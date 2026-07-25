/**
 * Deterministic root-group call-boundary and SCC inventory.
 *
 * Canonical IR proves nested closure allocations through `unit-ref` operands.
 * Invocation operands still encode argument shape rather than targets, so this
 * module consumes the proof-only abstract dataflow inventory to connect a call
 * only when that closure identity reaches the exact runtime callee position.
 *
 * Treating a call operand as a unit reference would be unsound (an argument
 * count can accidentally equal a constant-pool index). Any call, construction,
 * dynamic-code, or reflective boundary without an exact dataflow fact remains
 * indirect-or-external.
 *
 * @module compiler/call-graph
 */

import type {
	SemanticInstruction,
	SemanticNodeId,
	SemanticRootGroup,
	SemanticUnit,
	SourceOrigin,
	SourceOriginId,
} from "./ir.js";
import {
	analyzeCanonicalDirectCallTargets,
	type CanonicalDirectCallTargetFact,
} from "./direct-call-targets.js";
import {
	assertCanonicalSemanticOp,
	semanticOpName,
	type SemanticOp,
} from "./semantic-ops.js";
import {
	getSemanticSignature,
	type OperandKind,
	type SemanticCallKind,
	type SemanticCoercion,
	type SemanticCompletion,
	type SemanticEffect,
	type SemanticSuspensionKind,
} from "./semantic-signatures.js";
import type { RootGroupId, SemanticUnitId } from "./types.js";

type UserCodeCallKind = Exclude<SemanticCallKind, "none">;

/** Stable source identity for one observable boundary or closure allocation. */
export interface CanonicalCallSource {
	unitId: SemanticUnitId;
	nodeId: SemanticNodeId;
	originId: SourceOriginId;
	origin: Readonly<SourceOrigin>;
}

/**
 * A nested unit identity explicitly proven by a canonical `unit-ref`.
 *
 * This is lexical allocation evidence, not evidence that the child is invoked.
 */
export interface CanonicalClosureSite extends CanonicalCallSource {
	targetUnitId: SemanticUnitId;
	op: SemanticOp;
	opName: string;
	evidence: "unit-ref-constant-and-child-membership";
}

export type CanonicalBoundaryKind =
	| "invoke"
	| "construct"
	| "dynamic-code"
	| "dynamic-module"
	| "reflection"
	| "unknown";

export type CanonicalUnresolvedCallReason =
	| "callee-identity-not-represented"
	| "constructor-identity-not-represented"
	| "runtime-generated-code"
	| "runtime-module-resolution"
	| "runtime-hook-dispatch"
	| "unknown-call-semantics";

/**
 * Observable facts later fission/lowering stages must preserve around a
 * boundary. `mayExecuteArbitraryUserCode` deliberately dominates the narrower
 * signature effects: getters, proxies, coercion hooks, and callees can touch
 * state not named by the local instruction.
 */
export interface CanonicalBoundaryObservability {
	callKind: UserCodeCallKind;
	effect: SemanticEffect;
	completion: SemanticCompletion;
	coercion: SemanticCoercion;
	suspension: SemanticSuspensionKind;
	mayThrow: boolean;
	maySuspend: boolean;
	mayExecuteArbitraryUserCode: true;
	mayReadOrWriteProgramState: true;
	mayReenterRootGroup: true;
}

export type CanonicalCallResolution =
	| {
			kind: "direct-intra-group";
			targetUnitId: SemanticUnitId;
			evidence: "exact-canonical-dataflow";
	  }
	| {
			kind: "indirect-or-external";
			reason: CanonicalUnresolvedCallReason;
	  };

/**
 * One operation which can invoke user or host-controlled code.
 *
 * The encoded operand and its kind are retained for auditing. They must not be
 * interpreted as a target unless {@link CanonicalCallResolution} carries
 * explicit target evidence.
 */
export interface CanonicalCallBoundary extends CanonicalCallSource {
	op: SemanticOp;
	opName: string;
	boundaryKind: CanonicalBoundaryKind;
	operand: number;
	operandKind: OperandKind;
	resolution: CanonicalCallResolution;
	observability: CanonicalBoundaryObservability;
}

/** A call-graph edge backed by explicit canonical target evidence. */
export interface CanonicalDirectCallEdge extends CanonicalCallSource {
	targetUnitId: SemanticUnitId;
	evidence: "exact-canonical-dataflow";
}

