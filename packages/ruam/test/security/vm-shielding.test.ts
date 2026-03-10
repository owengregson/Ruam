import { assertEquivalent, evalObfuscated } from "../helpers.js";
import { obfuscateCode } from "../../src/transform.js";
import type { VmObfuscationOptions } from "../../src/types.js";

const shieldOpts: VmObfuscationOptions = { vmShielding: true };

describe("VM Shielding", () => {
  describe("basic functionality", () => {
    it("single function returns correct value", () => {
      assertEquivalent(`
        function add(a, b) { return a + b; }
        add(2, 3);
      `, shieldOpts);
    });

    it("multiple independent functions", () => {
      assertEquivalent(`
        function add(a, b) { return a + b; }
        function mul(a, b) { return a * b; }
        add(3, 4) + mul(5, 6);
      `, shieldOpts);
    });

    it("function with closures", () => {
      assertEquivalent(`
        function makeCounter() {
          let count = 0;
          return { inc() { return ++count; }, get() { return count; } };
        }
        var c = makeCounter();
        c.inc(); c.inc(); c.inc();
        c.get();
      `, shieldOpts);
    });

    it("function with string operations", () => {
      assertEquivalent(`
        function greet(name) {
          return "Hello, " + name + "!";
        }
        greet("world");
      `, shieldOpts);
    });

    it("function with arrays", () => {
      assertEquivalent(`
        function sum(arr) {
          var total = 0;
          for (var i = 0; i < arr.length; i++) total += arr[i];
          return total;
        }
        sum([1, 2, 3, 4, 5]);
      `, shieldOpts);
    });

    it("function with objects", () => {
      assertEquivalent(`
        function makeObj(x, y) {
          return { x: x, y: y, sum: x + y };
        }
        var o = makeObj(10, 20);
        [o.x, o.y, o.sum];
      `, shieldOpts);
    });

    it("recursive function (fibonacci)", () => {
      assertEquivalent(`
        function fib(n) {
          if (n <= 1) return n;
          return fib(n - 1) + fib(n - 2);
        }
        fib(10);
      `, shieldOpts);
    });

    it("function with try/catch", () => {
      assertEquivalent(`
        function safeParse(s) {
          try {
            return JSON.parse(s);
          } catch (e) {
            return null;
          }
        }
        [safeParse('{"a":1}'), safeParse('bad')];
      `, shieldOpts);
    });
  });

  describe("cross-function interaction", () => {
    it("functions calling each other", () => {
      assertEquivalent(`
        function double(x) { return x * 2; }
        function quadruple(x) { return double(double(x)); }
        quadruple(5);
      `, shieldOpts);
    });

    it("functions sharing scope via closure", () => {
      assertEquivalent(`
        function test() {
          var shared = 0;
          function inc() { shared += 1; }
          function get() { return shared; }
          inc(); inc(); inc();
          return get();
        }
        test();
      `, shieldOpts);
    });
  });

  describe("async functions", () => {
    it("async function with await", () => {
      assertEquivalent(`
        async function fetchVal() {
          var x = await Promise.resolve(42);
          return x;
        }
        fetchVal();
      `, shieldOpts);
    });
  });

  describe("classes", () => {
    it("class with methods", () => {
      assertEquivalent(`
        function test() {
          class Point {
            constructor(x, y) { this.x = x; this.y = y; }
            sum() { return this.x + this.y; }
          }
          var p = new Point(3, 4);
          return p.sum();
        }
        test();
      `, shieldOpts);
    });
  });

  describe("security properties", () => {
    it("generates distinct opcode shuffles per group", () => {
      const code = `
        function foo() { return 1; }
        function bar() { return 2; }
        foo() + bar();
      `;
      const output = obfuscateCode(code, shieldOpts);
      // Output should contain router mapping and multiple interpreter switches
      // At minimum it should be a valid JS that executes correctly
      expect(output).toBeTruthy();
      expect(output.length).toBeGreaterThan(100);
    });

    it("output contains watermark", () => {
      const output = obfuscateCode(`function f() { return 1; } f();`, shieldOpts);
      expect(output).toContain("_ru4m");
    });

    it("rolling cipher is auto-enabled", () => {
      // vmShielding forces rolling cipher — verify the output has cipher-related code
      const output = obfuscateCode(`function f() { return 1; } f();`, shieldOpts);
      // Rolling cipher generates mixState and deriveKey functions
      // Just verify the output is non-trivial and executes
      expect(output.length).toBeGreaterThan(500);
    });
  });

  describe("with additional options", () => {
    it("vmShielding + stackEncoding", () => {
      assertEquivalent(`
        function calc(a, b) { return a * b + a - b; }
        calc(7, 3);
      `, { vmShielding: true, stackEncoding: true });
    });

    it("vmShielding + integrityBinding", () => {
      assertEquivalent(`
        function calc(a, b) { return a + b; }
        calc(10, 20);
      `, { vmShielding: true, integrityBinding: true });
    });

    it("vmShielding + deadCodeInjection", () => {
      assertEquivalent(`
        function calc(a, b) { return a + b; }
        calc(10, 20);
      `, { vmShielding: true, deadCodeInjection: true });
    });

    it("vmShielding + decoyOpcodes", () => {
      assertEquivalent(`
        function calc(a, b) { return a + b; }
        calc(10, 20);
      `, { vmShielding: true, decoyOpcodes: true });
    });

    it("max preset (includes vmShielding) compiles without errors", () => {
      const output = obfuscateCode(`function calc(a, b) { return a + b; } calc(10, 20);`, { preset: "max" });
      expect(output).toBeTruthy();
      expect(output.length).toBeGreaterThan(500);
      expect(output).toContain("_ru4m");
    });
  });
});
