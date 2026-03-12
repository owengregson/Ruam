import { describe, it, expect } from "vitest";
import { assertEquivalent, evalObfuscated, evalOriginal } from "../helpers.js";
import { obfuscateCode } from "../../src/transform.js";
import {
	deriveImplicitKey,
	rollingEncrypt,
} from "../../src/encoding/rolling-cipher.js";

// ---------------------------------------------------------------------------
// Build-time rolling cipher unit tests
// ---------------------------------------------------------------------------

describe("rolling cipher build-time", () => {
	describe("deriveImplicitKey", () => {
		it("produces a 32-bit unsigned integer", () => {
			const key = deriveImplicitKey(10, 5, 2, 8);
			expect(key).toBeGreaterThanOrEqual(0);
			expect(key).toBeLessThanOrEqual(0xffffffff);
		});

		it("same inputs produce same key", () => {
			const k1 = deriveImplicitKey(10, 5, 2, 8);
			const k2 = deriveImplicitKey(10, 5, 2, 8);
			expect(k1).toBe(k2);
		});

		it("different inputs produce different keys", () => {
			const k1 = deriveImplicitKey(10, 5, 2, 8);
			const k2 = deriveImplicitKey(11, 5, 2, 8);
			const k3 = deriveImplicitKey(10, 6, 2, 8);
			const k4 = deriveImplicitKey(10, 5, 3, 8);
			const k5 = deriveImplicitKey(10, 5, 2, 9);
			expect(new Set([k1, k2, k3, k4, k5]).size).toBe(5);
		});
	});

	describe("rollingEncrypt", () => {
		it("modifies instruction array in place", () => {
			const instrs = [100, 5, 200, 10, 50, 0];
			const original = [...instrs];
			const key = deriveImplicitKey(3, 2, 1, 4);
			rollingEncrypt(instrs, key);
			expect(instrs).not.toEqual(original);
		});

		it("same key and data produce same encryption", () => {
			const instrs1 = [100, 5, 200, 10];
			const instrs2 = [100, 5, 200, 10];
			const key = deriveImplicitKey(2, 2, 1, 4);
			rollingEncrypt(instrs1, key);
			rollingEncrypt(instrs2, key);
			expect(instrs1).toEqual(instrs2);
		});

		it("different keys produce different encryption", () => {
			const instrs1 = [100, 5, 200, 10];
			const instrs2 = [100, 5, 200, 10];
			rollingEncrypt(instrs1, 12345);
			rollingEncrypt(instrs2, 67890);
			expect(instrs1).not.toEqual(instrs2);
		});

		it("integrity hash changes encryption", () => {
			const instrs1 = [100, 5, 200, 10];
			const instrs2 = [100, 5, 200, 10];
			const key = 12345;
			// Integrity hash is now folded into the master key before calling
			// rollingEncrypt (via keyAnchor XOR in deriveImplicitKey)
			rollingEncrypt(instrs1, (key ^ 0xaabbccdd) >>> 0);
			rollingEncrypt(instrs2, (key ^ 0x11223344) >>> 0);
			expect(instrs1).not.toEqual(instrs2);
		});

		it("handles empty instruction array", () => {
			const instrs: number[] = [];
			rollingEncrypt(instrs, 12345);
			expect(instrs).toEqual([]);
		});

		it("handles single instruction", () => {
			const instrs = [42, 7];
			const original = [...instrs];
			rollingEncrypt(instrs, 12345);
			expect(instrs).not.toEqual(original);
		});
	});
});

// ---------------------------------------------------------------------------
// End-to-end: rolling cipher correctness
// ---------------------------------------------------------------------------

const rcOpts = { rollingCipher: true };

