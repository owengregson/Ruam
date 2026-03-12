/**
 * RC4 cipher and custom binary encoding — used for bytecode encryption.
 *
 * Provides build-time implementations for:
 * - RC4 stream cipher (symmetric encrypt/decrypt)
 * - Custom alphabet binary encoding (replaces base64)
 * - Alphabet generation (per-build Fisher-Yates shuffle)
 *
 * @module encoding/decoder
 */

import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";

// ---------------------------------------------------------------------------
// Build-time implementations
// ---------------------------------------------------------------------------

/** RC4 stream cipher — symmetric encrypt / decrypt. */
export function rc4(data: Uint8Array, key: string): Uint8Array {
	const S = new Array<number>(256);
	let j = 0;

	for (let i = 0; i < 256; i++) S[i] = i;
	for (let i = 0; i < 256; i++) {
		j = (j + S[i]! + key.charCodeAt(i % key.length)) & 255;
		const t = S[i]!;
		S[i] = S[j]!;
		S[j] = t;
	}

	let ii = 0;
	j = 0;
	const out = new Uint8Array(data.length);
	for (let k = 0; k < data.length; k++) {
		ii = (ii + 1) & 255;
		j = (j + S[ii]!) & 255;
		const t = S[ii]!;
		S[ii] = S[j]!;
		S[j] = t;
		out[k] = data[k]! ^ S[(S[ii]! + S[j]!) & 255]!;
	}
	return out;
}

/** Base64-encode a byte array (works in both Node.js and browsers). */
export function b64encode(data: Uint8Array): string {
	if (typeof Buffer !== "undefined") {
		return Buffer.from(data).toString("base64");
	}
	let binary = "";
	for (let i = 0; i < data.length; i++) {
		binary += String.fromCharCode(data[i]!);
	}
	return btoa(binary);
}

// ---------------------------------------------------------------------------
// Custom alphabet encoding (replaces base64 in output)
// ---------------------------------------------------------------------------

/** Safe 64-char alphabet base: A-Z a-z 0-9 _ $ (all valid JS identifier chars). */
const ALPHABET_BASE =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_$";

/**
 * Generate a per-build shuffled 64-character encoding alphabet.
 *
 * Uses Fisher-Yates shuffle with LCG PRNG. The resulting alphabet
 * contains only JS-identifier-safe characters (A-Za-z0-9_$), so
 * encoded strings look like random identifiers rather than base64.
 *
 * @param seed - Build seed for deterministic shuffling.
 * @returns A 64-character shuffled alphabet string.
 */
export function generateAlphabet(seed: number): string {
	const chars = ALPHABET_BASE.split("");
	let s = seed >>> 0;
	for (let i = chars.length - 1; i > 0; i--) {
		s = (s * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
		const j = s % (i + 1);
		const tmp = chars[i]!;
		chars[i] = chars[j]!;
		chars[j] = tmp;
	}
	return chars.join("");
}

/**
 * Encode a Uint8Array using a custom 64-character alphabet.
 *
 * Same bit-packing as base64 (3 bytes → 4 chars) but with a per-build
 * shuffled alphabet and no padding characters. The output contains only
 * identifier-safe characters, eliminating the telltale `+/=` of base64.
 *
 * @param data     - Binary data to encode.
 * @param alphabet - A 64-character encoding alphabet.
 * @returns The encoded string.
 */
export function customEncode(data: Uint8Array, alphabet: string): string {
	let result = "";
	const n = data.length;
	let i = 0;

	// Process full groups of 3 bytes → 4 chars
	for (; i + 2 < n; i += 3) {
		const a = data[i]!;
		const b = data[i + 1]!;
		const c = data[i + 2]!;
		result += alphabet[(a >> 2) & 63];
		result += alphabet[((a & 3) << 4) | (b >> 4)];
		result += alphabet[((b & 15) << 2) | (c >> 6)];
		result += alphabet[c & 63];
	}

	// Handle remaining bytes (no padding)
	if (i < n) {
		const a = data[i]!;
		result += alphabet[(a >> 2) & 63];
		if (i + 1 < n) {
			const b = data[i + 1]!;
			result += alphabet[((a & 3) << 4) | (b >> 4)];
			result += alphabet[(b & 15) << 2];
		} else {
			result += alphabet[(a & 3) << 4];
		}
	}

	return result;
}
