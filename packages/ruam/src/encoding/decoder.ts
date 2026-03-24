/**
 * Stream cipher and custom binary encoding — used for bytecode encryption.
 *
 * Provides build-time implementations for:
 * - FNV-1a+LCG stream cipher (symmetric encrypt/decrypt)
 * - Custom alphabet binary encoding (replaces base64)
 *
 * @module encoding/decoder
 */

import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";

// ---------------------------------------------------------------------------
// Build-time implementations
// ---------------------------------------------------------------------------

/**
 * Custom symmetric cipher — FNV-1a key derivation + LCG keystream.
 *
 * Replaces RC4 with a structure that doesn't exhibit recognizable
 * cipher patterns (no S-box, no KSA/PRGA, no swap operations).
 * Symmetric via XOR — same function encrypts and decrypts.
 */
export function rc4(data: Uint8Array, key: string): Uint8Array {
	// Derive 32-bit state from key via FNV-1a
	let h = 0x811c9dc5; // FNV offset basis
	for (let i = 0; i < key.length; i++) {
		h = Math.imul(h ^ key.charCodeAt(i), 0x01000193); // FNV prime
	}
	h >>>= 0;

	// Transform each byte via LCG-driven keystream
	const out = new Uint8Array(data.length);
	for (let i = 0; i < data.length; i++) {
		h = (Math.imul(h, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
		out[i] = data[i]! ^ ((h >>> 16) & 0xff);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Custom alphabet encoding (replaces base64 in output)
// ---------------------------------------------------------------------------

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
