import { describe, expect, it } from "bun:test";
import { parseExpression } from "@babel/parser";
import type * as t from "@babel/types";
import { generateBprfArtifact } from "../../src/isogloss/bprf/index.js";
import { evaluateBprfReference } from "../../src/isogloss/bprf/testing-reference.js";
import { lowerSourcePureExpression } from "../../src/isogloss/source-region.js";

function expression(source: string): t.Expression {
	return parseExpression(source) as t.Expression;
}

describe("source pure-region lowering", () => {
	it("lowers a bounded mixed arithmetic expression deterministically", () => {
		const options = {
			domains: {
				x: { type: "number" as const, min: 1, max: 20 },
				y: { type: "number" as const, min: 2, max: 30 },
			},
			localBindings: new Set(["x", "y"]),
		};
		const first = lowerSourcePureExpression(
			expression("(x * y) + (x - 3)"),
			options
		);
		const second = lowerSourcePureExpression(
			expression("(x * y) + (x - 3)"),
			options
		);

		expect(second).toEqual(first);
		expect(first.accepted).toBe(true);
		if (!first.accepted) return;
		expect(first.region.ingress).toEqual([
			{
				name: "x",
				type: "number",
				domain: { type: "number", min: 1, max: 20 },
			},
			{
				name: "y",
				type: "number",
				domain: { type: "number", min: 2, max: 30 },
			},
		]);
		expect(first.region.contract.steps.map((step) => step.formula.tag)).toEqual([
			"product",
			"literal",
			"difference",
			"sum",
		]);
		expect(first.region.valueBounds.at(-1)).toEqual({
			type: "number",
			min: 0,
			max: 617,
			mayBeZero: true,
			mayBeNegative: false,
		});

		const artifact = generateBprfArtifact(first.region.contract, {
			seed: 901,
			realizationCount: 4,
			fragmentCount: 3,
		});
		for (const x of [1, 7, 20]) {
			for (const y of [2, 11, 30]) {
				for (let epoch = 0; epoch < 4; epoch++) {
					expect(
						evaluateBprfReference(
							artifact,
							[x, y],
							{ caller: "source", epoch, lineage: epoch * 7 }
						).outputs
					).toEqual([x * y + (x - 3)]);
				}
			}
		}
	});

	it("freezes the complete input prefix before assigning step references", () => {
		const result = lowerSourcePureExpression(
			expression("(x * y) + (z * z) + (x * z) + (y * 2) + 17"),
			{
				domains: {
					x: { type: "number", min: 1, max: 31 },
					y: { type: "number", min: 1, max: 31 },
					z: { type: "number", min: 1, max: 31 },
				},
				localBindings: new Set(["x", "y", "z"]),
			}
		);

		expect(result.accepted).toBe(true);
		if (!result.accepted) return;
		expect(result.region.ingress.map((input) => input.name)).toEqual([
			"x",
			"y",
			"z",
		]);
		expect(result.region.contract.steps[2]?.formula).toEqual({
			tag: "sum",
			left: 3,
			right: 4,
		});

		const artifact = generateBprfArtifact(result.region.contract, {
			seed: 902,
			realizationCount: 3,
			fragmentCount: 3,
		});
		for (const [x, y, z] of [
			[1, 1, 12],
			[7, 11, 19],
			[31, 31, 31],
		]) {
			expect(
				evaluateBprfReference(artifact, [x, y, z], {
					caller: "late-ingress",
					epoch: x,
					lineage: y + z,
				}).outputs
			).toEqual([
				x * y + z * z + x * z + y * 2 + 17,
			]);
		}
	});

	it("keeps lazy boolean branches native until lazy ingress is supported", () => {
		const result = lowerSourcePureExpression(
			expression("flag && (!other || flag)"),
			{
				domains: {
					flag: { type: "boolean" },
					other: { type: "boolean" },
				},
				localBindings: new Set(["flag", "other"]),
			}
		);

		expect(result).toEqual({
			accepted: false,
			rejection: {
				code: "RUAM_SOURCE_REGION_UNSUPPORTED_EXPRESSION",
				detail: "LogicalExpression",
			},
		});
	});

	it("requires explicit local binding and domain evidence", () => {
		const unbound = lowerSourcePureExpression(expression("globalValue + 1"), {
			domains: {
				globalValue: { type: "number", min: 0, max: 10 },
			},
			localBindings: new Set(),
		});
		const missing = lowerSourcePureExpression(expression("x + 1"), {
			domains: {},
			localBindings: new Set(["x"]),
		});

		expect(unbound).toEqual({
			accepted: false,
			rejection: {
				code: "RUAM_SOURCE_REGION_UNBOUND_IDENTIFIER",
				detail: "globalValue",
			},
		});
		expect(missing).toEqual({
			accepted: false,
			rejection: {
				code: "RUAM_SOURCE_REGION_MISSING_DOMAIN",
				detail: "x",
			},
		});
	});

	it("rejects coercive, effectful, and branch-type-mismatched forms", () => {
		const base = {
			domains: {
				x: { type: "number" as const, min: 1, max: 10 },
				flag: { type: "boolean" as const },
			},
			localBindings: new Set(["x", "flag"]),
		};

		for (const source of ["obj.x + 1", "f(x)", "x / 2"]) {
			const result = lowerSourcePureExpression(expression(source), base);
			expect(result.accepted).toBe(false);
			if (!result.accepted) {
				expect(result.rejection.code).toBe(
					"RUAM_SOURCE_REGION_UNSUPPORTED_EXPRESSION"
				);
			}
		}
		const mismatch = lowerSourcePureExpression(
			expression("flag ? x : false"),
			base
		);
		expect(mismatch.accepted).toBe(false);
		if (!mismatch.accepted) {
			expect(mismatch.rejection.code).toBe(
				"RUAM_SOURCE_REGION_UNSUPPORTED_EXPRESSION"
			);
		}
	});

	it("rejects unsafe integer ranges and every negative-zero source", () => {
		const overflow = lowerSourcePureExpression(expression("x * x"), {
			domains: {
				x: {
					type: "number",
					min: Number.MAX_SAFE_INTEGER - 1,
					max: Number.MAX_SAFE_INTEGER,
				},
			},
			localBindings: new Set(["x"]),
		});
		const negatedZero = lowerSourcePureExpression(expression("-x"), {
			domains: {
				x: { type: "number", min: 0, max: 1 },
			},
			localBindings: new Set(["x"]),
		});
		const multipliedZero = lowerSourcePureExpression(
			expression("x * y"),
			{
				domains: {
					x: { type: "number", min: 0, max: 1 },
					y: { type: "number", min: -2, max: -1 },
				},
				localBindings: new Set(["x", "y"]),
			}
		);

		expect(overflow.accepted).toBe(false);
		if (!overflow.accepted) {
			expect(overflow.rejection.code).toBe(
				"RUAM_SOURCE_REGION_UNSAFE_INTEGER_RANGE"
			);
		}
		for (const result of [negatedZero, multipliedZero]) {
			expect(result.accepted).toBe(false);
			if (!result.accepted) {
				expect(result.rejection.code).toBe(
					"RUAM_SOURCE_REGION_NEGATIVE_ZERO"
				);
			}
		}
	});
});
