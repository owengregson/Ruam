import { describe, expect, it } from "bun:test";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { parse } from "@babel/parser";
import { traverse } from "../src/babel-compat.js";
import { compileNativeCandidateCode } from "../src/transform.js";
import { compileFunction, resetUnitCounter } from "../src/compiler/index.js";
import { Op } from "../src/compiler/opcodes.js";
import type { BytecodeUnit } from "../src/types.js";
import { setupRegistry } from "../src/naming/setup.js";
import { resolveName } from "../src/naming/token.js";
import { buildNativeSpecialization } from "../src/ruamvm/native-specialization.js";
import { registry as handlers } from "../src/ruamvm/handlers/index.js";
import { emit } from "../src/ruamvm/emit.js";
import {
	arr, arrowFn, assign, call, exprStmt, fnExpr, getter, id, lit, member,
	method, newExpr, obj, returnStmt, setter, un, UOp,
} from "../src/ruamvm/nodes.js";
import { mapChildren, type JsNode } from "../src/ruamvm/nodes.js";

const CASES: Record<string, string> = {
	"branches past an optimized trailing instruction": `
		function classify(x){if(x<0)return 'negative';else if(x===0)return 'zero';else return 'positive'}
		globalThis.result=[classify(-3),classify(0),classify(3)];`,
	"loops, switch and abrupt completion": `
		function run(n) { let a=[]; outer: for(let i=0;i<n;i++) {
			try { if(i===2) continue; switch(i%3) { case 0:a.push(i);break;case 1:continue outer;default:a.push(-i) }
				if(i===6) break; } finally { a.push('f'+i); }
		} return a; } globalThis.result=run(9);`,
	"nested finally and return overrides": `
		function run(mode) { let a=[]; function inner(){try {try {if(mode===1)throw 4;return 2}
			finally {a.push(1);if(mode===2)return 7}}catch(e){a.push(e);return 5}finally{a.push(9)}}
		return [inner(),a] } globalThis.result=[run(0),run(1),run(2)];`,
	"native exceptions and catch destructuring": `
		function run(){let out=[];for(let i=0;i<3;i++){try {try {if(i===0) null.x; else throw {message:i}}
			finally {out.push('finally')}}catch({message:m}){out.push(typeof m)}}return out}
		globalThis.result=run();`,
	"synchronous reentry through getters and coercion": `
		function again(x){return x*7} function run(){let seen=[];let v={get value(){seen.push(again(2));return 3},
			valueOf(){seen.push(again(4));return 5}};return [v.value+v,seen,again(1)]} globalThis.result=run();`,
	"captured block scopes and recursive closures": `
		function run(){let fs=[];for(let i=0;i<4;i++)fs.push(()=>i);function fib(n){return n<2?n:fib(n-1)+fib(n-2)}
			return [fs.map(f=>f()),fib(9)]} globalThis.result=run();`,
	"class super, computed methods and lexical this": `
		function run(){class Base{constructor(x){this.x=x}get n(){return this.x}m(a){return this.x+a}}
			class Child extends Base{constructor(x){super(x+1)}['m'](a){const read=()=>super.n;return [super.m(a),read()]}}
			const c=new Child(4);return [c.m(3),Object.getOwnPropertyDescriptor(Child.prototype,'m').enumerable]}
		globalThis.result=run();`,
	"object methods, accessors and spread": `
		function run(){let x=3;const a={1(v){return v+this.n},n:4,get x(){return x},set x(v){x=v}};
			a.x=8;return [a[1](2),a.x,Object.hasOwn(a[1],'prototype'),{...a}.n]}
		globalThis.result=run();`,
	"optional chains, receiver and skipped arguments": `
		function run(){let n=0;let a={v:8,m(x){return this.v+x}};
			return [a?.m?.(2),null?.[n++],a.m?.(n++),n]}
		globalThis.result=run();`,
	"primitive constants and regex identity": `
		function run(){const re=/ab/gi;return [Object.is(-0,-0),Number.isNaN(NaN),Infinity,-Infinity,
			String(9007199254740993n+2n),re.source,re.flags,typeof undefined]}
		globalThis.result=run();`,
	"destructuring, defaults, rest and sparse arrays": `
		function run({a=3,...rest}={},...xs){let [x,,z=9]=xs;let sparse=[1,,3];
			return [a,rest,x,z,sparse.length,1 in sparse,...xs]}
		globalThis.result=run({b:7},2,4);`,
	"async prefix, catch and interleaving": `
		async function run(){let out=[];async function work(n){out.push('start'+n);try {
			await Promise.resolve();if(n===2)throw n;out.push('resume'+n);return n*3
		}catch(e){out.push('catch'+e);return 7}finally{out.push('end'+n)}}
		const first=work(1),second=work(2);out.push('caller');return [await first,await second,out]}
		globalThis.result=run();`,
	"nested async and sync frame isolation": `
		async function run(){let sum=0;function bump(n){sum+=n;return sum}
			async function work(n){let before=bump(n);await Promise.resolve(n);return [before,bump(n)]}
			return [await Promise.all([work(2),work(3)]),sum]}
		globalThis.result=run();`,
};

