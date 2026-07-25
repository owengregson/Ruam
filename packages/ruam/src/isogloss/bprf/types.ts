/**
 * Architecture-neutral contracts for the bounded pure BPRF spike.
 *
 * Logical contracts are compiler/reference inputs. Generated artifacts use
 * only contextual wire, fragment, and transition identities.
 *
 * @module isogloss/bprf/types
 */

export type PureScalar = number | boolean;
export type PureValueType = "number" | "boolean";
export type PureValueRef = number;

export interface PureRegionInput {
	type: PureValueType;
}

export type PureRegionFormula =
	| { tag: "literal"; type: "number"; value: number }
	| { tag: "literal"; type: "boolean"; value: boolean }
	| { tag: "sum"; left: PureValueRef; right: PureValueRef }
	| { tag: "difference"; left: PureValueRef; right: PureValueRef }
	| { tag: "product"; left: PureValueRef; right: PureValueRef }
	| { tag: "negate"; value: PureValueRef }
	| { tag: "not"; value: PureValueRef }
	| { tag: "and"; left: PureValueRef; right: PureValueRef }
	| { tag: "or"; left: PureValueRef; right: PureValueRef }
	| { tag: "xor"; left: PureValueRef; right: PureValueRef }
	| {
			tag: "select";
			gate: PureValueRef;
			whenTrue: PureValueRef;
			whenFalse: PureValueRef;
	  };

export interface PureRegionStep {
	type: PureValueType;
	formula: PureRegionFormula;
}

/**
 * Dense pure-region graph.
 *
 * Input references occupy `[0, inputs.length)`. Step references follow in
 * declaration order, so every formula may reference only an earlier value.
 */
export interface PureRegionContract {
	inputs: readonly PureRegionInput[];
	steps: readonly PureRegionStep[];
	outputs: readonly PureValueRef[];
}

export interface BprfGenerationOptions {
	seed: number;
	/** Must be at least two. Defaults to three. */
	realizationCount?: number;
	/** Necessary fragments per realization. Must be at least two. */
	fragmentCount?: number;
}

/** Affine coordinate basis for one contextual physical wire. */
export interface BprfWireBasis {
	scale: number;
	bias: number;
}

export interface BprfPort {
	slot: number;
	typeCode: 0 | 1;
	basis: BprfWireBasis;
}

export interface BprfFactor {
	slot: number;
	offset: number;
	basis: BprfWireBasis;
}

/** One partial polynomial contribution; never a complete logical step. */
export interface BprfPiece {
	phase: number;
	destination: number;
	destinationBasis: BprfWireBasis;
	coefficient: number;
	factors: readonly BprfFactor[];
}

/** A longitudinal fragment braided across several logical destinations. */
export interface BprfFragment {
	id: string;
	pieces: readonly BprfPiece[];
}

export interface BprfTransition {
	id: string;
	phase: number;
	boundaryCode: 0 | 1;
	writes: readonly number[];
}

export interface BprfRealization {
	id: string;
	/** Opaque structural-family code; it is not a language-operation identity. */
	familyCode: 0 | 1;
	contextSalt: number;
	frameSize: number;
	fragmentThreshold: number;
	inputPorts: readonly BprfPort[];
	outputPorts: readonly BprfPort[];
	transitions: readonly BprfTransition[];
	fragments: readonly BprfFragment[];
}

export interface BprfArtifact {
	format: "ruam-bprf-pure-1";
	id: string;
	selectionSalt: number;
	realizations: readonly BprfRealization[];
}

export interface BprfCallerContext {
	caller: string;
	epoch: number;
	lineage: number;
}

export interface BprfReferenceTraceEvent {
	realization: string;
	transition: string;
	fragment: string;
	phase: number;
}

export interface BprfReferenceResult {
	outputs: PureScalar[];
	trace: BprfReferenceTraceEvent[];
	realization: string;
}

export interface BprfValidationReport {
	realizationCount: number;
	familyCount: number;
	fragmentCountRange: readonly [number, number];
	transitionCountRange: readonly [number, number];
}
