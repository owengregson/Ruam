/**
 * Mixed Boolean Arithmetic (MBA) — AST tree transform.
 *
 * Replaces arithmetic and bitwise operations with semantically equivalent
 * but structurally opaque mixed boolean-arithmetic expressions.
 *
 * Two application modes:
 *  - **Bitwise ops** (`^`, `&`, `|`) — safe to transform when operands
 *    are known-integer (no string literals in the sub-tree).
 *  - **Arithmetic ops** (`+`, `-`) — wrapped with a runtime int32 guard:
 *    `(a|0)===a && (b|0)===b ? MBA(a,b) : a op b`
 *
 * A single pass (depth 1) is applied to avoid exponential expression
 * growth from nesting — the int32 guard already introduces bitwise ops
 * that would be re-transformed in deeper passes, producing enormous
 * output for zero additional security benefit.
 *
 * @module ruamvm/mba
 */

import type { JsNode, BinOp, BOpKind } from "./nodes.js";
import { bin, un, ternary, lit, mapChildren, BOp, UOp } from "./nodes.js";
import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";

// --- MBA identity tables ---

/** MBA replacement for `x + y` (assumes int32 operands). */
const ADD_VARIANTS: ((x: JsNode, y: JsNode) => JsNode)[] = [
	// (x ^ y) + 2 * (x & y)
	(x, y) =>
		bin(
			BOp.Add,
			bin(BOp.BitXor, x, y),
			bin(BOp.Mul, lit(2), bin(BOp.BitAnd, x, y))
		),
	// (x | y) + (x & y)
	(x, y) => bin(BOp.Add, bin(BOp.BitOr, x, y), bin(BOp.BitAnd, x, y)),
	// 2 * (x | y) - (x ^ y)
	(x, y) =>
		bin(
			BOp.Sub,
			bin(BOp.Mul, lit(2), bin(BOp.BitOr, x, y)),
			bin(BOp.BitXor, x, y)
		),
];

/** MBA replacement for `x - y` (assumes int32 operands). */
const SUB_VARIANTS: ((x: JsNode, y: JsNode) => JsNode)[] = [
	// (x ^ y) - 2 * (~x & y)
	(x, y) =>
		bin(
			BOp.Sub,
			bin(BOp.BitXor, x, y),
			bin(BOp.Mul, lit(2), bin(BOp.BitAnd, un(UOp.BitNot, x), y))
		),
	// (x & ~y) - (~x & y)
	(x, y) =>
		bin(
			BOp.Sub,
			bin(BOp.BitAnd, x, un(UOp.BitNot, y)),
			bin(BOp.BitAnd, un(UOp.BitNot, x), y)
		),
];

/** MBA replacement for `x ^ y`. */
const XOR_VARIANTS: ((x: JsNode, y: JsNode) => JsNode)[] = [
	// (x | y) & ~(x & y)
	(x, y) =>
		bin(
			BOp.BitAnd,
			bin(BOp.BitOr, x, y),
			un(UOp.BitNot, bin(BOp.BitAnd, x, y))
		),
	// (~x & y) | (x & ~y)
	(x, y) =>
		bin(
			BOp.BitOr,
			bin(BOp.BitAnd, un(UOp.BitNot, x), y),
			bin(BOp.BitAnd, x, un(UOp.BitNot, y))
		),
];

/** MBA replacement for `x & y`. */
const AND_VARIANTS: ((x: JsNode, y: JsNode) => JsNode)[] = [
	// ~(~x | ~y)   (De Morgan)
	(x, y) =>
		un(UOp.BitNot, bin(BOp.BitOr, un(UOp.BitNot, x), un(UOp.BitNot, y))),
	// (x | y) ^ (x ^ y)
	(x, y) => bin(BOp.BitXor, bin(BOp.BitOr, x, y), bin(BOp.BitXor, x, y)),
];

/** MBA replacement for `x | y`. */
const OR_VARIANTS: ((x: JsNode, y: JsNode) => JsNode)[] = [
	// ~(~x & ~y)   (De Morgan)
	(x, y) =>
		un(UOp.BitNot, bin(BOp.BitAnd, un(UOp.BitNot, x), un(UOp.BitNot, y))),
	// (x ^ y) + (x & y)
	(x, y) => bin(BOp.Add, bin(BOp.BitXor, x, y), bin(BOp.BitAnd, x, y)),
];

/** Map from operator to variant table (bitwise). */
const BITWISE_MBA = new Map<BOpKind, ((x: JsNode, y: JsNode) => JsNode)[]>([
	[BOp.BitXor, XOR_VARIANTS],
	[BOp.BitAnd, AND_VARIANTS],
	[BOp.BitOr, OR_VARIANTS],
]);

