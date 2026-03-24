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
import { Op, ALL_JUMP_OPS, PACKED_JUMP_OPS } from "./opcodes.js";

// --- Basic block identification (shared module) ---

import { identifyBasicBlocks } from "./basic-blocks.js";
import type { BasicBlock } from "./basic-blocks.js";

// --- Terminal opcodes ---
// Opcodes that never fall through to the next instruction.
const TERMINAL_OPS = new Set<Op>([
	Op.JMP,
	Op.RETURN,
	Op.RETURN_VOID,
	Op.THROW,
	Op.RETHROW,
	Op.GENERATOR_RETURN,
	Op.GENERATOR_THROW,
	Op.ASYNC_GENERATOR_RETURN,
	Op.ASYNC_GENERATOR_THROW,
]);

// --- LCG PRNG ---

function lcgNext(state: number): number {
	return (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
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

	// --- Phase 1: Insert explicit JMPs for fall-through blocks ---
	// Before reordering, identify blocks that don't end with a terminal
	// instruction. These rely on sequential fall-through to the next block,
	// which will break after reordering. Insert an explicit JMP at the end
	// of such blocks pointing to their original successor.
	// Deep-copy instructions to avoid sharing objects with unit.instructions.
	// Phase 1 modifies operands in-place; shared objects would corrupt the
	// original unit state visible to recursive child-unit processing.
	const oldInstrs = unit.instructions.map((i) => ({ ...i }));

	// Build a map from original block start → original block index
	const blockIndexByStart = new Map<number, number>();
	for (let bi = 0; bi < blocks.length; bi++) {
		blockIndexByStart.set(blocks[bi]!.startIp, bi);
	}

	// Determine which blocks need a fall-through JMP and insert them.
	// Track IP expansion so we can adjust block boundaries.
	const expandedInstrs: Instruction[] = [...oldInstrs];
	let totalExpansion = 0;
	const expansionByBlock = new Map<number, number>(); // block startIp -> expansion count

	for (let bi = 0; bi < blocks.length; bi++) {
		const block = blocks[bi]!;
		const lastIp = block.endIp - 1;
		const lastInstr = oldInstrs[lastIp];

		if (!lastInstr) continue;

		// If the block already ends with a terminal or unconditional jump, no fix needed
		if (TERMINAL_OPS.has(lastInstr.opcode)) continue;

		// If this is the last block, it has no successor to fall through to
		if (bi + 1 >= blocks.length) continue;

		// Insert a JMP to the original successor block's start IP
		const successorStartIp = blocks[bi + 1]!.startIp;
		const insertPos = block.endIp + totalExpansion;
		expandedInstrs.splice(insertPos, 0, {
			opcode: Op.JMP,
			operand: successorStartIp, // Will be patched by IP mapping below
		});
		totalExpansion++;
		expansionByBlock.set(
			block.startIp,
			(expansionByBlock.get(block.startIp) ?? 0) + 1
		);
	}

	// Rebuild block boundaries accounting for inserted JMPs
	const expandedBlocks: BasicBlock[] = [];
	let ipOffset = 0;
	for (let bi = 0; bi < blocks.length; bi++) {
		const origBlock = blocks[bi]!;
		const blockLen = origBlock.endIp - origBlock.startIp;
		const expansion = expansionByBlock.get(origBlock.startIp) ?? 0;
		expandedBlocks.push({
			startIp: origBlock.startIp + ipOffset,
			endIp: origBlock.startIp + ipOffset + blockLen + expansion,
		});
		ipOffset += expansion;
	}

	// Rebuild the permuted order using expanded blocks
	// The permuted array references original blocks by startIp — map to expanded
	const expandedPermuted: BasicBlock[] = [];
	const origToExpanded = new Map<number, BasicBlock>();
	for (let bi = 0; bi < blocks.length; bi++) {
		origToExpanded.set(blocks[bi]!.startIp, expandedBlocks[bi]!);
	}
	for (const origBlock of permuted) {
		expandedPermuted.push(origToExpanded.get(origBlock.startIp)!);
	}

	// Patch the JMP operands: they point to original successor IPs which
	// need to be adjusted for the expansion.
	const origIpToExpanded = new Map<number, number>();
	ipOffset = 0;
	for (let bi = 0; bi < blocks.length; bi++) {
		const origBlock = blocks[bi]!;
		for (let ip = origBlock.startIp; ip < origBlock.endIp; ip++) {
			origIpToExpanded.set(ip, ip + ipOffset);
		}
		ipOffset += expansionByBlock.get(origBlock.startIp) ?? 0;
	}

	// --- Build combined original→permuted IP mapping ---
	// Compose origIpToExpanded with expandedIpToPermuted in one step
	// to avoid mutating shared instruction objects.
	const ipMap = new Map<number, number>();
	let newIp = 0;
	for (const block of expandedPermuted) {
		const blockLen = block.endIp - block.startIp;
		for (let offset = 0; offset < blockLen; offset++) {
			ipMap.set(block.startIp + offset, newIp + offset);
		}
		newIp += blockLen;
	}

	// Combined mapping: original IP → permuted IP
	const origToPermuted = new Map<number, number>();
	for (const [origIp, expandedIp] of origIpToExpanded) {
		const permuted = ipMap.get(expandedIp);
		if (permuted != null) origToPermuted.set(origIp, permuted);
	}
	// Inserted fall-through JMPs use original successor IPs as operands.
	// Their expanded IPs are in ipMap but not in origIpToExpanded.
	// We'll patch them via origToPermuted (their operands are original IPs).

	// Rewrite instructions in permuted order (fresh copies, no mutation)
	const newInstrs: Instruction[] = [];
	for (const block of expandedPermuted) {
		for (let ip = block.startIp; ip < block.endIp; ip++) {
			newInstrs.push({ ...expandedInstrs[ip]! });
		}
	}

	// Patch jump targets in new instruction array.
	// Operands are still ORIGINAL IPs (no in-place Phase 1 mutation).
	// Use origToPermuted for direct original→permuted mapping.
	for (let ip = 0; ip < newInstrs.length; ip++) {
		const instr = newInstrs[ip]!;

		if (ALL_JUMP_OPS.has(instr.opcode)) {
			const newTarget = origToPermuted.get(instr.operand);
			if (newTarget != null) {
				instr.operand = newTarget;
			} else {
				// Fall-off-end targets (>= origInstrCount) map to newInstrs.length
				if (instr.operand >= oldInstrs.length) {
					instr.operand = newInstrs.length;
				}
			}
		}

		if (PACKED_JUMP_OPS.has(instr.opcode)) {
			const target = instr.operand >>> 16;
			const lower = instr.operand & 0xffff;
			const newTarget = origToPermuted.get(target);
			if (newTarget != null) {
				instr.operand = (newTarget << 16) | lower;
			} else if (target >= oldInstrs.length && target !== 0xffff) {
				instr.operand = (newInstrs.length << 16) | lower;
			}
		}
	}

	// Patch jump table
	const newJumpTable: Record<number, number> = {};
	for (const [label, ip] of Object.entries(unit.jumpTable)) {
		const newTarget = origToPermuted.get(ip);
		newJumpTable[Number(label)] = newTarget ?? ip;
	}

	// Patch exception table: map original IPs through expansion + permutation.
	// endIp can equal expandedInstrs.length (one past last instruction) —
	// handle by mapping to newInstrs.length when not found.
	const mapIp = (origIp: number): number => {
		const expandedIp = origIpToExpanded.get(origIp) ?? origIp;
		const mapped = ipMap.get(expandedIp);
		if (mapped != null) return mapped;
		// If expandedIp === expandedInstrs.length, map to newInstrs.length
		if (expandedIp >= expandedInstrs.length) return newInstrs.length;
		return expandedIp;
	};
	const newExceptionTable = unit.exceptionTable.map((entry) => ({
		startIp: mapIp(entry.startIp),
		endIp: mapIp(entry.endIp),
		catchIp: entry.catchIp >= 0 ? mapIp(entry.catchIp) : entry.catchIp,
		finallyIp:
			entry.finallyIp >= 0 ? mapIp(entry.finallyIp) : entry.finallyIp,
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
