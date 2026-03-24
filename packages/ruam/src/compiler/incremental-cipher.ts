/**
 * Build-time incremental cipher — block-epoch keyed instruction encryption.
 *
 * Each basic block gets a base key derived from (masterKey, blockId).
 * Within a block, each instruction's decryption key chains from the
 * previous instruction's decrypted values, creating sequential
 * dependency. At block boundaries the chain resets to the target block's
 * base key.
 *
 * @module compiler/incremental-cipher
 */

import {
	FNV_PRIME,
	MIX_PRIME1,
	MIX_PRIME2,
	GOLDEN_RATIO_PRIME,
} from "../constants.js";
import type { BytecodeUnit } from "../types.js";
import { identifyBasicBlocks, type BasicBlock } from "./basic-blocks.js";

// --- Types ---

/** A cipher block: basic block with an assigned sequential ID. */
export interface CipherBlock extends BasicBlock {
	/** Sequential block ID used for key derivation. */
	blockId: number;
}

// --- Key derivation ---

/**
 * Derive a per-block base key from the master key and block ID.
 *
 * Uses FNV-1a-style mixing with Murmur3 finalization to produce
 * a well-distributed 32-bit unsigned key.
 *
 * @param masterKey - The master encryption key for the unit.
 * @param blockId   - Sequential block identifier.
 * @returns A 32-bit unsigned per-block base key.
 */
export function deriveBlockKey(masterKey: number, blockId: number): number {
	let h = masterKey;
	h = Math.imul(h ^ blockId, FNV_PRIME) >>> 0;
	h =
		Math.imul(
			h ^ (Math.imul(blockId, GOLDEN_RATIO_PRIME) >>> 0),
			MIX_PRIME1
		) >>> 0;
	h ^= h >>> 16;
	h = Math.imul(h, MIX_PRIME2) >>> 0;
	h ^= h >>> 13;
	return h >>> 0;
}

// --- Chain feedback ---

/**
 * Chain feedback — mix current state with decrypted instruction values.
 *
 * Advances the chain state based on the plaintext opcode and operand,
 * creating sequential dependency within a basic block.
 *
 * @param state   - Current chain state.
 * @param opcode  - Decrypted (plaintext) opcode value.
 * @param operand - Decrypted (plaintext) operand value.
 * @returns Updated 32-bit unsigned chain state.
 */
export function chainMix(
	state: number,
	opcode: number,
	operand: number
): number {
	let h = state;
	h = Math.imul(h ^ opcode, MIX_PRIME1) >>> 0;
	h = Math.imul(h ^ operand, MIX_PRIME2) >>> 0;
	h ^= h >>> 16;
	return h >>> 0;
}

// --- Cipher block construction ---

/**
 * Build cipher blocks from a bytecode unit's basic blocks.
 *
 * Uses {@link identifyBasicBlocks} to find block boundaries and assigns
 * sequential block IDs starting from 0.
 *
 * @param unit - The bytecode unit to analyze.
 * @returns Array of cipher blocks with assigned IDs.
 */
export function buildCipherBlocks(unit: BytecodeUnit): CipherBlock[] {
	const blocks = identifyBasicBlocks(unit);
	return blocks.map((block, index) => ({
		startIp: block.startIp,
		endIp: block.endIp,
		blockId: index,
	}));
}

// --- Incremental encryption ---

/**
 * Encrypt a flat instruction array in-place using block-epoch keyed
 * incremental encryption.
 *
 * The instruction array is a flat `[opcode, operand, opcode, operand, ...]`
 * sequence where each instruction occupies two consecutive slots.
 *
 * For each block:
 * 1. Initialize chainState = deriveBlockKey(masterKey, block.blockId)
 * 2. For each instruction in the block:
 *    a. Save plaintext opcode and operand before encryption
 *    b. XOR opcode with lower 16 bits of chain state
 *    c. XOR operand with full 32 bits of chain state (signed)
 *    d. Advance chain using the PLAINTEXT values
 *
 * At runtime, the decryptor performs the inverse:
 * 1. XOR to recover plaintext
 * 2. Advance chain with the recovered plaintext
 *
 * Both sides produce identical chain state progression because the chain
 * is always advanced with plaintext values.
 *
 * @param instrs    - Flat instruction array `[op, operand, op, operand, ...]`.
 *                    Modified in-place.
 * @param masterKey - Master encryption key for the unit.
 * @param blocks    - Cipher blocks from {@link buildCipherBlocks}.
 */
export function incrementalEncrypt(
	instrs: number[],
	masterKey: number,
	blocks: CipherBlock[]
): void {
	for (const block of blocks) {
		let chainState = deriveBlockKey(masterKey, block.blockId);

		for (let ip = block.startIp; ip < block.endIp; ip++) {
			const opcodeIdx = ip * 2;
			const operandIdx = ip * 2 + 1;

			// Save plaintext values before encryption
			const plainOp = instrs[opcodeIdx]!;
			const plainOperand = instrs[operandIdx]!;

			// Encrypt: XOR with chain state
			instrs[opcodeIdx] = (plainOp ^ (chainState & 0xffff)) & 0xffff;
			instrs[operandIdx] = (plainOperand ^ chainState) | 0;

			// Advance chain using PLAINTEXT values (same as runtime will use
			// after decryption — ensures identical chain progression)
			chainState = chainMix(chainState, plainOp, plainOperand);
		}
	}
}
