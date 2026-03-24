import { describe, it } from "bun:test";
import { assertEquivalent } from "../helpers.js";

// ─── 1. Lexical scoping ────────────────────────────────────────────────────

describe("closures & scope – lexical scoping", () => {
	it("inner function accesses outer variable", () => {
		assertEquivalent(`
      function test() {
        var x = 10;
        function inner() { return x; }
        return inner();
      }
      test();
    `);
	});

	it("inner function does not see variables declared after it runs", () => {
		assertEquivalent(`
      function test() {
        var x = 1;
        function inner() { return x; }
        var result = inner();
        x = 999;
        return [result, inner()];
      }
      test();
    `);
	});

	it("block scoping with let", () => {
		assertEquivalent(`
      function test() {
        var r = [];
        {
          let x = 10;
          r.push(x);
        }
        {
          let x = 20;
          r.push(x);
        }
        return r;
      }
      test();
    `);
	});
});

// ─── 2. Closure over loop variable (var vs let) ────────────────────────────

describe("closures & scope – closure over loop variable", () => {
	it("var in loop – all closures see final value", () => {
		assertEquivalent(`
      function test() {
        var fns = [];
        for (var i = 0; i < 5; i++) {
          fns.push(function() { return i; });
        }
        return [fns[0](), fns[1](), fns[2](), fns[3](), fns[4]()];
      }
      test();
    `);
	});

	it("let in loop – each closure captures its own value", () => {
		assertEquivalent(`
      function test() {
        var fns = [];
        for (let i = 0; i < 5; i++) {
          fns.push(function() { return i; });
        }
        return [fns[0](), fns[1](), fns[2](), fns[3](), fns[4]()];
      }
      test();
    `);
	});
});

// ─── 3. IIFE to capture loop variable ──────────────────────────────────────

describe("closures & scope – IIFE", () => {
	it("IIFE captures loop variable correctly", () => {
		assertEquivalent(`
      function test() {
        var fns = [];
        for (var i = 0; i < 5; i++) {
          fns.push((function(captured) {
            return function() { return captured; };
          })(i));
        }
        return [fns[0](), fns[1](), fns[2](), fns[3](), fns[4]()];
      }
      test();
    `);
	});

	it("IIFE with multiple captured values", () => {
		assertEquivalent(`
      function test() {
        var fns = [];
        for (var i = 0; i < 3; i++) {
          for (var j = 0; j < 3; j++) {
            fns.push((function(a, b) {
              return function() { return a + "," + b; };
            })(i, j));
          }
        }
        return fns.map(function(f) { return f(); });
      }
      test();
    `);
	});
});

// ─── 4. Module pattern (revealing module) ──────────────────────────────────

describe("closures & scope – module pattern", () => {
	it("revealing module with private state", () => {
		assertEquivalent(`
      function test() {
        var mod = (function() {
          var _private = "secret";
          var _count = 0;
          function getSecret() { return _private; }
          function increment() { _count++; }
          function getCount() { return _count; }
          return { getSecret: getSecret, increment: increment, getCount: getCount };
        })();
        mod.increment();
        mod.increment();
        mod.increment();
        return [mod.getSecret(), mod.getCount()];
      }
      test();
    `);
	});
});

// ─── 5. Factory functions with private state ───────────────────────────────

describe("closures & scope – factory functions", () => {
	it("factory creates independent instances", () => {
		assertEquivalent(`
      function createStack() {
        var items = [];
        return {
          push: function(v) { items.push(v); },
          pop: function() { return items.pop(); },
          size: function() { return items.length; },
          peek: function() { return items[items.length - 1]; }
        };
      }
      function test() {
        var s1 = createStack();
        var s2 = createStack();
        s1.push(1); s1.push(2); s1.push(3);
        s2.push(10); s2.push(20);
        return [s1.size(), s2.size(), s1.pop(), s2.pop(), s1.peek()];
      }
      test();
    `);
	});

	it("factory with configurable behavior", () => {
		assertEquivalent(`
      function createMultiplier(factor) {
        return {
          multiply: function(x) { return x * factor; },
          getFactor: function() { return factor; },
          setFactor: function(f) { factor = f; }
        };
      }
      function test() {
        var m = createMultiplier(3);
        var r1 = m.multiply(5);
        m.setFactor(10);
        var r2 = m.multiply(5);
        return [r1, r2, m.getFactor()];
      }
      test();
    `);
	});
});

// ─── 6. Counter with increment/decrement/reset ─────────────────────────────

describe("closures & scope – counter", () => {
	it("full counter with inc/dec/reset/get", () => {
		assertEquivalent(`
      function makeCounter(initial) {
        var value = initial || 0;
        return {
          inc: function() { value++; return value; },
          dec: function() { value--; return value; },
          reset: function() { value = initial || 0; return value; },
          get: function() { return value; }
        };
      }
      function test() {
        var c = makeCounter(5);
        var r = [];
        r.push(c.get());
        r.push(c.inc());
        r.push(c.inc());
        r.push(c.inc());
        r.push(c.dec());
        r.push(c.reset());
        r.push(c.get());
        return r;
      }
      test();
    `);
	});
});

