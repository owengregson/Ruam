import { describe, it } from "vitest";
import { assertEquivalent } from "../helpers.js";

// ─── 1. if/else ───────────────────────────────────────────────────────────────

describe("comprehensive control flow – if/else", () => {
  it("simple if true branch", () => {
    assertEquivalent(`
      function test() {
        var x = 10;
        if (x > 5) return "yes";
        return "no";
      }
      test();
    `);
  });

  it("simple if false branch", () => {
    assertEquivalent(`
      function test() {
        var x = 2;
        if (x > 5) return "yes";
        return "no";
      }
      test();
    `);
  });

  it("nested if/else three levels deep", () => {
    assertEquivalent(`
      function classify(x, y) {
        if (x > 0) {
          if (y > 0) {
            return "both positive";
          } else {
            if (y === 0) return "x positive y zero";
            return "x positive y negative";
          }
        } else {
          return "x non-positive";
        }
      }
      [classify(1, 2), classify(1, 0), classify(1, -1), classify(-1, 5)];
    `);
  });

  it("chained else-if with multiple conditions", () => {
    assertEquivalent(`
      function grade(score) {
        if (score >= 90) return "A";
        else if (score >= 80) return "B";
        else if (score >= 70) return "C";
        else if (score >= 60) return "D";
        else return "F";
      }
      [grade(95), grade(85), grade(75), grade(65), grade(50)];
    `);
  });

  it("if/else without braces, multiline effect", () => {
    assertEquivalent(`
      function test(x) {
        var a = 0, b = 0;
        if (x > 0)
          a = 1;
        else
          b = 1;
        return [a, b];
      }
      [test(5), test(-5)];
    `);
  });

  it("if with complex boolean expression", () => {
    assertEquivalent(`
      function test(a, b, c) {
        if (a > 0 && (b < 10 || c === true)) return "match";
        return "no match";
      }
      [test(1, 5, false), test(1, 15, true), test(-1, 5, true), test(1, 15, false)];
    `);
  });
});

// ─── 2. Ternary ──────────────────────────────────────────────────────────────

describe("comprehensive control flow – ternary", () => {
  it("simple ternary", () => {
    assertEquivalent(`
      function test(x) { return x > 0 ? "pos" : "non-pos"; }
      [test(5), test(-3), test(0)];
    `);
  });

  it("nested ternary", () => {
    assertEquivalent(`
      function sign(x) {
        return x > 0 ? 1 : x < 0 ? -1 : 0;
      }
      [sign(10), sign(-7), sign(0)];
    `);
  });

  it("chained ternary for classification", () => {
    assertEquivalent(`
      function classify(n) {
        return n < 0 ? "negative"
             : n === 0 ? "zero"
             : n < 10 ? "small"
             : n < 100 ? "medium"
             : "large";
      }
      [classify(-5), classify(0), classify(3), classify(50), classify(200)];
    `);
  });

  it("ternary as function argument", () => {
    assertEquivalent(`
      function pick(flag) {
        return [1, 2, 3].concat(flag ? [4, 5] : []);
      }
      [pick(true), pick(false)];
    `);
  });
});

// ─── 3. switch ───────────────────────────────────────────────────────────────