async function execute(source: string): Promise<string> {
	const context = vm.createContext({});
	new vm.Script(source).runInContext(context, { timeout: 10_000 });
	return JSON.stringify(await context.result);
}

describe("experimental native specialization", () => {
	it("declines ambient function context in handlers, lexical arrows and computed method keys", () => {
		for (const context of ["this", "arguments", "new.target"]) {
			for (const shape of ["direct", "arrow", "computed-key"]) {
				const read = id(context);
				const key = context === "this" ? member(read, "p")
					: context === "arguments" ? member(read, "length") : un(UOp.Typeof, read);
				const expression = shape === "arrow" ? call(arrowFn([], [returnStmt(read)]), [])
					: shape === "computed-key" ? obj(method(key, [], [])) : read;
				const { built, prefix, names } = buildFakeHandler(expression, context === "new.target");
				expect(built.stats.sharedSemanticHelpers).toBe(0);
				const check = shape === "computed-key"
					? `Object.keys(_reviewValue)[0]===${JSON.stringify(context === "this" ? "0" : context === "arguments" ? "6" : "function")}`
					: context === "this" ? `_reviewValue===${names.unit}`
						: context === "arguments" ? `_reviewValue.length===6&&_reviewValue[0]===${names.unit}`
							: `_reviewValue===${names.unit}.f`;
				expect(vm.runInNewContext(prefix + check)).toBe(true);
			}
		}
	});

	it("retains context owned by regular factories, methods and accessors when sharing", () => {
		const observation = () => arr(id("this"), member(id("arguments"), "length"), un(UOp.Typeof, id("new.target")));
		const arrowObservation = () => call(arrowFn([], [returnStmt(observation())]), []);
		for (const construct of [false, true]) {
			const ownFunction = fnExpr(undefined, [], [returnStmt(arrowObservation())]);
			const expression = construct ? newExpr(ownFunction, []) : call(ownFunction, []);
			const { built, prefix } = buildFakeHandler(expression);
			expect(built.stats.sharedSemanticHelpers).toBe(1);
			if (!construct) expect(built.stats.sharedFactories).toBeGreaterThan(0);
			const check = construct
				? `typeof _reviewValue[0]==='object'&&_reviewValue[1]===0&&_reviewValue[2]==='function'`
				: `_reviewValue[0]===undefined&&_reviewValue[1]===0&&_reviewValue[2]==='undefined'`;
			expect(vm.runInNewContext(prefix + check)).toBe(true);
		}
		for (const kind of ["method", "get", "set"]) {
			const body = [exprStmt(assign(member(id("this"), "seen"), arrowObservation()))];
			const entry = kind === "method" ? method("value", [], body)
				: kind === "get" ? getter("value", body) : setter("value", "input", body);
			const { built, prefix } = buildFakeHandler(obj(entry));
			expect(built.stats.sharedSemanticHelpers).toBe(1);
			const invocation = kind === "method" ? "_reviewValue.value(7,8);"
				: kind === "get" ? "_reviewValue.value;" : "_reviewValue.value=7;";
			const argumentCount = kind === "method" ? 2 : kind === "get" ? 0 : 1;
			expect(vm.runInNewContext(prefix + invocation +
				`_reviewValue.seen[0]===_reviewValue&&_reviewValue.seen[1]===${argumentCount}&&_reviewValue.seen[2]==='undefined'`)).toBe(true);
		}
	});

	it("keeps direct eval in its original frame instead of sharing its helper or factory", () => {
		const original = handlers.get(Op.NOP)!;
		try {
			for (const nested of [false, true]) {
				handlers.set(Op.NOP, (ctx) => {
					const evaluation = call(id("eval"), [lit(`${ctx.U}.p+11`)]);
					return [
						// Exceed the helper-size threshold independently of random names.
						exprStmt(lit("padding".repeat(40))),
						exprStmt(ctx.push(nested
							? call(fnExpr(undefined, [], [returnStmt(evaluation)]), [])
							: evaluation)),
					];
				});
				const unit = compileUnit("function value(){return 4}");
				unit.instructions = [{ opcode: Op.NOP, operand: 0 }, { opcode: Op.RETURN, operand: 0 }];
				const { runtime: names, temps, registry } = setupRegistry(52);
				const built = buildNativeSpecialization([unit], names, temps, registry, 52, { scalarLowering: false });
				expect(built.stats.sharedSemanticHelpers).toBe(0);
				expect(built.stats.sharedFactories).toBe(0);
				const code = `"use strict";var ${names.globalRef}=globalThis;${built.declarations.map(node => emit(node)).join("\n")}
					${names.exec}(${names.load}(${JSON.stringify(unit.id)}),[],null);`;
				expect(vm.runInNewContext(code)).toBe(unit.paramCount + 11);
			}
		} finally {
			handlers.set(Op.NOP, original);
		}
	});

	for (const [label, source] of Object.entries(CASES)) {
		it(`preserves ${label} across names and seeds`, async () => {
			const expected = await execute(source);
			for (const seed of [0, 1, 0x12345678, 0xffffffff]) {
				const built = compileNativeCandidateCode(source, { seed });
				expect(built.report.compilation.completeSelection).toBe(true);
				expect(built.report.protectionQualified).toBe(false);
				expect(await execute(built.code)).toBe(expected);
			}
		});
	}

	it("uses direct blocks without byte serialization or opcode lookup", async () => {
		const built = compileNativeCandidateCode(`function sum(n){let s=0;for(let i=0;i<n;i++)s+=i;return s}globalThis.result=sum(20)`, { seed: 21 });
		expect(built.report.basicBlockCount).toBeLessThan(built.report.instructionCount);
		expect(built.report.unitCount).toBe(1);
		expect(built.code).not.toContain("DataView");
		expect(built.code).not.toContain("Int32Array");
		expect(built.code).not.toContain("fromCharCode");
		expect(await execute(built.code)).toBe("190");
	});

	it("erases straight-line dispatch while retaining a one-block loop", () => {
		const straight = compileNativeCandidateCode("function f(x){return x+3}globalThis.result=f(2)", { seed: 6 });
		expect(straight.report.structuredUnits).toBe(1);
		expect(straight.report.dispatchedUnits).toBe(0);
		const unit = compileUnit("function value(){return 4}");
		unit.instructions = [{ opcode: Op.JMP, operand: 0 }];
		const { runtime, temps, registry } = setupRegistry(4);
		const loop = buildNativeSpecialization([unit], runtime, temps, registry, 4);
		expect(loop.stats.basicBlockCount).toBe(1);
		expect(loop.stats.dispatchedUnits).toBe(1);
		expect(loop.stats.structuredUnits).toBe(0);
	});

	it("keeps local identifier lengths bounded across hundreds of units", () => {
		const template = compileUnit("function read(value){return value.x+value.y}");
		const units = Array.from({ length: 256 }, (_, index) => ({ ...template, id: `naming_${index}` }));
		for (const seed of [0, 71]) {
			const { runtime, temps, registry } = setupRegistry(seed);
			const built = buildNativeSpecialization(units, runtime, temps, registry, seed, { scalarLowering: false });
			const bindings: string[] = [];
			const visit = (node: JsNode): JsNode => {
				if (node.type === "VarDecl" || node.type === "FnDecl") bindings.push(resolveName(node.name));
				return mapChildren(node, visit);
			};
			built.declarations.forEach(visit);
			expect(built.unitCount).toBe(256);
			// A restarted local-name generator previously collided with every
			// earlier unit and grew identifiers to dozens of characters.
			expect(Math.max(...bindings.map((name) => name.length))).toBeLessThanOrEqual(10);
		}
	});

	it("admits scalar bodies and reports residual units with an explicit opt-out", async () => {
		const source = `function add(a,b){let c=a+b;return c*2}
			function choose(x){if(x)return add(2,3);return add(4,5)}
			globalThis.result=[choose(true),choose(false)];`;
		const scalar = compileNativeCandidateCode(source, { seed: 63 });
		const residual = compileNativeCandidateCode(source, { seed: 63, scalarLowering: false });
		expect(scalar.report.scalarUnits).toBeGreaterThan(0);
		expect(scalar.report.scalarInstructions).toBeGreaterThan(0);
		expect(Object.values(scalar.report.scalarDeclines).reduce((a, b) => a + b, 0))
			.toBe(scalar.report.unitCount - scalar.report.scalarUnits);
		expect(residual.report.scalarUnits).toBe(0);
		expect(residual.report.scalarDeclines.disabled).toBe(residual.report.unitCount);
		expect(await execute(scalar.code)).toBe(await execute(source));
		expect(await execute(residual.code)).toBe(await execute(source));
	});

	it("preserves nonfinite constants when output is embedded under shadowing", async () => {
		const source = "function run(){return [1e999,-1e999,0/0]}globalThis.result=run()";
		const built = compileNativeCandidateCode(source, { seed: 84 });
		const wrap = (code: string) => `(function(Infinity,NaN){${code}})(19,18)`;
		expect(await execute(wrap(built.code))).toBe(await execute(wrap(source)));
	});

	it("shared helpers retain separate captured state after later factory calls", async () => {
		const source = `function make(x){let n=x;return {get(){return n},inc(v){n+=v;return n},arrow:()=>this.tag}}
			const a=make.call({tag:'a'},1),b=make.call({tag:'b'},10);
			globalThis.result=[a.inc(2),b.inc(3),a.get(),b.get(),a.arrow(),b.arrow()];`;
		const built = compileNativeCandidateCode(source, { seed: 53 });
		expect(built.report.sharedFactories).toBeGreaterThan(0);
		expect(built.report.sharedSemanticHelpers).toBeGreaterThan(0);
		expect(built.report.semanticHelperCalls).toBeGreaterThan(0);
		expect(built.report.semanticHelperOpcodes).toContain("LOAD_SCOPED");
		expect(await execute(built.code)).toBe(await execute(source));
	});

	it("matches Node for the same semantic fixtures", () => {
		const fixtures = Object.values(CASES).map((source) => ({
			source, candidate: compileNativeCandidateCode(source, { seed: 765 }).code,
		}));
		const driver = `const vm=require('node:vm');const fixtures=JSON.parse(require('node:fs').readFileSync(0,'utf8'));(async()=>{for(const pair of fixtures){
			const results=[];for(const code of [pair.source,pair.candidate]){const ctx=vm.createContext({});
			new vm.Script(code).runInContext(ctx,{timeout:10000});results.push(JSON.stringify(await ctx.result));}
			if(results[0]!==results[1])throw new Error(JSON.stringify(results));}process.stdout.write('matched')})().catch(e=>{console.error(e);process.exitCode=1})`;
		// Full generated artifacts exceed single-argument limits on some hosts.
		// Stream the fixtures to Node so the oracle runs on Linux as well as macOS.
		const result = spawnSync("node", ["-e", driver], { input: JSON.stringify(fixtures), encoding: "utf8", timeout: 30_000 });
		expect(result.error).toBeUndefined();
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("matched");
	// Permit fixture compilation plus the existing 30-second child deadline.
	}, 45_000);

	it("rejects unsupported or malformed logical units explicitly", () => {
		const unit = compileUnit("function value(){return 4}");
		const build = () => {
			const { runtime, temps, registry } = setupRegistry(4);
			return buildNativeSpecialization([unit], runtime, temps, registry, 4);
		};
		unit.instructions.unshift({ opcode: Op.MUTATE, operand: 3 });
		expect(build).toThrow("Unsupported native opcode MUTATE");
		unit.instructions[0] = { opcode: Op.JMP, operand: -1 };
		expect(build).toThrow("Invalid native branch target");
		unit.instructions[0] = { opcode: Op.AWAIT, operand: 0 };
		expect(build).toThrow("AWAIT in synchronous native unit");
		unit.instructions.shift();
		unit.isGenerator = true;
		expect(build).toThrow("rejects generator unit");
	});
});

