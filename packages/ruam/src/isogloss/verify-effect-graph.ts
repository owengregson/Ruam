/** Build-time verification for whole-root Isogloss effect graphs. */

import type { SemanticRootGroup } from "../compiler/ir.js";
import type {
	IsoglossBoundaryVariant,
	IsoglossEffectGraph,
} from "./effect-graph.js";

export interface IsoglossEffectGraphVerification {
	readonly valid: true;
	readonly canonicalNodeCount: number;
	readonly protectedCodeletCount: number;
	readonly verifiedVariantCount: number;
	readonly unprotectedCanonicalNodeCount: 0;
	readonly unsupportedCanonicalNodeCount: 0;
}

/**
 * Prove total canonical-node ownership and exact CFG-edge preservation.
 * Throws on the first mismatch; a partial graph never receives a certificate.
 */
export function verifyIsoglossEffectGraph(
	group: SemanticRootGroup,
	graph: IsoglossEffectGraph
): IsoglossEffectGraphVerification {
	if (graph.rootGroupId !== group.id || graph.entryUnitId !== group.entryUnitId) {
		throw new Error("RUAM_ISOGLOSS_EFFECT_GRAPH_ROOT_MISMATCH");
	}
	const canonical = new Map<string, { op: number; exits: readonly string[] }>();
	for (const unit of group.units) {
		for (const node of unit.nodes) {
			canonical.set(`${unit.id}:${node.id}`, {
				op: node.op,
				exits: Object.freeze(
					(unit.exits.get(node.id) ?? []).map((exit) =>
						exitKey(unit.id, exit)
					)
				),
			});
		}
	}
	const codeletById = new Map(
		graph.units.flatMap((unit) => unit.codelets.map((codelet) => [codelet.id, codelet] as const))
	);
	const seen = new Set<string>();
	let verifiedVariantCount = 0;
	for (const unit of graph.units) {
		for (const codelet of unit.codelets) {
			const key = `${codelet.unitId}:${codelet.canonicalNodeId}`;
			const expected = canonical.get(key);
			if (!expected || expected.op !== codelet.op || seen.has(key)) {
				throw new Error(`RUAM_ISOGLOSS_EFFECT_GRAPH_CODELET_MISMATCH: ${key}`);
			}
			seen.add(key);
			const actualExits = codelet.exits.map(
				(exit) => `${exit.kind}:${exit.targetCodeletId ?? "terminal"}`
			);
			const expectedExits = expected.exits.map((exit) => {
				const [kind, targetKey] = splitExitKey(exit);
				if (targetKey === "terminal") return `${kind}:terminal`;
				const [targetUnitId, targetNodeId] = splitNodeKey(targetKey);
				const target = graph.units
					.find((candidate) => candidate.id === targetUnitId)
					?.codelets.find(
						(candidate) => candidate.canonicalNodeId === targetNodeId
					);
				if (!target) {
					throw new Error(`RUAM_ISOGLOSS_EFFECT_GRAPH_EXIT_TARGET_MISSING: ${exit}`);
				}
				return `${kind}:${target.id}`;
			});
			if (!sameSet(actualExits, expectedExits)) {
				throw new Error(`RUAM_ISOGLOSS_EFFECT_GRAPH_EXIT_MISMATCH: ${key}`);
			}
			for (const variant of codelet.variants) {
				verifyVariant(codelet.id, variant, codeletById);
				verifiedVariantCount++;
			}
		}
	}
	if (seen.size !== canonical.size || graph.protectedCodeletCount !== canonical.size) {
		throw new Error(
			`RUAM_ISOGLOSS_EFFECT_GRAPH_INCOMPLETE: ${seen.size}/${canonical.size}`
		);
	}
	return Object.freeze({
		valid: true,
		canonicalNodeCount: canonical.size,
		protectedCodeletCount: seen.size,
		verifiedVariantCount,
		unprotectedCanonicalNodeCount: 0,
		unsupportedCanonicalNodeCount: 0,
	});
}

function verifyVariant(
	codeletId: string,
	variant: IsoglossBoundaryVariant,
	codelets: ReadonlyMap<string, unknown>
): void {
	if (
		variant.resolvedCodeletId !== codeletId ||
		variant.leftCandidates.length < 2 ||
		variant.rightCandidates.length < 2
	) {
		throw new Error(`RUAM_ISOGLOSS_EFFECT_GRAPH_VARIANT_INVALID: ${variant.id}`);
	}
	const left = new Map(
		variant.leftCandidates.map((candidate) => [candidate.codeletId, candidate])
	);
	const intersection = variant.rightCandidates.filter((candidate) =>
		left.has(candidate.codeletId)
	);
	if (
		intersection.length < 2 ||
		new Set(intersection.map((candidate) => candidate.codeletId)).size < 2
	) {
		throw new Error(`RUAM_ISOGLOSS_EFFECT_GRAPH_VARIANT_UNIQUE: ${variant.id}`);
	}
	const resolved = intersection.filter(
		(candidate) => candidate.witnessClass === variant.selectedWitnessClass
	);
	if (
		resolved.length !== 1 ||
		resolved[0]!.codeletId !== codeletId ||
		!codelets.has(codeletId)
	) {
		throw new Error(`RUAM_ISOGLOSS_EFFECT_GRAPH_WITNESS_MISMATCH: ${variant.id}`);
	}
}

function exitKey(
	unitId: string,
	exit: import("../compiler/ir.js").SemanticExit
): string {
	if ("target" in exit) return `${exit.kind}|${unitId}:${exit.target}`;
	if ("resume" in exit) return `${exit.kind}|${unitId}:${exit.resume}`;
	return `${exit.kind}|terminal`;
}

function splitExitKey(value: string): [string, string] {
	const separator = value.indexOf("|");
	return [value.slice(0, separator), value.slice(separator + 1)];
}

function splitNodeKey(value: string): [string, number] {
	const separator = value.lastIndexOf(":");
	return [value.slice(0, separator), Number(value.slice(separator + 1))];
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) return false;
	const remaining = new Set(right);
	for (const item of left) remaining.delete(item);
	return remaining.size === 0;
}
