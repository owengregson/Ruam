import { describe, expect, it } from "bun:test";
import { parse } from "@babel/parser";
import {
	PREPROCESS_IDENTIFIER_LIMITS,
	preprocessIdentifiers,
} from "../src/preprocess.js";
import { protectCodeWithEntropy } from "../src/transform.js";

describe("identifier preprocessing", () => {
	it("reserves every author identifier before choosing replacement names", () => {
		const source =
			"const yzM=1;function collision(value){const nested=value+yzM;return nested;}";
		for (let seed = 0; seed < 128; seed++) {
			const result = preprocessIdentifiers(source, seed);
			expect(() =>
				parse(result.code, { sourceType: "unambiguous" })
			).not.toThrow();
			expect(new Set(result.usedNames).size).toBe(
				result.usedNames.size
			);
		}
	});

	it("renames only author bindings before generated helper insertion", () => {
		const functionNames = Array.from(
			{ length: 24 },
			(_, index) => `kernel${index}`
		);
		const source = functionNames
			.map(
				(name) =>
					`function ${name}(x){const y=x+1;return y*2+3;}`
			)
			.join("\n");
		const regionDomains = Object.fromEntries(
			functionNames.map((name) => [
				name,
				{
					x: { type: "number" as const, min: 0, max: 20 },
					y: { type: "number" as const, min: 1, max: 21 },
				},
			])
		);
		let word = 0;
		const started = performance.now();
		const result = protectCodeWithEntropy(
			source,
			{ preprocessIdentifiers: true, regionDomains },
			{
				nextUint32() {
					return word++;
				},
			}
		);
		expect(performance.now() - started).toBeLessThan(2_000);
		expect(result.stats.protectedRegionCount).toBe(
			functionNames.length
		);
		expect(() =>
			parse(result.code, { sourceType: "unambiguous" })
		).not.toThrow();
	});

	it("fails closed before quadratic rename work on excessive author bindings", () => {
		const source = Array.from(
			{ length: PREPROCESS_IDENTIFIER_LIMITS.bindings + 1 },
			(_, index) => `let authorBinding${index}=${index};`
		).join("");
		const started = performance.now();
		expect(() => preprocessIdentifiers(source, 17)).toThrow(
			"RUAM_PREPROCESS_RESOURCE_LIMIT"
		);
		expect(performance.now() - started).toBeLessThan(1_000);
	});
});
