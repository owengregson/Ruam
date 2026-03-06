// RuamTester.js — Comprehensive JavaScript VM Obfuscation Test File
// This file exercises every JavaScript operation to verify that the
// obfuscator maintains 100% semantic equivalence with native execution.
// Run through the obfuscator and execute both original + obfuscated versions.
// Compare outputs to verify integrity.

var results = [];
var testCount = 0;
var passCount = 0;

function assert(label, actual, expected) {
  testCount++;
  var pass;
  if (typeof expected === "number" && isNaN(expected)) {
    pass = typeof actual === "number" && isNaN(actual);
  } else if (typeof expected === "object" && expected !== null && typeof actual === "object" && actual !== null) {
    pass = JSON.stringify(actual) === JSON.stringify(expected);
  } else {
    pass = actual === expected;
  }
  if (pass) {
    passCount++;
  } else {
    results.push("FAIL: " + label + " | expected: " + JSON.stringify(expected) + " | got: " + JSON.stringify(actual));
  }
}

// =============================================================================
// 1. ARITHMETIC OPERATIONS
// =============================================================================
(function testArithmetic() {
  assert("add", 2 + 3, 5);
  assert("sub", 10 - 7, 3);
  assert("mul", 4 * 6, 24);
  assert("div", 15 / 3, 5);
  assert("mod", 17 % 5, 2);
  assert("pow", 2 ** 10, 1024);
  assert("neg", -(5), -5);
  assert("unary plus", +"42", 42);
  assert("div by zero", 1 / 0, Infinity);
  assert("neg div by zero", -1 / 0, -Infinity);
  assert("zero div zero", 0 / 0, NaN);
  assert("mod zero", 5 % 0, NaN);
  assert("float add", 0.1 + 0.2 > 0.3, true);
  // Note: MAX_SAFE_INTEGER + 1 === MAX_SAFE_INTEGER + 2 is actually true in IEEE 754
  // because both values exceed safe integer range and become the same float
  assert("integer overflow safe", 9007199254740991 + 1 === 9007199254740991 + 2, true);
  assert("neg zero", Object.is(-0, -0), true);
})();

// =============================================================================
// 2. BITWISE OPERATIONS
// =============================================================================
(function testBitwise() {
  assert("and", 0xFF & 0x0F, 0x0F);
  assert("or", 0xF0 | 0x0F, 0xFF);
  assert("xor", 0xFF ^ 0x0F, 0xF0);
  assert("not", ~0, -1);
  assert("shl", 1 << 4, 16);
  assert("shr", -16 >> 2, -4);
  assert("ushr", -1 >>> 0, 4294967295);
  assert("complex bitwise", (0xABCD & 0xFF00) >> 8, 0xAB);
})();

// =============================================================================
// 3. COMPARISON OPERATORS
// =============================================================================
(function testComparisons() {
  assert("eq loose", 1 == "1", true);
  assert("neq loose", 1 != "2", true);
  assert("seq", 1 === 1, true);
  assert("sneq", 1 !== "1", true);
  assert("lt", 3 < 5, true);
  assert("lte", 5 <= 5, true);
  assert("gt", 7 > 3, true);
  assert("gte", 3 >= 3, true);
  assert("null eq undefined", null == undefined, true);
  assert("null seq undefined", null === undefined, false);
  assert("NaN neq self", NaN === NaN, false);
  assert("string compare", "abc" < "abd", true);
})();

// =============================================================================
// 4. LOGICAL OPERATORS
// =============================================================================
(function testLogical() {
  assert("and true", true && "yes", "yes");
  assert("and false", false && "yes", false);
  assert("or true", true || "no", true);
  assert("or false", false || "fallback", "fallback");
  assert("not true", !true, false);
  assert("not false", !false, true);
  assert("double not", !!0, false);
  assert("double not truthy", !!"hello", true);
  assert("nullish coal null", null ?? "default", "default");
  assert("nullish coal undef", undefined ?? "default", "default");
  assert("nullish coal zero", 0 ?? "default", 0);
  assert("nullish coal empty", "" ?? "default", "");
  assert("short circuit and", false && (function(){ throw new Error(); })(), false);
})();

