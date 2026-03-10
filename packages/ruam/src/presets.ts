/**
 * Built-in preset configurations (low / medium / high) and option resolution.
 * @module presets
 */

import type { VmObfuscationOptions, PresetName } from "./types.js";

/**
 * Preset configurations keyed by name.
 *
 * - `low` -- VM compilation only.
 * - `medium` -- Adds identifier renaming, bytecode encryption, and decoy opcodes.
 * - `max` -- Maximum protection: debug protection, dead code injection, stack encoding.
 */
export const PRESETS: Record<
	PresetName,
	Required<Omit<VmObfuscationOptions, "preset" | "debugLogging">>
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
	},
};

/**
 * Resolve options by merging a preset (if specified) with explicit overrides.
 * Explicit options always win over preset values.
 *
 * @param options - User-supplied options, optionally referencing a preset.
 * @returns Fully resolved options with preset defaults filled in.
 */
export function resolveOptions(
	options: VmObfuscationOptions = {}
): VmObfuscationOptions {
	let resolved: VmObfuscationOptions;

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
