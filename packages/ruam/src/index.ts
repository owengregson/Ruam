/**
 * Ruam VM Obfuscator -- public API surface.
 * @module index
 */

import { obfuscateCode as transformCode } from "./transform.js";
import type { VmObfuscationOptions } from "./types.js";
import fs from "fs-extra";
import path from "path";
import { globby } from "globby";

export {
	type VmObfuscationOptions,
	type PresetName,
	type TargetEnvironment,
} from "./types.js";
export { PRESETS } from "./presets.js";

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
	options?: VmObfuscationOptions
): string {
	return transformCode(source, options);
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
	}
): Promise<void> {
	const include = config?.include ?? ["**/*.js"];
	const exclude = config?.exclude ?? ["**/node_modules/**"];

	const files = await globby(include, {
		cwd: dir,
		ignore: exclude,
		absolute: false,
	});

	for (const file of files) {
		const filePath = path.join(dir, file);
		await obfuscateFile(filePath, filePath, config?.options);
	}
}
