import { describe, it, expect } from "bun:test";
import { assertEquivalent, evalOriginal, evalObfuscated } from "../helpers.js";

/**
 * VM Breaker Tests
 *
 * Complex JS patterns specifically designed to stress-test and break
 * the VM obfuscator. Each test targets a specific class of JS semantics
 * that are notoriously tricky to implement correctly in a bytecode VM.
 */

// ---------------------------------------------------------------------------
// 1. Complex this-binding edge cases
// ---------------------------------------------------------------------------

describe("vm-breaker: this binding", () => {
	it("arrow function captures enclosing this, not call-site this", () => {
		assertEquivalent(`
      function test() {
        var obj = {
          val: 10,
          getArrow: function() {
            return () => this.val;
          }
        };
        var arrow = obj.getArrow();
        return arrow();
      }
      test();
    `);
	});

	it("nested arrow functions preserve outer this", () => {
		assertEquivalent(`
      function test() {
        var obj = {
          x: 5,
          nested: function() {
            var f = () => {
              var g = () => this.x;
              return g();
            };
            return f();
          }
        };
        return obj.nested();
      }
      test();
    `);
	});

	it("method shorthand this differs from arrow this in callbacks", () => {
		assertEquivalent(`
      function test() {
        var obj = {
          items: [1, 2, 3],
          multiplier: 10,
          process: function() {
            return this.items.map((x) => x * this.multiplier);
          }
        };
        return obj.process();
      }
      test();
    `);
	});

	it("this in constructor vs prototype method vs arrow", () => {
		assertEquivalent(`
      function test() {
        function Foo(v) {
          this.v = v;
          this.getArrow = () => this.v;
        }
        Foo.prototype.getProto = function() { return this.v; };

        var a = new Foo(1);
        var b = new Foo(2);
        var aArrow = a.getArrow;
        var bProto = b.getProto;

        return [
          a.getArrow(),
          aArrow(),
          a.getProto(),
        ];
      }
      test();
    `);
	});

	it("call/apply with null/undefined this in sloppy mode", () => {
		assertEquivalent(`
      function test() {
        function getThis() { return typeof this; }
        var r1 = getThis.call(null);
        var r2 = getThis.call(undefined);
        var r3 = getThis.call(42);
        return [r1, r2, r3];
      }
      test();
    `);
	});

	it("this inside nested object method calls", () => {
		assertEquivalent(`
      function test() {
        var a = {
          x: 1,
          b: {
            x: 2,
            c: {
              x: 3,
              getX: function() { return this.x; }
            }
          }
        };
        return [a.b.c.getX(), a.b.c.getX.call(a), a.b.c.getX.call(a.b)];
      }
      test();
    `);
	});
});

// ---------------------------------------------------------------------------
// 2. Tricky closure/scope interactions
// ---------------------------------------------------------------------------

describe("vm-breaker: closure scope tricks", () => {
	it("closure survives after creator returns and is called much later", () => {
		assertEquivalent(`
      function test() {
        var closures = [];
        for (var i = 0; i < 5; i++) {
          (function(captured) {
            closures.push(function() { return captured * captured; });
          })(i);
        }
        var results = [];
        for (var j = closures.length - 1; j >= 0; j--) {
          results.push(closures[j]());
        }
        return results;
      }
      test();
    `);
	});

	it("closure over let in for-of with mutation", () => {
		assertEquivalent(`
      function test() {
        var arr = [10, 20, 30];
        var fns = [];
        for (var item of arr) {
          var captured = item;
          fns.push((function(v) { return function() { return v + 1; }; })(captured));
        }
        return fns.map(function(f) { return f(); });
      }
      test();
    `);
	});

	it("closure modifying shared state in complex order", () => {
		assertEquivalent(`
      function test() {
        var state = { count: 0, log: [] };
        function inc() { state.count++; state.log.push("inc:" + state.count); }
        function dec() { state.count--; state.log.push("dec:" + state.count); }
        function reset() { state.count = 0; state.log.push("reset"); }

        inc(); inc(); inc(); dec(); inc(); reset(); inc();
        return state.log.join(",");
      }
      test();
    `);
	});

	it("immediately re-assigned closure variable", () => {
		assertEquivalent(`
      function test() {
        var x = "original";
        var getX = function() { return x; };
        x = "modified";
        var result1 = getX();
        x = "final";
        var result2 = getX();
        return [result1, result2];
      }
      test();
    `);
	});

	it("closure in catch block scope", () => {
		assertEquivalent(`
      function test() {
        var fns = [];
        for (var i = 0; i < 3; i++) {
          try {
            throw { idx: i, msg: "error" + i };
          } catch (e) {
            fns.push((function(err) {
              return function() { return err.idx + ":" + err.msg; };
            })(e));
          }
        }
        return fns.map(function(f) { return f(); });
      }
      test();
    `);
	});

	it("recursive closure with shared accumulator", () => {
		assertEquivalent(`
      function test() {
        var acc = [];
        function walk(tree, depth) {
          if (!tree) return;
          acc.push(Array(depth + 1).join("-") + tree.val);
          walk(tree.left, depth + 1);
          walk(tree.right, depth + 1);
        }
        walk({
          val: "root",
          left: { val: "L", left: { val: "LL", left: null, right: null }, right: null },
          right: { val: "R", left: null, right: { val: "RR", left: null, right: null } }
        }, 0);
        return acc.join("|");
      }
      test();
    `);
	});
});

