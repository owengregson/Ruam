import { describe, expect, it } from "bun:test";
import {
	generateBprfArtifact,
	type BprfCallerContext,
	type PureRegionContract,
	type PureScalar,
} from "../../src/isogloss/bprf/index.js";
import {
	emitBprfTestingSource,
	type BprfTestingEmission,
} from "../../src/isogloss/bprf/testing-emitter.js";
import { evaluateBprfReference } from "../../src/isogloss/bprf/testing-reference.js";

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
		{ type: "boolean", formula: { tag: "not", value: 7 } },
	],
	outputs: [10, 11, 8],
};

type EmittedEntry = (
	inputs: readonly PureScalar[],
	context: BprfCallerContext,
	ownerTrace?: (event: unknown) => void
) => PureScalar[];

function instantiate(emission: BprfTestingEmission): EmittedEntry {
	return new Function(
		`${emission.source}\nreturn ${emission.entryName};`
	)() as EmittedEntry;
}

function expectEquivalent(
	actual: readonly PureScalar[],
	expected: readonly PureScalar[]
): void {
	expect(actual).toHaveLength(expected.length);
	for (let index = 0; index < actual.length; index++) {
		if (typeof expected[index] === "number") {
			expect(actual[index]).toBeCloseTo(expected[index] as number, 10);
		} else {
			expect(actual[index]).toBe(expected[index]);
		}
	}
}