describe("comprehensive control flow – switch", () => {
  it("switch with break on every case", () => {
    assertEquivalent(`
      function color(c) {
        var result;
        switch (c) {
          case "r": result = "red"; break;
          case "g": result = "green"; break;
          case "b": result = "blue"; break;
          default: result = "unknown"; break;
        }
        return result;
      }
      [color("r"), color("g"), color("b"), color("x")];
    `);
  });

  it("switch with fall-through across multiple cases", () => {
    assertEquivalent(`
      function test(x) {
        var r = [];
        switch (x) {
          case 1: r.push("one");
          case 2: r.push("two");
          case 3: r.push("three"); break;
          case 4: r.push("four"); break;
          default: r.push("default");
        }
        return r;
      }
      [test(1), test(2), test(3), test(4), test(5)];
    `);
  });

  it("switch with default in the middle", () => {
    assertEquivalent(`
      function test(x) {
        var r = "";
        switch (x) {
          case 1: r = "one"; break;
          default: r = "other"; break;
          case 2: r = "two"; break;
        }
        return r;
      }
      [test(1), test(2), test(3)];
    `);
  });

  it("switch with complex expression cases", () => {
    assertEquivalent(`
      function test(x) {
        var a = 2, b = 3;
        switch (x) {
          case a + b: return "five";
          case a * b: return "six";
          case a * a: return "four";
          default: return "other";
        }
      }
      [test(5), test(6), test(4), test(1)];
    `);
  });

  it("switch with return from each case", () => {
    assertEquivalent(`
      function fibonacci(n) {
        switch (n) {
          case 0: return 0;
          case 1: return 1;
          case 2: return 1;
          case 3: return 2;
          case 4: return 3;
          case 5: return 5;
          default: return -1;
        }
      }
      [fibonacci(0), fibonacci(1), fibonacci(3), fibonacci(5), fibonacci(10)];
    `);
  });

  it("switch on string values", () => {
    assertEquivalent(`
      function command(cmd) {
        switch (cmd.toLowerCase()) {
          case "start": return 1;
          case "stop": return 2;
          case "pause": return 3;
          default: return 0;
        }
      }
      [command("START"), command("stop"), command("PAUSE"), command("other")];
    `);
  });
});

// ─── 4. for loop ─────────────────────────────────────────────────────────────

describe("comprehensive control flow – for loop", () => {
  it("standard ascending for loop", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        for (var i = 0; i < 5; i++) r.push(i);
        return r;
      }
      test();
    `);
  });

  it("descending for loop", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        for (var i = 5; i > 0; i--) r.push(i);
        return r;
      }
      test();
    `);
  });

  it("for loop with empty parts (infinite-style with break)", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        var i = 0;
        for (;;) {
          if (i >= 5) break;
          r.push(i);
          i++;
        }
        return r;
      }
      test();
    `);
  });

  it("for loop with only condition", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        var i = 0;
        for (; i < 4;) {
          r.push(i);
          i++;
        }
        return r;
      }
      test();
    `);
  });

  it("nested for loops – matrix", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        for (var i = 0; i < 3; i++) {
          for (var j = 0; j < 3; j++) {
            r.push(i * 3 + j);
          }
        }
        return r;
      }
      test();
    `);
  });

  it("for loop with continue", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        for (var i = 0; i < 10; i++) {
          if (i % 3 === 0) continue;
          r.push(i);
        }
        return r;
      }
      test();
    `);
  });

  it("for loop with break", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        for (var i = 0; i < 100; i++) {
          if (i > 5) break;
          r.push(i * i);
        }
        return r;
      }
      test();
    `);
  });

  it("for loop with multiple initializers and updates", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        for (var i = 0, j = 10; i < j; i++, j--) {
          r.push(i + ":" + j);
        }
        return r;
      }
      test();
    `);
  });
});

// ─── 5. while loop ───────────────────────────────────────────────────────────

describe("comprehensive control flow – while loop", () => {
  it("standard while loop", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        var i = 0;
        while (i < 5) {
          r.push(i);
          i++;
        }
        return r;
      }
      test();
    `);
  });

  it("while loop with break", () => {
    assertEquivalent(`
      function test() {
        var i = 0;
        while (true) {
          if (i === 7) break;
          i++;
        }
        return i;
      }
      test();
    `);
  });

  it("while loop with continue", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        var i = 0;
        while (i < 10) {
          i++;
          if (i % 2 === 0) continue;
          r.push(i);
        }
        return r;
      }
      test();
    `);
  });

  it("while loop used for digit extraction", () => {
    assertEquivalent(`
      function digits(n) {
        var r = [];
        while (n > 0) {
          r.push(n % 10);
          n = Math.floor(n / 10);
        }
        return r.reverse();
      }
      digits(12345);
    `);
  });
});

