/** Reproducible isolated historical baseline runs; never checks out or modifies the shared branch. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { PINNED_BASELINES } from "../src/regional/qualification/types.js";
const root = resolve(import.meta.dir, "../../..");
const evidence = resolve(root, "docs/research/2026-10-09-protection-swarm/implementation/qualification");
const outputIndex = process.argv.indexOf("--output"), output = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]!) : join(evidence, "historical-report.json");
const specimens = ["recurrence-1", "fixed-configuration-1", "independent-control-1", "independent-control-4", "pr7-declared-domain-probe"];
const rows: unknown[] = [], archives: unknown[] = [];
for (const baseline of PINNED_BASELINES) {
	let commit: string, archive: string;
	try {
		commit = execFileSync("git", ["rev-parse", "--verify", `${baseline.ref}^{commit}`], { cwd: root, encoding: "utf8" }).trim();
		archive = mkdtempSync(join(tmpdir(), `ruam-qualified-${baseline.id}-`));
		execFileSync("tar", ["-xf", "-", "-C", archive], { input: execFileSync("git", ["archive", commit], { cwd: root, maxBuffer: 100 * 1024 * 1024 }), maxBuffer: 100 * 1024 * 1024 });
		for (const location of ["node_modules", "packages/ruam/node_modules"]) if (existsSync(resolve(root, location))) symlinkSync(resolve(root, location), resolve(archive, location), "dir");
	} catch (error) { archives.push({ ...baseline, status: "unavailable", error: String(error), resistanceCredit: false }); continue; }
	archives.push({ ...baseline, commit, archive, modifications: "none", localOnlyCommit: baseline.ref === "f7f52c8" });
	for (const specimen of specimens) for (const seed of [0, 1]) {
		const started = performance.now();
		try {
			const text = execFileSync(process.execPath, [resolve(import.meta.dir, "regional-baseline-worker.ts")], {
				input: JSON.stringify({ archive, specimen, seed, legacy: baseline.id === "main-max" || baseline.id === "pr5-offline-max" }),
				encoding: "utf8", timeout: 15_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NO_COLOR: "1" },
			});
			rows.push({ baseline: baseline.id, specimen, seed, seedIsDeterministic: baseline.deterministicSeed, wallMs: performance.now() - started, ...JSON.parse(text.trim().split("\n").at(-1)!) });
		} catch (error) { const failure = error as { code?: string; signal?: string; message?: string }; rows.push({ baseline: baseline.id, specimen, seed, status: failure.code === "ETIMEDOUT" ? "timeout-right-censored" : "worker-error", wallMs: performance.now() - started, error: failure.message?.slice(0, 1000), signal: failure.signal, resistanceCredit: false }); }
	}
}
writeFileSync(output, JSON.stringify({ schema: "ruam-pinned-baselines-v1", generatedAt: new Date().toISOString(), claimsDemonstratedSecurity: false,
	processTimeoutMs: 15000, attackCpuBudget: "bounded by process timeout; no inferred resistance from errors/timeouts", archives, rows }, null, 2) + "\n");
console.log(JSON.stringify({ output, archives, runs: rows.length }, null, 2));
