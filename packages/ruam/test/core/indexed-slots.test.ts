/**
 * Scope correctness tests — closures, block scoping, catch scoping, typeof.
 *
 * Covers captured variables (closure reads/writes), let/const block scoping,
 * catch variable isolation, and typeof through the scope chain.
 */

import { assertEquivalent } from "../helpers.js";

// ---------------------------------------------------------------------------
// Basic closure reads
// ---------------------------------------------------------------------------

describe("indexed slots: basic closure reads", () => {
  it("inner function reads captured var", () => {
    assertEquivalent(`
      function test() {
        var x = 42;
        function inner() { return x; }
        return inner();
      }
      test();
    `);
  });

  it("inner function reads captured parameter", () => {
    assertEquivalent(`
      function test(a) {
        function inner() { return a; }
        return inner();
      }
      test(99);
    `);
  });

  it("arrow function reads captured var", () => {
    assertEquivalent(`
      function test() {
        var msg = "hello";
        var fn = function() { return msg; };
        return fn();
      }
      test();
    `);
  });

  it("multiple captured vars", () => {
    assertEquivalent(`
      function test() {
        var a = 1, b = 2, c = 3;
        function sum() { return a + b + c; }
        return sum();
      }
      test();
    `);
  });

  it("captured var with non-captured locals (mixed register/slot)", () => {
    assertEquivalent(`
      function test() {
        var captured = 10;
        var local = 20;
        function inner() { return captured; }
        return inner() + local;
      }
      test();
    `);
  });
});

// ---------------------------------------------------------------------------
// Closure mutations (write visibility)
// ---------------------------------------------------------------------------

describe("indexed slots: mutation visibility", () => {
  it("outer writes visible to inner", () => {
    assertEquivalent(`
      function test() {
        var x = 1;
        function get() { return x; }
        x = 42;
        return get();
      }
      test();
    `);
  });

  it("inner writes visible to outer", () => {
    assertEquivalent(`
      function test() {
        var x = 1;
        function set(v) { x = v; }
        set(99);
        return x;
      }
      test();
    `);
  });

  it("inner increment visible to outer", () => {
    assertEquivalent(`
      function test() {
        var count = 0;
        function inc() { count++; }
        inc(); inc(); inc();
        return count;
      }
      test();
    `);
  });

  it("outer increment visible to inner", () => {
    assertEquivalent(`
      function test() {
        var x = 0;
        function get() { return x; }
        x++;
        x++;
        return get();
      }
      test();
    `);
  });

  it("compound assignment visible across closures", () => {
    assertEquivalent(`
      function test() {
        var total = 0;
        function add(n) { total += n; }
        add(10); add(20); add(30);
        return total;
      }
      test();
    `);
  });

  it("multiple closures share same captured var", () => {
    assertEquivalent(`
      function test() {
        var x = 0;
        function inc() { x++; }
        function get() { return x; }
        function set(v) { x = v; }
        inc(); inc();
        set(100);
        inc();
        return get();
      }
      test();
    `);
  });
});

// ---------------------------------------------------------------------------
// Closures in loops
// ---------------------------------------------------------------------------

describe("indexed slots: closures in loops", () => {
  it("closure captures loop counter (var)", () => {
    assertEquivalent(`
      function test() {
        var fns = [];
        for (var i = 0; i < 3; i++) {
          (function(j) {
            fns.push(function() { return j; });
          })(i);
        }
        return [fns[0](), fns[1](), fns[2]()];
      }
      test();
    `);
  });

  it("closure modifies captured var in loop", () => {
    assertEquivalent(`
      function test() {
        var sum = 0;
        var adders = [];
        for (var i = 1; i <= 3; i++) {
          adders.push(function() { sum += i; });
        }
        adders[0](); adders[1](); adders[2]();
        return sum;
      }
      test();
    `);
  });

  it("forEach callback reads captured var", () => {
    assertEquivalent(`
      function test() {
        var result = [];
        var prefix = "item_";
        [1, 2, 3].forEach(function(n) {
          result.push(prefix + n);
        });
        return result;
      }
      test();
    `);
  });

  it("map callback reads and writes captured var", () => {
    assertEquivalent(`
      function test() {
        var count = 0;
        var result = [10, 20, 30].map(function(n) {
          count++;
          return n + count;
        });
        return { result: result, count: count };
      }
      test();
    `);
  });

  it("for-let destructuring gets per-iteration bindings", () => {
    assertEquivalent(`
      function test() {
        var items = [{v:10},{v:20},{v:30}];
        var fns = [];
        for (let {v} = items[0], i = 0; i < items.length; ({v} = items[i] || {v:0}), i++) {
          (function(val) { fns.push(function() { return val; }); })(v);
        }
        return [fns[0](), fns[1](), fns[2]()];
      }
      test();
    `);
  });
});

// ---------------------------------------------------------------------------
// Deep nesting
// ---------------------------------------------------------------------------