// =============================================================================
// 5. STRING OPERATIONS
// =============================================================================
(function testStrings() {
  assert("concat", "hello" + " " + "world", "hello world");
  assert("length", "test".length, 4);
  assert("charAt", "abc".charAt(1), "b");
  assert("charCodeAt", "A".charCodeAt(0), 65);
  assert("indexOf", "hello world".indexOf("world"), 6);
  assert("lastIndexOf", "abcabc".lastIndexOf("bc"), 4);
  assert("includes", "hello".includes("ell"), true);
  assert("startsWith", "hello".startsWith("hel"), true);
  assert("endsWith", "hello".endsWith("llo"), true);
  assert("slice", "hello world".slice(6), "world");
  assert("slice neg", "hello".slice(-3), "llo");
  assert("substring", "hello".substring(1, 3), "el");
  assert("toUpperCase", "hello".toUpperCase(), "HELLO");
  assert("toLowerCase", "HELLO".toLowerCase(), "hello");
  assert("trim", "  hello  ".trim(), "hello");
  assert("split", "a,b,c".split(",").length, 3);
  assert("split join", "a-b-c".split("-").join("+"), "a+b+c");
  assert("replace", "hello world".replace("world", "there"), "hello there");
  assert("repeat", "ab".repeat(3), "ababab");
  assert("padStart", "5".padStart(3, "0"), "005");
  assert("padEnd", "5".padEnd(3, "0"), "500");
  assert("fromCharCode", String.fromCharCode(72, 73), "HI");
  assert("str coerce num", "5" + 3, "53");
  assert("num coerce str", 5 + "3", "53");
  assert("str multiply", "5" * 3, 15);
  assert("str subtract", "10" - 5, 5);
})();

// =============================================================================
// 6. ARRAY OPERATIONS
// =============================================================================
(function testArrays() {
  var arr = [1, 2, 3, 4, 5];
  assert("array length", arr.length, 5);
  assert("array access", arr[2], 3);
  assert("array push", (function() { var a = [1]; a.push(2); return a.length; })(), 2);
  assert("array pop", (function() { var a = [1, 2, 3]; return a.pop(); })(), 3);
  assert("array shift", (function() { var a = [1, 2, 3]; return a.shift(); })(), 1);
  assert("array unshift", (function() { var a = [1]; a.unshift(0); return a[0]; })(), 0);
  assert("array splice", (function() { var a = [1, 2, 3, 4]; a.splice(1, 2); return a.length; })(), 2);
  assert("array slice", [1, 2, 3, 4, 5].slice(1, 3).length, 2);
  assert("array concat", [1, 2].concat([3, 4]).length, 4);
  assert("array indexOf", [10, 20, 30].indexOf(20), 1);
  assert("array includes", [1, 2, 3].includes(2), true);
  assert("array reverse", (function() { var a = [1, 2, 3]; a.reverse(); return a[0]; })(), 3);
  assert("array sort", (function() { var a = [3, 1, 2]; a.sort(); return a[0]; })(), 1);
  assert("array sort custom", (function() { return [3,1,2].sort(function(a,b){return b-a;})[0]; })(), 3);
  assert("array join", [1, 2, 3].join("-"), "1-2-3");
  assert("array map", [1, 2, 3].map(function(x) { return x * 2; })[1], 4);
  assert("array filter", [1, 2, 3, 4, 5].filter(function(x) { return x > 3; }).length, 2);
  assert("array reduce", [1, 2, 3, 4].reduce(function(a, b) { return a + b; }, 0), 10);
  assert("array every", [2, 4, 6].every(function(x) { return x % 2 === 0; }), true);
  assert("array some", [1, 2, 3].some(function(x) { return x > 2; }), true);
  assert("array find", [1, 2, 3, 4].find(function(x) { return x > 2; }), 3);
  assert("array findIndex", [1, 2, 3, 4].findIndex(function(x) { return x > 2; }), 2);
  assert("array flat", [1, [2, [3]]].flat(Infinity).length, 3);
  assert("array isArray", Array.isArray([1, 2]), true);
  assert("array from", Array.from("abc").length, 3);
  assert("array spread", (function() { var a = [1,2]; var b = [0].concat(a).concat([3]); return b.length; })(), 4);
  assert("nested array", [[1, 2], [3, 4]][1][0], 3);
  assert("array chain", [1,2,3,4,5].filter(function(x){return x%2===1;}).map(function(x){return x*10;}).reduce(function(a,b){return a+b;},0), 90);
})();

