/**
 * Conservative effect-delimited regions over canonical semantic control flow.
 *
 * Regions are a compiler artifact. They retain canonical node ownership for
 * verification, but production BPRF lowering must not publish these identities.
 * Fusion fails closed at every observable, exceptional, dynamic-stack, call,
 * suspension, branch, join, or structured-completion boundary.
 *
 * @module compiler/regions
 */

import type { CanonicalCfg } from "./cfg.js";
import type {
	SemanticExit,
	SemanticInstruction,
	SemanticNodeId,
	SemanticUnit,
} from "./ir.js";
import {
	getSemanticSignature,
	resolveStackArity,
	type ResolvedStackArity,
	type SemanticAccess,
	type SemanticAllocation,
	type SemanticCallKind,
	type SemanticCoercion,
	type SemanticCompletion,
	type SemanticEffect,
	type SemanticPurity,
	type SemanticSignature,
	type SemanticSuspensionKind,
	type SemanticThrowBehavior,
} from "./semantic-signatures.js";

export type EffectRegionId = string;

export type RegionStateDomain =
	| "register"
	| "argument"
	| "slot"
	| "frame"
	| "scope"
	| "object"
	| "global"
	| "this";

/** One state dependency crossing a region boundary. */
export interface RegionStatePort {
	domain: RegionStateDomain;
	/** Known register, argument, slot, or constant-pool name index. */
	key?: number;
}

/** Stack and non-stack dependencies crossing one side of a region. */
export interface RegionBoundaryContract {
	stack: ResolvedStackArity;
	state: readonly RegionStatePort[];
}

/** Aggregate effect facts for a complete region. */
export interface RegionEffectSummary {
	effects: readonly SemanticEffect[];
	purity: SemanticPurity;
	throwBehavior: SemanticThrowBehavior;
	coercions: readonly SemanticCoercion[];
	callKinds: readonly SemanticCallKind[];
	suspensions: readonly SemanticSuspensionKind[];
	frameAccess: SemanticAccess;
	scopeAccess: SemanticAccess;
	objectAccess: SemanticAccess;
	globalAccess: SemanticAccess;
	allocations: readonly SemanticAllocation[];
	completions: readonly SemanticCompletion[];
	readsThis: boolean;
	hasDynamicStack: boolean;
}

interface RegionExitBase {
	sourceNodeId: SemanticNodeId;
}

/** Typed transfer between effect regions or out of the current invocation. */
export type EffectRegionExit =
	| (RegionExitBase & {
			kind:
				| "fallthrough"
				| "branch-true"
				| "branch-false"
				| "exception"
				| "finally";
			targetNodeId: SemanticNodeId;
			targetRegionId: EffectRegionId;
	  })
	| (RegionExitBase & {
			kind: "call" | "yield" | "await";
			resumeNodeId: SemanticNodeId;
			resumeRegionId: EffectRegionId;
	  })
	| (RegionExitBase & { kind: "return" | "throw" });

export interface EffectRegion {
	id: EffectRegionId;
	entryNodeId: SemanticNodeId;
	nodeIds: readonly SemanticNodeId[];
	inputs: RegionBoundaryContract;
	outputs: RegionBoundaryContract;
	effects: RegionEffectSummary;
	exits: readonly EffectRegionExit[];
}

export interface EffectRegionGraph {
	/** Present when constructed from a SemanticUnit rather than a bare CFG. */
	unitId: string | null;
	entryRegionId: EffectRegionId;
	regions: readonly EffectRegion[];
	nodeOwnership: ReadonlyMap<SemanticNodeId, EffectRegionId>;
}

type RegionGraphInput = Pick<
	CanonicalCfg,
	"nodes" | "exits" | "entryNode"
> & { id?: string };

interface Predecessor {
	source: SemanticNodeId;
	exit: SemanticExit;
}

const PURITY_ORDER: readonly SemanticPurity[] = [
	"pure",
	"frame-local",
	"observable",
];
const THROW_ORDER: readonly SemanticThrowBehavior[] = [
	"never",
	"may-throw",
	"always-throws",
];
const ACCESS_ORDER: readonly SemanticAccess[] = [
	"none",
	"read",
	"write",
	"read-write",
	"unknown",
];

