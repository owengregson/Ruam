/**
 * Owner-side evidence that every canonical semantic node in each selected
 * root is owned by a verified Isogloss effect graph.
 *
 * This transitional certificate proves canonical graph ownership only. It
 * does not prove that an executable regional runtime exists or that emitted
 * artifact bytes contain no pass-through source. Serialized certificates are
 * normalized from explicit node and boundary-variant evidence; no aggregate
 * count is trusted.
 *
 * @module isogloss/protection-certificate
 */

import type { SemanticRootGroup } from "../compiler/ir.js";
import {
	ISOGLOSS_EFFECT_GRAPH_FORMAT,
	type IsoglossEffectGraph,
} from "./effect-graph.js";
import type { ProtectedSourceRoot } from "./source-roots.js";
import { verifyIsoglossEffectGraph } from "./verify-effect-graph.js";

export const ISOGLOSS_PROTECTION_CERTIFICATE_FORMAT =
	"ruam-isogloss-protection-certificate-1" as const;

export const ISOGLOSS_PROTECTION_CERTIFICATE_EVIDENCE =
	"canonical-ir+verified-effect-graph" as const;

export const ISOGLOSS_PROTECTION_CERTIFICATE_SCOPE =
	"canonical-graph-only" as const;

export const ISOGLOSS_PROTECTION_CERTIFICATE_LIMITS = Object.freeze({
	targetRoots: 1_024,
	canonicalNodesPerRoot: 1_000_000,
	identityCharacters: 1_024,
});

export interface IsoglossCanonicalNodeReference {
	readonly unitId: string;
	readonly nodeId: number;
}

export interface IsoglossTargetRootProtection {
	readonly rootGroupId: string;
	readonly effectGraphFormat: typeof ISOGLOSS_EFFECT_GRAPH_FORMAT;
	readonly effectGraphSeed: number;
	readonly canonicalNodes: readonly IsoglossCanonicalNodeReference[];
	/** Canonical nodes structurally owned by the verified build-side graph. */
	readonly protectedNodes: readonly IsoglossCanonicalNodeReference[];
	readonly externalEffectBoundaryNodes: readonly IsoglossCanonicalNodeReference[];
	readonly unprotectedNodes: readonly IsoglossCanonicalNodeReference[];
	readonly unsupportedNodes: readonly IsoglossCanonicalNodeReference[];
	readonly verifiedBoundaryVariants: readonly string[];
	readonly verifiedBoundaryVariantCount: number;
}

export interface IsoglossProtectionCertificate {
	readonly format: typeof ISOGLOSS_PROTECTION_CERTIFICATE_FORMAT;
	readonly evidence: typeof ISOGLOSS_PROTECTION_CERTIFICATE_EVIDENCE;
	readonly roots: readonly IsoglossTargetRootProtection[];
	readonly targetRootCount: number;
	readonly verifiedRootCount: number;
	readonly canonicalNodeCount: number;
	readonly protectedCanonicalNodeCount: number;
	readonly externalEffectBoundaryCount: number;
	readonly verifiedBoundaryVariantCount: number;
	readonly unprotectedCanonicalNodeCount: 0;
	readonly unsupportedCanonicalNodeCount: 0;
	/** False until emitted regional runtime and artifact bytes are verified. */
	readonly artifactBound: false;
	readonly coverageScope: typeof ISOGLOSS_PROTECTION_CERTIFICATE_SCOPE;
	readonly fullyProtected: false;
}

/** Build-side inputs accepted by the canonical graph evidence issuer. */
export interface IsoglossProtectionCertificationInput {
	readonly sourceRoots: readonly Pick<ProtectedSourceRoot, "id" | "group">[];
	readonly effectGraphs: readonly IsoglossEffectGraph[];
}

export type IsoglossProtectionCertificateErrorCode =
	| "RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE"
	| "RUAM_PROTECTION_CERTIFICATE_INVALID_FORMAT"
	| "RUAM_PROTECTION_CERTIFICATE_DUPLICATE_ROOT"
	| "RUAM_PROTECTION_CERTIFICATE_DUPLICATE_NODE"
	| "RUAM_PROTECTION_CERTIFICATE_DUPLICATE_VARIANT"
	| "RUAM_PROTECTION_CERTIFICATE_NODE_OUTSIDE_ROOT"
	| "RUAM_PROTECTION_CERTIFICATE_UNPROTECTED_NODE"
	| "RUAM_PROTECTION_CERTIFICATE_UNSUPPORTED_NODE"
	| "RUAM_PROTECTION_CERTIFICATE_COVERAGE_GAP"
	| "RUAM_PROTECTION_CERTIFICATE_COUNT_MISMATCH"
	| "RUAM_PROTECTION_CERTIFICATE_SOURCE_ROOT_MISMATCH"
	| "RUAM_PROTECTION_CERTIFICATE_MISSING_EFFECT_GRAPH"
	| "RUAM_PROTECTION_CERTIFICATE_UNEXPECTED_EFFECT_GRAPH"
	| "RUAM_PROTECTION_CERTIFICATE_INVALID_EFFECT_GRAPH";

