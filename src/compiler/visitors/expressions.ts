/**
 * Expression compilation visitors.
 *
 * Every JS expression type is compiled into a bytecode sequence that
 * leaves exactly one value on the VM stack.  Binary/unary operators map
 * directly to opcodes; calls, member access, and optional chaining
 * require multi-step sequences.
 *
 * @module compiler/visitors/expressions
 */

import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import { Op } from "../opcodes.js";
import type { Emitter } from "../emitter.js";
import type { ScopeAnalyzer } from "../scope.js";
import type { CompileContext } from "../index.js";

// ---------------------------------------------------------------------------
// Operator → opcode lookup tables (shared across multiple functions)
// ---------------------------------------------------------------------------

const BINARY_OP_MAP: Record<string, Op> = {
  "+": Op.ADD, "-": Op.SUB, "*": Op.MUL, "/": Op.DIV,
  "%": Op.MOD, "**": Op.POW,
  "&": Op.BIT_AND, "|": Op.BIT_OR, "^": Op.BIT_XOR,
  "<<": Op.SHL, ">>": Op.SHR, ">>>": Op.USHR,
  "==": Op.EQ, "!=": Op.NEQ, "===": Op.SEQ, "!==": Op.SNEQ,
  "<": Op.LT, "<=": Op.LTE, ">": Op.GT, ">=": Op.GTE,
};

const UNARY_OP_MAP: Record<string, Op> = {
  "-": Op.NEG,
  "+": Op.UNARY_PLUS,
  "~": Op.BIT_NOT,
  "!": Op.NOT,
};

// ---------------------------------------------------------------------------
// Top-level expression dispatcher
// ---------------------------------------------------------------------------

export function compileExpression(
  path: NodePath<t.Expression>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  const node = path.node;

  switch (node.type) {
    case "NumericLiteral": {
      const idx = emitter.addNumberConstant(node.value);
      emitter.emit(Op.PUSH_CONST, idx);
      break;
    }

    case "StringLiteral": {
      const idx = emitter.addStringConstant(node.value);
      emitter.emit(Op.PUSH_CONST, idx);
      break;
    }

    case "BooleanLiteral": {
      const idx = emitter.addBooleanConstant(node.value);
      emitter.emit(Op.PUSH_CONST, idx);
      break;
    }

    case "NullLiteral": {
      emitter.emit(Op.PUSH_NULL, 0);
      break;
    }

    case "BigIntLiteral": {
      const idx = emitter.addBigIntConstant(node.value);
      emitter.emit(Op.PUSH_CONST, idx);
      break;
    }

    case "RegExpLiteral": {
      const idx = emitter.addRegexConstant(node.pattern, node.flags);
      emitter.emit(Op.PUSH_CONST, idx);
      break;
    }

    case "TemplateLiteral": {
      compileTemplateLiteral(path as NodePath<t.TemplateLiteral>, emitter, scope, ctx);
      break;
    }

    case "TaggedTemplateExpression": {
      compileTaggedTemplate(path as NodePath<t.TaggedTemplateExpression>, emitter, scope, ctx);
      break;
    }

    case "Identifier": {
      compileIdentifier(node, emitter, scope);
      break;
    }

    case "ThisExpression": {
      emitter.emit(Op.PUSH_THIS, 0);
      break;
    }

    case "BinaryExpression": {
      compileBinaryExpression(path as NodePath<t.BinaryExpression>, emitter, scope, ctx);
      break;
    }

    case "LogicalExpression": {
      compileLogicalExpression(path as NodePath<t.LogicalExpression>, emitter, scope, ctx);
      break;
    }

    case "UnaryExpression": {
      compileUnaryExpression(path as NodePath<t.UnaryExpression>, emitter, scope, ctx);
      break;
    }

    case "UpdateExpression": {
      compileUpdateExpression(path as NodePath<t.UpdateExpression>, emitter, scope, ctx);
      break;
    }

    case "AssignmentExpression": {
      compileAssignmentExpression(path as NodePath<t.AssignmentExpression>, emitter, scope, ctx);
      break;
    }

    case "CallExpression": {
      compileCallExpression(path as NodePath<t.CallExpression>, emitter, scope, ctx);
      break;
    }

    case "NewExpression": {
      compileNewExpression(path as NodePath<t.NewExpression>, emitter, scope, ctx);
      break;
    }

    case "MemberExpression": {
      compileMemberExpression(path as NodePath<t.MemberExpression>, emitter, scope, ctx);
      break;
    }

    case "OptionalMemberExpression": {
      compileOptionalMemberExpression(path as NodePath<t.OptionalMemberExpression>, emitter, scope, ctx);
      break;
    }

    case "ConditionalExpression": {
      compileConditionalExpression(path as NodePath<t.ConditionalExpression>, emitter, scope, ctx);
      break;
    }

    case "SequenceExpression": {
      const exprs = (path as NodePath<t.SequenceExpression>).get("expressions");
      for (let i = 0; i < exprs.length; i++) {
        compileExpression(exprs[i]!, emitter, scope, ctx);
        if (i < exprs.length - 1) emitter.emit(Op.POP, 0);
      }
      break;
    }

    case "ObjectExpression": {
      compileObjectExpression(path as NodePath<t.ObjectExpression>, emitter, scope, ctx);
      break;
    }

    case "ArrayExpression": {
      compileArrayExpression(path as NodePath<t.ArrayExpression>, emitter, scope, ctx);
      break;
    }

    case "ArrowFunctionExpression":
    case "FunctionExpression": {
      ctx.compileNestedFunction(path as NodePath<t.Function>, emitter, scope);
      break;
    }

    case "ClassExpression": {
      ctx.compileClassExpression(path as NodePath<t.ClassExpression>, emitter, scope);
      break;
    }

    case "SpreadElement" as any: {
      compileExpression((path as unknown as NodePath<t.SpreadElement>).get("argument"), emitter, scope, ctx);
      emitter.emit(Op.SPREAD_ARRAY, 0);
      break;
    }

    case "YieldExpression": {
      const yieldPath = path as NodePath<t.YieldExpression>;
      if (yieldPath.node.argument) {
        compileExpression(yieldPath.get("argument") as NodePath<t.Expression>, emitter, scope, ctx);
      } else {
        emitter.emit(Op.PUSH_UNDEFINED, 0);
      }
      emitter.emit(yieldPath.node.delegate ? Op.YIELD_DELEGATE : Op.YIELD, 0);
      break;
    }

    case "AwaitExpression": {
      compileExpression((path as NodePath<t.AwaitExpression>).get("argument"), emitter, scope, ctx);
      emitter.emit(Op.AWAIT, 0);
      break;
    }

    case "MetaProperty": {
      if (node.meta.name === "new" && node.property.name === "target") {
        emitter.emit(Op.PUSH_NEW_TARGET, 0);
      }
      break;
    }

    case "ParenthesizedExpression": {
      compileExpression((path as NodePath<t.ParenthesizedExpression>).get("expression"), emitter, scope, ctx);
      break;
    }

    case "TSAsExpression":
    case "TSNonNullExpression":
    case "TSSatisfiesExpression": {
      compileExpression((path as any).get("expression") as NodePath<t.Expression>, emitter, scope, ctx);
      break;
    }

    case "OptionalCallExpression": {
      compileOptionalCallExpression(path as NodePath<t.OptionalCallExpression>, emitter, scope, ctx);
      break;
    }

    default:
      throw new Error(`Unsupported expression type: ${node.type}`);
  }
}