/** Build and validate deterministic effect-delimited regions. */
export function buildEffectRegionGraph(
	input: CanonicalCfg | SemanticUnit
): EffectRegionGraph {
	const graphInput = input as RegionGraphInput;
	const nodes = validateAndIndexInput(graphInput);
	const predecessors = buildPredecessors(graphInput, nodes);
	const orderedNodeIds = [...nodes.keys()].sort((left, right) => left - right);
	const ownership = new Map<SemanticNodeId, EffectRegionId>();
	const nodeGroups: SemanticNodeId[][] = [];

	for (const nodeId of orderedNodeIds) {
		if (ownership.has(nodeId)) continue;

		const group = [nodeId];
		let current = nodeId;
		while (true) {
			const next = fusionSuccessor(
				current,
				graphInput,
				nodes,
				predecessors,
				ownership
			);
			if (next == null) break;
			group.push(next);
			current = next;
		}

		const regionId = regionIdFor(group[0]!);
		for (const ownedNodeId of group) {
			if (ownership.has(ownedNodeId)) {
				throw new Error(
					`RUAM_DUPLICATE_REGION_OWNER: node ${ownedNodeId}`
				);
			}
			ownership.set(ownedNodeId, regionId);
		}
		nodeGroups.push(group);
	}

	const regions = nodeGroups.map((nodeIds) => {
		const id = ownership.get(nodeIds[0]!)!;
		const regionNodes = nodeIds.map((nodeId) => nodes.get(nodeId)!);
		const boundary = computeBoundaryContracts(regionNodes);
		const lastNodeId = nodeIds[nodeIds.length - 1]!;
		const semanticExits = graphInput.exits.get(lastNodeId);
		if (!semanticExits) {
			throw new Error(`RUAM_MISSING_SEMANTIC_EXITS: node ${lastNodeId}`);
		}
		const exits = semanticExits.map((exit) =>
			mapRegionExit(lastNodeId, exit, ownership)
		);

		return Object.freeze({
			id,
			entryNodeId: nodeIds[0]!,
			nodeIds: Object.freeze(nodeIds.slice()),
			inputs: boundary.inputs,
			outputs: boundary.outputs,
			effects: summarizeEffects(regionNodes),
			exits: Object.freeze(exits),
		});
	});

	const entryRegionId = ownership.get(graphInput.entryNode);
	if (!entryRegionId) {
		throw new Error(
			`RUAM_MISSING_ENTRY_REGION: node ${graphInput.entryNode}`
		);
	}

	const graph: EffectRegionGraph = Object.freeze({
		unitId: typeof graphInput.id === "string" ? graphInput.id : null,
		entryRegionId,
		regions: Object.freeze(regions),
		nodeOwnership: ownership,
	});
	validateEffectRegionGraph(graphInput, graph);
	return graph;
}

/**
 * Recheck ownership, boundary, and transfer invariants.
 *
 * Exposed so certificate/verifier work can validate deserialized owner-side
 * region graphs without trusting their builder.
 */
