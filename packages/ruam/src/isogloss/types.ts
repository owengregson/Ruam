/**
 * Frozen build-side schemas for Isogloss product planning.
 *
 * Owner plans may retain compiler contracts, generated relations, and secret
 * material. Client manifests are a separate, JSON-serializable type and never
 * contain compiler lowering contracts or owner secrets.
 *
 * @module isogloss/types
 */

import type {
	CanonicalCallGraphInventory,
} from "../compiler/call-graph.js";
import type {
	MaximumCustodyLearnabilityDecision,
	PureRegionLearnabilityAnalysis,
} from "../compiler/pure-region-learnability.js";
import type { LoweredPureRegionContract } from "../compiler/pure-region-lowering.js";
import type {
	BprfArtifact,
	BprfGenerationOptions,
	PureRegionContract,
} from "./bprf/index.js";
import type {
	IsoglossCustodyBoundary,
	IsoglossDeploymentEligibility,
	IsoglossDeploymentProfile,
} from "./deployment-eligibility.js";

export const ISOGLOSS_PRODUCT_POLICY_FORMAT =
	"ruam-isogloss-product-policy-1" as const;
export const ISOGLOSS_CLIENT_MANIFEST_FORMAT =
	"ruam-isogloss-client-manifest-1" as const;
export const ISOGLOSS_ELIGIBILITY_CERTIFICATE_FORMAT =
	"ruam-isogloss-eligibility-certificate-1" as const;
export const ISOGLOSS_OWNER_PLAN_FORMAT =
	"ruam-isogloss-owner-plan-1" as const;

export type IsoglossTranscriptBucket = 4 | 8 | 16 | 32;

export interface IsoglossProductPolicy {
	readonly format: typeof ISOGLOSS_PRODUCT_POLICY_FORMAT;
	readonly allowedProfiles: readonly IsoglossDeploymentProfile[];
	/**
	 * Reject only when a constructive exact attack is strictly cheaper.
	 * Equality is an explicit policy tie and is admitted.
	 */
	readonly minimumExactAttackQueries: bigint;
	readonly stateWidth: number;
	/** Required for every non-local profile and forbidden for local mode. */
	readonly transcriptBucket: IsoglossTranscriptBucket | null;
	readonly bprf: Readonly<BprfGenerationOptions>;
}

/** Capabilities available in the selected build/deployment environment. */
export interface IsoglossProfileCapabilities {
	readonly supportedProfiles: readonly IsoglossDeploymentProfile[];
	readonly supportedTranscriptBuckets: readonly IsoglossTranscriptBucket[];
	readonly custodianAvailable: boolean;
	readonly privateFunctionProtocolAvailable: boolean;
	readonly attestedExecutionAvailable: boolean;
}

/** Raw owner values never accepted by the client-manifest constructor. */
export interface IsoglossOwnerSecrets {
	readonly placementSecret?: string;
	readonly relationSecret?: string;
}

export type IsoglossPureInputDomain =
	| { readonly type: "boolean" }
	| {
			readonly type: "number";
			readonly min: number;
			readonly max: number;
	  };

/**
 * The AST-native source path uses `pure-contract`; `lowered-contract` remains
 * an adapter for the canonical compiler path.
 */
export type IsoglossPureRegionSource =
	| {
			readonly kind: "lowered-contract";
			readonly lowered: LoweredPureRegionContract;
	  }
	| {
			readonly kind: "pure-contract";
			readonly id: string;
			readonly contract: PureRegionContract;
			readonly inputDomains: readonly IsoglossPureInputDomain[];
			/** Real stages which must fit the fixed transcript bucket. */
			readonly protectedStageCount: number;
	  };

export interface IsoglossCanonicalCallGraphEvidence {
	readonly evidence: "canonical-call-graph";
	readonly inventory: CanonicalCallGraphInventory;
	readonly protectedUnitIds: readonly string[];
}

