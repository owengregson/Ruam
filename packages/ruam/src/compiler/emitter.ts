/**
 * Bytecode emitter and constant pool manager.
 *
 * The {@link Emitter} accumulates instructions and constants during
 * compilation.  It also provides helpers for jump-patching and
 * de-duplication of constant pool entries.
 *
 * @module compiler/emitter
 */

import type { Instruction, ConstantPoolEntry } from "../types.js";

/**
 * Bytecode emitter — the write side of compilation.
 *
 * Usage:
 * ```ts
 * const em = new Emitter();
 * const idx = em.addStringConstant("hello");
 * em.emit(Op.PUSH_CONST, idx);
 * ```
 */
export class Emitter {
  /** Accumulated instruction stream. */
  readonly instructions: Instruction[] = [];

  /** Accumulated constant pool. */
  readonly constants: ConstantPoolEntry[] = [];

  /** Map from serialised constant key → pool index (for de-duplication). */
  private readonly constantMap = new Map<string, number>();

  /** Current instruction pointer (= number of emitted instructions). */
  get ip(): number {
    return this.instructions.length;
  }

  // -----------------------------------------------------------------------
  // Instruction emission
  // -----------------------------------------------------------------------

  /** Emit an instruction and return its index. */
  emit(opcode: number, operand: number = 0): number {
    const idx = this.instructions.length;
    this.instructions.push({ opcode, operand });
    return idx;
  }

  /** Patch a previously-emitted jump instruction's target. */
  patchJump(instrIndex: number, target: number): void {
    this.instructions[instrIndex]!.operand = target;
  }

  /** Patch an arbitrary operand on a previously-emitted instruction. */
  patchOperand(instrIndex: number, operand: number): void {
    this.instructions[instrIndex]!.operand = operand;
  }

  // -----------------------------------------------------------------------
  // Constant pool helpers
  // -----------------------------------------------------------------------

  /** Add an entry to the constant pool, de-duplicating by value. */
  addConstant(entry: ConstantPoolEntry): number {
    const key = constantKey(entry);
    const existing = this.constantMap.get(key);
    if (existing !== undefined) return existing;
    const idx = this.constants.length;
    this.constants.push(entry);
    this.constantMap.set(key, idx);
    return idx;
  }

  addStringConstant(value: string): number {
    return this.addConstant({ type: "string", value });
  }

  addNumberConstant(value: number): number {
    return this.addConstant({ type: "number", value });
  }

  addBooleanConstant(value: boolean): number {
    return this.addConstant({ type: "boolean", value });
  }

  addNullConstant(): number {
    return this.addConstant({ type: "null", value: null });
  }

  addUndefinedConstant(): number {
    return this.addConstant({ type: "undefined", value: undefined });
  }

  addRegexConstant(pattern: string, flags: string): number {
    return this.addConstant({ type: "regex", value: { pattern, flags } });
  }

  addBigIntConstant(value: string): number {
    return this.addConstant({ type: "bigint", value });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Produce a unique string key for a constant pool entry (for de-dup). */
function constantKey(entry: ConstantPoolEntry): string {
  if (entry.type === "regex") {
    const v = entry.value as { pattern: string; flags: string };
    return `regex:${v.pattern}:${v.flags}`;
  }
  return `${entry.type}:${String(entry.value)}`;
}