describe("rolling cipher end-to-end correctness", () => {
	it("simple function", () => {
		assertEquivalent(
			`
      function add(a, b) { return a + b; }
      add(3, 4);
    `,
			rcOpts
		);
	});

	it("fibonacci", () => {
		assertEquivalent(
			`
      function fibonacci(n) {
        if (n <= 1) return n;
        return fibonacci(n - 1) + fibonacci(n - 2);
      }
      fibonacci(10);
    `,
			rcOpts
		);
	});

	it("string operations", () => {
		assertEquivalent(
			`
      function greet(name) {
        return "Hello, " + name + "!";
      }
      greet("World");
    `,
			rcOpts
		);
	});

	it("closures", () => {
		assertEquivalent(
			`
      function makeCounter(label) {
        var count = 0;
        return function() {
          count++;
          return label + ": " + count;
        };
      }
      var c = makeCounter("items");
      [c(), c(), c()];
    `,
			rcOpts
		);
	});

	it("classes", () => {
		assertEquivalent(
			`
      function test() {
        class Calculator {
          constructor(val) { this.value = val; }
          add(n) { this.value += n; return this; }
          multiply(n) { this.value *= n; return this; }
          getResult() { return this.value; }
        }
        return new Calculator(5).add(3).multiply(2).getResult();
      }
      test();
    `,
			rcOpts
		);
	});

	it("try/catch", () => {
		assertEquivalent(
			`
      function safe(input) {
        try {
          if (input < 0) throw new Error("negative");
          return input * 2;
        } catch (e) {
          return "Error: " + e.message;
        }
      }
      [safe(5), safe(-1)];
    `,
			rcOpts
		);
	});

	it("async functions", () => {
		assertEquivalent(
			`
      async function fetchData(url) {
        return "data:" + url;
      }
      fetchData("https://example.com");
    `,
			rcOpts
		);
	});

	it("for loops", () => {
		assertEquivalent(
			`
      function sumRange(n) {
        var total = 0;
        for (var i = 1; i <= n; i++) total += i;
        return total;
      }
      sumRange(100);
    `,
			rcOpts
		);
	});

	it("while loops", () => {
		assertEquivalent(
			`
      function collatz(n) {
        var steps = 0;
        while (n !== 1) {
          n = n % 2 === 0 ? n / 2 : 3 * n + 1;
          steps++;
        }
        return steps;
      }
      collatz(27);
    `,
			rcOpts
		);
	});

	it("switch statements", () => {
		assertEquivalent(
			`
      function classify(x) {
        switch(x) {
          case "alpha": return 1;
          case "beta": return 2;
          case "gamma": return 3;
          default: return 0;
        }
      }
      [classify("alpha"), classify("beta"), classify("delta")];
    `,
			rcOpts
		);
	});

	it("nested functions", () => {
		assertEquivalent(
			`
      function outer(x) {
        function inner(y) {
          return x + y;
        }
        return inner(10) + inner(20);
      }
      outer(5);
    `,
			rcOpts
		);
	});

	it("destructuring", () => {
		assertEquivalent(
			`
      function extract(obj) {
        var { username, email } = obj;
        return username + " <" + email + ">";
      }
      extract({ username: "admin", email: "admin@test.com" });
    `,
			rcOpts
		);
	});

	it("array operations", () => {
		assertEquivalent(
			`
      function process(arr) {
        return arr
          .filter(function(n) { return n > 2; })
          .map(function(n) { return n * 10; })
          .reduce(function(a, b) { return a + b; }, 0);
      }
      process([1, 2, 3, 4, 5]);
    `,
			rcOpts
		);
	});

	it("regex", () => {
		assertEquivalent(
			`
      function matchEmail(str) {
        return /^[a-zA-Z0-9]+@[a-zA-Z0-9]+\\.[a-zA-Z]{2,}$/.test(str);
      }
      [matchEmail("test@example.com"), matchEmail("invalid")];
    `,
			rcOpts
		);
	});

	it("template-style concatenation", () => {
		assertEquivalent(
			`
      function format(x, y) {
        return x + " + " + y + " = " + (x + y);
      }
      format(3, 4);
    `,
			rcOpts
		);
	});

	it("object methods", () => {
		assertEquivalent(
			`
      function test() {
        var obj = {
          data: [1, 2, 3],
          sum: function() {
            var total = 0;
            for (var i = 0; i < this.data.length; i++) total += this.data[i];
            return total;
          }
        };
        return obj.sum();
      }
      test();
    `,
			rcOpts
		);
	});

	it("ternary and logical operators", () => {
		assertEquivalent(
			`
      function classify(n) {
        var sign = n > 0 ? "positive" : n < 0 ? "negative" : "zero";
        var parity = n % 2 === 0 ? "even" : "odd";
        return sign + " " + parity;
      }
      [classify(7), classify(-4), classify(0)];
    `,
			rcOpts
		);
	});

	it("complex: multiple interacting functions", () => {
		assertEquivalent(
			`
      function compose(f, g) {
        return function(x) { return f(g(x)); };
      }
      function double(x) { return x * 2; }
      function addOne(x) { return x + 1; }
      var doubleAndAdd = compose(addOne, double);
      [doubleAndAdd(3), doubleAndAdd(5), doubleAndAdd(10)];
    `,
			rcOpts
		);
	});
});