/**
 * Frozen source-lowering evidence for AST-native expressions. Every field is
 * positive proof; omission or false values fail closed.
 */
export interface IsoglossSourceExpressionCallRiskEvidence {
	readonly format: "ruam-isogloss-source-call-risk-1";
	readonly evidence: "source-expression-structural-proof";
	readonly proofId: string;
	readonly noCalls: true;
	readonly noEffects: true;
	readonly noReentrancy: true;
	readonly noInterproceduralBoundaries: true;
	readonly noRecursiveOrFissionScc: true;
}

export type IsoglossMacroregionCallEvidence =
	| IsoglossCanonicalCallGraphEvidence
	| IsoglossSourceExpressionCallRiskEvidence;

export interface IsoglossProductPlanRequest {
	readonly region: IsoglossPureRegionSource;
	readonly callEvidence: IsoglossMacroregionCallEvidence;
	readonly profile: IsoglossDeploymentProfile;
	readonly boundary: IsoglossCustodyBoundary;
	readonly isGenerator: boolean;
	readonly completeLocalFallbackPresent: boolean;
	readonly policy: IsoglossProductPolicy;
	readonly capabilities: IsoglossProfileCapabilities;
	readonly ownerSecrets?: IsoglossOwnerSecrets;
}

export type IsoglossPlanBlockerCode =
	| "INCOMPLETE_DOMAIN_PROOF"
	| "INCOMPLETE_LEARNABILITY_ANALYSIS"
	| "NO_CONSTRUCTIVE_EXACT_ATTACK_BOUND"
	| "CHEAP_KNOWN_EXACT_ATTACK"
	| "PROFILE_FORBIDDEN_BY_POLICY"
	| "UNSUPPORTED_PROFILE_CAPABILITY"
	| "UNSUPPORTED_TRANSCRIPT_BUCKET"
	| "TRANSCRIPT_BUCKET_TOO_SMALL"
	| "MISSING_OWNER_PLACEMENT_SECRET"
	| "MISSING_OWNER_RELATION_SECRET"
	| "LOCAL_OWNER_SECRETS_FORBIDDEN"
	| "INCOMPLETE_CALL_GRAPH_PROOF"
	| "UNRESOLVED_CALL_BOUNDARY"
	| "REENTRANT_CALL_BOUNDARY"
	| "INTERPROCEDURAL_CALL_BOUNDARY"
	| "RECURSIVE_OR_FISSION_SCC"
	| "DEPLOYMENT_INELIGIBLE";

export interface IsoglossPlanBlocker {
	readonly code: IsoglossPlanBlockerCode;
	readonly detail: string;
}

export interface IsoglossMacroregionCallRisk {
	readonly evidence:
		| "canonical-call-graph"
		| "source-expression-structural-proof";
	readonly proofComplete: boolean;
	readonly protectedUnitIds: readonly string[];
	readonly unresolvedBoundaryIds: readonly string[];
	readonly reentrantBoundaryIds: readonly string[];
	readonly interproceduralEdgeIds: readonly string[];
	readonly recursiveOrFissionSccIds: readonly string[];
}

export interface IsoglossPlanningAssessment {
	readonly learnability: PureRegionLearnabilityAnalysis;
	readonly learnabilityDecision: MaximumCustodyLearnabilityDecision;
	readonly deployment: IsoglossDeploymentEligibility;
	readonly callRisk: IsoglossMacroregionCallRisk;
	readonly exactDomainProofComplete: boolean;
	readonly hardnessLowerBound: null;
}

export interface IsoglossSerializedAttackBound {
	readonly method: "input-enumeration" | "dense-interpolation" | "tied";
	readonly queries: string;
}

/**
 * Serializable non-claim. `hardnessLowerBound` is always null: an admitted
 * query threshold never becomes a resistance claim.
 */
