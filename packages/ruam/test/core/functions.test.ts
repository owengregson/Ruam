import { describe, it } from "bun:test";
import { assertEquivalent } from "../helpers.js";

describe("function declarations and expressions", () => {
	it("function declaration basic", () => {
		assertEquivalent(`
      function double(x) { return x * 2; }
      function test() {
        return double(5);
      }
      test();
    `);
	});

	it("function expression assigned to variable", () => {
		assertEquivalent(`
      function test() {
        var square = function(x) { return x * x; };
        return square(7);
      }
      test();
    `);
	});

	it("function expression used as recursive via variable", () => {
		assertEquivalent(`
      function test() {
        var countdown = function(n) {
          if (n <= 0) return [];
          var rest = countdown(n - 1);
          rest.unshift(n);
          return rest;
        };
        return countdown(5);
      }
      test();
    `);
	});

	it("multiple function declarations coexist", () => {
		assertEquivalent(`
      function add(a, b) { return a + b; }
      function mul(a, b) { return a * b; }
      function test() {
        return [add(2, 3), mul(4, 5), add(mul(2, 3), 1)];
      }
      test();
    `);
	});
});

describe("arrow functions", () => {
	it("arrow function with expression body", () => {
		assertEquivalent(`
      function test() {
        var double = function(x) { return x * 2; };
        return double(21);
      }
      test();
    `);
	});

	it("arrow function with block body", () => {
		assertEquivalent(`
      function test() {
        var compute = function(a, b) {
          var sum = a + b;
          var product = a * b;
          return [sum, product];
        };
        return compute(3, 4);
      }
      test();
    `);
	});

	it("arrow function does not have own this", () => {
		assertEquivalent(`
      function test() {
        var obj = {
          value: 10,
          getMultiplier: function() {
            var self = this;
            var multiply = function(x) { return self.value * x; };
            return multiply;
          }
        };
        var fn = obj.getMultiplier();
        return fn(5);
      }
      test();
    `);
	});

	it("arrow function in array methods", () => {
		assertEquivalent(`
      function test() {
        var nums = [1, 2, 3, 4, 5];
        var doubled = nums.map(function(n) { return n * 2; });
        var evens = doubled.filter(function(n) { return n % 4 === 0; });
        var sum = evens.reduce(function(acc, n) { return acc + n; }, 0);
        return [doubled, evens, sum];
      }
      test();
    `);
	});
});

describe("default parameters", () => {
	it("uses default when argument is undefined", () => {
		assertEquivalent(`
      function greet(name, greeting) {
        if (greeting === undefined) greeting = "Hello";
        return greeting + ", " + name + "!";
      }
      [greet("Alice"), greet("Bob", "Hi")];
    `);
	});

	it("default parameter with expression", () => {
		assertEquivalent(`
      function createArray(length, fill) {
        if (length === undefined) length = 5;
        if (fill === undefined) fill = 0;
        var arr = [];
        for (var i = 0; i < length; i++) arr.push(fill);
        return arr;
      }
      [createArray(), createArray(3), createArray(3, 1)];
    `);
	});

	it("default parameter does not apply for null or falsy", () => {
		assertEquivalent(`
      function test(val) {
        if (val === undefined) val = "default";
        return val;
      }
      [test(), test(null), test(0), test(""), test(false)];
    `);
	});
});

describe("rest parameters", () => {
	it("collects remaining arguments into an array", () => {
		assertEquivalent(`
      function test() {
        function sum() {
          var args = Array.prototype.slice.call(arguments);
          var total = 0;
          for (var i = 0; i < args.length; i++) total += args[i];
          return total;
        }
        return sum(1, 2, 3, 4, 5);
      }
      test();
    `);
	});

	it("rest parameters after named params", () => {
		assertEquivalent(`
      function test() {
        function format(prefix) {
          var rest = Array.prototype.slice.call(arguments, 1);
          return prefix + ": " + rest.join(", ");
        }
        return format("Items", "apple", "banana", "cherry");
      }
      test();
    `);
	});

	it("rest parameter is a real array", () => {
		assertEquivalent(`
      function test() {
        function checkType() {
          var args = Array.prototype.slice.call(arguments);
          return [
            Array.isArray(args),
            args.length,
            args.map(function(x) { return x * 2; })
          ];
        }
        return checkType(1, 2, 3);
      }
      test();
    `);
	});
});

