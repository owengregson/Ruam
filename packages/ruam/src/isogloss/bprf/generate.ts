/**
 * Deterministic generator for the bounded pure BPRF reference artifact.
 *
 * Logical formula tags are consumed here and never copied into the artifact.
 * Each realization uses contextual physical wires and longitudinal fragments.
 *
 * @module isogloss/bprf/generate
 */

import { BprfRandom, mix32, opaqueId } from "./random.js";
import type {
	BprfArtifact,
	BprfFactor,
	BprfFragment,
	BprfGenerationOptions,
	BprfPiece,
	BprfPort,
	BprfRealization,
	BprfTransition,
	BprfWireBasis,
	PureRegionContract,
	PureRegionFormula,
	PureValueRef,
	PureValueType,
} from "./types.js";
import { validateBprfArtifact } from "./validate.js";

interface AlgebraicFactor {
	ref: PureValueRef;
	offset: number;
}

interface AlgebraicTerm {
	coefficient: number;
	factors: AlgebraicFactor[];
}

interface ContractFacts {
	types: PureValueType[];
	depths: number[];
}

/** Hard ceilings that keep malformed build requests from allocating unbounded IR. */
export const BPRF_GENERATION_LIMITS = Object.freeze({
	inputs: 256,
	steps: 4_096,
	outputs: 256,
	realizations: 32,
	fragments: 32,
	weightedComplexity: 1_000_000,
});

/** Generate K semantically equivalent, structurally diverse realizations. */
export function generateBprfArtifact(
	contract: PureRegionContract,
	options: BprfGenerationOptions
): BprfArtifact {
	if (
		!contract ||
		typeof contract !== "object" ||
		!Array.isArray(contract.inputs) ||
		!Array.isArray(contract.steps) ||
		!Array.isArray(contract.outputs)
	) {
		throw new Error("RUAM_BPRF_INVALID_CONTRACT");
	}
	const realizationCount = options.realizationCount ?? 3;
	const fragmentCount = options.fragmentCount ?? 3;
	if (
		!Number.isSafeInteger(options.seed) ||
		options.seed < 0 ||
		options.seed > 0xffffffff
	) {
		throw new Error("RUAM_BPRF_INVALID_SEED");
	}
	if (
		!Number.isSafeInteger(realizationCount) ||
		realizationCount < 2 ||
		realizationCount > BPRF_GENERATION_LIMITS.realizations
	) {
		throw new Error("RUAM_BPRF_REALIZATION_COUNT_RANGE");
	}
	if (
		!Number.isSafeInteger(fragmentCount) ||
		fragmentCount < 2 ||
		fragmentCount > BPRF_GENERATION_LIMITS.fragments
	) {
		throw new Error("RUAM_BPRF_FRAGMENT_COUNT_RANGE");
	}
	if (
		contract.inputs.length > BPRF_GENERATION_LIMITS.inputs ||
		contract.steps.length > BPRF_GENERATION_LIMITS.steps ||
		contract.outputs.length > BPRF_GENERATION_LIMITS.outputs ||
		(contract.inputs.length + contract.steps.length + contract.outputs.length) *
			realizationCount *
			fragmentCount >
			BPRF_GENERATION_LIMITS.weightedComplexity
	) {
		throw new Error("RUAM_BPRF_RESOURCE_LIMIT");
	}
	const facts = validateContract(contract);

	const rootRandom = new BprfRandom(options.seed);
	const realizations = Array.from({ length: realizationCount }, (_, index) =>
		generateRealization(
			contract,
			facts,
			index,
			fragmentCount,
			mix32(options.seed ^ Math.imul(index + 1, 0x9e3779b9))
		)
	);
	const artifact: BprfArtifact = Object.freeze({
		format: "ruam-bprf-pure-1",
		id: opaqueId("r", rootRandom),
		selectionSalt: rootRandom.nextUint32(),
		realizations: Object.freeze(realizations),
	});
	validateBprfArtifact(artifact);
	return artifact;
}

