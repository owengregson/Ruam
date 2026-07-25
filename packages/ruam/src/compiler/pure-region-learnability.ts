/**
 * Owner-side black-box learnability analysis for bounded pure-region contracts.
 *
 * Every query count in this module is a constructive exact-attack upper bound.
 * It is intentionally not a hardness estimate and never becomes a client
 * artifact.
 *
 * @module compiler/pure-region-learnability
 */

import type {
	PureRegionContract,
	PureRegionFormula,
	PureValueRef,
	PureValueType,
} from "../isogloss/bprf/index.js";
import type {
	LoweredPureRegionContract,
	PureRegionValueDomain,
} from "./pure-region-lowering.js";

export const PURE_REGION_LEARNABILITY_NON_CLAIM =
	"Constructive exact black-box attack query upper bounds only; this analysis does not establish a hardness lower bound or resistance guarantee.";

export type PureRegionLearnabilityIssueCode =
	| "RUAM_PURE_REGION_LEARNABILITY_NO_INPUTS"
	| "RUAM_PURE_REGION_LEARNABILITY_TOO_FEW_STEPS"
	| "RUAM_PURE_REGION_LEARNABILITY_NO_OUTPUTS"
	| "RUAM_PURE_REGION_LEARNABILITY_INPUT_DOMAIN_COUNT_MISMATCH"
	| "RUAM_PURE_REGION_LEARNABILITY_MISSING_INPUT_DOMAIN"
	| "RUAM_PURE_REGION_LEARNABILITY_INVALID_INPUT_DOMAIN"
	| "RUAM_PURE_REGION_LEARNABILITY_INPUT_TYPE_MISMATCH"
	| "RUAM_PURE_REGION_LEARNABILITY_INVALID_VALUE_TYPE"
	| "RUAM_PURE_REGION_LEARNABILITY_INVALID_VALUE_REF"
	| "RUAM_PURE_REGION_LEARNABILITY_FORMULA_TYPE_MISMATCH"
	| "RUAM_PURE_REGION_LEARNABILITY_INVALID_LITERAL"
	| "RUAM_PURE_REGION_LEARNABILITY_UNSUPPORTED_FORMULA"
	| "RUAM_PURE_REGION_LEARNABILITY_INVALID_LOWERED_INPUT_BINDING";

export interface PureRegionLearnabilityIssue {
	code: PureRegionLearnabilityIssueCode;
	detail: string;
	inputIndex: number | null;
	stepIndex: number | null;
	outputIndex: number | null;
	valueRef: PureValueRef | null;
}

export interface PureRegionInputDomainAnalysis {
	inputIndex: number;
	type: PureValueType | null;
	domain: PureRegionValueDomain | null;
	/** Exact finite cardinality of the guarded input domain. */
	cardinality: bigint | null;
}

export interface PureRegionValueDegreeAnalysis {
	valueRef: PureValueRef;
	source: "input" | "step";
	type: PureValueType | null;
	/** Structural total-degree upper bound, or null when analysis is incomplete. */
	algebraicDegreeUpperBound: bigint | null;
}

export type DenseInterpolationInapplicability =
	| "unknown-algebraic-degree"
	| "invalid-input-domain"
	| "boolean-input-domain"
	| "insufficient-distinct-numeric-points"
	| null;

export interface DenseInterpolationAnalysis {
	totalDegreeUpperBound: bigint | null;
	/**
	 * Number of dense total-degree monomials, C(inputCount + degree, degree).
	 * This is a query attack bound only when attackQueryUpperBound is non-null.
	 */
	basisQueryCount: bigint | null;
	attackQueryUpperBound: bigint | null;
	inapplicableReason: DenseInterpolationInapplicability;
}

export type PureRegionExactAttackMethod =
	| "input-enumeration"
	| "dense-interpolation"
	| "tied";

export interface PureRegionExactAttackUpperBound {
	method: PureRegionExactAttackMethod;
	queries: bigint;
}

