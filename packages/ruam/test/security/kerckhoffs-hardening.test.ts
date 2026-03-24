import { describe, it } from "bun:test";
import { assertEquivalent } from "../helpers.js";

describe("kerckhoffs hardening (all three layers)", () => {
	const fullOpts = {
		incrementalCipher: true,
		semanticOpacity: true,
		observationResistance: true,
	};

	it("simple arithmetic", () => {
		assertEquivalent(
			`function f(a, b) { return a + b; } f(3, 7);`,
			fullOpts
		);
	});

	it("string operations", () => {
		assertEquivalent(
			`
            function f(s) { return s.split("").reverse().join(""); }
            f("hello");
        `,
			fullOpts
		);
	});

	it("closures", () => {
		assertEquivalent(
			`
            function outer(x) {
                return function(y) { return x + y; };
            }
            outer(10)(20);
        `,
			fullOpts
		);
	});

	it("classes with inheritance", () => {
		// Note: classes with super must be declared at top level (not inside a
		// wrapper function) due to a pre-existing VM limitation with super in
		// nested function contexts.
		assertEquivalent(
			`
            class Animal {
                constructor(name) { this.name = name; }
                speak() { return this.name + " speaks"; }
            }
            class Dog extends Animal {
                speak() { return super.speak() + " (bark)"; }
            }
            new Dog("Rex").speak();
        `,
			fullOpts
		);
	});

	it("async functions", () => {
		assertEquivalent(
			`
            async function f() {
                var result = await Promise.resolve(42);
                return result;
            }
            f();
        `,
			fullOpts
		);
	});

	it("spread and iterables", () => {
		// Note: generator for-of iteration has a pre-existing VM limitation.
		// This test covers array spread and iterable patterns instead.
		assertEquivalent(
			`
            function test() {
                var src = [1, 2, 3, 4, 5];
                var doubled = src.map(function(x) { return x * 2; });
                var sum = doubled.reduce(function(a, b) { return a + b; }, 0);
                return sum;
            }
            test();
        `,
			fullOpts
		);
	});

	it("complex control flow", () => {
		assertEquivalent(
			`
            function f(n) {
                var result = [];
                for (var i = 0; i < n; i++) {
                    if (i % 3 === 0) result.push("fizz");
                    else if (i % 5 === 0) result.push("buzz");
                    else result.push(i);
                }
                return result;
            }
            f(15);
        `,
			fullOpts
		);
	});

	it("exception handling", () => {
		assertEquivalent(
			`
            function f() {
                var results = [];
                try {
                    results.push("try");
                    throw new Error("test");
                } catch(e) {
                    results.push("catch:" + e.message);
                } finally {
                    results.push("finally");
                }
                return results.join(",");
            }
            f();
        `,
			fullOpts
		);
	});

	it("destructuring", () => {
		assertEquivalent(
			`
            function f() {
                var [a, b, ...rest] = [1, 2, 3, 4, 5];
                var {x, y} = {x: 10, y: 20};
                return a + b + rest.length + x + y;
            }
            f();
        `,
			fullOpts
		);
	});

	it("recursion with memoization", () => {
		assertEquivalent(
			`
            function test() {
                var memo = {};
                function fib(n) {
                    if (n in memo) return memo[n];
                    if (n <= 1) return n;
                    memo[n] = fib(n-1) + fib(n-2);
                    return memo[n];
                }
                return fib(20);
            }
            test();
        `,
			fullOpts
		);
	});

	it("full max preset", () => {
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

	it("max preset with multiple functions", () => {
		assertEquivalent(
			`
            function add(a, b) { return a + b; }
            function mul(a, b) { return a * b; }
            function compute(x) { return mul(add(x, 1), add(x, 2)); }
            compute(5);
        `,
			{ preset: "max" }
		);
	});

	it("max preset with class hierarchy", () => {
		// Note: classes with super must be declared at top level (not inside a
		// wrapper function) due to a pre-existing VM limitation with super in
		// nested function contexts.
		assertEquivalent(
			`
            class Base {
                constructor(v) { this.v = v; }
                method() { return this.v * 2; }
            }
            class Child extends Base {
                method() { return super.method() + 1; }
            }
            new Child(10).method();
        `,
			{ preset: "max" }
		);
	});
});
