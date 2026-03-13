/**
 * Web Worker entry point for the Ruam playground.
 *
 * Receives `{ code, options }` messages, runs obfuscation, and posts
 * back `{ result }` or `{ error }` responses.
 *
 * @module browser-worker
 */

import { obfuscateCode } from "./transform.js";
import type { VmObfuscationOptions } from "./types.js";

interface WorkerRequest {
	id: number;
	code: string;
	options?: VmObfuscationOptions;
}

interface WorkerResponseOk {
	id: number;
	result: string;
	elapsed: number;
}

interface WorkerResponseErr {
	id: number;
	error: string;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
	const { id, code, options } = e.data;
	const start = performance.now();
	try {
		const result = obfuscateCode(code, options);
		const elapsed = Math.round(performance.now() - start);
		(self as unknown as Worker).postMessage({
			id,
			result,
			elapsed,
		} satisfies WorkerResponseOk);
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : String(err);
		(self as unknown as Worker).postMessage({
			id,
			error: message,
		} satisfies WorkerResponseErr);
	}
};
