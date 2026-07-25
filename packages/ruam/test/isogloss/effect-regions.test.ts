import { describe, expect, it } from "bun:test";
import { parse } from "@babel/parser";
import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import { traverse } from "../../src/babel-compat.js";
import { buildCanonicalCfg } from "../../src/compiler/cfg.js";
import {
	compileSemanticFunction,
	resetUnitCounter,
} from "../../src/compiler/index.js";
import {
	createSemanticInstruction,
	type SemanticUnit,
} from "../../src/compiler/ir.js";
import { Op } from "../../src/compiler/operations.js";
import {
	buildEffectRegionGraph,
	validateEffectRegionGraph,
	type EffectRegionGraph,
} from "../../src/compiler/regions.js";

function getFunctionPath(
	source: string,
	name: string
): NodePath<t.Function> {
	const ast = parse(source, {
		sourceType: "script",
		sourceFilename: "effect-region-fixture.js",
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

function graphSnapshot(graph: EffectRegionGraph): unknown {
	return {
		unitId: graph.unitId,
		entryRegionId: graph.entryRegionId,
		regions: graph.regions,
		ownership: [...graph.nodeOwnership].sort(
			([left], [right]) => left - right
		),
	};
}

describe("effect-delimited region construction", () => {
	it("fuses a safe straight-line frame-local run and computes its boundary", () => {
		const cfg = buildCanonicalCfg({
			instructions: [
				{ opcode: Op.PUSH_TRUE, operand: 0 },
				{ opcode: Op.NOT, operand: 0 },
				{ opcode: Op.STORE_REG, operand: 2 },
				{ opcode: Op.LOAD_REG, operand: 2 },
				{ opcode: Op.NOT, operand: 0 },
				{ opcode: Op.RETURN, operand: 0 },
			],
			originIds: [0, 0, 0, 0, 0, 0],
		});

		const graph = buildEffectRegionGraph(cfg);

		expect(graph.entryRegionId).toBe("r_0");
		expect(graph.regions).toHaveLength(2);
		expect(graph.regions[0]!.nodeIds).toEqual([0, 1, 2, 3, 4]);
		expect(graph.regions[0]!.inputs).toEqual({ stack: 0, state: [] });
		expect(graph.regions[0]!.outputs).toEqual({
			stack: 1,
			state: [{ domain: "register", key: 2 }],
		});
		expect(graph.regions[0]!.effects.purity).toBe("frame-local");
		expect(graph.regions[0]!.effects.frameAccess).toBe("read-write");
		expect(graph.regions[0]!.exits).toEqual([
			{
				kind: "fallthrough",
				sourceNodeId: 4,
				targetNodeId: 5,
				targetRegionId: "r_5",
			},
		]);
		expect(graph.regions[1]!.inputs.stack).toBe(1);
		expect(graph.regions[1]!.outputs.stack).toBe(0);
		expect(graph.regions[1]!.exits).toEqual([
			{ kind: "return", sourceNodeId: 5 },
		]);
		for (let nodeId = 0; nodeId <= 4; nodeId++) {
			expect(graph.nodeOwnership.get(nodeId)).toBe("r_0");
		}
		expect(graph.nodeOwnership.get(5)).toBe("r_5");
		expect(() => validateEffectRegionGraph(cfg, graph)).not.toThrow();
	});

	it("isolates observable property access, unknown arity, and exception exits", () => {
		const cfg = buildCanonicalCfg({
			instructions: [
				{ opcode: Op.PUSH_CONST, operand: 0 },
				{ opcode: Op.GET_PROP_STATIC, operand: 1 },
				{ opcode: Op.RETURN, operand: 0 },
			],
			originIds: [0, 0, 0],
		});

		const graph = buildEffectRegionGraph(cfg);
		const propertyRegion = graph.regions[1]!;

		expect(graph.regions.map((region) => region.nodeIds)).toEqual([
			[0],
			[1],
			[2],
		]);
		expect(propertyRegion.inputs.stack).toBe("dynamic");
		expect(propertyRegion.outputs.stack).toBe("dynamic");
		expect(propertyRegion.effects.objectAccess).toBe("read");
		expect(propertyRegion.effects.callKinds).toEqual(["host-protocol"]);
		expect(propertyRegion.effects.throwBehavior).toBe("may-throw");
		expect(propertyRegion.exits).toEqual([
			{
				kind: "fallthrough",
				sourceNodeId: 1,
				targetNodeId: 2,
				targetRegionId: "r_2",
			},
			{ kind: "throw", sourceNodeId: 1 },
		]);
	});

	it("splits branches and control joins even when adjacent nodes are pure", () => {
		const cfg = buildCanonicalCfg({
			instructions: [
				{ opcode: Op.LOAD_ARG, operand: 0 },
				{ opcode: Op.JMP_FALSE, operand: 4 },
				{ opcode: Op.PUSH_TRUE, operand: 0 },
				{ opcode: Op.JMP, operand: 5 },
				{ opcode: Op.PUSH_FALSE, operand: 0 },
				{ opcode: Op.NOT, operand: 0 },
				{ opcode: Op.RETURN, operand: 0 },
			],
			originIds: [0, 0, 0, 0, 0, 0, 0],
		});

		const graph = buildEffectRegionGraph(cfg);

		expect(graph.regions.map((region) => region.nodeIds)).toEqual([
			[0],
			[1],
			[2],
			[3],
			[4],
			[5],
			[6],
		]);
		expect(graph.regions[1]!.exits).toEqual([
			{
				kind: "branch-false",
				sourceNodeId: 1,
				targetNodeId: 4,
				targetRegionId: "r_4",
			},
			{
				kind: "branch-true",
				sourceNodeId: 1,
				targetNodeId: 2,
				targetRegionId: "r_2",
			},
		]);
		expect(graph.nodeOwnership.get(4)).not.toBe(
			graph.nodeOwnership.get(5)
		);
	});

	it("preserves call and suspension resumptions as typed region exits", () => {
		const cfg = buildCanonicalCfg({
			instructions: [
				{ opcode: Op.CALL, operand: 0 },
				{ opcode: Op.AWAIT, operand: 0 },
				{ opcode: Op.RETURN, operand: 0 },
			],
			originIds: [0, 0, 0],
		});

		const graph = buildEffectRegionGraph(cfg);

		expect(graph.regions.map((region) => region.nodeIds)).toEqual([
			[0],
			[1],
			[2],
		]);
		expect(graph.regions[0]!.exits).toEqual([
			{
				kind: "call",
				sourceNodeId: 0,
				resumeNodeId: 1,
				resumeRegionId: "r_1",
			},
			{ kind: "throw", sourceNodeId: 0 },
		]);
		expect(graph.regions[1]!.exits).toEqual([
			{
				kind: "await",
				sourceNodeId: 1,
				resumeNodeId: 2,
				resumeRegionId: "r_2",
			},
			{ kind: "throw", sourceNodeId: 1 },
		]);
		expect(graph.regions[1]!.effects.suspensions).toEqual(["await"]);
	});

	it("keeps structured exception handlers outside the throwing region", () => {
		const packedTryTargets = (5 << 16) | 0xffff;
		const cfg = buildCanonicalCfg({
			instructions: [
				{ opcode: Op.TRY_PUSH, operand: packedTryTargets },
				{ opcode: Op.PUSH_CONST, operand: 0 },
				{ opcode: Op.GET_PROP_STATIC, operand: 1 },
				{ opcode: Op.TRY_POP, operand: 0 },
				{ opcode: Op.JMP, operand: 6 },
				{ opcode: Op.CATCH_BIND, operand: -1 },
				{ opcode: Op.RETURN_VOID, operand: 0 },
			],
			originIds: [0, 0, 0, 0, 0, 0, 0],
		});

		const graph = buildEffectRegionGraph(cfg);
		const propertyRegion = graph.regions.find(
			(region) => region.entryNodeId === 2
		)!;

		expect(propertyRegion.exits).toEqual([
			{
				kind: "fallthrough",
				sourceNodeId: 2,
				targetNodeId: 3,
				targetRegionId: "r_3",
			},
			{
				kind: "exception",
				sourceNodeId: 2,
				targetNodeId: 5,
				targetRegionId: "r_5",
			},
		]);
		expect(graph.nodeOwnership.get(2)).not.toBe(
			graph.nodeOwnership.get(5)
		);
	});

	it("is deterministic and covers every compiler-produced semantic node once", () => {
		const source = `
			function flip(value) {
				let result = !value;
				result = !result;
				return !result;
			}
		`;
		resetUnitCounter(321);
		const group = compileSemanticFunction(
			getFunctionPath(source, "flip"),
			"effect-region-root"
		);
		const unit = group.units.find(
			(candidate) => candidate.id === group.entryUnitId
		) as SemanticUnit;

		const first = buildEffectRegionGraph(unit);
		const second = buildEffectRegionGraph(unit);

		expect(first.unitId).toBe(unit.id);
		expect(graphSnapshot(first)).toEqual(graphSnapshot(second));
		expect(first.nodeOwnership.size).toBe(unit.nodes.length);
		expect(
			new Set(first.regions.flatMap((region) => region.nodeIds)).size
		).toBe(unit.nodes.length);
		expect(() => validateEffectRegionGraph(unit, first)).not.toThrow();
	});

	it("fails closed on malformed ownership inputs and targets", () => {
		const node = createSemanticInstruction({
			id: 0,
			op: Op.PUSH_TRUE,
			operand: 0,
			originId: 0,
		});

		expect(() =>
			buildEffectRegionGraph({
				nodes: [node],
				entryNode: 0,
				exits: new Map([
					[0, [{ kind: "fallthrough" as const, target: 99 }]],
				]),
			})
		).toThrow("RUAM_INVALID_SEMANTIC_TARGET");

		expect(() =>
			buildEffectRegionGraph({
				nodes: [node, node],
				entryNode: 0,
				exits: new Map([[0, [{ kind: "return" as const }]]]),
			})
		).toThrow("RUAM_DUPLICATE_SEMANTIC_NODE_ID");
	});
});
