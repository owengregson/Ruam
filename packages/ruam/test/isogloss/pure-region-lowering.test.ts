import { describe, expect, it } from "bun:test";
import { parse } from "@babel/parser";
import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import { traverse } from "../../src/babel-compat.js";
import {
	compileSemanticFunction,
	isPureRegionValueInDomain,
	lowerEffectRegionsToPureContract,
	resetUnitCounter,
	type PureRegionInputAssumption,
} from "../../src/compiler/index.js";
import type { SemanticUnit } from "../../src/compiler/ir.js";
import { SemanticOp } from "../../src/compiler/semantic-ops.js";
import {
	buildEffectRegionGraph,
	type EffectRegionGraph,
} from "../../src/compiler/regions.js";
import { generateBprfArtifact } from "../../src/isogloss/bprf/index.js";
import { evaluateBprfReference } from "../../src/isogloss/bprf/testing-reference.js";

interface CompiledFixture {
	unit: SemanticUnit;
	graph: EffectRegionGraph;
}

function getFunctionPath(
	source: string,
	name: string
): NodePath<t.Function> {
	const ast = parse(source, {
		sourceType: "script",
		sourceFilename: "pure-region-lowering-fixture.js",
	});
	let result: NodePath<t.Function> | undefined;
	traverse(ast, {
		Function(path) {
			const id = "id" in path.node ? path.node.id : null;
			if (id?.type === "Identifier" && id.name === name) {
				result = path as NodePath<t.Function>;
				path.stop();
			}
		},
	});
	if (!result) throw new Error(`Missing function ${name}`);
	return result;
}

function compileFixture(source: string, name: string): CompiledFixture {
	resetUnitCounter(711);
	const group = compileSemanticFunction(
		getFunctionPath(source, name),
		`pure-${name}`
	);
	const unit = group.units.find(
		(candidate) => candidate.id === group.entryUnitId
	)!;
	return { unit, graph: buildEffectRegionGraph(unit) };
}

function prefixBeforeReturn(fixture: CompiledFixture): string[] {
	const returnRegionIndex = fixture.graph.regions.findIndex((region) =>
		region.nodeIds.some(
			(nodeId) =>
				fixture.unit.nodes.find((node) => node.id === nodeId)!.op ===
				SemanticOp.RETURN
		)
	);
	if (returnRegionIndex < 1) throw new Error("Missing return boundary");
	return fixture.graph.regions
		.slice(0, returnRegionIndex)
		.map((region) => region.id);
}

function numberArgument(
	index: number,
	min: number,
	max: number
): PureRegionInputAssumption {
	return {
		binding: { kind: "argument", index },
		domain: { type: "number", min, max },
	};
}

