/**
 * Bytecode optimization passes.
 *
 * Runs after initial compilation to improve instruction density:
 *
 * - **Peephole optimizer** (Tier 2): Constant folding, dead pair elimination,
 *   jump threading, strength reduction.
 * - **Superinstruction fusion** (Tier 3): Fuses common register-based
 *   instruction sequences into single dispatches.
 *
 * @module compiler/optimizer
 */

import type { Instruction, ConstantPoolEntry } from "../types.js";
import {
	Op,
	JUMP_OPS,
	ALL_JUMP_OPS,
	PACKED_JUMP_OPS,
	FOLDABLE_BINOPS,
	PURE_PUSH_OPS,
	REG_BINOP_MAP,
	REG_CONST_BINOP_MAP,
} from "./opcodes.js";
import type { Emitter } from "./emitter.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run all optimization passes on a compiled instruction stream.
 * Modifies the emitter's instructions in place.
 */
export function optimizeInstructions(emitter: Emitter): void {
	let changed = true;
	let passes = 0;
	const maxPasses = 5;

	while (changed && passes < maxPasses) {
		changed = false;
		if (peepholePass(emitter)) changed = true;
		if (superinstructionPass(emitter)) changed = true;
		passes++;
	}

	// Final cleanup: remove NOPs
	removeNops(emitter);
}

// ---------------------------------------------------------------------------
// Peephole Optimizer (Tier 2)
// ---------------------------------------------------------------------------

function peepholePass(emitter: Emitter): boolean {
	const instrs = emitter.instructions;
	const consts = emitter.constants;
	let changed = false;
	const jumpTargets = computeJumpTargets(instrs);

	for (let i = 0; i < instrs.length; i++) {
		const cur = instrs[i]!;

		// --- Dead pair elimination ---

		// DUP + POP → NOP + NOP
		if (
			cur.opcode === Op.DUP &&
			i + 1 < instrs.length &&
			instrs[i + 1]!.opcode === Op.POP
		) {
			if (!jumpTargets.has(i + 1)) {
				cur.opcode = Op.NOP;
				cur.operand = 0;
				instrs[i + 1]!.opcode = Op.NOP;
				instrs[i + 1]!.operand = 0;
				changed = true;
				continue;
			}
		}

		// PUSH_X + POP → NOP + NOP (for side-effect-free pushes)
		if (
			PURE_PUSH_OPS.has(cur.opcode) &&
			i + 1 < instrs.length &&
			instrs[i + 1]!.opcode === Op.POP
		) {
			if (!jumpTargets.has(i + 1)) {
				cur.opcode = Op.NOP;
				cur.operand = 0;
				instrs[i + 1]!.opcode = Op.NOP;
				instrs[i + 1]!.operand = 0;
				changed = true;
				continue;
			}
		}

		// --- Constant folding ---
		// PUSH_CONST(a) + PUSH_CONST(b) + <binop> → PUSH_CONST(result)
		if (cur.opcode === Op.PUSH_CONST && i + 2 < instrs.length) {
			const next = instrs[i + 1]!;
			const binop = instrs[i + 2]!;
			if (
				next.opcode === Op.PUSH_CONST &&
				FOLDABLE_BINOPS.has(binop.opcode)
			) {
				const a = getNumericConst(consts, cur.operand);
				const b = getNumericConst(consts, next.operand);
				if (
					a !== null &&
					b !== null &&
					!jumpTargets.has(i + 1) &&
					!jumpTargets.has(i + 2)
				) {
					const result = foldBinop(binop.opcode, a, b);
					if (result !== null && isFinite(result)) {
						const idx = emitter.addNumberConstant(result);
						cur.opcode = Op.PUSH_CONST;
						cur.operand = idx;
						next.opcode = Op.NOP;
						next.operand = 0;
						binop.opcode = Op.NOP;
						binop.operand = 0;
						changed = true;
						continue;
					}
				}
			}
		}

		// --- Strength reduction ---
		// PUSH_CONST(1) + SUB → DEC (SUB is always numeric, so this is safe)
		// NOTE: We do NOT reduce PUSH_CONST(1) + ADD → INC because ADD does
		// string concatenation ("prop_" + 1 → "prop_1"), while INC is always
		// numeric (+x + 1).
		if (cur.opcode === Op.PUSH_CONST && i + 1 < instrs.length) {
			const next = instrs[i + 1]!;
			const val = getNumericConst(consts, cur.operand);
			if (
				val === 1 &&
				next.opcode === Op.SUB &&
				!jumpTargets.has(i + 1)
			) {
				cur.opcode = Op.NOP;
				cur.operand = 0;
				next.opcode = Op.DEC;
				next.operand = 0;
				changed = true;
				continue;
			}
		}

		// --- Jump threading ---
		// JMP(L) where L points to JMP(L2) → JMP(L2)
		if (JUMP_OPS.has(cur.opcode) && cur.operand >= 0) {
			const targetIdx = cur.operand; // target instruction index
			if (targetIdx < instrs.length) {
				const targetInstr = instrs[targetIdx]!;
				if (
					targetInstr.opcode === Op.JMP &&
					targetInstr.operand !== targetIdx
				) {
					cur.operand = targetInstr.operand;
					changed = true;
					continue;
				}
			}
		}

		// --- Redundant store+load ---
		// STORE_REG(r) + LOAD_REG(r) → DUP + STORE_REG(r)
		if (cur.opcode === Op.STORE_REG && i + 1 < instrs.length) {
			const next = instrs[i + 1]!;
			if (
				next.opcode === Op.LOAD_REG &&
				next.operand === cur.operand &&
				!jumpTargets.has(i + 1)
			) {
				// Reorder: DUP then STORE_REG (saves one instruction's worth of dispatch)
				next.opcode = Op.STORE_REG;
				next.operand = cur.operand;
				cur.opcode = Op.DUP;
				cur.operand = 0;
				changed = true;
				continue;
			}
		}

		// --- JMP to next instruction → NOP ---
		if (cur.opcode === Op.JMP && cur.operand === i + 1) {
			cur.opcode = Op.NOP;
			cur.operand = 0;
			changed = true;
			continue;
		}
	}

	return changed;
}

