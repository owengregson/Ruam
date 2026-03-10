import { describe, it } from "vitest";
import { assertEquivalent } from "../helpers.js";

describe("comprehensive advanced patterns", () => {
	// ── 1. Type coercion edge cases ──────────────────────────────────

	it("type coercion: {} + []", () => {
		assertEquivalent(`
      (function() {
        var a = {} + [];
        return String(a);
      })();
    `);
	});

	it("type coercion: [] + {}", () => {
		assertEquivalent(`
      (function() {
        var a = [] + {};
        return String(a);
      })();
    `);
	});

	it("type coercion: null == undefined", () => {
		assertEquivalent(`
      (function() {
        return [null == undefined, null === undefined, undefined == null];
      })();
    `);
	});

	it("type coercion: NaN !== NaN", () => {
		assertEquivalent(`
      (function() {
        return [NaN === NaN, NaN !== NaN, NaN == NaN, NaN != NaN];
      })();
    `);
	});

	it("type coercion: [] == false and [] == 0", () => {
		assertEquivalent(`
      (function() {
        return [[] == false, [] == 0, "" == false, "" == 0, "0" == false];
      })();
    `);
	});

	// ── 2. Comparison operators with mixed types ─────────────────────

	it("comparison: == and === with mixed types", () => {
		assertEquivalent(`
      (function() {
        return [
          1 == "1", 1 === "1",
          0 == "", 0 === "",
          0 == false, 0 === false,
          1 == true, 1 === true,
          null == 0, null == false, null == ""
        ];
      })();
    `);
	});

	it("comparison: <, >, <=, >= with mixed types", () => {
		assertEquivalent(`
      (function() {
        return [
          "10" > 9, "10" < 9,
          "abc" > "abd", "abc" < "abd",
          null > 0, null < 1, null >= 0, null <= 0,
          undefined > 0, undefined < 0, undefined >= 0, undefined <= 0
        ];
      })();
    `);
	});

	it("comparison: != and !== with mixed types", () => {
		assertEquivalent(`
      (function() {
        return [
          1 != "1", 1 !== "1",
          null != undefined, null !== undefined,
          0 != false, 0 !== false
        ];
      })();
    `);
	});

	// ── 3. typeof with all types ─────────────────────────────────────

	it("typeof: number, string, boolean", () => {
		assertEquivalent(`
      (function() {
        return [typeof 42, typeof "hello", typeof true];
      })();
    `);
	});

	it("typeof: undefined, object, function", () => {
		assertEquivalent(`
      (function() {
        return [typeof undefined, typeof null, typeof {}, typeof [], typeof function(){}];
      })();
    `);
	});

	it("typeof: NaN and Infinity", () => {
		assertEquivalent(`
      (function() {
        return [typeof NaN, typeof Infinity, typeof -Infinity];
      })();
    `);
	});

	// ── 4. void operator ─────────────────────────────────────────────

	it("void operator: various expressions", () => {
		assertEquivalent(`
      (function() {
        return [void 0, void "hello", void (1 + 2), void 0 === undefined];
      })();
    `);
	});

	it("void operator: in conditional", () => {
		assertEquivalent(`
      (function() {
        var x = void 0;
        return x === undefined ? "yes" : "no";
      })();
    `);
	});

	// ── 5. delete operator ───────────────────────────────────────────

	it("delete: removes property and returns true", () => {
		assertEquivalent(`
      (function() {
        var obj = {a: 1, b: 2, c: 3};
        var r1 = delete obj.b;
        return [r1, "b" in obj, obj.b, Object.keys(obj)];
      })();
    `);
	});

	it("delete: nested property and non-existent property", () => {
		assertEquivalent(`
      (function() {
        var obj = {x: {y: {z: 42}}};
        delete obj.x.y.z;
        var r = delete obj.nonexistent;
        return [r, JSON.stringify(obj)];
      })();
    `);
	});

	// ── 6. in operator ───────────────────────────────────────────────

	it("in operator: with objects and inherited properties", () => {
		assertEquivalent(`
      (function() {
        var obj = {a: 1, b: undefined};
        return ["a" in obj, "b" in obj, "c" in obj, "toString" in obj];
      })();
    `);
	});

	it("in operator: with arrays (index check)", () => {
		assertEquivalent(`
      (function() {
        var arr = [10, 20, 30];
        return [0 in arr, 1 in arr, 5 in arr, "length" in arr];
      })();
    `);
	});

	// ── 7. instanceof with custom constructors ───────────────────────

	it("instanceof: custom constructor function", () => {
		assertEquivalent(`
      (function() {
        function Foo() { this.x = 1; }
        function Bar() { this.y = 2; }
        var f = new Foo();
        return [f instanceof Foo, f instanceof Bar, f instanceof Object];
      })();
    `);
	});

	it("instanceof: prototype chain", () => {
		assertEquivalent(`
      (function() {
        function Animal(name) { this.name = name; }
        function Dog(name) { Animal.call(this, name); }
        Dog.prototype = Object.create(Animal.prototype);
        Dog.prototype.constructor = Dog;
        var d = new Dog("Rex");
        return [d instanceof Dog, d instanceof Animal, d instanceof Object, d.name];
      })();
    `);
	});

	// ── 8. Comma operator ────────────────────────────────────────────

	it("comma operator: evaluates all, returns last", () => {
		assertEquivalent(`
      (function() {
        var x = 0;
        var r = (x += 1, x += 10, x += 100, x);
        return [r, x];
      })();
    `);
	});

	it("comma operator: in for loop", () => {
		assertEquivalent(`
      (function() {
        var result = [];
        for (var i = 0, j = 10; i < 5; i++, j--) {
          result.push(i + j);
        }
        return result;
      })();
    `);
	});

	// ── 9. Logical assignment operators ──────────────────────────────

	it("logical OR assignment: ||=", () => {
		assertEquivalent(`
      (function() {
        var a = 0;
        var b = 5;
        var c = null;
        a ||= 10;
        b ||= 20;
        c ||= 30;
        return [a, b, c];
      })();
    `);
	});

	it("logical AND assignment: &&=", () => {
		assertEquivalent(`
      (function() {
        var a = 0;
        var b = 5;
        a &&= 10;
        b &&= 20;
        return [a, b];
      })();
    `);
	});

	it("nullish coalescing assignment: ??=", () => {
		assertEquivalent(`
      (function() {
        var a = null;
        var b = undefined;
        var c = 0;
        var d = "";
        a ??= 10;
        b ??= 20;
        c ??= 30;
        d ??= "hello";
        return [a, b, c, d];
      })();
    `);
	});

	// ── 10. Property accessors: computed properties ──────────────────

	it("computed property access with expressions", () => {
		assertEquivalent(`
      (function() {
        var obj = {a: 1, b: 2, c: 3};
        var key = "b";
        var prefix = "a";
        return [obj[key], obj[prefix], obj["c"], obj["a" + ""]];
      })();
    `);
	});

	it("computed property names in object literal", () => {
		assertEquivalent(`
      (function() {
        var k1 = "x";
        var k2 = "y";
        var obj = {};
        obj[k1] = 10;
        obj[k2] = 20;
        obj[k1 + k2] = 30;
        return obj;
      })();
    `);
	});

	// ── 11. Complex nested data structures ───────────────────────────

	it("objects in arrays in objects", () => {
		assertEquivalent(`
      (function() {
        var data = {
          users: [
            {name: "Alice", scores: [90, 85, 92]},
            {name: "Bob", scores: [78, 88, 95]}
          ],
          meta: {count: 2, active: true}
        };
        return [data.users[0].name, data.users[1].scores[2], data.meta.count];
      })();
    `);
	});

	it("deeply nested access and mutation", () => {
		assertEquivalent(`
      (function() {
        var root = {a: {b: {c: {d: {e: 42}}}}};
        root.a.b.c.d.e = 99;
        root.a.b.x = [1, [2, [3]]];
        return [root.a.b.c.d.e, root.a.b.x[1][1][0]];
      })();
    `);
	});

	// ── 12. Self-referencing objects ──────────────────────────────────

	it("self-referencing object via post-creation assignment", () => {
		assertEquivalent(`
      (function() {
        var obj = {name: "root", children: []};
        var child = {name: "child", parent: obj};
        obj.children.push(child);
        return [obj.children[0].parent.name, child.parent.children[0].name];
      })();
    `);
	});

	// ── 13. Method chaining patterns ─────────────────────────────────

	it("method chaining: array methods", () => {
		assertEquivalent(`
      (function() {
        return [5, 3, 8, 1, 9, 2, 7]
          .filter(function(x) { return x > 3; })
          .map(function(x) { return x * 2; })
          .sort(function(a, b) { return a - b; })
          .slice(0, 3);
      })();
    `);
	});

	it("method chaining: string methods", () => {
		assertEquivalent(`
      (function() {
        return "  Hello, World!  ".trim().toLowerCase().split(" ").join("-");
      })();
    `);
	});

	// ── 14. Immediately invoked with arguments ───────────────────────

	it("IIFE with arguments", () => {
		assertEquivalent(`
      (function(a, b, c) {
        return a + b + c;
      })(10, 20, 30);
    `);
	});

	it("IIFE with closure over passed values", () => {
		assertEquivalent(`
      (function(multiplier) {
        var fn = function(x) { return x * multiplier; };
        return [fn(1), fn(2), fn(3)];
      })(5);
    `);
	});

	// ── 15. Variable hoisting ────────────────────────────────────────

	it("var hoisting: used before assignment", () => {
		assertEquivalent(`
      (function() {
        var before = x;
        var x = 10;
        var after = x;
        return [before, after];
      })();
    `);
	});

	it("var hoisting: in conditional block", () => {
		assertEquivalent(`
      (function() {
        var result = typeof y;
        if (true) {
          var y = 42;
        }
        return [result, y];
      })();
    `);
	});

	// ── 16. Function hoisting ────────────────────────────────────────

	it("function declaration hoisting: call before definition", () => {
		assertEquivalent(`
      (function() {
        var r = hoisted(5);
        function hoisted(n) { return n * n; }
        return r;
      })();
    `);
	});

	it("function hoisting: mutual references", () => {
		assertEquivalent(`
      (function() {
        function isEven(n) { return n === 0 ? true : isOdd(n - 1); }
        function isOdd(n) { return n === 0 ? false : isEven(n - 1); }
        return [isEven(4), isOdd(5), isEven(3), isOdd(2)];
      })();
    `);
	});

	// ── 17. Multiple var declarations ────────────────────────────────

	it("multiple var declarations in one statement", () => {
		assertEquivalent(`
      (function() {
        var a = 1, b = 2, c = a + b, d = c * 2;
        return [a, b, c, d];
      })();
    `);
	});

	it("multiple var declarations with mixed initialization", () => {
		assertEquivalent(`
      (function() {
        var x, y = 10, z;
        x = 5;
        z = x + y;
        return [x, y, z];
      })();
    `);
	});

	// ── 18. Complex ternary expressions ──────────────────────────────

	it("nested ternary: a ? b ? c : d : e ? f : g", () => {
		assertEquivalent(`
      (function() {
        function classify(x) {
          return x > 0 ? x > 100 ? "big" : "small" : x === 0 ? "zero" : "negative";
        }
        return [classify(200), classify(50), classify(0), classify(-5)];
      })();
    `);
	});

	it("ternary as function argument", () => {
		assertEquivalent(`
      (function() {
        function pick(flag) {
          return [].concat(flag ? [1, 2] : [3, 4]);
        }
        return [pick(true), pick(false)];
      })();
    `);
	});

	// ── 19. Short-circuit side effects ───────────────────────────────

	it("short-circuit AND/OR with side effects", () => {
		assertEquivalent(`
      (function() {
        var log = [];
        function track(val) { log.push(val); return val; }
        var r1 = track(false) && track("never");
        var r2 = track(true) || track("never");
        var r3 = track(0) || track("fallback");
        return [r1, r2, r3, log];
      })();
    `);
	});

	it("short-circuit evaluation order", () => {
		assertEquivalent(`
      (function() {
        var x = 0;
        false && (x = 1);
        var a = x;
        true || (x = 2);
        var b = x;
        true && (x = 3);
        var c = x;
        return [a, b, c];
      })();
    `);
	});

	// ── 20. Strict vs loose equality edge cases ──────────────────────

	it("strict vs loose equality: all the tricky ones", () => {
		assertEquivalent(`
      (function() {
        return [
          "" == false,  "" === false,
          "0" == false, "0" === false,
          0 == "",      0 === "",
          0 == "0",     0 === "0",
          false == "0", false === "0",
          false == "",  false === "",
          null == undefined, null === undefined,
          NaN == NaN,   NaN === NaN
        ];
      })();
    `);
	});

	// ── 21. String/number comparison edge cases ──────────────────────

	it("string and number comparison", () => {
		assertEquivalent(`
      (function() {
        return [
          "9" < "10",
          9 < 10,
          "9" < 10,
          "09" == 9,
          "0xff" == 255,
          " " == 0,
          "\\t" == 0
        ];
      })();
    `);
	});

	it("string numeric sort vs numeric sort", () => {
		assertEquivalent(`
      (function() {
        var arr = [10, 9, 1, 100, 2, 20];
        var strSort = arr.slice().sort();
        var numSort = arr.slice().sort(function(a, b) { return a - b; });
        return [strSort, numSort];
      })();
    `);
	});

	// ── 22. Boolean conversion: !! and Boolean() ────────────────────

	it("double-bang boolean conversion", () => {
		assertEquivalent(`
      (function() {
        return [
          !!0, !!1, !!"", !!"hello",
          !!null, !!undefined, !!NaN,
          !!{}, !![], !!false, !!true
        ];
      })();
    `);
	});

	it("Boolean() constructor vs !!", () => {
		assertEquivalent(`
      (function() {
        var vals = [0, 1, -1, "", "0", null, undefined, NaN, {}, [], false, true];
        return vals.map(function(v) { return Boolean(v); });
      })();
    `);
	});

	// ── 23. Numeric string operations ────────────────────────────────

	it("numeric string arithmetic", () => {
		assertEquivalent(`
      (function() {
        return [
          "5" * 2,
          "10" - 5,
          "6" / 2,
          "7" % 3,
          "3" * "4",
          "abc" * 2,
          "5" + 2,
          5 + "2"
        ];
      })();
    `);
	});

	it("unary plus and Number() on strings", () => {
		assertEquivalent(`
      (function() {
        return [
          +"42", +"", +" ", +"abc", +"0xff",
          Number("42"), Number(""), Number(" "), Number("abc")
        ];
      })();
    `);
	});

	// ── 24. Array-like operations on strings ─────────────────────────

	it("string indexing and length", () => {
		assertEquivalent(`
      (function() {
        var s = "hello";
        return [s[0], s[4], s.length, s[100]];
      })();
    `);
	});

	it("string iteration via index", () => {
		assertEquivalent(`
      (function() {
        var s = "abcde";
        var result = [];
        for (var i = 0; i < s.length; i++) {
          result.push(s[i].toUpperCase());
        }
        return result;
      })();
    `);
	});

	// ── 25. Error creation and property access ───────────────────────

	it("Error: message and name properties", () => {
		assertEquivalent(`
      (function() {
        var e = new Error("something went wrong");
        return [e.message, e.name, e instanceof Error];
      })();
    `);
	});

	it("TypeError: creation and properties", () => {
		assertEquivalent(`
      (function() {
        var e = new TypeError("bad type");
        return [e.message, e.name, e instanceof TypeError, e instanceof Error];
      })();
    `);
	});

	// ── 26. Complex return expressions ───────────────────────────────

	it("return with complex expression", () => {
		assertEquivalent(`
      (function() {
        function compute(a, b, c) {
          return a * b + c - (a > b ? a : b) + (c % 2 === 0 ? 1 : -1);
        }
        return [compute(3, 5, 8), compute(10, 2, 7), compute(0, 0, 0)];
      })();
    `);
	});

	it("return with logical expression", () => {
		assertEquivalent(`
      (function() {
        function firstTruthy() {
          for (var i = 0; i < arguments.length; i++) {
            if (arguments[i]) return arguments[i];
          }
          return null;
        }
        return [firstTruthy(0, "", null, "found"), firstTruthy(0, false, null)];
      })();
    `);
	});

	// ── 27. Nested ternary with function calls ───────────────────────

	it("nested ternary calling functions", () => {
		assertEquivalent(`
      (function() {
        function double(x) { return x * 2; }
        function triple(x) { return x * 3; }
        function negate(x) { return -x; }
        function transform(x) {
          return x > 0 ? (x > 10 ? double(x) : triple(x)) : negate(x);
        }
        return [transform(20), transform(5), transform(-3), transform(0)];
      })();
    `);
	});

	// ── 28. Multi-level object property access ───────────────────────

	it("four-level property access: a.b.c.d", () => {
		assertEquivalent(`
      (function() {
        var a = {b: {c: {d: {value: 42}}}};
        return a.b.c.d.value;
      })();
    `);
	});

	it("mixed dot and bracket notation deep access", () => {
		assertEquivalent(`
      (function() {
        var data = {items: [{id: 1, tags: ["a", "b"]}, {id: 2, tags: ["c"]}]};
        var idx = 0;
        return [data.items[idx].tags[1], data["items"][1]["tags"][0]];
      })();
    `);
	});

	// ── 29. Dynamic property names with bracket notation ─────────────

	it("dynamic property names via concatenation", () => {
		assertEquivalent(`
      (function() {
        var obj = {prop1: "a", prop2: "b", prop3: "c"};
        var results = [];
        for (var i = 1; i <= 3; i++) {
          results.push(obj["prop" + i]);
        }
        return results;
      })();
    `);
	});

	it("dynamic property names from array of keys", () => {
		assertEquivalent(`
      (function() {
        var obj = {x: 10, y: 20, z: 30};
        var keys = ["x", "y", "z"];
        var sum = 0;
        for (var i = 0; i < keys.length; i++) {
          sum += obj[keys[i]];
        }
        return sum;
      })();
    `);
	});

	// ── 30. Arguments object manipulation ────────────────────────────

	it("arguments: length and indexed access", () => {
		assertEquivalent(`
      (function() {
        function test() {
          return [arguments.length, arguments[0], arguments[1], arguments[2]];
        }
        return test("a", "b", "c");
      })();
    `);
	});

	it("arguments: convert to array and manipulate", () => {
		assertEquivalent(`
      (function() {
        function toArray() {
          var arr = [];
          for (var i = 0; i < arguments.length; i++) {
            arr.push(arguments[i]);
          }
          return arr.reverse();
        }
        return toArray(1, 2, 3, 4, 5);
      })();
    `);
	});

	it("arguments: passed to another function", () => {
		assertEquivalent(`
      (function() {
        function sum() {
          var total = 0;
          for (var i = 0; i < arguments.length; i++) total += arguments[i];
          return total;
        }
        function wrapper() {
          var args = [];
          for (var i = 0; i < arguments.length; i++) args.push(arguments[i] * 2);
          return sum.apply(null, args);
        }
        return wrapper(1, 2, 3, 4);
      })();
    `);
	});

	// ── Additional edge-case patterns ────────────────────────────────

	it("object with numeric keys", () => {
		assertEquivalent(`
      (function() {
        var obj = {};
        obj[0] = "zero";
        obj[1] = "one";
        obj[2] = "two";
        return [obj[0], obj["1"], Object.keys(obj)];
      })();
    `);
	});

	it("property access on primitive via autoboxing", () => {
		assertEquivalent(`
      (function() {
        var s = "hello";
        var n = 42;
        return [s.length, s.charAt(1), n.toString(), n.toFixed(2)];
      })();
    `);
	});

	it("chained ternary as variable initializer", () => {
		assertEquivalent(`
      (function() {
        function grade(score) {
          var letter =
            score >= 90 ? "A" :
            score >= 80 ? "B" :
            score >= 70 ? "C" :
            score >= 60 ? "D" : "F";
          return letter;
        }
        return [grade(95), grade(85), grade(75), grade(65), grade(50)];
      })();
    `);
	});

	it("switch-like behavior via object lookup", () => {
		assertEquivalent(`
      (function() {
        var handlers = {
          add: function(a, b) { return a + b; },
          sub: function(a, b) { return a - b; },
          mul: function(a, b) { return a * b; }
        };
        function exec(op, a, b) {
          var fn = handlers[op];
          return fn ? fn(a, b) : null;
        }
        return [exec("add", 3, 4), exec("sub", 10, 3), exec("mul", 5, 6), exec("div", 1, 2)];
      })();
    `);
	});

	it("closure over loop variable via IIFE", () => {
		assertEquivalent(`
      (function() {
        var funcs = [];
        for (var i = 0; i < 5; i++) {
          funcs.push((function(j) {
            return function() { return j; };
          })(i));
        }
        return [funcs[0](), funcs[1](), funcs[2](), funcs[3](), funcs[4]()];
      })();
    `);
	});

	it("object property shorthand-like pattern", () => {
		assertEquivalent(`
      (function() {
        var name = "Alice";
        var age = 30;
        var obj = {name: name, age: age};
        return obj;
      })();
    `);
	});

	it("array spread equivalent via concat", () => {
		assertEquivalent(`
      (function() {
        var a = [1, 2, 3];
        var b = [4, 5, 6];
        var c = [0].concat(a).concat(b).concat([7]);
        return c;
      })();
    `);
	});

	it("complex expression: bitwise operations", () => {
		assertEquivalent(`
      (function() {
        return [
          5 & 3, 5 | 3, 5 ^ 3, ~5,
          8 << 2, 32 >> 2, -1 >>> 0
        ];
      })();
    `);
	});

	it("function as object property with this", () => {
		assertEquivalent(`
      (function() {
        var counter = {
          count: 0,
          increment: function() { this.count++; return this; },
          decrement: function() { this.count--; return this; },
          value: function() { return this.count; }
        };
        counter.increment().increment().increment().decrement();
        return counter.value();
      })();
    `);
	});

	it("hasOwnProperty vs in operator", () => {
		assertEquivalent(`
      (function() {
        var obj = {a: 1};
        return [
          obj.hasOwnProperty("a"),
          obj.hasOwnProperty("toString"),
          "a" in obj,
          "toString" in obj
        ];
      })();
    `);
	});

	it("Array.isArray and type checks", () => {
		assertEquivalent(`
      (function() {
        return [
          Array.isArray([]),
          Array.isArray({}),
          Array.isArray("hello"),
          Array.isArray(null),
          Array.isArray(new Array(3))
        ];
      })();
    `);
	});

	it("regex test and match", () => {
		assertEquivalent(`
      (function() {
        var re = /^[a-z]+$/;
        return [
          re.test("hello"),
          re.test("Hello"),
          re.test("123"),
          re.test(""),
          "abc123def".match(/[0-9]+/)[0]
        ];
      })();
    `);
	});
});
