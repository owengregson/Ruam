/**
 * Statement compilation visitors.
 *
 * Each JS statement type has a dedicated compiler function that emits the
 * corresponding bytecode sequence.  Control flow (if, while, for, switch,
 * try/catch, break/continue, labeled statements) is handled via jump
 * instructions and a loop-stack mechanism.
 *
 * @module compiler/visitors/statements
 */

import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import { Op } from "../opcodes.js";
import type { Emitter } from "../emitter.js";
import type { ScopeAnalyzer } from "../scope.js";
import type { CompileContext } from "../index.js";
import { compileExpression } from "./expressions.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Tracks break/continue targets for a loop or switch statement. */
export interface LoopContext {
  breakLabel: number;
  continueLabel: number;
  labelName?: string;
}

// ---------------------------------------------------------------------------
// Top-level statement dispatcher
// ---------------------------------------------------------------------------

export function compileStatement(
  path: NodePath<t.Statement>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
  loopStack: LoopContext[],
): void {
  const node = path.node;

  switch (node.type) {
    case "ExpressionStatement":
      compileExpression((path as NodePath<t.ExpressionStatement>).get("expression"), emitter, scope, ctx);
      emitter.emit(Op.POP, 0);
      break;

    case "ReturnStatement":
      compileReturnStatement(path as NodePath<t.ReturnStatement>, emitter, scope, ctx);
      break;

    case "VariableDeclaration":
      compileVariableDeclaration(path as NodePath<t.VariableDeclaration>, emitter, scope, ctx);
      break;

    case "IfStatement":
      compileIfStatement(path as NodePath<t.IfStatement>, emitter, scope, ctx, loopStack);
      break;

    case "BlockStatement":
      compileBlockStatement(path as NodePath<t.BlockStatement>, emitter, scope, ctx, loopStack);
      break;

    case "ForStatement":
      compileForStatement(path as NodePath<t.ForStatement>, emitter, scope, ctx, loopStack);
      break;

    case "WhileStatement":
      compileWhileStatement(path as NodePath<t.WhileStatement>, emitter, scope, ctx, loopStack);
      break;

    case "DoWhileStatement":
      compileDoWhileStatement(path as NodePath<t.DoWhileStatement>, emitter, scope, ctx, loopStack);
      break;

    case "ForInStatement":
      compileForInStatement(path as NodePath<t.ForInStatement>, emitter, scope, ctx, loopStack);
      break;

    case "ForOfStatement":
      compileForOfStatement(path as NodePath<t.ForOfStatement>, emitter, scope, ctx, loopStack);
      break;

    case "SwitchStatement":
      compileSwitchStatement(path as NodePath<t.SwitchStatement>, emitter, scope, ctx, loopStack);
      break;

    case "ThrowStatement":
      compileExpression((path as NodePath<t.ThrowStatement>).get("argument"), emitter, scope, ctx);
      emitter.emit(Op.THROW, 0);
      break;

    case "TryStatement":
      compileTryStatement(path as NodePath<t.TryStatement>, emitter, scope, ctx, loopStack);
      break;

    case "BreakStatement":
      compileBreakStatement(path as NodePath<t.BreakStatement>, emitter, loopStack);
      break;

    case "ContinueStatement":
      compileContinueStatement(path as NodePath<t.ContinueStatement>, emitter, loopStack);
      break;

    case "LabeledStatement":
      compileLabeledStatement(path as NodePath<t.LabeledStatement>, emitter, scope, ctx, loopStack);
      break;

    case "FunctionDeclaration":
      compileFunctionDeclaration(path as NodePath<t.FunctionDeclaration>, emitter, scope, ctx);
      break;

    case "ClassDeclaration":
      compileClassDeclaration(path as NodePath<t.ClassDeclaration>, emitter, scope, ctx);
      break;

    case "EmptyStatement":
      break;

    case "DebuggerStatement":
      emitter.emit(Op.DEBUGGER_STMT, 0);
      break;

    default:
      throw new Error(`Unsupported statement type: ${node.type}`);
  }
}

export function compileBody(
  stmts: NodePath<t.Statement>[],
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
  loopStack: LoopContext[],
): void {
  // Hoist function declarations (JS semantics: available before their textual position)
  for (const stmt of stmts) {
    if (stmt.isFunctionDeclaration()) {
      compileStatement(stmt, emitter, scope, ctx, loopStack);
    }
  }
  for (const stmt of stmts) {
    if (!stmt.isFunctionDeclaration()) {
      compileStatement(stmt, emitter, scope, ctx, loopStack);
    }
  }
}

