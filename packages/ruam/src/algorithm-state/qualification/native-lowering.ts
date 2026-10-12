/** A bounded G1 negative control. This is not a general compiler or protection qualification. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { Script, createContext } from "node:vm";
import { parse } from "@babel/parser";
import * as t from "@babel/types";
import { generate, traverse } from "../../babel-compat.js";
import { NameRegistry } from "../../naming/registry.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const print = (node: t.Node) => generate(node, { comments: false }).code;
const strictProgram = (body: t.Statement[]) => t.program(body, [t.directive(t.directiveLiteral("use strict"))]);
const expectedFunction = `function deriveSeed(parentSeed, scopeId) {
  let h = (parentSeed ^ FNV_OFFSET_BASIS) >>> 0;
  for (let i = 0; i < scopeId.length; i++) {
    h = (h ^ scopeId.charCodeAt(i)) >>> 0;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h;
}`;
function fail(detail: string): never { throw new Error(`NATIVE_CONTROL_UNSUPPORTED: ${detail}`); }
function functionFrom(source: string): t.FunctionDeclaration {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  const fn = ast.program.body.map(node => t.isExportNamedDeclaration(node) ? node.declaration : node)
    .find(node => t.isFunctionDeclaration(node) && node.id?.name === "deriveSeed");
  if (!t.isFunctionDeclaration(fn)) fail("deriveSeed declaration missing");
  const result = t.cloneNode(fn, true);
  result.returnType = null;
  for (const parameter of result.params) {
    if (!t.isIdentifier(parameter)) fail("non-identifier parameter");
    parameter.typeAnnotation = null;
  }
  if (print(result) !== print(parse(expectedFunction).program.body[0]!)) fail("authored function changed; review the control before rerunning");
  return result;
}
function constantFrom(source: string, name: string): number {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  for (const statement of ast.program.body) {
    const declaration = t.isExportNamedDeclaration(statement) ? statement.declaration : statement;
    if (!t.isVariableDeclaration(declaration) || declaration.kind !== "const") continue;
    for (const item of declaration.declarations) {
      if (t.isIdentifier(item.id, { name }) && t.isNumericLiteral(item.init) && Number.isSafeInteger(item.init.value)) return item.init.value;
    }
  }
  return fail(`literal constant ${name} missing`);
}
const assignment = (name: string, value: t.Expression) => t.expressionStatement(t.assignmentExpression("=", t.identifier(name), value));

/** Recognizes one authored function; native operations are retained, but source reflection is not preserved. */
export function lowerNativeSeedControl(source: string, constantsSource: string): { original: string; lowered: string; selectorName: string } {
  const fn = functionFrom(source);
  const initial = fn.body.body[0] as t.VariableDeclaration;
  const loop = fn.body.body[1] as t.ForStatement;
  const induction = loop.init as t.VariableDeclaration;
  const result = fn.body.body[2] as t.ReturnStatement;
  const constants = ["FNV_OFFSET_BASIS", "FNV_PRIME"].map(name => t.variableDeclaration("const", [t.variableDeclarator(t.identifier(name), t.numericLiteral(constantFrom(constantsSource, name)))]));
  const sourceIdentifiers = new Set<string>();
  traverse(t.file(strictProgram([...constants.map(item => t.cloneNode(item, true)), t.cloneNode(fn, true)])), {
    Identifier(path) { sourceIdentifiers.add(path.node.name); },
  });
  const names = new NameRegistry(0);
  names.exclude(sourceIdentifiers);
  const selectorToken = names.createScope("algorithm-state/native-lowering/control").claim("continuation");
  names.resolveAll();
  const selectorName = selectorToken.name;
  const transition = (label: number) => [assignment(selectorName, t.numericLiteral(label)), t.breakStatement()];
  const variableNames = [initial.declarations[0]!.id, induction.declarations[0]!.id] as t.Identifier[];
  const lowered = t.cloneNode(fn, true);
  lowered.body = t.blockStatement([
    t.variableDeclaration("let", variableNames.map(id => t.variableDeclarator(t.cloneNode(id)))),
    t.variableDeclaration("let", [t.variableDeclarator(t.identifier(selectorName), t.numericLiteral(17))]),
    t.forStatement(null, null, null, t.blockStatement([t.switchStatement(t.identifier(selectorName), [
      t.switchCase(t.numericLiteral(17), [
        assignment(variableNames[0]!.name, t.cloneNode(initial.declarations[0]!.init as t.Expression, true)),
        assignment(variableNames[1]!.name, t.cloneNode(induction.declarations[0]!.init as t.Expression, true)), ...transition(41),
      ]),
      t.switchCase(t.numericLiteral(41), [t.ifStatement(t.cloneNode(loop.test!, true), t.blockStatement([assignment(selectorName, t.numericLiteral(83))]), t.blockStatement([assignment(selectorName, t.numericLiteral(109))])), t.breakStatement()]),
      t.switchCase(t.numericLiteral(83), [...t.cloneNode(loop.body as t.BlockStatement, true).body, t.expressionStatement(t.cloneNode(loop.update!, true)), ...transition(41)]),
      t.switchCase(t.numericLiteral(109), [t.cloneNode(result, true)]),
      t.switchCase(null, [t.throwStatement(t.newExpression(t.identifier("Error"), [t.stringLiteral("invalid continuation")]))]),
    ])])),
  ]);
  return {
    original: print(strictProgram([...constants.map(item => t.cloneNode(item, true)), fn])),
    lowered: print(strictProgram([...constants, lowered])),
    selectorName,
  };
}

