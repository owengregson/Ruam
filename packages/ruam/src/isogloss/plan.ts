/**
 * Fail-closed owner/compiler product planning for Isogloss.
 *
 * This module consumes only production analyses and generators. Testing
 * evaluators and reference custodians are deliberately absent from the build
 * schema dependency graph.
 *
 * @module isogloss/plan
 */

import { createHash } from "node:crypto";
import type {
	CanonicalCallBoundary,
	CanonicalCallGraphInventory,
	CanonicalDirectCallEdge,
} from "../compiler/call-graph.js";
import {
	analyzePureRegionLearnability,
	assessMaximumCustodyLearnability,
	PURE_REGION_LEARNABILITY_NON_CLAIM,
} from "../compiler/pure-region-learnability.js";
import {
	generateBprfArtifact,
	type PureRegionContract,
} from "./bprf/index.js";
import {
	MASKED_CUSTODY_TRANSCRIPT_BUCKETS,
} from "./csh/transcript-buckets.js";
import {
	assessIsoglossDeploymentEligibility,
	type IsoglossDeploymentProfile,
} from "./deployment-eligibility.js";
import {
	ISOGLOSS_CLIENT_MANIFEST_FORMAT,
	ISOGLOSS_ELIGIBILITY_CERTIFICATE_FORMAT,
	ISOGLOSS_OWNER_PLAN_FORMAT,
	ISOGLOSS_PRODUCT_POLICY_FORMAT,
	type IsoglossClientExecution,
	type IsoglossClientLearnabilitySummary,
	type IsoglossClientManifest,
	type IsoglossEligibilityCertificate,
	type IsoglossMacroregionCallEvidence,
	type IsoglossMacroregionCallRisk,
	type IsoglossOwnerBuildPlan,
	type IsoglossOwnerMaterial,
	type IsoglossPlanBlocker,
	type IsoglossPlanningAssessment,
	type IsoglossProductPlanRequest,
	type IsoglossProductPlanResult,
	type IsoglossPureRegionSource,
	type IsoglossSourceExpressionCallRiskEvidence,
	type IsoglossTranscriptBucket,
	type IsoglossTranscriptClass,
} from "./types.js";

const PROFILE_ORDER: readonly IsoglossDeploymentProfile[] = Object.freeze([
	"holographic-local",
	"holographic-custodied",
	"holographic-private",
	"holographic-tee",
]);
const PROTECTED_PROFILES: ReadonlySet<IsoglossDeploymentProfile> = new Set([
	"holographic-custodied",
	"holographic-private",
	"holographic-tee",
]);
const BOUNDARIES = Object.freeze([
	"none",
	"existing-remote-await",
	"in-process-attested",
] as const);

interface NormalizedRegion {
	readonly id: string;
	readonly contract: PureRegionContract;
	readonly protectedStageCount: number;
	readonly source: IsoglossPureRegionSource;
	readonly commitment: Readonly<Record<string, unknown>>;
}

/**
 * Build an owner plan and client manifest only after every proof and policy
 * gate admits the macroregion. Rejected results carry neither artifact.
 */
