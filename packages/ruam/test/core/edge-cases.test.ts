import { describe, it, expect } from "bun:test";
import { assertEquivalent } from "../helpers.js";
import { obfuscateCode } from "../../src/transform.js";

describe("edge cases", () => {
	it("this binding with call", () => {
		assertEquivalent(`
      function getX() { return this.x; }
      var obj = {x: 42, getX: getX};
      obj.getX();
    `);
	});

	it("arguments object", () => {
		assertEquivalent(`
      function sumAll() {
        var total = 0;
        for (var i = 0; i < arguments.length; i++) total += arguments[i];
        return total;
      }
      sumAll(1, 2, 3, 4, 5);
    `);
	});

	it("typeof global variable", () => {
		assertEquivalent(`
      function test() {
        return typeof undeclaredVar;
      }
      test();
    `);
	});

	it("comma operator", () => {
		assertEquivalent(`
      function test() { return (1, 2, 3); }
      test();
    `);
	});

	it("void operator", () => {
		assertEquivalent(`
      function test() { return void 0; }
      test();
    `);
	});

	it("delete operator", () => {
		assertEquivalent(`
      function test() {
        var obj = {a: 1, b: 2};
        delete obj.a;
        return Object.keys(obj);
      }
      test();
    `);
	});

	it("in operator", () => {
		assertEquivalent(`
      function test() {
        var obj = {a: 1};
        return ["a" in obj, "b" in obj];
      }
      test();
    `);
	});

	it("instanceof operator", () => {
		assertEquivalent(`
      function test() {
        var arr = [1, 2, 3];
        return [arr instanceof Array, arr instanceof Object, arr instanceof RegExp];
      }
      test();
    `);
	});

	it("string template literal", () => {
		assertEquivalent(`
      function greet(name) {
        return "Hello, " + name + "!";
      }
      greet("World");
    `);
	});

	it("multiple return paths", () => {
		assertEquivalent(`
      function abs(x) {
        if (x < 0) return -x;
        return x;
      }
      [abs(-5), abs(3), abs(0)];
    `);
	});

	it("recursive function", () => {
		assertEquivalent(`
      function factorial(n) {
        if (n <= 1) return 1;
        return n * factorial(n - 1);
      }
      factorial(10);
    `);
	});

	it("method chaining", () => {
		assertEquivalent(`
      function test() {
        return [1, 2, 3, 4, 5].filter(function(x) { return x % 2 === 0; }).map(function(x) { return x * 2; });
      }
      test();
    `);
	});

	it("array methods", () => {
		assertEquivalent(`
      function test() {
        var arr = [3, 1, 4, 1, 5, 9];
        return arr.sort(function(a, b) { return a - b; });
      }
      test();
    `);
	});

	it("object creation and methods", () => {
		assertEquivalent(`
      function test() {
        var obj = {
          val: 10,
          double: function() { return this.val * 2; }
        };
        return obj.double();
      }
      test();
    `);
	});

	it("update expressions prefix/postfix", () => {
		assertEquivalent(`
      function test() {
        var a = 5;
        var b = a++;
        var c = ++a;
        return [a, b, c];
      }
      test();
    `);
	});

	it("compound assignment operators", () => {
		assertEquivalent(`
      function test() {
        var x = 10;
        x += 5;
        x -= 3;
        x *= 2;
        x /= 4;
        x %= 3;
        return x;
      }
      test();
    `);
	});

	it("string methods", () => {
		assertEquivalent(`
      function test() {
        var s = "hello world";
        return [s.toUpperCase(), s.indexOf("world"), s.slice(0, 5), s.split(" ")];
      }
      test();
    `);
	});

	it("dynamic import() compiles and executes", async () => {
		// import() returns a Promise — verify it resolves to a module
		const { evalObfuscated } = await import("../helpers.js");
		const result = evalObfuscated(`
      function loadPath() {
        return import("node:path");
      }
      loadPath();
    `);
		// Result is a Promise; verify it resolves to the path module
		const mod = await (result as Promise<any>);
		expect(typeof mod.join).toBe("function");
	});
});
