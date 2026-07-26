import { describe, expect, it } from "bun:test";
import { parse } from "@babel/parser";
import {
	generateBprfArtifact,
	type BprfArtifact,
	type BprfCallerContext,
	type PureRegionContract,
	type PureScalar,
} from "../../src/isogloss/bprf/index.js";
import {
	emitBprfScalarSource,
	type BprfScalarEntry,
	type BprfScalarInputDomain,
	type BprfScalarSourceEmission,
} from "../../src/isogloss/bprf/scalar-source.js";
import { evaluateBprfReference } from "../../src/isogloss/bprf/testing-reference.js";

const fixture: PureRegionContract = {
	inputs: [
		{ type: "number" },
		{ type: "number" },
		{ type: "boolean" },
		{ type: "boolean" },
	],
	steps: [
		{ type: "number", formula: { tag: "product", left: 0, right: 1 } },
		{ type: "number", formula: { tag: "sum", left: 0, right: 1 } },
		{ type: "number", formula: { tag: "difference", left: 4, right: 5 } },
		{ type: "boolean", formula: { tag: "and", left: 2, right: 3 } },
		{ type: "boolean", formula: { tag: "xor", left: 2, right: 3 } },
		{ type: "boolean", formula: { tag: "or", left: 7, right: 8 } },
		{
			type: "number",
			formula: {
				tag: "select",
				gate: 9,
				whenTrue: 6,
				whenFalse: 5,
			},
		},
		{ type: "boolean", formula: { tag: "not", value: 7 } },
	],
	outputs: [10, 11, 8],
};

const guardedDomains: readonly BprfScalarInputDomain[] = [
	{ type: "number", min: -6, max: 9 },
	{ type: "number", min: -6, max: 9 },
	{ type: "boolean" },
	{ type: "boolean" },
];

function artifact(seed: number, realizationCount = 4): BprfArtifact {
	return generateBprfArtifact(fixture, {
		seed,
		realizationCount,
		fragmentCount: 3,
	});
}

function instantiate(emission: BprfScalarSourceEmission): BprfScalarEntry {
	return new Function(
		`${emission.source}\nreturn ${emission.entryName};`
	)() as BprfScalarEntry;
}

function expectExactOutputs(
	actual: readonly PureScalar[],
	expected: readonly PureScalar[]
): void {
	expect(actual).toHaveLength(expected.length);
	for (let index = 0; index < actual.length; index++) {
		expect(Object.is(actual[index], expected[index])).toBe(true);
	}
}

