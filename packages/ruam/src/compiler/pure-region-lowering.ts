/**
 * Sound lowering gate from canonical effect-region spans to bounded BPRF
 * pure-region contracts.
 *
 * This module is compiler/owner-side only. It consumes SemanticOp identities
 * while proving a typed regional relation, then emits a PureRegionContract
 * whose generated BPRF artifact contains no operation or source-node identity.
 *
 * @module compiler/pure-region-lowering
 */

import type {
	PureRegionContract,
	PureRegionFormula,
	PureRegionStep,
	PureScalar,
	PureValueRef,
} from "../isogloss/bprf/index.js";
import type { SemanticInstruction, SemanticUnit } from "./ir.js";
import type {
	EffectRegion,
	EffectRegionExit,
	EffectRegionGraph,
	EffectRegionId,
} from "./regions.js";
import {
	SemanticOp,
	semanticOpName,
} from "./semantic-ops.js";

/**
 * Keeps logical and BPRF's expanded polynomial coordinates comfortably below
 * Number's exact-integer ceiling. This is a spike gate, not a general JS-number
 * lowering rule.
 */
export const MAX_PURE_REGION_INTEGER_MAGNITUDE = 1_000_000;

/**
 * Stack indices are bottom-to-top within the selected span's bounded entry or
 * exit stack window. Frame bindings use canonical argument/register/slot
 * indices and are later rewritten by contextual frame assignment.
 */
export type PureRegionBinding =
	| { kind: "stack"; index: number }
	| { kind: "argument"; index: number }
	| { kind: "register"; index: number }
	| { kind: "slot"; index: number };

export type PureRegionValueDomain =
	| { type: "boolean" }
	| {
			type: "number";
			/** Inclusive, exact safe-integer lower bound. */
			min: number;
			/** Inclusive, exact safe-integer upper bound. */
			max: number;
	  };

/** A guarded external value assumed at the selected span's entry. */
export interface PureRegionInputAssumption {
	binding: PureRegionBinding;
	domain: PureRegionValueDomain;
}

export interface PureRegionLoweringRequest {
	/** Consecutive effect regions in canonical graph order. */
	regionIds: readonly EffectRegionId[];
	/**
	 * Exact entry guards. Number domains accept only non-negative-zero safe
	 * integers within the declared inclusive range.
	 */
	assumptions: readonly PureRegionInputAssumption[];
}

export interface PureRegionInputBinding {
	contractInput: number;
	binding: PureRegionBinding;
	domain: PureRegionValueDomain;
}

export interface PureRegionOutputBinding {
	contractOutput: number;
	valueRef: PureValueRef;
	binding: PureRegionBinding;
	domain: PureRegionValueDomain;
}

export interface LoweredPureRegionContract {
	unitId: string;
	regionIds: readonly EffectRegionId[];
	contract: PureRegionContract;
	inputBindings: readonly PureRegionInputBinding[];
	outputBindings: readonly PureRegionOutputBinding[];
}

interface AbstractValueBase {
	symbol: number;
}

interface AbstractBoolean extends AbstractValueBase {
	type: "boolean";
}

interface AbstractNumber extends AbstractValueBase {
	type: "number";
	min: number;
	max: number;
}

type AbstractValue = AbstractBoolean | AbstractNumber;
type FrameValue = AbstractValue | typeof UNINITIALIZED;

interface SymbolicInput {
	value: AbstractValue;
	binding: PureRegionBinding;
	domain: PureRegionValueDomain;
}

interface SymbolicStep {
	value: AbstractValue;
	formula: PureRegionFormula;
}

interface PendingOutput {
	binding: PureRegionBinding;
	value: AbstractValue;
}

const UNINITIALIZED = Symbol("ruam-pure-region-uninitialized");
const STATE_BINDING_ORDER: Readonly<Record<string, number>> = Object.freeze({
	argument: 0,
	register: 1,
	slot: 2,
});

/**
 * Lower a consecutive, single-entry/single-fallthrough region span.
 *
 * The function throws on every unproved case. A successful result is valid
 * only under its explicit input binding guards; callers must route guard
 * failures to an ordinary JavaScript fallback rather than coerce them.
 */
