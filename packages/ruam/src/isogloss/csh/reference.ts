/**
 * Experimental moving-cover semantic holography reference model.
 *
 * This module exists to validate the local CSH mechanics before any production
 * artifact or runtime schema is frozen. A chart stores a non-linearly wrapped
 * polynomial evaluation of a mixed logical state. No chart contains an
 * independently decodable source value, and transitions transport directly
 * from incoming chart cells into the next cover without constructing a global
 * logical frame.
 *
 * The model is intentionally limited to fixed-width field vectors and affine
 * transitions. BPRF supplies the non-affine regional realizations around this
 * transport layer. Do not export this module from the public package entry
 * point until the dynamic-attacker gates have passed.
 *
 * @module isogloss/csh/reference
 */

import { deriveSeed } from "../../naming/scope.js";
import { createSeededRandom } from "../../random/entropy.js";

/** Largest 16-bit prime; products of field elements remain exact JS integers. */
export const CSH_FIELD_MODULUS = 65_521;

export interface ChartCellTransform {
	readonly scale: number;
	readonly offset: number;
	readonly exponent: number;
	readonly inverseExponent: number;
}

export interface ChartDescriptor {
	readonly id: string;
	readonly owner: string;
	readonly point: number;
	readonly cells: readonly ChartCellTransform[];
	readonly overlaps: readonly string[];
}

export interface ChartCover {
	readonly id: string;
	readonly epoch: number;
	readonly width: number;
	readonly threshold: number;
	readonly mixing: readonly (readonly number[])[];
	readonly bias: readonly number[];
	readonly charts: readonly ChartDescriptor[];
}

export interface EncodedChart {
	readonly coverId: string;
	readonly epoch: number;
	readonly chartId: string;
	readonly cells: readonly number[];
}

export interface AffineChartTransition {
	readonly id: string;
	readonly matrix: readonly (readonly number[])[];
	readonly bias: readonly number[];
}

export interface CertifiedProjectionSite {
	readonly id: string;
	readonly coefficients: readonly number[];
	readonly bias: number;
}

export interface CreateChartCoverOptions {
	readonly seed: number;
	readonly epoch: number;
	readonly width: number;
	readonly chartCount?: number;
	readonly threshold?: number;
}

/**
 * Create one deterministic cover. The default spike profile is five charts
 * with threshold three, as required by the D3 local-holography gate.
 */
export function createChartCover(
	options: CreateChartCoverOptions
): ChartCover {
	const {
		seed,
		epoch,
		width,
		chartCount = 5,
		threshold = 3,
	} = options;
	if (!Number.isSafeInteger(epoch) || epoch < 0) {
		throw new Error(`RUAM_CSH_INVALID_EPOCH: ${epoch}`);
	}
	if (!Number.isSafeInteger(width) || width < 2) {
		throw new Error(`RUAM_CSH_INVALID_WIDTH: ${width}`);
	}
	if (!Number.isSafeInteger(chartCount) || chartCount < 5) {
		throw new Error(`RUAM_CSH_INSUFFICIENT_CHARTS: ${chartCount}`);
	}
	if (
		!Number.isSafeInteger(threshold) ||
		threshold < 3 ||
		threshold > chartCount
	) {
		throw new Error(`RUAM_CSH_INVALID_THRESHOLD: ${threshold}`);
	}

	const random = createSeededRandom(
		deriveSeed(seed >>> 0, `csh-cover:${epoch}:${width}:${chartCount}:${threshold}`)
	);
	const mixing = createInvertibleMatrix(width, random);
	const bias = vector(width, () => randomField(random));
	const points = uniqueNonzeroPoints(chartCount, random);
	const coverTag = random.nextUint32().toString(36);
	const ids = points.map((_, index) => `c${epoch}_${index}_${coverTag}`);
	const charts = points.map((point, index): ChartDescriptor => {
		const cells = vector(width, (): ChartCellTransform => {
			const exponent = randomPermutationExponent(random);
			return freeze({
				scale: randomNonzeroField(random),
				offset: randomField(random),
				exponent,
				inverseExponent: inverseInteger(exponent, CSH_FIELD_MODULUS - 1),
			});
		});
		return freeze({
			id: ids[index]!,
			owner: `o${(index * 2 + epoch + 1) % chartCount}`,
			point,
			cells: freeze(cells),
			overlaps: freeze(ids.filter((_, other) => other !== index)),
		});
	});

	return freeze({
		id: `cover_${epoch}_${coverTag}`,
		epoch,
		width,
		threshold,
		mixing: freezeMatrix(mixing),
		bias: freeze(bias),
		charts: freeze(charts),
	});
}

