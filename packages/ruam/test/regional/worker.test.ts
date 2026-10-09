import { describe, expect, it } from "bun:test";
import { build } from "esbuild";
import { Script, createContext } from "node:vm";
import path from "node:path";

describe("regional browser-worker bundle", () => {
	it("compiles offline through the worker protocol with runtime source generation disabled", async () => {
		const bundle = await build({
			entryPoints: [path.resolve(import.meta.dir, "../../src/browser-worker.ts")],
			bundle: true, write: false, format: "iife", platform: "browser", target: "es2022",
			alias: { "node:crypto": path.resolve(import.meta.dir, "../../src/browser-crypto-shim.ts") },
			define: { "process.env.NODE_ENV": '"production"', "process.env": "{}", "process.platform": '"browser"', "process.versions": "{}" },
		});
		const messages: any[] = [];
		const worker: { onmessage?: (event: unknown) => void; postMessage: (value: unknown) => void } = {
			postMessage: value => messages.push(value),
		};
		const context = createContext({ self: worker, performance, TextEncoder, TextDecoder, process: { env: {}, platform: "browser", versions: {} } }, {
			codeGeneration: { strings: false, wasm: false },
		});
		new Script(bundle.outputFiles![0]!.text).runInContext(context, { timeout: 3000 });
		expect(messages.shift()).toEqual({ ready: true });
		worker.onmessage!({ data: { id: 1, mode: "regional-research", code: "function answer(x){return (x ^ 17) >>> 0;} answer(42);", regionalOptions: { seed: 8 } } });
		const result = messages.shift();
		expect(result.error).toBeUndefined();
		expect(result.report.status).toBe("experimental-unqualified");
		expect(result.report.releaseApproved).toBe(false);
		expect(new Script(result.result).runInNewContext({}, { timeout: 1000 })).toBe(59);
		worker.onmessage!({ data: { id: 2, mode: "regional-research", code: "eval('42')" } });
		expect(messages.shift().error).toContain("ADMISSION");
		worker.onmessage!({ data: { id: 3, mode: "regional-research", code: "42", options: { preset: "max" } } });
		expect(messages.shift().error).toContain("VM options");
		worker.onmessage!({ data: { id: 4, mode: "unknown", code: "42" } });
		expect(messages.shift().error).toContain("Unknown compiler");
		for (const mode of ["", null, false, 0]) {
			worker.onmessage!({ data: { id: 5, mode, code: "42" } });
			expect(messages.shift().error).toContain("Unknown compiler");
		}
		worker.onmessage!({ data: { id: 6, code: "42", regionalOptions: null } });
		expect(messages.shift().error).toContain("requires regional-research mode");
	});
});