function generateRealization(
	contract: PureRegionContract,
	facts: ContractFacts,
	realizationIndex: number,
	fragmentCount: number,
	seed: number
): BprfRealization {
	const random = new BprfRandom(seed);
	const familyCode = (realizationIndex & 1) as 0 | 1;
	const logicalValueCount = facts.types.length;
	const residualCount = familyCode === 1 ? contract.steps.length : 0;
	const contextualWireCount = logicalValueCount + residualCount;
	const frameSize = contextualWireCount + contract.outputs.length;
	const slots = random.shuffle(
		Array.from({ length: frameSize }, (_, slot) => slot)
	);
	const logicalSlots = slots.slice(0, logicalValueCount);
	const residualSlots = slots.slice(
		logicalValueCount,
		logicalValueCount + residualCount
	);
	const exitSlots = slots.slice(contextualWireCount);
	const contextualSlots = [...logicalSlots, ...residualSlots];
	const contextualBases = Array.from({ length: contextualWireCount }, () =>
		randomBasis(random)
	);
	const exitBases = contract.outputs.map((outputRef) =>
		distinctBasis(random, contextualBases[outputRef]!)
	);

	const phaseByStep = contract.steps.map((_, stepIndex) =>
		familyCode === 0
			? facts.depths[contract.inputs.length + stepIndex]! - 1
			: stepIndex * 2 + 1
	);
	const computationPhaseCount =
		phaseByStep.length === 0 ? 0 : Math.max(...phaseByStep) + 1;
	const boundaryPhase = computationPhaseCount;
	const transitionWrites = Array.from(
		{ length: boundaryPhase + 1 },
		() => [] as number[]
	);
	for (let stepIndex = 0; stepIndex < contract.steps.length; stepIndex++) {
		const ref = contract.inputs.length + stepIndex;
		if (familyCode === 1) {
			transitionWrites[stepIndex * 2]!.push(residualSlots[stepIndex]!);
		}
		transitionWrites[phaseByStep[stepIndex]!]!.push(logicalSlots[ref]!);
	}
	transitionWrites[boundaryPhase]!.push(...exitSlots);

	const transitions: BprfTransition[] = transitionWrites.map(
		(writes, phase) =>
			Object.freeze({
				id: opaqueId("t", random),
				phase,
				boundaryCode: phase === boundaryPhase ? 1 : 0,
				writes: Object.freeze(writes.slice()),
			})
	);

	const fragments: BprfFragment[] = Array.from(
		{ length: fragmentCount },
		() => ({
			id: opaqueId("f", random),
			pieces: [] as BprfPiece[],
		})
	);

	let destinationOrdinal = 0;
	for (let stepIndex = 0; stepIndex < contract.steps.length; stepIndex++) {
		const ref = contract.inputs.length + stepIndex;
		const step = contract.steps[stepIndex]!;
		const terms = termsForFormula(step.formula, familyCode, random);
		if (familyCode === 0) {
			distributeTerms({
				terms,
				phase: phaseByStep[stepIndex]!,
				destination: logicalSlots[ref]!,
				destinationBasis: contextualBases[ref]!,
				logicalSlots: contextualSlots,
				logicalBases: contextualBases,
				fragments,
				random,
				rotation: destinationOrdinal + realizationIndex,
			});
			destinationOrdinal++;
		} else {
			const residualRef = logicalValueCount + stepIndex;
			const { head, continuation } = splitContinuationTerms(
				terms,
				residualRef,
				random
			);
			distributeTerms({
				terms: head,
				phase: stepIndex * 2,
				destination: residualSlots[stepIndex]!,
				destinationBasis: contextualBases[residualRef]!,
				logicalSlots: contextualSlots,
				logicalBases: contextualBases,
				fragments,
				random,
				rotation: destinationOrdinal + realizationIndex,
			});
			destinationOrdinal++;
			distributeTerms({
				terms: continuation,
				phase: phaseByStep[stepIndex]!,
				destination: logicalSlots[ref]!,
				destinationBasis: contextualBases[ref]!,
				logicalSlots: contextualSlots,
				logicalBases: contextualBases,
				fragments,
				random,
				rotation: destinationOrdinal + realizationIndex,
			});
			destinationOrdinal++;
		}
	}

	for (let outputIndex = 0; outputIndex < contract.outputs.length; outputIndex++) {
		const outputRef = contract.outputs[outputIndex]!;
		distributeTerms({
			terms: [{ coefficient: 1, factors: [{ ref: outputRef, offset: 0 }] }],
			phase: boundaryPhase,
			destination: exitSlots[outputIndex]!,
			destinationBasis: exitBases[outputIndex]!,
			logicalSlots: contextualSlots,
			logicalBases: contextualBases,
			fragments,
			random,
			rotation: destinationOrdinal + realizationIndex,
		});
		destinationOrdinal++;
	}

	const inputPorts: BprfPort[] = contract.inputs.map((input, index) =>
		Object.freeze({
			slot: logicalSlots[index]!,
			typeCode: typeCode(input.type),
			basis: contextualBases[index]!,
		})
	);
	const outputPorts: BprfPort[] = contract.outputs.map((outputRef, index) =>
		Object.freeze({
			slot: exitSlots[index]!,
			typeCode: typeCode(facts.types[outputRef]!),
			basis: exitBases[index]!,
		})
	);

	return Object.freeze({
		id: opaqueId("v", random),
		familyCode,
		contextSalt: random.nextUint32(),
		frameSize,
		fragmentThreshold: fragmentCount,
		inputPorts: Object.freeze(inputPorts),
		outputPorts: Object.freeze(outputPorts),
		transitions: Object.freeze(transitions),
		fragments: Object.freeze(
			fragments.map((fragment) =>
				Object.freeze({
					id: fragment.id,
					pieces: Object.freeze(fragment.pieces.slice()),
				})
			)
		),
	});
}

