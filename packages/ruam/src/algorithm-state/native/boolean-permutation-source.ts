/**
 * Opt-in source admission for pure Boolean-returning functions.
 * General residual JavaScript is retained and still needs its existing backend.
 * @module algorithm-state/native/boolean-permutation-source
 */
import { parse, parseExpression } from "@babel/parser";
import * as t from "@babel/types";
import { generate, traverse } from "../../babel-compat.js";
import { BABEL_PARSER_PLUGINS } from "../../constants.js";
import { deriveSeed } from "../../naming/index.js";
import { compilePermutationFormula, PermutationBudgetError, type BooleanFormula, type PermutationCompilationOptions } from "./boolean-permutation.js";

export interface BooleanPermutationSourceOptions extends Omit<PermutationCompilationOptions, "inputCount"> {
	maxFunctions?: number;
	/** Aggregate emitted call-expression bytes, including captures and function. */
	maxTotalGeneratedBytes?: number;
}

interface Region {
	sourceStart: number;
	name: string | null;
	inputCount: number;
	steps: number;
	generatedBytes: number;
}

/** Literal truthiness and local formal reads do not invoke user coercion hooks. */
interface CaptureContext { params: Set<string>; values: t.Expression[]; inputs: Map<t.Node | string, number>; }

function capture(node: t.Expression, context: CaptureContext, key: t.Node | string): BooleanFormula | null {
	let index = context.inputs.get(key);
	if (index === undefined) {
		if (context.values.length >= 32) return null;
		index = context.values.length; context.inputs.set(key, index); context.values.push(t.cloneNode(node, true));
	}
	return { kind: "input", index };
}

function inertValue(node: t.Node, context: CaptureContext): boolean {
	return (t.isIdentifier(node) && context.params.has(node.name)) || t.isBooleanLiteral(node) || t.isNumericLiteral(node) || t.isStringLiteral(node) || t.isNullLiteral(node)
		|| (t.isUnaryExpression(node, { operator: "typeof" }) && t.isIdentifier(node.argument) && context.params.has(node.argument.name));
}

function formula(node: t.Node, context: CaptureContext, budget: { nodes: number }, depth = 0): BooleanFormula | null {
	if (++budget.nodes > 4096 || depth > 64) return null;
	if (t.isIdentifier(node)) {
		return context.params.has(node.name) ? capture(node, context, node.name) : null;
	}
	if (t.isBooleanLiteral(node) || t.isNumericLiteral(node) || t.isStringLiteral(node)) return { kind: "constant", value: !!node.value };
	if (t.isNullLiteral(node)) return { kind: "constant", value: false };
	if (t.isBinaryExpression(node) && (node.operator === "===" || node.operator === "!==") && inertValue(node.left, context) && inertValue(node.right, context)) return capture(node, context, node);
	if (t.isUnaryExpression(node, { operator: "!" })) {
		const operand = formula(node.argument, context, budget, depth + 1);
		return operand && { kind: "not", operand };
	}
	if (t.isLogicalExpression(node) && (node.operator === "&&" || node.operator === "||")) {
		const left = formula(node.left, context, budget, depth + 1), right = formula(node.right, context, budget, depth + 1);
		return left && right && { kind: node.operator === "&&" ? "and" : "or", left, right };
	}
	if (t.isConditionalExpression(node)) {
		const test = formula(node.test, context, budget, depth + 1);
		const consequent = formula(node.consequent, context, budget, depth + 1), alternate = formula(node.alternate, context, budget, depth + 1);
		return test && consequent && alternate && { kind: "or", left: { kind: "and", left: test, right: consequent }, right: { kind: "and", left: { kind: "not", operand: test }, right: alternate } };
	}
	return null;
}

function returnsBoolean(node: t.Node, depth = 0): boolean {
	if (depth > 64) return false;
	if (t.isBooleanLiteral(node) || t.isUnaryExpression(node, { operator: "!" })) return true;
	if (t.isBinaryExpression(node) && (node.operator === "===" || node.operator === "!==")) return true;
	if (t.isLogicalExpression(node) && (node.operator === "&&" || node.operator === "||")) return returnsBoolean(node.left, depth + 1) && returnsBoolean(node.right, depth + 1);
	return t.isConditionalExpression(node) && returnsBoolean(node.consequent, depth + 1) && returnsBoolean(node.alternate, depth + 1);
}

function boundedOption(value: number | undefined, fallback: number, maximum: number, name: string): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result < 0 || result > maximum) throw new RangeError(`Invalid ${name}`);
	return result;
}

