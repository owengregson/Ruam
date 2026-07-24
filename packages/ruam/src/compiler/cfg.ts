/**
 * Canonical control-flow graph construction.
 *
 * This module translates the compiler's unencoded, pre-superinstruction
 * instruction stream into node-identity control flow. It has no dependency on
 * either execution backend.
 *
 * @module compiler/cfg
 */

import type { Instruction } from "../types.js";
import {
	createSemanticInstruction,
	type SemanticExit,
	type SemanticInstruction,
	type SemanticNodeId,
	type SourceOriginId,
} from "./ir.js";
import {
	assertCanonicalSemanticOp,
	SEMANTIC_OP_COUNT,
	SemanticOp,
	type SemanticOp as SemanticOpValue,
} from "./semantic-ops.js";
import { getSemanticSignature } from "./semantic-signatures.js";

/** Input needed to create canonical nodes and typed exits for one unit. */
export interface CanonicalCfgInput {
	instructions: readonly Instruction[];
	originIds: readonly SourceOriginId[];
}

/** Execution-independent nodes plus their validated outgoing edges. */
export interface CanonicalCfg {
	nodes: SemanticInstruction[];
	exits: Map<SemanticNodeId, SemanticExit[]>;
	entryNode: SemanticNodeId;
}

interface HandlerTarget {
	catchTarget: SemanticNodeId | null;
	finallyTarget: SemanticNodeId | null;
}

const TAKEN_WHEN_FALSE = new Set<SemanticOpValue>([
	SemanticOp.JMP_FALSE,
	SemanticOp.JMP_FALSE_KEEP,
	SemanticOp.LOGICAL_AND,
]);

const CONDITIONAL_DIRECT_JUMPS = new Set<SemanticOpValue>([
	SemanticOp.JMP_TRUE,
	SemanticOp.JMP_FALSE,
	SemanticOp.JMP_NULLISH,
	SemanticOp.JMP_UNDEFINED,
	SemanticOp.JMP_TRUE_KEEP,
	SemanticOp.JMP_FALSE_KEEP,
	SemanticOp.JMP_NULLISH_KEEP,
	SemanticOp.LOGICAL_AND,
	SemanticOp.LOGICAL_OR,
	SemanticOp.NULLISH_COALESCE,
]);

const STRUCTURED_EXCEPTION_OPS = new Set<SemanticOpValue>([
	SemanticOp.TRY_PUSH,
	SemanticOp.TRY_POP,
	SemanticOp.CATCH_BIND,
	SemanticOp.CATCH_BIND_PATTERN,
	SemanticOp.FINALLY_MARK,
	SemanticOp.END_FINALLY,
]);

/**
 * Build a canonical CFG and fail closed on representation-specific opcodes or
 * malformed direct targets.
 */
export function buildCanonicalCfg(input: CanonicalCfgInput): CanonicalCfg {
	const { instructions, originIds } = input;
	if (instructions.length === 0) {
		throw new Error("RUAM_EMPTY_SEMANTIC_UNIT");
	}
	if (originIds.length !== instructions.length) {
		throw new Error(
			`RUAM_ORIGIN_ARITY_MISMATCH: ${originIds.length} origins for ${instructions.length} nodes`
		);
	}

	const nodes = instructions.map((instruction, id) => {
		if (
			!Number.isSafeInteger(instruction.opcode) ||
			instruction.opcode < 0 ||
			instruction.opcode >= SEMANTIC_OP_COUNT
		) {
			throw new Error(
				`RUAM_INVALID_SEMANTIC_OP: node ${id} -> ${instruction.opcode}`
			);
		}
		const op = instruction.opcode as SemanticOpValue;
		assertCanonicalSemanticOp(op);
		return createSemanticInstruction({
			id,
			op,
			operand: instruction.operand,
			originId: originIds[id]!,
		});
	});

	const exits = new Map<SemanticNodeId, SemanticExit[]>();
	for (const node of nodes) exits.set(node.id, []);

	const pending: Array<{
		nodeId: SemanticNodeId;
		handlers: HandlerTarget[];
	}> = [{ nodeId: 0, handlers: [] }];
	const visitedStates = new Set<string>();

	while (pending.length > 0) {
		const state = pending.pop()!;
		const stateKey = handlerStateKey(state.nodeId, state.handlers);
		if (visitedStates.has(stateKey)) continue;
		visitedStates.add(stateKey);

		const node = nodes[state.nodeId]!;
		const nodeExits = exitsForNode(node, nodes.length, state.handlers);
		const accumulated = exits.get(node.id)!;
		for (const exit of nodeExits) {
			if (!containsSameExit(accumulated, exit)) accumulated.push(exit);
		}

		const normalHandlers = handlersAfterNormalExit(
			node,
			state.handlers,
			nodes.length
		);
		for (const exit of nodeExits) {
			const target = exitTarget(exit);
			if (target == null) continue;
			const targetHandlers =
				exit.kind === "exception" || exit.kind === "finally"
					? state.handlers.slice(0, -1)
					: normalHandlers;
			pending.push({ nodeId: target, handlers: targetHandlers });
		}
	}

	for (const [id, nodeExits] of exits) {
		exits.set(id, Object.freeze(nodeExits.slice()) as SemanticExit[]);
	}

	return {
		nodes: Object.freeze(nodes.slice()) as SemanticInstruction[],
		exits,
		entryNode: 0,
	};
}