function compileReturnStatement(
  path: NodePath<t.ReturnStatement>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  if (path.node.argument) {
    compileExpression(path.get("argument") as NodePath<t.Expression>, emitter, scope, ctx);
    emitter.emit(Op.RETURN, 0);
  } else {
    emitter.emit(Op.RETURN_VOID, 0);
  }
}

function compileVariableDeclaration(
  path: NodePath<t.VariableDeclaration>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  const kind = path.node.kind as "var" | "let" | "const";

  for (const declarator of path.get("declarations")) {
    const id = declarator.get("id");
    const init = declarator.get("init");

    if (id.isIdentifier()) {
      scope.declare(id.node.name, kind);
      const nameIdx = emitter.addStringConstant(id.node.name);
      emitter.emit(Op.DECLARE_VAR, nameIdx);

      if (init.node) {
        compileExpression(init as NodePath<t.Expression>, emitter, scope, ctx);
        emitter.emit(Op.STORE_SCOPED, nameIdx);
      }
    } else if (id.isArrayPattern() || id.isObjectPattern()) {
      if (init.node) {
        compileExpression(init as NodePath<t.Expression>, emitter, scope, ctx);
      } else {
        emitter.emit(Op.PUSH_UNDEFINED, 0);
      }
      compileDestructuringPattern(id as NodePath<t.LVal>, emitter, scope, ctx, kind);
    }
  }
}

export function compileDestructuringPattern(
  pattern: NodePath<t.LVal>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
  declKind?: "var" | "let" | "const",
): void {
  if (pattern.isArrayPattern()) {
    compileArrayPattern(pattern, emitter, scope, ctx, declKind);
  } else if (pattern.isObjectPattern()) {
    compileObjectPattern(pattern, emitter, scope, ctx, declKind);
  } else if (pattern.isAssignmentPattern()) {
    compileAssignmentPattern(pattern, emitter, scope, ctx, declKind);
  } else if (pattern.isIdentifier()) {
    const nameIdx = emitter.addStringConstant(pattern.node.name);
    if (declKind) {
      scope.declare(pattern.node.name, declKind);
      emitter.emit(Op.DECLARE_VAR, nameIdx);
    }
    emitter.emit(Op.STORE_SCOPED, nameIdx);
  } else if (pattern.isRestElement()) {
    compileDestructuringPattern(pattern.get("argument") as NodePath<t.LVal>, emitter, scope, ctx, declKind);
  } else if (pattern.isMemberExpression()) {
    // assignment target is a member expression e.g. obj.x = ...
    const memberPath = pattern as NodePath<t.MemberExpression>;
    // value is on the stack
    // we need obj on stack, then swap, then set
    emitter.emit(Op.DUP, 0); // keep a copy of the value for potential chaining
    compileExpression(memberPath.get("object"), emitter, scope, ctx);
    emitter.emit(Op.SWAP, 0);
    if (memberPath.node.computed) {
      compileExpression(memberPath.get("property") as NodePath<t.Expression>, emitter, scope, ctx);
      emitter.emit(Op.SWAP, 0);
      emitter.emit(Op.SET_PROP_DYNAMIC, 0);
    } else {
      const nameIdx = emitter.addStringConstant((memberPath.node.property as t.Identifier).name);
      emitter.emit(Op.SET_PROP_STATIC, nameIdx);
    }
    emitter.emit(Op.POP, 0);
    emitter.emit(Op.POP, 0);
    return;
  }
}

