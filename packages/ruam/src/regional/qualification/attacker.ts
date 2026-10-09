/** Artifact-only recovery. Never accepts original source, compiler witnesses or hidden scorer inputs. */
import { parse } from "@babel/parser";
import * as t from "@babel/types";
import { generate, traverse } from "../../babel-compat.js";
import { Script, createContext } from "node:vm";
import type { RecoveryCandidate, ResourceObservation } from "./types.js";

const HOST_NAMES = new Set(["Math", "Number", "String", "Array", "Object", "Boolean", "JSON", "Infinity", "NaN", "undefined", "Error", "TypeError", "RangeError", "BigInt", "Symbol"]);
function begin() { return { wall: performance.now(), cpu: process.cpuUsage(), heap: process.memoryUsage().heapUsed }; }
function resources(start: ReturnType<typeof begin>, queries = 0): ResourceObservation {
	const cpu = process.cpuUsage(start.cpu);
	return { wallMilliseconds: performance.now() - start.wall, cpuUserMilliseconds: cpu.user / 1000,
		cpuSystemMilliseconds: cpu.system / 1000, retainedHeapDeltaBytes: process.memoryUsage().heapUsed - start.heap,
		peakRssBytes: process.resourceUsage().maxRSS * (process.versions.bun && process.platform === "darwin" ? 1 : 1024), queries,
		analystMinutes: null, modelTokens: 0 };
}
function literal(value: unknown): t.Expression | null {
	if (typeof value === "number") {
		if (!Number.isFinite(value) || Object.is(value, -0)) return null;
		return t.valueToNode(value) as t.Expression;
	}
	if (["string", "boolean"].includes(typeof value) || value === null) return t.valueToNode(value) as t.Expression;
	return null;
}
function pureValue(node: t.Node): boolean {
	if (t.isIdentifier(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node) || t.isStringLiteral(node) || t.isNullLiteral(node)) return true;
	if (t.isUnaryExpression(node) && node.operator !== "delete") return pureValue(node.argument);
	if (t.isBinaryExpression(node)) return pureValue(node.left) && pureValue(node.right);
	return false;
}

/** Bounded symbolic execution of local scalar assignments and branches. No evaluator/runtime is retained. */
function reduceScalarBody(fn: t.FunctionDeclaration, allowUnchanged = false): t.Expression | null {
	if (fn.async || fn.generator || !fn.params.every(p => t.isIdentifier(p))) return null;
	const initial = new Map<string, t.Expression>(fn.params.map(p => [(p as t.Identifier).name, t.cloneNode(p as t.Identifier)]));
	const tables = new Map<string, t.Expression[]>();
	let assignments = 0, budget = 3000;
	const expression = (node: t.Expression, env: Map<string, t.Expression>): t.Expression => {
		if (--budget < 0) throw new Error("symbolic budget");
		if (t.isIdentifier(node) && env.has(node.name)) return t.cloneNode(env.get(node.name)!, true);
		if (t.isNumericLiteral(node) || t.isBooleanLiteral(node) || t.isStringLiteral(node)) return t.cloneNode(node);
		if (t.isArrayExpression(node) && node.elements.every(element => t.isExpression(element))) return t.arrayExpression(node.elements.map(element => expression(element as t.Expression, env)));
		if (t.isMemberExpression(node) && node.computed && t.isIdentifier(node.object) && t.isNumericLiteral(node.property)) {
			const value = tables.get(node.object.name)?.[node.property.value];
			if (value) return t.cloneNode(value, true);
		}
		if (t.isBinaryExpression(node) && t.isExpression(node.left)) return t.binaryExpression(node.operator, expression(node.left, env), expression(node.right, env));
		if (t.isUnaryExpression(node) && node.operator !== "delete") return t.unaryExpression(node.operator, expression(node.argument as t.Expression, env));
		if (t.isConditionalExpression(node)) return t.conditionalExpression(expression(node.test, env), expression(node.consequent, env), expression(node.alternate, env));
		if (t.isCallExpression(node) && t.isMemberExpression(node.callee) && !node.callee.computed && t.isIdentifier(node.callee.object, { name: "Math" }) && t.isIdentifier(node.callee.property, { name: "imul" }) && node.arguments.every(a => t.isExpression(a))) return t.callExpression(t.cloneNode(node.callee), node.arguments.map(a => expression(a as t.Expression, env)));
		throw new Error("unsupported scalar expression");
	};
	const statements = (body: t.Statement[], env: Map<string, t.Expression>): t.Expression | null => {
		for (const statement of body) {
			if (t.isVariableDeclaration(statement)) {
				for (const decl of statement.declarations) {
					if (!t.isIdentifier(decl.id) || !decl.init || !t.isExpression(decl.init)) throw new Error("unsupported declaration");
					if (t.isArrayExpression(decl.init) && decl.init.elements.every(element => t.isNumericLiteral(element))) { tables.set(decl.id.name, decl.init.elements as t.NumericLiteral[]); assignments++; continue; }
					env.set(decl.id.name, expression(decl.init, env)); assignments++;
				}
			} else if (t.isExpressionStatement(statement) && t.isAssignmentExpression(statement.expression, { operator: "=" }) && t.isIdentifier(statement.expression.left)) {
				if (!env.has(statement.expression.left.name)) throw new Error("nonlocal write");
				env.set(statement.expression.left.name, expression(statement.expression.right, env)); assignments++;
			} else if (t.isIfStatement(statement) && statement.alternate) {
				const test = expression(statement.test, env), left = new Map(env), right = new Map(env);
				if (statements(t.isBlockStatement(statement.consequent) ? statement.consequent.body : [statement.consequent], left) || statements(t.isBlockStatement(statement.alternate) ? statement.alternate.body : [statement.alternate], right)) throw new Error("early return");
				for (const name of env.keys()) {
					if (left.get(name) !== env.get(name) || right.get(name) !== env.get(name)) env.set(name, t.conditionalExpression(t.cloneNode(test, true), left.get(name)!, right.get(name)!));
				}
			} else if (t.isReturnStatement(statement) && statement.argument && statement === body[body.length - 1]) return expression(statement.argument, env);
			else throw new Error("unsupported scalar statement");
		}
		return null;
	};
	try { const result = statements(fn.body.body, initial); return (assignments || allowUnchanged) && result && generate(result).code.length < 20_000 ? result : null; } catch { return null; }
}

