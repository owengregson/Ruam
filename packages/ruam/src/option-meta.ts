/**
 * Option metadata — single source of truth for all CLI/UI option definitions.
 *
 * This file defines option labels, categories, descriptions, and CLI flags.
 * The build-time manifest generator reads this to produce a JSON manifest
 * that the website consumes, eliminating hardcoded option definitions in
 * the Playground component.
 *
 * @module option-meta
 */

// --- Types ---

/** UI category for grouping options. */
export type OptionCategory = "security" | "obfuscation" | "optimization";

/** Metadata for a single boolean option. */
export interface OptionMetaEntry {
	/** Property key on VmObfuscationOptions. */
	key: string;
	/** Human-readable label for display. */
	label: string;
	/** UI category for grouping. */
	category: OptionCategory;
	/** Short description of what the option does. */
	description: string;
	/** CLI flag (e.g. "--rolling-cipher"). */
	cliFlag: string;
}

/** Auto-enable rule: when `when` is enabled, `enables` is forced on. */
export interface AutoEnableRule {
	when: string;
	enables: string;
}

// --- Option definitions ---

/**
 * Complete metadata for all boolean obfuscation options.
 * Order determines UI display order within categories.
 */
export const OPTION_META: OptionMetaEntry[] = [
	// Security
	{
		key: "rollingCipher",
		label: "Rolling Cipher",
		category: "security",
		description:
			"Position-dependent XOR encryption on every instruction",
		cliFlag: "--rolling-cipher",
	},
	{
		key: "integrityBinding",
		label: "Integrity Binding",
		category: "security",
		description:
			"Bind bytecode decryption to interpreter source integrity",
		cliFlag: "--integrity-binding",
	},
	{
		key: "debugProtection",
		label: "Debug Protection",
		category: "security",
		description:
			"Multi-layered anti-debugger with escalating response",
		cliFlag: "--debug-protection",
	},
	{
		key: "vmShielding",
		label: "VM Shielding",
		category: "security",
		description:
			"Per-function micro-interpreters with independent opcode shuffle",
		cliFlag: "--vm-shielding",
	},
	{
		key: "encryptBytecode",
		label: "Encrypt Bytecode",
		category: "security",
		description: "RC4 encryption using an environment fingerprint key",
		cliFlag: "--encrypt",
	},

	// Obfuscation
	{
		key: "mixedBooleanArithmetic",
		label: "MBA",
		category: "obfuscation",
		description:
			"Replace arithmetic/bitwise ops with MBA expressions",
		cliFlag: "--mba",
	},
	{
		key: "stackEncoding",
		label: "Stack Encoding",
		category: "obfuscation",
		description: "XOR-encode VM stack values during execution",
		cliFlag: "--stack-encoding",
	},
	{
		key: "deadCodeInjection",
		label: "Dead Code Injection",
		category: "obfuscation",
		description: "Insert unreachable bytecode sequences after RETURN",
		cliFlag: "--dead-code",
	},
	{
		key: "handlerFragmentation",
		label: "Handler Fragmentation",
		category: "obfuscation",
		description:
			"Split handlers into interleaved fragments",
		cliFlag: "--handler-fragmentation",
	},
	{
		key: "stringAtomization",
		label: "String Atomization",
		category: "obfuscation",
		description:
			"Replace string literals with encoded table lookups",
		cliFlag: "--string-atomization",
	},
	{
		key: "blockPermutation",
		label: "Block Permutation",
		category: "obfuscation",
		description: "Shuffle bytecode basic block order",
		cliFlag: "--block-permutation",
	},
	{
		key: "opcodeMutation",
		label: "Opcode Mutation",
		category: "obfuscation",
		description: "Runtime handler table mutations via MUTATE opcodes",
		cliFlag: "--opcode-mutation",
	},
	{
		key: "bytecodeScattering",
		label: "Bytecode Scattering",
		category: "obfuscation",
		description:
			"Split bytecode into mixed-type fragments scattered through output",
		cliFlag: "--bytecode-scattering",
	},

	// Optimization
	{
		key: "preprocessIdentifiers",
		label: "Rename Identifiers",
		category: "optimization",
		description: "Rename identifiers before compilation",
		cliFlag: "--preprocess",
	},
	{
		key: "dynamicOpcodes",
		label: "Dynamic Opcodes",
		category: "optimization",
		description: "Filter unused opcode handlers from interpreter",
		cliFlag: "--dynamic-opcodes",
	},
	{
		key: "decoyOpcodes",
		label: "Decoy Opcodes",
		category: "optimization",
		description: "Inject realistic fake opcode handlers",
		cliFlag: "--decoy-opcodes",
	},
	{
		key: "polymorphicDecoder",
		label: "Polymorphic Decoder",
		category: "optimization",
		description:
			"Per-build random chain of reversible byte operations",
		cliFlag: "--polymorphic-decoder",
	},
	{
		key: "scatteredKeys",
		label: "Scattered Keys",
		category: "optimization",
		description:
			"Fragment key materials across closure tiers",
		cliFlag: "--scattered-keys",
	},
];

// --- Auto-enable rules ---

/**
 * Rules that auto-enable dependent options.
 * Applied by resolveOptions() in presets.ts.
 */
export const AUTO_ENABLE_RULES: AutoEnableRule[] = [
	{ when: "integrityBinding", enables: "rollingCipher" },
	{ when: "vmShielding", enables: "rollingCipher" },
	{ when: "stringAtomization", enables: "polymorphicDecoder" },
	{ when: "opcodeMutation", enables: "rollingCipher" },
];

// --- Derived exports for CLI backward compat ---

/**
 * Map of option key → human-readable label.
 * Used by CLI for display output.
 */
export const OPTION_LABELS: Record<string, string> = Object.fromEntries(
	OPTION_META.map((m) => [m.key, m.label])
);
