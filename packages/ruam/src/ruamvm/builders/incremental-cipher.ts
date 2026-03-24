/**
 * Incremental cipher builder — assembles icBlockKey and icMix functions as AST nodes.
 *
 * Emits the runtime counterparts of the build-time functions in
 * `compiler/incremental-cipher.ts`. Both functions must produce
 * IDENTICAL results to their build-time equivalents so that the
 * encrypting and decrypting sides stay in sync.
 *
 * All runtime JS is generated via pure AST construction — no raw() nodes.
 * Dense bit-manipulation expressions are composed via nested BinOp nodes
 * with file-local helpers (xor, ushr, imul, xorAssign).
 *
 * @module ruamvm/builders/incremental-cipher
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../naming/compat-types.js";
import type { SplitFn } from "../constant-splitting.js";
import {
	assign,
	bin,
	call,
	exprStmt,
	fn,
	id,
	lit,
	returnStmt,
	varDecl,
	BOp,
	AOp,
} from "../nodes.js";
import {
	FNV_PRIME,
	GOLDEN_RATIO_PRIME,
	MIX_PRIME1,
	MIX_PRIME2,
} from "../../constants.js";

// --- Local helpers for dense bit manipulation ---

/** `a ^ b` */
const xor = (a: JsNode, b: JsNode): JsNode => bin(BOp.BitXor, a, b);

/** `a >>> n` */
const ushr = (a: JsNode, n: number): JsNode => bin(BOp.Ushr, a, lit(n));

/** `imulAlias(a, b)` — uses the IIFE-scope alias for Math.imul */
const makeImul =
	(imulName: string) =>
	(a: JsNode, b: JsNode): JsNode =>
		call(id(imulName), [a, b]);

/** `h ^= expr` — shorthand for `exprStmt(assign(id("h"), expr, AOp.BitXor))` */
const xorAssign = (target: string, value: JsNode): JsNode =>
	exprStmt(assign(id(target), value, AOp.BitXor));

/**
 * Build the runtime incremental cipher helper functions as JsNode[].
 *
 * Emits two function declarations:
 * - `icBlockKey(mk, bid)` — derives a per-block base key from the master key
 *   and block ID using FNV-1a-style mixing with Murmur3 finalization.
 *   Mirrors build-time `deriveBlockKey()` in `compiler/incremental-cipher.ts`.
 * - `icMix(s, op, od)` — advances chain feedback state by mixing in the
 *   decrypted opcode and operand values.
 *   Mirrors build-time `chainMix()` in `compiler/incremental-cipher.ts`.
 *
 * @param names  Runtime identifier mapping.
 * @param split  Optional constant splitter for numeric obfuscation.
 * @returns Array of JsNode representing both function declarations.
 */
export function buildIncrementalCipherSource(
	names: RuntimeNames,
	split?: SplitFn
): JsNode[] {
	const imulId = names.imul;
	return [
		buildBlockKeyFunction(names, split, imulId),
		buildMixFunction(names, split, imulId),
	];
}

// --- icBlockKey ---

/**
 * Build the icBlockKey(mk, bid) function.
 *
 * Derives a per-block base key from the master key and block ID:
 * 1. Mix masterKey with blockId via FNV-1a-style multiply-xor.
 * 2. Mix again with the golden-ratio-scrambled blockId.
 * 3. Apply Murmur3 avalanche finalization (16-bit shift + multiply + 13-bit shift).
 *
 * Must produce the EXACT same output as build-time `deriveBlockKey()`.
 */
function buildBlockKeyFunction(
	names: RuntimeNames,
	split?: SplitFn,
	imulId?: string
): JsNode {
	const L = (n: number): JsNode => (split ? split(n) : lit(n));
	const imul = makeImul(imulId ?? "Math.imul");
	const h = id("h");
	const mk = id("mk");
	const bid = id("bid");

	return fn(
		names.icBlockKey,
		["mk", "bid"],
		[
			// var h = mk;
			varDecl("h", mk),
			// h = (Math.imul(h ^ bid, 0x01000193) >>> 0);
			exprStmt(assign(h, ushr(imul(xor(h, bid), L(FNV_PRIME)), 0))),
			// h = (Math.imul(h ^ (Math.imul(bid, 0x9e3779b9) >>> 0), 0x85EBCA6B) >>> 0);
			exprStmt(
				assign(
					h,
					ushr(
						imul(
							xor(h, ushr(imul(bid, L(GOLDEN_RATIO_PRIME)), 0)),
							L(MIX_PRIME1)
						),
						0
					)
				)
			),
			// h ^= h >>> 16;
			xorAssign("h", ushr(h, 16)),
			// h = (Math.imul(h, 0xC2B2AE35) >>> 0);
			exprStmt(assign(h, ushr(imul(h, L(MIX_PRIME2)), 0))),
			// h ^= h >>> 13;
			xorAssign("h", ushr(h, 13)),
			// return h >>> 0;
			returnStmt(ushr(h, 0)),
		]
	);
}

// --- icMix ---

/**
 * Build the icMix(s, op, od) function.
 *
 * Advances the chain feedback state by mixing in the decrypted opcode
 * and operand values, creating sequential dependency within a basic block:
 * 1. Mix state with opcode via multiply-xor (MIX_PRIME1).
 * 2. Mix with operand via multiply-xor (MIX_PRIME2).
 * 3. Apply partial avalanche finalization (16-bit shift).
 *
 * Must produce the EXACT same output as build-time `chainMix()`.
 */
function buildMixFunction(
	names: RuntimeNames,
	split?: SplitFn,
	imulId?: string
): JsNode {
	const L = (n: number): JsNode => (split ? split(n) : lit(n));
	const imul = makeImul(imulId ?? "Math.imul");
	const h = id("h");
	const op = id("op");
	const od = id("od");

	return fn(
		names.icMix,
		["s", "op", "od"],
		[
			// var h = s;
			varDecl("h", id("s")),
			// h = (Math.imul(h ^ op, 0x85EBCA6B) >>> 0);
			exprStmt(assign(h, ushr(imul(xor(h, op), L(MIX_PRIME1)), 0))),
			// h = (Math.imul(h ^ od, 0xC2B2AE35) >>> 0);
			exprStmt(assign(h, ushr(imul(xor(h, od), L(MIX_PRIME2)), 0))),
			// h ^= h >>> 16;
			xorAssign("h", ushr(h, 16)),
			// return h >>> 0;
			returnStmt(ushr(h, 0)),
		]
	);
}