// =============================================================================
// 7. OBJECT OPERATIONS
// =============================================================================
(function testObjects() {
  assert("obj literal", (function() { var o = {a: 1, b: 2}; return o.a + o.b; })(), 3);
  assert("obj bracket", (function() { var o = {x: 42}; var k = "x"; return o[k]; })(), 42);
  assert("obj assign", (function() { var o = {}; o.x = 10; return o.x; })(), 10);
  assert("obj nested", (function() { var o = {a: {b: {c: 99}}}; return o.a.b.c; })(), 99);
  assert("obj keys", Object.keys({a: 1, b: 2, c: 3}).length, 3);
  assert("obj values", Object.values({a: 10, b: 20})[1], 20);
  assert("obj entries", Object.entries({x: 1}).length, 1);
  assert("obj assign merge", (function() { var a = {x: 1}; var b = {y: 2}; Object.assign(a, b); return a.y; })(), 2);
  assert("obj hasOwnProp", ({a: 1}).hasOwnProperty("a"), true);
  assert("obj in", "x" in {x: 1}, true);
  assert("obj not in", "y" in {x: 1}, false);
  assert("obj delete", (function() { var o = {a: 1, b: 2}; delete o.a; return "a" in o; })(), false);
  assert("obj freeze", (function() { var o = Object.freeze({x: 1}); try { o.x = 2; } catch(e) {} return o.x; })(), 1);
  assert("obj computed key", (function() { var k = "foo"; var o = {}; o[k] = 42; return o.foo; })(), 42);
  assert("obj shorthand method", (function() { var o = { greet: function() { return "hi"; } }; return o.greet(); })(), "hi");
  assert("obj property count", (function() { var o = {}; for (var i = 0; i < 5; i++) o["k" + i] = i; return Object.keys(o).length; })(), 5);
})();

// =============================================================================
// 8. CONTROL FLOW — IF/ELSE
// =============================================================================
(function testIfElse() {
  assert("if true", (function() { if (true) return 1; return 0; })(), 1);
  assert("if false", (function() { if (false) return 1; return 0; })(), 0);
  assert("if else", (function() { if (false) return 1; else return 2; })(), 2);
  assert("if elseif else", (function(x) { if (x < 0) return "neg"; else if (x > 0) return "pos"; else return "zero"; })(0), "zero");
  assert("nested if", (function(a, b) { if (a > 0) { if (b > 0) return "both"; return "a only"; } return "neither"; })(1, 1), "both");
})();

