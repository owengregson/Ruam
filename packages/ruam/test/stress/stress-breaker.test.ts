import { describe, it, expect } from "vitest";
import { assertEquivalent, evalOriginal, evalObfuscated } from "../helpers.js";

/**
 * Stress tests designed to break the VM obfuscator.
 * These exercise the hardest edge cases: deep recursion,
 * complex closure interactions, tricky this-binding, exception
 * flow interacting with closures, prototype manipulation
 * inside closures, complex assignment targets, and more.
 */

describe("stress: deep closure chains", () => {
  it("10-level nested closure accessing all outer vars", () => {
    assertEquivalent(`
      function build() {
        var a = 1;
        return function() {
          var b = 2;
          return function() {
            var c = 3;
            return function() {
              var d = 4;
              return function() {
                var e = 5;
                return function() {
                  var f = 6;
                  return function() {
                    var g = 7;
                    return function() {
                      return a + b + c + d + e + f + g;
                    };
                  };
                };
              };
            };
          };
        };
      }
      build()()()()()()()();
    `);
  });

  it("closure mutation across 5 levels", () => {
    assertEquivalent(`
      function outer() {
        var x = 0;
        function mid1() {
          x += 10;
          function mid2() {
            x += 100;
            function inner() {
              x += 1000;
              return x;
            }
            return inner();
          }
          return mid2();
        }
        mid1();
        return x;
      }
      outer();
    `);
  });

  it("many closures capturing same variable with interleaved mutations", () => {
    assertEquivalent(`
      function test() {
        var shared = 0;
        var fns = [];
        for (var i = 0; i < 5; i++) {
          fns.push(function(n) { shared += n; return shared; });
        }
        var results = [];
        for (var j = 0; j < fns.length; j++) {
          results.push(fns[j](j + 1));
        }
        return results;
      }
      test();
    `);
  });
});

describe("stress: this binding edge cases", () => {
  it("method call vs detached call", () => {
    assertEquivalent(`
      function test() {
        var obj = {
          val: 42,
          getVal: function() { return this.val; }
        };
        var detached = obj.getVal;
        var r1 = obj.getVal();
        return r1;
      }
      test();
    `);
  });

  it("nested method calls with different this", () => {
    assertEquivalent(`
      function test() {
        var a = {
          val: 10,
          b: {
            val: 20,
            getVal: function() { return this.val; }
          }
        };
        return a.b.getVal();
      }
      test();
    `);
  });

  it("call/apply/bind with closures", () => {
    assertEquivalent(`
      function test() {
        function greet(greeting) {
          return greeting + " " + this.name;
        }
        var obj = { name: "world" };
        var r1 = greet.call(obj, "hello");
        var r2 = greet.apply(obj, ["hi"]);
        var bound = greet.bind(obj);
        var r3 = bound("hey");
        return [r1, r2, r3];
      }
      test();
    `);
  });

  it("constructor with prototype methods accessing this", () => {
    assertEquivalent(`
      function test() {
        function Counter(start) {
          this.val = start;
        }
        Counter.prototype.inc = function() { this.val++; return this; };
        Counter.prototype.get = function() { return this.val; };
        var c = new Counter(0);
        c.inc().inc().inc();
        return c.get();
      }
      test();
    `);
  });
});

