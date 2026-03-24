import { describe, it, expect } from "bun:test";
import { assertEquivalent } from "../helpers.js";
import { obfuscateCode } from "../../src/transform.js";

/**
 * Tests verifying that the obfuscated output resists reverse engineering.
 *
 * These tests ensure that:
 * 1. No plaintext reverse opcode map is present
 * 2. String constants are not in plaintext
 * 3. The interpreter uses function table dispatch (not a giant switch)
 * 4. Different builds produce different handler structures
 * 5. The output still executes correctly
 */
describe("anti-reversing properties", () => {
	const sampleCode = `
    function fibonacci(n) {
      if (n <= 1) return n;
      return fibonacci(n - 1) + fibonacci(n - 2);
    }
    fibonacci(10);
  `;

	describe("no plaintext reverse opcode map", () => {
		it("output does not contain a large numeric array (reverse map)", () => {
			const out = obfuscateCode(sampleCode);
			// The old reverse map was an array of ~279 numbers like [234,17,89,...]
			// Check that no such array exists in the output
			const largeArrayPattern = /var\s+\w+\s*=\s*\[(\d+,){50,}\d+\]/;
			expect(largeArrayPattern.test(out)).toBe(false);
		});

		it("output does not contain sequential opcode numbers 0-278", () => {
			const out = obfuscateCode(sampleCode);
			// The logical opcodes 0-278 should not appear as a contiguous mapping
			// If someone reconstructed the reverse map, it would contain all numbers 0-278
			const hasSequentialMap = /\[(\d+,){278}\d+\]/.test(out);
			expect(hasSequentialMap).toBe(false);
		});
	});

	describe("no plaintext string constants", () => {
		it("function body strings are encoded", () => {
			const code = `
        function getSecret() {
          var secretKey = "SuperSecretPassword123";
          var apiEndpoint = "https://api.example.com/v2/auth";
          return secretKey + "|" + apiEndpoint;
        }
        getSecret();
      `;
			const out = obfuscateCode(code);
			expect(out).not.toContain("SuperSecretPassword123");
			expect(out).not.toContain("https://api.example.com/v2/auth");
		});

		it("variable names used inside functions are encoded", () => {
			const code = `
        function processData() {
          var customerDatabase = {};
          var encryptionKey = "abc";
          var authorizationToken = "xyz";
          return [customerDatabase, encryptionKey, authorizationToken];
        }
        processData();
      `;
			const out = obfuscateCode(code);
			expect(out).not.toContain("customerDatabase");
			expect(out).not.toContain("encryptionKey");
			expect(out).not.toContain("authorizationToken");
		});

		it("method and property names are encoded", () => {
			const code = `
        function buildConfig() {
          var config = {
            databaseHost: "localhost",
            databasePort: 5432,
            enableLogging: true
          };
          return config.databaseHost;
        }
        buildConfig();
      `;
			const out = obfuscateCode(code);
			expect(out).not.toContain("databaseHost");
			expect(out).not.toContain("databasePort");
			expect(out).not.toContain("enableLogging");
		});
	});

	describe("per-build uniqueness", () => {
		it("two builds produce different handler group structures", () => {
			const out1 = obfuscateCode(sampleCode);
			const out2 = obfuscateCode(sampleCode);

			// With function table dispatch, handlers are anonymous closures
			// in group arrays. Extract the handler function bodies.
			const fnPattern = /function\s*\(/g;
			const fns1 = [...out1.matchAll(fnPattern)];
			const fns2 = [...out2.matchAll(fnPattern)];

			// Both should have many handler functions (one per opcode)
			expect(fns1.length).toBeGreaterThan(50);
			expect(fns2.length).toBeGreaterThan(50);

			// The outputs should differ overall (different seeds → names, etc.)
			expect(out1).not.toEqual(out2);
		});

		it("two builds produce different variable names", () => {
			const out1 = obfuscateCode(sampleCode);
			const out2 = obfuscateCode(sampleCode);

			// Extract all short identifiers (var declarations and function names)
			// Use var pattern because structural choices may convert FnDecl→var=FnExpr,
			// changing the function keyword count between builds.
			const varPattern = /var ([_a-z][_a-z0-9]*)/g;
			const vars1 = [...out1.matchAll(varPattern)].map((m) => m[1]);
			const vars2 = [...out2.matchAll(varPattern)].map((m) => m[1]);

			// Both should have many variable declarations
			expect(vars1.length).toBeGreaterThan(10);
			expect(vars2.length).toBeGreaterThan(10);

			// The variable names should differ (different CSPRNG seeds → different LCG names)
			expect(vars1).not.toEqual(vars2);
		});

		it("two builds produce different bytecode encodings", () => {
			const code = `
        function add(a, b) { return a + b; }
        add(1, 2);
      `;
			const out1 = obfuscateCode(code);
			const out2 = obfuscateCode(code);

			// Extract the encoded bytecode strings (custom-alphabet binary)
			// They appear as string assignments to the bytecode table
			const bcPattern = /=\s*"([A-Za-z0-9_$]{20,})"/g;
			const strings1 = [...out1.matchAll(bcPattern)].map((m) => m[1]);
			const strings2 = [...out2.matchAll(bcPattern)].map((m) => m[1]);
			expect(strings1.length).toBeGreaterThan(0);
			expect(strings2.length).toBeGreaterThan(0);

			// Same function but different bytecode encodings per build
			expect(strings1).not.toEqual(strings2);
		});
	});

	describe("structural obfuscation", () => {
		it("dispatch uses function table groups, not a giant switch", () => {
			const out = obfuscateCode(sampleCode);

			// The old switch had 200+ case labels; function table dispatch
			// replaces it with handler group arrays + if-else routing.
			const casePattern = /\bcase (\d+):/g;
			const cases = [...out.matchAll(casePattern)];

			// Should have very few case labels (only from small internal
			// switches within individual handlers, not the main dispatch)
			expect(cases.length).toBeLessThan(50);

			// Handler closures should be abundant (regardless of dispatch style:
			// function table, direct array, or object lookup — all wrap handlers
			// in function expressions).
			const fnPattern = /function\s*\w*\s*\(/g;
			const fns = [...out.matchAll(fnPattern)];
			expect(fns.length).toBeGreaterThan(50);
		});

		it("no recognizable VM patterns in variable names", () => {
			const out = obfuscateCode(sampleCode);
			// These are the kind of names that would reveal it's a VM interpreter
			expect(out).not.toContain("stack");
			expect(out).not.toContain("opcode");
			expect(out).not.toContain("instruction");
			expect(out).not.toContain("register");
			expect(out).not.toContain("bytecode");
			expect(out).not.toContain("interpreter");
			expect(out).not.toContain("dispatch");
		});
	});

	describe("correctness under anti-reversing", () => {
		it("fibonacci works correctly", () => {
			assertEquivalent(sampleCode);
		});

		it("complex string operations work", () => {
			assertEquivalent(`
        function encode(str) {
          var result = "";
          for (var i = 0; i < str.length; i++) {
            result += String.fromCharCode(str.charCodeAt(i) + 1);
          }
          return result;
        }
        encode("Hello");
      `);
		});

		it("closures with encoded strings work", () => {
			assertEquivalent(`
        function makeCounter(label) {
          var count = 0;
          return function() {
            count++;
            return label + ": " + count;
          };
        }
        var c = makeCounter("items");
        [c(), c(), c()];
      `);
		});

		it("class with encoded method names works", () => {
			assertEquivalent(`
        function test() {
          class Calculator {
            constructor(initialValue) {
              this.value = initialValue;
            }
            add(n) { this.value += n; return this; }
            multiply(n) { this.value *= n; return this; }
            getResult() { return this.value; }
          }
          return new Calculator(5).add(3).multiply(2).getResult();
        }
        test();
      `);
		});

		it("try/catch with encoded error messages works", () => {
			assertEquivalent(`
        function riskyOperation(input) {
          try {
            if (input < 0) throw new Error("negative input not allowed");
            if (input > 100) throw new RangeError("input exceeds maximum");
            return input * 2;
          } catch (e) {
            return "Error: " + e.message;
          }
        }
        [riskyOperation(5), riskyOperation(-1), riskyOperation(200)];
      `);
		});

		it("async functions with encoded strings work", () => {
			assertEquivalent(`
        async function fetchData(url) {
          var prefix = "data:";
          return prefix + url;
        }
        fetchData("https://example.com");
      `);
		});

		it("destructuring with encoded property names works", () => {
			assertEquivalent(`
        function extract(obj) {
          var { username, email, role } = obj;
          return username + " (" + email + ") - " + role;
        }
        extract({ username: "admin", email: "admin@test.com", role: "superuser" });
      `);
		});

		it("map/filter/reduce with encoded strings work", () => {
			assertEquivalent(`
        function processNames(names) {
          return names
            .filter(function(n) { return n.length > 3; })
            .map(function(n) { return n.toUpperCase(); })
            .join(", ");
        }
        processNames(["Al", "Bob", "Charlie", "Dave", "Ed"]);
      `);
		});
	});
});