export interface PureRegionOutputLearnabilityAnalysis {
	outputIndex: number;
	valueRef: PureValueRef;
	type: PureValueType | null;
	algebraicDegreeUpperBound: bigint | null;
	denseInterpolation: DenseInterpolationAnalysis;
	cheapestKnownExactAttack: PureRegionExactAttackUpperBound | null;
}

export interface PureRegionLearnabilityAnalysis {
	source: "contract" | "lowered-contract";
	inputDomains: readonly PureRegionInputDomainAnalysis[];
	values: readonly PureRegionValueDegreeAnalysis[];
	outputs: readonly PureRegionOutputLearnabilityAnalysis[];
	/** Exact queries needed to enumerate the complete guarded input domain. */
	inputEnumerationQueryUpperBound: bigint | null;
	/** One common sample set sufficient to interpolate every output. */
	denseInterpolation: DenseInterpolationAnalysis;
	/** Cheapest known exact attack for learning all outputs simultaneously. */
	cheapestKnownExactAttack: PureRegionExactAttackUpperBound | null;
	issues: readonly PureRegionLearnabilityIssue[];
	boundInterpretation: "constructive-exact-attack-upper-bound";
	hardnessLowerBound: null;
	nonClaim: typeof PURE_REGION_LEARNABILITY_NON_CLAIM;
}

export interface MaximumCustodyLearnabilityPolicy {
	/**
	 * Reject when the cheapest known exact attack uses strictly fewer queries.
	 */
	minimumExactAttackQueries: bigint;
}

export type MaximumCustodyLearnabilityReason =
	| {
			code: "RUAM_PURE_REGION_MAXIMUM_CUSTODY_ANALYSIS_ISSUE";
			issue: PureRegionLearnabilityIssue;
	  }
	| {
			code: "RUAM_PURE_REGION_MAXIMUM_CUSTODY_NO_EXACT_ATTACK_BOUND";
	  }
	| {
			code: "RUAM_PURE_REGION_MAXIMUM_CUSTODY_CHEAP_EXACT_ATTACK";
			method: PureRegionExactAttackMethod;
			queries: bigint;
			minimumExactAttackQueries: bigint;
	  };

export interface MaximumCustodyLearnabilityDecision {
	decision: "eligible" | "rejected";
	eligibleForMaximumCustody: boolean;
	minimumExactAttackQueries: bigint;
	cheapestKnownExactAttack: PureRegionExactAttackUpperBound | null;
	reasons: readonly MaximumCustodyLearnabilityReason[];
	boundInterpretation: "constructive-exact-attack-upper-bound";
	hardnessLowerBound: null;
	nonClaim: typeof PURE_REGION_LEARNABILITY_NON_CLAIM;
}

interface ValueFact {
	type: PureValueType | null;
	degree: bigint | null;
}

interface DerivedDomains {
	domains: Array<PureRegionValueDomain | undefined>;
	issues: PureRegionLearnabilityIssue[];
}

export function analyzePureRegionLearnability(
	lowered: LoweredPureRegionContract
): PureRegionLearnabilityAnalysis;
export function analyzePureRegionLearnability(
	contract: PureRegionContract,
	inputDomains: readonly PureRegionValueDomain[]
): PureRegionLearnabilityAnalysis;
export function analyzePureRegionLearnability(
	source: LoweredPureRegionContract | PureRegionContract,
	inputDomains?: readonly PureRegionValueDomain[]
): PureRegionLearnabilityAnalysis {
	if (isLoweredContract(source)) {
		const derived = deriveLoweredInputDomains(source);
		return analyzeContract(
			source.contract,
			derived.domains,
			"lowered-contract",
			derived.issues
		);
	}
	return analyzeContract(
		source,
		inputDomains ? Array.from(inputDomains) : [],
		"contract",
		[]
	);
}

/**
 * Apply only the black-box learnability policy gate for maximum custody.
 *
 * An eligible result means merely that this particular known-attack upper
 * bound did not fall below the configured threshold. It is not evidence that
 * the real attack cost reaches that threshold.
 */