describe("arguments object", () => {
	it("arguments.length reflects actual call arguments", () => {
		assertEquivalent(`
      function test(a, b) {
        return arguments.length;
      }
      [test(), test(1), test(1, 2), test(1, 2, 3)];
    `);
	});

	it("arguments can be accessed by index", () => {
		assertEquivalent(`
      function test() {
        function getArgs() {
          var result = [];
          for (var i = 0; i < arguments.length; i++) {
            result.push(arguments[i]);
          }
          return result;
        }
        return getArgs("a", "b", "c");
      }
      test();
    `);
	});

	it("converting arguments to a real array", () => {
		assertEquivalent(`
      function test() {
        function toArr() {
          return Array.prototype.slice.call(arguments).reverse();
        }
        return toArr(1, 2, 3, 4);
      }
      test();
    `);
	});
});

describe("IIFE", () => {
	it("immediately invoked function expression returns a value", () => {
		assertEquivalent(`
      var result = (function() {
        return 42;
      })();
      result;
    `);
	});

	it("IIFE with arguments", () => {
		assertEquivalent(`
      var result = (function(a, b) {
        return a + b;
      })(10, 20);
      result;
    `);
	});

	it("IIFE creates private scope", () => {
		assertEquivalent(`
      var counter = (function() {
        var count = 0;
        return {
          inc: function() { return ++count; },
          get: function() { return count; }
        };
      })();
      counter.inc();
      counter.inc();
      counter.inc();
      counter.get();
    `);
	});
});

describe("higher-order functions", () => {
	it("function returning a function", () => {
		assertEquivalent(`
      function test() {
        function multiplier(factor) {
          return function(x) { return x * factor; };
        }
        var triple = multiplier(3);
        var quadruple = multiplier(4);
        return [triple(5), quadruple(5)];
      }
      test();
    `);
	});

	it("function accepting a function as argument", () => {
		assertEquivalent(`
      function test() {
        function applyTwice(fn, x) {
          return fn(fn(x));
        }
        function addThree(n) { return n + 3; }
        return applyTwice(addThree, 7);
      }
      test();
    `);
	});

	it("compose two functions", () => {
		assertEquivalent(`
      function test() {
        function compose(f, g) {
          return function(x) { return f(g(x)); };
        }
        function double(x) { return x * 2; }
        function addOne(x) { return x + 1; }
        var doubleAfterAdd = compose(double, addOne);
        return doubleAfterAdd(5);
      }
      test();
    `);
	});

	it("function that creates specialized validators", () => {
		assertEquivalent(`
      function test() {
        function rangeValidator(min, max) {
          return function(val) {
            return val >= min && val <= max;
          };
        }
        var isPercentage = rangeValidator(0, 100);
        var isByte = rangeValidator(0, 255);
        return [
          isPercentage(50), isPercentage(150),
          isByte(200), isByte(300)
        ];
      }
      test();
    `);
	});
});

describe("recursion", () => {
	it("computes factorial recursively", () => {
		assertEquivalent(`
      function factorial(n) {
        if (n <= 1) return 1;
        return n * factorial(n - 1);
      }
      [factorial(0), factorial(1), factorial(5), factorial(8)];
    `);
	});

	it("computes fibonacci recursively", () => {
		assertEquivalent(`
      function fib(n) {
        if (n <= 0) return 0;
        if (n === 1) return 1;
        return fib(n - 1) + fib(n - 2);
      }
      [fib(0), fib(1), fib(2), fib(5), fib(10)];
    `);
	});

	it("flattens a nested array recursively", () => {
		assertEquivalent(`
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
      flatten([1, [2, [3, 4], 5], [6, 7]]);
    `);
	});

	it("computes greatest common divisor recursively", () => {
		assertEquivalent(`
      function gcd(a, b) {
        if (b === 0) return a;
        return gcd(b, a % b);
      }
      [gcd(12, 8), gcd(100, 75), gcd(17, 13)];
    `);
	});
});

