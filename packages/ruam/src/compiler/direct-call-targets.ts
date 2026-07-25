/**
 * Proof-only direct-call target analysis over canonical semantic IR.
 *
 * A value is known only when it originates at a validated `unit-ref` closure
 * allocation and survives exact stack/frame transfer. Joins retain a target
 * only when every incoming state agrees. Dynamic stack behavior, exceptional
 * transfer, unsupported aliasing, and unknown mutation erase precision.
 *
 * Call conventions mirror the reference VM:
 *
 * - plain/tagged/constructor: `[callee, ...args]`
 * - method: `[callee, receiver, ...args]`
 * - fast calls: fixed versions of the plain convention
 * - super/eval/import: no stack-carried callee identity
 *
 * @module compiler/direct-call-targets
 */

import type {
	SemanticExit,
	SemanticInstruction,
	SemanticNodeId,
	SemanticRootGroup,
	SemanticUnit,
} from "./ir.js";
import {
	assertCanonicalSemanticOp,
	SemanticOp,
	type SemanticOp as SemanticOpValue,
} from "./semantic-ops.js";
import {
	getSemanticSignature,
	resolveStackArity,
	type ResolvedStackArity,
} from "./semantic-signatures.js";
import type { RootGroupId, SemanticUnitId } from "./types.js";

export type CanonicalDirectCallConvention =
	| "plain"
	| "method"
	| "construct"
	| "tagged-template"
	| "fast-0"
	| "fast-1"
	| "fast-2"
	| "fast-3";

/** One target identity proven at the input of a canonical call node. */
export interface CanonicalDirectCallTargetFact {
	rootGroupId: RootGroupId;
	sourceUnitId: SemanticUnitId;
	sourceNodeId: SemanticNodeId;
	targetUnitId: SemanticUnitId;
	convention: CanonicalDirectCallConvention;
	evidence: "exact-canonical-dataflow";
}

export interface CanonicalDirectCallTargetInventory {
	rootGroupId: RootGroupId;
	facts: readonly CanonicalDirectCallTargetFact[];
}

type AbstractValue = SemanticUnitId | null;

interface AbstractState {
	/** `null` means stack height or ordering is no longer known. */
	stack: AbstractValue[] | null;
	registers: AbstractValue[];
	arguments: AbstractValue[];
	slots: AbstractValue[];
}

interface CallLayout {
	convention: CanonicalDirectCallConvention;
	argumentCount: number;
	calleeDepth: number;
	inputCount: number;
}

interface IndexedGroup {
	units: ReadonlyMap<SemanticUnitId, SemanticUnit>;
	unitRefs: ReadonlyMap<SemanticUnitId, ReadonlyMap<SemanticNodeId, SemanticUnitId>>;
}

const DIRECT_CALL_OPS = new Set<SemanticOpValue>([
	SemanticOp.CALL,
	SemanticOp.CALL_METHOD,
	SemanticOp.CALL_NEW,
	SemanticOp.CALL_OPTIONAL,
	SemanticOp.CALL_METHOD_OPTIONAL,
	SemanticOp.CALL_TAGGED_TEMPLATE,
	SemanticOp.CALL_0,
	SemanticOp.CALL_1,
	SemanticOp.CALL_2,
	SemanticOp.CALL_3,
	SemanticOp.TAGGED_TEMPLATE,
]);

/**
 * Analyze every unit independently from its canonical invocation entry.
 *
 * Registers, arguments, and slots begin unknown. This deliberately does not
 * invent captured-scope facts across units; `LOAD_SCOPED` therefore produces
 * unknown unless canonical IR later grows an explicit lexical-frame contract.
 */
