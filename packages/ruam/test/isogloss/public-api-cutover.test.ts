import { describe, expect, it } from "bun:test";
import {
	IsoglossSourceTransformError,
	RuamOptionError,
	obfuscateCode,
	protectCode,
	type RuamOptions,
} from "../../src/index.js";

const ROOT_SOURCE = `
	function guardedProduct(x, y) {
		return (x * y) + (x - 7);
	}
`;

const ROOT_OPTIONS: RuamOptions = {
	regionDomains: {
		guardedProduct: {
			x: { type: "number", min: 1, max: 12 },
			y: { type: "number", min: 2, max: 15 },
		},
	},
};

const LEGACY_VM_SIGNATURES = [
	/\bruamvm\b/iu,
	/\bRUAM_VM\b/u,
	/\bbytecode\b/iu,
	/\bopcode\b/iu,
	/\binterpreter\b/iu,
	/\bUint8Array\b/u,
	/\bDataView\b/u,
	/\bbyteOffset\b/u,
	/\bbyteLength\b/u,
];

function executeFunction(
	code: string,
	name: string,
	args: readonly unknown[]
): unknown {
	return Function(`"use strict";${code};return ${name}(...arguments);`)(
		...args
	);
}

function expectNoLegacyVmRuntime(code: string): void {
	for (const signature of LEGACY_VM_SIGNATURES) {
		expect(code).not.toMatch(signature);
	}
}

describe("public Isogloss execution cutover", () => {
	it("protects a guarded root and reports the local profile honestly", () => {
		const build = protectCode(ROOT_SOURCE, ROOT_OPTIONS);

		expect(build.stats).toMatchObject({
			engine: "isogloss",
			profile: "holographic-local",
			rootGroupCount: 1,
			protectedRegionCount: 1,
			realizationCount: 3,
			clientCompleteness: "complete",
			hardnessLowerBound: null,
		});
		expect(build.ownerTrace).toBeUndefined();
		expect(build.code).not.toContain("(x * y) + (x - 7)");
		expect(build.code).not.toContain("x * y");
		expect(executeFunction(build.code, "guardedProduct", [4, 9])).toBe(
			33
		);
		expect(executeFunction(build.code, "guardedProduct", [12, 15])).toBe(
			185
		);

		const aliasCode = obfuscateCode(ROOT_SOURCE, ROOT_OPTIONS);
		expect(typeof aliasCode).toBe("string");
		expect(executeFunction(aliasCode, "guardedProduct", [4, 9])).toBe(
			33
		);
	});

	it("honors only the explicit Isogloss annotation in comment mode", () => {
		const source = `
			/* ruam:isogloss */
			function annotated(value) {
				return (value + 3) * (value - 2);
			}
			function unmarked(value) {
				return (value + 5) * (value - 1);
			}
		`;
		const build = protectCode(source, {
			targetMode: "comment",
			regionDomains: {
				annotated: {
					value: { type: "number", min: 2, max: 20 },
				},
			},
		});

		expect(build.stats.rootGroupCount).toBe(1);
		expect(build.stats.protectedRegionCount).toBe(1);
		expect(build.code).not.toContain(
			"(value + 3) * (value - 2)"
		);
		expect(build.code).toContain("(value + 5) * (value - 1)");
		expect(executeFunction(build.code, "annotated", [8])).toBe(66);
		expect(executeFunction(build.code, "unmarked", [8])).toBe(91);
	});

	it("ships no configured relation fallback and rejects outside declared domains", () => {
		const build = protectCode(ROOT_SOURCE, ROOT_OPTIONS);

		expect(build.code).not.toContain("return x * y + (x - 7)");
		expect(() =>
			executeFunction(build.code, "guardedProduct", [0, 9])
		).toThrow("RUAM_BPRF_SCALAR_INPUT_GUARD");
		expect(() =>
			executeFunction(build.code, "guardedProduct", [4, 16])
		).toThrow("RUAM_BPRF_SCALAR_INPUT_GUARD");
		expect(() =>
			protectCode(
				`function unsupported(x, object) {
					return x + object.value;
				}`,
				{
					regionDomains: {
						unsupported: {
							x: { type: "number", min: 1, max: 4 },
						},
					},
				}
			)
		).toThrow("RUAM_ISOGLOSS_CONFIGURED_REGION_REJECTED");

		try {
			protectCode(ROOT_SOURCE, {
				regionDomains: {
					guardedProduct: {
						x: { type: "number", min: 4, max: 3 },
						y: { type: "number", min: 2, max: 15 },
					},
				},
			});
			throw new Error("expected invalid declared domain");
		} catch (error) {
			expect(error).toBeInstanceOf(RuamOptionError);
			expect((error as RuamOptionError).path).toBe(
				"regionDomains.guardedProduct.x"
			);
		}
	});

	it("rejects a nonlocal profile at the source API without an owner-proven external boundary", () => {
		try {
			protectCode(ROOT_SOURCE, {
				...ROOT_OPTIONS,
				isogloss: {
					profile: "holographic-custodied",
					capabilities: {
						custodian: {
							endpoint:
								"https://custodian.example.test/evaluate",
							boundary: "existing-remote-await",
							completeLocalFallback: false,
						},
					},
				},
			});
			throw new Error("expected source-boundary rejection");
		} catch (error) {
			expect(error).toBeInstanceOf(IsoglossSourceTransformError);
			expect((error as IsoglossSourceTransformError).code).toBe(
				"RUAM_ISOGLOSS_SOURCE_PROFILE_REQUIRES_EXTERNAL_BOUNDARY"
			);
		}
	});

	it("emits no legacy bytecode loader or interpreter signature", () => {
		const build = protectCode(ROOT_SOURCE, ROOT_OPTIONS);

		expectNoLegacyVmRuntime(build.code);
		expect(() =>
			Function(
				"Uint8Array",
				"DataView",
				`"use strict";${build.code};return guardedProduct(4,9);`
			)(
				() => {
					throw new Error("legacy Uint8Array loader invoked");
				},
				() => {
					throw new Error("legacy DataView loader invoked");
				}
			)
		).not.toThrow();
	});
});