export function planIsoglossProduct(
	request: IsoglossProductPlanRequest
): IsoglossProductPlanResult {
	validateRequest(request);
	const region = normalizeRegion(request.region);
	const learnability =
		request.region.kind === "lowered-contract"
			? analyzePureRegionLearnability(request.region.lowered)
			: analyzePureRegionLearnability(
					request.region.contract,
					request.region.inputDomains
				);
	const learnabilityDecision = assessMaximumCustodyLearnability(
		learnability,
		{
			minimumExactAttackQueries:
				request.policy.minimumExactAttackQueries,
		}
	);
	const exactDomainProofComplete =
		learnability.issues.length === 0 &&
		learnability.inputDomains.length ===
			region.contract.inputs.length &&
		learnability.inputDomains.every(
			(input) => input.domain !== null && input.cardinality !== null
		);
	const deployment = assessIsoglossDeploymentEligibility({
		profile: request.profile,
		protectedRegionCount: 1,
		hasExactDomainProof: exactDomainProofComplete,
		isGenerator: request.isGenerator,
		boundary: request.boundary,
		custodianAvailable: request.capabilities.custodianAvailable,
		privateFunctionProtocolAvailable:
			request.capabilities.privateFunctionProtocolAvailable,
		attestedExecutionAvailable:
			request.capabilities.attestedExecutionAvailable,
		completeLocalFallbackPresent:
			request.completeLocalFallbackPresent,
	});
	const callRisk = assessCallEvidence(request.callEvidence, region.id);
	const assessment: IsoglossPlanningAssessment = deepFreeze({
		learnability,
		learnabilityDecision,
		deployment,
		callRisk,
		exactDomainProofComplete,
		hardnessLowerBound: null,
	});
	const blockers = collectBlockers(request, assessment, region);
	if (blockers.length > 0) {
		return deepFreeze({
			decision: "rejected",
			blockers,
			assessment,
			ownerPlan: null,
			clientManifest: null,
		});
	}

	const bprfArtifact = generateBprfArtifact(
		region.contract,
		request.policy.bprf
	);
	const transcript = createTranscriptClass(request);
	const policyDigest = digestCanonical(request.policy);
	const regionCommitment = digestCanonical({
		region: region.commitment,
		callEvidence: {
			evidence: request.callEvidence.evidence,
			digest: digestCanonical(request.callEvidence),
		},
	});
	const ownerArtifactDigest = digestCanonical(bprfArtifact);
	const learnabilitySummary = createLearnabilitySummary(request, assessment);
	const certificateBody = {
		format: ISOGLOSS_ELIGIBILITY_CERTIFICATE_FORMAT,
		eligible: true as const,
		profile: request.profile,
		policyDigest,
		regionCommitment,
		ownerArtifactDigest,
		learnability: learnabilitySummary,
		deployment,
		callRisk,
		hardnessLowerBound: null,
		nonClaim: PURE_REGION_LEARNABILITY_NON_CLAIM,
	};
	const certificateDigest = digestCanonical(certificateBody);
	const certificate: IsoglossEligibilityCertificate = deepFreeze({
		...certificateBody,
		certificateDigest,
	});
	const ownerSecrets = {
		placementSecret:
			request.ownerSecrets?.placementSecret ?? null,
		relationSecret:
			request.ownerSecrets?.relationSecret ?? null,
	};
	const ownerMaterial: IsoglossOwnerMaterial = deepFreeze({
		regionSource: cloneValue(region.source),
		bprfArtifact: cloneValue(bprfArtifact),
		ownerSecrets,
		transcript,
	});
	const ownerMaterialDigest = digestCanonical(ownerMaterial);
	const execution = createClientExecution(
		request.profile,
		bprfArtifact,
		ownerArtifactDigest,
		transcript
	);
	const manifestBody = {
		format: ISOGLOSS_CLIENT_MANIFEST_FORMAT,
		certificateDigest,
		regionCommitment,
		profile: request.profile,
		clientCompleteness: deployment.clientCompleteness,
		schedulingContract: deployment.schedulingContract,
		fallbackPolicy: deployment.fallbackPolicy,
		securityClaim: deployment.securityClaim,
		learnability: learnabilitySummary,
		execution,
	};
	const planDigest = digestCanonical({
		certificateDigest,
		manifest: manifestBody,
	});
	const clientManifest: IsoglossClientManifest = deepFreeze({
		...manifestBody,
		planDigest,
	});
	assertClientManifestSerializable(clientManifest);
	const ownerPlan: IsoglossOwnerBuildPlan = deepFreeze({
		format: ISOGLOSS_OWNER_PLAN_FORMAT,
		planDigest,
		certificateDigest,
		policyDigest,
		ownerMaterialDigest,
		assessment,
		certificate,
		ownerMaterial,
	});
	return deepFreeze({
		decision: "eligible",
		blockers: Object.freeze([]) as readonly [],
		assessment,
		ownerPlan,
		clientManifest,
	});
}

/**
 * Construct the only accepted AST-native call-risk proof. The returned object
 * is deeply frozen so callers cannot alter the proof after eligibility is
 * assessed.
 */
