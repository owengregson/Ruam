/**
 * Ruam VM Obfuscator -- public API surface.
 * @module index
 */

import {
	obfuscateCode as transformCode,
	obfuscateBundle as transformBundle,
} from "./transform.js";
import type { BundleFile } from "./transform.js";
import type { CohortContext } from "./compiler/cohort.js";
import type { VmObfuscationOptions } from "./types.js";
import { gateSourceMaps } from "./source-map-gate.js";
import fs from "fs-extra";
import path from "path";
import { globby } from "globby";

export {
	type VmObfuscationOptions,
	type PresetName,
	type TargetEnvironment,
} from "./types.js";
export { PRESETS } from "./presets.js";
export {
	OPTION_META,
	AUTO_ENABLE_RULES,
	OPTION_LABELS,
} from "./option-meta.js";
export type {
	OptionMetaEntry,
	AutoEnableRule,
	OptionCategory,
} from "./option-meta.js";
export { obfuscateBundle } from "./transform.js";
export type { BundleFile } from "./transform.js";
export { createCohort } from "./compiler/cohort.js";
export type {
	CohortContext,
	CohortFile,
	CohortLink,
	ResolvedLink,
} from "./compiler/cohort.js";

// --- Single-Source Obfuscation ---

/**
 * Obfuscate a JavaScript source string. Compiles eligible functions to
 * bytecode, embeds a VM runtime, and returns the transformed source.
 *
 * @param source - JavaScript source code to obfuscate.
 * @param options - Obfuscation options.
 * @returns The obfuscated JavaScript source.
 */
export function obfuscateCode(
	source: string,
	options?: VmObfuscationOptions,
	cohort?: CohortContext,
	filePath?: string
): string {
	return transformCode(source, options, cohort, filePath);
}

// --- File-Level Obfuscation ---

/**
 * Obfuscate a single file on disk.
 *
 * @param inputPath - Path to the source JS file.
 * @param outputPath - Where to write the result (defaults to overwriting the input).
 * @param options - Obfuscation options.
 */
export async function obfuscateFile(
	inputPath: string,
	outputPath?: string,
	options?: VmObfuscationOptions
): Promise<void> {
	const source = await fs.readFile(inputPath, "utf-8");
	const result = transformCode(source, options);
	await fs.writeFile(outputPath ?? inputPath, result, "utf-8");
}

// --- Directory-Level Obfuscation ---

/**
 * Obfuscate all matching JS files in a directory.
 *
 * @param dir - Root directory to scan.
 * @param config - Include/exclude globs and obfuscation options.
 */
export async function runVmObfuscation(
	dir: string,
	config?: {
		include?: string[];
		exclude?: string[];
		options?: VmObfuscationOptions;
		/** Keep `.map` files in the output (default: strip — cleartext-leak gate). */
		keepSourceMaps?: boolean;
	}
): Promise<void> {
	const include = config?.include ?? ["**/*.js"];
	const exclude = config?.exclude ?? ["**/node_modules/**"];

	const files = await globby(include, {
		cwd: dir,
		ignore: exclude,
		absolute: false,
	});

	// Read all sources first so the cohort term can depend on every file
	// (cross-file Layer-1 tangle). Per-file hermeticity is otherwise preserved.
	const sources: BundleFile[] = [];
	for (const file of files) {
		const filePath = path.join(dir, file);
		sources.push({ path: filePath, code: await fs.readFile(filePath, "utf-8") });
	}

	const results = transformBundle(sources, config?.options ?? {});
	for (const r of results) {
		await fs.writeFile(r.path, r.code, "utf-8");
	}

	// Cleartext-leak gate: strip copied source maps from the output tree.
	await gateSourceMaps(dir, { keepSourceMaps: config?.keepSourceMaps });
}
