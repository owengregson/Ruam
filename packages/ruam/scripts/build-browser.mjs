/**
 * Bundles the Ruam Web Worker for browser use.
 *
 * Produces a self-contained `ruam-worker.mjs` that includes all
 * dependencies (Babel, etc.) and polyfills `node:crypto` with the
 * Web Crypto API.
 *
 * Output is written to `../../apps/web/public/ruam-worker.mjs` so
 * the Next.js site can reference it directly.
 */

import { build } from "esbuild";
import { copyFile } from "node:fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outFile = join(root, "..", "..", "apps", "web", "public", "ruam-worker.mjs");

await build({
	entryPoints: [join(root, "src", "browser-worker.ts")],
	bundle: true,
	format: "esm",
	target: "es2022",
	platform: "browser",
	outfile: outFile,
	minify: true,
	treeShaking: true,
	// Polyfill Node.js globals for browser
	define: {
		"process.env.NODE_ENV": '"production"',
		"process.env": "{}",
		"process.platform": '"browser"',
		"process.versions": "{}",
	},
	// Inject a minimal process shim so bare `process` references resolve
	banner: {
		js: "var process = { env: { NODE_ENV: 'production' }, platform: 'browser', versions: {} };",
	},
	// Replace node:crypto import with our browser shim
	alias: {
		"node:crypto": join(root, "src", "browser-crypto-shim.ts"),
	},
	// These are Node-only and not reachable from obfuscateCode
	external: [
		"fs-extra",
		"globby",
		"path",
		"fs",
		"@inquirer/prompts",
		"chalk",
		"ora",
	],
	logLevel: "info",
});

console.log(`✓ Browser worker bundle written to ${outFile}`);

// Copy option manifest to web app public directory
const manifestSrc = join(root, "dist", "option-manifest.json");
const manifestDest = join(root, "..", "..", "apps", "web", "public", "option-manifest.json");
try {
	await copyFile(manifestSrc, manifestDest);
	console.log(`✓ Option manifest copied to ${manifestDest}`);
} catch {
	console.warn("⚠ option-manifest.json not found — run generate-manifest first");
}