export function createSourceExpressionMacroregionCallRiskEvidence(
	input: Omit<
		IsoglossSourceExpressionCallRiskEvidence,
		"format" | "evidence"
	>
): IsoglossSourceExpressionCallRiskEvidence {
	if (
		!input ||
		typeof input !== "object" ||
		typeof input.proofId !== "string" ||
		input.proofId.length === 0 ||
		input.noCalls !== true ||
		input.noEffects !== true ||
		input.noReentrancy !== true ||
		input.noInterproceduralBoundaries !== true ||
		input.noRecursiveOrFissionScc !== true
	) {
		throw new Error(
			"RUAM_ISOGLOSS_PLAN_INVALID_SOURCE_EXPRESSION_PROOF"
		);
	}
	return deepFreeze({
		format: "ruam-isogloss-source-call-risk-1",
		evidence: "source-expression-structural-proof",
		proofId: input.proofId,
		noCalls: input.noCalls,
		noEffects: input.noEffects,
		noReentrancy: input.noReentrancy,
		noInterproceduralBoundaries:
			input.noInterproceduralBoundaries,
		noRecursiveOrFissionScc: input.noRecursiveOrFissionScc,
	});
}

function normalizeRegion(
	source: IsoglossPureRegionSource
): NormalizedRegion {
	if (source.kind === "lowered-contract") {
		return {
			id: source.lowered.unitId,
			contract: source.lowered.contract,
			protectedStageCount: source.lowered.contract.steps.length,
			source,
			commitment: {
				kind: source.kind,
				unitId: source.lowered.unitId,
				regionIds: [...source.lowered.regionIds],
				protectedStageCount:
					source.lowered.contract.steps.length,
				contractDigest: digestCanonical(
					source.lowered.contract
				),
			},
		};
	}
	return {
		id: source.id,
		contract: source.contract,
		protectedStageCount: source.protectedStageCount,
		source,
		commitment: {
			kind: source.kind,
			id: source.id,
			protectedStageCount: source.protectedStageCount,
			contractDigest: digestCanonical(source.contract),
			inputDomainsDigest: digestCanonical(source.inputDomains),
		},
	};
}

function assessCallEvidence(
	callEvidence: IsoglossMacroregionCallEvidence,
	regionId: string
): IsoglossMacroregionCallRisk {
	if (callEvidence.evidence === "canonical-call-graph") {
		return deriveIsoglossMacroregionCallRisk(
			callEvidence.inventory,
			callEvidence.protectedUnitIds,
			regionId
		);
	}

	const evidence = callEvidence as unknown as Record<string, unknown>;
	const noCalls = evidence.noCalls === true;
	const noEffects = evidence.noEffects === true;
	const noReentrancy = evidence.noReentrancy === true;
	const noInterproceduralBoundaries =
		evidence.noInterproceduralBoundaries === true;
	const noRecursiveOrFissionScc =
		evidence.noRecursiveOrFissionScc === true;
	const exactProofSchema =
		Object.getOwnPropertySymbols(evidence).length === 0 &&
		Object.getOwnPropertyNames(evidence)
			.sort(compareStrings)
			.join(",") ===
		[
			"evidence",
			"format",
			"noCalls",
			"noEffects",
			"noInterproceduralBoundaries",
			"noRecursiveOrFissionScc",
			"noReentrancy",
			"proofId",
		].join(",");
	const proofComplete =
		Object.isFrozen(callEvidence) &&
		exactProofSchema &&
		evidence.format === "ruam-isogloss-source-call-risk-1" &&
		typeof evidence.proofId === "string" &&
		evidence.proofId.length > 0 &&
		noCalls &&
		noEffects &&
		noReentrancy &&
		noInterproceduralBoundaries &&
		noRecursiveOrFissionScc;
	return deepFreeze({
		evidence: "source-expression-structural-proof",
		proofComplete,
		protectedUnitIds: [regionId],
		unresolvedBoundaryIds: [
			...(noCalls
				? []
				: ["source-proof:calls-not-proven-absent"]),
			...(noEffects
				? []
				: ["source-proof:effects-not-proven-absent"]),
		],
		reentrantBoundaryIds: noReentrancy
			? []
			: ["source-proof:reentrancy-not-proven-absent"],
		interproceduralEdgeIds: noInterproceduralBoundaries
			? []
			: ["source-proof:interprocedural-not-proven-absent"],
		recursiveOrFissionSccIds: noRecursiveOrFissionScc
			? []
			: ["source-proof:scc-risk-not-proven-absent"],
	});
}

