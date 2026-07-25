import { describe, expect, it } from "bun:test";
import {
	DEFAULT_MINIMUM_EXACT_ATTACK_QUERIES,
	ISOGLOSS_FIXED_LOCAL_BPRF,
	REMOVED_LEGACY_VM_OPTION_HINTS,
	REMOVED_LEGACY_VM_OPTIONS,
	RuamOptionError,
	resolveRuamOptions,
	type IsoglossAttestationCapability,
	type IsoglossCustodianCapability,
	type IsoglossPrivateFunctionCapability,
} from "../../src/isogloss/options.js";

const custodian: IsoglossCustodianCapability = {
	endpoint: "https://custodian.example.test/v1/isogloss",
	boundary: "existing-remote-await",
	completeLocalFallback: false,
};

const privateFunction: IsoglossPrivateFunctionCapability = {
	protocol: "actively-secure-pfe",
	topology: "padded-universal-circuit",
	implementation: "audited-pfe-2026-07",
};

const attestation: IsoglossAttestationCapability = {
	provider: "example-tee",
	expectedMeasurement: "sha256:0123456789abcdef",
	boundary: "in-process-attested",
	completeLocalFallback: false,
};

function optionError(input: unknown): RuamOptionError {
	try {
		resolveRuamOptions(input);
	} catch (error) {
		expect(error).toBeInstanceOf(RuamOptionError);
		return error as RuamOptionError;
	}
	throw new Error("expected options to be rejected");
}

describe("replacement Isogloss option defaults", () => {
	it("uses deterministic, honest local defaults and fixed BPRF settings", () => {
		const first = resolveRuamOptions();
		const second = resolveRuamOptions({});
		const explicitEmpty = resolveRuamOptions({
			isogloss: { capabilities: {}, maximumCustody: {} },
			regionDomains: {},
		});

		expect(first).toEqual(second);
		expect(first).toEqual(explicitEmpty);
		expect(first.isogloss.profile).toBe("holographic-local");
		expect(first.isogloss.ownerTrace).toBe("off");
		expect(first.isogloss.capabilities).toEqual({});
		expect(first.isogloss.bprf).toBe(ISOGLOSS_FIXED_LOCAL_BPRF);
		expect(first.isogloss.bprf).toEqual({
			realizationCount: 3,
			fragmentCount: 3,
		});
		expect(
			first.isogloss.maximumCustody.minimumExactAttackQueries
		).toBe(DEFAULT_MINIMUM_EXACT_ATTACK_QUERIES);
		expect(first.targetMode).toBe("root");
		expect(first.threshold).toBe(1);
		expect(first.preprocessIdentifiers).toBe(false);
		expect(first.target).toBe("browser");
		expect(Object.keys(first.regionDomains)).toEqual([]);
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.isogloss)).toBe(true);
		expect(Object.isFrozen(first.isogloss.bprf)).toBe(true);
		expect(Object.isFrozen(first.regionDomains)).toBe(true);
	});

	it("resolves all engine-independent overrides and bigint-safe input", () => {
		const huge = "900719925474099312345678901234567890";
		const result = resolveRuamOptions({
			isogloss: {
				ownerTrace: "sidecar",
				maximumCustody: {
					minimumExactAttackQueries: huge,
				},
			},
			targetMode: "comment",
			threshold: 0.375,
			preprocessIdentifiers: true,
			target: "browser-extension",
			regionDomains: {
				priceQuote: {
					price: { type: "number", min: -500, max: 500 },
					enabled: { type: "boolean" },
				},
			},
		});

		expect(
			result.isogloss.maximumCustody.minimumExactAttackQueries
		).toBe(BigInt(huge));
		expect(result.isogloss.ownerTrace).toBe("sidecar");
		expect(result.targetMode).toBe("comment");
		expect(result.threshold).toBe(0.375);
		expect(result.preprocessIdentifiers).toBe(true);
		expect(result.target).toBe("browser-extension");
		expect(result.regionDomains.priceQuote).toEqual({
			price: { type: "number", min: -500, max: 500 },
			enabled: { type: "boolean" },
		});
		expect(Object.isFrozen(result.regionDomains.priceQuote)).toBe(true);
		expect(Object.isFrozen(result.regionDomains.priceQuote!.price)).toBe(true);
	});
});

