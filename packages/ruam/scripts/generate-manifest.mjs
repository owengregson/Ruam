/**
 * Build-time manifest generator.
 *
 * Reads option metadata and preset definitions from the built dist/,
 * produces a JSON manifest that the website consumes. Run after tsup
 * builds the core library.
 *
 * Output: dist/option-manifest.json
 *         (also copied to apps/web/public/ by build:browser script)
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");

async function main() {
	// Dynamic import from the built dist
	const optionMeta = await import(join(distDir, "index.js"));
	const presets = await import(join(distDir, "index.js"));

	// Extract what we need
	const { OPTION_META, AUTO_ENABLE_RULES } = optionMeta;
	const { PRESETS } = presets;

	if (!OPTION_META || !PRESETS) {
		console.error(
			"ERROR: Could not find OPTION_META or PRESETS in dist/index.js"
		);
		console.error(
			"Make sure they are exported from the main entry point."
		);
		process.exit(1);
	}

	// Build the manifest
	const manifest = {
		options: OPTION_META.map((m) => ({
			key: m.key,
			label: m.label,
			category: m.category,
			description: m.description,
			cliFlag: m.cliFlag,
		})),
		presets: {},
		autoEnableRules: AUTO_ENABLE_RULES.map((r) => ({
			when: r.when,
			enables: r.enables,
		})),
	};

	// Extract boolean option values from presets (skip non-boolean fields)
	const booleanKeys = new Set(OPTION_META.map((m) => m.key));
	for (const presetName of ["low", "medium", "max"]) {
		const preset = PRESETS[presetName];
		if (!preset) continue;
		const filtered = {};
		for (const [key, value] of Object.entries(preset)) {
			if (booleanKeys.has(key)) {
				filtered[key] = value;
			}
		}
		manifest.presets[presetName] = filtered;
	}

	const outputPath = join(distDir, "option-manifest.json");
	await writeFile(outputPath, JSON.stringify(manifest, null, 2) + "\n");
	console.log(`  Generated ${outputPath}`);
}

main().catch((err) => {
	console.error("Manifest generation failed:", err);
	process.exit(1);
});
