import { describe, it } from "vitest";
import { assertEquivalent } from "../helpers.js";

describe("destructuring", () => {
	it("array destructuring", () => {
		assertEquivalent(`
      function test() {
        var arr = [1, 2, 3];
        var a = arr[0], b = arr[1], c = arr[2];
        return [a, b, c];
      }
      test();
    `);
	});

	it("object property access", () => {
		assertEquivalent(`
      function test() {
        var obj = {x: 10, y: 20};
        return obj.x + obj.y;
      }
      test();
    `);
	});

	it("nested object access", () => {
		assertEquivalent(`
      function test() {
        var obj = {a: {b: {c: 42}}};
        return obj.a.b.c;
      }
      test();
    `);
	});

	it("computed property access", () => {
		assertEquivalent(`
      function test() {
        var obj = {hello: "world"};
        var key = "hello";
        return obj[key];
      }
      test();
    `);
	});

	it("spread in array literal", () => {
		assertEquivalent(`
      function test() {
        var a = [1, 2];
        var b = [0, ...a, 3];
        return b;
      }
      test();
    `);
	});

	it("spread in function call", () => {
		assertEquivalent(`
      function test() {
        var args = [1, 2, 3];
        return Math.max(...args);
      }
      test();
    `);
	});

	it("object spread", () => {
		assertEquivalent(`
      function test() {
        var a = {x: 1};
        var b = {y: 2};
        var c = Object.assign({}, a, b);
        return [c.x, c.y];
      }
      test();
    `);
	});

	it("default parameter values", () => {
		assertEquivalent(`
      function greet(name, greeting) {
        if (greeting === undefined) greeting = "Hello";
        return greeting + ", " + name + "!";
      }
      [greet("World"), greet("World", "Hi")];
    `);
	});
});