export interface CanonicalCallScc {
	id: string;
	unitIds: readonly SemanticUnitId[];
	incomingSccIds: readonly string[];
	outgoingSccIds: readonly string[];
	/** Proven by a self-edge or a component containing multiple units. */
	isRecursive: boolean;
	/** Proven only when the component contains multiple units. */
	isMutuallyRecursive: boolean;
	/** An unresolved boundary could dispatch back into this same unit. */
	hasUnresolvedRecursionRisk: boolean;
	/** An unresolved boundary could dispatch into another unit in the group. */
	hasUnresolvedMutualRecursionRisk: boolean;
	/** Arbitrary user code at a member boundary can reenter the protected root. */
	reentrancyRelevant: boolean;
	requiresInterproceduralFission: boolean;
}

export interface CanonicalCallGraphSummary {
	hasProvenRecursion: boolean;
	hasProvenMutualRecursion: boolean;
	hasUnresolvedRecursionRisk: boolean;
	hasUnresolvedMutualRecursionRisk: boolean;
	reentrancyRelevantSccIds: readonly string[];
	interproceduralFissionSccIds: readonly string[];
}

/**
 * Explicitly records the proof policy used to construct direct edges.
 */
export interface CanonicalCallTargetPolicy {
	mode: "canonical-evidence-only";
	directTargetRepresentation: "unit-ref-plus-exact-dataflow";
	unprovenBoundaryClassification: "indirect-or-external";
	supportedValueFlows: readonly [
		"stack",
		"register",
		"argument",
		"slot",
	];
	precisionLossBoundaries: readonly [
		"scope-chain",
		"dynamic-stack",
		"abrupt-control",
		"unsupported-aliasing",
	];
}

export interface CanonicalCallGraphInventory {
	rootGroupId: RootGroupId;
	entryUnitId: SemanticUnitId;
	unitIds: readonly SemanticUnitId[];
	targetPolicy: CanonicalCallTargetPolicy;
	closureSites: readonly CanonicalClosureSite[];
	boundaries: readonly CanonicalCallBoundary[];
	directEdges: readonly CanonicalDirectCallEdge[];
	sccs: readonly CanonicalCallScc[];
	summary: CanonicalCallGraphSummary;
}

export const CALL_GRAPH_LIMITS = Object.freeze({
	units: 2_048,
	nodes: 200_000,
	boundaries: 65_536,
});

const compilerProducedCallGraphs = new WeakSet<object>();

/** True only for an inventory constructed from canonical IR in this process. */
export function isCompilerProducedCallGraphInventory(
	value: unknown
): value is CanonicalCallGraphInventory {
	return (
		typeof value === "object" &&
		value !== null &&
		compilerProducedCallGraphs.has(value)
	);
}

/**
 * Inventory all canonical user-code boundaries and compute SCCs from only
 * direct edges whose target is explicitly represented in canonical IR.
 */
