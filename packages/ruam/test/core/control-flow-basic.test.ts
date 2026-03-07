import { describe, it } from "vitest";
import { assertEquivalent } from "../helpers.js";

describe("control flow", () => {
  it("if/else - true branch", () => {
    assertEquivalent(`
      function check(x) { if (x > 5) return "big"; else return "small"; }
      check(10);
    `);
  });

  it("if/else - false branch", () => {
    assertEquivalent(`
      function check(x) { if (x > 5) return "big"; else return "small"; }
      check(2);
    `);
  });

  it("if without else", () => {
    assertEquivalent(`
      function check(x) { var r = "none"; if (x > 5) r = "big"; return r; }
      check(10);
    `);
  });

  it("nested if/else", () => {
    assertEquivalent(`
      function classify(x) {
        if (x < 0) return "negative";
        else if (x === 0) return "zero";
        else return "positive";
      }
      classify(-3);
    `);
  });

  it("for loop", () => {
    assertEquivalent(`
      function sum(n) {
        var total = 0;
        for (var i = 1; i <= n; i++) total += i;
        return total;
      }
      sum(10);
    `);
  });

  it("for loop with let", () => {
    assertEquivalent(`
      function sum(n) {
        let total = 0;
        for (let i = 1; i <= n; i++) { total += i; }
        return total;
      }
      sum(10);
    `);
  });

  it("while loop", () => {
    assertEquivalent(`
      function countdown(n) {
        var result = [];
        while (n > 0) { result.push(n); n--; }
        return result;
      }
      countdown(5);
    `);
  });

  it("do-while loop", () => {
    assertEquivalent(`
      function doLoop(n) {
        var result = 0;
        do { result += n; n--; } while (n > 0);
        return result;
      }
      doLoop(5);
    `);
  });

  it("break in for loop", () => {
    assertEquivalent(`
      function findFirst(arr, target) {
        for (var i = 0; i < arr.length; i++) {
          if (arr[i] === target) return i;
        }
        return -1;
      }
      findFirst([1, 2, 3, 4, 5], 3);
    `);
  });

  it("continue in for loop", () => {
    assertEquivalent(`
      function sumEvens(n) {
        var total = 0;
        for (var i = 0; i <= n; i++) {
          if (i % 2 !== 0) continue;
          total += i;
        }
        return total;
      }
      sumEvens(10);
    `);
  });

  it("switch statement", () => {
    assertEquivalent(`
      function dayName(d) {
        switch(d) {
          case 0: return "Sun";
          case 1: return "Mon";
          case 2: return "Tue";
          default: return "Other";
        }
      }
      [dayName(0), dayName(1), dayName(5)];
    `);
  });

  it("switch with fallthrough", () => {
    assertEquivalent(`
      function test(x) {
        var result = [];
        switch(x) {
          case 1: result.push("one");
          case 2: result.push("two"); break;
          case 3: result.push("three"); break;
        }
        return result;
      }
      test(1);
    `);
  });

  it("ternary expression", () => {
    assertEquivalent(`
      function abs(x) { return x >= 0 ? x : -x; }
      [abs(5), abs(-3)];
    `);
  });

  it("logical AND short-circuit", () => {
    assertEquivalent(`
      function test(a, b) { return a && b; }
      [test(1, 2), test(0, 2), test(null, "x")];
    `);
  });

  it("logical OR short-circuit", () => {
    assertEquivalent(`
      function test(a, b) { return a || b; }
      [test(1, 2), test(0, 2), test("", "default")];
    `);
  });

  it("nullish coalescing", () => {
    assertEquivalent(`
      function test(a, b) { return a ?? b; }
      [test(1, 2), test(null, "fallback"), test(undefined, "fallback"), test(0, "fallback")];
    `);
  });

  it("for...in loop", () => {
    assertEquivalent(`
      function keys(obj) {
        var result = [];
        for (var k in obj) result.push(k);
        return result.sort();
      }
      keys({a: 1, b: 2, c: 3});
    `);
  });

  it("for...of loop", () => {
    assertEquivalent(`
      function sum(arr) {
        var total = 0;
        for (var x of arr) total += x;
        return total;
      }
      sum([1, 2, 3, 4, 5]);
    `);
  });
});