/** Derive only facts touching the protected macroregion. */
export function deriveIsoglossMacroregionCallRisk(
	inventory: CanonicalCallGraphInventory,
	protectedUnitIds: readonly string[],
	loweredUnitId: string
): IsoglossMacroregionCallRisk {
	const protectedSet = new Set(protectedUnitIds);
	const graphUnits = new Set(inventory.unitIds);
	const proofComplete =
		inventory.targetPolicy.mode === "canonical-evidence-only" &&
		protectedSet.has(loweredUnitId) &&
		[...protectedSet].every(
			(unitId) =>
				graphUnits.has(unitId) &&
				inventory.sccs.filter((scc) =>
					scc.unitIds.includes(unitId)
				).length === 1
		);
	const protectedBoundaries = inventory.boundaries.filter((boundary) =>
		protectedSet.has(boundary.unitId)
	);
	const unresolvedBoundaryIds = protectedBoundaries
		.filter(
			(boundary) =>
				boundary.resolution.kind === "indirect-or-external"
		)
		.map(boundaryId)
		.sort(compareStrings);
	const reentrantBoundaryIds = protectedBoundaries
		.filter(
			(boundary) =>
				boundary.observability.mayReenterRootGroup
		)
		.map(boundaryId)
		.sort(compareStrings);
	const interproceduralEdgeIds = inventory.directEdges
		.filter(
			(edge) =>
				edge.unitId !== edge.targetUnitId &&
				(protectedSet.has(edge.unitId) ||
					protectedSet.has(edge.targetUnitId))
		)
		.map(edgeId)
		.sort(compareStrings);
	const recursiveOrFissionSccIds = inventory.sccs
		.filter(
			(scc) =>
				scc.unitIds.some((unitId) => protectedSet.has(unitId)) &&
				(scc.isRecursive ||
					scc.hasUnresolvedRecursionRisk ||
					scc.hasUnresolvedMutualRecursionRisk ||
					scc.reentrancyRelevant ||
					scc.requiresInterproceduralFission)
		)
		.map((scc) => scc.id)
		.sort(compareStrings);
	return deepFreeze({
		evidence: "canonical-call-graph",
		proofComplete,
		protectedUnitIds: [...protectedSet].sort(compareStrings),
		unresolvedBoundaryIds,
		reentrantBoundaryIds,
		interproceduralEdgeIds,
		recursiveOrFissionSccIds,
	});
}

/**
 * Canonical JSON-compatible serialization used for build and certificate
 * digests. BigInts receive an explicit tagged representation.
 */
