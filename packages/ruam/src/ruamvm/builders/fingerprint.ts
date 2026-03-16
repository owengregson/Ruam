/**
 * Fingerprint builder — assembles the environment fingerprint function as AST.
 *
 * Produces the same runtime code as {@link generateFingerprintSource} in
 * `runtime/fingerprint.ts`, but represented as JsNode[] for the new
 * AST-based ruamvm pipeline.
 *
 * The fingerprint function computes a deterministic hash from built-in
 * function `.length` properties using XOR accumulation and Murmur3-style
 * mixing.  The result is the same for a given JS engine version but differs
 * across engines, providing a weak form of environment binding.
 *
 * @module ruamvm/builders/fingerprint
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../encoding/names.js";
import type { SplitFn } from "../constant-splitting.js";
import { fn, varDecl, id, lit, assign, bin, member, exprStmt, returnStmt, BOp, AOp } from "../nodes.js";

// --- Probe table ---

/** Built-in property probes: [object chain, shift amount]. */
const PROBES: [string, number][] = [
	["Array.prototype.reduce.length", 0x18],
	["String.prototype.charCodeAt.length", 0x14],
	["Math.floor.length", 0x10],
	["Object.keys.length", 0x0c],
	["JSON.stringify.length", 0x08],
	["parseInt.length", 0x04],
];

// --- Local helpers for dense bit manipulation ---

/** `a ^ b` */
const xor = (a: JsNode, b: JsNode): JsNode => bin(BOp.BitXor, a, b);

/** `a >>> n` */
const ushr = (a: JsNode, n: number): JsNode => bin(BOp.Ushr, a, lit(n));

// --- Helpers ---

/** Emit a dotted property chain as nested MemberExpr nodes. */
function dotChain(chain: string): JsNode {
	const parts = chain.split(".");
	let node: JsNode = id(parts[0]!);
	for (let i = 1; i < parts.length; i++) {
		node = member(node, parts[i]!);
	}
	return node;
}

// --- Builder ---

/**
 * Build the environment fingerprint function as JsNode[].
 *
 * @param names - Per-build randomized runtime identifiers.
 * @param split - Optional constant splitter for numeric obfuscation.
 * @returns A single-element array containing the function declaration.
 */
export function buildFingerprintSource(
	names: RuntimeNames,
	split?: SplitFn
): JsNode[] {
	const L = (v: number): JsNode => (split ? split(v) : lit(v));
	const h = id("h");

	// --- Function body ---

	const body: JsNode[] = [];

	// var h = 0x5f3759df;
	body.push(varDecl("h", L(0x5f3759df)));

	// h ^= <probe>.length << <shift>;
	for (const [chain, shift] of PROBES) {
		body.push(
			exprStmt(assign(h, bin(BOp.Shl, dotChain(chain), lit(shift)),AOp.BitXor))
		);
	}

	// Murmur3-style finalizer
	// h = (h ^ (h >>> 16)) * 0x45d9f3b;
	body.push(exprStmt(assign(h, bin(BOp.Mul, xor(h, ushr(h, 16)), L(0x45d9f3b)))));
	// h = (h ^ (h >>> 13)) * 0x45d9f3b;
	body.push(exprStmt(assign(h, bin(BOp.Mul, xor(h, ushr(h, 13)), L(0x45d9f3b)))));
	// h = h ^ (h >>> 16);
	body.push(exprStmt(assign(h, xor(h, ushr(h, 16)))));

	// return h >>> 0;
	body.push(returnStmt(ushr(h, 0)));

	return [fn(names.fp, [], body)];
}
