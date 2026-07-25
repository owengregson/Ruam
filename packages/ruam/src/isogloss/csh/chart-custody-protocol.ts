/**
 * Client protocol for a custodied contribution inside a CSH cover transition.
 *
 * The client can combine a signed set of chart-local additive contributions
 * into an already transported local cover. It has no implementation of the
 * missing relation and no fallback when a response is absent.
 *
 * @module isogloss/csh/chart-custody-protocol
 */

import { createHash, verify } from "node:crypto";
import {
	CSH_FIELD_MODULUS,
	type ChartCellTransform,
	type ChartCover,
	type EncodedChart,
} from "./reference.js";
import type { CustodyClientState } from "./custody-protocol.js";

export interface ChartCustodyClientContract {
	readonly sessionId: string;
	readonly contractId: string;
	readonly fromCoverId: string;
	readonly toCoverId: string;
	readonly initialLineageCommitment: string;
	readonly verificationKey: string;
}

export interface ChartCustodyRequest {
	readonly sessionId: string;
	readonly contractId: string;
	readonly fromCoverId: string;
	readonly toCoverId: string;
	readonly epoch: number;
	readonly lineageCommitment: string;
	readonly nonce: string;
	readonly charts: readonly EncodedChart[];
}

export interface AdditiveChartContribution {
	readonly chartId: string;
	readonly cells: readonly number[];
}

export interface ChartCustodyResponse {
	readonly sessionId: string;
	readonly contractId: string;
	readonly requestNonce: string;
	readonly epoch: number;
	readonly nextEpoch: number;
	readonly nextLineageCommitment: string;
	readonly chartContributions: readonly AdditiveChartContribution[];
	readonly signature: string;
}

export interface AppliedChartCustody {
	readonly charts: readonly EncodedChart[];
	readonly state: CustodyClientState;
}

export function createChartCustodyClientState(
	contract: ChartCustodyClientContract
): CustodyClientState {
	return Object.freeze({
		epoch: 0,
		lineageCommitment: contract.initialLineageCommitment,
	});
}

export function prepareChartCustodyRequest(
	contract: ChartCustodyClientContract,
	state: CustodyClientState,
	charts: readonly EncodedChart[],
	nonce: string
): ChartCustodyRequest {
	if (nonce.length < 8) throw new Error("RUAM_CSH_CUSTODY_NONCE_TOO_SHORT");
	if (
		charts.length === 0 ||
		charts.some((chart) => chart.coverId !== contract.fromCoverId)
	) {
		throw new Error("RUAM_CSH_CHART_CUSTODY_WRONG_SOURCE_COVER");
	}
	return Object.freeze({
		sessionId: contract.sessionId,
		contractId: contract.contractId,
		fromCoverId: contract.fromCoverId,
		toCoverId: contract.toCoverId,
		epoch: state.epoch,
		lineageCommitment: state.lineageCommitment,
		nonce,
		charts,
	});
}

/** Apply one authenticated missing gluing contribution to a local transport. */
export function applyCustodiedChartContribution(
	contract: ChartCustodyClientContract,
	state: CustodyClientState,
	localCharts: readonly EncodedChart[],
	targetCover: ChartCover,
	response: ChartCustodyResponse | undefined,
	expectedNonce: string
): AppliedChartCustody {
	if (response === undefined) {
		throw new Error("RUAM_CSH_CUSTODIAN_REQUIRED");
	}
	if (
		response.sessionId !== contract.sessionId ||
		response.contractId !== contract.contractId ||
		response.requestNonce !== expectedNonce ||
		response.epoch !== state.epoch ||
		response.nextEpoch !== state.epoch + 1 ||
		targetCover.id !== contract.toCoverId
	) {
		throw new Error("RUAM_CSH_CHART_CUSTODY_RESPONSE_MISMATCH");
	}
	if (
		!verify(
			null,
			Buffer.from(chartCustodySigningPayload(response)),
			contract.verificationKey,
			Buffer.from(response.signature, "base64")
		)
	) {
		throw new Error("RUAM_CSH_CUSTODY_BAD_SIGNATURE");
	}
	const localById = new Map(localCharts.map((chart) => [chart.chartId, chart]));
	const contributionById = new Map(
		response.chartContributions.map((contribution) => [
			contribution.chartId,
			contribution,
		])
	);
	if (
		localById.size !== targetCover.charts.length ||
		contributionById.size !== targetCover.charts.length
	) {
		throw new Error("RUAM_CSH_CHART_CUSTODY_INCOMPLETE_CONTRIBUTION");
	}
	const combined = targetCover.charts.map((descriptor): EncodedChart => {
		const local = localById.get(descriptor.id);
		const contribution = contributionById.get(descriptor.id);
		if (
			!local ||
			!contribution ||
			local.coverId !== targetCover.id ||
			local.epoch !== targetCover.epoch ||
			local.cells.length !== targetCover.width ||
			contribution.cells.length !== targetCover.width
		) {
			throw new Error(
				`RUAM_CSH_CHART_CUSTODY_INVALID_CONTRIBUTION: ${descriptor.id}`
			);
		}
		const cells = local.cells.map((stored, lane) => {
			const raw = unwrapCell(stored, descriptor.cells[lane]!);
			return wrapCell(
				add(raw, contribution.cells[lane]!),
				descriptor.cells[lane]!
			);
		});
		return Object.freeze({
			coverId: targetCover.id,
			epoch: targetCover.epoch,
			chartId: descriptor.id,
			cells: Object.freeze(cells),
		});
	});
	return Object.freeze({
		charts: Object.freeze(combined),
		state: Object.freeze({
			epoch: response.nextEpoch,
			lineageCommitment: response.nextLineageCommitment,
		}),
	});
}

export function chartCustodySigningPayload(
	response:
		| Omit<ChartCustodyResponse, "signature">
		| ChartCustodyResponse
): string {
	const contributionDigest = createHash("sha256")
		.update(JSON.stringify(response.chartContributions))
		.digest("hex");
	return [
		response.sessionId,
		response.contractId,
		response.requestNonce,
		response.epoch,
		response.nextEpoch,
		response.nextLineageCommitment,
		contributionDigest,
	].join("|");
}

function wrapCell(raw: number, transform: ChartCellTransform): number {
	return power(
		add(multiply(transform.scale, raw), transform.offset),
		transform.exponent
	);
}

function unwrapCell(
	stored: number,
	transform: ChartCellTransform
): number {
	return multiply(
		subtract(power(stored, transform.inverseExponent), transform.offset),
		inverse(transform.scale)
	);
}

function inverse(value: number): number {
	const normalized = normalize(value);
	if (normalized === 0) throw new Error("RUAM_CSH_ZERO_HAS_NO_INVERSE");
	return power(normalized, CSH_FIELD_MODULUS - 2);
}

function power(base: number, exponent: number): number {
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

function add(left: number, right: number): number {
	return normalize(normalize(left) + normalize(right));
}

function subtract(left: number, right: number): number {
	return normalize(normalize(left) - normalize(right));
}

function multiply(left: number, right: number): number {
	return normalize(normalize(left) * normalize(right));
}

function normalize(value: number): number {
	const normalized = Math.trunc(value) % CSH_FIELD_MODULUS;
	return normalized < 0 ? normalized + CSH_FIELD_MODULUS : normalized;
}
