import { describe, expect, it } from "bun:test";
import {
	applyMaskedTransitionResponse,
	createMaskedCustodyClientState,
	openMaskedCustodyProjection,
	prepareMaskedProjectionRequest,
	prepareMaskedTransitionRequest,
} from "../../src/isogloss/csh/masked-custody-protocol.js";
import {
	ReferenceMaskedChartCustodian,
	type HiddenMaskedTransition,
} from "../../src/isogloss/csh/reference-masked-custodian.js";
import {
	CSH_FIELD_MODULUS,
	createChartCover,
	encodeIngressCharts,
	evaluateCertifiedProjection,
	transportAffineCharts,
} from "../../src/isogloss/csh/reference.js";

const identity = {
	id: "masked_identity",
	matrix: [
		[1, 0, 0],
		[0, 1, 0],
		[0, 0, 1],
	],
	bias: [0, 0, 0],
};

const transitions: readonly HiddenMaskedTransition[] = [
	{
		linear: [
			[1, 1, 0],
			[0, 1, 0],
			[0, 0, 1],
		],
		bias: [3, 5, 7],
		cubicTerms: [
			{
				inputProjection: [1, 0, 1],
				outputDirection: [1, 2, 0],
				coefficient: 11,
			},
		],
	},
	{
		linear: [
			[1, 0, 0],
			[1, 1, 0],
			[0, 0, 1],
		],
		bias: [13, 17, 19],
		cubicTerms: [
			{
				inputProjection: [0, 1, 1],
				outputDirection: [0, 1, 3],
				coefficient: 23,
			},
		],
	},
];

const normalize = (value: number): number => {
	const reduced = Math.trunc(value) % CSH_FIELD_MODULUS;
	return reduced < 0 ? reduced + CSH_FIELD_MODULUS : reduced;
};

const multiply = (left: number, right: number): number =>
	normalize(normalize(left) * normalize(right));

const applyOwnerTransition = (
	transition: HiddenMaskedTransition,
	input: readonly number[]
): number[] => {
	const output = transition.linear.map((row, rowIndex) =>
		normalize(
			row.reduce(
				(sum, coefficient, index) =>
					sum + multiply(coefficient, input[index]!),
				transition.bias[rowIndex]!
			)
		)
	);
	for (const term of transition.cubicTerms) {
		const projected = normalize(
			term.inputProjection.reduce(
				(sum, coefficient, index) =>
					sum + multiply(coefficient, input[index]!),
				0
			)
		);
		const cubic = multiply(multiply(projected, projected), projected);
		for (let index = 0; index < output.length; index++) {
			output[index] = normalize(
				output[index]! +
					multiply(
						multiply(term.coefficient, cubic),
						term.outputDirection[index]!
					)
			);
		}
	}
	return output;
};

const coordinate = (width: number, index: number) => ({
	id: `test_coordinate_${index}`,
	coefficients: Array.from(
		{ length: width },
		(_, lane) => (lane === index ? 1 : 0)
	),
	bias: 0,
});

const createFixture = () => {
	const covers = [0, 1, 2].map((epoch) =>
		createChartCover({ seed: 4040, epoch, width: 3 })
	);
	const input = [2, 3, 5];
	const charts = encodeIngressCharts(input, covers[0]!, 4041);
	const custodian = new ReferenceMaskedChartCustodian({
		sessionId: "masked_session",
		contractId: "masked_crown",
		covers,
		transitions,
		exitProjection: {
			id: "masked_exit",
			coefficients: [1, 2, 3],
			bias: 29,
		},
		initialLineageCommitment: "masked_genesis",
		lineageSecret: "server-masked-lineage",
		maskSecret: "server-masked-representation",
		sharingSecret: "server-masked-sharing",
		responseSecret: "server-masked-response",
	});
	return { covers, input, charts, custodian };
};

