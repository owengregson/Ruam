/**
 * Main bytecode compiler entry point.
 *
 * {@link compileFunction} is the public API — it takes a Babel
 * `NodePath<Function>` and produces a {@link BytecodeUnit} (plus any
 * child units for nested functions).
 *
 * @module compiler
 */

import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import { Emitter } from "./emitter.js";
import { ScopeAnalyzer } from "./scope.js";
import { Op } from "./opcodes.js";
import { compileExpression } from "./visitors/expressions.js";
import {
	compileBody,
	compileDestructuringPattern,
	type LoopContext,
} from "./visitors/statements.js";
import { compileClassExpr } from "./visitors/classes.js";
import type { BytecodeUnit } from "../types.js";
import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";
import {
	analyzeCapturedVars,
	type CaptureAnalysisResult,
} from "./capture-analysis.js";
import { optimizeInstructions } from "./optimizer.js";

// ---------------------------------------------------------------------------
// Scope-object elision
// ---------------------------------------------------------------------------

/**
 * Opcodes that make a unit NON-elidable for per-call scope-object elision.
 *
 * Ruam's scope chain is prototypal: each call normally does
 * `SC = Object.create(OS)` and scoped variables become own properties on `SC`.
 * A unit only needs its own `SC` layer if at runtime it can:
 *
 *  - **add an own property to `SC`** — variable/function/class declarations
 *    (`DECLARE_VAR/LET/CONST`) and a named catch binding (`CATCH_BIND` writes
 *    `SC[name]`); or
 *  - **reassign `SC`** to a fresh child / parent — `PUSH_SCOPE`,
 *    `PUSH_BLOCK_SCOPE`, `PUSH_CATCH_SCOPE`, `PUSH_WITH_SCOPE`, `POP_SCOPE`; or
 *  - **capture `SC`** into a closure as the child's outer scope — every
 *    closure/function-creating opcode forwards `SC`.
 *
 * Opcodes that only READ free variables up the chain, ASSIGN to existing or
 * global bindings, or modify a found binding in place (`LOAD_SCOPED`,
 * `STORE_SCOPED`, `TYPEOF_GLOBAL`, `LOAD/STORE_GLOBAL`, the compound
 * `*_SCOPED` ops, `PUSH/STORE_CLOSURE_VAR`, etc.) never create a property on
 * `SC`, so they are SAFE and absent from this set — for those, `SC = OS` is
 * observationally identical.
 *
 * This set is intentionally CONSERVATIVE: it also lists `TDZ_MARK` and
 * `DELETE_SCOPED` (which only ever co-occur with declarations) and the
 * currently-unused Tier-4 indexed-scope opcodes, because including a safe
 * opcode here can only suppress an elision — never cause incorrectness.  The
 * optimizer never fuses or rewrites any of these opcodes into a different
 * opcode, so scanning the final (post-optimization) logical instruction
 * stream is exact.
 */
const SCOPE_DEPENDENT_OPS: ReadonlySet<Op> = new Set<Op>([
	// Add an own property to the current scope object.
	Op.DECLARE_VAR,
	Op.DECLARE_LET,
	Op.DECLARE_CONST,
	Op.CATCH_BIND,
	// Reassign the scope to a child (push) or parent (pop).
	Op.PUSH_SCOPE,
	Op.PUSH_BLOCK_SCOPE,
	Op.PUSH_CATCH_SCOPE,
	Op.PUSH_WITH_SCOPE,
	Op.POP_SCOPE,
	// Conservative: only emitted alongside declarations, but listed anyway.
	Op.TDZ_MARK,
	Op.DELETE_SCOPED,
	// Capture the scope into a closure (forwarded as the child's outer scope).
	Op.NEW_CLOSURE,
	Op.NEW_FUNCTION,
	Op.NEW_ARROW,
	Op.NEW_ASYNC,
	Op.NEW_GENERATOR,
	Op.NEW_ASYNC_GENERATOR,
	// Tier-4 indexed scope (currently never emitted; future-proof — any use of
	// an indexed scope frame makes the unit non-elidable).
	Op.LOAD_SLOT,
	Op.STORE_SLOT,
	Op.DECLARE_SLOT,
	Op.INC_SLOT,
	Op.DEC_SLOT,
	Op.POST_INC_SLOT,
	Op.POST_DEC_SLOT,
	Op.ADD_ASSIGN_SLOT,
	Op.SUB_ASSIGN_SLOT,
	Op.MUL_ASSIGN_SLOT,
	Op.PUSH_INDEXED_SCOPE,
	Op.POP_INDEXED_SCOPE,
]);

