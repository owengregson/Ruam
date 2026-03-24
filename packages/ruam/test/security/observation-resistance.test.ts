import { describe, it } from "bun:test";
import { assertEquivalent } from "../helpers.js";

const orOpts = { observationResistance: true };

describe("observation resistance", () => {
	describe("function identity binding", () => {
		it("correct execution when untampered", () => {
			assertEquivalent(
				`function f(a, b) { return a + b; } f(3, 7);`,
				orOpts
			);
		});

		it("closures", () => {
			assertEquivalent(
				`
				function outer(x) { return function(y) { return x + y; }; }
				outer(10)(20);
			`,
				orOpts
			);
		});

		it("loops", () => {
			assertEquivalent(
				`
				function sum(n) { var s = 0; for (var i = 0; i < n; i++) s += i; return s; }
				sum(100);
			`,
				orOpts
			);
		});

		it("recursion", () => {
			assertEquivalent(
				`
				function fib(n) { if (n <= 1) return n; return fib(n-1) + fib(n-2); }
				fib(10);
			`,
				orOpts
			);
		});

		it("with max preset", () => {
			assertEquivalent(
				`
				function f(a, b) { return a * b + 1; }
				f(6, 7);
			`,
				{ preset: "max" }
			);
		});

		it("classes", () => {
			assertEquivalent(
				`
				function test() {
					class Foo { constructor(x) { this.x = x; } get() { return this.x; } }
					return new Foo(42).get();
				}
				test();
			`,
				orOpts
			);
		});

		it("try-catch", () => {
			assertEquivalent(
				`
				function f() { try { throw new Error("x"); } catch(e) { return e.message; } }
				f();
			`,
				orOpts
			);
		});

		it("async", () => {
			assertEquivalent(
				`
				async function f() { return await Promise.resolve(42); }
				f();
			`,
				orOpts
			);
		});

		it("string operations", () => {
			assertEquivalent(
				`
				function f(s) { return s.split("").reverse().join(""); }
				f("hello");
			`,
				orOpts
			);
		});

		it("array methods", () => {
			assertEquivalent(
				`
				function f() {
					var arr = [1, 2, 3, 4, 5];
					return arr.map(function(x) { return x * 2; }).filter(function(x) { return x > 4; });
				}
				f();
			`,
				orOpts
			);
		});

		it("combined with rolling cipher", () => {
			assertEquivalent(
				`
				function f(a, b) { return a + b; }
				f(100, 200);
			`,
				{ observationResistance: true, rollingCipher: true }
			);
		});

		it("combined with incremental cipher", () => {
			assertEquivalent(
				`
				function f(a) { return a * a; }
				f(7);
			`,
				{ observationResistance: true, incrementalCipher: true }
			);
		});

		it("combined with integrity binding", () => {
			assertEquivalent(
				`
				function f(a, b) { return a - b; }
				f(50, 8);
			`,
				{ observationResistance: true, integrityBinding: true }
			);
		});
	});

	describe("witness counter + canaries + probes", () => {
		it("basic arithmetic", () => {
			assertEquivalent(
				`function f(a, b) { return a + b; } f(3, 7);`,
				orOpts
			);
		});

		it("complex program", () => {
			assertEquivalent(
				`
				function test() {
					var result = [];
					for (var i = 0; i < 5; i++) {
						result.push(i * i);
					}
					return result.join(",");
				}
				test();
			`,
				orOpts
			);
		});

		it("exception handling", () => {
			assertEquivalent(
				`
				function f() {
					try { throw new Error("test"); }
					catch (e) { return e.message; }
				}
				f();
			`,
				orOpts
			);
		});

		it("max preset still works", () => {
			assertEquivalent(
				`
				function fibonacci(n) {
					if (n <= 1) return n;
					return fibonacci(n - 1) + fibonacci(n - 2);
				}
				fibonacci(10);
			`,
				{ preset: "max" }
			);
		});

		it("nested function calls", () => {
			assertEquivalent(
				`
				function add(a, b) { return a + b; }
				function mul(a, b) { return a * b; }
				function compute(x) { return add(mul(x, x), mul(x, 2)); }
				compute(5);
			`,
				orOpts
			);
		});

		it("switch statement", () => {
			assertEquivalent(
				`
				function classify(n) {
					switch (true) {
						case n < 0: return "negative";
						case n === 0: return "zero";
						default: return "positive";
					}
				}
				classify(-1) + "," + classify(0) + "," + classify(1);
			`,
				orOpts
			);
		});

		it("object manipulation", () => {
			assertEquivalent(
				`
				function test() {
					var obj = { a: 1, b: 2, c: 3 };
					var sum = 0;
					for (var k in obj) { sum += obj[k]; }
					return sum;
				}
				test();
			`,
				orOpts
			);
		});

		it("with all hardening options", () => {
			assertEquivalent(
				`
				function f(a, b) { return a + b; }
				f(10, 20);
			`,
				{
					observationResistance: true,
					rollingCipher: true,
					incrementalCipher: true,
					integrityBinding: true,
				}
			);
		});
	});
});