function distributeTerms(options: {
	terms: AlgebraicTerm[];
	phase: number;
	destination: number;
	destinationBasis: BprfWireBasis;
	logicalSlots: readonly number[];
	logicalBases: readonly BprfWireBasis[];
	fragments: BprfFragment[];
	random: BprfRandom;
	rotation: number;
}): void {
	const {
		phase,
		destination,
		destinationBasis,
		logicalSlots,
		logicalBases,
		fragments,
		random,
		rotation,
	} = options;
	const terms = options.terms.slice();
	while (terms.length < fragments.length) {
		const mask = random.nonZeroInt(11);
		terms.push({ coefficient: mask, factors: [] });
		terms.push({ coefficient: -mask, factors: [] });
	}

	for (let termIndex = 0; termIndex < terms.length; termIndex++) {
		const term = terms[termIndex]!;
		const fragment = fragments[(termIndex + rotation) % fragments.length]!;
		const factors: BprfFactor[] = term.factors.map((factor) =>
			Object.freeze({
				slot: logicalSlots[factor.ref]!,
				offset: factor.offset,
				basis: logicalBases[factor.ref]!,
			})
		);
		(fragment.pieces as BprfPiece[]).push(
			Object.freeze({
				phase,
				destination,
				destinationBasis,
				coefficient: term.coefficient,
				factors: Object.freeze(factors),
			})
		);
	}
}

