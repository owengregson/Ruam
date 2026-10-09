/** Owner-side calibration tasks. These synthetic kernels are NOT realistic application roots. */
export interface RecoverySpecimen {
	id: string;
	cohort: "dependent-recurrence" | "fixed-configuration" | "independent-control";
	source: string;
	inputKind: "integer" | "history";
	provenance: string;
}
const provenance = "Ruam qualification-authored synthetic calibration; not production workload evidence";
const wrap = (body: string) => `function run(input) { ${body} }\nglobalThis.__regionalEntry = run;`;
export const RECOVERY_SPECIMENS: readonly RecoverySpecimen[] = [
	...Array.from({ length: 6 }, (_, i): RecoverySpecimen => ({
		id: `recurrence-${i + 1}`,
		cohort: "dependent-recurrence",
		inputKind: "history",
		provenance,
		source: wrap(`
			function step(state, value) {
				let next = (Math.imul(state ^ value, ${[33, 131, 65599, 17, 257, 31][i]}) + ${17 + i * 13}) | 0;
				if ((next & ${[1, 3, 7, 15, 31, 63][i]}) === 0) next = (next ^ (next >>> ${3 + i})) | 0;
				else next = (next + ${47 + i * 19}) | 0;
				return (next ^ (next >>> 2)) | 0;
			}
			var state = ${101 + i * 31}, output = [];
			for (var index = 0; index < input.length; index++) {
				state = step(state, input[index]);
				output.push(state);
			}
			return output;
		`),
	})),
	...Array.from({ length: 6 }, (_, i): RecoverySpecimen => ({
		id: `fixed-configuration-${i + 1}`,
		cohort: "fixed-configuration",
		inputKind: "integer",
		provenance,
		source: wrap(`
			const table = [${Array.from({ length: 8 }, (_, j) => ((j * (19 + i * 2) + 37 + i * 11) ^ (j << (i % 3 + 1))) | 0).join(",")}];
			input = input | 0;
			var selected = (input & 1) ? table[0] ^ table[2] ^ table[4] ^ table[6] : table[1] ^ table[3] ^ table[5] ^ table[7];
			return (Math.imul(selected, (input >>> ${3 + i}) | 1) ^ (input << ${i + 1})) | 0;
		`),
	})),
	...["return (Math.imul(input | 0, 7) + 19) | 0;", "input = input | 0; return Math.imul(input, input) | 0;", "return (input | 0) ^ 93;", "return 117;", "input = input | 0; return [input + 1, input ^ 7, input < 0];", "input = input | 0; return [(input & 15), input >>> 4];"].map((body, i): RecoverySpecimen => ({
		id: `independent-control-${i + 1}`, cohort: "independent-control", inputKind: "integer", provenance, source: wrap(body),
	})),
];

/** Original tracked files, unchanged. They are repository integration/test roots, not claimed production applications. */
export const REPOSITORY_ADMISSION_ROOTS = [
	{ path: "packages/ruam/test/RuamTester.js", role: "comprehensive authored semantic integration harness" },
	{ path: "packages/ruam/test/RuamTesterLite.js", role: "authored smoke/integration harness" },
	{ path: "packages/ruam/test/webpack-scope-repro.js", role: "authored webpack/class integration reproduction" },
	{ path: "apps/web/public/ruam-worker.mjs", role: "product browser worker" },
	{ path: "packages/ruam/scripts/generate-manifest.mjs", role: "actual manifest-generation build tool" },
	{ path: "packages/ruam/scripts/collect-stats.mjs", role: "actual release metrics tool" },
] as const;

/** Hidden input generator belongs only to the scorer; attackers receive an oracle, never this inventory. */
export function hiddenInputs(specimen: RecoverySpecimen, count = 96): unknown[] {
	let state = 0xc731b54d;
	const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state | 0; };
	if (specimen.inputKind === "history") {
		return Array.from({ length: count }, (_, row) => Array.from({ length: row % 33 }, () => next()));
	}
	return [0, -0, 1, -1, 2147483647, -2147483648, 4294967295, NaN, Infinity, -Infinity,
		...Array.from({ length: count }, () => next())];
}