export function assessMaximumCustodyLearnability(
	analysis: PureRegionLearnabilityAnalysis,
	policy: MaximumCustodyLearnabilityPolicy
): MaximumCustodyLearnabilityDecision {
	if (
		typeof policy.minimumExactAttackQueries !== "bigint" ||
		policy.minimumExactAttackQueries < 0n
	) {
		throw new Error(
			"RUAM_PURE_REGION_LEARNABILITY_INVALID_POLICY_THRESHOLD"
		);
	}

	const reasons: MaximumCustodyLearnabilityReason[] = analysis.issues.map(
		(issue) =>
			Object.freeze({
				code: "RUAM_PURE_REGION_MAXIMUM_CUSTODY_ANALYSIS_ISSUE",
				issue,
			})
	);
	const attack = analysis.cheapestKnownExactAttack;
	if (!attack) {
		reasons.push(
			Object.freeze({
				code: "RUAM_PURE_REGION_MAXIMUM_CUSTODY_NO_EXACT_ATTACK_BOUND",
			})
		);
	} else if (attack.queries < policy.minimumExactAttackQueries) {
		reasons.push(
			Object.freeze({
				code: "RUAM_PURE_REGION_MAXIMUM_CUSTODY_CHEAP_EXACT_ATTACK",
				method: attack.method,
				queries: attack.queries,
				minimumExactAttackQueries: policy.minimumExactAttackQueries,
			})
		);
	}

	const eligibleForMaximumCustody = reasons.length === 0;
	return Object.freeze({
		decision: eligibleForMaximumCustody ? "eligible" : "rejected",
		eligibleForMaximumCustody,
		minimumExactAttackQueries: policy.minimumExactAttackQueries,
		cheapestKnownExactAttack: attack,
		reasons: Object.freeze(reasons),
		boundInterpretation: "constructive-exact-attack-upper-bound",
		hardnessLowerBound: null,
		nonClaim: PURE_REGION_LEARNABILITY_NON_CLAIM,
	});
}