export function validateEffectRegionGraph(
	input: Pick<CanonicalCfg, "nodes" | "exits" | "entryNode">,
	graph: EffectRegionGraph
): void {
	const graphInput = input as RegionGraphInput;
	const nodes = validateAndIndexInput(graphInput);
	const predecessors = buildPredecessors(graphInput, nodes);
	const seen = new Set<SemanticNodeId>();
	const regionIds = new Set<EffectRegionId>();
	let previousEntryNodeId = -1;

	for (const region of graph.regions) {
		if (regionIds.has(region.id)) {
			throw new Error(`RUAM_DUPLICATE_REGION_ID: ${region.id}`);
		}
		regionIds.add(region.id);
		if (region.nodeIds.length === 0) {
			throw new Error(`RUAM_EMPTY_EFFECT_REGION: ${region.id}`);
		}
		if (region.id !== regionIdFor(region.nodeIds[0]!)) {
			throw new Error(`RUAM_NONDETERMINISTIC_REGION_ID: ${region.id}`);
		}
		if (region.entryNodeId !== region.nodeIds[0]) {
			throw new Error(`RUAM_INVALID_REGION_ENTRY: ${region.id}`);
		}
		if (region.entryNodeId <= previousEntryNodeId) {
			throw new Error("RUAM_NONDETERMINISTIC_REGION_ORDER");
		}
		previousEntryNodeId = region.entryNodeId;

		for (let index = 0; index < region.nodeIds.length; index++) {
			const nodeId = region.nodeIds[index]!;
			if (!nodes.has(nodeId)) {
				throw new Error(`RUAM_UNKNOWN_REGION_NODE: ${nodeId}`);
			}
			if (seen.has(nodeId)) {
				throw new Error(`RUAM_DUPLICATE_REGION_OWNER: node ${nodeId}`);
			}
			seen.add(nodeId);
			if (graph.nodeOwnership.get(nodeId) !== region.id) {
				throw new Error(`RUAM_REGION_OWNERSHIP_MISMATCH: node ${nodeId}`);
			}

			const next = region.nodeIds[index + 1];
			if (next != null) {
				const exits = graphInput.exits.get(nodeId)!;
				if (
					exits.length !== 1 ||
					exits[0]!.kind !== "fallthrough" ||
					exits[0]!.target !== next
				) {
					throw new Error(
						`RUAM_REGION_CROSSES_CONTROL_BOUNDARY: ${region.id}`
					);
				}
				if (
					isFusionBarrier(
						nodes.get(nodeId)!,
						exits,
						predecessors.get(nodeId)!,
						graphInput.entryNode
					) ||
					isFusionBarrier(
						nodes.get(next)!,
						graphInput.exits.get(next)!,
						predecessors.get(next)!,
						graphInput.entryNode
					)
				) {
					throw new Error(
						`RUAM_REGION_CROSSES_EFFECT_BOUNDARY: ${region.id}`
					);
				}
			}
		}

		const regionNodes = region.nodeIds.map((nodeId) => nodes.get(nodeId)!);
		const expectedBoundary = computeBoundaryContracts(regionNodes);
		if (
			!structurallyEqual(region.inputs, expectedBoundary.inputs) ||
			!structurallyEqual(region.outputs, expectedBoundary.outputs) ||
			!structurallyEqual(region.effects, summarizeEffects(regionNodes))
		) {
			throw new Error(`RUAM_INVALID_REGION_CONTRACT: ${region.id}`);
		}
		const lastNodeId = region.nodeIds[region.nodeIds.length - 1]!;
		const expectedExits = graphInput.exits
			.get(lastNodeId)!
			.map((exit) =>
				mapRegionExit(lastNodeId, exit, graph.nodeOwnership)
			);
		if (!structurallyEqual(region.exits, expectedExits)) {
			throw new Error(`RUAM_REGION_EXIT_MISMATCH: ${region.id}`);
		}
	}

	if (seen.size !== nodes.size) {
		throw new Error(
			`RUAM_INCOMPLETE_REGION_OWNERSHIP: ${seen.size} of ${nodes.size}`
		);
	}
	if (graph.nodeOwnership.size !== nodes.size) {
		throw new Error("RUAM_INVALID_REGION_OWNERSHIP_SIZE");
	}
	for (const nodeId of graph.nodeOwnership.keys()) {
		if (!nodes.has(nodeId)) {
			throw new Error(`RUAM_OWNER_FOR_UNKNOWN_NODE: ${nodeId}`);
		}
	}
	if (graph.entryRegionId !== graph.nodeOwnership.get(graphInput.entryNode)) {
		throw new Error("RUAM_ENTRY_REGION_MISMATCH");
	}

	for (const region of graph.regions) {
		for (const exit of region.exits) {
			if (
				"targetRegionId" in exit &&
				!regionIds.has(exit.targetRegionId)
			) {
				throw new Error(
					`RUAM_UNKNOWN_TARGET_REGION: ${exit.targetRegionId}`
				);
			}
			if (
				"resumeRegionId" in exit &&
				!regionIds.has(exit.resumeRegionId)
			) {
				throw new Error(
					`RUAM_UNKNOWN_RESUME_REGION: ${exit.resumeRegionId}`
				);
			}
		}
	}
}