/** Artifact-only CFG recovery: follows static edges and rebuilds the single natural loop. It never receives owner source. */
export function recoverNativeSeedControl(artifact: string): { code: string; visitedBlocks: number } {
  const ast = parse(artifact, { sourceType: "script" });
  const fn = ast.program.body.find(t.isFunctionDeclaration);
  if (!fn || fn.body.body.length !== 3) fail("not a three-part control body");
  const [locals, pc, dispatch] = fn.body.body;
  if (!t.isVariableDeclaration(locals) || !t.isVariableDeclaration(pc) || pc.declarations.length !== 1 || !t.isIdentifier(pc.declarations[0]!.id) || !t.isNumericLiteral(pc.declarations[0]!.init) || !t.isForStatement(dispatch) || dispatch.init || dispatch.test || dispatch.update || !t.isBlockStatement(dispatch.body) || dispatch.body.body.length !== 1) fail("unsupported dispatcher");
  const selector = pc.declarations[0]!.id.name;
  const initialLabel = pc.declarations[0]!.init.value;
  const switchNode = dispatch.body.body[0];
  if (!t.isSwitchStatement(switchNode) || !t.isIdentifier(switchNode.discriminant, { name: selector })) fail("selector mismatch");
  const blocks = new Map<number, t.Statement[]>();
  for (const block of switchNode.cases) {
    if (block.test === null) continue;
    if (!t.isNumericLiteral(block.test) || blocks.has(block.test.value)) fail("dynamic or duplicate label");
    blocks.set(block.test.value, block.consequent);
  }
  const edge = (statement: t.Statement | undefined): number => {
    if (!t.isExpressionStatement(statement) || !t.isAssignmentExpression(statement.expression, { operator: "=" }) || !t.isIdentifier(statement.expression.left, { name: selector }) || !t.isNumericLiteral(statement.expression.right)) fail("dynamic edge");
    return statement.expression.right.value;
  };
  const splitEdge = (label: number): { work: t.Statement[]; next: number } => {
    const body = blocks.get(label);
    if (!body || !t.isBreakStatement(body.at(-1)) || (body.at(-1) as t.BreakStatement).label) fail("noncanonical edge");
    return { work: body.slice(0, -2), next: edge(body.at(-2)) };
  };
  const initialization = splitEdge(initialLabel);
  const testBlock = blocks.get(initialization.next);
  if (!testBlock || testBlock.length !== 2 || !t.isIfStatement(testBlock[0]) || !t.isBreakStatement(testBlock[1])) fail("missing loop header");
  const branch = testBlock[0];
  if (!t.isBlockStatement(branch.consequent) || !t.isBlockStatement(branch.alternate) || branch.consequent.body.length !== 1 || branch.alternate.body.length !== 1) fail("noncanonical branch");
  const bodyLabel = edge(branch.consequent.body[0]);
  const exitLabel = edge(branch.alternate.body[0]);
  const body = splitEdge(bodyLabel);
  const exit = blocks.get(exitLabel);
  if (body.next !== initialization.next || !exit || exit.length !== 1 || !t.isReturnStatement(exit[0]) || new Set([initialLabel, initialization.next, bodyLabel, exitLabel]).size !== 4 || blocks.size !== 4) fail("not a four-block natural loop");
  fn.body = t.blockStatement([locals, ...initialization.work, t.whileStatement(branch.test, t.blockStatement(body.work)), ...exit]);
  let selectorSurvives = false;
  traverse(ast, { Identifier(path) { if (path.node.name === selector) selectorSurvives = true; } });
  if (selectorSurvives) fail("continuation escaped into the recovered computation");
  return { code: print(ast), visitedBlocks: blocks.size };
}

