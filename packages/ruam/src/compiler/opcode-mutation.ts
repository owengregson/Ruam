/**
 * Runtime opcode mutation.
 *
 * Inserts MUTATE instructions into compiled bytecode that permute the
 * handler table at runtime. The same physical opcode byte executes
 * different handlers at different points in execution, making static
 * disassembly impossible.
 *
 * Advancement over Aether-VM:
 * - Mutations are crypto-entangled with the rolling cipher
 * - Cumulative state (each mutation builds on the previous)
 * - The MUTATE opcode itself is encrypted by the rolling cipher
 * - Mutation parameters derived from build seed (deterministic but opaque)
 *
 * @module compiler/opcode-mutation
 */

import type { BytecodeUnit, Instruction } from "../types.js";
import { Op, OPCODE_COUNT } from "./opcodes.js";
import {
	LCG_MULTIPLIER,
	LCG_INCREMENT,
	GOLDEN_RATIO_PRIME,
} from "../constants.js";

// --- Constants ---

/** Minimum instructions between mutation points. */
const MIN_MUTATION_INTERVAL = 20;
/** Maximum instructions between mutation points. */
const MAX_MUTATION_INTERVAL = 50;
/** Number of swaps per mutation. */
const SWAPS_PER_MUTATION = 4;

// --- LCG helpers ---

