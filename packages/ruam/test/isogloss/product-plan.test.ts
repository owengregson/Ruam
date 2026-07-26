import { describe, expect, it } from "bun:test";
import type { CanonicalCallGraphInventory } from "../../src/compiler/call-graph.js";
import type { LoweredPureRegionContract } from "../../src/compiler/pure-region-lowering.js";
import {
	canonicalSerializeIsoglossBuildValue,
	createSourceExpressionMacroregionCallRiskEvidence,
	planIsoglossProduct,
} from "../../src/isogloss/plan.js";
import {
	ISOGLOSS_PRODUCT_POLICY_FORMAT,
	type IsoglossProductPlanRequest,
	type IsoglossProductPolicy,
	type IsoglossProfileCapabilities,
} from "../../src/isogloss/types.js";

function degreeNineLowered(): LoweredPureRegionContract {
	return {
		unitId: "product-unit",
		regionIds: ["r_0"],
		contract: {
			inputs: [
				{ type: "number" },
				{ type: "number" },
				{ type: "number" },
			],
			steps: [
				{
					type: "number",
					formula: { tag: "product", left: 0, right: 0 },
				},
				{
					type: "number",
					formula: { tag: "product", left: 3, right: 0 },
				},
				{
					type: "number",
					formula: { tag: "product", left: 1, right: 1 },
				},
				{
					type: "number",
					formula: { tag: "product", left: 5, right: 1 },
				},
				{
					type: "number",
					formula: { tag: "product", left: 2, right: 2 },
				},
				{
					type: "number",
					formula: { tag: "product", left: 7, right: 2 },
				},
				{
					type: "number",
					formula: { tag: "product", left: 4, right: 6 },
				},
				{
					type: "number",
					formula: { tag: "product", left: 9, right: 8 },
				},
			],
			outputs: [10],
		},
		inputBindings: [0, 1, 2].map((contractInput) => ({
			contractInput,
			binding: {
				kind: "argument" as const,
				index: contractInput,
			},
			domain: {
				type: "number" as const,
				min: 0,
				max: 9,
			},
		})),
		outputBindings: [],
	};
}

function cleanCallGraph(
	unitId = "product-unit"
): CanonicalCallGraphInventory {
	return {
		rootGroupId: "product-root",
		entryUnitId: unitId,
		unitIds: [unitId],
		targetPolicy: {
			mode: "canonical-evidence-only",
			directTargetRepresentation: "unit-ref-plus-exact-dataflow",
			unprovenBoundaryClassification: "indirect-or-external",
			supportedValueFlows: [
				"stack",
				"register",
				"argument",
				"slot",
			],
			precisionLossBoundaries: [
				"scope-chain",
				"dynamic-stack",
				"abrupt-control",
				"unsupported-aliasing",
			],
		},
		closureSites: [],
		boundaries: [],
		directEdges: [],
		sccs: [
			{
				id: "scc_0",
				unitIds: [unitId],
				incomingSccIds: [],
				outgoingSccIds: [],
				isRecursive: false,
				isMutuallyRecursive: false,
				hasUnresolvedRecursionRisk: false,
				hasUnresolvedMutualRecursionRisk: false,
				reentrancyRelevant: false,
				requiresInterproceduralFission: false,
			},
		],
		summary: {
			hasProvenRecursion: false,
			hasProvenMutualRecursion: false,
			hasUnresolvedRecursionRisk: false,
			hasUnresolvedMutualRecursionRisk: false,
			reentrancyRelevantSccIds: [],
			interproceduralFissionSccIds: [],
		},
	};
}

function localPolicy(
	minimumExactAttackQueries = 220n
): IsoglossProductPolicy {
	return {
		format: ISOGLOSS_PRODUCT_POLICY_FORMAT,
		allowedProfiles: [
			"holographic-local",
			"holographic-custodied",
			"holographic-private",
			"holographic-tee",
		],
		minimumExactAttackQueries,
		stateWidth: 3,
		transcriptBucket: null,
		bprf: {
			seed: 71_171,
			realizationCount: 3,
			fragmentCount: 3,
		},
	};
}

function capabilities(): IsoglossProfileCapabilities {
	return {
		supportedProfiles: [
			"holographic-local",
			"holographic-custodied",
			"holographic-private",
			"holographic-tee",
		],
		supportedTranscriptBuckets: [4, 8],
		custodianAvailable: true,
		privateFunctionProtocolAvailable: true,
		attestedExecutionAvailable: true,
	};
}