export function lowerEffectRegionsToPureContract(
	unit: SemanticUnit,
	graph: EffectRegionGraph,
	request: PureRegionLoweringRequest
): LoweredPureRegionContract {
	if (graph.unitId !== unit.id) {
		fail("RUAM_PURE_REGION_UNIT_MISMATCH");
	}
	const selected = selectAndValidateTopology(graph, request.regionIds);
	const nodes = new Map(unit.nodes.map((node) => [node.id, node]));
	const assumptions = buildAssumptionMap(request.assumptions);
	const usedAssumptions = new Set<string>();
	const symbolicInputs: SymbolicInput[] = [];
	const symbolicSteps: SymbolicStep[] = [];
	const stack: AbstractValue[] = [];
	const frame = new Map<string, FrameValue>();
	const modifiedBindings = new Map<string, PureRegionBinding>();
	let nextSymbol = 0;

	const createInput = (binding: PureRegionBinding): AbstractValue => {
		const key = bindingKey(binding);
		const assumption = assumptions.get(key);
		if (!assumption) {
			fail(
				"RUAM_PURE_REGION_INPUT_TYPE_REQUIRED",
				`${binding.kind}:${binding.index}`
			);
		}
		usedAssumptions.add(key);
		const domain = validateAndFreezeDomain(assumption.domain);
		const value = valueFromDomain(nextSymbol++, domain);
		symbolicInputs.push({
			value,
			binding: freezeBinding(binding),
			domain,
		});
		return value;
	};

	const addStep = (
		domain: PureRegionValueDomain,
		formula: PureRegionFormula
	): AbstractValue => {
		const frozenDomain = validateAndFreezeDomain(domain);
		const value = valueFromDomain(nextSymbol++, frozenDomain);
		symbolicSteps.push({
			value,
			formula: Object.freeze({ ...formula }) as PureRegionFormula,
		});
		return value;
	};

	const firstStack = selected[0]!.inputs.stack;
	if (firstStack === "dynamic") {
		fail("RUAM_PURE_REGION_DYNAMIC_STACK");
	}
	for (let index = 0; index < firstStack; index++) {
		stack.push(createInput({ kind: "stack", index }));
	}

	const readFrame = (
		kind: "argument" | "register" | "slot",
		index: number
	): AbstractValue => {
		const binding = { kind, index } as const;
		const key = bindingKey(binding);
		let value = frame.get(key);
		if (value === undefined) {
			value = createInput(binding);
			frame.set(key, value);
		}
		if (value === UNINITIALIZED) {
			fail(
				"RUAM_PURE_REGION_UNINITIALIZED_READ",
				`${kind}:${index}`
			);
		}
		return value;
	};

	const writeFrame = (
		kind: "argument" | "register" | "slot",
		index: number,
		value: FrameValue
	): void => {
		const binding = freezeBinding({ kind, index });
		const key = bindingKey(binding);
		frame.set(key, value);
		modifiedBindings.set(key, binding);
	};

	const pop = (node: SemanticInstruction): AbstractValue => {
		const value = stack.pop();
		if (!value) {
			fail(
				"RUAM_PURE_REGION_STACK_UNDERFLOW",
				`${node.id}:${semanticOpName(node.op)}`
			);
		}
		return value;
	};

	const pushLiteral = (
		domain: PureRegionValueDomain,
		value: number | boolean
	): void => {
		stack.push(
			addStep(
				domain,
				typeof value === "boolean"
					? { tag: "literal", type: "boolean", value }
					: { tag: "literal", type: "number", value }
			)
		);
	};

	for (const region of selected) {
		if (region.inputs.stack === "dynamic") {
			fail("RUAM_PURE_REGION_DYNAMIC_STACK", region.id);
		}
		if (stack.length !== region.inputs.stack) {
			fail(
				"RUAM_PURE_REGION_STACK_CONTRACT_MISMATCH",
				`${region.id}: expected ${region.inputs.stack}, received ${stack.length}`
			);
		}

		for (const nodeId of region.nodeIds) {
			const node = nodes.get(nodeId);
			if (!node) fail("RUAM_PURE_REGION_UNKNOWN_NODE", String(nodeId));

			switch (node.op) {
				case SemanticOp.PUSH_CONST: {
					const constant = unit.constants[node.operand];
					if (!constant) {
						fail(
							"RUAM_PURE_REGION_INVALID_CONSTANT",
							String(node.operand)
						);
					}
					if (constant.type === "boolean") {
						pushLiteral({ type: "boolean" }, constant.value);
					} else if (constant.type === "number") {
						const domain = exactNumberDomain(constant.value);
						pushLiteral(domain, constant.value);
					} else {
						unsupported(node);
					}
					break;
				}
				case SemanticOp.PUSH_ZERO:
					pushLiteral(exactNumberDomain(0), 0);
					break;
				case SemanticOp.PUSH_ONE:
					pushLiteral(exactNumberDomain(1), 1);
					break;
				case SemanticOp.PUSH_NEG_ONE:
					pushLiteral(exactNumberDomain(-1), -1);
					break;
				case SemanticOp.PUSH_TRUE:
					pushLiteral({ type: "boolean" }, true);
					break;
				case SemanticOp.PUSH_FALSE:
					pushLiteral({ type: "boolean" }, false);
					break;
				case SemanticOp.POP:
					pop(node);
					break;
				case SemanticOp.POP_N: {
					if (!Number.isSafeInteger(node.operand) || node.operand < 0) {
						fail(
							"RUAM_PURE_REGION_INVALID_STACK_OPERAND",
							String(node.operand)
						);
					}
					for (let index = 0; index < node.operand; index++) pop(node);
					break;
				}
				case SemanticOp.DUP: {
					const value = pop(node);
					stack.push(value, value);
					break;
				}
				case SemanticOp.DUP2: {
					const right = pop(node);
					const left = pop(node);
					stack.push(left, right, left, right);
					break;
				}
				case SemanticOp.SWAP: {
					const right = pop(node);
					const left = pop(node);
					stack.push(right, left);
					break;
				}
				case SemanticOp.ROT3:
					rotateStack(stack, 3, node);
					break;
				case SemanticOp.ROT4:
					rotateStack(stack, 4, node);
					break;
				case SemanticOp.PICK: {
					if (
						!Number.isSafeInteger(node.operand) ||
						node.operand < 0 ||
						node.operand >= stack.length
					) {
						fail(
							"RUAM_PURE_REGION_INVALID_STACK_OPERAND",
							String(node.operand)
						);
					}
					stack.push(stack[stack.length - node.operand - 1]!);
					break;
				}
				case SemanticOp.LOAD_ARG:
				stack.push(readFrame("argument", node.operand));
				break;
				case SemanticOp.LOAD_ARG_OR_DEFAULT:
					stack.push(readFrame("argument", node.operand));
					break;
				case SemanticOp.STORE_ARG:
					writeFrame("argument", node.operand, pop(node));
					break;
				case SemanticOp.LOAD_REG:
					stack.push(readFrame("register", node.operand));
					break;
				case SemanticOp.STORE_REG:
					writeFrame("register", node.operand, pop(node));
					break;
				case SemanticOp.LOAD_SLOT:
					stack.push(readFrame("slot", node.operand));
					break;
				case SemanticOp.STORE_SLOT:
					writeFrame("slot", node.operand, pop(node));
					break;
				case SemanticOp.DECLARE_SLOT:
					writeFrame("slot", node.operand, UNINITIALIZED);
					break;
				case SemanticOp.ADD:
				lowerBinaryNumber(node, stack, "sum", addStep);
					break;
				case SemanticOp.SUB:
					lowerBinaryNumber(node, stack, "difference", addStep);
					break;
				case SemanticOp.MUL:
					lowerBinaryNumber(node, stack, "product", addStep);
					break;
				case SemanticOp.NEG: {
					const input = requireNumber(pop(node), node);
					if (containsZero(input)) {
						fail(
							"RUAM_PURE_REGION_NEGATIVE_ZERO_RISK",
							String(node.id)
						);
					}
					const domain = boundedNumberDomain(-input.max, -input.min);
					stack.push(
						addStep(domain, { tag: "negate", value: input.symbol })
					);
					break;
				}
				case SemanticOp.NOT: {
					const input = requireBoolean(pop(node), node);
					stack.push(
						addStep(
							{ type: "boolean" },
							{ tag: "not", value: input.symbol }
						)
					);
					break;
				}
				case SemanticOp.TO_BOOLEAN: {
					const input = requireBoolean(pop(node), node);
					stack.push(input);
					break;
				}
				case SemanticOp.NOP:
				break;
				case SemanticOp.SOURCE_MAP:
					break;
				default:
					unsupported(node);
			}
		}

		if (
			region.outputs.stack === "dynamic" ||
			stack.length !== region.outputs.stack
		) {
			fail(
				"RUAM_PURE_REGION_STACK_CONTRACT_MISMATCH",
				`${region.id}: produced ${stack.length}`
			);
		}
	}

	for (const key of assumptions.keys()) {
		if (!usedAssumptions.has(key)) {
			fail("RUAM_PURE_REGION_UNUSED_ASSUMPTION", key);
		}
	}

	const pendingOutputs: PendingOutput[] = stack.map((value, index) => ({
		binding: freezeBinding({ kind: "stack", index }),
		value,
	}));
	const stateOutputs = [...modifiedBindings.values()].sort(compareBindings);
	for (const binding of stateOutputs) {
		const value = frame.get(bindingKey(binding));
		if (value === undefined || value === UNINITIALIZED) {
			fail(
				"RUAM_PURE_REGION_UNREPRESENTABLE_STATE_OUTPUT",
				bindingKey(binding)
			);
		}
		pendingOutputs.push({ binding, value });
	}

	if (symbolicInputs.length === 0) {
		fail("RUAM_PURE_REGION_REQUIRES_INPUT");
	}
	if (symbolicSteps.length < 2) {
		fail("RUAM_PURE_REGION_REQUIRES_BRAIDABLE_STEPS");
	}
	if (pendingOutputs.length === 0) {
		fail("RUAM_PURE_REGION_REQUIRES_OUTPUT");
	}

	const finalized = finalizeContract(
		symbolicInputs,
		symbolicSteps,
		pendingOutputs
	);
	return Object.freeze({
		unitId: unit.id,
		regionIds: Object.freeze(selected.map((region) => region.id)),
		contract: finalized.contract,
		inputBindings: finalized.inputBindings,
		outputBindings: finalized.outputBindings,
	});
}

