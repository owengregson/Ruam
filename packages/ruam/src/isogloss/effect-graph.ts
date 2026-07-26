/**
 * Build-only whole-root Isogloss graph for effectful canonical semantics.
 *
 * BPRF is a specialization for finite pure relations. Every other canonical
 * semantic node is represented here as a site-specific effect codelet with
 * multiple boundary variants. This graph is deliberately not a serialized
 * instruction stream: operation identities and source origins remain owner-
 * side inputs to the emitted-codelet generator and protection verifier.
 *
 * @module isogloss/effect-graph
 */

import type {
	SemanticExit,
	SemanticRootGroup,
	SemanticUnit,
} from "../compiler/ir.js";
import type { SemanticOp } from "../compiler/semantic-ops.js";
import {
	getSemanticSignature,
	type SemanticSignature,
} from "../compiler/semantic-signatures.js";

export const ISOGLOSS_EFFECT_GRAPH_FORMAT =
	"ruam-isogloss-effect-graph-1" as const;

export interface IsoglossEffectCandidate {
	readonly codeletId: string;
	readonly witnessClass: number;
}

export interface IsoglossBoundaryVariant {
	readonly id: string;
	readonly leftCell: string;
	readonly rightCell: string;
	readonly leftCandidates: readonly IsoglossEffectCandidate[];
	readonly rightCandidates: readonly IsoglossEffectCandidate[];
	readonly selectedWitnessClass: number;
	readonly resolvedCodeletId: string;
}

export interface IsoglossEffectExit {
	readonly kind: SemanticExit["kind"];
	readonly targetCodeletId: string | null;
}

/** Owner/build-side semantic codelet before contextual source emission. */
export interface IsoglossEffectCodelet {
	readonly id: string;
	readonly unitId: string;
	readonly canonicalNodeId: number;
	readonly op: SemanticOp;
	readonly operand: number;
	readonly originId: number;
	readonly signature: SemanticSignature;
	readonly variants: readonly IsoglossBoundaryVariant[];
	readonly exits: readonly IsoglossEffectExit[];
}

export interface IsoglossEffectUnit {
	readonly id: string;
	readonly entryCodeletId: string;
	readonly codelets: readonly IsoglossEffectCodelet[];
}

export interface IsoglossEffectGraph {
	readonly format: typeof ISOGLOSS_EFFECT_GRAPH_FORMAT;
	readonly rootGroupId: string;
	readonly entryUnitId: string;
	readonly seed: number;
	readonly units: readonly IsoglossEffectUnit[];
	readonly canonicalNodeCount: number;
	readonly protectedCodeletCount: number;
}

/**
 * Lower a complete canonical root group into site-specific effect codelets.
 * No operation is filtered by purity, effect, call, throw, or suspension.
 */
export function buildIsoglossEffectGraph(
	group: SemanticRootGroup,
	seed: number
): IsoglossEffectGraph {
	if (!Number.isSafeInteger(seed)) {
		throw new Error("RUAM_ISOGLOSS_EFFECT_GRAPH_INVALID_SEED");
	}
	if (group.units.length === 0) {
		throw new Error("RUAM_ISOGLOSS_EFFECT_GRAPH_EMPTY_ROOT");
	}

	const codeletIds = new Map<string, string>();
	for (const unit of group.units) {
		for (const node of unit.nodes) {
			codeletIds.set(nodeKey(unit.id, node.id), codeletId(seed, unit.id, node.id));
		}
	}

	const units = group.units.map((unit, unitOrdinal) =>
		buildUnit(unit, unitOrdinal, seed, codeletIds)
	);
	const canonicalNodeCount = group.units.reduce(
		(total, unit) => total + unit.nodes.length,
		0
	);
	return deepFreeze({
		format: ISOGLOSS_EFFECT_GRAPH_FORMAT,
		rootGroupId: group.id,
		entryUnitId: group.entryUnitId,
		seed,
		units,
		canonicalNodeCount,
		protectedCodeletCount: units.reduce(
			(total, unit) => total + unit.codelets.length,
			0
		),
	});
}