export class IsoglossProtectionCertificateError extends Error {
	override readonly name = "IsoglossProtectionCertificateError";

	constructor(
		readonly code: IsoglossProtectionCertificateErrorCode,
		detail: string
	) {
		super(`${code}: ${detail}`);
	}
}

/**
 * Verify complete graph ownership for every compiled source root and issue a
 * normalized certificate. Raw node arrays are never accepted here.
 */
export function createIsoglossProtectionCertificate(
	input: IsoglossProtectionCertificationInput
): IsoglossProtectionCertificate {
	return assembleCertificate(deriveVerifiedRoots(input));
}

function deriveVerifiedRoots(
	input: IsoglossProtectionCertificationInput
): readonly IsoglossTargetRootProtection[] {
	const record = plainRecord(input, "certification input");
	const sourceRoots = denseArray(record.sourceRoots, "sourceRoots");
	const effectGraphs = denseArray(record.effectGraphs, "effectGraphs");
	if (sourceRoots.length === 0) {
		fail(
			"RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE",
			"at least one source root is required"
		);
	}
	assertRootLimit(sourceRoots.length);
	assertRootLimit(effectGraphs.length);

	const graphsByRoot = new Map<string, IsoglossEffectGraph>();
	for (let index = 0; index < effectGraphs.length; index++) {
		const graphRecord = plainRecord(effectGraphs[index], `effectGraphs[${index}]`);
		const rootGroupId = identity(
			graphRecord.rootGroupId,
			`effectGraphs[${index}].rootGroupId`
		);
		if (graphsByRoot.has(rootGroupId)) {
			fail("RUAM_PROTECTION_CERTIFICATE_DUPLICATE_ROOT", rootGroupId);
		}
		if (
			graphRecord.format !== ISOGLOSS_EFFECT_GRAPH_FORMAT ||
			!Number.isSafeInteger(graphRecord.seed)
		) {
			fail(
				"RUAM_PROTECTION_CERTIFICATE_INVALID_EFFECT_GRAPH",
				`${rootGroupId}: invalid format or seed`
			);
		}
		graphsByRoot.set(rootGroupId, effectGraphs[index] as IsoglossEffectGraph);
	}

	const seenSourceRoots = new Set<string>();
	const derived = sourceRoots.map((candidate, index) => {
		const sourceRoot = plainRecord(candidate, `sourceRoots[${index}]`);
		const rootId = identity(sourceRoot.id, `sourceRoots[${index}].id`);
		if (seenSourceRoots.has(rootId)) {
			fail("RUAM_PROTECTION_CERTIFICATE_DUPLICATE_ROOT", rootId);
		}
		seenSourceRoots.add(rootId);
		const groupRecord = plainRecord(
			sourceRoot.group,
			`sourceRoots[${index}].group`
		);
		const groupId = identity(
			groupRecord.id,
			`sourceRoots[${index}].group.id`
		);
		if (rootId !== groupId) {
			fail(
				"RUAM_PROTECTION_CERTIFICATE_SOURCE_ROOT_MISMATCH",
				`${rootId}:${groupId}`
			);
		}

		const graph = graphsByRoot.get(rootId);
		if (!graph) {
			fail("RUAM_PROTECTION_CERTIFICATE_MISSING_EFFECT_GRAPH", rootId);
		}
		graphsByRoot.delete(rootId);
		const group = sourceRoot.group as SemanticRootGroup;
		let verification: ReturnType<typeof verifyIsoglossEffectGraph>;
		try {
			verification = verifyIsoglossEffectGraph(group, graph);
		} catch (error) {
			fail(
				"RUAM_PROTECTION_CERTIFICATE_INVALID_EFFECT_GRAPH",
				error instanceof Error ? error.message : String(error)
			);
		}

		const canonicalNodes = canonicalNodeReferences(group);
		assertNodeLimit(canonicalNodes.length, `${rootId}.canonicalNodes`);
		if (
			verification.canonicalNodeCount !== canonicalNodes.length ||
			verification.protectedCodeletCount !== canonicalNodes.length ||
			verification.unprotectedCanonicalNodeCount !== 0 ||
			verification.unsupportedCanonicalNodeCount !== 0
		) {
			fail(
				"RUAM_PROTECTION_CERTIFICATE_INVALID_EFFECT_GRAPH",
				`${rootId}: verifier did not prove total canonical coverage`
			);
		}

		const externalEffectBoundaryNodes = Object.freeze(
			graph.units.flatMap((unit) =>
				unit.codelets.flatMap((codelet) =>
					codelet.signature.purity === "observable"
						? [
								Object.freeze({
									unitId: codelet.unitId,
									nodeId: codelet.canonicalNodeId,
								}),
							]
						: []
				)
			)
		);
		const verifiedBoundaryVariants = Object.freeze(
			graph.units.flatMap((unit) =>
				unit.codelets.flatMap((codelet) =>
					codelet.variants.map((variant) => variant.id)
				)
			)
		);
		if (verifiedBoundaryVariants.length !== verification.verifiedVariantCount) {
			fail(
				"RUAM_PROTECTION_CERTIFICATE_INVALID_EFFECT_GRAPH",
				`${rootId}: verifier variant count mismatch`
			);
		}

		return {
			rootGroupId: rootId,
			effectGraphFormat: graph.format,
			effectGraphSeed: graph.seed,
			canonicalNodes,
			protectedNodes: canonicalNodes,
			externalEffectBoundaryNodes,
			unprotectedNodes: Object.freeze([]),
			unsupportedNodes: Object.freeze([]),
			verifiedBoundaryVariants,
			verifiedBoundaryVariantCount: verifiedBoundaryVariants.length,
		} satisfies IsoglossTargetRootProtection;
	});

	if (graphsByRoot.size > 0) {
		fail(
			"RUAM_PROTECTION_CERTIFICATE_UNEXPECTED_EFFECT_GRAPH",
			graphsByRoot.keys().next().value ?? "unknown"
		);
	}
	return normalizeRoots(derived);
}

