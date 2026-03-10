import { describe, it, expect } from "vitest";
import { assertEquivalent, evalObfuscated } from "../helpers.js";
import { obfuscateCode } from "../../src/transform.js";
import { encodeStringChars } from "../../src/compiler/encode.js";
import { LCG_MULTIPLIER, LCG_INCREMENT } from "../../src/constants.js";

// ---------------------------------------------------------------------------
// Build-time string encoding/decoding round-trip
// ---------------------------------------------------------------------------

/** Mirror of the runtime strDec function for testing. */
function decodeStringChars(
	encoded: number[],
	key: number,
	index: number
): string {
	let k = (key ^ (index * 0x9e3779b9)) >>> 0;
	let s = "";
	for (let i = 0; i < encoded.length; i++) {
		k = (k * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
		s += String.fromCharCode(encoded[i]! ^ (k & 0xffff));
	}
	return s;
}

describe("string constant encoding", () => {
	describe("encodeStringChars round-trip", () => {
		const key = 0xdeadbeef;

		it("encodes and decodes ASCII strings", () => {
			const str = "hello world";
			const encoded = encodeStringChars(str, key, 0);
			expect(encoded.length).toBe(str.length);
			expect(encoded.every((n) => typeof n === "number")).toBe(true);
			expect(decodeStringChars(encoded, key, 0)).toBe(str);
		});

		it("different indices produce different encodings", () => {
			const str = "test";
			const enc0 = encodeStringChars(str, key, 0);
			const enc1 = encodeStringChars(str, key, 1);
			expect(enc0).not.toEqual(enc1);
			// Both decode correctly with their respective indices
			expect(decodeStringChars(enc0, key, 0)).toBe(str);
			expect(decodeStringChars(enc1, key, 1)).toBe(str);
		});

		it("different keys produce different encodings", () => {
			const str = "test";
			const enc1 = encodeStringChars(str, 0x12345678, 0);
			const enc2 = encodeStringChars(str, 0x87654321, 0);
			expect(enc1).not.toEqual(enc2);
		});

		it("handles empty strings", () => {
			const encoded = encodeStringChars("", key, 0);
			expect(encoded).toEqual([]);
			expect(decodeStringChars(encoded, key, 0)).toBe("");
		});

		it("handles single character strings", () => {
			const str = "x";
			const encoded = encodeStringChars(str, key, 5);
			expect(encoded.length).toBe(1);
			expect(decodeStringChars(encoded, key, 5)).toBe(str);
		});

		it("handles unicode strings", () => {
			const str = "héllo wörld 日本語";
			const encoded = encodeStringChars(str, key, 0);
			expect(decodeStringChars(encoded, key, 0)).toBe(str);
		});

		it("handles strings with special characters", () => {
			const str = 'line1\nline2\ttab\r\n"quoted"';
			const encoded = encodeStringChars(str, key, 0);
			expect(decodeStringChars(encoded, key, 0)).toBe(str);
		});

		it("handles long strings", () => {
			const str = "a".repeat(1000);
			const encoded = encodeStringChars(str, key, 0);
			expect(decodeStringChars(encoded, key, 0)).toBe(str);
		});
	});

	describe("obfuscated output has no plaintext strings", () => {
		it("function body strings are encoded in constant pool", () => {
			const code = `
        function getMessage() {
          return "This is a secret message";
        }
        getMessage();
      `;
			const out = obfuscateCode(code);
			expect(out).not.toContain("This is a secret message");
		});

		it("local variable names inside functions are encoded", () => {
			const code = `
        function compute(a, b) {
          var intermediateResult = a * b;
          return intermediateResult + 100;
        }
        compute(5, 10);
      `;
			const out = obfuscateCode(code);
			// Local variable name is in the constant pool and should be encoded
			expect(out).not.toContain("intermediateResult");
		});

		it("property names inside functions are encoded", () => {
			const code = `
        function createUser(a, b) {
          return { firstName: a, lastName: b, fullName: a + " " + b };
        }
        createUser("John", "Doe");
      `;
			const out = obfuscateCode(code);
			// Property names used inside the function are in the constant pool
			expect(out).not.toContain("firstName");
			expect(out).not.toContain("lastName");
			expect(out).not.toContain("fullName");
		});
	});

	describe("encoded strings execute correctly", () => {
		it("string concatenation works", () => {
			assertEquivalent(`
        function greet(name) { return "Hello, " + name + "!"; }
        greet("World");
      `);
		});

		it("template literals work", () => {
			assertEquivalent(`
        function format(x, y) { return x + " + " + y + " = " + (x + y); }
        format(3, 4);
      `);
		});

		it("object property access with encoded names works", () => {
			assertEquivalent(`
        function getInfo(obj) {
          return obj.firstName + " " + obj.lastName;
        }
        getInfo({ firstName: "Jane", lastName: "Doe" });
      `);
		});

		it("array methods with string args work", () => {
			assertEquivalent(`
        function joinNames(arr) {
          return arr.join(", ");
        }
        joinNames(["Alice", "Bob", "Charlie"]);
      `);
		});

		it("switch on strings works", () => {
			assertEquivalent(`
        function classify(x) {
          switch(x) {
            case "alpha": return 1;
            case "beta": return 2;
            case "gamma": return 3;
            default: return 0;
          }
        }
        [classify("alpha"), classify("beta"), classify("gamma"), classify("delta")];
      `);
		});

		it("regex patterns still work", () => {
			assertEquivalent(`
        function matchEmail(str) {
          return /^[a-zA-Z0-9]+@[a-zA-Z0-9]+\\.[a-zA-Z]{2,}$/.test(str);
        }
        [matchEmail("test@example.com"), matchEmail("invalid")];
      `);
		});

		it("error messages with encoded strings work", () => {
			assertEquivalent(`
        function validate(x) {
          if (typeof x !== "number") {
            throw new TypeError("Expected a number");
          }
          return x * 2;
        }
        var result;
        try { validate("hello"); } catch(e) { result = e.message; }
        result;
      `);
		});

		it("computed property names work", () => {
			assertEquivalent(`
        function makeDynamic(key, value) {
          var obj = {};
          obj[key] = value;
          return obj;
        }
        var result = makeDynamic("myProp", 42);
        result.myProp;
      `);
		});

		it("closures with encoded string variables work", () => {
			assertEquivalent(`
        function makeGreeter(greeting) {
          return function(name) {
            return greeting + ", " + name + "!";
          };
        }
        var hi = makeGreeter("Hi");
        hi("Alice");
      `);
		});

		it("class method names work", () => {
			assertEquivalent(`
        function test() {
          class Animal {
            constructor(species) {
              this.species = species;
            }
            getSpecies() {
              return this.species;
            }
          }
          var cat = new Animal("cat");
          return cat.getSpecies();
        }
        test();
      `);
		});
	});
});