describe("stress: exception + closure interaction", () => {
  it("catch block closure captures error", () => {
    assertEquivalent(`
      function test() {
        var captured;
        try {
          throw new Error("boom");
        } catch(e) {
          captured = function() { return e.message; };
        }
        return captured();
      }
      test();
    `);
  });

  it("finally modifies closed-over variable", () => {
    assertEquivalent(`
      function test() {
        var x = "initial";
        var getter;
        try {
          getter = function() { return x; };
          throw "err";
        } catch(e) {
          x = "caught";
        } finally {
          x = "finally";
        }
        return getter();
      }
      test();
    `);
  });

  it("exception inside closure inside loop", () => {
    assertEquivalent(`
      function test() {
        var results = [];
        for (var i = 0; i < 5; i++) {
          try {
            if (i === 3) throw "skip " + i;
            results.push(i);
          } catch(e) {
            results.push(e);
          }
        }
        return results;
      }
      test();
    `);
  });

  it("nested try-catch with rethrow and finally", () => {
    assertEquivalent(`
      function test() {
        var log = [];
        try {
          log.push("outer-try");
          try {
            log.push("inner-try");
            throw "inner-error";
          } catch(e) {
            log.push("inner-catch:" + e);
            throw "rethrown";
          } finally {
            log.push("inner-finally");
          }
        } catch(e) {
          log.push("outer-catch:" + e);
        } finally {
          log.push("outer-finally");
        }
        return log.join("|");
      }
      test();
    `);
  });

  it("exception during iteration with cleanup", () => {
    assertEquivalent(`
      function test() {
        var processed = [];
        var items = [1, 2, "bad", 4, 5];
        for (var i = 0; i < items.length; i++) {
          try {
            if (typeof items[i] !== "number") throw "not a number: " + items[i];
            processed.push(items[i] * 2);
          } catch(e) {
            processed.push("ERR");
          }
        }
        return processed;
      }
      test();
    `);
  });
});

describe("stress: complex assignment targets", () => {
  it("chained property assignment", () => {
    assertEquivalent(`
      function test() {
        var o = {a: {b: {c: 0}}};
        o.a.b.c = 42;
        return o.a.b.c;
      }
      test();
    `);
  });

  it("computed property compound assignment", () => {
    assertEquivalent(`
      function test() {
        var arr = [10, 20, 30];
        var key = 1;
        arr[key] += 5;
        arr[key + 1] *= 2;
        return arr;
      }
      test();
    `);
  });

  it("assignment in condition", () => {
    assertEquivalent(`
      function test() {
        var x;
        if (x = 42) {
          return x;
        }
        return 0;
      }
      test();
    `);
  });

  it("property increment on returned object", () => {
    assertEquivalent(`
      function test() {
        function getObj() { return {count: 0}; }
        var o = getObj();
        o.count++;
        o.count++;
        o.count++;
        return o.count;
      }
      test();
    `);
  });

  it("dynamic property increment", () => {
    assertEquivalent(`
      function test() {
        var o = {a: 1, b: 2, c: 3};
        var keys = Object.keys(o);
        for (var i = 0; i < keys.length; i++) {
          o[keys[i]] *= 10;
        }
        return [o.a, o.b, o.c];
      }
      test();
    `);
  });
});

describe("stress: recursive algorithms", () => {
  it("mutual recursion (isEven/isOdd)", () => {
    assertEquivalent(`
      function test() {
        function isEven(n) { return n === 0 ? true : isOdd(n - 1); }
        function isOdd(n) { return n === 0 ? false : isEven(n - 1); }
        return [isEven(10), isOdd(11), isEven(7), isOdd(6)];
      }
      test();
    `);
  });

  it("tree traversal with accumulator", () => {
    assertEquivalent(`
      function test() {
        var tree = {
          val: 1,
          left: {
            val: 2,
            left: { val: 4, left: null, right: null },
            right: { val: 5, left: null, right: null }
          },
          right: {
            val: 3,
            left: null,
            right: { val: 6, left: null, right: null }
          }
        };
        function sum(node) {
          if (!node) return 0;
          return node.val + sum(node.left) + sum(node.right);
        }
        return sum(tree);
      }
      test();
    `);
  });

  it("tower of hanoi count", () => {
    assertEquivalent(`
      function test() {
        var moves = 0;
        function hanoi(n, from, to, aux) {
          if (n === 0) return;
          hanoi(n - 1, from, aux, to);
          moves++;
          hanoi(n - 1, aux, to, from);
        }
        hanoi(6, "A", "C", "B");
        return moves;
      }
      test();
    `);
  });

  it("recursive merge sort", () => {
    assertEquivalent(`
      function test() {
        function merge(left, right) {
          var result = [];
          var i = 0, j = 0;
          while (i < left.length && j < right.length) {
            if (left[i] <= right[j]) result.push(left[i++]);
            else result.push(right[j++]);
          }
          while (i < left.length) result.push(left[i++]);
          while (j < right.length) result.push(right[j++]);
          return result;
        }
        function mergeSort(arr) {
          if (arr.length <= 1) return arr;
          var mid = Math.floor(arr.length / 2);
          return merge(mergeSort(arr.slice(0, mid)), mergeSort(arr.slice(mid)));
        }
        return mergeSort([38, 27, 43, 3, 9, 82, 10]).join(",");
      }
      test();
    `);
  });

  it("recursive JSON-like stringify", () => {
    assertEquivalent(`
      function test() {
        function myStringify(val) {
          if (val === null) return "null";
          if (typeof val === "number" || typeof val === "boolean") return String(val);
          if (typeof val === "string") return '"' + val + '"';
          if (Array.isArray(val)) {
            var parts = [];
            for (var i = 0; i < val.length; i++) parts.push(myStringify(val[i]));
            return "[" + parts.join(",") + "]";
          }
          if (typeof val === "object") {
            var parts = [];
            var keys = Object.keys(val);
            for (var i = 0; i < keys.length; i++) {
              parts.push('"' + keys[i] + '":' + myStringify(val[keys[i]]));
            }
            return "{" + parts.join(",") + "}";
          }
          return "undefined";
        }
        return myStringify({a: [1, "two", null, true], b: {c: 3}});
      }
      test();
    `);
  });
});