export function analyzeCanonicalDirectCallTargets(
	group: SemanticRootGroup
): CanonicalDirectCallTargetInventory {
	const indexed = validateAndIndexGroup(group);
	const facts: CanonicalDirectCallTargetFact[] = [];
	const unitIds = [...indexed.units.keys()].sort(compareStrings);

	for (const unitId of unitIds) {
		const unit = indexed.units.get(unitId)!;
		const unitFacts = analyzeUnit(
			group.id,
			unit,
			indexed.unitRefs.get(unitId)!
		);
		facts.push(...unitFacts);
	}
	facts.sort(compareFacts);

	return Object.freeze({
		rootGroupId: group.id,
		facts: Object.freeze(facts),
	});
}

function analyzeUnit(
	rootGroupId: RootGroupId,
	unit: SemanticUnit,
	unitRefs: ReadonlyMap<SemanticNodeId, SemanticUnitId>
): CanonicalDirectCallTargetFact[] {
	const nodeById = new Map(unit.nodes.map((node) => [node.id, node]));
	const states = new Map<SemanticNodeId, AbstractState>();
	const queued = new Set<SemanticNodeId>();
	const queue: SemanticNodeId[] = [];
	const enqueue = (nodeId: SemanticNodeId): void => {
		if (queued.has(nodeId)) return;
		queued.add(nodeId);
		queue.push(nodeId);
		queue.sort((left, right) => left - right);
	};

	states.set(unit.entryNode, initialState(unit));
	enqueue(unit.entryNode);

	while (queue.length > 0) {
		const nodeId = queue.shift()!;
		queued.delete(nodeId);
		const node = nodeById.get(nodeId);
		if (!node) {
			throw new Error(
				`RUAM_DIRECT_TARGET_UNKNOWN_NODE: ${unit.id}:${nodeId}`
			);
		}
		const input = states.get(nodeId)!;
		const output = transfer(unit, node, input, unitRefs);
		const exits = unit.exits.get(nodeId);
		if (!exits) {
			throw new Error(
				`RUAM_DIRECT_TARGET_MISSING_EXITS: ${unit.id}:${nodeId}`
			);
		}

		for (const exit of exits) {
			const target = exitTarget(exit);
			if (target == null) continue;
			if (!nodeById.has(target)) {
				throw new Error(
					`RUAM_DIRECT_TARGET_INVALID_EXIT: ${unit.id}:${nodeId} -> ${target}`
				);
			}
			const candidate = isAbruptExit(exit)
				? unknownState(unit)
				: output;
			const previous = states.get(target);
			const joined = previous
				? joinStates(previous, candidate)
				: cloneState(candidate);
			if (!previous || !sameState(previous, joined)) {
				states.set(target, joined);
				enqueue(target);
			}
		}
	}

	const facts: CanonicalDirectCallTargetFact[] = [];
	for (const node of unit.nodes) {
		if (!DIRECT_CALL_OPS.has(node.op)) continue;
		const state = states.get(node.id);
		if (!state) continue;
		const layout = callLayout(node);
		if (!layout || state.stack == null) continue;
		assertStackDepth(unit, node, state.stack, layout.inputCount);
		const target =
			state.stack[state.stack.length - 1 - layout.calleeDepth] ?? null;
		if (target == null) continue;
		facts.push(
			Object.freeze({
				rootGroupId,
				sourceUnitId: unit.id,
				sourceNodeId: node.id,
				targetUnitId: target,
				convention: layout.convention,
				evidence: "exact-canonical-dataflow",
			})
		);
	}
	return facts;
}