/** Check the exact guard represented by a lowering input binding. */
export function isPureRegionValueInDomain(
	value: PureScalar,
	domain: PureRegionValueDomain
): boolean {
	if (domain.type === "boolean") return typeof value === "boolean";
	return (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		!Object.is(value, -0) &&
		value >= domain.min &&
		value <= domain.max
	);
}

function selectAndValidateTopology(
	graph: EffectRegionGraph,
	regionIds: readonly EffectRegionId[]
): EffectRegion[] {
	if (regionIds.length === 0) {
		fail("RUAM_PURE_REGION_EMPTY_SELECTION");
	}
	const topology = indexedTopologyFor(graph);
	const indexes = regionIds.map(
		(regionId) => topology.indexByRegionId.get(regionId) ?? -1
	);
	if (indexes.some((index) => index < 0)) {
		fail("RUAM_PURE_REGION_UNKNOWN_REGION");
	}
	if (new Set(regionIds).size !== regionIds.length) {
		fail("RUAM_PURE_REGION_DUPLICATE_REGION");
	}
	for (let index = 1; index < indexes.length; index++) {
		if (indexes[index] !== indexes[index - 1]! + 1) {
			fail("RUAM_PURE_REGION_NONCONTIGUOUS_SELECTION");
		}
	}
	const selected = indexes.map((index) => graph.regions[index]!);
	const selectedIds = new Set(regionIds);
	const incoming = topology.incomingByRegionId;

	for (let index = 0; index < selected.length; index++) {
		const region = selected[index]!;
		const next = selected[index + 1];
		for (const exit of region.exits) {
			if (
				exit.kind === "branch-true" ||
				exit.kind === "branch-false" ||
				exit.kind === "call" ||
				exit.kind === "yield" ||
				exit.kind === "await" ||
				exit.kind === "finally" ||
				exit.kind === "return"
			) {
				fail(
					"RUAM_PURE_REGION_UNREPRESENTABLE_CONTROL",
					`${region.id}:${exit.kind}`
				);
			}
			if (
				(exit.kind === "exception" || exit.kind === "throw") &&
				"targetRegionId" in exit &&
				selectedIds.has(exit.targetRegionId)
			) {
				fail(
					"RUAM_PURE_REGION_EXCEPTION_PATH_SELECTED",
					region.id
				);
			}
		}
		const fallthroughs = region.exits.filter(
			(
				exit
			): exit is Extract<
				EffectRegionExit,
				{ targetRegionId: EffectRegionId }
			> =>
				exit.kind === "fallthrough"
		);
		if (fallthroughs.length !== 1) {
			fail("RUAM_PURE_REGION_REQUIRES_FALLTHROUGH", region.id);
		}
		if (next) {
			if (fallthroughs[0]!.targetRegionId !== next.id) {
				fail("RUAM_PURE_REGION_NONLINEAR_SELECTION", region.id);
			}
		} else if (selectedIds.has(fallthroughs[0]!.targetRegionId)) {
			fail("RUAM_PURE_REGION_CYCLIC_SELECTION", region.id);
		}

		const entries = incoming.get(region.id) ?? [];
		const normalEntries = entries.filter(
			(entry) =>
				entry.exit.kind !== "exception" &&
				entry.exit.kind !== "finally"
		);
		const exceptionalEntries = entries.filter(
			(entry) =>
				entry.exit.kind === "exception" ||
				entry.exit.kind === "finally"
		);
		if (exceptionalEntries.length > 0) {
			fail("RUAM_PURE_REGION_EXCEPTION_ENTRY", region.id);
		}
		if (index === 0) {
			if (
				normalEntries.length > 1 ||
				normalEntries.some(
					(entry) => entry.exit.kind !== "fallthrough"
				)
			) {
				fail("RUAM_PURE_REGION_CONTROL_JOIN", region.id);
			}
		} else if (
			normalEntries.length !== 1 ||
			normalEntries[0]!.source !== selected[index - 1]!.id ||
			normalEntries[0]!.exit.kind !== "fallthrough"
		) {
			fail("RUAM_PURE_REGION_CONTROL_JOIN", region.id);
		}
	}
	return selected;
}

