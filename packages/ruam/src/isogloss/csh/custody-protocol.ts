/**
 * Client-visible protocol for the experimental CSH direct-custody spike.
 *
 * The protocol deliberately has no local relation implementation or fallback.
 * It can verify and open one lineage-bound, site-specific projection returned
 * by a custodian, but it cannot derive that projection from client artifacts.
 *
 * @module isogloss/csh/custody-protocol
 */

import { verify } from "node:crypto";
import {
	CSH_FIELD_MODULUS,
	type ChartCellTransform,
	type EncodedChart,
} from "./reference.js";

export interface CustodyClientContract {
	readonly sessionId: string;
	readonly contractId: string;
	readonly coverId: string;
	readonly initialLineageCommitment: string;
	readonly verificationKey: string;
}

export interface CustodyClientState {
	readonly epoch: number;
	readonly lineageCommitment: string;
}

export interface CustodyRequest {
	readonly sessionId: string;
	readonly contractId: string;
	readonly coverId: string;
	readonly epoch: number;
	readonly lineageCommitment: string;
	readonly nonce: string;
	readonly charts: readonly EncodedChart[];
}

export interface CustodyResponse {
	readonly sessionId: string;
	readonly contractId: string;
	readonly requestNonce: string;
	readonly epoch: number;
	readonly nextEpoch: number;
	readonly nextLineageCommitment: string;
	readonly encodedProjection: number;
	/** One-response opening for the declared scalar projection only. */
	readonly projectionOpening: ChartCellTransform;
	readonly signature: string;
}

export interface OpenedCustodyProjection {
	readonly projection: number;
	readonly state: CustodyClientState;
}

export function createCustodyClientState(
	contract: CustodyClientContract
): CustodyClientState {
	return Object.freeze({
		epoch: 0,
		lineageCommitment: contract.initialLineageCommitment,
	});
}

export function prepareCustodyRequest(
	contract: CustodyClientContract,
	state: CustodyClientState,
	charts: readonly EncodedChart[],
	nonce: string
): CustodyRequest {
	if (nonce.length < 8) throw new Error("RUAM_CSH_CUSTODY_NONCE_TOO_SHORT");
	if (
		charts.length === 0 ||
		charts.some((chart) => chart.coverId !== contract.coverId)
	) {
		throw new Error("RUAM_CSH_CUSTODY_WRONG_COVER");
	}
	return Object.freeze({
		sessionId: contract.sessionId,
		contractId: contract.contractId,
		coverId: contract.coverId,
		epoch: state.epoch,
		lineageCommitment: state.lineageCommitment,
		nonce,
		charts,
	});
}

/**
 * Verify and materialize exactly one ordinary value at its declared effect
 * boundary. There is intentionally no overload that accepts no response.
 */
export function openCustodiedProjection(
	contract: CustodyClientContract,
	state: CustodyClientState,
	response: CustodyResponse | undefined,
	expectedNonce: string
): OpenedCustodyProjection {
	if (response === undefined) {
		throw new Error("RUAM_CSH_CUSTODIAN_REQUIRED");
	}
	if (
		response.sessionId !== contract.sessionId ||
		response.contractId !== contract.contractId ||
		response.requestNonce !== expectedNonce ||
		response.epoch !== state.epoch ||
		response.nextEpoch !== state.epoch + 1
	) {
		throw new Error("RUAM_CSH_CUSTODY_RESPONSE_MISMATCH");
	}
	const signed = custodyResponseSigningPayload(response);
	if (
		!verify(
			null,
			Buffer.from(signed),
			contract.verificationKey,
			Buffer.from(response.signature, "base64")
		)
	) {
		throw new Error("RUAM_CSH_CUSTODY_BAD_SIGNATURE");
	}
	return Object.freeze({
		projection: unwrapProjection(
			response.encodedProjection,
			response.projectionOpening
		),
		state: Object.freeze({
			epoch: response.nextEpoch,
			lineageCommitment: response.nextLineageCommitment,
		}),
	});
}

export function custodyResponseSigningPayload(
	response: Omit<CustodyResponse, "signature"> | CustodyResponse
): string {
	return [
		response.sessionId,
		response.contractId,
		response.requestNonce,
		response.epoch,
		response.nextEpoch,
		response.nextLineageCommitment,
		response.encodedProjection,
		response.projectionOpening.scale,
		response.projectionOpening.offset,
		response.projectionOpening.exponent,
		response.projectionOpening.inverseExponent,
	].join("|");
}

function unwrapProjection(
	stored: number,
	transform: ChartCellTransform
): number {
	return multiply(
		subtract(
			powerField(stored, transform.inverseExponent),
			transform.offset
		),
		inverseField(transform.scale)
	);
}

function multiply(left: number, right: number): number {
	return normalize(normalize(left) * normalize(right));
}

function subtract(left: number, right: number): number {
	return normalize(normalize(left) - normalize(right));
}

function inverseField(value: number): number {
	const normalized = normalize(value);
	if (normalized === 0) throw new Error("RUAM_CSH_ZERO_HAS_NO_INVERSE");
	return powerField(normalized, CSH_FIELD_MODULUS - 2);
}

function powerField(base: number, exponent: number): number {
	let result = 1;
	let factor = normalize(base);
	let remaining = exponent;
	while (remaining > 0) {
		if (remaining % 2 === 1) result = multiply(result, factor);
		factor = multiply(factor, factor);
		remaining = Math.floor(remaining / 2);
	}
	return result;
}

function normalize(value: number): number {
	const normalized = Math.trunc(value) % CSH_FIELD_MODULUS;
	return normalized < 0 ? normalized + CSH_FIELD_MODULUS : normalized;
}
