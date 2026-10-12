import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { parse } from "@babel/parser";
import { traverse } from "../src/babel-compat.js";
import { compileFunction, resetUnitCounter } from "../src/compiler/index.js";
import { Op } from "../src/compiler/opcodes.js";
import { setupRegistry } from "../src/naming/setup.js";
import { emit } from "../src/ruamvm/emit.js";
import { fnExpr, exprStmt, lit, mapChildren, type JsNode } from "../src/ruamvm/nodes.js";
import { tryBuildNativeScalarBody } from "../src/ruamvm/native-scalar.js";
import type { BytecodeUnit, ConstantPoolEntry } from "../src/types.js";

function compile(source: string): BytecodeUnit {
	resetUnitCounter(71);
	let unit: BytecodeUnit | undefined;
	traverse(parse(source), { Function(path) { unit = compileFunction(path); path.stop(); } });
	if (!unit) throw new Error("Missing test function");
	return unit;
}

function build(unit: BytecodeUnit, seed = 0) {
	const { runtime: names, registry } = setupRegistry(seed);
	const result = tryBuildNativeScalarBody(unit, names, registry);
	if (!result.admitted) throw new Error(JSON.stringify(result));
	return { ...result, expression: emit(fnExpr(undefined,
		[names.unit, names.args, names.outer, names.tVal, names.nTgt, names.ho],
		[exprStmt(lit("use strict")), ...result.body],
	)) };
}

function value(entry: ConstantPoolEntry): unknown {
	if (entry.type === "bigint") return BigInt(entry.value);
	if (entry.type === "regex") return new RegExp(entry.value.pattern, entry.value.flags);
	return entry.value;
}

function instantiate(source: string, seed = 0) {
	const unit = compile(source);
	const built = build(unit, seed);
	const descriptor = { c: unit.constants.map(value) };
	const implementation = vm.runInNewContext(`(${built.expression})`) as (...args: unknown[]) => unknown;
	return { ...built, run: (...args: unknown[]) => implementation(descriptor, args, null, undefined, undefined, undefined) };
}

function outcome(run: () => unknown): unknown {
	try { return { value: run() }; }
	catch (error) { return { error: (error as Error).name }; }
}