export interface IsoglossClientLearnabilitySummary {
	readonly minimumExactAttackQueries: string;
	readonly cheapestKnownExactAttack: IsoglossSerializedAttackBound | null;
	readonly thresholdTieAccepted: boolean;
	readonly boundInterpretation: "constructive-exact-attack-upper-bound";
	readonly hardnessLowerBound: null;
	readonly nonClaim: string;
}

export interface IsoglossTranscriptClass {
	readonly id: string;
	readonly width: number;
	readonly epochCount: IsoglossTranscriptBucket;
	readonly coverCount: number;
}

export type IsoglossClientExecution =
	| {
			readonly mode: "local-bprf";
			readonly clientComplete: true;
			readonly localFallback: "not-applicable";
			readonly artifact: BprfArtifact;
	  }
	| {
			readonly mode:
				| "masked-custody"
				| "private-function-custody"
				| "attested-execution";
			readonly clientComplete: false;
			readonly localFallback: "forbidden";
			readonly ownerArtifactDigest: string;
			readonly transcript: IsoglossTranscriptClass;
	  };

export interface IsoglossClientManifest {
	readonly format: typeof ISOGLOSS_CLIENT_MANIFEST_FORMAT;
	readonly planDigest: string;
	readonly certificateDigest: string;
	readonly regionCommitment: string;
	readonly profile: IsoglossDeploymentProfile;
	readonly clientCompleteness:
		IsoglossDeploymentEligibility["clientCompleteness"];
	readonly schedulingContract:
		IsoglossDeploymentEligibility["schedulingContract"];
	readonly fallbackPolicy:
		IsoglossDeploymentEligibility["fallbackPolicy"];
	readonly securityClaim: IsoglossDeploymentEligibility["securityClaim"];
	readonly learnability: IsoglossClientLearnabilitySummary;
	readonly execution: IsoglossClientExecution;
}

export interface IsoglossEligibilityCertificate {
	readonly format: typeof ISOGLOSS_ELIGIBILITY_CERTIFICATE_FORMAT;
	readonly certificateDigest: string;
	readonly eligible: true;
	readonly profile: IsoglossDeploymentProfile;
	readonly policyDigest: string;
	readonly regionCommitment: string;
	readonly ownerArtifactDigest: string;
	readonly learnability: IsoglossClientLearnabilitySummary;
	readonly deployment: IsoglossDeploymentEligibility;
	readonly callRisk: IsoglossMacroregionCallRisk;
	readonly hardnessLowerBound: null;
	readonly nonClaim: string;
}

export interface IsoglossOwnerMaterial {
	readonly regionSource: IsoglossPureRegionSource;
	readonly bprfArtifact: BprfArtifact;
	readonly ownerSecrets: {
		readonly placementSecret: string | null;
		readonly relationSecret: string | null;
	};
	readonly transcript: IsoglossTranscriptClass | null;
}

/** Never serialize this object as a client artifact. */
export interface IsoglossOwnerBuildPlan {
	readonly format: typeof ISOGLOSS_OWNER_PLAN_FORMAT;
	readonly planDigest: string;
	readonly certificateDigest: string;
	readonly policyDigest: string;
	readonly ownerMaterialDigest: string;
	readonly assessment: IsoglossPlanningAssessment;
	readonly certificate: IsoglossEligibilityCertificate;
	readonly ownerMaterial: IsoglossOwnerMaterial;
}

export interface IsoglossEligibleProductPlan {
	readonly decision: "eligible";
	readonly blockers: readonly [];
	readonly assessment: IsoglossPlanningAssessment;
	readonly ownerPlan: IsoglossOwnerBuildPlan;
	readonly clientManifest: IsoglossClientManifest;
}

export interface IsoglossRejectedProductPlan {
	readonly decision: "rejected";
	readonly blockers: readonly IsoglossPlanBlocker[];
	readonly assessment: IsoglossPlanningAssessment;
	readonly ownerPlan: null;
	readonly clientManifest: null;
}

export type IsoglossProductPlanResult =
	| IsoglossEligibleProductPlan
	| IsoglossRejectedProductPlan;