function canonicalNodeReferences(
	group: SemanticRootGroup
): readonly IsoglossCanonicalNodeReference[] {
	if (!Array.isArray(group.units)) {
		fail(
			"RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE",
			`${group.id}.units must be an array`
		);
	}
	return Object.freeze(
		group.units.flatMap((unit, unitIndex) => {
			const unitId = identity(unit.id, `${group.id}.units[${unitIndex}].id`);
			if (!Array.isArray(unit.nodes)) {
				fail(
					"RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE",
					`${group.id}.${unitId}.nodes must be an array`
				);
			}
			return unit.nodes.map((node) =>
				Object.freeze({ unitId, nodeId: node.id })
			);
		})
	);
}

function assembleCertificate(
	roots: readonly IsoglossTargetRootProtection[]
): IsoglossProtectionCertificate {
	return Object.freeze({
		format: ISOGLOSS_PROTECTION_CERTIFICATE_FORMAT,
		evidence: ISOGLOSS_PROTECTION_CERTIFICATE_EVIDENCE,
		roots,
		targetRootCount: roots.length,
		verifiedRootCount: roots.length,
		canonicalNodeCount: sum(roots, (root) => root.canonicalNodes.length),
		protectedCanonicalNodeCount: sum(
			roots,
			(root) => root.protectedNodes.length
		),
		externalEffectBoundaryCount: sum(
			roots,
			(root) => root.externalEffectBoundaryNodes.length
		),
		verifiedBoundaryVariantCount: sum(
			roots,
			(root) => root.verifiedBoundaryVariants.length
		),
		unprotectedCanonicalNodeCount: 0,
		unsupportedCanonicalNodeCount: 0,
		artifactBound: false,
		coverageScope: ISOGLOSS_PROTECTION_CERTIFICATE_SCOPE,
		fullyProtected: false,
	});
}

/** Validate and deeply normalize an untrusted serialized certificate. */
export function validateIsoglossProtectionCertificate(
	value: unknown
): IsoglossProtectionCertificate {
	const record = plainRecord(value, "certificate");
	if (
		record.format !== ISOGLOSS_PROTECTION_CERTIFICATE_FORMAT ||
		record.evidence !== ISOGLOSS_PROTECTION_CERTIFICATE_EVIDENCE
	) {
		fail(
			"RUAM_PROTECTION_CERTIFICATE_INVALID_FORMAT",
			`${String(record.format)}:${String(record.evidence)}`
		);
	}
	const certificate = assembleCertificate(normalizeRoots(record.roots));
	for (const field of [
		"targetRootCount",
		"verifiedRootCount",
		"canonicalNodeCount",
		"protectedCanonicalNodeCount",
		"externalEffectBoundaryCount",
		"verifiedBoundaryVariantCount",
		"unprotectedCanonicalNodeCount",
		"unsupportedCanonicalNodeCount",
	] as const) {
		if (record[field] !== certificate[field]) {
			fail(
				"RUAM_PROTECTION_CERTIFICATE_COUNT_MISMATCH",
				`${field}:${String(record[field])}:${certificate[field]}`
			);
		}
	}
	if (
		record.artifactBound !== false ||
		record.coverageScope !== ISOGLOSS_PROTECTION_CERTIFICATE_SCOPE ||
		record.fullyProtected !== false
	) {
		fail(
			"RUAM_PROTECTION_CERTIFICATE_COVERAGE_GAP",
			"canonical graph evidence must not claim emitted-artifact protection"
		);
	}
	return certificate;
}

