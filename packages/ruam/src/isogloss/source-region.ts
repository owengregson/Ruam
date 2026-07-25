/**
 * Conservative source-AST lowering for locally guarded pure Isogloss regions.
 *
 * This is deliberately smaller than JavaScript expression semantics. It
 * accepts only local identifiers, finite integer literals, and arithmetic or
 * Boolean forms whose complete eager evaluation is observationally
 * equivalent to the source form. Every numeric ingress is guarded at runtime
 * by the exact domain recorded here. Product lowering replaces the source
 * expression completely and rejects values outside the developer-declared
 * contract; embedding the original expression as a fallback would hand the
 * protected relation back to the client.
 *
 * @module isogloss/source-region
 */

import * as t from "@babel/types";
import type {
	PureRegionContract,
	PureRegionFormula,
	PureValueRef,
	PureValueType,
} from "./bprf/index.js";
import type { PureRegionValueDomain } from "../compiler/pure-region-lowering.js";

export interface SourceRegionNumericDomain {
	readonly type: "number";
	readonly min: number;
	readonly max: number;
}

export interface SourceRegionBooleanDomain {
	readonly type: "boolean";
}

export type SourceRegionDomain =
	| SourceRegionNumericDomain
	| SourceRegionBooleanDomain;

export interface SourceRegionIngress {
	readonly name: string;
	readonly type: PureValueType;
	readonly domain: PureRegionValueDomain;
}

export interface SourceRegionValueBounds {
	readonly type: PureValueType;
	readonly min: number | null;
	readonly max: number | null;
	readonly mayBeZero: boolean;
	readonly mayBeNegative: boolean;
}

export interface LoweredSourcePureRegion {
	readonly contract: PureRegionContract;
	readonly ingress: readonly SourceRegionIngress[];
	readonly valueBounds: readonly SourceRegionValueBounds[];
	readonly outputType: PureValueType;
	readonly runtimeGuardRequired: true;
	readonly domainFailurePolicy: "reject-outside-declared-domain";
}

export type SourceRegionRejectionCode =
	| "RUAM_SOURCE_REGION_UNSUPPORTED_EXPRESSION"
	| "RUAM_SOURCE_REGION_UNBOUND_IDENTIFIER"
	| "RUAM_SOURCE_REGION_MISSING_DOMAIN"
	| "RUAM_SOURCE_REGION_DOMAIN_TYPE_MISMATCH"
	| "RUAM_SOURCE_REGION_INVALID_DOMAIN"
	| "RUAM_SOURCE_REGION_IDENTIFIER_TYPE_CONFLICT"
	| "RUAM_SOURCE_REGION_UNSAFE_LITERAL"
	| "RUAM_SOURCE_REGION_UNSAFE_INTEGER_RANGE"
	| "RUAM_SOURCE_REGION_NEGATIVE_ZERO"
	| "RUAM_SOURCE_REGION_BRANCH_TYPE_MISMATCH";

export interface SourceRegionRejection {
	readonly code: SourceRegionRejectionCode;
	readonly detail: string;
}

export type SourceRegionLoweringResult =
	| {
			readonly accepted: true;
			readonly region: LoweredSourcePureRegion;
	  }
	| {
			readonly accepted: false;
			readonly rejection: SourceRegionRejection;
	  };

export interface SourceRegionLoweringOptions {
	/**
	 * Exact runtime domain guards for local identifiers. The source transform
	 * must prove locality independently and pass only local binding names.
	 */
	readonly domains: Readonly<Record<string, SourceRegionDomain>>;
	/** Names proven by the caller to resolve to local lexical bindings. */
	readonly localBindings: ReadonlySet<string>;
}

interface MutableIngress {
	name: string;
	type: PureValueType;
	domain: PureRegionValueDomain;
}

interface LoweringState {
	inputs: MutableIngress[];
	inputByName: Map<string, number>;
	steps: Array<{ type: PureValueType; formula: PureRegionFormula }>;
	bounds: SourceRegionValueBounds[];
	options: SourceRegionLoweringOptions;
}

interface LoweredValue {
	ref: PureValueRef;
	bounds: SourceRegionValueBounds;
}

class SourceRegionError extends Error {
	constructor(
		readonly code: SourceRegionRejectionCode,
		detail: string
	) {
		super(detail);
	}
}

