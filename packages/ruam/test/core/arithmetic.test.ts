import { describe, it } from "bun:test";
import { assertEquivalent } from "../helpers.js";

describe("comprehensive arithmetic operations", () => {
	// ── 1. Integer arithmetic ──────────────────────────────────────────

	it("addition with positive integers", () => {
		assertEquivalent(`
      function f() { return 123 + 456; }
      f();
    `);
	});

	it("subtraction yielding a negative result", () => {
		assertEquivalent(`
      function f() { return 3 - 10; }
      f();
    `);
	});

	it("multiplication with a negative operand", () => {
		assertEquivalent(`
      function f() { return -7 * 6; }
      f();
    `);
	});

	it("integer division with remainder truncation", () => {
		assertEquivalent(`
      function f() { return 17 / 3; }
      f();
    `);
	});

	it("modulus with negative dividend", () => {
		assertEquivalent(`
      function f() { return -17 % 5; }
      f();
    `);
	});

	it("exponentiation with zero exponent", () => {
		assertEquivalent(`
      function f() { return 99 ** 0; }
      f();
    `);
	});

	it("exponentiation with negative base and odd exponent", () => {
		assertEquivalent(`
      function f() { return (-2) ** 3; }
      f();
    `);
	});

	it("multiplication by zero", () => {
		assertEquivalent(`
      function f() { return 999999 * 0; }
      f();
    `);
	});

	it("subtraction of two equal values yields zero", () => {
		assertEquivalent(`
      function f() { var x = 42; return x - x; }
      f();
    `);
	});

	// ── 2. Floating point ─────────────────────────────────────────────

	it("floating point addition precision", () => {
		assertEquivalent(`
      function f() { return 0.1 + 0.2; }
      f();
    `);
	});

	it("floating point subtraction precision", () => {
		assertEquivalent(`
      function f() { return 0.3 - 0.1; }
      f();
    `);
	});

	it("division producing Infinity", () => {
		assertEquivalent(`
      function f() { return 1 / 0; }
      f();
    `);
	});

	it("division producing negative Infinity", () => {
		assertEquivalent(`
      function f() { return -1 / 0; }
      f();
    `);
	});

	it("zero divided by zero produces NaN", () => {
		assertEquivalent(`
      function f() { return 0 / 0; }
      f();
    `);
	});

	it("Infinity arithmetic", () => {
		assertEquivalent(`
      function f() { return [Infinity + 1, Infinity - Infinity, Infinity * -1, Infinity * 0]; }
      f();
    `);
	});

	it("NaN propagation through arithmetic", () => {
		assertEquivalent(`
      function f() { return [NaN + 1, NaN * 5, NaN - NaN, NaN === NaN]; }
      f();
    `);
	});

	// ── 3. Bitwise operations ─────────────────────────────────────────

	it("bitwise AND isolates low nibble", () => {
		assertEquivalent(`
      function f() { return 0xABCD & 0x0F; }
      f();
    `);
	});

	it("bitwise OR combines flags", () => {
		assertEquivalent(`
      function f() { return 0x0A | 0x50; }
      f();
    `);
	});

	it("bitwise XOR toggles bits", () => {
		assertEquivalent(`
      function f() { return 0xFF ^ 0x0F; }
      f();
    `);
	});

	it("bitwise NOT inverts all bits", () => {
		assertEquivalent(`
      function f() { return ~0; }
      f();
    `);
	});

	it("left shift doubles value per position", () => {
		assertEquivalent(`
      function f() { return 1 << 10; }
      f();
    `);
	});

	it("signed right shift preserves sign", () => {
		assertEquivalent(`
      function f() { return -256 >> 4; }
      f();
    `);
	});

	it("unsigned right shift on negative number", () => {
		assertEquivalent(`
      function f() { return -1 >>> 0; }
      f();
    `);
	});

	it("XOR swap without temp variable", () => {
		assertEquivalent(`
      function f() {
        var a = 12, b = 34;
        a = a ^ b; b = b ^ a; a = a ^ b;
        return [a, b];
      }
      f();
    `);
	});

	// ── 4. Math methods ───────────────────────────────────────────────

	it("Math.floor on negative float", () => {
		assertEquivalent(`
      function f() { return Math.floor(-2.7); }
      f();
    `);
	});

	it("Math.ceil on positive float", () => {
		assertEquivalent(`
      function f() { return Math.ceil(2.1); }
      f();
    `);
	});

	it("Math.round with .5 tie-breaking", () => {
		assertEquivalent(`
      function f() { return [Math.round(2.5), Math.round(3.5), Math.round(-0.5)]; }
      f();
    `);
	});

	it("Math.abs on negative and positive", () => {
		assertEquivalent(`
      function f() { return [Math.abs(-42), Math.abs(42), Math.abs(0)]; }
      f();
    `);
	});

	it("Math.max and Math.min with multiple args", () => {
		assertEquivalent(`
      function f() { return [Math.max(1, 5, 3, -2, 8), Math.min(1, 5, 3, -2, 8)]; }
      f();
    `);
	});

	it("Math.pow matches ** operator", () => {
		assertEquivalent(`
      function f() { return [Math.pow(2, 10), Math.pow(10, 0), Math.pow(-3, 3)]; }
      f();
    `);
	});

	it("Math.sqrt of perfect and imperfect squares", () => {
		assertEquivalent(`
      function f() { return [Math.sqrt(144), Math.sqrt(2), Math.sqrt(0)]; }
      f();
    `);
	});

	it("Math.sign for positive, negative, and zero", () => {
		assertEquivalent(`
      function f() { return [Math.sign(42), Math.sign(-42), Math.sign(0)]; }
      f();
    `);
	});

	it("Math.trunc removes fractional part", () => {
		assertEquivalent(`
      function f() { return [Math.trunc(3.9), Math.trunc(-3.9), Math.trunc(0.1)]; }
      f();
    `);
	});

	it("Math.hypot computes Euclidean distance", () => {
		assertEquivalent(`
      function f() { return Math.hypot(3, 4); }
      f();
    `);
	});

	it("Math.log and Math.log2 and Math.log10", () => {
		assertEquivalent(`
      function f() { return [Math.log(1), Math.log2(8), Math.log10(1000)]; }
      f();
    `);
	});

	it("Math.clz32 counts leading zeros", () => {
		assertEquivalent(`
      function f() { return [Math.clz32(1), Math.clz32(256), Math.clz32(0)]; }
      f();
    `);
	});

	// ── 5. Number coercion ────────────────────────────────────────────

	it("string to number via unary plus", () => {
		assertEquivalent(`
      function f() { return [+"42", +"3.14", +"", +"abc"]; }
      f();
    `);
	});

	it("boolean to number coercion", () => {
		assertEquivalent(`
      function f() { return [true + 0, false + 0, true * 5, false * 5]; }
      f();
    `);
	});

	it("null to number coercion", () => {
		assertEquivalent(`
      function f() { return [null + 0, null * 5, +null]; }
      f();
    `);
	});

	it("Number constructor for coercion", () => {
		assertEquivalent(`
      function f() { return [Number("99"), Number(true), Number(false), Number(null), Number(undefined)]; }
      f();
    `);
	});

	// ── 6. Unary operators ────────────────────────────────────────────

	it("unary negation of zero and negative zero", () => {
		assertEquivalent(`
      function f() { return [-0 === 0, 1 / -0, 1 / 0]; }
      f();
    `);
	});

	it("bitwise NOT on various integers", () => {
		assertEquivalent(`
      function f() { return [~0, ~1, ~-1, ~255]; }
      f();
    `);
	});

	it("typeof with arithmetic results", () => {
		assertEquivalent(`
      function f() { return [typeof (1 + 2), typeof NaN, typeof Infinity]; }
      f();
    `);
	});

	// ── 7. Increment and decrement ────────────────────────────────────

	it("post-increment returns original value", () => {
		assertEquivalent(`
      function f() { var a = 5; var b = a++; return [a, b]; }
      f();
    `);
	});

	it("pre-increment returns new value", () => {
		assertEquivalent(`
      function f() { var a = 5; var b = ++a; return [a, b]; }
      f();
    `);
	});

	it("post-decrement returns original value", () => {
		assertEquivalent(`
      function f() { var a = 10; var b = a--; return [a, b]; }
      f();
    `);
	});

	it("pre-decrement returns new value", () => {
		assertEquivalent(`
      function f() { var a = 10; var b = --a; return [a, b]; }
      f();
    `);
	});

	it("increment in a loop accumulator", () => {
		assertEquivalent(`
      function f() {
        var sum = 0;
        for (var i = 0; i < 5; i++) { sum += i; }
        return sum;
      }
      f();
    `);
	});

	// ── 8. Compound assignment operators ──────────────────────────────

	it("addition assignment +=", () => {
		assertEquivalent(`
      function f() { var x = 10; x += 5; return x; }
      f();
    `);
	});

	it("subtraction assignment -=", () => {
		assertEquivalent(`
      function f() { var x = 10; x -= 3; return x; }
      f();
    `);
	});

	it("multiplication assignment *=", () => {
		assertEquivalent(`
      function f() { var x = 4; x *= 7; return x; }
      f();
    `);
	});

	it("division assignment /=", () => {
		assertEquivalent(`
      function f() { var x = 100; x /= 4; return x; }
      f();
    `);
	});

	it("modulus assignment %=", () => {
		assertEquivalent(`
      function f() { var x = 17; x %= 5; return x; }
      f();
    `);
	});

	it("exponentiation assignment **=", () => {
		assertEquivalent(`
      function f() { var x = 3; x **= 4; return x; }
      f();
    `);
	});

	it("bitwise AND assignment &=", () => {
		assertEquivalent(`
      function f() { var x = 0xFF; x &= 0x0F; return x; }
      f();
    `);
	});

	it("bitwise OR assignment |=", () => {
		assertEquivalent(`
      function f() { var x = 0x0A; x |= 0x50; return x; }
      f();
    `);
	});

	it("bitwise XOR assignment ^=", () => {
		assertEquivalent(`
      function f() { var x = 0xFF; x ^= 0x0F; return x; }
      f();
    `);
	});

	it("left shift assignment <<=", () => {
		assertEquivalent(`
      function f() { var x = 1; x <<= 8; return x; }
      f();
    `);
	});

	it("signed right shift assignment >>=", () => {
		assertEquivalent(`
      function f() { var x = -256; x >>= 4; return x; }
      f();
    `);
	});

	it("unsigned right shift assignment >>>=", () => {
		assertEquivalent(`
      function f() { var x = -1; x >>>= 0; return x; }
      f();
    `);
	});

	// ── 9. Mixed / complex expressions ────────────────────────────────

	it("order of operations: add then multiply", () => {
		assertEquivalent(`
      function f() { return 2 + 3 * 4; }
      f();
    `);
	});

	it("parenthesized expression changes precedence", () => {
		assertEquivalent(`
      function f() { return (2 + 3) * 4; }
      f();
    `);
	});

	it("chained arithmetic with mixed operators", () => {
		assertEquivalent(`
      function f() { return 100 - 20 * 3 + 50 / 5 % 7; }
      f();
    `);
	});

	it("nested function calls with arithmetic", () => {
		assertEquivalent(`
      function f() {
        return Math.floor(Math.sqrt(Math.pow(3, 2) + Math.pow(4, 2)));
      }
      f();
    `);
	});

	it("bitwise combined with arithmetic", () => {
		assertEquivalent(`
      function f() {
        var x = 42;
        return ((x & 0xFF) << 2) + (x >> 1) - (~x & 0xF);
      }
      f();
    `);
	});

	it("ternary inside arithmetic expression", () => {
		assertEquivalent(`
      function f() {
        var a = 10, b = 20;
        return (a > b ? a : b) * 2 + (a < b ? a : b);
      }
      f();
    `);
	});

	// ── 10. Edge cases ────────────────────────────────────────────────

	it("MAX_SAFE_INTEGER boundary", () => {
		assertEquivalent(`
      function f() {
        var max = 9007199254740991;
        return [max, max + 1, max + 2, max + 1 === max + 2];
      }
      f();
    `);
	});

	it("integer overflow wraps in bitwise context", () => {
		assertEquivalent(`
      function f() { return 0x7FFFFFFF + 1 | 0; }
      f();
    `);
	});

	it("division by zero does not throw", () => {
		assertEquivalent(`
      function f() { return [1 / 0, -1 / 0, 0 / 0]; }
      f();
    `);
	});

	it("NaN is not equal to itself", () => {
		assertEquivalent(`
      function f() {
        var x = NaN;
        return [x === x, x !== x, isNaN(x)];
      }
      f();
    `);
	});

	it("negative zero equality and detection", () => {
		assertEquivalent(`
      function f() {
        var nz = -0;
        return [nz === 0, 1 / nz === -Infinity, Object.is(nz, -0), Object.is(nz, 0)];
      }
      f();
    `);
	});

	it("large exponentiation produces Infinity", () => {
		assertEquivalent(`
      function f() { return [2 ** 1024, -(2 ** 1024)]; }
      f();
    `);
	});

	it("modulus with floating point operands", () => {
		assertEquivalent(`
      function f() { return [5.5 % 2, -5.5 % 2, 10.0 % 3.5]; }
      f();
    `);
	});

	it("cascading compound assignments", () => {
		assertEquivalent(`
      function f() {
        var x = 2;
        x += 3;
        x *= 4;
        x -= 1;
        x /= 3;
        x %= 5;
        x **= 2;
        return x;
      }
      f();
    `);
	});
});
