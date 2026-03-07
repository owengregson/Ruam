import { describe, it } from "vitest";
import { assertEquivalent } from "../helpers.js";

describe("exceptions", () => {
  it("try/catch basic", () => {
    assertEquivalent(`
      function test() {
        try {
          throw new Error("oops");
        } catch (e) {
          return e.message;
        }
      }
      test();
    `);
  });

  it("try/catch/finally", () => {
    assertEquivalent(`
      function test() {
        var log = [];
        try {
          log.push("try");
          throw "err";
        } catch (e) {
          log.push("catch:" + e);
        } finally {
          log.push("finally");
        }
        return log;
      }
      test();
    `);
  });

  it("try without error", () => {
    assertEquivalent(`
      function test() {
        var log = [];
        try {
          log.push("ok");
        } catch (e) {
          log.push("caught");
        }
        log.push("after");
        return log;
      }
      test();
    `);
  });

  it("re-throw", () => {
    assertEquivalent(`
      function test() {
        try {
          try {
            throw "inner";
          } catch (e) {
            throw "rethrown:" + e;
          }
        } catch (e) {
          return e;
        }
      }
      test();
    `);
  });

  it("error type check", () => {
    assertEquivalent(`
      function test() {
        try {
          null.property;
        } catch (e) {
          return e instanceof TypeError;
        }
      }
      test();
    `);
  });
});