function transfer(
	unit: SemanticUnit,
	node: SemanticInstruction,
	input: AbstractState,
	unitRefs: ReadonlyMap<SemanticNodeId, SemanticUnitId>
): AbstractState {
	const state = cloneState(input);

	switch (node.op) {
		case SemanticOp.NEW_CLOSURE:
		case SemanticOp.NEW_FUNCTION:
		case SemanticOp.NEW_ARROW:
		case SemanticOp.NEW_ASYNC:
		case SemanticOp.NEW_GENERATOR:
		case SemanticOp.NEW_ASYNC_GENERATOR:
			push(state, unitRefs.get(node.id) ?? null);
			return state;
		case SemanticOp.POP:
			pop(unit, node, state);
			return state;
		case SemanticOp.POP_N:
			assertNonNegativeOperand(unit, node);
			for (let index = 0; index < node.operand; index++) {
				pop(unit, node, state);
			}
			return state;
		case SemanticOp.DUP: {
			const value = pop(unit, node, state);
			push(state, value);
			push(state, value);
			return state;
		}
		case SemanticOp.DUP2: {
			const right = pop(unit, node, state);
			const left = pop(unit, node, state);
			push(state, left);
			push(state, right);
			push(state, left);
			push(state, right);
			return state;
		}
		case SemanticOp.SWAP: {
			const right = pop(unit, node, state);
			const left = pop(unit, node, state);
			push(state, right);
			push(state, left);
			return state;
		}
		case SemanticOp.ROT3:
			rotate(unit, node, state, 3);
			return state;
		case SemanticOp.ROT4:
			rotate(unit, node, state, 4);
			return state;
		case SemanticOp.PICK:
			assertNonNegativeOperand(unit, node);
			if (state.stack == null) return state;
			if (node.operand >= state.stack.length) {
				throw new Error(
					`RUAM_DIRECT_TARGET_INVALID_PICK: ${unit.id}:${node.id} depth ${node.operand}`
				);
			}
			push(
				state,
				state.stack[state.stack.length - node.operand - 1] ?? null
			);
			return state;
		case SemanticOp.LOAD_REG:
			push(state, readFrame(unit, node, state.registers, "register"));
			return state;
		case SemanticOp.STORE_REG:
			writeFrame(
				unit,
				node,
				state.registers,
				"register",
				pop(unit, node, state)
			);
			return state;
		case SemanticOp.LOAD_ARG:
		case SemanticOp.LOAD_ARG_OR_DEFAULT:
			push(state, readFrame(unit, node, state.arguments, "argument"));
			return state;
		case SemanticOp.STORE_ARG:
			writeFrame(
				unit,
				node,
				state.arguments,
				"argument",
				pop(unit, node, state)
			);
			return state;
		case SemanticOp.LOAD_SLOT:
			push(state, readFrame(unit, node, state.slots, "slot"));
			return state;
		case SemanticOp.STORE_SLOT:
			writeFrame(
				unit,
				node,
				state.slots,
				"slot",
				pop(unit, node, state)
			);
			return state;
		case SemanticOp.DECLARE_SLOT: {
			const slot = node.operand & 0xffff;
			writeFrameAt(unit, node, state.slots, "slot", slot, null);
			return state;
		}
		default:
			break;
	}

	const layout = callLayout(node);
	if (layout) {
		applyKnownCallLayout(unit, node, state, layout);
		clearAliasedStateAfterUserCode(state, node.op);
		return state;
	}

	switch (node.op) {
		case SemanticOp.DIRECT_EVAL:
			applyStackShape(unit, node, state, 1, 1);
			state.registers.fill(null);
			state.arguments.fill(null);
			state.slots.fill(null);
			return state;
		case SemanticOp.DYNAMIC_IMPORT:
			applyStackShape(unit, node, state, 1, 1);
			state.slots.fill(null);
			return state;
		case SemanticOp.SUPER_CALL: {
			const argumentCount = nonNegativeCallArgumentCount(unit, node);
			applyStackShape(unit, node, state, argumentCount, 1);
			state.slots.fill(null);
			state.arguments.fill(null);
			return state;
		}
		case SemanticOp.CALL_SUPER_METHOD: {
			const argumentCount = node.operand & 0xffff;
			applyStackShape(unit, node, state, argumentCount, 1);
			state.slots.fill(null);
			state.arguments.fill(null);
			return state;
		}
		default:
			break;
	}

	const signature = getSemanticSignature(node.op);
	const stackInput = resolveStackArity(signature.stackInput, node.operand);
	const stackOutput = resolveStackArity(signature.stackOutput, node.operand);
	applyResolvedStackShape(unit, node, state, stackInput, stackOutput);

	if (
		signature.operandKind === "register" &&
		(signature.frameAccess === "write" ||
			signature.frameAccess === "read-write" ||
			signature.frameAccess === "unknown")
	) {
		writeFrame(unit, node, state.registers, "register", null);
	} else if (
		signature.operandKind === "argument" &&
		(signature.frameAccess === "write" ||
			signature.frameAccess === "read-write" ||
			signature.frameAccess === "unknown")
	) {
		writeFrame(unit, node, state.arguments, "argument", null);
	} else if (
		signature.operandKind === "slot" &&
		(signature.frameAccess === "write" ||
			signature.frameAccess === "read-write" ||
			signature.frameAccess === "unknown")
	) {
		writeFrame(unit, node, state.slots, "slot", null);
	}

	if (signature.callKind !== "none") {
		clearAliasedStateAfterUserCode(state, node.op);
	}
	if (
		signature.objectAccess === "write" ||
		signature.objectAccess === "read-write" ||
		signature.objectAccess === "unknown"
	) {
		// The arguments object can alias argument slots. Without an explicit
		// object-identity fact, any object write may target that alias.
		state.arguments.fill(null);
	}
	if (signature.suspension !== "none") {
		state.slots.fill(null);
		state.arguments.fill(null);
	}
	return state;
}

