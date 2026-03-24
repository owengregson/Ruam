/**
 * Feature combination tests.
 *
 * Tests that different obfuscation features work correctly when enabled
 * together. Catches interaction bugs that single-feature tests miss.
 *
 * Uses a focused set of programs to keep runtime practical while still
 * covering key language features (closures, classes, error handling,
 * destructuring, loops).
 */

import { describe, it, expect } from "vitest";
import { assertEquivalent, evalObfuscated } from "../helpers.js";
import type { VmObfuscationOptions } from "../../src/types.js";

// --- Compact test programs ---

const ARITHMETIC = `
function add(a, b) { return a + b; }
add(3, 7);
`;

const STRINGS = `
function greet(name) { return "Hello, " + name + "!"; }
greet("world");
`;

const CLOSURES = `
function counter() {
  let n = 0;
  return function() { return ++n; };
}
const c = counter();
c(); c(); c();
`;

const CLASSES = `
class Animal {
  constructor(name) { this.name = name; }
  speak() { return this.name + " speaks"; }
}
class Dog extends Animal {
  speak() { return super.speak() + " (woof)"; }
}
new Dog("Rex").speak();
`;

const TRY_CATCH = `
function safeDivide(a, b) {
  try {
    if (b === 0) throw new Error("div/0");
    return a / b;
  } catch (e) {
    return e.message;
  }
}
[safeDivide(10, 2), safeDivide(1, 0)];
`;

const LOOPS_DESTRUCT = `
function fibonacci(n) {
  let a = 0, b = 1;
  for (let i = 0; i < n; i++) {
    [a, b] = [b, a + b];
  }
  return a;
}
fibonacci(10);
`;

const SWITCH_STMT = `
function classify(n) {
  switch (true) {
    case n < 0: return "negative";
    case n === 0: return "zero";
    default: return "positive";
  }
}
[classify(-1), classify(0), classify(5)];
`;

// Core set: covers closures, classes, errors, loops, control flow
const corePrograms: [string, string][] = [
	["arithmetic", ARITHMETIC],
	["strings", STRINGS],
	["closures", CLOSURES],
	["classes", CLASSES],
	["try/catch", TRY_CATCH],
	["loops+destructuring", LOOPS_DESTRUCT],
	["switch", SWITCH_STMT],
];

// Lighter set for expensive combos
const lightPrograms: [string, string][] = [
	["arithmetic", ARITHMETIC],
	["closures", CLOSURES],
	["classes", CLASSES],
];

// --- Feature combinations ---

describe("feature combinations: 2-feature pairs", () => {
	const pairs: [string, VmObfuscationOptions][] = [
		[
			"preprocess + encrypt",
			{ preprocessIdentifiers: true, encryptBytecode: true },
		],
		[
			"preprocess + rollingCipher",
			{ preprocessIdentifiers: true, rollingCipher: true },
		],
		[
			"encrypt + rollingCipher",
			{ encryptBytecode: true, rollingCipher: true },
		],
		[
			"rollingCipher + integrityBinding",
			{ rollingCipher: true, integrityBinding: true },
		],
		[
			"rollingCipher + blockPermutation",
			{ rollingCipher: true, blockPermutation: true },
		],
		[
			"rollingCipher + opcodeMutation",
			{ rollingCipher: true, opcodeMutation: true },
		],
		[
			"blockPermutation + opcodeMutation",
			{ blockPermutation: true, opcodeMutation: true },
		],
		[
			"stringAtomization + polymorphicDecoder",
			{ stringAtomization: true, polymorphicDecoder: true },
		],
		[
			"MBA + stackEncoding",
			{ mixedBooleanArithmetic: true, stackEncoding: true },
		],
		[
			"dynamicOpcodes + decoyOpcodes",
			{ dynamicOpcodes: true, decoyOpcodes: true },
		],
		[
			"deadCodeInjection + blockPermutation",
			{ deadCodeInjection: true, blockPermutation: true },
		],
		[
			"preprocess + MBA",
			{ preprocessIdentifiers: true, mixedBooleanArithmetic: true },
		],
		[
			"scatteredKeys + stringAtom",
			{
				scatteredKeys: true,
				stringAtomization: true,
				polymorphicDecoder: true,
			},
		],
		[
			"bytecodeScattering alone",
			{ bytecodeScattering: true },
		],
		[
			"scattering + MBA",
			{ bytecodeScattering: true, mixedBooleanArithmetic: true },
		],
		[
			"scattering + rollingCipher",
			{ bytecodeScattering: true, rollingCipher: true },
		],
		[
			"scattering + stringAtom",
			{
				bytecodeScattering: true,
				stringAtomization: true,
				polymorphicDecoder: true,
			},
		],
	];

	for (const [name, opts] of pairs) {
		describe(name, () => {
			for (const [prog, src] of corePrograms) {
				it(
					prog,
					() => {
						assertEquivalent(src, opts);
					},
					10_000
				);
			}
		});
	}
});

