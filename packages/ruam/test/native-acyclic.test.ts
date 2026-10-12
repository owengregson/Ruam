import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { parse } from "@babel/parser";
import { traverse } from "../src/babel-compat.js";
import { compileFunction, resetUnitCounter } from "../src/compiler/index.js";
import { Op } from "../src/compiler/opcodes.js";
import { setupRegistry } from "../src/naming/setup.js";
import { emit } from "../src/ruamvm/emit.js";
import { tryBuildNativeAcyclicBody } from "../src/ruamvm/native-acyclic.js";
import { fnExpr, mapChildren, labeledStmt, breakStmt, returnStmt, lit, type JsNode } from "../src/ruamvm/nodes.js";
import { obfuscateLocals } from "../src/ruamvm/transforms.js";
import { compileNativeCandidateCode } from "../src/transform.js";
import type { BytecodeUnit } from "../src/types.js";

function compile(source: string): BytecodeUnit {
	resetUnitCounter(71);
	let unit: BytecodeUnit | undefined;
	traverse(parse(source), { Function(path) { unit = compileFunction(path); path.stop(); } });
	if (!unit) throw new Error("Missing function");
	return unit;
}
function build(unit: BytecodeUnit, seed = 71) {
	const { runtime: names, temps, registry } = setupRegistry(seed);
	const result = tryBuildNativeAcyclicBody(unit, names, temps, registry);
	if (!result.admitted) throw new Error(JSON.stringify(result));
	const expression = emit(fnExpr(undefined,
		[names.unit, names.args, names.outer, names.tVal, names.nTgt, names.ho, names.globalRef, names.tdzSentinel], result.body));
	return { ...result, expression };
}
function instantiate(source: string, seed = 71) {
	const unit = compile(source), built = build(unit, seed);
	const generated = vm.runInNewContext(`(${built.expression})`);
	const constants = unit.constants.map(c => c.type === "bigint" ? BigInt(c.value)
		: c.type === "regex" ? new RegExp(c.value.pattern, c.value.flags) : c.value);
	return { ...built, run: (...args: unknown[]) => generated({ c: constants }, args, Object.create(null), undefined, undefined, undefined, globalThis, {}) };
}
function outcome(f: () => unknown) {
	try { return { value: f() }; } catch (e) { return { error: (e as Error).name }; }
}