interface IndexedEffectRegionTopology {
	readonly indexByRegionId: ReadonlyMap<EffectRegionId, number>;
	readonly incomingByRegionId: ReadonlyMap<
		EffectRegionId,
		readonly { source: EffectRegionId; exit: EffectRegionExit }[]
	>;
}

const indexedTopologyCache = new WeakMap<
	EffectRegionGraph,
	IndexedEffectRegionTopology
>();

function indexedTopologyFor(
	graph: EffectRegionGraph
): IndexedEffectRegionTopology {
	const cacheable = Object.isFrozen(graph);
	const cached = cacheable
		? indexedTopologyCache.get(graph)
		: undefined;
	if (cached) return cached;
	const indexByRegionId = new Map<EffectRegionId, number>();
	const incomingByRegionId = new Map<
		EffectRegionId,
		Array<{ source: EffectRegionId; exit: EffectRegionExit }>
	>();
	for (let index = 0; index < graph.regions.length; index++) {
		const region = graph.regions[index]!;
		indexByRegionId.set(region.id, index);
		for (const exit of region.exits) {
			const target = exitRegionId(exit);
			if (!target) continue;
			const entries = incomingByRegionId.get(target) ?? [];
			entries.push({ source: region.id, exit });
			incomingByRegionId.set(target, entries);
		}
	}
	const topology: IndexedEffectRegionTopology = {
		indexByRegionId,
		incomingByRegionId,
	};
	if (cacheable) indexedTopologyCache.set(graph, topology);
	return topology;
}

