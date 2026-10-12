/**
 * Conservative effect/escape inventory and a literal-call infrastructure control.
 * Inlining closed constructors is not algorithm/state protection qualification.
 * @module algorithm-state/native/closed-expressions
 */
import { parse } from "@babel/parser";
import type { Binding, NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { generate, traverse } from "../../babel-compat.js";
import { BABEL_PARSER_PLUGINS } from "../../constants.js";

export interface ClosedExpressionRecord {
  id: number;
  name: string;
  line: number | null;
  kind: string;
  directCalls: number;
  escapingReferences: number;
  effects: Record<"propertyAccess" | "call" | "construct" | "suspend" | "write" | "nestedFunction" | "coercion", number>;
  dependencies: number[];
  status: "admitted-infrastructure-control" | "residual";
  reasons: string[];
}
export interface ClosedExpressionReport {
  functions: ClosedExpressionRecord[];
  declined: Array<{ sourceStart: number; reason: string }>;
  admittedFunctions: number;
  fusedCallSites: number;
  scope: {
    protectionQualified: false;
    algorithmReplacement: false;
    residualBackend: "current-vm";
    analysis: "closed-expression-functions-only";
    effectOrder: "no-callback-operations-inside-admitted-region";
    sourceReflection: "not-preserved";
    resourceEquivalence: "not-proved";
  };
}
interface Candidate {
  path: NodePath<t.FunctionDeclaration>;
  binding: Binding;
  params: string[];
  expression: t.Expression;
  record: ClosedExpressionRecord;
}

function literal(node: t.Node | null | undefined): boolean {
  if (t.isNumericLiteral(node) || t.isStringLiteral(node) || t.isBooleanLiteral(node) || t.isNullLiteral(node) || t.isBigIntLiteral(node)) return true;
  return t.isUnaryExpression(node) && ["+", "-"].includes(node.operator) && t.isNumericLiteral(node.argument);
}

/**
 * Inventory all functions, then fuse only closed, effect-free literal call graphs.
 * @param source Source accepted by the existing parser configuration.
 * @returns Transformed source and explicit admission/rejection evidence.
 */
export function compileClosedExpressionFusion(source: string): { code: string; report: ClosedExpressionReport } {
  const ast = parse(source, { sourceType: "unambiguous", plugins: [...BABEL_PARSER_PLUGINS] });
  const records: ClosedExpressionRecord[] = [];
  const report: ClosedExpressionReport = { functions: records, declined: [], admittedFunctions: 0, fusedCallSites: 0, scope: { protectionQualified: false, algorithmReplacement: false, residualBackend: "current-vm", analysis: "closed-expression-functions-only", effectOrder: "no-callback-operations-inside-admitted-region", sourceReflection: "not-preserved", resourceEquivalence: "not-proved" } };
  const candidates = new Map<Binding, Candidate>();
  const byFunction = new Map<t.Node, Candidate>();
  const callTargets = new Map<t.Node, Candidate>();
  let dynamicScope = false;
  traverse(ast, {
    WithStatement() { dynamicScope = true; },
    CallExpression(path) { if (t.isIdentifier(path.node.callee, { name: "eval" })) dynamicScope = true; },
    Function(path) {
      // Annex B may copy a block/switch/label declaration into a surrounding
      // var binding without Babel reporting a constantViolation on that binding.
      // Strictness is the declaration's enclosing context, not its own body.
      if (path.isFunctionDeclaration() && !path.isInStrictMode() && !path.parentPath.isProgram() && !(path.parentPath.isBlockStatement() && path.parentPath.parentPath.isFunction() && path.parentPath.parentPath.node.body === path.parentPath.node)) {
        report.declined.push({ sourceStart: path.node.start ?? -1, reason: "sloppy Annex B function declaration prevents a whole-source lexical binding proof" });
      }
      const binding = path.isFunctionDeclaration() && path.node.id ? path.scope.parent?.getBinding(path.node.id.name) : undefined;
      const references = binding?.referencePaths ?? [];
      const directCalls = references.filter((reference) => reference.parentPath?.isCallExpression() && reference.parentPath.node.callee === reference.node && !reference.parentPath.node.optional).length;
      const effects: ClosedExpressionRecord["effects"] = { propertyAccess: 0, call: 0, construct: 0, suspend: 0, write: 0, nestedFunction: 0, coercion: 0 };
      path.traverse({
        Function(nested) { effects.nestedFunction++; nested.skip(); },
        "MemberExpression|OptionalMemberExpression"() { effects.propertyAccess++; },
        "CallExpression|OptionalCallExpression"() { effects.call++; },
        NewExpression() { effects.construct++; },
        "AwaitExpression|YieldExpression"() { effects.suspend++; },
        "AssignmentExpression|UpdateExpression"() { effects.write++; },
        BinaryExpression(inner) { if (!["===", "!=="].includes(inner.node.operator)) effects.coercion++; },
      });
      const record: ClosedExpressionRecord = { id: path.node.start ?? records.length, name: ("id" in path.node && path.node.id?.name) || "<anonymous>", line: path.node.loc?.start.line ?? null, kind: path.node.type, directCalls, escapingReferences: references.length - directCalls, effects, dependencies: [], status: "residual", reasons: [] };
      records.push(record);
      if (!path.isFunctionDeclaration() || !binding) { record.reasons.push("function kind has no admitted stable lexical binding"); return; }
      if (path.parentPath.isProgram() && path.parentPath.node.sourceType === "script") record.reasons.push("script-global function can escape through the host global object");
      if (!path.parentPath.isProgram() && !(path.parentPath.isBlockStatement() && path.parentPath.parentPath.isFunction() && path.parentPath.parentPath.node.body === path.parentPath.node)) record.reasons.push("block declaration needs an Annex B or export-binding proof");
      if (path.parentPath.isExportDeclaration()) record.reasons.push("exported function escapes the closed graph");
      if (!binding.constant || record.escapingReferences) record.reasons.push("binding is mutable or has a non-direct-call reference");
      if (!directCalls) record.reasons.push("no direct consumers");
      if (path.node.async || path.node.generator || path.node.params.some((parameter) => !t.isIdentifier(parameter))) record.reasons.push("async/generator/default/destructured/rest parameters require residual semantics");
      if (path.node.body.body.length !== 1 || !t.isReturnStatement(path.node.body.body[0]) || !t.isExpression(path.node.body.body[0].argument)) { record.reasons.push("body is not a single expression return"); return; }
      const candidate = { path, binding, params: path.node.params.filter((parameter): parameter is t.Identifier => t.isIdentifier(parameter)).map((parameter) => parameter.name), expression: path.node.body.body[0].argument, record };
      if (new Set(candidate.params).size !== candidate.params.length) record.reasons.push("duplicate parameters require argument-binding semantics");
      candidates.set(binding, candidate);
      byFunction.set(path.node, candidate);
    },
  });

  if (report.declined.length) {
    for (const record of records) record.reasons.push("whole source declined: sloppy Annex B declarations may rebind otherwise stable functions");
    return { code: source, report };
  }

  function scalar(node: t.Node, parameters: readonly string[]): boolean {
    if (literal(node) || (t.isIdentifier(node) && parameters.includes(node.name))) return true;
    if (t.isLogicalExpression(node)) return scalar(node.left, parameters) && scalar(node.right, parameters);
    if (t.isConditionalExpression(node)) return scalar(node.test, parameters) && scalar(node.consequent, parameters) && scalar(node.alternate, parameters);
    if (t.isUnaryExpression(node) && ["!", "void", "typeof"].includes(node.operator)) return scalar(node.argument, parameters);
    return t.isBinaryExpression(node) && ["===", "!=="].includes(node.operator) && scalar(node.left, parameters) && scalar(node.right, parameters);
  }
  function expression(node: t.Node, owner: Candidate): boolean {
    if (scalar(node, owner.params)) return true;
    if (t.isObjectExpression(node)) return node.properties.every((property) => t.isObjectProperty(property) && !property.computed && (t.isIdentifier(property.key) || t.isStringLiteral(property.key) || t.isNumericLiteral(property.key)) && expression(property.value, owner));
    if (t.isArrayExpression(node)) return node.elements.every((element) => element === null || expression(element, owner));
    if (t.isConditionalExpression(node)) return scalar(node.test, owner.params) && expression(node.consequent, owner) && expression(node.alternate, owner);
    if (!t.isCallExpression(node) || node.optional || !t.isIdentifier(node.callee) || node.arguments.some((argument) => !scalar(argument, owner.params))) return false;
    const targetBinding = owner.path.scope.getBinding(node.callee.name);
    const target = targetBinding && candidates.get(targetBinding);
    if (!target) return false;
    callTargets.set(node, target);
    owner.record.dependencies.push(target.record.id);
    return true;
  }
  for (const candidate of candidates.values()) {
    if (dynamicScope) candidate.record.reasons.push("eval/with prevents a closed lexical escape proof");
    if (!expression(candidate.expression, candidate)) candidate.record.reasons.push("expression includes property access, mutable calls, coercions, closures, spread, or nonlocal state");
  }
  const eligible = new Set([...candidates.values()].filter((candidate) => !candidate.record.reasons.length));
  function cyclic(candidate: Candidate, active: Set<Candidate>): boolean {
    if (active.has(candidate)) return true;
    const next = new Set(active).add(candidate);
    return candidate.record.dependencies.some((id) => {
      const dependency = [...candidates.values()].find((entry) => entry.record.id === id);
      return dependency ? cyclic(dependency, next) : false;
    });
  }
  for (const candidate of eligible) {
    if (cyclic(candidate, new Set())) { eligible.delete(candidate); candidate.record.reasons.push("recursive graph has no bounded expression expansion"); }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of eligible) {
      const dependencyMissing = candidate.record.dependencies.some((id) => ![...eligible].some((entry) => entry.record.id === id));
      const unsafeEntry = candidate.binding.referencePaths.some((reference) => {
        const call = reference.parentPath;
        if (!call?.isCallExpression() || call.node.callee !== reference.node) return true;
        if (call.node.arguments.every(literal)) return false;
        const callerNode = call.getFunctionParent()?.node;
        const caller = callerNode && byFunction.get(callerNode);
        return !caller || !eligible.has(caller) || !call.node.arguments.every((argument) => scalar(argument, caller.params));
      });
      if (dependencyMissing || unsafeEntry) {
        eligible.delete(candidate); changed = true;
        candidate.record.reasons.push(dependencyMissing ? "callee is outside the admitted graph" : "entry arguments are not literal primitives from a closed caller");
      }
    }
  }

  function expand(node: t.Expression, values: Map<string, t.Expression>): t.Expression {
    if (t.isIdentifier(node)) return t.cloneNode(values.get(node.name)!);
    if (t.isObjectExpression(node)) return t.objectExpression(node.properties.map((property) => {
      const original = property as t.ObjectProperty;
      if (original.shorthand && t.isIdentifier(original.key, { name: "__proto__" })) {
        return t.objectProperty(t.stringLiteral("__proto__"), expand(original.value as t.Expression, values), true, false);
      }
      return t.objectProperty(t.cloneNode(original.key), expand(original.value as t.Expression, values), false, false);
    }));
    if (t.isArrayExpression(node)) return t.arrayExpression(node.elements.map((element) => element === null ? null : expand(element as t.Expression, values)));
    if (t.isCallExpression(node)) {
      const callee = callTargets.get(node)!;
      const args = node.arguments.map((argument) => expand(argument as t.Expression, values));
      return expand(callee.expression, new Map(callee.params.map((name, index) => [name, args[index] ?? t.unaryExpression("void", t.numericLiteral(0))])));
    }
    if (t.isUnaryExpression(node)) return t.unaryExpression(node.operator, expand(node.argument, values));
    if (t.isBinaryExpression(node)) return t.binaryExpression(node.operator, expand(node.left as t.Expression, values), expand(node.right, values));
    if (t.isLogicalExpression(node)) return t.logicalExpression(node.operator, expand(node.left, values), expand(node.right, values));
    if (t.isConditionalExpression(node)) return t.conditionalExpression(expand(node.test, values), expand(node.consequent, values), expand(node.alternate, values));
    return t.cloneNode(node);
  }
  let fusedCallSites = 0;
  traverse(ast, { CallExpression: { exit(path) {
    if (!t.isIdentifier(path.node.callee)) return;
    const binding = path.scope.getBinding(path.node.callee.name);
    const candidate = binding && candidates.get(binding);
    if (!candidate || !eligible.has(candidate)) return;
    // Calls within removed helper definitions are expanded from their source
    // expressions recursively, avoiding stale binding information after edits.
    if (path.findParent((parent) => parent.isFunctionDeclaration() && !!byFunction.get(parent.node) && eligible.has(byFunction.get(parent.node)!))) return;
    const values = new Map(candidate.params.map((name, index) => [name, (path.node.arguments[index] as t.Expression | undefined) ?? t.unaryExpression("void", t.numericLiteral(0))]));
    path.replaceWith(expand(candidate.expression, values)); fusedCallSites++;
  } } });
  for (const candidate of eligible) { candidate.record.status = "admitted-infrastructure-control"; candidate.path.remove(); }
  report.admittedFunctions = eligible.size;
  report.fusedCallSites = fusedCallSites;
  return { code: fusedCallSites ? generate(ast).code : source, report };
}