describe("specialized BPRF source-emission spike", () => {
	it("matches the reference across seeds, ontologies, and caller contexts", () => {
		const inputs = [
			[3, 5, true, false],
			[-4, 7, false, false],
			[6, -2, true, true],
			[0, 9, false, true],
		] as const;
		for (const seed of [0, 1, 0x12345678, 0xffffffff]) {
			const artifact = generateBprfArtifact(fixture, {
				seed,
				realizationCount: 4,
				fragmentCount: 3,
			});
			const emission = emitBprfTestingSource(artifact);
			const execute = instantiate(emission);
			const reached = new Set<string>();
			for (let index = 0; index < 96; index++) {
				const context = {
					caller: `site-${index % 13}`,
					epoch: Math.floor(index / 13),
					lineage: index * 11,
				};
				for (const values of inputs) {
					const reference = evaluateBprfReference(
						artifact,
						values,
						context
					);
					reached.add(reference.realization);
					expectEquivalent(execute(values, context), reference.outputs);
				}
			}
			expect(reached.size).toBe(artifact.realizations.length);
		}
	});

	it("emits deterministic but structurally diverse specialized source", () => {
		const artifact = generateBprfArtifact(fixture, {
			seed: 7727,
			realizationCount: 4,
			fragmentCount: 3,
		});
		const first = emitBprfTestingSource(artifact);
		const second = emitBprfTestingSource(artifact);
		const differentArtifact = generateBprfArtifact(fixture, {
			seed: 7728,
			realizationCount: 4,
			fragmentCount: 3,
		});
		const different = emitBprfTestingSource(differentArtifact);

		expect(second.source).toBe(first.source);
		expect(different.source).not.toBe(first.source);
		expect(first.byteLength).toBe(Buffer.byteLength(first.source, "utf8"));
		expect(first.codeletCount).toBe(
			artifact.realizations.reduce(
				(total, realization) =>
					total +
					realization.transitions.length *
						realization.fragments.length,
				0
			)
		);

		const familyZeroCodelets =
			first.source.match(/function x0_\d+_\d+\(/g)?.length ?? 0;
		const familyOneCodelets =
			first.source.match(/function x1_\d+_\d+\(/g)?.length ?? 0;
		expect(familyOneCodelets).toBeGreaterThan(familyZeroCodelets);
	});

	it("contains direct codelets and no generic artifact execution seam", () => {
		const artifact = generateBprfArtifact(fixture, {
			seed: 9090,
			realizationCount: 3,
			fragmentCount: 3,
		});
		const emission = emitBprfTestingSource(artifact);
		const source = emission.source;
		const forbidden = [
			"SemanticOp",
			"opcode",
			"operand",
			"handler",
			"sourceNode",
			"nodeId",
			".pieces",
			".fragments",
			"artifact",
			"piece",
			"destination",
			"coefficient",
			"factors",
			'"sum"',
			'"difference"',
			'"product"',
			'"and"',
			'"or"',
			'"xor"',
			'"select"',
			'"not"',
		];
		for (const token of forbidden) expect(source).not.toContain(token);
		expect(source).not.toContain("switch(");
		expect(source).not.toContain("while(");
		expect(source.match(/\bfor\s*\(/g)?.length ?? 0).toBe(1);

		const functionCount = source.match(/\bfunction\s+/g)?.length ?? 0;
		expect(functionCount).toBe(
			emission.codeletCount + emission.realizationCount + 3
		);
		for (let realizationIndex = 0; realizationIndex < artifact.realizations.length; realizationIndex++) {
			const realization = artifact.realizations[realizationIndex]!;
			for (const transition of realization.transitions) {
				for (let fragmentIndex = 0; fragmentIndex < realization.fragments.length; fragmentIndex++) {
					const name = `x${realizationIndex}_${transition.phase}_${fragmentIndex}`;
					expect(source.split(name)).toHaveLength(3);
				}
			}
			for (const fragment of realization.fragments) {
				expect(source).not.toContain(fragment.id);
			}
		}
	});

	it("keeps owner tracing optional, opaque, and outside ordinary source", () => {
		const artifact = generateBprfArtifact(fixture, {
			seed: 5150,
			realizationCount: 3,
			fragmentCount: 3,
		});
		const ordinary = emitBprfTestingSource(artifact);
		const traced = emitBprfTestingSource(artifact, { ownerTracing: true });
		const execute = instantiate(traced);
		const events: Array<Record<string, unknown>> = [];
		const context = { caller: "trace-site", epoch: 3, lineage: 19 };
		const reference = evaluateBprfReference(
			artifact,
			[3, 5, true, false],
			context
		);
		const outputs = execute(
			[3, 5, true, false],
			context,
			(event) => events.push(event as Record<string, unknown>)
		);

		expectEquivalent(outputs, reference.outputs);
		expect(ordinary.source).not.toContain("if(z)z(");
		expect(traced.source).toContain("if(z)z(");
		expect(events.length).toBe(reference.trace.length);
		for (const event of events) {
			expect(Object.keys(event).sort()).toEqual(["f", "p", "r", "t"]);
			expect(typeof event.r).toBe("string");
			expect(typeof event.t).toBe("string");
			expect(typeof event.f).toBe("string");
			expect(typeof event.p).toBe("number");
		}

		const byTransition = new Map<string, Set<string>>();
		for (const event of events) {
			const transition = event.t as string;
			const owners = byTransition.get(transition) ?? new Set<string>();
			owners.add(event.f as string);
			byTransition.set(transition, owners);
		}
		const selected = artifact.realizations.find(
			(realization) => realization.id === events[0]!.r
		)!;
		expect(byTransition.size).toBe(selected.transitions.length);
		for (const owners of byTransition.values()) {
			expect(owners.size).toBe(selected.fragmentThreshold);
		}
	});

	it("enforces the narrow input and caller-context ABI", () => {
		const artifact = generateBprfArtifact(fixture, {
			seed: 17,
			realizationCount: 2,
			fragmentCount: 2,
		});
		const execute = instantiate(emitBprfTestingSource(artifact));
		expect(() =>
			execute([1, 2, true], { caller: "x", epoch: 0, lineage: 0 })
		).toThrow("RUAM_BPRF_INPUT_ABI");
		expect(() =>
			execute(
				[1, 2, true, false],
				{ caller: "x", epoch: -1, lineage: 0 }
			)
		).toThrow("RUAM_BPRF_CONTEXT_ABI");
	});
});
