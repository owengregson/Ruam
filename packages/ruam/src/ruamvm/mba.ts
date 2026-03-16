/**
 * Mixed Boolean Arithmetic (MBA) — AST tree transform.
 *
 * Replaces arithmetic and bitwise operations with semantically equivalent
 * but structurally opaque mixed boolean-arithmetic expressions.
 *
 * Two application modes:
 *  - **Bitwise ops** (`^`, `&`, `|`) — always safe to transform (coerce to int32).
 *  - **Arithmetic ops** (`+`, `-`) — wrapped with a runtime int32 guard:
 *    `(a|0)===a && (b|0)===b ? MBA(a,b) : a op b`
 *
 * MBA expressions are recursively nested to the configured depth for
 * additional obfuscation.
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

/** Map from operator to variant table (bitwise — always safe). */
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

	// Bitwise ops — always safe (coerce to int32)
	const bitwiseVariants = BITWISE_MBA.get(op);
	if (bitwiseVariants) {
		const variant = bitwiseVariants[lcg() % bitwiseVariants.length]!;
		return variant(left, right);
	}

	// Arithmetic ops — need int32 guard for user values.
	// Skip when either operand is a string literal — MBA on string
	// concatenation produces enormous useless int32-guard blocks
	// (the guard always fails, falling through to the clean path).
	const arithVariants = ARITH_MBA.get(op);
	if (arithVariants) {
		if (containsStringLiteral(left) || containsStringLiteral(right)) {
			return node;
		}
		const variant = arithVariants[lcg() % arithVariants.length]!;
		const mbaExpr = variant(left, right);
		return int32Guard(left, right, op, mbaExpr);
	}

	return node;
}

/**
 * Check if a node tree contains a string literal anywhere.
 * Used to skip MBA on string concatenation (e.g. error messages).
 */
function containsStringLiteral(node: JsNode): boolean {
	if (node.type === "Literal" && typeof node.value === "string") {
		return true;
	}
	if (node.type === "BinOp") {
		return (
			containsStringLiteral(node.left) ||
			containsStringLiteral(node.right)
		);
	}
	return false;
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
 * Nesting depth controls recursive MBA application to sub-expressions.
 *
 * @param nodes - Statement list to transform
 * @param seed - LCG seed for deterministic variant selection
 * @param depth - Nesting depth (default 2)
 * @returns Transformed statement list
 */
export function applyMBA(
	nodes: JsNode[],
	seed: number,
	depth: number = 2
): JsNode[] {
	const lcg = makeLcg(seed);

	function walk(node: JsNode, currentDepth: number): JsNode {
		// Walk children first (bottom-up)
		const walked = mapChildren(node, (child) => walk(child, currentDepth));

		// Transform eligible BinOps
		if (walked.type === "BinOp" && MBA_OPS.has(walked.op)) {
			let result = mbaSingle(walked, lcg);
			// Recursive nesting: apply MBA to sub-expressions of the result
			for (let d = 1; d < currentDepth; d++) {
				result = mapChildren(result, (child) => {
					if (child.type === "BinOp" && MBA_OPS.has(child.op)) {
						return mbaSingle(child, lcg);
					}
					return child;
				});
			}
			return result;
		}

		return walked;
	}

	return nodes.map((n) => walk(n, depth));
}