/** Easy, prespecified partial edit: add each UTF-16 code unit instead of XOR; retain all other behavior. */
export function editNativeSeedControl(code: string): string {
  const ast = parse(code);
  let changes = 0;
  traverse(ast, { BinaryExpression(path) {
    if (path.node.operator === "^" && t.isCallExpression(path.node.right) && t.isMemberExpression(path.node.right.callee) && t.isIdentifier(path.node.right.callee.property, { name: "charCodeAt" })) {
      // Keep the original numeric coercion even when a caller supplies a non-string
      // scope with an overridden charCodeAt. Raw + would concatenate string results.
      path.node.operator = "+";
      path.node.right = t.binaryExpression("|", path.node.right, t.numericLiteral(0));
      changes++;
    }
  } });
  if (changes !== 1) fail("edit requires exactly one character mixing site");
  return print(ast);
}

interface Scenario { readonly id: string; readonly setup: string; readonly arguments: string; }
function scenarios(): Scenario[] {
  const rows: Scenario[] = [];
  const strings = ["", "a", "codec", "naming/scope", "\0", "\ud800", "\udfff", "\ud83d\ude00", "A\ud800Z", "é", "e\u0301", "x".repeat(1024)];
  const seeds = ["0", "-0", "1", "-1", "2147483647", "2147483648", "4294967295", "4294967296", "9007199254740991", "1.25", "NaN", "Infinity", "-Infinity", "undefined", "null", "true", "'17'", "1n", "Symbol('seed')"];
  for (const seed of seeds) for (const scope of strings) rows.push({ id: `boundary-${rows.length}`, setup: "", arguments: `${seed}, ${JSON.stringify(scope)}` });
  let state = 0x879fac13;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  for (let i = 0; i < 128; i++) {
    const seed = next();
    const length = next() % 65;
    const scope = Array.from({ length }, () => String.fromCharCode(next() & 0xffff)).join("");
    rows.push({ id: `generated-utf16-${i}`, setup: "", arguments: `${seed}, ${JSON.stringify(scope)}` });
  }
  for (const expression of ["null", "undefined", "0", "true", "{}", "[]", "[1]", "Symbol('scope')", "1n"]) rows.push({ id: `nonstring-${rows.length}`, setup: "", arguments: `1, ${expression}` });
  rows.push(
    { id: "parent-coercion", setup: `const parent = {valueOf(){trace.push('parent'); return 19;}};`, arguments: `parent, 'ab'` },
    { id: "parent-throws-before-scope", setup: `const parent = {valueOf(){trace.push('parent'); throw new RangeError('parent');}}; const scope = {get length(){trace.push('length'); return 0;}};`, arguments: "parent, scope" },
    { id: "scope-native-getters", setup: `const scope = {get length(){trace.push('length'); return 2;}, get charCodeAt(){trace.push('method'); return function(i){trace.push('call:'+i+':'+(this === scope)); return {valueOf(){trace.push('coerce:'+i); return i+65;}};}}};`, arguments: "5, scope" },
    { id: "scope-proxy", setup: `const target = {length:2,charCodeAt(i){trace.push('call:'+i); return i+65;}}; const scope = new Proxy(target, {get(t,k,r){trace.push('get:'+String(k)); return Reflect.get(t,k,r);}});`, arguments: "8, scope" },
    { id: "mutation-during-character-read", setup: `const scope = {length:3, charCodeAt(i){trace.push('read:'+i); this.length--; return 66;}};`, arguments: "9, scope" },
    { id: "character-throws", setup: `const scope = {length:2,charCodeAt(i){trace.push('read:'+i); if(i) throw new TypeError('character'); return 42;}};`, arguments: "4, scope" },
    { id: "character-string-coercion", setup: `const scope = {length:1,charCodeAt(){trace.push('read'); return '65';}};`, arguments: "4, scope" },
    { id: "character-numeric-hint", setup: `const scope = {length:1,charCodeAt(){return {[Symbol.toPrimitive](hint){trace.push(hint); return hint === 'number' ? 65 : 'bad';}};}};`, arguments: "4, scope" },
    { id: "character-bigint", setup: `const scope = {length:1,charCodeAt(){trace.push('read'); return 1n;}};`, arguments: "4, scope" },
    { id: "character-symbol", setup: `const scope = {length:1,charCodeAt(){trace.push('read'); return Symbol('code');}};`, arguments: "4, scope" },
    { id: "native-imul-lookup", setup: `const imul = Math.imul; Object.defineProperty(Math,'imul',{get(){trace.push('imul:get'); return function(a,b){trace.push('imul:call'); return imul(a,b);}}});`, arguments: "7, 'abc'" },
    { id: "reentrant-call", setup: `const scope = {length:1,charCodeAt(i){trace.push(deriveSeed(13,'nested')); return 65;}};`, arguments: "11, scope" },
    { id: "strict-module-caller-boundary", setup: `const scope = {length:1,charCodeAt:new Function('return arguments.callee.caller === null ? 65 : 66')};`, arguments: "1, scope" },
  );
  return rows;
}
interface Observation { kind: "return" | "throw"; value?: unknown; name?: string; message?: string; trace: unknown[]; }
function observe(code: string | ((parent: number, scope: string) => number), scenario: Scenario): Observation {
  const context = createContext(typeof code === "function" ? { deriveSeed: code } : {});
  if (typeof code === "string") new Script(code).runInContext(context, { timeout: 250 });
  // Caller code remains a separate script: a strict compiled module must not
  // accidentally make host callbacks strict merely by prepending its source.
  const script = new Script(`const trace = [];\n${scenario.setup}\ntry { globalThis.result = {kind:'return', value:deriveSeed(${scenario.arguments}), trace}; } catch(error) { globalThis.result = {kind:'throw', name:error.name, message:error.message, trace}; }`);
  script.runInContext(context, { timeout: 250 });
  return context.result as Observation;
}
function equal(left: Observation, right: Observation): boolean {
  return left.kind === right.kind && Object.is(left.value, right.value) && left.name === right.name && left.message === right.message && JSON.stringify(left.trace) === JSON.stringify(right.trace);
}
function validate(code: string, cases: readonly Scenario[], expected: readonly Observation[]) {
  let mismatches = 0;
  const failures: string[] = [];
  cases.forEach((scenario, index) => {
    if (!equal(observe(code, scenario), expected[index]!)) { mismatches++; if (failures.length < 8) failures.push(scenario.id); }
  });
  return { status: mismatches ? "mismatch" as const : "pass" as const, cases: cases.length, mismatches, failures };
}
function measured<T>(operation: () => T): { result: T; wallMilliseconds: number; cpuUserMilliseconds: number; cpuSystemMilliseconds: number } {
  const start = performance.now(), cpu = process.cpuUsage();
  const result = operation();
  const used = process.cpuUsage(cpu);
  return { result, wallMilliseconds: performance.now() - start, cpuUserMilliseconds: used.user / 1000, cpuSystemMilliseconds: used.system / 1000 };
}

