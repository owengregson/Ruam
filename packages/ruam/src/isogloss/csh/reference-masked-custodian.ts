/**
 * Server-side statefully masked CSH relation sequence.
 *
 * Client charts encode `x + mask(epoch)`. A transition response changes an
 * identity-transported masked state into `F_epoch(x) + mask(epoch+1)` without
 * returning either the logical state, the transition, or either mask.
 *
 * @module isogloss/csh/reference-masked-custodian
 */

import {
	createHmac,
	generateKeyPairSync,
	sign,
} from "node:crypto";
import {
	chartCustodySigningPayload,
	chartCustodyRequestDigest,
	type AdditiveChartContribution,
	type ChartCustodyRequest,
	type ChartCustodyResponse,
} from "./chart-custody-protocol.js";
import {
	custodyResponseSigningPayload,
	custodyRequestDigest,
	type CustodyRequest,
	type CustodyResponse,
} from "./custody-protocol.js";
import type { MaskedCustodyClientContract } from "./masked-custody-protocol.js";
import {
	CSH_FIELD_MODULUS,
	evaluateCertifiedProjection,
	type ChartCellTransform,
	type ChartCover,
	type CertifiedProjectionSite,
} from "./reference.js";

export interface HiddenCubicTerm {
	readonly inputProjection: readonly number[];
	readonly outputDirection: readonly number[];
	readonly coefficient: number;
}

export interface HiddenMaskedTransition {
	readonly linear: readonly (readonly number[])[];
	readonly bias: readonly number[];
	readonly cubicTerms: readonly HiddenCubicTerm[];
}

export interface ReferenceMaskedCustodianOptions {
	readonly sessionId: string;
	readonly contractId: string;
	readonly covers: readonly ChartCover[];
	readonly transitions: readonly HiddenMaskedTransition[];
	readonly exitProjection: CertifiedProjectionSite;
	readonly initialLineageCommitment: string;
	readonly lineageSecret: string;
	readonly maskSecret: string;
	readonly sharingSecret: string;
	readonly responseSecret: string;
}

export class ReferenceMaskedChartCustodian {
	readonly clientContract: MaskedCustodyClientContract;

	readonly #covers: readonly ChartCover[];
	readonly #transitions: readonly HiddenMaskedTransition[];
	readonly #exitProjection: CertifiedProjectionSite;
	readonly #lineageSecret: string;
	readonly #maskSecret: string;
	readonly #sharingSecret: string;
	readonly #responseSecret: string;
	readonly #protocolBinding: string;
	readonly #privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
	readonly #consumedNonces = new Set<string>();
	#epoch = 0;
	#lineageCommitment: string;
	#mask: number[];
	#expectedMaskedState: readonly number[] | undefined;
	#terminated = false;

