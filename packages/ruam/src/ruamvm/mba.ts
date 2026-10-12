/**
 * Mixed Boolean Arithmetic (MBA) — AST tree transform.
 *
 * Replaces arithmetic and bitwise operations with semantically equivalent
 * but structurally opaque mixed boolean-arithmetic expressions.
 *
 * Only repeatable handler-local identifiers and numeric literals are eligible.
 * Both bitwise and arithmetic identities require primitive int32 Numbers;
 * all other values use the original operator without speculative coercion.
 * Arithmetic involving zero also falls back to preserve signed zero.
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
 * Check primitive types before performing any potentially coercive operation.
 * The caller admits only repeatable operands, so these reads cannot duplicate
 * calls, property accessors, stack pops or unary numeric conversions.
 */
function int32Guard(
	left: JsNode,
	right: JsNode,
	op: BOpKind,
	mbaExpr: JsNode
): JsNode {
	const numberCheck = bin(BOp.And,
		bin(BOp.Seq, un(UOp.Typeof, left), lit("number")),
		bin(BOp.Seq, un(UOp.Typeof, right), lit("number")));
	const leftCheck = bin(BOp.Seq, bin(BOp.BitOr, left, lit(0)), left);
	const rightCheck = bin(BOp.Seq, bin(BOp.BitOr, right, lit(0)), right);
	let guard = bin(BOp.And, numberCheck, bin(BOp.And, leftCheck, rightCheck));
	if (ARITH_MBA.has(op)) {
		guard = bin(BOp.And, guard, bin(BOp.And,
			bin(BOp.Sneq, left, lit(0)), bin(BOp.Sneq, right, lit(0))));
	}
	return ternary(guard, mbaExpr, bin(op, left, right));
}

/**
 * Identifiers in this pass refer to compiler-owned handler locals. Arbitrary
 * expression operands are deliberately excluded: even an innocent-looking
 * index or unary plus can read an accessor or coerce a caller-owned object.
 */
function isRepeatableOperand(node: JsNode): boolean {
	return node.type === "Id" || (node.type === "Literal" && typeof node.value === "number");
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
	if (!isRepeatableOperand(left) || !isRepeatableOperand(right)) return node;

	// Bitwise operators also accept BigInt and coercive objects. Preserve those
	// with the original operator instead of applying Number-only identities.
	const bitwiseVariants = BITWISE_MBA.get(op);
	if (bitwiseVariants) {
		const variant = bitwiseVariants[lcg() % bitwiseVariants.length]!;
		return int32Guard(left, right, op, variant(left, right));
	}

	// Arithmetic identities operate on primitive int32 Numbers only.
	const arithVariants = ARITH_MBA.get(op);
	if (arithVariants) {
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
