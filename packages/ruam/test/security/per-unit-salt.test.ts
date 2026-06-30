import { describe, it, expect } from "bun:test";
import { assertEquivalent } from "../helpers.js";
import { deriveSeed } from "../../src/naming/scope.js";

// W2 — per-unit key salt.
//
// Every compiled unit gets a distinct per-unit salt folded into its cipher key,
// so two units with IDENTICAL metadata (instr/reg/param/const counts) no longer
// derive the SAME key (which would share the position keystream across units).
// These tests exercise the exact collision case across seeds + configs to lock
// build==runtime symmetry of the new serialized salt field.

describe("per-unit key salt", () => {
	// Source with several structurally-IDENTICAL functions (same metadata) —
	// the case the salt targets. They previously shared a key.
	const DUP_SOURCE = `
		function a1(x){return x*2+1}
		function a2(x){return x*2+1}
		function a3(x){return x*2+1}
		function a4(x){return x*2+1}
		[a1(3), a2(3), a3(3), a4(3)]
	`;

	const configs: { name: string; opts: Record<string, unknown> }[] = [
		{ name: "rollingCipher", opts: { rollingCipher: true } },
		{ name: "medium preset", opts: { preset: "medium" } },
		{ name: "max preset", opts: { preset: "max" } },
		{
			name: "incrementalCipher",
			opts: { rollingCipher: true, incrementalCipher: true },
		},
	];

	for (const cfg of configs) {
		it(`${cfg.name}: duplicate-metadata functions round-trip across seeds`, () => {
			for (let iter = 0; iter < 15; iter++) {
				assertEquivalent(DUP_SOURCE, {
					targetMode: "root",
					preprocessIdentifiers: false,
					...cfg.opts,
				});
			}
		});
	}

	it("string-heavy duplicate functions round-trip (salts the string key too)", () => {
		const src = `
			function s1(){return "alpha"+"beta"}
			function s2(){return "alpha"+"beta"}
			[s1(), s2()]
		`;
		for (let iter = 0; iter < 15; iter++) {
			assertEquivalent(src, {
				targetMode: "root",
				preprocessIdentifiers: false,
				preset: "medium",
			});
		}
	});

	it("derives a distinct salt per unit id (mechanism)", () => {
		const seed = 0x12345678;
		const salts = ["a", "b", "c", "d"].map(
			(id) => deriveSeed(seed, `unitSalt:${id}`) >>> 0
		);
		expect(new Set(salts).size).toBe(salts.length);
	});
});