function callLayout(node: SemanticInstruction): CallLayout | null {
	switch (node.op) {
		case SemanticOp.CALL:
		case SemanticOp.CALL_OPTIONAL: {
			const argumentCount = absoluteArgumentCount(node);
			return {
				convention: "plain",
				argumentCount,
				calleeDepth: argumentCount,
				inputCount: argumentCount + 1,
			};
		}
		case SemanticOp.CALL_METHOD:
		case SemanticOp.CALL_METHOD_OPTIONAL: {
			const argumentCount = absoluteArgumentCount(node);
			return {
				convention: "method",
				argumentCount,
				calleeDepth: argumentCount + 1,
				inputCount: argumentCount + 2,
			};
		}
		case SemanticOp.CALL_NEW: {
			const argumentCount = nonNegativeArgumentCount(node);
			return {
				convention: "construct",
				argumentCount,
				calleeDepth: argumentCount,
				inputCount: argumentCount + 1,
			};
		}
		case SemanticOp.CALL_TAGGED_TEMPLATE:
		case SemanticOp.TAGGED_TEMPLATE: {
			const argumentCount = nonNegativeArgumentCount(node);
			return {
				convention: "tagged-template",
				argumentCount,
				calleeDepth: argumentCount,
				inputCount: argumentCount + 1,
			};
		}
		case SemanticOp.CALL_0:
			return {
				convention: "fast-0",
				argumentCount: 0,
				calleeDepth: 0,
				inputCount: 1,
			};
		case SemanticOp.CALL_1:
			return {
				convention: "fast-1",
				argumentCount: 1,
				calleeDepth: 1,
				inputCount: 2,
			};
		case SemanticOp.CALL_2:
			return {
				convention: "fast-2",
				argumentCount: 2,
				calleeDepth: 2,
				inputCount: 3,
			};
		case SemanticOp.CALL_3:
			return {
				convention: "fast-3",
				argumentCount: 3,
				calleeDepth: 3,
				inputCount: 4,
			};
		default:
			return null;
	}
}

function applyKnownCallLayout(
	unit: SemanticUnit,
	node: SemanticInstruction,
	state: AbstractState,
	layout: CallLayout
): void {
	applyStackShape(unit, node, state, layout.inputCount, 1);
}

function applyResolvedStackShape(
	unit: SemanticUnit,
	node: SemanticInstruction,
	state: AbstractState,
	input: ResolvedStackArity,
	output: ResolvedStackArity
): void {
	if (input === "dynamic" || output === "dynamic") {
		state.stack = null;
		return;
	}
	applyStackShape(unit, node, state, input, output);
}