function buildAssumptionMap(
	assumptions: readonly PureRegionInputAssumption[]
): Map<string, PureRegionInputAssumption> {
	const result = new Map<string, PureRegionInputAssumption>();
	for (const assumption of assumptions) {
		validateBinding(assumption.binding);
		const key = bindingKey(assumption.binding);
		if (result.has(key)) {
			fail("RUAM_PURE_REGION_DUPLICATE_ASSUMPTION", key);
		}
		result.set(key, {
			binding: freezeBinding(assumption.binding),
			domain: validateAndFreezeDomain(assumption.domain),
		});
	}
	return result;
}

function lowerBinaryNumber(
	node: SemanticInstruction,
	stack: AbstractValue[],
	tag: "sum" | "difference" | "product",
	addStep: (
		domain: PureRegionValueDomain,
		formula: PureRegionFormula
	) => AbstractValue
): void {
	const rightValue = stack.pop();
	const leftValue = stack.pop();
	if (!rightValue || !leftValue) {
		fail(
			"RUAM_PURE_REGION_STACK_UNDERFLOW",
			`${node.id}:${semanticOpName(node.op)}`
		);
	}
	const left = requireNumber(leftValue, node);
	const right = requireNumber(rightValue, node);
	let domain: PureRegionValueDomain;
	if (tag === "sum") {
		domain = boundedNumberDomain(left.min + right.min, left.max + right.max);
	} else if (tag === "difference") {
		domain = boundedNumberDomain(left.min - right.max, left.max - right.min);
	} else {
		if (
			(containsZero(left) && right.min < 0) ||
			(containsZero(right) && left.min < 0)
		) {
			fail(
				"RUAM_PURE_REGION_NEGATIVE_ZERO_RISK",
				String(node.id)
			);
		}
		const products = [
			left.min * right.min,
			left.min * right.max,
			left.max * right.min,
			left.max * right.max,
		];
		domain = boundedNumberDomain(
			Math.min(...products),
			Math.max(...products)
		);
	}
	stack.push(
		addStep(domain, {
			tag,
			left: left.symbol,
			right: right.symbol,
		})
	);
}