function compileIdentifier(node: t.Identifier, emitter: Emitter, _scope: ScopeAnalyzer): void {
  if (node.name === "undefined") {
    emitter.emit(Op.PUSH_UNDEFINED, 0);
    return;
  }
  if (node.name === "arguments") {
    emitter.emit(Op.PUSH_ARGUMENTS, 0);
    return;
  }

  const nameIdx = emitter.addStringConstant(node.name);
  emitter.emit(Op.LOAD_SCOPED, nameIdx);
}

function compileBinaryExpression(
  path: NodePath<t.BinaryExpression>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  const node = path.node;

  if (node.operator === "in") {
    compileExpression(path.get("left") as NodePath<t.Expression>, emitter, scope, ctx);
    compileExpression(path.get("right"), emitter, scope, ctx);
    emitter.emit(Op.IN_OP, 0);
    return;
  }

  if (node.operator === "instanceof") {
    compileExpression(path.get("left") as NodePath<t.Expression>, emitter, scope, ctx);
    compileExpression(path.get("right"), emitter, scope, ctx);
    emitter.emit(Op.INSTANCEOF, 0);
    return;
  }

  compileExpression(path.get("left") as NodePath<t.Expression>, emitter, scope, ctx);
  compileExpression(path.get("right"), emitter, scope, ctx);

  const op = BINARY_OP_MAP[node.operator];
  if (op === undefined) throw new Error(`Unsupported binary operator: ${node.operator}`);
  emitter.emit(op, 0);
}

function compileLogicalExpression(
  path: NodePath<t.LogicalExpression>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  const node = path.node;

  compileExpression(path.get("left"), emitter, scope, ctx);

  if (node.operator === "&&") {
    emitter.emit(Op.DUP, 0);
    const jumpIdx = emitter.emit(Op.JMP_FALSE, 0);
    emitter.emit(Op.POP, 0);
    compileExpression(path.get("right"), emitter, scope, ctx);
    emitter.patchJump(jumpIdx, emitter.ip);
  } else if (node.operator === "||") {
    emitter.emit(Op.DUP, 0);
    const jumpIdx = emitter.emit(Op.JMP_TRUE, 0);
    emitter.emit(Op.POP, 0);
    compileExpression(path.get("right"), emitter, scope, ctx);
    emitter.patchJump(jumpIdx, emitter.ip);
  } else if (node.operator === "??") {
    emitter.emit(Op.DUP, 0);
    const jumpIdx = emitter.emit(Op.JMP_NULLISH, 0);
    const skipIdx = emitter.emit(Op.JMP, 0);
    emitter.patchJump(jumpIdx, emitter.ip);
    emitter.emit(Op.POP, 0);
    compileExpression(path.get("right"), emitter, scope, ctx);
    emitter.patchJump(skipIdx, emitter.ip);
  }
}

