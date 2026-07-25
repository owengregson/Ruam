/**
 * Server-side missing chart relation for the CSH integration spike.
 *
 * It evaluates a hidden nonlinear projection and returns only additive chart
 * contributions under the next cover. The relation and logical direction are
 * absent from the client contract.
 *
 * @module isogloss/csh/reference-chart-custodian
 */

import {
	createHash,
	generateKeyPairSync,
	sign,
} from "node:crypto";
import { deriveSeed } from "../../naming/scope.js";
import { createSeededRandom } from "../../random/entropy.js";
import {
	CSH_FIELD_MODULUS,
	evaluateCertifiedProjection,
	type ChartCover,
	type CertifiedProjectionSite,
} from "./reference.js";
import {
	chartCustodySigningPayload,
	chartCustodyRequestDigest,
	type AdditiveChartContribution,
	type ChartCustodyClientContract,
	type ChartCustodyRequest,
	type ChartCustodyResponse,
} from "./chart-custody-protocol.js";

export interface HiddenChartRelation {
	readonly inputProjection: CertifiedProjectionSite;
	readonly cubic: number;
	readonly linear: number;
	readonly bias: number;
	readonly outputDirection: readonly number[];
}

export interface ReferenceChartCustodianOptions {
	readonly sessionId: string;
	readonly contractId: string;
	readonly fromCover: ChartCover;
	readonly toCover: ChartCover;
	readonly initialLineageCommitment: string;
	readonly lineageSecret: string;
	readonly sharingSecret: string;
	readonly relation: HiddenChartRelation;
}

export class ReferenceChartRelationCustodian {
	readonly clientContract: ChartCustodyClientContract;

	readonly #fromCover: ChartCover;
	readonly #toCover: ChartCover;
	readonly #relation: HiddenChartRelation;
	readonly #lineageSecret: string;
	readonly #sharingSecret: string;
	readonly #privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
	readonly #consumedNonces = new Set<string>();
	#epoch = 0;
	#lineageCommitment: string;

	constructor(options: ReferenceChartCustodianOptions) {
		if (options.fromCover.id === options.toCover.id) {
			throw new Error("RUAM_CSH_COVER_DID_NOT_CHANGE");
		}
		if (
			options.fromCover.width !== options.toCover.width ||
			options.relation.outputDirection.length !== options.toCover.width
		) {
			throw new Error("RUAM_CSH_CHART_CUSTODY_WIDTH_MISMATCH");
		}
		const relationScalars = [
			options.relation.cubic,
			options.relation.linear,
			options.relation.bias,
			...options.relation.outputDirection,
		];
		if (
			relationScalars.some((value) => !Number.isSafeInteger(value)) ||
			!options.relation.outputDirection.some(
				(value) => normalize(value) !== 0
			)
		) {
			throw new Error("RUAM_CSH_CHART_CUSTODY_INVALID_RELATION");
		}
		const { privateKey, publicKey } = generateKeyPairSync("ed25519");
		this.#privateKey = privateKey;
		this.#fromCover = options.fromCover;
		this.#toCover = options.toCover;
		this.#relation = options.relation;
		this.#lineageSecret = options.lineageSecret;
		this.#sharingSecret = options.sharingSecret;
		this.#lineageCommitment = options.initialLineageCommitment;
		this.clientContract = Object.freeze({
			sessionId: options.sessionId,
			contractId: options.contractId,
			fromCoverId: options.fromCover.id,
			toCoverId: options.toCover.id,
			initialLineageCommitment: options.initialLineageCommitment,
			verificationKey: publicKey
				.export({ type: "spki", format: "pem" })
				.toString(),
		});
	}

	evaluate(request: ChartCustodyRequest): ChartCustodyResponse {
		chartCustodyRequestDigest(request);
		if (
			request.sessionId !== this.clientContract.sessionId ||
			request.contractId !== this.clientContract.contractId ||
			request.fromCoverId !== this.#fromCover.id ||
			request.toCoverId !== this.#toCover.id
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
		const projectedInput = evaluateCertifiedProjection(
			request.charts,
			this.#fromCover,
			this.#relation.inputProjection
		);
		const cubed = multiply(
			multiply(projectedInput, projectedInput),
			projectedInput
		);
		const residual = add(
			add(
				multiply(this.#relation.cubic, cubed),
				multiply(this.#relation.linear, projectedInput)
			),
			this.#relation.bias
		);
		const logicalDelta = this.#relation.outputDirection.map((direction) =>
			multiply(direction, residual)
		);
		const mixedDelta = multiplyMatrixVector(
			this.#toCover.mixing,
			logicalDelta
		);
		const chartContributions = createAdditiveShares(
			mixedDelta,
			this.#toCover,
			deriveSharingSeed(
				this.#sharingSecret,
				this.#epoch,
				request.nonce
			)
		);
		const nextEpoch = this.#epoch + 1;
		const nextLineageCommitment = createHash("sha256")
			.update(this.#lineageSecret)
			.update("|")
			.update(this.#lineageCommitment)
			.update("|")
			.update(request.nonce)
			.update("|")
			.update(JSON.stringify(chartContributions))
			.digest("hex");
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
		return Object.freeze({ ...unsigned, signature });
	}
}

function createAdditiveShares(
	constant: readonly number[],
	cover: ChartCover,
	seed: number
): readonly AdditiveChartContribution[] {
	const random = createSeededRandom(seed);
	const residuals = Array.from({ length: cover.width }, () =>
		Array.from({ length: cover.threshold - 1 }, () =>
			random.nextUint32() % CSH_FIELD_MODULUS
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

function deriveSharingSeed(
	secret: string,
	epoch: number,
	nonce: string
): number {
	const secretWord = createHash("sha256")
		.update(secret)
		.update("|")
		.update(nonce)
		.digest()
		.readUInt32LE(0);
	return deriveSeed(secretWord, `chart-custody:${epoch}`);
}

function multiplyMatrixVector(
	matrix: readonly (readonly number[])[],
	input: readonly number[]
): number[] {
	return matrix.map((row) => {
		let value = 0;
		for (let index = 0; index < row.length; index++) {
			value = add(value, multiply(row[index]!, input[index]!));
		}
		return value;
	});
}

function add(left: number, right: number): number {
	return normalize(normalize(left) + normalize(right));
}

function multiply(left: number, right: number): number {
	return normalize(normalize(left) * normalize(right));
}

function normalize(value: number): number {
	const normalized = Math.trunc(value) % CSH_FIELD_MODULUS;
	return normalized < 0 ? normalized + CSH_FIELD_MODULUS : normalized;
}