function compileArrayPattern(
  pattern: NodePath<t.ArrayPattern>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
  declKind?: "var" | "let" | "const",
): void {
  // value is on stack top. We need an iterator.
  emitter.emit(Op.GET_ITERATOR, 0);

  for (const elem of pattern.get("elements")) {
    if (elem.node === null) {
      // skip this index
      emitter.emit(Op.DUP, 0);
      emitter.emit(Op.ITER_NEXT, 0);
      emitter.emit(Op.POP, 0);
      continue;
    }

    if (elem.isRestElement()) {
      // collect remaining into an array
      emitter.emit(Op.DUP, 0);
      emitter.emit(Op.NEW_ARRAY, 0);
      const loopStart = emitter.ip;
      emitter.emit(Op.SWAP, 0);
      emitter.emit(Op.DUP, 0);
      emitter.emit(Op.ITER_DONE, 0);
      const exitJump = emitter.emit(Op.JMP_TRUE, 0);
      emitter.emit(Op.DUP, 0);
      emitter.emit(Op.ITER_NEXT, 0);
      emitter.emit(Op.ROT3, 0);
      emitter.emit(Op.SWAP, 0);
      emitter.emit(Op.ARRAY_PUSH, 0);
      emitter.emit(Op.SWAP, 0);
      emitter.emit(Op.JMP, loopStart);
      emitter.patchJump(exitJump, emitter.ip);
      emitter.emit(Op.POP, 0);
      // Now stack has: [..., iterator, array]
      // Swap to put array on top, pop iterator
      emitter.emit(Op.SWAP, 0);
      emitter.emit(Op.POP, 0);
      compileDestructuringPattern(elem.get("argument") as NodePath<t.LVal>, emitter, scope, ctx, declKind);
      continue;
    }

    emitter.emit(Op.DUP, 0);
    emitter.emit(Op.ITER_NEXT, 0);

    if (elem.isAssignmentPattern()) {
      compileAssignmentPattern(elem, emitter, scope, ctx, declKind);
    } else {
      compileDestructuringPattern(elem as NodePath<t.LVal>, emitter, scope, ctx, declKind);
    }
  }

  emitter.emit(Op.POP, 0);
}

function compileObjectPattern(
  pattern: NodePath<t.ObjectPattern>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
  declKind?: "var" | "let" | "const",
): void {
  const props = pattern.get("properties");

  for (const prop of props) {
    if (prop.isRestElement()) {
      // rest element in object pattern: {...rest} = obj
      emitter.emit(Op.DUP, 0);
      // We need to create a new object with remaining keys
      // For simplicity, use Object.assign({}, obj) then delete extracted keys
      // Actually, just push the object — the runtime handles rest via spread
      emitter.emit(Op.NEW_OBJECT, 0);
      emitter.emit(Op.SWAP, 0);
      emitter.emit(Op.SPREAD_ARRAY, 0); // uses Object.assign semantics

      // Delete already-extracted keys
      const precedingKeys: string[] = [];
      for (const p2 of props) {
        if (p2 === prop) break;
        if (p2.isObjectProperty()) {
          const key = p2.node.key;
          if (key.type === "Identifier" && !p2.node.computed) precedingKeys.push(key.name);
          else if (key.type === "StringLiteral") precedingKeys.push(key.value);
        }
      }
      for (const k of precedingKeys) {
        emitter.emit(Op.DUP, 0);
        const nameIdx = emitter.addStringConstant(k);
        emitter.emit(Op.DELETE_PROP_STATIC, nameIdx);
        emitter.emit(Op.POP, 0);
      }

      compileDestructuringPattern(prop.get("argument") as NodePath<t.LVal>, emitter, scope, ctx, declKind);
      continue;
    }

    if (!prop.isObjectProperty()) continue;

    emitter.emit(Op.DUP, 0);

    const key = prop.node.key;
    if (prop.node.computed) {
      compileExpression(prop.get("key") as NodePath<t.Expression>, emitter, scope, ctx);
      emitter.emit(Op.GET_PROP_DYNAMIC, 0);
    } else if (key.type === "Identifier") {
      const nameIdx = emitter.addStringConstant(key.name);
      emitter.emit(Op.GET_PROP_STATIC, nameIdx);
    } else if (key.type === "StringLiteral") {
      const nameIdx = emitter.addStringConstant(key.value);
      emitter.emit(Op.GET_PROP_STATIC, nameIdx);
    } else if (key.type === "NumericLiteral") {
      const nameIdx = emitter.addStringConstant(String(key.value));
      emitter.emit(Op.GET_PROP_STATIC, nameIdx);
    }

    const value = prop.get("value") as NodePath<t.LVal>;
    if (value.isAssignmentPattern()) {
      compileAssignmentPattern(value, emitter, scope, ctx, declKind);
    } else {
      compileDestructuringPattern(value, emitter, scope, ctx, declKind);
    }
  }

  emitter.emit(Op.POP, 0);
}