function compileUnaryExpression(
  path: NodePath<t.UnaryExpression>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  const node = path.node;

  if (node.operator === "typeof") {
    const arg = path.get("argument");
    if (arg.isIdentifier()) {
      const resolved = scope.resolve(arg.node.name);
      if (!resolved || resolved.isOuter) {
        const nameIdx = emitter.addStringConstant(arg.node.name);
        emitter.emit(Op.TYPEOF_GLOBAL, nameIdx);
        return;
      }
    }
    compileExpression(arg, emitter, scope, ctx);
    emitter.emit(Op.TYPEOF, 0);
    return;
  }

  if (node.operator === "delete") {
    const arg = path.get("argument");
    if (arg.isMemberExpression()) {
      const obj = arg.get("object");
      compileExpression(obj, emitter, scope, ctx);
      if (arg.node.computed) {
        compileExpression(arg.get("property") as NodePath<t.Expression>, emitter, scope, ctx);
        emitter.emit(Op.DELETE_PROP_DYNAMIC, 0);
      } else {
        const nameIdx = emitter.addStringConstant((arg.node.property as t.Identifier).name);
        emitter.emit(Op.DELETE_PROP_STATIC, nameIdx);
      }
    } else {
      emitter.emit(Op.PUSH_CONST, emitter.addBooleanConstant(true));
    }
    return;
  }

  if (node.operator === "void") {
    compileExpression(path.get("argument"), emitter, scope, ctx);
    emitter.emit(Op.VOID, 0);
    return;
  }

  compileExpression(path.get("argument"), emitter, scope, ctx);

  const op = UNARY_OP_MAP[node.operator];
  if (op === undefined) throw new Error(`Unsupported unary operator: ${node.operator}`);
  emitter.emit(op, 0);
}

function compileUpdateExpression(
  path: NodePath<t.UpdateExpression>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  const node = path.node;
  const arg = path.get("argument");

  if (arg.isIdentifier()) {
    const nameIdx = emitter.addStringConstant(arg.node.name);
    emitter.emit(Op.LOAD_SCOPED, nameIdx);
    if (!node.prefix) emitter.emit(Op.DUP, 0);
    emitter.emit(Op.PUSH_CONST, emitter.addNumberConstant(1));
    emitter.emit(node.operator === "++" ? Op.ADD : Op.SUB, 0);
    if (node.prefix) emitter.emit(Op.DUP, 0);
    emitter.emit(Op.STORE_SCOPED, nameIdx);
    // For postfix: old value is under the new value on stack, STORE_SCOPED consumed new value
    // For prefix: DUP'd the new value, STORE_SCOPED consumed one copy, the other remains
  } else if (arg.isMemberExpression()) {
    compileMemberExpressionForUpdate(arg, emitter, scope, ctx, node.operator, node.prefix);
  }
}

function compileMemberExpressionForUpdate(
  path: NodePath<t.MemberExpression>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
  operator: "++" | "--",
  prefix: boolean,
): void {
  // Save obj to register to avoid deep-stack issues with SET_PROP
  const rObj = scope.registerAllocator.alloc();
  compileExpression(path.get("object"), emitter, scope, ctx);
  emitter.emit(Op.STORE_REG, rObj);

  if (path.node.computed) {
    const rKey = scope.registerAllocator.alloc();
    const rNewVal = scope.registerAllocator.alloc();

    compileExpression(path.get("property") as NodePath<t.Expression>, emitter, scope, ctx);
    emitter.emit(Op.STORE_REG, rKey);

    // Get current value: obj[key]
    emitter.emit(Op.LOAD_REG, rObj);
    emitter.emit(Op.LOAD_REG, rKey);
    emitter.emit(Op.GET_PROP_DYNAMIC, 0);

    // Compute new value, keeping expression result on stack
    if (!prefix) emitter.emit(Op.DUP, 0); // keep oldVal for postfix result
    emitter.emit(Op.PUSH_CONST, emitter.addNumberConstant(1));
    emitter.emit(operator === "++" ? Op.ADD : Op.SUB, 0);
    if (prefix) emitter.emit(Op.DUP, 0); // keep newVal for prefix result

    // Store back: obj[key] = newVal using registers
    emitter.emit(Op.STORE_REG, rNewVal);
    emitter.emit(Op.LOAD_REG, rObj);
    emitter.emit(Op.LOAD_REG, rKey);
    emitter.emit(Op.LOAD_REG, rNewVal);
    emitter.emit(Op.SET_PROP_DYNAMIC, 0);
    emitter.emit(Op.POP, 0); // remove obj pushed by SET_PROP
  } else {
    const nameIdx = emitter.addStringConstant((path.node.property as t.Identifier).name);

    // Get current value: obj.prop
    emitter.emit(Op.LOAD_REG, rObj);
    emitter.emit(Op.GET_PROP_STATIC, nameIdx);

    // Compute new value, keeping expression result on stack
    if (!prefix) emitter.emit(Op.DUP, 0);
    emitter.emit(Op.PUSH_CONST, emitter.addNumberConstant(1));
    emitter.emit(operator === "++" ? Op.ADD : Op.SUB, 0);
    if (prefix) emitter.emit(Op.DUP, 0);

    // Store back: obj.prop = newVal
    emitter.emit(Op.LOAD_REG, rObj);
    emitter.emit(Op.SWAP, 0);
    emitter.emit(Op.SET_PROP_STATIC, nameIdx);
    emitter.emit(Op.POP, 0); // remove obj pushed by SET_PROP
  }
}

