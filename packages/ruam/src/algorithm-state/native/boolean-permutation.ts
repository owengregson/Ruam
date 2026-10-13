/**
 * Experimental width-five permutation realization of finite Boolean formulas.
 * Inputs are captured primitive booleans, never arbitrary JS expressions.
 * This is a compiler/cost specimen, not protection-qualified obfuscation.
 * @module algorithm-state/native/boolean-permutation
 */

import { NameRegistry } from "../../naming/registry.js";
import {
	BOp, UOp, assign, bin, exprStmt, fnExpr, id, ifStmt, lit, newExpr,
	returnStmt, ternary, throwStmt, un, varDecl, type FnExpr, type JsNode,
} from "../../ruamvm/nodes.js";
import { emit } from "../../ruamvm/emit.js";

// --- Positive input grammar ---

export type BooleanFormula =
	| { readonly kind: "constant"; readonly value: boolean }
	| { readonly kind: "input"; readonly index: number }
	| { readonly kind: "not"; readonly operand: BooleanFormula }
	| { readonly kind: "and" | "or"; readonly left: BooleanFormula; readonly right: BooleanFormula };

export type Permutation5 = readonly [number, number, number, number, number];

export interface PermutationInstruction {
	/** null selects a constant permutation; both arms are then equal. */
	readonly inputIndex: number | null;
	readonly whenFalse: Permutation5;
	readonly whenTrue: Permutation5;
}

export interface PermutationCompilationOptions {
	inputCount: number;
	seed?: number;
	maxSteps?: number;
	maxNodes?: number;
	maxDepth?: number;
	maxOutputBytes?: number;
}

/** An explicit experiment budget refusal, distinct from invalid IR or compiler bugs. */
export class PermutationBudgetError extends RangeError {
	constructor(message: string) {
		super(message);
		this.name = "PermutationBudgetError";
	}
}

export interface PermutationCompilation {
	/** Anonymous function expression accepting inputCount primitive booleans. */
	code: string;
	ast: FnExpr;
	program: readonly PermutationInstruction[];
	report: {
		inputCount: number;
		formulaNodes: number;
		formulaDepth: number;
		steps: number;
		outputBytes: number;
		maxSteps: number;
		inputContract: "captured-primitive-booleans";
		protectionQualified: false;
		wholeJavaScriptScopeQualified: false;
	};
}

// --- Group construction ---

const IDENTITY: Permutation5 = Object.freeze([0, 1, 2, 3, 4]);
const TARGET: Permutation5 = Object.freeze([1, 2, 3, 4, 0]);
const SECOND: Permutation5 = Object.freeze([1, 3, 0, 4, 2]);

/** Execute a first, then b: each step maps the current state s to p[s]. */
function then(a: Permutation5, b: Permutation5): Permutation5 {
	return Object.freeze(a.map((v) => b[v]!)) as unknown as Permutation5;
}

function inverse(p: Permutation5): Permutation5 {
	return Object.freeze(IDENTITY.map((i) => p.indexOf(i))) as unknown as Permutation5;
}

/** Label map r satisfying r(from(s)) = to(r(s)) for two five-cycles. */
function relabel(from: Permutation5, to: Permutation5): Permutation5 {
	const labels = [0, 0, 0, 0, 0];
	let a = 0, b = 0;
	for (let i = 0; i < 5; i++) {
		labels[a] = b;
		a = from[a]!;
		b = to[b]!;
	}
	return Object.freeze(labels) as unknown as Permutation5;
}

function conjugate(p: Permutation5, labels: Permutation5): Permutation5 {
	return then(then(inverse(labels), p), labels);
}

const SECOND_LABELS = relabel(TARGET, SECOND);
// Execution order P, Q, P^-1, Q^-1. For both true this is a five-cycle.
const COMMUTATOR = then(then(then(TARGET, SECOND), inverse(TARGET)), inverse(SECOND));
const RESULT_LABELS = relabel(COMMUTATOR, TARGET);