export function lowerSourcePureExpression(
	expression: t.Expression,
	options: SourceRegionLoweringOptions
): SourceRegionLoweringResult {
	const state: LoweringState = {
		inputs: [],
		inputByName: new Map(),
		steps: [],
		bounds: [],
		options,
	};
	try {
		// Value references address `[all inputs, then all steps]`. Discover the
		// complete ingress prefix before emitting any step so a later first use
		// of an input cannot shift already-emitted step references.
		if (isSupportedSourceExpressionShape(expression)) {
			predeclareSourceInputs(expression, state);
		}
		const output = lowerExpression(expression, state, null);
		const contract: PureRegionContract = Object.freeze({
			inputs: Object.freeze(
				state.inputs.map((input) =>
					Object.freeze({ type: input.type })
				)
			),
			steps: Object.freeze(
				state.steps.map((step) =>
					Object.freeze({
						type: step.type,
						formula: Object.freeze({ ...step.formula }),
					})
				)
			),
			outputs: Object.freeze([output.ref]),
		});
		return Object.freeze({
			accepted: true,
			region: Object.freeze({
				contract,
				ingress: Object.freeze(
					state.inputs.map((input) =>
						Object.freeze({
							name: input.name,
							type: input.type,
							domain: freezeDomain(input.domain),
						})
					)
				),
				valueBounds: Object.freeze(state.bounds.slice()),
				outputType: output.bounds.type,
				runtimeGuardRequired: true,
				domainFailurePolicy: "reject-outside-declared-domain",
			}),
		});
	} catch (error) {
		if (!(error instanceof SourceRegionError)) throw error;
		return Object.freeze({
			accepted: false,
			rejection: Object.freeze({
				code: error.code,
				detail: error.message,
			}),
		});
	}
}

function isSupportedSourceExpressionShape(expression: t.Expression): boolean {
	if (
		t.isIdentifier(expression) ||
		t.isNumericLiteral(expression) ||
		t.isBooleanLiteral(expression)
	) {
		return true;
	}
	if (t.isParenthesizedExpression(expression)) {
		return isSupportedSourceExpressionShape(expression.expression);
	}
	if (
		t.isUnaryExpression(expression) &&
		(expression.operator === "-" || expression.operator === "!") &&
		t.isExpression(expression.argument)
	) {
		return isSupportedSourceExpressionShape(expression.argument);
	}
	if (
		t.isBinaryExpression(expression) &&
		(expression.operator === "+" ||
			expression.operator === "-" ||
			expression.operator === "*") &&
		t.isExpression(expression.left) &&
		t.isExpression(expression.right)
	) {
		return (
			isSupportedSourceExpressionShape(expression.left) &&
			isSupportedSourceExpressionShape(expression.right)
		);
	}
	if (
		t.isLogicalExpression(expression) &&
		(expression.operator === "&&" || expression.operator === "||")
	) {
		return (
			isSupportedSourceExpressionShape(expression.left) &&
			isSupportedSourceExpressionShape(expression.right)
		);
	}
	if (t.isConditionalExpression(expression)) {
		return (
			isSupportedSourceExpressionShape(expression.test) &&
			isSupportedSourceExpressionShape(expression.consequent) &&
			isSupportedSourceExpressionShape(expression.alternate)
		);
	}
	return false;
}

function predeclareSourceInputs(
	expression: t.Expression,
	state: LoweringState
): void {
	if (t.isIdentifier(expression)) {
		lowerIdentifier(expression, state, null);
		return;
	}
	if (
		t.isNumericLiteral(expression) ||
		t.isBooleanLiteral(expression)
	) {
		return;
	}
	if (t.isParenthesizedExpression(expression)) {
		predeclareSourceInputs(expression.expression, state);
		return;
	}
	if (t.isUnaryExpression(expression) && t.isExpression(expression.argument)) {
		predeclareSourceInputs(expression.argument, state);
		return;
	}
	if (
		(t.isBinaryExpression(expression) ||
			t.isLogicalExpression(expression)) &&
		t.isExpression(expression.left) &&
		t.isExpression(expression.right)
	) {
		predeclareSourceInputs(expression.left, state);
		predeclareSourceInputs(expression.right, state);
		return;
	}
	if (t.isConditionalExpression(expression)) {
		predeclareSourceInputs(expression.test, state);
		predeclareSourceInputs(expression.consequent, state);
		predeclareSourceInputs(expression.alternate, state);
	}
}

