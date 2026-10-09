import { describe, expect, test } from "bun:test";
import { extractStandalone, learnNumeric } from "../../src/regional/qualification/attacker.js";
import { hiddenInputs, RECOVERY_SPECIMENS } from "../../src/regional/qualification/specimens.js";
import { oracleFor, scoreRecovery, sameValue, validateCandidate } from "../../src/regional/qualification/scorer.js";

describe("executable recovery qualification", () => {
	test("reduces private scalar state and validates independently on held-out histories", () => {
		const specimen = RECOVERY_SPECIMENS[0]!;
		const inputs = hiddenInputs(specimen), expected = inputs.map(oracleFor(specimen.source));
		const candidate = extractStandalone(specimen.source);
		expect(candidate.transformations.scalarBodiesReduced).toBeGreaterThan(0);
		expect(candidate.code).not.toContain("__regionalEntry");
		expect(candidate.code).not.toContain("function run");
		expect(scoreRecovery(candidate, inputs, expected).verifiedStandaloneRecovery).toBe(true);
	});
	test("unchanged artifact function copying earns no recovery credit", () => {
		expect(extractStandalone("function run(x) { return x; }").status).toBe("artifact-transplant-only");
		expect(extractStandalone("function run(x) { return x + 0; }").status).toBe("artifact-transplant-only");
	});
	test("normalizing a wrapper around a retained interpreter earns no recovery credit", () => {
		const artifact = "function run(input){function interpreter(code,value){let state=value;for(let pc=0;pc<code.length;pc+=2){switch(code[pc]){case 1:state+=code[pc+1];break;case 2:state^=code[pc+1];break;}}return state;}const program=[1,17,2,91,1,29];return interpreter(program,input)+0;}";
		const inputs = Array.from({ length: 96 }, (_, i) => i), expected = inputs.map(oracleFor(artifact));
		expect(scoreRecovery(extractStandalone(artifact), inputs, expected).verifiedStandaloneRecovery).toBe(false);
		const recursive = "function run(input){const program=[1,17,2,91,1,20+9];function interpreter(pc,value){if(pc===program.length)return value;return interpreter(pc+2,program[pc]===1?value+program[pc+1]:value^program[pc+1]);}return interpreter(0,input)+0;}";
		expect(scoreRecovery(extractStandalone(recursive), inputs, inputs.map(oracleFor(recursive))).verifiedStandaloneRecovery).toBe(false);
		const singleReturn = "function run(input){const program=[1,17,2,91,1,20+9];function interpreter(pc,value){return pc===program.length?value:interpreter(pc+2,program[pc]===1?value+program[pc+1]:value^program[pc+1]);}return interpreter(0,input)+0;}";
		expect(scoreRecovery(extractStandalone(singleReturn), inputs, inputs.map(oracleFor(singleReturn))).verifiedStandaloneRecovery).toBe(false);
	});
	test("oracle-only learner recovers easy control without original source", () => {
		const candidate = learnNumeric(x => (Math.imul(x | 0, 7) + 19) | 0);
		const specimen = RECOVERY_SPECIMENS.find(s => s.id === "independent-control-1")!;
		const inputs = hiddenInputs(specimen), expected = inputs.map(oracleFor(specimen.source));
		expect(scoreRecovery(candidate, inputs, expected).verifiedStandaloneRecovery).toBe(true);
		expect(candidate.resources.queries).toBeGreaterThan(0);
	});
	test("plausible wrong candidate and signed-zero changes fail held-out validation", () => {
		const candidate = learnNumeric(() => 3);
		const result = scoreRecovery(candidate, Array.from({ length: 96 }, (_, i) => i), Array.from({ length: 96 }, (_, i) => i === 95 ? -0 : 3));
		expect(result.verifiedStandaloneRecovery).toBe(false);
		expect(result.validation?.mismatches).toBe(1);
		expect(sameValue([-0, NaN], [0, NaN])).toBe(false);
	});
	test("external runtime dependency is unsupported", () => {
		expect(extractStandalone("function run(x) { return foreignRuntime(x) + 1; }").status).toBe("unsupported");
	});
	test("empty, misaligned and unsupported oracles cannot pass", () => {
		expect(validateCandidate("function run(x){return x}", "run", [], []).status).toBe("error");
		expect(validateCandidate("function run(x){return x}", "run", [1], []).status).toBe("error");
		expect(validateCandidate("function run(x){return x}", "run", [{}], [{}]).status).toBe("error");
	});
});
