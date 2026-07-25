import { describe, expect, it } from "bun:test";
import {
	generateBprfArtifact,
	validateBprfArtifact,
	type BprfArtifact,
	type PureRegionContract,
} from "../../src/isogloss/bprf/index.js";
import {
	evaluateBprfReference,
	selectBprfRealization,
} from "../../src/isogloss/bprf/testing-reference.js";

const fixture: PureRegionContract = {
	inputs: [
		{ type: "number" },
		{ type: "number" },
		{ type: "boolean" },
		{ type: "boolean" },
	],
	steps: [
		{ type: "number", formula: { tag: "product", left: 0, right: 1 } },
		{ type: "number", formula: { tag: "sum", left: 0, right: 1 } },
		{ type: "number", formula: { tag: "difference", left: 4, right: 5 } },
		{ type: "boolean", formula: { tag: "and", left: 2, right: 3 } },
		{ type: "boolean", formula: { tag: "xor", left: 2, right: 3 } },
		{ type: "boolean", formula: { tag: "or", left: 7, right: 8 } },
		{
			type: "number",
			formula: {
				tag: "select",
				gate: 9,
				whenTrue: 6,
				whenFalse: 5,
			},
		},
		{ type: "number", formula: { tag: "negate", value: 10 } },
		{ type: "boolean", formula: { tag: "not", value: 7 } },
	],
	outputs: [10, 11, 12, 8],
};

const cases = [
	[3, 5, true, false],
	[-4, 7, false, false],
	[6, -2, true, true],
	[0, 9, false, true],
] as const;

function expected(values: readonly [number, number, boolean, boolean]) {
	const [left, right, first, second] = values;
	const product = left * right;
	const sum = left + right;
	const difference = product - sum;
	const conjunction = first && second;
	const exclusive = first !== second;
	const gate = conjunction || exclusive;
	const selected = gate ? difference : sum;
	return [selected, -selected, !conjunction, exclusive] as const;
}