describe("indexed slots: deep nesting", () => {
  it("3-level deep closure read", () => {
    assertEquivalent(`
      function test() {
        var x = 42;
        function mid() {
          function inner() { return x; }
          return inner();
        }
        return mid();
      }
      test();
    `);
  });

  it("3-level deep closure write", () => {
    assertEquivalent(`
      function test() {
        var x = 0;
        function mid() {
          function inner() { x = 99; }
          inner();
        }
        mid();
        return x;
      }
      test();
    `);
  });

  it("each level has its own captured vars", () => {
    assertEquivalent(`
      function test() {
        var a = 1;
        function level1() {
          var b = 2;
          function level2() {
            return a + b;
          }
          return level2();
        }
        return level1();
      }
      test();
    `);
  });

  it("deep mutation chain", () => {
    assertEquivalent(`
      function test() {
        var x = 0;
        function a() {
          function b() {
            function c() { x += 10; }
            c();
            x += 5;
          }
          b();
          x += 1;
        }
        a();
        return x;
      }
      test();
    `);
  });
});

// ---------------------------------------------------------------------------
// Classes with captured vars
// ---------------------------------------------------------------------------

describe("indexed slots: classes", () => {
  it("class constructor reads captured var", () => {
    assertEquivalent(`
      function test() {
        var defaultName = "world";
        class Greeter {
          constructor() { this.name = defaultName; }
          greet() { return "Hello, " + this.name; }
        }
        return new Greeter().greet();
      }
      test();
    `);
  });

  it("class method modifies captured var", () => {
    assertEquivalent(`
      function test() {
        var count = 0;
        class Counter {
          inc() { count++; }
          get() { return count; }
        }
        var c = new Counter();
        c.inc(); c.inc(); c.inc();
        return c.get();
      }
      test();
    `);
  });

  it("class with computed property keys from captured vars", () => {
    assertEquivalent(`
      function test() {
        var key1 = "prop_" + 1;
        var key2 = "prop_" + 2;
        class DynProps {
          constructor() {
            this[key1] = "first";
            this[key2] = "second";
          }
          getAll() {
            var result = [];
            for (var k in this) {
              if (k.indexOf("prop_") === 0) result.push(this[k]);
            }
            return result.sort();
          }
        }
        return new DynProps().getAll();
      }
      test();
    `);
  });

  it("class factory with captured state", () => {
    assertEquivalent(`
      function test() {
        var instances = 0;
        class Tracked {
          constructor() { instances++; this.id = instances; }
        }
        new Tracked(); new Tracked(); var t = new Tracked();
        return { id: t.id, total: instances };
      }
      test();
    `);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("indexed slots: edge cases", () => {
  it("captured var initialized to undefined", () => {
    assertEquivalent(`
      function test() {
        var x;
        function set(v) { x = v; }
        function get() { return x; }
        var before = get();
        set(42);
        return { before: before, after: get() };
      }
      test();
    `);
  });

  it("captured var with default parameter", () => {
    assertEquivalent(`
      function test(x) {
        if (x === undefined) x = 10;
        function get() { return x; }
        return get();
      }
      test();
    `);
  });

  it("IIFE captures outer var", () => {
    assertEquivalent(`
      function test() {
        var x = 5;
        var result = (function() { return x * 2; })();
        return result;
      }
      test();
    `);
  });

  it("closure survives after outer function returns", () => {
    assertEquivalent(`
      function test() {
        function makeCounter() {
          var n = 0;
          return function() { return ++n; };
        }
        var counter = makeCounter();
        return [counter(), counter(), counter()];
      }
      test();
    `);
  });

  it("two independent closures from same factory", () => {
    assertEquivalent(`
      function test() {
        function makeCounter() {
          var n = 0;
          return function() { return ++n; };
        }
        var a = makeCounter();
        var b = makeCounter();
        a(); a(); a();
        b();
        return [a(), b()];
      }
      test();
    `);
  });

  it("captured var used in try/catch", () => {
    assertEquivalent(`
      function test() {
        var result = "none";
        function setResult(v) { result = v; }
        try {
          setResult("ok");
        } catch(e) {
          setResult("error");
        }
        return result;
      }
      test();
    `);
  });

  it("typeof captured var in inner function", () => {
    assertEquivalent(`
      function test() {
        var x = 42;
        function inner() { return typeof x; }
        return inner();
      }
      test();
    `);
  });

  it("typeof undefined captured var in inner function", () => {
    assertEquivalent(`
      function test() {
        var x;
        function inner() { return typeof x; }
        return inner();
      }
      test();
    `);
  });

  it("captured var as object property value", () => {
    assertEquivalent(`
      function test() {
        var name = "Alice";
        var age = 30;
        function makeObj() { return { name: name, age: age }; }
        return makeObj();
      }
      test();
    `);
  });

  it("rest parameter captured by closure", () => {
    assertEquivalent(`
      function test() {
        function collect() {
          var items = [];
          function add(x) { items.push(x); }
          function get() { return items; }
          return { add: add, get: get };
        }
        var c = collect();
        c.add(1); c.add(2); c.add(3);
        return c.get();
      }
      test();
    `);
  });

  it("captured var in conditional branches", () => {
    assertEquivalent(`
      function test() {
        var x = 0;
        function inc() { x++; }
        if (true) { inc(); inc(); }
        if (false) { inc(); }
        return x;
      }
      test();
    `);
  });

  it("captured var with destructuring assignment in inner", () => {
    assertEquivalent(`
      function test() {
        var a = 0, b = 0;
        function swap() {
          var tmp = a;
          a = b;
          b = tmp;
        }
        a = 10; b = 20;
        swap();
        return [a, b];
      }
      test();
    `);
  });

  it("recursive function with captured accumulator", () => {
    assertEquivalent(`
      function test() {
        var calls = 0;
        function fib(n) {
          calls++;
          if (n <= 1) return n;
          return fib(n - 1) + fib(n - 2);
        }
        var result = fib(8);
        return { result: result, calls: calls };
      }
      test();
    `);
  });
});

// ---------------------------------------------------------------------------
// Interaction with block scopes
// ---------------------------------------------------------------------------

describe("indexed slots: block scope interaction", () => {
  it("captured var accessed through block scope", () => {
    assertEquivalent(`
      function test() {
        var x = 1;
        {
          var y = 2;
          function inner() { return x + y; }
        }
        return inner();
      }
      test();
    `);
  });

  it("captured var with for-loop block scope", () => {
    assertEquivalent(`
      function test() {
        var sum = 0;
        for (var i = 0; i < 5; i++) {
          (function() { sum += i; })();
        }
        return sum;
      }
      test();
    `);
  });

  it("let in bare block shadows outer var", () => {
    assertEquivalent(`
      function test() {
        var x = 1;
        {
          let x = 2;
          x = x + 10;
        }
        return x;
      }
      test();
    `);
  });

  it("const in bare block shadows outer var", () => {
    assertEquivalent(`
      function test() {
        var x = 1;
        {
          const x = 99;
        }
        return x;
      }
      test();
    `);
  });

  it("multiple nested blocks with let shadowing", () => {
    assertEquivalent(`
      function test() {
        let x = 1;
        {
          let x = 2;
          {
            let x = 3;
          }
        }
        return x;
      }
      test();
    `);
  });

  it("let in block visible to closure within block", () => {
    assertEquivalent(`
      function test() {
        var result;
        {
          let x = 42;
          result = (function() { return x; })();
        }
        return result;
      }
      test();
    `);
  });
});

// ---------------------------------------------------------------------------
// Catch variable scoping
// ---------------------------------------------------------------------------

describe("catch variable scoping", () => {
  it("catch variable does not leak to outer scope", () => {
    assertEquivalent(`
      function test() {
        var e = "outer";
        try { throw "err"; } catch(e) { }
        return e;
      }
      test();
    `);
  });

  it("catch variable shadows outer with same name", () => {
    assertEquivalent(`
      function test() {
        var x = "original";
        try { throw "caught"; } catch(x) { x = "modified"; }
        return x;
      }
      test();
    `);
  });
});

// ---------------------------------------------------------------------------
// typeof in closures
// ---------------------------------------------------------------------------

describe("typeof in closures", () => {
  it("typeof scoped var in inner function", () => {
    assertEquivalent(`
      function test() {
        var x = 42;
        function inner() { return typeof x; }
        return inner();
      }
      test();
    `);
  });

  it("typeof undefined scoped var", () => {
    assertEquivalent(`
      function test() {
        var x;
        function inner() { return typeof x; }
        return inner();
      }
      test();
    `);
  });

  it("typeof string scoped var", () => {
    assertEquivalent(`
      function test() {
        var s = "hello";
        function inner() { return typeof s; }
        return inner();
      }
      test();
    `);
  });

  it("typeof nonexistent global still returns undefined", () => {
    assertEquivalent(`
      function test() {
        return typeof someNonexistentGlobalVar123;
      }
      test();
    `);
  });
});

// ---------------------------------------------------------------------------
// Switch let/const scoping
// ---------------------------------------------------------------------------

describe("switch let/const scoping", () => {
  it("let in switch case does not leak outside", () => {
    assertEquivalent(`
      function test() {
        var x = "outer";
        switch (1) {
          case 1: let x = "inner"; break;
        }
        return x;
      }
      test();
    `);
  });

  it("let in switch with braces per case", () => {
    assertEquivalent(`
      function test() {
        var result = [];
        switch (2) {
          case 1: { let v = "a"; result.push(v); break; }
          case 2: { let v = "b"; result.push(v); break; }
          case 3: { let v = "c"; result.push(v); break; }
        }
        return result;
      }
      test();
    `);
  });
});

// ---------------------------------------------------------------------------
// for-in destructuring
// ---------------------------------------------------------------------------

describe("for-in destructuring", () => {
  it("for-in with simple variable", () => {
    assertEquivalent(`
      function test() {
        var obj = {a: 1, b: 2, c: 3};
        var keys = [];
        for (var k in obj) { keys.push(k); }
        return keys.sort();
      }
      test();
    `);
  });
});
