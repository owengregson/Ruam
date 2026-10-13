import { expect, test } from "bun:test";
import { Script } from "node:vm";
import { execFileSync } from "node:child_process";
import {
	compilePermutationFormula, PermutationBudgetError,
	type BooleanFormula, type PermutationInstruction,
} from "../../src/algorithm-state/native/boolean-permutation.js";
import { deriveSeed, lcgNext } from "../../src/naming/scope.js";
import { emit } from "../../src/ruamvm/emit.js";

const input = (index: number): BooleanFormula => ({ kind: "input", index });
const constant = (value: boolean): BooleanFormula => ({ kind: "constant", value });
const not = (operand: BooleanFormula): BooleanFormula => ({ kind: "not", operand });
const and = (left: BooleanFormula, right: BooleanFormula): BooleanFormula => ({ kind: "and", left, right });
const or = (left: BooleanFormula, right: BooleanFormula): BooleanFormula => ({ kind: "or", left, right });

// Independent specification: recursive native Boolean operations, no permutations.
function oracle(formula: BooleanFormula, values: readonly boolean[]): boolean {
	switch (formula.kind) {
		case "constant": return formula.value;
		case "input": return values[formula.index]!;
		case "not": return !oracle(formula.operand, values);
		case "and": return oracle(formula.left, values) && oracle(formula.right, values);
		case "or": return oracle(formula.left, values) || oracle(formula.right, values);
	}
}

function action(program: readonly PermutationInstruction[], values: readonly boolean[], initial: number): number {
	let state = initial;
	for (const step of program) state = (step.inputIndex === null || values[step.inputIndex] ? step.whenTrue : step.whenFalse)[state]!;
	return state;
}

function execute(code: string): (...values: unknown[]) => boolean {
	return new Script(`(${code})`).runInNewContext({}, { timeout: 1000 });
}

function allInputs(count: number): boolean[][] {
	return Array.from({ length: 2 ** count }, (_, bits) => Array.from({ length: count }, (_, i) => !!(bits & (1 << i))));
}

test("exhausts every formula of up to three nodes over two inputs and constants", () => {
	const leaves = [constant(false), constant(true), input(0), input(1)];
	const formulas = [...leaves, ...leaves.map(not), ...leaves.map((leaf) => not(not(leaf)))];
	for (const a of leaves) for (const b of leaves) formulas.push(and(a, b), or(a, b));
	expect(formulas).toHaveLength(44);
	for (const seed of [0, 1, 41, 0x80000000, 0xffffffff]) {
		for (const formula of formulas) {
			const compiled = compilePermutationFormula(formula, { inputCount: 2, seed });
			const native = execute(compiled.code);
			for (const values of allInputs(2)) {
				const expected = oracle(formula, values);
				expect(native(...values)).toBe(expected);
				// Stronger invariant than the single emitted acceptance state:
				// the complete product is identity or the canonical five-cycle.
				for (let initial = 0; initial < 5; initial++) expect(action(compiled.program, values, initial)).toBe(expected ? (initial + 1) % 5 : initial);
			}
			expect(compiled.report.outputBytes).toBe(new TextEncoder().encode(compiled.code).length);
			expect(compiled.report.protectionQualified).toBe(false);
			expect(compiled.report.wholeJavaScriptScopeQualified).toBe(false);
		}
	}
});

test("handles nonlocal repeated inputs and nested Boolean composition on Bun and native Node", () => {
	let state = deriveSeed(731, "permutationTestFormulas");
	const next = () => { state = lcgNext(state); return state; };
	const generate = (depth: number): BooleanFormula => {
		if (!depth) return input(next() % 4);
		const kind = next() % 3;
		if (kind === 0) return not(generate(depth - 1));
		const a = generate(depth - 1), b = generate(depth - 1);
		return kind === 1 ? and(a, b) : or(a, b);
	};
	const fixtures = Array.from({ length: 36 }, (_, seed) => {
		const formula = generate(3), compiled = compilePermutationFormula(formula, { inputCount: 4, seed });
		const cases = allInputs(4).map((values) => ({ values, expected: oracle(formula, values) }));
		const native = execute(compiled.code);
		for (const entry of cases) expect(native(...entry.values)).toBe(entry.expected);
		return { code: compiled.code, cases };
	});
	const result = JSON.parse(execFileSync("node", ["-e", `
const fs = require('node:fs'), vm = require('node:vm');
let checked = 0;
for (const fixture of JSON.parse(fs.readFileSync(0, 'utf8'))) {
  const fn = vm.runInNewContext('(' + fixture.code + ')', {}, {timeout: 1000});
  for (const entry of fixture.cases) {
    if (fn(...entry.values) !== entry.expected) throw new Error('Boolean source oracle mismatch');
    checked++;
  }
}
process.stdout.write(JSON.stringify({checked}));
`], { input: JSON.stringify(fixtures), encoding: "utf8", timeout: 10000 }));
	expect(result.checked).toBe(576);
}, 15000);

