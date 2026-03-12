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

import type { JsNode, BinOp } from "./nodes.js";
import { bin, un, ternary, lit, mapChildren } from "./nodes.js";
import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";

// --- MBA identity tables ---

/** MBA replacement for `x + y` (assumes int32 operands). */
const ADD_VARIANTS: ((x: JsNode, y: JsNode) => JsNode)[] = [
	// (x ^ y) + 2 * (x & y)
	(x, y) => bin("+", bin("^", x, y), bin("*", lit(2), bin("&", x, y))),
	// (x | y) + (x & y)
	(x, y) => bin("+", bin("|", x, y), bin("&", x, y)),
	// 2 * (x | y) - (x ^ y)
	(x, y) => bin("-", bin("*", lit(2), bin("|", x, y)), bin("^", x, y)),
];

/** MBA replacement for `x - y` (assumes int32 operands). */
const SUB_VARIANTS: ((x: JsNode, y: JsNode) => JsNode)[] = [
	// (x ^ y) - 2 * (~x & y)
	(x, y) =>
		bin("-", bin("^", x, y), bin("*", lit(2), bin("&", un("~", x), y))),
	// (x & ~y) - (~x & y)
	(x, y) => bin("-", bin("&", x, un("~", y)), bin("&", un("~", x), y)),
];

/** MBA replacement for `x ^ y`. */
const XOR_VARIANTS: ((x: JsNode, y: JsNode) => JsNode)[] = [
	// (x | y) & ~(x & y)
	(x, y) => bin("&", bin("|", x, y), un("~", bin("&", x, y))),
	// (~x & y) | (x & ~y)
	(x, y) => bin("|", bin("&", un("~", x), y), bin("&", x, un("~", y))),
];

/** MBA replacement for `x & y`. */
const AND_VARIANTS: ((x: JsNode, y: JsNode) => JsNode)[] = [
	// ~(~x | ~y)   (De Morgan)
	(x, y) => un("~", bin("|", un("~", x), un("~", y))),
	// (x | y) ^ (x ^ y)
	(x, y) => bin("^", bin("|", x, y), bin("^", x, y)),
];

/** MBA replacement for `x | y`. */
const OR_VARIANTS: ((x: JsNode, y: JsNode) => JsNode)[] = [
	// ~(~x & ~y)   (De Morgan)
	(x, y) => un("~", bin("&", un("~", x), un("~", y))),
	// (x ^ y) + (x & y)
	(x, y) => bin("+", bin("^", x, y), bin("&", x, y)),
];

/** Map from operator to variant table (bitwise — always safe). */
const BITWISE_MBA: Record<string, ((x: JsNode, y: JsNode) => JsNode)[]> = {
	"^": XOR_VARIANTS,
	"&": AND_VARIANTS,
	"|": OR_VARIANTS,
};

/** Map from operator to variant table (arithmetic — needs int32 guard). */
const ARITH_MBA: Record<string, ((x: JsNode, y: JsNode) => JsNode)[]> = {
	"+": ADD_VARIANTS,
	"-": SUB_VARIANTS,
};

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
	op: string,
	mbaExpr: JsNode
): JsNode {
	const leftCheck = bin("===", bin("|", left, lit(0)), left);
	const rightCheck = bin("===", bin("|", right, lit(0)), right);
	const guard = bin("&&", leftCheck, rightCheck);
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
	const bitwiseVariants = BITWISE_MBA[op];
	if (bitwiseVariants) {
		const variant = bitwiseVariants[lcg() % bitwiseVariants.length]!;
		return variant(left, right);
	}

	// Arithmetic ops — need int32 guard for user values
	const arithVariants = ARITH_MBA[op];
	if (arithVariants) {
		const variant = arithVariants[lcg() % arithVariants.length]!;
		const mbaExpr = variant(left, right);
		return int32Guard(left, right, op, mbaExpr);
	}

	return node;
}

/** Operators eligible for MBA transformation. */
const MBA_OPS = new Set(["^", "&", "|", "+", "-"]);

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
