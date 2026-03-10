/**
 * Rolling cipher for bytecode instruction encryption.
 *
 * Encrypts each instruction's opcode and operand with a rolling state
 * that evolves instruction-by-instruction.  The master key is derived
 * from bytecode metadata — no plaintext seed is stored in the output.
 *
 * @module runtime/rolling-cipher
 */

import {
	FNV_OFFSET_BASIS,
	FNV_PRIME,
	GOLDEN_RATIO_PRIME,
	MIX_PRIME1,
	MIX_PRIME2,
	AVALANCHE_CONSTANT,
} from "../constants.js";

// ---------------------------------------------------------------------------
// Build-time: derive master key from bytecode metadata
// ---------------------------------------------------------------------------

/**
 * Derive the implicit master key from a bytecode unit's structural
 * properties.  This produces the same value at build time and runtime
 * because the metadata is available in both contexts.
 */
export function deriveImplicitKey(
	instrCount: number,
	registerCount: number,
	paramCount: number,
	constantCount: number
): number {
	let h = FNV_OFFSET_BASIS;
	h = Math.imul(h ^ instrCount, FNV_PRIME);
	h = Math.imul(h ^ registerCount, FNV_PRIME);
	h = Math.imul(h ^ paramCount, FNV_PRIME);
	h = Math.imul(h ^ constantCount, FNV_PRIME);
	h ^= h >>> 16;
	h = Math.imul(h, AVALANCHE_CONSTANT);
	h ^= h >>> 13;
	return h >>> 0;
}

/**
 * Mix function: advance the rolling state using the decrypted values.
 */
function mixState(state: number, opcode: number, operand: number): number {
	let h = state;
	h = Math.imul(h ^ opcode, MIX_PRIME1) >>> 0;
	h = Math.imul(h ^ operand, MIX_PRIME2) >>> 0;
	h ^= h >>> 16;
	return h >>> 0;
}

// ---------------------------------------------------------------------------
// Build-time: encrypt instruction stream in-place
// ---------------------------------------------------------------------------

/**
 * Encrypt an instruction array (flat `[opcode, operand, ...]`) using
 * position-dependent encryption.  Modifies the array in place.
 *
 * Each instruction is encrypted with a key derived from the master key
 * and the instruction's position index.  This is robust across jumps
 * and non-linear control flow — no sequential state dependency.
 *
 * @param instrs      Flat instruction array `[op0, operand0, op1, operand1, ...]`
 * @param masterKey   Key derived from {@link deriveImplicitKey}.
 * @param integrityHash  Optional integrity hash to fold into the key.
 */
export function rollingEncrypt(
	instrs: number[],
	masterKey: number,
	integrityHash?: number
): void {
	const baseKey =
		integrityHash !== undefined
			? (masterKey ^ integrityHash) >>> 0
			: masterKey;

	for (let i = 0; i < instrs.length; i += 2) {
		const idx = i >>> 1;
		// Position-dependent key stream: mix base key with instruction index
		const keyStream = mixState(baseKey, idx, idx ^ GOLDEN_RATIO_PRIME);
		instrs[i] = (instrs[i]! ^ (keyStream & 0xffff)) & 0xffff;
		instrs[i + 1] = (instrs[i + 1]! ^ keyStream) | 0;
	}
}

