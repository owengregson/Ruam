/**
 * Constant splitting — replaces numeric literals with computed expressions.
 *
 * Each call to the returned function generates a unique expression that
 * evaluates to the given value at runtime. This prevents attackers from
 * grepping for well-known constants (FNV primes, golden ratios, etc.).
 *
 * @module ruamvm/constant-splitting
 */

import type { JsNode } from "./nodes.js";
import { bin, lit, BOp } from "./nodes.js";
import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";

// --- Types ---

/** A function that takes a 32-bit numeric constant and returns a JsNode expression that computes it. */
export type SplitFn = (value: number) => JsNode;

// --- Splitter factory ---

/**
 * Create a constant splitter seeded from the build seed.
 *
 * Returns a function that converts numeric literals into computed
 * expressions. Each call advances the internal PRNG state, so
 * consecutive calls produce different split patterns.
 *
 * @param seed - Per-build CSPRNG seed.
 * @returns A function `split(value) => JsNode` that creates obfuscated constants.
 */
export function makeConstantSplitter(seed: number): SplitFn {
	let s = seed >>> 0;

	function lcg(): number {
		s = (s * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
		return s;
	}

	let callCount = 0;

	return function split(value: number): JsNode {
		const v = value >>> 0; // ensure unsigned 32-bit
		const mask = lcg();
		const strategy = callCount++ % 3;

		switch (strategy) {
			case 0: {
				// XOR split: mask ^ (mask ^ value) = value
				const other = (mask ^ v) >>> 0;
				return bin(BOp.BitXor, lit(mask), lit(other));
			}
			case 1: {
				// SUB split: (value + offset) - offset = value
				// Use smaller offset to avoid overflow issues
				const offset = (mask & 0x7fffffff) >>> 0;
				const sum = (v + offset) >>> 0;
				return bin(BOp.Ushr, bin(BOp.Sub, lit(sum), lit(offset)), lit(0));
			}
			case 2:
			default: {
				// Double XOR: (a ^ b ^ c) where a ^ b ^ c = value
				const a = lcg();
				const b = (a ^ mask ^ v) >>> 0;
				return bin(BOp.BitXor, bin(BOp.BitXor, lit(a), lit(mask)), lit(b));
			}
		}
	};
}