export function extractStandalone(artifact: string, publicEntry = "run"): RecoveryCandidate {
	const started = begin();
	const transformations: Record<string, number> = { constantFolds: 0, helperInlines: 0, scalarBodiesReduced: 0, unusedFunctionsRemoved: 0, ssaStatements: 0 };
	try {
		const input = parse(artifact, { sourceType: "unambiguous" });
		const declarations = new Map<string, t.Statement>();
		for (const raw of input.program.body) {
			const statement = t.isExportNamedDeclaration(raw) ? raw.declaration : raw;
			if (t.isFunctionDeclaration(statement) && statement.id) declarations.set(statement.id.name, statement);
			if (t.isVariableDeclaration(statement)) for (const decl of statement.declarations) {
				if (t.isIdentifier(decl.id)) declarations.set(decl.id.name, t.variableDeclaration(statement.kind, [decl]));
			}
		}
		const root = declarations.get(publicEntry);
		if (!root) return { kind: "static-extraction", status: "unsupported", reason: "Public entry is not a top-level statically bound declaration; no VM lifting implemented.", transformations, resources: resources(started) };
		const needed = new Set([publicEntry]);
		let selected = [t.cloneNode(root, true)];
		for (let pass = 0; pass < 24; pass++) {
			let changed = false;
			const file = t.file(t.program(selected));
			traverse(file, { ReferencedIdentifier(path) {
				if (!path.scope.getBinding(path.node.name) && declarations.has(path.node.name) && !needed.has(path.node.name)) {
					needed.add(path.node.name); changed = true;
				}
			} });
			selected = [...needed].map(name => t.cloneNode(declarations.get(name)!, true));
			if (!changed) break;
		}
		// Copying the whole generated interpreter is not independently extracted semantics.
		if (needed.size > 12) return { kind: "static-extraction", status: "artifact-transplant-only", reason: `Entry requires ${needed.size} top-level bindings; refusing to relabel a retained runtime as recovery.`, transformations, resources: resources(started) };
		const recovered = t.file(t.program(selected));
		// A bounded declaration count does not exclude an embedded interpreter. Admit only the
		// scalar-expression plus ordered array-history grammar, never generic dispatch machinery.
		let residualRuntime: string | undefined;
		traverse(recovered, {
			"SwitchStatement|WhileStatement|DoWhileStatement|TryStatement|NewExpression"(path) { residualRuntime = path.node.type; },
			ForStatement(path) {
				const owner = path.getFunctionParent();
				const test = path.node.test;
				if (!owner?.isFunctionDeclaration() || owner.node.id?.name !== publicEntry || !t.isBinaryExpression(test, { operator: "<" }) || !t.isMemberExpression(test.right) || test.right.computed || !t.isIdentifier(test.right.property, { name: "length" }) || !owner.node.params.some(param => t.isIdentifier(param) && t.isIdentifier((test.right as t.MemberExpression).object, { name: param.name }))) residualRuntime = "non-history loop";
				const body = t.isBlockStatement(path.node.body) ? path.node.body.body : [];
				const first = body[0], second = body[1];
				if (body.length !== 2 || !t.isExpressionStatement(first) || !t.isAssignmentExpression(first.expression, { operator: "=" }) || !t.isCallExpression(first.expression.right) || !t.isIdentifier(first.expression.right.callee) || !t.isExpressionStatement(second) || !t.isCallExpression(second.expression) || !t.isMemberExpression(second.expression.callee) || !t.isIdentifier(second.expression.callee.property, { name: "push" })) residualRuntime = "loop is not one scalar transition followed by history append";
			},
			CallExpression(path) {
				const callee = path.node.callee;
				if (t.isIdentifier(callee) && path.scope.getBinding(callee.name)?.path.isFunctionDeclaration()) return;
				if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property)) {
					if (t.isIdentifier(callee.object, { name: "Math" }) && callee.property.name === "imul") return;
					if (t.isIdentifier(callee.object) && callee.property.name === "push") {
						const binding = path.scope.getBinding(callee.object.name);
						if (binding?.path.isVariableDeclarator() && t.isArrayExpression(binding.path.node.init)) return;
					}
				}
				residualRuntime = "non-scalar or dynamic call";
			},
		});
		if (residualRuntime) return { kind: "static-extraction", status: "unsupported", reason: `Residual computation is outside the scalar/history grammar (${residualRuntime}); no retained runtime credit.`, transformations, resources: resources(started) };
		traverse(recovered, { FunctionDeclaration: { exit(path) {
			const expression = reduceScalarBody(path.node);
			if (expression) { path.node.body = t.blockStatement([t.returnStatement(expression)]); transformations.scalarBodiesReduced!++; }
			if (path.node.id?.name !== publicEntry && !reduceScalarBody(path.node, true)) residualRuntime = "helper did not reduce to the closed scalar-expression grammar; recursive/runtime calls receive no credit";
		} } });
		if (residualRuntime) return { kind: "static-extraction", status: "unsupported", reason: residualRuntime, transformations, resources: resources(started) };
		for (let iteration = 0; iteration < 4; iteration++) {
			traverse(recovered, {
				CallExpression: { exit(path) {
					if (!t.isIdentifier(path.node.callee)) return;
					const binding = path.scope.getBinding(path.node.callee.name);
					if (!binding?.path.isFunctionDeclaration() || !binding.constant) return;
					const fn = binding.path.node;
					if (fn.async || fn.generator || fn.body.body.length !== 1 || !t.isReturnStatement(fn.body.body[0]) || !fn.body.body[0].argument) return;
					if (!fn.params.every(p => t.isIdentifier(p)) || path.node.arguments.length !== fn.params.length || !path.node.arguments.every(a => t.isExpression(a) && pureValue(a))) return;
					const replacements = new Map(fn.params.map((p, i) => [(p as t.Identifier).name, path.node.arguments[i] as t.Expression]));
					const expression = t.cloneNode(fn.body.body[0].argument, true);
					let safe = true;
					const wrapped = t.file(t.program([t.expressionStatement(expression)]));
					traverse(wrapped, { ReferencedIdentifier(p) { if (!replacements.has(p.node.name) && !HOST_NAMES.has(p.node.name)) safe = false; } });
					if (!safe) return;
					traverse(wrapped, { ReferencedIdentifier(p) { const value = replacements.get(p.node.name); if (value) { p.replaceWith(t.cloneNode(value, true)); p.skip(); } } });
					path.replaceWith((wrapped.program.body[0] as t.ExpressionStatement).expression);
					transformations.helperInlines!++;
				} },
				"BinaryExpression|UnaryExpression|ConditionalExpression"(path) {
					if (!path.isExpression() || (path.isUnaryExpression() && path.node.operator === "delete")) return;
					const evaluation = path.evaluate();
					if (!evaluation.confident) return;
					const node = literal(evaluation.value);
					if (node) { path.replaceWith(node); transformations.constantFolds!++; }
				},
			});
		}
		traverse(recovered, { Program(path) { path.scope.crawl(); }, FunctionDeclaration: { exit(path) {
			if (!path.node.id || path.node.id.name === publicEntry) return;
			const binding = path.parentPath.scope.getBinding(path.node.id.name);
			if (binding && !binding.referenced) { path.remove(); transformations.unusedFunctionsRemoved!++; }
		} } });
		let sequence = 0;
		// Produce a fresh three-address computation for returns, not a wrapper invoking the artifact.
		traverse(recovered, { ReturnStatement(path) {
			const before: t.Statement[] = [];
			const lower = (node: t.Expression): t.Expression => {
				if (t.isBinaryExpression(node) && t.isExpression(node.left)) {
					const left = lower(node.left), right = lower(node.right);
					const id = path.scope.generateUidIdentifier(`recovered${sequence++}`);
					before.push(t.variableDeclaration("const", [t.variableDeclarator(id, t.binaryExpression(node.operator, left, right))]));
					transformations.ssaStatements!++;
					return id;
				}
				if (t.isUnaryExpression(node) && node.operator !== "delete") return t.unaryExpression(node.operator, lower(node.argument as t.Expression), node.prefix);
				if (t.isArrayExpression(node) && node.elements.every(element => t.isExpression(element))) return t.arrayExpression(node.elements.map(element => lower(element as t.Expression)));
				return t.cloneNode(node, true);
			};
			if (path.node.argument) {
				path.node.argument = lower(path.node.argument);
				if (before.length) path.insertBefore(before);
			}
		} });
		let unknown: string | undefined;
		traverse(recovered, { Program(path) { path.scope.crawl(); } });
		traverse(recovered, { ReferencedIdentifier(path) {
			if (!path.scope.getBinding(path.node.name) && !HOST_NAMES.has(path.node.name)) unknown = path.node.name;
		} });
		if (unknown) return { kind: "static-extraction", status: "unsupported", reason: `Unresolved runtime/environment dependency: ${unknown}`, transformations, resources: resources(started) };
		const meaningful = transformations.constantFolds! + transformations.helperInlines! + transformations.scalarBodiesReduced!;
		if (!meaningful) return { kind: "static-extraction", status: "artifact-transplant-only", reason: "Slicing alone did not transform the computation; unchanged function copying earns no recovery credit.", transformations, resources: resources(started) };
		traverse(recovered, { Program(path) { path.scope.rename(publicEntry, "recovered"); } });
		const code = generate(recovered, { comments: false, compact: false }).code;
		return { kind: "static-extraction", status: "candidate", code, entry: "recovered", reason: "Artifact-only declaration slicing, helper partial evaluation and fresh three-address return computations; no original artifact invocation.", transformations, resources: resources(started) };
	} catch (error) {
		return { kind: "static-extraction", status: "error", reason: String(error), transformations, resources: resources(started) };
	}
}