function compileAssignmentExpression(
  path: NodePath<t.AssignmentExpression>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  const node = path.node;
  const left = path.get("left");

  if (node.operator !== "=" && node.operator !== "&&=" && node.operator !== "||=" && node.operator !== "??=") {
    compileCompoundAssignment(path, emitter, scope, ctx);
    return;
  }

  if (node.operator === "&&=" || node.operator === "||=" || node.operator === "??=") {
    compileLogicalAssignment(path, emitter, scope, ctx);
    return;
  }

  if (left.isIdentifier()) {
    compileExpression(path.get("right") as NodePath<t.Expression>, emitter, scope, ctx);
    emitter.emit(Op.DUP, 0);
    const nameIdx = emitter.addStringConstant(left.node.name);
    emitter.emit(Op.STORE_SCOPED, nameIdx);
  } else if (left.isMemberExpression()) {
    if (left.node.computed) {
      // Use registers for computed member to avoid deep-stack ROT3 issues
      const rObj = scope.registerAllocator.alloc();
      const rKey = scope.registerAllocator.alloc();
      const rVal = scope.registerAllocator.alloc();

      compileExpression(left.get("object"), emitter, scope, ctx);
      emitter.emit(Op.STORE_REG, rObj);
      compileExpression(left.get("property") as NodePath<t.Expression>, emitter, scope, ctx);
      emitter.emit(Op.STORE_REG, rKey);
      compileExpression(path.get("right") as NodePath<t.Expression>, emitter, scope, ctx);
      emitter.emit(Op.DUP, 0); // expression result stays on stack

      emitter.emit(Op.STORE_REG, rVal);
      emitter.emit(Op.LOAD_REG, rObj);
      emitter.emit(Op.LOAD_REG, rKey);
      emitter.emit(Op.LOAD_REG, rVal);
      emitter.emit(Op.SET_PROP_DYNAMIC, 0);
    } else {
      compileExpression(left.get("object"), emitter, scope, ctx);
      compileExpression(path.get("right") as NodePath<t.Expression>, emitter, scope, ctx);
      emitter.emit(Op.DUP, 0);
      emitter.emit(Op.ROT3, 0);
      const nameIdx = emitter.addStringConstant((left.node.property as t.Identifier).name);
      emitter.emit(Op.SET_PROP_STATIC, nameIdx);
    }
    emitter.emit(Op.POP, 0);
  } else if (left.isArrayPattern() || left.isObjectPattern()) {
    compileExpression(path.get("right") as NodePath<t.Expression>, emitter, scope, ctx);
    emitter.emit(Op.DUP, 0);
    ctx.compileDestructuring(left as NodePath<t.LVal>, emitter, scope);
  }
}