/**
 * Resynthesize complete effect-free Boolean functions, retaining all declines.
 * @param source JavaScript accepted by Ruam's existing parser.
 * @param options Explicit compiler budgets; none asserts a source input bound.
 * @returns Source plus admission evidence, never a protection qualification.
 */
export function compileBooleanPermutationCode(source: string, options: BooleanPermutationSourceOptions = {}) {
	const maxFunctions = boundedOption(options.maxFunctions, 32, 1024, "maxFunctions");
	const maxTotalGeneratedBytes = boundedOption(options.maxTotalGeneratedBytes, 1_048_576, 16_777_216, "maxTotalGeneratedBytes");
	// Validate lower-level options even when the source has no eligible functions.
	const { maxFunctions: _functions, maxTotalGeneratedBytes: _bytes, ...compilerOptions } = options;
	try { compilePermutationFormula({ kind: "constant", value: false }, { ...compilerOptions, inputCount: 0 }); }
	catch (error) { if (!(error instanceof PermutationBudgetError)) throw error; }
	const ast = parse(source, { sourceType: "unambiguous", plugins: [...BABEL_PARSER_PLUGINS] });
	const regions: Region[] = [];
	const declined: Array<{ sourceStart: number; reason: string }> = [];
	let generatedBytes = 0;
	traverse(ast, {
		Function(path) {
			const node = path.node;
			const decline = (reason: string) => { declined.push({ sourceStart: node.start ?? -1, reason }); };
			if (!t.isFunctionDeclaration(node) && !t.isFunctionExpression(node) && !t.isArrowFunctionExpression(node)) { decline("method-kind"); return; }
			if (node.async || node.generator) { decline("suspending-function"); return; }
			if (node.params.length > 32 || node.params.some(param => !t.isIdentifier(param))) { decline("non-simple-parameters"); return; }
			const names = node.params.map(param => (param as t.Identifier).name);
			if (new Set(names).size !== names.length) { decline("duplicate-parameters"); return; }
			const context: CaptureContext = { params: new Set(names), values: [], inputs: new Map() };
			let expression: t.Expression | null = null;
			if (t.isBlockStatement(node.body)) {
				if (node.body.body.length === 1 && t.isReturnStatement(node.body.body[0]) && t.isExpression(node.body.body[0].argument)) expression = node.body.body[0].argument;
			} else expression = node.body;
			if (!expression || !returnsBoolean(expression)) { decline("not-single-boolean-return"); return; }
			const relation = formula(expression, context, { nodes: 0 });
			if (!relation) { decline("effectful-or-unsupported-expression"); return; }
			if (names.some(name => path.scope.getBinding(name)?.kind !== "param")) { decline("unproved-parameter-binding"); return; }
			if (regions.length >= maxFunctions) { decline("aggregate-function-budget"); return; }
			let compiled;
			try {
				compiled = compilePermutationFormula(relation, { ...compilerOptions, inputCount: context.values.length, seed: deriveSeed(options.seed ?? 0, `boolean-source:${node.start ?? -1}`) });
			} catch (error) {
				if (!(error instanceof PermutationBudgetError)) throw error;
				decline(`formula-budget:${error.message}`); return;
			}
			// The runtime body is the typed JsNode emitter's output, parsed into the
			// outer Babel tree. It is never evaluated dynamically at runtime.
			const implementation = parseExpression(compiled.code);
			const call = t.callExpression(implementation, context.values.map(value => t.unaryExpression("!", t.unaryExpression("!", value))));
			const bytes = Buffer.byteLength(generate(call).code, "utf8");
			if (generatedBytes + bytes > maxTotalGeneratedBytes) { decline("aggregate-output-budget"); return; }
			if (t.isBlockStatement(node.body)) node.body.body = [t.returnStatement(call)];
			else node.body = call;
			generatedBytes += bytes;
			regions.push({ sourceStart: node.start ?? -1, name: "id" in node && t.isIdentifier(node.id) ? node.id.name : null, inputCount: context.values.length, steps: compiled.report.steps, generatedBytes: bytes });
			path.skip();
		},
	});
	return {
		code: generate(ast).code,
		regions, declined, generatedBytes,
		scope: {
			experimental: true, inputProof: "effect-free-formal-predicates-and-boolean-return", runtimeInputFiltering: false,
			residualBackend: "caller-selected", wholeProgramReplacement: false, protectionQualified: false,
			sourceReflection: "not-preserved", resourceEquivalence: "not-proved",
		} as const,
	};
}