describe("experimental straight-line scalar lowering", () => {
	it("preserves primitive numeric and BigInt operator behavior without numeric assumptions", () => {
		const values = [undefined, null, false, true, 0, -0, 1, -1, NaN, Infinity, -Infinity, "3", "x", 2n, -3n, Symbol("x")];
		for (const operator of ["+", "-", "*", "/", "%", "**", "|", "&", "^", "<<", ">>", ">>>", "==", "===", "<", ">="]) {
			const source = `function f(a,b){return a${operator}b}`;
			const expected = vm.runInNewContext(`(${source})`) as (a: unknown, b: unknown) => unknown;
			for (const seed of [0, 0xffffffff]) {
				const { run } = instantiate(source, seed);
				for (const a of values) for (const b of values) {
					// Avoid the unbounded computation of exponentiating large BigInts.
					expect(outcome(() => run(a, b))).toEqual(outcome(() => expected(a, b)));
				}
			}
		}
		for (const source of ["function f(){return -0}", "function f(){return 1e999}", "function f(){return 0/0}", "function f(){return 2n}"]) {
			const expected = vm.runInNewContext(`(${source})`) as () => unknown;
			expect(Object.is(instantiate(source).run(), expected())).toBe(true);
		}
	});

	it("preserves getter, coercion, abrupt completion and reentry order in actual Node", () => {
		const cases = [
			{
				source: "function f(o){const v=o.value;return v+v}",
				exercise: `const log=[];const o={get value(){log.push('get');return {[Symbol.toPrimitive](hint){log.push(hint);return 4}}}};return [invoke(o),log];`,
			},
			{
				source: "function f(a,b){return a.value+b.value}",
				exercise: `const log=[];const a={get value(){log.push('a.get');return {[Symbol.toPrimitive](hint){log.push('a.'+hint);return 3}}}};
				const b={get value(){log.push('b.get');return {[Symbol.toPrimitive](hint){log.push('b.'+hint);return '4'}}}};return [invoke(a,b),log];`,
			},
			{
				source: "function f(a,b){return a.value+b.value}",
				exercise: `const log=[];const token={};const a={get value(){log.push('a.get');return {valueOf(){log.push('coerce');return 3}}}};
				const b={get value(){log.push('b.get');throw token}};let same=false;try{invoke(a,b)}catch(e){same=e===token}return [same,log];`,
			},
			{
				source: "function f(o,key){return o[key]+o[key]}",
				exercise: `const log=[];const sym=Symbol('k');const key={[Symbol.toPrimitive](hint){log.push('key:'+hint);return sym}};
				const target={[sym]:4};const proxy=new Proxy(target,{get(o,k,r){log.push(k===sym?'get:symbol':'other');return Reflect.get(o,k,r)}});return [invoke(proxy,key),log];`,
			},
			{
				source: "function f(o){const v=o.value;return v+v}",
				exercise: `const log=[];const o={get value(){log.push(invoke({value:3}));return 4}};return [invoke(o),log];`,
			},
			{
				source: "function f(a,b){let x=a;a=b;return x+a}",
				exercise: `return [invoke(3,8),invoke('x','y')];`,
			},
			{
				source: "function f(a){a+=3;return a}",
				exercise: `const log=[];const a={[Symbol.toPrimitive](hint){log.push(hint);return '4'}};return [invoke(a),log];`,
			},
		];
		const fixtures = cases.map(({ source, exercise }) => {
			const unit = compile(source);
			return { source, exercise, scalar: build(unit, 307).expression, constants: unit.constants.map(value) };
		});
		const driver = `const vm=require('node:vm');for(const f of JSON.parse(process.argv[1])){
			const observed=[];for(const scalar of [false,true]){const c=vm.createContext({constants:f.constants});
			const invocation=scalar?'const generated=('+f.scalar+');const invoke=(...args)=>generated({c:constants},args,null);':'const invoke=('+f.source+');';
			observed.push(JSON.stringify(vm.runInContext('(function(){'+invocation+f.exercise+'})()',c,{timeout:1000})));}
			if(observed[0]!==observed[1])throw new Error(JSON.stringify({source:f.source,observed}));
		}process.stdout.write('matched:'+JSON.parse(process.argv[1]).length);`;
		const result = spawnSync("node", ["-e", driver, JSON.stringify(fixtures)], { encoding: "utf8", timeout: 10_000 });
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe(`matched:${cases.length}`);
	});

	it("erases runtime stack/register containers while keeping a duplicate getter evaluated once", () => {
		const source = "function f(o){const v=o.value;return v+v}";
		const built = instantiate(source);
		let gets = 0;
		expect(built.run({ get value() { gets++; return 7; } })).toBe(14);
		expect(gets).toBe(1);
		expect(built.stats.registerSlotsElided).toBeGreaterThan(0);
		expect(built.stats.maxStackDepth).toBeGreaterThan(1);
		expect(built.stats.operandStackArrays).toBe(0);
		expect(built.stats.registerArrays).toBe(0);
		const inspect = (node: JsNode): void => {
			expect(["ArrayExpr", "StackPush", "StackPop", "StackPeek", "CallExpr", "SwitchStmt", "ForStmt"].includes(node.type)).toBe(false);
			mapChildren(node, child => { inspect(child); return child; });
		};
		built.body.forEach(inspect);
	});

	it("leaves constant construction and sharing to the existing descriptor loader", () => {
		const unit = compile("function f(){return /a/g}");
		const built = build(unit);
		const implementation = vm.runInNewContext(`(${built.expression})`) as (unit: unknown, args: unknown[]) => unknown;
		const constant = /a/g;
		let poolReads = 0, valueReads = 0;
		const descriptor = { get c() { poolReads++; return new Proxy(["f", constant], { get(target, key) { valueReads++; return Reflect.get(target, key); } }); } };
		expect(implementation(descriptor, [])).toBe(constant);
		expect(implementation(descriptor, [])).toBe(constant);
		expect(poolReads).toBe(2);
		expect(valueReads).toBe(2);
		expect(built.expression).not.toContain("RegExp");
		expect(built.expression).not.toContain("BigInt");
	});

	it("declines residual language features without allocating names or changing input units", () => {
		for (const source of [
			"function f(x){return x()}", "function f(x){if(x)return 1;return 2}",
			"function f(x){return ()=>x}", "function f(x){x.value=3;return x}",
			"async function f(x){return x}", "function* f(){yield 1}",
			"function f(){return outside}", "function f(a){return a++}",
		]) {
			const unit = compile(source);
			const frozen = JSON.stringify(unit);
			const first = setupRegistry(9), second = setupRegistry(9);
			const result = tryBuildNativeScalarBody(unit, first.runtime, first.registry);
			expect(result.admitted).toBe(false);
			expect(JSON.stringify(unit)).toBe(frozen);
			expect(first.registry.createDynamicGenerator("probe")()).toBe(second.registry.createDynamicGenerator("probe")());
		}
	});

	it("rejects malformed instructions and unproven control flow explicitly", () => {
		const cases = [
			{ instructions: [{ opcode: Op.RETURN, operand: 0 }], reason: "stack-underflow" },
			{ instructions: [{ opcode: Op.LOAD_REG, operand: 7 }, { opcode: Op.RETURN, operand: 0 }], reason: "invalid-register" },
			{ instructions: [{ opcode: Op.PUSH_CONST, operand: 900 }, { opcode: Op.RETURN, operand: 0 }], reason: "invalid-constant" },
			{ instructions: [{ opcode: Op.PUSH_NULL, operand: NaN }, { opcode: Op.RETURN, operand: 0 }], reason: "invalid-operand" },
			{ instructions: [{ opcode: Op.RETURN_VOID, operand: 0 }, { opcode: Op.NOP, operand: 0 }], reason: "instructions-after-return" },
			{ instructions: [{ opcode: Op.PUSH_ONE, operand: 0 }], reason: "missing-terminal-return" },
			{ instructions: [{ opcode: Op.JMP, operand: 0 }], reason: "unsupported-opcode" },
		];
		for (const { instructions, reason } of cases) {
			const unit = { ...compile("function f(){return 3}"), instructions };
			const { runtime, registry } = setupRegistry(4);
			expect(tryBuildNativeScalarBody(unit, runtime, registry)).toMatchObject({ admitted: false, reason });
		}
	});
});
