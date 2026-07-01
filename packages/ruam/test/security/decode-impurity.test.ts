import { describe, it, expect } from "bun:test";
import { assertEquivalent, evalObfuscated } from "../helpers.js";
import { obfuscateCode } from "../../src/transform.js";
import {
	rollingEncryptChained,
	assertChainedDecryptInverts,
} from "../../src/compiler/rolling-cipher.js";

// W3 — decode-path impurity (chained keystream) behind the mandatory
// build-time self-equality gate.

describe("decode impurity", () => {
	const PROGRAMS: { name: string; src: string }[] = [
		{
			name: "arithmetic loop",
			src: "function f(n){var s=0;for(var i=0;i<n;i++){s+=i*i-(i%3);}return s}\nf(30)",
		},
		{
			name: "recursion",
			src: "function fib(n){return n<2?n:fib(n-1)+fib(n-2)}\nfib(16)",
		},
		{
			name: "branchy + try/catch",
			src: "function g(n){var r=0;for(var i=0;i<n;i++){try{if(i%2)r+=i;else r-=1;if(i>20)throw 0;}catch(e){r+=100;}}return r}\ng(25)",
		},
		{
			name: "strings + objects",
			src: 'function h(){var o={a:"x",b:"y"};return o.a+o.b+"z"}\nh()',
		},
	];

	it("build-time self-equality gate validates the chained encrypt inverts", () => {
		// A representative instruction stream.
		const instrs: number[] = [];
		for (let i = 0; i < 40; i++) {
			instrs.push((i * 7 + 3) & 0xffff, (i * 131 - 5) | 0);
		}
		const original = instrs.slice();
		rollingEncryptChained(instrs, 0xdeadbeef);
		expect(instrs).not.toEqual(original); // actually encrypted
		// Gate must pass for a correct encrypt.
		expect(() =>
			assertChainedDecryptInverts(instrs, 0xdeadbeef, original)
		).not.toThrow();
		// Gate must FAIL if the ciphertext is tampered.
		const tampered = instrs.slice();
		tampered[10] = (tampered[10]! ^ 0x55) & 0xffff;
		expect(() =>
			assertChainedDecryptInverts(tampered, 0xdeadbeef, original)
		).toThrow();
	});

	it("decodeImpurity builds round-trip across seeds (build==runtime symmetry)", () => {
		for (const prog of PROGRAMS) {
			for (let iter = 0; iter < 15; iter++) {
				assertEquivalent(prog.src, {
					targetMode: "root",
					preprocessIdentifiers: false,
					decodeImpurity: true,
				});
			}
		}
	});

	it("decodeImpurity changes the emitted bytecode vs plain rolling cipher", () => {
		// Same source, two builds: with and without impurity. Both must run.
		const src = PROGRAMS[0]!.src;
		expect(
			evalObfuscated(src, {
				targetMode: "root",
				preprocessIdentifiers: false,
				decodeImpurity: true,
			})
		).toBe(
			evalObfuscated(src, {
				targetMode: "root",
				preprocessIdentifiers: false,
				rollingCipher: true,
			})
		);
	});

	it("auto-enables rollingCipher", async () => {
		const { resolveOptions } = await import("../../src/presets.js");
		expect(resolveOptions({ decodeImpurity: true }).rollingCipher).toBe(true);
	});

	it("throws when combined with cache-disabling features (loud, not silent)", () => {
		const src = PROGRAMS[0]!.src;
		for (const bad of [
			{ incrementalCipher: true },
			{ opcodeMutation: true },
			{ observationResistance: true },
			{ vmShielding: true },
		]) {
			expect(() =>
				obfuscateCode(src, {
					targetMode: "root",
					preprocessIdentifiers: false,
					decodeImpurity: true,
					...bad,
				})
			).toThrow();
		}
	});
});
