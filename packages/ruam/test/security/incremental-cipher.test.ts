import { describe, it, expect } from "bun:test";
import {
	deriveBlockKey,
	chainMix,
	buildCipherBlocks,
	incrementalEncrypt,
	type CipherBlock,
} from "../../src/compiler/incremental-cipher.js";
import type { BytecodeUnit } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helper: simulate runtime decryption (inverse of incrementalEncrypt)
// ---------------------------------------------------------------------------

function incrementalDecrypt(
	instrs: number[],
	masterKey: number,
	blocks: CipherBlock[]
): void {
	for (const block of blocks) {
		let chainState = deriveBlockKey(masterKey, block.blockId);

		for (let ip = block.startIp; ip < block.endIp; ip++) {
			const opcodeIdx = ip * 2;
			const operandIdx = ip * 2 + 1;

			// Decrypt: XOR with chain state to recover plaintext
			const plainOp =
				(instrs[opcodeIdx]! ^ (chainState & 0xffff)) & 0xffff;
			const plainOperand = (instrs[operandIdx]! ^ chainState) | 0;

			// Write back plaintext
			instrs[opcodeIdx] = plainOp;
			instrs[operandIdx] = plainOperand;

			// Advance chain with recovered plaintext (same progression as encrypt)
			chainState = chainMix(chainState, plainOp, plainOperand);
		}
	}
}

// ---------------------------------------------------------------------------
// Helper: create a minimal BytecodeUnit for testing
// ---------------------------------------------------------------------------