describe("statefully masked chart custody", () => {
	it("keeps intermediate logical states hidden across multiple cover transitions", () => {
		const { covers, input, custodian } = createFixture();
		let charts = encodeIngressCharts(input, covers[0]!, 4041);
		let state = createMaskedCustodyClientState(custodian.clientContract);
		let ownerState = input;
		const observedMaskedStates: number[][] = [];

		for (let epoch = 0; epoch < transitions.length; epoch++) {
			const request = prepareMaskedTransitionRequest(
				custodian.clientContract,
				state,
				charts,
				`masked_nonce_${epoch}`
			);
			const local = transportAffineCharts(
				charts,
				covers[epoch]!,
				covers[epoch + 1]!,
				identity,
				5000 + epoch
			);
			const applied = applyMaskedTransitionResponse(
				custodian.clientContract,
				state,
				local,
				covers[epoch + 1]!,
				custodian.evaluateTransition(request),
				request.nonce
			);
			charts = applied.charts;
			state = applied.state;
			ownerState = applyOwnerTransition(transitions[epoch]!, ownerState);
			const masked = ownerState.map((_, index) =>
				evaluateCertifiedProjection(
					charts,
					covers[epoch + 1]!,
					coordinate(3, index)
				)
			);
			observedMaskedStates.push(masked);
			expect(masked).not.toEqual(ownerState);
		}

		const exitRequest = prepareMaskedProjectionRequest(
			custodian.clientContract,
			state,
			charts,
			"masked_exit_nonce"
		);
		const opened = openMaskedCustodyProjection(
			custodian.clientContract,
			state,
			custodian.evaluateExitProjection(exitRequest),
			exitRequest.nonce
		);
		const expected = normalize(
			ownerState[0]! +
				2 * ownerState[1]! +
				3 * ownerState[2]! +
				29
		);
		expect(opened.projection).toBe(expected);
		expect(observedMaskedStates).toHaveLength(2);
	});

	it("does not expose hidden transitions, representation masks, or secrets", () => {
		const { custodian } = createFixture();
		const serialized = JSON.stringify(custodian.clientContract).toLowerCase();
		for (const forbidden of [
			"transition",
			"linear",
			"cubic",
			"bias",
			"projection",
			"masksecret",
			"representationmask",
			"semanticop",
			"handler",
			"server-masked",
		]) {
			expect(serialized).not.toContain(forbidden);
		}
		expect(custodian.clientContract.coverIds).toHaveLength(3);
	});

	it("binds lineage, rejects forks, and has no unsigned local fallback", () => {
		const { covers, charts, custodian } = createFixture();
		const contract = custodian.clientContract;
		const state = createMaskedCustodyClientState(contract);
		const first = prepareMaskedTransitionRequest(
			contract,
			state,
			charts,
			"masked_fork_0001"
		);
		const second = prepareMaskedTransitionRequest(
			contract,
			state,
			charts,
			"masked_fork_0002"
		);
		const local = transportAffineCharts(
			charts,
			covers[0]!,
			covers[1]!,
			identity,
			6060
		);
		const response = custodian.evaluateTransition(first);
		expect(() => custodian.evaluateTransition(first)).toThrow(
			"RUAM_CSH_CUSTODY_REPLAY"
		);
		expect(() => custodian.evaluateTransition(second)).toThrow(
			"RUAM_CSH_CUSTODY_STALE_LINEAGE"
		);
		expect(() =>
			applyMaskedTransitionResponse(
				contract,
				state,
				local,
				covers[1]!,
				undefined,
				first.nonce
			)
		).toThrow("RUAM_CSH_CUSTODIAN_REQUIRED");
		expect(() =>
			applyMaskedTransitionResponse(
				contract,
				state,
				local,
				covers[1]!,
				response,
				"masked_wrong_nonce"
			)
		).toThrow("RUAM_CSH_CHART_CUSTODY_RESPONSE_MISMATCH");
	});

	it("rejects a substituted locally transported representation", () => {
		const { covers, charts, custodian } = createFixture();
		const contract = custodian.clientContract;
		const state = createMaskedCustodyClientState(contract);
		const first = prepareMaskedTransitionRequest(
			contract,
			state,
			charts,
			"substitution_nonce_0001"
		);
		const local = transportAffineCharts(
			charts,
			covers[0]!,
			covers[1]!,
			identity,
			7070
		);
		const substituted = local.map((chart, chartIndex) =>
			chartIndex === 0
				? Object.freeze({
						...chart,
						cells: Object.freeze(
							chart.cells.map((cell, cellIndex) =>
								cellIndex === 0 ? normalize(cell + 1) : cell
							)
						),
					})
				: chart
		);
		const applied = applyMaskedTransitionResponse(
			contract,
			state,
			substituted,
			covers[1]!,
			custodian.evaluateTransition(first),
			first.nonce
		);
		const second = prepareMaskedTransitionRequest(
			contract,
			applied.state,
			applied.charts,
			"substitution_nonce_0002"
		);
		expect(() => custodian.evaluateTransition(second)).toThrow(
			"RUAM_CSH_MASKED_CUSTODY_STATE_SUBSTITUTION"
		);
	});
});
