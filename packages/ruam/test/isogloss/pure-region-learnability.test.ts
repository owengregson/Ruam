import { describe, expect, it } from "bun:test";
import {
	analyzePureRegionLearnability,
	assessMaximumCustodyLearnability,
	PURE_REGION_LEARNABILITY_NON_CLAIM,
	type LoweredPureRegionContract,
	type PureRegionValueDomain,
} from "../../src/compiler/index.js";
import type { PureRegionContract } from "../../src/isogloss/bprf/index.js";

function degreeNineContract(): PureRegionContract {
	return {
		inputs: [
			{ type: "number" },
			{ type: "number" },
			{ type: "number" },
		],
		steps: [
			{ type: "number", formula: { tag: "product", left: 0, right: 0 } },
			{ type: "number", formula: { tag: "product", left: 3, right: 0 } },
			{ type: "number", formula: { tag: "product", left: 1, right: 1 } },
			{ type: "number", formula: { tag: "product", left: 5, right: 1 } },
			{ type: "number", formula: { tag: "product", left: 2, right: 2 } },
			{ type: "number", formula: { tag: "product", left: 7, right: 2 } },
			{ type: "number", formula: { tag: "product", left: 4, right: 6 } },
			{ type: "number", formula: { tag: "product", left: 9, right: 8 } },
		],
		outputs: [10],
	};
}

function numericDomains(
	count: number,
	min: number,
	max: number
): PureRegionValueDomain[] {
	return Array.from({ length: count }, () => ({
		type: "number",
		min,
		max,
	}));
}

function asLowered(
	contract: PureRegionContract,
	domains: readonly PureRegionValueDomain[]
): LoweredPureRegionContract {
	return {
		unitId: "learnability-fixture",
		regionIds: ["r_0"],
		contract,
		inputBindings: domains
			.map((domain, contractInput) => ({
				contractInput,
				binding: { kind: "argument" as const, index: contractInput },
				domain,
			}))
			.reverse(),
		outputBindings: [],
	};
}

