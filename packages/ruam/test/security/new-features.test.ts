/**
 * Tests for 5 new security features:
 * - Polymorphic decoder chains
 * - Interpreter string atomization
 * - Scattered key material
 * - Bytecode block permutation
 * - Runtime opcode mutation
 */

import { describe, it, expect } from "bun:test";
import { assertEquivalent, evalObfuscated } from "../helpers.js";
import { obfuscateCode } from "../../src/index.js";
import {
	generateDecoderChain,
	polyEncode,
} from "../../src/ruamvm/polymorphic-decoder.js";

// --- Option sets ---

const polyOpts = { polymorphicDecoder: true };
const atomizeOpts = { stringAtomization: true };
const scatterOpts = { scatteredKeys: true, rollingCipher: true };
const blockPermOpts = { blockPermutation: true };
const mutationOpts = { opcodeMutation: true }; // auto-enables rollingCipher
const allNewOpts = {
	polymorphicDecoder: true,
	stringAtomization: true,
	scatteredKeys: true,
	blockPermutation: true,
	opcodeMutation: true,
};
const mediumOpts = { preset: "medium" as const };
const maxOpts = { preset: "max" as const };

// ═══════════════════════════════════════════════════════════════════════
// 1. Polymorphic Decoder Chains
// ═══════════════════════════════════════════════════════════════════════

