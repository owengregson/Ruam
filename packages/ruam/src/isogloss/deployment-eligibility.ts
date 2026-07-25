/**
 * Conservative deployment-profile eligibility for protected Isogloss regions.
 *
 * This is an owner/compiler gate. It prevents a remote custody profile from
 * silently changing a synchronous API or adding a new suspension point to an
 * async function. A remote relation is eligible only when it composes into an
 * already-observable remote await contract.
 *
 * @module isogloss/deployment-eligibility
 */

export type IsoglossDeploymentProfile =
	| "holographic-local"
	| "holographic-custodied"
	| "holographic-private"
	| "holographic-tee";

export type IsoglossCustodyBoundary =
	| "none"
	| "existing-remote-await"
	| "in-process-attested";

export type IsoglossEligibilityBlocker =
	| "NO_PROTECTED_REGION"
	| "MISSING_EXACT_DOMAIN_PROOF"
	| "REMOTE_BOUNDARY_WOULD_CHANGE_SCHEDULING"
	| "MISSING_CUSTODIAN"
	| "MISSING_PRIVATE_FUNCTION_PROTOCOL"
	| "MISSING_ATTESTED_EXECUTION"
	| "UNSUPPORTED_GENERATOR_CUSTODY"
	| "LOCAL_FALLBACK_FORBIDDEN";

export interface IsoglossDeploymentEligibilityRequest {
	readonly profile: IsoglossDeploymentProfile;
	readonly protectedRegionCount: number;
	readonly hasExactDomainProof: boolean;
	readonly isGenerator: boolean;
	readonly boundary: IsoglossCustodyBoundary;
	readonly custodianAvailable?: boolean;
	readonly privateFunctionProtocolAvailable?: boolean;
	readonly attestedExecutionAvailable?: boolean;
	/**
	 * Maximum profiles must not carry a complete local relation for outage or
	 * development fallback.
	 */
	readonly completeLocalFallbackPresent?: boolean;
}

export interface IsoglossDeploymentEligibility {
	readonly profile: IsoglossDeploymentProfile;
	readonly eligible: boolean;
	readonly blockers: readonly IsoglossEligibilityBlocker[];
	readonly clientCompleteness:
		| "complete"
		| "incomplete-under-custodian"
		| "incomplete-under-private-protocol"
		| "incomplete-under-attestation";
	readonly schedulingContract:
		| "no-new-suspension"
		| "existing-remote-await-only"
		| "in-process-attested-call";
	readonly fallbackPolicy:
		| "not-applicable"
		| "no-complete-local-fallback";
	readonly securityClaim:
		| "client-side-analysis-amplification-only"
		| "client-internal-relation-incomplete"
		| "client-and-custodian-input-separation"
		| "hardware-isolation-dependent";
}

export function assessIsoglossDeploymentEligibility(
	request: IsoglossDeploymentEligibilityRequest
): IsoglossDeploymentEligibility {
	validateRequest(request);
	const blockers: IsoglossEligibilityBlocker[] = [];
	if (request.protectedRegionCount === 0) {
		blockers.push("NO_PROTECTED_REGION");
	}
	if (!request.hasExactDomainProof) {
		blockers.push("MISSING_EXACT_DOMAIN_PROOF");
	}

	switch (request.profile) {
		case "holographic-local":
			return result(request.profile, blockers, {
				clientCompleteness: "complete",
				schedulingContract: "no-new-suspension",
				fallbackPolicy: "not-applicable",
				securityClaim: "client-side-analysis-amplification-only",
			});

		case "holographic-custodied":
			requireRemoteCustody(request, blockers);
			if (!request.custodianAvailable) {
				blockers.push("MISSING_CUSTODIAN");
			}
			return result(request.profile, blockers, {
				clientCompleteness: "incomplete-under-custodian",
				schedulingContract: "existing-remote-await-only",
				fallbackPolicy: "no-complete-local-fallback",
				securityClaim: "client-internal-relation-incomplete",
			});

		case "holographic-private":
			requireRemoteCustody(request, blockers);
			if (!request.custodianAvailable) {
				blockers.push("MISSING_CUSTODIAN");
			}
			if (!request.privateFunctionProtocolAvailable) {
				blockers.push("MISSING_PRIVATE_FUNCTION_PROTOCOL");
			}
			return result(request.profile, blockers, {
				clientCompleteness: "incomplete-under-private-protocol",
				schedulingContract: "existing-remote-await-only",
				fallbackPolicy: "no-complete-local-fallback",
				securityClaim: "client-and-custodian-input-separation",
			});

		case "holographic-tee":
			if (
				request.boundary !== "in-process-attested" ||
				!request.attestedExecutionAvailable
			) {
				blockers.push("MISSING_ATTESTED_EXECUTION");
			}
			if (request.completeLocalFallbackPresent) {
				blockers.push("LOCAL_FALLBACK_FORBIDDEN");
			}
			return result(request.profile, blockers, {
				clientCompleteness: "incomplete-under-attestation",
				schedulingContract: "in-process-attested-call",
				fallbackPolicy: "no-complete-local-fallback",
				securityClaim: "hardware-isolation-dependent",
			});
	}
}

function requireRemoteCustody(
	request: IsoglossDeploymentEligibilityRequest,
	blockers: IsoglossEligibilityBlocker[]
): void {
	if (request.isGenerator) {
		blockers.push("UNSUPPORTED_GENERATOR_CUSTODY");
	}
	if (request.boundary !== "existing-remote-await") {
		blockers.push("REMOTE_BOUNDARY_WOULD_CHANGE_SCHEDULING");
	}
	if (request.completeLocalFallbackPresent) {
		blockers.push("LOCAL_FALLBACK_FORBIDDEN");
	}
}

function result(
	profile: IsoglossDeploymentProfile,
	blockers: IsoglossEligibilityBlocker[],
	claims: Omit<
		IsoglossDeploymentEligibility,
		"profile" | "eligible" | "blockers"
	>
): IsoglossDeploymentEligibility {
	return Object.freeze({
		profile,
		eligible: blockers.length === 0,
		blockers: Object.freeze(blockers),
		...claims,
	});
}

function validateRequest(
	request: IsoglossDeploymentEligibilityRequest
): void {
	if (
		!Number.isSafeInteger(request.protectedRegionCount) ||
		request.protectedRegionCount < 0
	) {
		throw new Error(
			"RUAM_ISOGLOSS_ELIGIBILITY_INVALID_REGION_COUNT"
		);
	}
}
