// RuamTesterLite.js — Lightweight VM Obfuscation Smoke Test
// Covers core JS semantics with minimal tests per category.
// Use RuamTester.js for full regression coverage.

var results = [];
var testCount = 0;
var passCount = 0;

function assert(label, actual, expected) {
	testCount++;
	var pass;
	if (typeof expected === "number" && isNaN(expected)) {
		pass = typeof actual === "number" && isNaN(actual);
	} else if (
		typeof expected === "object" &&
		expected !== null &&
		typeof actual === "object" &&
		actual !== null
	) {
		pass = JSON.stringify(actual) === JSON.stringify(expected);
	} else {
		pass = actual === expected;
	}
	if (pass) {
		passCount++;
	} else {
		results.push(
			"FAIL: " +
				label +
				" | expected: " +
				JSON.stringify(expected) +
				" | got: " +
				JSON.stringify(actual)
		);
	}
}

// === 1. ARITHMETIC ===
(function () {
	assert("add", 2 + 3, 5);
	assert("mul", 4 * 6, 24);
	assert("div", 15 / 3, 5);
	assert("mod", 17 % 5, 2);
	assert("pow", 2 ** 10, 1024);
	assert("unary neg", -5, -5);
	assert("div by zero", 1 / 0, Infinity);
	assert("NaN", 0 / 0, NaN);
})();

// === 2. BITWISE ===
(function () {
	assert("and", 0xff & 0x0f, 0x0f);
	assert("or", 0xf0 | 0x0f, 0xff);
	assert("xor", 0xff ^ 0x0f, 0xf0);
	assert("shl", 1 << 4, 16);
	assert("ushr", -1 >>> 0, 4294967295);
})();

// === 3. COMPARISON ===
(function () {
	assert("eq loose", 1 == "1", true);
	assert("strict eq", 1 === 1, true);
	assert("strict neq", 1 !== "1", true);
	assert("lt", 3 < 5, true);
	assert("null == undef", null == undefined, true);
	assert("NaN !== NaN", NaN === NaN, false);
})();

// === 4. LOGICAL ===
(function () {
	assert("and", true && "yes", "yes");
	assert("or fallback", false || "fb", "fb");
	assert("not", !true, false);
	assert("nullish coal", null ?? "default", "default");
	assert("nullish zero", 0 ?? "default", 0);
})();

// === 5. STRINGS ===
(function () {
	assert("concat", "hello" + " " + "world", "hello world");
	assert("length", "test".length, 4);
	assert("charAt", "abc".charAt(1), "b");
	assert("indexOf", "hello world".indexOf("world"), 6);
	assert("slice", "hello world".slice(6), "world");
	assert("toUpperCase", "hello".toUpperCase(), "HELLO");
	assert("split join", "a-b-c".split("-").join("+"), "a+b+c");
	assert("replace", "hello world".replace("world", "there"), "hello there");
	assert("str coerce num", "5" + 3, "53");
})();

// === 6. ARRAYS ===
(function () {
	assert("length", [1, 2, 3].length, 3);
	assert("access", [10, 20, 30][1], 20);
	assert(
		"push",
		(function () {
			var a = [1];
			a.push(2, 3);
			return a.length;
		})(),
		3
	);
	assert(
		"pop",
		(function () {
			var a = [1, 2, 3];
			return a.pop();
		})(),
		3
	);
	assert("slice", [1, 2, 3, 4, 5].slice(1, 3).length, 2);
	assert("indexOf", [10, 20, 30].indexOf(20), 1);
	assert(
		"map",
		[1, 2, 3].map(function (x) {
			return x * 2;
		})[1],
		4
	);
	assert(
		"filter",
		[1, 2, 3, 4, 5].filter(function (x) {
			return x > 3;
		}).length,
		2
	);
	assert(
		"reduce",
		[1, 2, 3, 4].reduce(function (a, b) {
			return a + b;
		}, 0),
		10
	);
	assert("flat", [1, [2, [3]]].flat(Infinity).length, 3);
})();

// === 7. OBJECTS ===
(function () {
	assert(
		"literal",
		(function () {
			var o = { a: 1, b: 2 };
			return o.a + o.b;
		})(),
		3
	);
	assert(
		"bracket access",
		(function () {
			var o = { x: 42 };
			return o["x"];
		})(),
		42
	);
	assert(
		"nested",
		(function () {
			var o = { a: { b: { c: 99 } } };
			return o.a.b.c;
		})(),
		99
	);
	assert("keys", Object.keys({ a: 1, b: 2, c: 3 }).length, 3);
	assert("hasOwnProp", { a: 1 }.hasOwnProperty("a"), true);
	assert("in operator", "x" in { x: 1 }, true);
	assert(
		"delete",
		(function () {
			var o = { a: 1, b: 2 };
			delete o.a;
			return "a" in o;
		})(),
		false
	);
})();