// ---------------------------------------------------------------------------
// Superinstruction Fusion (Tier 3)
// ---------------------------------------------------------------------------

function superinstructionPass(emitter: Emitter): boolean {
	const instrs = emitter.instructions;
	const consts = emitter.constants;
	let changed = false;
	const jumpTargets = computeJumpTargets(instrs);

	for (let i = 0; i < instrs.length - 1; i++) {
		const a = instrs[i]!;
		const b = instrs[i + 1]!;

		// Guard: don't fuse across jump targets
		if (jumpTargets.has(i + 1)) continue;

		// --- Two-instruction fusions ---

		// LOAD_REG(r) + GET_PROP_STATIC(name) → REG_GET_PROP(r | name<<16)
		if (a.opcode === Op.LOAD_REG && b.opcode === Op.GET_PROP_STATIC) {
			const r = a.operand;
			const name = b.operand;
			if (r <= 0xffff && name <= 0xffff) {
				a.opcode = Op.REG_GET_PROP;
				a.operand = (r & 0xffff) | ((name & 0xffff) << 16);
				b.opcode = Op.NOP;
				b.operand = 0;
				changed = true;
				continue;
			}
		}

		if (i + 2 >= instrs.length) continue;
		const c = instrs[i + 2]!;
		if (jumpTargets.has(i + 2)) continue;

		// --- Three-instruction fusions ---

		// LOAD_REG(a) + LOAD_REG(b) + <binop> → REG_<binop>(a | b<<16)
		if (a.opcode === Op.LOAD_REG && b.opcode === Op.LOAD_REG) {
			const ra = a.operand;
			const rb = b.operand;
			if (ra <= 0xffff && rb <= 0xffff) {
				const superOp = REG_BINOP_MAP.get(c.opcode);
				if (superOp != null) {
					a.opcode = superOp;
					a.operand = (ra & 0xffff) | ((rb & 0xffff) << 16);
					b.opcode = Op.NOP;
					b.operand = 0;
					c.opcode = Op.NOP;
					c.operand = 0;
					changed = true;
					continue;
				}
			}
		}

		// LOAD_REG(r) + PUSH_CONST(c) + <binop> → REG_CONST_<binop>(r | c<<16)
		if (a.opcode === Op.LOAD_REG && b.opcode === Op.PUSH_CONST) {
			const r = a.operand;
			const ci = b.operand;
			if (r <= 0xffff && ci <= 0xffff) {
				const superOp = REG_CONST_BINOP_MAP.get(c.opcode);
				if (superOp != null) {
					a.opcode = superOp;
					a.operand = (r & 0xffff) | ((ci & 0xffff) << 16);
					b.opcode = Op.NOP;
					b.operand = 0;
					c.opcode = Op.NOP;
					c.operand = 0;
					changed = true;
					continue;
				}
			}
		}

		if (i + 3 >= instrs.length) continue;
		const d = instrs[i + 3]!;
		if (jumpTargets.has(i + 3)) continue;

		// --- Four-instruction fusions ---

		// LOAD_REG(r) + PUSH_CONST(c) + LT + JMP_FALSE(target) → REG_LT_CONST_JF
		if (
			a.opcode === Op.LOAD_REG &&
			b.opcode === Op.PUSH_CONST &&
			c.opcode === Op.LT &&
			d.opcode === Op.JMP_FALSE
		) {
			const r = a.operand;
			const constIdx = b.operand;
			const target = d.operand;
			if (r <= 0xff && constIdx <= 0xff) {
				a.opcode = Op.REG_LT_CONST_JF;
				a.operand =
					(r & 0xff) |
					((constIdx & 0xff) << 8) |
					((target & 0xffff) << 16);
				b.opcode = Op.NOP;
				b.operand = 0;
				c.opcode = Op.NOP;
				c.operand = 0;
				d.opcode = Op.NOP;
				d.operand = 0;
				changed = true;
				continue;
			}
		}

		// LOAD_REG(a) + LOAD_REG(b) + LT + JMP_FALSE(target) → REG_LT_REG_JF
		if (
			a.opcode === Op.LOAD_REG &&
			b.opcode === Op.LOAD_REG &&
			c.opcode === Op.LT &&
			d.opcode === Op.JMP_FALSE
		) {
			const ra = a.operand;
			const rb = b.operand;
			const target = d.operand;
			if (ra <= 0xff && rb <= 0xff) {
				a.opcode = Op.REG_LT_REG_JF;
				a.operand =
					(ra & 0xff) |
					((rb & 0xff) << 8) |
					((target & 0xffff) << 16);
				b.opcode = Op.NOP;
				b.operand = 0;
				c.opcode = Op.NOP;
				c.operand = 0;
				d.opcode = Op.NOP;
				d.operand = 0;
				changed = true;
				continue;
			}
		}

		// LOAD_REG(r) + PUSH_CONST(c) + ADD + STORE_REG(r) → REG_ADD_CONST
		if (
			a.opcode === Op.LOAD_REG &&
			b.opcode === Op.PUSH_CONST &&
			c.opcode === Op.ADD &&
			d.opcode === Op.STORE_REG &&
			d.operand === a.operand
		) {
			const r = a.operand;
			const constIdx = b.operand;
			if (r <= 0xffff && constIdx <= 0xffff) {
				a.opcode = Op.REG_ADD_CONST;
				a.operand = (r & 0xffff) | ((constIdx & 0xffff) << 16);
				b.opcode = Op.NOP;
				b.operand = 0;
				c.opcode = Op.NOP;
				c.operand = 0;
				d.opcode = Op.NOP;
				d.operand = 0;
				changed = true;
				continue;
			}
		}
	}

	return changed;
}

