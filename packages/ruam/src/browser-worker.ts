/**
 * Web Worker entry point for the Ruam playground.
 *
 * Receives `{ code, options }` messages, runs obfuscation, and posts
 * back `{ result }` or `{ error }` responses. Explicit `regional-research`
 * requests use `regionalOptions` and also return an unqualified owner report.
 * Posts a `{ ready: true }`
 * message on load so the main thread knows the module is initialized.
 *
 * @module browser-worker
 */

import { obfuscateCode } from "./transform.js";
import type { VmObfuscationOptions } from "./types.js";
import { compileRegionalCode } from "./regional/index.js";
import type { RegionalGraphOptions } from "./regional/index.js";

interface WorkerRequest {
	id: number;
	code: string;
	options?: VmObfuscationOptions;
	mode?: "legacy" | "regional-research";
	regionalOptions?: RegionalGraphOptions;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
	const { id, code, options } = e.data;
	const start = performance.now();
	try {
		if (e.data.mode !== undefined && e.data.mode !== "legacy" && e.data.mode !== "regional-research") {
			throw new Error("Unknown compiler mode");
		}
		if (e.data.mode === "regional-research") {
			if (options && Object.keys(options).length) throw new Error("VM options do not apply to the regional research compiler");
			const build = compileRegionalCode(code, e.data.regionalOptions);
			(self as unknown as Worker).postMessage({
				id, result: build.code, report: build.report,
				elapsed: Math.round(performance.now() - start),
			});
			return;
		}
		if (e.data.regionalOptions !== undefined) throw new Error("regionalOptions requires regional-research mode");
		const result = obfuscateCode(code, options);
		const elapsed = Math.round(performance.now() - start);
		(self as unknown as Worker).postMessage({ id, result, elapsed });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		(self as unknown as Worker).postMessage({ id, error: message });
	}
};

// Signal that the module has loaded and onmessage is set
(self as unknown as Worker).postMessage({ ready: true });