describe("Isogloss deployment capability profiles", () => {
	it("requires and accepts only the custodian descriptor for custodied mode", () => {
		const result = resolveRuamOptions({
			isogloss: {
				profile: "holographic-custodied",
				capabilities: { custodian },
			},
		});

		expect(result.isogloss.capabilities.custodian).toEqual(custodian);
		expect(result.isogloss.capabilities.privateFunction).toBeUndefined();
		expect(result.isogloss.capabilities.attestation).toBeUndefined();
	});

	it("requires both custodian and actively-secure PFE descriptors for private mode", () => {
		const result = resolveRuamOptions({
			isogloss: {
				profile: "holographic-private",
				capabilities: { custodian, privateFunction },
			},
		});

		expect(result.isogloss.capabilities.custodian).toEqual(custodian);
		expect(result.isogloss.capabilities.privateFunction).toEqual(
			privateFunction
		);
	});

	it("requires and accepts only the attestation descriptor for TEE mode", () => {
		const result = resolveRuamOptions({
			isogloss: {
				profile: "holographic-tee",
				capabilities: { attestation },
			},
		});

		expect(result.isogloss.capabilities.attestation).toEqual(attestation);
	});

	it("rejects every remote profile without its explicit capability", () => {
		for (const profile of [
			"holographic-custodied",
			"holographic-private",
			"holographic-tee",
		] as const) {
			expect(optionError({ isogloss: { profile } }).code).toBe(
				"RUAM_ISOGLOSS_CAPABILITY_REQUIRED"
			);
		}
	});

	it("rejects capabilities that do not match the selected profile", () => {
		expect(
			optionError({
				isogloss: {
					profile: "holographic-local",
					capabilities: { custodian },
				},
			}).code
		).toBe("RUAM_ISOGLOSS_PROFILE_CAPABILITY_MISMATCH");
		expect(
			optionError({
				isogloss: {
					profile: "holographic-custodied",
					capabilities: { custodian, privateFunction },
				},
			}).code
		).toBe("RUAM_ISOGLOSS_PROFILE_CAPABILITY_MISMATCH");
		expect(
			optionError({
				isogloss: {
					profile: "holographic-tee",
					capabilities: { custodian, attestation },
				},
			}).code
		).toBe("RUAM_ISOGLOSS_PROFILE_CAPABILITY_MISMATCH");
	});

	it("forbids true or omitted complete local fallback declarations", () => {
		for (const completeLocalFallback of [true, undefined]) {
			const error = optionError({
				isogloss: {
					profile: "holographic-custodied",
					capabilities: {
						custodian: {
							endpoint: custodian.endpoint,
							boundary: "existing-remote-await",
							completeLocalFallback,
						},
					},
				},
			});
			expect(error.code).toBe("RUAM_ISOGLOSS_LOCAL_FALLBACK_FORBIDDEN");
			expect(error.path).toBe(
				"isogloss.capabilities.custodian.completeLocalFallback"
			);
		}
	});

	it("rejects dishonest or incomplete capability descriptors", () => {
		expect(
			optionError({
				isogloss: {
					profile: "holographic-custodied",
					capabilities: {
						custodian: {
							...custodian,
							endpoint: "http://custodian.example.test",
						},
					},
				},
			}).path
		).toBe("isogloss.capabilities.custodian.endpoint");
		expect(
			optionError({
				isogloss: {
					profile: "holographic-private",
					capabilities: {
						custodian,
						privateFunction: {
							...privateFunction,
							protocol: "semi-honest-pfe",
						},
					},
				},
			}).path
		).toBe("isogloss.capabilities.privateFunction.protocol");
		expect(
			optionError({
				isogloss: {
					profile: "holographic-tee",
					capabilities: {
						attestation: {
							...attestation,
							expectedMeasurement: " ",
						},
					},
				},
			}).path
		).toBe("isogloss.capabilities.attestation.expectedMeasurement");
	});
});