// ─── 7. Memoization pattern ────────────────────────────────────────────────

describe("closures & scope – memoization", () => {
	it("closure-based caching with array indexing", () => {
		assertEquivalent(`
      function makeCachedSquare() {
        var results = [];
        var computed = false;
        return {
          compute: function(n) {
            if (!computed) {
              for (var i = 0; i < 20; i++) {
                results.push(i * i);
              }
              computed = true;
            }
            return results[n];
          }
        };
      }
      function test() {
        var sq = makeCachedSquare();
        return [sq.compute(0), sq.compute(1), sq.compute(5), sq.compute(10)];
      }
      test();
    `);
	});

	it("fibonacci via iterative approach with closure", () => {
		assertEquivalent(`
      function makeFib() {
        return function(n) {
          if (n <= 1) return n;
          var a = 0, b = 1;
          for (var i = 2; i <= n; i++) {
            var temp = a + b;
            a = b;
            b = temp;
          }
          return b;
        };
      }
      function test() {
        var fib = makeFib();
        return [fib(0), fib(1), fib(5), fib(10), fib(15)];
      }
      test();
    `);
	});
});

// ─── 8. Event handler simulation (callback closures) ───────────────────────

describe("closures & scope – callback closures", () => {
	it("callbacks capture context at registration time", () => {
		assertEquivalent(`
      function test() {
        var handlers = [];
        function on(name, cb) {
          handlers.push({name: name, cb: cb});
        }
        function emit(name, data) {
          var results = [];
          for (var i = 0; i < handlers.length; i++) {
            if (handlers[i].name === name) {
              results.push(handlers[i].cb(data));
            }
          }
          return results;
        }

        var prefix = "event";
        on("click", function(d) { return prefix + ":" + d; });

        prefix = "changed";
        on("click", function(d) { return prefix + ":" + d; });

        return emit("click", "payload");
      }
      test();
    `);
	});

	it("closure-based once wrapper", () => {
		assertEquivalent(`
      function once(fn) {
        var called = false;
        var result;
        return function() {
          if (called) return result;
          called = true;
          result = fn.apply(null, arguments);
          return result;
        };
      }
      function test() {
        var count = 0;
        var wrapped = once(function(x) { count++; return x * 2; });
        var r = [];
        r.push(wrapped(5));
        r.push(wrapped(10));
        r.push(wrapped(15));
        r.push(count);
        return r;
      }
      test();
    `);
	});
});

// ─── 9. Currying ────────────────────────────────────────────────────────────

describe("closures & scope – currying", () => {
	it("manual currying of a three-argument function", () => {
		assertEquivalent(`
      function curry3(fn) {
        return function(a) {
          return function(b) {
            return function(c) {
              return fn(a, b, c);
            };
          };
        };
      }
      function test() {
        var add3 = curry3(function(a, b, c) { return a + b + c; });
        return [add3(1)(2)(3), add3(10)(20)(30)];
      }
      test();
    `);
	});

	it("curried comparison functions", () => {
		assertEquivalent(`
      function test() {
        function greaterThan(threshold) {
          return function(value) { return value > threshold; };
        }
        var gt10 = greaterThan(10);
        var gt100 = greaterThan(100);
        return [gt10(5), gt10(15), gt100(50), gt100(200)];
      }
      test();
    `);
	});
});

// ─── 10. Partial application ────────────────────────────────────────────────

describe("closures & scope – partial application", () => {
	it("partial application of first argument", () => {
		assertEquivalent(`
      function partial(fn, first) {
        return function() {
          var args = [first];
          for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
          return fn.apply(null, args);
        };
      }
      function test() {
        function multiply(a, b) { return a * b; }
        var double = partial(multiply, 2);
        var triple = partial(multiply, 3);
        return [double(5), double(10), triple(5), triple(10)];
      }
      test();
    `);
	});

	it("partial application preserves remaining arity", () => {
		assertEquivalent(`
      function test() {
        function format(prefix, separator, suffix, value) {
          return prefix + value + separator + suffix;
        }
        function partialFirst(fn, a) {
          return function(b, c, d) { return fn(a, b, c, d); };
        }
        var htmlWrap = partialFirst(format, "<b>");
        return [htmlWrap("", "</b>", "bold"), htmlWrap(" - ", "</b>", "text")];
      }
      test();
    `);
	});
});

// ─── 11. Multiple closures sharing same scope ──────────────────────────────

