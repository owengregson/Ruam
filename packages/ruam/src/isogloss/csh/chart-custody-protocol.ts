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
	/** Commitment to the exact local target representation and target cover. */
	readonly targetRepresentationDigest: string;
}

export interface AdditiveChartContribution {
	readonly chartId: string;
	readonly cells: readonly number[];
}

export interface ChartCustodyResponse {
	readonly sessionId: string;
	readonly contractId: string;
	readonly requestFromCoverId: string;
	readonly requestToCoverId: string;
	readonly requestNonce: string;
	readonly requestLineageCommitment: string;
	readonly requestDigest: string;
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
	localTargetCharts: readonly EncodedChart[],
	targetCover: ChartCover,
	nonce: string
): ChartCustodyRequest {
	if (typeof nonce !== "string" || nonce.length < 8 || nonce.length > 512) {
		throw new Error("RUAM_CSH_CUSTODY_INVALID_NONCE");
	}
	if (
		charts.length === 0 ||
		charts.some((chart) => chart.coverId !== contract.fromCoverId)
	) {
		throw new Error("RUAM_CSH_CHART_CUSTODY_WRONG_SOURCE_COVER");
	}
	const request = Object.freeze({
		sessionId: contract.sessionId,
		contractId: contract.contractId,
		fromCoverId: contract.fromCoverId,
		toCoverId: contract.toCoverId,
		epoch: state.epoch,
		lineageCommitment: state.lineageCommitment,
		nonce,
		charts,
		targetRepresentationDigest: chartCustodyTargetDigest(
			localTargetCharts,
			targetCover
		),
	});
	chartCustodyRequestDigest(request);
	return request;
}

