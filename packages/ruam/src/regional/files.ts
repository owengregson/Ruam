/**
 * Node-only input inventory for the experimental regional compiler.
 * All regional disk builds use the same graph compiler and terminal publisher.
 * @module regional/files
 */
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { compileRegionalGraph } from "./graph.js";
import { publishRegionalPackage } from "./publication.js";

export interface RegionalFileOptions {
	compiler?: Parameters<typeof compileRegionalGraph>[1];
	/** Relative ESM entry paths; defaults to every inventoried JS file. */
	entryPoints?: string[];
	maxFiles?: number;
	maxInputBytes?: number;
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result <= 0) {
		throw new Error(`${name} must be a positive safe integer`);
	}
	return result;
}

/**
 * Compile one file or a pure JavaScript directory to a new output directory.
 * Inputs are never modified. Symlinks and non-JavaScript entries are rejected;
 * packaging assets, CommonJS and dependency discovery are not inferred.
 * @param inputPath File or directory to inventory completely.
 * @param outputDirectory New directory for generated JavaScript only.
 * @param options Compiler options and deterministic inventory limits.
 * @returns Owner-side package report; it is not written into client output.
 */
export async function protectRegionalPath(
	inputPath: string,
	outputDirectory: string,
	options: RegionalFileOptions = {}
) {
	const maxFiles = positiveLimit(options.maxFiles, 256, "maxFiles");
	const maxInputBytes = positiveLimit(options.maxInputBytes, 1_048_576, "maxInputBytes");
	const input = path.resolve(inputPath);
	const requestedOutput = path.resolve(outputDirectory);
	const output = path.join(await realpath(path.dirname(requestedOutput)), path.basename(requestedOutput));
	const rootStat = await lstat(input);
	if (rootStat.isSymbolicLink()) throw new Error("Regional input cannot be a symbolic link");
	const canonicalInput = await realpath(input);
	// The publisher also checks canonical source paths after compilation.
	const relativeOutput = path.relative(canonicalInput, output);
	if (rootStat.isDirectory() && (!relativeOutput || (!relativeOutput.startsWith(`..${path.sep}`) && relativeOutput !== ".." && !path.isAbsolute(relativeOutput)))) {
		throw new Error("Regional output must be outside the source directory");
	}
	const files: Record<string, string> = Object.create(null);
	const sourcePaths: string[] = [];
	let byteCount = 0;
	async function visit(filePath: string, relativeName: string): Promise<void> {
		const stat = await lstat(filePath);
		if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not admitted: ${relativeName}`);
		if (stat.isDirectory()) {
			for (const name of (await readdir(filePath)).sort()) {
				await visit(path.join(filePath, name), relativeName ? `${relativeName}/${name}` : name);
			}
			return;
		}
		if (!stat.isFile() || !/\.(?:js|mjs)$/.test(relativeName)) {
			throw new Error(`Only regular .js/.mjs inputs are admitted: ${relativeName}`);
		}
		if (sourcePaths.length >= maxFiles) throw new Error(`Regional inventory exceeds ${maxFiles} files`);
		if (byteCount + stat.size > maxInputBytes) throw new Error(`Regional inventory exceeds ${maxInputBytes} bytes`);
		const bytes = await readFile(filePath);
		byteCount += bytes.byteLength;
		if (byteCount > maxInputBytes) throw new Error(`Regional inventory exceeds ${maxInputBytes} bytes`);
		// Invalid UTF-8 must not be silently replaced before provenance is recorded.
		files[relativeName] = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
		sourcePaths.push(await realpath(filePath));
	}
	await visit(input, rootStat.isDirectory() ? "" : path.basename(input));
	if (!sourcePaths.length) throw new Error("Regional input contains no JavaScript files");
	const entryPoints = options.entryPoints ?? Object.keys(files);
	const build = compileRegionalGraph({ entryPoints, files }, options.compiler);
	await publishRegionalPackage(build, output, { sourcePaths });
	return build;
}