/**
 * Encode an observable ingress vector into one cover.
 *
 * This is an ingress-only reference helper. Regional transitions must use
 * {@link transportAffineCharts}, which never reconstructs the logical vector.
 */
export function encodeIngressCharts(
	logicalValues: readonly number[],
	cover: ChartCover,
	seed: number
): readonly EncodedChart[] {
	validateCover(cover);
	assertVectorWidth(logicalValues, cover.width, "INGRESS");
	const constant = addVectors(
		multiplyMatrixVector(cover.mixing, logicalValues),
		cover.bias
	);
	const residuals = createResiduals(
		cover.width,
		cover.threshold,
		deriveSeed(seed >>> 0, `csh-ingress:${cover.id}`)
	);
	const charts = cover.charts.map((descriptor): EncodedChart => {
		const cells = vector(cover.width, (lane) => {
			const raw = evaluatePolynomial(
				constant[lane]!,
				residuals[lane]!,
				descriptor.point
			);
			return wrapCell(raw, descriptor.cells[lane]!);
		});
		return freeze({
			coverId: cover.id,
			epoch: cover.epoch,
			chartId: descriptor.id,
			cells: freeze(cells),
		});
	});
	return freeze(charts);
}

/**
 * Transport an affine logical transition into a fresh cover.
 *
 * For x' = A*x+c and encoded constants s=M*x+b, this composes the public
 * cover relation s'=M'*A*M^-1*s+d. Each output cell accumulates weighted
 * contributions from incoming chart cells directly; no s or x vector is ever
 * assembled.
 */
export function transportAffineCharts(
	incoming: readonly EncodedChart[],
	from: ChartCover,
	to: ChartCover,
	transition: AffineChartTransition,
	seed: number
): readonly EncodedChart[] {
	validateCover(from);
	validateCover(to);
	if (from.id === to.id || from.epoch === to.epoch) {
		throw new Error("RUAM_CSH_COVER_DID_NOT_CHANGE");
	}
	if (from.width !== to.width) {
		throw new Error(
			`RUAM_CSH_WIDTH_MISMATCH: ${from.width} -> ${to.width}`
		);
	}
	assertMatrixShape(transition.matrix, from.width, "TRANSITION");
	assertVectorWidth(transition.bias, from.width, "TRANSITION_BIAS");
	const selected = validateAndSelectCharts(incoming, from);
	const weights = interpolationWeightsAtZero(
		selected.map(({ descriptor }) => descriptor.point)
	);
	const inverseFromMixing = invertMatrix(from.mixing);
	const secretTransform = multiplyMatrices(
		multiplyMatrices(to.mixing, transition.matrix),
		inverseFromMixing
	);
	const transformedOldBias = multiplyMatrixVector(
		secretTransform,
		from.bias
	);
	const secretBias = subtractVectors(
		addVectors(
			multiplyMatrixVector(to.mixing, transition.bias),
			to.bias
		),
		transformedOldBias
	);
	const residuals = createResiduals(
		to.width,
		to.threshold,
		deriveSeed(
			seed >>> 0,
			`csh-transport:${transition.id}:${from.id}:${to.id}`
		)
	);

	const transported = to.charts.map((target): EncodedChart => {
		const cells = vector(to.width, (outputLane) => {
			let rawOutput = add(
				secretBias[outputLane]!,
				evaluatePolynomial(0, residuals[outputLane]!, target.point)
			);
			for (let chartIndex = 0; chartIndex < selected.length; chartIndex++) {
				const { chart, descriptor } = selected[chartIndex]!;
				const chartWeight = weights[chartIndex]!;
				for (let inputLane = 0; inputLane < from.width; inputLane++) {
					const rawInput = unwrapCell(
						chart.cells[inputLane]!,
						descriptor.cells[inputLane]!
					);
					rawOutput = add(
						rawOutput,
						multiply(
							multiply(
								secretTransform[outputLane]![inputLane]!,
								chartWeight
							),
							rawInput
						)
					);
				}
			}
			return wrapCell(rawOutput, target.cells[outputLane]!);
		});
		return freeze({
			coverId: to.id,
			epoch: to.epoch,
			chartId: target.id,
			cells: freeze(cells),
		});
	});
	return freeze(transported);
}