function applyStackShape(
	unit: SemanticUnit,
	node: SemanticInstruction,
	state: AbstractState,
	inputCount: number,
	outputCount: number
): void {
	if (state.stack == null) return;
	assertStackDepth(unit, node, state.stack, inputCount);
	state.stack.length -= inputCount;
	for (let index = 0; index < outputCount; index++) state.stack.push(null);
}

function clearAliasedStateAfterUserCode(
	state: AbstractState,
	op: SemanticOpValue
): void {
	state.slots.fill(null);
	state.arguments.fill(null);
	if (op === SemanticOp.DIRECT_EVAL) {
		state.registers.fill(null);
	}
}

function push(state: AbstractState, value: AbstractValue): void {
	if (state.stack != null) state.stack.push(value);
}

function pop(
	unit: SemanticUnit,
	node: SemanticInstruction,
	state: AbstractState
): AbstractValue {
	if (state.stack == null) return null;
	assertStackDepth(unit, node, state.stack, 1);
	return state.stack.pop() ?? null;
}

function rotate(
	unit: SemanticUnit,
	node: SemanticInstruction,
	state: AbstractState,
	count: number
): void {
	if (state.stack == null) return;
	assertStackDepth(unit, node, state.stack, count);
	const values = state.stack.splice(state.stack.length - count, count);
	state.stack.push(values[count - 1]!, ...values.slice(0, -1));
}

function readFrame(
	unit: SemanticUnit,
	node: SemanticInstruction,
	frame: readonly AbstractValue[],
	kind: "register" | "argument" | "slot"
): AbstractValue {
	validateFrameIndex(unit, node, frame, kind, node.operand);
	return frame[node.operand] ?? null;
}

function writeFrame(
	unit: SemanticUnit,
	node: SemanticInstruction,
	frame: AbstractValue[],
	kind: "register" | "argument" | "slot",
	value: AbstractValue
): void {
	writeFrameAt(unit, node, frame, kind, node.operand, value);
}

function writeFrameAt(
	unit: SemanticUnit,
	node: SemanticInstruction,
	frame: AbstractValue[],
	kind: "register" | "argument" | "slot",
	index: number,
	value: AbstractValue
): void {
	validateFrameIndex(unit, node, frame, kind, index);
	frame[index] = value;
}

function validateFrameIndex(
	unit: SemanticUnit,
	node: SemanticInstruction,
	frame: readonly AbstractValue[],
	kind: "register" | "argument" | "slot",
	index: number
): void {
	if (!Number.isSafeInteger(index) || index < 0 || index >= frame.length) {
		throw new Error(
			`RUAM_DIRECT_TARGET_INVALID_${kind.toUpperCase()}_INDEX: ${unit.id}:${node.id} -> ${index} (size ${frame.length})`
		);
	}
}

function assertStackDepth(
	unit: SemanticUnit,
	node: SemanticInstruction,
	stack: readonly AbstractValue[],
	required: number
): void {
	if (
		!Number.isSafeInteger(required) ||
		required < 0 ||
		stack.length < required
	) {
		throw new Error(
			`RUAM_DIRECT_TARGET_STACK_UNDERFLOW: ${unit.id}:${node.id} needs ${required}, has ${stack.length}`
		);
	}
}

function absoluteArgumentCount(node: SemanticInstruction): number {
	if (!Number.isSafeInteger(node.operand)) {
		throw new Error(
			`RUAM_DIRECT_TARGET_INVALID_CALL_OPERAND: ${node.id} -> ${node.operand}`
		);
	}
	return Math.abs(node.operand);
}

function nonNegativeArgumentCount(node: SemanticInstruction): number {
	if (!Number.isSafeInteger(node.operand) || node.operand < 0) {
		throw new Error(
			`RUAM_DIRECT_TARGET_INVALID_CALL_OPERAND: ${node.id} -> ${node.operand}`
		);
	}
	return node.operand;
}

function nonNegativeCallArgumentCount(
	unit: SemanticUnit,
	node: SemanticInstruction
): number {
	try {
		return nonNegativeArgumentCount(node);
	} catch {
		throw new Error(
			`RUAM_DIRECT_TARGET_INVALID_CALL_OPERAND: ${unit.id}:${node.id} -> ${node.operand}`
		);
	}
}