	constructor(options: ReferenceMaskedCustodianOptions) {
		validateOptions(options);
		const { privateKey, publicKey } = generateKeyPairSync("ed25519");
		this.#privateKey = privateKey;
		this.#covers = options.covers;
		this.#transitions = options.transitions;
		this.#exitProjection = options.exitProjection;
		this.#lineageSecret = options.lineageSecret;
		this.#maskSecret = options.maskSecret;
		this.#sharingSecret = options.sharingSecret;
		this.#responseSecret = options.responseSecret;
		this.#protocolBinding = JSON.stringify([
			options.sessionId,
			options.contractId,
		]);
		this.#lineageCommitment = options.initialLineageCommitment;
		this.#mask = Array.from(
			{ length: options.covers[0]!.width },
			() => 0
		);
		this.clientContract = Object.freeze({
			sessionId: options.sessionId,
			contractId: options.contractId,
			coverIds: Object.freeze(options.covers.map((cover) => cover.id)),
			initialLineageCommitment: options.initialLineageCommitment,
			verificationKey: publicKey
				.export({ type: "spki", format: "pem" })
				.toString(),
		});
	}

	evaluateTransition(request: ChartCustodyRequest): ChartCustodyResponse {
		chartCustodyRequestDigest(request);
		this.#assertLiveRequest(request);
		const transition = this.#transitions[this.#epoch];
		const from = this.#covers[this.#epoch];
		const to = this.#covers[this.#epoch + 1];
		if (!transition || !from || !to) {
			throw new Error("RUAM_CSH_MASKED_CUSTODY_NO_TRANSITION");
		}
		if (
			request.fromCoverId !== from.id ||
			request.toCoverId !== to.id
		) {
			throw new Error("RUAM_CSH_CUSTODY_REQUEST_MISMATCH");
		}
		const masked = recoverVector(request.charts, from);
		this.#assertExpectedMaskedState(masked);
		const logical = masked.map((value, index) =>
			subtract(value, this.#mask[index]!)
		);
		const nextLogical = evaluateHiddenTransition(transition, logical);
		const nextMask = deriveVector(
			this.#maskSecret,
			this.#protocolBinding,
			this.#epoch,
			request.nonce,
			from.width
		);
		const nextMasked = nextLogical.map((value, index) =>
			add(value, nextMask[index]!)
		);
		const delta = nextMasked.map((value, index) =>
			subtract(value, masked[index]!)
		);
		const mixedDelta = multiplyMatrixVector(to.mixing, delta);
		const chartContributions = createAdditiveShares(
			mixedDelta,
			to,
			this.#sharingSecret,
			this.#protocolBinding,
			this.#epoch,
			request.nonce
		);
		const nextEpoch = this.#epoch + 1;
		const nextLineageCommitment = nextLineage(
			this.#lineageSecret,
			this.#protocolBinding,
			this.#lineageCommitment,
			request.nonce,
			chartContributions
		);
		const unsigned = {
			sessionId: request.sessionId,
			contractId: request.contractId,
			requestFromCoverId: request.fromCoverId,
			requestToCoverId: request.toCoverId,
			requestNonce: request.nonce,
			requestLineageCommitment: request.lineageCommitment,
			requestDigest: chartCustodyRequestDigest(request),
			epoch: this.#epoch,
			nextEpoch,
			nextLineageCommitment,
			chartContributions,
		};
		const signature = sign(
			null,
			Buffer.from(chartCustodySigningPayload(unsigned)),
			this.#privateKey
		).toString("base64");
		this.#consumedNonces.add(request.nonce);
		this.#epoch = nextEpoch;
		this.#lineageCommitment = nextLineageCommitment;
		this.#mask = nextMask;
		this.#expectedMaskedState = Object.freeze(nextMasked);
		return Object.freeze({ ...unsigned, signature });
	}

	evaluateExitProjection(request: CustodyRequest): CustodyResponse {
		custodyRequestDigest(request);
		this.#assertLiveRequest(request);
		if (this.#epoch !== this.#transitions.length) {
			throw new Error("RUAM_CSH_MASKED_CUSTODY_NOT_AT_EXIT");
		}
		const terminalCover = this.#covers[this.#epoch]!;
		if (request.coverId !== terminalCover.id) {
			throw new Error("RUAM_CSH_CUSTODY_REQUEST_MISMATCH");
		}
		const masked = recoverVector(request.charts, terminalCover);
		this.#assertExpectedMaskedState(masked);
		const logical = masked.map((value, index) =>
			subtract(value, this.#mask[index]!)
		);
		const projected = add(
			dot(this.#exitProjection.coefficients, logical),
			this.#exitProjection.bias
		);
		const projectionOpening = deriveResponseTransform(
			this.#responseSecret,
			this.#protocolBinding,
			this.#epoch,
			request.nonce
		);
		const encodedProjection = wrapProjection(
			projected,
			projectionOpening
		);
		const nextEpoch = this.#epoch + 1;
		const nextLineageCommitment = nextLineage(
			this.#lineageSecret,
			this.#protocolBinding,
			this.#lineageCommitment,
			request.nonce,
			encodedProjection
		);
		const unsigned = {
			sessionId: request.sessionId,
			contractId: request.contractId,
			requestCoverId: request.coverId,
			requestNonce: request.nonce,
			requestLineageCommitment: request.lineageCommitment,
			requestDigest: custodyRequestDigest(request),
			epoch: this.#epoch,
			nextEpoch,
			nextLineageCommitment,
			encodedProjection,
			projectionOpening,
		};
		const signature = sign(
			null,
			Buffer.from(custodyResponseSigningPayload(unsigned)),
			this.#privateKey
		).toString("base64");
		this.#consumedNonces.add(request.nonce);
		this.#epoch = nextEpoch;
		this.#lineageCommitment = nextLineageCommitment;
		this.#terminated = true;
		return Object.freeze({ ...unsigned, signature });
	}

	#assertLiveRequest(
		request: ChartCustodyRequest | CustodyRequest
	): void {
		if (this.#terminated) {
			throw new Error("RUAM_CSH_MASKED_CUSTODY_TERMINATED");
		}
		if (
			request.sessionId !== this.clientContract.sessionId ||
			request.contractId !== this.clientContract.contractId
		) {
			throw new Error("RUAM_CSH_CUSTODY_REQUEST_MISMATCH");
		}
		if (this.#consumedNonces.has(request.nonce)) {
			throw new Error("RUAM_CSH_CUSTODY_REPLAY");
		}
		if (
			request.epoch !== this.#epoch ||
			request.lineageCommitment !== this.#lineageCommitment
		) {
			throw new Error("RUAM_CSH_CUSTODY_STALE_LINEAGE");
		}
	}

	#assertExpectedMaskedState(masked: readonly number[]): void {
		if (
			this.#expectedMaskedState !== undefined &&
			(masked.length !== this.#expectedMaskedState.length ||
				masked.some(
					(value, index) =>
						value !== this.#expectedMaskedState![index]
				))
		) {
			throw new Error("RUAM_CSH_MASKED_CUSTODY_STATE_SUBSTITUTION");
		}
	}
}