/** Map from operator to variant table (arithmetic — needs int32 guard). */
const ARITH_MBA = new Map<BOpKind, ((x: JsNode, y: JsNode) => JsNode)[]>([
	[BOp.Add, ADD_VARIANTS],
	[BOp.Sub, SUB_VARIANTS],
]);

// --- LCG PRNG ---

function makeLcg(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
		return s;
	};
}

// --- Int32 guard builder ---

/**
 * Build a runtime int32 guard ternary:
 * `(a|0)===a && (b|0)===b ? mbaExpr : a op b`
 */
function int32Guard(
	left: JsNode,
	right: JsNode,
	op: BOpKind,
	mbaExpr: JsNode
): JsNode {
	const leftCheck = bin(BOp.Seq, bin(BOp.BitOr, left, lit(0)), left);
	const rightCheck = bin(BOp.Seq, bin(BOp.BitOr, right, lit(0)), right);
	const guard = bin(BOp.And, leftCheck, rightCheck);
	return ternary(guard, mbaExpr, bin(op, left, right));
}

// --- String / non-integer detection ---

/**
 * Check if a node sub-tree may produce a non-integer value.
 *
 * Walks BinOps, UnaryOps, and ternaries to find string literals
 * or non-numeric literals that would make MBA semantically wrong
 * or produce nonsensical bitwise-on-string expressions.
 */
function mayProduceNonInteger(node: JsNode): boolean {
	if (node.type === "Literal") {
		return typeof node.value === "string";
	}
	if (node.type === "BinOp") {
		return (
			mayProduceNonInteger(node.left) || mayProduceNonInteger(node.right)
		);
	}
	if (node.type === "UnaryOp") {
		return mayProduceNonInteger(node.expr);
	}
	if (node.type === "TernaryExpr") {
		return (
			mayProduceNonInteger(node.then) || mayProduceNonInteger(node.else)
		);
	}
	return false;
}

// --- Core transform ---

/**
 * Apply a single level of MBA replacement to a BinOp node.
 *
 * @param node - The BinOp to transform
 * @param lcg - PRNG for variant selection
 * @returns Transformed JsNode, or the original if the op isn't MBA-eligible
 */
function mbaSingle(node: BinOp, lcg: () => number): JsNode {
	const { op, left, right } = node;

	// Bitwise ops — skip when operands may contain non-integer values
	const bitwiseVariants = BITWISE_MBA.get(op);
	if (bitwiseVariants) {
		if (mayProduceNonInteger(left) || mayProduceNonInteger(right)) {
			return node;
		}
		const variant = bitwiseVariants[lcg() % bitwiseVariants.length]!;
		return variant(left, right);
	}

	// Arithmetic ops — need int32 guard for user values.
	// Skip when either operand may produce a non-integer (string
	// concatenation, object coercion, etc.) — the guard always fails
	// at runtime, producing enormous dead code for no benefit.
	const arithVariants = ARITH_MBA.get(op);
	if (arithVariants) {
		if (mayProduceNonInteger(left) || mayProduceNonInteger(right)) {
			return node;
		}
		const variant = arithVariants[lcg() % arithVariants.length]!;
		const mbaExpr = variant(left, right);
		return int32Guard(left, right, op, mbaExpr);
	}

	return node;
}

/** Operators eligible for MBA transformation. */
const MBA_OPS = new Set<BOpKind>([
	BOp.BitXor,
	BOp.BitAnd,
	BOp.BitOr,
	BOp.Add,
	BOp.Sub,
]);

/**
 * Apply MBA transformation to all eligible BinOp nodes in a JsNode tree.
 *
 * Walks bottom-up, replacing eligible operations with MBA equivalents.
 * Uses depth 1 (single pass) to avoid exponential expression growth —
 * deeper nesting re-transforms int32Guard's own bitwise ops, producing
 * enormous output for no additional security.
 *
 * @param nodes - Statement list to transform
 * @param seed - LCG seed for deterministic variant selection
 * @returns Transformed statement list
 */
export function applyMBA(nodes: JsNode[], seed: number): JsNode[] {
	const lcg = makeLcg(seed);

	function walk(node: JsNode): JsNode {
		// Walk children first (bottom-up)
		const walked = mapChildren(node, (child) => walk(child));

		// Transform eligible BinOps (single pass — no nesting)
		if (walked.type === "BinOp" && MBA_OPS.has(walked.op)) {
			return mbaSingle(walked, lcg);
		}

		return walked;
	}

	return nodes.map((n) => walk(n));
}
