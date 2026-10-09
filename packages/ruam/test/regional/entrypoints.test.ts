import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Script } from "node:vm";
import { createHash } from "node:crypto";
import { compileRegionalCode } from "../../src/regional/index.js";
import { protectRegionalPath } from "../../src/regional/files.js";
import { runRegionalCli } from "../../src/regional/cli.js";

describe("regional entry points use complete-package admission", () => {
	it("preserves observable values and callback writes in final single-source bytes", () => {
		const source = `
			const state = { n: 1 };
			function run(cb) { state.n++; cb(state); return [state.n, -0, 1 / -0]; }
			run(function (shared) { shared.n = 40; });
		`;
		const build = compileRegionalCode(source, { seed: 7 });
		const actual = new Script(build.code).runInNewContext({}, { timeout: 1000 }) as number[];
		expect(actual[0]).toBe(40);
		expect(Object.is(actual[1], -0)).toBe(true);
		expect(actual[2]).toBe(-Infinity);
		expect(build.report.status).toBe("experimental-unqualified");
	});

	it("does not route unsupported source to legacy compilation", () => {
		expect(() => compileRegionalCode("eval('40 + 2')")).toThrow();
		expect(() => compileRegionalCode("async function task() { return 42; } task();")).toThrow();
		expect(() => compileRegionalCode("import { x } from './missing.js'; x;")).toThrow();
	});

	it("inventories every file and publishes only after every root succeeds", async () => {
		const temp = await mkdtemp(path.join(os.tmpdir(), "ruam-regional-input-"));
		try {
			const input = path.join(temp, "source");
			const output = path.join(temp, "output");
			await mkdir(input);
			await writeFile(path.join(input, "good.js"), "function run(x) { return x | 0; } run(42);");
			await writeFile(path.join(input, "bad.js"), "eval('42');");
			await expect(protectRegionalPath(input, output)).rejects.toThrow();
			expect(await readdir(temp)).toEqual(["source"]);
			await rm(path.join(input, "bad.js"));
			const build = await protectRegionalPath(input, output);
			expect(build.status).toBe("experimental-unqualified");
			expect(await readdir(output)).toEqual(["good.js"]);
			expect(new Script(await readFile(path.join(output, "good.js"), "utf8")).runInNewContext()).toBe(42);
			expect(await readFile(path.join(input, "good.js"), "utf8")).toBe("function run(x) { return x | 0; } run(42);");
			await expect(protectRegionalPath(input, output)).rejects.toThrow();
		} finally { await rm(temp, { recursive: true, force: true }); }
	});

	it("rejects ambiguous input and input/output overlap before publication", async () => {
		const temp = await mkdtemp(path.join(os.tmpdir(), "ruam-regional-input-"));
		try {
			const input = path.join(temp, "source");
			await mkdir(input);
			await writeFile(path.join(input, "input.js"), "42;");
			await expect(protectRegionalPath(input, path.join(input, "out"))).rejects.toThrow("outside");
			await writeFile(path.join(input, "ignored.json"), "{}");
			await expect(protectRegionalPath(input, path.join(temp, "out"))).rejects.toThrow("Only regular");
			await rm(path.join(input, "ignored.json"));
			await symlink(path.join(input, "input.js"), path.join(input, "alias.js"));
			await expect(protectRegionalPath(input, path.join(temp, "out"))).rejects.toThrow("Symbolic links");
			await rm(path.join(input, "alias.js"));
			await expect(protectRegionalPath(input, path.join(temp, "out"), { maxInputBytes: 1 })).rejects.toThrow("bytes");
			await expect(protectRegionalPath(input, path.join(temp, "out"), { maxFiles: NaN })).rejects.toThrow("positive");
			expect(await readdir(temp)).toEqual(["source"]);
		} finally { await rm(temp, { recursive: true, force: true }); }
	});

	it("requires explicit output and rejects production flags in the research command", async () => {
		await expect(runRegionalCli(["input.js"])).rejects.toThrow("requires an input");
		await expect(runRegionalCli(["input.js", "-o", "out", "--preset", "max"])).rejects.toThrow("Unknown regional option");
		await expect(runRegionalCli(["input.js", "-o", "out", "--seed", "4294967296"])).rejects.toThrow("uint32");
	});

	it("binds source inventory to the original UTF-8 bytes including a BOM", async () => {
		const temp = await mkdtemp(path.join(os.tmpdir(), "ruam-regional-bom-"));
		try {
			const input = path.join(temp, "source.js");
			const bytes = Buffer.from("\ufefffunction answer(){return 42;} answer();", "utf8");
			await writeFile(input, bytes);
			const build = await protectRegionalPath(input, path.join(temp, "output"));
			expect(build.sourceInventory[0]!.bytes).toBe(bytes.length);
			expect(build.sourceInventory[0]!.sha256).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
			expect(new Script(build.files["source.js"]!).runInNewContext()).toBe(42);
		} finally { await rm(temp, { recursive: true, force: true }); }
	});
});
