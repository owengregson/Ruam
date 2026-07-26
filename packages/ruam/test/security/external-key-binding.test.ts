import { describe, it, expect } from "bun:test";
import { obfuscateCode } from "../../src/transform.js";
import { resolveOptions } from "../../src/presets.js";
import { evalCode } from "../helpers.js";

const ACCESSOR = "globalThis.__RUAM_EXT_KEY";
const SECRET = "s3cr3t-license-9f2a";

// A function with enough instructions that a wrong-key (garbage) decode cannot
// coincidentally produce the correct result.
const SRC =
	"function compute(n){var s=0;for(var i=1;i<=n;i++){s+=i*i - (i%3);}return s}\ncompute(12)";
const EXPECTED = (() => {
	let s = 0;
	for (let i = 1; i <= 12; i++) s += i * i - (i % 3);
	return s;
})();

function runWithSecret(code: string, secret: string | undefined): unknown {
	const prelude =
		secret === undefined
			? ""
			: `globalThis.__RUAM_EXT_KEY = ${JSON.stringify(secret)};\n`;
	return evalCode(prelude + code);
}

describe("externalKeyBinding", () => {
	it("auto-enables rollingCipher", () => {
		const resolved = resolveOptions({
			externalKeyBinding: { value: SECRET, accessor: ACCESSOR },
		});
		expect(resolved.rollingCipher).toBe(true);
	});

	it("never embeds the secret value in the output", () => {
		const code = obfuscateCode(SRC, {
			targetMode: "root",
			preprocessIdentifiers: false,
			externalKeyBinding: { value: SECRET, accessor: ACCESSOR },
		});
		expect(code).not.toContain(SECRET);
	});

	it("decrypts and runs correctly when the runtime secret matches", () => {
		for (let iter = 0; iter < 25; iter++) {
			const code = obfuscateCode(SRC, {
				targetMode: "root",
				preprocessIdentifiers: false,
				externalKeyBinding: { value: SECRET, accessor: ACCESSOR },
			});
			expect(runWithSecret(code, SECRET)).toBe(EXPECTED);
		}
	});

	it("does NOT produce the correct result when the secret is wrong", () => {
		let denied = 0;
		for (let iter = 0; iter < 25; iter++) {
			const code = obfuscateCode(SRC, {
				targetMode: "root",
				preprocessIdentifiers: false,
				externalKeyBinding: { value: SECRET, accessor: ACCESSOR },
			});
			let result: unknown;
			try {
				result = runWithSecret(code, "wrong-secret");
			} catch {
				denied++;
				continue;
			}
			expect(result).not.toBe(EXPECTED);
			denied++;
		}
		expect(denied).toBe(25);
	});

	it("does NOT produce the correct result when the secret is absent", () => {
		const code = obfuscateCode(SRC, {
			targetMode: "root",
			preprocessIdentifiers: false,
			externalKeyBinding: { value: SECRET, accessor: ACCESSOR },
		});
		let result: unknown;
		let threw = false;
		try {
			result = runWithSecret(code, undefined);
		} catch {
			threw = true;
		}
		expect(threw || result !== EXPECTED).toBe(true);
	});

	it("rejects an invalid accessor at build time (dev gate)", () => {
		expect(() =>
			obfuscateCode(SRC, {
				targetMode: "root",
				preprocessIdentifiers: false,
				externalKeyBinding: {
					value: SECRET,
					accessor: "globalThis['x']; doEvil()",
				},
			})
		).toThrow();
	});

	it("supports a deeper accessor path", () => {
		const code = obfuscateCode(SRC, {
			targetMode: "root",
			preprocessIdentifiers: false,
			externalKeyBinding: {
				value: SECRET,
				accessor: "globalThis.__ruam.k",
			},
		});
		const result = evalCode(
			`globalThis.__ruam = { k: ${JSON.stringify(SECRET)} };\n` + code
		);
		expect(result).toBe(EXPECTED);
	});
});
