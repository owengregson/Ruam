/**
 * Server-side direct relation evaluator for the experimental CSH spike.
 *
 * This module models a process/trust boundary. It must never be bundled into a
 * client artifact. It is the direct-remote performance/control baseline that
 * precedes a topology-hidden, actively secure PFE implementation.
 *
 * @module isogloss/csh/reference-custodian
 */

import {
	createHash,
	generateKeyPairSync,
	sign,
} from "node:crypto";
import {
	CSH_FIELD_MODULUS,
	evaluateCertifiedProjection,
	type ChartCellTransform,
	type ChartCover,
	type CertifiedProjectionSite,
} from "./reference.js";
import {
	custodyResponseSigningPayload,
	custodyRequestDigest,
	type CustodyClientContract,
	type CustodyRequest,
	type CustodyResponse,
} from "./custody-protocol.js";

export interface CustodiedNonlinearRelation {
	readonly projectionSite: CertifiedProjectionSite;
	readonly cubic: number;
	readonly linear: number;
	readonly bias: number;
}

export interface ReferenceCustodianOptions {
	readonly sessionId: string;
	readonly contractId: string;
	readonly cover: ChartCover;
	readonly initialLineageCommitment: string;
	readonly relation: CustodiedNonlinearRelation;
	readonly lineageSecret: string;
	readonly responseSecret: string;
}

/**
 * Stateful one-session evaluator. A successful request consumes its epoch
 * before another request can be evaluated, preventing snapshot-and-fork reuse.
 */
export class ReferenceRelationCustodian {
	readonly clientContract: CustodyClientContract;

	readonly #cover: ChartCover;
	readonly #relation: CustodiedNonlinearRelation;
	readonly #lineageSecret: string;
	readonly #responseSecret: string;
	readonly #privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
	readonly #consumedNonces = new Set<string>();
	#epoch = 0;
	#lineageCommitment: string;

	constructor(options: ReferenceCustodianOptions) {
		const { privateKey, publicKey } = generateKeyPairSync("ed25519");
		this.#privateKey = privateKey;
		this.#cover = options.cover;
		this.#relation = options.relation;
		this.#lineageSecret = options.lineageSecret;
		this.#responseSecret = options.responseSecret;
		this.#lineageCommitment = options.initialLineageCommitment;
		this.clientContract = Object.freeze({
			sessionId: options.sessionId,
			contractId: options.contractId,
			coverId: options.cover.id,
			initialLineageCommitment: options.initialLineageCommitment,
			verificationKey: publicKey
				.export({ type: "spki", format: "pem" })
				.toString(),
		});
	}

	evaluate(request: CustodyRequest): CustodyResponse {
		custodyRequestDigest(request);
		if (
			request.sessionId !== this.clientContract.sessionId ||
			request.contractId !== this.clientContract.contractId ||
			request.coverId !== this.#cover.id
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

		const inputProjection = evaluateCertifiedProjection(
			request.charts,
			this.#cover,
			this.#relation.projectionSite
		);
		const squared = multiply(inputProjection, inputProjection);
		const cubed = multiply(squared, inputProjection);
		const projected = add(
			add(
				multiply(this.#relation.cubic, cubed),
				multiply(this.#relation.linear, inputProjection)
			),
			this.#relation.bias
		);
		const projectionOpening = deriveResponseTransform(
			this.#responseSecret,
			this.#epoch,
			request.nonce
		);
		const encodedProjection = wrapProjection(
			projected,
			projectionOpening
		);
		const nextEpoch = this.#epoch + 1;
		const nextLineageCommitment = createHash("sha256")
			.update(this.#lineageSecret)
			.update("|")
			.update(this.#lineageCommitment)
			.update("|")
			.update(request.nonce)
			.update("|")
			.update(String(encodedProjection))
			.digest("hex");
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

		// Advance before returning so re-entrant/forked requests see new state.
		this.#consumedNonces.add(request.nonce);
		this.#epoch = nextEpoch;
		this.#lineageCommitment = nextLineageCommitment;
		return Object.freeze({ ...unsigned, signature });
	}
}

function deriveResponseTransform(
	secret: string,
	epoch: number,
	nonce: string
): ChartCellTransform {
	const digest = createHash("sha256")
		.update(secret)
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
	while (greatestCommonDivisor(exponent, order) !== 1) {
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
	return powerField(
		add(multiply(transform.scale, raw), transform.offset),
		transform.exponent
	);
}

function add(left: number, right: number): number {
	return normalize(normalize(left) + normalize(right));
}

function multiply(left: number, right: number): number {
	return normalize(normalize(left) * normalize(right));
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
	if (oldR !== 1) {
		throw new Error(`RUAM_CSH_NONINVERTIBLE_INTEGER: ${value}`);
	}
	return normalizeFor(oldS, modulus);
}

function greatestCommonDivisor(left: number, right: number): number {
	let a = Math.abs(left);
	let b = Math.abs(right);
	while (b !== 0) [a, b] = [b, a % b];
	return a;
}

function normalize(value: number): number {
	return normalizeFor(value, CSH_FIELD_MODULUS);
}

function normalizeFor(value: number, modulus: number): number {
	const normalized = Math.trunc(value) % modulus;
	return normalized < 0 ? normalized + modulus : normalized;
}