function localRequest(): IsoglossProductPlanRequest {
	return {
		region: {
			kind: "lowered-contract",
			lowered: degreeNineLowered(),
		},
		callEvidence: {
			evidence: "canonical-call-graph",
			inventory: cleanCallGraph(),
			protectedUnitIds: ["product-unit"],
		},
		profile: "holographic-local",
		boundary: "none",
		isGenerator: false,
		completeLocalFallbackPresent: false,
		policy: localPolicy(),
		capabilities: capabilities(),
	};
}

function protectedRequest(
	profile:
		| "holographic-custodied"
		| "holographic-private"
		| "holographic-tee" = "holographic-custodied"
): IsoglossProductPlanRequest {
	const local = localRequest();
	return {
		...local,
		profile,
		boundary:
			profile === "holographic-tee"
				? "in-process-attested"
				: "existing-remote-await",
		policy: {
			...local.policy,
			transcriptBucket: 8,
		},
		ownerSecrets: {
			placementSecret: "owner-placement-secret-sentinel",
			relationSecret: "owner-relation-secret-sentinel",
		},
	};
}

describe("Isogloss owner product planning and client schema", () => {
	it("rejects the 220-query attack below policy and admits an exact threshold tie", () => {
		const rejected = planIsoglossProduct({
			...localRequest(),
			policy: localPolicy(221n),
		});

		expect(rejected.decision).toBe("rejected");
		expect(rejected.blockers).toContainEqual({
			code: "CHEAP_KNOWN_EXACT_ATTACK",
			detail: "dense-interpolation:220<221",
		});
		expect(rejected.ownerPlan).toBeNull();
		expect(rejected.clientManifest).toBeNull();
		expect(rejected.assessment.hardnessLowerBound).toBeNull();

		const tied = planIsoglossProduct(localRequest());
		expect(tied.decision).toBe("eligible");
		if (tied.decision !== "eligible") return;
		expect(
			tied.assessment.learnability.cheapestKnownExactAttack
		).toEqual({
			method: "dense-interpolation",
			queries: 220n,
		});
		expect(
			tied.clientManifest.learnability.thresholdTieAccepted
		).toBe(true);
		expect(
			tied.clientManifest.learnability.hardnessLowerBound
		).toBeNull();
		expect(tied.ownerPlan.certificate.hardnessLowerBound).toBeNull();
		expect(tied.ownerPlan.certificate.nonClaim).toContain(
			"does not establish a hardness lower bound"
		);
		expect(tied.clientManifest.execution).toMatchObject({
			mode: "local-bprf",
			clientComplete: true,
			localFallback: "not-applicable",
		});
		expect(tied.clientManifest.clientCompleteness).toBe("complete");
	});

	it("enforces profile capabilities, scheduling, attestation, and no protected fallback", () => {
		const custody = planIsoglossProduct(protectedRequest());
		expect(custody.decision).toBe("eligible");
		if (custody.decision === "eligible") {
			expect(custody.clientManifest.execution).toMatchObject({
				mode: "masked-custody",
				clientComplete: false,
				localFallback: "forbidden",
			});
		}

		const unsupported = planIsoglossProduct({
			...protectedRequest(),
			capabilities: {
				...capabilities(),
				supportedProfiles: ["holographic-local"],
			},
		});
		expect(unsupported.blockers).toContainEqual({
			code: "UNSUPPORTED_PROFILE_CAPABILITY",
			detail: "holographic-custodied",
		});

		const fallback = planIsoglossProduct({
			...protectedRequest(),
			completeLocalFallbackPresent: true,
		});
		expect(fallback.blockers).toContainEqual({
			code: "DEPLOYMENT_INELIGIBLE",
			detail: "LOCAL_FALLBACK_FORBIDDEN",
		});

		const missingBucketCapability = planIsoglossProduct({
			...protectedRequest(),
			capabilities: {
				...capabilities(),
				supportedTranscriptBuckets: [4],
			},
		});
		expect(missingBucketCapability.blockers).toContainEqual({
			code: "UNSUPPORTED_TRANSCRIPT_BUCKET",
			detail: "8",
		});

		const missingSecrets = planIsoglossProduct({
			...protectedRequest(),
			ownerSecrets: undefined,
		});
		expect(missingSecrets.blockers.map((blocker) => blocker.code)).toEqual(
			expect.arrayContaining([
				"MISSING_OWNER_PLACEMENT_SECRET",
				"MISSING_OWNER_RELATION_SECRET",
			])
		);

		const privateMissing = planIsoglossProduct({
			...protectedRequest("holographic-private"),
			capabilities: {
				...capabilities(),
				privateFunctionProtocolAvailable: false,
			},
		});
		expect(privateMissing.blockers).toContainEqual({
			code: "DEPLOYMENT_INELIGIBLE",
			detail: "MISSING_PRIVATE_FUNCTION_PROTOCOL",
		});

		const teeMissing = planIsoglossProduct({
			...protectedRequest("holographic-tee"),
			capabilities: {
				...capabilities(),
				attestedExecutionAvailable: false,
			},
		});
		expect(teeMissing.blockers).toContainEqual({
			code: "DEPLOYMENT_INELIGIBLE",
			detail: "MISSING_ATTESTED_EXECUTION",
		});

		const localWithOwnerSecret = planIsoglossProduct({
			...localRequest(),
			ownerSecrets: {
				placementSecret: "not-valid-in-local-mode",
			},
		});
		expect(localWithOwnerSecret.blockers).toContainEqual({
			code: "LOCAL_OWNER_SECRETS_FORBIDDEN",
			detail: "holographic-local",
		});
	});

	it("keeps compiler relations and owner secrets outside protected client serialization", () => {
		const result = planIsoglossProduct(protectedRequest());
		expect(result.decision).toBe("eligible");
		if (result.decision !== "eligible") return;

		const client = JSON.stringify(result.clientManifest);
		const owner = canonicalSerializeIsoglossBuildValue(
			result.ownerPlan.ownerMaterial
		);
		for (const forbidden of [
			"owner-placement-secret-sentinel",
			"owner-relation-secret-sentinel",
			'"contract"',
			'"inputBindings"',
			'"formula"',
			'"realizations"',
		]) {
			expect(client).not.toContain(forbidden);
		}
		expect(owner).toContain("owner-placement-secret-sentinel");
		expect(owner).toContain("owner-relation-secret-sentinel");
		expect(owner).toContain('"contract"');
		expect(result.clientManifest.execution).toEqual({
			mode: "masked-custody",
			clientComplete: false,
			localFallback: "forbidden",
			ownerArtifactDigest:
				result.ownerPlan.certificate.ownerArtifactDigest,
			transcript: {
				id: "csh-masked-v1-w3-e8",
				width: 3,
				epochCount: 8,
				coverCount: 9,
			},
		});
		expect(() => JSON.parse(client)).not.toThrow();
		expect(Object.isFrozen(result.clientManifest)).toBe(true);
		expect(Object.isFrozen(result.clientManifest.execution)).toBe(true);
	});

	it("accepts an AST-native pure contract with frozen structural call proof and retains no legacy call graph", () => {
		const lowered = degreeNineLowered();
		const callEvidence =
			createSourceExpressionMacroregionCallRiskEvidence({
				proofId: "ast-product-expression-proof",
				noCalls: true,
				noEffects: true,
				noReentrancy: true,
				noInterproceduralBoundaries: true,
				noRecursiveOrFissionScc: true,
			});
		const result = planIsoglossProduct({
			...protectedRequest(),
			region: {
				kind: "pure-contract",
				id: "ast-product-expression",
				contract: lowered.contract,
				inputDomains: [
					{ type: "number", min: 0, max: 9 },
					{ type: "number", min: 0, max: 9 },
					{ type: "number", min: 0, max: 9 },
				],
				protectedStageCount: 8,
			},
			callEvidence,
		});

		expect(Object.isFrozen(callEvidence)).toBe(true);
		expect(result.decision).toBe("eligible");
		if (result.decision !== "eligible") return;
		expect(result.assessment.learnability.source).toBe("contract");
		expect(result.assessment.callRisk).toMatchObject({
			evidence: "source-expression-structural-proof",
			proofComplete: true,
			unresolvedBoundaryIds: [],
			reentrantBoundaryIds: [],
			interproceduralEdgeIds: [],
			recursiveOrFissionSccIds: [],
		});
		expect(result.ownerPlan.ownerMaterial.regionSource.kind).toBe(
			"pure-contract"
		);
		const retainedPlan =
			canonicalSerializeIsoglossBuildValue(result.ownerPlan);
		expect(retainedPlan).not.toContain("rootGroupId");
		expect(retainedPlan).not.toContain("canonical-call-graph");
		expect(retainedPlan).not.toContain("SemanticRootGroup");
	});

	it("produces canonical deterministic plan and certificate digests", () => {
		const request = protectedRequest();
		const first = planIsoglossProduct(request);
		const second = planIsoglossProduct(structuredClone(request));
		expect(first.decision).toBe("eligible");
		expect(second.decision).toBe("eligible");
		if (
			first.decision !== "eligible" ||
			second.decision !== "eligible"
		) {
			return;
		}
		expect(second.ownerPlan.planDigest).toBe(first.ownerPlan.planDigest);
		expect(second.ownerPlan.certificateDigest).toBe(
			first.ownerPlan.certificateDigest
		);
		expect(JSON.stringify(second.clientManifest)).toBe(
			JSON.stringify(first.clientManifest)
		);
		expect(first.ownerPlan.planDigest).toMatch(/^[0-9a-f]{64}$/u);
		expect(first.ownerPlan.certificateDigest).toMatch(
			/^[0-9a-f]{64}$/u
		);

		const changedSecret = planIsoglossProduct({
			...request,
			ownerSecrets: {
				...request.ownerSecrets,
				placementSecret: "different-owner-placement-secret",
			},
		});
		expect(changedSecret.decision).toBe("eligible");
		if (changedSecret.decision === "eligible") {
			// No client-visible digest may become an offline verifier for an
			// owner secret. Only the owner-held material digest changes.
			expect(changedSecret.ownerPlan.planDigest).toBe(
				first.ownerPlan.planDigest
			);
			expect(changedSecret.ownerPlan.certificateDigest).toBe(
				first.ownerPlan.certificateDigest
			);
			expect(changedSecret.ownerPlan.ownerMaterialDigest).not.toBe(
				first.ownerPlan.ownerMaterialDigest
			);
		}

		expect(
			canonicalSerializeIsoglossBuildValue({ z: 1, a: 220n })
		).toBe('{"a":{"$bigint":"220"},"z":1}');
	});

	it("fails closed on incomplete proof, boundary/SCC risk, and malformed inputs", () => {
		const incompleteDomain = degreeNineLowered();
		incompleteDomain.inputBindings = incompleteDomain.inputBindings.slice(
			0,
			2
		);
		const domainResult = planIsoglossProduct({
			...localRequest(),
			region: {
				kind: "lowered-contract",
				lowered: incompleteDomain,
			},
		});
		expect(domainResult.blockers.map((blocker) => blocker.code)).toEqual(
			expect.arrayContaining([
				"INCOMPLETE_DOMAIN_PROOF",
				"INCOMPLETE_LEARNABILITY_ANALYSIS",
			])
		);

		const incompleteGraph = cleanCallGraph();
		incompleteGraph.sccs = [];
		const graphResult = planIsoglossProduct({
			...localRequest(),
			callEvidence: {
				evidence: "canonical-call-graph",
				inventory: incompleteGraph,
				protectedUnitIds: ["product-unit"],
			},
		});
		expect(graphResult.blockers).toContainEqual({
			code: "INCOMPLETE_CALL_GRAPH_PROOF",
			detail: "product-unit",
		});

		const riskyGraph = cleanCallGraph();
		riskyGraph.boundaries = [
			{
				unitId: "product-unit",
				nodeId: 7,
				originId: 0,
				origin: {
					file: "fixture.js",
					start: 1,
					end: 2,
					line: 1,
					column: 1,
				},
				op: 44,
				opName: "CALL",
				boundaryKind: "invoke",
				operand: 0,
				operandKind: "arg-count",
				resolution: {
					kind: "indirect-or-external",
					reason: "callee-identity-not-represented",
				},
				observability: {
					callKind: "plain",
					effect: "unknown",
					completion: "normal-or-throw",
					coercion: "none",
					suspension: "none",
					mayThrow: true,
					maySuspend: false,
					mayExecuteArbitraryUserCode: true,
					mayReadOrWriteProgramState: true,
					mayReenterRootGroup: true,
				},
			},
		] as CanonicalCallGraphInventory["boundaries"];
		riskyGraph.sccs = [
			{
				...riskyGraph.sccs[0]!,
				hasUnresolvedRecursionRisk: true,
				reentrancyRelevant: true,
				requiresInterproceduralFission: true,
			},
			{
				id: "scc_1",
				unitIds: ["child-unit"],
				incomingSccIds: ["scc_0"],
				outgoingSccIds: [],
				isRecursive: false,
				isMutuallyRecursive: false,
				hasUnresolvedRecursionRisk: false,
				hasUnresolvedMutualRecursionRisk: false,
				reentrancyRelevant: false,
				requiresInterproceduralFission: false,
			},
		];
		riskyGraph.unitIds = ["child-unit", "product-unit"];
		riskyGraph.directEdges = [
			{
				unitId: "product-unit",
				nodeId: 8,
				originId: 0,
				origin: {
					file: "fixture.js",
					start: 2,
					end: 3,
					line: 1,
					column: 2,
				},
				targetUnitId: "child-unit",
				evidence: "exact-canonical-dataflow",
			},
		];
		const riskResult = planIsoglossProduct({
			...localRequest(),
			callEvidence: {
				evidence: "canonical-call-graph",
				inventory: riskyGraph,
				protectedUnitIds: ["product-unit"],
			},
		});
		expect(riskResult.blockers.map((blocker) => blocker.code)).toEqual(
			expect.arrayContaining([
				"UNRESOLVED_CALL_BOUNDARY",
				"REENTRANT_CALL_BOUNDARY",
				"INTERPROCEDURAL_CALL_BOUNDARY",
				"RECURSIVE_OR_FISSION_SCC",
			])
		);

		const validSourceProof =
			createSourceExpressionMacroregionCallRiskEvidence({
				proofId: "ast-product-expression-proof",
				noCalls: true,
				noEffects: true,
				noReentrancy: true,
				noInterproceduralBoundaries: true,
				noRecursiveOrFissionScc: true,
			});
		const unfrozenProofResult = planIsoglossProduct({
			...localRequest(),
			callEvidence: { ...validSourceProof },
		});
		expect(unfrozenProofResult.blockers).toContainEqual({
			code: "INCOMPLETE_CALL_GRAPH_PROOF",
			detail: "product-unit",
		});

		const riskySourceProof = Object.freeze({
			...validSourceProof,
			noEffects: false,
			noReentrancy: false,
		}) as unknown as IsoglossProductPlanRequest["callEvidence"];
		const riskySourceResult = planIsoglossProduct({
			...localRequest(),
			callEvidence: riskySourceProof,
		});
		expect(
			riskySourceResult.blockers.map((blocker) => blocker.code)
		).toEqual(
			expect.arrayContaining([
				"INCOMPLETE_CALL_GRAPH_PROOF",
				"UNRESOLVED_CALL_BOUNDARY",
				"REENTRANT_CALL_BOUNDARY",
			])
		);

		expect(() =>
			planIsoglossProduct({
				...localRequest(),
				policy: {
					...localPolicy(),
					minimumExactAttackQueries: -1n,
				},
			})
		).toThrow("RUAM_ISOGLOSS_PLAN_INVALID_POLICY");
		expect(() =>
			planIsoglossProduct({
				...localRequest(),
				policy: {
					...localPolicy(),
					transcriptBucket: 4,
				},
			})
		).toThrow("RUAM_ISOGLOSS_PLAN_INVALID_TRANSCRIPT_BUCKET");
		expect(() =>
			planIsoglossProduct({
				...localRequest(),
				region: {
					kind: "pure-contract",
					id: "malformed-stage-count",
					contract: degreeNineLowered().contract,
					inputDomains: [
						{ type: "number", min: 0, max: 9 },
						{ type: "number", min: 0, max: 9 },
						{ type: "number", min: 0, max: 9 },
					],
					protectedStageCount: 0,
				},
			})
		).toThrow("RUAM_ISOGLOSS_PLAN_INVALID_PURE_CONTRACT");

		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		expect(() =>
			canonicalSerializeIsoglossBuildValue(cyclic)
		).toThrow("RUAM_ISOGLOSS_CANONICAL_CYCLE");
	});
});