function exitsForNode(
	node: SemanticInstruction,
	nodeCount: number,
	handlers: readonly HandlerTarget[]
): SemanticExit[] {
	const { op, operand, id } = node;
	const next = id + 1;
	const innermostHandler = handlers[handlers.length - 1];
	const signature = getSemanticSignature(op);
	let normal: SemanticExit[];

	if (op === SemanticOp.JMP) {
		normal = [{ kind: "fallthrough", target: directTarget(operand, nodeCount, id) }];
	} else if (CONDITIONAL_DIRECT_JUMPS.has(op)) {
		const taken = directTarget(operand, nodeCount, id);
		const notTaken = fallthroughTarget(next, nodeCount, id);
		normal = TAKEN_WHEN_FALSE.has(op)
			? [
					{ kind: "branch-false", target: taken },
					{ kind: "branch-true", target: notTaken },
				]
			: [
					{ kind: "branch-true", target: taken },
					{ kind: "branch-false", target: notTaken },
				];
	} else if (
		op === SemanticOp.TABLE_SWITCH ||
		op === SemanticOp.LOOKUP_SWITCH
	) {
		throw new Error(
			`RUAM_CANONICAL_SWITCH_TABLE_REQUIRES_TARGETS: node ${id}`
		);
	} else if (signature.control === "call") {
		normal = [{ kind: "call", resume: fallthroughTarget(next, nodeCount, id) }];
	} else if (signature.control === "yield") {
		normal = [{ kind: "yield", resume: fallthroughTarget(next, nodeCount, id) }];
	} else if (signature.control === "await") {
		normal = [{ kind: "await", resume: fallthroughTarget(next, nodeCount, id) }];
	} else if (signature.control === "return") {
		normal = innermostHandler?.finallyTarget != null
			? [{ kind: "finally", target: innermostHandler.finallyTarget }]
			: [{ kind: "return" }];
	} else if (op === SemanticOp.THROW_IF_NOT_OBJECT) {
		normal = [
			{
				kind: "fallthrough",
				target: fallthroughTarget(next, nodeCount, id),
			},
		];
	} else if (signature.control === "throw") {
		normal = abruptExceptionExit(innermostHandler);
	} else {
		normal = [{ kind: "fallthrough", target: fallthroughTarget(next, nodeCount, id) }];
	}

	if (
		signature.mayThrow &&
		(signature.control !== "throw" || op === SemanticOp.THROW_IF_NOT_OBJECT) &&
		!STRUCTURED_EXCEPTION_OPS.has(op)
	) {
		const exceptional = abruptExceptionExit(innermostHandler);
		if (!containsSameExit(normal, exceptional[0]!)) normal.push(...exceptional);
	}

	return normal;
}

function handlersAfterNormalExit(
	node: SemanticInstruction,
	handlers: readonly HandlerTarget[],
	nodeCount: number
): HandlerTarget[] {
	if (node.op === SemanticOp.TRY_PUSH) {
		return [
			...handlers,
			decodeTryTargets(node.operand, nodeCount, node.id),
		];
	}
	if (node.op === SemanticOp.TRY_POP) {
		if (handlers.length === 0) {
			throw new Error(`RUAM_UNBALANCED_TRY_POP: node ${node.id}`);
		}
		return handlers.slice(0, -1);
	}
	return handlers.slice();
}

function decodeTryTargets(
	operand: number,
	nodeCount: number,
	source: SemanticNodeId
): HandlerTarget {
	const catchRaw = (operand >>> 16) & 0xffff;
	const finallyRaw = operand & 0xffff;
	const catchTarget =
		catchRaw === 0xffff ? null : directTarget(catchRaw, nodeCount, source);
	const finallyTarget =
		finallyRaw === 0xffff
			? null
			: directTarget(finallyRaw, nodeCount, source);
	if (catchTarget == null && finallyTarget == null) {
		throw new Error(`RUAM_EMPTY_TRY_HANDLER: node ${source}`);
	}
	return { catchTarget, finallyTarget };
}

function abruptExceptionExit(
	handler: HandlerTarget | undefined
): SemanticExit[] {
	if (handler?.catchTarget != null) {
		return [{ kind: "exception", target: handler.catchTarget }];
	}
	if (handler?.finallyTarget != null) {
		return [{ kind: "finally", target: handler.finallyTarget }];
	}
	return [{ kind: "throw" }];
}

function directTarget(
	target: number,
	nodeCount: number,
	source: SemanticNodeId
): SemanticNodeId {
	if (!Number.isSafeInteger(target) || target < 0 || target >= nodeCount) {
		throw new Error(
			`RUAM_INVALID_SEMANTIC_TARGET: node ${source} -> ${target} (size ${nodeCount})`
		);
	}
	return target;
}

function fallthroughTarget(
	target: number,
	nodeCount: number,
	source: SemanticNodeId
): SemanticNodeId {
	return directTarget(target, nodeCount, source);
}

function containsSameExit(
	exits: readonly SemanticExit[],
	candidate: SemanticExit
): boolean {
	return exits.some((exit) => JSON.stringify(exit) === JSON.stringify(candidate));
}

function exitTarget(exit: SemanticExit): SemanticNodeId | null {
	if ("target" in exit) return exit.target;
	if ("resume" in exit) return exit.resume;
	return null;
}

function handlerStateKey(
	nodeId: SemanticNodeId,
	handlers: readonly HandlerTarget[]
): string {
	return `${nodeId}|${handlers
		.map(
			(handler) =>
				`${handler.catchTarget ?? "-"}:${handler.finallyTarget ?? "-"}`
		)
		.join(",")}`;
}
