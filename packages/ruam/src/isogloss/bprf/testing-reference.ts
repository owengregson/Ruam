/**
 * NON-PRODUCT REFERENCE EVALUATOR.
 *
 * This generic evaluator exists only for differential tests and spike scoring.
 * Product execution must emit generated regional codelets instead of shipping
 * a universal artifact evaluator.
 *
 * @module isogloss/bprf/testing-reference
 */

import { hashText, mix32 } from "./random.js";
import type {
	BprfArtifact,
	BprfCallerContext,
	BprfPiece,
	BprfRealization,
	BprfReferenceResult,
	BprfReferenceTraceEvent,
	BprfWireBasis,
	PureScalar,
} from "./types.js";
import { validateBprfArtifact } from "./validate.js";

/** Deterministically select a contextual realization for one caller lineage. */
export function selectBprfRealization(
	artifact: BprfArtifact,
	context: BprfCallerContext
): BprfRealization {
	if (
		!Number.isSafeInteger(context.epoch) ||
		context.epoch < 0 ||
		!Number.isSafeInteger(context.lineage) ||
		context.lineage < 0
	) {
		throw new Error("RUAM_BPRF_INVALID_CALLER_CONTEXT");
	}
	const callerHash = hashText(context.caller, artifact.selectionSalt);
	const selection = mix32(
		callerHash ^
			Math.imul(context.epoch + 1, 0x9e3779b9) ^
			Math.imul(context.lineage + 1, 0x85ebca6b)
	);
	return artifact.realizations[selection % artifact.realizations.length]!;
}

/**
 * Evaluate a generated artifact for differential testing.
 *
 * Trace records contain only contextual realization/transition/fragment
 * identities. They deliberately omit values, formula tags, operand tuples,
 * and source identities.
 */
export function evaluateBprfReference(
	artifact: BprfArtifact,
	inputs: readonly PureScalar[],
	context: BprfCallerContext
): BprfReferenceResult {
	validateBprfArtifact(artifact);
	const realization = selectBprfRealization(artifact, context);
	if (inputs.length !== realization.inputPorts.length) {
		throw new Error("RUAM_BPRF_INPUT_ARITY_MISMATCH");
	}

	const frame: Array<number | undefined> = Array.from(
		{ length: realization.frameSize },
		() => undefined
	);
	for (let index = 0; index < inputs.length; index++) {
		const port = realization.inputPorts[index]!;
		const coordinate = toCoordinate(
			inputs[index]!,
			port.typeCode,
			realization.familyCode
		);
		frame[port.slot] = encodeCoordinate(coordinate, port.basis);
	}

	const trace: BprfReferenceTraceEvent[] = [];
	for (const transition of realization.transitions) {
		const totals = new Map<number, number>();
		const destinationBases = new Map<number, BprfWireBasis>();
		for (const fragment of realization.fragments) {
			let participated = false;
			for (const piece of fragment.pieces) {
				if (piece.phase !== transition.phase) continue;
				participated = true;
				const contribution = evaluatePiece(piece, frame);
				totals.set(
					piece.destination,
					(totals.get(piece.destination) ?? 0) + contribution
				);
				destinationBases.set(piece.destination, piece.destinationBasis);
			}
			if (participated) {
				trace.push(
					Object.freeze({
						realization: realization.id,
						transition: transition.id,
						fragment: fragment.id,
						phase: transition.phase,
					})
				);
			}
		}
		for (const destination of transition.writes) {
			const total = totals.get(destination);
			const basis = destinationBases.get(destination);
			if (total == null || !basis) {
				throw new Error("RUAM_BPRF_INCOMPLETE_REFERENCE_TRANSITION");
			}
			frame[destination] = encodeCoordinate(total, basis);
		}
	}

	const outputs = realization.outputPorts.map((port) => {
		const encoded = frame[port.slot];
		if (encoded == null) throw new Error("RUAM_BPRF_MISSING_REFERENCE_OUTPUT");
		const coordinate = decodeCoordinate(encoded, port.basis);
		return fromCoordinate(coordinate, port.typeCode, realization.familyCode);
	});
	return {
		outputs,
		trace,
		realization: realization.id,
	};
}

function evaluatePiece(
	piece: BprfPiece,
	frame: readonly (number | undefined)[]
): number {
	let value = piece.coefficient;
	for (const factor of piece.factors) {
		const encoded = frame[factor.slot];
		if (encoded == null) {
			throw new Error("RUAM_BPRF_REFERENCE_READ_BEFORE_WRITE");
		}
		value *= decodeCoordinate(encoded, factor.basis) + factor.offset;
	}
	return value;
}

function toCoordinate(
	value: PureScalar,
	typeCode: 0 | 1,
	familyCode: 0 | 1
): number {
	if (typeCode === 0) {
		if (typeof value !== "number" || !Number.isFinite(value)) {
			throw new Error("RUAM_BPRF_EXPECTED_FINITE_NUMBER");
		}
		return value;
	}
	if (typeof value !== "boolean") {
		throw new Error("RUAM_BPRF_EXPECTED_BOOLEAN");
	}
	if (familyCode === 0) return value ? 1 : 0;
	return value ? 1 : -1;
}

function fromCoordinate(
	value: number,
	typeCode: 0 | 1,
	familyCode: 0 | 1
): PureScalar {
	if (typeCode === 0) return value;
	return familyCode === 0 ? value > 0.5 : value > 0;
}

function encodeCoordinate(value: number, basis: BprfWireBasis): number {
	return value * basis.scale + basis.bias;
}

function decodeCoordinate(value: number, basis: BprfWireBasis): number {
	return (value - basis.bias) / basis.scale;
}