function compileAssignmentPattern(
  pattern: NodePath<t.AssignmentPattern>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
  declKind?: "var" | "let" | "const",
): void {
  // value is on the stack — check if undefined, use default if so
  emitter.emit(Op.DUP, 0);
  emitter.emit(Op.PUSH_UNDEFINED, 0);
  emitter.emit(Op.SEQ, 0);
  const skipDefault = emitter.emit(Op.JMP_FALSE, 0);
  emitter.emit(Op.POP, 0);
  compileExpression(pattern.get("right"), emitter, scope, ctx);
  emitter.patchJump(skipDefault, emitter.ip);

  compileDestructuringPattern(pattern.get("left") as NodePath<t.LVal>, emitter, scope, ctx, declKind);
}

function compileIfStatement(
  path: NodePath<t.IfStatement>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
  loopStack: LoopContext[],
): void {
  compileExpression(path.get("test"), emitter, scope, ctx);
  const falseJump = emitter.emit(Op.JMP_FALSE, 0);

  compileStatement(path.get("consequent"), emitter, scope, ctx, loopStack);

  if (path.node.alternate) {
    const endJump = emitter.emit(Op.JMP, 0);
    emitter.patchJump(falseJump, emitter.ip);
    compileStatement(path.get("alternate") as NodePath<t.Statement>, emitter, scope, ctx, loopStack);
    emitter.patchJump(endJump, emitter.ip);
  } else {
    emitter.patchJump(falseJump, emitter.ip);
  }
}

function compileBlockStatement(
  path: NodePath<t.BlockStatement>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
  loopStack: LoopContext[],
): void {
  scope.pushScope(true);
  const stmts = path.get("body");
  compileBody(stmts, emitter, scope, ctx, loopStack);
  scope.popScope();
}

function compileForStatement(
  path: NodePath<t.ForStatement>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
  loopStack: LoopContext[],
): void {
  scope.pushScope(true);

  if (path.node.init) {
    const init = path.get("init");
    if (init.isVariableDeclaration()) {
      compileVariableDeclaration(init, emitter, scope, ctx);
    } else if (init.isExpression()) {
      compileExpression(init, emitter, scope, ctx);
      emitter.emit(Op.POP, 0);
    }
  }

  const testIp = emitter.ip;
  let exitJump = -1;

  if (path.node.test) {
    compileExpression(path.get("test") as NodePath<t.Expression>, emitter, scope, ctx);
    exitJump = emitter.emit(Op.JMP_FALSE, 0);
  }

  const breakTarget = -1;
  const continueTarget = -1;
  const loopCtx: LoopContext = { breakLabel: breakTarget, continueLabel: continueTarget };
  loopStack.push(loopCtx);

  compileStatement(path.get("body"), emitter, scope, ctx, loopStack);

  loopCtx.continueLabel = emitter.ip;

  if (path.node.update) {
    compileExpression(path.get("update") as NodePath<t.Expression>, emitter, scope, ctx);
    emitter.emit(Op.POP, 0);
  }

  emitter.emit(Op.JMP, testIp);

  if (exitJump >= 0) {
    emitter.patchJump(exitJump, emitter.ip);
  }

  loopCtx.breakLabel = emitter.ip;
  patchBreaksAndContinues(emitter, loopCtx, loopStack);
  loopStack.pop();
  scope.popScope();
}

function compileWhileStatement(
  path: NodePath<t.WhileStatement>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
  loopStack: LoopContext[],
): void {
  const testIp = emitter.ip;
  compileExpression(path.get("test"), emitter, scope, ctx);
  const exitJump = emitter.emit(Op.JMP_FALSE, 0);

  const loopCtx: LoopContext = { breakLabel: -1, continueLabel: testIp };
  loopStack.push(loopCtx);

  compileStatement(path.get("body"), emitter, scope, ctx, loopStack);
  emitter.emit(Op.JMP, testIp);
  emitter.patchJump(exitJump, emitter.ip);

  loopCtx.breakLabel = emitter.ip;
  patchBreaksAndContinues(emitter, loopCtx, loopStack);
  loopStack.pop();
}

function compileDoWhileStatement(
  path: NodePath<t.DoWhileStatement>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
  loopStack: LoopContext[],
): void {
  const bodyIp = emitter.ip;

  const loopCtx: LoopContext = { breakLabel: -1, continueLabel: -1 };
  loopStack.push(loopCtx);

  compileStatement(path.get("body"), emitter, scope, ctx, loopStack);

  loopCtx.continueLabel = emitter.ip;

  compileExpression(path.get("test"), emitter, scope, ctx);
  emitter.emit(Op.JMP_TRUE, bodyIp);

  loopCtx.breakLabel = emitter.ip;
  patchBreaksAndContinues(emitter, loopCtx, loopStack);
  loopStack.pop();
}

