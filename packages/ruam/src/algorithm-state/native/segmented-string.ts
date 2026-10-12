/**
 * Complete selected-function experiment: segmented string accumulation with
 * authored iterator, coercion and dynamic slice observations retained.
 * @module algorithm-state/native/segmented-string
 */
import { parse } from "@babel/parser";
import * as t from "@babel/types";
import { generate, traverse } from "../../babel-compat.js";
import { BABEL_PARSER_PLUGINS } from "../../constants.js";
import { NameRegistry } from "../../naming/registry.js";

export interface SegmentedStringReport {
  transformedFunctions: Array<{ sourceStart: number; sourceEnd: number; stateBinding: string; algorithm: "segmented-string-with-original-slice-observations" }>;
  declined: Array<{ sourceStart: number; reason: string }>;
  scope: {
    transformationGranularity: "complete-recognized-function";
    wholeApplicationReplacement: false;
    residualBackend: "current-vm";
    protectionQualified: false;
    runtimeInputsFiltered: false;
    sourceReflection: "not-preserved";
    resourceExceptionTiming: "not-preserved";
    originalIntrinsicCalls: "retained";
  };
}

function containsName(node: t.Node, name: string): boolean {
  let found = false;
  t.traverseFast(node, (child) => { if (t.isIdentifier(child, { name })) found = true; });
  return found;
}
function member(node: t.Node, state: string, property: string): node is t.MemberExpression {
  return t.isMemberExpression(node) && !node.computed && t.isIdentifier(node.object, { name: state }) && t.isIdentifier(node.property, { name: property });
}
function sliceAssignment(node: t.Statement, state: string): boolean {
  if (!t.isExpressionStatement(node) || !t.isAssignmentExpression(node.expression, { operator: "=" }) || !t.isIdentifier(node.expression.left, { name: state })) return false;
  const call = node.expression.right;
  return t.isCallExpression(call) && !call.optional && member(call.callee, state, "slice") && call.arguments.length === 2 && t.isNumericLiteral(call.arguments[0], { value: 0 }) && t.isUnaryExpression(call.arguments[1], { operator: "-" }) && t.isNumericLiteral(call.arguments[1].argument, { value: 1 });
}

/**
 * Replace an entire recognized string simulation function, with no type filter
 * on runtime arguments. All unrecognized JavaScript remains with the current VM.
 * Allocation and engine string-limit failures can occur at different times;
 * this experiment is therefore not a full-semantic or protection certificate.
 * @param source Source accepted by the existing parser configuration.
 * @param options Public seed for the centralized generated-name registry.
 * @returns Transformed source and complete-function recognition evidence.
 */