export async function runNativeLoweringControl(repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url))) {
  const sourcePath = "packages/ruam/src/naming/scope.ts";
  const constantsPath = "packages/ruam/src/constants.ts";
  const harnessPath = fileURLToPath(import.meta.url);
  const namingDependencyPaths = ["packages/ruam/src/naming/registry.ts", "packages/ruam/src/naming/token.ts", "packages/ruam/src/naming/reserved.ts"];
  const [source, constants, harness, ...namingSources] = await Promise.all([readFile(resolve(repoRoot, sourcePath), "utf8"), readFile(resolve(repoRoot, constantsPath), "utf8"), readFile(harnessPath, "utf8"), ...namingDependencyPaths.map(path => readFile(resolve(repoRoot, path), "utf8"))]);
  if (source === undefined || constants === undefined || harness === undefined) fail("missing source snapshot");
  const authoredModule = await import(pathToFileURL(resolve(repoRoot, sourcePath)).href);
  if (typeof authoredModule.deriveSeed !== "function") fail("actual module export missing");
  const lowering = measured(() => lowerNativeSeedControl(source, constants));
  const recovery = measured(() => recoverNativeSeedControl(lowering.result.lowered));
  const edit = measured(() => editNativeSeedControl(recovery.result.code));
  const ordinaryEdit = measured(() => editNativeSeedControl(lowering.result.original));
  const cases = scenarios();
  const expected = cases.map(scenario => observe(lowering.result.original, scenario));
  // Import the actual ESM export so extraction cannot silently redefine module
  // semantics. This one excluded case deliberately replaces realm-local Math;
  // the imported module resolves Math in its own realm instead.
  const moduleCases = cases.filter(scenario => scenario.id !== "native-imul-lookup");
  const moduleExpected = moduleCases.map(scenario => observe(authoredModule.deriveSeed, scenario));
  const importedOriginal = validate(lowering.result.original, moduleCases, moduleExpected);
  const importedLowering = validate(lowering.result.lowered, moduleCases, moduleExpected);
  // This is an explicit known incompatibility, not a dropped passing case. The
  // current VM also changes source text, but that does not prove parity here.
  const reflectionCase: Scenario = { id: "source-text-reflection", setup: `const scope = {length:1,charCodeAt(){return deriveSeed.toString().includes('switch') ? 66 : 65;}};`, arguments: "1, scope" };
  const reflectedOriginal = observe(authoredModule.deriveSeed, reflectionCase);
  const reflectedLowered = observe(lowering.result.lowered, reflectionCase);
  const knownCompatibilityFailures = [{
    id: reflectionCase.id,
    reason: "A callback observes generated function text. Lowering and recovery alter that text; unrestricted source reflection is not preserved, and current-VM reflection parity is not established.",
    validation: validate(lowering.result.lowered, [reflectionCase], [reflectedOriginal]),
    recoveryAgainstLowered: validate(recovery.result.code, [reflectionCase], [reflectedLowered]),
    observations: { importedOriginal: reflectedOriginal, lowered: reflectedLowered, recovered: observe(recovery.result.code, reflectionCase) },
  }];
  // Owner oracle construction is independent of the attacker's AST-edit routine.
  const mixingSite = "h ^ scopeId.charCodeAt(i)";
  if (lowering.result.original.split(mixingSite).length !== 2) fail("owner edit oracle site changed");
  const ownerEdited = lowering.result.original.replace(mixingSite, "h + (scopeId.charCodeAt(i) | 0)");
  const expectedEdit = cases.map(scenario => observe(ownerEdited, scenario));
  const correctness = validate(lowering.result.lowered, cases, expected);
  const recovered = validate(recovery.result.code, cases, expected);
  const edited = validate(edit.result, cases, expectedEdit);
  const ordinaryEdited = validate(ordinaryEdit.result, cases, expectedEdit);
  const incorrectRecovery = recovery.result.code.replace("return h;", "return (h ^ 1) >>> 0;");
  if (incorrectRecovery === recovery.result.code) fail("incorrect-candidate mutation site missing");
  const negativeControls = {
    uneditedAgainstEditOracle: validate(recovery.result.code, cases, expectedEdit),
    wrongRecovery: { sha256: hash(incorrectRecovery), validation: validate(incorrectRecovery, cases, expected) },
  };
  const after = await Promise.all([readFile(resolve(repoRoot, sourcePath), "utf8"), readFile(resolve(repoRoot, constantsPath), "utf8"), readFile(harnessPath, "utf8"), ...namingDependencyPaths.map(path => readFile(resolve(repoRoot, path), "utf8"))]);
  if (after[0] !== source || after[1] !== constants || after[2] !== harness || namingSources.some((text, index) => after[index + 3] !== text)) fail("source, harness or naming dependency changed during qualification");
  const timings = ({ result: _result, ...resources }: ReturnType<typeof measured>) => resources;
  return {
    format: "ruam-native-lowering-control-v1", status: "negative-control", releaseApproved: false,
    scope: "one existing deriveSeed function with tested non-source-reflective inputs/effects and an explicit known reflection failure; not an application, full-semantic compatibility or full-JavaScript qualification",
    source: { path: sourcePath, sha256: hash(source), constantsPath, constantsSha256: hash(constants), extractedFunctionSha256: hash(lowering.result.original) },
    harness: { path: "packages/ruam/src/algorithm-state/qualification/native-lowering.ts", sha256: hash(harness), sourceAndHarnessUnchangedAtEnd: true },
    controlScope: { controlShapeRecognized: true, recognizedShape: "exact authored deriveSeed AST and literal imported FNV constants", runtimeInputsFiltered: false, sourceReflection: "not-preserved", fullSemanticCompatibility: false, generalCompiler: false, a1Admission: "not-evaluated" },
    naming: { system: "NameRegistry", publicSeed: 0, selectorName: lowering.result.selectorName, dependencies: namingDependencyPaths.map((path, index) => ({ path, sha256: hash(namingSources[index]!) })), dependenciesUnchangedAtEnd: true, sourceAndConstantsDependencies: "hashed in source record", protectionCredit: false },
    artifact: { sha256: hash(lowering.result.lowered), bytes: Buffer.byteLength(lowering.result.lowered), code: lowering.result.lowered },
    recovery: { kind: "artifact-only-static-natural-loop-reconstruction", sha256: hash(recovery.result.code), bytes: Buffer.byteLength(recovery.result.code), code: recovery.result.code, visitedBlocks: recovery.result.visitedBlocks, validation: recovered, resources: timings(recovery) },
    partialEdit: { ticket: "Add each UTF-16 code unit modulo 2^32 instead of XOR at character mixing; preserve seed initialization, multiplication and observable effects.", classification: "easy-partial-edit-negative-control", sha256: hash(edit.result), code: edit.result, validation: edited, resources: timings(edit) },
    ordinaryBaseline: { sha256: hash(lowering.result.original), bytes: Buffer.byteLength(lowering.result.original), partialEdit: { validation: ordinaryEdited, resources: timings(ordinaryEdit) } },
    correctness, knownCompatibilityFailures, importedModuleOracle: { original: importedOriginal, lowered: importedLowering, excludes: [{ id: "native-imul-lookup", reason: "This scenario intentionally instruments realm-local Math; an imported module uses its own realm." }] }, negativeControls, compilerResources: timings(lowering),
    effort: { authoringAnalystMinutes: null, modelAssistedAuthoringTokens: null, attackModelTokens: 0, reusableSetupMilliseconds: null, peakMemoryBytes: null, note: "Only automated local AST lowering/recovery/edit operation CPU and wall time were measured. Authoring/setup effort and peak memory remain unknown." },
    evidenceLimits: ["Public deterministic scenarios, not a blind campaign or universal equivalence proof.", "Known source-reflection failure disqualifies unrestricted semantic compatibility; both lowering and recovery expose different function text.", "Resource measurements exclude analyst implementation effort, which is unknown; no model attack was run.", "This rejects continuation flattening alone as an adequate defense for this non-source-reflective control; it does not measure full-scope G1 or A1 resistance.", "The node:vm runner executes trusted compiler and local attacker output; it is not a hostile-code sandbox."],
    decision: correctness.status === "pass" && importedOriginal.status === "pass" && importedLowering.status === "pass" && recovered.status === "pass" && edited.status === "pass" && ordinaryEdited.status === "pass" && knownCompatibilityFailures.every(item => item.validation.status === "mismatch" && item.recoveryAgainstLowered.status === "mismatch") && negativeControls.uneditedAgainstEditOracle.status === "mismatch" && negativeControls.wrongRecovery.validation.status === "mismatch" ? "reject-continuation-flattening-alone-for-this-control" : "correctness-or-attack-validation-failed",
  };
}
