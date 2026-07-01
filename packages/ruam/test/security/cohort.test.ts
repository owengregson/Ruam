import { describe, it, expect } from "bun:test";
import { createCohort } from "../../src/compiler/cohort.js";
import { obfuscateBundle } from "../../src/transform.js";
import { evalCode } from "../helpers.js";

describe("cohort digest", () => {
	const files = [
		{ path: "a.js", code: "var a = 1;" },
		{ path: "b.js", code: "var b = 2;" },
		{ path: "c.js", code: "function f(x){return x*2}" },
	];

	it("digestAll is deterministic", () => {
		const c = createCohort(files, 12345);
		expect(c.digestAll()).toBe(c.digestAll());
		expect(createCohort(files, 12345).digestAll()).toBe(
			createCohort(files, 12345).digestAll()
		);
	});

	it("digestAll is independent of file ordering", () => {
		const a = createCohort(files, 777).digestAll();
		const reordered = [files[2]!, files[0]!, files[1]!];
		const b = createCohort(reordered, 777).digestAll();
		expect(a).toBe(b);
	});

	it("digestAll differs across cohort seeds", () => {
		expect(createCohort(files, 1).digestAll()).not.toBe(
			createCohort(files, 2).digestAll()
		);
	});

	it("digestAll depends on every file's content", () => {
		const base = createCohort(files, 9).digestAll();
		const changed = createCohort(
			[files[0]!, files[1]!, { path: "c.js", code: "function f(x){return x*3}" }],
			9
		).digestAll();
		expect(base).not.toBe(changed);
	});

	it("digestAll is a uint32", () => {
		const d = createCohort(files, 0xdeadbeef).digestAll();
		expect(d).toBe(d >>> 0);
		expect(Number.isInteger(d)).toBe(true);
	});
});

describe("obfuscateBundle build==runtime symmetry under cohort fold", () => {
	// The cohort term is folded into the key anchor at BOTH build and runtime.
	// If the fold were asymmetric, decryption would garble and these would
	// throw or return the wrong value. Run across many fresh random seeds.
	it("round-trips every file in a multi-file cohort with rolling cipher", () => {
		for (let iter = 0; iter < 30; iter++) {
			const out = obfuscateBundle(
				[
					{ path: "f1.js", code: "function add(a,b){return a+b}\nadd(2,3)" },
					{ path: "f2.js", code: "function mul(a,b){return a*b}\nmul(4,5)" },
					{
						path: "f3.js",
						code: "function g(n){var s=0;for(var i=0;i<n;i++)s+=i;return s}\ng(5)",
					},
				],
				{
					targetMode: "root",
					rollingCipher: true,
					preprocessIdentifiers: false,
				}
			);
			expect(out).toHaveLength(3);
			expect(evalCode(out[0]!.code)).toBe(5);
			expect(evalCode(out[1]!.code)).toBe(20);
			expect(evalCode(out[2]!.code)).toBe(10);
		}
	});

	it("a single-file bundle behaves like plain obfuscation (no cohort term)", () => {
		const out = obfuscateBundle(
			[{ path: "solo.js", code: "function sq(x){return x*x}\nsq(7)" }],
			{ targetMode: "root", rollingCipher: true, preprocessIdentifiers: false }
		);
		expect(out).toHaveLength(1);
		expect(evalCode(out[0]!.code)).toBe(49);
	});

	it("round-trips under the medium preset across seeds", () => {
		for (let iter = 0; iter < 20; iter++) {
			const out = obfuscateBundle(
				[
					{ path: "p.js", code: "function inc(x){return x+1}\ninc(41)" },
					{ path: "q.js", code: "function dec(x){return x-1}\ndec(43)" },
				],
				{ targetMode: "root", preset: "medium", preprocessIdentifiers: false }
			);
			expect(evalCode(out[0]!.code)).toBe(42);
			expect(evalCode(out[1]!.code)).toBe(42);
		}
	});
});
