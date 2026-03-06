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
import { compileBody, compileDestructuringPattern, type LoopContext } from "./visitors/statements.js";
import { compileClassExpr } from "./visitors/classes.js";
import type { BytecodeUnit } from "../types.js";
import { UNIT_ID_PREFIX, UNIT_ID_PAD_LENGTH } from "../constants.js";

// ---------------------------------------------------------------------------
// Unit ID generation
// ---------------------------------------------------------------------------

let unitCounter = 0;

/** Reset the unit ID counter (call before each file compilation). */
export function resetUnitCounter(): void {
  unitCounter = 0;
}

/** Generate the next unique bytecode unit ID (e.g. `"u_0000"`). */
function genUnitId(): string {
  return UNIT_ID_PREFIX + (unitCounter++).toString(16).padStart(UNIT_ID_PAD_LENGTH, "0");
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
  compileNestedFunction(fnPath: NodePath<t.Function>, emitter: Emitter, parentScope: ScopeAnalyzer): void;
  compileClassExpression(classPath: NodePath<t.ClassExpression>, emitter: Emitter, parentScope: ScopeAnalyzer): void;
  compileDestructuring(pattern: NodePath<t.LVal>, emitter: Emitter, scope: ScopeAnalyzer): void;
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
function compileFunctionInner(fnPath: NodePath<t.Function>, allUnits: BytecodeUnit[]): BytecodeUnit {
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
  if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression") {
    if (node.id?.name) {
      nameConstIndex = emitter.addStringConstant(node.id.name);
    }
  }

  // -- Declare simple parameters -------------------------------------------
  for (let i = 0; i < params.length; i++) {
    const param = params[i]!;
    if (param.isIdentifier()) {
      declareAndStoreParam(param.node.name, i, emitter, scope);
    } else if (param.isAssignmentPattern()) {
      const left = param.get("left");
      if (left.isIdentifier()) {
        scope.declare(left.node.name, "param");
        const nameIdx = emitter.addStringConstant(left.node.name);
        emitter.emit(Op.DECLARE_VAR, nameIdx);
      }
    } else if (param.isRestElement()) {
      const arg = param.get("argument");
      if (arg.isIdentifier()) {
        scope.declare(arg.node.name, "param");
        const nameIdx = emitter.addStringConstant(arg.node.name);
        emitter.emit(Op.DECLARE_VAR, nameIdx);
      }
    }
    // Destructuring params are handled in the second pass below.
  }

  // -- Build CompileContext ------------------------------------------------
  const ctx: CompileContext = {
    compileNestedFunction(innerFnPath, parentEmitter, _parentScope) {
      const childUnit = compileFunctionInner(innerFnPath, allUnits);
      allUnits.push(childUnit);
      const idIdx = parentEmitter.addStringConstant(childUnit.id);
      parentEmitter.emit(Op.NEW_CLOSURE, idIdx);
    },

    compileClassExpression(classPath, parentEmitter, parentScope) {
      compileClassExpr(classPath, parentEmitter, parentScope, this, allUnits, compileFunctionInner);
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
    compileExpression(bodyPath as NodePath<t.Expression>, emitter, scope, ctx);
    emitter.emit(Op.RETURN, 0);
  }

  // Ensure every code path ends with a return
  ensureTrailingReturn(emitter);

  return {
    id: genUnitId(),
    constants: emitter.constants,
    instructions: emitter.instructions,
    jumpTable: {},
    exceptionTable: [],
    paramCount,
    registerCount: scope.totalRegisters,
    isStrict,
    isGenerator,
    isAsync,
    isArrow,
    nameConstIndex,
    outerNames: scope.outerNames,
    childUnits: [],
  };
}

// ---------------------------------------------------------------------------
// Parameter compilation helpers
// ---------------------------------------------------------------------------

/** Declare a simple identifier parameter and store the argument value. */
function declareAndStoreParam(name: string, argIndex: number, emitter: Emitter, scope: ScopeAnalyzer): void {
  scope.declare(name, "param");
  const nameIdx = emitter.addStringConstant(name);
  emitter.emit(Op.DECLARE_VAR, nameIdx);
  emitter.emit(Op.LOAD_ARG, argIndex);
  emitter.emit(Op.STORE_SCOPED, nameIdx);
}

/**
 * Second pass over parameters — compiles default values, rest elements,
 * and destructuring patterns that require the full CompileContext.
 */
function compileComplexParams(
  params: NodePath<t.LVal>[],
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
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
      compileDestructuringPattern(param as NodePath<t.LVal>, emitter, scope, ctx);
    }
  }
}

/** Compile a parameter with a default value. */
function compileDefaultParam(
  param: NodePath<t.AssignmentPattern>,
  argIndex: number,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
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
  compileExpression(param.get("right") as NodePath<t.Expression>, emitter, scope, ctx);
  emitter.patchJump(skipDefault, emitter.ip);

  if (paramName) {
    const nameIdx = emitter.addStringConstant(paramName);
    emitter.emit(Op.STORE_SCOPED, nameIdx);
  } else if (left.isArrayPattern() || left.isObjectPattern()) {
    compileDestructuringPattern(left as NodePath<t.LVal>, emitter, scope, ctx);
  }
}

/** Compile a rest parameter (`...args`). */
function compileRestParam(
  param: NodePath<t.RestElement>,
  startIndex: number,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
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
    const nameIdx = emitter.addStringConstant(restName);
    emitter.emit(Op.STORE_SCOPED, nameIdx);
  } else if (arg.isArrayPattern() || arg.isObjectPattern()) {
    compileDestructuringPattern(arg as NodePath<t.LVal>, emitter, scope, ctx);
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
  if (!last || (last.opcode !== Op.RETURN && last.opcode !== Op.RETURN_VOID)) {
    emitter.emit(Op.RETURN_VOID, 0);
  }
}