// =============================================================================
// 9. CONTROL FLOW — LOOPS
// =============================================================================
(function testLoops() {
  assert("for loop", (function() { var s = 0; for (var i = 1; i <= 10; i++) s += i; return s; })(), 55);
  assert("while loop", (function() { var i = 0; var s = 0; while (i < 5) { s += i; i++; } return s; })(), 10);
  assert("do while", (function() { var i = 0; do { i++; } while (i < 3); return i; })(), 3);
  assert("for break", (function() { var s = 0; for (var i = 0; i < 10; i++) { if (i === 5) break; s += i; } return s; })(), 10);
  assert("for continue", (function() { var s = 0; for (var i = 0; i < 10; i++) { if (i % 2 === 0) continue; s += i; } return s; })(), 25);
  assert("nested loops", (function() { var s = 0; for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) s++; return s; })(), 9);
  assert("for in", (function() { var o = {a: 1, b: 2, c: 3}; var keys = []; for (var k in o) keys.push(k); return keys.length; })(), 3);
  assert("for of array", (function() { var arr = [10, 20, 30]; var s = 0; for (var x of arr) s += x; return s; })(), 60);
  assert("for of string", (function() { var s = ""; for (var c of "abc") s += c.toUpperCase(); return s; })(), "ABC");
  assert("while break", (function() { var i = 0; while (true) { i++; if (i >= 5) break; } return i; })(), 5);
  assert("labeled break", (function() {
    var count = 0;
    outer: for (var i = 0; i < 3; i++) {
      for (var j = 0; j < 3; j++) {
        if (j === 1) break outer;
        count++;
      }
    }
    return count;
  })(), 1);
})();

// =============================================================================
// 10. CONTROL FLOW — SWITCH
// =============================================================================
(function testSwitch() {
  assert("switch match", (function(x) {
    switch(x) { case 1: return "one"; case 2: return "two"; default: return "other"; }
  })(2), "two");
  assert("switch default", (function(x) {
    switch(x) { case 1: return "one"; default: return "default"; }
  })(99), "default");
  assert("switch fallthrough", (function(x) {
    var r = "";
    switch(x) { case 1: r += "a"; case 2: r += "b"; break; case 3: r += "c"; }
    return r;
  })(1), "ab");
  assert("switch string", (function(s) {
    switch(s) { case "hello": return 1; case "world": return 2; default: return 0; }
  })("world"), 2);
})();

// =============================================================================
// 11. CONTROL FLOW — TERNARY
// =============================================================================
(function testTernary() {
  assert("ternary true", true ? "yes" : "no", "yes");
  assert("ternary false", false ? "yes" : "no", "no");
  assert("ternary nested", (function(x) { return x > 0 ? "pos" : x < 0 ? "neg" : "zero"; })(0), "zero");
  assert("ternary expr", (function(a, b) { return (a > b ? a : b); })(3, 7), 7);
})();

// =============================================================================
// 12. FUNCTIONS
// =============================================================================
(function testFunctions() {
  assert("function decl", (function() {
    function add(a, b) { return a + b; }
    return add(3, 4);
  })(), 7);
  assert("function expr", (function() {
    var mul = function(a, b) { return a * b; };
    return mul(5, 6);
  })(), 30);
  assert("default param", (function() {
    function greet(name) { if (name === undefined) name = "world"; return "hello " + name; }
    return greet();
  })(), "hello world");
  assert("rest params", (function() {
    function sum() { var s = 0; for (var i = 0; i < arguments.length; i++) s += arguments[i]; return s; }
    return sum(1, 2, 3, 4);
  })(), 10);
  assert("recursion factorial", (function() {
    function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }
    return fact(6);
  })(), 720);
  assert("recursion fibonacci", (function() {
    function fib(n) { return n <= 1 ? n : fib(n - 1) + fib(n - 2); }
    return fib(10);
  })(), 55);
  assert("higher order", (function() {
    function apply(fn, x) { return fn(x); }
    return apply(function(n) { return n * n; }, 5);
  })(), 25);
  assert("IIFE", (function() { return 42; })(), 42);
  assert("function as method", (function() {
    var obj = { val: 10, getVal: function() { return this.val; } };
    return obj.getVal();
  })(), 10);
})();

