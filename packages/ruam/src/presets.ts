/**
 * Configuration presets for Ruam.
 *
 * Three built-in presets provide convenient groupings of options:
 *
 * - **low** — VM compilation only.  Smallest output overhead,
 *   fastest builds, minimal protection.
 * - **medium** — Adds identifier renaming, bytecode encryption,
 *   and decoy opcodes.  Good balance of protection and performance.
 * - **high** — Maximum protection: debug protection, dead code
 *   injection, and stack value encoding on top of medium settings.
 *
 * Explicit options always override preset values.
 *
 * @module presets
 */

import type { VmObfuscationOptions, PresetName } from "./types.js";

/** Preset configurations keyed by name. */
export const PRESETS: Record<PresetName, Required<Omit<VmObfuscationOptions, "preset" | "debugLogging">>> = {
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
  },
  high: {
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
  },
};

/**
 * Resolve options by merging a preset (if specified) with explicit overrides.
 *
 * Explicit options always win over preset values.
 */
export function resolveOptions(options: VmObfuscationOptions = {}): VmObfuscationOptions {
  if (!options.preset) return options;

  const preset = PRESETS[options.preset];
  const { preset: _discard, ...explicit } = options;

  // Build merged result: preset provides defaults, explicit options override
  const merged: VmObfuscationOptions = { ...preset };
  for (const [key, value] of Object.entries(explicit)) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}