describe("pure-region black-box learnability risk gate", () => {
	it("reports the 220-query exact interpolation attack for degree nine in three variables", () => {
		const contract = degreeNineContract();
		const domains = numericDomains(3, 0, 9);
		const first = analyzePureRegionLearnability(contract, domains);
		const second = analyzePureRegionLearnability(contract, domains);
		const lowered = analyzePureRegionLearnability(
			asLowered(contract, domains)
		);

		expect(second).toEqual(first);
		expect(first.issues).toEqual([]);
		expect(first.inputDomains.map((input) => input.cardinality)).toEqual([
			10n,
			10n,
			10n,
		]);
		expect(
			first.values.map((value) => value.algebraicDegreeUpperBound)
		).toEqual([1n, 1n, 1n, 2n, 3n, 2n, 3n, 2n, 3n, 6n, 9n]);
		expect(first.outputs[0]!.algebraicDegreeUpperBound).toBe(9n);
		expect(first.outputs[0]!.denseInterpolation).toEqual({
			totalDegreeUpperBound: 9n,
			basisQueryCount: 220n,
			attackQueryUpperBound: 220n,
			inapplicableReason: null,
		});
		expect(first.inputEnumerationQueryUpperBound).toBe(1_000n);
		expect(first.cheapestKnownExactAttack).toEqual({
			method: "dense-interpolation",
			queries: 220n,
		});
		expect(lowered.source).toBe("lowered-contract");
		expect(lowered.inputDomains).toEqual(first.inputDomains);
		expect(lowered.denseInterpolation).toEqual(first.denseInterpolation);
		expect(lowered.cheapestKnownExactAttack).toEqual(
			first.cheapestKnownExactAttack
		);

		const rejected = assessMaximumCustodyLearnability(first, {
			minimumExactAttackQueries: 221n,
		});
		expect(rejected.decision).toBe("rejected");
		expect(rejected.eligibleForMaximumCustody).toBe(false);
		expect(rejected.reasons).toEqual([
			{
				code: "RUAM_PURE_REGION_MAXIMUM_CUSTODY_CHEAP_EXACT_ATTACK",
				method: "dense-interpolation",
				queries: 220n,
				minimumExactAttackQueries: 221n,
			},
		]);

		const thresholdTie = assessMaximumCustodyLearnability(first, {
			minimumExactAttackQueries: 220n,
		});
		expect(thresholdTie.decision).toBe("eligible");
		expect(thresholdTie.reasons).toEqual([]);
	});

	it("rejects simple low-degree contracts using the cheapest constructive attack", () => {
		const contract: PureRegionContract = {
			inputs: [{ type: "number" }, { type: "number" }],
			steps: [
				{
					type: "number",
					formula: { tag: "literal", type: "number", value: 1 },
				},
				{
					type: "number",
					formula: { tag: "sum", left: 0, right: 1 },
				},
			],
			outputs: [3],
		};
		const analysis = analyzePureRegionLearnability(
			contract,
			numericDomains(2, 0, 99)
		);

		expect(analysis.outputs[0]!.algebraicDegreeUpperBound).toBe(1n);
		expect(analysis.inputEnumerationQueryUpperBound).toBe(10_000n);
		expect(analysis.denseInterpolation.attackQueryUpperBound).toBe(3n);
		expect(analysis.cheapestKnownExactAttack).toEqual({
			method: "dense-interpolation",
			queries: 3n,
		});
		expect(
			assessMaximumCustodyLearnability(analysis, {
				minimumExactAttackQueries: 100n,
			}).reasons
		).toEqual([
			{
				code: "RUAM_PURE_REGION_MAXIMUM_CUSTODY_CHEAP_EXACT_ATTACK",
				method: "dense-interpolation",
				queries: 3n,
				minimumExactAttackQueries: 100n,
			},
		]);
	});

	it("uses exact enumeration when numeric domains cannot support the dense simplex", () => {
		const analysis = analyzePureRegionLearnability(
			degreeNineContract(),
			numericDomains(3, 0, 1)
		);

		expect(analysis.denseInterpolation.basisQueryCount).toBe(220n);
		expect(analysis.denseInterpolation.attackQueryUpperBound).toBeNull();
		expect(analysis.denseInterpolation.inapplicableReason).toBe(
			"insufficient-distinct-numeric-points"
		);
		expect(analysis.inputEnumerationQueryUpperBound).toBe(8n);
		expect(analysis.cheapestKnownExactAttack).toEqual({
			method: "input-enumeration",
			queries: 8n,
		});
	});

	it("handles boolean cardinalities without misapplying numeric interpolation", () => {
		const contract: PureRegionContract = {
			inputs: [{ type: "boolean" }, { type: "boolean" }],
			steps: [
				{
					type: "boolean",
					formula: { tag: "and", left: 0, right: 1 },
				},
				{
					type: "boolean",
					formula: { tag: "not", value: 2 },
				},
			],
			outputs: [3],
		};
		const analysis = analyzePureRegionLearnability(contract, [
			{ type: "boolean" },
			{ type: "boolean" },
		]);

		expect(analysis.inputDomains.map((input) => input.cardinality)).toEqual([
			2n,
			2n,
		]);
		expect(analysis.outputs[0]!.algebraicDegreeUpperBound).toBe(2n);
		expect(analysis.denseInterpolation.basisQueryCount).toBe(6n);
		expect(analysis.denseInterpolation.attackQueryUpperBound).toBeNull();
		expect(analysis.denseInterpolation.inapplicableReason).toBe(
			"boolean-input-domain"
		);
		expect(analysis.inputEnumerationQueryUpperBound).toBe(4n);
		expect(analysis.cheapestKnownExactAttack).toEqual({
			method: "input-enumeration",
			queries: 4n,
		});
	});

	it("keeps degree and query arithmetic exact beyond Number saturation", () => {
		const squaringSteps: PureRegionContract["steps"][number][] = [
			{
				type: "number",
				formula: { tag: "product", left: 0, right: 1 },
			},
		];
		for (let step = 0; step < 1_024; step++) {
			const priorRef = 2 + squaringSteps.length - 1;
			squaringSteps.push({
				type: "number",
				formula: { tag: "product", left: priorRef, right: priorRef },
			});
		}
		const contract: PureRegionContract = {
			inputs: [{ type: "number" }, { type: "number" }],
			steps: squaringSteps,
			outputs: [2 + squaringSteps.length - 1],
		};
		const degree = 1n << 1_025n;
		const expectedBasis = ((degree + 1n) * (degree + 2n)) / 2n;
		const widestSafeIntegerDomain = {
			type: "number",
			min: Number.MIN_SAFE_INTEGER,
			max: Number.MAX_SAFE_INTEGER,
		} as const;
		const cardinality =
			BigInt(Number.MAX_SAFE_INTEGER) -
			BigInt(Number.MIN_SAFE_INTEGER) +
			1n;
		const analysis = analyzePureRegionLearnability(contract, [
			widestSafeIntegerDomain,
			widestSafeIntegerDomain,
		]);

		expect(analysis.outputs[0]!.algebraicDegreeUpperBound).toBe(degree);
		expect(analysis.denseInterpolation.basisQueryCount).toBe(expectedBasis);
		expect(typeof analysis.denseInterpolation.basisQueryCount).toBe("bigint");
		expect(Number(analysis.denseInterpolation.basisQueryCount)).toBe(
			Number.POSITIVE_INFINITY
		);
		expect(analysis.inputEnumerationQueryUpperBound).toBe(
			cardinality * cardinality
		);
		expect(Number.isSafeInteger(Number(analysis.inputEnumerationQueryUpperBound))).toBe(
			false
		);
	});

	it("fails closed on unknown formulas even when enumeration exceeds policy", () => {
		const futureContract = {
			inputs: [{ type: "number" }],
			steps: [
				{
					type: "number",
					formula: { tag: "future-hash", value: 0 },
				},
				{
					type: "number",
					formula: { tag: "negate", value: 1 },
				},
			],
			outputs: [2],
		} as unknown as PureRegionContract;
		const first = analyzePureRegionLearnability(futureContract, [
			{ type: "number", min: 0, max: 9_999 },
		]);
		const second = analyzePureRegionLearnability(futureContract, [
			{ type: "number", min: 0, max: 9_999 },
		]);

		expect(second).toEqual(first);
		expect(first.inputEnumerationQueryUpperBound).toBe(10_000n);
		expect(first.cheapestKnownExactAttack).toEqual({
			method: "input-enumeration",
			queries: 10_000n,
		});
		expect(first.issues).toEqual([
			{
				code: "RUAM_PURE_REGION_LEARNABILITY_UNSUPPORTED_FORMULA",
				detail: "future-hash",
				inputIndex: null,
				stepIndex: 0,
				outputIndex: null,
				valueRef: 1,
			},
		]);
		const decision = assessMaximumCustodyLearnability(first, {
			minimumExactAttackQueries: 100n,
		});
		expect(decision.decision).toBe("rejected");
		expect(decision.reasons).toEqual([
			{
				code: "RUAM_PURE_REGION_MAXIMUM_CUSTODY_ANALYSIS_ISSUE",
				issue: first.issues[0],
			},
		]);
	});

	it("states attack bounds as non-claims and validates the policy threshold", () => {
		const analysis = analyzePureRegionLearnability(
			degreeNineContract(),
			numericDomains(3, 0, 9)
		);
		const decision = assessMaximumCustodyLearnability(analysis, {
			minimumExactAttackQueries: 220n,
		});

		expect(analysis.boundInterpretation).toBe(
			"constructive-exact-attack-upper-bound"
		);
		expect(analysis.hardnessLowerBound).toBeNull();
		expect(analysis.nonClaim).toBe(PURE_REGION_LEARNABILITY_NON_CLAIM);
		expect(analysis.nonClaim).toContain(
			"does not establish a hardness lower bound"
		);
		expect(decision.hardnessLowerBound).toBeNull();
		expect(decision.nonClaim).toBe(PURE_REGION_LEARNABILITY_NON_CLAIM);
		expect(() =>
			assessMaximumCustodyLearnability(analysis, {
				minimumExactAttackQueries: -1n,
			})
		).toThrow(
			"RUAM_PURE_REGION_LEARNABILITY_INVALID_POLICY_THRESHOLD"
		);
	});
});