export function buildCanonicalCallGraphInventory(
	group: SemanticRootGroup
): CanonicalCallGraphInventory {
	const units = validateAndIndexGroup(group);
	const totalNodeCount = [...units.values()].reduce(
		(total, unit) => total + unit.nodes.length,
		0
	);
	if (
		units.size > CALL_GRAPH_LIMITS.units ||
		totalNodeCount > CALL_GRAPH_LIMITS.nodes
	) {
		throw new Error(
			`RUAM_CALL_GRAPH_RESOURCE_LIMIT: units:${units.size}:nodes:${totalNodeCount}`
		);
	}
	const unitIds = Object.freeze([...units.keys()].sort(compareStrings));
	const closureSites: CanonicalClosureSite[] = [];
	const boundaries: CanonicalCallBoundary[] = [];

	for (const unitId of unitIds) {
		const unit = units.get(unitId)!;
		for (const node of unit.nodes) {
			const source = sourceFor(unit, node);
			const signature = getSemanticSignature(node.op);

			if (signature.operandKind === "unit-ref") {
				closureSites.push(
					createClosureSite(unit, node, source, units)
				);
			}
		}
	}
	const targetFacts = analyzeCanonicalDirectCallTargets(group);
	const targetFactsByUnit = new Map<
		SemanticUnitId,
		Map<SemanticNodeId, CanonicalDirectCallTargetFact>
	>();
	for (const fact of targetFacts.facts) {
		let factsByNode = targetFactsByUnit.get(fact.sourceUnitId);
		if (!factsByNode) {
			factsByNode = new Map();
			targetFactsByUnit.set(fact.sourceUnitId, factsByNode);
		}
		if (factsByNode.has(fact.sourceNodeId)) {
			throw new Error(
				`RUAM_DUPLICATE_DIRECT_CALL_TARGET_FACT: ${fact.sourceUnitId}:${fact.sourceNodeId}`
			);
		}
		factsByNode.set(fact.sourceNodeId, fact);
	}
	for (const unitId of unitIds) {
		const unit = units.get(unitId)!;
		for (const node of unit.nodes) {
			const source = sourceFor(unit, node);
			const signature = getSemanticSignature(node.op);
			if (signature.callKind !== "none") {
				boundaries.push(
					createBoundary(
						node,
						source,
						signature.callKind,
						targetFactsByUnit.get(unit.id)?.get(node.id)
					)
				);
			}
		}
	}
	if (boundaries.length > CALL_GRAPH_LIMITS.boundaries) {
		throw new Error(
			`RUAM_CALL_GRAPH_RESOURCE_LIMIT: boundaries:${boundaries.length}`
		);
	}

	closureSites.sort(compareSources);
	boundaries.sort(compareSources);

	const directEdges = Object.freeze(
		boundaries
			.flatMap((boundary): CanonicalDirectCallEdge[] => {
				if (boundary.resolution.kind !== "direct-intra-group") return [];
				return [
					Object.freeze({
						unitId: boundary.unitId,
						nodeId: boundary.nodeId,
						originId: boundary.originId,
						origin: boundary.origin,
						targetUnitId: boundary.resolution.targetUnitId,
						evidence: boundary.resolution.evidence,
					}),
				];
			})
			.sort(compareEdges)
	);
	const sccs = buildDeterministicSccs(unitIds, directEdges, boundaries);
	const summary = summarizeSccs(sccs);

	const inventory = Object.freeze({
		rootGroupId: group.id,
		entryUnitId: group.entryUnitId,
		unitIds,
		targetPolicy: Object.freeze({
			mode: "canonical-evidence-only",
			directTargetRepresentation: "unit-ref-plus-exact-dataflow",
			unprovenBoundaryClassification: "indirect-or-external",
			supportedValueFlows: Object.freeze([
				"stack",
				"register",
				"argument",
				"slot",
			] as const),
			precisionLossBoundaries: Object.freeze([
				"scope-chain",
				"dynamic-stack",
				"abrupt-control",
				"unsupported-aliasing",
			] as const),
		}),
		closureSites: Object.freeze(closureSites),
		boundaries: Object.freeze(boundaries),
		directEdges,
		sccs,
		summary,
	});
	compilerProducedCallGraphs.add(inventory);
	return inventory;
}

function validateAndIndexGroup(
	group: SemanticRootGroup
): Map<SemanticUnitId, SemanticUnit> {
	if (group.units.length === 0) {
		throw new Error(`RUAM_EMPTY_SEMANTIC_ROOT_GROUP: ${group.id}`);
	}

	const units = new Map<SemanticUnitId, SemanticUnit>();
	for (const unit of group.units) {
		if (units.has(unit.id)) {
			throw new Error(`RUAM_DUPLICATE_SEMANTIC_UNIT: ${unit.id}`);
		}
		if (unit.rootGroupId !== group.id) {
			throw new Error(
				`RUAM_CALL_GRAPH_ROOT_GROUP_MISMATCH: ${unit.id} belongs to ${unit.rootGroupId}, expected ${group.id}`
			);
		}
		units.set(unit.id, unit);
	}

	if (!units.has(group.entryUnitId)) {
		throw new Error(
			`RUAM_MISSING_CALL_GRAPH_ENTRY_UNIT: ${group.entryUnitId}`
		);
	}

	for (const unit of units.values()) {
		validateUnit(unit, units);
	}
	return units;
}

