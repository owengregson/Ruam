import { describe, expect, it } from "bun:test";
import { parse } from "@babel/parser";
import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import { traverse } from "../../src/babel-compat.js";
import {
	buildEffectRegionGraph,
	compileSemanticFunction,
	planPureRegionCandidates,
	resetUnitCounter,
	type EffectRegionGraph,
	type PureRegionEntryAssumptionMap,
	type PureRegionInputAssumption,
} from "../../src/compiler/index.js";
import type { SemanticUnit } from "../../src/compiler/ir.js";
import { SemanticOp } from "../../src/compiler/semantic-ops.js";
import { generateBprfArtifact } from "../../src/isogloss/bprf/index.js";
import { evaluateBprfReference } from "../../src/isogloss/bprf/testing-reference.js";

interface CompiledFixture {
	unit: SemanticUnit;
	graph: EffectRegionGraph;
}

function getFunctionPath(
	source: string,
	name: string
): NodePath<t.Function> {
	const ast = parse(source, {
		sourceType: "script",
		sourceFilename: "pure-region-planning-fixture.js",
	});
	let result: NodePath<t.Function> | undefined;
	traverse(ast, {
		Function(path) {
			const id = "id" in path.node ? path.node.id : null;
			if (id?.type === "Identifier" && id.name === name) {
				result = path as NodePath<t.Function>;
				path.stop();
			}
		},
	});
	if (!result) throw new Error(`Missing function ${name}`);
	return result;
}

function compileFixture(source: string, name: string): CompiledFixture {
	resetUnitCounter(919);
	const group = compileSemanticFunction(
		getFunctionPath(source, name),
		`plan-${name}`
	);
	const unit = group.units.find(
		(candidate) => candidate.id === group.entryUnitId
	)!;
	return { unit, graph: buildEffectRegionGraph(unit) };
}

function regionIndexWithOp(
	fixture: CompiledFixture,
	op: SemanticOp
): number {
	const index = fixture.graph.regions.findIndex((region) =>
		region.nodeIds.some(
			(nodeId) =>
				fixture.unit.nodes.find((node) => node.id === nodeId)!.op === op
		)
	);
	if (index < 0) throw new Error(`Missing semantic op ${op}`);
	return index;
}

function numberAssumption(
	kind: "stack" | "argument" | "register" | "slot",
	index: number,
	min: number,
	max: number
): PureRegionInputAssumption {
	return {
		binding: { kind, index },
		domain: { type: "number", min, max },
	};
}

function booleanArgument(index: number): PureRegionInputAssumption {
	return {
		binding: { kind: "argument", index },
		domain: { type: "boolean" },
	};
}

function compileMixedFixture(): CompiledFixture {
	return compileFixture(
		`function mixed(a, b) {
			let x = a * 3;
			x = x + 1;
			x = x / b;
			x = x - 2;
			x = x * 2;
			return x;
		}`,
		"mixed"
	);
}

function mixedAssumptions(
	fixture: CompiledFixture
): PureRegionEntryAssumptionMap {
	const division = regionIndexWithOp(fixture, SemanticOp.DIV);
	return new Map([
		[
			fixture.graph.regions[0]!.id,
			[
				numberAssumption("argument", 0, 1, 20),
				numberAssumption("argument", 1, 1, 20),
			],
		],
		[
			fixture.graph.regions[division]!.id,
			[
				numberAssumption("stack", 0, 1, 20),
				numberAssumption("stack", 1, 1, 20),
			],
		],
		[
			fixture.graph.regions[division + 1]!.id,
			[numberAssumption("stack", 0, 1, 20)],
		],
	]);
}