test("the independently specified oracle rejects wrong permutation order", () => {
	const formula = and(input(0), input(1));
	const compiled = compilePermutationFormula(formula, { inputCount: 2 });
	const start = 3; // Two input guards then the scalar state declaration.
	const steps = compiled.ast.body.slice(start, -1);
	// P, P^-1, Q, Q^-1 cancels even when both operands are true. Simply
	// reversing all four steps need not change the acceptance of state zero.
	const mutated = { ...compiled.ast, body: [
		...compiled.ast.body.slice(0, start),
		steps[0]!, steps[2]!, steps[1]!, steps[3]!,
		compiled.ast.body.at(-1)!,
	] };
	const wrong = execute(emit(mutated));
	expect(allInputs(2).some((values) => wrong(...values) !== oracle(formula, values))).toBe(true);
	expect(wrong(true, true)).toBe(false);
});

test("admits no coercive expression grammar and rejects nonboolean runtime values without coercion", () => {
	const compiled = compilePermutationFormula(and(input(0), input(1)), { inputCount: 2 });
	const native = execute(compiled.code);
	let conversions = 0;
	const object = { valueOf() { conversions++; return true; }, [Symbol.toPrimitive]() { conversions++; return true; } };
	for (const value of [0, 1, "", "yes", null, undefined, object, new Boolean(true), () => true]) {
		expect(() => native(value, true)).toThrow("primitive booleans");
		expect(() => native(false, value)).toThrow("primitive booleans");
	}
	expect(conversions).toBe(0);
	expect(() => native(true)).toThrow("primitive booleans");
	const invalid: unknown[] = [null, true, [], { kind: "input", index: 2 }, { kind: "input", index: -1 },
		{ kind: "constant", value: 1 }, { kind: "call", callee: "effect" },
		{ kind: "input", index: 0, source: "getter.x" }, { kind: "not" },
		Object.create({ kind: "constant", value: true })];
	for (const formula of invalid) expect(() => compilePermutationFormula(formula as BooleanFormula, { inputCount: 2 })).toThrow(TypeError);
	let reads = 0;
	expect(() => compilePermutationFormula({ get kind() { reads++; return "constant"; }, value: true } as BooleanFormula, { inputCount: 0 })).toThrow("accessors");
	expect(reads).toBe(0);
});

test("bounds construction before expansion and distinguishes experiment refusals", () => {
	const tree = (depth: number): BooleanFormula => depth ? and(tree(depth - 1), tree(depth - 1)) : input(0);
	const atCap = compilePermutationFormula(tree(4), { inputCount: 1 });
	expect(atCap.program).toHaveLength(256);
	expect(atCap.code.length).toBeLessThanOrEqual(65536);
	expect(execute(atCap.code)(true)).toBe(true);
	expect(execute(atCap.code)(false)).toBe(false);
	for (const options of [{ maxSteps: 255 }, { maxNodes: 20 }, { maxDepth: 4 }, { maxOutputBytes: 10 }]) {
		expect(() => compilePermutationFormula(tree(4), { inputCount: 1, ...options })).toThrow(PermutationBudgetError);
	}
	expect(() => compilePermutationFormula(tree(5), { inputCount: 1 })).toThrow("step cap exceeded before construction");
	expect(compilePermutationFormula(constant(false), { inputCount: 0, maxSteps: 0 }).program).toHaveLength(0);
	for (const options of [{ inputCount: 33 }, { maxSteps: Infinity }, { maxSteps: 4097 }, { seed: -1 }, { maxDepth: 129 }, { maxNodes: 0 }, { maxOutputBytes: 1048577 }]) {
		expect(() => compilePermutationFormula(input(0), { inputCount: 1, ...options })).toThrow(TypeError);
	}
	const cycle: any = { kind: "not" }; cycle.operand = cycle;
	expect(() => compilePermutationFormula(cycle, { inputCount: 0 })).toThrow("Cyclic");
});

test("uses deterministic scoped names and emits no runtime program table or interpreter", () => {
	const formula = or(and(input(0), input(1)), not(input(2)));
	const a = compilePermutationFormula(formula, { inputCount: 3, seed: 17 });
	expect(compilePermutationFormula(formula, { inputCount: 3, seed: 17 }).code).toBe(a.code);
	expect(compilePermutationFormula(formula, { inputCount: 3, seed: 18 }).code).not.toBe(a.code);
	expect(a.ast.params.every((parameter) => typeof parameter !== "string")).toBe(true);
	expect(new Set(a.ast.params.map((parameter) => String((parameter as any).name))).size).toBe(3);
	expect(a.code).not.toMatch(/\b(?:while|for|switch|eval|arguments)\b|\[/);
	expect(Object.isFrozen(a.program)).toBe(true);
	expect(Object.isFrozen(a.program[0])).toBe(true);
	expect(Object.isFrozen(a.program[0]!.whenTrue)).toBe(true);
	const shared = not(input(0));
	expect(compilePermutationFormula(and(shared, shared), { inputCount: 1 }).report.formulaNodes).toBe(5);
});
