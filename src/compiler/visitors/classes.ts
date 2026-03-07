/**
 * Class expression and declaration compilation.
 *
 * Handles the `class` keyword by emitting `NEW_CLASS`, then compiling each
 * method / property as a child bytecode unit.  Instance field initialisers
 * are injected into the constructor body before compilation.
 *
 * @module compiler/visitors/classes
 */

import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import { Op } from "../opcodes.js";
import type { Emitter } from "../emitter.js";
import type { ScopeAnalyzer } from "../scope.js";
import type { CompileContext } from "../index.js";
import type { BytecodeUnit } from "../../types.js";
import { compileExpression } from "./expressions.js";

/**
 * Compile a `ClassExpression` node.
 *
 * The resulting class constructor is left on the stack.  Callers are
 * responsible for storing it (e.g. via `STORE_SCOPED` for declarations).
 */
export function compileClassExpr(
  classPath: NodePath<t.ClassExpression>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
  allUnits: BytecodeUnit[],
  compileFunctionInner: (fnPath: NodePath<t.Function>, allUnits: BytecodeUnit[]) => BytecodeUnit,
): void {
  const classNode = classPath.node;

  // --- Inject instance property initialisers into the constructor ----------
  injectInstanceProperties(classNode);

  // --- Emit NEW_CLASS (optionally with superclass) -------------------------
  if (classNode.superClass) {
    compileExpression(classPath.get("superClass") as NodePath<t.Expression>, emitter, scope, ctx);
    emitter.emit(Op.NEW_CLASS, 1);
  } else {
    emitter.emit(Op.NEW_CLASS, 0);
  }

  // --- Compile each class member -------------------------------------------
  const body = classPath.get("body").get("body");
  for (const member of body) {
    if (member.isClassMethod()) {
      compileClassMethod(member, emitter, scope, ctx, allUnits, compileFunctionInner);
    } else if (member.isClassProperty() && member.node.static) {
      compileStaticProperty(member, emitter, scope, ctx);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Move instance (non-static) class property initialisers into the
 * constructor body so they execute as `this.x = value`.
 *
 * If no constructor exists, a synthetic one is created (with `super()`
 * forwarding if the class extends a superclass).
 */
function injectInstanceProperties(classNode: t.ClassExpression): void {
  const inits: t.Statement[] = [];

  for (const member of classNode.body.body) {
    if (member.type === "ClassProperty" && !member.static && member.value) {
      const key = member.key;
      if (key.type === "Identifier") {
        inits.push({
          type: "ExpressionStatement",
          expression: {
            type: "AssignmentExpression",
            operator: "=",
            left: {
              type: "MemberExpression",
              object: { type: "ThisExpression" } as t.ThisExpression,
              property: { type: "Identifier", name: key.name } as t.Identifier,
              computed: false,
            } as t.MemberExpression,
            right: member.value,
          } as t.AssignmentExpression,
        } as t.ExpressionStatement);
      }
    }
  }

  if (inits.length === 0) return;

  // Try to inject into an existing constructor
  for (const member of classNode.body.body) {
    if (member.type === "ClassMethod" && member.kind === "constructor") {
      const superIdx = member.body.body.findIndex(stmt =>
        stmt.type === "ExpressionStatement" &&
        stmt.expression.type === "CallExpression" &&
        stmt.expression.callee.type === "Super"
      );
      if (superIdx >= 0) {
        member.body.body.splice(superIdx + 1, 0, ...inits);
      } else {
        member.body.body.unshift(...inits);
      }
      return;
    }
  }

  // No constructor — create a synthetic one
  const ctorBody: t.Statement[] = [];
  if (classNode.superClass) {
    ctorBody.push({
      type: "ExpressionStatement",
      expression: {
        type: "CallExpression",
        callee: { type: "Super" } as t.Super,
        arguments: [{
          type: "SpreadElement",
          argument: { type: "Identifier", name: "arguments" } as t.Identifier,
        } as t.SpreadElement],
      } as t.CallExpression,
    } as t.ExpressionStatement);
  }
  ctorBody.push(...inits);

  classNode.body.body.unshift({
    type: "ClassMethod",
    kind: "constructor",
    key: { type: "Identifier", name: "constructor" } as t.Identifier,
    params: [],
    body: { type: "BlockStatement", body: ctorBody, directives: [] } as t.BlockStatement,
    computed: false,
    static: false,
    generator: false,
    async: false,
  } as t.ClassMethod);
}

/** Compile a class method (constructor, regular, getter, or setter). */
function compileClassMethod(
  member: NodePath<t.ClassMethod>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
  allUnits: BytecodeUnit[],
  compileFunctionInner: (fnPath: NodePath<t.Function>, allUnits: BytecodeUnit[]) => BytecodeUnit,
): void {
  emitter.emit(Op.DUP, 0);

  if (member.node.computed) {
    // Computed method name: [expr]() { ... }
    // Stack after DUP: [class, class]
    const isStatic = member.node.static;
    const isAccessor = member.node.kind === "get" || member.node.kind === "set";

    // For instance methods, resolve prototype as the assignment target
    if (!isStatic) {
      const protoIdx = emitter.addStringConstant("prototype");
      emitter.emit(Op.GET_PROP_STATIC, protoIdx); // [class, proto]
    }
    // Stack: [class, target]

    // Save target to register for home object stamping
    const rTarget = scope.registerAllocator.alloc();
    emitter.emit(Op.DUP, 0);              // [class, target, target]
    emitter.emit(Op.STORE_REG, rTarget);   // [class, target]

    // Compile key expression onto the stack
    compileExpression(member.get("key") as NodePath<t.Expression>, emitter, scope, ctx);
    // Stack: [class, target, key]

    // Compile method body as a closure
    const childUnit = compileFunctionInner(member as unknown as NodePath<t.Function>, allUnits);
    allUnits.push(childUnit);
    const idIdx = emitter.addStringConstant(childUnit.id);
    emitter.emit(Op.NEW_CLOSURE, idIdx);
    // Stack: [class, target, key, fn]

    // Stamp fn._ho = target (home object for super resolution)
    const hoIdx = emitter.addStringConstant("_ho");
    emitter.emit(Op.DUP, 0);              // [class, target, key, fn, fn]
    emitter.emit(Op.LOAD_REG, rTarget);    // [class, target, key, fn, fn, target]
    emitter.emit(Op.SET_PROP_STATIC, hoIdx); // [class, target, key, fn, fn]
    emitter.emit(Op.POP, 0);              // [class, target, key, fn]

    if (isAccessor) {
      // Build a property descriptor: {get/set: fn, configurable: true, enumerable: false}
      emitter.emit(Op.NEW_OBJECT, 0);    // [class, target, key, fn, {}]
      emitter.emit(Op.SWAP, 0);          // [class, target, key, {}, fn]
      const descKeyIdx = emitter.addStringConstant(member.node.kind); // "get" or "set"
      emitter.emit(Op.SET_PROP_STATIC, descKeyIdx); // [class, target, key, {get/set: fn}]

      // Add configurable: true
      emitter.emit(Op.DUP, 0);           // [class, target, key, desc, desc]
      emitter.emit(Op.PUSH_TRUE, 0);     // [class, target, key, desc, desc, true]
      const confIdx = emitter.addStringConstant("configurable");
      emitter.emit(Op.SET_PROP_STATIC, confIdx); // [class, target, key, desc, desc']
      emitter.emit(Op.POP, 0);           // [class, target, key, desc]

      // Add enumerable: false
      emitter.emit(Op.DUP, 0);           // [class, target, key, desc, desc]
      emitter.emit(Op.PUSH_FALSE, 0);    // [class, target, key, desc, desc, false]
      const enumIdx = emitter.addStringConstant("enumerable");
      emitter.emit(Op.SET_PROP_STATIC, enumIdx); // [class, target, key, desc, desc']
      emitter.emit(Op.POP, 0);           // [class, target, key, desc]

      // Object.defineProperty(target, key, desc) -> pushes target
      emitter.emit(Op.DEFINE_OWN_PROPERTY, 0); // [class, target]
      emitter.emit(Op.POP, 0);           // [class]
    } else {
      // Simple assignment: target[key] = fn -> pushes target
      emitter.emit(Op.SET_PROP_DYNAMIC, 0); // [class, target]
      emitter.emit(Op.POP, 0);              // [class]
    }
    return;
  }

  const childUnit = compileFunctionInner(member as unknown as NodePath<t.Function>, allUnits);
  allUnits.push(childUnit);
  const idIdx = emitter.addStringConstant(childUnit.id);
  emitter.emit(Op.NEW_CLOSURE, idIdx);

  const key = member.node.key;
  let keyName: string;
  if (key.type === "Identifier") keyName = key.name;
  else if (key.type === "StringLiteral") keyName = key.value;
  else throw new Error(`Unsupported class method key: ${key.type}`);

  const nameIdx = emitter.addStringConstant(keyName);
  const isStatic = member.node.static ? 1 : 0;

  if (member.node.kind === "constructor") {
    emitter.emit(Op.DEFINE_METHOD, nameIdx);
  } else if (member.node.kind === "get") {
    emitter.emit(Op.DEFINE_GETTER, nameIdx | (isStatic << 16));
  } else if (member.node.kind === "set") {
    emitter.emit(Op.DEFINE_SETTER, nameIdx | (isStatic << 16));
  } else {
    emitter.emit(Op.DEFINE_METHOD, nameIdx | (isStatic << 16));
  }

  emitter.emit(Op.POP, 0);
}

/** Compile a static class property. */
function compileStaticProperty(
  member: NodePath<t.ClassProperty>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  if (!member.node.value) return;

  emitter.emit(Op.DUP, 0);
  compileExpression(member.get("value") as NodePath<t.Expression>, emitter, scope, ctx);

  const key = member.node.key;
  if (key.type === "Identifier") {
    const nameIdx = emitter.addStringConstant(key.name);
    emitter.emit(Op.SET_PROP_STATIC, nameIdx);
  } else if (member.node.computed) {
    compileExpression(member.get("key") as NodePath<t.Expression>, emitter, scope, ctx);
    emitter.emit(Op.SET_PROP_DYNAMIC, 0);
  }

  emitter.emit(Op.POP, 0);
}