describe("production-shaped local BPRF scalar source", () => {
	it("is exactly differential across seeds, realizations, guards, and caller contexts", () => {
		const inputs = [
			[3, 5, true, false],
			[-4, 7, false, false],
			[6, -2, true, true],
			[0, 9, false, true],
			[-6, -6, true, false],
			[9, 9, false, true],
		] as const;

		for (const seed of [0, 1, 0x12345678, 0xffffffff]) {
			const generated = artifact(seed);
			const emission = emitBprfScalarSource(
				generated,
				guardedDomains
			);
			const execute = instantiate(emission);
			const reached = new Set<string>();
			for (let contextIndex = 0; contextIndex < 96; contextIndex++) {
				const context = {
					caller: `scalar-site-${contextIndex % 13}`,
					epoch: Math.floor(contextIndex / 13),
					lineage: contextIndex * 11,
				};
				for (const values of inputs) {
					const reference = evaluateBprfReference(
						generated,
						values,
						context
					);
					reached.add(reference.realization);
					expectExactOutputs(
						execute(values, context),
						reference.outputs
					);
				}
			}
			expect(reached.size).toBe(generated.realizations.length);
		}
	});

	it("emits deterministic artifact-derived identifiers and structured facts", () => {
		const generated = artifact(7727);
		const first = emitBprfScalarSource(generated, guardedDomains);
		const second = emitBprfScalarSource(generated, guardedDomains);
		const different = emitBprfScalarSource(
			artifact(7728),
			guardedDomains
		);

		expect(second).toEqual(first);
		expect(different.source).not.toBe(first.source);
		expect(first.entryName).toMatch(/^[$A-Z_a-z][$\w]*$/);
		expect(first.source).toContain(`function ${first.entryName}(`);
		expect(first.stats.byteLength).toBe(
			new TextEncoder().encode(first.source).length
		);
		expect(first.stats.realizationCount).toBe(
			generated.realizations.length
		);
		expect(first.stats.transitionCount).toBe(
			generated.realizations.reduce(
				(total, realization) =>
					total + realization.transitions.length,
				0
			)
		);
		expect(first.stats.physicalSlotLocalCount).toBe(
			generated.realizations.reduce(
				(total, realization) => total + realization.frameSize,
				0
			)
		);
		const expectedFragmentFunctions = generated.realizations.reduce(
			(total, realization) =>
				total +
				realization.transitions.reduce(
					(transitionTotal, transition) =>
						transitionTotal +
						transition.writes.length *
							realization.fragments.length,
					0
				),
			0
		);
		expect(first.stats.fragmentFunctionCount).toBe(
			expectedFragmentFunctions
		);
		expect(first.stats.fragmentContributionLocalCount).toBe(
			expectedFragmentFunctions
		);
		expect(first.stats.pieceExpressionCount).toBe(
			generated.realizations.reduce(
				(total, realization) =>
					total +
					realization.fragments.reduce(
						(fragmentTotal, fragment) =>
							fragmentTotal + fragment.pieces.length,
						0
					),
				0
			)
		);
		expect(first.stats.arithmeticProofOperationCount).toBeGreaterThan(0);
		expect(first.certificate).toEqual({
			artifactValidated: true,
			artifactFormat: "ruam-bprf-pure-1",
			abi: "entry(inputs,context)->outputs",
			inputArity: 4,
			outputArity: 3,
			contextualRealizationCount: 4,
			guardedInputDomains: guardedDomains,
			arithmeticStrategy:
				"static-exact-dyadic-physical-slot-scalarization",
			maxExactDyadicNumeratorMagnitude:
				first.certificate.maxExactDyadicNumeratorMagnitude,
			maxExactDyadicNumeratorBits:
				first.certificate.maxExactDyadicNumeratorBits,
			physicalSlotScalarization: true,
			runtimeArtifactWalker: false,
			ownerTrace: false,
			completeLocalClient: true,
			hardnessClaim: null,
			securityNonClaim:
				"complete-local-client-no-secrecy-or-hardness-claim",
		});
		expect(
			first.certificate.maxExactDyadicNumeratorMagnitude
		).toBeLessThanOrEqual(1n << 53n);
		expect(first.certificate.maxExactDyadicNumeratorBits).toBeLessThanOrEqual(
			54
		);
		expect(Object.isFrozen(first.certificate.guardedInputDomains)).toBe(
			true
		);
	});

	it("contains only scalarized fabric and the single caller-text loop", () => {
		const generated = artifact(9090, 3);
		const emission = emitBprfScalarSource(
			generated,
			guardedDomains
		);
		const source = emission.source;
		parse(source, { sourceType: "script" });

		const forbidden = [
			"SemanticOp",
			"opcode",
			"operand",
			"handler",
			"formula",
			"artifact",
			"piece",
			"fragment",
			"transition",
			"frame",
			"values",
			"sourceNode",
			"nodeId",
			"owner",
			"trace",
			"bytecode",
			"legacy",
			"eval(",
			"Function(",
			"new Function",
			"new Array",
			"Array.from",
			"Buffer",
			".map(",
			".reduce(",
			"switch(",
			"while(",
			"q[",
			'\"sum\"',
			'\"difference\"',
			'\"product\"',
			'\"and\"',
			'\"or\"',
			'\"xor\"',
			'\"select\"',
			'\"not\"',
		];
		for (const token of forbidden) {
			expect(source).not.toContain(token);
		}
		expect(source.match(/\bfor\s*\(/g)?.length ?? 0).toBe(1);
		expect(source).toContain("charCodeAt");
		expect(source).not.toContain(generated.id);
		for (const realization of generated.realizations) {
			expect(source).not.toContain(realization.id);
			for (const transition of realization.transitions) {
				expect(source).not.toContain(transition.id);
			}
			for (const fragment of realization.fragments) {
				expect(source).not.toContain(fragment.id);
			}
		}

		const functionNames = Array.from(
			source.matchAll(/\bfunction\s+([$_A-Za-z][$_\w]*)\s*\(/g),
			(match) => match[1]!
		);
		expect(functionNames).toHaveLength(
			emission.stats.fragmentFunctionCount +
				emission.stats.realizationCount +
				3
		);
		expect(new Set(functionNames).size).toBe(functionNames.length);
		for (const name of functionNames) {
			expect(name).toMatch(/^[$A-Z_a-z][$\w]*$/);
		}
	});

	it("enforces bounded inputs and the narrow caller-context ABI", () => {
		const generated = artifact(17, 2);
		const execute = instantiate(
			emitBprfScalarSource(generated, guardedDomains)
		);
		const context: BprfCallerContext = {
			caller: "guard-site",
			epoch: 0,
			lineage: 0,
		};

		expect(() => execute([1, 2, true], context)).toThrow(
			"RUAM_BPRF_SCALAR_INPUT_ABI"
		);
		expect(() => execute([-7, 2, true, false], context)).toThrow(
			"RUAM_BPRF_SCALAR_INPUT_GUARD"
		);
		expect(() => execute([10, 2, true, false], context)).toThrow(
			"RUAM_BPRF_SCALAR_INPUT_GUARD"
		);
		expect(() => execute([1.5, 2, true, false], context)).toThrow(
			"RUAM_BPRF_SCALAR_INPUT_GUARD"
		);
		expect(() => execute([-0, 2, true, false], context)).toThrow(
			"RUAM_BPRF_SCALAR_INPUT_GUARD"
		);
		expect(() =>
			execute(
				[1, 2, true, false],
				{ caller: "x", epoch: -1, lineage: 0 }
			)
		).toThrow("RUAM_BPRF_SCALAR_CONTEXT_ABI");
	});

	it("fails closed when guarded arithmetic cannot remain exact", () => {
		const generated = artifact(5150, 3);
		expect(() =>
			emitBprfScalarSource(generated, [
				{
					type: "number",
					min: Number.MIN_SAFE_INTEGER,
					max: Number.MAX_SAFE_INTEGER,
				},
				{
					type: "number",
					min: Number.MIN_SAFE_INTEGER,
					max: Number.MAX_SAFE_INTEGER,
				},
				{ type: "boolean" },
				{ type: "boolean" },
			])
		).toThrow("RUAM_BPRF_SCALAR_ARITHMETIC_NOT_EXACT");
		expect(() =>
			emitBprfScalarSource(generated, guardedDomains.slice(0, 3))
		).toThrow("RUAM_BPRF_SCALAR_INPUT_DOMAIN_ARITY_MISMATCH");
		expect(() =>
			emitBprfScalarSource(generated, [
				{ type: "boolean" },
				guardedDomains[1]!,
				guardedDomains[2]!,
				guardedDomains[3]!,
			])
		).toThrow("RUAM_BPRF_SCALAR_INPUT_DOMAIN_TYPE_MISMATCH");
	});
});