export function compileSegmentedStringCode(source: string, options: { seed?: number } = {}): { code: string; report: SegmentedStringReport } {
  const ast = parse(source, { sourceType: "unambiguous", plugins: [...BABEL_PARSER_PLUGINS] });
  const report: SegmentedStringReport = {
    transformedFunctions: [], declined: [],
    scope: { transformationGranularity: "complete-recognized-function", wholeApplicationReplacement: false, residualBackend: "current-vm", protectionQualified: false, runtimeInputsFiltered: false, sourceReflection: "not-preserved", resourceExceptionTiming: "not-preserved", originalIntrinsicCalls: "retained" },
  };
  const names = new Set<string>();
  let dynamicScope = false;
  traverse(ast, {
    Identifier(path) { names.add(path.node.name); },
    WithStatement() { dynamicScope = true; },
    CallExpression(path) { if (t.isIdentifier(path.node.callee, { name: "eval" })) dynamicScope = true; },
  });
  const registry = new NameRegistry(options.seed ?? 0);
  registry.exclude(names); registry.resolveAll();
  const fresh = registry.createDynamicGenerator("algorithm-state.segmented-string");
  traverse(ast, { Function(path) {
    const body = path.node.body;
    if (!t.isBlockStatement(body) || body.body.length !== 3) return;
    const [initial, loop, returned] = body.body;
    if (!t.isVariableDeclaration(initial) || initial.declarations.length !== 1 || initial.kind === "const") return;
    const declaration = initial.declarations[0]!;
    if (!t.isIdentifier(declaration.id) || !t.isStringLiteral(declaration.init, { value: "" })) return;
    const state = declaration.id.name;
    const sourceStart = path.node.start ?? -1;
    const reject = (reason: string) => report.declined.push({ sourceStart, reason });
    if (dynamicScope) { reject("eval/with prevents proof of private accumulator state"); return; }
    if (path.node.params.some((parameter) => containsName(parameter, state))) { reject("accumulator may alias a parameter or mapped arguments entry"); return; }
    if (path.node.async || path.node.generator || !t.isForOfStatement(loop) || loop.await || !t.isReturnStatement(returned) || !t.isIdentifier(returned.argument, { name: state })) { reject("requires a synchronous for-of simulation returning its accumulator"); return; }
    if (!t.isBlockStatement(loop.body) || loop.body.body.length !== 1 || !t.isSwitchStatement(loop.body.body[0]) || containsName(loop.left, state) || containsName(loop.right, state)) { reject("iterator or loop body observes the accumulator outside admitted operations"); return; }
    const dispatch = loop.body.body[0];
    if (containsName(dispatch.discriminant, state)) { reject("switch discriminator observes the accumulator"); return; }
    let append: t.SwitchCase | undefined;
    let appendExpression: t.AssignmentExpression | undefined;
    let erase: t.IfStatement | undefined;
    for (const branch of dispatch.cases) {
      if (branch.test && containsName(branch.test, state)) { reject("case selector observes the accumulator"); return; }
      if (branch.consequent.length === 1 && t.isBreakStatement(branch.consequent[0]) && !branch.consequent[0].label) continue;
      if (branch.consequent.length !== 2 || !t.isBreakStatement(branch.consequent[1]) || branch.consequent[1].label) { reject("unrecognized case completion or fallthrough"); return; }
      const operation = branch.consequent[0]!;
      if (t.isExpressionStatement(operation) && t.isAssignmentExpression(operation.expression, { operator: "+=" }) && t.isIdentifier(operation.expression.left, { name: state }) && !containsName(operation.expression.right, state) && !append) {
        append = branch; appendExpression = operation.expression; continue;
      }
      if (t.isIfStatement(operation) && !operation.alternate && t.isBinaryExpression(operation.test, { operator: ">" }) && member(operation.test.left, state, "length") && t.isNumericLiteral(operation.test.right, { value: 0 }) && t.isBlockStatement(operation.consequent) && operation.consequent.body.length === 1 && sliceAssignment(operation.consequent.body[0]!, state) && !erase) {
        erase = operation; continue;
      }
      reject("case has an unproved accumulator access or effect"); return;
    }
    if (!append || !appendExpression || !erase) { reject("requires exactly one append and one observed slice case"); return; }
    const pending = fresh(), count = fresh(), piece = fresh(), cursor = fresh(), text = fresh(), valueField = fresh(), previousField = fresh();
    const id = (name: string) => t.identifier(name);
    const set = (name: string, value: t.Expression) => t.expressionStatement(t.assignmentExpression("=", id(name), value));
    const isString = () => t.binaryExpression("===", t.unaryExpression("typeof", id(state)), t.stringLiteral("string"));
    const own = (name: string, key: string) => t.memberExpression(id(name), t.stringLiteral(key), true);
    // Each materialization is a fresh lexical block. Only compiler-owned nodes
    // and primitive strings are read; no Array/String method is introduced.
    const materialize = () => t.ifStatement(t.binaryExpression("!==", id(pending), t.nullLiteral()), t.blockStatement([
      t.variableDeclaration("let", [t.variableDeclarator(id(cursor), id(pending)), t.variableDeclarator(id(text), t.stringLiteral(""))]),
      t.whileStatement(t.binaryExpression("!==", id(cursor), t.nullLiteral()), t.blockStatement([
        set(text, t.binaryExpression("+", own(cursor, valueField), id(text))),
        set(cursor, own(cursor, previousField)),
      ])),
      set(state, t.binaryExpression("+", id(state), id(text))),
      set(pending, t.nullLiteral()), set(count, t.numericLiteral(0)),
    ]));
    const originalAppend = t.cloneNode(appendExpression, true);
    append.consequent[0] = t.ifStatement(isString(), t.blockStatement([
      t.variableDeclaration("const", [t.variableDeclarator(id(piece), t.binaryExpression("+", t.stringLiteral(""), t.cloneNode(appendExpression.right, true)))]),
      set(pending, t.objectExpression([t.objectProperty(t.stringLiteral(valueField), id(piece)), t.objectProperty(t.stringLiteral(previousField), id(pending))])),
      set(count, t.binaryExpression("+", id(count), t.memberExpression(id(piece), id("length")))),
    ]), t.blockStatement([t.expressionStatement(originalAppend)]));
    erase.test = t.binaryExpression(">", t.conditionalExpression(isString(), t.binaryExpression("+", t.memberExpression(id(state), id("length")), id(count)), t.memberExpression(id(state), id("length"))), t.numericLiteral(0));
    (erase.consequent as t.BlockStatement).body.unshift(materialize());
    body.body.splice(1, 0, t.variableDeclaration("let", [t.variableDeclarator(id(pending), t.nullLiteral()), t.variableDeclarator(id(count), t.numericLiteral(0))]));
    body.body.splice(body.body.length - 1, 0, materialize());
    report.transformedFunctions.push({ sourceStart, sourceEnd: path.node.end ?? -1, stateBinding: state, algorithm: "segmented-string-with-original-slice-observations" });
    path.skip();
  } });
  return { code: report.transformedFunctions.length ? generate(ast).code : source, report };
}