function step(inputIndex: number | null, whenFalse: Permutation5, whenTrue: Permutation5): PermutationInstruction {
	return Object.freeze({ inputIndex, whenFalse, whenTrue });
}

function invertProgram(program: readonly PermutationInstruction[]): PermutationInstruction[] {
	return [...program].reverse().map((s) => step(s.inputIndex, inverse(s.whenFalse), inverse(s.whenTrue)));
}

function relabelProgram(program: readonly PermutationInstruction[], labels: Permutation5): PermutationInstruction[] {
	return program.map((s) => step(s.inputIndex, conjugate(s.whenFalse, labels), conjugate(s.whenTrue, labels)));
}

function negate(program: readonly PermutationInstruction[]): PermutationInstruction[] {
	// False: identity^-1 then TARGET. True: TARGET^-1 then TARGET.
	return [...invertProgram(program), step(null, TARGET, TARGET)];
}

function conjunction(left: readonly PermutationInstruction[], right: readonly PermutationInstruction[]): PermutationInstruction[] {
	const q = relabelProgram(right, SECOND_LABELS);
	const commutator = [...left, ...q, ...invertProgram(left), ...invertProgram(q)];
	return relabelProgram(commutator, RESULT_LABELS);
}

function construct(formula: BooleanFormula): PermutationInstruction[] {
	switch (formula.kind) {
		case "constant": return formula.value ? [step(null, TARGET, TARGET)] : [];
		case "input": return [step(formula.index, IDENTITY, TARGET)];
		case "not": return negate(construct(formula.operand));
		case "and": return conjunction(construct(formula.left), construct(formula.right));
		case "or": return negate(conjunction(negate(construct(formula.left)), negate(construct(formula.right))));
	}
}

// --- Admission and bounded construction ---

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new TypeError(`${label} must be an integer in [${minimum}, ${maximum}]`);
	}
	return value;
}

/** Read only own data properties; do not admit AST nodes, inherited fields or accessors. */
function fields(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected a Boolean formula record");
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== null && prototype !== Object.prototype) throw new TypeError("Formula records must have ordinary or null prototypes");
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const result: Record<string, unknown> = Object.create(null);
	for (const key of Reflect.ownKeys(descriptors)) {
		if (typeof key !== "string") throw new TypeError("Formula symbol fields are not admitted");
		const descriptor = descriptors[key]!;
		if (!("value" in descriptor)) throw new TypeError("Formula accessors are not admitted");
		result[key] = descriptor.value;
	}
	return result;
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
	const keys = Object.keys(record);
	if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
		throw new TypeError("Formula has missing or unrecognized fields");
	}
}

// --- Native typed AST emission ---

function selectState(state: JsNode, p: Permutation5): JsNode {
	if (p.every((value, i) => value === i)) return state;
	let expression: JsNode = lit(p[4]);
	for (let i = 3; i >= 0; i--) expression = ternary(bin(BOp.Seq, state, lit(i)), lit(p[i]!), expression);
	return expression;
}

/**
 * Compile a finite formula to a straight-line native function. Boolean arguments
 * must already be captured; this API does not lift JS expressions or assert that
 * their property access, coercion, calls, or short-circuit effects are pure.
 * Budgets limit compilation; exceeding one refuses this experimental transform.
 * @param formula Positive finite Boolean formula record.
 * @param options Arity, naming seed, and bounded compiler resource caps.
 * @returns Generated typed AST, native source, build-time program and cost report.
 */