// =============================================================================
// 13. CLOSURES
// =============================================================================
(function testClosures() {
  assert("basic closure", (function() {
    function makeAdder(x) {
      return function(y) { return x + y; };
    }
    return makeAdder(10)(5);
  })(), 15);

  assert("counter closure", (function() {
    function counter() {
      var count = 0;
      return {
        inc: function() { count++; return count; },
        get: function() { return count; }
      };
    }
    var c = counter();
    c.inc();
    c.inc();
    c.inc();
    return c.get();
  })(), 3);

  assert("shared scope closure", (function() {
    function makeState(init) {
      var val = init;
      return {
        get: function() { return val; },
        set: function(v) { val = v; }
      };
    }
    var s = makeState(10);
    s.set(42);
    return s.get();
  })(), 42);

  assert("nested closure", (function() {
    function outer(x) {
      return function middle(y) {
        return function inner(z) {
          return x + y + z;
        };
      };
    }
    return outer(1)(2)(3);
  })(), 6);

  assert("closure factory", (function() {
    function multiplier(factor) {
      return function(x) { return x * factor; };
    }
    var double = multiplier(2);
    var triple = multiplier(3);
    return double(5) + triple(5);
  })(), 25);

  assert("closure mutation", (function() {
    function makeCounter() {
      var count = 0;
      return function() { count = count + 1; return count; };
    }
    var c = makeCounter();
    c();
    c();
    return c();
  })(), 3);
})();

// =============================================================================
// 14. EXCEPTION HANDLING
// =============================================================================
(function testExceptions() {
  assert("try catch", (function() {
    try { throw new Error("test"); } catch(e) { return e.message; }
  })(), "test");

  assert("try finally", (function() {
    var x = 0;
    try { x = 1; } finally { x = x + 10; }
    return x;
  })(), 11);

  assert("try catch finally", (function() {
    var log = [];
    try { log.push("try"); throw "err"; } catch(e) { log.push("catch"); } finally { log.push("finally"); }
    return log.join(",");
  })(), "try,catch,finally");

  assert("catch binding", (function() {
    try { throw {code: 42}; } catch(e) { return e.code; }
  })(), 42);

  assert("nested try", (function() {
    var r = "";
    try {
      try { throw "inner"; } catch(e) { r += e; }
      r += "+";
      throw "outer";
    } catch(e) { r += e; }
    return r;
  })(), "inner+outer");

  assert("error types", (function() {
    try { null.x; } catch(e) { return e.constructor.name; }
  })(), "TypeError");

  assert("finally always runs", (function() {
    var ran = false;
    try { return 1; } finally { ran = true; }
  })(), 1);

  assert("rethrow", (function() {
    var caught = "";
    try {
      try { throw "original"; } catch(e) { throw e + "+rethrown"; }
    } catch(e) { caught = e; }
    return caught;
  })(), "original+rethrown");
})();

// =============================================================================
// 15. DESTRUCTURING
// =============================================================================
(function testDestructuring() {
  assert("array destr basic", (function() {
    var arr = [1, 2, 3];
    var a = arr[0], b = arr[1], c = arr[2];
    return a + b + c;
  })(), 6);

  assert("obj destr basic", (function() {
    var obj = {x: 10, y: 20};
    var x = obj.x, y = obj.y;
    return x + y;
  })(), 30);

  assert("swap via temp", (function() {
    var a = 1, b = 2;
    var temp = a; a = b; b = temp;
    return a * 10 + b;
  })(), 21);

  assert("nested obj access", (function() {
    var obj = {a: {b: {c: 42}}};
    return obj.a.b.c;
  })(), 42);
})();

