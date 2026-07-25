/**
 * Structural verifier for pure BPRF reference artifacts.
 *
 * The verifier checks fission, longitudinal braiding, contextual diversity,
 * physical-frame validity, and absence of semantic-dispatch schema fields.
 *
 * @module isogloss/bprf/validate
 */

import type {
	BprfArtifact,
	BprfPiece,
	BprfRealization,
	BprfValidationReport,
	BprfWireBasis,
} from "./types.js";

const FORBIDDEN_SCHEMA_KEYS = new Set([
	"op",
	"opcode",
	"operand",
	"semanticop",
	"handler",
	"handlerid",
	"sourceid",
	"sourcenode",
	"sourcenodeid",
	"nodeid",
	"canonicaloperand",
]);

/** Validate an artifact or throw a stable `RUAM_BPRF_*` diagnostic. */
export function validateBprfArtifact(
	artifact: BprfArtifact
): BprfValidationReport {
	if (artifact.format !== "ruam-bprf-pure-1") {
		throw new Error("RUAM_BPRF_FORMAT_MISMATCH");
	}
	assertNoForbiddenSchemaKeys(artifact);
	if (artifact.realizations.length < 2) {
		throw new Error("RUAM_BPRF_REALIZATION_COUNT_MIN_2");
	}

	const realizationIds = new Set<string>();
	const familyCodes = new Set<number>();
	const structuralSignatures = new Set<string>();
	const fragmentCounts: number[] = [];
	const transitionCounts: number[] = [];

	for (const realization of artifact.realizations) {
		if (realizationIds.has(realization.id)) {
			throw new Error("RUAM_BPRF_DUPLICATE_REALIZATION_ID");
		}
		realizationIds.add(realization.id);
		familyCodes.add(realization.familyCode);
		validateRealization(realization);
		fragmentCounts.push(realization.fragments.length);
		transitionCounts.push(realization.transitions.length);
		structuralSignatures.add(structuralSignature(realization));
	}

	if (familyCodes.size < 2) {
		throw new Error("RUAM_BPRF_REQUIRES_TWO_STRUCTURAL_FAMILIES");
	}
	if (structuralSignatures.size !== artifact.realizations.length) {
		throw new Error("RUAM_BPRF_DUPLICATE_REALIZATION_STRUCTURE");
	}

	return Object.freeze({
		realizationCount: artifact.realizations.length,
		familyCount: familyCodes.size,
		fragmentCountRange: Object.freeze([
			Math.min(...fragmentCounts),
			Math.max(...fragmentCounts),
		]) as readonly [number, number],
		transitionCountRange: Object.freeze([
			Math.min(...transitionCounts),
			Math.max(...transitionCounts),
		]) as readonly [number, number],
	});
}

