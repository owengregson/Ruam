import { describe, expect, it } from "bun:test";
import {
	applyCustodiedChartContribution,
	createChartCustodyClientState,
	prepareChartCustodyRequest,
} from "../../src/isogloss/csh/chart-custody-protocol.js";
import { ReferenceChartRelationCustodian } from "../../src/isogloss/csh/reference-chart-custodian.js";
import {
	CSH_FIELD_MODULUS,
	createChartCover,
	encodeIngressCharts,
	evaluateCertifiedProjection,
	transportAffineCharts,
} from "../../src/isogloss/csh/reference.js";

const identityTransition = {
	id: "local_identity",
	matrix: [
		[1, 0, 0],
		[0, 1, 0],
		[0, 0, 1],
	],
	bias: [0, 0, 0],
};

const coordinate = (index: number) => ({
	id: `coordinate_${index}`,
	coefficients: [0, 1, 2].map((lane) => (lane === index ? 1 : 0)),
	bias: 0,
});

const fixture = () => {
	const from = createChartCover({ seed: 2027, epoch: 0, width: 3 });
	const to = createChartCover({ seed: 2027, epoch: 1, width: 3 });
	const values = [7, 11, 13];
	const incoming = encodeIngressCharts(values, from, 3030);
	const local = transportAffineCharts(
		incoming,
		from,
		to,
		identityTransition,
		3031
	);
	const custodian = new ReferenceChartRelationCustodian({
		sessionId: "chart_session",
		contractId: "hidden_glue",
		fromCover: from,
		toCover: to,
		initialLineageCommitment: "chart_genesis",
		lineageSecret: "server-chart-lineage",
		sharingSecret: "server-chart-sharing",
		relation: {
			inputProjection: {
				id: "hidden_input",
				coefficients: [2, 1, 3],
				bias: 5,
			},
			cubic: 7,
			linear: 11,
			bias: 17,
			outputDirection: [1, 2, 0],
		},
	});
	return { from, to, values, incoming, local, custodian };
};

const expectedResidual = (values: readonly number[]): number => {
	const input =
		(2 * values[0]! + values[1]! + 3 * values[2]! + 5) %
		CSH_FIELD_MODULUS;
	return (
		7 * (((input * input) % CSH_FIELD_MODULUS) * input) +
		11 * input +
		17
	) % CSH_FIELD_MODULUS;
};

describe("custodied chart relation", () => {
	it("makes a hidden nonlinear contribution necessary inside a cover transition", () => {
		const { to, values, incoming, local, custodian } = fixture();
		const contract = custodian.clientContract;
		const state = createChartCustodyClientState(contract);
		const request = prepareChartCustodyRequest(
			contract,
			state,
			incoming,
			"chart_nonce_0001"
		);
		expect(() =>
			applyCustodiedChartContribution(
				contract,
				state,
				local,
				to,
				undefined,
				request.nonce
			)
		).toThrow("RUAM_CSH_CUSTODIAN_REQUIRED");

		const response = custodian.evaluate(request);
		expect(() =>
			applyCustodiedChartContribution(
				contract,
				state,
				local,
				to,
				response,
				"chart_nonce_wrong"
			)
		).toThrow("RUAM_CSH_CHART_CUSTODY_RESPONSE_MISMATCH");
		const applied = applyCustodiedChartContribution(
			contract,
			state,
			local,
			to,
			response,
			request.nonce
		);
		const residual = expectedResidual(values);
		const expected = [
			(values[0]! + residual) % CSH_FIELD_MODULUS,
			(values[1]! + 2 * residual) % CSH_FIELD_MODULUS,
			values[2],
		];
		for (let index = 0; index < expected.length; index++) {
			expect(
				evaluateCertifiedProjection(
					applied.charts,
					to,
					coordinate(index)
				)
			).toBe(expected[index]);
		}
		expect(
			evaluateCertifiedProjection(local, to, coordinate(0))
		).toBe(values[0]);
		expect(applied.state.epoch).toBe(1);
	});

	it("keeps the relation and output direction out of the client contract and response", () => {
		const { incoming, custodian } = fixture();
		const contract = custodian.clientContract;
		const state = createChartCustodyClientState(contract);
		const response = custodian.evaluate(
			prepareChartCustodyRequest(
				contract,
				state,
				incoming,
				"chart_nonce_0002"
			)
		);
		const serialized = JSON.stringify({ contract, response }).toLowerCase();
		for (const forbidden of [
			"inputprojection",
			"outputdirection",
			"cubic",
			"linear",
			"semanticop",
			"handler",
			"codelet",
			"nextregion",
			"server-chart-lineage",
			"server-chart-sharing",
		]) {
			expect(serialized).not.toContain(forbidden);
		}
		expect(response.chartContributions).toHaveLength(5);
		expect(
			response.chartContributions.every(
				(contribution) => contribution.cells.length === 3
			)
		).toBe(true);
	});

	it("rejects replay, snapshot forks, incomplete contributions, and tampering", () => {
		const { to, incoming, local, custodian } = fixture();
		const contract = custodian.clientContract;
		const state = createChartCustodyClientState(contract);
		const first = prepareChartCustodyRequest(
			contract,
			state,
			incoming,
			"chart_fork_00001"
		);
		const second = prepareChartCustodyRequest(
			contract,
			state,
			incoming,
			"chart_fork_00002"
		);
		const response = custodian.evaluate(first);
		expect(() => custodian.evaluate(first)).toThrow(
			"RUAM_CSH_CUSTODY_REPLAY"
		);
		expect(() => custodian.evaluate(second)).toThrow(
			"RUAM_CSH_CUSTODY_STALE_LINEAGE"
		);

		const incomplete = {
			...response,
			chartContributions: response.chartContributions.slice(1),
		};
		expect(() =>
			applyCustodiedChartContribution(
				contract,
				state,
				local,
				to,
				incomplete,
				first.nonce
			)
		).toThrow("RUAM_CSH_CUSTODY_BAD_SIGNATURE");
		const tampered = structuredClone(response);
		(
			tampered.chartContributions[0]!.cells as number[]
		)[0] = (tampered.chartContributions[0]!.cells[0]! + 1) %
			CSH_FIELD_MODULUS;
		expect(() =>
			applyCustodiedChartContribution(
				contract,
				state,
				local,
				to,
				tampered,
				first.nonce
			)
		).toThrow("RUAM_CSH_CUSTODY_BAD_SIGNATURE");
	});
});
