/**
 * Rolling cipher builder — assembles rcDeriveKey and rcMix functions as AST nodes.
 *
 * All runtime JS is generated via pure AST construction — no raw() nodes.
 * Dense bit-manipulation expressions are composed via nested BinOp nodes
 * with file-local helpers (xor, ushr, imul, xorAssign).
 *
 * @module codegen/builders/rolling-cipher
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../runtime/names.js";
import {
	assign,
	bin,
	call,
	exprStmt,
	fn,
	id,
	lit,
	member,
	returnStmt,
	varDecl,
} from "../nodes.js";

// --- Local helpers for dense bit manipulation ---

/** `a ^ b` */
const xor = (a: JsNode, b: JsNode): JsNode => bin("^", a, b);

/** `a >>> n` */
const ushr = (a: JsNode, n: number): JsNode => bin(">>>", a, lit(n));

/** `Math.imul(a, b)` */
const imul = (a: JsNode, b: JsNode): JsNode =>
	call(member(id("Math"), "imul"), [a, b]);

/** `h ^= expr` — shorthand for `exprStmt(assign(id("h"), expr, "^"))` */
const xorAssign = (target: string, value: JsNode): JsNode =>
	exprStmt(assign(id(target), value, "^"));

/**
 * Build the runtime rolling cipher helper functions as JsNode[].
 *
 * Emits two function declarations:
 * - `rcDeriveKey(unit)` — derives the implicit master key from unit metadata
 *   using FNV-1a, with an optional integrity hash XOR folded in.
 * - `rcMix(state, a, b)` — rolling state update for position-dependent decryption.
 *
 * @param names          Runtime identifier mapping.
 * @param integrityHash  Optional integrity hash literal to fold into the derived key.
 * @returns Array of JsNode representing both function declarations.
 */
export function buildRollingCipherSource(
	names: RuntimeNames,
	integrityHash?: number
): JsNode[] {
	return [
		buildDeriveKeyFunction(names, integrityHash),
		buildMixFunction(names),
	];
}

// --- rcDeriveKey ---

/**
 * Build the rcDeriveKey(unit) function.
 *
 * Derives the implicit master key from a bytecode unit's structural
 * properties (instruction count, register count, param count, constant count)
 * via FNV-1a hashing. When an integrity hash is provided, it is XOR-folded
 * into the key before returning.
 */
function buildDeriveKeyFunction(
	names: RuntimeNames,
	integrityHash?: number
): JsNode {
	const h = id("h");
	const u = id("u");
	const k = id("k");
	const FNV_PRIME = lit(0x01000193);

	// h = Math.imul(h ^ expr, FNV_PRIME)
	const fnvRound = (expr: JsNode): JsNode =>
		exprStmt(assign(h, imul(xor(h, expr), FNV_PRIME)));

	const body: JsNode[] = [
		// var h = 0x811C9DC5;
		varDecl("h", lit(0x811c9dc5)),
		// h = Math.imul(h ^ (u.i.length >>> 1), 0x01000193);
		fnvRound(ushr(member(member(u, "i"), "length"), 1)),
		// h = Math.imul(h ^ u.r, 0x01000193);
		fnvRound(member(u, "r")),
		// h = Math.imul(h ^ u.p, 0x01000193);
		fnvRound(member(u, "p")),
		// h = Math.imul(h ^ u.c.length, 0x01000193);
		fnvRound(member(member(u, "c"), "length")),
		// h ^= h >>> 16;
		xorAssign("h", ushr(h, 16)),
		// h = Math.imul(h, 0x45D9F3B);
		exprStmt(assign(h, imul(h, lit(0x45d9f3b)))),
		// h ^= h >>> 13;
		xorAssign("h", ushr(h, 13)),
		// var k = h >>> 0;
		varDecl("k", ushr(h, 0)),
	];

	// Optional: k = (k ^ ihash) >>> 0;
	if (integrityHash !== undefined) {
		body.push(
			exprStmt(assign(k, ushr(xor(k, id(names.ihash)), 0)))
		);
	}

	// return k;
	body.push(returnStmt(k));

	return fn(names.rcDeriveKey, ["u"], body);
}

// --- rcMix ---

/**
 * Build the rcMix(state, a, b) function.
 *
 * Advances the rolling cipher state by mixing in the decrypted opcode
 * and operand values using two multiply-xor rounds with avalanche shift.
 */
function buildMixFunction(names: RuntimeNames): JsNode {
	const h = id("h");
	const a = id("a");
	const b = id("b");

	return fn(names.rcMix, ["s", "a", "b"], [
		// var h = s;
		varDecl("h", id("s")),
		// h = Math.imul(h ^ a, 0x85EBCA6B) >>> 0;
		exprStmt(assign(h, ushr(imul(xor(h, a), lit(0x85ebca6b)), 0))),
		// h = Math.imul(h ^ b, 0xC2B2AE35) >>> 0;
		exprStmt(assign(h, ushr(imul(xor(h, b), lit(0xc2b2ae35)), 0))),
		// h ^= h >>> 16;
		xorAssign("h", ushr(h, 16)),
		// return h >>> 0;
		returnStmt(ushr(h, 0)),
	]);
}
