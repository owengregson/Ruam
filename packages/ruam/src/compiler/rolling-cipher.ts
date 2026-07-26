/**
 * Rolling cipher for bytecode instruction encryption.
 *
 * Encrypts each instruction's opcode and operand with a rolling state
 * that evolves instruction-by-instruction.  The master key is derived
 * from bytecode metadata — no plaintext seed is stored in the output.
 *
 * @module compiler/rolling-cipher
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
 *
 * When {@link cipherSalt} is provided it is mixed into the hash after
 * the metadata rounds but before the avalanche finalization.  This
 * makes the key non-derivable from bytecode metadata alone — the salt
 * is a per-build random value embedded as a numeric literal in the
 * runtime output.
 *
 * @param instrCount     Number of instructions in the unit.
 * @param registerCount  Number of registers used by the unit.
 * @param paramCount     Number of parameters the unit accepts.
 * @param constantCount  Number of constants in the constant pool.
 * @param cipherSalt     Optional per-build random salt.
 * @param keyAnchor      Optional key anchor (XOR-folded into the derived key
 *                       after avalanche finalization — matches the runtime
 *                       `rcDeriveKey` which XORs the closure variable `_ka`
 *                       as the final step).
 */
export function deriveImplicitKey(
	instrCount: number,
	registerCount: number,
	paramCount: number,
	constantCount: number,
	cipherSalt?: number,
	keyAnchor?: number
): number {
	let h = FNV_OFFSET_BASIS;
	h = Math.imul(h ^ instrCount, FNV_PRIME);
	h = Math.imul(h ^ registerCount, FNV_PRIME);
	h = Math.imul(h ^ paramCount, FNV_PRIME);
	h = Math.imul(h ^ constantCount, FNV_PRIME);
	if (cipherSalt !== undefined) {
		h = Math.imul(h ^ cipherSalt, FNV_PRIME);
	}
	h ^= h >>> 16;
	h = Math.imul(h, AVALANCHE_CONSTANT);
	h ^= h >>> 13;
	let k = h >>> 0;
	if (keyAnchor !== undefined) {
		k = (k ^ keyAnchor) >>> 0;
	}
	return k;
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
 *                    If a key anchor + integrity hash are used, they should already
 *                    be folded into the key via {@link deriveImplicitKey}'s `keyAnchor` param.
 */
export function rollingEncrypt(instrs: number[], masterKey: number): void {
	const baseKey = masterKey;

	for (let i = 0; i < instrs.length; i += 2) {
		const idx = i >>> 1;
		// Position-dependent key stream: mix base key with instruction index
		const keyStream = mixState(baseKey, idx, idx ^ GOLDEN_RATIO_PRIME);
		instrs[i] = (instrs[i]! ^ (keyStream & 0xffff)) & 0xffff;
		instrs[i + 1] = (instrs[i + 1]! ^ keyStream) | 0;
	}
}

// ---------------------------------------------------------------------------
// Decode-path impurity (W3) — chained encryption + build-time self-equality gate
// ---------------------------------------------------------------------------

/** Chain mixing prime for the decode-impurity accumulator. */
const CHAIN_PRIME = 0x85ebca77;

/**
 * Advance the decode-impurity accumulator from a decrypted instruction.
 * Identical at build (from plaintext) and runtime (from the decrypted stream).
 */
function chainAcc(acc: number, op: number, operand: number): number {
	return (Math.imul(acc, CHAIN_PRIME) ^ op ^ operand) >>> 0;
}

/**
 * Encrypt the instruction stream with a CHAINED keystream (decode impurity).
 *
 * Each instruction's keystream folds in an accumulator chained from every
 * PRIOR instruction's plaintext (in linear order). This removes the position
 * cipher's random-access property: an attacker cannot decrypt instruction K
 * without first decrypting 0..K-1 — forcing full sequential simulation.
 *
 * Safe because the decode cache materializes the stream in the SAME linear
 * forward pass at runtime (independent of the execution path), so the
 * accumulator evolves identically. Only valid for cache-active builds; the
 * caller (transform) enforces that and runs {@link assertChainedDecryptInverts}.
 *
 * @param instrs    Flat `[op0, operand0, ...]` (modified in place).
 * @param masterKey Key derived from {@link deriveImplicitKey}.
 */
export function rollingEncryptChained(
	instrs: number[],
	masterKey: number
): void {
	let acc = masterKey >>> 0;
	for (let i = 0; i < instrs.length; i += 2) {
		const idx = i >>> 1;
		const op = instrs[i]!;
		const operand = instrs[i + 1]!;
		const keyStream = mixState(
			masterKey,
			idx,
			(idx ^ GOLDEN_RATIO_PRIME ^ acc) >>> 0
		);
		instrs[i] = (op ^ (keyStream & 0xffff)) & 0xffff;
		instrs[i + 1] = (operand ^ keyStream) | 0;
		// Chain from the PLAINTEXT (== what the runtime decrypt yields).
		acc = chainAcc(acc, op & 0xffff, operand | 0);
	}
}

/**
 * MANDATORY build-time self-equality gate for decode impurity.
 *
 * Simulates the runtime chained decrypt over {@link encrypted} and asserts it
 * recovers {@link original} exactly. The runtime AST implements this same
 * algorithm; cross-seed round-trip tests lock build==runtime equivalence. If
 * this ever diverges it THROWS at build time — a loud build failure, never a
 * silent miscompile.
 *
 * @throws If the simulated decrypt does not reproduce the original plaintext.
 */
export function assertChainedDecryptInverts(
	encrypted: number[],
	masterKey: number,
	original: number[]
): void {
	let acc = masterKey >>> 0;
	for (let i = 0; i < encrypted.length; i += 2) {
		const idx = i >>> 1;
		const keyStream = mixState(
			masterKey,
			idx,
			(idx ^ GOLDEN_RATIO_PRIME ^ acc) >>> 0
		);
		const decOp = (encrypted[i]! ^ (keyStream & 0xffff)) & 0xffff;
		const decOperand = (encrypted[i + 1]! ^ keyStream) | 0;
		if (
			decOp !== (original[i]! & 0xffff) ||
			decOperand !== (original[i + 1]! | 0)
		) {
			throw new Error(
				`decodeImpurity self-equality gate failed at instruction ${idx}: ` +
					`build/runtime decrypt would diverge — refusing to emit a ` +
					`potentially miscompiled unit.`
			);
		}
		acc = chainAcc(acc, decOp, decOperand);
	}
}