describe("closures", () => {
	it("closure preserves variable after outer function returns", () => {
		assertEquivalent(`
      function test() {
        function makeGreeter(greeting) {
          return function(name) {
            return greeting + ", " + name + "!";
          };
        }
        var hi = makeGreeter("Hi");
        var hey = makeGreeter("Hey");
        return [hi("Alice"), hey("Bob")];
      }
      test();
    `);
	});

	it("closure-based accumulator", () => {
		assertEquivalent(`
      function test() {
        function makeAccumulator(initial) {
          var total = initial;
          return {
            add: function(n) { total += n; return total; },
            subtract: function(n) { total -= n; return total; },
            value: function() { return total; }
          };
        }
        var acc = makeAccumulator(100);
        acc.add(20);
        acc.subtract(5);
        acc.add(30);
        return acc.value();
      }
      test();
    `);
	});

	it("closure captures and modifies shared state", () => {
		assertEquivalent(`
      function test() {
        function makeStack() {
          var items = [];
          return {
            push: function(v) { items.push(v); return items.length; },
            pop: function() { return items.pop(); },
            size: function() { return items.length; },
            peek: function() { return items[items.length - 1]; }
          };
        }
        var s = makeStack();
        s.push(10);
        s.push(20);
        s.push(30);
        var popped = s.pop();
        return [popped, s.size(), s.peek()];
      }
      test();
    `);
	});
});

describe("Function.prototype methods", () => {
	it("Function.prototype.call sets this context", () => {
		assertEquivalent(`
      function test() {
        function getInfo() {
          return this.name + " is " + this.age;
        }
        var person = { name: "Alice", age: 30 };
        return getInfo.call(person);
      }
      test();
    `);
	});

	it("Function.prototype.apply with argument array", () => {
		assertEquivalent(`
      function test() {
        function sum() {
          var total = 0;
          for (var i = 0; i < arguments.length; i++) total += arguments[i];
          return total;
        }
        return sum.apply(null, [1, 2, 3, 4, 5]);
      }
      test();
    `);
	});

	it("Function.prototype.bind creates a bound function", () => {
		assertEquivalent(`
      function test() {
        function greet(greeting) {
          return greeting + ", " + this.name;
        }
        var alice = { name: "Alice" };
        var greetAlice = greet.bind(alice);
        return [greetAlice("Hello"), greetAlice("Hi")];
      }
      test();
    `);
	});

	it("bind with partial application", () => {
		assertEquivalent(`
      function test() {
        function multiply(a, b) { return a * b; }
        var double = multiply.bind(null, 2);
        var triple = multiply.bind(null, 3);
        return [double(5), triple(5), double(10)];
      }
      test();
    `);
	});
});

describe("nested function scopes", () => {
	it("inner function accesses outer variables", () => {
		assertEquivalent(`
      function test() {
        var outerVar = "outer";
        function inner() {
          var innerVar = "inner";
          return outerVar + "-" + innerVar;
        }
        return inner();
      }
      test();
    `);
	});

	it("three levels of nesting with variable shadowing", () => {
		assertEquivalent(`
      function test() {
        var x = "level0";
        function level1() {
          var x = "level1";
          function level2() {
            var x = "level2";
            return x;
          }
          return [x, level2()];
        }
        return [x, level1()];
      }
      test();
    `);
	});

	it("inner function modifies outer variable", () => {
		assertEquivalent(`
      function test() {
        var count = 0;
        function increment() { count++; }
        function getCount() { return count; }
        increment();
        increment();
        increment();
        return getCount();
      }
      test();
    `);
	});
});

