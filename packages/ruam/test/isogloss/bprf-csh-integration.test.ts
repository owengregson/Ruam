import { describe, expect, it } from "bun:test";
import {
	generateBprfArtifact,
	type PureRegionContract,
} from "../../src/isogloss/bprf/index.js";
import {
	evaluateBprfReference,
	selectBprfRealization,
} from "../../src/isogloss/bprf/testing-reference.js";
import { evaluateBprfOverCshReference } from "../../src/isogloss/csh/testing-bprf-reference.js";
import { createChartCover } from "../../src/isogloss/csh/reference.js";

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

function coversFor(
	artifact: ReturnType<typeof generateBprfArtifact>,
	context: { caller: string; epoch: number; lineage: number },
	seed: number
) {
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

const normalizeFieldSpikeOutput = (value: unknown): unknown =>
	typeof value === "number" && Object.is(value, -0) ? 0 : value;

describe("BPRF over moving-cover CSH reference", () => {
	it("matches both BPRF ontologies without reconstructing a transition frame", () => {
		const artifact = generateBprfArtifact(contract, {
			seed: 0x51c0ffee,
			realizationCount: 4,
			fragmentCount: 3,
		});
		const reachedFamilies = new Set<number>();
		for (let index = 0; index < 80; index++) {
			const context = {
				caller: `integration-caller-${index % 13}`,
				epoch: index,
				lineage: index * 17,
			};
			const realization = selectBprfRealization(artifact, context);
			reachedFamilies.add(realization.familyCode);
			const inputs = [
				(index % 7) - 3,
				(index % 5) + 1,
				index % 2 === 0,
			] as const;
			const plain = evaluateBprfReference(artifact, inputs, context);
			const integrated = evaluateBprfOverCshReference(
				artifact,
				inputs,
				context,
				coversFor(artifact, context, 0x600d0000 + index),
				0x700d0000 + index
			);

			expect(integrated.realization).toBe(plain.realization);
			expect(integrated.outputs).toEqual(
				plain.outputs.map(normalizeFieldSpikeOutput)
			);
			expect(integrated.trace.length).toBeGreaterThan(
				realization.transitions.length
			);
		}
		expect(reachedFamilies).toEqual(new Set([0, 1]));
	});

	it("requires the five-chart multiplication quorum at every transition", () => {
		const artifact = generateBprfArtifact(contract, {
			seed: 1414,
			realizationCount: 2,
			fragmentCount: 3,
		});
		const context = { caller: "quorum", epoch: 1, lineage: 2 };
		const covers = coversFor(artifact, context, 1515);
		const valid = evaluateBprfOverCshReference(
			artifact,
			[3, 4, true],
			context,
			covers,
			1616
		);
		expect(valid.outputs).toEqual([5, false]);

		const damagedCovers = covers.map((cover, index) =>
			index === 0
				? createChartCover({
						seed: 1516,
						epoch: cover.epoch,
						width: cover.width,
						chartCount: 5,
						threshold: 4,
				  })
				: cover
		);
		expect(() =>
			evaluateBprfOverCshReference(
				artifact,
				[3, 4, true],
				context,
				damagedCovers,
				1616
			)
		).toThrow("RUAM_BPRF_CSH_MULTIPLICATION_QUORUM_TOO_SMALL");
	});

	it("changes cover at every transition and exposes only contextual trace identities", () => {
		const artifact = generateBprfArtifact(contract, {
			seed: 1717,
			realizationCount: 3,
			fragmentCount: 3,
		});
		const context = { caller: "trace", epoch: 4, lineage: 9 };
		const covers = coversFor(artifact, context, 1818);
		const result = evaluateBprfOverCshReference(
			artifact,
			[2, 5, false],
			context,
			covers,
			1919
		);

		expect(new Set(covers.map((cover) => cover.id)).size).toBe(covers.length);
		for (const event of result.trace) {
			expect(event.fromCover).not.toBe(event.toCover);
			expect(Object.keys(event).sort()).toEqual([
				"chart",
				"fragment",
				"fromCover",
				"phase",
				"realization",
				"toCover",
				"transition",
			]);
		}
		const serialized = JSON.stringify(result.trace).toLowerCase();
		for (const forbidden of [
			"semanticop",
			"opcode",
			"operand",
			"handler",
			"coefficient",
			"factor",
			"destination",
			"sourcenode",
		]) {
			expect(serialized).not.toContain(forbidden);
		}
	});
});