function assertNonNegativeOperand(
	unit: SemanticUnit,
	node: SemanticInstruction
): void {
	if (!Number.isSafeInteger(node.operand) || node.operand < 0) {
		throw new Error(
			`RUAM_DIRECT_TARGET_INVALID_STACK_OPERAND: ${unit.id}:${node.id} -> ${node.operand}`
		);
	}
}

function initialState(unit: SemanticUnit): AbstractState {
	return {
		stack: [],
		registers: Array.from({ length: unit.registerCount }, () => null),
		arguments: Array.from(
			{ length: Math.max(unit.paramCount, 0) },
			() => null
		),
		slots: Array.from({ length: unit.slotCount }, () => null),
	};
}

function unknownState(unit: SemanticUnit): AbstractState {
	return {
		stack: null,
		registers: Array.from({ length: unit.registerCount }, () => null),
		arguments: Array.from(
			{ length: Math.max(unit.paramCount, 0) },
			() => null
		),
		slots: Array.from({ length: unit.slotCount }, () => null),
	};
}

function cloneState(state: AbstractState): AbstractState {
	return {
		stack: state.stack?.slice() ?? null,
		registers: state.registers.slice(),
		arguments: state.arguments.slice(),
		slots: state.slots.slice(),
	};
}

function joinStates(
	left: AbstractState,
	right: AbstractState
): AbstractState {
	return {
		stack: joinStack(left.stack, right.stack),
		registers: joinFrame(left.registers, right.registers),
		arguments: joinFrame(left.arguments, right.arguments),
		slots: joinFrame(left.slots, right.slots),
	};
}

function joinStack(
	left: readonly AbstractValue[] | null,
	right: readonly AbstractValue[] | null
): AbstractValue[] | null {
	if (left == null || right == null || left.length !== right.length) {
		return null;
	}
	return left.map((value, index) =>
		value != null && value === right[index] ? value : null
	);
}

function joinFrame(
	left: readonly AbstractValue[],
	right: readonly AbstractValue[]
): AbstractValue[] {
	if (left.length !== right.length) {
		throw new Error(
			`RUAM_DIRECT_TARGET_FRAME_SHAPE_MISMATCH: ${left.length} vs ${right.length}`
		);
	}
	return left.map((value, index) =>
		value != null && value === right[index] ? value : null
	);
}

function sameState(left: AbstractState, right: AbstractState): boolean {
	return (
		sameValues(left.stack, right.stack) &&
		sameValues(left.registers, right.registers) &&
		sameValues(left.arguments, right.arguments) &&
		sameValues(left.slots, right.slots)
	);
}

