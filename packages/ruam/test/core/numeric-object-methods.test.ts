import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { obfuscateCode } from "../../src/transform.js";
import { evalOriginal } from "../helpers.js";
import type { VmObfuscationOptions } from "../../src/types.js";

function compile(source: string, options: VmObfuscationOptions = {}): { output: string; warnings: unknown[][] } {
	const warnings: unknown[][] = [];
	const previousWarn = console.warn;
	let output: string;
	try {
		console.warn = (...args: unknown[]) => { warnings.push(args); };
		output = obfuscateCode(source, { targetMode: "root", ...options });
	} finally {
		console.warn = previousWarn;
	}
	return { output, warnings };
}

function compileWithoutFallback(source: string, options: VmObfuscationOptions = {}): string {
	const { output, warnings } = compile(source, options);
	// Value parity alone would pass when the compiler leaves the root native.
	expect(warnings).toEqual([]);
	expect(output).not.toBe(source);
	return output;
}

describe("numeric object method keys", () => {
	it("canonicalizes numeric literal spellings and keeps property ordering", () => {
		const source = `
			function test() {
				var methods = {
					2() { return this.offset + 2; },
					0x10() { return 16; },
					1e3() { return 1000; },
					1.5() { return 1.5; },
					1e21() { return "large"; },
					0() { return "zero"; },
					offset: 8
				};
				return [Object.keys(methods), methods[2](), methods[16](),
					methods[1000](), methods[1.5](), methods[1e21](), methods[0]()];
			}
			test();
		`;
		expect(evalOriginal(compileWithoutFallback(source))).toEqual(evalOriginal(source));
	});

	for (const preset of ["low", "max"] as const) {
		it(`compiles a numeric module table and its captured loader with ${preset}`, () => {
			const source = `
				(function () {
					var modules = {
						17(module, exports, load) { exports.value = load(23).value + 4; },
						23(module, exports) { exports.value = 8; }
					};
					var cache = {};
					function load(id) {
						if (cache[id]) return cache[id].exports;
						var module = { exports: {} };
						cache[id] = module;
						modules[id](module, module.exports, load);
						return module.exports;
					}
					return [load(17).value, load(23).value, load(17) === load(17)];
				})();
			`;
			expect(evalOriginal(compileWithoutFallback(source, { preset }))).toEqual(evalOriginal(source));
		});
	}

	it("retains the last definition when number spellings name the same property", () => {
		const source = `
			function test() {
				var methods = { 16() { return "first"; }, 0x10() { return "last"; } };
				var descriptor = Object.getOwnPropertyDescriptor(methods, "16");
				return [methods[16](), Object.keys(methods), descriptor.enumerable,
					descriptor.writable, descriptor.configurable];
			}
			test();
		`;
		expect(evalOriginal(compileWithoutFallback(source))).toEqual(evalOriginal(source));
	});

	it("preserves names, lengths and nonconstructability for numeric and existing named methods", () => {
		const source = `
			function test() {
				var methods = {
					31(a, b = 2, ...rest) { return a + b + rest.length; },
					named(a, { value }, ...rest) { return a + value + rest.length; },
					"text key"(...values) { return values.length; }
				};
				return Object.keys(methods).map(function (key) {
					var fn = methods[key];
					var constructible = true;
					try { Reflect.construct(fn, []); } catch (error) { constructible = false; }
					var name = Object.getOwnPropertyDescriptor(fn, "name");
					var length = Object.getOwnPropertyDescriptor(fn, "length");
					return [fn.name, fn.length, Object.prototype.hasOwnProperty.call(fn, "prototype"),
						constructible, name.enumerable, name.writable, name.configurable,
						length.enumerable, length.writable, length.configurable];
				});
			}
			test();
		`;
		expect(evalOriginal(compileWithoutFallback(source))).toEqual(evalOriginal(source));
	});

	it("keeps home objects and lexical scopes through reentry and abrupt completion", () => {
		const source = `
			function make(base, offset) {
				return {
					__proto__: base,
					7(depth) { if (depth < 0) throw new Error("negative");
						return depth ? this[7](depth - 1) + 1 : super.value + offset; },
					invoke(other) { var message;
						try { other[7](-1); } catch (error) { message = error.message; }
						return [other[7](1), this[7](2), message]; },
					strict() { "use strict"; return this; }
				};
			}
			var first = make({ value: 4 }, 3);
			var second = make({ value: 10 }, 7);
			var results = first.invoke(second);
			Object.setPrototypeOf(first, { value: 20 });
			[results, first[7](0), second[7](0), first.strict.call(null), first.strict.call(6)];
		`;
		expect(evalOriginal(compileWithoutFallback(source, { preset: "max" }))).toEqual(evalOriginal(source));
	});

	it("defines own methods without invoking an inherited setter", () => {
		const source = `
			function test() {
				var events = [];
				var base = {};
				Object.defineProperty(base, "8", { set: function () { events.push("set"); } });
				var methods = { __proto__: base, 8() { return 9; }, "__proto__"() { return 10; } };
				return [methods[8](), methods.__proto__(), events,
					Object.getPrototypeOf(methods) === base, Object.keys(methods)];
			}
			test();
		`;
		expect(evalOriginal(compileWithoutFallback(source))).toEqual(evalOriginal(source));
	});

	it("inherits method strictness from surrounding function and class bodies", () => {
		const source = `
			function strictFactory() {
				"use strict";
				return { inherited() { return this; } };
			}
			function classFactory() {
				class Factory { make() { return { inherited() { return this; } }; } }
				return new Factory().make();
			}
			var first = strictFactory().inherited;
			var second = classFactory().inherited;
			[first.call(null), first.call(4), second.call(null), second.call(6)];
		`;
		expect(evalOriginal(compileWithoutFallback(source))).toEqual(evalOriginal(source));
	});

	it("captures super home and lexical this through nested arrows", () => {
		const source = `
			function test() {
				var base = { get value() { return this.offset; } };
				var home = { __proto__: base, 1() { return () => () => [super.value, this.offset]; } };
				var receiver = { offset: 11 };
				var nested = home[1].call(receiver);
				var result = nested.call({ offset: 22 })();
				Object.setPrototypeOf(home, { get value() { return this.offset + 4; } });
				return [result, nested()()];
			}
			test();
		`;
		for (const debugLogging of [false, true]) {
			const output = compileWithoutFallback(source, { debugLogging });
			expect(evalOriginal(output)).toEqual(evalOriginal(source));
		}
	});

	it("preserves receiver getters and resolves super callees before arguments", () => {
		const source = `
			function test() {
				var events = [];
				var base = { get run() { events.push("get:" + this.offset);
					return function (value) { events.push("call:" + this.offset); return value + this.offset; }; } };
				var home = { __proto__: base, 1() { return super.run((events.push("argument"), 4)); },
					2() { return super.missing(); }, 3() { return super.value; } };
				var value = home[1].call({ offset: 7 });
				var missing, nullBase;
				try { home[2](); } catch (error) { missing = error.name; }
				Object.setPrototypeOf(home, null);
				try { home[3](); } catch (error) { nullBase = error.name; }
				return [value, events, missing, nullBase];
			}
			test();
		`;
		expect(evalOriginal(compileWithoutFallback(source))).toEqual(evalOriginal(source));
	});

	it("writes super properties on the method receiver and honors strict rejection", () => {
		const source = `
			function test() {
				var base = { stored: 2, set value(v) { this.stored = v; } };
				Object.defineProperty(base, "fixed", { value: 3 });
				var home = { __proto__: base, 1(v) { return super.value = v; },
					2(v) { return super.stored = v; }, 3() { return super.fixed = 9; },
					4() { "use strict"; return super.fixed = 9; } };
				var receiver = {};
				var first = home[1].call(receiver, 8), second = home[2].call(receiver, 11);
				var sloppy = home[3].call(receiver), strict;
				try { home[4].call(receiver); } catch (error) { strict = error.name; }
				return [first, second, receiver.stored, base.stored, sloppy, strict];
			}
			test();
		`;
		expect(evalOriginal(compileWithoutFallback(source))).toEqual(evalOriginal(source));
	});

	it("captures home and receiver in async arrows across suspension", async () => {
		const source = `
			function make() {
				var home = { __proto__: { get value() { return this.offset; } },
					async 1() { await Promise.resolve(); return async () => {
						await Promise.resolve(); return [super.value, this.offset]; }; } };
				return home[1].call({ offset: 12 }).then(function (arrow) { return arrow.call({ offset: 50 }); });
			}
			make();
		`;
		expect(await evalOriginal(compileWithoutFallback(source))).toEqual(await evalOriginal(source));
	});

	it("captures super assignment references before RHS and getter effects", () => {
		const source = `
			function test() {
				var events = [], home;
				var replacement = { set value(v) { events.push("new:" + v); } };
				var base = { get value() { events.push("get"); Object.setPrototypeOf(home, replacement); return 3; },
					set value(v) { events.push("old:" + v); } };
				home = { __proto__: base,
					1() { return super.value = (Object.setPrototypeOf(home, replacement), 8); },
					2() { return super.value += 4; },
					3() { return super.value++; },
					4(key) { return super[key] = (events.push("rhs"), 6); } };
				var assigned = home[1](); Object.setPrototypeOf(home, base);
				var compound = home[2](); Object.setPrototypeOf(home, base);
				var post = home[3](); Object.setPrototypeOf(home, base);
				var computed = home[4]({ toString() { events.push("key"); Object.setPrototypeOf(home, replacement); return "value"; } });
				return [assigned, compound, post, computed, events];
			}
			test();
		`;
		expect(evalOriginal(compileWithoutFallback(source))).toEqual(evalOriginal(source));
	});

	it("matches Node for Symbol-valued super key coercion at get and put", () => {
		const source = `
			function test() {
				var key = Symbol("key"), events = [], base = {};
				Object.defineProperty(base, key, { get() { return 4; }, set(v) { events.push(v); } });
				var home = { __proto__: base, 1(k) { return ++super[k]; } };
				var coerciveKey = Object.defineProperty({}, Symbol.toPrimitive, {
					value: function(hint) { events.push(hint); return key; } });
				var result = home[1](coerciveKey);
				return [result, events];
			}
			test();
		`;
		// Bun/JSC currently coerces this key once; Node/V8 and the Reference
		// operations coerce separately for GetValue and PutValue. Check the
		// generated bytes in Node against Node's original-source oracle.
		const child = spawnSync("node", ["-e", `const fs=require("node:fs"),vm=require("node:vm");
			const sources=JSON.parse(fs.readFileSync(0,"utf8"));
			process.stdout.write(JSON.stringify(sources.map(source=>vm.runInNewContext(source,{}, {timeout:2000}))));`], {
			input: JSON.stringify([source, compileWithoutFallback(source)]), encoding: "utf8", timeout: 10_000,
		});
		expect(child.error).toBeUndefined();
		expect(child.status).toBe(0);
		const [original, generated] = JSON.parse(child.stdout);
		expect(generated).toEqual(original);
		expect(original).toEqual([5, ["string", "string", 5]]);
	});

	it("preserves async method metadata, result and rejection behavior", async () => {
		const source = `
			function make(offset) {
				return { async 9(value) { if (value < 0) throw new Error("negative");
					return await Promise.resolve(value + offset); } };
			}
			var methods = make(4);
			Promise.all([methods[9](3), methods[9](-1).catch(function (error) { return error.message; })])
				.then(function (values) { return [values, methods[9].name, methods[9].length,
					Object.prototype.hasOwnProperty.call(methods[9], "prototype")]; });
		`;
		expect(await evalOriginal(compileWithoutFallback(source))).toEqual(await evalOriginal(source));
	});

	it("continues to decline numeric accessors and generators", () => {
		for (const member of ["get 1() { return 3; }", "set 1(value) {}", "*1() { yield 3; }"]) {
			const source = `function test() { return { ${member} }; } Object.keys(test());`;
			const { output, warnings } = compile(source);
			expect(warnings.length).toBe(1);
			expect(String(warnings[0]![0])).toContain("Unsupported method key type: NumericLiteral");
			expect(evalOriginal(output)).toEqual(evalOriginal(source));
		}
	});

	it("declines dynamic computed keys instead of silently treating them as names", () => {
		const source = `function test(key) { return { [key]() { return 3; } }; } Object.keys(test("actual"));`;
		const { output, warnings } = compile(source);
		expect(warnings.length).toBe(1);
		expect(String(warnings[0]![0])).toContain("Unsupported computed object method key: Identifier");
		expect(evalOriginal(output)).toEqual(evalOriginal(source));
	});
});
