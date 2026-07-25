/**
 * Client-visible protocol for the experimental CSH direct-custody spike.
 *
 * The protocol deliberately has no local relation implementation or fallback.
 * It can verify and open one lineage-bound, site-specific projection returned
 * by a custodian, but it cannot derive that projection from client artifacts.
 *
 * @module isogloss/csh/custody-protocol
 */

import { createHash, verify } from "node:crypto";
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
	readonly requestCoverId: string;
	readonly requestNonce: string;
	readonly requestLineageCommitment: string;
	readonly requestDigest: string;
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
	if (typeof nonce !== "string" || nonce.length < 8 || nonce.length > 512) {
		throw new Error("RUAM_CSH_CUSTODY_INVALID_NONCE");
	}
	if (
		charts.length === 0 ||
		charts.some((chart) => chart.coverId !== contract.coverId)
	) {
		throw new Error("RUAM_CSH_CUSTODY_WRONG_COVER");
	}
	const request = Object.freeze({
		sessionId: contract.sessionId,
		contractId: contract.contractId,
		coverId: contract.coverId,
		epoch: state.epoch,
		lineageCommitment: state.lineageCommitment,
		nonce,
		charts,
	});
	custodyRequestDigest(request);
	return request;
}

/**
 * Verify and materialize exactly one ordinary value at its declared effect
 * boundary. There is intentionally no overload that accepts no response.
 */
export function openCustodiedProjection(
	contract: CustodyClientContract,
	state: CustodyClientState,
	response: CustodyResponse | undefined,
	request: CustodyRequest
): OpenedCustodyProjection {
	if (response === undefined) {
		throw new Error("RUAM_CSH_CUSTODIAN_REQUIRED");
	}
	if (
		response.sessionId !== contract.sessionId ||
		response.contractId !== contract.contractId ||
		request.sessionId !== contract.sessionId ||
		request.contractId !== contract.contractId ||
		request.coverId !== contract.coverId ||
		request.epoch !== state.epoch ||
		request.lineageCommitment !== state.lineageCommitment ||
		response.requestCoverId !== contract.coverId ||
		response.requestNonce !== request.nonce ||
		response.requestLineageCommitment !==
			state.lineageCommitment ||
		response.requestDigest !== custodyRequestDigest(request) ||
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
	assertProtocolString(response.sessionId, "session");
	assertProtocolString(response.contractId, "contract");
	assertProtocolString(response.requestCoverId, "cover");
	assertProtocolString(response.requestNonce, "nonce");
	assertProtocolString(
		response.requestLineageCommitment,
		"request-lineage"
	);
	assertProtocolString(response.requestDigest, "request-digest");
	assertProtocolString(
		response.nextLineageCommitment,
		"next-lineage"
	);
	for (const [label, value] of [
		["epoch", response.epoch],
		["next-epoch", response.nextEpoch],
		["encoded-projection", response.encodedProjection],
		["opening-scale", response.projectionOpening.scale],
		["opening-offset", response.projectionOpening.offset],
		["opening-exponent", response.projectionOpening.exponent],
		[
			"opening-inverse-exponent",
			response.projectionOpening.inverseExponent,
		],
	] as const) {
		assertProtocolInteger(value, label);
	}
	return JSON.stringify([
		"ruam-csh-custody-response-v2",
		response.sessionId,
		response.contractId,
		response.requestCoverId,
		response.requestNonce,
		response.requestLineageCommitment,
		response.requestDigest,
		response.epoch,
		response.nextEpoch,
		response.nextLineageCommitment,
		response.encodedProjection,
		response.projectionOpening.scale,
		response.projectionOpening.offset,
		response.projectionOpening.exponent,
		[
			response.projectionOpening.scale,
			response.projectionOpening.offset,
			response.projectionOpening.exponent,
			response.projectionOpening.inverseExponent,
		],
	]);
}

/** Digest the complete request with a versioned, unambiguous encoding. */
export function custodyRequestDigest(request: CustodyRequest): string {
	assertProtocolString(request.sessionId, "session");
	assertProtocolString(request.contractId, "contract");
	assertProtocolString(request.coverId, "cover");
	assertProtocolString(request.lineageCommitment, "lineage");
	assertProtocolString(request.nonce, "nonce");
	assertProtocolInteger(request.epoch, "epoch");
	if (
		request.charts.length === 0 ||
		request.charts.length > 256 ||
		request.charts.some(
			(chart) =>
				chart.coverId !== request.coverId ||
				(typeof chart.chartId !== "string") ||
				chart.chartId.length === 0 ||
				chart.chartId.length > 4_096 ||
				!Number.isSafeInteger(chart.epoch) ||
				chart.epoch < 0 ||
				!Array.isArray(chart.cells) ||
				chart.cells.length === 0 ||
				chart.cells.length > 4_096 ||
				chart.cells.some(
					(cell) => !Number.isSafeInteger(cell)
				)
		)
	) {
		throw new Error("RUAM_CSH_CUSTODY_INVALID_REQUEST");
	}
	return createHash("sha256")
		.update(
			JSON.stringify([
				"ruam-csh-custody-request-v2",
				request.sessionId,
				request.contractId,
				request.coverId,
				request.epoch,
				request.lineageCommitment,
				request.nonce,
				request.charts.map((chart) => [
					chart.coverId,
					chart.epoch,
					chart.chartId,
					chart.cells,
				]),
			])
		)
		.digest("hex");
}

function assertProtocolString(value: unknown, label: string): void {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > 4_096
	) {
		throw new Error(`RUAM_CSH_INVALID_PROTOCOL_STRING: ${label}`);
	}
}

function assertProtocolInteger(value: unknown, label: string): void {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < 0
	) {
		throw new Error(`RUAM_CSH_INVALID_PROTOCOL_INTEGER: ${label}`);
	}
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