/**
 * Determine whether a unit's per-call scope object can be elided (`SC = OS`).
 *
 * @param instructions - The unit's FINAL (post-optimization) logical instructions.
 * @param hasDynamicScope - Whether the source used `eval`/`with` (forces a real scope).
 * @returns `true` when no scope-dependent opcode is present and scope is static.
 */
function computeScopeless(
	instructions: { opcode: number }[],
	hasDynamicScope: boolean
): boolean {
	if (hasDynamicScope) return false;
	for (const ins of instructions) {
		if (SCOPE_DEPENDENT_OPS.has(ins.opcode as Op)) return false;
	}
	return true;
}

// ---------------------------------------------------------------------------
// Unit ID generation
// ---------------------------------------------------------------------------

let unitIdState = 0;
const unitIdSet = new Set<string>();

/** Reset the unit ID generator (call before each file compilation). */
export function resetUnitCounter(seed?: number): void {
	unitIdState = (seed ?? 0) >>> 0;
	unitIdSet.clear();
}

/**
 * Generate the next unique bytecode unit ID.
 * Uses a seeded LCG to produce random-looking alphanumeric IDs
 * (e.g. `"k7m2"`, `"x9fp"`) instead of sequential `u_NNNN`.
 */
function genUnitId(): string {
	for (;;) {
		unitIdState = (unitIdState * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
		const id = (unitIdState >>> 0).toString(36).slice(0, 5);
		if (id.length >= 3 && !unitIdSet.has(id)) {
			unitIdSet.add(id);
			return id;
		}
	}
}

// ---------------------------------------------------------------------------
// CompileContext — shared interface for recursive compilation
// ---------------------------------------------------------------------------

/**
 * Context object threaded through compilation visitors.
 *
 * Provides callbacks that visitors use to compile nested constructs
 * (functions, classes, destructuring) without circular imports.
 */
export interface CompileContext {
	compileNestedFunction(
		fnPath: NodePath<t.Function>,
		emitter: Emitter,
		parentScope: ScopeAnalyzer
	): void;
	compileClassExpression(
		classPath: NodePath<t.ClassExpression>,
		emitter: Emitter,
		parentScope: ScopeAnalyzer
	): void;
	compileDestructuring(
		pattern: NodePath<t.LVal>,
		emitter: Emitter,
		scope: ScopeAnalyzer
	): void;
	/** Register promotion map: variable name → register index. Only set for non-captured locals. */
	registerMap: Map<string, number>;
	/** Captured variable → indexed scope slot index. Only set for captured locals. */
	slotMap: Map<string, number>;
	/** Block nesting depth (0 = function body top level). Used to prevent let/const shadowing bugs. */
	blockDepth: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compile a single top-level function into a bytecode unit.
 *
 * Nested functions / classes are recursively compiled into child units
 * that are attached to the returned unit's {@link BytecodeUnit.childUnits}.
 */
export function compileFunction(fnPath: NodePath<t.Function>): BytecodeUnit {
	const allUnits: BytecodeUnit[] = [];
	const unit = compileFunctionInner(fnPath, allUnits);
	unit.childUnits = allUnits;
	return unit;
}

// ---------------------------------------------------------------------------
// Core compilation logic
// ---------------------------------------------------------------------------

/**
 * Inner function compiler — produces a single BytecodeUnit.
 *
 * Called both for top-level functions and recursively for nested
 * functions/closures.
 */
function compileFunctionInner(
	fnPath: NodePath<t.Function>,
	allUnits: BytecodeUnit[]
): BytecodeUnit {
	const node = fnPath.node;
	const params = fnPath.get("params") as NodePath<t.LVal>[];
	const paramCount = params.length;

	const emitter = new Emitter();
	const scope = new ScopeAnalyzer(0);

	const isStrict = detectStrict(fnPath);
	const isGenerator = !!node.generator;
	const isAsync = !!node.async;
	const isArrow = node.type === "ArrowFunctionExpression";

	// Record the function's name in the constant pool (for stack traces)
	let nameConstIndex = -1;
	if (
		node.type === "FunctionDeclaration" ||
		node.type === "FunctionExpression"
	) {
		if (node.id?.name) {
			nameConstIndex = emitter.addStringConstant(node.id.name);
		}
	}

	// -- Capture analysis (Tier 1) ------------------------------------------
	const captureResult = analyzeCapturedVars(fnPath);
	const registerMap = new Map<string, number>();
	const slotMap = new Map<string, number>();

	// Assign registers to promotable (non-captured) variables
	for (const name of captureResult.promotableNames) {
		registerMap.set(name, scope.registerAllocator.alloc());
	}

	// Note: Tier 4 (indexed scope slots) was evaluated and reverted — the
	// slotMap is kept empty.  Captured variables use the normal scope chain
	// (LOAD_SCOPED / STORE_SCOPED) which inner closures also walk, so indexed
	// slots provided no net performance benefit while adding complexity.

	// -- Declare simple parameters -------------------------------------------
	for (let i = 0; i < params.length; i++) {
		const param = params[i]!;
		if (param.isIdentifier()) {
			declareAndStoreParam(
				param.node.name,
				i,
				emitter,
				scope,
				registerMap,
				slotMap,
				captureResult
			);
		} else if (param.isAssignmentPattern()) {
			const left = param.get("left");
			if (left.isIdentifier()) {
				scope.declare(left.node.name, "param");
				const pName = left.node.name;
				if (registerMap.has(pName)) {
					// Will be stored via register in compileComplexParams
				} else if (slotMap.has(pName)) {
					const slotIdx = slotMap.get(pName)!;
					const nameIdx = emitter.addStringConstant(pName);
					emitter.emit(
						Op.DECLARE_SLOT,
						(slotIdx & 0xffff) | ((nameIdx & 0xffff) << 16)
					);
				} else {
					const nameIdx = emitter.addStringConstant(pName);
					emitter.emit(Op.DECLARE_VAR, nameIdx);
				}
			}
		} else if (param.isRestElement()) {
			const arg = param.get("argument");
			if (arg.isIdentifier()) {
				scope.declare(arg.node.name, "param");
				const pName = arg.node.name;
				if (registerMap.has(pName)) {
					// Will be stored via register in compileComplexParams
				} else if (slotMap.has(pName)) {
					const slotIdx = slotMap.get(pName)!;
					const nameIdx = emitter.addStringConstant(pName);
					emitter.emit(
						Op.DECLARE_SLOT,
						(slotIdx & 0xffff) | ((nameIdx & 0xffff) << 16)
					);
				} else {
					const nameIdx = emitter.addStringConstant(pName);
					emitter.emit(Op.DECLARE_VAR, nameIdx);
				}
			}
		}
		// Destructuring params are handled in the second pass below.
	}

	// -- Build CompileContext ------------------------------------------------
	const ctx: CompileContext = {
		registerMap,
		slotMap,
		blockDepth: 0,

		compileNestedFunction(innerFnPath, parentEmitter, _parentScope) {
			const childUnit = compileFunctionInner(innerFnPath, allUnits);
			allUnits.push(childUnit);
			const idIdx = parentEmitter.addStringConstant(childUnit.id);
			parentEmitter.emit(Op.NEW_CLOSURE, idIdx);
		},

		compileClassExpression(classPath, parentEmitter, parentScope) {
			compileClassExpr(
				classPath,
				parentEmitter,
				parentScope,
				this,
				allUnits,
				compileFunctionInner
			);
		},

		compileDestructuring(pattern, em, sc) {
			compileDestructuringPattern(pattern, em, sc, this);
		},
	};

	// -- Process complex parameters (defaults, rest, destructuring) ----------
	compileComplexParams(params, emitter, scope, ctx);

	// -- Compile the function body -------------------------------------------
	const bodyPath = fnPath.get("body");
	if (bodyPath.isBlockStatement()) {
		const loopStack: LoopContext[] = [];
		compileBody(bodyPath.get("body"), emitter, scope, ctx, loopStack);
	} else if (bodyPath.isExpression()) {
		compileExpression(
			bodyPath as NodePath<t.Expression>,
			emitter,
			scope,
			ctx
		);
		emitter.emit(Op.RETURN, 0);
	}

	// Ensure every code path ends with a return
	ensureTrailingReturn(emitter);

	// -- Optimization passes (Tiers 2 & 3) ----------------------------------
	optimizeInstructions(emitter);

	// -- Scope-object elision -----------------------------------------------
	// Scan the FINAL opcodes (still logical here, before the per-file shuffle)
	// for any scope-dependent opcode.  When none are present and the function
	// has no dynamic scope, the per-call `Object.create(OS)` layer is provably
	// redundant and the runtime can use `SC = OS` directly.
	const scopeless = computeScopeless(
		emitter.instructions,
		captureResult.hasDynamicScope
	);

	return {
		id: genUnitId(),
		constants: emitter.constants,
		instructions: emitter.instructions,
		jumpTable: {},
		exceptionTable: [],
		paramCount,
		registerCount: scope.totalRegisters,
		slotCount: slotMap.size,
		isStrict,
		isGenerator,
		isAsync,
		isArrow,
		scopeless,
		nameConstIndex,
		outerNames: scope.outerNames,
		childUnits: [],
	};
}

// ---------------------------------------------------------------------------
// Parameter compilation helpers
// ---------------------------------------------------------------------------

/** Declare a simple identifier parameter and store the argument value. */
function declareAndStoreParam(
	name: string,
	argIndex: number,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	registerMap: Map<string, number>,
	slotMap: Map<string, number>,
	_captureResult: CaptureAnalysisResult
): void {
	scope.declare(name, "param");
	const reg = registerMap.get(name);
	const slot = slotMap.get(name);
	if (reg !== undefined) {
		// Register-promoted: store arg directly into register
		emitter.emit(Op.LOAD_ARG, argIndex);
		emitter.emit(Op.STORE_REG, reg);
	} else if (slot !== undefined) {
		// Indexed scope slot (captured variable)
		const nameIdx = emitter.addStringConstant(name);
		emitter.emit(
			Op.DECLARE_SLOT,
			(slot & 0xffff) | ((nameIdx & 0xffff) << 16)
		);
		emitter.emit(Op.LOAD_ARG, argIndex);
		emitter.emit(Op.STORE_SLOT, slot);
	} else {
		// Fallback: use scope chain (outer names, etc.)
		const nameIdx = emitter.addStringConstant(name);
		emitter.emit(Op.DECLARE_VAR, nameIdx);
		emitter.emit(Op.LOAD_ARG, argIndex);
		emitter.emit(Op.STORE_SCOPED, nameIdx);
	}
}

/**
 * Second pass over parameters — compiles default values, rest elements,
 * and destructuring patterns that require the full CompileContext.
 */
function compileComplexParams(
	params: NodePath<t.LVal>[],
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	for (let i = 0; i < params.length; i++) {
		const param = params[i]!;

		if (param.isAssignmentPattern()) {
			compileDefaultParam(param, i, emitter, scope, ctx);
		} else if (param.isRestElement()) {
			compileRestParam(param, i, emitter, scope, ctx);
		} else if (!param.isIdentifier()) {
			// Destructuring param
			emitter.emit(Op.LOAD_ARG, i);
			compileDestructuringPattern(
				param as NodePath<t.LVal>,
				emitter,
				scope,
				ctx
			);
		}
	}
}

/** Compile a parameter with a default value. */
function compileDefaultParam(
	param: NodePath<t.AssignmentPattern>,
	argIndex: number,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	const left = param.get("left");
	const paramName = left.isIdentifier() ? left.node.name : null;

	// Load arg, check if undefined, use default if so
	emitter.emit(Op.LOAD_ARG, argIndex);
	emitter.emit(Op.DUP, 0);
	emitter.emit(Op.PUSH_UNDEFINED, 0);
	emitter.emit(Op.SEQ, 0);
	const skipDefault = emitter.emit(Op.JMP_FALSE, 0);
	emitter.emit(Op.POP, 0);
	compileExpression(
		param.get("right") as NodePath<t.Expression>,
		emitter,
		scope,
		ctx
	);
	emitter.patchJump(skipDefault, emitter.ip);

	if (paramName) {
		const reg = ctx.registerMap.get(paramName);
		const slot = ctx.slotMap.get(paramName);
		if (reg !== undefined) {
			emitter.emit(Op.STORE_REG, reg);
		} else if (slot !== undefined) {
			emitter.emit(Op.STORE_SLOT, slot);
		} else {
			const nameIdx = emitter.addStringConstant(paramName);
			emitter.emit(Op.STORE_SCOPED, nameIdx);
		}
	} else if (left.isArrayPattern() || left.isObjectPattern()) {
		compileDestructuringPattern(
			left as NodePath<t.LVal>,
			emitter,
			scope,
			ctx
		);
	}
}

/** Compile a rest parameter (`...args`). */
function compileRestParam(
	param: NodePath<t.RestElement>,
	startIndex: number,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	const arg = param.get("argument");
	const restName = arg.isIdentifier() ? arg.node.name : null;

	// Array.prototype.slice.call(arguments, startIndex)
	emitter.emit(Op.PUSH_ARGUMENTS, 0);
	const sliceNameIdx = emitter.addStringConstant("slice");
	emitter.emit(Op.DUP, 0);
	emitter.emit(Op.GET_PROP_STATIC, sliceNameIdx);
	emitter.emit(Op.SWAP, 0);
	const sliceIdx = emitter.addNumberConstant(startIndex);
	emitter.emit(Op.PUSH_CONST, sliceIdx);
	emitter.emit(Op.CALL_METHOD, 1);

	if (restName) {
		const reg = ctx.registerMap.get(restName);
		const slot = ctx.slotMap.get(restName);
		if (reg !== undefined) {
			emitter.emit(Op.STORE_REG, reg);
		} else if (slot !== undefined) {
			emitter.emit(Op.STORE_SLOT, slot);
		} else {
			const nameIdx = emitter.addStringConstant(restName);
			emitter.emit(Op.STORE_SCOPED, nameIdx);
		}
	} else if (arg.isArrayPattern() || arg.isObjectPattern()) {
		compileDestructuringPattern(
			arg as NodePath<t.LVal>,
			emitter,
			scope,
			ctx
		);
	}
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Detect whether the function body starts with `"use strict"`. */
function detectStrict(fnPath: NodePath<t.Function>): boolean {
	const body = fnPath.get("body");
	if (!body.isBlockStatement()) return false;
	const stmts = body.get("body");
	if (stmts.length > 0) {
		const first = stmts[0]!;
		if (first.isExpressionStatement()) {
			const expr = first.node.expression;
			if (expr.type === "StringLiteral" && expr.value === "use strict") {
				return true;
			}
		}
	}
	return false;
}

/** Ensure the instruction stream ends with a return instruction. */
function ensureTrailingReturn(emitter: Emitter): void {
	const last = emitter.instructions[emitter.instructions.length - 1];
	if (
		!last ||
		(last.opcode !== Op.RETURN && last.opcode !== Op.RETURN_VOID)
	) {
		emitter.emit(Op.RETURN_VOID, 0);
	}
}