function makeUnit(
	instructions: Array<{ opcode: number; operand: number }>,
	overrides?: Partial<BytecodeUnit>
): BytecodeUnit {
	return {
		id: "test",
		constants: [],
		instructions,
		jumpTable: {},
		exceptionTable: [],
		paramCount: 0,
		registerCount: 0,
		slotCount: 0,
		isStrict: false,
		isGenerator: false,
		isAsync: false,
		isArrow: false,
		nameConstIndex: -1,
		outerNames: [],
		childUnits: [],
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Helper: flatten instructions to a flat array [op, operand, op, operand, ...]
// ---------------------------------------------------------------------------

function flatten(instrs: Array<{ opcode: number; operand: number }>): number[] {
	const flat: number[] = [];
	for (const instr of instrs) {
		flat.push(instr.opcode, instr.operand);
	}
	return flat;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("incremental cipher build-time", () => {
	// --- deriveBlockKey ---

	describe("deriveBlockKey", () => {
		it("produces a 32-bit unsigned integer", () => {
			const key = deriveBlockKey(0xdeadbeef, 0);
			expect(key).toBeGreaterThanOrEqual(0);
			expect(key).toBeLessThanOrEqual(0xffffffff);
		});

		it("is deterministic", () => {
			const k1 = deriveBlockKey(12345, 7);
			const k2 = deriveBlockKey(12345, 7);
			expect(k1).toBe(k2);
		});

		it("different blockIds produce different keys", () => {
			const keys = new Set<number>();
			for (let i = 0; i < 100; i++) {
				keys.add(deriveBlockKey(0xabcdef01, i));
			}
			// All 100 should be unique (collision in 32-bit space with
			// good mixing is astronomically unlikely for 100 values)
			expect(keys.size).toBe(100);
		});

		it("different masterKeys produce different keys", () => {
			const k1 = deriveBlockKey(1, 0);
			const k2 = deriveBlockKey(2, 0);
			const k3 = deriveBlockKey(0xffffffff, 0);
			expect(new Set([k1, k2, k3]).size).toBe(3);
		});

		it("handles zero inputs", () => {
			const key = deriveBlockKey(0, 0);
			expect(key).toBeGreaterThanOrEqual(0);
			expect(key).toBeLessThanOrEqual(0xffffffff);
		});
	});

	// --- chainMix ---

	describe("chainMix", () => {
		it("produces a 32-bit unsigned integer", () => {
			const result = chainMix(0xdeadbeef, 42, 100);
			expect(result).toBeGreaterThanOrEqual(0);
			expect(result).toBeLessThanOrEqual(0xffffffff);
		});

		it("different opcodes produce different states", () => {
			const s1 = chainMix(0x12345678, 10, 50);
			const s2 = chainMix(0x12345678, 11, 50);
			expect(s1).not.toBe(s2);
		});

		it("different operands produce different states", () => {
			const s1 = chainMix(0x12345678, 10, 50);
			const s2 = chainMix(0x12345678, 10, 51);
			expect(s1).not.toBe(s2);
		});

		it("different initial states produce different results", () => {
			const s1 = chainMix(0x11111111, 10, 50);
			const s2 = chainMix(0x22222222, 10, 50);
			expect(s1).not.toBe(s2);
		});

		it("is deterministic", () => {
			const s1 = chainMix(999, 42, 7);
			const s2 = chainMix(999, 42, 7);
			expect(s1).toBe(s2);
		});
	});

	// --- buildCipherBlocks ---

	describe("buildCipherBlocks", () => {
		it("assigns sequential blockIds starting from 0", () => {
			// Simple linear code: all one block
			const unit = makeUnit([
				{ opcode: 1, operand: 0 },
				{ opcode: 2, operand: 0 },
				{ opcode: 3, operand: 0 },
			]);
			const blocks = buildCipherBlocks(unit);
			expect(blocks.length).toBeGreaterThanOrEqual(1);
			expect(blocks[0]!.blockId).toBe(0);
			for (let i = 0; i < blocks.length; i++) {
				expect(blocks[i]!.blockId).toBe(i);
			}
		});

		it("returns empty array for empty unit", () => {
			const unit = makeUnit([]);
			const blocks = buildCipherBlocks(unit);
			expect(blocks).toEqual([]);
		});
	});

	// --- incrementalEncrypt round-trip ---

	describe("incrementalEncrypt", () => {
		it("modifies instruction data in place", () => {
			const instrs = [
				{ opcode: 100, operand: 5 },
				{ opcode: 200, operand: 10 },
				{ opcode: 50, operand: 0 },
			];
			const unit = makeUnit(instrs);
			const blocks = buildCipherBlocks(unit);
			const flat = flatten(instrs);
			const original = [...flat];

			incrementalEncrypt(flat, 0xdeadbeef, blocks);
			expect(flat).not.toEqual(original);
		});

		it("round-trip: encrypt then decrypt recovers plaintext", () => {
			const instrs = [
				{ opcode: 100, operand: 5 },
				{ opcode: 200, operand: 10 },
				{ opcode: 50, operand: 0 },
				{ opcode: 150, operand: 999 },
			];
			const unit = makeUnit(instrs);
			const blocks = buildCipherBlocks(unit);
			const flat = flatten(instrs);
			const original = [...flat];

			incrementalEncrypt(flat, 0xdeadbeef, blocks);
			// Should be encrypted (different from original)
			expect(flat).not.toEqual(original);

			// Decrypt
			incrementalDecrypt(flat, 0xdeadbeef, blocks);
			expect(flat).toEqual(original);
		});

		it("round-trip with multiple blocks via jump instructions", () => {
			// Use opcode 6 = JMP (Op.JMP from the enum) to create multiple blocks.
			// But we reference numeric opcodes directly — the identifyBasicBlocks
			// function checks against the JUMP_OPS set which uses the Op enum.
			// For testing with raw numbers, we'll use exception table entries
			// to create block boundaries instead.
			const instrs = [
				{ opcode: 1, operand: 0 },
				{ opcode: 2, operand: 0 },
				// Block boundary via exception table
				{ opcode: 3, operand: 0 },
				{ opcode: 4, operand: 0 },
				// Another block boundary
				{ opcode: 5, operand: 0 },
				{ opcode: 6, operand: 0 },
			];
			const unit = makeUnit(instrs, {
				exceptionTable: [
					{ startIp: 0, endIp: 2, catchIp: 2, finallyIp: 4 },
				],
			});
			const blocks = buildCipherBlocks(unit);
			expect(blocks.length).toBe(3); // [0,2), [2,4), [4,6)

			const flat = flatten(instrs);
			const original = [...flat];

			incrementalEncrypt(flat, 0x42424242, blocks);
			expect(flat).not.toEqual(original);

			incrementalDecrypt(flat, 0x42424242, blocks);
			expect(flat).toEqual(original);
		});

		it("same key and data produce same encryption", () => {
			const instrs = [
				{ opcode: 100, operand: 5 },
				{ opcode: 200, operand: 10 },
			];
			const unit = makeUnit(instrs);
			const blocks = buildCipherBlocks(unit);

			const flat1 = flatten(instrs);
			const flat2 = flatten(instrs);

			incrementalEncrypt(flat1, 0xaabbccdd, blocks);
			incrementalEncrypt(flat2, 0xaabbccdd, blocks);

			expect(flat1).toEqual(flat2);
		});

		it("different keys produce different encryption", () => {
			const instrs = [
				{ opcode: 100, operand: 5 },
				{ opcode: 200, operand: 10 },
			];
			const unit = makeUnit(instrs);
			const blocks = buildCipherBlocks(unit);

			const flat1 = flatten(instrs);
			const flat2 = flatten(instrs);

			incrementalEncrypt(flat1, 0x11111111, blocks);
			incrementalEncrypt(flat2, 0x22222222, blocks);

			expect(flat1).not.toEqual(flat2);
		});
	});

	// --- Multi-block independence ---

	describe("multi-block independence", () => {
		it("block 1 encryption does not depend on block 0 content", () => {
			// Create two units with different block 0 content but same block 1
			const instrA = [
				{ opcode: 10, operand: 20 }, // block 0
				{ opcode: 30, operand: 40 }, // block 1
				{ opcode: 50, operand: 60 }, // block 1
			];
			const instrB = [
				{ opcode: 99, operand: 88 }, // block 0 — DIFFERENT
				{ opcode: 30, operand: 40 }, // block 1 — SAME
				{ opcode: 50, operand: 60 }, // block 1 — SAME
			];

			// Use exception table to create block boundary at IP 1
			const exTable = [
				{ startIp: 0, endIp: 1, catchIp: 1, finallyIp: -1 },
			];
			const unitA = makeUnit(instrA, { exceptionTable: exTable });
			const unitB = makeUnit(instrB, { exceptionTable: exTable });

			const blocksA = buildCipherBlocks(unitA);
			const blocksB = buildCipherBlocks(unitB);
			expect(blocksA.length).toBe(2);
			expect(blocksB.length).toBe(2);

			const flatA = flatten(instrA);
			const flatB = flatten(instrB);

			const masterKey = 0xfedcba98;
			incrementalEncrypt(flatA, masterKey, blocksA);
			incrementalEncrypt(flatB, masterKey, blocksB);

			// Block 1 ciphertext should be identical because block 1's chain
			// starts fresh from deriveBlockKey(masterKey, 1) regardless of
			// block 0's content.
			// Block 1 starts at IP 1 → flat index 2
			expect(flatA[2]).toBe(flatB[2]); // opcode at IP 1
			expect(flatA[3]).toBe(flatB[3]); // operand at IP 1
			expect(flatA[4]).toBe(flatB[4]); // opcode at IP 2
			expect(flatA[5]).toBe(flatB[5]); // operand at IP 2
		});
	});

	// --- Chain dependency within a block ---

	describe("chain dependency within a block", () => {
		it("changing instruction N plaintext changes instruction N+1 ciphertext", () => {
			const instrA = [
				{ opcode: 10, operand: 20 },
				{ opcode: 30, operand: 40 },
				{ opcode: 50, operand: 60 },
			];
			const instrB = [
				{ opcode: 10, operand: 20 },
				{ opcode: 31, operand: 40 }, // Changed opcode at IP 1
				{ opcode: 50, operand: 60 },
			];
			const unitA = makeUnit(instrA);
			const unitB = makeUnit(instrB);

			const blocksA = buildCipherBlocks(unitA);
			const blocksB = buildCipherBlocks(unitB);

			const flatA = flatten(instrA);
			const flatB = flatten(instrB);

			const masterKey = 0x55555555;
			incrementalEncrypt(flatA, masterKey, blocksA);
			incrementalEncrypt(flatB, masterKey, blocksB);

			// IP 0 should be identical (same plaintext, same chain start)
			expect(flatA[0]).toBe(flatB[0]);
			expect(flatA[1]).toBe(flatB[1]);

			// IP 1 opcode is different in plaintext, so ciphertext differs
			expect(flatA[2]).not.toBe(flatB[2]);

			// IP 2 should differ because the chain state diverged after IP 1
			// (chainMix used different plaintext at IP 1)
			expect(flatA[4]).not.toBe(flatB[4]);
		});

		it("changing instruction N operand also affects subsequent ciphertext", () => {
			const instrA = [
				{ opcode: 10, operand: 20 },
				{ opcode: 30, operand: 40 },
			];
			const instrB = [
				{ opcode: 10, operand: 21 }, // Changed operand at IP 0
				{ opcode: 30, operand: 40 },
			];
			const unitA = makeUnit(instrA);
			const unitB = makeUnit(instrB);

			const blocksA = buildCipherBlocks(unitA);
			const blocksB = buildCipherBlocks(unitB);

			const flatA = flatten(instrA);
			const flatB = flatten(instrB);

			const masterKey = 0x77777777;
			incrementalEncrypt(flatA, masterKey, blocksA);
			incrementalEncrypt(flatB, masterKey, blocksB);

			// IP 0 opcode is the same plaintext but operand differs,
			// so operand ciphertext differs
			expect(flatA[0]).toBe(flatB[0]); // same opcode plaintext → same ciphertext
			expect(flatA[1]).not.toBe(flatB[1]); // different operand

			// IP 1 ciphertext should differ because chain diverged
			// (chainMix used different operand at IP 0)
			expect(flatA[2]).not.toBe(flatB[2]);
			expect(flatA[3]).not.toBe(flatB[3]);
		});
	});

	// --- Edge cases ---

	describe("edge cases", () => {
		it("handles single-instruction unit", () => {
			const instrs = [{ opcode: 42, operand: 7 }];
			const unit = makeUnit(instrs);
			const blocks = buildCipherBlocks(unit);
			const flat = flatten(instrs);
			const original = [...flat];

			incrementalEncrypt(flat, 0xdeadbeef, blocks);
			expect(flat).not.toEqual(original);

			incrementalDecrypt(flat, 0xdeadbeef, blocks);
			expect(flat).toEqual(original);
		});

		it("handles large instruction counts", () => {
			const instrs = Array.from({ length: 200 }, (_, i) => ({
				opcode: (i * 7) & 0xffff,
				operand: (i * 13) & 0xffff,
			}));
			const unit = makeUnit(instrs);
			const blocks = buildCipherBlocks(unit);
			const flat = flatten(instrs);
			const original = [...flat];

			incrementalEncrypt(flat, 0xcafebabe, blocks);
			expect(flat).not.toEqual(original);

			incrementalDecrypt(flat, 0xcafebabe, blocks);
			expect(flat).toEqual(original);
		});

		it("handles zero masterKey", () => {
			const instrs = [
				{ opcode: 100, operand: 200 },
				{ opcode: 300, operand: 400 },
			];
			const unit = makeUnit(instrs);
			const blocks = buildCipherBlocks(unit);
			const flat = flatten(instrs);
			const original = [...flat];

			incrementalEncrypt(flat, 0, blocks);
			incrementalDecrypt(flat, 0, blocks);
			expect(flat).toEqual(original);
		});

		it("handles max uint32 masterKey", () => {
			const instrs = [
				{ opcode: 100, operand: 200 },
				{ opcode: 300, operand: 400 },
			];
			const unit = makeUnit(instrs);
			const blocks = buildCipherBlocks(unit);
			const flat = flatten(instrs);
			const original = [...flat];

			incrementalEncrypt(flat, 0xffffffff, blocks);
			incrementalDecrypt(flat, 0xffffffff, blocks);
			expect(flat).toEqual(original);
		});
	});
});

// ---------------------------------------------------------------------------
// End-to-end tests — verify the full pipeline (compile + encrypt + runtime)
// ---------------------------------------------------------------------------

import { assertEquivalent } from "../helpers.js";

const icOpts = { incrementalCipher: true };

describe("incremental cipher e2e", () => {
	it("simple return", () => {
		assertEquivalent(`function f() { return 42; } f();`, icOpts);
	});

	it("arithmetic", () => {
		assertEquivalent(
			`function f(a, b) { return a + b * 2 - 1; } f(10, 3);`,
			icOpts
		);
	});

	it("conditionals", () => {
		assertEquivalent(
			`function f(x) { if (x > 0) return "pos"; else return "neg"; } [f(5), f(-1)];`,
			icOpts
		);
	});

	it("loops", () => {
		assertEquivalent(
			`function f(n) { var s = 0; for (var i = 0; i < n; i++) s += i; return s; } f(10);`,
			icOpts
		);
	});

	it("closures", () => {
		assertEquivalent(
			`function f() { var x = 10; function g() { return x + 1; } return g(); } f();`,
			icOpts
		);
	});

	it("recursion", () => {
		assertEquivalent(
			`function fib(n) { if (n <= 1) return n; return fib(n-1) + fib(n-2); } fib(10);`,
			icOpts
		);
	});

	it("try-catch", () => {
		assertEquivalent(
			`function f() { try { return JSON.parse('{"a":1}').a; } catch(e) { return -1; } } f();`,
			icOpts
		);
	});

	it("try-catch error path", () => {
		assertEquivalent(
			`function f() { try { return JSON.parse('bad'); } catch(e) { return null; } } f();`,
			icOpts
		);
	});

	it("try-finally", () => {
		assertEquivalent(
			`function f() { var x = 0; try { x = 1; return x; } finally { x = 2; } } f();`,
			icOpts
		);
	});

	it("empty function", () => {
		assertEquivalent(`function f() {} f();`, icOpts);
	});

	it("switch statement", () => {
		assertEquivalent(
			`function f(x) { switch(x) { case 1: return "a"; case 2: return "b"; default: return "c"; } } [f(1), f(2), f(3)];`,
			icOpts
		);
	});

	it("switch with fallthrough", () => {
		assertEquivalent(
			`function f(x) { var r = ""; switch(x) { case 1: r += "a"; case 2: r += "b"; break; case 3: r += "c"; } return r; } [f(1), f(2), f(3)];`,
			icOpts
		);
	});

	it("while loop", () => {
		assertEquivalent(
			`function f(n) { var i = 0, s = 0; while (i < n) { s += i; i++; } return s; } f(5);`,
			icOpts
		);
	});

	it("nested closures", () => {
		assertEquivalent(
			`function f() { var a = 1; function g() { var b = 2; function h() { return a + b; } return h(); } return g(); } f();`,
			icOpts
		);
	});

	it("array operations", () => {
		assertEquivalent(
			`function f() { var a = [3,1,2]; return a.sort().join(","); } f();`,
			icOpts
		);
	});

	it("object operations", () => {
		assertEquivalent(
			`function f() { var o = {x:1,y:2}; o.z = o.x + o.y; return o.z; } f();`,
			icOpts
		);
	});

	it("string operations", () => {
		assertEquivalent(
			`function f(s) { return s.toUpperCase().slice(0,3); } f("hello");`,
			icOpts
		);
	});

	it("ternary", () => {
		assertEquivalent(
			`function f(x) { return x > 0 ? x * 2 : -x; } [f(5), f(-3)];`,
			icOpts
		);
	});

	it("logical operators", () => {
		assertEquivalent(
			`function f(a,b) { return (a || b) && !(a && b); } [f(true,false), f(true,true), f(false,false)];`,
			icOpts
		);
	});

	it("class with methods", () => {
		assertEquivalent(
			`function f() { class C { constructor(x) { this.x = x; } get() { return this.x; } } return new C(42).get(); } f();`,
			icOpts
		);
	});

	// --- Feature combinations ---

	it("with blockPermutation", () => {
		assertEquivalent(
			`function f(n) { var s = 0; for (var i = 0; i < n; i++) { if (i % 2 === 0) s += i; else s -= i; } return s; } f(10);`,
			{ incrementalCipher: true, blockPermutation: true }
		);
	});

	it("with opcodeMutation", () => {
		assertEquivalent(
			`function f(n) { var s = 0; for (var i = 0; i < n; i++) s += i; return s; } f(10);`,
			{ incrementalCipher: true, opcodeMutation: true }
		);
	});

	it("with blockPermutation + opcodeMutation", () => {
		assertEquivalent(
			`function f(n) { var s = 0; for (var i = 0; i < n; i++) { if (i % 2 === 0) s += i; else s -= i; } return s; } f(10);`,
			{
				incrementalCipher: true,
				blockPermutation: true,
				opcodeMutation: true,
			}
		);
	});

	it("with integrityBinding", () => {
		assertEquivalent(`function f() { return 42; } f();`, {
			incrementalCipher: true,
			integrityBinding: true,
		});
	});

	it("with deadCodeInjection", () => {
		assertEquivalent(
			`function f(x) { if (x) return 1; return 0; } [f(true), f(false)];`,
			{ incrementalCipher: true, deadCodeInjection: true }
		);
	});

	it("with stackEncoding", () => {
		assertEquivalent(`function f(a, b) { return a + b; } f(10, 20);`, {
			incrementalCipher: true,
			stackEncoding: true,
		});
	});

	it("full max preset: simple", () => {
		assertEquivalent(`function f() { return 42; } f();`, { preset: "max" });
	});

	it("full max preset: try-catch", () => {
		assertEquivalent(
			`function f() { try { return JSON.parse('{"x":1}').x; } catch(e) { return -1; } } f();`,
			{ preset: "max" }
		);
	});

	it("full max preset: closures + recursion", () => {
		assertEquivalent(
			`function f() { function fib(n) { if (n <= 1) return n; return fib(n-1) + fib(n-2); } return fib(10); } f();`,
			{ preset: "max" }
		);
	});

	it("full max preset: loop + conditionals", () => {
		assertEquivalent(
			`function f(n) { var s = 0; for (var i = 1; i <= n; i++) { if (i % 3 === 0) s += i; } return s; } f(15);`,
			{ preset: "max" }
		);
	});

	it("async function", () => {
		assertEquivalent(
			`async function f() { return await Promise.resolve(42); } f();`,
			icOpts
		);
	});

	// Note: generators with for-of are a pre-existing issue (fails without
	// incrementalCipher too), so not tested here.
});