function validateUnit(
	unit: SemanticUnit,
	units: ReadonlyMap<SemanticUnitId, SemanticUnit>
): void {
	if (unit.nodes.length === 0) {
		throw new Error(`RUAM_EMPTY_CALL_GRAPH_UNIT: ${unit.id}`);
	}
	if (
		!Number.isSafeInteger(unit.entryNode) ||
		unit.entryNode < 0 ||
		unit.entryNode >= unit.nodes.length
	) {
		throw new Error(
			`RUAM_INVALID_CALL_GRAPH_ENTRY_NODE: ${unit.id}:${unit.entryNode}`
		);
	}

	const childIds = new Set<SemanticUnitId>();
	for (const childId of unit.childUnitIds) {
		if (childIds.has(childId)) {
			throw new Error(
				`RUAM_DUPLICATE_CALL_GRAPH_CHILD: ${unit.id} -> ${childId}`
			);
		}
		childIds.add(childId);
		if (!units.has(childId)) {
			throw new Error(
				`RUAM_UNKNOWN_CALL_GRAPH_CHILD: ${unit.id} -> ${childId}`
			);
		}
	}

	for (let index = 0; index < unit.nodes.length; index++) {
		const node = unit.nodes[index]!;
		assertCanonicalSemanticOp(node.op);
		if (node.id !== index) {
			throw new Error(
				`RUAM_NONDETERMINISTIC_CALL_GRAPH_NODE_ORDER: ${unit.id}:${node.id} at ${index}`
			);
		}
		if (!Number.isSafeInteger(node.operand)) {
			throw new Error(
				`RUAM_INVALID_CALL_GRAPH_OPERAND: ${unit.id}:${node.id}`
			);
		}
		if (
			!Number.isSafeInteger(node.originId) ||
			node.originId < 0 ||
			node.originId >= unit.origins.length
		) {
			throw new Error(
				`RUAM_MISSING_CALL_GRAPH_ORIGIN: ${unit.id}:${node.id}`
			);
		}
		if (!unit.exits.has(node.id)) {
			throw new Error(
				`RUAM_MISSING_CALL_GRAPH_EXITS: ${unit.id}:${node.id}`
			);
		}
	}
}

function sourceFor(
	unit: SemanticUnit,
	node: SemanticInstruction
): CanonicalCallSource {
	const origin = unit.origins[node.originId]!;
	return Object.freeze({
		unitId: unit.id,
		nodeId: node.id,
		originId: node.originId,
		origin: Object.freeze({ ...origin }),
	});
}

function createClosureSite(
	unit: SemanticUnit,
	node: SemanticInstruction,
	source: CanonicalCallSource,
	units: ReadonlyMap<SemanticUnitId, SemanticUnit>
): CanonicalClosureSite {
	const constant = unit.constants[node.operand];
	if (constant?.type !== "string") {
		throw new Error(
			`RUAM_INVALID_CANONICAL_UNIT_REF: ${unit.id}:${node.id} operand ${node.operand}`
		);
	}
	const targetUnitId = constant.value;
	if (!units.has(targetUnitId)) {
		throw new Error(
			`RUAM_UNKNOWN_CANONICAL_UNIT_REF: ${unit.id}:${node.id} -> ${targetUnitId}`
		);
	}
	if (!unit.childUnitIds.includes(targetUnitId)) {
		throw new Error(
			`RUAM_NON_CHILD_CANONICAL_UNIT_REF: ${unit.id}:${node.id} -> ${targetUnitId}`
		);
	}

	return Object.freeze({
		...source,
		targetUnitId,
		op: node.op,
		opName: semanticOpName(node.op),
		evidence: "unit-ref-constant-and-child-membership",
	});
}

function createBoundary(
	node: SemanticInstruction,
	source: CanonicalCallSource,
	callKind: UserCodeCallKind,
	targetFact: CanonicalDirectCallTargetFact | undefined
): CanonicalCallBoundary {
	const signature = getSemanticSignature(node.op);
	return Object.freeze({
		...source,
		op: node.op,
		opName: semanticOpName(node.op),
		boundaryKind: boundaryKindFor(callKind),
		operand: node.operand,
		operandKind: signature.operandKind,
		resolution: targetFact
			? Object.freeze({
					kind: "direct-intra-group",
					targetUnitId: targetFact.targetUnitId,
					evidence: targetFact.evidence,
				})
			: Object.freeze({
					kind: "indirect-or-external",
					reason: unresolvedReasonFor(callKind),
				}),
		observability: Object.freeze({
			callKind,
			effect: signature.effect,
			completion: signature.completion,
			coercion: signature.coercion,
			suspension: signature.suspension,
			mayThrow: signature.mayThrow,
			maySuspend:
				signature.suspension !== "none" ||
				callKind === "dynamic-import",
			mayExecuteArbitraryUserCode: true,
			mayReadOrWriteProgramState: true,
			mayReenterRootGroup: true,
		}),
	});
}