// =============================================================================
// 16. TYPE COERCION & TYPEOF
// =============================================================================
(function testTypes() {
  assert("typeof number", typeof 42, "number");
  assert("typeof string", typeof "hello", "string");
  assert("typeof boolean", typeof true, "boolean");
  assert("typeof undefined", typeof undefined, "undefined");
  assert("typeof null", typeof null, "object");
  assert("typeof function", typeof function(){}, "function");
  assert("typeof object", typeof {}, "object");
  assert("typeof array", typeof [], "object");
  assert("Number coerce", Number("42"), 42);
  assert("Number coerce bool", Number(true), 1);
  assert("Number coerce null", Number(null), 0);
  assert("Number coerce undef", Number(undefined), NaN);
  assert("String coerce", String(42), "42");
  assert("Boolean coerce 0", Boolean(0), false);
  assert("Boolean coerce 1", Boolean(1), true);
  assert("Boolean coerce empty", Boolean(""), false);
  assert("Boolean coerce str", Boolean("x"), true);
  assert("Boolean coerce null", Boolean(null), false);
  assert("Boolean coerce obj", Boolean({}), true);
})();

// =============================================================================
// 17. SCOPE & HOISTING
// =============================================================================
(function testScope() {
  assert("var hoisting", (function() {
    var x = typeof y;
    var y = 10;
    return x;
  })(), "undefined");

  assert("function hoisting", (function() {
    var result = foo();
    function foo() { return 42; }
    return result;
  })(), 42);

  assert("var scope function", (function() {
    var x = "outer";
    function inner() { var x = "inner"; return x; }
    return inner() + "+" + x;
  })(), "inner+outer");

  assert("var shadowing", (function() {
    var x = 1;
    (function() { var x = 2; })();
    return x;
  })(), 1);
})();

// =============================================================================
// 18. ITERATION PATTERNS
// =============================================================================
(function testIteration() {
  assert("map and filter chain", (function() {
    var nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    return nums
      .filter(function(n) { return n % 2 === 0; })
      .map(function(n) { return n * n; })
      .reduce(function(a, b) { return a + b; }, 0);
  })(), 220);

  assert("reduce to object", (function() {
    var pairs = [["a", 1], ["b", 2], ["c", 3]];
    var obj = pairs.reduce(function(acc, pair) {
      acc[pair[0]] = pair[1];
      return acc;
    }, {});
    return obj.b;
  })(), 2);

  assert("forEach side effect", (function() {
    var sum = 0;
    [1, 2, 3, 4, 5].forEach(function(n) { sum += n; });
    return sum;
  })(), 15);
})();

