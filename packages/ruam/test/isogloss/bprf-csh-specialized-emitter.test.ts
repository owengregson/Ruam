import { describe, expect, it } from "bun:test";
import {
	generateBprfArtifact,
	type BprfArtifact,
	type BprfCallerContext,
	type PureRegionContract,
	type PureScalar,
} from "../../src/isogloss/bprf/index.js";
import { selectBprfRealization } from "../../src/isogloss/bprf/testing-reference.js";
import { createChartCover, type ChartCover } from "../../src/isogloss/csh/reference.js";
import {
	emitBprfOverCshTestingSource,
	type BprfCshTestingEmission,
} from "../../src/isogloss/csh/testing-emitter.js";
import { evaluateBprfOverCshReference } from "../../src/isogloss/csh/testing-bprf-reference.js";

const contract: PureRegionContract = {
	inputs: [
		{ type: "number" },
		{ type: "number" },
		{ type: "boolean" },
	],
	steps: [
		{ type: "number", formula: { tag: "product", left: 0, right: 1 } },
		{ type: "number", formula: { tag: "sum", left: 0, right: 1 } },
		{ type: "number", formula: { tag: "difference", left: 3, right: 4 } },
		{ type: "boolean", formula: { tag: "not", value: 2 } },
		{
			type: "number",
			formula: {
				tag: "select",
				gate: 2,
				whenTrue: 5,
				whenFalse: 4,
			},
		},
	],
	outputs: [7, 6],
};

type SpecializedEntry = (inputs: readonly PureScalar[]) => PureScalar[];

function instantiate(emission: BprfCshTestingEmission): SpecializedEntry {
	return new Function(
		`${emission.source}\nreturn ${emission.entryName};`
	)() as SpecializedEntry;
}

function findContext(
	artifact: BprfArtifact,
	familyCode: 0 | 1
): BprfCallerContext {
	for (let index = 0; index < 1_000; index++) {
		const context = {
			caller: `csh-emitter-${index}`,
			epoch: index % 17,
			lineage: index * 5,
		};
		if (selectBprfRealization(artifact, context).familyCode === familyCode) {
			return context;
		}
	}
	throw new Error(`Missing family ${familyCode}`);
}

function coversFor(
	artifact: BprfArtifact,
	context: BprfCallerContext,
	seed: number
): ChartCover[] {
	const realization = selectBprfRealization(artifact, context);
	return Array.from(
		{ length: realization.transitions.length + 1 },
		(_, epoch) =>
			createChartCover({
				seed,
				epoch,
				width: realization.frameSize,
				chartCount: 5,
				threshold: 3,
			})
	);
}

function expectEquivalent(
	actual: readonly PureScalar[],
	expected: readonly PureScalar[]
): void {
	expect(actual).toHaveLength(expected.length);
	for (let index = 0; index < actual.length; index++) {
		expect(Object.is(actual[index], -0) ? 0 : actual[index]).toBe(
			Object.is(expected[index], -0) ? 0 : expected[index]
		);
	}
}

