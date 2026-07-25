import { describe, expect, it } from "bun:test";
import { resolveRuamOptions } from "../../src/isogloss/options.js";
import {
	buildLocalIsoglossSource,
	IsoglossSourceTransformError,
} from "../../src/isogloss/source-transform.js";

function executeFunction(
	code: string,
	name: string,
	args: readonly unknown[]
): unknown {
	return Function(`"use strict";${code};return ${name}(...arguments);`)(
		...args
	);
}

describe("product local Isogloss source transform", () => {
	it("replaces the source relation and preserves every declared-domain result", () => {
		const source = `
			function crown(x, y) {
				return (x * y) + (x - 3);
			}
		`;
		const options = resolveRuamOptions({
			regionDomains: {
				crown: {
					x: { type: "number", min: 1, max: 20 },
					y: { type: "number", min: 2, max: 30 },
				},
			},
		});
		const first = buildLocalIsoglossSource(source, options, 7001);
		const second = buildLocalIsoglossSource(source, options, 7001);

		expect(second).toEqual(first);
		expect(first.stats.engine).toBe("isogloss");
		expect(first.stats.profile).toBe("holographic-local");
		expect(first.stats.protectedRegionCount).toBe(1);
		expect(first.stats.realizationCount).toBe(3);
		expect(first.stats.clientCompleteness).toBe("complete");
		expect(first.stats.hardnessLowerBound).toBeNull();
		expect(first.code).not.toContain("(x * y) + (x - 3)");
		expect(first.code).not.toContain("x * y");
		expect(first.code).not.toContain("ruamvm");
		expect(first.code).not.toContain("opcode");
		expect(first.code).not.toContain("handler");
		expect(first.code).not.toContain("eval(");
		expect(first.code).not.toContain("new Function");

		for (const x of [1, 7, 20]) {
			for (const y of [2, 11, 30]) {
				expect(executeFunction(first.code, "crown", [x, y])).toBe(
					x * y + (x - 3)
				);
			}
		}
		expect(() => executeFunction(first.code, "crown", [0, 2])).toThrow(
			"RUAM_BPRF_SCALAR_INPUT_GUARD"
		);
	});

	it("keeps unsupported unconfigured effects native and reports them honestly", () => {
		const source = `
			function host(obj) { return obj.value + 1; }
			function plain(x) { return x; }
		`;
		const result = buildLocalIsoglossSource(
			source,
			resolveRuamOptions(),
			5
		);

		expect(result.stats.protectedRegionCount).toBe(0);
		expect(result.stats.rootGroupCount).toBe(0);
		expect(result.stats.expansionRatio).toBeGreaterThan(0);
		expect(result.diagnostics.map((item) => item.code)).toEqual([
			"RUAM_SOURCE_TARGET_MISSING_DOMAINS",
			"RUAM_SOURCE_TARGET_MISSING_DOMAINS",
		]);
		expect(executeFunction(result.code, "host", [{ value: 4 }])).toBe(5);
		expect(executeFunction(result.code, "plain", [9])).toBe(9);
	});

	it("emits an owner-only sidecar without adding runtime tracing", () => {
		const source = `function flag(a,b){return a && !b;}`;
		const result = buildLocalIsoglossSource(
			source,
			resolveRuamOptions({
				isogloss: { ownerTrace: "sidecar" },
				regionDomains: {
					flag: {
						a: { type: "boolean" },
						b: { type: "boolean" },
					},
				},
			}),
			77
		);

		expect(result.ownerTrace?.format).toBe(
			"ruam-isogloss-owner-trace-1"
		);
		expect(result.ownerTrace?.regions).toHaveLength(1);
		expect(
			result.ownerTrace?.regions[0]!.emitterCertificate.ownerTrace
		).toBe(false);
		expect(result.code).not.toContain("ownerTrace");
		expect(executeFunction(result.code, "flag", [true, false])).toBe(true);
		expect(executeFunction(result.code, "flag", [true, true])).toBe(false);
	});

	it("fails configured targets closed instead of shipping an original fallback", () => {
		expect(() =>
			buildLocalIsoglossSource(
				`function bad(x,obj){return x + obj.value;}`,
				resolveRuamOptions({
					regionDomains: {
						bad: {
							x: { type: "number", min: 1, max: 4 },
						},
					},
				}),
				1
			)
		).toThrow("RUAM_ISOGLOSS_CONFIGURED_REGION_REJECTED");
		expect(() =>
			buildLocalIsoglossSource(
				`function actual(x){return (x+1)*2;}`,
				resolveRuamOptions({
					regionDomains: {
						missing: {
							x: { type: "number", min: 1, max: 4 },
						},
					},
				}),
				1
			)
		).toThrow("RUAM_ISOGLOSS_CONFIGURED_TARGET_NOT_FOUND");
	});

	it("rejects nonlocal grafting and top-level intrinsic capture", () => {
		const custodied = resolveRuamOptions({
			isogloss: {
				profile: "holographic-custodied",
				capabilities: {
					custodian: {
						endpoint: "https://custodian.example/evaluate",
						boundary: "existing-remote-await",
						completeLocalFallback: false,
					},
				},
			},
		});
		expect(() =>
			buildLocalIsoglossSource("function f(){return 1;}", custodied, 1)
		).toThrow("RUAM_ISOGLOSS_SOURCE_PROFILE_REQUIRES_EXTERNAL_BOUNDARY");

		const local = resolveRuamOptions({
			regionDomains: {
				f: { x: { type: "number", min: 1, max: 4 } },
			},
		});
		expect(() =>
			buildLocalIsoglossSource(
				`const Number={};function f(x){return (x+1)*2;}`,
				local,
				1
			)
		).toThrow("RUAM_ISOGLOSS_INTRINSIC_SHADOW");
	});

	it("surfaces structured transform errors", () => {
		try {
			buildLocalIsoglossSource(
				"function f(){return 1;}",
				resolveRuamOptions({
					regionDomains: {
						missing: {
							x: { type: "number", min: 0, max: 1 },
						},
					},
				}),
				2
			);
			throw new Error("expected failure");
		} catch (error) {
			expect(error).toBeInstanceOf(IsoglossSourceTransformError);
			expect(
				(error as IsoglossSourceTransformError).code
			).toBe("RUAM_ISOGLOSS_CONFIGURED_TARGET_NOT_FOUND");
		}
	});
});