function analyzeContract(
	contract: PureRegionContract,
	inputDomains: Array<PureRegionValueDomain | undefined>,
	source: "contract" | "lowered-contract",
	initialIssues: readonly PureRegionLearnabilityIssue[]
): PureRegionLearnabilityAnalysis {
	const issues = Array.from(initialIssues);
	if (contract.inputs.length === 0) {
		addIssue(issues, "RUAM_PURE_REGION_LEARNABILITY_NO_INPUTS", "inputs");
	}
	if (contract.steps.length < 2) {
		addIssue(
			issues,
			"RUAM_PURE_REGION_LEARNABILITY_TOO_FEW_STEPS",
			String(contract.steps.length)
		);
	}
	if (contract.outputs.length === 0) {
		addIssue(issues, "RUAM_PURE_REGION_LEARNABILITY_NO_OUTPUTS", "outputs");
	}
	if (inputDomains.length !== contract.inputs.length) {
		addIssue(
			issues,
			"RUAM_PURE_REGION_LEARNABILITY_INPUT_DOMAIN_COUNT_MISMATCH",
			`${inputDomains.length}:${contract.inputs.length}`
		);
	}

	const domainAnalyses: PureRegionInputDomainAnalysis[] = [];
	const valueFacts: ValueFact[] = [];
	const values: PureRegionValueDegreeAnalysis[] = [];

	for (let inputIndex = 0; inputIndex < contract.inputs.length; inputIndex++) {
		const declaredType = validValueType(contract.inputs[inputIndex]!.type)
			? contract.inputs[inputIndex]!.type
			: null;
		if (!declaredType) {
			addIssue(
				issues,
				"RUAM_PURE_REGION_LEARNABILITY_INVALID_VALUE_TYPE",
				String(contract.inputs[inputIndex]!.type),
				{ inputIndex, valueRef: inputIndex }
			);
		}
		const domain = inputDomains[inputIndex];
		const analyzedDomain = analyzeDomain(
			domain,
			declaredType,
			inputIndex,
			issues
		);
		domainAnalyses.push(analyzedDomain);
		const fact = Object.freeze({
			type: declaredType,
			degree: declaredType ? 1n : null,
		});
		valueFacts.push(fact);
		values.push(
			Object.freeze({
				valueRef: inputIndex,
				source: "input",
				type: fact.type,
				algebraicDegreeUpperBound: fact.degree,
			})
		);
	}

	for (let stepIndex = 0; stepIndex < contract.steps.length; stepIndex++) {
		const step = contract.steps[stepIndex]!;
		const valueRef = contract.inputs.length + stepIndex;
		const declaredType = validValueType(step.type) ? step.type : null;
		if (!declaredType) {
			addIssue(
				issues,
				"RUAM_PURE_REGION_LEARNABILITY_INVALID_VALUE_TYPE",
				String(step.type),
				{ stepIndex, valueRef }
			);
		}
		const degree = analyzeFormulaDegree(
			step.formula,
			declaredType,
			valueFacts,
			stepIndex,
			valueRef,
			issues
		);
		const fact = Object.freeze({ type: declaredType, degree });
		valueFacts.push(fact);
		values.push(
			Object.freeze({
				valueRef,
				source: "step",
				type: fact.type,
				algebraicDegreeUpperBound: fact.degree,
			})
		);
	}

	const enumerationQueries = completeEnumerationQueries(domainAnalyses);
	const outputs: PureRegionOutputLearnabilityAnalysis[] = [];
	for (let outputIndex = 0; outputIndex < contract.outputs.length; outputIndex++) {
		const valueRef = contract.outputs[outputIndex]!;
		const fact = readOutputFact(valueRef, valueFacts, outputIndex, issues);
		const dense = analyzeDenseInterpolation(
			contract.inputs.length,
			fact?.degree ?? null,
			domainAnalyses
		);
		outputs.push(
			Object.freeze({
				outputIndex,
				valueRef,
				type: fact?.type ?? null,
				algebraicDegreeUpperBound: fact?.degree ?? null,
				denseInterpolation: dense,
				cheapestKnownExactAttack: fact
					? chooseCheapestAttack(
							enumerationQueries,
							dense.attackQueryUpperBound
						)
					: null,
			})
		);
	}

	const allOutputDegrees =
		outputs.length > 0 &&
		outputs.every(
			(output) => output.algebraicDegreeUpperBound !== null
		)
			? outputs.map((output) => output.algebraicDegreeUpperBound!)
			: null;
	const contractDegree = allOutputDegrees
		? maxBigInt(allOutputDegrees)
		: null;
	const denseInterpolation = analyzeDenseInterpolation(
		contract.inputs.length,
		contractDegree,
		domainAnalyses
	);
	const hasValidOutputs =
		outputs.length === contract.outputs.length &&
		outputs.length > 0 &&
		outputs.every((output) => output.type !== null);
	const cheapestKnownExactAttack = hasValidOutputs
		? chooseCheapestAttack(
				enumerationQueries,
				denseInterpolation.attackQueryUpperBound
			)
		: null;

	return Object.freeze({
		source,
		inputDomains: Object.freeze(domainAnalyses),
		values: Object.freeze(values),
		outputs: Object.freeze(outputs),
		inputEnumerationQueryUpperBound: enumerationQueries,
		denseInterpolation,
		cheapestKnownExactAttack,
		issues: Object.freeze(issues),
		boundInterpretation: "constructive-exact-attack-upper-bound",
		hardnessLowerBound: null,
		nonClaim: PURE_REGION_LEARNABILITY_NON_CLAIM,
	});
}