describe("specialized BPRF-over-CSH source-emission spike", () => {
	it("matches the combined reference across both ontologies and contexts", () => {
		const artifact = generateBprfArtifact(contract, {
			seed: 0x51c0ffee,
			realizationCount: 4,
			fragmentCount: 3,
		});
		const inputs = [
			[3, 4, true],
			[-2, 5, false],
			[0, 7, true],
			[6, -3, false],
		] as const;

		for (const familyCode of [0, 1] as const) {
			const context = findContext(artifact, familyCode);
			const covers = coversFor(artifact, context, 0x600d0000 + familyCode);
			const seed = 0x700d0000 + familyCode;
			const emission = emitBprfOverCshTestingSource(
				artifact,
				context,
				covers,
				seed
			);
			const execute = instantiate(emission);
			expect(emission.familyCode).toBe(familyCode);
			for (const values of inputs) {
				const reference = evaluateBprfOverCshReference(
					artifact,
					values,
					context,
					covers,
					seed
				);
				expectEquivalent(execute(values), reference.outputs);
			}
		}
	});

	it("is deterministic and bakes a distinct cover at every transition", () => {
		const artifact = generateBprfArtifact(contract, {
			seed: 31337,
			realizationCount: 3,
			fragmentCount: 3,
		});
		const context = findContext(artifact, 0);
		const covers = coversFor(artifact, context, 41414);
		const first = emitBprfOverCshTestingSource(
			artifact,
			context,
			covers,
			51515
		);
		const replay = emitBprfOverCshTestingSource(
			artifact,
			context,
			covers,
			51515
		);
		const changedCovers = coversFor(artifact, context, 41415);
		const changed = emitBprfOverCshTestingSource(
			artifact,
			context,
			changedCovers,
			51515
		);
		const realization = selectBprfRealization(artifact, context);

		expect(replay.source).toBe(first.source);
		expect(changed.source).not.toBe(first.source);
		expect(first.coverIds).toEqual(covers.map((cover) => cover.id));
		expect(new Set(first.coverIds).size).toBe(first.coverIds.length);
		expect(first.coverIds).toHaveLength(realization.transitions.length + 1);
		expect(first.reductionCount).toBe(realization.transitions.length * 5);
		expect(first.contributorCodeletCount).toBe(
			realization.transitions.length * 25
		);
		expect(first.fragmentCodeletCount).toBe(
			realization.transitions.length *
				5 *
				realization.fragments.length
		);

		const reusedEpoch = covers.slice();
		reusedEpoch[1] = createChartCover({
			seed: 91919,
			epoch: covers[0]!.epoch,
			width: realization.frameSize,
			chartCount: 5,
			threshold: 3,
		});
		expect(() =>
			emitBprfOverCshTestingSource(
				artifact,
				context,
				reusedEpoch,
				51515
			)
		).toThrow("RUAM_BPRF_CSH_EMITTER_EPOCH_REUSE");
	});

	it("contains no artifact walker, chart/frame array, or global decode seam", () => {
		const artifact = generateBprfArtifact(contract, {
			seed: 60606,
			realizationCount: 2,
			fragmentCount: 3,
		});
		const context = findContext(artifact, 0);
		const covers = coversFor(artifact, context, 70707);
		const emission = emitBprfOverCshTestingSource(
			artifact,
			context,
			covers,
			80808
		);
		const source = emission.source.toLowerCase();
		for (const token of [
			"semanticop",
			"opcode",
			"operand",
			"handler",
			"sourcenode",
			"artifact",
			".pieces",
			".fragments",
			".charts",
			".cells",
			"global",
			"decode",
			"ownertrace",
			"transition",
			"fragment",
		]) {
			expect(source).not.toContain(token);
		}
		expect(source).not.toContain("new array");
		expect(source).not.toContain("switch(");
		expect(source).not.toContain("while(");
		expect(source.match(/\bfor\s*\(/g)?.length ?? 0).toBe(0);
		expect(source).not.toContain(".map(");
		expect(source).not.toContain(".reduce(");
		expect(source).not.toContain(".flatmap(");
		expect(source).not.toContain("c[");
	});

	it("makes all five degree-reduction contributors structurally necessary", () => {
		const artifact = generateBprfArtifact(contract, {
			seed: 90909,
			realizationCount: 2,
			fragmentCount: 3,
		});
		const context = findContext(artifact, 0);
		const realization = selectBprfRealization(artifact, context);
		const emission = emitBprfOverCshTestingSource(
			artifact,
			context,
			coversFor(artifact, context, 10010),
			11011
		);

		for (
			let transitionIndex = 0;
			transitionIndex < realization.transitions.length;
			transitionIndex++
		) {
			for (let targetIndex = 0; targetIndex < 5; targetIndex++) {
				const definition = `function w${transitionIndex}_${targetIndex}(d0,d1,d2,d3,d4)`;
				expect(emission.source).toContain(definition);
				for (let contributor = 0; contributor < 5; contributor++) {
					expect(
						emission.source.split(
							`d${transitionIndex}_${targetIndex}_${contributor}`
						)
					).toHaveLength(3);
				}
			}
		}
		expect(emission.contributorCodeletCount).toBe(
			emission.reductionCount * 5
		);
	});

	it("enforces the finite-field integer/boolean test ABI", () => {
		const artifact = generateBprfArtifact(contract, {
			seed: 12121,
			realizationCount: 2,
			fragmentCount: 2,
		});
		const context = findContext(artifact, 0);
		const execute = instantiate(
			emitBprfOverCshTestingSource(
				artifact,
				context,
				coversFor(artifact, context, 13131),
				14141
			)
		);

		expect(() => execute([1, 2])).toThrow("RUAM_CSH_INPUT_ABI");
		expect(() => execute([1.5, 2, true])).toThrow("RUAM_CSH_INPUT_ABI");
		expect(() => execute([20_000, 2, true])).toThrow("RUAM_CSH_INPUT_ABI");
		expect(() => execute([1, 2, 1])).toThrow("RUAM_CSH_INPUT_ABI");
	});
});