describe("stress: complex iteration patterns", () => {
  it("nested for...of with break", () => {
    assertEquivalent(`
      function test() {
        var matrix = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
        var found = -1;
        for (var i = 0; i < matrix.length; i++) {
          for (var j = 0; j < matrix[i].length; j++) {
            if (matrix[i][j] === 5) {
              found = i * 10 + j;
              break;
            }
          }
          if (found >= 0) break;
        }
        return found;
      }
      test();
    `);
  });

  it("for...of with object values iteration", () => {
    assertEquivalent(`
      function test() {
        var obj = {x: 10, y: 20, z: 30};
        var vals = Object.values(obj);
        var sum = 0;
        for (var v of vals) sum += v;
        return sum;
      }
      test();
    `);
  });

  it("reducing over computed keys", () => {
    assertEquivalent(`
      function test() {
        var data = {};
        for (var i = 0; i < 10; i++) {
          data["key_" + i] = i * i;
        }
        var keys = Object.keys(data);
        var total = 0;
        for (var k of keys) {
          total += data[k];
        }
        return total;
      }
      test();
    `);
  });

  it("iterator protocol simulation", () => {
    assertEquivalent(`
      function test() {
        function range(start, end) {
          var values = [];
          for (var i = start; i < end; i++) values.push(i);
          return values;
        }
        var sum = 0;
        for (var n of range(1, 11)) sum += n;
        return sum;
      }
      test();
    `);
  });
});

describe("stress: complex expression evaluation order", () => {
  it("multiple side effects in single expression", () => {
    assertEquivalent(`
      function test() {
        var log = [];
        function track(label, val) { log.push(label); return val; }
        var r = track("a", 1) + track("b", 2) * track("c", 3);
        return log.join(",") + "=" + r;
      }
      test();
    `);
  });

  it("short-circuit with side effects in complex expression", () => {
    assertEquivalent(`
      function test() {
        var calls = [];
        function f(n) { calls.push(n); return n; }
        var r = f(0) || f(1) || f(0) || f(2);
        return calls.join(",") + ":" + r;
      }
      test();
    `);
  });

  it("ternary chains with function calls", () => {
    assertEquivalent(`
      function test() {
        function classify(n) {
          return n < 0 ? "negative"
            : n === 0 ? "zero"
            : n < 10 ? "small"
            : n < 100 ? "medium"
            : "large";
        }
        return [classify(-5), classify(0), classify(7), classify(42), classify(999)];
      }
      test();
    `);
  });

  it("comma operator in complex positions", () => {
    assertEquivalent(`
      function test() {
        var a = 0, b = 0, c = 0;
        for (a = 1, b = 2; a < 5; a++, b *= 2) {
          c += a + b;
        }
        return [a, b, c];
      }
      test();
    `);
  });
});

