import { describe, expect, it } from "bun:test";
import {
	createDeterministicEntropy,
	obfuscateCodeDeterministic,
} from "../../src/testing.js";

describe("deterministic build entropy", () => {
	it("reproduces the same complete transform for a fixed seed", () => {
		const source = `
			function alpha(x) { return x + 1; }
			function beta(x) { return x * 2; }
			[alpha(4), beta(5)];
		`;
		const options = {
			targetMode: "root" as const,
			threshold: 0.5,
			preprocessIdentifiers: true,
			rollingCipher: true,
		};

		const first = obfuscateCodeDeterministic(source, options, 0x12345678);
		const second = obfuscateCodeDeterministic(source, options, 0x12345678);

		expect(second).toBe(first);
	});

	it("keeps labeled entropy streams isolated", () => {
		const first = createDeterministicEntropy(42);
		const second = createDeterministicEntropy(42);

		const firstFile = first.nextUint32("file");
		first.nextUint32("unrelated");
		first.nextUint32("unrelated");
		const firstCipher = first.nextUint32("cipher");

		expect(second.nextUint32("file")).toBe(firstFile);
		expect(second.nextUint32("cipher")).toBe(firstCipher);
	});

	it("changes randomized output when the root seed changes", () => {
		const source = `function f(x) { return x * x + 1; } f(9);`;
		const outputs = new Set(
			Array.from({ length: 8 }, (_, seed) =>
				obfuscateCodeDeterministic(source, {}, seed)
			)
		);

		expect(outputs.size).toBeGreaterThan(1);
	});
});
