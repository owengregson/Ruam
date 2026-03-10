/**
 * Rolling cipher builder — assembles rcDeriveKey and rcMix functions as AST nodes.
 *
 * Replaces the template-literal approach in runtime/rolling-cipher.ts with
 * AST-based construction. The function bodies use raw() because the
 * bit-manipulation expressions are dense and benefit from verbatim output.
 *
 * @module codegen/builders/rolling-cipher
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../runtime/names.js";
import { raw } from "../nodes.js";

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
	const ihashXor =
		integrityHash !== undefined ? `k=(k^${names.ihash})>>>0;` : "";

	return raw(
		`function ${names.rcDeriveKey}(u){` +
			`var h=0x811C9DC5;` +
			`h=Math.imul(h^(u.i.length>>>1),0x01000193);` +
			`h=Math.imul(h^u.r,0x01000193);` +
			`h=Math.imul(h^u.p,0x01000193);` +
			`h=Math.imul(h^u.c.length,0x01000193);` +
			`h^=h>>>16;` +
			`h=Math.imul(h,0x45D9F3B);` +
			`h^=h>>>13;` +
			`var k=h>>>0;` +
			ihashXor +
			`return k;` +
			`}`
	);
}

// --- rcMix ---

/**
 * Build the rcMix(state, a, b) function.
 *
 * Advances the rolling cipher state by mixing in the decrypted opcode
 * and operand values using two multiply-xor rounds with avalanche shift.
 */
function buildMixFunction(names: RuntimeNames): JsNode {
	return raw(
		`function ${names.rcMix}(s,a,b){` +
			`var h=s;` +
			`h=Math.imul(h^a,0x85EBCA6B)>>>0;` +
			`h=Math.imul(h^b,0xC2B2AE35)>>>0;` +
			`h^=h>>>16;` +
			`return h>>>0;` +
			`}`
	);
}