function normalizeRoots(value: unknown): readonly IsoglossTargetRootProtection[] {
	const candidates = denseArray(value, "roots");
	if (candidates.length === 0) {
		fail(
			"RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE",
			"at least one target root is required"
		);
	}
	assertRootLimit(candidates.length);
	const rootIds = new Set<string>();
	const roots = candidates.map((candidate, rootIndex) => {
		const root = plainRecord(candidate, `roots[${rootIndex}]`);
		const rootGroupId = identity(
			root.rootGroupId,
			`roots[${rootIndex}].rootGroupId`
		);
		if (rootIds.has(rootGroupId)) {
			fail("RUAM_PROTECTION_CERTIFICATE_DUPLICATE_ROOT", rootGroupId);
		}
		rootIds.add(rootGroupId);
		if (root.effectGraphFormat !== ISOGLOSS_EFFECT_GRAPH_FORMAT) {
			fail(
				"RUAM_PROTECTION_CERTIFICATE_INVALID_FORMAT",
				`${rootGroupId}.effectGraphFormat`
			);
		}
		if (!Number.isSafeInteger(root.effectGraphSeed)) {
			fail(
				"RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE",
				`${rootGroupId}.effectGraphSeed`
			);
		}

		const canonicalNodes = normalizeNodes(
			root.canonicalNodes,
			`${rootGroupId}.canonicalNodes`
		);
		if (canonicalNodes.length === 0) {
			fail(
				"RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE",
				`${rootGroupId} has no canonical nodes`
			);
		}
		const protectedNodes = normalizeNodes(
			root.protectedNodes,
			`${rootGroupId}.protectedNodes`
		);
		const externalEffectBoundaryNodes = normalizeNodes(
			root.externalEffectBoundaryNodes,
			`${rootGroupId}.externalEffectBoundaryNodes`
		);
		const unprotectedNodes = normalizeNodes(
			root.unprotectedNodes,
			`${rootGroupId}.unprotectedNodes`
		);
		const unsupportedNodes = normalizeNodes(
			root.unsupportedNodes,
			`${rootGroupId}.unsupportedNodes`
		);
		const verifiedBoundaryVariants = normalizeIdentities(
			root.verifiedBoundaryVariants,
			`${rootGroupId}.verifiedBoundaryVariants`
		);
		if (
			!Number.isSafeInteger(root.verifiedBoundaryVariantCount) ||
			root.verifiedBoundaryVariantCount !== verifiedBoundaryVariants.length
		) {
			fail(
				"RUAM_PROTECTION_CERTIFICATE_COUNT_MISMATCH",
				`${rootGroupId}.verifiedBoundaryVariantCount:${String(
					root.verifiedBoundaryVariantCount
				)}:${verifiedBoundaryVariants.length}`
			);
		}
		if (verifiedBoundaryVariants.length < canonicalNodes.length) {
			fail(
				"RUAM_PROTECTION_CERTIFICATE_COVERAGE_GAP",
				`${rootGroupId}: fewer verified variants than canonical nodes`
			);
		}

		const canonicalKeys = new Set(canonicalNodes.map(nodeKey));
		for (const [label, nodes] of [
			["protected", protectedNodes],
			["external-effect", externalEffectBoundaryNodes],
			["unprotected", unprotectedNodes],
			["unsupported", unsupportedNodes],
		] as const) {
			for (const node of nodes) {
				if (!canonicalKeys.has(nodeKey(node))) {
					fail(
						"RUAM_PROTECTION_CERTIFICATE_NODE_OUTSIDE_ROOT",
						`${rootGroupId}:${label}:${nodeKey(node)}`
					);
				}
			}
		}
		if (unprotectedNodes.length > 0) {
			fail(
				"RUAM_PROTECTION_CERTIFICATE_UNPROTECTED_NODE",
				`${rootGroupId}:${nodeKey(unprotectedNodes[0]!)}`
			);
		}
		if (unsupportedNodes.length > 0) {
			fail(
				"RUAM_PROTECTION_CERTIFICATE_UNSUPPORTED_NODE",
				`${rootGroupId}:${nodeKey(unsupportedNodes[0]!)}`
			);
		}
		const protectedKeys = new Set(protectedNodes.map(nodeKey));
		if (
			protectedKeys.size !== canonicalKeys.size ||
			[...canonicalKeys].some((key) => !protectedKeys.has(key))
		) {
			fail("RUAM_PROTECTION_CERTIFICATE_COVERAGE_GAP", rootGroupId);
		}

		return Object.freeze({
			rootGroupId,
			effectGraphFormat: ISOGLOSS_EFFECT_GRAPH_FORMAT,
			effectGraphSeed: root.effectGraphSeed as number,
			canonicalNodes,
			protectedNodes,
			externalEffectBoundaryNodes,
			unprotectedNodes,
			unsupportedNodes,
			verifiedBoundaryVariants,
			verifiedBoundaryVariantCount: verifiedBoundaryVariants.length,
		});
	});
	return Object.freeze(roots);
}