function validateRealization(realization: BprfRealization): void {
	if (realization.familyCode !== 0 && realization.familyCode !== 1) {
		throw new Error("RUAM_BPRF_INVALID_FAMILY_CODE");
	}
	if (!Number.isSafeInteger(realization.contextSalt)) {
		throw new Error("RUAM_BPRF_INVALID_CONTEXT_SALT");
	}
	if (!Number.isSafeInteger(realization.frameSize) || realization.frameSize < 1) {
		throw new Error("RUAM_BPRF_INVALID_FRAME_SIZE");
	}
	if (realization.fragments.length < 2) {
		throw new Error("RUAM_BPRF_FRAGMENT_COUNT_MIN_2");
	}
	if (
		!Number.isSafeInteger(realization.fragmentThreshold) ||
		realization.fragmentThreshold < 2 ||
		realization.fragmentThreshold !== realization.fragments.length
	) {
		throw new Error("RUAM_BPRF_FRAGMENT_THRESHOLD_MISMATCH");
	}
	if (realization.transitions.length < 2) {
		throw new Error("RUAM_BPRF_TRANSITION_COUNT_MIN_2");
	}
	if (realization.inputPorts.length === 0 || realization.outputPorts.length === 0) {
		throw new Error("RUAM_BPRF_PORTS_REQUIRED");
	}

	const fragmentIds = new Set<string>();
	for (const fragment of realization.fragments) {
		if (fragmentIds.has(fragment.id)) {
			throw new Error("RUAM_BPRF_DUPLICATE_FRAGMENT_ID");
		}
		fragmentIds.add(fragment.id);
		if (fragment.pieces.length === 0) {
			throw new Error("RUAM_BPRF_EMPTY_FRAGMENT");
		}
	}

	const transitionIds = new Set<string>();
	const writtenPhase = new Map<number, number>();
	const basisBySlot = new Map<number, BprfWireBasis>();
	const inputSlots = new Set<number>();
	for (const port of realization.inputPorts) {
		assertSlot(port.slot, realization.frameSize);
		assertBasis(port.basis);
		if (inputSlots.has(port.slot)) {
			throw new Error("RUAM_BPRF_DUPLICATE_INPUT_SLOT");
		}
		inputSlots.add(port.slot);
		writtenPhase.set(port.slot, -1);
		basisBySlot.set(port.slot, port.basis);
	}

	for (let index = 0; index < realization.transitions.length; index++) {
		const transition = realization.transitions[index]!;
		if (transition.phase !== index) {
			throw new Error("RUAM_BPRF_NON_DENSE_PHASES");
		}
		if (transitionIds.has(transition.id)) {
			throw new Error("RUAM_BPRF_DUPLICATE_TRANSITION_ID");
		}
		transitionIds.add(transition.id);
		if (transition.writes.length === 0) {
			throw new Error("RUAM_BPRF_EMPTY_TRANSITION");
		}
		if (
			transition.boundaryCode !==
			(index === realization.transitions.length - 1 ? 1 : 0)
		) {
			throw new Error("RUAM_BPRF_INVALID_BOUNDARY_TRANSITION");
		}
		for (const slot of transition.writes) {
			assertSlot(slot, realization.frameSize);
			if (writtenPhase.has(slot)) {
				throw new Error("RUAM_BPRF_SLOT_WRITTEN_MORE_THAN_ONCE");
			}
			writtenPhase.set(slot, transition.phase);
		}
	}

	const piecesByDestination = new Map<
		number,
		Array<{ fragmentId: string; piece: BprfPiece }>
	>();
	for (const fragment of realization.fragments) {
		const fragmentDestinations = new Set<number>();
		for (const piece of fragment.pieces) {
			assertFinite(piece.coefficient);
			assertBasis(piece.destinationBasis);
			assertSlot(piece.destination, realization.frameSize);
			const expectedPhase = writtenPhase.get(piece.destination);
			if (expectedPhase == null || expectedPhase !== piece.phase) {
				throw new Error("RUAM_BPRF_PIECE_DESTINATION_PHASE_MISMATCH");
			}
			for (const factor of piece.factors) {
				assertFinite(factor.offset);
				assertBasis(factor.basis);
				assertSlot(factor.slot, realization.frameSize);
				const factorPhase = writtenPhase.get(factor.slot);
				if (factorPhase == null || factorPhase >= piece.phase) {
					throw new Error("RUAM_BPRF_FORWARD_OR_UNKNOWN_FACTOR");
				}
			}
			fragmentDestinations.add(piece.destination);
			const destinationPieces = piecesByDestination.get(piece.destination) ?? [];
			destinationPieces.push({ fragmentId: fragment.id, piece });
			piecesByDestination.set(piece.destination, destinationPieces);
		}
		if (fragmentDestinations.size < 2) {
			throw new Error("RUAM_BPRF_FRAGMENT_NOT_BRAIDED");
		}
	}

	for (const transition of realization.transitions) {
		for (const destination of transition.writes) {
			const destinationPieces = piecesByDestination.get(destination) ?? [];
			const owners = new Set(destinationPieces.map((entry) => entry.fragmentId));
			if (owners.size !== realization.fragmentThreshold) {
				throw new Error("RUAM_BPRF_DESTINATION_NOT_FISSIONED");
			}
			for (const owner of owners) {
				const ownedCount = destinationPieces.filter(
					(entry) => entry.fragmentId === owner
				).length;
				if (ownedCount === destinationPieces.length) {
					throw new Error("RUAM_BPRF_FRAGMENT_OWNS_COMPLETE_DESTINATION");
				}
			}
			assertConsistentDestinationBasis(destinationPieces.map((entry) => entry.piece));
			basisBySlot.set(
				destination,
				destinationPieces[0]!.piece.destinationBasis
			);
		}
	}

	for (const fragment of realization.fragments) {
		for (const piece of fragment.pieces) {
			for (const factor of piece.factors) {
				const expectedBasis = basisBySlot.get(factor.slot);
				if (!expectedBasis || !sameBasis(expectedBasis, factor.basis)) {
					throw new Error("RUAM_BPRF_FACTOR_BASIS_MISMATCH");
				}
			}
		}
	}

	const finalTransition =
		realization.transitions[realization.transitions.length - 1]!;
	const finalSlots = new Set(finalTransition.writes);
	for (const port of realization.outputPorts) {
		assertSlot(port.slot, realization.frameSize);
		assertBasis(port.basis);
		if (!finalSlots.has(port.slot) || inputSlots.has(port.slot)) {
			throw new Error("RUAM_BPRF_OUTPUT_NOT_REBASED_AT_BOUNDARY");
		}
		const pieces = piecesByDestination.get(port.slot)!;
		if (!sameBasis(pieces[0]!.piece.destinationBasis, port.basis)) {
			throw new Error("RUAM_BPRF_OUTPUT_BASIS_MISMATCH");
		}
	}
}