function compileForInStatement(
  path: NodePath<t.ForInStatement>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
  loopStack: LoopContext[],
): void {
  scope.pushScope(true);

  compileExpression(path.get("right"), emitter, scope, ctx);
  emitter.emit(Op.FORIN_INIT, 0);

  const testIp = emitter.ip;
  emitter.emit(Op.DUP, 0);
  emitter.emit(Op.FORIN_DONE, 0);
  const exitJump = emitter.emit(Op.JMP_TRUE, 0);

  emitter.emit(Op.DUP, 0);
  emitter.emit(Op.FORIN_NEXT, 0);

  // Per-iteration scope so closures in the body capture fresh bindings
  const left = path.get("left");
  const needsIterScope = left.isVariableDeclaration() && left.node.kind !== "var";
  if (needsIterScope) emitter.emit(Op.PUSH_SCOPE, 0);

  if (left.isVariableDeclaration()) {
    const decl = left.get("declarations")[0]!;
    const id = decl.get("id");
    if (id.isIdentifier()) {
      const kind = left.node.kind as "var" | "let" | "const";
      scope.declare(id.node.name, kind);
      const nameIdx = emitter.addStringConstant(id.node.name);
      emitter.emit(Op.DECLARE_VAR, nameIdx);
      emitter.emit(Op.STORE_SCOPED, nameIdx);
    }
  } else if (left.isIdentifier()) {
    const nameIdx = emitter.addStringConstant(left.node.name);
    emitter.emit(Op.STORE_SCOPED, nameIdx);
  }

  const loopCtx: LoopContext = { breakLabel: -1, continueLabel: testIp };
  loopStack.push(loopCtx);

  compileStatement(path.get("body"), emitter, scope, ctx, loopStack);

  if (needsIterScope) emitter.emit(Op.POP_SCOPE, 0);
  emitter.emit(Op.JMP, testIp);
  emitter.patchJump(exitJump, emitter.ip);

  emitter.emit(Op.POP, 0);

  loopCtx.breakLabel = emitter.ip;
  patchBreaksAndContinues(emitter, loopCtx, loopStack);
  loopStack.pop();
  scope.popScope();
}

function compileForOfStatement(
  path: NodePath<t.ForOfStatement>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
  loopStack: LoopContext[],
): void {
  scope.pushScope(true);

  compileExpression(path.get("right"), emitter, scope, ctx);
  emitter.emit(Op.GET_ITERATOR, 0);

  const testIp = emitter.ip;
  // ITER_DONE peeks at iterator, pushes done flag — no DUP needed
  emitter.emit(Op.ITER_DONE, 0);
  const exitJump = emitter.emit(Op.JMP_TRUE, 0);

  // DUP iterator before ITER_NEXT (which pops it)
  emitter.emit(Op.DUP, 0);
  emitter.emit(Op.ITER_NEXT, 0);

  // Per-iteration scope so closures in the body capture fresh bindings
  const left = path.get("left");
  const needsIterScope = left.isVariableDeclaration() && left.node.kind !== "var";
  if (needsIterScope) emitter.emit(Op.PUSH_SCOPE, 0);

  if (left.isVariableDeclaration()) {
    const decl = left.get("declarations")[0]!;
    const id = decl.get("id");
    if (id.isIdentifier()) {
      const kind = left.node.kind as "var" | "let" | "const";
      scope.declare(id.node.name, kind);
      const nameIdx = emitter.addStringConstant(id.node.name);
      emitter.emit(Op.DECLARE_VAR, nameIdx);
      emitter.emit(Op.STORE_SCOPED, nameIdx);
    } else {
      compileDestructuringPattern(id as NodePath<t.LVal>, emitter, scope, ctx, left.node.kind as "var" | "let" | "const");
    }
  } else if (left.isIdentifier()) {
    const nameIdx = emitter.addStringConstant(left.node.name);
    emitter.emit(Op.STORE_SCOPED, nameIdx);
  } else {
    compileDestructuringPattern(left as NodePath<t.LVal>, emitter, scope, ctx);
  }

  const loopCtx: LoopContext = { breakLabel: -1, continueLabel: testIp };
  loopStack.push(loopCtx);

  compileStatement(path.get("body"), emitter, scope, ctx, loopStack);

  if (needsIterScope) emitter.emit(Op.POP_SCOPE, 0);
  emitter.emit(Op.JMP, testIp);
  emitter.patchJump(exitJump, emitter.ip);

  emitter.emit(Op.POP, 0);

  loopCtx.breakLabel = emitter.ip;
  patchBreaksAndContinues(emitter, loopCtx, loopStack);
  loopStack.pop();
  scope.popScope();
}

