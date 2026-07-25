/**
 * Compiler-internal types shared by canonical semantic IR and source lowering.
 *
 * These are analysis structures, not a distributable instruction format.
 *
 * @module compiler/types
 */

/** Literal data referenced by canonical semantic instructions. */
export type ConstantPoolEntry =
	| { type: "null"; value: null }
	| { type: "undefined"; value: undefined }
	| { type: "boolean"; value: boolean }
	| { type: "number"; value: number }
	| { type: "string"; value: string }
	| { type: "bigint"; value: string }
	| { type: "regex"; value: { pattern: string; flags: string } };

/** One temporary visitor emission before canonical CFG construction. */
export interface EmittedSemanticInstruction {
	opcode: number;
	operand: number;
}

/** Temporary exception range emitted while lowering one source function. */
export interface SemanticExceptionRange {
	startIp: number;
	endIp: number;
	catchIp: number;
	finallyIp: number;
}

/** Opaque identity shared by every semantic unit in one protected root. */
export type RootGroupId = string;

/** Opaque identity of a compiled semantic unit. */
export type SemanticUnitId = string;

/**
 * Function-level facts that are independent of the eventual execution
 * representation.
 *
 * These fields exclude serialization, physical encoding, and dispatch data.
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
 * Private result used while recursive Babel visitors assemble a root group.
 * It is discarded after canonical semantic IR is frozen.
 */
export interface SemanticCompileUnit extends SemanticFunctionMetadata {
	id: SemanticUnitId;
	constants: ConstantPoolEntry[];
	instructions: EmittedSemanticInstruction[];
	jumpTable: Record<number, number>;
	exceptionTable: SemanticExceptionRange[];
	childUnits: SemanticCompileUnit[];
}
