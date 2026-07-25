/**
 * NON-PRODUCT BPRF/CSH INTEGRATION EVALUATOR.
 *
 * This differential-test evaluator executes BPRF polynomial fragments over
 * chart-local shares. A multiplication raises the sharing polynomial from
 * degree two to degree four; five chart contributors then reduce it directly
 * into a fresh degree-two sharing under a new cover. No complete BPRF frame is
 * reconstructed at a transition.
 *
 * Product execution must emit specialized chart-local codelets. This generic
 * evaluator must never ship in a client artifact.
 *
 * @module isogloss/csh/testing-bprf-reference
 */

import { deriveSeed } from "../../naming/scope.js";
import { createSeededRandom } from "../../random/entropy.js";
import type {
	BprfArtifact,
	BprfCallerContext,
	BprfPiece,
	BprfRealization,
	PureScalar,
} from "../bprf/index.js";
import { validateBprfArtifact } from "../bprf/index.js";
import { selectBprfRealization } from "../bprf/testing-reference.js";
import {
	CSH_FIELD_MODULUS,
	encodeIngressCharts,
	evaluateCertifiedProjection,
	validateCover,
	type ChartCellTransform,
	type ChartCover,
	type EncodedChart,
} from "./reference.js";

export interface BprfCshTraceEvent {
	readonly realization: string;
	readonly transition: string;
	readonly fragment: string;
	readonly chart: string;
	readonly fromCover: string;
	readonly toCover: string;
	readonly phase: number;
}

export interface BprfCshReferenceResult {
	readonly outputs: readonly PureScalar[];
	readonly charts: readonly EncodedChart[];
	readonly realization: string;
	readonly trace: readonly BprfCshTraceEvent[];
}

/**
 * Evaluate one bounded integer/boolean BPRF realization over moving CSH
 * covers. There must be one ingress cover plus one new cover per transition.
 */
export function evaluateBprfOverCshReference(
	artifact: BprfArtifact,
	inputs: readonly PureScalar[],
	context: BprfCallerContext,
	covers: readonly ChartCover[],
	seed: number
): BprfCshReferenceResult {
	validateBprfArtifact(artifact);
	const realization = selectBprfRealization(artifact, context);
	validateIntegrationInputs(realization, inputs, covers);
	const ingressFrame = createIngressFrame(realization, inputs);
	let charts = encodeIngressCharts(
		ingressFrame,
		covers[0]!,
		deriveSeed(seed >>> 0, `bprf-csh-ingress:${realization.id}`)
	);
	const trace: BprfCshTraceEvent[] = [];
	for (
		let transitionIndex = 0;
		transitionIndex < realization.transitions.length;
		transitionIndex++
	) {
		const transition = realization.transitions[transitionIndex]!;
		const from = covers[transitionIndex]!;
		const to = covers[transitionIndex + 1]!;
		const transported = transportBprfTransition(
			realization,
			transition.phase,
			charts,
			from,
			to,
			deriveSeed(
				seed >>> 0,
				`bprf-csh-transition:${realization.id}:${transition.id}`
			)
		);
		charts = transported.charts;
		for (const event of transported.trace) trace.push(event);
	}

	const finalCover = covers[covers.length - 1]!;
	const outputs = realization.outputPorts.map((port, outputIndex) => {
		const inverseScale = inverse(port.basis.scale);
		const coefficients = Array.from(
			{ length: realization.frameSize },
			(_, slot) => (slot === port.slot ? inverseScale : 0)
		);
		const coordinate = evaluateCertifiedProjection(charts, finalCover, {
			id: `exit_${outputIndex}`,
			coefficients,
			bias: subtract(0, multiply(port.basis.bias, inverseScale)),
		});
		if (port.typeCode === 0) return fromSignedField(coordinate);
		if (realization.familyCode === 0) return coordinate !== 0;
		return fromSignedField(coordinate) > 0;
	});
	return Object.freeze({
		outputs: Object.freeze(outputs),
		charts,
		realization: realization.id,
		trace: Object.freeze(trace),
	});
}

function validateIntegrationInputs(
	realization: BprfRealization,
	inputs: readonly PureScalar[],
	covers: readonly ChartCover[]
): void {
	if (inputs.length !== realization.inputPorts.length) {
		throw new Error("RUAM_BPRF_CSH_INPUT_ARITY_MISMATCH");
	}
	if (covers.length !== realization.transitions.length + 1) {
		throw new Error("RUAM_BPRF_CSH_COVER_COUNT_MISMATCH");
	}
	const ids = new Set<string>();
	for (const cover of covers) {
		validateCover(cover);
		if (cover.width !== realization.frameSize) {
			throw new Error("RUAM_BPRF_CSH_COVER_WIDTH_MISMATCH");
		}
		if (cover.charts.length < cover.threshold * 2 - 1) {
			throw new Error("RUAM_BPRF_CSH_MULTIPLICATION_QUORUM_TOO_SMALL");
		}
		if (ids.has(cover.id)) {
			throw new Error("RUAM_BPRF_CSH_COVER_DID_NOT_CHANGE");
		}
		ids.add(cover.id);
	}
}

