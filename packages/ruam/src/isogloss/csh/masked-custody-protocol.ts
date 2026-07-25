/**
 * Client protocol for statefully masked multi-transition CSH custody.
 *
 * The client carries charts for `logicalState + custodianMask`. It can perform
 * an identity cover transport and combine a signed transition contribution,
 * but neither the hidden transition nor the current/next representation mask
 * appears in this contract.
 *
 * @module isogloss/csh/masked-custody-protocol
 */

import {
	applyCustodiedChartContribution,
	prepareChartCustodyRequest,
	type ChartCustodyClientContract,
	type ChartCustodyRequest,
	type ChartCustodyResponse,
} from "./chart-custody-protocol.js";
import {
	openCustodiedProjection,
	type CustodyClientContract,
	type CustodyClientState,
	type CustodyRequest,
	type CustodyResponse,
	type OpenedCustodyProjection,
} from "./custody-protocol.js";
import type { ChartCover, EncodedChart } from "./reference.js";

export interface MaskedCustodyClientContract {
	readonly sessionId: string;
	readonly contractId: string;
	/** Ordered ingress, intermediate, and terminal covers. */
	readonly coverIds: readonly string[];
	readonly initialLineageCommitment: string;
	readonly verificationKey: string;
}

export function createMaskedCustodyClientState(
	contract: MaskedCustodyClientContract
): CustodyClientState {
	if (contract.coverIds.length < 2) {
		throw new Error("RUAM_CSH_MASKED_CUSTODY_COVER_PATH_TOO_SHORT");
	}
	return Object.freeze({
		epoch: 0,
		lineageCommitment: contract.initialLineageCommitment,
	});
}

export function prepareMaskedTransitionRequest(
	contract: MaskedCustodyClientContract,
	state: CustodyClientState,
	charts: readonly EncodedChart[],
	nonce: string
): ChartCustodyRequest {
	const fixed = transitionContract(contract, state.epoch);
	return prepareChartCustodyRequest(fixed, state, charts, nonce);
}

export function applyMaskedTransitionResponse(
	contract: MaskedCustodyClientContract,
	state: CustodyClientState,
	localIdentityTransport: readonly EncodedChart[],
	targetCover: ChartCover,
	response: ChartCustodyResponse | undefined,
	expectedNonce: string
): {
	readonly charts: readonly EncodedChart[];
	readonly state: CustodyClientState;
} {
	const fixed = transitionContract(contract, state.epoch);
	return applyCustodiedChartContribution(
		fixed,
		state,
		localIdentityTransport,
		targetCover,
		response,
		expectedNonce
	);
}

export function prepareMaskedProjectionRequest(
	contract: MaskedCustodyClientContract,
	state: CustodyClientState,
	charts: readonly EncodedChart[],
	nonce: string
): CustodyRequest {
	const terminalEpoch = contract.coverIds.length - 1;
	if (state.epoch !== terminalEpoch) {
		throw new Error(
			`RUAM_CSH_MASKED_CUSTODY_NOT_AT_EXIT: ${state.epoch}/${terminalEpoch}`
		);
	}
	if (
		nonce.length < 8 ||
		charts.length === 0 ||
		charts.some(
			(chart) => chart.coverId !== contract.coverIds[terminalEpoch]
		)
	) {
		throw new Error("RUAM_CSH_MASKED_CUSTODY_INVALID_EXIT_REQUEST");
	}
	return Object.freeze({
		sessionId: contract.sessionId,
		contractId: contract.contractId,
		coverId: contract.coverIds[terminalEpoch]!,
		epoch: state.epoch,
		lineageCommitment: state.lineageCommitment,
		nonce,
		charts,
	});
}

export function openMaskedCustodyProjection(
	contract: MaskedCustodyClientContract,
	state: CustodyClientState,
	response: CustodyResponse | undefined,
	expectedNonce: string
): OpenedCustodyProjection {
	const terminalEpoch = contract.coverIds.length - 1;
	const fixed: CustodyClientContract = Object.freeze({
		sessionId: contract.sessionId,
		contractId: contract.contractId,
		coverId: contract.coverIds[terminalEpoch]!,
		initialLineageCommitment: contract.initialLineageCommitment,
		verificationKey: contract.verificationKey,
	});
	return openCustodiedProjection(
		fixed,
		state,
		response,
		expectedNonce
	);
}

function transitionContract(
	contract: MaskedCustodyClientContract,
	epoch: number
): ChartCustodyClientContract {
	const fromCoverId = contract.coverIds[epoch];
	const toCoverId = contract.coverIds[epoch + 1];
	if (fromCoverId === undefined || toCoverId === undefined) {
		throw new Error(
			`RUAM_CSH_MASKED_CUSTODY_NO_TRANSITION: ${epoch}`
		);
	}
	return Object.freeze({
		sessionId: contract.sessionId,
		contractId: contract.contractId,
		fromCoverId,
		toCoverId,
		initialLineageCommitment: contract.initialLineageCommitment,
		verificationKey: contract.verificationKey,
	});
}