function analyzeDomain(
	domain: PureRegionValueDomain | undefined,
	declaredType: PureValueType | null,
	inputIndex: number,
	issues: PureRegionLearnabilityIssue[]
): PureRegionInputDomainAnalysis {
	if (!domain) {
		addIssue(
			issues,
			"RUAM_PURE_REGION_LEARNABILITY_MISSING_INPUT_DOMAIN",
			String(inputIndex),
			{ inputIndex, valueRef: inputIndex }
		);
		return Object.freeze({
			inputIndex,
			type: declaredType,
			domain: null,
			cardinality: null,
		});
	}
	const frozenDomain = freezeDomain(domain);
	if (
		domain.type !== "boolean" &&
		(domain.type !== "number" ||
			!Number.isSafeInteger(domain.min) ||
			!Number.isSafeInteger(domain.max) ||
			domain.min > domain.max)
	) {
		addIssue(
			issues,
			"RUAM_PURE_REGION_LEARNABILITY_INVALID_INPUT_DOMAIN",
			String(inputIndex),
			{ inputIndex, valueRef: inputIndex }
		);
		return Object.freeze({
			inputIndex,
			type: declaredType,
			domain: frozenDomain,
			cardinality: null,
		});
	}
	if (declaredType !== domain.type) {
		addIssue(
			issues,
			"RUAM_PURE_REGION_LEARNABILITY_INPUT_TYPE_MISMATCH",
			`${String(declaredType)}:${domain.type}`,
			{ inputIndex, valueRef: inputIndex }
		);
		return Object.freeze({
			inputIndex,
			type: declaredType,
			domain: frozenDomain,
			cardinality: null,
		});
	}
	const cardinality =
		domain.type === "boolean"
			? 2n
			: BigInt(domain.max) - BigInt(domain.min) + 1n;
	return Object.freeze({
		inputIndex,
		type: declaredType,
		domain: frozenDomain,
		cardinality,
	});
}

function analyzeFormulaDegree(
	formula: PureRegionFormula,
	resultType: PureValueType | null,
	facts: readonly ValueFact[],
	stepIndex: number,
	valueRef: PureValueRef,
	issues: PureRegionLearnabilityIssue[]
): bigint | null {
	const context = { stepIndex, valueRef };
	const unary = (
		ref: PureValueRef,
		expectedType: PureValueType
	): ValueFact | null => {
		const fact = readFormulaFact(ref, facts, issues, context);
		if (fact && (resultType !== expectedType || fact.type !== expectedType)) {
			addIssue(
				issues,
				"RUAM_PURE_REGION_LEARNABILITY_FORMULA_TYPE_MISMATCH",
				`${String(resultType)}:${String(fact.type)}:${expectedType}`,
				context
			);
			return null;
		}
		return fact;
	};
	const binary = (
		leftRef: PureValueRef,
		rightRef: PureValueRef,
		expectedType: PureValueType
	): readonly [ValueFact, ValueFact] | null => {
		const left = readFormulaFact(leftRef, facts, issues, context);
		const right = readFormulaFact(rightRef, facts, issues, context);
		if (!left || !right) return null;
		if (
			resultType !== expectedType ||
			left.type !== expectedType ||
			right.type !== expectedType
		) {
			addIssue(
				issues,
				"RUAM_PURE_REGION_LEARNABILITY_FORMULA_TYPE_MISMATCH",
				`${String(resultType)}:${String(left.type)}:${String(right.type)}`,
				context
			);
			return null;
		}
		return [left, right];
	};

	switch (formula.tag) {
		case "literal": {
			const validLiteral =
				formula.type === resultType &&
				((formula.type === "number" &&
					typeof formula.value === "number" &&
					Number.isFinite(formula.value)) ||
					(formula.type === "boolean" &&
						typeof formula.value === "boolean"));
			if (!validLiteral) {
				addIssue(
					issues,
					formula.type === resultType
						? "RUAM_PURE_REGION_LEARNABILITY_INVALID_LITERAL"
						: "RUAM_PURE_REGION_LEARNABILITY_FORMULA_TYPE_MISMATCH",
					String(formula.type),
					context
				);
				return null;
			}
			return 0n;
		}
		case "sum":
		case "difference": {
			const pair = binary(formula.left, formula.right, "number");
			return pair &&
				pair[0].degree !== null &&
				pair[1].degree !== null
				? maxBigInt([pair[0].degree, pair[1].degree])
				: null;
		}
		case "product": {
			const pair = binary(formula.left, formula.right, "number");
			return pair &&
				pair[0].degree !== null &&
				pair[1].degree !== null
				? pair[0].degree + pair[1].degree
				: null;
		}
		case "negate": {
			const value = unary(formula.value, "number");
			return value?.degree ?? null;
		}
		case "not": {
			const value = unary(formula.value, "boolean");
			return value?.degree ?? null;
		}
		case "and":
		case "or":
		case "xor": {
			const pair = binary(formula.left, formula.right, "boolean");
			return pair &&
				pair[0].degree !== null &&
				pair[1].degree !== null
				? pair[0].degree + pair[1].degree
				: null;
		}
		case "select": {
			const gate = readFormulaFact(
				formula.gate,
				facts,
				issues,
				context
			);
			const whenTrue = readFormulaFact(
				formula.whenTrue,
				facts,
				issues,
				context
			);
			const whenFalse = readFormulaFact(
				formula.whenFalse,
				facts,
				issues,
				context
			);
			if (!gate || !whenTrue || !whenFalse) return null;
			if (
				gate.type !== "boolean" ||
				resultType === null ||
				whenTrue.type !== resultType ||
				whenFalse.type !== resultType
			) {
				addIssue(
					issues,
					"RUAM_PURE_REGION_LEARNABILITY_FORMULA_TYPE_MISMATCH",
					`${String(gate.type)}:${String(whenTrue.type)}:${String(whenFalse.type)}`,
					context
				);
				return null;
			}
			if (
				gate.degree === null ||
				whenTrue.degree === null ||
				whenFalse.degree === null
			) {
				return null;
			}
			return maxBigInt([
				whenFalse.degree,
				gate.degree + whenTrue.degree,
				gate.degree + whenFalse.degree,
			]);
		}
		default:
			addIssue(
				issues,
				"RUAM_PURE_REGION_LEARNABILITY_UNSUPPORTED_FORMULA",
				String((formula as { tag?: unknown }).tag),
				context
			);
			return null;
	}
}