/**
 * Materialize one declared scalar effect/return projection.
 *
 * The implementation fuses interpolation, inverse mixing, and projection into
 * a scalar accumulator. It never returns or internally constructs a complete
 * logical vector.
 */
export function evaluateCertifiedProjection(
	incoming: readonly EncodedChart[],
	cover: ChartCover,
	site: CertifiedProjectionSite
): number {
	validateCover(cover);
	assertVectorWidth(site.coefficients, cover.width, "PROJECTION");
	const selected = validateAndSelectCharts(incoming, cover);
	const weights = interpolationWeightsAtZero(
		selected.map(({ descriptor }) => descriptor.point)
	);
	const inverseMixing = invertMatrix(cover.mixing);
	const secretCoefficients = multiplyRowByMatrix(
		site.coefficients,
		inverseMixing
	);
	let projected = subtract(
		normalize(site.bias),
		dot(secretCoefficients, cover.bias)
	);
	for (let chartIndex = 0; chartIndex < selected.length; chartIndex++) {
		const { chart, descriptor } = selected[chartIndex]!;
		const chartWeight = weights[chartIndex]!;
		for (let lane = 0; lane < cover.width; lane++) {
			const raw = unwrapCell(
				chart.cells[lane]!,
				descriptor.cells[lane]!
			);
			projected = add(
				projected,
				multiply(
					multiply(secretCoefficients[lane]!, chartWeight),
					raw
				)
			);
		}
	}
	return projected;
}

/** Verify structural invariants without deriving a logical value. */
export function validateCover(cover: ChartCover): void {
	if (cover.width < 2 || cover.charts.length < 5) {
		throw new Error("RUAM_CSH_INVALID_COVER_SHAPE");
	}
	if (cover.threshold < 3 || cover.threshold > cover.charts.length) {
		throw new Error("RUAM_CSH_INVALID_COVER_THRESHOLD");
	}
	assertMatrixShape(cover.mixing, cover.width, "COVER_MIXING");
	assertVectorWidth(cover.bias, cover.width, "COVER_BIAS");
	invertMatrix(cover.mixing);
	const ids = new Set<string>();
	const points = new Set<number>();
	for (const chart of cover.charts) {
		if (
			chart.cells.length !== cover.width ||
			chart.point === 0 ||
			chart.point >= CSH_FIELD_MODULUS
		) {
			throw new Error(`RUAM_CSH_INVALID_CHART: ${chart.id}`);
		}
		if (ids.has(chart.id) || points.has(chart.point)) {
			throw new Error(`RUAM_CSH_DUPLICATE_CHART: ${chart.id}`);
		}
		ids.add(chart.id);
		points.add(chart.point);
		for (const cell of chart.cells) {
			if (
				cell.scale === 0 ||
				multiply(
					cell.exponent,
					cell.inverseExponent,
					CSH_FIELD_MODULUS - 1
				) !== 1
			) {
				throw new Error(`RUAM_CSH_INVALID_CELL_TRANSFORM: ${chart.id}`);
			}
		}
	}
	for (const chart of cover.charts) {
		const expected = cover.charts
			.filter((candidate) => candidate.id !== chart.id)
			.map((candidate) => candidate.id);
		if (
			chart.overlaps.length !== expected.length ||
			expected.some((id) => !chart.overlaps.includes(id))
		) {
			throw new Error(`RUAM_CSH_INVALID_OVERLAP_COVER: ${chart.id}`);
		}
	}
}

