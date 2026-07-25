import { describe, expect, it } from "bun:test";
import { parse } from "@babel/parser";
import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import { traverse } from "../../src/babel-compat.js";
import {
	buildCanonicalCallGraphInventory,
	compileSemanticFunction,
	resetUnitCounter,
} from "../../src/compiler/index.js";
import {
	createSemanticInstruction,
	type SemanticRootGroup,
	type SemanticUnit,
} from "../../src/compiler/ir.js";
import { Op } from "../../src/compiler/opcodes.js";
import type { ConstantPoolEntry } from "../../src/compiler/types.js";

function getFunctionPath(
	source: string,
	name: string
): NodePath<t.Function> {
	const ast = parse(source, {
		sourceType: "script",
		sourceFilename: "call-graph-fixture.js",
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

function makeUnit(
	id: string,
	rootGroupId: string,
	instructions: readonly { opcode: Op; operand: number }[],
	options: {
		constants?: ConstantPoolEntry[];
		childUnitIds?: string[];
	} = {}
): SemanticUnit {
	const nodes = instructions.map((instruction, index) =>
		createSemanticInstruction({
			id: index,
			op: instruction.opcode,
			operand: instruction.operand,
			originId: 0,
		})
	);
	return {
		id,
		rootGroupId,
		constants: options.constants ?? [],
		nodes,
		exits: new Map(nodes.map((node) => [node.id, []])),
		entryNode: 0,
		origins: [
			{
				file: "manual-call-graph-fixture.js",
				start: 10,
				end: 20,
				line: 2,
				column: 3,
			},
		],
		childUnitIds: options.childUnitIds ?? [],
		paramCount: 0,
		registerCount: 0,
		slotCount: 0,
		isStrict: false,
		isGenerator: false,
		isAsync: false,
		isArrow: false,
		scopeless: true,
		usesExceptions: false,
		usesThisContext: false,
		nameConstIndex: -1,
		outerNames: [],
	};
}

function makeGroup(
	id: string,
	entryUnitId: string,
	units: SemanticUnit[]
): SemanticRootGroup {
	return {
		id,
		entryUnitId,
		units,
		usedSemantics: new Set(
			units.flatMap((unit) => unit.nodes.map((node) => node.op))
		),
		hasAsync: units.some((unit) => unit.isAsync),
		hasGenerator: units.some((unit) => unit.isGenerator),
	};
}

describe("canonical root-group call graph inventory", () => {
	it("keeps proven closure identity separate from an unproven call target", () => {
		const source = `
			function outer() {
				return (function child(value) { return value; })(7);
			}
		`;
		resetUnitCounter(111);
		const group = compileSemanticFunction(
			getFunctionPath(source, "outer"),
			"call-graph-root"
		);
		const root = group.units.find(
			(unit) => unit.id === group.entryUnitId
		)!;
		const child = group.units.find(
			(unit) => unit.id !== group.entryUnitId
		)!;
		const closureNode = root.nodes.find(
			(node) => node.op === Op.NEW_CLOSURE
		)!;
		const callNode = root.nodes.find((node) => node.op === Op.CALL)!;

		// Both happen to be zero in this fixture: one is a constant-pool index,
		// the other is argc. Numeric equality is not target evidence.
		expect(closureNode.operand).toBe(callNode.operand);

		const inventory = buildCanonicalCallGraphInventory(group);
		const invoke = inventory.boundaries.find(
			(boundary) => boundary.nodeId === callNode.id
		)!;

		expect(inventory.targetPolicy).toEqual({
			mode: "canonical-evidence-only",
			directTargetRepresentation: "absent-from-current-ir",
			unprovenBoundaryClassification: "indirect-or-external",
		});
		expect(inventory.closureSites).toEqual([
			expect.objectContaining({
				unitId: root.id,
				nodeId: closureNode.id,
				targetUnitId: child.id,
				evidence: "unit-ref-constant-and-child-membership",
			}),
		]);
		expect(invoke).toEqual(
			expect.objectContaining({
				unitId: root.id,
				nodeId: callNode.id,
				operand: 1,
				operandKind: "argc",
				resolution: {
					kind: "indirect-or-external",
					reason: "callee-identity-not-represented",
				},
			})
		);
		expect(invoke.origin.file).toBe("call-graph-fixture.js");
		expect(inventory.directEdges).toEqual([]);
		expect(inventory.summary.hasProvenRecursion).toBe(false);
		expect(inventory.summary.hasUnresolvedRecursionRisk).toBe(true);
		expect(inventory.summary.hasUnresolvedMutualRecursionRisk).toBe(true);
	});

	it("reports source and observability for invoke, construct, dynamic, and reflection boundaries", () => {
		const unit = makeUnit("entry", "boundary-root", [
			{ opcode: Op.CALL_METHOD, operand: 2 },
			{ opcode: Op.CALL_NEW, operand: 1 },
			{ opcode: Op.DIRECT_EVAL, operand: 1 },
			{ opcode: Op.DYNAMIC_IMPORT, operand: 0 },
			{ opcode: Op.GET_PROP_DYNAMIC, operand: 0 },
			{ opcode: Op.ADD, operand: 0 },
			{ opcode: Op.RETURN_VOID, operand: 0 },
		]);
		const inventory = buildCanonicalCallGraphInventory(
			makeGroup("boundary-root", unit.id, [unit])
		);

		expect(
			inventory.boundaries.map((boundary) => ({
				nodeId: boundary.nodeId,
				kind: boundary.boundaryKind,
				reason:
					boundary.resolution.kind === "indirect-or-external"
						? boundary.resolution.reason
						: null,
			}))
		).toEqual([
			{
				nodeId: 0,
				kind: "invoke",
				reason: "callee-identity-not-represented",
			},
			{
				nodeId: 1,
				kind: "construct",
				reason: "constructor-identity-not-represented",
			},
			{
				nodeId: 2,
				kind: "dynamic-code",
				reason: "runtime-generated-code",
			},
			{
				nodeId: 3,
				kind: "dynamic-module",
				reason: "runtime-module-resolution",
			},
			{
				nodeId: 4,
				kind: "reflection",
				reason: "runtime-hook-dispatch",
			},
			{
				nodeId: 5,
				kind: "reflection",
				reason: "runtime-hook-dispatch",
			},
		]);
		expect(
			inventory.boundaries.every(
				(boundary) =>
					boundary.originId === 0 &&
					boundary.origin.line === 2 &&
					boundary.observability.mayExecuteArbitraryUserCode &&
					boundary.observability.mayReadOrWriteProgramState &&
					boundary.observability.mayReenterRootGroup
			)
		).toBe(true);
		expect(inventory.boundaries[3]!.observability.maySuspend).toBe(true);
		expect(inventory.sccs).toEqual([
			expect.objectContaining({
				id: "scc_0",
				unitIds: ["entry"],
				isRecursive: false,
				isMutuallyRecursive: false,
				hasUnresolvedRecursionRisk: true,
				hasUnresolvedMutualRecursionRisk: false,
				reentrancyRelevant: true,
				requiresInterproceduralFission: true,
			}),
		]);
		expect(inventory.summary.reentrancyRelevantSccIds).toEqual(["scc_0"]);
		expect(inventory.summary.interproceduralFissionSccIds).toEqual([
			"scc_0",
		]);
	});

	it("does not claim direct recursion when canonical calls lack target facts", () => {
		const source = `
			function outer() {
				function recur() { return recur(); }
				return recur();
			}
		`;
		resetUnitCounter(222);
		const group = compileSemanticFunction(
			getFunctionPath(source, "outer"),
			"recursive-root"
		);
		const first = buildCanonicalCallGraphInventory(group);
		const reordered = buildCanonicalCallGraphInventory({
			...group,
			units: [...group.units].reverse(),
		});

		expect(reordered).toEqual(first);
		expect(first.unitIds).toEqual([...first.unitIds].sort());
		expect(
			first.boundaries.filter(
				(boundary) => boundary.observability.callKind === "invoke"
			)
		).toHaveLength(2);
		expect(first.directEdges).toEqual([]);
		expect(first.sccs).toHaveLength(2);
		expect(first.sccs.every((scc) => !scc.isRecursive)).toBe(true);
		expect(first.summary).toEqual(
			expect.objectContaining({
				hasProvenRecursion: false,
				hasProvenMutualRecursion: false,
				hasUnresolvedRecursionRisk: true,
				hasUnresolvedMutualRecursionRisk: true,
			})
		);
	});

	it("fails closed on malformed nested unit identity", () => {
		const child = makeUnit("child", "malformed-root", [
			{ opcode: Op.RETURN_VOID, operand: 0 },
		]);
		const root = makeUnit(
			"root",
			"malformed-root",
			[
				{ opcode: Op.NEW_CLOSURE, operand: 0 },
				{ opcode: Op.RETURN, operand: 0 },
			],
			{
				constants: [{ type: "number", value: 123 }],
				childUnitIds: [child.id],
			}
		);

		expect(() =>
			buildCanonicalCallGraphInventory(
				makeGroup("malformed-root", root.id, [root, child])
			)
		).toThrow("RUAM_INVALID_CANONICAL_UNIT_REF");
	});
});
