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
import type { SourceOrigin, SourceOriginId } from "./ir.js";

const UNKNOWN_SOURCE_ORIGIN: SourceOrigin = Object.freeze({
	start: 0,
	end: 0,
	line: 1,
	column: 0,
});

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

	/**
	 * Deduplicated source locations referenced by
	 * {@link instructionOriginIds}. This metadata is deliberately parallel to
	 * the legacy instruction array so adding it cannot change bytecode output.
	 */
	readonly origins: SourceOrigin[] = [];

	/** Source-origin index recorded at the moment each instruction is emitted. */
	readonly instructionOriginIds: SourceOriginId[] = [];

	/** Map from serialised constant key → pool index (for de-duplication). */
	private readonly constantMap = new Map<string, number>();

	/** Map from a stable source-location key → origin table index. */
	private readonly originMap = new Map<string, SourceOriginId>();

	/** Origin inherited by emit calls in the current lexical compilation span. */
	private currentOriginId: SourceOriginId;

	constructor(defaultOrigin: SourceOrigin = UNKNOWN_SOURCE_ORIGIN) {
		this.currentOriginId = this.addOrigin(defaultOrigin);
	}

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
		this.instructionOriginIds.push(this.currentOriginId);
		return idx;
	}

	/**
	 * Associate every instruction emitted by `emitWithin` with `origin`.
	 *
	 * The previous origin is restored even when a visitor throws, and nested
	 * spans behave like a lexical stack. Visitors can adopt this incrementally:
	 * instructions emitted outside a span retain the emitter's default origin.
	 */
	withOrigin<T>(origin: SourceOrigin | null | undefined, emitWithin: () => T): T {
		if (!origin) return emitWithin();
		const previousOriginId = this.currentOriginId;
		this.currentOriginId = this.addOrigin(origin);
		try {
			return emitWithin();
		} finally {
			this.currentOriginId = previousOriginId;
		}
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

	private addOrigin(origin: SourceOrigin): SourceOriginId {
		const normalized = normalizeOrigin(origin);
		const key = originKey(normalized);
		const existing = this.originMap.get(key);
		if (existing !== undefined) return existing;
		const id = this.origins.length;
		this.origins.push(Object.freeze(normalized));
		this.originMap.set(key, id);
		return id;
	}
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Produce a unique string key for a constant pool entry (for de-dup). */
function constantKey(entry: ConstantPoolEntry): string {
	if (entry.type === "regex") {
		return `regex:${entry.value.pattern}:${entry.value.flags}`;
	}
	return `${entry.type}:${String(entry.value)}`;
}

function normalizeOrigin(origin: SourceOrigin): SourceOrigin {
	const start = Number.isSafeInteger(origin.start) && origin.start >= 0
		? origin.start
		: 0;
	const end = Number.isSafeInteger(origin.end) && origin.end >= start
		? origin.end
		: start;
	const line = Number.isSafeInteger(origin.line) && origin.line >= 1
		? origin.line
		: 1;
	const column = Number.isSafeInteger(origin.column) && origin.column >= 0
		? origin.column
		: 0;
	return origin.file
		? { file: origin.file, start, end, line, column }
		: { start, end, line, column };
}

function originKey(origin: SourceOrigin): string {
	return [
		origin.file ?? "",
		origin.start,
		origin.end,
		origin.line,
		origin.column,
	].join(":");
}