function compileSwitchStatement(
  path: NodePath<t.SwitchStatement>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
  loopStack: LoopContext[],
): void {
  compileExpression(path.get("discriminant"), emitter, scope, ctx);

  const cases = path.get("cases");
  const caseJumps: number[] = [];
  let defaultJump = -1;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!;
    if (c.node.test) {
      emitter.emit(Op.DUP, 0);
      compileExpression(c.get("test") as NodePath<t.Expression>, emitter, scope, ctx);
      emitter.emit(Op.SEQ, 0);
      caseJumps.push(emitter.emit(Op.JMP_TRUE, 0));
    } else {
      defaultJump = i;
      caseJumps.push(-1);
    }
  }

  const afterJump = defaultJump >= 0 ? -1 : emitter.emit(Op.JMP, 0);
  if (defaultJump >= 0) {
    caseJumps[defaultJump] = emitter.emit(Op.JMP, 0);
  }

  const loopCtx: LoopContext = { breakLabel: -1, continueLabel: -1 };
  loopStack.push(loopCtx);

  const caseBodyIps: number[] = [];
  for (let i = 0; i < cases.length; i++) {
    caseBodyIps.push(emitter.ip);
    const c = cases[i]!;
    for (const stmt of c.get("consequent")) {
      compileStatement(stmt, emitter, scope, ctx, loopStack);
    }
  }

  for (let i = 0; i < caseJumps.length; i++) {
    if (caseJumps[i]! >= 0) {
      emitter.patchJump(caseJumps[i]!, caseBodyIps[i]!);
    }
  }

  if (afterJump >= 0) {
    emitter.patchJump(afterJump, emitter.ip);
  }

  loopCtx.breakLabel = emitter.ip;
  emitter.emit(Op.POP, 0);

  patchBreaksAndContinues(emitter, loopCtx, loopStack);
  loopStack.pop();
}

function compileTryStatement(
  path: NodePath<t.TryStatement>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
  loopStack: LoopContext[],
): void {
  const hasCatch = !!path.node.handler;
  const hasFinally = !!path.node.finalizer;

  const tryPushIdx = emitter.emit(Op.TRY_PUSH, 0);

  compileStatement(path.get("block"), emitter, scope, ctx, loopStack);

  emitter.emit(Op.TRY_POP, 0);
  const afterTryJump = emitter.emit(Op.JMP, 0);

  let catchIp = -1;
  let finallyIp = -1;
  let catchFinallyPushIdx = -1;

  if (hasCatch) {
    catchIp = emitter.ip;
    scope.pushScope(true);

    const handler = path.get("handler") as NodePath<t.CatchClause>;
    if (handler.node.param) {
      const param = handler.get("param") as NodePath<t.LVal>;
      if (param.isIdentifier()) {
        scope.declare(param.node.name, "let");
        const nameIdx = emitter.addStringConstant(param.node.name);
        emitter.emit(Op.DECLARE_VAR, nameIdx);
        emitter.emit(Op.CATCH_BIND, nameIdx);
      } else {
        emitter.emit(Op.CATCH_BIND, -1);
        compileDestructuringPattern(param, emitter, scope, ctx, "let");
      }
    } else {
      emitter.emit(Op.CATCH_BIND, -1);
      emitter.emit(Op.POP, 0);
    }

    // If both catch and finally, wrap catch body in its own TRY_PUSH for the finally
    if (hasFinally) {
      catchFinallyPushIdx = emitter.emit(Op.TRY_PUSH, 0);
    }

    compileStatement(handler.get("body"), emitter, scope, ctx, loopStack);
    scope.popScope();

    if (hasFinally) {
      emitter.emit(Op.TRY_POP, 0);
    }
  }

  const afterCatchJump = emitter.emit(Op.JMP, 0);

  if (hasFinally) {
    finallyIp = emitter.ip;
    emitter.emit(Op.FINALLY_MARK, 0);
    compileStatement(path.get("finalizer") as NodePath<t.BlockStatement>, emitter, scope, ctx, loopStack);
    emitter.emit(Op.END_FINALLY, 0);
  }

  emitter.patchJump(afterTryJump, hasFinally ? finallyIp : emitter.ip);
  emitter.patchJump(afterCatchJump, hasFinally ? finallyIp : emitter.ip);

  if (hasCatch && hasFinally) {
    // Try body: only catch handler (finally handled by catch body's own TRY_PUSH)
    emitter.patchOperand(tryPushIdx, encodeTryTarget(catchIp, -1));
    // Catch body: only finally handler
    emitter.patchOperand(catchFinallyPushIdx, encodeTryTarget(-1, finallyIp));
  } else {
    emitter.patchOperand(tryPushIdx, encodeTryTarget(catchIp, finallyIp));
  }
}

