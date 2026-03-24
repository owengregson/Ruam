/**
 * Bytecode scattering engine tests.
 *
 * Unit tests for the heterogeneous fragment engine + round-trip verification.
 */

import { describe, it, expect } from "bun:test";
import { scatterBytecodeUnit } from "../../src/ruamvm/bytecode-scatter.js";
import { emit } from "../../src/ruamvm/emit.js";

function makeNameGen(): () => string {
	let i = 0;
	return () => "_f" + i++;
}

describe("bytecode scattering engine", () => {
	it("returns typed fragments with declarations and reassembly", () => {
		const result = scatterBytecodeUnit(
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij",
			42,
			makeNameGen(),
			"__dec"
		);
		expect(result.fragments.length).toBeGreaterThanOrEqual(2);
		for (const f of result.fragments) {
			expect(f.decl.type).toBe("VarDecl");
			expect(typeof f.name).toBe("string");
		}
		expect(result.reassembly).toBeTruthy();
	});

	it("round-trips: fragments reconstruct original string", () => {
		const encoded = "testStringABC123xyzQWERTYuiopASDF";
		const result = scatterBytecodeUnit(
			encoded,
			555,
			makeNameGen(),
			"__dec"
		);

		// Build decode function + fragment declarations + reassembly
		const decodeFn = `var __dec=function(v){if(typeof v==="number")v=[v];var s="",i,n;for(i=0;i<v.length;i++){n=v[i];s+=String.fromCharCode(n>>>24&255,n>>>16&255,n>>>8&255,n&255)}return s};`;
		const fragCode = result.fragments
			.map((f) => emit(f.decl) + ";")
			.join("");
		const wrapper = new Function(
			decodeFn + fragCode + "\nreturn " + emit(result.reassembly) + ";"
		);
		expect(wrapper()).toBe(encoded);
	});

	it("handles short strings (no split)", () => {
		const result = scatterBytecodeUnit("AB", 1, makeNameGen(), "__dec");
		expect(result.fragments.length).toBe(1);
		expect(result.needsDecode).toBe(false);
	});

	it("produces heterogeneous fragment types across seeds", () => {
		const types = new Set<string>();
		for (let seed = 0; seed < 50; seed++) {
			// Use length divisible by 4 to allow packed type
			const result = scatterBytecodeUnit(
				"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij012345678901",
				seed,
				makeNameGen(),
				"__dec"
			);
			for (const f of result.fragments) {
				if (f.decl.type === "VarDecl" && f.decl.init) {
					types.add(f.decl.init.type);
				}
			}
		}
		// Should have string literals AND array expressions (packed ints)
		expect(types.has("Literal")).toBe(true);
		expect(types.has("ArrayExpr")).toBe(true);
	});

	it("respects min/max fragment parameters", () => {
		const result = scatterBytecodeUnit(
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
			777,
			makeNameGen(),
			"__dec",
			3,
			4
		);
		expect(result.fragments.length).toBeGreaterThanOrEqual(3);
		expect(result.fragments.length).toBeLessThanOrEqual(4);
	});

	it("deterministic: same seed produces same output", () => {
		const encoded = "SameInputSameOutputExpected12345678";
		const r1 = scatterBytecodeUnit(encoded, 42, makeNameGen(), "__dec");
		const r2 = scatterBytecodeUnit(encoded, 42, makeNameGen(), "__dec");
		expect(r1.fragments.length).toBe(r2.fragments.length);
		for (let i = 0; i < r1.fragments.length; i++) {
			expect(emit(r1.fragments[i]!.decl)).toBe(
				emit(r2.fragments[i]!.decl)
			);
		}
		expect(emit(r1.reassembly)).toBe(emit(r2.reassembly));
	});

	it("needsDecode is true when packed int fragments exist", () => {
		let foundDecode = false;
		for (let seed = 0; seed < 50; seed++) {
			const result = scatterBytecodeUnit(
				"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh",
				seed,
				makeNameGen(),
				"__dec"
			);
			if (result.needsDecode) {
				foundDecode = true;
				break;
			}
		}
		expect(foundDecode).toBe(true);
	});
});