// === 8. CONTROL FLOW ===
(function () {
	assert(
		"if/else",
		(function (x) {
			if (x < 0) return "neg";
			else if (x > 0) return "pos";
			else return "zero";
		})(0),
		"zero"
	);
	assert(
		"for loop",
		(function () {
			var s = 0;
			for (var i = 1; i <= 10; i++) s += i;
			return s;
		})(),
		55
	);
	assert(
		"while",
		(function () {
			var i = 0;
			while (i < 5) i++;
			return i;
		})(),
		5
	);
	assert(
		"do while",
		(function () {
			var i = 0;
			do {
				i++;
			} while (i < 3);
			return i;
		})(),
		3
	);
	assert(
		"for break",
		(function () {
			var s = 0;
			for (var i = 0; i < 10; i++) {
				if (i === 5) break;
				s += i;
			}
			return s;
		})(),
		10
	);
	assert(
		"for continue",
		(function () {
			var s = 0;
			for (var i = 0; i < 10; i++) {
				if (i % 2 === 0) continue;
				s += i;
			}
			return s;
		})(),
		25
	);
	assert(
		"for in",
		(function () {
			var o = { a: 1, b: 2, c: 3 };
			var keys = [];
			for (var k in o) keys.push(k);
			return keys.length;
		})(),
		3
	);
	assert(
		"for of",
		(function () {
			var s = 0;
			for (var x of [10, 20, 30]) s += x;
			return s;
		})(),
		60
	);
	assert(
		"switch",
		(function (x) {
			switch (x) {
				case 1:
					return "one";
				case 2:
					return "two";
				default:
					return "other";
			}
		})(2),
		"two"
	);
	assert(
		"switch fallthrough",
		(function (x) {
			var r = "";
			switch (x) {
				case 1:
					r += "a";
				case 2:
					r += "b";
					break;
				case 3:
					r += "c";
			}
			return r;
		})(1),
		"ab"
	);
	assert("ternary", (true ? "yes" : "no"), "yes");
	assert(
		"labeled break",
		(function () {
			var count = 0;
			outer: for (var i = 0; i < 3; i++) {
				for (var j = 0; j < 3; j++) {
					if (j === 1) break outer;
					count++;
				}
			}
			return count;
		})(),
		1
	);
})();

// === 9. FUNCTIONS ===
(function () {
	assert(
		"declaration",
		(function () {
			function add(a, b) {
				return a + b;
			}
			return add(3, 4);
		})(),
		7
	);
	assert(
		"expression",
		(function () {
			var mul = function (a, b) {
				return a * b;
			};
			return mul(5, 6);
		})(),
		30
	);
	assert(
		"recursion",
		(function () {
			function fact(n) {
				return n <= 1 ? 1 : n * fact(n - 1);
			}
			return fact(6);
		})(),
		720
	);
	assert(
		"higher order",
		(function () {
			function apply(fn, x) {
				return fn(x);
			}
			return apply(function (n) {
				return n * n;
			}, 5);
		})(),
		25
	);
	assert(
		"method this",
		(function () {
			var obj = {
				val: 10,
				getVal: function () {
					return this.val;
				},
			};
			return obj.getVal();
		})(),
		10
	);
	assert("IIFE", (function () { return 42; })(), 42);
})();

// === 10. CLOSURES ===
(function () {
	assert(
		"basic",
		(function () {
			function makeAdder(x) {
				return function (y) {
					return x + y;
				};
			}
			return makeAdder(10)(5);
		})(),
		15
	);
	assert(
		"counter",
		(function () {
			function counter() {
				var count = 0;
				return {
					inc: function () {
						count++;
						return count;
					},
					get: function () {
						return count;
					},
				};
			}
			var c = counter();
			c.inc();
			c.inc();
			c.inc();
			return c.get();
		})(),
		3
	);
	assert(
		"nested",
		(function () {
			function outer(x) {
				return function (y) {
					return function (z) {
						return x + y + z;
					};
				};
			}
			return outer(1)(2)(3);
		})(),
		6
	);
})();