function encodeTryTarget(catchIp: number, finallyIp: number): number {
  return ((catchIp & 0xFFFF) << 16) | (finallyIp & 0xFFFF);
}

export function decodeTryTarget(encoded: number): { catchIp: number; finallyIp: number } {
  let catchIp = (encoded >> 16) & 0xFFFF;
  let finallyIp = encoded & 0xFFFF;
  if (catchIp === 0xFFFF) catchIp = -1;
  if (finallyIp === 0xFFFF) finallyIp = -1;
  return { catchIp, finallyIp };
}

function compileBreakStatement(
  path: NodePath<t.BreakStatement>,
  emitter: Emitter,
  loopStack: LoopContext[],
): void {
  if (path.node.label) {
    const label = path.node.label.name;
    for (let i = loopStack.length - 1; i >= 0; i--) {
      if (loopStack[i]!.labelName === label) {
        emitter.emit(Op.BREAK, i);
        return;
      }
    }
  }
  emitter.emit(Op.BREAK, loopStack.length - 1);
}

function compileContinueStatement(
  path: NodePath<t.ContinueStatement>,
  emitter: Emitter,
  loopStack: LoopContext[],
): void {
  if (path.node.label) {
    const label = path.node.label.name;
    for (let i = loopStack.length - 1; i >= 0; i--) {
      if (loopStack[i]!.labelName === label) {
        emitter.emit(Op.CONTINUE, i);
        return;
      }
    }
  }
  emitter.emit(Op.CONTINUE, loopStack.length - 1);
}

function compileLabeledStatement(
  path: NodePath<t.LabeledStatement>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
  loopStack: LoopContext[],
): void {
  const labelName = path.node.label.name;
  const loopCtx: LoopContext = { breakLabel: -1, continueLabel: -1, labelName };
  loopStack.push(loopCtx);

  compileStatement(path.get("body"), emitter, scope, ctx, loopStack);

  loopCtx.breakLabel = emitter.ip;
  patchBreaksAndContinues(emitter, loopCtx, loopStack);
  loopStack.pop();
}

function compileFunctionDeclaration(
  path: NodePath<t.FunctionDeclaration>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  const name = path.node.id?.name;
  if (!name) return;

  scope.declare(name, "function");
  const nameIdx = emitter.addStringConstant(name);
  emitter.emit(Op.DECLARE_VAR, nameIdx);
  ctx.compileNestedFunction(path as unknown as NodePath<t.Function>, emitter, scope);
  emitter.emit(Op.STORE_SCOPED, nameIdx);
}

function compileClassDeclaration(
  path: NodePath<t.ClassDeclaration>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  const name = path.node.id?.name;
  if (!name) return;

  scope.declare(name, "let");
  const nameIdx = emitter.addStringConstant(name);
  emitter.emit(Op.DECLARE_VAR, nameIdx);
  ctx.compileClassExpression(path as unknown as NodePath<t.ClassExpression>, emitter, scope);
  emitter.emit(Op.STORE_SCOPED, nameIdx);
}

function patchBreaksAndContinues(
  emitter: Emitter,
  loopCtx: LoopContext,
  loopStack: LoopContext[],
): void {
  const myIndex = loopStack.indexOf(loopCtx);
  if (myIndex < 0) return;

  for (let i = 0; i < emitter.instructions.length; i++) {
    const instr = emitter.instructions[i]!;
    if (instr.opcode === Op.BREAK && instr.operand === myIndex) {
      instr.opcode = Op.JMP;
      instr.operand = loopCtx.breakLabel;
    } else if (instr.opcode === Op.CONTINUE && instr.operand === myIndex) {
      instr.opcode = Op.JMP;
      instr.operand = loopCtx.continueLabel;
    }
  }
}
