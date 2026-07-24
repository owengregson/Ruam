/**
 * Canonical, execution-representation-independent semantic IR.
 *
 * Node identities and typed exits replace instruction-pointer control flow.
 * This IR is the contract between JavaScript compilation and Isogloss lattice
 * lowering; it must never contain shuffled/physical opcodes or encoded
 * bytecode offsets.
 *
 * @module compiler/ir
 */

import {
	assertCanonicalSemanticOp,
	type SemanticOp,
} from "./semantic-ops.js";
import type {
	ConstantPoolEntry,
	RootGroupCompatible,
	RootGroupId,
	SemanticFunctionMetadata,
	SemanticUnitId,
} from "./types.js";

/** Dense unit-local identity of a canonical semantic node. */
export type SemanticNodeId = number;

/** Dense unit-local index into {@link SemanticUnit.origins}. */
export type SourceOriginId = number;

/** Source location associated with one or more canonical semantic nodes. */
export interface SourceOrigin {
	/** Original filename when compilation was given one. */
	file?: string;
	/** Inclusive UTF-16 source offset. */
	start: number;
	/** Exclusive UTF-16 source offset. */
	end: number;
	/** One-based source line. */
	line: number;
	/** Zero-based source column. */
	column: number;
}

/** One canonical language-level action before lattice lowering. */
export interface SemanticInstruction {
	/** Stable identity within the containing unit. */
	id: SemanticNodeId;
	/** Language-level behavior, never a shuffled or physical opcode. */
	op: SemanticOp;
	/** Operation-specific payload interpreted by its semantic signature. */
	operand: number;
	/** Index into the unit's source-origin table. */
	originId: SourceOriginId;
}

/** Construct one instruction while enforcing the canonical-operation fence. */
export function createSemanticInstruction(
	instruction: SemanticInstruction
): SemanticInstruction {
	assertCanonicalSemanticOp(instruction.op);
	if (!Number.isSafeInteger(instruction.id) || instruction.id < 0) {
		throw new Error(`RUAM_INVALID_SEMANTIC_NODE_ID: ${instruction.id}`);
	}
	if (!Number.isSafeInteger(instruction.originId) || instruction.originId < 0) {
		throw new Error(`RUAM_INVALID_SOURCE_ORIGIN_ID: ${instruction.originId}`);
	}
	return Object.freeze({ ...instruction });
}

/**
 * Typed control transfer from a canonical semantic node.
 *
 * Calls resume in the same unit after the invoked value completes.  Exception
 * and finally edges name compiler-known handlers; uncaught throws use the
 * terminal `throw` form.
 */
export type SemanticExit =
	| { kind: "fallthrough"; target: SemanticNodeId }
	| { kind: "branch-true"; target: SemanticNodeId }
	| { kind: "branch-false"; target: SemanticNodeId }
	| { kind: "call"; resume: SemanticNodeId }
	| { kind: "exception"; target: SemanticNodeId }
	| { kind: "finally"; target: SemanticNodeId }
	| { kind: "return" }
	| { kind: "throw" }
	| { kind: "yield"; resume: SemanticNodeId }
	| { kind: "await"; resume: SemanticNodeId };

/** Canonical representation of one source function. */
export interface SemanticUnit
	extends RootGroupCompatible,
		SemanticFunctionMetadata {
	/** Literal pool referenced by semantic operands. */
	constants: ConstantPoolEntry[];
	/** Canonical semantic nodes in deterministic ID order. */
	nodes: SemanticInstruction[];
	/** All legal outgoing edges for each reachable node. */
	exits: Map<SemanticNodeId, SemanticExit[]>;
	/** First node selected by the unit's entry contract. */
	entryNode: SemanticNodeId;
	/** Deduplicated source locations used by owner diagnostics. */
	origins: SourceOrigin[];
	/** Nested semantic units referenced by closure-creation operations. */
	childUnitIds: SemanticUnitId[];
}

/**
 * Compiler-facing root-group description.
 *
 * The future pipeline layer can extend this with Babel paths and entry
 * contracts without making the canonical IR depend on Babel.
 */
export interface SemanticRootGroup {
	id: RootGroupId;
	entryUnitId: SemanticUnitId;
	units: SemanticUnit[];
	usedSemantics: ReadonlySet<SemanticOp>;
	hasAsync: boolean;
	hasGenerator: boolean;
}

/** Whether an exit completes the current invocation instead of naming a node. */
export function isTerminalSemanticExit(
	exit: SemanticExit
): exit is Extract<SemanticExit, { kind: "return" | "throw" }> {
	return exit.kind === "return" || exit.kind === "throw";
}