export function canonicalSerializeIsoglossBuildValue(value: unknown): string {
	const active = new Set<object>();
	const serialize = (current: unknown): string => {
		if (current === null) return "null";
		switch (typeof current) {
			case "string":
			case "boolean":
				return JSON.stringify(current);
			case "number":
				if (!Number.isFinite(current)) {
					throw new Error(
						"RUAM_ISOGLOSS_CANONICAL_NONFINITE_NUMBER"
					);
				}
				return JSON.stringify(
					Object.is(current, -0) ? 0 : current
				);
			case "bigint":
				return `{"$bigint":${JSON.stringify(String(current))}}`;
			case "object": {
				if (active.has(current)) {
					throw new Error(
						"RUAM_ISOGLOSS_CANONICAL_CYCLE"
					);
				}
				active.add(current);
				let serialized: string;
				if (Array.isArray(current)) {
					if (
						!current.every((_, index) =>
							Object.hasOwn(current, index)
						) ||
						!arrayHasEveryIndex(current) ||
						Object.keys(current).length !== current.length
					) {
						throw new Error(
							"RUAM_ISOGLOSS_CANONICAL_SPARSE_ARRAY"
						);
					}
					serialized = `[${current
						.map((entry) => serialize(entry))
						.join(",")}]`;
				} else {
					const prototype = Object.getPrototypeOf(current);
					if (
						prototype !== Object.prototype &&
						prototype !== null
					) {
						throw new Error(
							"RUAM_ISOGLOSS_CANONICAL_NON_PLAIN_OBJECT"
						);
					}
					const record = current as Record<string, unknown>;
					const keys = Object.keys(record).sort(compareStrings);
					if (Reflect.ownKeys(record).length !== keys.length) {
						throw new Error(
							"RUAM_ISOGLOSS_CANONICAL_HIDDEN_PROPERTY"
						);
					}
					for (const key of keys) {
						if (record[key] === undefined) {
							throw new Error(
								"RUAM_ISOGLOSS_CANONICAL_UNDEFINED"
							);
						}
					}
					serialized = `{${keys
						.map(
							(key) =>
								`${JSON.stringify(key)}:${serialize(record[key])}`
						)
						.join(",")}}`;
				}
				active.delete(current);
				return serialized;
			}
			default:
				throw new Error(
					"RUAM_ISOGLOSS_CANONICAL_UNSUPPORTED_VALUE"
				);
		}
	};
	return serialize(value);
}

export function digestCanonicalIsoglossBuildValue(value: unknown): string {
	return digestCanonical(value);
}

function collectBlockers(
	request: IsoglossProductPlanRequest,
	assessment: IsoglossPlanningAssessment,
	region: NormalizedRegion
): IsoglossPlanBlocker[] {
	const blockers: IsoglossPlanBlocker[] = [];
	const add = (
		code: IsoglossPlanBlocker["code"],
		detail: string
	): void => {
		if (
			!blockers.some(
				(blocker) =>
					blocker.code === code && blocker.detail === detail
			)
		) {
			blockers.push(Object.freeze({ code, detail }));
		}
	};

	if (!assessment.exactDomainProofComplete) {
		add("INCOMPLETE_DOMAIN_PROOF", region.id);
	}
	if (assessment.learnability.issues.length > 0) {
		add(
			"INCOMPLETE_LEARNABILITY_ANALYSIS",
			assessment.learnability.issues
				.map((issue) => issue.code)
				.join(",")
		);
	}
	for (const reason of assessment.learnabilityDecision.reasons) {
		if (
			reason.code ===
			"RUAM_PURE_REGION_MAXIMUM_CUSTODY_NO_EXACT_ATTACK_BOUND"
		) {
			add(
				"NO_CONSTRUCTIVE_EXACT_ATTACK_BOUND",
				region.id
			);
		}
		if (
			reason.code ===
			"RUAM_PURE_REGION_MAXIMUM_CUSTODY_CHEAP_EXACT_ATTACK"
		) {
			add(
				"CHEAP_KNOWN_EXACT_ATTACK",
				`${reason.method}:${reason.queries}<${reason.minimumExactAttackQueries}`
			);
		}
	}
	if (!request.policy.allowedProfiles.includes(request.profile)) {
		add("PROFILE_FORBIDDEN_BY_POLICY", request.profile);
	}
	if (!request.capabilities.supportedProfiles.includes(request.profile)) {
		add("UNSUPPORTED_PROFILE_CAPABILITY", request.profile);
	}
	if (PROTECTED_PROFILES.has(request.profile)) {
		const bucket = request.policy.transcriptBucket;
		if (
			bucket === null ||
			!request.capabilities.supportedTranscriptBuckets.includes(
				bucket
			)
		) {
			add(
				"UNSUPPORTED_TRANSCRIPT_BUCKET",
				String(bucket)
			);
		} else if (region.protectedStageCount > bucket) {
			add(
				"TRANSCRIPT_BUCKET_TOO_SMALL",
				`${region.protectedStageCount}>${bucket}`
			);
		}
		if (!validOwnerSecret(request.ownerSecrets?.placementSecret)) {
			add(
				"MISSING_OWNER_PLACEMENT_SECRET",
				request.profile
			);
		}
		if (!validOwnerSecret(request.ownerSecrets?.relationSecret)) {
			add("MISSING_OWNER_RELATION_SECRET", request.profile);
		}
	} else if (
		request.ownerSecrets?.placementSecret !== undefined ||
		request.ownerSecrets?.relationSecret !== undefined
	) {
		add("LOCAL_OWNER_SECRETS_FORBIDDEN", request.profile);
	}
	if (!assessment.callRisk.proofComplete) {
		add("INCOMPLETE_CALL_GRAPH_PROOF", region.id);
	}
	for (const id of assessment.callRisk.unresolvedBoundaryIds) {
		add("UNRESOLVED_CALL_BOUNDARY", id);
	}
	for (const id of assessment.callRisk.reentrantBoundaryIds) {
		add("REENTRANT_CALL_BOUNDARY", id);
	}
	for (const id of assessment.callRisk.interproceduralEdgeIds) {
		add("INTERPROCEDURAL_CALL_BOUNDARY", id);
	}
	for (const id of assessment.callRisk.recursiveOrFissionSccIds) {
		add("RECURSIVE_OR_FISSION_SCC", id);
	}
	for (const blocker of assessment.deployment.blockers) {
		add("DEPLOYMENT_INELIGIBLE", blocker);
	}
	return blockers;
}