export function compilePermutationFormula(formula: BooleanFormula, options: PermutationCompilationOptions): PermutationCompilation {
	const inputCount = integer(options.inputCount, 0, 32, "inputCount");
	const seed = integer(options.seed ?? 0, 0, 0xffffffff, "seed");
	const maxSteps = integer(options.maxSteps ?? 256, 0, 4096, "maxSteps");
	const maxNodes = integer(options.maxNodes ?? 1024, 1, 16384, "maxNodes");
	const maxDepth = integer(options.maxDepth ?? 64, 1, 128, "maxDepth");
	const maxOutputBytes = integer(options.maxOutputBytes ?? 65536, 1, 1048576, "maxOutputBytes");
	let nodes = 0, depth = 0;
	const active = new Set<object>();
	const snapshot = (value: unknown, level: number): { formula: BooleanFormula; steps: number } => {
		if (++nodes > maxNodes) throw new PermutationBudgetError("Boolean formula node cap exceeded");
		if (level > maxDepth) throw new PermutationBudgetError("Boolean formula depth cap exceeded");
		depth = Math.max(depth, level);
		if (value !== null && typeof value === "object" && active.has(value)) throw new TypeError("Cyclic Boolean formula");
		const record = fields(value);
		active.add(value as object);
		let result: { formula: BooleanFormula; steps: number };
		switch (record.kind) {
			case "constant":
				exactKeys(record, ["kind", "value"]);
				if (typeof record.value !== "boolean") throw new TypeError("Formula constants must be booleans");
				result = { formula: { kind: "constant", value: record.value }, steps: record.value ? 1 : 0 };
				break;
			case "input": {
				exactKeys(record, ["kind", "index"]);
				const index = integer(record.index, 0, inputCount - 1, "input index");
				result = { formula: { kind: "input", index }, steps: 1 };
				break;
			}
			case "not": {
				exactKeys(record, ["kind", "operand"]);
				const child = snapshot(record.operand, level + 1);
				result = { formula: { kind: "not", operand: child.formula }, steps: child.steps + 1 };
				break;
			}
			case "and": case "or": {
				exactKeys(record, ["kind", "left", "right"]);
				const left = snapshot(record.left, level + 1), right = snapshot(record.right, level + 1);
				result = { formula: { kind: record.kind, left: left.formula, right: right.formula }, steps: 2 * (left.steps + right.steps) + (record.kind === "or" ? 5 : 0) };
				break;
			}
			default: throw new TypeError("Unrecognized Boolean formula kind");
		}
		active.delete(value as object);
		if (result.steps > maxSteps) throw new PermutationBudgetError("Permutation step cap exceeded before construction");
		return result;
	};
	const admitted = snapshot(formula, 1);
	const program = Object.freeze(construct(admitted.formula));
	if (program.length !== admitted.steps) throw new Error("Permutation step accounting mismatch");
	const registry = new NameRegistry(seed);
	const names = registry.createScope("booleanPermutation");
	const parameters = Array.from({ length: inputCount }, (_, i) => names.claim(`input${i}`));
	const state = names.claim("state");
	registry.resolveAll();
	const body: JsNode[] = parameters.map((parameter) => ifStmt(
		bin(BOp.Sneq, un(UOp.Typeof, id(parameter)), lit("boolean")),
		[throwStmt(newExpr(id("TypeError"), [lit("Permutation inputs must be primitive booleans")]))],
	));
	body.push(varDecl(state, lit(0)));
	for (const instruction of program) {
		const selected = instruction.inputIndex === null
			? selectState(id(state), instruction.whenTrue)
			: ternary(id(parameters[instruction.inputIndex]!), selectState(id(state), instruction.whenTrue), selectState(id(state), instruction.whenFalse));
		body.push(exprStmt(assign(id(state), selected)));
	}
	body.push(returnStmt(bin(BOp.Seq, id(state), lit(TARGET[0]))));
	const ast = fnExpr(undefined, parameters, body);
	const code = emit(ast);
	const outputBytes = new TextEncoder().encode(code).byteLength;
	if (outputBytes > maxOutputBytes) throw new PermutationBudgetError("Permutation output byte cap exceeded");
	return { code, ast, program, report: {
		inputCount, formulaNodes: nodes, formulaDepth: depth, steps: program.length, outputBytes, maxSteps,
		inputContract: "captured-primitive-booleans", protectionQualified: false, wholeJavaScriptScopeQualified: false,
	} };
}