function lowerExpression(
	expression: t.Expression,
	state: LoweringState,
	expectedType: PureValueType | null
): LoweredValue {
	if (t.isParenthesizedExpression(expression)) {
		return lowerExpression(expression.expression, state, expectedType);
	}
	if (t.isIdentifier(expression)) {
		return lowerIdentifier(expression, state, expectedType);
	}
	if (t.isNumericLiteral(expression)) {
		if (
			!Number.isSafeInteger(expression.value) ||
			Object.is(expression.value, -0)
		) {
			fail(
				Object.is(expression.value, -0)
					? "RUAM_SOURCE_REGION_NEGATIVE_ZERO"
					: "RUAM_SOURCE_REGION_UNSAFE_LITERAL",
				String(expression.value)
			);
		}
		if (expectedType === "boolean") {
			fail(
				"RUAM_SOURCE_REGION_DOMAIN_TYPE_MISMATCH",
				"numeric literal in boolean position"
			);
		}
		return addStep(
			state,
			"number",
			{ tag: "literal", type: "number", value: expression.value },
			numericBounds(expression.value, expression.value)
		);
	}
	if (t.isBooleanLiteral(expression)) {
		if (expectedType === "number") {
			fail(
				"RUAM_SOURCE_REGION_DOMAIN_TYPE_MISMATCH",
				"boolean literal in numeric position"
			);
		}
		return addStep(
			state,
			"boolean",
			{ tag: "literal", type: "boolean", value: expression.value },
			booleanBounds()
		);
	}
	if (
		t.isUnaryExpression(expression) &&
		(expression.operator === "-" || expression.operator === "!")
	) {
		if (!t.isExpression(expression.argument)) {
			fail(
				"RUAM_SOURCE_REGION_UNSUPPORTED_EXPRESSION",
				expression.type
			);
		}
		if (expression.operator === "!") {
			const value = lowerExpression(expression.argument, state, "boolean");
			return addStep(
				state,
				"boolean",
				{ tag: "not", value: value.ref },
				booleanBounds()
			);
		}
		const value = lowerExpression(expression.argument, state, "number");
		if (value.bounds.mayBeZero) {
			fail(
				"RUAM_SOURCE_REGION_NEGATIVE_ZERO",
				"unary negation may produce -0"
			);
		}
		return addStep(
			state,
			"number",
			{ tag: "negate", value: value.ref },
			checkedNumericBounds(
				-value.bounds.max!,
				-value.bounds.min!,
				"unary-negate"
			)
		);
	}
	if (
		t.isBinaryExpression(expression) &&
		(expression.operator === "+" ||
			expression.operator === "-" ||
			expression.operator === "*")
	) {
		if (
			!t.isExpression(expression.left) ||
			!t.isExpression(expression.right)
		) {
			fail(
				"RUAM_SOURCE_REGION_UNSUPPORTED_EXPRESSION",
				expression.type
			);
		}
		const left = lowerExpression(expression.left, state, "number");
		const right = lowerExpression(expression.right, state, "number");
		if (
			expression.operator === "*" &&
			((left.bounds.mayBeZero && right.bounds.mayBeNegative) ||
				(right.bounds.mayBeZero && left.bounds.mayBeNegative))
		) {
			fail(
				"RUAM_SOURCE_REGION_NEGATIVE_ZERO",
				"multiplication may produce -0"
			);
		}
		const range =
			expression.operator === "+"
				? checkedNumericBounds(
						left.bounds.min! + right.bounds.min!,
						left.bounds.max! + right.bounds.max!,
						"sum"
					)
				: expression.operator === "-"
					? checkedNumericBounds(
							left.bounds.min! - right.bounds.max!,
							left.bounds.max! - right.bounds.min!,
							"difference"
						)
					: productBounds(left.bounds, right.bounds);
		const tag =
			expression.operator === "+"
				? "sum"
				: expression.operator === "-"
					? "difference"
					: "product";
		return addStep(
			state,
			"number",
			{ tag, left: left.ref, right: right.ref },
			range
		);
	}
	if (
		t.isLogicalExpression(expression) &&
		(expression.operator === "&&" || expression.operator === "||")
	) {
		const left = lowerExpression(expression.left, state, "boolean");
		const right = lowerExpression(expression.right, state, "boolean");
		return addStep(
			state,
			"boolean",
			{
				tag: expression.operator === "&&" ? "and" : "or",
				left: left.ref,
				right: right.ref,
			},
			booleanBounds()
		);
	}
	if (t.isConditionalExpression(expression)) {
		const gate = lowerExpression(expression.test, state, "boolean");
		const whenTrue = lowerExpression(
			expression.consequent,
			state,
			expectedType
		);
		const whenFalse = lowerExpression(
			expression.alternate,
			state,
			whenTrue.bounds.type
		);
		if (whenTrue.bounds.type !== whenFalse.bounds.type) {
			fail(
				"RUAM_SOURCE_REGION_BRANCH_TYPE_MISMATCH",
				`${whenTrue.bounds.type}:${whenFalse.bounds.type}`
			);
		}
		const bounds =
			whenTrue.bounds.type === "boolean"
				? booleanBounds()
				: checkedNumericBounds(
						Math.min(
							whenTrue.bounds.min!,
							whenFalse.bounds.min!
						),
						Math.max(
							whenTrue.bounds.max!,
							whenFalse.bounds.max!
						),
						"select"
					);
		return addStep(
			state,
			whenTrue.bounds.type,
			{
				tag: "select",
				gate: gate.ref,
				whenTrue: whenTrue.ref,
				whenFalse: whenFalse.ref,
			},
			bounds
		);
	}
	fail("RUAM_SOURCE_REGION_UNSUPPORTED_EXPRESSION", expression.type);
}