function createLearnabilitySummary(
	request: IsoglossProductPlanRequest,
	assessment: IsoglossPlanningAssessment
): IsoglossClientLearnabilitySummary {
	const attack = assessment.learnability.cheapestKnownExactAttack;
	return deepFreeze({
		minimumExactAttackQueries:
			request.policy.minimumExactAttackQueries.toString(),
		cheapestKnownExactAttack: attack
			? {
					method: attack.method,
					queries: attack.queries.toString(),
				}
			: null,
		thresholdTieAccepted:
			attack?.queries ===
			request.policy.minimumExactAttackQueries,
		boundInterpretation:
			"constructive-exact-attack-upper-bound",
		hardnessLowerBound: null,
		nonClaim: PURE_REGION_LEARNABILITY_NON_CLAIM,
	});
}

function createTranscriptClass(
	request: IsoglossProductPlanRequest
): IsoglossTranscriptClass | null {
	if (request.profile === "holographic-local") return null;
	const epochCount = request.policy
		.transcriptBucket as IsoglossTranscriptBucket;
	return deepFreeze({
		id: `csh-masked-v1-w${request.policy.stateWidth}-e${epochCount}`,
		width: request.policy.stateWidth,
		epochCount,
		coverCount: epochCount + 1,
	});
}

function createClientExecution(
	profile: IsoglossDeploymentProfile,
	bprfArtifact: ReturnType<typeof generateBprfArtifact>,
	ownerArtifactDigest: string,
	transcript: IsoglossTranscriptClass | null
): IsoglossClientExecution {
	if (profile === "holographic-local") {
		return deepFreeze({
			mode: "local-bprf",
			clientComplete: true,
			localFallback: "not-applicable",
			artifact: cloneValue(bprfArtifact),
		});
	}
	if (!transcript) {
		throw new Error("RUAM_ISOGLOSS_PLAN_MISSING_TRANSCRIPT");
	}
	const mode =
		profile === "holographic-custodied"
			? "masked-custody"
			: profile === "holographic-private"
				? "private-function-custody"
				: "attested-execution";
	return deepFreeze({
		mode,
		clientComplete: false,
		localFallback: "forbidden",
		ownerArtifactDigest,
		transcript,
	});
}