// ─── 6. do-while ─────────────────────────────────────────────────────────────

describe("comprehensive control flow – do-while", () => {
  it("standard do-while accumulates", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        var i = 0;
        do {
          r.push(i);
          i++;
        } while (i < 5);
        return r;
      }
      test();
    `);
  });

  it("do-while executes at least once even if condition false", () => {
    assertEquivalent(`
      function test() {
        var ran = false;
        do {
          ran = true;
        } while (false);
        return ran;
      }
      test();
    `);
  });

  it("do-while with break in the middle", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        var i = 0;
        do {
          r.push(i);
          i++;
          if (i === 3) break;
          r.push("after:" + (i - 1));
        } while (i < 10);
        return r;
      }
      test();
    `);
  });
});

// ─── 7. for...in ─────────────────────────────────────────────────────────────

describe("comprehensive control flow – for...in", () => {
  it("iterates object keys", () => {
    assertEquivalent(`
      function test() {
        var obj = {a: 1, b: 2, c: 3};
        var keys = [];
        for (var k in obj) keys.push(k);
        return keys.sort();
      }
      test();
    `);
  });

  it("for...in with hasOwnProperty guard", () => {
    assertEquivalent(`
      function test() {
        var parent = {inherited: true};
        var child = Object.create(parent);
        child.own = true;
        var ownKeys = [];
        for (var k in child) {
          if (child.hasOwnProperty(k)) ownKeys.push(k);
        }
        return ownKeys;
      }
      test();
    `);
  });

  it("for...in collects values", () => {
    assertEquivalent(`
      function test() {
        var obj = {x: 10, y: 20, z: 30};
        var sum = 0;
        for (var k in obj) {
          sum += obj[k];
        }
        return sum;
      }
      test();
    `);
  });
});

// ─── 8. for...of ─────────────────────────────────────────────────────────────

describe("comprehensive control flow – for...of", () => {
  it("iterates over array", () => {
    assertEquivalent(`
      function test() {
        var r = 0;
        for (var x of [10, 20, 30]) r += x;
        return r;
      }
      test();
    `);
  });

  it("iterates over string characters", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        for (var ch of "hello") r.push(ch);
        return r;
      }
      test();
    `);
  });

  it("for...of with break", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        for (var x of [1, 2, 3, 4, 5, 6, 7]) {
          if (x > 4) break;
          r.push(x);
        }
        return r;
      }
      test();
    `);
  });

  it("for...of with continue", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        for (var x of [1, 2, 3, 4, 5, 6]) {
          if (x % 2 === 0) continue;
          r.push(x);
        }
        return r;
      }
      test();
    `);
  });
});

// ─── 9. break with labels ───────────────────────────────────────────────────

describe("comprehensive control flow – labeled break", () => {
  it("break out of outer loop with label", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        outer: for (var i = 0; i < 5; i++) {
          for (var j = 0; j < 5; j++) {
            if (i + j === 4) break outer;
            r.push(i + "," + j);
          }
        }
        return r;
      }
      test();
    `);
  });

  it("labeled break on while loop", () => {
    assertEquivalent(`
      function test() {
        var count = 0;
        search: while (true) {
          count++;
          var inner = 0;
          while (true) {
            inner++;
            if (inner === 3) break search;
          }
        }
        return count;
      }
      test();
    `);
  });
});

// ─── 10. continue with labels ───────────────────────────────────────────────

describe("comprehensive control flow – labeled continue", () => {
  it("continue outer loop with label", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        outer: for (var i = 0; i < 4; i++) {
          for (var j = 0; j < 4; j++) {
            if (j === 2) continue outer;
            r.push(i + "," + j);
          }
        }
        return r;
      }
      test();
    `);
  });

  it("labeled continue skips rest of outer iteration", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        loop: for (var i = 0; i < 5; i++) {
          if (i === 2) continue loop;
          r.push(i);
        }
        return r;
      }
      test();
    `);
  });
});

// ─── 11. Nested loops with break/continue ───────────────────────────────────