describe("stress: prototype and constructor patterns", () => {
  it("prototype chain with overrides", () => {
    assertEquivalent(`
      function test() {
        function Animal(name) { this.name = name; }
        Animal.prototype.type = "animal";
        Animal.prototype.describe = function() {
          return this.type + ":" + this.name;
        };

        function Dog(name, breed) {
          Animal.call(this, name);
          this.breed = breed;
        }
        Dog.prototype = Object.create(Animal.prototype);
        Dog.prototype.constructor = Dog;
        Dog.prototype.type = "dog";
        Dog.prototype.describe = function() {
          return Animal.prototype.describe.call(this) + "(" + this.breed + ")";
        };

        var d = new Dog("Rex", "Labrador");
        return d.describe();
      }
      test();
    `);
  });

  it("mixin pattern", () => {
    assertEquivalent(`
      function test() {
        function mixin(target, source) {
          var keys = Object.keys(source);
          for (var i = 0; i < keys.length; i++) {
            target[keys[i]] = source[keys[i]];
          }
          return target;
        }
        var serializable = {
          toJSON: function() {
            var result = {};
            var keys = Object.keys(this);
            for (var i = 0; i < keys.length; i++) {
              if (typeof this[keys[i]] !== "function") {
                result[keys[i]] = this[keys[i]];
              }
            }
            return JSON.stringify(result);
          }
        };
        var obj = {x: 1, y: 2, z: 3};
        mixin(obj, serializable);
        return obj.toJSON();
      }
      test();
    `);
  });
});

describe("stress: complex state machines", () => {
  it("state machine with transitions and guards", () => {
    assertEquivalent(`
      function test() {
        function createFSM(initial, transitions) {
          var state = initial;
          var history = [initial];
          return {
            transition: function(event) {
              for (var i = 0; i < transitions.length; i++) {
                var t = transitions[i];
                if (t.from === state && t.event === event) {
                  if (!t.guard || t.guard()) {
                    state = t.to;
                    history.push(state);
                    return true;
                  }
                }
              }
              return false;
            },
            getState: function() { return state; },
            getHistory: function() { return history.join("->"); }
          };
        }
        var count = 0;
        var fsm = createFSM("idle", [
          {from: "idle", event: "start", to: "running"},
          {from: "running", event: "pause", to: "paused"},
          {from: "paused", event: "resume", to: "running"},
          {from: "running", event: "stop", to: "idle"},
          {from: "running", event: "error", to: "failed", guard: function() { count++; return count > 2; }},
        ]);
        fsm.transition("start");
        fsm.transition("error");
        fsm.transition("pause");
        fsm.transition("resume");
        fsm.transition("error");
        fsm.transition("error");
        return fsm.getHistory();
      }
      test();
    `);
  });

  it("observable pattern with multiple subscribers", () => {
    assertEquivalent(`
      function test() {
        function createObservable(initial) {
          var value = initial;
          var subscribers = [];
          return {
            get: function() { return value; },
            set: function(newVal) {
              var old = value;
              value = newVal;
              for (var i = 0; i < subscribers.length; i++) {
                subscribers[i](newVal, old);
              }
            },
            subscribe: function(fn) {
              subscribers.push(fn);
              return function() {
                var idx = subscribers.indexOf(fn);
                if (idx >= 0) subscribers.splice(idx, 1);
              };
            }
          };
        }
        var log = [];
        var obs = createObservable(0);
        var unsub1 = obs.subscribe(function(n, o) { log.push("A:" + o + "->" + n); });
        var unsub2 = obs.subscribe(function(n, o) { log.push("B:" + o + "->" + n); });
        obs.set(1);
        unsub1();
        obs.set(2);
        return log.join("|");
      }
      test();
    `);
  });
});