function validateRequest(request: IsoglossProductPlanRequest): void {
	if (!request || typeof request !== "object") {
		throw new Error("RUAM_ISOGLOSS_PLAN_INVALID_REQUEST");
	}
	if (
		!request.region ||
		typeof request.region !== "object" ||
		(request.region.kind !== "lowered-contract" &&
			request.region.kind !== "pure-contract")
	) {
		throw new Error("RUAM_ISOGLOSS_PLAN_INVALID_REGION_SOURCE");
	}
	if (request.region.kind === "lowered-contract") {
		if (
			!request.region.lowered ||
			typeof request.region.lowered.unitId !== "string" ||
			request.region.lowered.unitId.length === 0 ||
			!Array.isArray(request.region.lowered.regionIds) ||
			request.region.lowered.regionIds.length === 0 ||
			!Array.isArray(request.region.lowered.inputBindings) ||
			!validPureContractShape(request.region.lowered.contract)
		) {
			throw new Error(
				"RUAM_ISOGLOSS_PLAN_INVALID_LOWERED_CONTRACT"
			);
		}
	} else if (
		typeof request.region.id !== "string" ||
		request.region.id.length === 0 ||
		!validPureContractShape(request.region.contract) ||
		!Array.isArray(request.region.inputDomains) ||
		!Number.isSafeInteger(request.region.protectedStageCount) ||
		request.region.protectedStageCount < 1 ||
		request.region.protectedStageCount !==
			request.region.contract.steps.length
	) {
		throw new Error("RUAM_ISOGLOSS_PLAN_INVALID_PURE_CONTRACT");
	}
	if (!PROFILE_ORDER.includes(request.profile)) {
		throw new Error("RUAM_ISOGLOSS_PLAN_INVALID_PROFILE");
	}
	if (!BOUNDARIES.includes(request.boundary)) {
		throw new Error("RUAM_ISOGLOSS_PLAN_INVALID_BOUNDARY");
	}
	if (
		!request.policy ||
		typeof request.policy !== "object" ||
		!request.capabilities ||
		typeof request.capabilities !== "object" ||
		!Array.isArray(request.policy.allowedProfiles) ||
		!request.policy.bprf ||
		typeof request.policy.bprf !== "object" ||
		!Array.isArray(request.capabilities.supportedProfiles) ||
		!Array.isArray(
			request.capabilities.supportedTranscriptBuckets
		) ||
		request.policy.format !== ISOGLOSS_PRODUCT_POLICY_FORMAT ||
		typeof request.policy.minimumExactAttackQueries !== "bigint" ||
		request.policy.minimumExactAttackQueries < 0n ||
		!Number.isSafeInteger(request.policy.stateWidth) ||
		request.policy.stateWidth < 2 ||
		!Number.isSafeInteger(request.policy.bprf.seed) ||
		request.policy.allowedProfiles.length === 0 ||
		request.policy.allowedProfiles.some(
			(profile) => !PROFILE_ORDER.includes(profile)
		) ||
		request.capabilities.supportedProfiles.some(
			(profile) => !PROFILE_ORDER.includes(profile)
		) ||
		request.capabilities.supportedTranscriptBuckets.some(
			(candidate) =>
				!MASKED_CUSTODY_TRANSCRIPT_BUCKETS.includes(candidate)
		) ||
		(request.policy.bprf.realizationCount !== undefined &&
			(!Number.isSafeInteger(
				request.policy.bprf.realizationCount
			) ||
				request.policy.bprf.realizationCount < 2)) ||
		(request.policy.bprf.fragmentCount !== undefined &&
			(!Number.isSafeInteger(request.policy.bprf.fragmentCount) ||
				request.policy.bprf.fragmentCount < 2)) ||
		typeof request.isGenerator !== "boolean" ||
		typeof request.completeLocalFallbackPresent !== "boolean" ||
		typeof request.capabilities.custodianAvailable !== "boolean" ||
		typeof request.capabilities.privateFunctionProtocolAvailable !==
			"boolean" ||
		typeof request.capabilities.attestedExecutionAvailable !==
			"boolean" ||
		hasDuplicates(request.policy.allowedProfiles) ||
		hasDuplicates(request.capabilities.supportedProfiles) ||
		hasDuplicates(request.capabilities.supportedTranscriptBuckets)
	) {
		throw new Error("RUAM_ISOGLOSS_PLAN_INVALID_POLICY");
	}
	const bucket = request.policy.transcriptBucket;
	if (
		(bucket !== null &&
			!MASKED_CUSTODY_TRANSCRIPT_BUCKETS.includes(bucket)) ||
		(request.profile === "holographic-local" && bucket !== null) ||
		(request.profile !== "holographic-local" && bucket === null)
	) {
		throw new Error("RUAM_ISOGLOSS_PLAN_INVALID_TRANSCRIPT_BUCKET");
	}
	if (
		!request.callEvidence ||
		typeof request.callEvidence !== "object" ||
		(request.callEvidence.evidence !== "canonical-call-graph" &&
			request.callEvidence.evidence !==
				"source-expression-structural-proof")
	) {
		throw new Error("RUAM_ISOGLOSS_PLAN_INVALID_CALL_EVIDENCE");
	}
	if (request.callEvidence.evidence === "canonical-call-graph") {
		const inventory = request.callEvidence.inventory;
		const protectedUnitIds =
			request.callEvidence.protectedUnitIds;
		if (
			!Array.isArray(protectedUnitIds) ||
			protectedUnitIds.length === 0 ||
			hasDuplicates(protectedUnitIds) ||
			protectedUnitIds.some(
				(unitId) =>
					typeof unitId !== "string" ||
					unitId.length === 0
			)
		) {
			throw new Error(
				"RUAM_ISOGLOSS_PLAN_INVALID_PROTECTED_UNITS"
			);
		}
		if (
			!inventory ||
			inventory.targetPolicy?.mode !==
				"canonical-evidence-only" ||
			!Array.isArray(inventory.unitIds) ||
			!Array.isArray(inventory.boundaries) ||
			!Array.isArray(inventory.directEdges) ||
			!Array.isArray(inventory.sccs)
		) {
			throw new Error("RUAM_ISOGLOSS_PLAN_INVALID_CALL_GRAPH");
		}
	}
	if (
		request.ownerSecrets !== undefined &&
		(!request.ownerSecrets ||
			typeof request.ownerSecrets !== "object" ||
			(request.ownerSecrets.placementSecret !== undefined &&
				typeof request.ownerSecrets.placementSecret !==
					"string") ||
			(request.ownerSecrets.relationSecret !== undefined &&
				typeof request.ownerSecrets.relationSecret !==
					"string"))
	) {
		throw new Error("RUAM_ISOGLOSS_PLAN_INVALID_OWNER_SECRETS");
	}
}