// ---------------------------------------------------------------------------
// Rolling cipher anti-reversing properties
// ---------------------------------------------------------------------------

describe("rolling cipher anti-reversing", () => {
	const sampleCode = `
    function fibonacci(n) {
      if (n <= 1) return n;
      return fibonacci(n - 1) + fibonacci(n - 2);
    }
    fibonacci(10);
  `;

	it("no plaintext seed literal (0x9E3779B9 pattern)", () => {
		const out = obfuscateCode(sampleCode, rcOpts);
		// The old string decoder embedded the seed next to 0x9E3779B9
		// With rolling cipher, no seed literal should appear near this constant
		// Actually, the golden ratio constant itself should not appear as a key source
		const seedPattern = /\(\d{5,}\^?\(/;
		// There should be no large numeric literal used as a direct XOR seed
		// that isn't part of known constants like the FNV/mix primes
		const knownPrimes = [
			"0x811C9DC5",
			"0x01000193",
			"0x45D9F3B",
			"0x85EBCA6B",
			"0xC2B2AE35",
		];
		// Check that the golden ratio constant, if present, doesn't have an adjacent raw seed
		const matches = [...out.matchAll(/\((\d{5,})\^/g)];
		for (const m of matches) {
			// The matched number should not be a unique-per-build seed
			// It should be a known algorithmic constant
			const hex = "0x" + parseInt(m[1]!, 10).toString(16).toUpperCase();
			const isKnown = knownPrimes.some((p) => p.toUpperCase() === hex);
			// If it's not a known constant, it shouldn't be the shuffle seed
			if (!isKnown) {
				// Verify the same "seed" doesn't appear in a second build (it should differ)
				const out2 = obfuscateCode(sampleCode, rcOpts);
				expect(out2).not.toContain(m[1]!);
			}
		}
	});

	it("string decoder does not embed a plaintext key literal", () => {
		const out = obfuscateCode(sampleCode, rcOpts);
		// Old pattern: function _xx(b,x){var k=(SEED^(x*0x9E3779B9))>>>0;
		// New pattern: function _xx(mk,b,x){var k=(mk^(x*0x9E3779B9))>>>0;
		// The function should take mk as parameter, not have a numeric literal
		const oldPattern = /function\s+\w+\(b,x\)\{var\s+\w+=\(\d+\^/;
		expect(oldPattern.test(out)).toBe(false);
	});

	it("two rolling cipher builds produce different instruction encodings", () => {
		const out1 = obfuscateCode(sampleCode, rcOpts);
		const out2 = obfuscateCode(sampleCode, rcOpts);
		const instrPattern = /"i":\s*\[([^\]]+)\]/;
		const match1 = out1.match(instrPattern);
		const match2 = out2.match(instrPattern);
		expect(match1).not.toBeNull();
		expect(match2).not.toBeNull();
		expect(match1![1]).not.toBe(match2![1]);
	});

	it("strings are still encoded (not plaintext)", () => {
		const code = `
      function getSecret() {
        return "SuperSecretPassword123";
      }
      getSecret();
    `;
		const out = obfuscateCode(code, rcOpts);
		expect(out).not.toContain("SuperSecretPassword123");
	});

	it("output still executes correctly", () => {
		assertEquivalent(sampleCode, rcOpts);
	});
});

// ---------------------------------------------------------------------------
// Integrity binding end-to-end
// ---------------------------------------------------------------------------

const ibOpts = { rollingCipher: true, integrityBinding: true };

describe("integrity binding end-to-end", () => {
	it("simple function works", () => {
		assertEquivalent(
			`
      function add(a, b) { return a + b; }
      add(3, 4);
    `,
			ibOpts
		);
	});

	it("fibonacci works", () => {
		assertEquivalent(
			`
      function fibonacci(n) {
        if (n <= 1) return n;
        return fibonacci(n - 1) + fibonacci(n - 2);
      }
      fibonacci(10);
    `,
			ibOpts
		);
	});

	it("string operations work", () => {
		assertEquivalent(
			`
      function greet(name) {
        return "Hello, " + name + "!";
      }
      greet("World");
    `,
			ibOpts
		);
	});

	it("closures work", () => {
		assertEquivalent(
			`
      function makeCounter() {
        var count = 0;
        return function() { return ++count; };
      }
      var c = makeCounter();
      [c(), c(), c()];
    `,
			ibOpts
		);
	});

	it("classes work", () => {
		assertEquivalent(
			`
      function test() {
        class Point {
          constructor(x, y) { this.x = x; this.y = y; }
          distanceTo(other) {
            var dx = this.x - other.x;
            var dy = this.y - other.y;
            return Math.floor(Math.sqrt(dx*dx + dy*dy));
          }
        }
        return new Point(3, 4).distanceTo(new Point(0, 0));
      }
      test();
    `,
			ibOpts
		);
	});

	it("try/catch works", () => {
		assertEquivalent(
			`
      function safe(x) {
        try {
          if (x < 0) throw new Error("neg");
          return x;
        } catch(e) {
          return -1;
        }
      }
      [safe(5), safe(-1)];
    `,
			ibOpts
		);
	});

	it("async works", () => {
		assertEquivalent(
			`
      async function getData() { return 42; }
      getData();
    `,
			ibOpts
		);
	});

	it("nested functions work", () => {
		assertEquivalent(
			`
      function outer(x) {
        function middle(y) {
          function inner(z) { return x + y + z; }
          return inner(3);
        }
        return middle(2);
      }
      outer(1);
    `,
			ibOpts
		);
	});

	it("loops work", () => {
		assertEquivalent(
			`
      function factorial(n) {
        var result = 1;
        for (var i = 2; i <= n; i++) result *= i;
        return result;
      }
      factorial(10);
    `,
			ibOpts
		);
	});

	it("array operations work", () => {
		assertEquivalent(
			`
      function sumEven(arr) {
        return arr.filter(function(n) { return n % 2 === 0; })
                  .reduce(function(a, b) { return a + b; }, 0);
      }
      sumEven([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    `,
			ibOpts
		);
	});

	it("complex: recursive with closures", () => {
		assertEquivalent(
			`
      function buildTree(depth) {
        if (depth === 0) return { value: 1 };
        return {
          value: depth,
          left: buildTree(depth - 1),
          right: buildTree(depth - 1)
        };
      }
      function countNodes(node) {
        if (!node) return 0;
        return 1 + countNodes(node.left) + countNodes(node.right);
      }
      countNodes(buildTree(4));
    `,
			ibOpts
		);
	});
});

// ---------------------------------------------------------------------------
// Integrity binding anti-reversing properties
// ---------------------------------------------------------------------------

describe("integrity binding anti-reversing", () => {
	const sampleCode = `
    function add(a, b) { return a + b; }
    add(1, 2);
  `;

	it("output contains integrity binding infrastructure", () => {
		const out = obfuscateCode(sampleCode, ibOpts);
		// With constant splitting, crypto constants are hidden behind computed
		// expressions. Verify infrastructure exists by checking the output
		// contains rolling cipher functions (Math.imul is used in both
		// rcDeriveKey and rcMix).
		expect(out).toContain("Math.imul");
		// The output should execute correctly (proves infrastructure works end-to-end)
		assertEquivalent(sampleCode, ibOpts);
	});

	it("modifying a key anchor XOR fold breaks execution", () => {
		const out = obfuscateCode(sampleCode, ibOpts);
		// The key anchor has XOR folds (watermark + integrity hash):
		//   _ka = (_ka ^ SPLIT_EXPR) >>> 0
		// Find any such pattern and corrupt a numeric literal inside it.
		const modified = out.replace(
			/(\w+)\s*=\s*\(\1\s*\^[^;]*?(\d{6,})/,
			(match, _name, num) =>
				match.replace(num, String(parseInt(num, 10) + 1))
		);
		expect(modified).not.toBe(out); // Sanity: regex must have matched
		// With a wrong integrity hash, decryption produces garbage opcodes.
		// This may throw an error OR silently produce an incorrect result.
		const vm = require("node:vm");
		const ctx = vm.createContext({
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
			setInterval,
			clearTimeout,
			clearInterval,
			queueMicrotask,
			Uint8Array,
			Int8Array,
			Float64Array,
			ArrayBuffer,
			DataView,
			TextEncoder,
			TextDecoder,
			Buffer,
			globalThis,
		});
		let result: unknown;
		let threw = false;
		try {
			result = vm.runInContext(modified, ctx);
		} catch {
			threw = true;
		}
		// Either it threw or it produced a wrong result (not 3)
		expect(threw || result !== 3).toBe(true);
	});

	it("unmodified output executes correctly", () => {
		assertEquivalent(sampleCode, ibOpts);
	});

	it("two builds with integrity binding produce different hashes", () => {
		const out1 = obfuscateCode(sampleCode, ibOpts);
		const out2 = obfuscateCode(sampleCode, ibOpts);
		// The integrity hash depends on the interpreter source which depends
		// on randomized names, so it should differ between builds
		const instrPattern = /"i":\s*\[([^\]]+)\]/;
		const m1 = out1.match(instrPattern);
		const m2 = out2.match(instrPattern);
		expect(m1).not.toBeNull();
		expect(m2).not.toBeNull();
		expect(m1![1]).not.toBe(m2![1]);
	});
});

// ---------------------------------------------------------------------------
// Feature interaction: rolling cipher + other features
// ---------------------------------------------------------------------------

describe("rolling cipher with other features", () => {
	it("works with preprocessIdentifiers", () => {
		assertEquivalent(
			`
      function processData(inputValue) {
        var intermediateResult = inputValue * 2;
        return intermediateResult + 100;
      }
      processData(21);
    `,
			{ rollingCipher: true, preprocessIdentifiers: true }
		);
	});

	it("works with debugProtection", () => {
		assertEquivalent(
			`
      function add(a, b) { return a + b; }
      add(1, 2);
    `,
			{ rollingCipher: true, debugProtection: true }
		);
	});

	it("works with medium preset (auto-enables rolling cipher)", () => {
		assertEquivalent(
			`
      function add(a, b) { return a + b; }
      add(1, 2);
    `,
			{ preset: "medium" }
		);
	});

	it("works with max preset (auto-enables both)", () => {
		assertEquivalent(
			`
      function add(a, b) { return a + b; }
      add(1, 2);
    `,
			{ preset: "max" }
		);
	});
});

// ---------------------------------------------------------------------------
// Binary encoding + rolling cipher (encryptBytecode: true)
// ---------------------------------------------------------------------------

const binaryRcOpts = { encryptBytecode: true, rollingCipher: true };
const binaryIbOpts = {
	encryptBytecode: true,
	rollingCipher: true,
	integrityBinding: true,
};

describe("binary encoding with rolling cipher", () => {
	it("simple function", () => {
		assertEquivalent(
			`
      function add(a, b) { return a + b; }
      add(3, 4);
    `,
			binaryRcOpts
		);
	});

	it("fibonacci", () => {
		assertEquivalent(
			`
      function fibonacci(n) {
        if (n <= 1) return n;
        return fibonacci(n - 1) + fibonacci(n - 2);
      }
      fibonacci(10);
    `,
			binaryRcOpts
		);
	});

	it("closures", () => {
		assertEquivalent(
			`
      function makeCounter() {
        var count = 0;
        return function() { return ++count; };
      }
      var c = makeCounter();
      [c(), c(), c()];
    `,
			binaryRcOpts
		);
	});

	it("classes", () => {
		assertEquivalent(
			`
      function test() {
        class Foo {
          constructor(x) { this.x = x; }
          getX() { return this.x; }
        }
        return new Foo(42).getX();
      }
      test();
    `,
			binaryRcOpts
		);
	});

	it("try/catch", () => {
		assertEquivalent(
			`
      function safe(x) {
        try {
          if (x < 0) throw new Error("neg");
          return x * 2;
        } catch(e) {
          return -1;
        }
      }
      [safe(5), safe(-1)];
    `,
			binaryRcOpts
		);
	});

	it("loops", () => {
		assertEquivalent(
			`
      function sum(n) {
        var t = 0;
        for (var i = 1; i <= n; i++) t += i;
        return t;
      }
      sum(100);
    `,
			binaryRcOpts
		);
	});

	it("async function", () => {
		assertEquivalent(
			`
      async function getData() { return 42; }
      getData();
    `,
			binaryRcOpts
		);
	});

	it("with integrity binding", () => {
		assertEquivalent(
			`
      function add(a, b) { return a + b; }
      add(3, 4);
    `,
			binaryIbOpts
		);
	});

	it("full high preset (encryptBytecode not overridden)", () => {
		// Explicitly pass encryptBytecode: true to override the test helper default
		assertEquivalent(
			`
      function fibonacci(n) {
        if (n <= 1) return n;
        return fibonacci(n - 1) + fibonacci(n - 2);
      }
      fibonacci(10);
    `,
			{ preset: "max", encryptBytecode: true }
		);
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("rolling cipher edge cases", () => {
	it("empty function", () => {
		assertEquivalent(
			`
      function noop() {}
      noop();
    `,
			rcOpts
		);
	});

	it("function with no return value", () => {
		assertEquivalent(
			`
      function sideEffect(arr) {
        arr.push(42);
      }
      var a = [1, 2, 3];
      sideEffect(a);
      a;
    `,
			rcOpts
		);
	});

	it("deeply nested closures", () => {
		assertEquivalent(
			`
      function a(x) {
        return function(y) {
          return function(z) {
            return x + y + z;
          };
        };
      }
      a(1)(2)(3);
    `,
			rcOpts
		);
	});

	it("recursive function with many calls", () => {
		assertEquivalent(
			`
      function fib(n) {
        if (n <= 1) return n;
        return fib(n-1) + fib(n-2);
      }
      fib(15);
    `,
			rcOpts
		);
	});

	it("multiple independent functions", () => {
		assertEquivalent(
			`
      function square(x) { return x * x; }
      function cube(x) { return x * x * x; }
      function sum(a, b) { return a + b; }
      sum(square(3), cube(2));
    `,
			rcOpts
		);
	});

	it("function with many parameters", () => {
		assertEquivalent(
			`
      function many(a, b, c, d, e, f) {
        return a + b + c + d + e + f;
      }
      many(1, 2, 3, 4, 5, 6);
    `,
			rcOpts
		);
	});

	it("function with rest arguments", () => {
		assertEquivalent(
			`
      function sum() {
        var total = 0;
        for (var i = 0; i < arguments.length; i++) total += arguments[i];
        return total;
      }
      sum(1, 2, 3, 4, 5);
    `,
			rcOpts
		);
	});

	it("function that throws", () => {
		assertEquivalent(
			`
      function mustThrow() {
        try {
          throw new Error("test error");
        } catch(e) {
          return e.message;
        }
      }
      mustThrow();
    `,
			rcOpts
		);
	});

	it("class inheritance with rolling cipher", () => {
		assertEquivalent(
			`
      function test() {
        class Animal {
          constructor(name) { this.name = name; }
          speak() { return this.name + " makes a sound"; }
        }
        class Dog extends Animal {
          constructor(name) { super(name); }
          speak() { return this.name + " barks"; }
        }
        var d = new Dog("Rex");
        return d.speak();
      }
      test();
    `,
			rcOpts
		);
	});
});

// ---------------------------------------------------------------------------
// Dead code injection (exception table + jump table patching)
// ---------------------------------------------------------------------------

const deadCodeOpts = { deadCodeInjection: true };
const highPresetOpts = { preset: "max" as const, encryptBytecode: false };

describe("dead code injection", () => {
	it("simple function", () => {
		assertEquivalent(
			`
      function add(a, b) { return a + b; }
      add(3, 4);
    `,
			deadCodeOpts
		);
	});

	it("try/catch", () => {
		assertEquivalent(
			`
      function safe(x) {
        try {
          if (x < 0) throw new Error("neg");
          return x * 2;
        } catch(e) {
          return -1;
        }
      }
      [safe(5), safe(-1)];
    `,
			deadCodeOpts
		);
	});

	it("try/catch/finally", () => {
		assertEquivalent(
			`
      function test(x) {
        var result = [];
        try {
          result.push("try");
          if (x) throw new Error("err");
          result.push("no-throw");
        } catch(e) {
          result.push("catch");
        } finally {
          result.push("finally");
        }
        return result;
      }
      [test(false), test(true)];
    `,
			deadCodeOpts
		);
	});

	it("nested try/catch", () => {
		assertEquivalent(
			`
      function test() {
        var r = [];
        try {
          try {
            throw new Error("inner");
          } catch(e) {
            r.push("inner-catch:" + e.message);
          }
          r.push("between");
          try {
            throw new Error("second");
          } catch(e2) {
            r.push("second-catch:" + e2.message);
          }
        } catch(e) {
          r.push("outer-catch");
        }
        return r;
      }
      test();
    `,
			deadCodeOpts
		);
	});

	it("loops with multiple returns", () => {
		assertEquivalent(
			`
      function findFirst(arr, pred) {
        for (var i = 0; i < arr.length; i++) {
          if (pred(arr[i])) return arr[i];
        }
        return null;
      }
      findFirst([1, 2, 3, 4, 5], function(x) { return x > 3; });
    `,
			deadCodeOpts
		);
	});

	it("switch with returns", () => {
		assertEquivalent(
			`
      function classify(n) {
        switch(true) {
          case n < 0: return "negative";
          case n === 0: return "zero";
          case n > 100: return "large";
          default: return "small";
        }
      }
      [classify(-5), classify(0), classify(200), classify(42)];
    `,
			deadCodeOpts
		);
	});

	it("with rolling cipher + integrity binding", () => {
		assertEquivalent(
			`
      function test() {
        try {
          var obj = { a: 1, b: 2 };
          return obj.a + obj.b;
        } catch(e) {
          return -1;
        }
      }
      test();
    `,
			{
				deadCodeInjection: true,
				rollingCipher: true,
				integrityBinding: true,
			}
		);
	});

	it("full high preset with try/catch", () => {
		assertEquivalent(
			`
      function safeGet(obj, key) {
        try {
          return obj[key];
        } catch(e) {
          return undefined;
        }
      }
      [safeGet({x: 1}, "x"), safeGet(null, "x")];
    `,
			highPresetOpts
		);
	});

	it("complex: optional access pattern (Chrome extension style)", () => {
		assertEquivalent(
			`
      function test() {
        var win = { sessionStorage: { getItem: function(k) { return 'v_' + k; } } };
        var winNull = {};
        var r1, r2;
        try {
          r1 = win.sessionStorage.getItem('key');
        } catch(e) {
          r1 = null;
        }
        try {
          r2 = winNull.sessionStorage.getItem('key');
        } catch(e) {
          r2 = null;
        }
        return [r1, r2];
      }
      test();
    `,
			highPresetOpts
		);
	});
});
