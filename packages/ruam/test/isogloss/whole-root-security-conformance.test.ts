import { describe, expect, it } from "bun:test";
import { parse } from "@babel/parser";
import { BABEL_PARSER_PLUGINS } from "../../src/constants.js";
import type { SemanticRootGroup } from "../../src/compiler/ir.js";
import {
	buildIsoglossEffectGraph,
	type IsoglossEffectCodelet,
	type IsoglossEffectGraph,
} from "../../src/isogloss/effect-graph.js";
import { compileProtectedSourceRoots } from "../../src/isogloss/source-roots.js";
import { verifyIsoglossEffectGraph } from "../../src/isogloss/verify-effect-graph.js";
import { protectCodeDeterministic } from "../../src/testing.js";

const WHOLE_ROOT_SOURCE = `
async function protectedRoot(value, object) {
	function* steps(start) {
		yield start;
		return start + 1;
	}
	async function later(input) {
		return await Promise.resolve(input);
	}
	object.count = value;
	if (value > 0) {
		try {
			const iterator = steps(value);
			return await later(iterator.next().value + object.bump());
		} catch (error) {
			object.error = error;
			throw error;
		}
	}
	throw new RangeError("negative");
}
`;

function parseSource(source: string) {
	return parse(source, {
		sourceType: "unambiguous",
		plugins: [...BABEL_PARSER_PLUGINS],
	});
}

function compileOne(source = WHOLE_ROOT_SOURCE, seed = 0x51a7c0de) {
	const roots = compileProtectedSourceRoots(parseSource(source), {
		targetMode: "root",
		threshold: 1,
		seed,
	});
	expect(roots).toHaveLength(1);
	return roots[0]!;
}

function canonicalNodeKeys(group: SemanticRootGroup): string[] {
	return group.units
		.flatMap((unit) =>
			unit.nodes.map((node) => `${unit.id}:${node.id}`)
		)
		.sort();
}

function codeletNodeKeys(graph: IsoglossEffectGraph): string[] {
	return graph.units
		.flatMap((unit) =>
			unit.codelets.map(
				(codelet) => `${codelet.unitId}:${codelet.canonicalNodeId}`
			)
		)
		.sort();
}

function replaceCodelet(
	graph: IsoglossEffectGraph,
	target: IsoglossEffectCodelet,
	replacement: IsoglossEffectCodelet
): IsoglossEffectGraph {
	return {
		...graph,
		units: graph.units.map((unit) => ({
			...unit,
			codelets: unit.codelets.map((codelet) =>
				codelet === target ? replacement : codelet
			),
		})),
	} as IsoglossEffectGraph;
}

function firstCodelet(
	graph: IsoglossEffectGraph,
	predicate: (codelet: IsoglossEffectCodelet) => boolean = () => true
): IsoglossEffectCodelet {
	const codelet = graph.units
		.flatMap((unit) => unit.codelets)
		.find(predicate);
	expect(codelet).toBeDefined();
	return codelet!;
}