function normalizeNodes(
	value: unknown,
	label: string
): readonly IsoglossCanonicalNodeReference[] {
	if (Array.isArray(value)) assertNodeLimit(value.length, label);
	const candidates = denseArray(value, label);
	const seen = new Set<string>();
	const nodes = candidates.map((candidate, index) => {
		const node = plainRecord(candidate, `${label}[${index}]`);
		const unitId = identity(node.unitId, `${label}[${index}].unitId`);
		const nodeId = node.nodeId;
		if (!Number.isSafeInteger(nodeId) || (nodeId as number) < 0) {
			fail(
				"RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE",
				`${label}[${index}].nodeId`
			);
		}
		const normalized = Object.freeze({ unitId, nodeId: nodeId as number });
		const key = nodeKey(normalized);
		if (seen.has(key)) {
			fail("RUAM_PROTECTION_CERTIFICATE_DUPLICATE_NODE", `${label}:${key}`);
		}
		seen.add(key);
		return normalized;
	});
	return Object.freeze(nodes);
}

function normalizeIdentities(value: unknown, label: string): readonly string[] {
	const candidates = denseArray(value, label);
	const seen = new Set<string>();
	const identities = candidates.map((candidate, index) => {
		const normalized = identity(candidate, `${label}[${index}]`);
		if (seen.has(normalized)) {
			fail("RUAM_PROTECTION_CERTIFICATE_DUPLICATE_VARIANT", normalized);
		}
		seen.add(normalized);
		return normalized;
	});
	return Object.freeze(identities);
}

function denseArray(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) {
		fail(
			"RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE",
			`${label} must be an array`
		);
	}
	for (let index = 0; index < value.length; index++) {
		if (!Object.hasOwn(value, index)) {
			fail(
				"RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE",
				`${label} must not be sparse`
			);
		}
	}
	return value;
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		fail(
			"RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE",
			`${label} must be an object`
		);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		fail(
			"RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE",
			`${label} must be a plain object`
		);
	}
	return value as Record<string, unknown>;
}

function identity(value: unknown, label: string): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value !== value.trim() ||
		value.length > ISOGLOSS_PROTECTION_CERTIFICATE_LIMITS.identityCharacters
	) {
		fail(
			"RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE",
			`${label} must be a bounded nonempty string without surrounding whitespace`
		);
	}
	return value;
}

function assertRootLimit(count: number): void {
	if (count > ISOGLOSS_PROTECTION_CERTIFICATE_LIMITS.targetRoots) {
		fail(
			"RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE",
			`target roots exceed ${ISOGLOSS_PROTECTION_CERTIFICATE_LIMITS.targetRoots}`
		);
	}
}

function assertNodeLimit(count: number, label: string): void {
	if (count > ISOGLOSS_PROTECTION_CERTIFICATE_LIMITS.canonicalNodesPerRoot) {
		fail(
			"RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE",
			`${label} exceeds ${ISOGLOSS_PROTECTION_CERTIFICATE_LIMITS.canonicalNodesPerRoot}`
		);
	}
}

function nodeKey(node: IsoglossCanonicalNodeReference): string {
	return `${node.unitId}:${node.nodeId}`;
}

function sum<T>(values: readonly T[], select: (value: T) => number): number {
	return values.reduce((total, value) => total + select(value), 0);
}

function fail(
	code: IsoglossProtectionCertificateErrorCode,
	detail: string
): never {
	throw new IsoglossProtectionCertificateError(code, detail);
}