function buildUnit(
	unit: SemanticUnit,
	unitOrdinal: number,
	seed: number,
	codeletIds: ReadonlyMap<string, string>
): IsoglossEffectUnit {
	const ownIds = unit.nodes.map((node) => requiredCodeletId(codeletIds, unit.id, node.id));
	const codelets = unit.nodes.map((node, nodeOrdinal) => {
		const id = ownIds[nodeOrdinal]!;
		const decoyId =
			ownIds.length > 1
				? ownIds[(nodeOrdinal + 1) % ownIds.length]!
				: `${id}_alias_${mix(seed, unitOrdinal, nodeOrdinal, 1).toString(36)}`;
		const secondDecoyId =
			ownIds.length > 1
				? ownIds[
						(nodeOrdinal + Math.max(1, Math.floor(ownIds.length / 2))) %
							ownIds.length
					]!
				: `${id}_alias_${mix(seed, unitOrdinal, nodeOrdinal, 2).toString(36)}`;
		const exits = (unit.exits.get(node.id) ?? []).map((exit) =>
			effectExit(unit.id, exit, codeletIds)
		);
		return Object.freeze({
			id,
			unitId: unit.id,
			canonicalNodeId: node.id,
			op: node.op,
			operand: node.operand,
			originId: node.originId,
			signature: getSemanticSignature(node.op),
			variants: Object.freeze([
				boundaryVariant(seed, unitOrdinal, nodeOrdinal, 0, id, decoyId),
				boundaryVariant(seed, unitOrdinal, nodeOrdinal, 1, id, secondDecoyId),
			]),
			exits: Object.freeze(exits),
		}) satisfies IsoglossEffectCodelet;
	});
	return Object.freeze({
		id: unit.id,
		entryCodeletId: requiredCodeletId(codeletIds, unit.id, unit.entryNode),
		codelets: Object.freeze(codelets),
	});
}

function boundaryVariant(
	seed: number,
	unitOrdinal: number,
	nodeOrdinal: number,
	variantOrdinal: number,
	intendedId: string,
	decoyId: string
): IsoglossBoundaryVariant {
	const state = mix(seed, unitOrdinal, nodeOrdinal, variantOrdinal);
	const intendedWitness = state & 0xffff;
	let decoyWitness = (state >>> 16) & 0xffff;
	if (decoyWitness === intendedWitness) decoyWitness ^= 0x5a5a;
	const candidates = Object.freeze([
		Object.freeze({ codeletId: intendedId, witnessClass: intendedWitness }),
		Object.freeze({ codeletId: decoyId, witnessClass: decoyWitness }),
	]);
	return Object.freeze({
		id: `v_${state.toString(36)}`,
		leftCell: `l_${mix(state, 0x11, 0x29, 0x43).toString(36)}`,
		rightCell: `r_${mix(state, 0x71, 0x83, 0xa7).toString(36)}`,
		leftCandidates: candidates,
		rightCandidates: Object.freeze([...candidates].reverse()),
		selectedWitnessClass: intendedWitness,
		resolvedCodeletId: intendedId,
	});
}

function effectExit(
	unitId: string,
	exit: SemanticExit,
	codeletIds: ReadonlyMap<string, string>
): IsoglossEffectExit {
	if ("target" in exit) {
		return Object.freeze({
			kind: exit.kind,
			targetCodeletId: requiredCodeletId(codeletIds, unitId, exit.target),
		});
	}
	if ("resume" in exit) {
		return Object.freeze({
			kind: exit.kind,
			targetCodeletId: requiredCodeletId(codeletIds, unitId, exit.resume),
		});
	}
	return Object.freeze({ kind: exit.kind, targetCodeletId: null });
}

function requiredCodeletId(
	ids: ReadonlyMap<string, string>,
	unitId: string,
	nodeId: number
): string {
	const id = ids.get(nodeKey(unitId, nodeId));
	if (!id) {
		throw new Error(`RUAM_ISOGLOSS_EFFECT_GRAPH_MISSING_NODE: ${unitId}:${nodeId}`);
	}
	return id;
}

function nodeKey(unitId: string, nodeId: number): string {
	return `${unitId}:${nodeId}`;
}

function codeletId(seed: number, unitId: string, nodeId: number): string {
	let state = mix(seed, nodeId, unitId.length, 0x13579bdf);
	for (let index = 0; index < unitId.length; index++) {
		state = mix(state, unitId.charCodeAt(index), index, 0x9e3779b9);
	}
	return `c_${state.toString(36)}`;
}

function mix(a: number, b: number, c: number, d: number): number {
	let value = (a ^ Math.imul(b + 1, 0x9e3779b9) ^ Math.imul(c + 1, 0x85ebca6b) ^ d) >>> 0;
	value ^= value >>> 16;
	value = Math.imul(value, 0x7feb352d) >>> 0;
	value ^= value >>> 15;
	value = Math.imul(value, 0x846ca68b) >>> 0;
	value ^= value >>> 16;
	return value >>> 0;
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value as Record<string, unknown>)) {
			deepFreeze(child);
		}
	}
	return value;
}