function compileCompoundAssignment(
  path: NodePath<t.AssignmentExpression>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  const node = path.node;
  const left = path.get("left");
  const baseOp = node.operator.slice(0, -1);
  const arithmeticOp = BINARY_OP_MAP[baseOp];
  if (arithmeticOp === undefined) throw new Error(`Unsupported compound assignment: ${node.operator}`);

  if (left.isIdentifier()) {
    const nameIdx = emitter.addStringConstant(left.node.name);
    emitter.emit(Op.LOAD_SCOPED, nameIdx);
    compileExpression(path.get("right") as NodePath<t.Expression>, emitter, scope, ctx);
    emitter.emit(arithmeticOp, 0);
    emitter.emit(Op.DUP, 0);
    emitter.emit(Op.STORE_SCOPED, nameIdx);
  } else if (left.isMemberExpression()) {
    if (left.node.computed) {
      // Use registers for computed member to avoid deep-stack ROT3 issues
      const rObj = scope.registerAllocator.alloc();
      const rKey = scope.registerAllocator.alloc();
      const rNewVal = scope.registerAllocator.alloc();

      compileExpression(left.get("object"), emitter, scope, ctx);
      emitter.emit(Op.STORE_REG, rObj);
      compileExpression(left.get("property") as NodePath<t.Expression>, emitter, scope, ctx);
      emitter.emit(Op.STORE_REG, rKey);

      emitter.emit(Op.LOAD_REG, rObj);
      emitter.emit(Op.LOAD_REG, rKey);
      emitter.emit(Op.GET_PROP_DYNAMIC, 0);

      compileExpression(path.get("right") as NodePath<t.Expression>, emitter, scope, ctx);
      emitter.emit(arithmeticOp, 0);
      emitter.emit(Op.DUP, 0); // expression result

      emitter.emit(Op.STORE_REG, rNewVal);
      emitter.emit(Op.LOAD_REG, rObj);
      emitter.emit(Op.LOAD_REG, rKey);
      emitter.emit(Op.LOAD_REG, rNewVal);
      emitter.emit(Op.SET_PROP_DYNAMIC, 0);
      emitter.emit(Op.POP, 0);
    } else {
      // Static member: ROT3 works fine (only 3 items deep)
      compileExpression(left.get("object"), emitter, scope, ctx);
      emitter.emit(Op.DUP, 0);
      const nameIdx = emitter.addStringConstant((left.node.property as t.Identifier).name);
      emitter.emit(Op.GET_PROP_STATIC, nameIdx);

      compileExpression(path.get("right") as NodePath<t.Expression>, emitter, scope, ctx);
      emitter.emit(arithmeticOp, 0);
      emitter.emit(Op.DUP, 0);
      emitter.emit(Op.ROT3, 0);
      emitter.emit(Op.SET_PROP_STATIC, nameIdx);
      emitter.emit(Op.POP, 0);
    }
  }
}

function compileLogicalAssignment(
  path: NodePath<t.AssignmentExpression>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  const node = path.node;
  const left = path.get("left");

  if (!left.isIdentifier()) throw new Error("Logical assignment only supported for identifiers");

  const nameIdx = emitter.addStringConstant(left.node.name);
  emitter.emit(Op.LOAD_SCOPED, nameIdx);
  emitter.emit(Op.DUP, 0);

  let jumpIdx: number;
  if (node.operator === "&&=") {
    jumpIdx = emitter.emit(Op.JMP_FALSE, 0);
  } else if (node.operator === "||=") {
    jumpIdx = emitter.emit(Op.JMP_TRUE, 0);
  } else {
    const nullJump = emitter.emit(Op.JMP_NULLISH, 0);
    jumpIdx = emitter.emit(Op.JMP, 0);
    emitter.patchJump(nullJump, emitter.ip);
  }

  emitter.emit(Op.POP, 0);
  compileExpression(path.get("right") as NodePath<t.Expression>, emitter, scope, ctx);
  emitter.emit(Op.DUP, 0);
  emitter.emit(Op.STORE_SCOPED, nameIdx);

  emitter.patchJump(jumpIdx!, emitter.ip);
}

function compileCallExpression(
  path: NodePath<t.CallExpression>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  const callee = path.get("callee");
  const args = path.get("arguments");

  if (callee.isMemberExpression()) {
    compileExpression(callee.get("object"), emitter, scope, ctx);
    emitter.emit(Op.DUP, 0);

    if (callee.node.computed) {
      compileExpression(callee.get("property") as NodePath<t.Expression>, emitter, scope, ctx);
      emitter.emit(Op.GET_PROP_DYNAMIC, 0);
    } else {
      const nameIdx = emitter.addStringConstant((callee.node.property as t.Identifier).name);
      emitter.emit(Op.GET_PROP_STATIC, nameIdx);
    }

    emitter.emit(Op.SWAP, 0);

    let hasSpread = false;
    for (const arg of args) {
      if (arg.isSpreadElement()) {
        hasSpread = true;
        compileExpression(arg.get("argument"), emitter, scope, ctx);
        emitter.emit(Op.SPREAD_ARGS, 0);
      } else {
        compileExpression(arg as NodePath<t.Expression>, emitter, scope, ctx);
      }
    }

    emitter.emit(Op.CALL_METHOD, hasSpread ? -(args.length) : args.length);
  } else if (callee.isSuper()) {
    for (const arg of args) {
      if (arg.isSpreadElement()) {
        compileExpression(arg.get("argument"), emitter, scope, ctx);
        emitter.emit(Op.SPREAD_ARGS, 0);
      } else {
        compileExpression(arg as NodePath<t.Expression>, emitter, scope, ctx);
      }
    }
    emitter.emit(Op.SUPER_CALL, args.length);
  } else {
    compileExpression(callee as NodePath<t.Expression>, emitter, scope, ctx);

    let hasSpread = false;
    for (const arg of args) {
      if (arg.isSpreadElement()) {
        hasSpread = true;
        compileExpression(arg.get("argument"), emitter, scope, ctx);
        emitter.emit(Op.SPREAD_ARGS, 0);
      } else {
        compileExpression(arg as NodePath<t.Expression>, emitter, scope, ctx);
      }
    }

    emitter.emit(Op.CALL, hasSpread ? -(args.length) : args.length);
  }
}

