import { describe, expect, it } from "bun:test";
import { parse } from "@babel/parser";
import { BABEL_PARSER_PLUGINS } from "../../src/constants.js";
import { buildIsoglossEffectGraph } from "../../src/isogloss/effect-graph.js";
import {
	createIsoglossProtectionCertificate,
	ISOGLOSS_PROTECTION_CERTIFICATE_EVIDENCE,
	ISOGLOSS_PROTECTION_CERTIFICATE_FORMAT,
	ISOGLOSS_PROTECTION_CERTIFICATE_LIMITS,
	ISOGLOSS_PROTECTION_CERTIFICATE_SCOPE,
	IsoglossProtectionCertificateError,
	validateIsoglossProtectionCertificate,
} from "../../src/isogloss/protection-certificate.js";
import { compileProtectedSourceRoots } from "../../src/isogloss/source-roots.js";

function compileEvidence(
	source = `
function calculate(value) { return (value + 1) * 2; }
function perform(value, object) {
	object.count++;
	return object.run(value);
}
`,
	seed = 0x12345678
) {
	const ast = parse(source, {
		sourceType: "script",
		plugins: [...BABEL_PARSER_PLUGINS],
	});
	const sourceRoots = compileProtectedSourceRoots(ast, {
		targetMode: "root",
		threshold: 1,
		seed,
	});
	const effectGraphs = sourceRoots.map((root, index) =>
		buildIsoglossEffectGraph(root.group, seed + index + 1)
	);
	return { sourceRoots, effectGraphs };
}

function issue(source?: string) {
	const evidence = compileEvidence(source);
	return {
		...evidence,
		certificate: createIsoglossProtectionCertificate(evidence),
	};
}

function serializedCertificate(source?: string): Record<string, any> {
	return JSON.parse(JSON.stringify(issue(source).certificate));
}

function withRoot(
	certificate: Record<string, any>,
	update: (root: Record<string, any>) => Record<string, any>
) {
	return {
		...certificate,
		roots: [update(certificate.roots[0]), ...certificate.roots.slice(1)],
	};
}