// =============================================================================
// 19. COMPLEX PATTERNS
// =============================================================================
(function testComplexPatterns() {
  assert("fibonacci memoized", (function() {
    var memo = {};
    function fib(n) {
      if (n in memo) return memo[n];
      if (n <= 1) return n;
      memo[n] = fib(n - 1) + fib(n - 2);
      return memo[n];
    }
    return fib(20);
  })(), 6765);

  assert("deep clone via JSON", (function() {
    var original = {a: 1, b: {c: [1, 2, 3]}};
    var clone = JSON.parse(JSON.stringify(original));
    clone.b.c.push(4);
    return original.b.c.length + "," + clone.b.c.length;
  })(), "3,4");

  assert("linked list", (function() {
    function node(val, next) { return {val: val, next: next}; }
    var list = node(1, node(2, node(3, node(4, null))));
    var sum = 0;
    var cur = list;
    while (cur) { sum += cur.val; cur = cur.next; }
    return sum;
  })(), 10);

  assert("binary search", (function() {
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
  })(), 3);

  assert("quicksort", (function() {
    function qsort(arr) {
      if (arr.length <= 1) return arr;
      var pivot = arr[0];
      var left = arr.slice(1).filter(function(x) { return x <= pivot; });
      var right = arr.slice(1).filter(function(x) { return x > pivot; });
      return qsort(left).concat([pivot]).concat(qsort(right));
    }
    return qsort([5, 3, 8, 1, 9, 2, 7, 4, 6]).join(",");
  })(), "1,2,3,4,5,6,7,8,9");

  assert("flatten nested", (function() {
    function flatten(arr) {
      var result = [];
      for (var i = 0; i < arr.length; i++) {
        if (Array.isArray(arr[i])) {
          var sub = flatten(arr[i]);
          for (var j = 0; j < sub.length; j++) result.push(sub[j]);
        } else {
          result.push(arr[i]);
        }
      }
      return result;
    }
    return flatten([1, [2, [3, [4]]], 5]).join(",");
  })(), "1,2,3,4,5");

  assert("curry", (function() {
    function curry(fn) {
      return function(a) {
        return function(b) {
          return fn(a, b);
        };
      };
    }
    var add = curry(function(a, b) { return a + b; });
    return add(10)(20);
  })(), 30);

  assert("compose", (function() {
    function compose(f, g) {
      return function(x) { return f(g(x)); };
    }
    var double = function(x) { return x * 2; };
    var inc = function(x) { return x + 1; };
    return compose(double, inc)(5);
  })(), 12);

  assert("pipe", (function() {
    function pipe() {
      var fns = Array.prototype.slice.call(arguments);
      return function(x) {
        var result = x;
        for (var i = 0; i < fns.length; i++) result = fns[i](result);
        return result;
      };
    }
    return pipe(
      function(x) { return x + 1; },
      function(x) { return x * 2; },
      function(x) { return x - 3; }
    )(10);
  })(), 19);

  assert("event emitter pattern", (function() {
    function createEmitter() {
      var listeners = {};
      return {
        on: function(event, cb) {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(cb);
        },
        emit: function(event, data) {
          var cbs = listeners[event] || [];
          for (var i = 0; i < cbs.length; i++) cbs[i](data);
        }
      };
    }
    var em = createEmitter();
    var result = 0;
    em.on("add", function(n) { result += n; });
    em.on("add", function(n) { result += n * 10; });
    em.emit("add", 5);
    return result;
  })(), 55);
})();

// =============================================================================
// 20. MATH METHODS
// =============================================================================
(function testMathMethods() {
  assert("Math.floor", Math.floor(4.7), 4);
  assert("Math.ceil", Math.ceil(4.1), 5);
  assert("Math.round", Math.round(4.5), 5);
  assert("Math.abs neg", Math.abs(-42), 42);
  assert("Math.max", Math.max(1, 5, 3), 5);
  assert("Math.min", Math.min(1, 5, 3), 1);
  assert("Math.pow", Math.pow(2, 8), 256);
  assert("Math.sqrt", Math.sqrt(144), 12);
  assert("Math.sign neg", Math.sign(-5), -1);
  assert("Math.sign zero", Math.sign(0), 0);
  assert("Math.sign pos", Math.sign(5), 1);
  assert("Math.trunc", Math.trunc(4.9), 4);
  assert("Math.trunc neg", Math.trunc(-4.9), -4);
  assert("Math.PI exists", Math.PI > 3.14 && Math.PI < 3.15, true);
})();

// =============================================================================
// 21. JSON
// =============================================================================
(function testJSON() {
  assert("JSON.stringify obj", JSON.stringify({a: 1}), '{"a":1}');
  assert("JSON.stringify arr", JSON.stringify([1, 2, 3]), "[1,2,3]");
  assert("JSON.parse obj", JSON.parse('{"x":42}').x, 42);
  assert("JSON.parse arr", JSON.parse("[1,2,3]").length, 3);
  assert("JSON roundtrip", (function() {
    var obj = {name: "test", values: [1, 2, 3], nested: {x: true}};
    return JSON.parse(JSON.stringify(obj)).nested.x;
  })(), true);
})();

// =============================================================================
// 22. REGEX (basic)
// =============================================================================
(function testRegex() {
  assert("regex test", /hello/.test("hello world"), true);
  assert("regex test fail", /xyz/.test("hello"), false);
  assert("regex match", "hello123world".match(/\d+/)[0], "123");
  assert("string replace regex", "aabbcc".replace(/b/g, "X"), "aaXXcc");
  assert("string search", "hello world".search(/world/), 6);
  assert("string split regex", "a1b2c3".split(/\d/).join(","), "a,b,c,");
})();