describe("strict Isogloss option validation", () => {
	it("rejects unknown properties at every nested option layer", () => {
		const cases: Array<[unknown, string]> = [
			[{ surprise: true }, "surprise"],
			[{ isogloss: { surprise: true } }, "isogloss.surprise"],
			[
				{ isogloss: { maximumCustody: { surprise: true } } },
				"isogloss.maximumCustody.surprise",
			],
			[
				{ isogloss: { capabilities: { surprise: true } } },
				"isogloss.capabilities.surprise",
			],
			[
				{
					isogloss: {
						profile: "holographic-custodied",
						capabilities: { custodian: { ...custodian, surprise: true } },
					},
				},
				"isogloss.capabilities.custodian.surprise",
			],
			[
				{
					isogloss: {
						profile: "holographic-private",
						capabilities: {
							custodian,
							privateFunction: {
								...privateFunction,
								surprise: true,
							},
						},
					},
				},
				"isogloss.capabilities.privateFunction.surprise",
			],
			[
				{
					isogloss: {
						profile: "holographic-tee",
						capabilities: {
							attestation: { ...attestation, surprise: true },
						},
					},
				},
				"isogloss.capabilities.attestation.surprise",
			],
			[
				{
					regionDomains: {
						f: { x: { type: "boolean", min: 0 } },
					},
				},
				"regionDomains.f.x.min",
			],
			[
				{
					regionDomains: {
						f: {
							x: { type: "number", min: 0, max: 1, surprise: true },
						},
					},
				},
				"regionDomains.f.x.surprise",
			],
		];

		for (const [input, path] of cases) {
			const error = optionError(input);
			expect(error.code).toBe("RUAM_UNKNOWN_ISOGLOSS_OPTION");
			expect(error.path).toBe(path);
		}
	});

	it("does not expose BPRF realization or fragment tuning", () => {
		const nested = optionError({
			isogloss: { bprf: { realizationCount: 99, fragmentCount: 1 } },
		});
		const topLevel = optionError({ realizationCount: 99 });

		expect(nested.code).toBe("RUAM_UNKNOWN_ISOGLOSS_OPTION");
		expect(nested.path).toBe("isogloss.bprf");
		expect(topLevel.code).toBe("RUAM_UNKNOWN_ISOGLOSS_OPTION");
	});

	it("rejects invalid scalar values and non-canonical query counts", () => {
		for (const threshold of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(optionError({ threshold }).path).toBe("threshold");
		}
		expect(optionError({ threshold: "1" }).path).toBe("threshold");
		expect(
			optionError({ isogloss: { profile: "maximum" } }).path
		).toBe("isogloss.profile");
		expect(
			optionError({ isogloss: { ownerTrace: "sidecar+runtime" } }).path
		).toBe("isogloss.ownerTrace");

		for (const minimumExactAttackQueries of [
			-1,
			1n,
			"-1",
			"01",
			"1.0",
			"",
			" 10",
		]) {
			expect(
				optionError({
					isogloss: {
						maximumCustody: { minimumExactAttackQueries },
					},
				}).path
			).toBe(
				"isogloss.maximumCustody.minimumExactAttackQueries"
			);
		}
	});

	it("requires exact, safe runtime-guard domains", () => {
		const invalidDomains = [
			{ type: "number", min: 2, max: 1 },
			{ type: "number", min: -0, max: 1 },
			{ type: "number", min: 0.5, max: 1 },
			{ type: "number", min: 0, max: Number.MAX_VALUE },
			{ type: "boolean", max: true },
			{ min: 0, max: 1 },
		];
		for (const domain of invalidDomains) {
			expect(
				optionError({
					regionDomains: { target: { local: domain } },
				}).code
			).toMatch(/^RUAM_(?:INVALID|UNKNOWN)_ISOGLOSS_OPTION$/);
		}

		expect(optionError({ regionDomains: [] }).path).toBe("regionDomains");
		expect(
			optionError({ regionDomains: { " ": {} } }).path
		).toBe("regionDomains. ");
		expect(
			optionError({ regionDomains: { target: { "": { type: "boolean" } } } })
				.path
		).toBe("regionDomains.target.");
	});

	it("rejects non-plain option objects and compatibility-like aliases", () => {
		expect(optionError(null).code).toBe("RUAM_INVALID_ISOGLOSS_OPTIONS");
		expect(optionError([]).code).toBe("RUAM_INVALID_ISOGLOSS_OPTIONS");
		expect(optionError(new (class Options {})()).code).toBe(
			"RUAM_INVALID_ISOGLOSS_OPTIONS"
		);
		expect(optionError({ executionModel: "isogloss" }).code).toBe(
			"RUAM_UNKNOWN_ISOGLOSS_OPTION"
		);
		expect(optionError({ domains: {} }).code).toBe(
			"RUAM_UNKNOWN_ISOGLOSS_OPTION"
		);
		expect(
			optionError({ toString: "not-a-legacy-option" }).code
		).toBe("RUAM_UNKNOWN_ISOGLOSS_OPTION");
	});
});

describe("legacy VM option tombstones", () => {
	const expectedLegacyKeys = [
		"preset",
		"encryptBytecode",
		"debugProtection",
		"debugLogging",
		"dynamicOpcodes",
		"decoyOpcodes",
		"deadCodeInjection",
		"stackEncoding",
		"rollingCipher",
		"integrityBinding",
		"vmShielding",
		"mixedBooleanArithmetic",
		"handlerFragmentation",
		"stringAtomization",
		"polymorphicDecoder",
		"scatteredKeys",
		"blockPermutation",
		"opcodeMutation",
		"bytecodeScattering",
		"incrementalCipher",
		"semanticOpacity",
		"observationResistance",
	] as const;

	it("exports the exhaustive removed-key set", () => {
		expect(REMOVED_LEGACY_VM_OPTIONS).toEqual(expectedLegacyKeys);
	});

	for (const key of expectedLegacyKeys) {
		it(`rejects ${key} even when its value is undefined`, () => {
			const error = optionError({ [key]: undefined });

			expect(error.code).toBe("RUAM_REMOVED_VM_OPTION");
			expect(error.path).toBe(key);
			expect(error.message).toContain(
				REMOVED_LEGACY_VM_OPTION_HINTS[key]
			);
			expect(REMOVED_LEGACY_VM_OPTION_HINTS[key].length).toBeGreaterThan(20);
		});
	}
});
