import { describe, expect, it } from "bun:test";
import { runSidecarControl } from "../../src/algorithm-state/qualification/sidecar.js";

describe("algorithm-state existing-root edit negative control", () => {
	it("validates the sidecar and catches a superficially correct patch on future frozen behavior", async () => {
		const report = await runSidecarControl();
		expect(report.status).toBe("pass-control");
		expect(report.sourcesUnchangedDuringRun).toBe(true);
		expect(report.variants).toHaveLength(3);
		for (const variant of report.variants.slice(0, 2)) {
			expect(variant.correctness.status).toBe("pass");
			expect(variant.attackValidation).toMatchObject({ status: "pass", cases: 12, mismatches: 0 });
			expect(variant.uneditedTicketValidation.mismatches).toBe(12);
			expect(variant.naiveAttackValidation.mismatches).toBe(12);
			expect(variant.naiveAttackValidation.firstFailure).toContain("direct.frozen.duplicate");
			expect(variant.codeSha256).toMatch(/^[a-f0-9]{64}$/);
			expect(variant.ownerOracleSha256).not.toBe(variant.codeSha256);
			expect(variant.codeBytes).toBeGreaterThan(0);
			expect(variant.attackInstallationResources).toHaveLength(12);
		}
		expect(report.variants[1]!.codeBytes).toBeLessThan(report.variants[0]!.codeBytes);
		const vm = report.variants[2]!;
		expect(vm.id).toBe("current-vm-max");
		expect(vm.compilerOptions).toEqual({ preset: "max", debugProtection: false });
		expect(vm.protectedCoverageEstablished).toBe(false);
		if (vm.functionalBaseline) {
			expect(vm.correctness.status).toBe("pass");
			expect(vm.compilerWarnings).toHaveLength(0);
			expect(vm.attackValidation.status).toBe("pass");
			expect(vm.naiveAttackValidation.status).toBe("mismatch");
		}
		expect(report.harnessSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(report).toMatchObject({ admittedCompleteRoot: false, claimsSecurityAdvantage: false, actualAiTrial: false, standaloneRecovery: false, a1Artifact: false });
		expect(report.attacker).toMatchObject({ reusesOriginalArtifact: true, removedImplementationMachinery: false, oracleQueries: 0,
			evaluationModelTokens: 0, analystWorkSeconds: null, authoringModelTokens: null });
		expect(report.corpus.visibility).toContain("not hidden");
		expect(() => JSON.stringify(report)).not.toThrow();
	}, 30_000);
});
