/** One baseline in an externally time-bounded child process. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { extractStandalone, learnNumeric } from "../src/regional/qualification/attacker.js";
import { digest, oracleFor, scoreRecovery, validateCandidate } from "../src/regional/qualification/scorer.js";
import { RECOVERY_SPECIMENS, hiddenInputs } from "../src/regional/qualification/specimens.js";
const request = JSON.parse(readFileSync(0, "utf8"));
const domainProbe = request.specimen === "pr7-declared-domain-probe";
const loopProbe = request.specimen === "wip-simple-loop-probe";
const specimen = loopProbe ? { source: "function run(input) { var sum = 0; for (var i = 0; i < input; i++) sum += i; return sum; } globalThis.__regionalEntry = run;", inputKind: "integer" } : domainProbe ? { source: "function run(input) { return (input * input) + (input - 3); } globalThis.__regionalEntry = run;", inputKind: "integer" } : RECOVERY_SPECIMENS.find(s => s.id === request.specimen)!;
const inputs = loopProbe ? Array.from({ length: 20 }, (_, i) => i) : domainProbe ? Array.from({ length: 100 }, (_, i) => i % 20 + 1) : hiddenInputs(specimen as typeof RECOVERY_SPECIMENS[number]);
const expected = inputs.map(oracleFor(specimen.source));
try {
	const started = performance.now();
	let code: string, ownerStats: unknown;
	if (request.legacy) {
		const module = await import(pathToFileURL(`${request.archive}/packages/ruam/src/transform.ts`).href);
		code = module.obfuscateCode(specimen.source, { preset: "max", target: "node" });
	} else {
		const module = await import(pathToFileURL(`${request.archive}/packages/ruam/src/testing.ts`).href);
		const result = module.protectCodeDeterministic(specimen.source, { isogloss: { profile: "holographic-local" }, ...(domainProbe ? { regionDomains: { run: { input: { type: "number", min: 1, max: 20 } } } } : {}) }, request.seed);
		code = result.code; ownerStats = result.stats;
	}
	const compileWallMs = performance.now() - started;
	const correctness = validateCandidate(code, "__regionalEntry", inputs, expected);
	const extraction = scoreRecovery(extractStandalone(code), inputs, expected);
	const learning = !loopProbe && specimen.inputKind === "integer" ? scoreRecovery(learnNumeric(oracleFor(code, "__regionalEntry")), inputs, expected) : null;
	const trim = (candidate: typeof extraction) => ({ ...candidate, code: undefined, recoveredSha256: candidate.code ? digest(candidate.code) : undefined });
	console.log(JSON.stringify({ status: "compiled", artifactSha256: digest(code), artifactBytes: code.length, compileWallMs, correctness, ownerStats,
		staticAttack: trim(extraction), numericAttack: learning && trim(learning), equallyProtectedCoverageConfirmed: false, domainProbe: domainProbe ? "Adapted PR7 source-transform.test.ts crown relation, one numeric input with owner-declared domain1..20; 20 distinct values repeated five times, not 100 independent cases. Oracle learner may query outside domain and report error." : undefined,
		comparativeStrength: "inconclusive: no historical VM lifting and no complete-coverage equality proof" }));
} catch (error) { console.log(JSON.stringify({ status: "compiler-or-execution-error", error: String(error), equallyProtectedCoverageConfirmed: false })); }
