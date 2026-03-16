/**
 * Bytecode block permutation.
 *
 * Compiler pass that identifies basic blocks in a bytecode unit,
 * shuffles their physical order via seeded Fisher-Yates, and rewrites
 * all jump targets to new positions.
 *
 * Combined with dead code injection, attackers see fake blocks
 * interleaved with real out-of-order blocks. Zero runtime overhead —
 * blocks are fixed at compile time, rolling cipher encrypts in the
 * permuted positions naturally.
 *
 * Advancement over js-confuser-vm's PATCH opcode:
 * - Permutes ALL blocks randomly (no predictable "end of bytecode" pattern)
 * - Interleaves with dead code injection for maximal confusion
 * - Zero runtime overhead (blocks reordered at compile time)
 * - CSP-safe (no eval or Function constructor needed)
 *
 * @module compiler/block-permutation
 */

import type { BytecodeUnit, Instruction } from "../types.js";
import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";

// --- Jump analysis ---

// Import opcode sets for identifying jumps. We import the names and check
// against the canonical opcode enum (before shuffle map is applied).
import {
	JUMP_OPS,
	ALL_JUMP_OPS,
	PACKED_JUMP_OPS,
} from "./opcodes.js";

// --- LCG PRNG ---

function lcgNext(state: number): number {
	return (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
}

// --- Basic block identification ---

/** A basic block: a contiguous range of instructions [startIp, endIp). */
interface BasicBlock {
	/** First instruction IP (inclusive). */
	startIp: number;
	/** One past the last instruction IP (exclusive). */
	endIp: number;
}

/**
 * Identify basic block boundaries in a bytecode unit.
 *
 * Block boundaries occur at:
 * - Jump targets (start of block)
 * - Instructions after jumps (start of block)
 * - Exception handler entry points (start of block)
 *
 * @param unit - The bytecode unit to analyze
 * @returns Array of basic blocks covering the entire instruction stream
 */
function identifyBasicBlocks(unit: BytecodeUnit): BasicBlock[] {
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

	// Sort block starts and create blocks
	const sorted = [...blockStarts].filter((ip) => ip < instrs.length).sort((a, b) => a - b);
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

// --- Block permutation ---

/**
 * Permute the basic blocks of a bytecode unit.
 *
 * Shuffles block order via seeded Fisher-Yates, then rewrites all
 * jump targets, exception table entries, and the jump table to
 * reference new instruction positions.
 *
 * @param unit - The bytecode unit to permute (modified in-place)
 * @param seed - Per-build seed for deterministic shuffling
 */
export function permuteBlocks(unit: BytecodeUnit, seed: number): void {
	const blocks = identifyBasicBlocks(unit);

	// Need at least 3 blocks to make permutation meaningful
	if (blocks.length < 3) return;

	// Fisher-Yates shuffle of block order (skip first block — keep entry point)
	let state = (seed ^ (unit.id.charCodeAt(0) || 0x42)) >>> 0;
	const permuted = [...blocks];
	// Keep block 0 in place (entry point must be first)
	for (let i = permuted.length - 1; i > 1; i--) {
		state = lcgNext(state);
		const j = 1 + ((state >>> 16) % i); // j in [1, i]
		const tmp = permuted[i]!;
		permuted[i] = permuted[j]!;
		permuted[j] = tmp;
	}

	// Check if permutation actually changed anything
	let changed = false;
	for (let i = 0; i < blocks.length; i++) {
		if (blocks[i]!.startIp !== permuted[i]!.startIp) {
			changed = true;
			break;
		}
	}
	if (!changed) return;

	// Build old IP → new IP mapping
	const ipMap = new Map<number, number>();
	let newIp = 0;
	for (const block of permuted) {
		const blockLen = block.endIp - block.startIp;
		for (let offset = 0; offset < blockLen; offset++) {
			ipMap.set(block.startIp + offset, newIp + offset);
		}
		newIp += blockLen;
	}

	// Rewrite instructions in new order
	const oldInstrs = [...unit.instructions];
	const newInstrs: Instruction[] = [];
	for (const block of permuted) {
		for (let ip = block.startIp; ip < block.endIp; ip++) {
			newInstrs.push({ ...oldInstrs[ip]! });
		}
	}

	// Patch jump targets in new instruction array
	for (let ip = 0; ip < newInstrs.length; ip++) {
		const instr = newInstrs[ip]!;

		if (JUMP_OPS.has(instr.opcode)) {
			const newTarget = ipMap.get(instr.operand);
			if (newTarget != null) {
				instr.operand = newTarget;
			}
		}

		if (PACKED_JUMP_OPS.has(instr.opcode)) {
			// Packed: operand = (target << 16) | lowerBits
			const target = instr.operand >>> 16;
			const lower = instr.operand & 0xffff;
			const newTarget = ipMap.get(target);
			if (newTarget != null) {
				instr.operand = (newTarget << 16) | lower;
			}
		}
	}

	// Patch jump table
	const newJumpTable: Record<number, number> = {};
	for (const [label, ip] of Object.entries(unit.jumpTable)) {
		const newTarget = ipMap.get(ip);
		newJumpTable[Number(label)] = newTarget ?? ip;
	}

	// Patch exception table
	const newExceptionTable = unit.exceptionTable.map((entry) => ({
		startIp: ipMap.get(entry.startIp) ?? entry.startIp,
		endIp: ipMap.get(entry.endIp) ?? entry.endIp,
		catchIp: entry.catchIp >= 0 ? (ipMap.get(entry.catchIp) ?? entry.catchIp) : entry.catchIp,
		finallyIp: entry.finallyIp >= 0 ? (ipMap.get(entry.finallyIp) ?? entry.finallyIp) : entry.finallyIp,
	}));

	// Apply changes
	unit.instructions = newInstrs;
	unit.jumpTable = newJumpTable;
	unit.exceptionTable = newExceptionTable;

	// Recursively permute child units
	for (const child of unit.childUnits) {
		state = lcgNext(state);
		permuteBlocks(child, state);
	}
}