function analyzeDenseInterpolation(
	inputCount: number,
	degree: bigint | null,
	domains: readonly PureRegionInputDomainAnalysis[]
): DenseInterpolationAnalysis {
	if (degree === null) {
		return freezeDense(null, null, null, "unknown-algebraic-degree");
	}
	const basisQueries =
		inputCount > 0 ? denseMonomialCount(inputCount, degree) : null;
	if (
		basisQueries === null ||
		domains.length !== inputCount ||
		domains.some((domain) => domain.cardinality === null)
	) {
		return freezeDense(
			degree,
			basisQueries,
			null,
			"invalid-input-domain"
		);
	}
	if (degree === 0n) {
		return freezeDense(degree, basisQueries, 1n, null);
	}
	if (domains.some((domain) => domain.domain?.type === "boolean")) {
		return freezeDense(
			degree,
			basisQueries,
			null,
			"boolean-input-domain"
		);
	}
	const requiredDistinctPoints = degree + 1n;
	if (
		domains.some(
			(domain) => domain.cardinality! < requiredDistinctPoints
		)
	) {
		return freezeDense(
			degree,
			basisQueries,
			null,
			"insufficient-distinct-numeric-points"
		);
	}
	return freezeDense(degree, basisQueries, basisQueries, null);
}

function denseMonomialCount(
	inputCount: number,
	degree: bigint
): bigint {
	let result = 1n;
	for (let input = 1; input <= inputCount; input++) {
		const factor = BigInt(input);
		result = (result * (degree + factor)) / factor;
	}
	return result;
}

function completeEnumerationQueries(
	domains: readonly PureRegionInputDomainAnalysis[]
): bigint | null {
	if (
		domains.length === 0 ||
		domains.some((domain) => domain.cardinality === null)
	) {
		return null;
	}
	return domains.reduce(
		(product, domain) => product * domain.cardinality!,
		1n
	);
}

function chooseCheapestAttack(
	enumerationQueries: bigint | null,
	denseQueries: bigint | null
): PureRegionExactAttackUpperBound | null {
	if (enumerationQueries === null && denseQueries === null) return null;
	if (enumerationQueries === null) {
		return Object.freeze({
			method: "dense-interpolation",
			queries: denseQueries!,
		});
	}
	if (denseQueries === null) {
		return Object.freeze({
			method: "input-enumeration",
			queries: enumerationQueries,
		});
	}
	if (enumerationQueries === denseQueries) {
		return Object.freeze({
			method: "tied",
			queries: enumerationQueries,
		});
	}
	return enumerationQueries < denseQueries
		? Object.freeze({
				method: "input-enumeration",
				queries: enumerationQueries,
			})
		: Object.freeze({
				method: "dense-interpolation",
				queries: denseQueries,
			});
}

