/**
 * Compiler-internal types shared by canonical semantic IR and its lowering
 * stages.
 *
 * Public configuration remains in `src/types.ts`.  During the Isogloss
 * migration the constant-pool type is aliased from that module so existing VM
 * consumers remain source-compatible; ownership can move here at cutover
 * without changing canonical-IR callers.
 *
 * @module compiler/types
 */

import type {
	BytecodeUnit,
	ConstantPoolEntry as PublicConstantPoolEntry,
	ExceptionEntry,
	Instruction,
} from "../types.js";

/** Literal data referenced by canonical semantic instructions. */
export type ConstantPoolEntry = PublicConstantPoolEntry;

/** Opaque identity shared by every semantic unit in one protected root. */
export type RootGroupId = string;

/** Opaque identity of a compiled semantic unit. */
export type SemanticUnitId = string;

/**
 * Function-level facts that are independent of the eventual execution
 * representation.
 *
 * These fields intentionally mirror the semantic subset of the current
 * `BytecodeUnit`, providing a structurally compatible migration target while
 * excluding bytecode instructions, instruction-pointer tables, and physical
 * encoding details.
 */
export interface SemanticFunctionMetadata {
	/** Number of declared parameters. */
	paramCount: number;
	/** Total registers allocated by compiler analysis. */
	registerCount: number;
	/** Number of indexed scope slots used by the function. */
	slotCount: number;
	/** Whether the source function had a strict-mode directive. */
	isStrict: boolean;
	/** Whether the source function is a generator. */
	isGenerator: boolean;
	/** Whether the source function is async. */
	isAsync: boolean;
	/** Whether the source function is an arrow function. */
	isArrow: boolean;
	/** Whether the per-call scope object may be elided. */
	scopeless: boolean;
	/** Whether exception-completion state is required. */
	usesExceptions: boolean;
	/** Whether `this`, `new.target`, or `super` context is required. */
	usesThisContext: boolean;
	/** Constant-pool index of the function name, or `-1` when anonymous. */
	nameConstIndex: number;
	/** Names captured from outer lexical scopes. */
	outerNames: string[];
}

/** Minimum identity contract for a unit participating in a root group. */
export interface RootGroupCompatible {
	id: SemanticUnitId;
	rootGroupId: RootGroupId;
}

/**
 * Temporary aliases used only by migration adapters.
 *
 * New semantic and Isogloss modules should depend on the canonical types
 * instead.  Keeping the aliases here prevents new code from reaching into the
 * public API module for legacy bytecode structures.
 */
export type LegacyInstruction = Instruction;
export type LegacyExceptionEntry = ExceptionEntry;
export type LegacyBytecodeUnit = BytecodeUnit;
