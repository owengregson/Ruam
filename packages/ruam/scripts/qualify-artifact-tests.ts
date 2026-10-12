import { readFileSync } from "node:fs";
import { runArtifactTests, type ArtifactTestOptions } from "../src/algorithm-state/qualification/artifact-tests.js";

try {
	if (process.argv.length !== 3) throw new Error("Usage: bun scripts/qualify-artifact-tests.ts /absolute/path/config.json");
	const config = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as ArtifactTestOptions;
	const report = runArtifactTests(config);
	console.log(JSON.stringify({ status: report.status, tests: report.results.length, outputDirectory: report.outputDirectory, releaseApproved: false }, null, 2));
	process.exitCode = report.status === "pass" ? 0 : 2;
} catch (error) { console.error(String(error)); process.exitCode = 1; }