function finalizeContract(
	inputs: readonly SymbolicInput[],
	steps: readonly SymbolicStep[],
	outputs: readonly PendingOutput[]
): {
	contract: PureRegionContract;
	inputBindings: readonly PureRegionInputBinding[];
	outputBindings: readonly PureRegionOutputBinding[];
} {
	const refs = new Map<number, PureValueRef>();
	const contractInputs = inputs.map((input, index) => {
		refs.set(input.value.symbol, index);
		return Object.freeze({ type: input.domain.type });
	});
	const inputBindings = inputs.map((input, index) =>
		Object.freeze({
			contractInput: index,
			binding: input.binding,
			domain: input.domain,
		})
	);
	const contractSteps: PureRegionStep[] = [];
	for (const step of steps) {
		const formula = remapFormula(step.formula, refs);
		const ref = contractInputs.length + contractSteps.length;
		refs.set(step.value.symbol, ref);
		contractSteps.push(
			Object.freeze({
				type: step.value.type,
				formula,
			})
		);
	}
	const contractOutputs = outputs.map((output) => {
		const ref = refs.get(output.value.symbol);
		if (ref == null) fail("RUAM_PURE_REGION_INTERNAL_MISSING_REF");
		return ref;
	});
	const outputBindings = outputs.map((output, index) =>
		Object.freeze({
			contractOutput: index,
			valueRef: contractOutputs[index]!,
			binding: output.binding,
			domain: domainFromValue(output.value),
		})
	);
	return {
		contract: Object.freeze({
			inputs: Object.freeze(contractInputs),
			steps: Object.freeze(contractSteps),
			outputs: Object.freeze(contractOutputs),
		}),
		inputBindings: Object.freeze(inputBindings),
		outputBindings: Object.freeze(outputBindings),
	};
}

function remapFormula(
	formula: PureRegionFormula,
	refs: ReadonlyMap<number, PureValueRef>
): PureRegionFormula {
	const ref = (symbol: number): PureValueRef => {
		const value = refs.get(symbol);
		if (value == null) fail("RUAM_PURE_REGION_INTERNAL_FORWARD_REF");
		return value;
	};
	switch (formula.tag) {
		case "literal":
			return Object.freeze({ ...formula });
		case "negate":
		case "not":
			return Object.freeze({ ...formula, value: ref(formula.value) });
		case "sum":
		case "difference":
		case "product":
		case "and":
		case "or":
		case "xor":
			return Object.freeze({
				...formula,
				left: ref(formula.left),
				right: ref(formula.right),
			});
		case "select":
			return Object.freeze({
				...formula,
				gate: ref(formula.gate),
				whenTrue: ref(formula.whenTrue),
				whenFalse: ref(formula.whenFalse),
			});
	}
}

function rotateStack(
	stack: AbstractValue[],
	width: 3 | 4,
	node: SemanticInstruction
): void {
	if (stack.length < width) {
		fail(
			"RUAM_PURE_REGION_STACK_UNDERFLOW",
			`${node.id}:${semanticOpName(node.op)}`
		);
	}
	const values = stack.splice(stack.length - width, width);
	stack.push(values[width - 1]!, ...values.slice(0, width - 1));
}

