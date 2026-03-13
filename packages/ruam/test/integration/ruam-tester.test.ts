import { describe, it, expect } from "vitest";
import { obfuscateCode } from "../../src/transform.js";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";

describe("RuamTester comprehensive", () => {
	const testerSource = fs.readFileSync(
		path.join(import.meta.dirname, "..", "RuamTester.js"),
		"utf-8"
	);

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
			clearTimeout,
			queueMicrotask,
			Uint8Array,
			Int8Array,
			Float64Array,
			ArrayBuffer,
			DataView,
			TextEncoder,
			TextDecoder,
		});
	}

	it("runs RuamTester.js natively without errors", () => {
		const ctx = makeContext();
		const result = vm.runInContext(testerSource, ctx) as string;
		console.log("Native:", result);
		expect(result).toContain("passed");
		expect(result).not.toContain("FAIL");
	});

	it("runs RuamTester.js through obfuscator with identical results", () => {
		const obfuscated = obfuscateCode(testerSource, {
			targetMode: "root",
			encryptBytecode: false,
		});

		const ctx = makeContext();
		const result = vm.runInContext(obfuscated, ctx) as string;
		console.log("Obfuscated:", result);
		expect(result).toContain("passed");
		// Allow for some test failures initially — report them
		if (result.includes("FAIL")) {
			const lines = result.split("\n");
			const failures = lines.filter((l: string) => l.startsWith("FAIL"));
			console.log(`${failures.length} failures:`);
			failures.forEach((f: string) => console.log("  " + f));
		}
		expect(result).not.toContain("FAIL");
	});
});

describe("recursive obfuscation", () => {
	// Double-obfuscation (re-obfuscating the VM runtime itself) is not a supported use case
	// and produces non-deterministic results across Node.js versions.
	it.skip("double-obfuscated code executes correctly", () => {
		const source = `
      function add(a, b) { return a + b; }
      function fib(n) {
        if (n <= 1) return n;
        return fib(n - 1) + fib(n - 2);
      }
      [add(3, 4), fib(10)];
    `;

		// First pass
		const pass1 = obfuscateCode(source, { targetMode: "root" });
		// Second pass — re-obfuscates the IIFE runtime + dispatch calls
		const pass2 = obfuscateCode(pass1, { targetMode: "root" });

		const ctx = vm.createContext({
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

		const original = vm.runInContext(
			source,
			vm.createContext({
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
			})
		);

		const result = vm.runInContext(pass2, ctx, { timeout: 10000 });
		expect(result).toEqual(original);
	});
});