describe("stress: complex data transformations", () => {
  it("group by with reduce", () => {
    assertEquivalent(`
      function test() {
        var data = [
          {name: "Alice", dept: "eng"},
          {name: "Bob", dept: "sales"},
          {name: "Carol", dept: "eng"},
          {name: "Dave", dept: "sales"},
          {name: "Eve", dept: "eng"},
        ];
        var grouped = data.reduce(function(acc, item) {
          if (!acc[item.dept]) acc[item.dept] = [];
          acc[item.dept].push(item.name);
          return acc;
        }, {});
        return grouped.eng.length + "," + grouped.sales.length;
      }
      test();
    `);
  });

  it("deep object merge with conflict resolution", () => {
    assertEquivalent(`
      function test() {
        function deepMerge(target, source) {
          var keys = Object.keys(source);
          for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (typeof source[key] === "object" && source[key] !== null &&
                typeof target[key] === "object" && target[key] !== null &&
                !Array.isArray(source[key])) {
              deepMerge(target[key], source[key]);
            } else {
              target[key] = source[key];
            }
          }
          return target;
        }
        var a = {x: 1, nested: {a: 1, b: 2}, arr: [1, 2]};
        var b = {y: 2, nested: {b: 20, c: 30}, arr: [3, 4]};
        var result = deepMerge(a, b);
        return [result.x, result.y, result.nested.a, result.nested.b, result.nested.c, result.arr.join(",")];
      }
      test();
    `);
  });

  it("matrix operations", () => {
    assertEquivalent(`
      function test() {
        function matMul(a, b) {
          var rows = a.length, cols = b[0].length, inner = b.length;
          var result = [];
          for (var i = 0; i < rows; i++) {
            result[i] = [];
            for (var j = 0; j < cols; j++) {
              var sum = 0;
              for (var k = 0; k < inner; k++) {
                sum += a[i][k] * b[k][j];
              }
              result[i][j] = sum;
            }
          }
          return result;
        }
        var a = [[1, 2], [3, 4]];
        var b = [[5, 6], [7, 8]];
        var c = matMul(a, b);
        return [c[0][0], c[0][1], c[1][0], c[1][1]];
      }
      test();
    `);
  });
});

describe("stress: tricky scoping", () => {
  it("function declaration hoisting inside if block", () => {
    assertEquivalent(`
      function test() {
        var x = foo();
        function foo() { return 42; }
        return x;
      }
      test();
    `);
  });

  it("var in for-loop shared across closures", () => {
    assertEquivalent(`
      function test() {
        var fns = [];
        for (var i = 0; i < 5; i++) {
          (function(j) {
            fns.push(function() { return j; });
          })(i);
        }
        return fns.map(function(f) { return f(); });
      }
      test();
    `);
  });

  it("arguments object interaction with named params", () => {
    assertEquivalent(`
      function test() {
        function f(a, b) {
          var args = [];
          for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
          return args;
        }
        return f(1, 2, 3, 4, 5);
      }
      test();
    `);
  });

  it("closure over catch variable", () => {
    assertEquivalent(`
      function test() {
        var fns = [];
        for (var i = 0; i < 3; i++) {
          try {
            throw i * 10;
          } catch(e) {
            (function(captured) {
              fns.push(function() { return captured; });
            })(e);
          }
        }
        return fns.map(function(f) { return f(); });
      }
      test();
    `);
  });
});

describe("stress: complex string building", () => {
  it("template-like string building with expressions", () => {
    assertEquivalent(`
      function test() {
        function template(strings) {
          var values = [];
          for (var i = 1; i < arguments.length; i++) values.push(arguments[i]);
          var result = "";
          for (var i = 0; i < strings.length; i++) {
            result += strings[i];
            if (i < values.length) result += String(values[i]);
          }
          return result;
        }
        var name = "World";
        var count = 42;
        return template(["Hello, ", "! You have ", " messages."], name, count);
      }
      test();
    `);
  });

  it("recursive string processing", () => {
    assertEquivalent(`
      function test() {
        function camelToSnake(str) {
          var result = "";
          for (var i = 0; i < str.length; i++) {
            var c = str.charAt(i);
            if (c >= "A" && c <= "Z") {
              if (i > 0) result += "_";
              result += c.toLowerCase();
            } else {
              result += c;
            }
          }
          return result;
        }
        return [
          camelToSnake("helloWorld"),
          camelToSnake("camelCaseString"),
          camelToSnake("XMLParser"),
        ];
      }
      test();
    `);
  });
});

