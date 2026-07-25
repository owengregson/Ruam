import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const packageRoot = path.resolve(import.meta.dir, "../..");

function reachableModules(entries: readonly string[]): Map<string, string> {
	const reached = new Map<string, string>();
	const pending = [...entries];
	while (pending.length > 0) {
		const file = pending.pop()!;
		if (reached.has(file)) continue;
		const source = fs.readFileSync(file, "utf8");
		reached.set(file, source);
		const imports = ts.preProcessFile(source, true, true).importedFiles;
		for (const imported of imports) {
			if (!imported.fileName.startsWith(".")) continue;
			const requested = path.resolve(path.dirname(file), imported.fileName);
			const candidates = [
				requested,
				requested.replace(/\.js$/, ".ts"),
				requested.replace(/\.js$/, ".tsx"),
				path.join(requested, "index.ts"),
			];
			const resolved = candidates.find((candidate) => fs.existsSync(candidate));
			if (resolved !== undefined) pending.push(resolved);
		}
	}
	return reached;
}

describe("Isogloss reference isolation", () => {
	it("keeps generic evaluators, emitters, custodians, and test entropy out of package entries", () => {
		const modules = reachableModules([
				path.join(packageRoot, "src/index.ts"),
				path.join(packageRoot, "src/cli.ts"),
		]);
		const inputs = [...modules.keys()].map((file) =>
			file.replaceAll("\\", "/")
		);
		const forbiddenModules = [
			"/src/testing.ts",
			"/src/isogloss/bprf/testing-reference.ts",
			"/src/isogloss/bprf/testing-emitter.ts",
			"/src/isogloss/csh/reference.ts",
			"/src/isogloss/csh/testing-bprf-reference.ts",
			"/src/isogloss/csh/reference-custodian.ts",
			"/src/isogloss/csh/reference-chart-custodian.ts",
			"/src/isogloss/csh/reference-masked-custodian.ts",
		];

		for (const forbidden of forbiddenModules) {
			expect(
				inputs.some((input) => input.endsWith(forbidden)),
				forbidden
			).toBe(false);
		}
		const emitted = [...modules.values()].join("\n");
		for (const forbiddenToken of [
			"ReferenceRelationCustodian",
			"evaluateBprfReference",
			"evaluateBprfOverCshReference",
			"ReferenceChartRelationCustodian",
			"ReferenceMaskedChartCustodian",
			"RUAM_BPRF_CSH_MULTIPLICATION_QUORUM",
			"server-only-lineage-secret",
		]) {
			expect(emitted).not.toContain(forbiddenToken);
		}
	});
});
