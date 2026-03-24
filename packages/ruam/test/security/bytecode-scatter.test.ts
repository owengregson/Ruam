/**
 * Bytecode scattering engine tests.
 *
 * Unit tests for the fragment engine + round-trip verification.
 */

import { describe, it, expect } from "bun:test";
import { scatterBytecodeUnit } from "../../src/ruamvm/bytecode-scatter.js";
import { emit } from "../../src/ruamvm/emit.js";

function makeNameGen(): () => string {
	let i = 0;
	return () => "_f" + i++;
}

describe("bytecode scattering engine", () => {
	it("returns JsNode varDecl fragments", () => {
		const result = scatterBytecodeUnit(
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
			42,
			makeNameGen(),
			new Set(),
			"__up"
		);
		expect(result.fragments.length).toBeGreaterThanOrEqual(2);
		for (const f of result.fragments) {
			expect(f.type).toBe("VarDecl");
		}
	});

	it("reassembly emits valid JS", () => {
		const result = scatterBytecodeUnit(
			"ABCDEFGHIJKLMNOPabcdefghijklmnop",
			99,
			makeNameGen(),
			new Set(),
			"__up"
		);
		const reassemblyStr = emit(result.reassembly);
		expect(reassemblyStr).toBeTruthy();
		expect(typeof reassemblyStr).toBe("string");
	});

	it("round-trips: fragments + reassembly = original", () => {
		const encoded = "testStringABC123xyzQWERTYuiop";
		const result = scatterBytecodeUnit(
			encoded,
			555,
			makeNameGen(),
			new Set(),
			"__up"
		);

		// Build executable code: emit all fragments + reassembly
		const unpackFn = `var __up=function(a){var s="",i,n;for(i=0;i<a.length;i++){n=a[i];s+=String.fromCharCode(n>>>24&255,n>>>16&255,n>>>8&255,n&255)}return s};`;
		const fragCode = result.fragments.map((f) => emit(f) + ";").join("\n");
		const wrapper = new Function(
			unpackFn + fragCode + "\nreturn " + emit(result.reassembly) + ";"
		);
		expect(wrapper()).toBe(encoded);
	});

	it("handles short strings (no split)", () => {
		const result = scatterBytecodeUnit(
			"AB",
			1,
			makeNameGen(),
			new Set(),
			"__up"
		);
		expect(result.fragments.length).toBe(1);
	});

	it("handles medium strings", () => {
		const encoded = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH";
		const result = scatterBytecodeUnit(
			encoded,
			12345,
			makeNameGen(),
			new Set(),
			"__up"
		);

		const unpackFn = `var __up=function(a){var s="",i,n;for(i=0;i<a.length;i++){n=a[i];s+=String.fromCharCode(n>>>24&255,n>>>16&255,n>>>8&255,n&255)}return s};`;
		const fragCode = result.fragments.map((f) => emit(f) + ";").join("\n");
		const wrapper = new Function(
			unpackFn + fragCode + "\nreturn " + emit(result.reassembly) + ";"
		);
		expect(wrapper()).toBe(encoded);
	});

	it("produces different fragment types (string + packed)", () => {
		// Run multiple seeds and check that we get variety
		const types = new Set<string>();
		for (let seed = 0; seed < 50; seed++) {
			// Use length divisible by 4 to allow packed type
			const result = scatterBytecodeUnit(
				"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij012345678901",
				seed,
				makeNameGen(),
				new Set(),
				"__up"
			);
			for (const f of result.fragments) {
				if (f.type === "VarDecl" && f.init) {
					types.add(f.init.type);
				}
			}
		}
		// Should have string literals and array expressions (packed ints)
		expect(types.has("Literal")).toBe(true);
		expect(types.has("ArrayExpr")).toBe(true);
	});

	it("respects min/max fragment parameters", () => {
		const result = scatterBytecodeUnit(
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
			777,
			makeNameGen(),
			new Set(),
			"__up",
			3,
			4
		);
		expect(result.fragments.length).toBeGreaterThanOrEqual(3);
		expect(result.fragments.length).toBeLessThanOrEqual(4);
	});

	it("deterministic: same seed produces same output", () => {
		const encoded = "SameInputSameOutputExpected1234";
		const gen1 = makeNameGen();
		const gen2 = makeNameGen();
		const r1 = scatterBytecodeUnit(encoded, 42, gen1, new Set(), "__up");
		const r2 = scatterBytecodeUnit(encoded, 42, gen2, new Set(), "__up");

		expect(r1.fragments.length).toBe(r2.fragments.length);
		for (let i = 0; i < r1.fragments.length; i++) {
			expect(emit(r1.fragments[i]!)).toBe(emit(r2.fragments[i]!));
		}
		expect(emit(r1.reassembly)).toBe(emit(r2.reassembly));
	});
});