interface SelectedChart {
	readonly chart: EncodedChart;
	readonly descriptor: ChartDescriptor;
}

function validateAndSelectCharts(
	incoming: readonly EncodedChart[],
	cover: ChartCover
): SelectedChart[] {
	if (incoming.length < cover.threshold) {
		throw new Error(
			`RUAM_CSH_THRESHOLD_NOT_MET: ${incoming.length}/${cover.threshold}`
		);
	}
	const descriptors = new Map(
		cover.charts.map((descriptor) => [descriptor.id, descriptor])
	);
	const seen = new Set<string>();
	return incoming.map((chart): SelectedChart => {
		if (chart.coverId !== cover.id || chart.epoch !== cover.epoch) {
			throw new Error(`RUAM_CSH_WRONG_COVER: ${chart.chartId}`);
		}
		if (seen.has(chart.chartId)) {
			throw new Error(`RUAM_CSH_DUPLICATE_CONTRIBUTION: ${chart.chartId}`);
		}
		seen.add(chart.chartId);
		const descriptor = descriptors.get(chart.chartId);
		if (!descriptor || chart.cells.length !== cover.width) {
			throw new Error(`RUAM_CSH_UNKNOWN_CHART: ${chart.chartId}`);
		}
		return { chart, descriptor };
	});
}

function createResiduals(
	width: number,
	threshold: number,
	seed: number
): number[][] {
	const random = createSeededRandom(seed);
	return vector(width, () =>
		vector(threshold - 1, () => randomField(random))
	);
}

function createInvertibleMatrix(
	width: number,
	random: ReturnType<typeof createSeededRandom>
): number[][] {
	for (let attempt = 0; attempt < 128; attempt++) {
		const candidate = vector(width, () =>
			vector(width, () => randomField(random))
		);
		try {
			invertMatrix(candidate);
			return candidate;
		} catch {
			// Deterministically continue the stream until a nonsingular basis.
		}
	}
	throw new Error("RUAM_CSH_COULD_NOT_BUILD_MIXING_BASIS");
}

function uniqueNonzeroPoints(
	count: number,
	random: ReturnType<typeof createSeededRandom>
): number[] {
	const points: number[] = [];
	const seen = new Set<number>();
	while (points.length < count) {
		const point = randomNonzeroField(random);
		if (!seen.has(point)) {
			seen.add(point);
			points.push(point);
		}
	}
	return points;
}

function randomPermutationExponent(
	random: ReturnType<typeof createSeededRandom>
): number {
	const order = CSH_FIELD_MODULUS - 1;
	for (;;) {
		const candidate = 3 + (random.nextUint32() % (order - 3));
		if (greatestCommonDivisor(candidate, order) === 1) return candidate;
	}
}

function interpolationWeightsAtZero(points: readonly number[]): number[] {
	if (new Set(points).size !== points.length) {
		throw new Error("RUAM_CSH_DUPLICATE_INTERPOLATION_POINT");
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
		return multiply(numerator, inverseField(denominator));
	});
}

function evaluatePolynomial(
	constant: number,
	coefficients: readonly number[],
	point: number
): number {
	let value = normalize(constant);
	let power = normalize(point);
	for (const coefficient of coefficients) {
		value = add(value, multiply(coefficient, power));
		power = multiply(power, point);
	}
	return value;
}

function wrapCell(raw: number, transform: ChartCellTransform): number {
	return powerField(
		add(multiply(transform.scale, raw), transform.offset),
		transform.exponent
	);
}

function unwrapCell(stored: number, transform: ChartCellTransform): number {
	return multiply(
		subtract(
			powerField(stored, transform.inverseExponent),
			transform.offset
		),
		inverseField(transform.scale)
	);
}

function multiplyMatrices(
	left: readonly (readonly number[])[],
	right: readonly (readonly number[])[]
): number[][] {
	const width = left.length;
	assertMatrixShape(left, width, "LEFT_MATRIX");
	assertMatrixShape(right, width, "RIGHT_MATRIX");
	return vector(width, (row) =>
		vector(width, (column) => {
			let value = 0;
			for (let inner = 0; inner < width; inner++) {
				value = add(
					value,
					multiply(left[row]![inner]!, right[inner]![column]!)
				);
			}
			return value;
		})
	);
}

