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
import { Op, OPCODE_COUNT, ALL_JUMP_OPS, PACKED_JUMP_OPS } from "./opcodes.js";
import { GOLDEN_RATIO_PRIME } from "../constants.js";
import { lcgNext } from "../naming/scope.js";

// --- Constants ---

/** Minimum instructions between mutation points. */
const MIN_MUTATION_INTERVAL = 20;
/** Maximum instructions between mutation points. */
const MAX_MUTATION_INTERVAL = 50;
/** Number of swaps per mutation. */
const SWAPS_PER_MUTATION = 4;

/**
 * Opcodes that unconditionally transfer control, so the instruction lexically
 * following them is NOT reached by fall-through. A MUTATE inserted before such
 * a successor would never execute via the straight-line path — it is only
 * reachable (if at all) by a jump that lands *after* the inserted MUTATE, or it
 * is dead code. Either way the runtime mutation state desyncs from the linear
 * build-time encoding. (TABLE_SWITCH/LOOKUP_SWITCH are reserved/unused today but
 * are unconditional transfers at runtime, so they are listed for safety.)
 */
const UNCONDITIONAL_TRANSFER_OPS = new Set<number>([
	Op.JMP,
	Op.RETURN,
	Op.RETURN_VOID,
	Op.THROW,
	Op.RETHROW,
	Op.TABLE_SWITCH,
	Op.LOOKUP_SWITCH,
]);

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

// --- Loop detection ---

/**
 * Build the set of IPs that are UNSAFE for a MUTATE.
 *
 * `adjustEncodingForMutations` encodes instructions in a single LINEAR pass,
 * assuming every MUTATE executes exactly once, in lexical order, before any
 * instruction lexically after it. A MUTATE only honours that assumption when it
 * sits on a point reached exactly once on every execution path. Two control-flow
 * shapes violate it and so must be excluded:
 *
 *  - **Backward-jump (loop) spans** `[target, jumpIp]`: a MUTATE inside a loop
 *    body executes on every iteration, diverging from the single-execution model.
 *  - **Forward-jump spans** `[jumpIp+1, target]`: instructions skipped when a
 *    forward branch is taken (if/else arms, switch cases) — and, crucially, the
 *    body of a `try` (an exception edge jumps from anywhere in the try body to
 *    the catch/finally target packed in `TRY_PUSH`). A MUTATE there is reached
 *    only on some paths, so the runtime mutation state desyncs from the encoding.
 *    The span is **target-inclusive**: a forward branch *lands on* its target,
 *    and an inserted MUTATE precedes the original instruction at that IP, so the
 *    landing edge is remapped to *after* the MUTATE (the loader inserts the
 *    MUTATE before the target's instruction). The branch-taken path therefore
 *    bypasses the MUTATE while the fall-through path runs it — exactly the
 *    desync the linear encoding cannot represent. So the target itself is unsafe.
 *  - **Jump-only / dead successors**: an IP whose lexical predecessor is an
 *    unconditional transfer (`JMP`/`RETURN`/`THROW`/…) has no fall-through edge.
 *    A MUTATE placed before it never runs on the straight-line path — control
 *    only arrives via a jump (which lands after the MUTATE) or never (dead
 *    code) — so build-time counts a mutation the runtime never applies.
 *
 * Excluding all of these leaves only straight-line, fall-through-reached
 * positions whose mutation is crossed exactly once — correctness over mutation
 * density (heavily-branched units may receive no MUTATEs, which is fine).
 */