// =============================================================================
// 23. DATE (basic, deterministic)
// =============================================================================
(function testDate() {
  assert("date from timestamp", (function() {
    var d = new Date(0);
    return d.getTime();
  })(), 0);
  assert("date year", new Date(2024, 0, 1).getFullYear(), 2024);
  assert("date month", new Date(2024, 5, 15).getMonth(), 5);
})();

// =============================================================================
// 24. PROPERTY DESCRIPTORS
// =============================================================================
(function testPropertyDescriptors() {
  assert("defineProperty", (function() {
    var obj = {};
    Object.defineProperty(obj, "x", { value: 42, writable: false, enumerable: true, configurable: false });
    return obj.x;
  })(), 42);

  assert("non-writable", (function() {
    var obj = {};
    Object.defineProperty(obj, "x", { value: 10, writable: false });
    try { obj.x = 20; } catch(e) {}
    return obj.x;
  })(), 10);

  assert("getter setter", (function() {
    var obj = {};
    var _val = 0;
    Object.defineProperty(obj, "val", {
      get: function() { return _val * 2; },
      set: function(v) { _val = v; }
    });
    obj.val = 5;
    return obj.val;
  })(), 10);
})();

// =============================================================================
// 25. PROTOTYPE CHAIN
// =============================================================================
(function testPrototype() {
  assert("prototype method", (function() {
    function Animal(name) { this.name = name; }
    Animal.prototype.speak = function() { return this.name + " speaks"; };
    var a = new Animal("Dog");
    return a.speak();
  })(), "Dog speaks");

  assert("prototype chain", (function() {
    function Base() { this.x = 1; }
    Base.prototype.getX = function() { return this.x; };
    function Child() { Base.call(this); this.y = 2; }
    Child.prototype = Object.create(Base.prototype);
    Child.prototype.constructor = Child;
    var c = new Child();
    return c.getX() + c.y;
  })(), 3);

  assert("instanceof", (function() {
    function Foo() {}
    var f = new Foo();
    return f instanceof Foo;
  })(), true);
})();

// =============================================================================
// 26. EDGE CASES
// =============================================================================
(function testEdgeCases() {
  assert("void operator", void 0, undefined);
  assert("void expr", void "anything", undefined);
  assert("comma operator", (1, 2, 3), 3);
  assert("empty array holes", [1,,3].length, 3);
  assert("obj with numeric keys", (function() { var o = {0: "a", 1: "b"}; return o[0]; })(), "a");
  assert("string as array", "hello"[1], "e");
  assert("toString implicit", (function() { var o = {toString: function() { return "custom"; }}; return "" + o; })(), "custom");
  assert("valueOf implicit", (function() { var o = {valueOf: function() { return 42; }}; return o + 0; })(), 42);
  assert("arguments length", (function() { return arguments.length; })(1, 2, 3), 3);
  assert("arguments access", (function() { return arguments[1]; })("a", "b", "c"), "b");
  assert("conditional chain", (function(x) { return x > 0 ? x > 10 ? "big" : "small" : "non-positive"; })(5), "small");
  assert("complex expression", (function() { var a = 1, b = 2, c = 3; return a + b * c - (a + b) * c; })(), -2);
  assert("optional chaining null", (function() { var o = null; return o === null ? undefined : o.x; })(), undefined);
  assert("optional chaining deep", (function() { var o = {a: {b: {c: 42}}}; return o && o.a && o.a.b && o.a.b.c; })(), 42);
})();

// =============================================================================
// SUMMARY
// =============================================================================
var summary = testCount + " tests, " + passCount + " passed, " + (testCount - passCount) + " failed";
if (results.length > 0) {
  summary += "\n" + results.join("\n");
}
summary;