function lowerIdentifier(
	identifier: t.Identifier,
	state: LoweringState,
	expectedType: PureValueType | null
): LoweredValue {
	if (!state.options.localBindings.has(identifier.name)) {
		fail("RUAM_SOURCE_REGION_UNBOUND_IDENTIFIER", identifier.name);
	}
	const domain = state.options.domains[identifier.name];
	if (!domain) {
		fail("RUAM_SOURCE_REGION_MISSING_DOMAIN", identifier.name);
	}
	validateDomain(identifier.name, domain);
	if (expectedType && domain.type !== expectedType) {
		fail(
			"RUAM_SOURCE_REGION_DOMAIN_TYPE_MISMATCH",
			`${identifier.name}:${domain.type}:${expectedType}`
		);
	}
	const prior = state.inputByName.get(identifier.name);
	if (prior !== undefined) {
		const ingress = state.inputs[prior]!;
		if (ingress.type !== domain.type) {
			fail(
				"RUAM_SOURCE_REGION_IDENTIFIER_TYPE_CONFLICT",
				identifier.name
			);
		}
		return {
			ref: prior,
			bounds: state.bounds[prior]!,
		};
	}
	const inputIndex = state.inputs.length;
	const frozenDomain = freezeDomain(domain);
	const bounds =
		domain.type === "boolean"
			? booleanBounds()
			: numericBounds(domain.min, domain.max);
	state.inputs.push({
		name: identifier.name,
		type: domain.type,
		domain: frozenDomain,
	});
	state.inputByName.set(identifier.name, inputIndex);
	state.bounds.push(bounds);
	return { ref: inputIndex, bounds };
}

function addStep(
	state: LoweringState,
	type: PureValueType,
	formula: PureRegionFormula,
	bounds: SourceRegionValueBounds
): LoweredValue {
	const ref = state.inputs.length + state.steps.length;
	state.steps.push({ type, formula });
	state.bounds.push(bounds);
	return { ref, bounds };
}

function validateDomain(name: string, domain: SourceRegionDomain): void {
	if (domain.type === "boolean") return;
	if (
		domain.type !== "number" ||
		!Number.isSafeInteger(domain.min) ||
		!Number.isSafeInteger(domain.max) ||
		domain.min > domain.max ||
		Object.is(domain.min, -0) ||
		Object.is(domain.max, -0)
	) {
		fail("RUAM_SOURCE_REGION_INVALID_DOMAIN", name);
	}
}

function productBounds(
	left: SourceRegionValueBounds,
	right: SourceRegionValueBounds
): SourceRegionValueBounds {
	const products = [
		left.min! * right.min!,
		left.min! * right.max!,
		left.max! * right.min!,
		left.max! * right.max!,
	];
	return checkedNumericBounds(
		Math.min(...products),
		Math.max(...products),
		"product"
	);
}

function checkedNumericBounds(
	min: number,
	max: number,
	detail: string
): SourceRegionValueBounds {
	if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) {
		fail("RUAM_SOURCE_REGION_UNSAFE_INTEGER_RANGE", detail);
	}
	return numericBounds(min, max);
}

function numericBounds(
	min: number,
	max: number
): SourceRegionValueBounds {
	return Object.freeze({
		type: "number",
		min,
		max,
		mayBeZero: min <= 0 && max >= 0,
		mayBeNegative: min < 0,
	});
}

function booleanBounds(): SourceRegionValueBounds {
	return Object.freeze({
		type: "boolean",
		min: null,
		max: null,
		mayBeZero: true,
		mayBeNegative: false,
	});
}

function freezeDomain(
	domain: SourceRegionDomain | PureRegionValueDomain
): PureRegionValueDomain {
	return Object.freeze({ ...domain }) as PureRegionValueDomain;
}

function fail(code: SourceRegionRejectionCode, detail: string): never {
	throw new SourceRegionError(code, detail);
}
