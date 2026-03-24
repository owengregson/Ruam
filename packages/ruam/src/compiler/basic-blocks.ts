/**
 * Basic block identification for bytecode units.
 *
 * Extracts the shared logic for identifying basic block boundaries from
 * the instruction stream.  Used by block permutation, incremental cipher,
 * and any future pass that operates on control-flow structure.
 *
 * @module compiler/basic-blocks
 */

import type { BytecodeUnit } from "../types.js";
import { JUMP_OPS, PACKED_JUMP_OPS } from "./opcodes.js";

// --- Basic block types ---

/** A basic block: a contiguous range of instructions [startIp, endIp). */
export interface BasicBlock {
	/** First instruction IP (inclusive). */
	startIp: number;
	/** One past the last instruction IP (exclusive). */
	endIp: number;
}

// --- Basic block identification ---

/**
 * Identify basic block boundaries in a bytecode unit.
 *
 * Block boundaries occur at:
 * - IP 0 (always a block start)
 * - Jump targets (start of block)
 * - Instructions after jumps (start of block)
 * - Packed jump targets extracted from upper bits (start of block)
 * - Exception handler entry/exit points (start of block)
 * - Jump table target IPs (start of block)
 *
 * @param unit - The bytecode unit to analyze
 * @returns Array of basic blocks covering the entire instruction stream
 */
export function identifyBasicBlocks(unit: BytecodeUnit): BasicBlock[] {
	const instrs = unit.instructions;
	if (instrs.length === 0) return [];

	// Collect all block-start IPs
	const blockStarts = new Set<number>();
	blockStarts.add(0); // First instruction is always a block start

	for (let ip = 0; ip < instrs.length; ip++) {
		const instr = instrs[ip]!;
		const opcode = instr.opcode;

		if (JUMP_OPS.has(opcode)) {
			// The jump target is a block start
			const target = instr.operand;
			if (target >= 0 && target < instrs.length) {
				blockStarts.add(target);
			}
			// The instruction after the jump is a block start
			if (ip + 1 < instrs.length) {
				blockStarts.add(ip + 1);
			}
		}

		if (PACKED_JUMP_OPS.has(opcode)) {
			// Packed jumps encode target in upper bits
			const target = instr.operand >>> 16;
			if (target >= 0 && target < instrs.length) {
				blockStarts.add(target);
			}
			if (ip + 1 < instrs.length) {
				blockStarts.add(ip + 1);
			}
		}
	}

	// Exception handler entry points
	for (const entry of unit.exceptionTable) {
		if (entry.catchIp >= 0) blockStarts.add(entry.catchIp);
		if (entry.finallyIp >= 0) blockStarts.add(entry.finallyIp);
		blockStarts.add(entry.startIp);
		if (entry.endIp < instrs.length) blockStarts.add(entry.endIp);
	}

	// Jump table target IPs
	for (const ip of Object.values(unit.jumpTable)) {
		if (ip >= 0 && ip < instrs.length) {
			blockStarts.add(ip);
		}
	}

	// Sort block starts and create blocks
	const sorted = [...blockStarts]
		.filter((ip) => ip < instrs.length)
		.sort((a, b) => a - b);
	const blocks: BasicBlock[] = [];
	for (let i = 0; i < sorted.length; i++) {
		const start = sorted[i]!;
		const end = i + 1 < sorted.length ? sorted[i + 1]! : instrs.length;
		if (start < end) {
			blocks.push({ startIp: start, endIp: end });
		}
	}

	return blocks;
}