describe("comprehensive control flow – nested loops with break/continue", () => {
  it("inner break does not affect outer loop", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        for (var i = 0; i < 3; i++) {
          for (var j = 0; j < 10; j++) {
            if (j === 2) break;
            r.push(i + ":" + j);
          }
        }
        return r;
      }
      test();
    `);
  });

  it("inner continue does not affect outer loop", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        for (var i = 0; i < 3; i++) {
          for (var j = 0; j < 5; j++) {
            if (j === 1 || j === 3) continue;
            r.push(i + ":" + j);
          }
        }
        return r;
      }
      test();
    `);
  });

  it("triple nested loop with early exit", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        for (var i = 0; i < 3; i++) {
          for (var j = 0; j < 3; j++) {
            for (var k = 0; k < 3; k++) {
              if (i + j + k > 3) break;
              r.push(i + j + k);
            }
          }
        }
        return r;
      }
      test();
    `);
  });
});

// ─── 12. Short-circuit evaluation ───────────────────────────────────────────

describe("comprehensive control flow – short-circuit evaluation", () => {
  it("&& returns first falsy or last truthy", () => {
    assertEquivalent(`
      function test() {
        return [
          1 && 2 && 3,
          1 && 0 && 3,
          null && "never",
          "a" && "b",
          "" && "b"
        ];
      }
      test();
    `);
  });

  it("|| returns first truthy or last falsy", () => {
    assertEquivalent(`
      function test() {
        return [
          0 || "" || null || "found",
          1 || "never",
          "" || 0 || false || undefined,
          "a" || "b"
        ];
      }
      test();
    `);
  });

  it("&& used for conditional execution (side effects)", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        var flag = true;
        flag && r.push("executed");
        var flag2 = false;
        flag2 && r.push("skipped");
        return r;
      }
      test();
    `);
  });

  it("|| used for default value pattern", () => {
    assertEquivalent(`
      function withDefault(val) {
        var v = val || "default";
        return v;
      }
      [withDefault("hello"), withDefault(""), withDefault(0), withDefault(null)];
    `);
  });
});

// ─── 13. Comma operator ─────────────────────────────────────────────────────

describe("comprehensive control flow – comma operator", () => {
  it("comma operator evaluates all, returns last", () => {
    assertEquivalent(`
      function test() {
        var a = (1, 2, 3);
        return a;
      }
      test();
    `);
  });

  it("comma operator with side effects", () => {
    assertEquivalent(`
      function test() {
        var x = 0;
        var y = (x++, x++, x++, x);
        return [x, y];
      }
      test();
    `);
  });

  it("comma operator in for loop update", () => {
    assertEquivalent(`
      function test() {
        var r = [];
        for (var i = 0, j = 10; i < 5; i++, j -= 2) {
          r.push(i + ":" + j);
        }
        return r;
      }
      test();
    `);
  });
});

// ─── 14. try/catch/finally ──────────────────────────────────────────────────

