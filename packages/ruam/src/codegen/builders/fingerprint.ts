/**
 * Fingerprint builder — assembles the environment fingerprint function as AST.
 *
 * Produces the same runtime code as {@link generateFingerprintSource} in
 * `runtime/fingerprint.ts`, but represented as JsNode[] for the new
 * AST-based codegen pipeline.
 *
 * The fingerprint function computes a deterministic hash from built-in
 * function `.length` properties using XOR accumulation and Murmur3-style
 * mixing.  The result is the same for a given JS engine version but differs
 * across engines, providing a weak form of environment binding.
 *
 * @module codegen/builders/fingerprint
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../runtime/names.js";
import {
	fn, varDecl, id, raw, assign, bin, member, exprStmt,
} from "../nodes.js";

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

/** Hex literal as a raw node (preserves 0x… notation in output, zero-padded to even length). */
function hex(n: number): JsNode {
	const s = n.toString(16);
	return raw("0x" + (s.length % 2 ? "0" + s : s));
}

// --- Builder ---

/**
 * Build the environment fingerprint function as JsNode[].
 *
 * @param names - Per-build randomized runtime identifiers.
 * @returns A single-element array containing the function declaration.
 */
export function buildFingerprintSource(names: RuntimeNames): JsNode[] {
	const h = id("h");

	// --- Function body ---

	const body: JsNode[] = [];

	// var h = 0x5f3759df;
	body.push(varDecl("h", hex(0x5f3759df)));

	// h ^= <probe>.length << <shift>;
	for (const [chain, shift] of PROBES) {
		body.push(
			exprStmt(
				assign(h, bin("<<", dotChain(chain), hex(shift)), "^")
			)
		);
	}

	// Murmur3-style finalizer — uses raw() because the nested
	// parenthesization in the original template (`(h^(h>>>16))`) includes
	// explicit inner parens that the AST emitter would (correctly) omit.
	body.push(raw("h=(h^(h>>>16))*0x45d9f3b"));
	body.push(raw("h=(h^(h>>>13))*0x45d9f3b"));
	body.push(raw("h=h^(h>>>16)"));

	// return h >>> 0;
	body.push(raw("return h>>>0"));

	return [fn(names.fp, [], body)];
}