function validateOptions(options: ReferenceMaskedCustodianOptions): void {
	if (
		options.covers.length < 2 ||
		options.transitions.length !== options.covers.length - 1
	) {
		throw new Error("RUAM_CSH_MASKED_CUSTODY_PATH_MISMATCH");
	}
	const width = options.covers[0]!.width;
	if (
		options.covers.some((cover) => cover.width !== width) ||
		new Set(options.covers.map((cover) => cover.id)).size !==
			options.covers.length ||
		options.exitProjection.coefficients.length !== width
	) {
		throw new Error("RUAM_CSH_MASKED_CUSTODY_WIDTH_MISMATCH");
	}
	for (const transition of options.transitions) {
		if (
			transition.linear.length !== width ||
			transition.linear.some((row) => row.length !== width) ||
			transition.bias.length !== width
		) {
			throw new Error("RUAM_CSH_MASKED_CUSTODY_WIDTH_MISMATCH");
		}
		for (const term of transition.cubicTerms) {
			if (
				term.inputProjection.length !== width ||
				term.outputDirection.length !== width
			) {
				throw new Error("RUAM_CSH_MASKED_CUSTODY_WIDTH_MISMATCH");
			}
		}
	}
}

function evaluateHiddenTransition(
	transition: HiddenMaskedTransition,
	logical: readonly number[]
): number[] {
	const output = multiplyMatrixVector(transition.linear, logical).map(
		(value, index) => add(value, transition.bias[index]!)
	);
	for (const term of transition.cubicTerms) {
		const projected = dot(term.inputProjection, logical);
		const cubic = multiply(
			multiply(projected, projected),
			projected
		);
		for (let index = 0; index < output.length; index++) {
			output[index] = add(
				output[index]!,
				multiply(
					multiply(term.coefficient, cubic),
					term.outputDirection[index]!
				)
			);
		}
	}
	return output;
}

function recoverVector(
	charts: CustodyRequest["charts"],
	cover: ChartCover
): number[] {
	return Array.from({ length: cover.width }, (_, coordinate) =>
		evaluateCertifiedProjection(charts, cover, {
			id: `server_projection_${coordinate}`,
			coefficients: Array.from(
				{ length: cover.width },
				(_, index) => (index === coordinate ? 1 : 0)
			),
			bias: 0,
		})
	);
}

function createAdditiveShares(
	constant: readonly number[],
	cover: ChartCover,
	secret: string,
	protocolBinding: string,
	epoch: number,
	nonce: string
): readonly AdditiveChartContribution[] {
	const residuals = Array.from({ length: cover.width }, (_, lane) =>
		Array.from({ length: cover.threshold - 1 }, (_, coefficient) =>
			deriveFieldElement(
				secret,
				"chart-share",
				protocolBinding,
				epoch,
				nonce,
				lane,
				coefficient
			)
		)
	);
	return Object.freeze(
		cover.charts.map((chart) => {
			const cells = constant.map((value, lane) => {
				let shared = normalize(value);
				let pointPower = chart.point;
				for (const residual of residuals[lane]!) {
					shared = add(shared, multiply(residual, pointPower));
					pointPower = multiply(pointPower, chart.point);
				}
				return shared;
			});
			return Object.freeze({
				chartId: chart.id,
				cells: Object.freeze(cells),
			});
		})
	);
}

