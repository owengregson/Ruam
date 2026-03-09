/**
 * Rolling cipher for bytecode instruction encryption.
 *
 * Encrypts each instruction's opcode and operand with a rolling state
 * that evolves instruction-by-instruction.  The master key is derived
 * from bytecode metadata — no plaintext seed is stored in the output.
 *
 * @module runtime/rolling-cipher
 */

import type { RuntimeNames } from "./names.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Mixing prime for the rolling state update. */
const MIX_PRIME1 = 0x85EBCA6B;
/** Mixing prime for operand contribution. */
const MIX_PRIME2 = 0xC2B2AE35;

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
  constantCount: number,
): number {
  let h = 0x811C9DC5; // FNV offset basis
  h = Math.imul(h ^ instrCount, 0x01000193);
  h = Math.imul(h ^ registerCount, 0x01000193);
  h = Math.imul(h ^ paramCount, 0x01000193);
  h = Math.imul(h ^ constantCount, 0x01000193);
  // Avalanche
  h ^= h >>> 16;
  h = Math.imul(h, 0x45D9F3B);
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * Mix function: advance the rolling state using the decrypted values.
 */
function mixState(state: number, opcode: number, operand: number): number {
  let h = state;
  h = (Math.imul(h ^ opcode, MIX_PRIME1)) >>> 0;
  h = (Math.imul(h ^ operand, MIX_PRIME2)) >>> 0;
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
  integrityHash?: number,
): void {
  const baseKey = integrityHash !== undefined
    ? (masterKey ^ integrityHash) >>> 0
    : masterKey;

  for (let i = 0; i < instrs.length; i += 2) {
    const idx = i >>> 1;
    // Position-dependent key stream: mix base key with instruction index
    const keyStream = mixState(baseKey, idx, idx ^ 0x9E3779B9);
    instrs[i] = (instrs[i]! ^ (keyStream & 0xFFFF)) & 0xFFFF;
    instrs[i + 1] = (instrs[i + 1]! ^ keyStream) | 0;
  }
}

// ---------------------------------------------------------------------------
// Runtime source generation
// ---------------------------------------------------------------------------

/**
 * Generate the runtime rolling cipher helper functions.
 *
 * Emits:
 * - `rcDeriveKey(unit)` — derives the implicit master key from unit metadata
 * - `rcMix(state, a, b)` — rolling state update
 *
 * These are called inside the interpreter loop to decrypt each instruction.
 */
export function generateRollingCipherSource(
  names: RuntimeNames,
  integrityBinding: boolean,
): string {
  // The derive function reads the same structural fields used at build time
  const ihashXor = integrityBinding
    ? `k=(k^${names.ihash})>>>0;`
    : '';

  return `
function ${names.rcDeriveKey}(u){var h=0x811C9DC5;h=Math.imul(h^(u.i.length>>>1),0x01000193);h=Math.imul(h^u.r,0x01000193);h=Math.imul(h^u.p,0x01000193);h=Math.imul(h^u.c.length,0x01000193);h^=h>>>16;h=Math.imul(h,0x45D9F3B);h^=h>>>13;var k=h>>>0;${ihashXor}return k;}
function ${names.rcMix}(s,a,b){var h=s;h=Math.imul(h^a,0x85EBCA6B)>>>0;h=Math.imul(h^b,0xC2B2AE35)>>>0;h^=h>>>16;return h>>>0;}
`;
}