function boundaryKindFor(
	callKind: UserCodeCallKind
): CanonicalBoundaryKind {
	switch (callKind) {
		case "invoke":
			return "invoke";
		case "construct":
			return "construct";
		case "direct-eval":
			return "dynamic-code";
		case "dynamic-import":
			return "dynamic-module";
		case "coercion-hook":
		case "host-protocol":
			return "reflection";
		case "unknown":
			return "unknown";
	}
}

function unresolvedReasonFor(
	callKind: UserCodeCallKind
): CanonicalUnresolvedCallReason {
	switch (callKind) {
		case "invoke":
			return "callee-identity-not-represented";
		case "construct":
			return "constructor-identity-not-represented";
		case "direct-eval":
			return "runtime-generated-code";
		case "dynamic-import":
			return "runtime-module-resolution";
		case "coercion-hook":
		case "host-protocol":
			return "runtime-hook-dispatch";
		case "unknown":
			return "unknown-call-semantics";
	}
}

function buildDeterministicSccs(
	unitIds: readonly SemanticUnitId[],
	edges: readonly CanonicalDirectCallEdge[],
	boundaries: readonly CanonicalCallBoundary[]
): readonly CanonicalCallScc[] {
	const adjacencySets = new Map<SemanticUnitId, Set<SemanticUnitId>>(
		unitIds.map((unitId) => [unitId, new Set()])
	);
	for (const edge of edges) {
		const targets = adjacencySets.get(edge.unitId);
		if (!targets || !adjacencySets.has(edge.targetUnitId)) {
			throw new Error(
				`RUAM_CALL_GRAPH_EDGE_OUTSIDE_GROUP: ${edge.unitId} -> ${edge.targetUnitId}`
			);
		}
		targets.add(edge.targetUnitId);
	}
	const adjacency = new Map<SemanticUnitId, readonly SemanticUnitId[]>(
		[...adjacencySets].map(([unitId, targets]) => [
			unitId,
			Object.freeze([...targets].sort(compareStrings)),
		])
	);

	let nextIndex = 0;
	const indexByUnit = new Map<SemanticUnitId, number>();
	const lowLinkByUnit = new Map<SemanticUnitId, number>();
	const stack: SemanticUnitId[] = [];
	const onStack = new Set<SemanticUnitId>();
	const components: SemanticUnitId[][] = [];

	const visit = (unitId: SemanticUnitId): void => {
		const index = nextIndex++;
		indexByUnit.set(unitId, index);
		lowLinkByUnit.set(unitId, index);
		stack.push(unitId);
		onStack.add(unitId);

		for (const targetId of adjacency.get(unitId)!) {
			if (!indexByUnit.has(targetId)) {
				visit(targetId);
				lowLinkByUnit.set(
					unitId,
					Math.min(
						lowLinkByUnit.get(unitId)!,
						lowLinkByUnit.get(targetId)!
					)
				);
			} else if (onStack.has(targetId)) {
				lowLinkByUnit.set(
					unitId,
					Math.min(
						lowLinkByUnit.get(unitId)!,
						indexByUnit.get(targetId)!
					)
				);
			}
		}

		if (lowLinkByUnit.get(unitId) !== indexByUnit.get(unitId)) return;
		const component: SemanticUnitId[] = [];
		while (stack.length > 0) {
			const member = stack.pop()!;
			onStack.delete(member);
			component.push(member);
			if (member === unitId) break;
		}
		component.sort(compareStrings);
		components.push(component);
	};

	for (const unitId of unitIds) {
		if (!indexByUnit.has(unitId)) visit(unitId);
	}
	components.sort(compareComponents);

	const sccIdByUnit = new Map<SemanticUnitId, string>();
	const sccIds = components.map((_, index) => `scc_${index}`);
	for (let index = 0; index < components.length; index++) {
		for (const unitId of components[index]!) {
			sccIdByUnit.set(unitId, sccIds[index]!);
		}
	}

	const incomingByScc = new Map<string, Set<string>>();
	const outgoingByScc = new Map<string, Set<string>>();
	const selfEdgeByScc = new Set<string>();
	const unresolvedByScc = new Set<string>();
	const reentryByScc = new Set<string>();
	for (const id of sccIds) {
		incomingByScc.set(id, new Set());
		outgoingByScc.set(id, new Set());
	}
	for (const edge of edges) {
		const sourceSccId = sccIdByUnit.get(edge.unitId)!;
		const targetSccId = sccIdByUnit.get(edge.targetUnitId)!;
		if (sourceSccId === targetSccId) {
			if (edge.unitId === edge.targetUnitId) {
				selfEdgeByScc.add(sourceSccId);
			}
			continue;
		}
		outgoingByScc.get(sourceSccId)!.add(targetSccId);
		incomingByScc.get(targetSccId)!.add(sourceSccId);
	}
	for (const boundary of boundaries) {
		const id = sccIdByUnit.get(boundary.unitId)!;
		if (boundary.resolution.kind === "indirect-or-external") {
			unresolvedByScc.add(id);
		}
		if (boundary.observability.mayReenterRootGroup) {
			reentryByScc.add(id);
		}
	}

	return Object.freeze(
		components.map((component, index) => {
			const id = sccIds[index]!;
			const incoming = incomingByScc.get(id)!;
			const outgoing = outgoingByScc.get(id)!;
			const hasSelfEdge = selfEdgeByScc.has(id);
			const unresolved = unresolvedByScc.has(id);
			const reentrancyRelevant = reentryByScc.has(id);
			const isMutuallyRecursive = component.length > 1;
			const isRecursive = isMutuallyRecursive || hasSelfEdge;
			const hasUnresolvedRecursionRisk = unresolved;
			const hasUnresolvedMutualRecursionRisk =
				unresolved && unitIds.length > 1;

			return Object.freeze({
				id,
				unitIds: Object.freeze(component.slice()),
				incomingSccIds: Object.freeze(
					[...incoming].sort(compareStrings)
				),
				outgoingSccIds: Object.freeze(
					[...outgoing].sort(compareStrings)
				),
				isRecursive,
				isMutuallyRecursive,
				hasUnresolvedRecursionRisk,
				hasUnresolvedMutualRecursionRisk,
				reentrancyRelevant,
				requiresInterproceduralFission:
					isRecursive || reentrancyRelevant,
			});
		})
	);
}