function deriveVector(
	secret: string,
	protocolBinding: string,
	epoch: number,
	nonce: string,
	width: number
): number[] {
	return Array.from(
		{ length: width },
		(_, lane) =>
			deriveFieldElement(
				secret,
				"representation-mask",
				protocolBinding,
				epoch,
				nonce,
				lane,
				0
			)
	);
}

function deriveFieldElement(
	secret: string,
	domain: string,
	protocolBinding: string,
	epoch: number,
	nonce: string,
	lane: number,
	coefficient: number
): number {
	return createHmac("sha256", secret)
		.update(domain)
		.update("|")
		.update(protocolBinding)
		.update("|")
		.update(String(epoch))
		.update("|")
		.update(nonce)
		.update("|")
		.update(String(lane))
		.update("|")
		.update(String(coefficient))
		.digest()
		.readUInt32LE(0) % CSH_FIELD_MODULUS;
}

function nextLineage(
	secret: string,
	protocolBinding: string,
	current: string,
	nonce: string,
	value: unknown
): string {
	return createHmac("sha256", secret)
		.update("lineage")
		.update("|")
		.update(protocolBinding)
		.update("|")
		.update(current)
		.update("|")
		.update(nonce)
		.update("|")
		.update(JSON.stringify(value))
		.digest("hex");
}

function deriveResponseTransform(
	secret: string,
	protocolBinding: string,
	epoch: number,
	nonce: string
): ChartCellTransform {
	const digest = createHmac("sha256", secret)
		.update("projection-opening")
		.update("|")
		.update(protocolBinding)
		.update("|")
		.update(String(epoch))
		.update("|")
		.update(nonce)
		.digest();
	const scale =
		1 + (digest.readUInt32LE(0) % (CSH_FIELD_MODULUS - 1));
	const offset = digest.readUInt32LE(4) % CSH_FIELD_MODULUS;
	const order = CSH_FIELD_MODULUS - 1;
	let exponent = 3 + (digest.readUInt32LE(8) % (order - 3));
	while (gcd(exponent, order) !== 1) {
		exponent++;
		if (exponent >= order) exponent = 3;
	}
	return Object.freeze({
		scale,
		offset,
		exponent,
		inverseExponent: inverseInteger(exponent, order),
	});
}

function wrapProjection(
	raw: number,
	transform: ChartCellTransform
): number {
	return power(
		add(multiply(transform.scale, raw), transform.offset),
		transform.exponent
	);
}

function multiplyMatrixVector(
	matrix: readonly (readonly number[])[],
	input: readonly number[]
): number[] {
	return matrix.map((row) => dot(row, input));
}

function dot(left: readonly number[], right: readonly number[]): number {
	let value = 0;
	for (let index = 0; index < left.length; index++) {
		value = add(value, multiply(left[index]!, right[index]!));
	}
	return value;
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

function inverseInteger(value: number, modulus: number): number {
	let oldR = normalizeFor(value, modulus);
	let r = modulus;
	let oldS = 1;
	let s = 0;
	while (r !== 0) {
		const quotient = Math.floor(oldR / r);
		[oldR, r] = [r, oldR - quotient * r];
		[oldS, s] = [s, oldS - quotient * s];
	}
	if (oldR !== 1) throw new Error("RUAM_CSH_NONINVERTIBLE_INTEGER");
	return normalizeFor(oldS, modulus);
}

function gcd(left: number, right: number): number {
	let a = Math.abs(left);
	let b = Math.abs(right);
	while (b !== 0) [a, b] = [b, a % b];
	return a;
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
	return normalizeFor(value, CSH_FIELD_MODULUS);
}

function normalizeFor(value: number, modulus: number): number {
	const normalized = Math.trunc(value) % modulus;
	return normalized < 0 ? normalized + modulus : normalized;
}
