import { describe, expect, it } from "bun:test";
import {
	createCustodyClientState,
	openCustodiedProjection,
	prepareCustodyRequest,
} from "../../src/isogloss/csh/custody-protocol.js";
import { ReferenceRelationCustodian } from "../../src/isogloss/csh/reference-custodian.js";
import {
	CSH_FIELD_MODULUS,
	createChartCover,
	encodeIngressCharts,
} from "../../src/isogloss/csh/reference.js";

const createFixture = () => {
	const cover = createChartCover({ seed: 808, epoch: 3, width: 3 });
	const charts = encodeIngressCharts([7, 11, 13], cover, 809);
	const custodian = new ReferenceRelationCustodian({
		sessionId: "session_alpha",
		contractId: "contract_crown",
		cover,
		initialLineageCommitment: "lineage_genesis",
		lineageSecret: "server-only-lineage-secret",
		responseSecret: "server-only-response-secret",
		relation: {
			projectionSite: {
				id: "custodied_input",
				coefficients: [2, 3, 5],
				bias: 19,
			},
			cubic: 37,
			linear: 41,
			bias: 43,
		},
	});
	return { cover, charts, custodian };
};

const relationOutput = (input: number): number => {
	const squared = (input * input) % CSH_FIELD_MODULUS;
	const cubed = (squared * input) % CSH_FIELD_MODULUS;
	return (37 * cubed + 41 * input + 43) % CSH_FIELD_MODULUS;
};

describe("custodied CSH direct-relation reference", () => {
	it("requires a signed custodian response to materialize the projection", () => {
		const { charts, custodian } = createFixture();
		const contract = custodian.clientContract;
		const state = createCustodyClientState(contract);
		const request = prepareCustodyRequest(
			contract,
			state,
			charts,
			"nonce_00000001"
		);

		expect(() =>
			openCustodiedProjection(contract, state, undefined, request.nonce)
		).toThrow("RUAM_CSH_CUSTODIAN_REQUIRED");
		const response = custodian.evaluate(request);
		expect(() =>
			openCustodiedProjection(
				contract,
				state,
				response,
				"nonce_wrong_0001"
			)
		).toThrow("RUAM_CSH_CUSTODY_RESPONSE_MISMATCH");
		const opened = openCustodiedProjection(
			contract,
			state,
			response,
			request.nonce
		);
		const inputProjection =
			2 * 7 + 3 * 11 + 5 * 13 + 19;
		expect(opened.projection).toBe(
			relationOutput(inputProjection % CSH_FIELD_MODULUS)
		);
		expect(opened.state.epoch).toBe(1);
		expect(opened.state.lineageCommitment).toBe(
			response.nextLineageCommitment
		);
	});

	it("prevents replay and snapshot-fork of one representation epoch", () => {
		const { charts, custodian } = createFixture();
		const contract = custodian.clientContract;
		const state = createCustodyClientState(contract);
		const firstFork = prepareCustodyRequest(
			contract,
			state,
			charts,
			"nonce_fork_0001"
		);
		const secondFork = prepareCustodyRequest(
			contract,
			state,
			charts,
			"nonce_fork_0002"
		);
		custodian.evaluate(firstFork);

		expect(() => custodian.evaluate(firstFork)).toThrow(
			"RUAM_CSH_CUSTODY_REPLAY"
		);
		expect(() => custodian.evaluate(secondFork)).toThrow(
			"RUAM_CSH_CUSTODY_STALE_LINEAGE"
		);
	});

	it("rejects response tampering and carries no relation in the client contract", () => {
		const { charts, custodian } = createFixture();
		const contract = custodian.clientContract;
		const state = createCustodyClientState(contract);
		const response = custodian.evaluate(
			prepareCustodyRequest(
				contract,
				state,
				charts,
				"nonce_tamper_01"
			)
		);
		const tampered = {
			...response,
			encodedProjection:
				(response.encodedProjection + 1) % CSH_FIELD_MODULUS,
		};

		expect(() =>
			openCustodiedProjection(
				contract,
				state,
				tampered,
				"nonce_tamper_01"
			)
		).toThrow("RUAM_CSH_CUSTODY_BAD_SIGNATURE");
		const serialized = JSON.stringify(contract).toLowerCase();
		for (const forbidden of [
			"projectionsite",
			"cubic",
			"linear",
			"lineagesecret",
			"semanticop",
			"handler",
			"codelet",
			"nextregion",
		]) {
			expect(serialized).not.toContain(forbidden);
		}
		expect(serialized).not.toContain("server-only-lineage-secret");
		expect(serialized).not.toContain("server-only-response-secret");
	});

	it("advances a valid client and custodian lineage monotonically", () => {
		const { charts, custodian } = createFixture();
		const contract = custodian.clientContract;
		let state = createCustodyClientState(contract);
		const openings = new Set<string>();
		for (let epoch = 0; epoch < 3; epoch++) {
			const request = prepareCustodyRequest(
				contract,
				state,
				charts,
				`nonce_epoch_${epoch}`
			);
			const response = custodian.evaluate(request);
			openings.add(JSON.stringify(response.projectionOpening));
			const opened = openCustodiedProjection(
				contract,
				state,
				response,
				request.nonce
			);
			expect(opened.state.epoch).toBe(epoch + 1);
			state = opened.state;
		}
		expect(openings.size).toBe(3);
	});
});