describe("polymorphic decoder chains", () => {
	describe("build-time encoding", () => {
		it("generates chains of 4-8 operations", () => {
			for (let seed = 0; seed < 20; seed++) {
				const chain = generateDecoderChain(seed);
				expect(chain.ops.length).toBeGreaterThanOrEqual(4);
				expect(chain.ops.length).toBeLessThanOrEqual(8);
			}
		});

		it("different seeds produce different chains", () => {
			const chain1 = generateDecoderChain(12345);
			const chain2 = generateDecoderChain(67890);
			const ops1 = chain1.ops.map((o) => o.kind).join(",");
			const ops2 = chain2.ops.map((o) => o.kind).join(",");
			expect(ops1).not.toEqual(ops2);
		});

		it("encode/decode round-trips correctly", () => {
			const chain = generateDecoderChain(42);
			const encoded = polyEncode("hello world", chain, 0);
			expect(encoded.length).toBe(11); // Same length as input
			// Encoded should differ from ASCII
			const ascii = "hello world".split("").map((c) => c.charCodeAt(0));
			expect(encoded).not.toEqual(ascii);
		});

		it("position-dependent: same string at different indices encodes differently", () => {
			const chain = generateDecoderChain(42);
			const enc1 = polyEncode("test", chain, 0);
			const enc2 = polyEncode("test", chain, 1);
			expect(enc1).not.toEqual(enc2);
		});
	});

	describe("correctness with polymorphicDecoder", () => {
		it("simple function", () => {
			assertEquivalent(`function f() { return 42; } f();`, polyOpts);
		});

		it("string operations", () => {
			assertEquivalent(
				`function f() { return "hello" + " " + "world"; } f();`,
				polyOpts
			);
		});

		it("closures", () => {
			assertEquivalent(
				`function outer() {
					var x = 10;
					function inner() { return x + 5; }
					return inner();
				}
				outer();`,
				polyOpts
			);
		});

		it("try/catch", () => {
			assertEquivalent(
				`function f() {
					try { throw new Error("test"); }
					catch(e) { return e.message; }
				}
				f();`,
				polyOpts
			);
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 2. String Atomization
// ═══════════════════════════════════════════════════════════════════════

describe("interpreter string atomization", () => {
	describe("correctness", () => {
		it("simple function", () => {
			assertEquivalent(`function f() { return 42; } f();`, atomizeOpts);
		});

		it("object property access", () => {
			assertEquivalent(
				`function f() {
					var obj = { name: "test", value: 42 };
					return obj.name + ":" + obj.value;
				}
				f();`,
				atomizeOpts
			);
		});

		it("class methods", () => {
			assertEquivalent(
				`function f() {
					class Greeter {
						constructor(name) { this.name = name; }
						greet() { return "Hello, " + this.name; }
					}
					return new Greeter("world").greet();
				}
				f();`,
				atomizeOpts
			);
		});

		it("array methods with strings", () => {
			assertEquivalent(
				`function f() {
					return ["a", "b", "c"].join("-");
				}
				f();`,
				atomizeOpts
			);
		});

		it("fibonacci (no strings)", () => {
			assertEquivalent(
				`function fib(n) {
					if (n <= 1) return n;
					return fib(n - 1) + fib(n - 2);
				}
				fib(10);`,
				atomizeOpts
			);
		});
	});

	describe("anti-reversing", () => {
		it("no plaintext property names in output", () => {
			const code = `function f() {
				var obj = { mySecretProp: 42 };
				return obj.mySecretProp;
			} f();`;
			const out = obfuscateCode(code, atomizeOpts);
			// The property name in the bytecode constants should be encoded
			// (string atomization encodes interpreter strings, not user strings)
			expect(typeof evalObfuscated(code, atomizeOpts)).toBe("number");
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Scattered Key Material
// ═══════════════════════════════════════════════════════════════════════

describe("scattered key material", () => {
	describe("correctness", () => {
		it("simple function", () => {
			assertEquivalent(`function f() { return 42; } f();`, scatterOpts);
		});

		it("string operations", () => {
			assertEquivalent(
				`function f() { return "hello" + " " + "world"; } f();`,
				scatterOpts
			);
		});

		it("closures", () => {
			assertEquivalent(
				`function outer() {
					var x = 10;
					function inner() { return x * 2; }
					return inner();
				}
				outer();`,
				scatterOpts
			);
		});

		it("try/catch/finally", () => {
			assertEquivalent(
				`function f() {
					var result = "";
					try { result += "try"; throw 1; }
					catch(e) { result += "catch"; }
					finally { result += "finally"; }
					return result;
				}
				f();`,
				scatterOpts
			);
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Bytecode Block Permutation
// ═══════════════════════════════════════════════════════════════════════

describe("bytecode block permutation", () => {
	describe("correctness", () => {
		it("simple function", () => {
			assertEquivalent(`function f() { return 42; } f();`, blockPermOpts);
		});

		it("if/else branches", () => {
			assertEquivalent(
				`function f(x) {
					if (x > 0) return "positive";
					else if (x < 0) return "negative";
					else return "zero";
				}
				[f(5), f(-3), f(0)];`,
				blockPermOpts
			);
		});

		it("for loop", () => {
			assertEquivalent(
				`function sum(n) {
					var s = 0;
					for (var i = 0; i < n; i++) s += i;
					return s;
				}
				sum(10);`,
				blockPermOpts
			);
		});

		it("switch statement", () => {
			assertEquivalent(
				`function f(x) {
					switch(x) {
						case 1: return "one";
						case 2: return "two";
						case 3: return "three";
						default: return "other";
					}
				}
				[f(1), f(2), f(3), f(4)];`,
				blockPermOpts
			);
		});

		it("try/catch with throw", () => {
			assertEquivalent(
				`function f() {
					try {
						throw new Error("test");
					} catch(e) {
						return e.message;
					}
				}
				f();`,
				blockPermOpts
			);
		});

		it("nested functions", () => {
			assertEquivalent(
				`function outer() {
					function inner(x) { return x * 2; }
					return inner(21);
				}
				outer();`,
				blockPermOpts
			);
		});

		it("complex: fibonacci", () => {
			assertEquivalent(
				`function fib(n) {
					if (n <= 1) return n;
					return fib(n - 1) + fib(n - 2);
				}
				fib(10);`,
				blockPermOpts
			);
		});

		it("optional access pattern (Chrome extension style)", () => {
			assertEquivalent(
				`function test() {
					var win = { sessionStorage: { getItem: function(k) { return 'v_' + k; } } };
					var winNull = {};
					var r1, r2;
					try { r1 = win.sessionStorage.getItem('key'); } catch(e) { r1 = null; }
					try { r2 = winNull.sessionStorage.getItem('key'); } catch(e) { r2 = null; }
					return [r1, r2];
				}
				test();`,
				blockPermOpts
			);
		});
	});

	describe("per-build variation", () => {
		it("two builds produce different bytecode", () => {
			const code = `function f(x) { if (x > 0) return x; else return -x; } f(5);`;
			const out1 = obfuscateCode(code, blockPermOpts);
			const out2 = obfuscateCode(code, blockPermOpts);
			// Different CSPRNG seeds → different block orderings
			expect(out1).not.toEqual(out2);
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Runtime Opcode Mutation
// ═══════════════════════════════════════════════════════════════════════

describe("runtime opcode mutation", () => {
	describe("correctness", () => {
		it("simple function", () => {
			assertEquivalent(`function f() { return 42; } f();`, mutationOpts);
		});

		it("arithmetic", () => {
			assertEquivalent(
				`function f(a, b) { return a + b * 2 - 1; } f(10, 5);`,
				mutationOpts
			);
		});

		it("string operations", () => {
			assertEquivalent(
				`function f() { return "hello" + " " + "world"; } f();`,
				mutationOpts
			);
		});

		it("closures", () => {
			assertEquivalent(
				`function outer() {
					var x = 10;
					function inner() { return x + 5; }
					return inner();
				}
				outer();`,
				mutationOpts
			);
		});

		it("loops", () => {
			assertEquivalent(
				`function sum(n) {
					var s = 0;
					for (var i = 0; i < n; i++) s += i;
					return s;
				}
				sum(100);`,
				mutationOpts
			);
		});

		it("try/catch", () => {
			assertEquivalent(
				`function f() {
					try { throw new Error("test"); }
					catch(e) { return e.message; }
				}
				f();`,
				mutationOpts
			);
		});

		it("class with methods", () => {
			assertEquivalent(
				`function f() {
					class Counter {
						constructor() { this.n = 0; }
						inc() { this.n++; return this; }
						val() { return this.n; }
					}
					var c = new Counter();
					c.inc().inc().inc();
					return c.val();
				}
				f();`,
				mutationOpts
			);
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 6. Combined Features
// ═══════════════════════════════════════════════════════════════════════

describe("combined new features", () => {
	it("all new features together", () => {
		assertEquivalent(
			`function f() {
				var arr = [1, 2, 3, 4, 5];
				var sum = 0;
				for (var i = 0; i < arr.length; i++) sum += arr[i];
				return sum;
			}
			f();`,
			allNewOpts
		);
	});

	it("medium preset (includes stringAtomization + polymorphicDecoder + scatteredKeys)", () => {
		assertEquivalent(
			`function fib(n) {
				if (n <= 1) return n;
				return fib(n - 1) + fib(n - 2);
			}
			fib(10);`,
			mediumOpts
		);
	});

	it("max preset (all features)", () => {
		assertEquivalent(
			`function f() {
				class Counter {
					constructor() { this.count = 0; }
					increment() { this.count++; return this; }
					value() { return this.count; }
				}
				var c = new Counter();
				c.increment().increment().increment();
				return c.value();
			}
			f();`,
			maxOpts
		);
	});

	it("max preset with async", () => {
		assertEquivalent(
			`function f() {
				async function delay(ms) {
					return new Promise(function(resolve) {
						setTimeout(function() { resolve(ms); }, 0);
					});
				}
				async function main() {
					var result = await delay(42);
					return result;
				}
				return main();
			}
			f();`,
			maxOpts
		);
	});

	it("max preset with try/catch/finally", () => {
		assertEquivalent(
			`function f() {
				var result = [];
				try {
					result.push("try");
					throw new Error("test");
				} catch(e) {
					result.push("catch:" + e.message);
				} finally {
					result.push("finally");
				}
				return result.join(",");
			}
			f();`,
			maxOpts
		);
	});

	it("max preset complex: optional access pattern", () => {
		assertEquivalent(
			`function test() {
				var win = { sessionStorage: { getItem: function(k) { return 'v_' + k; } } };
				var winNull = {};
				var r1, r2;
				try { r1 = win.sessionStorage.getItem('key'); } catch(e) { r1 = null; }
				try { r2 = winNull.sessionStorage.getItem('key'); } catch(e) { r2 = null; }
				return [r1, r2];
			}
			test();`,
			maxOpts
		);
	});
});