function createIngressFrame(
	realization: BprfRealization,
	inputs: readonly PureScalar[]
): number[] {
	const frame = Array.from({ length: realization.frameSize }, () => 0);
	for (let index = 0; index < inputs.length; index++) {
		const input = inputs[index]!;
		const port = realization.inputPorts[index]!;
		let coordinate: number;
		if (port.typeCode === 0) {
			if (
				typeof input !== "number" ||
				!Number.isSafeInteger(input) ||
				Math.abs(input) >= CSH_FIELD_MODULUS / 4
			) {
				throw new Error("RUAM_BPRF_CSH_BOUNDED_INTEGER_REQUIRED");
			}
			coordinate = normalize(input);
		} else {
			if (typeof input !== "boolean") {
				throw new Error("RUAM_BPRF_CSH_BOOLEAN_REQUIRED");
			}
			coordinate =
				realization.familyCode === 0
					? input
						? 1
						: 0
					: input
						? 1
						: normalize(-1);
		}
		frame[port.slot] = add(
			multiply(coordinate, port.basis.scale),
			port.basis.bias
		);
	}
	return frame;
}

function transportBprfTransition(
	realization: BprfRealization,
	phase: number,
	incoming: readonly EncodedChart[],
	from: ChartCover,
	to: ChartCover,
	seed: number
): {
	charts: readonly EncodedChart[];
	trace: readonly BprfCshTraceEvent[];
} {
	if (
		incoming.length !== from.charts.length ||
		incoming.length < from.threshold * 2 - 1
	) {
		throw new Error(
			`RUAM_BPRF_CSH_MULTIPLICATION_QUORUM: ${incoming.length}/${from.charts.length}`
		);
	}
	if (from.id === to.id) {
		throw new Error("RUAM_BPRF_CSH_COVER_DID_NOT_CHANGE");
	}
	const descriptorById = new Map(
		from.charts.map((descriptor) => [descriptor.id, descriptor])
	);
	const seen = new Set<string>();
	const selected = incoming.map((chart) => {
		if (chart.coverId !== from.id || chart.epoch !== from.epoch) {
			throw new Error(`RUAM_BPRF_CSH_WRONG_COVER: ${chart.chartId}`);
		}
		if (seen.has(chart.chartId)) {
			throw new Error(
				`RUAM_BPRF_CSH_DUPLICATE_CHART: ${chart.chartId}`
			);
		}
		seen.add(chart.chartId);
		const descriptor = descriptorById.get(chart.chartId);
		if (!descriptor) {
			throw new Error(`RUAM_BPRF_CSH_UNKNOWN_CHART: ${chart.chartId}`);
		}
		return { chart, descriptor };
	});
	const inverseMixing = invertMatrix(from.mixing);
	const localFrameShares = selected.map(({ chart, descriptor }) => {
		const mixedShares = chart.cells.map((cell, lane) =>
			unwrapCell(cell, descriptor.cells[lane]!)
		);
		return multiplyMatrixVector(
			inverseMixing,
			mixedShares.map((value, lane) => subtract(value, from.bias[lane]!))
		);
	});
	const transition = realization.transitions[phase];
	if (!transition || transition.phase !== phase) {
		throw new Error("RUAM_BPRF_CSH_UNKNOWN_TRANSITION_PHASE");
	}
	const participating = realization.fragments.filter((fragment) =>
		fragment.pieces.some((piece) => piece.phase === phase)
	);
	const trace: BprfCshTraceEvent[] = [];
	const nextFrameShares = localFrameShares.map(
		(frameShare, chartIndex): number[] => {
			const next = frameShare.slice();
			for (const destination of transition.writes) {
				const pieces = participating.flatMap((fragment) =>
					fragment.pieces.filter(
						(piece) =>
							piece.phase === phase &&
							piece.destination === destination
					)
				);
				if (pieces.length === 0) {
					throw new Error("RUAM_BPRF_CSH_MISSING_DESTINATION");
				}
				let coordinateShare = 0;
				for (const piece of pieces) {
					coordinateShare = add(
						coordinateShare,
						evaluatePieceShare(piece, frameShare)
					);
				}
				const basis = pieces[0]!.destinationBasis;
				next[destination] = add(
					multiply(coordinateShare, basis.scale),
					basis.bias
				);
			}
			for (const fragment of participating) {
				trace.push(
					Object.freeze({
						realization: realization.id,
						transition: transition.id,
						fragment: fragment.id,
						chart: selected[chartIndex]!.descriptor.id,
						fromCover: from.id,
						toCover: to.id,
						phase,
					})
				);
			}
			return next;
		}
	);

	const sourceWeights = interpolationWeightsAtZero(
		selected.map(({ descriptor }) => descriptor.point)
	);
	const random = createSeededRandom(seed);
	const residuals = selected.map(() =>
		Array.from({ length: to.width }, () =>
			Array.from({ length: to.threshold - 1 }, () =>
				random.nextUint32() % CSH_FIELD_MODULUS
			)
		)
	);
	const charts = to.charts.map((target): EncodedChart => {
		const cells = Array.from({ length: to.width }, (_, mixedLane) => {
			let reducedShare = 0;
			for (
				let sourceIndex = 0;
				sourceIndex < selected.length;
				sourceIndex++
			) {
				const sourceFrame = nextFrameShares[sourceIndex]!;
				let mixedEvaluation = to.bias[mixedLane]!;
				for (let frameLane = 0; frameLane < to.width; frameLane++) {
					mixedEvaluation = add(
						mixedEvaluation,
						multiply(
							to.mixing[mixedLane]![frameLane]!,
							sourceFrame[frameLane]!
						)
					);
				}
				let contribution = multiply(
					sourceWeights[sourceIndex]!,
					mixedEvaluation
				);
				let pointPower = target.point;
				for (const residual of residuals[sourceIndex]![mixedLane]!) {
					contribution = add(
						contribution,
						multiply(residual, pointPower)
					);
					pointPower = multiply(pointPower, target.point);
				}
				reducedShare = add(reducedShare, contribution);
			}
			return wrapCell(reducedShare, target.cells[mixedLane]!);
		});
		return Object.freeze({
			coverId: to.id,
			epoch: to.epoch,
			chartId: target.id,
			cells: Object.freeze(cells),
		});
	});
	return {
		charts: Object.freeze(charts),
		trace: Object.freeze(trace),
	};
}