function termsForFormula(
	formula: PureRegionFormula,
	familyCode: 0 | 1,
	random: BprfRandom
): AlgebraicTerm[] {
	switch (formula.tag) {
		case "literal":
			return [
				{
					coefficient:
						formula.type === "boolean"
							? booleanCoordinate(formula.value, familyCode)
							: formula.value,
					factors: [],
				},
			];
		case "sum":
			return [wireTerm(formula.left), wireTerm(formula.right)];
		case "difference":
			return [wireTerm(formula.left), wireTerm(formula.right, -1)];
		case "product":
			return splitProduct(formula.left, formula.right, 1, random);
		case "negate":
			return [wireTerm(formula.value, -1)];
		case "not":
			return familyCode === 0
				? [constantTerm(1), wireTerm(formula.value, -1)]
				: [wireTerm(formula.value, -1)];
		case "and":
			return familyCode === 0
				? splitProduct(formula.left, formula.right, 1, random)
				: [
						wireTerm(formula.left, 0.5),
						wireTerm(formula.right, 0.5),
						...splitProduct(formula.left, formula.right, 0.5, random),
						constantTerm(-0.5),
					];
		case "or":
			return familyCode === 0
				? [
						wireTerm(formula.left),
						wireTerm(formula.right),
						...splitProduct(formula.left, formula.right, -1, random),
					]
				: [
						wireTerm(formula.left, 0.5),
						wireTerm(formula.right, 0.5),
						...splitProduct(formula.left, formula.right, -0.5, random),
						constantTerm(0.5),
					];
		case "xor":
			return familyCode === 0
				? [
						wireTerm(formula.left),
						wireTerm(formula.right),
						...splitProduct(formula.left, formula.right, -2, random),
					]
				: splitProduct(formula.left, formula.right, -1, random);
		case "select": {
			const baseCoefficient = familyCode === 0 ? 1 : 0.5;
			return [
				wireTerm(formula.whenFalse, baseCoefficient),
				...(familyCode === 1
					? [wireTerm(formula.whenTrue, 0.5)]
					: []),
				...splitProduct(
					formula.gate,
					formula.whenTrue,
					baseCoefficient,
					random
				),
				...splitProduct(
					formula.gate,
					formula.whenFalse,
					-baseCoefficient,
					random
				),
			];
		}
	}
}

/**
 * Convert one direct polynomial update into a continuation residual followed
 * by a separate closure transition. Neither transition owns the full update.
 */
function splitContinuationTerms(
	terms: readonly AlgebraicTerm[],
	residualRef: PureValueRef,
	random: BprfRandom
): { head: AlgebraicTerm[]; continuation: AlgebraicTerm[] } {
	if (terms.length === 1) {
		const mask = random.nonZeroInt(13);
		return {
			head: [terms[0]!, constantTerm(mask)],
			continuation: [wireTerm(residualRef), constantTerm(-mask)],
		};
	}
	const cut = Math.max(1, Math.floor(terms.length / 2));
	return {
		head: terms.slice(0, cut),
		continuation: [wireTerm(residualRef), ...terms.slice(cut)],
	};
}

function splitProduct(
	left: PureValueRef,
	right: PureValueRef,
	coefficient: number,
	random: BprfRandom
): AlgebraicTerm[] {
	const leftShift = random.nonZeroInt(5);
	const rightShift = random.nonZeroInt(5);
	return [
		{
			coefficient,
			factors: [
				{ ref: left, offset: leftShift },
				{ ref: right, offset: rightShift },
			],
		},
		{
			coefficient: -coefficient * leftShift,
			factors: [{ ref: right, offset: 0 }],
		},
		{
			coefficient: -coefficient * rightShift,
			factors: [{ ref: left, offset: 0 }],
		},
		constantTerm(-coefficient * leftShift * rightShift),
	];
}

function wireTerm(ref: PureValueRef, coefficient = 1): AlgebraicTerm {
	return { coefficient, factors: [{ ref, offset: 0 }] };
}

function constantTerm(coefficient: number): AlgebraicTerm {
	return { coefficient, factors: [] };
}

function randomBasis(random: BprfRandom): BprfWireBasis {
	return Object.freeze({
		scale: random.nonZeroInt(3),
		bias: random.nonZeroInt(17),
	});
}

function distinctBasis(
	random: BprfRandom,
	previous: BprfWireBasis
): BprfWireBasis {
	for (;;) {
		const candidate = randomBasis(random);
		if (
			candidate.scale !== previous.scale ||
			candidate.bias !== previous.bias
		) {
			return candidate;
		}
	}
}