describe("feature combinations: 3+ features", () => {
	const combos: [string, VmObfuscationOptions][] = [
		[
			"preprocess + encrypt + rolling",
			{
				preprocessIdentifiers: true,
				encryptBytecode: true,
				rollingCipher: true,
			},
		],
		[
			"rolling + integrity + blockPerm",
			{
				rollingCipher: true,
				integrityBinding: true,
				blockPermutation: true,
			},
		],
		[
			"MBA + stringAtom + polyDec",
			{
				mixedBooleanArithmetic: true,
				stringAtomization: true,
				polymorphicDecoder: true,
			},
		],
		[
			"stackEncoding + rolling + mutation",
			{ stackEncoding: true, rollingCipher: true, opcodeMutation: true },
		],
		[
			"deadCode + blockPerm + mutation",
			{
				deadCodeInjection: true,
				blockPermutation: true,
				opcodeMutation: true,
			},
		],
		[
			"scattered + stringAtom + MBA",
			{
				scatteredKeys: true,
				stringAtomization: true,
				polymorphicDecoder: true,
				mixedBooleanArithmetic: true,
			},
		],
		[
			"encrypt + rolling + integrity + blockPerm + mutation",
			{
				encryptBytecode: true,
				rollingCipher: true,
				integrityBinding: true,
				blockPermutation: true,
				opcodeMutation: true,
			},
		],
		[
			"all encoding features",
			{
				preprocessIdentifiers: true,
				encryptBytecode: true,
				rollingCipher: true,
				stringAtomization: true,
				polymorphicDecoder: true,
				scatteredKeys: true,
			},
		],
		[
			"all bytecode features",
			{
				deadCodeInjection: true,
				blockPermutation: true,
				opcodeMutation: true,
				dynamicOpcodes: true,
				decoyOpcodes: true,
			},
		],
		[
			"all runtime features",
			{
				mixedBooleanArithmetic: true,
				stackEncoding: true,
				stringAtomization: true,
				polymorphicDecoder: true,
			},
		],
	];

	for (const [name, opts] of combos) {
		describe(name, () => {
			for (const [prog, src] of lightPrograms) {
				it(
					prog,
					() => {
						assertEquivalent(src, opts);
					},
					15_000
				);
			}
		});
	}
});

describe("preset tests", () => {
	describe("preset low", () => {
		for (const [prog, src] of corePrograms) {
			it(prog, () => assertEquivalent(src, { preset: "low" }), 10_000);
		}
	});

	describe("preset medium", () => {
		for (const [prog, src] of corePrograms) {
			it(prog, () => assertEquivalent(src, { preset: "medium" }), 10_000);
		}
	});

	describe("preset max (no debug prot)", () => {
		for (const [prog, src] of lightPrograms) {
			it(
				prog,
				() => {
					assertEquivalent(src, {
						preset: "max",
						debugProtection: false,
					});
				},
				30_000
			);
		}
	});
});

describe("preset overrides", () => {
	it("medium + MBA", () => {
		assertEquivalent(ARITHMETIC, {
			preset: "medium",
			mixedBooleanArithmetic: true,
		});
	}, 10_000);

	it("max - MBA", () => {
		assertEquivalent(ARITHMETIC, {
			preset: "max",
			mixedBooleanArithmetic: false,
			debugProtection: false,
		});
	}, 30_000);

	it("low + preprocess", () => {
		assertEquivalent(STRINGS, {
			preset: "low",
			preprocessIdentifiers: true,
		});
	}, 10_000);

	it("medium + stackEncoding", () => {
		assertEquivalent(CLOSURES, { preset: "medium", stackEncoding: true });
	}, 10_000);

	it("medium + blockPermutation", () => {
		assertEquivalent(LOOPS_DESTRUCT, {
			preset: "medium",
			blockPermutation: true,
		});
	}, 10_000);

	it("medium + opcodeMutation", () => {
		assertEquivalent(CLASSES, { preset: "medium", opcodeMutation: true });
	}, 10_000);
});

// Note: generator and async tests are excluded here because generator
// compilation produces async VM dispatch code (top-level await) which
// is incompatible with vm.Script. They are tested separately in the
// core test suite.

describe("naming system stress", () => {
	it("200 local bindings with preprocessing", () => {
		const vars = Array.from({ length: 200 }, (_, i) => `var v${i} = ${i};`);
		const sum = `var total = ${Array.from(
			{ length: 200 },
			(_, i) => `v${i}`
		).join(" + ")};`;
		const src = `function bigFunc() { ${vars.join(
			" "
		)} ${sum} return total; } bigFunc();`;
		assertEquivalent(src, { preprocessIdentifiers: true });
	}, 30_000);

	it("30 functions with preprocessing", () => {
		const funcs = Array.from(
			{ length: 30 },
			(_, i) => `function f${i}(x) { return x + ${i}; }`
		);
		const calls = Array.from({ length: 30 }, (_, i) => `f${i}(1)`).join(
			" + "
		);
		const src = `${funcs.join("\n")}\n${calls};`;
		assertEquivalent(src, { preprocessIdentifiers: true });
	}, 30_000);
});
