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

const MAX_BROWSER_SOURCE_BYTES = 1_000_000;

self.onmessage = (e: MessageEvent<unknown>) => {
	const request = e.data;
	if (
		!request ||
		typeof request !== "object" ||
		!Number.isSafeInteger((request as WorkerRequest).id) ||
		(request as WorkerRequest).id < 0 ||
		typeof (request as WorkerRequest).code !== "string" ||
		((request as WorkerRequest).options !== undefined &&
			(!(request as WorkerRequest).options ||
				typeof (request as WorkerRequest).options !== "object" ||
				Object.getPrototypeOf((request as WorkerRequest).options) !==
					Object.prototype))
	) {
		(self as unknown as Worker).postMessage({
			id: null,
			error: "RUAM_BROWSER_INVALID_REQUEST",
		});
		return;
	}
	const { id, code, options } = request as WorkerRequest;
	if (new TextEncoder().encode(code).byteLength > MAX_BROWSER_SOURCE_BYTES) {
		(self as unknown as Worker).postMessage({
			id,
			error: "RUAM_BROWSER_SOURCE_LIMIT",
		});
		return;
	}
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
		const message =
			err instanceof Error &&
			/^RUAM_[A-Z0-9_]+(?::|$)/u.test(err.message)
				? err.message
				: "RUAM_BROWSER_TRANSFORM_FAILED";
		(self as unknown as Worker).postMessage({ id, error: message });
	}
};

// Signal that the module has loaded and onmessage is set
(self as unknown as Worker).postMessage({ ready: true });