describe("automatic pure-region candidate planning", () => {
	it("plans deterministic disjoint maximal spans in graph order", () => {
		const fixture = compileMixedFixture();
		const assumptions = mixedAssumptions(fixture);
		const division = regionIndexWithOp(fixture, SemanticOp.DIV);
		const first = planPureRegionCandidates(
			fixture.unit,
			fixture.graph,
			assumptions
		);
		const second = planPureRegionCandidates(
			fixture.unit,
			fixture.graph,
			assumptions
		);

		expect(JSON.stringify(second)).toBe(JSON.stringify(first));
		expect(
			first.candidates.map((candidate) => [
				candidate.startRegionIndex,
				candidate.endRegionIndex,
			])
		).toEqual([
			[0, division - 1],
			[division + 1, fixture.graph.regions.length - 2],
		]);
		for (const candidate of first.candidates) {
			expect(candidate.lowered.regionIds).toEqual(
				fixture.graph.regions
					.slice(
						candidate.startRegionIndex,
						candidate.endRegionIndex + 1
					)
					.map((region) => region.id)
			);
		}

		const selectedIds = first.candidates.flatMap((candidate) =>
			Array.from(candidate.lowered.regionIds)
		);
		expect(new Set(selectedIds).size).toBe(selectedIds.length);
		expect(selectedIds).not.toContain(
			fixture.graph.regions[division]!.id
		);
		expect(selectedIds).not.toContain(
			fixture.graph.regions.at(-1)!.id
		);
		expect(
			first.rejections.some(
				(rejection) =>
					rejection.startRegionIndex === 0 &&
					rejection.endRegionIndex >= division &&
					rejection.code === "RUAM_PURE_REGION_UNSUPPORTED_OP"
			)
		).toBe(true);
		expect(
			first.rejections.some(
				(rejection) =>
					rejection.startRegionIndex === division &&
					rejection.endRegionIndex === division &&
					rejection.code === "RUAM_PURE_REGION_UNSUPPORTED_OP" &&
					rejection.detail?.includes("DIV")
			)
		).toBe(true);
		expect(first.rejections.at(-1)).toEqual({
			entryRegionId: fixture.graph.regions.at(-1)!.id,
			startRegionIndex: fixture.graph.regions.length - 1,
			endRegionIndex: fixture.graph.regions.length - 1,
			regionIds: [fixture.graph.regions.at(-1)!.id],
			code: "RUAM_PURE_REGION_PLAN_ASSUMPTIONS_UNAVAILABLE",
			detail: null,
		});
	});

	it("uses a provider once per unconsumed entry without changing the plan", () => {
		const fixture = compileMixedFixture();
		const assumptions = mixedAssumptions(fixture);
		const fromMap = planPureRegionCandidates(
			fixture.unit,
			fixture.graph,
			assumptions
		);
		const calls: Array<[string, number]> = [];
		const fromProvider = planPureRegionCandidates(
			fixture.unit,
			fixture.graph,
			(region, index) => {
				calls.push([region.id, index]);
				return assumptions.get(region.id);
			}
		);

		expect(JSON.stringify(fromProvider)).toBe(JSON.stringify(fromMap));
		expect(calls).toEqual([
			[fixture.graph.regions[0]!.id, 0],
			[
				fixture.graph.regions[
					regionIndexWithOp(fixture, SemanticOp.DIV)
				]!.id,
				regionIndexWithOp(fixture, SemanticOp.DIV),
			],
			[
				fixture.graph.regions[
					regionIndexWithOp(fixture, SemanticOp.DIV) + 1
				]!.id,
				regionIndexWithOp(fixture, SemanticOp.DIV) + 1,
			],
			[
				fixture.graph.regions.at(-1)!.id,
				fixture.graph.regions.length - 1,
			],
		]);
	});

	it("is exactly equivalent through every planned BPRF realization", () => {
		const fixture = compileMixedFixture();
		const plan = planPureRegionCandidates(
			fixture.unit,
			fixture.graph,
			mixedAssumptions(fixture)
		);
		const [beforeDivision, afterDivision] = plan.candidates;
		expect(beforeDivision).toBeDefined();
		expect(afterDivision).toBeDefined();

		for (const seed of [0, 1, 0x5eed1234, 0xffffffff]) {
			const beforeArtifact = generateBprfArtifact(
				beforeDivision!.lowered.contract,
				{ seed, realizationCount: 4, fragmentCount: 3 }
			);
			const afterArtifact = generateBprfArtifact(
				afterDivision!.lowered.contract,
				{ seed, realizationCount: 4, fragmentCount: 3 }
			);
			const beforeReached = new Set<string>();
			const afterReached = new Set<string>();

			for (let contextIndex = 0; contextIndex < 48; contextIndex++) {
				const context = {
					caller: `planner-caller-${contextIndex % 7}`,
					epoch: Math.floor(contextIndex / 7),
					lineage: contextIndex * 17,
				};
				for (const a of [1, 7, 20]) {
					for (const b of [1, 4, 20]) {
						const result = evaluateBprfReference(
							beforeArtifact,
							[a, b],
							context
						);
						beforeReached.add(result.realization);
						expect(result.outputs[0]).toBe(a * 3 + 1);
						expect(result.outputs[1]).toBe(b);
					}
					const result = evaluateBprfReference(
						afterArtifact,
						[a],
						context
					);
					afterReached.add(result.realization);
					expect(result.outputs[0]).toBe((a - 2) * 2);
				}
			}

			expect(beforeReached.size).toBe(beforeArtifact.realizations.length);
			expect(afterReached.size).toBe(afterArtifact.realizations.length);
		}
	});

	it("does not infer missing domains and records structured rejections", () => {
		const fixture = compileMixedFixture();
		const plan = planPureRegionCandidates(
			fixture.unit,
			fixture.graph,
			new Map()
		);

		expect(plan.candidates).toEqual([]);
		expect(plan.rejections).toHaveLength(fixture.graph.regions.length);
		expect(
			plan.rejections.every(
				(rejection) =>
					rejection.code ===
						"RUAM_PURE_REGION_PLAN_ASSUMPTIONS_UNAVAILABLE" &&
					rejection.detail === null &&
					rejection.regionIds.length === 1
			)
		).toBe(true);
	});

	it("never plans across branch, call, suspension, or exception entries", () => {
		const fixtures = [
			{
				fixture: compileFixture(
					`function branch(flag) {
						let x = !flag;
						x = !x;
						return flag ? x : !x;
					}`,
					"branch"
				),
				label: "branch",
				domain: "boolean",
			},
			{
				fixture: compileFixture(
					`function call(value) {
						let x = !value;
						x = !x;
						Math.abs(1);
						return x;
					}`,
					"call"
				),
				label: "call",
				domain: "boolean",
			},
			{
				fixture: compileFixture(
					`async function suspend(value) {
						let x = !value;
						x = !x;
						await x;
						return x;
					}`,
					"suspend"
				),
				label: "suspend",
				domain: "boolean",
			},
			{
				fixture: compileFixture(
					`function handled(value) {
						try {
							let x = value * 2;
							x = x + 1;
							return x;
						} catch {
							return 0;
						}
					}`,
					"handled"
				),
				label: "handled",
				domain: "number",
			},
		];

		for (const { fixture, label, domain } of fixtures) {
			const assumptions = new Map([
				[
					fixture.graph.regions[0]!.id,
					domain === "number"
						? [numberAssumption("argument", 0, 1, 20)]
						: [booleanArgument(0)],
				],
			]);
			const plan = planPureRegionCandidates(
				fixture.unit,
				fixture.graph,
				assumptions
			);
			if (label === "handled") {
				expect(plan.candidates).toEqual([]);
				expect(
					plan.rejections.some(
						(rejection) =>
							rejection.code ===
								"RUAM_PURE_REGION_EXCEPTION_ENTRY" ||
							rejection.code ===
								"RUAM_PURE_REGION_EXCEPTION_PATH_SELECTED"
					)
				).toBe(true);
			} else if (plan.candidates.length === 0) {
				throw new Error(`Expected a lowerable prefix for ${label}`);
			}
			const selected = new Set(
				plan.candidates.flatMap((candidate) =>
					Array.from(candidate.lowered.regionIds)
				)
			);

			for (const region of fixture.graph.regions) {
				if (
					region.exits.some((exit) =>
						[
							"branch-true",
							"branch-false",
							"call",
							"yield",
							"await",
							"finally",
							"return",
						].includes(exit.kind)
					)
				) {
					expect(selected.has(region.id)).toBe(false);
				}
				for (const exit of region.exits) {
					if (
						(exit.kind === "exception" ||
							exit.kind === "finally") &&
						"targetRegionId" in exit
					) {
						expect(selected.has(exit.targetRegionId)).toBe(false);
					}
				}
			}
		}
	});

	it("propagates provider and canonical-input failures", () => {
		const fixture = compileMixedFixture();
		const providerFailure = new Error("unexpected-provider-failure");
		expect(() =>
			planPureRegionCandidates(
				fixture.unit,
				fixture.graph,
				() => {
					throw providerFailure;
				}
			)
		).toThrow(providerFailure);

		const malformedUnit: SemanticUnit = {
			...fixture.unit,
			nodes: fixture.unit.nodes.slice(1),
		};
		expect(() =>
			planPureRegionCandidates(
				malformedUnit,
				fixture.graph,
				mixedAssumptions(fixture)
			)
		).toThrow("RUAM_PURE_REGION_UNKNOWN_NODE");

		expect(() =>
			planPureRegionCandidates(
				fixture.unit,
				{ ...fixture.graph, unitId: "wrong-unit" },
				mixedAssumptions(fixture)
			)
		).toThrow("RUAM_PURE_REGION_PLAN_UNIT_MISMATCH");
	});
});
