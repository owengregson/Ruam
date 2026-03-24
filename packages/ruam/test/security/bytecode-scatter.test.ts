/**
 * Bytecode scattering engine tests.
 *
 * Unit tests for the chunk splitting engine + round-trip verification.
 */

import { describe, it, expect } from "bun:test";
import { scatterBytecodeUnit } from "../../src/ruamvm/bytecode-scatter.js";

describe("bytecode scattering engine", () => {
	it("returns ordered string chunks", () => {
		const result = scatterBytecodeUnit(
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
			42
		);
		expect(result.chunks.length).toBeGreaterThanOrEqual(2);
		for (const chunk of result.chunks) {
			expect(typeof chunk).toBe("string");
			expect(chunk.length).toBeGreaterThan(0);
		}
	});

	it("round-trips: joined chunks equal original", () => {
		const encoded = "testStringABC123xyzQWERTYuiop";
		const result = scatterBytecodeUnit(encoded, 555);
		expect(result.chunks.join("")).toBe(encoded);
	});

	it("handles short strings (no split)", () => {
		const result = scatterBytecodeUnit("AB", 1);
		expect(result.chunks.length).toBe(1);
		expect(result.chunks[0]).toBe("AB");
	});

	it("handles medium strings", () => {
		const encoded = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH";
		const result = scatterBytecodeUnit(encoded, 12345);
		expect(result.chunks.join("")).toBe(encoded);
		expect(result.chunks.length).toBeGreaterThanOrEqual(2);
	});

	it("respects min/max fragment parameters", () => {
		const result = scatterBytecodeUnit(
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
			777,
			3,
			4
		);
		expect(result.chunks.length).toBeGreaterThanOrEqual(3);
		expect(result.chunks.length).toBeLessThanOrEqual(4);
	});

	it("deterministic: same seed produces same output", () => {
		const encoded = "SameInputSameOutputExpected1234";
		const r1 = scatterBytecodeUnit(encoded, 42);
		const r2 = scatterBytecodeUnit(encoded, 42);
		expect(r1.chunks).toEqual(r2.chunks);
	});

	it("different seeds produce different splits", () => {
		const encoded = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop";
		const r1 = scatterBytecodeUnit(encoded, 1);
		const r2 = scatterBytecodeUnit(encoded, 999);
		// Same content but at least some chunks should differ in size
		expect(r1.chunks.join("")).toBe(r2.chunks.join(""));
		const differ = r1.chunks.some(
			(c, i) => c !== (r2.chunks[i] ?? "")
		);
		expect(differ).toBe(true);
	});

	it("produces variable-length chunks (not equal splits)", () => {
		// Run across seeds and check that chunk sizes vary
		const sizes = new Set<number>();
		for (let seed = 0; seed < 20; seed++) {
			const result = scatterBytecodeUnit(
				"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
				seed
			);
			for (const chunk of result.chunks) {
				sizes.add(chunk.length);
			}
		}
		// Should have at least 3 distinct chunk sizes across 20 seeds
		expect(sizes.size).toBeGreaterThanOrEqual(3);
	});
});
