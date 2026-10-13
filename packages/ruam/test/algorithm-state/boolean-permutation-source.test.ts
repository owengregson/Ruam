import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { compileBooleanPermutationCode } from "../../src/algorithm-state/native/boolean-permutation-source.js";
import { obfuscateCode } from "../../src/index.js";

// Independently authored public fixtures, without private app source or data.
const fixture = `function choose(a,b,c) { "use strict"; return !(a && b) || !!c; }`;
const load = (code: string, name = "choose"): any => runInNewContext(`${code};${name}`, {});

describe("experimental Boolean permutation source admission", () => {
	test("proves truthiness locally without narrowing arbitrary JS arguments", () => {
		const values: unknown[] = [undefined, null, false, true, 0, -0, NaN, Infinity, -Infinity, 1, -1, "", "x", 0n, 1n, Symbol("x"), {}, [], () => 0];
		let hooks = 0;
		values.push({ valueOf() { hooks++; throw Error("unexpected coercion"); }, [Symbol.toPrimitive]() { hooks++; throw Error("unexpected primitive conversion"); } });
		const revoked = Proxy.revocable({}, {}); revoked.revoke(); values.push(revoked.proxy);
		const original = load(fixture);
		for (const seed of [0, 1, 71, 0xffffffff]) {
			const result = compileBooleanPermutationCode(fixture, { seed });
			expect(result.regions).toHaveLength(1);
			expect(result.scope.runtimeInputFiltering).toBe(false);
			expect(result.scope.protectionQualified).toBe(false);
			expect(result.code).toContain('"use strict"');
			const candidate = load(result.code);
			for (const a of values) for (const b of values) for (const c of values) expect(candidate(a, b, c)).toBe(original(a, b, c));
		}
		expect(hooks).toBe(0);
	});

	test("retains return values and exact effects in declined functions", () => {
		for (const source of [
			`function choose(a,b){return a && b;}`,
			`function choose(a){return !!a.value;}`,
			`function choose(a){return !a();}`,
			`function choose(a){return !(a < 3);}`,
			`function choose(a){return !external;}`,
			`function choose(a=read()){return !a;}`,
			`function choose(...a){return !a;}`,
			`function choose(a){a=mutate();return !a;}`,
			`async function choose(a){return !a;}`,
			`function* choose(a){return !a;}`,
		]) {
			const result = compileBooleanPermutationCode(source);
			expect(result.regions).toHaveLength(0);
			expect(result.declined.length).toBeGreaterThan(0);
		}
		const result = compileBooleanPermutationCode(`function choose(a){return !!a.value;}`);
		const events: string[] = [];
		expect(load(result.code)({ get value() { events.push("read"); return 9; } })).toBe(true);
		expect(events).toEqual(["read"]);
		const identity = {};
		expect(load(compileBooleanPermutationCode(`function choose(a,b){return a&&b;}`).code)(true, identity)).toBe(identity);
	});

	test("captures only noncoercive strict comparisons and local typeof checks", () => {
		const source = `function choose(a,b){return typeof a==="string" || (a === b && a !== null);}`;
		const result = compileBooleanPermutationCode(source);
		expect(result.regions).toHaveLength(1);
		const original = load(source), candidate = load(result.code);
		let hooks = 0;
		const object = { [Symbol.toPrimitive]() { hooks++; throw Error("coercion"); } };
		const revoked = Proxy.revocable({}, {}); revoked.revoke();
		const values = [undefined, null, NaN, -0, 0, 1, "", "x", 0n, 1n, true, false, Symbol(), object, revoked.proxy];
		for (const a of values) for (const b of values) expect(candidate(a, b)).toBe(original(a, b));
		expect(hooks).toBe(0);
		for (const expr of ["a==b", "a!=b", "typeof a.value === 'string'", "a.value===b", "typeof external === 'string'"]) {
			expect(compileBooleanPermutationCode(`function choose(a,b){return ${expr};}`).regions).toHaveLength(0);
		}
	});

	test("supports pure conditional and concise arrows, preserving metadata and construction", () => {
		const source = `const choose=(a,b,c)=>a ? !b : !!c; function build(a){return !a;}`;
		const result = compileBooleanPermutationCode(source);
		expect(result.regions).toHaveLength(2);
		const values = load(`${result.code}; const metadata=[choose.name,choose.length,build.name,build.length,Object.getPrototypeOf(new build(1))===build.prototype];`, "metadata");
		expect(Array.from(values)).toEqual(["choose", 3, "build", 1, true]);
		for (const a of [0, 1]) for (const b of [0, 1]) for (const c of [0, 1]) expect(load(result.code)(a, b, c)).toBe(load(source)(a, b, c));
	});

	test("keeps effectful sibling functions through the existing backend", () => {
		const source = `function pure(a,b){return !a&&!!b;} function choose(x){return pure(x.flag,x.ready)?x.run():x.skip();}`;
		const result = compileBooleanPermutationCode(source);
		expect(result.regions).toHaveLength(1);
		for (const preset of ["low", "max"] as const) {
			const compiled = load(obfuscateCode(`${result.code};globalThis.fixtureCall=choose;`, { preset, debugProtection: false }), "globalThis.fixtureCall");
			const events: string[] = [];
			const out = compiled({ get flag() { events.push("flag"); return false; }, get ready() { events.push("ready"); return true; }, run() { events.push("run"); return 42; }, skip() { events.push("skip"); return -1; } });
			expect(out).toBe(42); expect(events).toEqual(["flag", "ready", "run"]);
		}
	});

	test("declines exhausted budgets and validates invalid options", () => {
		const two = `function a(x){return !x;} function b(x){return !!x;}`;
		expect(compileBooleanPermutationCode(two, { maxFunctions: 1 }).regions).toHaveLength(1);
		expect(compileBooleanPermutationCode(two, { maxTotalGeneratedBytes: 0 }).regions).toHaveLength(0);
		expect(compileBooleanPermutationCode(two, { maxOutputBytes: 32 }).regions).toHaveLength(0);
		expect(() => compileBooleanPermutationCode("let x=1;", { maxFunctions: -1 })).toThrow();
		expect(() => compileBooleanPermutationCode("let x=1;", { maxTotalGeneratedBytes: Infinity })).toThrow();
		expect(() => compileBooleanPermutationCode("let x=1;", { seed: NaN })).toThrow();
	});

	test("executes final emitted source in native Node with primitive and proxy inputs", () => {
		const result = compileBooleanPermutationCode(fixture, { seed: 19 });
		const script = `${result.code}\nconst r=Proxy.revocable({},{});r.revoke();const values=[null,undefined,0,-0,NaN,1,"", "x",0n,1n,Symbol(),r.proxy];for(const a of values)for(const b of values)for(const c of values){if(choose(a,b,c)!==(!(a&&b)||!!c))throw Error("different");}process.stdout.write("ok");`;
		expect(execFileSync("node", ["-e", script], { encoding: "utf8", timeout: 15_000 })).toBe("ok");
	});
});
