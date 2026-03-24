import { describe, it, expect } from "bun:test";
import { obfuscateCode } from "../../src/transform.js";
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

/**
 * Regression test for exception handler property name corruption.
 *
 * stringObfuscateLocals used to rename `catchIp`/`finallyIp`/`sp` via
 * word-boundary regex, which could collide with other short identifiers
 * and corrupt the exception handler frame object. Fixed by using `_`-prefixed
 * property names (`_ci`, `_fi`, `_sp`) that are excluded from renaming.
 *
 * Runs 50 trials to exercise different random name seeds.
 */
describe("regression: try/catch property name collision", () => {
	const source = `
    function f() {
      var arr = [-41,18,29,33,-42,-49];
      var results = [];
      for (var i = 0; i < arr.length; i++) {
        try {
          if (i === 4) throw new Error("stop:" + arr[i]);
          results.push(arr[i] * 2);
        } catch (e) {
          results.push("E:" + e.message);
        }
      }
      return results;
    }
    f();
  `;

	const expected = [-82, 36, 58, 66, "E:stop:-42", -98];

	for (let trial = 0; trial < 50; trial++) {
		it(`trial ${trial}`, () => {
			const obfuscated = obfuscateCode(source, {
				targetMode: "root",
				encryptBytecode: false,
				preprocessIdentifiers: false,
			});
			const result = new vm.Script(obfuscated).runInContext(
				makeContext()
			);
			expect(result).toEqual(expected);
		});
	}
});