describe("whole-root Isogloss security conformance", () => {
	it("owns every canonical node in a root and all nested closures exactly once", () => {
		const root = compileOne();
		const graph = buildIsoglossEffectGraph(root.group, 0x10203040);
		const verification = verifyIsoglossEffectGraph(root.group, graph);
		const canonical = canonicalNodeKeys(root.group);
		const protectedNodes = codeletNodeKeys(graph);

		expect(root.group.units).toHaveLength(3);
		expect(
			root.group.units.every((unit) => unit.rootGroupId === root.group.id)
		).toBe(true);
		expect(new Set(canonical).size).toBe(canonical.length);
		expect(new Set(protectedNodes).size).toBe(protectedNodes.length);
		expect(protectedNodes).toEqual(canonical);
		expect(verification).toMatchObject({
			valid: true,
			canonicalNodeCount: canonical.length,
			protectedCodeletCount: canonical.length,
			unprotectedCanonicalNodeCount: 0,
			unsupportedCanonicalNodeCount: 0,
		});
	});

	it("represents calls, mutation, control, exceptions, await, and generators inside the graph", () => {
		const root = compileOne();
		const graph = buildIsoglossEffectGraph(root.group, 0x20304050);
		const signatures = graph.units.flatMap((unit) =>
			unit.codelets.map((codelet) => codelet.signature)
		);

		expect(root.group.hasAsync).toBe(true);
		expect(root.group.hasGenerator).toBe(true);
		expect(signatures.some((signature) => signature.callKind === "invoke")).toBe(
			true
		);
		expect(
			signatures.some(
				(signature) =>
					signature.objectAccess === "write" ||
					signature.objectAccess === "read-write"
			)
		).toBe(true);
		expect(
			signatures.some((signature) => signature.control !== "fallthrough")
		).toBe(true);
		expect(
			signatures.some((signature) => signature.effect === "exception")
		).toBe(true);
		expect(signatures.some((signature) => signature.suspension === "await")).toBe(
			true
		);
		expect(signatures.some((signature) => signature.suspension === "yield")).toBe(
			true
		);
		expect(verifyIsoglossEffectGraph(root.group, graph).valid).toBe(true);
	});

	it("rejects a changed semantic operation", () => {
		const root = compileOne();
		const graph = buildIsoglossEffectGraph(root.group, 0x30405060);
		const target = firstCodelet(graph);
		const canonicalPeer = firstCodelet(
			graph,
			(codelet) => codelet.op !== target.op
		);
		const tampered = replaceCodelet(graph, target, {
			...target,
			op: canonicalPeer.op,
		});

		expect(() => verifyIsoglossEffectGraph(root.group, tampered)).toThrow(
			"RUAM_ISOGLOSS_EFFECT_GRAPH_CODELET_MISMATCH"
		);
	});

	it("rejects a changed semantic operand", () => {
		const root = compileOne();
		const graph = buildIsoglossEffectGraph(root.group, 0x40506070);
		const target = firstCodelet(graph);
		const tampered = replaceCodelet(graph, target, {
			...target,
			operand: target.operand + 1,
		});

		expect(() => verifyIsoglossEffectGraph(root.group, tampered)).toThrow(
			"RUAM_ISOGLOSS_EFFECT_GRAPH_CODELET_MISMATCH"
		);
	});

	it("rejects changed origin, signature, entry, and aggregate evidence", () => {
		const root = compileOne();
		const graph = buildIsoglossEffectGraph(root.group, 0x45556575);
		const target = firstCodelet(graph);
		const changedOrigin = replaceCodelet(graph, target, {
			...target,
			originId: target.originId + 1,
		});
		expect(() => verifyIsoglossEffectGraph(root.group, changedOrigin)).toThrow(
			"RUAM_ISOGLOSS_EFFECT_GRAPH_CODELET_MISMATCH"
		);

		const changedSignature = replaceCodelet(graph, target, {
			...target,
			signature: { ...target.signature, purity: "pure" },
		});
		expect(() =>
			verifyIsoglossEffectGraph(root.group, changedSignature)
		).toThrow("RUAM_ISOGLOSS_EFFECT_GRAPH_CODELET_MISMATCH");

		const changedEntry = {
			...graph,
			units: graph.units.map((unit, index) =>
				index === 0 ? { ...unit, entryCodeletId: "forged-entry" } : unit
			),
		} as IsoglossEffectGraph;
		expect(() => verifyIsoglossEffectGraph(root.group, changedEntry)).toThrow(
			"RUAM_ISOGLOSS_EFFECT_GRAPH_ENTRY_MISMATCH"
		);

		const changedCount = {
			...graph,
			protectedCodeletCount: graph.protectedCodeletCount + 1,
		};
		expect(() =>
			verifyIsoglossEffectGraph(root.group, changedCount)
		).toThrow("RUAM_ISOGLOSS_EFFECT_GRAPH_COUNT_MISMATCH");
	});

	it("rejects changed control-flow exits", () => {
		const root = compileOne();
		const graph = buildIsoglossEffectGraph(root.group, 0x50607080);
		const target = firstCodelet(graph, (codelet) => codelet.exits.length > 0);
		const tampered = replaceCodelet(graph, target, {
			...target,
			exits: [],
		});

		expect(() => verifyIsoglossEffectGraph(root.group, tampered)).toThrow(
			"RUAM_ISOGLOSS_EFFECT_GRAPH_EXIT_MISMATCH"
		);
	});

	it("rejects witness and pair-ambiguity variant tampering", () => {
		const root = compileOne();
		const graph = buildIsoglossEffectGraph(root.group, 0x60708090);
		const target = firstCodelet(graph);
		const variant = target.variants[0]!;
		const witnessClasses = new Set(
			[...variant.leftCandidates, ...variant.rightCandidates].map(
				(candidate) => candidate.witnessClass
			)
		);
		let absentWitness = 0;
		while (witnessClasses.has(absentWitness)) absentWitness++;
		const badWitness = replaceCodelet(graph, target, {
			...target,
			variants: [
				{ ...variant, selectedWitnessClass: absentWitness },
				...target.variants.slice(1),
			],
		});
		expect(() => verifyIsoglossEffectGraph(root.group, badWitness)).toThrow(
			"RUAM_ISOGLOSS_EFFECT_GRAPH_WITNESS_MISMATCH"
		);

		const leftWitnessChanged = replaceCodelet(graph, target, {
			...target,
			variants: [
				{
					...variant,
					leftCandidates: variant.leftCandidates.map((candidate) =>
						candidate.codeletId === variant.resolvedCodeletId
							? { ...candidate, witnessClass: candidate.witnessClass + 1 }
							: candidate
					),
				},
				...target.variants.slice(1),
			],
		});
		expect(() =>
			verifyIsoglossEffectGraph(root.group, leftWitnessChanged)
		).toThrow("RUAM_ISOGLOSS_EFFECT_GRAPH_VARIANT_UNIQUE");

		const repeated = variant.leftCandidates[0]!;
		const uniquePair = replaceCodelet(graph, target, {
			...target,
			variants: [
				{
					...variant,
					rightCandidates: [repeated, { ...repeated }],
				},
				...target.variants.slice(1),
			],
		});
		expect(() => verifyIsoglossEffectGraph(root.group, uniquePair)).toThrow(
			"RUAM_ISOGLOSS_EFFECT_GRAPH_VARIANT_UNIQUE"
		);
	});

	it("is deterministic for each seed and verifies across the pull-request seed tier", () => {
		const root = compileOne();
		const fingerprints = new Set<string>();
		const seeds = Array.from(
			{ length: 32 },
			(_unused, index) => Math.imul(index + 1, 0x9e3779b9) >>> 0
		);
		for (const seed of seeds) {
			const first = buildIsoglossEffectGraph(root.group, seed);
			const repeated = buildIsoglossEffectGraph(root.group, seed);
			expect(repeated).toEqual(first);
			expect(verifyIsoglossEffectGraph(root.group, first).valid).toBe(true);
			expect(codeletNodeKeys(first)).toEqual(canonicalNodeKeys(root.group));
			fingerprints.add(
				first.units
					.flatMap((unit) => unit.codelets)
					.map((codelet) =>
						[
							codelet.id,
							...codelet.variants.map(
								(variant) =>
									`${variant.leftCell}:${variant.rightCell}:${variant.selectedWitnessClass}`
							),
						].join("|")
					)
					.join(";")
			);
		}
		expect(fingerprints.size).toBe(seeds.length);
	});

	it("forbids the product pipeline from reporting or emitting a native lane", () => {
		const source = `function exposed(object, offset) {
	object.value += offset;
	if (object.value > 10) return object.commit();
	throw new RangeError("small");
}`;
		const build = protectCodeDeterministic(source, {}, 0x71a9e001);
		const stats = build.stats as unknown as Record<string, unknown>;
		const diagnosticCodes = build.diagnostics.map((diagnostic) => diagnostic.code);

		expect(stats.nativeRegionCount ?? 0).toBe(0);
		expect(stats.nativeFunctionCount ?? 0).toBe(0);
		expect(stats.hybridFunctionCount ?? 0).toBe(0);
		expect(diagnosticCodes).not.toContain("RUAM_SOURCE_TARGET_MISSING_DOMAINS");
		expect(diagnosticCodes).not.toContain("RUAM_SOURCE_REGION_NATIVE");
		expect(build.code).not.toBe(source);
		expect(build.code).not.toContain("object.value += offset");
		expect(build.code).not.toContain("return object.commit()");
	});
});