function validateAndIndexInput(
	input: RegionGraphInput
): Map<SemanticNodeId, SemanticInstruction> {
	if (input.nodes.length === 0) {
		throw new Error("RUAM_EMPTY_SEMANTIC_UNIT");
	}
	const nodes = new Map<SemanticNodeId, SemanticInstruction>();
	for (const node of input.nodes) {
		if (!Number.isSafeInteger(node.id) || node.id < 0) {
			throw new Error(`RUAM_INVALID_SEMANTIC_NODE_ID: ${node.id}`);
		}
		if (nodes.has(node.id)) {
			throw new Error(`RUAM_DUPLICATE_SEMANTIC_NODE_ID: ${node.id}`);
		}
		nodes.set(node.id, node);
		if (!input.exits.has(node.id)) {
			throw new Error(`RUAM_MISSING_SEMANTIC_EXITS: node ${node.id}`);
		}
	}
	if (!nodes.has(input.entryNode)) {
		throw new Error(`RUAM_INVALID_SEMANTIC_ENTRY: ${input.entryNode}`);
	}
	for (const [nodeId, exits] of input.exits) {
		if (!nodes.has(nodeId)) {
			throw new Error(`RUAM_EXITS_FOR_UNKNOWN_NODE: ${nodeId}`);
		}
		for (const exit of exits) {
			const target = semanticExitTarget(exit);
			if (target != null && !nodes.has(target)) {
				throw new Error(
					`RUAM_INVALID_SEMANTIC_TARGET: node ${nodeId} -> ${target}`
				);
			}
		}
	}
	return nodes;
}

function buildPredecessors(
	input: RegionGraphInput,
	nodes: ReadonlyMap<SemanticNodeId, SemanticInstruction>
): Map<SemanticNodeId, Predecessor[]> {
	const predecessors = new Map<SemanticNodeId, Predecessor[]>();
	for (const nodeId of nodes.keys()) predecessors.set(nodeId, []);
	for (const [source, exits] of input.exits) {
		for (const exit of exits) {
			const target = semanticExitTarget(exit);
			if (target == null) continue;
			predecessors.get(target)!.push({ source, exit });
		}
	}
	for (const entries of predecessors.values()) {
		entries.sort(
			(left, right) =>
				left.source - right.source ||
				left.exit.kind.localeCompare(right.exit.kind)
		);
	}
	return predecessors;
}

function fusionSuccessor(
	nodeId: SemanticNodeId,
	input: RegionGraphInput,
	nodes: ReadonlyMap<SemanticNodeId, SemanticInstruction>,
	predecessors: ReadonlyMap<SemanticNodeId, readonly Predecessor[]>,
	ownership: ReadonlyMap<SemanticNodeId, EffectRegionId>
): SemanticNodeId | null {
	const node = nodes.get(nodeId)!;
	const exits = input.exits.get(nodeId)!;
	if (
		isFusionBarrier(
			node,
			exits,
			predecessors.get(nodeId)!,
			input.entryNode
		)
	) {
		return null;
	}
	if (exits.length !== 1 || exits[0]!.kind !== "fallthrough") return null;

	const target = exits[0]!.target;
	if (ownership.has(target)) return null;
	const targetNode = nodes.get(target)!;
	const targetPredecessors = predecessors.get(target)!;
	if (
		targetPredecessors.length !== 1 ||
		targetPredecessors[0]!.source !== nodeId
	) {
		return null;
	}
	if (
		isFusionBarrier(
			targetNode,
			input.exits.get(target)!,
			targetPredecessors,
			input.entryNode
		)
	) {
		return null;
	}
	return target;
}

