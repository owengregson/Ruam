import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { compileRegionalCode } from "../src/regional/index.js";
import type { RegionalCompileReport } from "../src/regional/compiler/types.js";
import { extractStandalone, learnNumeric } from "../src/regional/qualification/attacker.js";
import { RECOVERY_SPECIMENS, REPOSITORY_ADMISSION_ROOTS, hiddenInputs } from "../src/regional/qualification/specimens.js";
import { digest, median, oracleFor, scoreRecovery, validateCandidate } from "../src/regional/qualification/scorer.js";
import type { AttackResult } from "../src/regional/qualification/types.js";

const root = resolve(import.meta.dir, "../../..");
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]!) : resolve(root, "docs/research/2026-10-09-protection-swarm/implementation/qualification/regional-report.json");
const provenanceFiles = ["packages/ruam/src/regional/compiler/index.ts", "packages/ruam/src/regional/compiler/analysis.ts", "packages/ruam/src/regional/compiler/transforms.ts", "packages/ruam/src/regional/compiler/types.ts",
	"packages/ruam/src/regional/index.ts", "packages/ruam/src/regional/graph.ts", "packages/ruam/src/regional/files.ts", "packages/ruam/src/regional/cost.ts", "packages/ruam/src/regional/validation.ts", "packages/ruam/src/regional/contracts.ts",
	"packages/ruam/src/regional/qualification/attacker.ts", "packages/ruam/src/regional/qualification/scorer.ts", "packages/ruam/src/regional/qualification/specimens.ts", "packages/ruam/scripts/regional-qualify.ts"];
const sourceHashes = () => Object.fromEntries(provenanceFiles.map(path => [path, digest(readFileSync(resolve(root, path), "utf8"))]));
const startingHashes = sourceHashes();
const builds = 8;
const variants = [
	{ id: "plain", options: { fusion: false, joint: false, configuration: false } },
	{ id: "fusion-only", options: { fusion: true, joint: false, configuration: false } },
	{ id: "regional", options: { fusion: true, joint: true, configuration: false } },
	{ id: "regional-configuration", options: { fusion: true, joint: true, configuration: true } },
] as const;
const rows: Record<string, unknown>[] = [];
const costs = new Map<string, number[]>();
const summarizeAttack = (attack: AttackResult) => ({ ...attack, code: undefined, recoveredSha256: attack.code ? digest(attack.code) : undefined, recoveredBytes: attack.code?.length });
for (const specimen of RECOVERY_SPECIMENS) {
	const inputs = hiddenInputs(specimen), original = oracleFor(specimen.source), expected = inputs.map(original);
	for (let seed = 0; seed < builds; seed++) for (const variant of variants) {
		try {
			const compiled = compileRegionalCode(specimen.source, { seed, ...variant.options });
			const core = compiled.report.reports["input.js"] as RegionalCompileReport;
			const correctness = validateCandidate(compiled.code, "run", inputs, expected);
			const staticAttack = scoreRecovery(extractStandalone(compiled.code), inputs, expected);
			const numericAttack = specimen.inputKind === "integer" ? scoreRecovery(learnNumeric(oracleFor(compiled.code)), inputs, expected) : null;
			if (staticAttack.verifiedStandaloneRecovery) {
				const key = `${specimen.id}/${variant.id}`;
				costs.set(key, [...(costs.get(key) ?? []), staticAttack.resources.cpuUserMilliseconds + staticAttack.resources.cpuSystemMilliseconds]);
			}
			rows.push({ specimen: specimen.id, cohort: specimen.cohort, seed, variant: variant.id, artifactSha256: digest(compiled.code), artifactBytes: compiled.code.length,
				transformations: core.transformations, coverage: core.coverage, packageWholeSourceProtection: compiled.report.wholeSourceProtection, correctness, staticAttack: summarizeAttack(staticAttack), numericAttack: numericAttack && summarizeAttack(numericAttack) });
		} catch (error) { rows.push({ specimen: specimen.id, seed, variant: variant.id, status: "compiler-or-scorer-error", error: String(error) }); }
	}
}
const admissions = REPOSITORY_ADMISSION_ROOTS.map(item => {
	try {
		const source = readFileSync(resolve(root, item.path), "utf8"), compiled = compileRegionalCode(source, { seed: 0 });
		return { ...item, sourceSha256: digest(source), admission: "compiled-experimental", qualifiedCompleteRoot: false, report: compiled.report,
			reason: "Compilation alone is not whole-source protection or cross-host semantic qualification." };
	} catch (error) { return { ...item, admission: "rejected-or-unavailable", qualifiedCompleteRoot: false, error: String(error) }; }
});
const pairedCosts = RECOVERY_SPECIMENS.map(specimen => {
	const plain = median(costs.get(`${specimen.id}/plain`) ?? []), regional = median(costs.get(`${specimen.id}/regional-configuration`) ?? []);
	return { specimen: specimen.id, cohort: specimen.cohort, plainMedianCpuMs: plain, regionalMedianCpuMs: regional,
		ratio: plain && regional !== null ? regional / plain : null, plainSampleCount: costs.get(`${specimen.id}/plain`)?.length ?? 0, sampleCount: costs.get(`${specimen.id}/regional-configuration`)?.length ?? 0 };
});
const atMostTwo = pairedCosts.filter(row => row.cohort !== "independent-control" && row.ratio !== null && row.ratio <= 2 && row.sampleCount === 8 && row.plainSampleCount === 8);

