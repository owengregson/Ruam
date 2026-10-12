import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseFrozenAudit, reportDestination, sourceDigest, stoppedPreflight, verifyFrozenBaseline, verifyFrozenSources } from "../src/algorithm-state/qualification/preflight.js";
import { runSidecarControl } from "../src/algorithm-state/qualification/sidecar.js";
import { runNativeLoweringControl } from "../src/algorithm-state/qualification/native-lowering.js";

const repository = resolve(import.meta.dir, "../../..");
const evidenceDirectory = "docs/research/2026-10-12-algorithm-state";
const manifestPath = `${evidenceDirectory}/roots.json`;
const provenancePaths = [manifestPath, "packages/ruam/src/algorithm-state/qualification/preflight.ts",
	"packages/ruam/src/algorithm-state/qualification/sidecar.ts", "packages/ruam/scripts/algorithm-state-qualify.ts",
	"packages/ruam/test/algorithm-state/preflight.test.ts", "packages/ruam/test/algorithm-state/sidecar.test.ts",
	"packages/ruam/src/algorithm-state/qualification/native-lowering.ts", "packages/ruam/test/algorithm-state/native-lowering.test.ts"];

async function main() {
	const args = process.argv.slice(2);
	let reportOnly = false, output = resolve(repository, `${evidenceDirectory}/preflight-report.json`);
	let hasOutput = false;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--report-only" && !reportOnly) { reportOnly = true; continue; }
		if (arg === "--output" && !hasOutput) {
			const value = args[++index];
			if (!value || value.startsWith("--")) throw new Error("--output requires a file path");
			output = resolve(value); hasOutput = true; continue;
		}
		throw new Error(`Unknown or repeated argument: ${arg}`);
	}
	if (statSync(resolve(repository, manifestPath)).size > 1024 * 1024) throw new Error("Audit manifest exceeds 1 MiB");
	const readHashes = () => Object.fromEntries(provenancePaths.map(path => [path, sourceDigest(readFileSync(resolve(repository, path)))]));
	const startingHashes = readHashes();
	const audit = parseFrozenAudit(JSON.parse(readFileSync(resolve(repository, manifestPath), "utf8")));
	const protectedFiles = [...provenancePaths, ...audit.dependencySources.map(source => source.path)].map(path => resolve(repository, path));
	output = reportDestination(output, protectedFiles);
	verifyFrozenBaseline(audit, repository);
	const sources = verifyFrozenSources(audit, repository);
	// These attack controls concern existing ordinary implementations. No failed
	// root is compiled or promoted to a new A1 implementation by this command.
	const sidecar = await runSidecarControl(repository);
	const nativeLowering = await runNativeLoweringControl(repository);
	verifyFrozenSources(audit, repository);
	if (JSON.stringify(startingHashes) !== JSON.stringify(readHashes())) throw new Error("Qualification inputs changed during the run");
	if (sidecar.status !== "pass-control" || !sidecar.sourcesUnchangedDuringRun) throw new Error("Sidecar control failed; no qualification report can be completed");
	if (nativeLowering.decision !== "reject-continuation-flattening-alone-for-this-control") throw new Error("Native lowering control failed; inspect correctness and attack validation before completing the report");
	const decision = stoppedPreflight(audit);
	const report = {
		schema: "ruam-algorithm-state-preflight-v1",
		generatedAt: new Date().toISOString(),
		decision,
		provenance: {
			gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(),
			baselineCommit: audit.baselineCommit,
			baselineSourceBlobsVerified: true,
			experimentId: audit.experimentId,
			qualificationFiles: startingHashes,
			frozenSources: sources,
			sourcesUnchangedDuringRun: true,
		},
		runtime: { executable: process.execPath, versions: process.versions, platform: process.platform, architecture: process.arch, realBrowserEnginesTested: [] },
		admission: { method: "manual-source-audit-with-verified-provenance", sourceDerivedAdmissionProverImplemented: false, roots: audit.roots },
		sidecar,
		nativeLowering,
		limitations: [
			"The complete requested replacement is not implemented. Full existing JavaScript and protected-selection scope remains required.",
			"The frozen A1 pilot stops at admission; no A1 artifact, algorithm compiler, explanation trial or partial-edit protection result exists.",
			"Sidecar controls test a negative-control ticket on a rejected root; they do not score the frozen candidate ticket or measure A1 resistance.",
			"The native-lowering control is one hand-specialized existing function with known observation limits, not a general backend or full-scope compatibility result.",
			"This is not a blinded AI campaign or proof that every future combined design fails. Unknown authoring and analyst effort remain unknown.",
			"Source hashes and exact Git blobs bind this manual audit to code; they do not prove the audit's semantic conclusions.",
			"Passing correctness controls cannot override a failed admission, full-scope compatibility, cost or protection gate.",
		],
	};
	// Publish a complete report. A stopped qualification exits 2 unless the caller
	// explicitly asks only to reproduce the report; operational failures exit 1.
	// Recheck the destination after execution; external hostile filesystem races
	// are outside this repository-owned research runner's trust boundary.
	output = reportDestination(output, protectedFiles);
	const stagingDirectory = mkdtempSync(join(dirname(output), ".ruam-a1-report-"));
	const staging = join(stagingDirectory, "report.json");
	try {
		writeFileSync(staging, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
		renameSync(staging, output);
	} finally { rmSync(stagingDirectory, { force: true, recursive: true }); }
	console.log(JSON.stringify({ output, ...decision, sidecarControl: sidecar.status, nativeLoweringControl: nativeLowering.decision }, null, 2));
	process.exitCode = reportOnly ? 0 : 2;
}

main().catch(error => { console.error(String(error)); process.exitCode = 1; });