function compileOptionalCallExpression(
  path: NodePath<t.OptionalCallExpression>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  const callee = path.get("callee");
  const args = path.get("arguments");

  // If callee is a member expression, we need CALL_METHOD to preserve `this`
  if (callee.isMemberExpression() || callee.isOptionalMemberExpression()) {
    const obj = callee.get("object") as NodePath<t.Expression>;
    compileExpression(obj, emitter, scope, ctx);

    // If the member access is optional (obj?.method), check obj first
    if ((callee.node as t.OptionalMemberExpression).optional) {
      emitter.emit(Op.DUP, 0);
      const objNullJump = emitter.emit(Op.JMP_NULLISH, 0);
      const objOkJump = emitter.emit(Op.JMP, 0);

      emitter.patchJump(objNullJump, emitter.ip);
      emitter.emit(Op.POP, 0); // pop obj
      emitter.emit(Op.PUSH_UNDEFINED, 0);
      const objSkipEnd = emitter.emit(Op.JMP, 0);

      emitter.patchJump(objOkJump, emitter.ip);
      // obj is not null — get the method
      emitter.emit(Op.DUP, 0);
      if (callee.node.computed) {
        compileExpression(callee.get("property") as NodePath<t.Expression>, emitter, scope, ctx);
        emitter.emit(Op.GET_PROP_DYNAMIC, 0);
      } else {
        const nameIdx = emitter.addStringConstant((callee.node.property as t.Identifier).name);
        emitter.emit(Op.GET_PROP_STATIC, nameIdx);
      }

      // Check if fn is nullish (for the ?. call part)
      emitter.emit(Op.DUP, 0);
      const fnNullJump = emitter.emit(Op.JMP_NULLISH, 0);
      const fnOkJump = emitter.emit(Op.JMP, 0);

      emitter.patchJump(fnNullJump, emitter.ip);
      emitter.emit(Op.POP, 0); // pop fn
      emitter.emit(Op.POP, 0); // pop obj
      emitter.emit(Op.PUSH_UNDEFINED, 0);
      const fnSkipEnd = emitter.emit(Op.JMP, 0);

      emitter.patchJump(fnOkJump, emitter.ip);
      emitter.emit(Op.SWAP, 0); // [fn, obj] for CALL_METHOD
      let hasSpread = false;
      for (const arg of args) {
        if (arg.isSpreadElement()) {
          hasSpread = true;
          compileExpression(arg.get("argument"), emitter, scope, ctx);
          emitter.emit(Op.SPREAD_ARGS, 0);
        } else {
          compileExpression(arg as NodePath<t.Expression>, emitter, scope, ctx);
        }
      }
      emitter.emit(Op.CALL_METHOD, hasSpread ? -(args.length) : args.length);

      emitter.patchJump(objSkipEnd, emitter.ip);
      emitter.patchJump(fnSkipEnd, emitter.ip);
    } else {
      // Non-optional member (e.g., obj.method?.()), just get the method
      emitter.emit(Op.DUP, 0);
      if (callee.node.computed) {
        compileExpression(callee.get("property") as NodePath<t.Expression>, emitter, scope, ctx);
        emitter.emit(Op.GET_PROP_DYNAMIC, 0);
      } else {
        const nameIdx = emitter.addStringConstant((callee.node.property as t.Identifier).name);
        emitter.emit(Op.GET_PROP_STATIC, nameIdx);
      }

      // Check if fn is nullish
      emitter.emit(Op.DUP, 0);
      const fnNullJump = emitter.emit(Op.JMP_NULLISH, 0);
      const fnOkJump = emitter.emit(Op.JMP, 0);

      emitter.patchJump(fnNullJump, emitter.ip);
      emitter.emit(Op.POP, 0); // pop fn
      emitter.emit(Op.POP, 0); // pop obj
      emitter.emit(Op.PUSH_UNDEFINED, 0);
      const fnSkipEnd = emitter.emit(Op.JMP, 0);

      emitter.patchJump(fnOkJump, emitter.ip);
      emitter.emit(Op.SWAP, 0); // [fn, obj] for CALL_METHOD
      let hasSpread = false;
      for (const arg of args) {
        if (arg.isSpreadElement()) {
          hasSpread = true;
          compileExpression(arg.get("argument"), emitter, scope, ctx);
          emitter.emit(Op.SPREAD_ARGS, 0);
        } else {
          compileExpression(arg as NodePath<t.Expression>, emitter, scope, ctx);
        }
      }
      emitter.emit(Op.CALL_METHOD, hasSpread ? -(args.length) : args.length);

      emitter.patchJump(fnSkipEnd, emitter.ip);
    }
    return;
  }

  // Standalone optional call: fn?.(args)
  compileExpression(callee as NodePath<t.Expression>, emitter, scope, ctx);
  emitter.emit(Op.DUP, 0);
  const skipJump = emitter.emit(Op.JMP_NULLISH, 0);
  const proceedJump = emitter.emit(Op.JMP, 0);

  emitter.patchJump(skipJump, emitter.ip);
  emitter.emit(Op.POP, 0);
  emitter.emit(Op.PUSH_UNDEFINED, 0);
  const endJump = emitter.emit(Op.JMP, 0);

  emitter.patchJump(proceedJump, emitter.ip);

  for (const arg of args) {
    if (arg.isSpreadElement()) {
      compileExpression(arg.get("argument"), emitter, scope, ctx);
      emitter.emit(Op.SPREAD_ARGS, 0);
    } else {
      compileExpression(arg as NodePath<t.Expression>, emitter, scope, ctx);
    }
  }
  emitter.emit(Op.CALL, args.length);

  emitter.patchJump(endJump, emitter.ip);
}