describe("comprehensive control flow – try/catch/finally", () => {
  it("basic try/catch", () => {
    assertEquivalent(`
      function test() {
        try {
          throw new Error("boom");
        } catch (e) {
          return "caught: " + e.message;
        }
      }
      test();
    `);
  });

  it("try/catch/finally – all execute in order", () => {
    assertEquivalent(`
      function test() {
        var log = [];
        try {
          log.push("try");
          throw "error";
        } catch (e) {
          log.push("catch:" + e);
        } finally {
          log.push("finally");
        }
        log.push("after");
        return log;
      }
      test();
    `);
  });

  it("finally runs even when no error", () => {
    assertEquivalent(`
      function test() {
        var log = [];
        try {
          log.push("try");
        } catch (e) {
          log.push("catch");
        } finally {
          log.push("finally");
        }
        return log;
      }
      test();
    `);
  });

  // Not yet implemented: finally execution after return (needs completion-type tracking in VM)
  it.fails("finally runs even after return in try", () => {
    assertEquivalent(`
      function test() {
        var log = [];
        function inner() {
          try {
            log.push("try");
            return "from-try";
          } finally {
            log.push("finally");
          }
        }
        var result = inner();
        return [result, log];
      }
      test();
    `);
  });

  // Not yet implemented: finally execution after return in catch (same as above)
  it.fails("finally runs even after return in catch", () => {
    assertEquivalent(`
      function test() {
        var log = [];
        function inner() {
          try {
            throw "err";
          } catch (e) {
            log.push("catch");
            return "from-catch";
          } finally {
            log.push("finally");
          }
        }
        var result = inner();
        return [result, log];
      }
      test();
    `);
  });

  it("nested try/catch", () => {
    assertEquivalent(`
      function test() {
        var log = [];
        try {
          log.push("outer-try");
          try {
            log.push("inner-try");
            throw "inner-error";
          } catch (e) {
            log.push("inner-catch:" + e);
            throw "rethrown";
          }
        } catch (e) {
          log.push("outer-catch:" + e);
        }
        return log;
      }
      test();
    `);
  });

  it("rethrow preserves original error", () => {
    assertEquivalent(`
      function test() {
        try {
          try {
            throw new TypeError("type error");
          } catch (e) {
            throw e;
          }
        } catch (e) {
          return [e instanceof TypeError, e.message];
        }
      }
      test();
    `);
  });

  it("catch with type checking via instanceof", () => {
    assertEquivalent(`
      function test() {
        var results = [];

        try { throw new TypeError("t"); }
        catch (e) { results.push(e instanceof TypeError); }

        try { throw new RangeError("r"); }
        catch (e) { results.push(e instanceof RangeError); }

        try { throw "string error"; }
        catch (e) { results.push(typeof e === "string"); }

        return results;
      }
      test();
    `);
  });

  it("try/finally without catch", () => {
    assertEquivalent(`
      function test() {
        var log = [];
        try {
          log.push("try");
        } finally {
          log.push("finally");
        }
        return log;
      }
      test();
    `);
  });

  // Not yet implemented: finally return overriding try/catch return (needs completion-type tracking)
  it.fails("finally overrides return value when it also returns", () => {
    assertEquivalent(`
      function test() {
        function inner() {
          try {
            return "try-value";
          } finally {
            return "finally-value";
          }
        }
        return inner();
      }
      test();
    `);
  });

  it("error in catch block is catchable by outer try", () => {
    assertEquivalent(`
      function test() {
        try {
          try {
            throw "first";
          } catch (e) {
            throw "second:" + e;
          }
        } catch (e) {
          return e;
        }
      }
      test();
    `);
  });
});

// ─── 15. throw custom errors ────────────────────────────────────────────────

describe("comprehensive control flow – throw", () => {
  it("throw string", () => {
    assertEquivalent(`
      function test() {
        try {
          throw "custom string error";
        } catch (e) {
          return e;
        }
      }
      test();
    `);
  });

  it("throw number", () => {
    assertEquivalent(`
      function test() {
        try {
          throw 42;
        } catch (e) {
          return e;
        }
      }
      test();
    `);
  });

  it("throw object with custom properties", () => {
    assertEquivalent(`
      function test() {
        try {
          throw {code: 404, message: "not found"};
        } catch (e) {
          return e.code + ":" + e.message;
        }
      }
      test();
    `);
  });

  it("throw Error subclass", () => {
    assertEquivalent(`
      function test() {
        try {
          throw new RangeError("out of bounds");
        } catch (e) {
          return [e instanceof RangeError, e instanceof Error, e.message];
        }
      }
      test();
    `);
  });

  it("conditional throw based on input", () => {
    assertEquivalent(`
      function safeDivide(a, b) {
        if (b === 0) throw new Error("division by zero");
        return a / b;
      }
      function test() {
        var results = [];
        results.push(safeDivide(10, 2));
        try {
          safeDivide(10, 0);
        } catch (e) {
          results.push(e.message);
        }
        return results;
      }
      test();
    `);
  });
});
