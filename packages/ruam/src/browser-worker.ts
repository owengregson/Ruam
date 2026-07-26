/**
 * Web Worker entry point for the Ruam playground.
 *
 * Receives `{ code, options }` messages, runs Isogloss protection, and posts
 * back `{ result, stats, diagnostics }` or `{ error }` responses. Posts a `{ ready: true }`
 * message on load so the main thread knows the module is initialized.
 *
 * @module browser-worker
 */

import { protectCode } from "./transform.js";
import type { RuamOptions } from "./isogloss/options.js";

interface WorkerRequest {
	id: number;
	code: string;
	options?: RuamOptions;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
	const { id, code, options } = e.data;
	const start = performance.now();
	try {
		const build = protectCode(code, options);
		const elapsed = Math.round(performance.now() - start);
		(self as unknown as Worker).postMessage({
			id,
			result: build.code,
			stats: build.stats,
			diagnostics: build.diagnostics,
			elapsed,
		});
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		(self as unknown as Worker).postMessage({ id, error: message });
	}
};

// Signal that the module has loaded and onmessage is set
(self as unknown as Worker).postMessage({ ready: true });
