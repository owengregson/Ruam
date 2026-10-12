import { expect, it } from "bun:test";
import { runInNewContext } from "node:vm";
import { recoverWordTableTransitions } from "../../src/algorithm-state/qualification/word-fusion-attack.js";

// Independently synthesize a numeric control, without any application source.
const transition = (word: number) => { word ^= word << 7; word ^= word >>> 9; word ^= word << 8; return word >>> 0; };
function artifact(corrupt = false, leak = false) {
	const tables = Array.from({ length: 8 }, (_, nibble) => Array.from({ length: 16 }, (_, value) => transition(value << (nibble * 4))));
	if (corrupt) tables[3]![15]! ^= 1;
	return `function step(word){${tables.map((table, i) => `const t${i}=${JSON.stringify(table)};`).join("")}word=(${tables.map((_, i) => `t${i}[(word>>>${i * 4})&15]`).join("^")})>>>0;${leak ? "globalThis.leak=t0;" : ""}return word;}`;
}
it("recovers a complete numeric table transition and executes a partial edit", () => {
	const recovered = recoverWordTableTransitions(artifact()), edited = recoverWordTableTransitions(artifact(), 1);
	expect(recovered.status).toBe("recovered");
	expect(recovered.regions[0]!.verifiedTableEntries).toBe(128);
	expect(recovered.codeBytes).toBeLessThan(recovered.artifactBytes);
	expect(recovered.wholeProgramRecoveryEstablished).toBe(false);
	const f = runInNewContext(`${recovered.code};step`), e = runInNewContext(`${edited.code};step`);
	for (const value of [0, 1, 0xffffffff, 0x80000000, 0x12345678, ...Array.from({ length: 32 }, (_, i) => 2 ** i)]) {
		expect(f(value)).toBe(transition(value));
		expect(e(value)).toBe((transition(value) ^ 1) >>> 0);
	}
});
it("declines nonlinear or externally retained tables", () => {
	expect(recoverWordTableTransitions(artifact(true)).status).toBe("unsupported");
	expect(recoverWordTableTransitions(artifact(false, true)).status).toBe("unsupported");
});
