import { describe, it, expect } from "bun:test";
import { obfuscateCode } from "../src/transform.js";
import type { VmObfuscationOptions } from "../src/types.js";
import vm from "node:vm";

function makeContext(): vm.Context {
	return vm.createContext({
		console,
		Array,
		Object,
		String,
		Number,
		Boolean,
		Symbol,
		Math,
		JSON,
		Date,
		RegExp,
		Error,
		TypeError,
		RangeError,
		SyntaxError,
		ReferenceError,
		Map,
		Set,
		WeakMap,
		WeakSet,
		Promise,
		Proxy,
		Reflect,
		parseInt,
		parseFloat,
		isNaN,
		isFinite,
		undefined,
		NaN,
		Infinity,
		setTimeout,
		setInterval,
		clearTimeout,
		clearInterval,
		queueMicrotask,
		Uint8Array,
		Int8Array,
		Int32Array,
		Float64Array,
		ArrayBuffer,
		DataView,
		TextEncoder,
		TextDecoder,
		Buffer,
	});
}

async function wrapModule(
	specifier: string,
	ctx: vm.Context
): Promise<vm.Module> {
	const mod = await import(specifier);
	const exports = Object.keys(mod);
	const synth = new vm.SyntheticModule(
		exports,
		function () {
			for (const key of exports) {
				this.setExport(key, mod[key]);
			}
		},
		{ context: ctx }
	);
	await synth.link(() => {
		throw new Error("unexpected link");
	});
	await synth.evaluate();
	return synth;
}

function runInContext(code: string, ctx: vm.Context): unknown {
	const script = new vm.Script(code, {
		importModuleDynamically: ((specifier: string) => {
			return wrapModule(specifier, ctx);
		}) as vm.ScriptOptions["importModuleDynamically"],
	});
	return script.runInContext(ctx);
}

export function evalOriginal(source: string): unknown {
	return runInContext(source, makeContext());
}

/**
 * Evaluate already-obfuscated code (e.g. bundle output) in a fresh context.
 * Returns the value of the script's final expression.
 */
export function evalCode(code: string): unknown {
	return runInContext(code, makeContext());
}

/**
 * Run a sequence of code strings in ONE shared context (shared globalThis),
 * in order. Returns the context's global object so tests can read values the
 * scripts wrote to globalThis (e.g. `globalThis.__R = ...`). Used to simulate
 * a cross-file runtime link: provider script first, consumer script second.
 */
export function evalSharedSequence(
	codes: string[]
): Record<string, unknown> {
	const ctx = makeContext();
	for (const code of codes) runInContext(code, ctx);
	return ctx as unknown as Record<string, unknown>;
}

export function evalObfuscated(
	source: string,
	options?: VmObfuscationOptions
): unknown {
	const obfuscated = obfuscateCode(source, {
		targetMode: "root",
		encryptBytecode: false,
		preprocessIdentifiers: false,
		...options,
	});
	try {
		return runInContext(obfuscated, makeContext());
	} catch (e) {
		console.error("ERROR:", (e as Error).message);
		console.error("--- OBFUSCATED CODE (first 200 lines) ---");
		console.error(obfuscated.split("\n").slice(0, 200).join("\n"));
		console.error("--- END ---");
		throw e;
	}
}

export function assertEquivalent(
	source: string,
	options?: VmObfuscationOptions
): void {
	const original = evalOriginal(source);
	const obfuscated = evalObfuscated(source, options);
	expect(obfuscated).toEqual(original);
}