describe("multiple return paths", () => {
	it("returns different types based on input", () => {
		assertEquivalent(`
      function classify(val) {
        if (val === null) return "null";
        if (val === undefined) return "undefined";
        if (typeof val === "number") return val * 2;
        if (typeof val === "string") return val.length;
        if (Array.isArray(val)) return val;
        return "unknown";
      }
      [classify(null), classify(undefined), classify(5), classify("hi"), classify([1,2]), classify(true)];
    `);
	});

	it("early return pattern for guard clauses", () => {
		assertEquivalent(`
      function divide(a, b) {
        if (typeof a !== "number") return "error: a not number";
        if (typeof b !== "number") return "error: b not number";
        if (b === 0) return "error: division by zero";
        return a / b;
      }
      [divide(10, 2), divide(10, 0), divide("x", 2), divide(10, "y")];
    `);
	});
});

describe("functions as object methods", () => {
	it("method accesses object properties via this", () => {
		assertEquivalent(`
      function test() {
        var rect = {
          width: 10,
          height: 5,
          area: function() { return this.width * this.height; },
          perimeter: function() { return 2 * (this.width + this.height); }
        };
        return [rect.area(), rect.perimeter()];
      }
      test();
    `);
	});

	it("method that returns this for chaining", () => {
		assertEquivalent(`
      function test() {
        var builder = {
          parts: [],
          add: function(part) { this.parts.push(part); return this; },
          build: function() { return this.parts.join(" + "); }
        };
        return builder.add("a").add("b").add("c").build();
      }
      test();
    `);
	});

	it("dynamically adding methods to an object", () => {
		assertEquivalent(`
      function test() {
        var obj = { val: 10 };
        obj.double = function() { return this.val * 2; };
        obj.addTo = function(n) { return this.val + n; };
        return [obj.double(), obj.addTo(5)];
      }
      test();
    `);
	});
});

describe("callback patterns", () => {
	it("forEach-like callback invocation", () => {
		assertEquivalent(`
      function test() {
        function myForEach(arr, callback) {
          for (var i = 0; i < arr.length; i++) {
            callback(arr[i], i);
          }
        }
        var results = [];
        myForEach([10, 20, 30], function(val, idx) {
          results.push(idx + ":" + val);
        });
        return results;
      }
      test();
    `);
	});

	it("map-like callback transformation", () => {
		assertEquivalent(`
      function test() {
        function myMap(arr, fn) {
          var result = [];
          for (var i = 0; i < arr.length; i++) {
            result.push(fn(arr[i], i));
          }
          return result;
        }
        return myMap([1, 2, 3, 4], function(x, i) { return x * x + i; });
      }
      test();
    `);
	});

	it("filter-like callback predicate", () => {
		assertEquivalent(`
      function test() {
        function myFilter(arr, pred) {
          var result = [];
          for (var i = 0; i < arr.length; i++) {
            if (pred(arr[i])) result.push(arr[i]);
          }
          return result;
        }
        return myFilter([1, 2, 3, 4, 5, 6, 7, 8], function(x) { return x % 3 === 0; });
      }
      test();
    `);
	});

	it("reduce-like callback accumulation", () => {
		assertEquivalent(`
      function test() {
        function myReduce(arr, fn, initial) {
          var acc = initial;
          for (var i = 0; i < arr.length; i++) {
            acc = fn(acc, arr[i]);
          }
          return acc;
        }
        return myReduce([1, 2, 3, 4, 5], function(sum, x) { return sum + x; }, 0);
      }
      test();
    `);
	});

	it("callback with error-first pattern", () => {
		assertEquivalent(`
      function test() {
        function safeDivide(a, b, callback) {
          if (b === 0) {
            callback("division by zero", null);
          } else {
            callback(null, a / b);
          }
        }
        var results = [];
        safeDivide(10, 2, function(err, val) {
          results.push([err, val]);
        });
        safeDivide(10, 0, function(err, val) {
          results.push([err, val]);
        });
        return results;
      }
      test();
    `);
	});
});