function compileNewExpression(
  path: NodePath<t.NewExpression>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  compileExpression(path.get("callee") as NodePath<t.Expression>, emitter, scope, ctx);

  const args = path.get("arguments");
  for (const arg of args) {
    if (arg.isSpreadElement()) {
      compileExpression(arg.get("argument"), emitter, scope, ctx);
      emitter.emit(Op.SPREAD_ARGS, 0);
    } else {
      compileExpression(arg as NodePath<t.Expression>, emitter, scope, ctx);
    }
  }

  emitter.emit(Op.CALL_NEW, args.length);
}

export function compileMemberExpression(
  path: NodePath<t.MemberExpression>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  compileExpression(path.get("object"), emitter, scope, ctx);

  if (path.node.computed) {
    compileExpression(path.get("property") as NodePath<t.Expression>, emitter, scope, ctx);
    emitter.emit(Op.GET_PROP_DYNAMIC, 0);
  } else {
    const nameIdx = emitter.addStringConstant((path.node.property as t.Identifier).name);
    emitter.emit(Op.GET_PROP_STATIC, nameIdx);
  }
}

function compileOptionalMemberExpression(
  path: NodePath<t.OptionalMemberExpression>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  compileExpression(path.get("object"), emitter, scope, ctx);

  if (path.node.optional) {
    emitter.emit(Op.DUP, 0);
    const nullJump = emitter.emit(Op.JMP_NULLISH, 0);
    const proceedJump = emitter.emit(Op.JMP, 0);

    emitter.patchJump(nullJump, emitter.ip);
    emitter.emit(Op.POP, 0);
    emitter.emit(Op.PUSH_UNDEFINED, 0);
    const endJump = emitter.emit(Op.JMP, 0);

    emitter.patchJump(proceedJump, emitter.ip);
    if (path.node.computed) {
      compileExpression(path.get("property") as NodePath<t.Expression>, emitter, scope, ctx);
      emitter.emit(Op.GET_PROP_DYNAMIC, 0);
    } else {
      const nameIdx = emitter.addStringConstant((path.node.property as t.Identifier).name);
      emitter.emit(Op.GET_PROP_STATIC, nameIdx);
    }
    emitter.patchJump(endJump, emitter.ip);
  } else {
    if (path.node.computed) {
      compileExpression(path.get("property") as NodePath<t.Expression>, emitter, scope, ctx);
      emitter.emit(Op.GET_PROP_DYNAMIC, 0);
    } else {
      const nameIdx = emitter.addStringConstant((path.node.property as t.Identifier).name);
      emitter.emit(Op.GET_PROP_STATIC, nameIdx);
    }
  }
}

function compileConditionalExpression(
  path: NodePath<t.ConditionalExpression>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  compileExpression(path.get("test"), emitter, scope, ctx);
  const falseJump = emitter.emit(Op.JMP_FALSE, 0);
  compileExpression(path.get("consequent"), emitter, scope, ctx);
  const endJump = emitter.emit(Op.JMP, 0);
  emitter.patchJump(falseJump, emitter.ip);
  compileExpression(path.get("alternate"), emitter, scope, ctx);
  emitter.patchJump(endJump, emitter.ip);
}