/** Exercise admission through the public builder without exposing its private proof. */
function buildFakeHandler(expression: JsNode, construct = false) {
	const original = handlers.get(Op.NOP)!;
	try {
		handlers.set(Op.NOP, ctx => [exprStmt(lit("padding".repeat(40))), exprStmt(ctx.push(expression))]);
		const unit = compileUnit("function value(){return 4}");
		unit.instructions = [{ opcode: Op.NOP, operand: 0 }, { opcode: Op.RETURN, operand: 0 }];
		const { runtime: names, temps, registry } = setupRegistry(52);
		const built = buildNativeSpecialization([unit], names, temps, registry, 52, { scalarLowering: false });
		const invoke = construct ? `new ${names.unit}.f(${names.unit},[],null)` : `${names.exec}(${names.unit},[],null)`;
		const prefix = `"use strict";var ${names.globalRef}=globalThis;${built.declarations.map(node => emit(node)).join("\n")}
			var ${names.unit}=${names.load}(${JSON.stringify(unit.id)});var _reviewValue=${invoke};`;
		return { built, prefix, names };
	} finally {
		handlers.set(Op.NOP, original);
	}
}

function compileUnit(source: string): BytecodeUnit {
	resetUnitCounter(9);
	let unit: BytecodeUnit | undefined;
	traverse(parse(source), { Function(path) { unit = compileFunction(path); path.stop(); } });
	if (!unit) throw new Error("Fixture has no function");
	return unit;
}