// === 11. EXCEPTIONS ===
(function () {
	assert(
		"try catch",
		(function () {
			try {
				throw new Error("test");
			} catch (e) {
				return e.message;
			}
		})(),
		"test"
	);
	assert(
		"try catch finally",
		(function () {
			var log = [];
			try {
				log.push("try");
				throw "err";
			} catch (e) {
				log.push("catch");
			} finally {
				log.push("finally");
			}
			return log.join(",");
		})(),
		"try,catch,finally"
	);
	assert(
		"error type",
		(function () {
			try {
				null.x;
			} catch (e) {
				return e.constructor.name;
			}
		})(),
		"TypeError"
	);
})();

// === 12. TYPES ===
(function () {
	assert("typeof number", typeof 42, "number");
	assert("typeof string", typeof "hi", "string");
	assert("typeof bool", typeof true, "boolean");
	assert("typeof undef", typeof undefined, "undefined");
	assert("typeof null", typeof null, "object");
	assert("typeof fn", typeof function () {}, "function");
	assert("Number coerce", Number("42"), 42);
	assert("Boolean coerce", Boolean(0), false);
})();

// === 13. SCOPE ===
(function () {
	assert(
		"var hoisting",
		(function () {
			var x = typeof y;
			var y = 10;
			return x;
		})(),
		"undefined"
	);
	assert(
		"function hoisting",
		(function () {
			var result = foo();
			function foo() {
				return 42;
			}
			return result;
		})(),
		42
	);
	assert(
		"shadowing",
		(function () {
			var x = 1;
			(function () {
				var x = 2;
			})();
			return x;
		})(),
		1
	);
})();

// === 14. COMPLEX PATTERNS ===
(function () {
	assert(
		"memoized fib",
		(function () {
			var memo = {};
			function fib(n) {
				if (n in memo) return memo[n];
				if (n <= 1) return n;
				memo[n] = fib(n - 1) + fib(n - 2);
				return memo[n];
			}
			return fib(20);
		})(),
		6765
	);
	assert(
		"binary search",
		(function () {
			function bsearch(arr, target) {
				var lo = 0, hi = arr.length - 1;
				while (lo <= hi) {
					var mid = (lo + hi) >> 1;
					if (arr[mid] === target) return mid;
					if (arr[mid] < target) lo = mid + 1;
					else hi = mid - 1;
				}
				return -1;
			}
			return bsearch([1, 3, 5, 7, 9, 11, 13], 7);
		})(),
		3
	);
	assert(
		"event emitter",
		(function () {
			function createEmitter() {
				var listeners = {};
				return {
					on: function (event, cb) {
						if (!listeners[event]) listeners[event] = [];
						listeners[event].push(cb);
					},
					emit: function (event, data) {
						var cbs = listeners[event] || [];
						for (var i = 0; i < cbs.length; i++) cbs[i](data);
					},
				};
			}
			var em = createEmitter();
			var result = 0;
			em.on("add", function (n) { result += n; });
			em.on("add", function (n) { result += n * 10; });
			em.emit("add", 5);
			return result;
		})(),
		55
	);
})();

// === 15. MISC ===
(function () {
	assert("Math.floor", Math.floor(4.7), 4);
	assert("Math.abs", Math.abs(-42), 42);
	assert("Math.max", Math.max(1, 5, 3), 5);
	assert("JSON roundtrip", JSON.parse(JSON.stringify({ x: 42 })).x, 42);
	assert("regex test", /hello/.test("hello world"), true);
	assert("regex match", "abc123def".match(/\d+/)[0], "123");
	assert("void", void 0, undefined);
	assert("comma op", (1, 2, 3), 3);
	assert("arguments", (function () { return arguments.length; })(1, 2, 3), 3);
	assert(
		"prototype",
		(function () {
			function Animal(name) { this.name = name; }
			Animal.prototype.speak = function () { return this.name + " speaks"; };
			return new Animal("Dog").speak();
		})(),
		"Dog speaks"
	);
	assert(
		"getter/setter",
		(function () {
			var obj = {};
			var _v = 0;
			Object.defineProperty(obj, "v", {
				get: function () { return _v * 2; },
				set: function (x) { _v = x; },
			});
			obj.v = 5;
			return obj.v;
		})(),
		10
	);
})();

// === SUMMARY ===
var summary =
	testCount +
	" tests, " +
	passCount +
	" passed, " +
	(testCount - passCount) +
	" failed";
if (results.length > 0) {
	summary += "\n" + results.join("\n");
}
console.log(summary);
summary;