function findUnsafeMutationIPs(
	instrs: readonly Instruction[],
	jumpTable: Record<number, number>
): Set<number> {
	const unsafe = new Set<number>();
	const mark = (a: number, b: number): void => {
		const lo = Math.max(0, a);
		const hi = Math.min(instrs.length - 1, b);
		for (let j = lo; j <= hi; j++) unsafe.add(j);
	};

	// An IP with no fall-through predecessor is reachable only via a jump (which
	// lands *after* an inserted MUTATE) or not at all. Either way a MUTATE there
	// would not be crossed exactly-once on the linear path. Mark all such IPs.
	for (let ip = 1; ip < instrs.length; ip++) {
		if (UNCONDITIONAL_TRANSFER_OPS.has(instrs[ip - 1]!.opcode)) {
			unsafe.add(ip);
		}
	}

	// Exception handling is reached via RUNTIME control edges (the exec loop's
	// catch routes `IP = _h._ci*2 / _h._fi*2`, and RETURN/RETHROW defer through
	// the finally) that are invisible to instruction-stream jump analysis. A
	// catch/finally body — and anything after it, since finally-resumption can
	// re-route — is reachable in non-linear order, so once a unit enters any
	// try region the linear single-pass mutation encoding no longer holds.
	// Conservatively exclude everything from the first TRY_PUSH to the end; only
	// the straight-line prologue before any try can safely carry a MUTATE.
	let firstTry = -1;
	for (let ip = 0; ip < instrs.length; ip++) {
		if (instrs[ip]!.opcode === Op.TRY_PUSH) {
			firstTry = ip;
			break;
		}
	}
	if (firstTry >= 0) mark(firstTry, instrs.length - 1);

	for (let ip = 0; ip < instrs.length; ip++) {
		const instr = instrs[ip]!;
		const targets: number[] = [];

		if (ALL_JUMP_OPS.has(instr.opcode)) {
			targets.push(jumpTable[instr.operand] ?? instr.operand);
		} else if (PACKED_JUMP_OPS.has(instr.opcode)) {
			// Upper 16 bits: catch IP (TRY_PUSH) or jump target (REG_*_JF).
			const hi = (instr.operand >>> 16) & 0xffff;
			if (hi !== 0xffff) targets.push(jumpTable[hi] ?? hi);
			// TRY_PUSH packs a SECOND forward target (finally IP) in the low bits.
			if (instr.opcode === Op.TRY_PUSH) {
				const lo = instr.operand & 0xffff;
				if (lo !== 0xffff) targets.push(jumpTable[lo] ?? lo);
			}
		}

		for (const t of targets) {
			if (t === 0xffff) continue; // "no target" sentinel
			if (t <= ip) {
				mark(t, ip); // backward jump → loop body (target inclusive)
			} else {
				// Forward jump → conditionally-skipped region, TARGET INCLUSIVE.
				// The target is the branch's landing point; a MUTATE inserted
				// before it is bypassed by the branch-taken path but run by the
				// fall-through path, so it cannot sit at the target either.
				mark(ip + 1, t);
			}
		}
	}

	return unsafe;
}

/**
 * Insert MUTATE instructions into a compiled bytecode unit.
 *
 * Inserts at pseudo-random intervals (20-50 instructions) to break up
 * the instruction stream. Each MUTATE carries a seed operand that
 * determines the specific permutation.
 *
 * MUTATE instructions are only inserted at IPs that execute exactly once
 * (outside loop bodies). This is critical because adjustEncodingForMutations
 * assumes each MUTATE executes once; a MUTATE inside a loop would permute
 * the handler table on every iteration, diverging from compile-time state.
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

	// Skip units that have child units (closures, inner functions).
	// Children share the parent's handler table `_ht` at runtime.
	// MUTATEs in the parent permute `_ht`, but children are encoded
	// against the initial shuffleMap — their dispatch would be wrong.
	if (unit.childUnits.length > 0) return [];

	// Identify IPs that are unsafe for a MUTATE — inside loop bodies (backward
	// jumps), conditionally-skipped forward-branch spans, or try bodies. The
	// build-time linear encoding only holds for MUTATEs reached exactly once on
	// every path, so MUTATEs go only at unconditionally-reached positions.
	const unsafeIPs = findUnsafeMutationIPs(instrs, unit.jumpTable);

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
		// AND we're not inside a loop body
		if (instrCount >= nextMutation && ip > 0 && !unsafeIPs.has(ip)) {
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
			// Must mirror the exact insertion condition from above
			if (count >= nextMut2 && oldIp > 0 && !unsafeIPs.has(oldIp)) {
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

		// Patch jump instruction operands (direct IP targets) in new instructions
		for (const instr of newInstrs) {
			if (instr.opcode === Op.MUTATE) continue;
			if (ALL_JUMP_OPS.has(instr.opcode)) {
				const newTarget = ipMap.get(instr.operand);
				if (newTarget !== undefined) {
					instr.operand = newTarget;
				}
			} else if (PACKED_JUMP_OPS.has(instr.opcode)) {
				const lo = instr.operand & 0xffff;
				const hi = (instr.operand >>> 16) & 0xffff;
				const newHi = ipMap.get(hi);
				if (newHi !== undefined) {
					instr.operand = (newHi << 16) | lo;
				}
			}
		}
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