/** Apply one authenticated missing gluing contribution to a local transport. */
export function applyCustodiedChartContribution(
	contract: ChartCustodyClientContract,
	state: CustodyClientState,
	localCharts: readonly EncodedChart[],
	targetCover: ChartCover,
	response: ChartCustodyResponse | undefined,
	request: ChartCustodyRequest
): AppliedChartCustody {
	if (response === undefined) {
		throw new Error("RUAM_CSH_CUSTODIAN_REQUIRED");
	}
	if (
		response.sessionId !== contract.sessionId ||
		response.contractId !== contract.contractId ||
		request.sessionId !== contract.sessionId ||
		request.contractId !== contract.contractId ||
		request.fromCoverId !== contract.fromCoverId ||
		request.toCoverId !== contract.toCoverId ||
		request.epoch !== state.epoch ||
		request.lineageCommitment !== state.lineageCommitment ||
		request.targetRepresentationDigest !==
			chartCustodyTargetDigest(localCharts, targetCover) ||
		response.requestFromCoverId !== contract.fromCoverId ||
		response.requestToCoverId !== contract.toCoverId ||
		response.requestNonce !== request.nonce ||
		response.requestLineageCommitment !==
			state.lineageCommitment ||
		response.requestDigest !== chartCustodyRequestDigest(request) ||
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
	assertChartProtocolString(response.sessionId, "session");
	assertChartProtocolString(response.contractId, "contract");
	assertChartProtocolString(response.requestFromCoverId, "from-cover");
	assertChartProtocolString(response.requestToCoverId, "to-cover");
	assertChartProtocolString(response.requestNonce, "nonce");
	assertChartProtocolString(
		response.requestLineageCommitment,
		"request-lineage"
	);
	assertChartProtocolString(response.requestDigest, "request-digest");
	assertChartProtocolString(
		response.nextLineageCommitment,
		"next-lineage"
	);
	assertChartProtocolInteger(response.epoch, "epoch");
	assertChartProtocolInteger(response.nextEpoch, "next-epoch");
	if (
		!Array.isArray(response.chartContributions) ||
		response.chartContributions.length === 0 ||
		response.chartContributions.length > 256 ||
		response.chartContributions.some(
			(contribution) =>
				typeof contribution.chartId !== "string" ||
				contribution.chartId.length === 0 ||
				contribution.chartId.length > 4_096 ||
				!Array.isArray(contribution.cells) ||
				contribution.cells.length === 0 ||
				contribution.cells.length > 4_096 ||
				contribution.cells.some(
					(cell: number) => !Number.isSafeInteger(cell)
				)
		)
	) {
		throw new Error("RUAM_CSH_CHART_CUSTODY_INVALID_RESPONSE");
	}
	const contributionDigest = createHash("sha256")
		.update(JSON.stringify(response.chartContributions))
		.digest("hex");
	return JSON.stringify([
		"ruam-csh-chart-custody-response-v2",
		response.sessionId,
		response.contractId,
		response.requestFromCoverId,
		response.requestToCoverId,
		response.requestNonce,
		response.requestLineageCommitment,
		response.requestDigest,
		response.epoch,
		response.nextEpoch,
		response.nextLineageCommitment,
		contributionDigest,
	]);
}

/** Digest the complete chart request with a versioned canonical encoding. */
export function chartCustodyRequestDigest(
	request: ChartCustodyRequest
): string {
	assertChartProtocolString(request.sessionId, "session");
	assertChartProtocolString(request.contractId, "contract");
	assertChartProtocolString(request.fromCoverId, "from-cover");
	assertChartProtocolString(request.toCoverId, "to-cover");
	assertChartProtocolString(request.lineageCommitment, "lineage");
	assertChartProtocolString(request.nonce, "nonce");
	assertChartProtocolString(
		request.targetRepresentationDigest,
		"target-representation-digest"
	);
	assertChartProtocolInteger(request.epoch, "epoch");
	if (
		request.charts.length === 0 ||
		request.charts.length > 256 ||
		request.charts.some(
			(chart) =>
				chart.coverId !== request.fromCoverId ||
				typeof chart.chartId !== "string" ||
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
		throw new Error("RUAM_CSH_CHART_CUSTODY_INVALID_REQUEST");
	}
	return createHash("sha256")
		.update(
			JSON.stringify([
				"ruam-csh-chart-custody-request-v2",
				request.sessionId,
				request.contractId,
				request.fromCoverId,
				request.toCoverId,
				request.epoch,
				request.lineageCommitment,
				request.nonce,
				request.targetRepresentationDigest,
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

/** Bind the exact local target representation and its decoding cover. */
export function chartCustodyTargetDigest(
	localCharts: readonly EncodedChart[],
	targetCover: ChartCover
): string {
	if (
		!targetCover ||
		typeof targetCover !== "object" ||
		typeof targetCover.id !== "string" ||
		targetCover.id.length === 0 ||
		targetCover.id.length > 4_096 ||
		!Number.isSafeInteger(targetCover.epoch) ||
		targetCover.epoch < 0 ||
		!Number.isSafeInteger(targetCover.width) ||
		targetCover.width < 2 ||
		targetCover.width > 256 ||
		!Number.isSafeInteger(targetCover.threshold) ||
		targetCover.threshold < 1 ||
		!Array.isArray(targetCover.mixing) ||
		targetCover.mixing.length !== targetCover.width ||
		targetCover.mixing.some(
			(row) =>
				!Array.isArray(row) ||
				row.length !== targetCover.width ||
				row.some((cell) => !Number.isSafeInteger(cell))
		) ||
		!Array.isArray(targetCover.bias) ||
		targetCover.bias.length !== targetCover.width ||
		targetCover.bias.some((cell) => !Number.isSafeInteger(cell)) ||
		!Array.isArray(targetCover.charts) ||
		targetCover.charts.length === 0 ||
		targetCover.charts.length > 256 ||
		targetCover.charts.some(
			(descriptor) =>
				!descriptor || typeof descriptor !== "object"
		) ||
		targetCover.threshold > targetCover.charts.length ||
		!Array.isArray(localCharts) ||
		localCharts.length !== targetCover.charts.length ||
		localCharts.some(
			(chart) =>
				!chart ||
				typeof chart !== "object" ||
				typeof chart.chartId !== "string"
		)
	) {
		throw new Error("RUAM_CSH_CHART_CUSTODY_INVALID_TARGET");
	}
	const localById = new Map(localCharts.map((chart) => [chart.chartId, chart]));
	if (
		localById.size !== targetCover.charts.length ||
		targetCover.charts.some((descriptor) => {
			const local = localById.get(descriptor.id);
			return (
				typeof descriptor.id !== "string" ||
				descriptor.id.length === 0 ||
				descriptor.id.length > 4_096 ||
				typeof descriptor.owner !== "string" ||
				descriptor.owner.length > 4_096 ||
				!Number.isSafeInteger(descriptor.point) ||
				!Array.isArray(descriptor.overlaps) ||
				descriptor.overlaps.length > 256 ||
				descriptor.overlaps.some(
					(overlap: string) =>
						typeof overlap !== "string" ||
						overlap.length > 4_096
				) ||
				!Array.isArray(descriptor.cells) ||
				descriptor.cells.length !== targetCover.width ||
				descriptor.cells.some((cell: ChartCellTransform) =>
					[
						cell.scale,
						cell.offset,
						cell.exponent,
						cell.inverseExponent,
					].some((value) => !Number.isSafeInteger(value))
				) ||
				!local ||
				local.coverId !== targetCover.id ||
				local.epoch !== targetCover.epoch ||
				!Array.isArray(local.cells) ||
				local.cells.length !== targetCover.width ||
				local.cells.some((cell: number) => !Number.isSafeInteger(cell))
			);
		})
	) {
		throw new Error("RUAM_CSH_CHART_CUSTODY_INVALID_TARGET");
	}
	return createHash("sha256")
		.update(
			JSON.stringify([
				"ruam-csh-chart-target-representation-v1",
				targetCover.id,
				targetCover.epoch,
				targetCover.width,
				targetCover.threshold,
				targetCover.mixing,
				targetCover.bias,
				targetCover.charts.map((descriptor) => [
					descriptor.id,
					descriptor.owner,
					descriptor.point,
					descriptor.cells.map((cell: ChartCellTransform) => [
						cell.scale,
						cell.offset,
						cell.exponent,
						cell.inverseExponent,
					]),
					descriptor.overlaps,
				]),
				targetCover.charts.map((descriptor) => {
					const local = localById.get(descriptor.id)!;
					return [
						local.coverId,
						local.epoch,
						local.chartId,
						local.cells,
					];
				}),
			])
		)
		.digest("hex");
}

function assertChartProtocolString(value: unknown, label: string): void {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > 4_096
	) {
		throw new Error(`RUAM_CSH_INVALID_PROTOCOL_STRING: ${label}`);
	}
}

function assertChartProtocolInteger(value: unknown, label: string): void {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < 0
	) {
		throw new Error(`RUAM_CSH_INVALID_PROTOCOL_INTEGER: ${label}`);
	}
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
