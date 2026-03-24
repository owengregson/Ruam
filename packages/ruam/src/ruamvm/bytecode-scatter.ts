/**
 * Bytecode scattering engine.
 *
 * Splits encoded bytecode strings into ordered chunks for incremental
 * accumulation. The caller emits `bt["id"] = chunk0` followed by
 * `bt["id"] += chunk1`, `bt["id"] += chunk2`, etc. — scattered among
 * runtime statements so no contiguous encoded block appears in output.
 *
 * @module ruamvm/bytecode-scatter
 */

import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";
import { deriveSeed } from "../naming/scope.js";

// --- LCG helper ---

function lcgNext(state: number): number {
	return (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
}

// --- Core API ---

/** Result of scattering a single bytecode unit. */
export interface ScatterResult {
	/** Ordered string chunks. First is assigned with `=`, rest with `+=`. */
	chunks: string[];
}

/**
 * Split an encoded bytecode string into ordered chunks.
 *
 * @param encoded      - The encoded bytecode string to scatter
 * @param seed         - Per-build seed for deterministic LCG choices
 * @param minFragments - Minimum fragment count (default 2)
 * @param maxFragments - Maximum fragment count (default 6)
 * @returns ScatterResult with ordered string chunks
 */
export function scatterBytecodeUnit(
	encoded: string,
	seed: number,
	minFragments = 2,
	maxFragments = 6
): ScatterResult {
	let state = deriveSeed(seed, "btScatterFrag");

	// Short strings: no split
	if (encoded.length < 8) {
		return { chunks: [encoded] };
	}

	// Determine fragment count based on string length + LCG
	state = lcgNext(state);
	const range = maxFragments - minFragments + 1;
	const fragCount = minFragments + ((state >>> 16) % range);

	// Vary chunk sizes instead of equal splits — avoids the
	// "all chunks are exactly N chars" fingerprint.
	const chunks: string[] = [];
	let offset = 0;
	const remaining = encoded.length;

	for (let i = 0; i < fragCount && offset < remaining; i++) {
		const left = fragCount - i;
		const baseLen = Math.ceil((remaining - offset) / left);
		// Jitter: ±25% variation on chunk size
		state = lcgNext(state);
		const jitter = ((state >>> 16) % 51) - 25; // -25 to +25
		const len = Math.max(
			4,
			Math.min(remaining - offset, baseLen + Math.floor((baseLen * jitter) / 100))
		);
		chunks.push(encoded.slice(offset, offset + len));
		offset += len;
	}

	// Append any remainder to the last chunk
	if (offset < remaining && chunks.length > 0) {
		chunks[chunks.length - 1] += encoded.slice(offset);
	}

	return { chunks };
}