// ---------------------------------------------------------------------------
// NOP removal + jump retargeting
// ---------------------------------------------------------------------------

function removeNops(emitter: Emitter): void {
	const instrs = emitter.instructions;
	const nopCount = instrs.filter((i) => i.opcode === Op.NOP).length;
	if (nopCount === 0) return;

	// Build a mapping from old index to new index
	const indexMap = new Array<number>(instrs.length);
	let newIdx = 0;
	for (let i = 0; i < instrs.length; i++) {
		indexMap[i] = newIdx;
		if (instrs[i]!.opcode !== Op.NOP) newIdx++;
	}

	// Retarget all jumps
	for (const instr of instrs) {
		// Simple jumps: operand is a direct IP target
		if (ALL_JUMP_OPS.has(instr.opcode)) {
			if (instr.operand >= 0 && instr.operand < instrs.length) {
				instr.operand = indexMap[instr.operand]!;
			}
		}
		// Packed jumps: target(s) encoded in upper/lower bits
		if (instr.opcode === Op.TRY_PUSH) {
			let catchIp = (instr.operand >> 16) & 0xffff;
			let finallyIp = instr.operand & 0xffff;
			if (catchIp !== 0xffff && catchIp < instrs.length)
				catchIp = indexMap[catchIp]!;
			if (finallyIp !== 0xffff && finallyIp < instrs.length)
				finallyIp = indexMap[finallyIp]!;
			instr.operand = ((catchIp & 0xffff) << 16) | (finallyIp & 0xffff);
		} else if (
			instr.opcode === Op.REG_LT_CONST_JF ||
			instr.opcode === Op.REG_LT_REG_JF
		) {
			const low = instr.operand & 0xffff;
			let target = (instr.operand >>> 16) & 0xffff;
			if (target < instrs.length) target = indexMap[target]!;
			instr.operand = low | ((target & 0xffff) << 16);
		}
	}

	// Remove NOPs
	const filtered = instrs.filter((i) => i.opcode !== Op.NOP);
	instrs.length = 0;
	for (const instr of filtered) instrs.push(instr);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Evaluate a foldable binary opcode on two numeric constants. */
function foldBinop(op: Op, a: number, b: number): number | null {
	const fn = FOLDABLE_BINOPS.get(op);
	return fn ? fn(a, b) : null;
}

function getNumericConst(
	consts: ConstantPoolEntry[],
	idx: number
): number | null {
	const c = consts[idx];
	if (!c) return null;
	if (c.type === "number") return c.value;
	return null;
}

/**
 * Pre-compute the set of all instruction indices that are jump targets.
 * This replaces the O(n) per-query isJumpTarget scan with O(1) lookups.
 */
function computeJumpTargets(instrs: Instruction[]): Set<number> {
	const targets = new Set<number>();
	for (const instr of instrs) {
		if (ALL_JUMP_OPS.has(instr.opcode)) {
			if (instr.operand >= 0) targets.add(instr.operand);
		}
		if (PACKED_JUMP_OPS.has(instr.opcode)) {
			const upper = (instr.operand >>> 16) & 0xffff;
			const lower = instr.operand & 0xffff;
			if (upper !== 0xffff) targets.add(upper);
			if (instr.opcode === Op.TRY_PUSH && lower !== 0xffff)
				targets.add(lower);
		}
	}
	return targets;
}