describe("closures & scope – shared scope", () => {
	it("getter and setter share the same variable", () => {
		assertEquivalent(`
      function test() {
        var shared = "initial";
        var getter = function() { return shared; };
        var setter = function(v) { shared = v; };
        var r = [];
        r.push(getter());
        setter("modified");
        r.push(getter());
        setter("final");
        r.push(getter());
        return r;
      }
      test();
    `);
	});

	it("multiple operations on shared array", () => {
		assertEquivalent(`
      function test() {
        var data = [];
        var add = function(v) { data.push(v); };
        var getAll = function() { return data.slice(); };
        var count = function() { return data.length; };
        var clear = function() { data.length = 0; };

        add("a"); add("b"); add("c");
        var snapshot1 = getAll();
        var c1 = count();
        clear();
        var c2 = count();
        add("d");
        var snapshot2 = getAll();
        return [snapshot1, c1, c2, snapshot2];
      }
      test();
    `);
	});
});

// ─── 12. Nested closures (closure over closure) ────────────────────────────

describe("closures & scope – nested closures", () => {
	it("three levels of closure nesting", () => {
		assertEquivalent(`
      function level1(a) {
        return function level2(b) {
          return function level3(c) {
            return function level4(d) {
              return a + b + c + d;
            };
          };
        };
      }
      function test() {
        return [
          level1(1)(2)(3)(4),
          level1(10)(20)(30)(40),
          level1(0)(0)(0)(1)
        ];
      }
      test();
    `);
	});

	it("nested closures each modify their own state", () => {
		assertEquivalent(`
      function test() {
        function outer() {
          var outerCount = 0;
          return function middle() {
            outerCount++;
            var middleCount = 0;
            return function inner() {
              middleCount++;
              return "outer:" + outerCount + ",middle:" + middleCount;
            };
          };
        }
        var mid1 = outer();
        var inn1a = mid1();
        var inn1b = mid1();
        return [inn1a(), inn1a(), inn1b(), inn1b()];
      }
      test();
    `);
	});
});

// ─── 13. Closure preserving references not values ──────────────────────────

describe("closures & scope – reference preservation", () => {
	it("closure sees mutations to outer primitive variable", () => {
		assertEquivalent(`
      function test() {
        var count = 0;
        var increment = function() { count = count + 1; };
        var getCount = function() { return count; };

        increment();
        increment();
        increment();
        var c1 = getCount();

        count = 100;
        var c2 = getCount();

        return [c1, c2];
      }
      test();
    `);
	});

	it("closure over reassigned variable gets latest value", () => {
		assertEquivalent(`
      function test() {
        var x = 1;
        var getX = function() { return x; };
        var r = [];
        r.push(getX());
        x = 2;
        r.push(getX());
        x = 3;
        r.push(getX());
        return r;
      }
      test();
    `);
	});

	it("closures share reference to same array via function scope", () => {
		assertEquivalent(`
      function makeShared() {
        var arr = [1, 2, 3];
        return {
          add: function(v) { arr.push(v); },
          read: function() { return arr.slice(); },
          size: function() { return arr.length; }
        };
      }
      function test() {
        var s = makeShared();
        s.add(4);
        s.add(5);
        var snap = s.read();
        var sz = s.size();
        return [snap, sz];
      }
      test();
    `);
	});
});

// ─── 14. Scope chain ───────────────────────────────────────────────────────

describe("closures & scope – scope chain", () => {
	it("inner function accesses outer outer function variables", () => {
		assertEquivalent(`
      function test() {
        var a = "global-a";
        function outer() {
          var b = "outer-b";
          function middle() {
            var c = "middle-c";
            function inner() {
              return a + "," + b + "," + c;
            }
            return inner();
          }
          return middle();
        }
        return outer();
      }
      test();
    `);
	});

	it("shadowed variables resolve to nearest scope", () => {
		assertEquivalent(`
      function test() {
        var x = "outer";
        function f1() {
          var x = "middle";
          function f2() {
            var x = "inner";
            return x;
          }
          return [x, f2()];
        }
        return [x, f1()];
      }
      test();
    `);
	});

	it("variable shadowing with partial override", () => {
		assertEquivalent(`
      function test() {
        var a = 1, b = 2, c = 3;
        function level1() {
          var a = 10;
          function level2() {
            var b = 20;
            function level3() {
              return [a, b, c];
            }
            return level3();
          }
          return level2();
        }
        return level1();
      }
      test();
    `);
	});

	it("closure captures correct scope across sibling functions", () => {
		assertEquivalent(`
      function test() {
        var shared = 0;
        function inc() { shared++; return shared; }
        function dec() { shared--; return shared; }
        function get() { return shared; }

        var r = [];
        r.push(inc()); // 1
        r.push(inc()); // 2
        r.push(inc()); // 3
        r.push(dec()); // 2
        r.push(get()); // 2
        return r;
      }
      test();
    `);
	});

	it("closure in returned object method accesses enclosing scope", () => {
		assertEquivalent(`
      function createPerson(name, age) {
        return {
          greet: function() {
            return "Hi, I am " + name + " aged " + age;
          },
          birthday: function() {
            age++;
            return age;
          }
        };
      }
      function test() {
        var p = createPerson("Alice", 30);
        var r = [];
        r.push(p.greet());
        r.push(p.birthday());
        r.push(p.birthday());
        r.push(p.greet());
        return r;
      }
      test();
    `);
	});
});