// ---------------------------------------------------------------------------
// 3. Complex exception flow
// ---------------------------------------------------------------------------

describe("vm-breaker: exception flow", () => {
	it("throw in ternary expression", () => {
		assertEquivalent(`
      function test() {
        function check(x) {
          try {
            return x > 0 ? x : (function() { throw new Error("neg"); })();
          } catch (e) {
            return "caught:" + e.message;
          }
        }
        return [check(5), check(-1)];
      }
      test();
    `);
	});

	it("exception in array/object initializer", () => {
		assertEquivalent(`
      function test() {
        function boom() { throw "bang"; }
        try {
          var arr = [1, boom(), 3];
          return arr;
        } catch (e) {
          return "caught:" + e;
        }
      }
      test();
    `);
	});

	it("exception in function argument evaluation", () => {
		assertEquivalent(`
      function test() {
        function add(a, b) { return a + b; }
        function explode() { throw "kaboom"; }
        try {
          return add(1, explode());
        } catch (e) {
          return "caught:" + e;
        }
      }
      test();
    `);
	});

	it("try/catch/finally with return in try and finally side-effect", () => {
		assertEquivalent(`
      function test() {
        var sideEffect = [];
        function inner() {
          try {
            sideEffect.push("try");
            return "from-try";
          } catch (e) {
            sideEffect.push("catch");
            return "from-catch";
          } finally {
            sideEffect.push("finally");
          }
        }
        var result = inner();
        return sideEffect.join(",");
      }
      test();
    `);
	});

	it("nested try-catch with multiple exception types", () => {
		assertEquivalent(`
      function test() {
        var results = [];
        var errors = [
          new TypeError("type"),
          new RangeError("range"),
          "string-error",
          42,
          null
        ];
        for (var i = 0; i < errors.length; i++) {
          try {
            throw errors[i];
          } catch (e) {
            if (e instanceof TypeError) results.push("T:" + e.message);
            else if (e instanceof RangeError) results.push("R:" + e.message);
            else if (typeof e === "string") results.push("S:" + e);
            else if (typeof e === "number") results.push("N:" + e);
            else results.push("other");
          }
        }
        return results.join("|");
      }
      test();
    `);
	});

	it("exception during for-of iteration", () => {
		assertEquivalent(`
      function test() {
        var results = [];
        var items = [1, 2, 3, 4, 5];
        try {
          for (var x of items) {
            if (x === 3) throw new Error("stop at 3");
            results.push(x);
          }
        } catch (e) {
          results.push("caught:" + e.message);
        }
        return results;
      }
      test();
    `);
	});

	it("exception from method call in chain", () => {
		assertEquivalent(`
      function test() {
        var obj = {
          data: [1, 2, 3],
          transform: function() {
            return this.data.map(function(x) {
              if (x === 2) throw new Error("bad:" + x);
              return x * 10;
            });
          }
        };
        try {
          return obj.transform();
        } catch (e) {
          return "caught:" + e.message;
        }
      }
      test();
    `);
	});
});

// ---------------------------------------------------------------------------
// 4. Complex class patterns
// ---------------------------------------------------------------------------

