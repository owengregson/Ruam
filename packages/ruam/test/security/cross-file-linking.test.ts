import { describe, it, expect } from "bun:test";
import { obfuscateBundle } from "../../src/transform.js";
import { evalSharedSequence, evalCode } from "../helpers.js";

// W4-L2 — opt-in cross-file runtime co-residence link.
//
// A consumer file folds a secret written by a provider file to a shared global
// at load. Strict binding (no fallback): a consumer cannot decrypt/run without
// its provider present-and-earlier in the same realm.

const PROVIDER = { path: "prov.js", code: "var __pInit = 1;" };
const CONSUMER = {
	path: "cons.js",
	code: "function compute(n){var s=0;for(var i=1;i<=n;i++){s+=i;}return s}\nglobalThis.__R = compute(10);",
};
const EXPECTED = 55;

const OPTS = {
	targetMode: "root" as const,
	target: "browser-extension" as const, // wrap each file in an IIFE (no top-level collisions)
	rollingCipher: true,
	preprocessIdentifiers: false,
};
const LINK = { provider: "prov.js", consumers: ["cons.js"] };

describe("cross-file runtime linking", () => {
	it("provider output writes a shared-global secret (char-code, no plaintext)", () => {
		const out = obfuscateBundle([PROVIDER, CONSUMER], OPTS, LINK);
		const provOut = out.find((f) => f.path === "prov.js")!.code;
		expect(provOut).toContain("globalThis[");
		expect(provOut).toContain("String.fromCharCode(");
	});

	it("consumer runs correctly when the provider loaded first (same realm)", () => {
		for (let iter = 0; iter < 20; iter++) {
			const out = obfuscateBundle([PROVIDER, CONSUMER], OPTS, LINK);
			const prov = out.find((f) => f.path === "prov.js")!.code;
			const cons = out.find((f) => f.path === "cons.js")!.code;
			const ctx = evalSharedSequence([prov, cons]);
			expect(ctx.__R).toBe(EXPECTED);
		}
	});

	it("consumer is DENIED when the provider is absent", () => {
		let denied = 0;
		for (let iter = 0; iter < 20; iter++) {
			const out = obfuscateBundle([PROVIDER, CONSUMER], OPTS, LINK);
			const cons = out.find((f) => f.path === "cons.js")!.code;
			try {
				const ctx = evalSharedSequence([cons]); // provider NOT run
				if (ctx.__R !== EXPECTED) denied++;
			} catch {
				denied++;
			}
		}
		expect(denied).toBe(20);
	});

	it("provider itself still runs (it is not a consumer)", () => {
		const out = obfuscateBundle(
			[
				PROVIDER,
				{ path: "cons.js", code: "globalThis.__R = 7;" },
			],
			OPTS,
			LINK
		);
		const prov = out.find((f) => f.path === "prov.js")!.code;
		// Provider's own IIFE runs without error (the prepended write + IIFE).
		expect(() => evalCode(prov)).not.toThrow();
	});

	it("without a link declaration, files run standalone (Layer-1 only)", () => {
		const out = obfuscateBundle([PROVIDER, CONSUMER], OPTS /* no link */);
		const cons = out.find((f) => f.path === "cons.js")!.code;
		const ctx = evalSharedSequence([cons]);
		expect(ctx.__R).toBe(EXPECTED);
	});
});