function typeCode(type: PureValueType): 0 | 1 {
	return type === "number" ? 0 : 1;
}

function booleanCoordinate(value: boolean, familyCode: 0 | 1): number {
	if (familyCode === 0) return value ? 1 : 0;
	return value ? 1 : -1;
}

function validateContract(contract: PureRegionContract): ContractFacts {
	if (contract.inputs.length === 0) {
		throw new Error("RUAM_BPRF_REGION_REQUIRES_INPUT");
	}
	if (contract.steps.length < 2) {
		throw new Error("RUAM_BPRF_REGION_REQUIRES_BRAIDABLE_STEPS");
	}
	if (contract.outputs.length === 0) {
		throw new Error("RUAM_BPRF_REGION_REQUIRES_OUTPUT");
	}

	const types = contract.inputs.map((input) => input.type);
	const depths = contract.inputs.map(() => 0);
	for (let stepIndex = 0; stepIndex < contract.steps.length; stepIndex++) {
		const step = contract.steps[stepIndex]!;
		const maxRef = contract.inputs.length + stepIndex;
		const refs = formulaRefs(step.formula);
		for (const ref of refs) assertPriorRef(ref, maxRef);
		assertFormulaTypes(step.formula, step.type, types);
		if (
			step.formula.tag === "literal" &&
			step.formula.type === "number" &&
			(!Number.isSafeInteger(step.formula.value) ||
				Object.is(step.formula.value, -0))
		) {
			throw new Error("RUAM_BPRF_UNSAFE_NUMBER_LITERAL");
		}
		types.push(step.type);
		depths.push(
			refs.length === 0 ? 1 : Math.max(...refs.map((ref) => depths[ref]!)) + 1
		);
	}
	for (const output of contract.outputs) assertPriorRef(output, types.length);
	return { types, depths };
}

function assertFormulaTypes(
	formula: PureRegionFormula,
	resultType: PureValueType,
	types: readonly PureValueType[]
): void {
	const typeAt = (ref: PureValueRef): PureValueType => types[ref]!;
	switch (formula.tag) {
		case "literal":
			if (formula.type !== resultType) throw typeError();
			return;
		case "sum":
		case "difference":
		case "product":
			if (
				resultType !== "number" ||
				typeAt(formula.left) !== "number" ||
				typeAt(formula.right) !== "number"
			) {
				throw typeError();
			}
			return;
		case "negate":
			if (resultType !== "number" || typeAt(formula.value) !== "number") {
				throw typeError();
			}
			return;
		case "not":
			if (resultType !== "boolean" || typeAt(formula.value) !== "boolean") {
				throw typeError();
			}
			return;
		case "and":
		case "or":
		case "xor":
			if (
				resultType !== "boolean" ||
				typeAt(formula.left) !== "boolean" ||
				typeAt(formula.right) !== "boolean"
			) {
				throw typeError();
			}
			return;
		case "select":
			if (
				typeAt(formula.gate) !== "boolean" ||
				typeAt(formula.whenTrue) !== resultType ||
				typeAt(formula.whenFalse) !== resultType
			) {
				throw typeError();
			}
			return;
	}
}

function formulaRefs(formula: PureRegionFormula): PureValueRef[] {
	switch (formula.tag) {
		case "literal":
			return [];
		case "negate":
		case "not":
			return [formula.value];
		case "sum":
		case "difference":
		case "product":
		case "and":
		case "or":
		case "xor":
			return [formula.left, formula.right];
		case "select":
			return [formula.gate, formula.whenTrue, formula.whenFalse];
	}
}

function assertPriorRef(ref: PureValueRef, upperBound: number): void {
	if (!Number.isSafeInteger(ref) || ref < 0 || ref >= upperBound) {
		throw new Error(`RUAM_BPRF_INVALID_VALUE_REF: ${ref}`);
	}
}

function typeError(): Error {
	return new Error("RUAM_BPRF_FORMULA_TYPE_MISMATCH");
}