function assertConsistentDestinationBasis(pieces: readonly BprfPiece[]): void {
	const expected = pieces[0]?.destinationBasis;
	if (!expected) throw new Error("RUAM_BPRF_MISSING_DESTINATION_PIECES");
	for (const piece of pieces) {
		if (!sameBasis(piece.destinationBasis, expected)) {
			throw new Error("RUAM_BPRF_INCONSISTENT_DESTINATION_BASIS");
		}
	}
}

function assertNoForbiddenSchemaKeys(value: unknown): void {
	if (Array.isArray(value)) {
		for (const item of value) assertNoForbiddenSchemaKeys(item);
		return;
	}
	if (value === null || typeof value !== "object") return;
	for (const [key, child] of Object.entries(value)) {
		if (FORBIDDEN_SCHEMA_KEYS.has(key.toLowerCase())) {
			throw new Error(`RUAM_BPRF_FORBIDDEN_SCHEMA_KEY: ${key}`);
		}
		assertNoForbiddenSchemaKeys(child);
	}
}

function structuralSignature(realization: BprfRealization): string {
	return JSON.stringify({
		familyCode: realization.familyCode,
		frameSize: realization.frameSize,
		fragmentThreshold: realization.fragmentThreshold,
		inputPorts: realization.inputPorts,
		outputPorts: realization.outputPorts,
		transitions: realization.transitions.map((transition) => ({
			phase: transition.phase,
			boundaryCode: transition.boundaryCode,
			writes: transition.writes,
		})),
		fragments: realization.fragments.map((fragment) =>
			fragment.pieces.map((piece) => ({
				phase: piece.phase,
				destination: piece.destination,
				destinationBasis: piece.destinationBasis,
				coefficient: piece.coefficient,
				factors: piece.factors,
			}))
		),
	});
}

function assertSlot(slot: number, frameSize: number): void {
	if (!Number.isSafeInteger(slot) || slot < 0 || slot >= frameSize) {
		throw new Error(`RUAM_BPRF_INVALID_SLOT: ${slot}`);
	}
}

function assertBasis(basis: BprfWireBasis): void {
	assertFinite(basis.scale);
	assertFinite(basis.bias);
	if (basis.scale === 0) throw new Error("RUAM_BPRF_ZERO_BASIS_SCALE");
}

function assertFinite(value: number): void {
	if (!Number.isFinite(value)) throw new Error("RUAM_BPRF_NON_FINITE_VALUE");
}

function sameBasis(left: BprfWireBasis, right: BprfWireBasis): boolean {
	return left.scale === right.scale && left.bias === right.bias;
}