function isFusionBarrier(
	node: SemanticInstruction,
	exits: readonly SemanticExit[],
	predecessors: readonly Predecessor[],
	entryNode: SemanticNodeId
): boolean {
	const signature = getSemanticSignature(node.op);
	const stackInput = resolveStackArity(signature.stackInput, node.operand);
	const stackOutput = resolveStackArity(signature.stackOutput, node.operand);
	if (stackInput === "dynamic" || stackOutput === "dynamic") return true;
	if (signature.precision !== "classified") return true;
	if (signature.purity === "observable") return true;
	if (signature.throwBehavior !== "never") return true;
	if (
		signature.coercion === "observable" ||
		signature.coercion === "unknown"
	) {
		return true;
	}
	if (signature.callKind !== "none") return true;
	if (signature.suspension !== "none") return true;
	if (signature.scopeAccess !== "none") return true;
	if (signature.objectAccess !== "none") return true;
	if (signature.globalAccess !== "none") return true;
	if (signature.allocation !== "none") return true;
	if (signature.frameAccess === "unknown") return true;
	if (signature.completion !== "normal") return true;
	if (
		exits.length !== 1 ||
		exits[0]!.kind !== "fallthrough"
	) {
		return true;
	}
	if (node.id === entryNode) {
		return predecessors.length !== 0;
	}
	if (predecessors.length !== 1) return true;
	return predecessors.some(
		(predecessor) =>
			predecessor.exit.kind === "exception" ||
			predecessor.exit.kind === "finally"
	);
}

function computeBoundaryContracts(
	nodes: readonly SemanticInstruction[]
): {
	inputs: RegionBoundaryContract;
	outputs: RegionBoundaryContract;
} {
	let stackDepth = 0;
	let requiredStack = 0;
	let dynamicStack = false;
	const stateInputs = new Map<string, RegionStatePort>();
	const stateOutputs = new Map<string, RegionStatePort>();
	const writtenState = new Set<string>();

	for (const node of nodes) {
		const signature = getSemanticSignature(node.op);
		const stackInput = resolveStackArity(signature.stackInput, node.operand);
		const stackOutput = resolveStackArity(signature.stackOutput, node.operand);
		if (stackInput === "dynamic" || stackOutput === "dynamic") {
			dynamicStack = true;
		} else if (!dynamicStack) {
			requiredStack = Math.max(requiredStack, stackInput - stackDepth);
			stackDepth += stackOutput - stackInput;
		}

		for (const access of stateAccesses(node, signature)) {
			const key = statePortKey(access.port);
			if (
				(access.access === "read" ||
					access.access === "read-write" ||
					access.access === "unknown") &&
				!writtenState.has(key)
			) {
				stateInputs.set(key, access.port);
			}
			if (
				access.access === "write" ||
				access.access === "read-write" ||
				access.access === "unknown"
			) {
				writtenState.add(key);
				stateOutputs.set(key, access.port);
			}
		}
	}

	const outputStack = dynamicStack
		? "dynamic"
		: requiredStack + stackDepth;
	if (outputStack !== "dynamic" && outputStack < 0) {
		throw new Error("RUAM_NEGATIVE_REGION_STACK_OUTPUT");
	}

	return {
		inputs: Object.freeze({
			stack: dynamicStack ? "dynamic" : requiredStack,
			state: Object.freeze(sortStatePorts(stateInputs.values())),
		}),
		outputs: Object.freeze({
			stack: outputStack,
			state: Object.freeze(sortStatePorts(stateOutputs.values())),
		}),
	};
}

function stateAccesses(
	node: SemanticInstruction,
	signature: SemanticSignature
): Array<{ access: SemanticAccess; port: RegionStatePort }> {
	const result: Array<{ access: SemanticAccess; port: RegionStatePort }> = [];
	if (signature.frameAccess !== "none") {
		const domain: RegionStateDomain =
			signature.operandKind === "register"
				? "register"
				: signature.operandKind === "argument"
					? "argument"
					: signature.operandKind === "slot"
						? "slot"
						: "frame";
		result.push({
			access: signature.frameAccess,
			port: Object.freeze({
				domain,
				...(domain !== "frame" ? { key: node.operand } : {}),
			}),
		});
	}
	for (const [domain, access] of [
		["scope", signature.scopeAccess],
		["object", signature.objectAccess],
		["global", signature.globalAccess],
	] as const) {
		if (access === "none") continue;
		result.push({
			access,
			port: Object.freeze({
				domain,
				...((domain === "scope" || domain === "global") &&
				signature.operandKind === "scope-name"
					? { key: node.operand }
					: {}),
			}),
		});
	}
	if (signature.readsThis) {
		result.push({
			access: "read",
			port: Object.freeze({ domain: "this" }),
		});
	}
	return result;
}

