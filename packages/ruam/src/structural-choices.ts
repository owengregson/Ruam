/**
 * Per-build structural variation choices.
 *
 * Controls how the runtime code is structured — statement order,
 * control flow style, declaration forms, expression noise. All choices
 * are deterministically derived from the build seed so builds are
 * reproducible.
 *
 * @module structural-choices
 */

import { LCG_MULTIPLIER, LCG_INCREMENT } from "./constants.js";

// --- Public interfaces ---

/** Per-build choices that affect runtime code structure. */
export interface StructuralChoices {
	/** Shuffled indices for runtime component ordering within each tier. */
	statementOrder: {
		tier0: number[];
		tier1: number[];
		tier2: number[];
		tier3: number[];
		tier4: number[];
	};

	/** Control flow style preferences. */
	controlFlow: {
		/** Probability (0-1) of converting simple if/else to ternary. */
		ternaryBias: number;
		/** Preferred loop form for simple counted loops. */
		loopStyle: "for" | "while";
		/** Probability (0-1) of converting && to if block and vice versa. */
		shortCircuitBias: number;
	};

	/** How consecutive var declarations are grouped. */
	declarationStyle: "individual" | "chained" | "mixed";

	/** Expression-level noise toggles. */
	expressionNoise: {
		/** obj.x → obj["x"] probability. */
		dotToBracketBias: number;
		/** f() → (0,f)() probability. */
		indirectCallBias: number;
		/** a === b → !(a !== b) probability. */
		doubleNegationBias: number;
		/** Numeric literal → hex/computed probability. */
		numericVariationBias: number;
	};

	/** PRNG for per-node coin flips during AST transforms. */
	prng: () => number;
}

// --- Tier sizes (number of shuffleable components per tier) ---

/**
 * Tier 0: foundational declarations — must come first.
 * Components: imul alias, spread symbol, hop alias, globalRef, TDZ sentinel.
 */
export const TIER_0_SIZE = 5;

/**
 * Tier 1: crypto/encoding primitives — used by loader/interpreter.
 * Components: binary decoder, fingerprint, RC4, rolling cipher helpers, string decoder.
 * (Actual count varies with options; max 5.)
 */
export const TIER_1_MAX = 5;

/**
 * Tier 2: interpreter machinery.
 * Components: handler table init, integrity binding, interpreter functions.
 * (Fixed ordering due to data dependency: table → integrity → interpreters.)
 */
export const TIER_2_SIZE = 1; // Not shuffleable — dependency chain

/**
 * Tier 3: dispatch layer.
 * Components: runners, loader + cache + deserializer.
 */
export const TIER_3_SIZE = 3;

/**
 * Tier 4: wiring.
 * Components: global exposure, debug protection, debug logging.
 */
export const TIER_4_MAX = 3;

// --- Generator ---

/**
 * Generate all structural choices from a build seed.
 *
 * Uses a separate LCG stream (seeded from `seed ^ 0xDEADBEEF`) so it
 * doesn't perturb the existing opcode-shuffle / name-generation PRNG
 * sequences. Existing builds that don't use structural choices are
 * unaffected.
 *
 * @param seed - The per-build CSPRNG seed (same as opcode shuffle seed).
 * @returns A frozen {@link StructuralChoices} object.
 */
export function generateStructuralChoices(seed: number): StructuralChoices {
	// Separate LCG stream so we don't alter existing PRNG sequences
	let state = (seed ^ 0xdeadbeef) >>> 0;
	function lcg(): number {
		state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
		return state;
	}

	/** Seeded Fisher-Yates shuffle. */
	function shuffle(n: number): number[] {
		const indices = Array.from({ length: n }, (_, i) => i);
		for (let i = n - 1; i > 0; i--) {
			const j = lcg() % (i + 1);
			[indices[i], indices[j]] = [indices[j]!, indices[i]!];
		}
		return indices;
	}

	/** Float in [0, 1) from next LCG value. */
	function float(): number {
		return (lcg() >>> 0) / 0x100000000;
	}

	/** Pick one of N options. */
	function pick<T>(options: T[]): T {
		return options[lcg() % options.length]!;
	}

	// Create a separate PRNG for per-node coin flips (independent stream)
	let prngState = lcg();
	function prng(): number {
		prngState =
			(Math.imul(prngState, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
		return prngState / 0x100000000;
	}

	return {
		statementOrder: {
			tier0: shuffle(TIER_0_SIZE),
			tier1: shuffle(TIER_1_MAX),
			tier2: [0], // Not shuffleable — dependency chain
			tier3: shuffle(TIER_3_SIZE),
			tier4: shuffle(TIER_4_MAX),
		},

		controlFlow: {
			ternaryBias: 0.15 + float() * 0.45, // 15-60%
			loopStyle: pick(["for", "while"]),
			shortCircuitBias: 0.1 + float() * 0.3, // 10-40%
		},

		declarationStyle: pick(["individual", "chained", "mixed"]),

		expressionNoise: {
			dotToBracketBias: 0.1 + float() * 0.35, // 10-45%
			indirectCallBias: 0.05 + float() * 0.15, // 5-20%
			doubleNegationBias: 0.08 + float() * 0.22, // 8-30%
			numericVariationBias: 0.1 + float() * 0.3, // 10-40%
		},

		prng,
	};
}
