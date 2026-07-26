import { describe, expect, it } from "bun:test";
import { parse } from "@babel/parser";
import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import { traverse } from "../../src/babel-compat.js";
import { buildCanonicalCfg } from "../../src/compiler/cfg.js";
import {
	analyzeCanonicalDirectCallTargets,
	buildCanonicalCallGraphInventory,
	compileSemanticFunction,
	resetUnitCounter,
} from "../../src/compiler/index.js";
import {
	type SemanticRootGroup,
	type SemanticUnit,
} from "../../src/compiler/ir.js";
import { Op } from "../../src/compiler/operations.js";
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
		paramCount?: number;
		registerCount?: number;
		slotCount?: number;
	} = {}
): SemanticUnit {
	const cfg = buildCanonicalCfg({
		instructions: instructions.map((instruction) => ({ ...instruction })),
		originIds: instructions.map(() => 0),
	});
	return {
		id,
		rootGroupId,
		constants: options.constants ?? [],
		nodes: cfg.nodes,
		exits: cfg.exits,
		entryNode: cfg.entryNode,
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
		paramCount: options.paramCount ?? 0,
		registerCount: options.registerCount ?? 0,
		slotCount: options.slotCount ?? 0,
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
	it("proves an IIFE target by dataflow rather than operand coincidence", () => {
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
		const reorderedInventory = buildCanonicalCallGraphInventory({
			...group,
			units: [...group.units].reverse(),
		});
		const invoke = inventory.boundaries.find(
			(boundary) => boundary.nodeId === callNode.id
		)!;

		expect(reorderedInventory).toEqual(inventory);
		expect(inventory.targetPolicy).toEqual({
			mode: "canonical-evidence-only",
			directTargetRepresentation: "unit-ref-plus-exact-dataflow",
			unprovenBoundaryClassification: "indirect-or-external",
			supportedValueFlows: ["stack", "register", "argument", "slot"],
			precisionLossBoundaries: [
				"scope-chain",
				"dynamic-stack",
				"abrupt-control",
				"unsupported-aliasing",
			],
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
					kind: "direct-intra-group",
					targetUnitId: child.id,
					evidence: "exact-canonical-dataflow",
				},
			})
		);
		expect(invoke.origin.file).toBe("call-graph-fixture.js");
		expect(inventory.directEdges).toEqual([
			expect.objectContaining({
				unitId: root.id,
				nodeId: callNode.id,
				targetUnitId: child.id,
				evidence: "exact-canonical-dataflow",
			}),
		]);
		expect(inventory.summary.hasProvenRecursion).toBe(false);
		expect(inventory.summary.hasUnresolvedRecursionRisk).toBe(false);
		expect(inventory.summary.hasUnresolvedMutualRecursionRisk).toBe(false);
		const rootScc = inventory.sccs.find((scc) =>
			scc.unitIds.includes(root.id)
		)!;
		const childScc = inventory.sccs.find((scc) =>
			scc.unitIds.includes(child.id)
		)!;
		expect(rootScc.outgoingSccIds).toEqual([childScc.id]);
		expect(childScc.incomingSccIds).toEqual([rootScc.id]);
	});

	it("never treats argc or a constant-pool index as target evidence", () => {
		const child = makeUnit("child", "operand-root", [
			{ opcode: Op.RETURN_VOID, operand: 0 },
		]);
		const root = makeUnit(
			"root",
			"operand-root",
			[
				{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
				{ opcode: Op.CALL, operand: 0 },
				{ opcode: Op.RETURN, operand: 0 },
			],
			{
				constants: [{ type: "string", value: child.id }],
				childUnitIds: [child.id],
			}
		);
		const inventory = buildCanonicalCallGraphInventory(
			makeGroup("operand-root", root.id, [root, child])
		);

		expect(inventory.directEdges).toEqual([]);
		expect(inventory.boundaries[0]!.operand).toBe(0);
		expect(inventory.boundaries[0]!.resolution).toEqual({
			kind: "indirect-or-external",
			reason: "callee-identity-not-represented",
		});
	});

	it("propagates nested bindings through canonical registers", () => {
		const source = `
			function outer() {
				function inner() { return 1; }
				return inner();
			}
		`;
		resetUnitCounter(112);
		const group = compileSemanticFunction(
			getFunctionPath(source, "outer"),
			"register-binding-root"
		);
		const root = group.units.find(
			(unit) => unit.id === group.entryUnitId
		)!;
		const child = group.units.find(
			(unit) => unit.id !== group.entryUnitId
		)!;
		const callNode = root.nodes.find((node) => node.op === Op.CALL)!;
		const analysis = analyzeCanonicalDirectCallTargets(group);
		const inventory = buildCanonicalCallGraphInventory(group);

		expect(
			root.nodes.map((node) => node.op).slice(0, 4)
		).toEqual([Op.NEW_CLOSURE, Op.STORE_REG, Op.LOAD_REG, Op.CALL]);
		expect(analysis.facts).toEqual([
			{
				rootGroupId: "register-binding-root",
				sourceUnitId: root.id,
				sourceNodeId: callNode.id,
				targetUnitId: child.id,
				convention: "plain",
				evidence: "exact-canonical-dataflow",
			},
		]);
		expect(inventory.directEdges).toEqual([
			expect.objectContaining({
				unitId: root.id,
				nodeId: callNode.id,
				targetUnitId: child.id,
			}),
		]);
	});

	it("retains equal branch targets and rejects disagreeing branch targets", () => {
		const equalSource = `
			function outer(flag) {
				function inner() { return 1; }
				const selected = flag ? inner : inner;
				return selected();
			}
		`;
		resetUnitCounter(113);
		const equalGroup = compileSemanticFunction(
			getFunctionPath(equalSource, "outer"),
			"equal-join-root"
		);
		const equalRoot = equalGroup.units.find(
			(unit) => unit.id === equalGroup.entryUnitId
		)!;
		const equalChild = equalGroup.units.find(
			(unit) => unit.id !== equalGroup.entryUnitId
		)!;
		const equalCall = equalRoot.nodes.find((node) => node.op === Op.CALL)!;
		const equalInventory = buildCanonicalCallGraphInventory(equalGroup);

		expect(equalInventory.directEdges).toContainEqual(
			expect.objectContaining({
				unitId: equalRoot.id,
				nodeId: equalCall.id,
				targetUnitId: equalChild.id,
			})
		);

		const disagreeingSource = `
			function outer(flag) {
				function left() { return 1; }
				function right() { return 2; }
				const selected = flag ? left : right;
				return selected();
			}
		`;
		resetUnitCounter(114);
		const disagreeingGroup = compileSemanticFunction(
			getFunctionPath(disagreeingSource, "outer"),
			"disagreeing-join-root"
		);
		const disagreeingRoot = disagreeingGroup.units.find(
			(unit) => unit.id === disagreeingGroup.entryUnitId
		)!;
		const disagreeingCall = disagreeingRoot.nodes.find(
			(node) => node.op === Op.CALL
		)!;
		const disagreeingInventory =
			buildCanonicalCallGraphInventory(disagreeingGroup);
		const boundary = disagreeingInventory.boundaries.find(
			(candidate) =>
				candidate.unitId === disagreeingRoot.id &&
				candidate.nodeId === disagreeingCall.id
		)!;

		expect(
			disagreeingInventory.directEdges.some(
				(edge) =>
					edge.unitId === disagreeingRoot.id &&
					edge.nodeId === disagreeingCall.id
			)
		).toBe(false);
		expect(boundary.resolution).toEqual({
			kind: "indirect-or-external",
			reason: "callee-identity-not-represented",
		});
	});

	it("uses the VM method, constructor, fast-call, and slot conventions", () => {
		const child = makeUnit("child", "convention-root", [
			{ opcode: Op.RETURN_VOID, operand: 0 },
		]);
		const root = makeUnit(
			"root",
			"convention-root",
			[
				{ opcode: Op.NEW_CLOSURE, operand: 0 },
				{ opcode: Op.STORE_SLOT, operand: 0 },
				{ opcode: Op.LOAD_SLOT, operand: 0 },
				{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
				{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
				{ opcode: Op.CALL_METHOD, operand: 1 },
				{ opcode: Op.POP, operand: 0 },
				{ opcode: Op.NEW_CLOSURE, operand: 0 },
				{ opcode: Op.STORE_SLOT, operand: 0 },
				{ opcode: Op.LOAD_SLOT, operand: 0 },
				{ opcode: Op.CALL_NEW, operand: 0 },
				{ opcode: Op.POP, operand: 0 },
				{ opcode: Op.NEW_CLOSURE, operand: 0 },
				{ opcode: Op.STORE_SLOT, operand: 0 },
				{ opcode: Op.LOAD_SLOT, operand: 0 },
				{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
				{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
				{ opcode: Op.CALL_2, operand: 999 },
				{ opcode: Op.POP, operand: 0 },
				{ opcode: Op.NEW_CLOSURE, operand: 0 },
				{ opcode: Op.STORE_SLOT, operand: 0 },
				{ opcode: Op.LOAD_SLOT, operand: 0 },
				{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
				{ opcode: Op.CALL, operand: -1 },
				{ opcode: Op.POP, operand: 0 },
				{ opcode: Op.NEW_CLOSURE, operand: 0 },
				{ opcode: Op.STORE_SLOT, operand: 0 },
				{ opcode: Op.LOAD_SLOT, operand: 0 },
				{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
				{ opcode: Op.CALL_TAGGED_TEMPLATE, operand: 1 },
				{ opcode: Op.RETURN, operand: 0 },
			],
			{
				constants: [{ type: "string", value: child.id }],
				childUnitIds: [child.id],
				slotCount: 1,
			}
		);
		const analysis = analyzeCanonicalDirectCallTargets(
			makeGroup("convention-root", root.id, [root, child])
		);

		expect(
			analysis.facts.map((fact) => ({
				nodeId: fact.sourceNodeId,
				target: fact.targetUnitId,
				convention: fact.convention,
			}))
		).toEqual([
			{ nodeId: 5, target: child.id, convention: "method" },
			{ nodeId: 10, target: child.id, convention: "construct" },
			{ nodeId: 17, target: child.id, convention: "fast-2" },
			{ nodeId: 23, target: child.id, convention: "plain" },
			{
				nodeId: 29,
				target: child.id,
				convention: "tagged-template",
			},
		]);
	});

	it("leaves aliased and scope-loaded calls unresolved", () => {
		const source = `
			function outer(callback) {
				function inner() { return 1; }
				callback(inner);
				let selected = inner;
				selected = callback;
				return selected();
			}
		`;
		resetUnitCounter(115);
		const group = compileSemanticFunction(
			getFunctionPath(source, "outer"),
			"alias-root"
		);
		const root = group.units.find(
			(unit) => unit.id === group.entryUnitId
		)!;
		const inventory = buildCanonicalCallGraphInventory(group);
		const rootInvokes = inventory.boundaries.filter(
			(boundary) =>
				boundary.unitId === root.id &&
				boundary.observability.callKind === "invoke"
		);

		expect(rootInvokes).toHaveLength(2);
		expect(
			rootInvokes.every(
				(boundary) =>
					boundary.resolution.kind === "indirect-or-external"
			)
		).toBe(true);
		expect(
			inventory.directEdges.some((edge) => edge.unitId === root.id)
		).toBe(false);
	});

	it("drops argument-held targets across super calls and suspension", () => {
		const child = makeUnit("child", "escape-root", [
			{ opcode: Op.RETURN_VOID, operand: 0 },
		]);
		const superRoot = makeUnit(
			"super-root",
			"escape-root",
			[
				{ opcode: Op.NEW_CLOSURE, operand: 0 },
				{ opcode: Op.STORE_ARG, operand: 0 },
				{ opcode: Op.SUPER_CALL, operand: 0 },
				{ opcode: Op.POP, operand: 0 },
				{ opcode: Op.LOAD_ARG, operand: 0 },
				{ opcode: Op.CALL_0, operand: 0 },
				{ opcode: Op.RETURN, operand: 0 },
			],
			{
				constants: [{ type: "string", value: child.id }],
				childUnitIds: [child.id],
				paramCount: 1,
			}
		);
		const awaitRoot = makeUnit(
			"await-root",
			"await-escape-root",
			[
				{ opcode: Op.NEW_CLOSURE, operand: 0 },
				{ opcode: Op.STORE_ARG, operand: 0 },
				{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
				{ opcode: Op.AWAIT, operand: 0 },
				{ opcode: Op.POP, operand: 0 },
				{ opcode: Op.LOAD_ARG, operand: 0 },
				{ opcode: Op.CALL_0, operand: 0 },
				{ opcode: Op.RETURN, operand: 0 },
			],
			{
				constants: [{ type: "string", value: child.id }],
				childUnitIds: [child.id],
				paramCount: 1,
			}
		);
		const awaitChild = { ...child, rootGroupId: "await-escape-root" };

		expect(
			analyzeCanonicalDirectCallTargets(
				makeGroup("escape-root", superRoot.id, [superRoot, child])
			).facts
		).toEqual([]);
		expect(
			analyzeCanonicalDirectCallTargets(
				makeGroup("await-escape-root", awaitRoot.id, [
					awaitRoot,
					awaitChild,
				])
			).facts
		).toEqual([]);
	});

	it("reports source and observability for invoke, construct, dynamic, and reflection boundaries", () => {
		const unit = makeUnit("entry", "boundary-root", [
			{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
			{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
			{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
			{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
			{ opcode: Op.CALL_METHOD, operand: 2 },
			{ opcode: Op.POP, operand: 0 },
			{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
			{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
			{ opcode: Op.CALL_NEW, operand: 1 },
			{ opcode: Op.POP, operand: 0 },
			{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
			{ opcode: Op.DIRECT_EVAL, operand: 0 },
			{ opcode: Op.POP, operand: 0 },
			{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
			{ opcode: Op.DYNAMIC_IMPORT, operand: 0 },
			{ opcode: Op.POP, operand: 0 },
			{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
			{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
			{ opcode: Op.GET_PROP_DYNAMIC, operand: 0 },
			{ opcode: Op.POP, operand: 0 },
			{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
			{ opcode: Op.PUSH_UNDEFINED, operand: 0 },
			{ opcode: Op.ADD, operand: 0 },
			{ opcode: Op.POP, operand: 0 },
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
				nodeId: 4,
				kind: "invoke",
				reason: "callee-identity-not-represented",
			},
			{
				nodeId: 8,
				kind: "construct",
				reason: "constructor-identity-not-represented",
			},
			{
				nodeId: 11,
				kind: "dynamic-code",
				reason: "runtime-generated-code",
			},
			{
				nodeId: 14,
				kind: "dynamic-module",
				reason: "runtime-module-resolution",
			},
			{
				nodeId: 18,
				kind: "reflection",
				reason: "runtime-hook-dispatch",
			},
			{
				nodeId: 22,
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

	it("keeps captured-scope mutual recursion unresolved", () => {
		const source = `
			function outer() {
				function left() { return right(); }
				function right() { return left(); }
				return left();
			}
		`;
		resetUnitCounter(223);
		const group = compileSemanticFunction(
			getFunctionPath(source, "outer"),
			"mutual-scope-root"
		);
		const inventory = buildCanonicalCallGraphInventory(group);
		const invokes = inventory.boundaries.filter(
			(boundary) => boundary.observability.callKind === "invoke"
		);

		expect(invokes).toHaveLength(3);
		expect(
			invokes.every(
				(boundary) =>
					boundary.resolution.kind === "indirect-or-external"
			)
		).toBe(true);
		expect(inventory.directEdges).toEqual([]);
		expect(inventory.summary.hasProvenRecursion).toBe(false);
		expect(inventory.summary.hasProvenMutualRecursion).toBe(false);
		expect(inventory.summary.hasUnresolvedMutualRecursionRisk).toBe(true);
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

	it("fails closed on malformed reachable stack and frame facts", () => {
		const underflow = makeUnit("underflow", "underflow-root", [
			{ opcode: Op.CALL, operand: 1 },
			{ opcode: Op.RETURN, operand: 0 },
		]);
		expect(() =>
			analyzeCanonicalDirectCallTargets(
				makeGroup("underflow-root", underflow.id, [underflow])
			)
		).toThrow("RUAM_DIRECT_TARGET_STACK_UNDERFLOW");

		const invalidRegister = makeUnit("bad-reg", "bad-reg-root", [
			{ opcode: Op.LOAD_REG, operand: 0 },
			{ opcode: Op.RETURN, operand: 0 },
		]);
		expect(() =>
			analyzeCanonicalDirectCallTargets(
				makeGroup("bad-reg-root", invalidRegister.id, [
					invalidRegister,
				])
			)
		).toThrow("RUAM_DIRECT_TARGET_INVALID_REGISTER_INDEX");
	});
});