function multiplyMatrixVector(
	matrix: readonly (readonly number[])[],
	input: readonly number[]
): number[] {
	assertMatrixShape(matrix, input.length, "MATRIX_VECTOR");
	return matrix.map((row) => dot(row, input));
}

function multiplyRowByMatrix(
	row: readonly number[],
	matrix: readonly (readonly number[])[]
): number[] {
	assertMatrixShape(matrix, row.length, "ROW_MATRIX");
	return vector(row.length, (column) => {
		let value = 0;
		for (let inner = 0; inner < row.length; inner++) {
			value = add(
				value,
				multiply(row[inner]!, matrix[inner]![column]!)
			);
		}
		return value;
	});
}

function invertMatrix(
	input: readonly (readonly number[])[]
): number[][] {
	const width = input.length;
	assertMatrixShape(input, width, "INVERSE");
	const augmented = input.map((row, rowIndex) => [
		...row.map(normalize),
		...vector(width, (column) => (rowIndex === column ? 1 : 0)),
	]);
	for (let column = 0; column < width; column++) {
		let pivot = column;
		while (pivot < width && augmented[pivot]![column] === 0) pivot++;
		if (pivot === width) throw new Error("RUAM_CSH_SINGULAR_MIXING_BASIS");
		[augmented[column], augmented[pivot]] = [
			augmented[pivot]!,
			augmented[column]!,
		];
		const pivotInverse = inverseField(augmented[column]![column]!);
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

function addVectors(
	left: readonly number[],
	right: readonly number[]
): number[] {
	assertVectorWidth(right, left.length, "VECTOR_ADD");
	return left.map((value, index) => add(value, right[index]!));
}

function subtractVectors(
	left: readonly number[],
	right: readonly number[]
): number[] {
	assertVectorWidth(right, left.length, "VECTOR_SUBTRACT");
	return left.map((value, index) => subtract(value, right[index]!));
}

function dot(left: readonly number[], right: readonly number[]): number {
	assertVectorWidth(right, left.length, "DOT");
	let value = 0;
	for (let index = 0; index < left.length; index++) {
		value = add(value, multiply(left[index]!, right[index]!));
	}
	return value;
}

function assertMatrixShape(
	matrix: readonly (readonly number[])[],
	width: number,
	label: string
): void {
	if (
		matrix.length !== width ||
		matrix.some((row) => row.length !== width)
	) {
		throw new Error(`RUAM_CSH_INVALID_${label}_SHAPE`);
	}
}

function assertVectorWidth(
	values: readonly number[],
	width: number,
	label: string
): void {
	if (values.length !== width) {
		throw new Error(
			`RUAM_CSH_INVALID_${label}_WIDTH: ${values.length}/${width}`
		);
	}
}

function randomField(
	random: ReturnType<typeof createSeededRandom>
): number {
	return random.nextUint32() % CSH_FIELD_MODULUS;
}

function randomNonzeroField(
	random: ReturnType<typeof createSeededRandom>
): number {
	return 1 + (random.nextUint32() % (CSH_FIELD_MODULUS - 1));
}

function add(left: number, right: number): number {
	return normalize(normalize(left) + normalize(right));
}

function subtract(left: number, right: number): number {
	return normalize(normalize(left) - normalize(right));
}

function multiply(
	left: number,
	right: number,
	modulus = CSH_FIELD_MODULUS
): number {
	const value = (normalizeFor(left, modulus) * normalizeFor(right, modulus)) %
		modulus;
	return value < 0 ? value + modulus : value;
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

function vector<T>(length: number, create: (index: number) => T): T[] {
	return Array.from({ length }, (_, index) => create(index));
}

function freeze<T>(value: T): Readonly<T> {
	return Object.freeze(value);
}

function freezeMatrix(
	matrix: readonly (readonly number[])[]
): readonly (readonly number[])[] {
	return freeze(matrix.map((row) => freeze([...row])));
}