function compileObjectExpression(
  path: NodePath<t.ObjectExpression>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  emitter.emit(Op.NEW_OBJECT, 0);

  for (const prop of path.get("properties")) {
    if (prop.isObjectProperty()) {
      emitter.emit(Op.DUP, 0);

      if (prop.node.computed) {
        compileExpression(prop.get("key") as NodePath<t.Expression>, emitter, scope, ctx);
        compileExpression(prop.get("value") as NodePath<t.Expression>, emitter, scope, ctx);
        emitter.emit(Op.SET_PROP_DYNAMIC, 0);
      } else {
        const key = prop.node.key;
        let keyName: string;
        if (key.type === "Identifier") keyName = key.name;
        else if (key.type === "StringLiteral") keyName = key.value;
        else if (key.type === "NumericLiteral") keyName = String(key.value);
        else throw new Error(`Unsupported object key type: ${key.type}`);

        compileExpression(prop.get("value") as NodePath<t.Expression>, emitter, scope, ctx);
        const nameIdx = emitter.addStringConstant(keyName);
        emitter.emit(Op.SET_PROP_STATIC, nameIdx);
      }

      emitter.emit(Op.POP, 0);
    } else if (prop.isObjectMethod()) {
      emitter.emit(Op.DUP, 0);
      const method = prop as NodePath<t.ObjectMethod>;
      ctx.compileNestedFunction(method as unknown as NodePath<t.Function>, emitter, scope);

      const key = method.node.key;
      let keyName: string;
      if (key.type === "Identifier") keyName = key.name;
      else if (key.type === "StringLiteral") keyName = key.value;
      else throw new Error(`Unsupported method key type: ${key.type}`);

      const nameIdx = emitter.addStringConstant(keyName);

      if (method.node.kind === "get") {
        emitter.emit(Op.DEFINE_GETTER, nameIdx);
      } else if (method.node.kind === "set") {
        emitter.emit(Op.DEFINE_SETTER, nameIdx);
      } else {
        emitter.emit(Op.SET_PROP_STATIC, nameIdx);
      }
      emitter.emit(Op.POP, 0);
    } else if (prop.isSpreadElement()) {
      compileExpression(prop.get("argument"), emitter, scope, ctx);
      emitter.emit(Op.SPREAD_ARRAY, 0);
    }
  }
}

function compileArrayExpression(
  path: NodePath<t.ArrayExpression>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  emitter.emit(Op.NEW_ARRAY, 0);

  for (const elem of path.get("elements")) {
    if (elem.node === null) {
      emitter.emit(Op.PUSH_UNDEFINED, 0);
      emitter.emit(Op.ARRAY_PUSH, 0);
    } else if (elem.isSpreadElement()) {
      compileExpression(elem.get("argument"), emitter, scope, ctx);
      emitter.emit(Op.SPREAD_ARRAY, 0);
    } else {
      compileExpression(elem as NodePath<t.Expression>, emitter, scope, ctx);
      emitter.emit(Op.ARRAY_PUSH, 0);
    }
  }
}

function compileTemplateLiteral(
  path: NodePath<t.TemplateLiteral>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  const quasis = path.get("quasis");
  const expressions = path.get("expressions");

  if (expressions.length === 0) {
    const idx = emitter.addStringConstant(quasis[0]!.node.value.cooked ?? quasis[0]!.node.value.raw);
    emitter.emit(Op.PUSH_CONST, idx);
    return;
  }

  const firstQuasi = quasis[0]!.node.value.cooked ?? quasis[0]!.node.value.raw;
  const idx = emitter.addStringConstant(firstQuasi);
  emitter.emit(Op.PUSH_CONST, idx);

  for (let i = 0; i < expressions.length; i++) {
    compileExpression(expressions[i] as NodePath<t.Expression>, emitter, scope, ctx);
    emitter.emit(Op.ADD, 0);
    const quasi = quasis[i + 1]!.node.value.cooked ?? quasis[i + 1]!.node.value.raw;
    const qIdx = emitter.addStringConstant(quasi);
    emitter.emit(Op.PUSH_CONST, qIdx);
    emitter.emit(Op.ADD, 0);
  }
}

function compileTaggedTemplate(
  path: NodePath<t.TaggedTemplateExpression>,
  emitter: Emitter,
  scope: ScopeAnalyzer,
  ctx: CompileContext,
): void {
  compileExpression(path.get("tag"), emitter, scope, ctx);

  const quasis = path.get("quasi").get("quasis");
  const expressions = path.get("quasi").get("expressions");

  emitter.emit(Op.NEW_ARRAY, 0);
  for (const q of quasis) {
    const val = q.node.value.cooked ?? q.node.value.raw;
    const idx = emitter.addStringConstant(val);
    emitter.emit(Op.PUSH_CONST, idx);
    emitter.emit(Op.ARRAY_PUSH, 0);
  }

  for (const expr of expressions) {
    compileExpression(expr as NodePath<t.Expression>, emitter, scope, ctx);
  }

  emitter.emit(Op.CALL, 1 + expressions.length);
}
