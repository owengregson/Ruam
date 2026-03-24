/**
 * Centralized tuning parameters for obfuscation features.
 *
 * Each preset maps to an intensity level (0 = low, 1 = medium, 2 = max).
 * Modules import from this file instead of hardcoding magic numbers.
 *
 * @module tuning
 */

// --- Intensity type ---

/** Tuning intensity level: 0 = conservative, 1 = moderate, 2 = aggressive. */
export type Intensity = 0 | 1 | 2;

// --- Tuning profile ---

/** Complete set of tunable numeric parameters. */
export interface TuningProfile {
	// -- Opcode mutation --
	/** Minimum instruction gap between MUTATE opcode insertions. */
	mutationIntervalMin: number;
	/** Maximum instruction gap between MUTATE opcode insertions. */
	mutationIntervalMax: number;
	/** Number of handler table swaps per MUTATE execution. */
	swapsPerMutation: number;

	// -- Handler fragmentation --
	/** Maximum fragment count per handler (for handlers with 3+ statements). */
	handlerFragmentMax: number;

	// -- Polymorphic decoder --
	/** Minimum operations in the decoder chain. */
	decoderChainMin: number;
	/** Maximum operations in the decoder chain. */
	decoderChainMax: number;

	// -- Decoy opcodes --
	/** Minimum number of decoy handler closures. */
	decoyHandlerMin: number;
	/** Maximum number of decoy handler closures. */
	decoyHandlerMax: number;

	// -- Scattered keys --
	/** Minimum string fragment count. */
	scatterStringFragMin: number;
	/** Maximum string fragment count. */
	scatterStringFragMax: number;
	/** Minimum array fragment count. */
	scatterArrayFragMin: number;
	/** Maximum array fragment count. */
	scatterArrayFragMax: number;

	// -- Bytecode scattering --
	/** Minimum bytecode fragment count per unit. */
	bytecodeFragmentMin: number;
	/** Maximum bytecode fragment count per unit. */
	bytecodeFragmentMax: number;

	// -- Dead code injection --
	/** Probability (0–100) of injecting dead code at each RETURN site. */
	deadCodeProbability: number;
	/** Minimum dead code block size (instruction count). */
	deadCodeBlockMin: number;
	/** Maximum dead code block size (instruction count). */
	deadCodeBlockMax: number;

	// -- MBA --
	/** MBA expression nesting depth. */
	mbaDepth: number;

	// -- String atomization --
	/** Minimum string length to atomize. */
	atomizeMinLength: number;

	// -- Structural variation biases (each 0.0–1.0 range) --
	/** Ternary bias range: [min, max]. */
	ternaryBiasRange: [number, number];
	/** Dot-to-bracket bias range: [min, max]. */
	dotBracketBiasRange: [number, number];
	/** Numeric variation bias range: [min, max]. */
	numericVariationBiasRange: [number, number];
}

// --- Profile definitions ---

const PROFILES: Record<Intensity, TuningProfile> = {
	// Intensity 0: conservative (low preset)
	0: {
		mutationIntervalMin: 30,
		mutationIntervalMax: 60,
		swapsPerMutation: 2,
		handlerFragmentMax: 2,
		decoderChainMin: 3,
		decoderChainMax: 5,
		decoyHandlerMin: 4,
		decoyHandlerMax: 8,
		scatterStringFragMin: 2,
		scatterStringFragMax: 3,
		scatterArrayFragMin: 2,
		scatterArrayFragMax: 3,
		bytecodeFragmentMin: 2,
		bytecodeFragmentMax: 3,
		deadCodeProbability: 25,
		deadCodeBlockMin: 2,
		deadCodeBlockMax: 4,
		mbaDepth: 1,
		atomizeMinLength: 3,
		ternaryBiasRange: [0.1, 0.3],
		dotBracketBiasRange: [0.05, 0.2],
		numericVariationBiasRange: [0.05, 0.15],
	},

	// Intensity 1: moderate (medium preset) — current defaults
	1: {
		mutationIntervalMin: 20,
		mutationIntervalMax: 50,
		swapsPerMutation: 4,
		handlerFragmentMax: 3,
		decoderChainMin: 4,
		decoderChainMax: 8,
		decoyHandlerMin: 8,
		decoyHandlerMax: 16,
		scatterStringFragMin: 3,
		scatterStringFragMax: 5,
		scatterArrayFragMin: 2,
		scatterArrayFragMax: 4,
		bytecodeFragmentMin: 2,
		bytecodeFragmentMax: 6,
		deadCodeProbability: 40,
		deadCodeBlockMin: 3,
		deadCodeBlockMax: 6,
		mbaDepth: 2,
		atomizeMinLength: 2,
		ternaryBiasRange: [0.15, 0.6],
		dotBracketBiasRange: [0.1, 0.45],
		numericVariationBiasRange: [0.1, 0.4],
	},

	// Intensity 2: aggressive (max preset)
	2: {
		mutationIntervalMin: 12,
		mutationIntervalMax: 35,
		swapsPerMutation: 6,
		handlerFragmentMax: 3,
		decoderChainMin: 6,
		decoderChainMax: 10,
		decoyHandlerMin: 12,
		decoyHandlerMax: 24,
		scatterStringFragMin: 4,
		scatterStringFragMax: 6,
		scatterArrayFragMin: 3,
		scatterArrayFragMax: 5,
		bytecodeFragmentMin: 3,
		bytecodeFragmentMax: 8,
		deadCodeProbability: 60,
		deadCodeBlockMin: 4,
		deadCodeBlockMax: 8,
		mbaDepth: 3,
		atomizeMinLength: 1,
		ternaryBiasRange: [0.2, 0.7],
		dotBracketBiasRange: [0.15, 0.55],
		numericVariationBiasRange: [0.15, 0.5],
	},
};

// --- Public API ---

/**
 * Get the tuning profile for a given intensity level.
 *
 * @param intensity - 0 (conservative), 1 (moderate), or 2 (aggressive)
 * @returns Frozen TuningProfile with all numeric parameters
 */
export function getTuningProfile(intensity: Intensity): Readonly<TuningProfile> {
	return PROFILES[intensity];
}

/**
 * Map a preset name to its intensity level.
 */
export function presetToIntensity(
	preset: "low" | "medium" | "max" | undefined
): Intensity {
	switch (preset) {
		case "low":
			return 0;
		case "medium":
			return 1;
		case "max":
			return 2;
		default:
			return 1; // default to moderate
	}
}
