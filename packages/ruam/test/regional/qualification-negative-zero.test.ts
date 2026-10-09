import { describe, expect, it } from "bun:test";
import { Script } from "node:vm";
import { obfuscateCode } from "../../src/transform.js";

describe("legacy encoded stack preserves numeric observations", () => {
	for (const options of [{ stackEncoding: true }, { preset: "max" as const }]) {
		it(`${JSON.stringify(options)} preserves negative zero through calls and stack operations`, () => {
			const source = `
				function echo(value) { return value; }
				function collect(value) { return [echo(value), echo(-value), 1 / echo(value)]; }
				collect(-0);
			`;
			for (let build = 0; build < 8; build++) {
				const output = obfuscateCode(source, options);
				const result = new Script(output).runInNewContext(
					{ setTimeout, setInterval, clearTimeout, clearInterval },
					{ timeout: 2_000 }
				) as number[];
				expect(Object.is(result[0], -0)).toBe(true);
				expect(Object.is(result[1], 0)).toBe(true);
				expect(result[2]).toBe(-Infinity);
			}
		});
	}
});
