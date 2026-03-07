import { describe, it, expect } from "vitest";
import { evalOriginal, evalObfuscated } from "../helpers.js";

describe("async/await support", () => {
  it("basic async function returns a thenable", () => {
    const src = `(function() {
      async function foo() { return 42; }
      var result = foo();
      return typeof result.then === "function" && typeof result.catch === "function";
    })()`;
    expect(evalObfuscated(src)).toBe(true);
  });

  it("async function resolved value", async () => {
    const src = `(function() {
      async function foo() { return 42; }
      return foo();
    })()`;
    const result = evalObfuscated(src);
    expect(typeof (result as any).then).toBe("function");
    expect(await result).toBe(42);
  });

  it("await resolves a promise", async () => {
    const src = `(function() {
      async function foo() {
        var x = await Promise.resolve(10);
        return x + 5;
      }
      return foo();
    })()`;
    const result = evalObfuscated(src);
    expect(await result).toBe(15);
  });

  it("await chains", async () => {
    const src = `(function() {
      async function foo() {
        var a = await Promise.resolve(1);
        var b = await Promise.resolve(2);
        var c = await Promise.resolve(3);
        return a + b + c;
      }
      return foo();
    })()`;
    expect(await evalObfuscated(src)).toBe(6);
  });

  it("await non-promise values", async () => {
    const src = `(function() {
      async function foo() {
        var x = await 42;
        return x;
      }
      return foo();
    })()`;
    expect(await evalObfuscated(src)).toBe(42);
  });

  it("async function with try-catch", async () => {
    const src = `(function() {
      async function foo() {
        try {
          var x = await Promise.reject(new Error("fail"));
          return x;
        } catch (e) {
          return "caught: " + e.message;
        }
      }
      return foo();
    })()`;
    expect(await evalObfuscated(src)).toBe("caught: fail");
  });

  it("async method on object", async () => {
    const src = `(function() {
      var obj = {
        async getValue() {
          return await Promise.resolve(99);
        }
      };
      return obj.getValue();
    })()`;
    expect(await evalObfuscated(src)).toBe(99);
  });

  it(".catch() works on async function result", async () => {
    const src = `(function() {
      async function foo() { return 10; }
      return typeof foo().catch;
    })()`;
    expect(await evalObfuscated(src)).toBe("function");
  });

  it(".then() works on async function result", async () => {
    const src = `(function() {
      async function foo() { return 10; }
      return foo().then(function(v) { return v * 2; });
    })()`;
    expect(await evalObfuscated(src)).toBe(20);
  });

  it("async arrow function", async () => {
    const src = `(function() {
      var foo = async (...args) => {
        var x = await Promise.resolve(args[0]);
        return x + 1;
      };
      return foo(5);
    })()`;
    expect(await evalObfuscated(src)).toBe(6);
  });

  it("nested async calls", async () => {
    const src = `(function() {
      async function inner() {
        return await Promise.resolve(7);
      }
      async function outer() {
        var x = await inner();
        return x * 3;
      }
      return outer();
    })()`;
    expect(await evalObfuscated(src)).toBe(21);
  });

  it("async with conditional await", async () => {
    const src = `(function() {
      async function foo(useAsync) {
        if (useAsync) {
          return await Promise.resolve("async");
        }
        return "sync";
      }
      return Promise.all([foo(true), foo(false)]);
    })()`;
    const result = await evalObfuscated(src);
    expect(result).toEqual(["async", "sync"]);
  });

  it("async function throwing rejects the promise", async () => {
    const src = `(function() {
      async function foo() {
        throw new Error("boom");
      }
      return foo().catch(function(e) { return e.message; });
    })()`;
    expect(await evalObfuscated(src)).toBe("boom");
  });

  it("async with loop and await", async () => {
    const src = `(function() {
      async function sum(arr) {
        var total = 0;
        for (var i = 0; i < arr.length; i++) {
          total += await Promise.resolve(arr[i]);
        }
        return total;
      }
      return sum([1, 2, 3, 4, 5]);
    })()`;
    expect(await evalObfuscated(src)).toBe(15);
  });

  it("promise chain with .catch on async method", async () => {
    const src = `(function() {
      var obj = {
        async doWork() {
          return await Promise.resolve("done");
        }
      };
      return obj.doWork()
        .then(function(v) { return v + "!"; })
        .catch(function() { return "error"; });
    })()`;
    expect(await evalObfuscated(src)).toBe("done!");
  });

  it("class with async method", async () => {
    const src = `(function() {
      class MyClass {
        constructor(val) {
          this.val = val;
        }
        async getVal() {
          return await Promise.resolve(this.val);
        }
      }
      var obj = new MyClass(42);
      return obj.getVal();
    })()`;
    expect(await evalObfuscated(src)).toBe(42);
  });
});
