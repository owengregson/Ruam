import { describe, expect, it } from "bun:test";
import {
	assessIsoglossDeploymentEligibility,
	type IsoglossDeploymentEligibilityRequest,
} from "../../src/isogloss/deployment-eligibility.js";

const base: IsoglossDeploymentEligibilityRequest = {
	profile: "holographic-local",
	protectedRegionCount: 2,
	hasExactDomainProof: true,
	isGenerator: false,
	boundary: "none",
};

describe("Isogloss deployment eligibility", () => {
	it("keeps the local profile honest about client completeness", () => {
		const result = assessIsoglossDeploymentEligibility(base);

		expect(result.eligible).toBe(true);
		expect(result.clientCompleteness).toBe("complete");
		expect(result.schedulingContract).toBe("no-new-suspension");
		expect(result.securityClaim).toBe(
			"client-side-analysis-amplification-only"
		);
	});

	it("rejects remote custody that would add a suspension boundary", () => {
		const result = assessIsoglossDeploymentEligibility({
			...base,
			profile: "holographic-custodied",
			custodianAvailable: true,
		});

		expect(result.eligible).toBe(false);
		expect(result.blockers).toEqual([
			"REMOTE_BOUNDARY_WOULD_CHANGE_SCHEDULING",
		]);
		expect(result.fallbackPolicy).toBe("no-complete-local-fallback");
	});

	it("admits custody only at an existing remote-await contract", () => {
		const result = assessIsoglossDeploymentEligibility({
			...base,
			profile: "holographic-custodied",
			boundary: "existing-remote-await",
			custodianAvailable: true,
		});

		expect(result.eligible).toBe(true);
		expect(result.blockers).toEqual([]);
		expect(result.clientCompleteness).toBe(
			"incomplete-under-custodian"
		);
		expect(result.schedulingContract).toBe(
			"existing-remote-await-only"
		);
	});

	it("requires a real private-function protocol for private custody", () => {
		const missing = assessIsoglossDeploymentEligibility({
			...base,
			profile: "holographic-private",
			boundary: "existing-remote-await",
			custodianAvailable: true,
		});
		const available = assessIsoglossDeploymentEligibility({
			...base,
			profile: "holographic-private",
			boundary: "existing-remote-await",
			custodianAvailable: true,
			privateFunctionProtocolAvailable: true,
		});

		expect(missing.eligible).toBe(false);
		expect(missing.blockers).toEqual([
			"MISSING_PRIVATE_FUNCTION_PROTOCOL",
		]);
		expect(available.eligible).toBe(true);
		expect(available.securityClaim).toBe(
			"client-and-custodian-input-separation"
		);
	});

	it("never hides missing proofs, generators, or local fallbacks", () => {
		const result = assessIsoglossDeploymentEligibility({
			...base,
			profile: "holographic-custodied",
			protectedRegionCount: 0,
			hasExactDomainProof: false,
			isGenerator: true,
			boundary: "none",
			custodianAvailable: false,
			completeLocalFallbackPresent: true,
		});

		expect(result.eligible).toBe(false);
		expect(result.blockers).toEqual([
			"NO_PROTECTED_REGION",
			"MISSING_EXACT_DOMAIN_PROOF",
			"UNSUPPORTED_GENERATOR_CUSTODY",
			"REMOTE_BOUNDARY_WOULD_CHANGE_SCHEDULING",
			"LOCAL_FALLBACK_FORBIDDEN",
			"MISSING_CUSTODIAN",
		]);
	});

	it("requires an in-process attested boundary for the TEE profile", () => {
		const missing = assessIsoglossDeploymentEligibility({
			...base,
			profile: "holographic-tee",
		});
		const available = assessIsoglossDeploymentEligibility({
			...base,
			profile: "holographic-tee",
			boundary: "in-process-attested",
			attestedExecutionAvailable: true,
		});

		expect(missing.eligible).toBe(false);
		expect(missing.blockers).toEqual(["MISSING_ATTESTED_EXECUTION"]);
		expect(available.eligible).toBe(true);
		expect(available.schedulingContract).toBe(
			"in-process-attested-call"
		);
	});

	it("fails closed on invalid planner counts", () => {
		expect(() =>
			assessIsoglossDeploymentEligibility({
				...base,
				protectedRegionCount: -1,
			})
		).toThrow("RUAM_ISOGLOSS_ELIGIBILITY_INVALID_REGION_COUNT");
	});
});