function sameValues(
	left: readonly AbstractValue[] | null,
	right: readonly AbstractValue[] | null
): boolean {
	if (left == null || right == null) return left === right;
	if (left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
}

function validateAndIndexGroup(group: SemanticRootGroup): IndexedGroup {
	const units = new Map<SemanticUnitId, SemanticUnit>();
	for (const unit of group.units) {
		if (units.has(unit.id)) {
			throw new Error(`RUAM_DUPLICATE_DIRECT_TARGET_UNIT: ${unit.id}`);
		}
		if (unit.rootGroupId !== group.id) {
			throw new Error(
				`RUAM_DIRECT_TARGET_ROOT_GROUP_MISMATCH: ${unit.id}`
			);
		}
		if (
			!Number.isSafeInteger(unit.registerCount) ||
			unit.registerCount < 0 ||
			!Number.isSafeInteger(unit.paramCount) ||
			unit.paramCount < 0 ||
			!Number.isSafeInteger(unit.slotCount) ||
			unit.slotCount < 0
		) {
			throw new Error(
				`RUAM_DIRECT_TARGET_INVALID_FRAME_SHAPE: ${unit.id}`
			);
		}
		units.set(unit.id, unit);
	}
	if (!units.has(group.entryUnitId)) {
		throw new Error(
			`RUAM_DIRECT_TARGET_MISSING_ENTRY_UNIT: ${group.entryUnitId}`
		);
	}

	const unitRefs = new Map<
		SemanticUnitId,
		ReadonlyMap<SemanticNodeId, SemanticUnitId>
	>();
	for (const unit of units.values()) {
		if (unit.nodes.length === 0) {
			throw new Error(`RUAM_EMPTY_DIRECT_TARGET_UNIT: ${unit.id}`);
		}
		if (
			!Number.isSafeInteger(unit.entryNode) ||
			unit.entryNode < 0 ||
			unit.entryNode >= unit.nodes.length
		) {
			throw new Error(
				`RUAM_DIRECT_TARGET_INVALID_ENTRY_NODE: ${unit.id}:${unit.entryNode}`
			);
		}
		const children = new Set<SemanticUnitId>();
		for (const childId of unit.childUnitIds) {
			if (children.has(childId)) {
				throw new Error(
					`RUAM_DUPLICATE_DIRECT_TARGET_CHILD: ${unit.id} -> ${childId}`
				);
			}
			children.add(childId);
			if (!units.has(childId)) {
				throw new Error(
					`RUAM_UNKNOWN_DIRECT_TARGET_CHILD: ${unit.id} -> ${childId}`
				);
			}
		}

		const refs = new Map<SemanticNodeId, SemanticUnitId>();
		for (let index = 0; index < unit.nodes.length; index++) {
			const node = unit.nodes[index]!;
			assertCanonicalSemanticOp(node.op);
			if (node.id !== index) {
				throw new Error(
					`RUAM_NONDETERMINISTIC_DIRECT_TARGET_NODE_ORDER: ${unit.id}:${node.id}`
				);
			}
			if (!Number.isSafeInteger(node.operand)) {
				throw new Error(
					`RUAM_DIRECT_TARGET_INVALID_OPERAND: ${unit.id}:${node.id}`
				);
			}
			const exits = unit.exits.get(node.id);
			if (!exits) {
				throw new Error(
					`RUAM_DIRECT_TARGET_MISSING_EXITS: ${unit.id}:${node.id}`
				);
			}
			for (const exit of exits) {
				const target = exitTarget(exit);
				if (
					target != null &&
					(!Number.isSafeInteger(target) ||
						target < 0 ||
						target >= unit.nodes.length)
				) {
					throw new Error(
						`RUAM_DIRECT_TARGET_INVALID_EXIT: ${unit.id}:${node.id} -> ${target}`
					);
				}
			}
			if (getSemanticSignature(node.op).operandKind !== "unit-ref") {
				continue;
			}
			const constant = unit.constants[node.operand];
			if (constant?.type !== "string") {
				throw new Error(
					`RUAM_INVALID_DIRECT_TARGET_UNIT_REF: ${unit.id}:${node.id}`
				);
			}
			if (
				!units.has(constant.value) ||
				!unit.childUnitIds.includes(constant.value)
			) {
				throw new Error(
					`RUAM_UNKNOWN_DIRECT_TARGET_UNIT_REF: ${unit.id}:${node.id} -> ${constant.value}`
				);
			}
			refs.set(node.id, constant.value);
		}
		unitRefs.set(unit.id, refs);
	}
	return { units, unitRefs };
}

function exitTarget(exit: SemanticExit): SemanticNodeId | null {
	if ("target" in exit) return exit.target;
	if ("resume" in exit) return exit.resume;
	return null;
}

function isAbruptExit(exit: SemanticExit): boolean {
	return exit.kind === "exception" || exit.kind === "finally";
}

function compareFacts(
	left: CanonicalDirectCallTargetFact,
	right: CanonicalDirectCallTargetFact
): number {
	return (
		compareStrings(left.sourceUnitId, right.sourceUnitId) ||
		left.sourceNodeId - right.sourceNodeId ||
		compareStrings(left.targetUnitId, right.targetUnitId)
	);
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