function validPureContractShape(
	contract: PureRegionContract | null | undefined
): contract is PureRegionContract {
	return Boolean(
		contract &&
			typeof contract === "object" &&
			Array.isArray(contract.inputs) &&
			Array.isArray(contract.steps) &&
			Array.isArray(contract.outputs)
	);
}

function assertClientManifestSerializable(
	manifest: IsoglossClientManifest
): void {
	canonicalSerializeIsoglossBuildValue(manifest);
	const serialized = JSON.stringify(manifest);
	if (
		typeof serialized !== "string" ||
		serialized.includes("[object Undefined]")
	) {
		throw new Error(
			"RUAM_ISOGLOSS_PLAN_CLIENT_MANIFEST_NOT_SERIALIZABLE"
		);
	}
}

function validOwnerSecret(value: string | undefined): boolean {
	return typeof value === "string" && value.length >= 16;
}

function boundaryId(boundary: CanonicalCallBoundary): string {
	return `${boundary.unitId}:${boundary.nodeId}`;
}

function edgeId(edge: CanonicalDirectCallEdge): string {
	return `${edge.unitId}:${edge.nodeId}->${edge.targetUnitId}`;
}

function digestCanonical(value: unknown): string {
	return createHash("sha256")
		.update(canonicalSerializeIsoglossBuildValue(value))
		.digest("hex");
}

function cloneValue<T>(value: T): T {
	return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const nested of Object.values(
			value as Record<string, unknown>
		)) {
			deepFreeze(nested);
		}
	}
	return value;
}

function hasDuplicates(values: readonly unknown[]): boolean {
	return new Set(values).size !== values.length;
}

function arrayHasEveryIndex(values: readonly unknown[]): boolean {
	for (let index = 0; index < values.length; index++) {
		if (!Object.hasOwn(values, index)) return false;
	}
	return true;
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