function summarizeEffects(
	nodes: readonly SemanticInstruction[]
): RegionEffectSummary {
	const signatures = nodes.map((node) => getSemanticSignature(node.op));
	return Object.freeze({
		effects: uniqueSorted(signatures.map((signature) => signature.effect)),
		purity: maximum(
			signatures.map((signature) => signature.purity),
			PURITY_ORDER
		),
		throwBehavior: maximum(
			signatures.map((signature) => signature.throwBehavior),
			THROW_ORDER
		),
		coercions: uniqueSorted(
			signatures.map((signature) => signature.coercion)
		),
		callKinds: uniqueSorted(
			signatures.map((signature) => signature.callKind)
		),
		suspensions: uniqueSorted(
			signatures.map((signature) => signature.suspension)
		),
		frameAccess: combineAccess(
			signatures.map((signature) => signature.frameAccess)
		),
		scopeAccess: combineAccess(
			signatures.map((signature) => signature.scopeAccess)
		),
		objectAccess: combineAccess(
			signatures.map((signature) => signature.objectAccess)
		),
		globalAccess: combineAccess(
			signatures.map((signature) => signature.globalAccess)
		),
		allocations: uniqueSorted(
			signatures.map((signature) => signature.allocation)
		),
		completions: uniqueSorted(
			signatures.map((signature) => signature.completion)
		),
		readsThis: signatures.some((signature) => signature.readsThis),
		hasDynamicStack: nodes.some((node, index) => {
			const signature = signatures[index]!;
			return (
				resolveStackArity(signature.stackInput, node.operand) === "dynamic" ||
				resolveStackArity(signature.stackOutput, node.operand) === "dynamic"
			);
		}),
	});
}

function mapRegionExit(
	sourceNodeId: SemanticNodeId,
	exit: SemanticExit,
	ownership: ReadonlyMap<SemanticNodeId, EffectRegionId>
): EffectRegionExit {
	if ("target" in exit) {
		const targetRegionId = ownership.get(exit.target);
		if (!targetRegionId) {
			throw new Error(
				`RUAM_MISSING_TARGET_REGION: node ${sourceNodeId} -> ${exit.target}`
			);
		}
		return Object.freeze({
			kind: exit.kind,
			sourceNodeId,
			targetNodeId: exit.target,
			targetRegionId,
		});
	}
	if ("resume" in exit) {
		const resumeRegionId = ownership.get(exit.resume);
		if (!resumeRegionId) {
			throw new Error(
				`RUAM_MISSING_RESUME_REGION: node ${sourceNodeId} -> ${exit.resume}`
			);
		}
		return Object.freeze({
			kind: exit.kind,
			sourceNodeId,
			resumeNodeId: exit.resume,
			resumeRegionId,
		});
	}
	return Object.freeze({ kind: exit.kind, sourceNodeId });
}

function semanticExitTarget(exit: SemanticExit): SemanticNodeId | null {
	if ("target" in exit) return exit.target;
	if ("resume" in exit) return exit.resume;
	return null;
}

function regionIdFor(firstNodeId: SemanticNodeId): EffectRegionId {
	return `r_${firstNodeId.toString(36)}`;
}

function statePortKey(port: RegionStatePort): string {
	return `${port.domain}:${port.key ?? "*"}`;
}

function sortStatePorts(
	ports: Iterable<RegionStatePort>
): RegionStatePort[] {
	return [...ports].sort((left, right) =>
		statePortKey(left).localeCompare(statePortKey(right))
	);
}

function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] {
	return Object.freeze([...new Set(values)].sort());
}

function structurallyEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function maximum<T extends string>(
	values: readonly T[],
	order: readonly T[]
): T {
	let result = order[0]!;
	for (const value of values) {
		if (order.indexOf(value) > order.indexOf(result)) result = value;
	}
	return result;
}

function combineAccess(values: readonly SemanticAccess[]): SemanticAccess {
	if (values.includes("unknown")) return "unknown";
	const reads = values.some(
		(value) => value === "read" || value === "read-write"
	);
	const writes = values.some(
		(value) => value === "write" || value === "read-write"
	);
	if (reads && writes) return "read-write";
	if (reads) return "read";
	if (writes) return "write";
	return "none";
}