/** Independently implemented oracle learner for easy functions. It sees no artifact AST or owner source. */
export function learnNumeric(oracle: (input: number) => unknown): RecoveryCandidate {
	const started = begin(); let queries = 0;
	const observations = new Map<number, unknown>();
	const ask = (x: number) => { if (!observations.has(x)) { queries++; observations.set(x, oracle(x)); } return observations.get(x); };
	try {
		const zero = ask(0), one = ask(1), two = ask(2);
		if (![zero, one, two].every(v => typeof v === "number" && Number.isFinite(v))) return { kind: "blackbox-learning", status: "unsupported", reason: "Learner grammar accepts scalar numeric outputs only.", transformations: {}, resources: resources(started, queries) };
		const b = zero as number, a = (one as number) - b;
		const quadratic = ((two as number) - 2 * (one as number) + b) / 2;
		const linear = a - quadratic;
		const expressions = [String(b), `(Math.imul(${a | 0}, input | 0) + ${b | 0}) | 0`, `(input | 0) ^ ${b | 0}`,
			`(Math.imul(${quadratic | 0}, Math.imul(input | 0, input | 0)) + Math.imul(${linear | 0}, input | 0) + ${b | 0}) | 0`];
		const training = [-17, -3, -1, 3, 4, 11, 53, 255, 65537, 2147483647, -2147483648];
		for (const expression of expressions) {
			const code = `function recovered(input) { return ${expression}; }`;
			const context = createContext({}); new Script(code).runInContext(context, { timeout: 100 });
			const fn = context.recovered as (n: number) => unknown;
			if (training.every(x => Object.is(fn(x), ask(x)))) return { kind: "blackbox-learning", status: "candidate", code, entry: "recovered", reason: "Numeric constant/affine/xor/quadratic grammar fit; hidden validation still required.", transformations: { learnedExpression: 1 }, resources: resources(started, queries) };
		}
		return { kind: "blackbox-learning", status: "unsupported", reason: "No learned expression fit the training oracle.", transformations: {}, resources: resources(started, queries) };
	} catch (error) { return { kind: "blackbox-learning", status: "error", reason: String(error), transformations: {}, resources: resources(started, queries) }; }
}
