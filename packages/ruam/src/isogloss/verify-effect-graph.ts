/** Build-time verification for whole-root Isogloss effect graphs. */

import type { SemanticRootGroup } from "../compiler/ir.js";
import {
	getSemanticSignature,
	type SemanticSignature,
} from "../compiler/semantic-signatures.js";
import type {
	IsoglossBoundaryVariant,
	IsoglossEffectGraph,
} from "./effect-graph.js";
import { ISOGLOSS_EFFECT_GRAPH_FORMAT } from "./effect-graph.js";

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
	if (
		graph.format !== ISOGLOSS_EFFECT_GRAPH_FORMAT ||
		!Number.isSafeInteger(graph.seed)
	) {
		throw new Error("RUAM_ISOGLOSS_EFFECT_GRAPH_FORMAT_MISMATCH");
	}
	if (graph.rootGroupId !== group.id || graph.entryUnitId !== group.entryUnitId) {
		throw new Error("RUAM_ISOGLOSS_EFFECT_GRAPH_ROOT_MISMATCH");
	}
	const canonical = new Map<
		string,
		{
			op: number;
			operand: number;
			originId: number;
			signature: SemanticSignature;
			exits: readonly string[];
		}
	>();
	const canonicalUnits = new Map(group.units.map((unit) => [unit.id, unit]));
	if (canonicalUnits.size !== group.units.length) {
		throw new Error("RUAM_ISOGLOSS_EFFECT_GRAPH_DUPLICATE_CANONICAL_UNIT");
	}
	for (const unit of group.units) {
		for (const node of unit.nodes) {
			const key = `${unit.id}:${node.id}`;
			if (canonical.has(key)) {
				throw new Error(
					`RUAM_ISOGLOSS_EFFECT_GRAPH_DUPLICATE_CANONICAL_NODE: ${key}`
				);
			}
			canonical.set(key, {
				op: node.op,
				operand: node.operand,
				originId: node.originId,
				signature: getSemanticSignature(node.op),
				exits: Object.freeze(
					(unit.exits.get(node.id) ?? []).map((exit) =>
						exitKey(unit.id, exit)
					)
				),
			});
		}
	}
	if (
		graph.canonicalNodeCount !== canonical.size ||
		graph.protectedCodeletCount !== canonical.size ||
		graph.units.length !== canonicalUnits.size
	) {
		throw new Error("RUAM_ISOGLOSS_EFFECT_GRAPH_COUNT_MISMATCH");
	}

	const graphUnitIds = new Set<string>();
	const codeletById = new Map<string, unknown>();
	const codeletByCanonicalKey = new Map<string, string>();
	for (const unit of graph.units) {
		if (graphUnitIds.has(unit.id) || !canonicalUnits.has(unit.id)) {
			throw new Error(`RUAM_ISOGLOSS_EFFECT_GRAPH_UNIT_MISMATCH: ${unit.id}`);
		}
		graphUnitIds.add(unit.id);
		for (const codelet of unit.codelets) {
			if (codelet.unitId !== unit.id || codeletById.has(codelet.id)) {
				throw new Error(
					`RUAM_ISOGLOSS_EFFECT_GRAPH_CODELET_ID_MISMATCH: ${codelet.id}`
				);
			}
			codeletById.set(codelet.id, codelet);
			codeletByCanonicalKey.set(
				`${codelet.unitId}:${codelet.canonicalNodeId}`,
				codelet.id
			);
		}
	}
	for (const [unitId, unit] of canonicalUnits) {
		const graphUnit = graph.units.find((candidate) => candidate.id === unitId);
		const expectedEntry = codeletByCanonicalKey.get(`${unitId}:${unit.entryNode}`);
		if (!graphUnit || !expectedEntry || graphUnit.entryCodeletId !== expectedEntry) {
			throw new Error(`RUAM_ISOGLOSS_EFFECT_GRAPH_ENTRY_MISMATCH: ${unitId}`);
		}
	}

	const seen = new Set<string>();
	const variantIds = new Set<string>();
	let verifiedVariantCount = 0;
	for (const unit of graph.units) {
		for (const codelet of unit.codelets) {
			const key = `${codelet.unitId}:${codelet.canonicalNodeId}`;
			const expected = canonical.get(key);
			if (
				!expected ||
				expected.op !== codelet.op ||
				expected.operand !== codelet.operand ||
				expected.originId !== codelet.originId ||
				!sameSignature(codelet.signature, expected.signature) ||
				seen.has(key)
			) {
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
			if (codelet.variants.length < 2) {
				throw new Error(
					`RUAM_ISOGLOSS_EFFECT_GRAPH_VARIANT_COVERAGE: ${codelet.id}`
				);
			}
			for (const variant of codelet.variants) {
				if (variantIds.has(variant.id)) {
					throw new Error(
						`RUAM_ISOGLOSS_EFFECT_GRAPH_VARIANT_DUPLICATE: ${variant.id}`
					);
				}
				variantIds.add(variant.id);
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

function sameSignature(
	actual: SemanticSignature,
	expected: SemanticSignature
): boolean {
	for (const key of Object.keys(expected) as (keyof SemanticSignature)[]) {
		if (actual[key] !== expected[key]) return false;
	}
	return Object.keys(actual).length === Object.keys(expected).length;
}

function verifyVariant(
	codeletId: string,
	variant: IsoglossBoundaryVariant,
	codelets: ReadonlyMap<string, unknown>
): void {
	if (
		variant.id.length === 0 ||
		variant.leftCell.length === 0 ||
		variant.rightCell.length === 0 ||
		variant.leftCell === variant.rightCell ||
		variant.resolvedCodeletId !== codeletId ||
		variant.leftCandidates.length < 2 ||
		variant.rightCandidates.length < 2
	) {
		throw new Error(`RUAM_ISOGLOSS_EFFECT_GRAPH_VARIANT_INVALID: ${variant.id}`);
	}
	const leftIds = new Set(
		variant.leftCandidates.map((candidate) => candidate.codeletId)
	);
	const rightIds = new Set(
		variant.rightCandidates.map((candidate) => candidate.codeletId)
	);
	const leftPairs = new Set(variant.leftCandidates.map(candidateKey));
	const intersection = variant.rightCandidates.filter((candidate) =>
		leftPairs.has(candidateKey(candidate))
	);
	if (
		leftIds.size !== variant.leftCandidates.length ||
		rightIds.size !== variant.rightCandidates.length ||
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

function candidateKey(candidate: {
	readonly codeletId: string;
	readonly witnessClass: number;
}): string {
	return `${candidate.codeletId}\u0000${candidate.witnessClass}`;
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
	const remaining = new Map<string, number>();
	for (const item of right) {
		remaining.set(item, (remaining.get(item) ?? 0) + 1);
	}
	for (const item of left) {
		const count = remaining.get(item);
		if (count === undefined) return false;
		if (count === 1) remaining.delete(item);
		else remaining.set(item, count - 1);
	}
	return remaining.size === 0;
}