describe("opt-in native acyclic scalar lowering", () => {
	it("preserves branch and register joins across primitive, coercing and abrupt values", () => {
		const sources = [
			"function f(a,b){return a ? b : a}",
			"function f(a,b){let x=a,y=b;if(a){x=b;y=a}return x+y}",
			"function f(a,b){return a&&b||a}",
			"function f(a,b){return a??b}",
			"function f(a,b){if(a<3)return b+1;if(b>=a)return b-a;return a*b}",
			"function f(a,b){if(a){if(b)return a;return b}if(b)return a+b;return a}",
		];
		const values = [undefined, null, false, true, 0, -0, 1, 4, NaN, Infinity, "3", "x", 2n, Symbol("x")];
		for (const source of sources) {
			const original = vm.runInNewContext(`(${source})`);
			for (const seed of [0, 71, 0xffffffff]) {
				const built = instantiate(source, seed);
				for (const a of values) for (const b of values) expect(outcome(() => built.run(a, b))).toEqual(outcome(() => original(a, b)));
				const visit = (node: JsNode): JsNode => {
					expect(["StackPush", "StackPop", "StackPeek", "ArrayExpr", "SwitchStmt", "ForStmt", "WhileStmt"].includes(node.type)).toBe(false);
					return mapChildren(node, visit);
				};
				built.body.forEach(visit);
				expect(built.stats.operandStackArrays).toBe(0);
				expect(built.stats.registerArrays).toBe(0);
			}
		}
	}, 30_000);

	it("topologically orders a forward DAG whose bytecode targets go backwards", () => {
		const unit = { ...compile("function f(){return 0}"), instructions: [
			{ opcode: Op.JMP, operand: 3 },
			{ opcode: Op.PUSH_ONE, operand: 0 },
			{ opcode: Op.RETURN, operand: 0 },
			{ opcode: Op.JMP, operand: 1 },
		] };
		const built = build(unit);
		expect(vm.runInNewContext(`(${built.expression})`)({ c: [] }, [])).toBe(1);
		expect(built.stats.basicBlocks).toBe(3);
	});

	it("renames labelled regions and their transfers consistently", () => {
		const original = [labeledStmt("forwardRegion", [breakStmt("forwardRegion"), returnStmt(lit(91))]), returnStmt(lit(7))];
		for (const seed of [0, 71, 0xffffffff]) {
			const { registry } = setupRegistry(seed, new Set(["sourceBinding"]));
			const renamed = obfuscateLocals(original, seed, new Set(), registry);
			const expression = emit(fnExpr(undefined, [], renamed));
			expect(expression).not.toContain("forwardRegion");
			expect(vm.runInNewContext(`(${expression})()`)).toBe(7);
		}
	});

	it("decodes every admitted fused comparison form without changing coercion order", () => {
		const forms = [
			[Op.REG_LT_CONST_JF, Op.REG_LT_REG_JF, Op.CONST_LT_JF, "<"],
			[Op.REG_LTE_CONST_JF, Op.REG_LTE_REG_JF, Op.CONST_LTE_JF, "<="],
			[Op.REG_GT_CONST_JF, Op.REG_GT_REG_JF, Op.CONST_GT_JF, ">"],
			[Op.REG_GTE_CONST_JF, Op.REG_GTE_REG_JF, Op.CONST_GTE_JF, ">="],
			[Op.REG_SEQ_CONST_JF, Op.REG_SEQ_REG_JF, Op.CONST_SEQ_JF, "==="],
			[Op.REG_SNEQ_CONST_JF, Op.REG_SNEQ_REG_JF, Op.CONST_SNEQ_JF, "!=="],
		] as const;
		for (const [regConstant, regRegister, stackConstant, operator] of forms) {
			for (const opcode of [regConstant, regRegister, stackConstant]) {
				const unit = { ...compile("function f(){return 0}"), registerCount: 2,
					constants: [{ type: "number" as const, value: 2 }], instructions: [
						{ opcode: Op.LOAD_ARG, operand: 0 }, { opcode: Op.STORE_REG, operand: 0 },
						{ opcode: Op.LOAD_ARG, operand: 1 }, { opcode: Op.STORE_REG, operand: 1 },
						{ opcode: opcode === stackConstant ? Op.LOAD_REG : Op.NOP, operand: 0 },
						{ opcode, operand: (8 << 16) | (opcode === regRegister ? 1 << 8 : 0) },
						{ opcode: Op.PUSH_ONE, operand: 0 }, { opcode: Op.RETURN, operand: 0 },
						{ opcode: Op.PUSH_ZERO, operand: 0 }, { opcode: Op.RETURN, operand: 0 },
					] };
				const generated = vm.runInNewContext(`(${build(unit).expression})`);
				const original = new Function("a", "b", `return a${operator}b ? 1 : 0`);
				for (const value of [undefined, null, -0, NaN, "2", 2n, Symbol("x")]) {
					expect(outcome(() => generated({ c: [2] }, [value, 2]))).toEqual(outcome(() => original(value, 2)));
				}
				const logs: string[][] = [];
				for (const lowered of [false, true]) {
					const log: string[] = [];
					const a = { valueOf() { log.push("a"); return 1; } };
					const b = opcode === regRegister ? { valueOf() { log.push("b"); return 2; } } : 2;
					if (lowered) generated({ c: [2] }, [a, b]); else original(a, b);
					logs.push(log);
				}
				expect(logs[1]).toEqual(logs[0]);
			}
		}
	});

	it("preserves exact scope get/has/TDZ order and live reads across callback reentry", () => {
		const unit = { ...compile("function f(){return outside}"), constants: [{ type: "string" as const, value: "x" }] };
		const built = build({ ...unit, instructions: [{ opcode: Op.LOAD_SCOPED, operand: 0 }, { opcode: Op.RETURN, operand: 0 }] });
		const generated = vm.runInNewContext(`(${built.expression})`);
		const log: string[] = [], sentinel = {};
		const globals = new Proxy({ x: 9 }, { get(t, k, r) { log.push("global"); return Reflect.get(t, k, r); } });
		let present = false, value: unknown = undefined;
		const scope = new Proxy({}, {
			get() { log.push("get"); return value; }, has() { log.push("has"); return present; },
		});
		const invoke = () => generated({ c: ["x"] }, [], scope, undefined, undefined, undefined, globals, sentinel);
		expect(invoke()).toBe(9); expect(log.splice(0)).toEqual(["get", "has", "global"]);
		present = true; expect(invoke()).toBeUndefined(); expect(log.splice(0)).toEqual(["get", "has"]);
		value = 4; expect(invoke()).toBe(4); expect(log.splice(0)).toEqual(["get"]);
		value = sentinel; expect(outcome(invoke)).toEqual({ error: "ReferenceError" }); expect(log.splice(0)).toEqual(["get"]);
		const reentrant = instantiate("function f(o,fn){const a=o.x;if(a)return fn(a)+o.x;return fn(0)}");
		const object = { x: 2 };
		expect(reentrant.run(object, (v: number) => { object.x = 7; return reentrant.run({ x: 0 }, () => v + 1); })).toBe(10);
	});

	it("matches source and residual behavior for ordered reads/calls/construction in actual Node", () => {
		const cases = [
			{ source: "function target(o,f){return o.m(f())};globalThis.result=[target(receiver,change),log]", bootstrap: `var log=[];var receiver={v:1};Object.defineProperty(receiver,'m',{configurable:true,get(){log.push('get');return function(a){log.push('old:'+this.v);return a}}});function change(){log.push('arg');receiver.v=9;Object.defineProperty(receiver,'m',{value(){log.push('new')},configurable:true});return 7}` },
			{ source: "function target(f){return f(1,2,3,4)};globalThis.result=[target(strictFn),target(sloppyFn)]", bootstrap: "function strictFn(){'use strict';return this===undefined};function sloppyFn(){return this===globalThis}" },
			{ source: "function target(c,f){return new c(f(1),f(2)).out};globalThis.result=[target(ctor,arg),log]", bootstrap: `var log=[];var ctor=new Proxy(function C(a,b){log.push('body');this.out=[a,b,new.target===ctor]}, {construct(target,args,newTarget){log.push('construct');return Reflect.construct(target,args,newTarget)}});function arg(n){log.push('arg:'+n);return n}` },
			{ source: "function target(f,a,b){return f(a(),b())};try{target(null,first,bad)}catch(e){globalThis.result=[e.name,e.message,log]}", bootstrap: "var log=[];function first(){log.push('first');return 1};function bad(){log.push('throw');throw new RangeError('argument')}" },
			{ source: "function target(o,f){let x=o.a;if(x<3)x=f(x);else x=o.b;return x+o.c};globalThis.result=[target(o,callback),log]", bootstrap: `var log=[];var o={get a(){log.push('a');return {valueOf(){log.push('coerce');return 1}}},get b(){log.push('b');throw Error('untaken')},get c(){log.push('c');return 3}};function callback(x){log.push('call');return 8}` },
			{ source: "function target(f,a){if(a)return f(target(f,0))+a;return f(2)};globalThis.result=[target(callback,3),log]", bootstrap: "var log=[];function callback(x){log.push(x);return x+1}" },
			{ source: "function target(o,f){return o?.m(f())??f(9)};globalThis.result=[target(null,arg),target(receiver,arg),log]", bootstrap: "var log=[];function arg(n){log.push(n===undefined?'arg':n);return n??4};var receiver={m(x){log.push('m');return x}}" },
			{ source: "function target(a,b){if(a<b)return a+b;throw a};var result;try{result=target(first,second)}catch(e){result=[e===first,log]};globalThis.result=result", bootstrap: "var log=[];var first={[Symbol.toPrimitive](h){log.push('a:'+h);return 4}};var second={[Symbol.toPrimitive](h){log.push('b:'+h);return 2}}" },
		];
		const fixtures = cases.flatMap(c => [0, 71, 0xffffffff].map(seed => {
			const lowered = compileNativeCandidateCode(c.source, { seed, acyclicLowering: true });
			expect(lowered.report.acyclicUnits).toBeGreaterThan(0);
			return { ...c, lowered: lowered.code, residual: compileNativeCandidateCode(c.source, { seed, scalarLowering: false }).code };
		}));
		const driver = `const vm=require('node:vm'),f=JSON.parse(require('node:fs').readFileSync(0,'utf8'));for(const row of f){const observed=[];for(const code of [row.source,row.lowered,row.residual]){const context=vm.createContext({});vm.runInContext(row.bootstrap,context);vm.runInContext(code,context,{timeout:1000});observed.push(JSON.stringify(context.result))}if(observed.some(v=>v!==observed[0]))throw Error(JSON.stringify({source:row.source,observed}))}process.stdout.write('matched:'+f.length)`;
		const result = spawnSync("node", ["-e", driver], { input: JSON.stringify(fixtures), encoding: "utf8", timeout: 15_000 });
		expect(result.error).toBeUndefined(); expect(result.status).toBe(0); expect(result.stderr).toBe("");
		expect(result.stdout).toBe(`matched:${fixtures.length}`);
	// Compilation plus the existing 15-second subprocess deadline are one batch.
	}, 60_000);

	it("retains the explicit inherited mutable-apply behavior without claiming a source repair", () => {
		const source = "function target(f){return f(1,2,3,4)};globalThis.result=target(external)";
		const bootstrap = "function external(){return 4};external.apply=function(){return 91}";
		for (const options of [{ scalarLowering: false }, { acyclicLowering: true }]) {
			const context = vm.createContext({}); vm.runInContext(bootstrap, context);
			vm.runInContext(compileNativeCandidateCode(source, { seed: 4, ...options }).code, context);
			expect(context.result).toBe(91);
		}
		const context = vm.createContext({}); vm.runInContext(bootstrap + ";" + source, context); expect(context.result).toBe(4);
	});

	it("keeps invalid uninitialized and primitive callees as runtime errors in Node", () => {
		const sources = [
			"function target(){let x;return new x()}",
			"function target(){var x;return x()}",
			"function target(){const x=-1;return x()}",
			"function target(){const x=1;return new x()}",
		].map(source => source + ";try{target()}catch(e){globalThis.result=e.name}");
		const fixtures = sources.map(source => {
			const lowered = compileNativeCandidateCode(source, { seed: 71, acyclicLowering: true });
			expect(lowered.report.acyclicUnits).toBe(1);
			return [source, compileNativeCandidateCode(source, { seed: 71, scalarLowering: false }).code, lowered.code];
		});
		const driver = `const vm=require('node:vm'),rows=JSON.parse(require('node:fs').readFileSync(0,'utf8'));for(const row of rows)for(const code of row){const context=vm.createContext({});vm.runInContext(code,context,{timeout:1000});if(context.result!=='TypeError')throw Error(String(context.result))}process.stdout.write('matched:'+rows.length)`;
		const child = spawnSync("node", ["-e", driver], { input: JSON.stringify(fixtures), encoding: "utf8", timeout: 15_000 });
		expect(child.error).toBeUndefined(); expect(child.status).toBe(0); expect(child.stderr).toBe("");
		expect(child.stdout).toBe("matched:4");
	}, 30_000);

	it("preserves missing property receiver errors and computed-key order in Node", () => {
		const sources = [
			"function target(){let x;return x.y}",
			"function target(flag,k){let x;return x[k()]}",
			"function target(flag){let x;if(flag)return x.y;return 4}",
			"function target(flag,k){let x;return x[k]}",
			"function target(flag,k){if(flag)return (-1)[k];return (void 0)[k]}",
		].map(source => source + `;var log=[];var key={toString(){log.push('key-coercion');return 'y'}};try{globalThis.result=target(true,()=>{log.push('key-eval');return key})}catch(e){globalThis.result=e.name};globalThis.result=[globalThis.result,log]`);
		const fixtures = sources.map(source => [source,
			compileNativeCandidateCode(source, { seed: 71, scalarLowering: false }).code,
			compileNativeCandidateCode(source, { seed: 71 }).code,
			compileNativeCandidateCode(source, { seed: 71, acyclicLowering: true }).code,
		]);
		const driver = `const vm=require('node:vm'),rows=JSON.parse(require('node:fs').readFileSync(0,'utf8'));for(const row of rows){const values=row.map(code=>{const context=vm.createContext({});vm.runInContext(code,context,{timeout:1000});return JSON.stringify(context.result)});if(values.some(v=>v!==values[0]))throw Error(JSON.stringify(values))}process.stdout.write('matched:'+rows.length)`;
		const child = spawnSync("node", ["-e", driver], { input: JSON.stringify(fixtures), encoding: "utf8", timeout: 15_000 });
		expect(child.error).toBeUndefined(); expect(child.status).toBe(0); expect(child.stderr).toBe("");
		expect(child.stdout).toBe("matched:5");
	}, 30_000);

	it("preserves unary and exponentiation syntax for non-identifier scalar operands", () => {
		const base = { ...compile("function target(){return 0}"), registerCount: 1,
			constants: [{ type: "number" as const, value: 2 }] };
		for (const [instructions, expected] of [
			[[Op.PUSH_NEG_ONE, Op.NEG], 1],
			[[Op.PUSH_ONE, Op.PUSH_NEG_ONE, Op.SUB], 2],
			[[Op.PUSH_NEG_ONE, Op.PUSH_CONST, Op.POW], 1],
			[[Op.LOAD_REG, Op.PUSH_CONST, Op.POW], NaN],
		] as const) {
			const unit = { ...base, instructions: [...instructions, Op.RETURN].map(opcode => ({ opcode, operand: 0 })) };
			const expression = build(unit).expression;
			expect(Object.is(vm.runInNewContext(`(${expression})`)({ c: [2] }, []), expected)).toBe(true);
		}
		const sources = [
			"function target(){let x;return x**2}",
			"function target(a){let x;if(a)return x**2;return 0}",
			"function target(a){const x=-1;if(a)return x**2;return -x}",
			"function target(a){const x=-1;return 2-x}",
		].map(source => source + ";var value=target(true);globalThis.result=Number.isNaN(value)?'NaN':Object.is(value,-0)?'-0':String(value)");
		const fixtures = sources.map(source => [source,
			compileNativeCandidateCode(source, { seed: 71, scalarLowering: false }).code,
			compileNativeCandidateCode(source, { seed: 71 }).code,
			compileNativeCandidateCode(source, { seed: 71, acyclicLowering: true }).code,
		]);
		const driver = `const vm=require('node:vm'),rows=JSON.parse(require('node:fs').readFileSync(0,'utf8'));for(const row of rows){const values=row.map(code=>{const context=vm.createContext({});vm.runInContext(code,context,{timeout:1000});return context.result});if(values.some(v=>v!==values[0]))throw Error(JSON.stringify(values))}process.stdout.write('matched:'+rows.length)`;
		const child = spawnSync("node", ["-e", driver], { input: JSON.stringify(fixtures), encoding: "utf8", timeout: 15_000 });
		expect(child.error).toBeUndefined(); expect(child.status).toBe(0); expect(child.stderr).toBe("");
		expect(child.stdout).toBe("matched:4");
	}, 30_000);

	it("keeps the extension opt-in and lets scalarLowering:false disable all scalar tiers", () => {
		const source = "function f(x,g){if(x)return g(x);return 2};globalThis.result=f(3,x=>x+1)";
		const baseline = compileNativeCandidateCode(source, { seed: 9 });
		const enabled = compileNativeCandidateCode(source, { seed: 9, acyclicLowering: true });
		expect(baseline.report.acyclicUnits).toBe(0);
		expect(enabled.report.acyclicUnits).toBeGreaterThan(0);
		expect(enabled.report.protectionQualified).toBe(false);
		const disabled = compileNativeCandidateCode(source, { seed: 9, scalarLowering: false, acyclicLowering: true });
		expect(disabled.report.scalarUnits).toBe(0);
		expect(disabled.code).toBe(compileNativeCandidateCode(source, { seed: 9, scalarLowering: false }).code);
	});

	it("declines unsupported or malformed units before allocating names", () => {
		const original = compile("function f(){return 1}");
		const malformed = [
			{ instructions: [{ opcode: Op.JMP, operand: 0 }], reason: "cyclic-control-flow" },
			{ instructions: [{ opcode: Op.JMP, operand: -1 }], reason: "invalid-target" },
			{ instructions: [{ opcode: Op.PUSH_TRUE, operand: 0 }, { opcode: Op.JMP_TRUE, operand: 3 }, { opcode: Op.PUSH_ONE, operand: 0 }, { opcode: Op.RETURN_VOID, operand: 0 }], reason: "unequal-stack-merge" },
			{ instructions: [{ opcode: Op.RETURN_VOID, operand: 0 }, { opcode: Op.NEW_ARRAY, operand: 0 }], reason: "unsupported-opcode" },
			{ instructions: [{ opcode: Op.CALL, operand: -1 }], reason: "spread-call" },
			{ instructions: [{ opcode: Op.REG_LT_REG_JF, operand: 65535 }], reason: "invalid-packed-branch" },
			{ instructions: [...Array.from({ length: 129 }, (_, i) => ({ opcode: Op.JMP, operand: i + 1 })), { opcode: Op.RETURN_VOID, operand: 0 }], reason: "acyclic-block-limit" },
		];
		for (const { instructions, reason } of malformed) {
			const first = setupRegistry(81), second = setupRegistry(81);
			expect(tryBuildNativeAcyclicBody({ ...original, instructions }, first.runtime, first.temps, first.registry)).toMatchObject({ admitted: false, reason });
			expect(first.registry.createDynamicGenerator("probe")()).toBe(second.registry.createDynamicGenerator("probe")());
		}
		for (const source of ["function f(x){while(x)x=x-1;return x}", "function f(x){x.a=3;return x}", "function f(){return []}", "async function f(x){return x}", "function f(x){return ()=>x}", "function f(x){try{return x()}catch(e){return e}}", "function f(a){return a++}"]) {
			const { runtime, temps, registry } = setupRegistry(1);
			expect(tryBuildNativeAcyclicBody(compile(source), runtime, temps, registry).admitted).toBe(false);
		}
	});
});