function lcgNext(state: number): number {
	return (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
}

// --- Mutation state tracking ---

/**
 * Tracks the cumulative handler table mutation state.
 *
 * At compile time, we maintain the current state of the handler table
 * so that subsequent opcodes can be encoded against the post-mutation mapping.
 */
export class MutationState {
	/** Current forward mapping: logical opcode → physical opcode (after mutations). */
	private forwardMap: number[];
	/** Current reverse mapping: physical opcode → logical opcode. */
	private reverseMap: number[];

	constructor(shuffleMap: number[]) {
		// shuffleMap[logical] = physical
		this.forwardMap = [...shuffleMap];
		this.reverseMap = new Array(shuffleMap.length).fill(0);
		for (let i = 0; i < shuffleMap.length; i++) {
			this.reverseMap[shuffleMap[i]!] = i;
		}
	}

	/** Get the current physical opcode for a logical opcode. */
	getPhysical(logical: number): number {
		return this.forwardMap[logical] ?? logical;
	}

	/** Apply a mutation (same algorithm as runtime). */
	applyMutation(mutSeed: number, tableSize: number): void {
		let seed = mutSeed >>> 0;
		for (let k = 0; k < SWAPS_PER_MUTATION; k++) {
			seed = lcgNext(seed);
			const i = (seed >>> 16) % tableSize;
			seed = lcgNext(seed);
			const j = (seed >>> 16) % tableSize;
			if (i === j) continue;

			// Swap entries in reverse map (which the runtime _ht represents)
			const vi = this.reverseMap[i];
			const vj = this.reverseMap[j];
			if (vi == null || vj == null) continue;
			this.reverseMap[i] = vj;
			this.reverseMap[j] = vi;

			// Update forward map to match
			this.forwardMap[vj] = i;
			this.forwardMap[vi] = j;
		}
	}
}

/**
 * Insert MUTATE instructions into a compiled bytecode unit.
 *
 * Inserts at pseudo-random intervals (20-50 instructions) to break up
 * the instruction stream. Each MUTATE carries a seed operand that
 * determines the specific permutation.
 *
 * @param unit - The bytecode unit to modify (mutated in-place)
 * @param seed - Per-build seed for deterministic placement
 * @returns Array of mutation seeds in order (for runtime verification)
 */
export function insertMutationOpcodes(
	unit: BytecodeUnit,
	seed: number
): number[] {
	const instrs = unit.instructions;
	if (instrs.length < MIN_MUTATION_INTERVAL * 2) return [];

	let state = (seed ^ GOLDEN_RATIO_PRIME) >>> 0;
	const mutationSeeds: number[] = [];
	const newInstrs: Instruction[] = [];
	let nextMutation = 0;

	// Determine first mutation point
	state = lcgNext(state);
	nextMutation =
		MIN_MUTATION_INTERVAL +
		((state >>> 16) % (MAX_MUTATION_INTERVAL - MIN_MUTATION_INTERVAL + 1));

	let instrCount = 0;
	for (let ip = 0; ip < instrs.length; ip++) {
		// Insert mutation before this instruction if interval reached
		if (instrCount >= nextMutation && ip > 0) {
			// Generate mutation seed
			state = lcgNext(state);
			const mutSeed = state >>> 0;
			mutationSeeds.push(mutSeed);

			newInstrs.push({ opcode: Op.MUTATE, operand: mutSeed });

			// Reset counter and pick next interval
			instrCount = 0;
			state = lcgNext(state);
			nextMutation =
				MIN_MUTATION_INTERVAL +
				((state >>> 16) %
					(MAX_MUTATION_INTERVAL - MIN_MUTATION_INTERVAL + 1));
		}

		newInstrs.push(instrs[ip]!);
		instrCount++;
	}

	// Update unit instructions (jump targets need patching)
	if (mutationSeeds.length > 0) {
		// Build IP remapping: old IP → new IP (accounting for inserted MUTATEs)
		const ipMap = new Map<number, number>();
		let mutIdx = 0;
		let newIp = 0;
		let count = 0;
		let nextMut2 = 0;

		// Recompute insertion points to build the map
		let st2 = (seed ^ GOLDEN_RATIO_PRIME) >>> 0;
		st2 = lcgNext(st2);
		nextMut2 =
			MIN_MUTATION_INTERVAL +
			((st2 >>> 16) %
				(MAX_MUTATION_INTERVAL - MIN_MUTATION_INTERVAL + 1));

		for (let oldIp = 0; oldIp < instrs.length; oldIp++) {
			if (count >= nextMut2 && oldIp > 0) {
				newIp++; // Skip the MUTATE instruction
				count = 0;
				st2 = lcgNext(st2); // mutSeed
				st2 = lcgNext(st2); // next interval
				nextMut2 =
					MIN_MUTATION_INTERVAL +
					((st2 >>> 16) %
						(MAX_MUTATION_INTERVAL - MIN_MUTATION_INTERVAL + 1));
			}
			ipMap.set(oldIp, newIp);
			newIp++;
			count++;
		}

		// Patch jump targets in new instructions
		// We need to import JUMP_OPS etc. — defer to the caller for patching
		unit.instructions = newInstrs;

		// Patch jump table
		const newJumpTable: Record<number, number> = {};
		for (const [label, ip] of Object.entries(unit.jumpTable)) {
			const newTarget = ipMap.get(ip);
			newJumpTable[Number(label)] = newTarget ?? ip;
		}
		unit.jumpTable = newJumpTable;

		// Patch exception table
		unit.exceptionTable = unit.exceptionTable.map((entry) => ({
			startIp: ipMap.get(entry.startIp) ?? entry.startIp,
			endIp: ipMap.get(entry.endIp) ?? entry.endIp,
			catchIp:
				entry.catchIp >= 0
					? ipMap.get(entry.catchIp) ?? entry.catchIp
					: entry.catchIp,
			finallyIp:
				entry.finallyIp >= 0
					? ipMap.get(entry.finallyIp) ?? entry.finallyIp
					: entry.finallyIp,
		}));
	}

	// NOTE: Do NOT recursively process child units. Child units (closures,
	// inner functions) share the parent's handler table `_ht` at runtime.
	// Mutations in the parent change the table state before the child runs,
	// but the child's opcodes were encoded against the initial state.
	// Only root-level units get mutations; child units run with whatever
	// mutation state the parent has established.

	return mutationSeeds;
}

/**
 * Apply mutation state tracking to the encode pass.
 *
 * After inserting MUTATE opcodes but before encoding with the shuffle map,
 * this function walks the instruction stream and adjusts the physical
 * opcode encoding to account for cumulative mutations.
 *
 * @param unit - The bytecode unit with MUTATE instructions inserted
 * @param shuffleMap - The per-build opcode shuffle map
 * @param tableSize - Handler table size (for modular swap indices)
 */
export function adjustEncodingForMutations(
	unit: BytecodeUnit,
	shuffleMap: number[],
	tableSize: number
): void {
	const state = new MutationState(shuffleMap);

	for (const instr of unit.instructions) {
		if (instr.opcode === Op.MUTATE) {
			// The MUTATE opcode itself is encoded with the pre-mutation map
			instr.opcode = state.getPhysical(Op.MUTATE);
			// Apply the mutation for subsequent opcodes
			state.applyMutation(instr.operand, tableSize);
		} else {
			// Encode with the current (post-mutation) map
			instr.opcode = state.getPhysical(instr.opcode);
		}
	}

	// Child units use the plain shuffle map — no mutation adjustment needed
	// (they don't contain MUTATE instructions and share the parent's _ht)
}