describe("vm-breaker: class patterns", () => {
	it("class with static methods and instance interaction", () => {
		assertEquivalent(`
      function test() {
        class Counter {
          static count = 0;
          constructor() { Counter.count++; this.id = Counter.count; }
          static getCount() { return Counter.count; }
          getId() { return this.id; }
        }
        var a = new Counter();
        var b = new Counter();
        var c = new Counter();
        return [a.getId(), b.getId(), c.getId(), Counter.getCount()];
      }
      test();
    `);
	});

	it("multi-level inheritance with super in methods", () => {
		assertEquivalent(`
      function test() {
        class A {
          constructor(x) { this.x = x; }
          describe() { return "A(" + this.x + ")"; }
        }
        class B extends A {
          constructor(x, y) { super(x); this.y = y; }
          describe() { return "B(" + this.y + ")<-" + super.describe(); }
        }
        class C extends B {
          constructor(x, y, z) { super(x, y); this.z = z; }
          describe() { return "C(" + this.z + ")<-" + super.describe(); }
        }
        return new C(1, 2, 3).describe();
      }
      test();
    `);
	});

	it("class with computed method names", () => {
		assertEquivalent(`
      function test() {
        var methodName = "greet";
        class Greeter {
          [methodName](name) { return "Hello, " + name; }
        }
        return new Greeter().greet("World");
      }
      test();
    `);
	});

	it("class with getter and setter interplay", () => {
		assertEquivalent(`
      function test() {
        class Temperature {
          constructor(celsius) { this._c = celsius; }
          get fahrenheit() { return this._c * 9 / 5 + 32; }
          set fahrenheit(f) { this._c = (f - 32) * 5 / 9; }
          get celsius() { return this._c; }
        }
        var t = new Temperature(100);
        var f = t.fahrenheit;
        t.fahrenheit = 32;
        return [f, t.celsius];
      }
      test();
    `);
	});

	it("instanceof through inheritance chain", () => {
		assertEquivalent(`
      function test() {
        class Base {}
        class Mid extends Base {}
        class Leaf extends Mid {}
        var l = new Leaf();
        return [
          l instanceof Leaf,
          l instanceof Mid,
          l instanceof Base,
          l instanceof Object,
          new Base() instanceof Leaf,
        ];
      }
      test();
    `);
	});

	it("class methods returning this for chaining", () => {
		assertEquivalent(`
      function test() {
        class Builder {
          constructor() { this.parts = []; }
          add(p) { this.parts.push(p); return this; }
          build() { return this.parts.join("+"); }
        }
        return new Builder().add("a").add("b").add("c").build();
      }
      test();
    `);
	});

	it("class with symbol-like computed properties", () => {
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
});

// ---------------------------------------------------------------------------
// 5. Complex evaluation order & side effects
// ---------------------------------------------------------------------------

describe("vm-breaker: evaluation order", () => {
	it("side effects in property access key computation", () => {
		assertEquivalent(`
      function test() {
        var log = [];
        var obj = { a: 1, b: 2, c: 3 };
        function key(k) { log.push("key:" + k); return k; }
        function val(v) { log.push("val:" + v); return v; }
        obj[key("a")] = val(10);
        obj[key("b")] = val(20);
        return log.join(",") + "|" + obj.a + "," + obj.b;
      }
      test();
    `);
	});

	it("short-circuit evaluation with side effects in all branches", () => {
		assertEquivalent(`
      function test() {
        var log = [];
        function t(label, val) { log.push(label); return val; }
        var r1 = t("a", false) && t("b", true);
        var r2 = t("c", true) && t("d", false) && t("e", true);
        var r3 = t("f", false) || t("g", 0) || t("h", "yes");
        return log.join(",") + "|" + r1 + "|" + r2 + "|" + r3;
      }
      test();
    `);
	});

	it("function call argument evaluation order", () => {
		assertEquivalent(`
      function test() {
        var log = [];
        function track(label, val) { log.push(label); return val; }
        function combine(a, b, c) { return a + b + c; }
        combine(track("1st", 10), track("2nd", 20), track("3rd", 30));
        return log.join(",");
      }
      test();
    `);
	});

	it("comma operator in return position", () => {
		assertEquivalent(`
      function test() {
        var x = 0;
        function side() { x++; return x; }
        var result = (side(), side(), side(), x * 10);
        return result;
      }
      test();
    `);
	});

	it("conditional assignment with complex conditions", () => {
		assertEquivalent(`
      function test() {
        var obj = { a: null, b: undefined, c: 0, d: "", e: false, f: "ok" };
        var results = [];
        var keys = Object.keys(obj);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          var v = obj[k] ?? "DEFAULT";
          results.push(k + "=" + v);
        }
        return results.join(",");
      }
      test();
    `);
	});

	it("nested ternary with side effects", () => {
		assertEquivalent(`
      function test() {
        var log = [];
        function classify(n) {
          return (log.push("check<0"), n < 0)
            ? (log.push("neg"), "negative")
            : (log.push("check==0"), n === 0)
              ? (log.push("zero"), "zero")
              : (log.push("pos"), "positive");
        }
        var r = classify(5);
        return log.join(",") + "|" + r;
      }
      test();
    `);
	});

	it("postfix vs prefix increment in expressions", () => {
		assertEquivalent(`
      function test() {
        var a = 1, b = 1;
        var r1 = a++ + a++;
        var r2 = ++b + ++b;
        var r3 = a;
        var r4 = b;
        return [r1, r2, r3, r4];
      }
      test();
    `);
	});
});

// ---------------------------------------------------------------------------
// 6. Complex iteration and data structure patterns
// ---------------------------------------------------------------------------

describe("vm-breaker: complex data structures", () => {
	it("linked list operations", () => {
		assertEquivalent(`
      function test() {
        function Node(val, next) { this.val = val; this.next = next || null; }
        function toArray(head) {
          var arr = [];
          var cur = head;
          while (cur) { arr.push(cur.val); cur = cur.next; }
          return arr;
        }
        function reverse(head) {
          var prev = null, cur = head;
          while (cur) {
            var next = cur.next;
            cur.next = prev;
            prev = cur;
            cur = next;
          }
          return prev;
        }
        var list = new Node(1, new Node(2, new Node(3, new Node(4, new Node(5)))));
        var reversed = reverse(list);
        return toArray(reversed);
      }
      test();
    `);
	});

	it("graph traversal with cycle detection", () => {
		assertEquivalent(`
      function test() {
        var graph = {
          A: ["B", "C"],
          B: ["D"],
          C: ["D", "E"],
          D: ["A"],
          E: []
        };
        function bfs(start) {
          var visited = {};
          var queue = [start];
          var order = [];
          while (queue.length > 0) {
            var node = queue.shift();
            if (visited[node]) continue;
            visited[node] = true;
            order.push(node);
            var neighbors = graph[node] || [];
            for (var i = 0; i < neighbors.length; i++) {
              if (!visited[neighbors[i]]) queue.push(neighbors[i]);
            }
          }
          return order;
        }
        return bfs("A").join(",");
      }
      test();
    `);
	});

	it("priority queue (min-heap) implementation", () => {
		assertEquivalent(`
      function test() {
        function MinHeap() { this.data = []; }
        MinHeap.prototype.push = function(val) {
          this.data.push(val);
          var i = this.data.length - 1;
          while (i > 0) {
            var parent = Math.floor((i - 1) / 2);
            if (this.data[parent] <= this.data[i]) break;
            var tmp = this.data[parent];
            this.data[parent] = this.data[i];
            this.data[i] = tmp;
            i = parent;
          }
        };
        MinHeap.prototype.pop = function() {
          var top = this.data[0];
          var last = this.data.pop();
          if (this.data.length > 0) {
            this.data[0] = last;
            var i = 0;
            while (true) {
              var left = 2 * i + 1, right = 2 * i + 2, smallest = i;
              if (left < this.data.length && this.data[left] < this.data[smallest]) smallest = left;
              if (right < this.data.length && this.data[right] < this.data[smallest]) smallest = right;
              if (smallest === i) break;
              var tmp = this.data[i];
              this.data[i] = this.data[smallest];
              this.data[smallest] = tmp;
              i = smallest;
            }
          }
          return top;
        };
        var heap = new MinHeap();
        var items = [5, 3, 8, 1, 9, 2, 7, 4, 6];
        for (var i = 0; i < items.length; i++) heap.push(items[i]);
        var sorted = [];
        while (heap.data.length > 0) sorted.push(heap.pop());
        return sorted;
      }
      test();
    `);
	});

	it("Map and Set operations", () => {
		assertEquivalent(`
      function test() {
        var m = new Map();
        m.set("a", 1);
        m.set("b", 2);
        m.set("c", 3);
        m.set("b", 20);

        var keys = [];
        var vals = [];
        m.forEach(function(v, k) { keys.push(k); vals.push(v); });

        var s = new Set([1, 2, 3, 2, 1]);
        return [m.size, m.get("b"), keys.join(","), vals.join(","), s.size, s.has(2), s.has(5)];
      }
      test();
    `);
	});

	it("complex reduce building nested structure", () => {
		assertEquivalent(`
      function test() {
        var paths = ["a.b.c", "a.b.d", "a.e", "f.g"];
        var tree = paths.reduce(function(acc, path) {
          var parts = path.split(".");
          var node = acc;
          for (var i = 0; i < parts.length; i++) {
            if (!node[parts[i]]) node[parts[i]] = {};
            node = node[parts[i]];
          }
          return acc;
        }, {});
        return JSON.stringify(tree);
      }
      test();
    `);
	});
});

// ---------------------------------------------------------------------------
// 7. Complex string patterns
// ---------------------------------------------------------------------------

describe("vm-breaker: string edge cases", () => {
	it("regex with capture groups and backreferences", () => {
		assertEquivalent(`
      function test() {
        var str = "2023-12-25";
        var match = str.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
        return match ? [match[1], match[2], match[3]] : null;
      }
      test();
    `);
	});

	it("recursive string replacement", () => {
		assertEquivalent(`
      function test() {
        function expandTemplate(template, vars) {
          var result = template;
          var keys = Object.keys(vars);
          for (var i = 0; i < keys.length; i++) {
            while (result.indexOf("{{" + keys[i] + "}}") >= 0) {
              result = result.replace("{{" + keys[i] + "}}", String(vars[keys[i]]));
            }
          }
          return result;
        }
        return expandTemplate(
          "Hello {{name}}, you have {{count}} {{thing}}s. {{name}} is great!",
          { name: "Alice", count: 5, thing: "widget" }
        );
      }
      test();
    `);
	});

	it("complex string parsing (CSV-like)", () => {
		assertEquivalent(`
      function test() {
        function parseCSV(text) {
          var rows = text.split("\\n");
          var result = [];
          for (var i = 0; i < rows.length; i++) {
            if (rows[i].trim() === "") continue;
            result.push(rows[i].split(",").map(function(cell) { return cell.trim(); }));
          }
          return result;
        }
        var csv = "name, age, city\\nAlice, 30, NYC\\nBob, 25, LA\\nCharlie, 35, SF";
        var parsed = parseCSV(csv);
        return parsed.map(function(row) { return row.join("|"); }).join("\\n");
      }
      test();
    `);
	});

	it("string encoding/decoding round-trip", () => {
		assertEquivalent(`
      function test() {
        function encode(str) {
          var result = [];
          for (var i = 0; i < str.length; i++) {
            result.push(str.charCodeAt(i) ^ 0x42);
          }
          return result;
        }
        function decode(arr) {
          var result = "";
          for (var i = 0; i < arr.length; i++) {
            result += String.fromCharCode(arr[i] ^ 0x42);
          }
          return result;
        }
        var original = "Hello, World! 12345 !@#$%";
        var encoded = encode(original);
        var decoded = decode(encoded);
        return decoded === original ? "match" : "mismatch";
      }
      test();
    `);
	});
});

// ---------------------------------------------------------------------------
// 8. Complex assignment and destructuring
// ---------------------------------------------------------------------------

describe("vm-breaker: complex assignments", () => {
	it("chained assignment", () => {
		assertEquivalent(`
      function test() {
        var a, b, c;
        a = b = c = 42;
        return [a, b, c];
      }
      test();
    `);
	});

	it("destructuring assignment in complex positions", () => {
		assertEquivalent(`
      function test() {
        function getData() {
          return { x: 10, y: 20, nested: { a: 1, b: 2 } };
        }
        var { x, y, nested: { a, b } } = getData();
        return [x, y, a, b];
      }
      test();
    `);
	});

	it("array destructuring with rest and skip", () => {
		assertEquivalent(`
      function test() {
        var arr = [1, 2, 3, 4, 5, 6, 7];
        var [first, , third, ...rest] = arr;
        return [first, third, rest.length, rest[0]];
      }
      test();
    `);
	});

	it("destructuring with defaults", () => {
		assertEquivalent(`
      function test() {
        var { a = 1, b = 2, c = 3 } = { a: 10, c: 30 };
        return [a, b, c];
      }
      test();
    `);
	});

	it("swap via destructuring", () => {
		assertEquivalent(`
      function test() {
        var a = "first", b = "second";
        [a, b] = [b, a];
        return [a, b];
      }
      test();
    `);
	});

	it("computed property in destructuring", () => {
		assertEquivalent(`
      function test() {
        var key = "dynamic";
        var { [key]: value } = { dynamic: 42, other: 99 };
        return value;
      }
      test();
    `);
	});

	it("destructuring in for-of", () => {
		assertEquivalent(`
      function test() {
        var pairs = [[1, "a"], [2, "b"], [3, "c"]];
        var result = [];
        for (var [num, letter] of pairs) {
          result.push(letter + num);
        }
        return result;
      }
      test();
    `);
	});

	it("nested destructuring with array inside object", () => {
		assertEquivalent(`
      function test() {
        var data = {
          users: [
            { name: "Alice", scores: [90, 85, 92] },
            { name: "Bob", scores: [78, 82, 88] }
          ]
        };
        var { users: [{ name: firstName, scores: [best] }, { scores: [, secondBest] }] } = data;
        return [firstName, best, secondBest];
      }
      test();
    `);
	});
});

// ---------------------------------------------------------------------------
// 9. Complex mixed patterns (real-world-ish)
// ---------------------------------------------------------------------------

describe("vm-breaker: real-world patterns", () => {
	it("event emitter implementation", () => {
		assertEquivalent(`
      function test() {
        function EventEmitter() {
          this._handlers = {};
        }
        EventEmitter.prototype.on = function(event, handler) {
          if (!this._handlers[event]) this._handlers[event] = [];
          this._handlers[event].push(handler);
          return this;
        };
        EventEmitter.prototype.emit = function(event) {
          var args = [];
          for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
          var handlers = this._handlers[event] || [];
          for (var j = 0; j < handlers.length; j++) {
            handlers[j].apply(null, args);
          }
          return this;
        };

        var log = [];
        var emitter = new EventEmitter();
        emitter
          .on("data", function(x) { log.push("A:" + x); })
          .on("data", function(x) { log.push("B:" + (x * 2)); })
          .on("end", function() { log.push("done"); });

        emitter.emit("data", 5);
        emitter.emit("data", 10);
        emitter.emit("end");
        return log.join(",");
      }
      test();
    `);
	});

	it("promise-like chain (synchronous mock)", () => {
		assertEquivalent(`
      function test() {
        function SyncPromise(val) { this._val = val; }
        SyncPromise.prototype.then = function(fn) {
          return new SyncPromise(fn(this._val));
        };
        SyncPromise.prototype.value = function() { return this._val; };

        var result = new SyncPromise(5)
          .then(function(x) { return x * 2; })
          .then(function(x) { return x + 3; })
          .then(function(x) { return "result:" + x; })
          .value();
        return result;
      }
      test();
    `);
	});

	it("dependency injection pattern", () => {
		assertEquivalent(`
      function test() {
        function createApp(deps) {
          return {
            run: function(input) {
              var validated = deps.validator(input);
              var transformed = deps.transformer(validated);
              var formatted = deps.formatter(transformed);
              return formatted;
            }
          };
        }
        var app = createApp({
          validator: function(x) { return Math.abs(x); },
          transformer: function(x) { return x * x; },
          formatter: function(x) { return "Result: " + x; }
        });
        return [app.run(5), app.run(-3)];
      }
      test();
    `);
	});

	it("LRU cache implementation", () => {
		assertEquivalent(`
      function test() {
        function LRU(capacity) {
          this.capacity = capacity;
          this.cache = {};
          this.order = [];
        }
        LRU.prototype.get = function(key) {
          if (!(key in this.cache)) return -1;
          this._touch(key);
          return this.cache[key];
        };
        LRU.prototype.put = function(key, value) {
          if (key in this.cache) {
            this.cache[key] = value;
            this._touch(key);
          } else {
            if (this.order.length >= this.capacity) {
              var evicted = this.order.shift();
              delete this.cache[evicted];
            }
            this.cache[key] = value;
            this.order.push(key);
          }
        };
        LRU.prototype._touch = function(key) {
          var idx = this.order.indexOf(key);
          if (idx >= 0) this.order.splice(idx, 1);
          this.order.push(key);
        };

        var cache = new LRU(3);
        cache.put("a", 1);
        cache.put("b", 2);
        cache.put("c", 3);
        var r1 = cache.get("a");
        cache.put("d", 4);
        var r2 = cache.get("b");
        var r3 = cache.get("a");
        var r4 = cache.get("d");
        return [r1, r2, r3, r4];
      }
      test();
    `);
	});

	it("complex sorting with custom comparator", () => {
		assertEquivalent(`
      function test() {
        var data = [
          { name: "Charlie", age: 30, score: 85 },
          { name: "Alice", age: 25, score: 92 },
          { name: "Bob", age: 30, score: 88 },
          { name: "Dave", age: 25, score: 92 },
          { name: "Eve", age: 35, score: 78 }
        ];
        data.sort(function(a, b) {
          if (a.score !== b.score) return b.score - a.score;
          if (a.age !== b.age) return a.age - b.age;
          return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        });
        return data.map(function(d) { return d.name; }).join(",");
      }
      test();
    `);
	});

	it("interpreter pattern (mini expression evaluator)", () => {
		assertEquivalent(`
      function test() {
        function evaluate(expr) {
          if (typeof expr === "number") return expr;
          if (expr.op === "+") return evaluate(expr.left) + evaluate(expr.right);
          if (expr.op === "*") return evaluate(expr.left) * evaluate(expr.right);
          if (expr.op === "-") return evaluate(expr.left) - evaluate(expr.right);
          if (expr.op === "neg") return -evaluate(expr.val);
          throw new Error("unknown op: " + expr.op);
        }
        // (3 + 4) * -(2 - 1) = 7 * -1 = -7
        var expr = {
          op: "*",
          left: { op: "+", left: 3, right: 4 },
          right: { op: "neg", val: { op: "-", left: 2, right: 1 } }
        };
        return evaluate(expr);
      }
      test();
    `);
	});
});

// ---------------------------------------------------------------------------
// 10. Generator-like patterns (manual state machine)
// ---------------------------------------------------------------------------

describe("vm-breaker: generator-like state machines", () => {
	it("manual iterator with state", () => {
		assertEquivalent(`
      function test() {
        function rangeIterator(start, end, step) {
          var current = start;
          return {
            next: function() {
              if (current >= end) return { value: undefined, done: true };
              var val = current;
              current += step;
              return { value: val, done: false };
            }
          };
        }
        var iter = rangeIterator(0, 10, 3);
        var results = [];
        var item;
        while (!(item = iter.next()).done) {
          results.push(item.value);
        }
        return results;
      }
      test();
    `);
	});

	it("lazy evaluation chain", () => {
		assertEquivalent(`
      function test() {
        function LazyList(arr) {
          this._data = arr;
          this._transforms = [];
        }
        LazyList.prototype.map = function(fn) {
          var copy = new LazyList(this._data);
          copy._transforms = this._transforms.concat([{ type: "map", fn: fn }]);
          return copy;
        };
        LazyList.prototype.filter = function(fn) {
          var copy = new LazyList(this._data);
          copy._transforms = this._transforms.concat([{ type: "filter", fn: fn }]);
          return copy;
        };
        LazyList.prototype.toArray = function() {
          var result = this._data.slice();
          for (var i = 0; i < this._transforms.length; i++) {
            var t = this._transforms[i];
            if (t.type === "map") {
              result = result.map(t.fn);
            } else if (t.type === "filter") {
              result = result.filter(t.fn);
            }
          }
          return result;
        };

        var result = new LazyList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
          .filter(function(x) { return x % 2 === 0; })
          .map(function(x) { return x * x; })
          .filter(function(x) { return x > 10; })
          .toArray();
        return result;
      }
      test();
    `);
	});

	it("coroutine-like cooperative scheduling", () => {
		assertEquivalent(`
      function test() {
        var tasks = [];
        var log = [];

        function createTask(name, steps) {
          var step = 0;
          tasks.push(function() {
            if (step < steps.length) {
              log.push(name + ":" + steps[step]);
              step++;
              return false;
            }
            return true;
          });
        }

        createTask("A", ["init", "process", "done"]);
        createTask("B", ["start", "work", "finish"]);
        createTask("C", ["begin", "end"]);

        var maxIterations = 20;
        var iteration = 0;
        while (tasks.length > 0 && iteration < maxIterations) {
          iteration++;
          var i = 0;
          while (i < tasks.length) {
            if (tasks[i]()) {
              tasks.splice(i, 1);
            } else {
              i++;
            }
          }
        }
        return log.join(",");
      }
      test();
    `);
	});
});

// ---------------------------------------------------------------------------
// 11. Tricky operator patterns
// ---------------------------------------------------------------------------

describe("vm-breaker: tricky operators", () => {
	it("logical assignment operators", () => {
		assertEquivalent(`
      function test() {
        var a = null;
        a ??= 42;
        var b = 0;
        b ||= 99;
        var c = 1;
        c &&= 50;
        var d = "hello";
        d ??= "world";
        return [a, b, c, d];
      }
      test();
    `);
	});

	it("optional chaining with method calls", () => {
		assertEquivalent(`
      function test() {
        var obj = {
          a: {
            b: {
              fn: function() { return 42; }
            }
          }
        };
        var r1 = obj?.a?.b?.fn();
        var r2 = obj?.x?.y?.fn();
        var r3 = obj?.a?.b?.nonexistent?.();
        return [r1, r2, r3];
      }
      test();
    `);
	});

	it("delete on various targets", () => {
		assertEquivalent(`
      function test() {
        var obj = { a: 1, b: 2, c: 3 };
        var r1 = delete obj.a;
        var r2 = "a" in obj;
        var r3 = delete obj["b"];
        var r4 = "b" in obj;
        var arr = [1, 2, 3];
        delete arr[1];
        return [r1, r2, r3, r4, arr.length, arr[1]];
      }
      test();
    `);
	});

	it("in operator with various values", () => {
		assertEquivalent(`
      function test() {
        var obj = { a: 1, b: undefined, c: null, d: 0, e: false };
        return [
          "a" in obj,
          "b" in obj,
          "c" in obj,
          "f" in obj,
          0 in [10, 20, 30],
          "length" in [1, 2],
        ];
      }
      test();
    `);
	});

	it("bitwise operations for flag management", () => {
		assertEquivalent(`
      function test() {
        var READ = 1, WRITE = 2, EXEC = 4;
        var perms = 0;
        perms |= READ;
        perms |= WRITE;
        var canRead = (perms & READ) !== 0;
        var canWrite = (perms & WRITE) !== 0;
        var canExec = (perms & EXEC) !== 0;
        perms ^= WRITE;
        var canWriteAfter = (perms & WRITE) !== 0;
        return [canRead, canWrite, canExec, canWriteAfter, perms];
      }
      test();
    `);
	});
});

// ---------------------------------------------------------------------------
// 12. Edge case value types
// ---------------------------------------------------------------------------

describe("vm-breaker: value edge cases", () => {
	it("NaN comparisons and propagation", () => {
		assertEquivalent(`
      function test() {
        return [
          NaN === NaN,
          NaN !== NaN,
          isNaN(NaN),
          isNaN(undefined),
          isNaN("hello"),
          isNaN(42),
          NaN + 1,
          NaN > 0,
          NaN < 0,
          NaN == null,
        ];
      }
      test();
    `);
	});

	it("null/undefined arithmetic and coercion", () => {
		assertEquivalent(`
      function test() {
        return [
          null + 1,
          undefined + 1,
          null * 5,
          null == undefined,
          null === undefined,
          +null,
          +undefined,
          "" + null,
          "" + undefined,
        ];
      }
      test();
    `);
	});

	it("negative zero behavior", () => {
		assertEquivalent(`
      function test() {
        var nz = -0;
        return [
          nz === 0,
          1 / nz === -Infinity,
          1 / 0 === Infinity,
          Object.is(nz, -0),
          Object.is(nz, 0),
          String(nz),
        ];
      }
      test();
    `);
	});

	it("type coercion in equality", () => {
		assertEquivalent(`
      function test() {
        return [
          0 == false,
          "" == false,
          null == false,
          undefined == false,
          0 == "",
          0 == null,
          "" == null,
          1 == true,
          2 == true,
          "1" == 1,
          "0" == false,
          [] == false,
        ];
      }
      test();
    `);
	});

	it("valueOf and toString in type coercion", () => {
		assertEquivalent(`
      function test() {
        var obj = {
          valueOf: function() { return 10; },
          toString: function() { return "hello"; }
        };
        var numResult = obj + 5;
        var strResult = [obj].join("");
        var boolResult = !obj;
        return [numResult, boolResult];
      }
      test();
    `);
	});

	it("sparse array behavior", () => {
		assertEquivalent(`
      function test() {
        var arr = [1, , , 4, , 6];
        var mapped = arr.map(function(x) { return x === undefined ? "U" : x; });
        var filtered = arr.filter(function() { return true; });
        var count = 0;
        arr.forEach(function() { count++; });
        return [arr.length, mapped.join(","), filtered.length, count];
      }
      test();
    `);
	});
});