function requireNumber(
	value: AbstractValue,
	node: SemanticInstruction
): AbstractNumber {
	if (value.type !== "number") {
		fail(
			"RUAM_PURE_REGION_TYPE_MISMATCH",
			`${node.id}:${semanticOpName(node.op)} expected number`
		);
	}
	return value;
}

function requireBoolean(
	value: AbstractValue,
	node: SemanticInstruction
): AbstractBoolean {
	if (value.type !== "boolean") {
		fail(
			"RUAM_PURE_REGION_TYPE_MISMATCH",
			`${node.id}:${semanticOpName(node.op)} expected boolean`
		);
	}
	return value;
}

function valueFromDomain(
	symbol: number,
	domain: PureRegionValueDomain
): AbstractValue {
	return domain.type === "boolean"
		? Object.freeze({ symbol, type: "boolean" })
		: Object.freeze({
				symbol,
				type: "number",
				min: domain.min,
				max: domain.max,
			});
}

function domainFromValue(value: AbstractValue): PureRegionValueDomain {
	return value.type === "boolean"
		? Object.freeze({ type: "boolean" })
		: Object.freeze({ type: "number", min: value.min, max: value.max });
}

function exactNumberDomain(value: number): PureRegionValueDomain {
	if (
		!Number.isSafeInteger(value) ||
		Object.is(value, -0) ||
		Math.abs(value) > MAX_PURE_REGION_INTEGER_MAGNITUDE
	) {
		fail("RUAM_PURE_REGION_UNSAFE_NUMBER_LITERAL", String(value));
	}
	return Object.freeze({ type: "number", min: value, max: value });
}

function boundedNumberDomain(
	min: number,
	max: number
): PureRegionValueDomain {
	if (
		!Number.isSafeInteger(min) ||
		!Number.isSafeInteger(max) ||
		min > max ||
		Math.abs(min) > MAX_PURE_REGION_INTEGER_MAGNITUDE ||
		Math.abs(max) > MAX_PURE_REGION_INTEGER_MAGNITUDE
	) {
		fail(
			"RUAM_PURE_REGION_NUMERIC_DOMAIN_OVERFLOW",
			`${min}:${max}`
		);
	}
	return Object.freeze({ type: "number", min, max });
}

function validateAndFreezeDomain(
	domain: PureRegionValueDomain
): PureRegionValueDomain {
	if (domain.type === "boolean") {
		return Object.freeze({ type: "boolean" });
	}
	return boundedNumberDomain(domain.min, domain.max);
}

function containsZero(value: AbstractNumber): boolean {
	return value.min <= 0 && value.max >= 0;
}

function validateBinding(binding: PureRegionBinding): void {
	if (
		!Number.isSafeInteger(binding.index) ||
		binding.index < 0
	) {
		fail(
			"RUAM_PURE_REGION_INVALID_BINDING",
			`${binding.kind}:${binding.index}`
		);
	}
}

function freezeBinding(binding: PureRegionBinding): PureRegionBinding {
	validateBinding(binding);
	return Object.freeze({ ...binding }) as PureRegionBinding;
}

function bindingKey(binding: PureRegionBinding): string {
	return `${binding.kind}:${binding.index}`;
}

function compareBindings(
	left: PureRegionBinding,
	right: PureRegionBinding
): number {
	const leftOrder = STATE_BINDING_ORDER[left.kind] ?? -1;
	const rightOrder = STATE_BINDING_ORDER[right.kind] ?? -1;
	return leftOrder - rightOrder || left.index - right.index;
}

function exitRegionId(exit: EffectRegionExit): EffectRegionId | null {
	if ("targetRegionId" in exit) return exit.targetRegionId;
	if ("resumeRegionId" in exit) return exit.resumeRegionId;
	return null;
}

function unsupported(node: SemanticInstruction): never {
	fail(
		"RUAM_PURE_REGION_UNSUPPORTED_OP",
		`${node.id}:${semanticOpName(node.op)}`
	);
}

function fail(code: string, detail?: string): never {
	throw new Error(detail ? `${code}: ${detail}` : code);
}
