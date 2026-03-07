import { describe, it } from "vitest";
import { assertEquivalent } from "../helpers.js";

describe("basic functions", () => {
  it("returns a constant", () => {
    assertEquivalent(`
      function f() { return 42; }
      f();
    `);
  });

  it("adds two numbers", () => {
    assertEquivalent(`
      function add(a, b) { return a + b; }
      add(3, 7);
    `);
  });

  it("subtracts two numbers", () => {
    assertEquivalent(`
      function sub(a, b) { return a - b; }
      sub(10, 4);
    `);
  });

  it("multiplies two numbers", () => {
    assertEquivalent(`
      function mul(a, b) { return a * b; }
      mul(6, 7);
    `);
  });

  it("divides two numbers", () => {
    assertEquivalent(`
      function div(a, b) { return a / b; }
      div(20, 4);
    `);
  });

  it("handles modulus", () => {
    assertEquivalent(`
      function mod(a, b) { return a % b; }
      mod(17, 5);
    `);
  });

  it("handles exponentiation", () => {
    assertEquivalent(`
      function pow(a, b) { return a ** b; }
      pow(2, 10);
    `);
  });

  it("handles unary negation", () => {
    assertEquivalent(`
      function neg(x) { return -x; }
      neg(5);
    `);
  });

  it("handles unary plus", () => {
    assertEquivalent(`
      function toNum(x) { return +x; }
      toNum("123");
    `);
  });

  it("handles boolean not", () => {
    assertEquivalent(`
      function negate(x) { return !x; }
      negate(false);
    `);
  });

  it("returns string concatenation", () => {
    assertEquivalent(`
      function greet(name) { return "Hello, " + name + "!"; }
      greet("World");
    `);
  });

  it("returns undefined when no return", () => {
    assertEquivalent(`
      function noop() {}
      noop();
    `);
  });

  it("handles multiple statements", () => {
    assertEquivalent(`
      function calc(x) {
        var a = x * 2;
        var b = a + 3;
        return b;
      }
      calc(5);
    `);
  });

  it("handles comparison operators", () => {
    assertEquivalent(`
      function compare(a, b) {
        return [a < b, a <= b, a > b, a >= b, a === b, a !== b, a == b, a != b];
      }
      compare(3, 5);
    `);
  });

  it("handles bitwise operators", () => {
    assertEquivalent(`
      function bits(a, b) {
        return [a & b, a | b, a ^ b, ~a, a << 2, a >> 1, a >>> 1];
      }
      bits(0xFF, 0x0F);
    `);
  });

  it("handles typeof", () => {
    assertEquivalent(`
      function types() {
        return [typeof 42, typeof "hello", typeof true, typeof null, typeof undefined];
      }
      types();
    `);
  });

  it("handles void operator", () => {
    assertEquivalent(`
      function voidOp(x) { return void x; }
      voidOp(42);
    `);
  });
});
