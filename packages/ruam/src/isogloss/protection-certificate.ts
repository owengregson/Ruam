/**
 * Owner-side evidence that every canonical semantic node in each selected
 * root is owned by the protected Isogloss execution representation.
 *
 * Counts alone are not accepted as proof. Validation recomputes every count
 * from the node-reference sets and requires exact, zero-gap coverage.
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
	readonly protectedNodes: readonly IsoglossCanonicalNodeReference[];
	readonly externalEffectBoundaryNodes: readonly IsoglossCanonicalNodeReference[];
	readonly unprotectedNodes: readonly IsoglossCanonicalNodeReference[];
	readonly unsupportedNodes: readonly IsoglossCanonicalNodeReference[];
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
	readonly fullyProtected: true;
}

/**
 * Authoritative build inputs for a protection certificate.
 *
 * `sourceRoots` are structurally typed so callers may pass the direct result
 * of {@link compileProtectedSourceRoots} without exposing Babel paths through
 * the certificate API. Every source root must have exactly one matching graph.
 */
export interface IsoglossProtectionCertificationInput {
	readonly sourceRoots: readonly Pick<ProtectedSourceRoot, "id" | "group">[];
	readonly effectGraphs: readonly IsoglossEffectGraph[];
}

export type IsoglossProtectionCertificateErrorCode =
	| "RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE"
	| "RUAM_PROTECTION_CERTIFICATE_INVALID_FORMAT"
	| "RUAM_PROTECTION_CERTIFICATE_DUPLICATE_ROOT"
	| "RUAM_PROTECTION_CERTIFICATE_DUPLICATE_NODE"
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
 * Verify complete effect-graph ownership for every compiled source root and
 * issue a normalized certificate. Raw caller-authored node arrays are never
 * accepted by this authority boundary.
 */
export function createIsoglossProtectionCertificate(
	input: IsoglossProtectionCertificationInput
): IsoglossProtectionCertificate {
	const normalizedRoots = deriveVerifiedRoots(input);
	return assembleCertificate(normalizedRoots);
}

function assembleCertificate(
	normalizedRoots: readonly IsoglossTargetRootProtection[]
): IsoglossProtectionCertificate {
	const canonicalNodeCount = sum(
		normalizedRoots,
		(root) => root.canonicalNodes.length
	);
	const protectedCanonicalNodeCount = sum(
		normalizedRoots,
		(root) => root.protectedNodes.length
	);
	const externalEffectBoundaryCount = sum(
		normalizedRoots,
		(root) => root.externalEffectBoundaryNodes.length
	);
	const verifiedBoundaryVariantCount = sum(
		normalizedRoots,
		(root) => root.verifiedBoundaryVariantCount
	);

	return Object.freeze({
		format: ISOGLOSS_PROTECTION_CERTIFICATE_FORMAT,
		evidence: ISOGLOSS_PROTECTION_CERTIFICATE_EVIDENCE,
		roots: normalizedRoots,
		targetRootCount: normalizedRoots.length,
		verifiedRootCount: normalizedRoots.length,
		canonicalNodeCount,
		protectedCanonicalNodeCount,
		externalEffectBoundaryCount,
		verifiedBoundaryVariantCount,
		unprotectedCanonicalNodeCount: 0,
		unsupportedCanonicalNodeCount: 0,
		fullyProtected: true,
	});
}

/**
 * Validate untrusted certificate data and return an immutable normalized copy.
 * Aggregate fields are checked against node sets rather than trusted.
 */
export function validateIsoglossProtectionCertificate(
	value: unknown
): IsoglossProtectionCertificate {
	const record = plainRecord(value, "certificate");
	if (record.format !== ISOGLOSS_PROTECTION_CERTIFICATE_FORMAT) {
		fail(
			"RUAM_PROTECTION_CERTIFICATE_INVALID_FORMAT",
			String(record.format)
		);
	}
	if (!Array.isArray(record.roots)) {
		fail("RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE", "roots must be an array");
	}
	const certificate = createIsoglossProtectionCertificate(
		record.roots as readonly IsoglossTargetRootProtection[]
	);
	const numericFields = [
		"targetRootCount",
		"verifiedRootCount",
		"canonicalNodeCount",
		"protectedCanonicalNodeCount",
		"externalEffectBoundaryCount",
		"unprotectedCanonicalNodeCount",
		"unsupportedCanonicalNodeCount",
	] as const;
	for (const field of numericFields) {
		if (record[field] !== certificate[field]) {
			fail(
				"RUAM_PROTECTION_CERTIFICATE_COUNT_MISMATCH",
				`${field}:${String(record[field])}:${certificate[field]}`
			);
		}
	}
	if (record.fullyProtected !== true) {
		fail(
			"RUAM_PROTECTION_CERTIFICATE_COVERAGE_GAP",
			"fullyProtected must be true"
		);
	}
	return certificate;
}

function normalizeRoots(
	value: readonly IsoglossTargetRootProtection[]
): readonly IsoglossTargetRootProtection[] {
	if (!Array.isArray(value) || value.length === 0) {
		fail(
			"RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE",
			"at least one target root is required"
		);
	}
	const rootIds = new Set<string>();
	const roots = value.map((candidate, rootIndex) => {
		const root = plainRecord(candidate, `roots[${rootIndex}]`);
		const rootGroupId = nonemptyString(
			root.rootGroupId,
			`roots[${rootIndex}].rootGroupId`
		);
		if (rootIds.has(rootGroupId)) {
			fail("RUAM_PROTECTION_CERTIFICATE_DUPLICATE_ROOT", rootGroupId);
		}
		rootIds.add(rootGroupId);

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
			fail(
				"RUAM_PROTECTION_CERTIFICATE_COVERAGE_GAP",
				rootGroupId
			);
		}
		for (const node of externalEffectBoundaryNodes) {
			if (!protectedKeys.has(nodeKey(node))) {
				fail(
					"RUAM_PROTECTION_CERTIFICATE_COVERAGE_GAP",
					`${rootGroupId}:unprotected external effect ${nodeKey(node)}`
				);
			}
		}

		return Object.freeze({
			rootGroupId,
			canonicalNodes,
			protectedNodes,
			externalEffectBoundaryNodes,
			unprotectedNodes,
			unsupportedNodes,
		});
	});
	return Object.freeze(roots);
}

function normalizeNodes(value: unknown, label: string) {
	if (!Array.isArray(value)) {
		fail("RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE", `${label} must be an array`);
	}
	const seen = new Set<string>();
	const nodes = value.map((candidate, index) => {
		const node = plainRecord(candidate, `${label}[${index}]`);
		const unitId = nonemptyString(node.unitId, `${label}[${index}].unitId`);
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

function nodeKey(node: IsoglossCanonicalNodeReference): string {
	return `${node.unitId}:${node.nodeId}`;
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		fail("RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE", `${label} must be an object`);
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

function nonemptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
		fail(
			"RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE",
			`${label} must be a nonempty string without surrounding whitespace`
		);
	}
	return value;
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
