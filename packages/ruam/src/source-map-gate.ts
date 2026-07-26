/**
 * Source-map / cleartext-leak gate.
 *
 * In directory/bundle mode Ruam copies the whole input tree before obfuscating
 * the matched `*.js` files in place. Babel regeneration strips
 * `//# sourceMappingURL=` comments from emitted code, but the copied `*.map`
 * files (and any inline `data:` source maps in non-obfuscated files) survive
 * verbatim — and a `.map` carries `sourcesContent`, i.e. the ORIGINAL SOURCE.
 * Shipping that next to the obfuscated output defeats the entire system.
 *
 * This module is the single place that removes source-map leakage from an
 * output tree. It deletes `*.map` files and strips any surviving
 * `sourceMappingURL` annotation from `.js` / `.mjs` / `.cjs` files.
 *
 * @module source-map-gate
 */

import fs from "fs-extra";
import path from "path";

/** Options controlling the source-map gate. */
export interface SourceMapGateOptions {
	/** When true, the gate is a no-op (maps and annotations are preserved). */
	keepSourceMaps?: boolean;
}

/**
 * Matches a trailing `sourceMappingURL` annotation line (both `//#` and the
 * legacy `//@` forms), including inline `data:` URIs. Anchored to end-of-line
 * so it never touches an unrelated comment mid-file.
 */
const SOURCE_MAPPING_URL_RE = /[ \t]*\/\/[#@][ \t]*sourceMappingURL=.*$/gm;

/**
 * Remove every `sourceMappingURL` annotation from a source string.
 *
 * @param code - JavaScript source text.
 * @returns The source with all `sourceMappingURL` annotation lines removed and
 *          trailing whitespace trimmed.
 */
export function stripSourceMappingComment(code: string): string {
	if (!code.includes("sourceMappingURL")) return code;
	return code.replace(SOURCE_MAPPING_URL_RE, "").replace(/\s+$/, "");
}

/** File extensions whose contents may carry a `sourceMappingURL` annotation. */
const SCRIPT_EXTS = new Set([".js", ".mjs", ".cjs"]);

/**
 * Gate an already-written output tree against source-map leakage.
 *
 * Deletes all `*.map` files and strips `sourceMappingURL` annotations from
 * script files anywhere under {@link outputDir}. Idempotent and safe to run
 * on a tree that has already been gated.
 *
 * @param outputDir - Absolute path to the output directory to gate.
 * @param opts - Gate options. When `keepSourceMaps` is set, this is a no-op.
 * @returns The number of `*.map` files deleted.
 */
export async function gateSourceMaps(
	outputDir: string,
	opts: SourceMapGateOptions
): Promise<number> {
	if (opts.keepSourceMaps) return 0;

	const { globby } = await import("globby");
	const all = await globby(["**/*"], {
		cwd: outputDir,
		ignore: ["**/node_modules/**"],
		absolute: true,
		dot: true,
		onlyFiles: true,
	});

	let removed = 0;
	for (const file of all) {
		const ext = path.extname(file).toLowerCase();
		if (ext === ".map") {
			await fs.remove(file);
			removed++;
			continue;
		}
		if (SCRIPT_EXTS.has(ext)) {
			const code = await fs.readFile(file, "utf8");
			const stripped = stripSourceMappingComment(code);
			if (stripped !== code) {
				await fs.writeFile(file, stripped);
			}
		}
	}
	return removed;
}