describe("stress: complex return value patterns", () => {
  it("function returning different types based on input", () => {
    assertEquivalent(`
      function test() {
        function parse(input) {
          if (input === "null") return null;
          if (input === "true") return true;
          if (input === "false") return false;
          var num = Number(input);
          if (!isNaN(num)) return num;
          if (input.charAt(0) === "[") return input.slice(1, -1).split(",");
          return input;
        }
        return [
          parse("42"),
          parse("null"),
          parse("true"),
          parse("false"),
          parse("hello"),
          parse("[a,b,c]"),
        ];
      }
      test();
    `);
  });

  it("early return in nested loops", () => {
    assertEquivalent(`
      function test() {
        function findPair(arr, target) {
          for (var i = 0; i < arr.length; i++) {
            for (var j = i + 1; j < arr.length; j++) {
              if (arr[i] + arr[j] === target) {
                return [i, j, arr[i], arr[j]];
              }
            }
          }
          return null;
        }
        return findPair([2, 7, 11, 15], 9);
      }
      test();
    `);
  });
});

describe("stress: interleaved closures and objects", () => {
  it("builder pattern with method chaining", () => {
    assertEquivalent(`
      function test() {
        function QueryBuilder() {
          var parts = {table: "", conditions: [], fields: "*", limit: null};
          return {
            from: function(t) { parts.table = t; return this; },
            select: function(f) { parts.fields = f; return this; },
            where: function(c) { parts.conditions.push(c); return this; },
            take: function(n) { parts.limit = n; return this; },
            build: function() {
              var q = "SELECT " + parts.fields + " FROM " + parts.table;
              if (parts.conditions.length > 0) {
                q += " WHERE " + parts.conditions.join(" AND ");
              }
              if (parts.limit !== null) {
                q += " LIMIT " + parts.limit;
              }
              return q;
            }
          };
        }
        return QueryBuilder()
          .from("users")
          .select("name, email")
          .where("age > 18")
          .where("active = true")
          .take(10)
          .build();
      }
      test();
    `);
  });

  it("middleware pipeline pattern", () => {
    assertEquivalent(`
      function test() {
        function createPipeline() {
          var middlewares = [];
          return {
            use: function(fn) { middlewares.push(fn); return this; },
            execute: function(input) {
              var result = input;
              for (var i = 0; i < middlewares.length; i++) {
                result = middlewares[i](result);
              }
              return result;
            }
          };
        }
        var pipeline = createPipeline()
          .use(function(s) { return s.trim(); })
          .use(function(s) { return s.toLowerCase(); })
          .use(function(s) { return s.split(" ").join("-"); })
          .use(function(s) { return s.replace(/[^a-z0-9-]/g, ""); });
        return pipeline.execute("  Hello World! 123  ");
      }
      test();
    `);
  });
});

describe("stress: edge case value handling", () => {
  it("sparse array operations", () => {
    assertEquivalent(`
      function test() {
        var arr = [1, , 3, , 5];
        var r1 = arr.length;
        var r2 = arr[1];
        var filtered = arr.filter(function(x) { return x !== undefined; });
        return [r1, r2, filtered.length, filtered.join(",")];
      }
      test();
    `);
  });

  it("property access on primitives via autoboxing", () => {
    assertEquivalent(`
      function test() {
        var s = "hello";
        var r1 = s.length;
        var r2 = s.toUpperCase();
        var r3 = (42).toString(16);
        var r4 = true.toString();
        return [r1, r2, r3, r4];
      }
      test();
    `);
  });

  it("complex truthiness checks", () => {
    assertEquivalent(`
      function test() {
        var values = [0, 1, -1, "", "0", null, undefined, NaN, Infinity, true, false, [], {}];
        return values.map(function(v) { return v ? "T" : "F"; }).join("");
      }
      test();
    `);
  });

  it("object with Symbol.toPrimitive-like behavior via valueOf", () => {
    assertEquivalent(`
      function test() {
        var obj = {
          valueOf: function() { return 42; },
          toString: function() { return "forty-two"; }
        };
        var r1 = obj + 0;
        var r2 = "" + obj;
        return [r1, r2];
      }
      test();
    `);
  });
});
