/**
 * Handler aliasing — create structurally different implementations
 * of the same logical opcode.
 *
 * For high-value opcodes, generates structurally different handler bodies
 * by applying AST transforms (if/else inversion, sequence wrapping,
 * no-op injection). The build seed selects which variant is used,
 * so different builds produce different interpreter code for the same
 * opcode.
 *
 * All transforms are semantics-preserving:
 * - If/else inversion: negate condition, swap branches (always safe)
 * - Sequence wrapping: `expr` → `(0, expr)` (always safe)
 * - No-op prefix: prepend `void 0;` statement (always safe)
 *
 * @module ruamvm/handler-aliasing
 */

import { deriveSeed } from "../naming/scope.js";
import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";
import type { JsNode, IfStmt, ExprStmt } from "./nodes.js";
import {
	exprStmt,
	un,
	lit,
	seq,
	ifStmt,
	UOp,
	mapChildren,
} from "./nodes.js";

// --- LCG helper ---

/** Advance an LCG state and return the next value. */
function lcgNext(state: number): number {
	return (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
}

// --- Transforms ---

/**
 * Invert an if/else statement: negate condition, swap then/else branches.
 * Only applied when both branches exist (otherwise the inversion would
 * create an else-only if statement, which changes semantics for bare if).
 */
function invertIfElse(node: IfStmt): IfStmt {
	if (!node.else || node.else.length === 0) return node;
	return ifStmt(
		un(UOp.Not, node.test),
		node.else,
		node.then
	);
}

/**
 * Wrap an expression statement's expr in a sequence expression: `expr` → `(0, expr)`.
 * Always safe — the leading `0` is a no-op value that gets discarded.
 */
function wrapExprInSequence(node: ExprStmt): ExprStmt {
	// Don't double-wrap sequence expressions
	if (node.expr.type === "SequenceExpr") return node;
	return exprStmt(seq(lit(0), node.expr));
}

/**
 * Create a void-0 no-op statement: `void 0;`
 */
function makeNoop(): JsNode {
	return exprStmt(un(UOp.Void, lit(0)));
}

// --- Deep walk ---

/**
 * Walk a single node, applying if/else inversion and expression wrapping
 * based on the PRNG state.
 *
 * @param node - The node to transform
 * @param state - Current LCG state (mutated via closure)
 * @returns Object with transformed node and updated state
 */
function walkWithState(
	node: JsNode,
	state: { s: number }
): JsNode {
	// First recurse into children
	const walked = mapChildren(node, (child) => walkWithState(child, state));

	// Apply transforms based on node type
	if (walked.type === "IfStmt") {
		state.s = lcgNext(state.s);
		// ~50% chance to invert when both branches exist
		if ((state.s & 1) === 0 && walked.else && walked.else.length > 0) {
			return invertIfElse(walked);
		}
	}

	if (walked.type === "ExprStmt") {
		state.s = lcgNext(state.s);
		// ~25% chance to wrap in sequence expression
		if ((state.s & 3) === 0) {
			return wrapExprInSequence(walked);
		}
	}

	return walked;
}

// --- Public API ---

/**
 * Apply structural aliasing transforms to a handler body.
 *
 * Derives a per-opcode seed and uses it to deterministically apply
 * semantics-preserving transforms: if/else inversion, expression
 * sequence wrapping, and no-op statement injection.
 *
 * @param body - The handler body AST nodes
 * @param seed - Build seed
 * @param opcodeIndex - The opcode index (for seed derivation)
 * @returns Transformed handler body (new array, no mutation)
 */
export function aliasHandlerBody(
	body: JsNode[],
	seed: number,
	opcodeIndex: number
): JsNode[] {
	const localSeed = deriveSeed(seed, "handlerAlias_" + opcodeIndex);
	const state = { s: localSeed };

	// Walk each body statement applying transforms
	const result: JsNode[] = [];

	// Possibly prepend a no-op statement
	state.s = lcgNext(state.s);
	if ((state.s & 3) === 0) {
		result.push(makeNoop());
	}

	for (const stmt of body) {
		result.push(walkWithState(stmt, state));
	}

	return result;
}