describe("Isogloss protection certificate", () => {
	it("derives complete root, graph, node, effect, and variant evidence", () => {
		const { sourceRoots, effectGraphs, certificate } = issue();
		const canonicalNodeCount = sourceRoots.reduce(
			(total, root) =>
				total + root.group.units.reduce((sum, unit) => sum + unit.nodes.length, 0),
			0
		);
		const variantCount = effectGraphs.reduce(
			(total, graph) =>
				total +
				graph.units.reduce(
					(unitTotal, unit) =>
						unitTotal +
						unit.codelets.reduce(
							(codeletTotal, codelet) =>
								codeletTotal + codelet.variants.length,
							0
						),
					0
				),
			0
		);

		expect(certificate).toMatchObject({
			format: ISOGLOSS_PROTECTION_CERTIFICATE_FORMAT,
			evidence: ISOGLOSS_PROTECTION_CERTIFICATE_EVIDENCE,
			targetRootCount: sourceRoots.length,
			verifiedRootCount: sourceRoots.length,
			canonicalNodeCount,
			protectedCanonicalNodeCount: canonicalNodeCount,
			verifiedBoundaryVariantCount: variantCount,
			unprotectedCanonicalNodeCount: 0,
			unsupportedCanonicalNodeCount: 0,
			artifactBound: false,
			coverageScope: ISOGLOSS_PROTECTION_CERTIFICATE_SCOPE,
			fullyProtected: false,
		});
		expect(certificate.externalEffectBoundaryCount).toBeGreaterThan(0);
		for (let index = 0; index < certificate.roots.length; index++) {
			const root = certificate.roots[index]!;
			const graph = effectGraphs[index]!;
			expect(root).toMatchObject({
				rootGroupId: sourceRoots[index]!.id,
				effectGraphFormat: graph.format,
				effectGraphSeed: graph.seed,
				unprotectedNodes: [],
				unsupportedNodes: [],
			});
			expect(root.protectedNodes).toEqual(root.canonicalNodes);
			expect(root.verifiedBoundaryVariantCount).toBe(
				root.verifiedBoundaryVariants.length
			);
		}
		expect(Object.isFrozen(certificate)).toBe(true);
		expect(Object.isFrozen(certificate.roots)).toBe(true);
		expect(Object.isFrozen(certificate.roots[0]!.canonicalNodes[0]!)).toBe(
			true
		);
		expect(Object.isFrozen(certificate.roots[0]!.verifiedBoundaryVariants)).toBe(
			true
		);
	});

	it("round-trips serialized evidence and recomputes every aggregate count", () => {
		const serialized = serializedCertificate();
		expect(validateIsoglossProtectionCertificate(serialized)).toEqual(
			issue().certificate
		);

		for (const field of [
			"targetRootCount",
			"verifiedRootCount",
			"canonicalNodeCount",
			"protectedCanonicalNodeCount",
			"externalEffectBoundaryCount",
			"verifiedBoundaryVariantCount",
			"unprotectedCanonicalNodeCount",
			"unsupportedCanonicalNodeCount",
		]) {
			expect(() =>
				validateIsoglossProtectionCertificate({
					...serialized,
					[field]: serialized[field] + 1,
				})
			).toThrow("RUAM_PROTECTION_CERTIFICATE_COUNT_MISMATCH");
		}
		expect(() =>
			validateIsoglossProtectionCertificate({
				...serialized,
				evidence: "caller-authored",
			})
		).toThrow("RUAM_PROTECTION_CERTIFICATE_INVALID_FORMAT");
		expect(() =>
			validateIsoglossProtectionCertificate({
				...serialized,
				fullyProtected: true,
			})
		).toThrow("RUAM_PROTECTION_CERTIFICATE_COVERAGE_GAP");
		expect(() =>
			validateIsoglossProtectionCertificate({
				...serialized,
				artifactBound: true,
			})
		).toThrow("RUAM_PROTECTION_CERTIFICATE_COVERAGE_GAP");
	});

	it("issues certificates only from matching compiled roots and verified graphs", () => {
		const evidence = compileEvidence("function execute(x) { return x + 1; }");
		const root = evidence.sourceRoots[0]!;
		const graph = evidence.effectGraphs[0]!;

		expect(() =>
			createIsoglossProtectionCertificate([] as never)
		).toThrow("RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE");
		expect(() =>
			createIsoglossProtectionCertificate({
				sourceRoots: evidence.sourceRoots,
				effectGraphs: [],
			})
		).toThrow("RUAM_PROTECTION_CERTIFICATE_MISSING_EFFECT_GRAPH");
		expect(() =>
			createIsoglossProtectionCertificate({
				sourceRoots: evidence.sourceRoots,
				effectGraphs: [graph, graph],
			})
		).toThrow("RUAM_PROTECTION_CERTIFICATE_DUPLICATE_ROOT");
		expect(() =>
			createIsoglossProtectionCertificate({
				sourceRoots: evidence.sourceRoots,
				effectGraphs: [
					graph,
					{ ...graph, rootGroupId: "unexpected-root" },
				],
			})
		).toThrow("RUAM_PROTECTION_CERTIFICATE_UNEXPECTED_EFFECT_GRAPH");
		expect(() =>
			createIsoglossProtectionCertificate({
				sourceRoots: [{ ...root, id: "wrong-root" }],
				effectGraphs: [graph],
			})
		).toThrow("RUAM_PROTECTION_CERTIFICATE_SOURCE_ROOT_MISMATCH");
		expect(() =>
			createIsoglossProtectionCertificate({
				sourceRoots: [root, root],
				effectGraphs: [graph],
			})
		).toThrow("RUAM_PROTECTION_CERTIFICATE_DUPLICATE_ROOT");

		const unit = graph.units[0]!;
		const incomplete = {
			...graph,
			units: [{ ...unit, codelets: unit.codelets.slice(0, -1) }],
		};
		expect(() =>
			createIsoglossProtectionCertificate({
				sourceRoots: evidence.sourceRoots,
				effectGraphs: [incomplete],
			})
		).toThrow("RUAM_PROTECTION_CERTIFICATE_INVALID_EFFECT_GRAPH");
	});

	it("rejects serialized coverage gaps, unsupported nodes, and forged identities", () => {
		const serialized = serializedCertificate("function execute(x) { return x + 1; }");
		const first = serialized.roots[0].canonicalNodes[0];
		for (const [field, code] of [
			["unprotectedNodes", "RUAM_PROTECTION_CERTIFICATE_UNPROTECTED_NODE"],
			["unsupportedNodes", "RUAM_PROTECTION_CERTIFICATE_UNSUPPORTED_NODE"],
		] as const) {
			expect(() =>
				validateIsoglossProtectionCertificate(
					withRoot(serialized, (root) => ({ ...root, [field]: [first] }))
				)
			).toThrow(code);
		}
		expect(() =>
			validateIsoglossProtectionCertificate(
				withRoot(serialized, (root) => ({
					...root,
					protectedNodes: root.protectedNodes.slice(1),
				}))
			)
		).toThrow("RUAM_PROTECTION_CERTIFICATE_COVERAGE_GAP");
		expect(() =>
			validateIsoglossProtectionCertificate(
				withRoot(serialized, (root) => ({
					...root,
					externalEffectBoundaryNodes: [{ unitId: "other", nodeId: 0 }],
				}))
			)
		).toThrow("RUAM_PROTECTION_CERTIFICATE_NODE_OUTSIDE_ROOT");
		expect(() =>
			validateIsoglossProtectionCertificate(
				withRoot(serialized, (root) => ({
					...root,
					canonicalNodes: [...root.canonicalNodes, first],
				}))
			)
		).toThrow("RUAM_PROTECTION_CERTIFICATE_DUPLICATE_NODE");
	});

	it("validates graph metadata and derives variant counts from variant identities", () => {
		const serialized = serializedCertificate("function execute(x) { return x + 1; }");
		expect(() =>
			validateIsoglossProtectionCertificate(
				withRoot(serialized, (root) => ({
					...root,
					effectGraphFormat: "wrong-format",
				}))
			)
		).toThrow("RUAM_PROTECTION_CERTIFICATE_INVALID_FORMAT");
		expect(() =>
			validateIsoglossProtectionCertificate(
				withRoot(serialized, (root) => ({ ...root, effectGraphSeed: 1.5 }))
			)
		).toThrow("RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE");
		expect(() =>
			validateIsoglossProtectionCertificate(
				withRoot(serialized, (root) => ({
					...root,
					verifiedBoundaryVariants: [
						root.verifiedBoundaryVariants[0],
						root.verifiedBoundaryVariants[0],
					],
					verifiedBoundaryVariantCount: 2,
				}))
			)
		).toThrow("RUAM_PROTECTION_CERTIFICATE_DUPLICATE_VARIANT");
		expect(() =>
			validateIsoglossProtectionCertificate(
				withRoot(serialized, (root) => ({
					...root,
					verifiedBoundaryVariantCount:
						root.verifiedBoundaryVariantCount + 1,
				}))
			)
		).toThrow("RUAM_PROTECTION_CERTIFICATE_COUNT_MISMATCH");
		expect(() =>
			validateIsoglossProtectionCertificate(
				withRoot(serialized, (root) => ({
					...root,
					verifiedBoundaryVariants: [],
					verifiedBoundaryVariantCount: 0,
				}))
			)
		).toThrow("RUAM_PROTECTION_CERTIFICATE_COVERAGE_GAP");
	});

	it("enforces root, node, and identity resource limits", () => {
		const serialized = serializedCertificate("function execute(x) { return x + 1; }");
		const tooManyRoots = Array.from(
			{ length: ISOGLOSS_PROTECTION_CERTIFICATE_LIMITS.targetRoots + 1 },
			() => serialized.roots[0]
		);
		expect(() =>
			validateIsoglossProtectionCertificate({ ...serialized, roots: tooManyRoots })
		).toThrow("RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE");

		const tooManyNodes: unknown[] = [];
		tooManyNodes.length =
			ISOGLOSS_PROTECTION_CERTIFICATE_LIMITS.canonicalNodesPerRoot + 1;
		expect(() =>
			validateIsoglossProtectionCertificate(
				withRoot(serialized, (root) => ({
					...root,
					canonicalNodes: tooManyNodes,
				}))
			)
		).toThrow("RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE");

		expect(() =>
			validateIsoglossProtectionCertificate(
				withRoot(serialized, (root) => ({
					...root,
					rootGroupId: "x".repeat(
						ISOGLOSS_PROTECTION_CERTIFICATE_LIMITS.identityCharacters + 1
					),
				}))
			)
		).toThrow("RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE");
		expect(() =>
			validateIsoglossProtectionCertificate(
				withRoot(serialized, (root) => ({
					...root,
					canonicalNodes: [{ ...root.canonicalNodes[0], nodeId: -1 }],
				}))
			)
		).toThrow("RUAM_PROTECTION_CERTIFICATE_INVALID_SHAPE");
	});

	it("returns structured error codes", () => {
		try {
			validateIsoglossProtectionCertificate({});
			throw new Error("expected certificate rejection");
		} catch (error) {
			expect(error).toBeInstanceOf(IsoglossProtectionCertificateError);
			expect((error as IsoglossProtectionCertificateError).code).toBe(
				"RUAM_PROTECTION_CERTIFICATE_INVALID_FORMAT"
			);
		}
	});
});