describe("pure BPRF reference kernel", () => {
	it("is equivalent across seeds, structural families, and caller contexts", () => {
		for (const seed of [0, 1, 0x12345678, 0xffffffff]) {
			const artifact = generateBprfArtifact(fixture, {
				seed,
				realizationCount: 4,
				fragmentCount: 3,
			});
			const reached = new Set<string>();
			for (let contextIndex = 0; contextIndex < 128; contextIndex++) {
				const context = {
					caller: `caller-${contextIndex % 11}`,
					epoch: Math.floor(contextIndex / 11),
					lineage: contextIndex * 7,
				};
				for (const inputs of cases) {
					const result = evaluateBprfReference(artifact, inputs, context);
					const oracle = expected(inputs);
					reached.add(result.realization);
					expect(result.outputs[0]).toBeCloseTo(oracle[0], 10);
					expect(result.outputs[1]).toBeCloseTo(oracle[1], 10);
					expect(result.outputs[2]).toBe(oracle[2]);
					expect(result.outputs[3]).toBe(oracle[3]);
				}
			}
			expect(reached.size).toBe(artifact.realizations.length);
			expect(
				new Set(artifact.realizations.map((realization) => realization.familyCode))
					.size
			).toBe(2);
		}
	});

	it("is byte-for-byte deterministic for a seed and diverse across seeds", () => {
		const options = { seed: 90210, realizationCount: 3, fragmentCount: 4 };
		const first = generateBprfArtifact(fixture, options);
		const second = generateBprfArtifact(fixture, options);
		const different = generateBprfArtifact(fixture, {
			...options,
			seed: options.seed + 1,
		});

		expect(JSON.stringify(second)).toBe(JSON.stringify(first));
		expect(JSON.stringify(different)).not.toBe(JSON.stringify(first));
		expect(() =>
			generateBprfArtifact(fixture, {
				...options,
				seed: 2 ** 32,
			})
		).toThrow("RUAM_BPRF_INVALID_SEED");
		expect(() =>
			generateBprfArtifact(
				{
					inputs: [{ type: "number" }],
					steps: [
						{
							type: "number",
							formula: {
								tag: "literal",
								type: "number",
								value: 0.1,
							},
						},
						{
							type: "number",
							formula: { tag: "sum", left: 0, right: 1 },
						},
					],
					outputs: [2],
				},
				options
			)
		).toThrow("RUAM_BPRF_UNSAFE_NUMBER_LITERAL");
	});

	it("fissions every destination and braids every fragment longitudinally", () => {
		const artifact = generateBprfArtifact(fixture, {
			seed: 7331,
			realizationCount: 4,
			fragmentCount: 3,
		});
		const report = validateBprfArtifact(artifact);

		expect(report.realizationCount).toBe(4);
		expect(report.familyCount).toBe(2);
		const directPhaseCounts = artifact.realizations
			.filter((realization) => realization.familyCode === 0)
			.map((realization) => realization.transitions.length);
		const residualPhaseCounts = artifact.realizations
			.filter((realization) => realization.familyCode === 1)
			.map((realization) => realization.transitions.length);
		expect(Math.min(...residualPhaseCounts)).toBeGreaterThan(
			Math.max(...directPhaseCounts)
		);
		for (const realization of artifact.realizations) {
			const destinations = new Set(
				realization.transitions.flatMap((transition) => transition.writes)
			);
			for (const destination of destinations) {
				const owners = new Set(
					realization.fragments
						.filter((fragment) =>
							fragment.pieces.some(
								(piece) => piece.destination === destination
							)
						)
						.map((fragment) => fragment.id)
				);
				expect(owners.size).toBe(realization.fragmentThreshold);
			}
			for (const fragment of realization.fragments) {
				expect(
					new Set(fragment.pieces.map((piece) => piece.destination)).size
				).toBeGreaterThan(1);
			}
			const inputSlots = new Set(
				realization.inputPorts.map((port) => port.slot)
			);
			for (const output of realization.outputPorts) {
				expect(inputSlots.has(output.slot)).toBe(false);
			}
		}

		const damaged = structuredClone(artifact) as BprfArtifact;
		(damaged.realizations[0]!.fragments as unknown[]).pop();
		expect(() => validateBprfArtifact(damaged)).toThrow(
			"RUAM_BPRF_FRAGMENT_THRESHOLD_MISMATCH"
		);
	});

	it("emits no semantic-dispatch identity and traces only contextual fabric IDs", () => {
		const artifact = generateBprfArtifact(fixture, {
			seed: 4141,
			realizationCount: 3,
			fragmentCount: 3,
		});
		const serialized = JSON.stringify(artifact);
		const forbiddenArtifactTokens = [
			"SemanticOp",
			"opcode",
			"operand",
			"handler",
			"nodeId",
			"sourceNode",
			'"sum"',
			'"difference"',
			'"product"',
			'"negate"',
			'"not"',
			'"and"',
			'"or"',
			'"xor"',
			'"select"',
			'"literal"',
			'"tag"',
			'"formula"',
		];
		for (const token of forbiddenArtifactTokens) {
			expect(serialized).not.toContain(token);
		}

		const result = evaluateBprfReference(
			artifact,
			cases[0],
			{ caller: "alpha", epoch: 2, lineage: 17 }
		);
		expect(result.trace.length).toBeGreaterThan(0);
		for (const event of result.trace) {
			expect(Object.keys(event).sort()).toEqual([
				"fragment",
				"phase",
				"realization",
				"transition",
			]);
			expect(event.realization).toBe(result.realization);
		}
		const serializedTrace = JSON.stringify(result.trace);
		for (const token of forbiddenArtifactTokens) {
			expect(serializedTrace).not.toContain(token);
		}
		expect(serializedTrace).not.toContain("coefficient");
		expect(serializedTrace).not.toContain("factors");
		expect(serializedTrace).not.toContain("destination");
	});

	it("selects variants from caller context without changing results", () => {
		const artifact = generateBprfArtifact(fixture, {
			seed: 8080,
			realizationCount: 3,
			fragmentCount: 3,
		});
		const selected = new Set<string>();
		for (let index = 0; index < 100; index++) {
			const context = {
				caller: `entry-${index}`,
				epoch: index % 5,
				lineage: index,
			};
			const realization = selectBprfRealization(artifact, context);
			const result = evaluateBprfReference(artifact, cases[1], context);
			selected.add(realization.id);
			expect(result.realization).toBe(realization.id);
			expect(result.outputs[0]).toBeCloseTo(expected(cases[1])[0], 10);
		}
		expect(selected.size).toBe(artifact.realizations.length);
	});
});