function readFormulaFact(
	ref: PureValueRef,
	facts: readonly ValueFact[],
	issues: PureRegionLearnabilityIssue[],
	context: { stepIndex: number; valueRef: PureValueRef }
): ValueFact | null {
	if (!validPriorRef(ref, facts.length)) {
		addIssue(
			issues,
			"RUAM_PURE_REGION_LEARNABILITY_INVALID_VALUE_REF",
			String(ref),
			{ ...context, valueRef: ref }
		);
		return null;
	}
	return facts[ref]!;
}

function readOutputFact(
	ref: PureValueRef,
	facts: readonly ValueFact[],
	outputIndex: number,
	issues: PureRegionLearnabilityIssue[]
): ValueFact | null {
	if (!validPriorRef(ref, facts.length)) {
		addIssue(
			issues,
			"RUAM_PURE_REGION_LEARNABILITY_INVALID_VALUE_REF",
			String(ref),
			{ outputIndex, valueRef: ref }
		);
		return null;
	}
	return facts[ref]!;
}

function deriveLoweredInputDomains(
	lowered: LoweredPureRegionContract
): DerivedDomains {
	const domains = Array<PureRegionValueDomain | undefined>(
		lowered.contract.inputs.length
	).fill(undefined);
	const issues: PureRegionLearnabilityIssue[] = [];
	for (const binding of lowered.inputBindings) {
		if (
			!Number.isSafeInteger(binding.contractInput) ||
			binding.contractInput < 0 ||
			binding.contractInput >= domains.length ||
			domains[binding.contractInput] !== undefined
		) {
			addIssue(
				issues,
				"RUAM_PURE_REGION_LEARNABILITY_INVALID_LOWERED_INPUT_BINDING",
				String(binding.contractInput),
				{
					inputIndex: Number.isSafeInteger(binding.contractInput)
						? binding.contractInput
						: null,
				}
			);
			continue;
		}
		domains[binding.contractInput] = binding.domain;
	}
	return { domains, issues };
}

function freezeDense(
	degree: bigint | null,
	basisQueries: bigint | null,
	attackQueries: bigint | null,
	inapplicableReason: DenseInterpolationInapplicability
): DenseInterpolationAnalysis {
	return Object.freeze({
		totalDegreeUpperBound: degree,
		basisQueryCount: basisQueries,
		attackQueryUpperBound: attackQueries,
		inapplicableReason,
	});
}

function freezeDomain(
	domain: PureRegionValueDomain
): PureRegionValueDomain {
	return Object.freeze({ ...domain }) as PureRegionValueDomain;
}

function validValueType(value: unknown): value is PureValueType {
	return value === "number" || value === "boolean";
}

function validPriorRef(ref: PureValueRef, upperBound: number): boolean {
	return (
		Number.isSafeInteger(ref) &&
		ref >= 0 &&
		ref < upperBound
	);
}

function maxBigInt(values: readonly bigint[]): bigint {
	let result = values[0]!;
	for (let index = 1; index < values.length; index++) {
		if (values[index]! > result) result = values[index]!;
	}
	return result;
}

function isLoweredContract(
	source: LoweredPureRegionContract | PureRegionContract
): source is LoweredPureRegionContract {
	return "contract" in source;
}

function addIssue(
	issues: PureRegionLearnabilityIssue[],
	code: PureRegionLearnabilityIssueCode,
	detail: string,
	location: Partial<
		Pick<
			PureRegionLearnabilityIssue,
			"inputIndex" | "stepIndex" | "outputIndex" | "valueRef"
		>
	> = {}
): void {
	issues.push(
		Object.freeze({
			code,
			detail,
			inputIndex: location.inputIndex ?? null,
			stepIndex: location.stepIndex ?? null,
			outputIndex: location.outputIndex ?? null,
			valueRef: location.valueRef ?? null,
		})
	);
}
