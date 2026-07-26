import { describe, expect, it } from "bun:test";
import { parse } from "@babel/parser";
import { BABEL_PARSER_PLUGINS } from "../../src/constants.js";
import {
	buildIsoglossEffectGraph,
	type IsoglossEffectGraph,
} from "../../src/isogloss/effect-graph.js";
import { compileProtectedSourceRoots } from "../../src/isogloss/source-roots.js";
import { verifyIsoglossEffectGraph } from "../../src/isogloss/verify-effect-graph.js";

function compileOne(source: string) {
	const ast = parse(source, {
		sourceType: "script",
		plugins: [...BABEL_PARSER_PLUGINS],
	});
	const roots = compileProtectedSourceRoots(ast, {
		targetMode: "root",
		threshold: 1,
		seed: 0x12345678,
	});
	expect(roots).toHaveLength(1);
	return roots[0]!.group;
}

describe("whole-root Isogloss effect graph", () => {
	it("owns every canonical node including calls, mutation, control, and throws", () => {
		const group = compileOne(`
function execute(value, object) {
	object.count++;
	if (value > 0) return object.run(value);
	throw new RangeError("negative");
}
`);
		const graph = buildIsoglossEffectGraph(group, 0xabcdef01);
		const verification = verifyIsoglossEffectGraph(group, graph);
		const codelets = graph.units.flatMap((unit) => unit.codelets);
		const effects = new Set(codelets.map((codelet) => codelet.signature.effect));

		expect(verification).toMatchObject({
			valid: true,
			canonicalNodeCount: codelets.length,
			protectedCodeletCount: codelets.length,
			unprotectedCanonicalNodeCount: 0,
			unsupportedCanonicalNodeCount: 0,
		});
		expect(effects).toContain("object");
		expect(effects).toContain("call");
		expect(codelets.every((codelet) => codelet.variants.length === 2)).toBe(true);
		expect(
			codelets.every((codelet) =>
				codelet.variants.every(
					(variant) =>
						variant.leftCandidates.length >= 2 &&
						variant.rightCandidates.length >= 2 &&
						variant.resolvedCodeletId === codelet.id
				)
			)
		).toBe(true);
	});

	it("is deterministic per seed and structurally different across seeds", () => {
		const group = compileOne("function execute(x) { return (x + 1) * 2; }");
		const first = buildIsoglossEffectGraph(group, 111);
		const repeated = buildIsoglossEffectGraph(group, 111);
		const different = buildIsoglossEffectGraph(group, 222);

		expect(first).toEqual(repeated);
		expect(first.units[0]!.codelets.map((codelet) => codelet.id)).not.toEqual(
			different.units[0]!.codelets.map((codelet) => codelet.id)
		);
	});

	it("creates distinct semantic aliases for a single-node empty root", () => {
		const group = compileOne("function execute() {}");
		const graph = buildIsoglossEffectGraph(group, 223);
		const codelet = graph.units[0]!.codelets[0]!;

		expect(codelet.variants).toHaveLength(2);
		expect(
			codelet.variants.every(
				(variant) =>
					new Set(
						variant.leftCandidates.map((candidate) => candidate.codeletId)
					).size >= 2
			)
		).toBe(true);
		expect(verifyIsoglossEffectGraph(group, graph).valid).toBe(true);
	});

	it("refuses to certify a graph missing one protected codelet", () => {
		const group = compileOne("function execute(x) { return x + 1; }");
		const graph = buildIsoglossEffectGraph(group, 333);
		const firstUnit = graph.units[0]!;
		const incomplete = {
			...graph,
			units: [
				{
					...firstUnit,
					codelets: firstUnit.codelets.slice(0, -1),
				},
				...graph.units.slice(1),
			],
		} as IsoglossEffectGraph;

		expect(() => verifyIsoglossEffectGraph(group, incomplete)).toThrow(
			/RUAM_ISOGLOSS_EFFECT_GRAPH_(EXIT_TARGET_MISSING|INCOMPLETE)/
		);
	});
});