describe("canonical effect-region to pure BPRF lowering", () => {
	it("lowers a compiler-produced bounded numeric span with explicit bindings", () => {
		const fixture = compileFixture(
			`function calc(a) {
				let x = a * 3;
				x = x + a;
				x = x - 1;
				return -x;
			}`,
			"calc"
		);
		const request = {
			regionIds: prefixBeforeReturn(fixture),
			assumptions: [numberArgument(0, 1, 20)],
		};

		const first = lowerEffectRegionsToPureContract(
			fixture.unit,
			fixture.graph,
			request
		);
		const second = lowerEffectRegionsToPureContract(
			fixture.unit,
			fixture.graph,
			request
		);

		expect(JSON.stringify(second)).toBe(JSON.stringify(first));
		expect(first.contract.inputs).toEqual([{ type: "number" }]);
		expect(
			first.contract.steps.map((step) => step.formula.tag)
		).toEqual([
			"literal",
			"product",
			"sum",
			"literal",
			"difference",
			"negate",
		]);
		expect(first.inputBindings).toEqual([
			{
				contractInput: 0,
				binding: { kind: "argument", index: 0 },
				domain: { type: "number", min: 1, max: 20 },
			},
		]);
		expect(first.outputBindings.map((output) => output.binding)).toEqual([
			{ kind: "stack", index: 0 },
			{ kind: "register", index: 0 },
			{ kind: "register", index: 1 },
		]);
		expect(first.outputBindings[0]!.domain).toEqual({
			type: "number",
			min: -79,
			max: -3,
		});
		expect(JSON.stringify(first.contract)).not.toContain("SemanticOp");
		expect(JSON.stringify(first.contract)).not.toContain("nodeId");
		expect(JSON.stringify(first.contract)).not.toContain("opcode");
	});

	it("is exactly differential-equivalent through every BPRF realization", () => {
		const fixture = compileFixture(
			`function calc(a) {
				let x = a * 3;
				x = x + a;
				x = x - 1;
				return -x;
			}`,
			"calc"
		);
		const lowered = lowerEffectRegionsToPureContract(
			fixture.unit,
			fixture.graph,
			{
				regionIds: prefixBeforeReturn(fixture),
				assumptions: [numberArgument(0, 1, 20)],
			}
		);
		const stackOutput = lowered.outputBindings.find(
			(output) =>
				output.binding.kind === "stack" && output.binding.index === 0
		)!;

		for (const seed of [0, 1, 0x12345678, 0xffffffff]) {
			const artifact = generateBprfArtifact(lowered.contract, {
				seed,
				realizationCount: 4,
				fragmentCount: 3,
			});
			const serializedArtifact = JSON.stringify(artifact);
			for (const forbidden of [
				"SemanticOp",
				"opcode",
				"nodeId",
				"regionIds",
				'"argument"',
				'"register"',
			]) {
				expect(serializedArtifact).not.toContain(forbidden);
			}
			const reached = new Set<string>();
			for (let contextIndex = 0; contextIndex < 64; contextIndex++) {
				const context = {
					caller: `numeric-caller-${contextIndex % 7}`,
					epoch: Math.floor(contextIndex / 7),
					lineage: contextIndex * 13,
				};
				for (const input of [1, 2, 7, 13, 20]) {
					const nativeResult = -(input * 3 + input - 1);
					const result = evaluateBprfReference(
						artifact,
						[input],
						context
					);
					reached.add(result.realization);
					expect(
						result.outputs[stackOutput.contractOutput]
					).toBe(nativeResult);
				}
			}
			expect(reached.size).toBe(artifact.realizations.length);
		}
	});

	it("maps an interior span's stack and frame dependencies explicitly", () => {
		const fixture = compileFixture(
			`function calc(a) {
				let x = a * 3;
				x = x + a;
				x = x - 1;
				return -x;
			}`,
			"calc"
		);
		const start = fixture.graph.regions.findIndex((region) =>
			region.nodeIds.some(
				(nodeId) =>
					fixture.unit.nodes.find((node) => node.id === nodeId)!.op ===
					SemanticOp.MUL
			)
		);
		const returnBoundary = fixture.graph.regions.findIndex((region) =>
			region.nodeIds.some(
				(nodeId) =>
					fixture.unit.nodes.find((node) => node.id === nodeId)!.op ===
					SemanticOp.RETURN
			)
		);
		const lowered = lowerEffectRegionsToPureContract(
			fixture.unit,
			fixture.graph,
			{
				regionIds: fixture.graph.regions
					.slice(start, returnBoundary)
					.map((region) => region.id),
				assumptions: [
					{
						binding: { kind: "stack", index: 0 },
						domain: { type: "number", min: 1, max: 20 },
					},
					{
						binding: { kind: "stack", index: 1 },
						domain: { type: "number", min: 3, max: 3 },
					},
					{
						binding: { kind: "register", index: 0 },
						domain: { type: "number", min: 1, max: 20 },
					},
				],
			}
		);

		expect(
			lowered.inputBindings.map((input) => input.binding)
		).toEqual([
			{ kind: "stack", index: 0 },
			{ kind: "stack", index: 1 },
			{ kind: "register", index: 0 },
		]);
		expect(
			lowered.outputBindings.some(
				(output) =>
					output.binding.kind === "stack" &&
					output.binding.index === 0
			)
		).toBe(true);
	});

	it("lowers intrinsic boolean operations without coercion", () => {
		const fixture = compileFixture(
			`function flip(value) {
				let result = !value;
				result = !result;
				return !result;
			}`,
			"flip"
		);
		const lowered = lowerEffectRegionsToPureContract(
			fixture.unit,
			fixture.graph,
			{
				regionIds: prefixBeforeReturn(fixture),
				assumptions: [
					{
						binding: { kind: "argument", index: 0 },
						domain: { type: "boolean" },
					},
				],
			}
		);
		const artifact = generateBprfArtifact(lowered.contract, {
			seed: 9191,
			realizationCount: 4,
			fragmentCount: 3,
		});
		const stackOutput = lowered.outputBindings.find(
			(output) => output.binding.kind === "stack"
		)!;

		expect(
			lowered.contract.steps.map((step) => step.formula.tag)
		).toEqual(["not", "not", "not"]);
		for (const value of [true, false]) {
			const result = evaluateBprfReference(
				artifact,
				[value],
				{ caller: "boolean", epoch: 2, lineage: value ? 1 : 0 }
			);
			expect(result.outputs[stackOutput.contractOutput]).toBe(!value);
		}
	});

	it("exposes exact entry guards for downstream fallback routing", () => {
		const numberDomain = { type: "number", min: 1, max: 20 } as const;
		const booleanDomain = { type: "boolean" } as const;

		expect(isPureRegionValueInDomain(1, numberDomain)).toBe(true);
		expect(isPureRegionValueInDomain(20, numberDomain)).toBe(true);
		expect(isPureRegionValueInDomain(0, numberDomain)).toBe(false);
		expect(isPureRegionValueInDomain(21, numberDomain)).toBe(false);
		expect(isPureRegionValueInDomain(1.5, numberDomain)).toBe(false);
		expect(isPureRegionValueInDomain(-0, {
			type: "number",
			min: -1,
			max: 1,
		})).toBe(false);
		expect(isPureRegionValueInDomain(true, numberDomain)).toBe(false);
		expect(isPureRegionValueInDomain(true, booleanDomain)).toBe(true);
		expect(isPureRegionValueInDomain(1, booleanDomain)).toBe(false);
	});

	it("rejects unknown or mismatched input types instead of assuming purity", () => {
		const fixture = compileFixture(
			`function calc(a) {
				let x = a * 3;
				x = x + a;
				x = x - 1;
				return -x;
			}`,
			"calc"
		);
		const regionIds = prefixBeforeReturn(fixture);

		expect(() =>
			lowerEffectRegionsToPureContract(fixture.unit, fixture.graph, {
				regionIds,
				assumptions: [],
			})
		).toThrow("RUAM_PURE_REGION_INPUT_TYPE_REQUIRED");
		expect(() =>
			lowerEffectRegionsToPureContract(fixture.unit, fixture.graph, {
				regionIds,
				assumptions: [
					{
						binding: { kind: "argument", index: 0 },
						domain: { type: "boolean" },
					},
				],
			})
		).toThrow("RUAM_PURE_REGION_TYPE_MISMATCH");
	});

	it("rejects effects, calls, branches, and unsupported arithmetic", () => {
		const property = compileFixture(
			`function property(value) { return value.answer; }`,
			"property"
		);
		expect(() =>
			lowerEffectRegionsToPureContract(property.unit, property.graph, {
				regionIds: prefixBeforeReturn(property),
				assumptions: [
					{
						binding: { kind: "argument", index: 0 },
						domain: { type: "boolean" },
					},
				],
			})
		).toThrow("RUAM_PURE_REGION_DYNAMIC_STACK");

		const call = compileFixture(
			`function invoke(fn) { return fn(1); }`,
			"invoke"
		);
		expect(() =>
			lowerEffectRegionsToPureContract(call.unit, call.graph, {
				regionIds: prefixBeforeReturn(call),
				assumptions: [
					{
						binding: { kind: "argument", index: 0 },
						domain: { type: "boolean" },
					},
				],
			})
		).toThrow("RUAM_PURE_REGION_UNREPRESENTABLE_CONTROL");

		const branch = compileFixture(
			`function choose(flag) { return flag ? 1 : 2; }`,
			"choose"
		);
		expect(() =>
			lowerEffectRegionsToPureContract(branch.unit, branch.graph, {
				regionIds: branch.graph.regions.map((region) => region.id),
				assumptions: [
					{
						binding: { kind: "argument", index: 0 },
						domain: { type: "boolean" },
					},
				],
			})
		).toThrow("RUAM_PURE_REGION_UNREPRESENTABLE_CONTROL");

		const division = compileFixture(
			`function divide(left, right) { return left / right; }`,
			"divide"
		);
		expect(() =>
			lowerEffectRegionsToPureContract(division.unit, division.graph, {
				regionIds: prefixBeforeReturn(division),
				assumptions: [
					numberArgument(0, 1, 20),
					numberArgument(1, 1, 20),
				],
			})
		).toThrow("RUAM_PURE_REGION_UNSUPPORTED_OP");
	});

	it("rejects signed-zero, fractional, overflow, and non-braidable cases", () => {
		const negate = compileFixture(
			`function negate(value) { return -value; }`,
			"negate"
		);
		expect(() =>
			lowerEffectRegionsToPureContract(negate.unit, negate.graph, {
				regionIds: prefixBeforeReturn(negate),
				assumptions: [numberArgument(0, -1, 1)],
			})
		).toThrow("RUAM_PURE_REGION_NEGATIVE_ZERO_RISK");

		const fractional = compileFixture(
			`function fractional(value) {
				let result = value + 2.5;
				return !result;
			}`,
			"fractional"
		);
		expect(() =>
			lowerEffectRegionsToPureContract(
				fractional.unit,
				fractional.graph,
				{
					regionIds: prefixBeforeReturn(fractional),
					assumptions: [numberArgument(0, 1, 20)],
				}
			)
		).toThrow("RUAM_PURE_REGION_UNSAFE_NUMBER_LITERAL");

		const overflow = compileFixture(
			`function grow(value) { return value * value; }`,
			"grow"
		);
		expect(() =>
			lowerEffectRegionsToPureContract(overflow.unit, overflow.graph, {
				regionIds: prefixBeforeReturn(overflow),
				assumptions: [numberArgument(0, 1_000, 1_000_000)],
			})
		).toThrow("RUAM_PURE_REGION_NUMERIC_DOMAIN_OVERFLOW");

		const oneStep = compileFixture(
			`function oneStep(value) { return !value; }`,
			"oneStep"
		);
		expect(() =>
			lowerEffectRegionsToPureContract(oneStep.unit, oneStep.graph, {
				regionIds: prefixBeforeReturn(oneStep),
				assumptions: [
					{
						binding: { kind: "argument", index: 0 },
						domain: { type: "boolean" },
					},
				],
			})
		).toThrow("RUAM_PURE_REGION_REQUIRES_BRAIDABLE_STEPS");
	});
});
