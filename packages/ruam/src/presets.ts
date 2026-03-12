/**
 * Built-in preset configurations (low / medium / high) and option resolution.
 * @module presets
 */

import type {
	VmObfuscationOptions,
	PresetName,
	TargetEnvironment,
} from "./types.js";

/**
 * Preset configurations keyed by name.
 *
 * - `low` -- VM compilation only.
 * - `medium` -- Adds identifier renaming, bytecode encryption, and decoy opcodes.
 * - `max` -- Maximum protection: debug protection, dead code injection, stack encoding.
 */
export const PRESETS: Record<
	PresetName,
	Required<Omit<VmObfuscationOptions, "preset" | "debugLogging" | "target">>
> = {
	low: {
		targetMode: "root",
		threshold: 1.0,
		preprocessIdentifiers: false,
		encryptBytecode: false,
		debugProtection: false,
		dynamicOpcodes: false,
		decoyOpcodes: false,
		deadCodeInjection: false,
		stackEncoding: false,
		rollingCipher: false,
		integrityBinding: false,
		vmShielding: false,
		mixedBooleanArithmetic: false,
		handlerFragmentation: false,
	},
	medium: {
		targetMode: "root",
		threshold: 1.0,
		preprocessIdentifiers: true,
		encryptBytecode: true,
		debugProtection: false,
		dynamicOpcodes: true,
		decoyOpcodes: true,
		deadCodeInjection: false,
		stackEncoding: false,
		rollingCipher: true,
		integrityBinding: false,
		vmShielding: false,
		mixedBooleanArithmetic: false,
		handlerFragmentation: false,
	},
	max: {
		targetMode: "root",
		threshold: 1.0,
		preprocessIdentifiers: true,
		encryptBytecode: true,
		debugProtection: true,
		dynamicOpcodes: true,
		decoyOpcodes: true,
		deadCodeInjection: true,
		stackEncoding: true,
		rollingCipher: true,
		integrityBinding: true,
		vmShielding: true,
		mixedBooleanArithmetic: true,
		handlerFragmentation: true,
	},
};

/**
 * Resolved options with internal fields derived from the target environment.
 *
 * `wrapOutput` is not part of the public API — it is set automatically
 * based on {@link VmObfuscationOptions.target}.
 */
export interface ResolvedOptions extends VmObfuscationOptions {
	/** @internal Wrap the entire output in an IIFE. Set by `target`. */
	wrapOutput?: boolean;
}

/** Target-specific default settings. */
const TARGET_DEFAULTS: Record<TargetEnvironment, Partial<ResolvedOptions>> = {
	node: {},
	browser: {},
	"browser-extension": { wrapOutput: true },
};

/**
 * Resolve options by merging a preset (if specified) with explicit overrides,
 * then applying target-environment defaults.
 *
 * Priority: explicit options > preset values > target defaults.
 *
 * @param options - User-supplied options, optionally referencing a preset.
 * @returns Fully resolved options with preset defaults filled in.
 */
export function resolveOptions(
	options: VmObfuscationOptions = {}
): ResolvedOptions {
	let resolved: ResolvedOptions;

	if (options.preset) {
		const preset = PRESETS[options.preset];
		const { preset: _discard, ...explicit } = options;

		resolved = { ...preset };
		for (const [key, value] of Object.entries(explicit)) {
			if (value !== undefined) {
				(resolved as Record<string, unknown>)[key] = value;
			}
		}
	} else {
		resolved = { ...options };
	}

	// Apply target-environment defaults (only for fields not explicitly set)
	const target = resolved.target ?? "browser";
	const targetDefaults = TARGET_DEFAULTS[target];
	for (const [key, value] of Object.entries(targetDefaults)) {
		if ((resolved as Record<string, unknown>)[key] === undefined) {
			(resolved as Record<string, unknown>)[key] = value;
		}
	}

	// integrityBinding requires rollingCipher — auto-enable it
	if (resolved.integrityBinding && !resolved.rollingCipher) {
		resolved.rollingCipher = true;
	}

	// vmShielding requires rollingCipher (implicit per-unit key derivation)
	if (resolved.vmShielding && !resolved.rollingCipher) {
		resolved.rollingCipher = true;
	}

	return resolved;
}
