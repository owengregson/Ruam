/**
 * Experimental, source-proved resynthesis of local linear word transitions.
 * This is an opt-in prepass: residual JavaScript still requires the current VM.
 * Lookup decomposition is an algorithm change, not a protection qualification.
 * @module algorithm-state/native/word-fusion
 */

import { parse } from "@babel/parser";
import type { Binding, NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { generate, traverse } from "../../babel-compat.js";
import { BABEL_PARSER_PLUGINS } from "../../constants.js";
import { NameRegistry } from "../../naming/registry.js";

export interface WordShiftStep {
  direction: "left" | "right" | "signed-right";
  amount: number;
}

export interface WordFusionRegion {
  sourceStart: number;
  sourceEnd: number;
  stateBinding: string;
  inputProof: "authored-number-coercion" | "stable-local-word-return";
  steps: WordShiftStep[];
  output: "uint32" | "int32";
  columns: number[];
  tableNames: string[];
  verification: { status: "proved"; basisCases: 32; tableEntries: 128 };
}

export interface WordFusionResult {
  code: string;
  regions: WordFusionRegion[];
  declined: { sourceStart: number; reason: string }[];
  scope: {
    experimental: true;
    residualProtection: "requires-current-vm";
    wholeProgramReplacement: false;
    extractionResistance: "unqualified";
    sourceReflection: "not-preserved";
    resourceEquivalence: "not-proved";
    runtimeInputFiltering: false;
  };
}

/** Execute the admitted recurrence; used only at build/verification time. */
export function applyWordSteps(input: number, steps: readonly WordShiftStep[]): number {
  let word = input;
  for (const step of steps) {
    const shifted = step.direction === "left" ? word << step.amount
      : step.direction === "right" ? word >>> step.amount : word >> step.amount;
    word ^= shifted;
  }
  return word >>> 0;
}

/** Build the 32 columns of the linear map using composition of basis images. */
export function composeWordColumns(steps: readonly WordShiftStep[]): number[] {
  let columns = Array.from({ length: 32 }, (_, bit) => (2 ** bit) >>> 0);
  for (const step of steps) {
    columns = columns.map((column) => {
      const shifted = step.direction === "left" ? column << step.amount
        : step.direction === "right" ? column >>> step.amount : column >> step.amount;
      return (column ^ shifted) >>> 0;
    });
  }
  return columns;
}

/** Derive eight nibble tables; no original recurrence survives in the output. */
export function buildWordTables(columns: readonly number[]): number[][] {
  if (columns.length !== 32) throw new Error("word matrix must have 32 columns");
  return Array.from({ length: 8 }, (_, nibble) => Array.from({ length: 16 }, (_, value) => {
    let result = 0;
    for (let bit = 0; bit < 4; bit++) {
      if ((value >>> bit) & 1) result ^= columns[nibble * 4 + bit]!;
    }
    return result >>> 0;
  }));
}

/**
 * Verify every emitted table entry against the admitted source recurrence.
 * The grammar is linear over GF(2), including sign-propagating right shifts;
 * checking each nibble image proves the lookup decomposition for all 2^32 words.
 * This claim does not generalize to arbitrary source expressions.
 */
export function verifyWordTables(steps: readonly WordShiftStep[], tables: readonly (readonly number[])[]): boolean {
  if (tables.length !== 8 || tables.some((row) => row.length !== 16)) return false;
  for (let nibble = 0; nibble < 8; nibble++) {
    for (let value = 0; value < 16; value++) {
      if (tables[nibble]![value] !== applyWordSteps(value * 2 ** (nibble * 4), steps)) return false;
    }
  }
  return true;
}

function shiftStep(statement: t.Statement): { name: string; step: WordShiftStep } | null {
  if (!t.isExpressionStatement(statement) || !t.isAssignmentExpression(statement.expression, { operator: "^=" })) return null;
  const { left, right } = statement.expression;
  if (!t.isIdentifier(left) || !t.isBinaryExpression(right) || !t.isIdentifier(right.left, { name: left.name }) || !t.isNumericLiteral(right.right)) return null;
  if (!["<<", ">>>", ">>"].includes(right.operator) || !Number.isInteger(right.right.value) || right.right.value < 0 || right.right.value > 31) return null;
  return { name: left.name, step: { direction: right.operator === "<<" ? "left" : right.operator === ">>>" ? "right" : "signed-right", amount: right.right.value } };
}

function normalization(statement: t.Statement | undefined, name: string): "uint32" | "int32" | null {
  if (!t.isExpressionStatement(statement) || !t.isAssignmentExpression(statement.expression)) return null;
  const expression = statement.expression;
  if (!t.isIdentifier(expression.left, { name })) return null;
  if (t.isNumericLiteral(expression.right, { value: 0 })) {
    if (expression.operator === ">>>=") return "uint32";
    if (expression.operator === "|=") return "int32";
  }
  if (expression.operator === "=" && t.isBinaryExpression(expression.right) && t.isIdentifier(expression.right.left, { name }) && t.isNumericLiteral(expression.right.right, { value: 0 })) {
    if (expression.right.operator === ">>>") return "uint32";
    if (expression.right.operator === "|") return "int32";
  }
  return null;
}

// This proves the result type on normal completion, without assuming anything
// about arguments or mutable intrinsics. Effects and exceptions stay in source.
function forcesNumber(node: t.Node | null | undefined): boolean {
  if (t.isNumericLiteral(node)) return true;
  if (t.isUnaryExpression(node, { operator: "+" })) return true;
  if (!t.isBinaryExpression(node)) return false;
  if (["<<", ">>", ">>>", "|", "&", "^"].includes(node.operator)) {
    return t.isNumericLiteral(node.left) || t.isNumericLiteral(node.right);
  }
  return false;
}

function stableWordReturn(init: t.Expression, path: NodePath): boolean {
  if (!t.isCallExpression(init) || !t.isIdentifier(init.callee)) return false;
  const binding = path.scope.getBinding(init.callee.name);
  if (!binding?.constant || !binding.path.isFunctionDeclaration()) return false;
  const helper = binding.path;
  if (helper.node.async || helper.node.generator || !helper.node.body.body.length) return false;
  // A script's global function can be changed through the global object.
  if (helper.parentPath.isProgram() && helper.parentPath.node.sourceType !== "module") return false;
  if (!t.isReturnStatement(helper.node.body.body.at(-1))) return false;
  let valid = true;
  helper.get("body").traverse({
    Function(nested) { nested.skip(); },
    ReturnStatement(returnPath) { if (!forcesNumber(returnPath.node.argument)) valid = false; },
  });
  return valid;
}

function proveBinding(binding: Binding | undefined, path: NodePath, firstStatement: t.Statement): { proof?: WordFusionRegion["inputProof"]; reason?: string } {
  if (!binding?.path.isVariableDeclarator() || !t.isIdentifier(binding.path.node.id) || !binding.path.node.init) return { reason: "state needs an initialized lexical binding" };
  const owner = path.getFunctionParent();
  if (!owner || binding.path.getFunctionParent() !== owner || !t.isBlockStatement(owner.node.body)) return { reason: "state must belong to this function" };
  const declaration = binding.path.parentPath;
  if (!declaration.isVariableDeclaration() || declaration.node.kind === "const" || declaration.parentPath.node !== owner.node.body) return { reason: "initializer must dominate the region in the function body" };
  let enclosing = path;
  while (enclosing.parentPath && enclosing.parentPath.node !== owner.node.body) enclosing = enclosing.parentPath;
  const declarationIndex = owner.node.body.body.indexOf(declaration.node);
  const regionIndex = owner.node.body.body.indexOf(enclosing.node as t.Statement);
  // The direct function body itself is the block being examined.
  const actualRegionIndex = path.node === owner.node.body ? owner.node.body.body.indexOf(firstStatement) : regionIndex;
  if (declarationIndex < 0 || actualRegionIndex <= declarationIndex) return { reason: "initializer does not dominate this transition" };
  const init = binding.path.node.init;
  const proof = forcesNumber(init) ? "authored-number-coercion" : stableWordReturn(init, binding.path) ? "stable-local-word-return" : undefined;
  if (!proof) return { reason: "primitive Number entry domain is not source-proved" };
  for (const write of binding.constantViolations) {
    if (!write.isAssignmentExpression() || write.getFunctionParent() !== owner || !t.isIdentifier(write.node.left, { name: binding.identifier.name })) return { reason: "state has an unsupported write or nested writer" };
    const expression = write.node;
    if (expression.operator === "=" && forcesNumber(expression.right)) continue;
    if (["^=", "|=", "&=", "<<=", ">>=", ">>>="].includes(expression.operator) && t.isNumericLiteral(expression.right)) continue;
    if (shiftStep(t.expressionStatement(t.cloneNode(expression)))) continue;
    return { reason: "state has a write without a Number preservation proof" };
  }
  return { proof };
}

/**
 * Resynthesize source-proved adjacent local XOR/constant-shift transitions.
 * Unsupported code is retained verbatim when no region qualifies, and must be
 * protected by the existing VM. TypeScript annotations never establish a domain.
 * @param source JavaScript (the production parser's syntax plugins are accepted).
 * @param options Public naming seed; no seed variation is claimed as protection.
 * @returns Code plus explicit scope, admission, and universal bitvector evidence.
 */
export function compileWordFusionCode(source: string, options: { seed?: number } = {}): WordFusionResult {
  const ast = parse(source, { sourceType: "unambiguous", plugins: [...BABEL_PARSER_PLUGINS] });
  const result: WordFusionResult = {
    code: source, regions: [], declined: [],
    scope: { experimental: true, residualProtection: "requires-current-vm", wholeProgramReplacement: false, extractionResistance: "unqualified", sourceReflection: "not-preserved", resourceEquivalence: "not-proved", runtimeInputFiltering: false },
  };
  const names = new Set<string>();
  let dynamicScope = false;
  traverse(ast, {
    Identifier(path) { names.add(path.node.name); },
    WithStatement() { dynamicScope = true; },
    CallExpression(path) { if (t.isIdentifier(path.node.callee, { name: "eval" })) dynamicScope = true; },
    FunctionDeclaration(path) {
      // Annex B's sloppy block-function copies are not represented reliably by
      // Babel constantViolations. They can replace either state or its helper.
      if (!path.isInStrictMode() && !path.parentPath.isProgram() && !(path.parentPath.isBlockStatement() && path.parentPath.parentPath.isFunction() && path.parentPath.parentPath.node.body === path.parentPath.node)) {
        result.declined.push({ sourceStart: path.node.start ?? -1, reason: "sloppy Annex B function declaration prevents a whole-source lexical state proof" });
      }
    },
  });
  if (dynamicScope) {
    result.declined.push({ sourceStart: 0, reason: "eval/with prevents lexical state and fresh-name proofs" });
    return result;
  }
  if (result.declined.length) return result;
  const registry = new NameRegistry(options.seed ?? 0);
  registry.exclude(names);
  registry.resolveAll();
  const fresh = registry.createDynamicGenerator("algorithm-state.word-fusion.tables");
  const declarations = new Map<t.BlockStatement, t.VariableDeclarator[]>();
  traverse(ast, {
    BlockStatement: { exit(path) {
      const body = path.node.body;
      for (let index = 0; index < body.length; index++) {
        const first = shiftStep(body[index]!);
        if (!first) continue;
        const steps = [first.step];
        let end = index + 1;
        while (end < body.length) {
          const next = shiftStep(body[end]!);
          if (!next || next.name !== first.name) break;
          steps.push(next.step);
          end++;
        }
        if (steps.length < 2) continue;
        const sourceStart = body[index]!.start ?? -1;
        const checked = proveBinding(path.scope.getBinding(first.name), path, body[index]!);
        if (!checked.proof) {
          result.declined.push({ sourceStart, reason: checked.reason! });
          index = end - 1;
          continue;
        }
        const output = normalization(body[end], first.name) ?? "int32";
        if (normalization(body[end], first.name)) end++;
        const columns = composeWordColumns(steps);
        const tables = buildWordTables(columns);
        if (!verifyWordTables(steps, tables)) throw new Error("word fusion proof failed");
        const tableNames = tables.map(() => fresh());
        const ownerBody = path.getFunctionParent()!.node.body as t.BlockStatement;
        const pending = declarations.get(ownerBody) ?? [];
        for (let nibble = 0; nibble < 8; nibble++) {
          pending.push(t.variableDeclarator(t.identifier(tableNames[nibble]!), t.arrayExpression(tables[nibble]!.map((value) => t.numericLiteral(value)))));
        }
        declarations.set(ownerBody, pending);
        const terms = tableNames.map((name, nibble) => t.memberExpression(t.identifier(name), t.binaryExpression("&", t.binaryExpression(">>>", t.identifier(first.name), t.numericLiteral(nibble * 4)), t.numericLiteral(15)), true));
        const fused = terms.slice(1).reduce<t.Expression>((left, right) => t.binaryExpression("^", left, right), terms[0]!);
        const replacement = t.expressionStatement(t.assignmentExpression("=", t.identifier(first.name), t.binaryExpression(output === "uint32" ? ">>>" : "|", fused, t.numericLiteral(0))));
        result.regions.push({ sourceStart, sourceEnd: body[end - 1]!.end ?? -1, stateBinding: first.name, inputProof: checked.proof, steps, output, columns, tableNames, verification: { status: "proved", basisCases: 32, tableEntries: 128 } });
        body.splice(index, end - index, replacement);
      }
    } },
  });
  for (const [body, pending] of declarations) body.body.unshift(t.variableDeclaration("const", pending));
  if (result.regions.length) result.code = generate(ast, { comments: true }).code;
  return result;
}
