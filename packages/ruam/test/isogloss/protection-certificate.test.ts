import { describe, expect, it } from "bun:test";
import {
	createIsoglossProtectionCertificate,
	IsoglossProtectionCertificateError,
	validateIsoglossProtectionCertificate,
	type IsoglossCanonicalNodeReference,
	type IsoglossTargetRootProtection,
} from "../../src/isogloss/protection-certificate.js";

function node(unitId: string, nodeId: number): IsoglossCanonicalNodeReference {
	return { unitId, nodeId };
}

function root(
	rootGroupId: string,
	canonicalNodes: readonly IsoglossCanonicalNodeReference[],
	externalEffectBoundaryNodes: readonly IsoglossCanonicalNodeReference[] = []
): IsoglossTargetRootProtection {
	return {
		rootGroupId,
		canonicalNodes,
		protectedNodes: canonicalNodes,
		externalEffectBoundaryNodes,
		unprotectedNodes: [],
		unsupportedNodes: [],
	};
}

describe("Isogloss protection certificate", () => {
	it("derives exact aggregate evidence from fully covered target roots", () => {
		const effect = node("unit-b", 1);
		const certificate = createIsoglossProtectionCertificate([
			root("root-a", [node("unit-a", 0), node("unit-a", 1)]),
			root("root-b", [node("unit-b", 0), effect], [effect]),
		]);

		expect(certificate).toMatchObject({
			targetRootCount: 2,
			verifiedRootCount: 2,
			canonicalNodeCount: 4,
			protectedCanonicalNodeCount: 4,
			externalEffectBoundaryCount: 1,
			unprotectedCanonicalNodeCount: 0,
			unsupportedCanonicalNodeCount: 0,
			fullyProtected: true,
		});
		expect(Object.isFrozen(certificate)).toBe(true);
		expect(Object.isFrozen(certificate.roots)).toBe(true);
		expect(Object.isFrozen(certificate.roots[0]!.canonicalNodes[0]!)).toBe(
			true
		);
	});

	it("validates serialized data and does not trust claimed aggregate counts", () => {
		const certificate = createIsoglossProtectionCertificate([
			root("root", [node("unit", 0), node("unit", 1)]),
		]);
		const serialized = JSON.parse(JSON.stringify(certificate));

		expect(validateIsoglossProtectionCertificate(serialized)).toEqual(
			certificate
		);
		expect(() =>
			validateIsoglossProtectionCertificate({
				...serialized,
				protectedCanonicalNodeCount: 99,
			})
		).toThrow("RUAM_PROTECTION_CERTIFICATE_COUNT_MISMATCH");
		expect(() =>
			validateIsoglossProtectionCertificate({
				...serialized,
				fullyProtected: false,
			})
		).toThrow("RUAM_PROTECTION_CERTIFICATE_COVERAGE_GAP");
	});

	it("rejects unprotected, unsupported, or omitted canonical nodes", () => {
		const first = node("unit", 0);
		const second = node("unit", 1);
		for (const [field, code] of [
			["unprotectedNodes", "RUAM_PROTECTION_CERTIFICATE_UNPROTECTED_NODE"],
			["unsupportedNodes", "RUAM_PROTECTION_CERTIFICATE_UNSUPPORTED_NODE"],
		] as const) {
			const candidate = root("root", [first, second]);
			expect(() =>
				createIsoglossProtectionCertificate([
					{ ...candidate, [field]: [second] },
				])
			).toThrow(code);
		}

		expect(() =>
			createIsoglossProtectionCertificate([
				{
					...root("root", [first, second]),
					protectedNodes: [first],
				},
			])
		).toThrow("RUAM_PROTECTION_CERTIFICATE_COVERAGE_GAP");
	});

	it("rejects duplicate identities and effect boundaries outside the root", () => {
		const repeated = node("unit", 0);
		expect(() =>
			createIsoglossProtectionCertificate([
				root("root", [repeated, { ...repeated }]),
			])
		).toThrow("RUAM_PROTECTION_CERTIFICATE_DUPLICATE_NODE");
		expect(() =>
			createIsoglossProtectionCertificate([
				root("root", [repeated]),
				root("root", [node("other", 0)]),
			])
		).toThrow("RUAM_PROTECTION_CERTIFICATE_DUPLICATE_ROOT");
		expect(() =>
			createIsoglossProtectionCertificate([
				root("root", [repeated], [node("other", 0)]),
			])
		).toThrow("RUAM_PROTECTION_CERTIFICATE_NODE_OUTSIDE_ROOT");
	});

	it("returns structured error codes for invalid evidence", () => {
		try {
			createIsoglossProtectionCertificate([]);
			throw new Error("expected certificate rejection");
		} catch (error) {
			expect(error).toBeInstanceOf(IsoglossProtectionCertificateError);
			expect((error as IsoglossProtectionCertificateError).code).toBe(
				"RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE"
			);
		}
	});
});
