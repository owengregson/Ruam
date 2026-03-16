/**
 * Browser entry point for Ruam.
 *
 * Re-exports {@link obfuscateCode} with Node.js `crypto` polyfilled
 * for the Web Crypto API. Used by the playground Web Worker.
 *
 * @module browser-entry
 */

export { obfuscateCode } from "./transform.js";
export { PRESETS } from "./presets.js";
export type {
	VmObfuscationOptions,
	PresetName,
	TargetEnvironment,
} from "./types.js";
