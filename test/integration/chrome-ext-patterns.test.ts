import { describe, it, expect } from "vitest";
import { obfuscateCode } from "../../src/transform.js";
import vm from "node:vm";

/**
 * Tests that reproduce patterns found in Chrome extension service workers.
 * These cover async methods, class hierarchies, .catch() chains,
 * promise-returning methods, event listeners with async callbacks, etc.
 */

function makeContext(extraGlobals: Record<string, unknown> = {}): vm.Context {
  return vm.createContext({
    console,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Symbol,
    Math,
    JSON,
    Date,
    RegExp,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    ReferenceError,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Proxy,
    Reflect,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    undefined,
    NaN,
    Infinity,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    Uint8Array,
    Int8Array,
    Float64Array,
    ArrayBuffer,
    DataView,
    TextEncoder,
    TextDecoder,
    Buffer,
    ...extraGlobals,
  });
}

function runObfuscated(source: string, options = {}, extraGlobals = {}): unknown {
  const obfuscated = obfuscateCode(source, {
    targetMode: "root",
    encryptBytecode: false,
    preprocessIdentifiers: false,
    debugLogging: true,
    ...options,
  });
  try {
    return vm.runInContext(obfuscated, makeContext(extraGlobals));
  } catch (e) {
    console.error("OBFUSCATED ERROR:", (e as Error).message);
    console.error("--- first 50 lines ---");
    console.error(obfuscated.split("\n").slice(0, 50).join("\n"));
    throw e;
  }
}

describe("Chrome extension patterns", () => {
  it("async method .catch() chain", async () => {
    const src = `(function() {
      var obj = {
        async enqueue(type, data) {
          return { type: type, data: data, ts: Date.now() };
        }
      };
      return obj.enqueue("session.start", {}).catch(function() { return "error"; });
    })()`;
    const result = await runObfuscated(src);
    expect(result).toHaveProperty("type", "session.start");
  });

  it("async method .then().catch() chain", async () => {
    const src = `(function() {
      var obj = {
        async flush() {
          return "flushed";
        }
      };
      return obj.flush()
        .then(function(v) { return v + "!"; })
        .catch(function() { return "error"; });
    })()`;
    expect(await runObfuscated(src)).toBe("flushed!");
  });

  it("class with async methods and .catch()", async () => {
    const src = `(function() {
      class EventQueue {
        constructor() {
          this.items = [];
        }
        async enqueue(type, meta) {
          this.items.push({ type: type, meta: meta });
          return true;
        }
        async flush() {
          var copy = this.items.slice();
          this.items = [];
          return copy;
        }
      }
      var eq = new EventQueue();
      return eq.enqueue("test", { x: 1 })
        .then(function() { return eq.flush(); })
        .then(function(items) { return items.length; })
        .catch(function() { return -1; });
    })()`;
    expect(await runObfuscated(src)).toBe(1);
  });

  it("class with name instance property", async () => {
    const src = `(function() {
      class Stage {
        name = "UnnamedStage";
        process(input) { return input; }
      }
      class DifficultyStage extends Stage {
        name = "DifficultyStage";
        process(input) { return input + " (difficult)"; }
      }
      var s = new DifficultyStage();
      return [s.name, s.process("test")];
    })()`;
    expect(await runObfuscated(src)).toEqual(["DifficultyStage", "test (difficult)"]);
  });

  it("multiple async methods with .catch() on each", async () => {
    const src = `(function() {
      class Manager {
        async start() { return "started"; }
        async stop() { return "stopped"; }
        async handleAlarm(name) { return "alarm:" + name; }
      }
      var m = new Manager();
      return Promise.all([
        m.start().catch(function(e) { return "err:" + e; }),
        m.stop().catch(function(e) { return "err:" + e; }),
        m.handleAlarm("test").catch(function(e) { return "err:" + e; })
      ]);
    })()`;
    expect(await runObfuscated(src)).toEqual(["started", "stopped", "alarm:test"]);
  });

  it("async IIFE with await and .catch()", async () => {
    const src = `(function() {
      var result = [];
      async function doWork() {
        var a = await Promise.resolve(1);
        var b = await Promise.resolve(2);
        result.push(a + b);
        return a + b;
      }
      doWork().catch(function() { result.push("error"); });
      return result;
    })()`;
    // Note: result may be empty since the async work hasn't completed yet
    // but the key test is that .catch() doesn't throw
    runObfuscated(src); // should not throw
  });

  it("class inheritance with super() and async methods", async () => {
    const src = `(function() {
      class Base {
        constructor(x) { this.x = x; }
        async getX() { return await Promise.resolve(this.x); }
      }
      class Child extends Base {
        constructor(x, y) {
          super(x);
          this.y = y;
        }
        async getSum() {
          var x = await this.getX();
          return x + this.y;
        }
      }
      var c = new Child(10, 20);
      return c.getSum();
    })()`;
    expect(await runObfuscated(src)).toBe(30);
  });

  it("typeof result.catch === 'function' pattern", async () => {
    const src = `(function() {
      async function doSomething() { return 42; }
      var result = doSomething();
      if (result && typeof result.catch === "function") {
        return result.catch(function(err) { return "caught"; });
      }
      return "no catch";
    })()`;
    expect(await runObfuscated(src)).toBe(42);
  });

  it("state machine with async restore", async () => {
    const src = `(function() {
      class StateMachine {
        constructor() {
          this.state = "idle";
        }
        async restore() {
          this.state = await Promise.resolve("restored");
          return this.state;
        }
        send(event) {
          this.state = event;
          return this.state;
        }
      }
      var sm = new StateMachine();
      return sm.restore()
        .then(function(state) { return state; })
        .catch(function(err) { return "error:" + err; });
    })()`;
    expect(await runObfuscated(src)).toBe("restored");
  });

  it("promise chain: method().then().catch()", async () => {
    const src = `(function() {
      var storage = {
        data: {},
        async get(key) {
          return this.data[key];
        },
        async set(key, val) {
          this.data[key] = val;
          return true;
        }
      };
      return storage.set("foo", 42)
        .then(function() { return storage.get("foo"); })
        .then(function(val) { return val; })
        .catch(function(err) { return "error:" + err; });
    })()`;
    expect(await runObfuscated(src)).toBe(42);
  });

  it("class with multiple instance properties and methods", async () => {
    const src = `(function() {
      class Pipeline {
        name = "Pipeline";
        stages = [];
        running = false;

        addStage(s) {
          this.stages.push(s);
          return this;
        }

        async run(input) {
          this.running = true;
          var result = input;
          for (var i = 0; i < this.stages.length; i++) {
            result = await Promise.resolve(this.stages[i](result));
          }
          this.running = false;
          return result;
        }
      }
      var p = new Pipeline();
      p.addStage(function(x) { return x * 2; })
       .addStage(function(x) { return x + 1; });
      return p.run(5);
    })()`;
    expect(await runObfuscated(src)).toBe(11);
  });
});