const wholeSourceProtection = rows.length > 0 && rows.every(row => (row.coverage as { wholeSourceProtection?: boolean })?.wholeSourceProtection === true);
const report = {
	schema: "ruam-regional-qualification-v1", generatedAt: new Date().toISOString(), status: "NO-GO", claimsDemonstratedSecurity: false,
	codeVersion: { gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), workingTreeFiles: startingHashes, sourcesUnchangedDuringRun: JSON.stringify(startingHashes) === JSON.stringify(sourceHashes()) },
	runtime: { executable: process.execPath, versions: process.versions, realBrowserEnginesTested: [], vmIsBrowserEvidence: false },
	protocol: { seedCount: builds, variants: variants.map(v => v.id), syntheticSpecimens: RECOVERY_SPECIMENS.map(({ id, cohort, provenance }) => ({ id, cohort, provenance })),
		resources: "CPU and wall are extraction only, oracle queries separately counted; heap delta may be negative; peak RSS is process-wide high-water (Bun/macOS bytes; Node KiB converted), not per-attack allocation. Analyst time unknown (null), model tokens in executable attacker zero.",
		hiddenCases: "96 variable-length recurrence histories or 106 numeric inputs; scorer inputs/source never passed to attacker API; deterministic calibration fixtures are repository-public, not a blind human red-team trial.",
		limitations: ["No baseline-comparative security multiplier: existing VM lifter is not implemented.", "Timing is a small-sample local microbenchmark affected by warmup; CPU ratios are an early falsifier only.", "Static reduction recovers scalar arithmetic/branches and retains ordinary loop scaffolds; arrays/complex runtimes may be unsupported.", "No real-engine cross-host qualification; no claim of unrestricted full-JavaScript support.", "Scorer is synchronous-only: it provides real timers but cancels outstanding handles after each realm; background anti-debug/async behavior is not scored."] },
	gates: { wholeSourceProtection, qualifiedCompleteRoots: 0, requiredCompleteRoots: 3, representativeRootGatePassed: false, qualificationProtocol: "Complete-root cross-host qualification is not implemented; zero qualified roots is not inferred from syntax admission alone.",
		earlyAttackAtMostTwoTimesCpu: atMostTwo.map(row => row.specimen), stopExpansion: true,
		reasons: ["Compiler explicitly reports wholeSourceProtection:false; no complete authored root is qualified.", ...(atMostTwo.length ? ["At least one dependent/configuration specimen has validated standalone recovery at <=2x plain median CPU; prototype resistance rationale fails early falsifier."] : ["No <=2x timing result is treated as proof of protection; coverage alone fails the release gate."])] },
	pairedCosts, admissions, rows,
};
writeFileSync(outputPath, JSON.stringify(report) + "\n");
console.log(JSON.stringify({ outputPath, builds: rows.length, correctnessPasses: rows.filter(r => (r.correctness as { status?: string })?.status === "pass").length,
	staticRecoveries: rows.filter(r => (r.staticAttack as { verifiedStandaloneRecovery?: boolean })?.verifiedStandaloneRecovery).length,
	blackboxRecoveries: rows.filter(r => (r.numericAttack as { verifiedStandaloneRecovery?: boolean })?.verifiedStandaloneRecovery).length, gates: report.gates }, null, 2));