function evaluatePieceShare(
	piece: BprfPiece,
	frameShare: readonly number[]
): number {
	let value = coefficientToField(piece.coefficient);
	for (const factor of piece.factors) {
		const basisInverse = inverse(factor.basis.scale);
		const coordinateShare = multiply(
			subtract(frameShare[factor.slot]!, factor.basis.bias),
			basisInverse
		);
		value = multiply(value, add(coordinateShare, factor.offset));
	}
	return value;
}

function coefficientToField(value: number): number {
	if (Number.isSafeInteger(value)) return normalize(value);
	const doubled = value * 2;
	if (Number.isSafeInteger(doubled)) {
		return multiply(normalize(doubled), inverse(2));
	}
	throw new Error(`RUAM_BPRF_CSH_UNSUPPORTED_COEFFICIENT: ${value}`);
}

function interpolationWeightsAtZero(points: readonly number[]): number[] {
	if (new Set(points).size !== points.length) {
		throw new Error("RUAM_BPRF_CSH_DUPLICATE_POINT");
	}
	return points.map((point, index) => {
		let numerator = 1;
		let denominator = 1;
		for (let other = 0; other < points.length; other++) {
			if (other === index) continue;
			numerator = multiply(numerator, subtract(0, points[other]!));
			denominator = multiply(
				denominator,
				subtract(point, points[other]!)
			);
		}
		return multiply(numerator, inverse(denominator));
	});
}

function multiplyMatrixVector(
	matrix: readonly (readonly number[])[],
	input: readonly number[]
): number[] {
	return matrix.map((row) => {
		let value = 0;
		for (let column = 0; column < row.length; column++) {
			value = add(value, multiply(row[column]!, input[column]!));
		}
		return value;
	});
}

function invertMatrix(
	input: readonly (readonly number[])[]
): number[][] {
	const width = input.length;
	const augmented = input.map((row, rowIndex) => [
		...row.map(normalize),
		...Array.from({ length: width }, (_, column) =>
			rowIndex === column ? 1 : 0
		),
	]);
	for (let column = 0; column < width; column++) {
		let pivot = column;
		while (pivot < width && augmented[pivot]![column] === 0) pivot++;
		if (pivot === width) throw new Error("RUAM_BPRF_CSH_SINGULAR_COVER");
		[augmented[column], augmented[pivot]] = [
			augmented[pivot]!,
			augmented[column]!,
		];
		const pivotInverse = inverse(augmented[column]![column]!);
		for (let index = 0; index < width * 2; index++) {
			augmented[column]![index] = multiply(
				augmented[column]![index]!,
				pivotInverse
			);
		}
		for (let row = 0; row < width; row++) {
			if (row === column) continue;
			const factor = augmented[row]![column]!;
			for (let index = 0; index < width * 2; index++) {
				augmented[row]![index] = subtract(
					augmented[row]![index]!,
					multiply(factor, augmented[column]![index]!)
				);
			}
		}
	}
	return augmented.map((row) => row.slice(width));
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
	if (normalized === 0) throw new Error("RUAM_BPRF_CSH_ZERO_INVERSE");
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

function fromSignedField(value: number): number {
	return value > CSH_FIELD_MODULUS / 2
		? value - CSH_FIELD_MODULUS
		: value;
}