function summarizeSccs(
	sccs: readonly CanonicalCallScc[]
): CanonicalCallGraphSummary {
	return Object.freeze({
		hasProvenRecursion: sccs.some((scc) => scc.isRecursive),
		hasProvenMutualRecursion: sccs.some(
			(scc) => scc.isMutuallyRecursive
		),
		hasUnresolvedRecursionRisk: sccs.some(
			(scc) => scc.hasUnresolvedRecursionRisk
		),
		hasUnresolvedMutualRecursionRisk: sccs.some(
			(scc) => scc.hasUnresolvedMutualRecursionRisk
		),
		reentrancyRelevantSccIds: Object.freeze(
			sccs
				.filter((scc) => scc.reentrancyRelevant)
				.map((scc) => scc.id)
		),
		interproceduralFissionSccIds: Object.freeze(
			sccs
				.filter((scc) => scc.requiresInterproceduralFission)
				.map((scc) => scc.id)
		),
	});
}

function compareSources(
	left: CanonicalCallSource,
	right: CanonicalCallSource
): number {
	return (
		compareStrings(left.unitId, right.unitId) ||
		left.nodeId - right.nodeId
	);
}

function compareEdges(
	left: CanonicalDirectCallEdge,
	right: CanonicalDirectCallEdge
): number {
	return (
		compareSources(left, right) ||
		compareStrings(left.targetUnitId, right.targetUnitId)
	);
}

function compareComponents(
	left: readonly SemanticUnitId[],
	right: readonly SemanticUnitId[]
): number {
	for (let index = 0; index < Math.min(left.length, right.length); index++) {
		const comparison = compareStrings(left[index]!, right[index]!);
		if (comparison !== 0) return comparison;
	}
	return left.length - right.length;
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
