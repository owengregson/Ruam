/** @module Isolated application tests with generated-module substitution and explicit coverage evidence. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface ArtifactTestOptions {
	projectRoot: string;
	/** Must be a new directory outside the application tree. Logs can contain private application code. */
	outputDirectory: string;
	substitutions: Array<{ source: string; artifact: string; sha256: string }>;
	tests: string[];
	timeoutMs?: number;
}
interface LoadEvidence { source: string; artifact: string; sha256: string; bytes: number; importPath: string; }
interface TestCounts { total: number; skipped: number; failed: number; executed: number; }
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function inside(parent: string, child: string): boolean {
	const rel = relative(parent, child);
	return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
function file(path: string): string {
	const result = realpathSync(path);
	if (!statSync(result).isFile()) throw new Error(`Expected file: ${path}`);
	return result;
}
function testCounts(path: string): TestCounts | null {
	if (!existsSync(path)) return null;
	// Read only Bun's root JUnit summary; nested suites repeat their counts.
	const root = readFileSync(path, "utf8").match(/<testsuites\s[^>]*>/)?.[0];
	if (!root) return null;
	const count = (name: string) => {
		const match = root.match(new RegExp(`\\b${name}="(\\d+)"`));
		return match ? Number(match[1]) : NaN;
	};
	const total = count("tests"), skipped = count("skipped"), failed = count("failures");
	if (![total, skipped, failed].every(Number.isSafeInteger) || skipped + failed > total) return null;
	return { total, skipped, failed, executed: total - skipped };
}

/**
 * Runs repository-owned application tests in one Bun process per file.
 * Tests and artifacts are trusted code, not sandboxed hostile inputs.
 * @returns Local report; test success alone earns no protection qualification.
 */
export function runArtifactTests(options: ArtifactTestOptions) {
	if (!process.versions.bun) throw new Error("Artifact application tests require Bun");
	const projectRoot = realpathSync(options.projectRoot);
	if (!statSync(projectRoot).isDirectory()) throw new Error("Project root must be a directory");
	const requestedOutput = resolve(options.outputDirectory);
	const outputDirectory = join(realpathSync(resolve(requestedOutput, "..")), requestedOutput.split(sep).at(-1)!);
	if (inside(projectRoot, outputDirectory) || existsSync(outputDirectory)) throw new Error("Output must be a new directory outside the application tree");
	if (!Array.isArray(options.tests) || !options.tests.length || options.tests.length > 256) throw new Error("Expected 1 to 256 explicit test files");
	if (!Array.isArray(options.substitutions) || !options.substitutions.length || options.substitutions.length > 128) throw new Error("Expected 1 to 128 module substitutions");
	const timeoutMs = options.timeoutMs ?? 60_000;
	if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) throw new Error("Invalid per-test timeout");
	const tests = options.tests.map(path => file(resolve(projectRoot, path)));
	if (new Set(tests).size !== tests.length || tests.some(path => !inside(projectRoot, path))) throw new Error("Tests must be distinct files inside the application tree");
	const substitutions = options.substitutions.map(item => {
		const source = file(resolve(projectRoot, item.source)), artifact = file(resolve(projectRoot, item.artifact));
		if (!inside(projectRoot, source)) throw new Error("Substitution source must belong to the application tree");
		if (!/^[a-f0-9]{64}$/.test(item.sha256) || digest(readFileSync(artifact)) !== item.sha256) throw new Error("Artifact hash does not match");
		return { source, artifact, sha256: item.sha256 };
	});
	if (new Set(substitutions.map(item => item.source)).size !== substitutions.length) throw new Error("Duplicate substitution source");
	const preload = fileURLToPath(new URL("./artifact-test-preload.ts", import.meta.url));
	const boundPaths = [...new Set([fileURLToPath(import.meta.url), preload, ...tests, ...substitutions.flatMap(item => [item.source, item.artifact])])];
	const snapshot = () => Object.fromEntries(boundPaths.map(path => [path, digest(readFileSync(path))]));
	const startingHashes = snapshot();
	mkdirSync(outputDirectory);
	const configPath = join(outputDirectory, "substitutions.json");
	writeFileSync(configPath, JSON.stringify({ substitutions }, null, 2) + "\n", { flag: "wx" });
	const results = tests.map((test, index) => {
		const evidencePath = join(outputDirectory, `${index}.loads.jsonl`);
		const junitPath = join(outputDirectory, `${index}.junit.xml`);
		writeFileSync(evidencePath, "", { flag: "wx" });
		const start = performance.now();
		const child = spawnSync(process.execPath, ["test", "--reporter=junit", `--reporter-outfile=${junitPath}`, "--preload", preload, test], {
			cwd: projectRoot,
			env: { ...process.env, RUAM_ARTIFACT_TEST_CONFIG: configPath, RUAM_ARTIFACT_TEST_EVIDENCE: evidencePath },
			encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024,
		});
		const wallMilliseconds = performance.now() - start;
		writeFileSync(join(outputDirectory, `${index}.stdout.log`), child.stdout ?? "", { flag: "wx" });
		writeFileSync(join(outputDirectory, `${index}.stderr.log`), child.stderr ?? "", { flag: "wx" });
		const loads = readFileSync(evidencePath, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as LoadEvidence);
		const evidenceValid = loads.every(load => substitutions.some(item => load.source === item.source && load.artifact === item.artifact && load.sha256 === item.sha256));
		const counts = testCounts(junitPath);
		return { test, exitCode: child.status, signal: child.signal, error: child.error?.message ?? null,
			wallMilliseconds, loadedArtifacts: loads, evidenceValid, counts,
			status: child.status === 0 && !child.error && loads.length > 0 && evidenceValid && counts && counts.executed > 0 && counts.failed === 0 ? "pass" : "fail" };
	});
	const unchanged = JSON.stringify(startingHashes) === JSON.stringify(snapshot());
	const loaded = new Set(results.flatMap(result => result.loadedArtifacts.map(load => load.source)));
	const missing = substitutions.filter(item => !loaded.has(item.source)).map(item => item.source);
	const report = {
		schema: "ruam-exact-artifact-tests-v1", generatedAt: new Date().toISOString(),
		status: unchanged && !missing.length && results.every(result => result.status === "pass") ? "pass" : "fail",
		projectRoot, outputDirectory, runtime: { executable: process.execPath, versions: process.versions },
		substitutions, boundFileHashes: startingHashes, boundFilesUnchanged: unchanged,
		missingSubstitutions: missing, results, releaseApproved: false, protectionQualified: false,
		limitations: [
			"Application test processes and generated artifacts are trusted local code, not security-sandboxed inputs.",
			"A passing test file must execute a test and load a requested artifact. Unloaded substitutions and stale artifacts fail this run; loading does not itself prove every export was exercised.",
			"The selected test files, source entries, artifacts and preload are hash-bound; transitive test dependencies and host state are not fully frozen.",
			"This records application tests under Bun and the application's mocks; it does not certify browser equivalence, full protected coverage or resistance to recovery.",
			"Logs and exact application paths remain local and may contain private source or data. Do not publish them automatically.",
		],
	};
	writeFileSync(join(outputDirectory, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
	return report;
}
