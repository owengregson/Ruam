/**
 * NON-PRODUCT SPECIALIZED BPRF/CSH SOURCE-EMISSION SPIKE.
 *
 * This owner-side utility specializes one caller-selected BPRF realization and
 * a complete moving-cover plan into direct JavaScript. Generated code stores
 * each chart as a separately named object of scalar fields. It contains no
 * artifact walker, chart collection, frame array, global decoder, or generic
 * transition evaluator.
 *
 * @module isogloss/csh/testing-emitter
 */

import { deriveSeed } from "../../naming/scope.js";
import { createSeededRandom } from "../../random/entropy.js";
import type {
	BprfArtifact,
	BprfCallerContext,
	BprfPiece,
	BprfRealization,
	PureValueType,
} from "../bprf/index.js";
import { validateBprfArtifact } from "../bprf/index.js";
import { selectBprfRealization } from "../bprf/testing-reference.js";
import {
	CSH_FIELD_MODULUS,
	validateCover,
	type ChartCellTransform,
	type ChartCover,
} from "./reference.js";

export interface BprfCshTestingEmission {
	readonly source: string;
	readonly entryName: string;
	readonly byteLength: number;
	readonly realizationId: string;
	readonly familyCode: 0 | 1;
	readonly coverIds: readonly string[];
	readonly chartLocalCodeletCount: number;
	readonly fragmentCodeletCount: number;
	readonly contributorCodeletCount: number;
	readonly reductionCount: number;
	readonly projectionCodeletCount: number;
}

interface PowerRegistry {
	name(exponent: number): string;
	source(): string[];
}

/**
 * Emit one caller-specialized finite-field integer/boolean BPRF-over-CSH
 * implementation.
 *
 * Narrow ABI: `entry(inputs) -> outputs`. Caller context, covers, residual
 * entropy, bases, and all routing are owner-side inputs baked into the source.
 */
export function emitBprfOverCshTestingSource(
	artifact: BprfArtifact,
	context: BprfCallerContext,
	covers: readonly ChartCover[],
	seed: number
): BprfCshTestingEmission {
	validateBprfArtifact(artifact);
	const realization = selectBprfRealization(artifact, context);
	validatePlan(realization, covers);

	const powers = createPowerRegistry();
	const body: string[] = ['"use strict";', emitNormalizer()];
	let chartLocalCodeletCount = 0;
	let fragmentCodeletCount = 0;
	let contributorCodeletCount = 0;
	let reductionCount = 0;
	let projectionCodeletCount = 0;

	const ingressResiduals = residualMatrix(
		realization.frameSize,
		covers[0]!.threshold - 1,
		deriveSeed(
			deriveSeed(
				seed >>> 0,
				`bprf-csh-ingress:${realization.id}`
			),
			`csh-ingress:${covers[0]!.id}`
		)
	);
	for (let chartIndex = 0; chartIndex < 5; chartIndex++) {
		body.push(
			emitIngressChart(
				realization,
				covers[0]!,
				chartIndex,
				ingressResiduals,
				powers
			)
		);
		chartLocalCodeletCount++;
	}

	const entryLines: string[] = [
		"function __ruamBprfCshSpike(a){",
		emitInputAbi(realization),
		...Array.from(
			{ length: 5 },
			(_, chartIndex) => `let c${chartIndex}=i${chartIndex}(a);`
		),
	];

	for (
		let transitionIndex = 0;
		transitionIndex < realization.transitions.length;
		transitionIndex++
	) {
		const transition = realization.transitions[transitionIndex]!;
		const from = covers[transitionIndex]!;
		const to = covers[transitionIndex + 1]!;
		const inverseFromMixing = invertMatrix(from.mixing);
		const sourceWeights = interpolationWeightsAtZero(
			from.charts.map((chart) => chart.point)
		);
		const transitionSeed = deriveSeed(
			seed >>> 0,
			`bprf-csh-transition:${realization.id}:${transition.id}`
		);
		const transitionResiduals = residualCube(
			5,
			to.width,
			to.threshold - 1,
			transitionSeed
		);

		for (let sourceIndex = 0; sourceIndex < 5; sourceIndex++) {
			body.push(
				emitLocalChartOpening(
					transitionIndex,
					sourceIndex,
					from,
					inverseFromMixing,
					powers
				)
			);
			chartLocalCodeletCount++;
			for (
				let fragmentIndex = 0;
				fragmentIndex < realization.fragments.length;
				fragmentIndex++
			) {
				body.push(
					emitChartFragment(
						realization,
						transitionIndex,
						sourceIndex,
						fragmentIndex,
						transition.phase
					)
				);
				fragmentCodeletCount++;
			}
			body.push(
				emitLocalChartMerge(
					realization,
					transitionIndex,
					sourceIndex,
					transition.phase
				)
			);
			chartLocalCodeletCount++;
		}

		for (let targetIndex = 0; targetIndex < 5; targetIndex++) {
			for (let sourceIndex = 0; sourceIndex < 5; sourceIndex++) {
				body.push(
					emitDegreeContribution(
						transitionIndex,
						targetIndex,
						sourceIndex,
						to,
						sourceWeights[sourceIndex]!,
						transitionResiduals[sourceIndex]!
					)
				);
				contributorCodeletCount++;
			}
			body.push(
				emitTargetWrap(
					transitionIndex,
					targetIndex,
					to,
					powers
				)
			);
			reductionCount++;
		}

		for (let sourceIndex = 0; sourceIndex < 5; sourceIndex++) {
			entryLines.push(
				`const U${transitionIndex}_${sourceIndex}=u${transitionIndex}_${sourceIndex}(c${sourceIndex});`
			);
			for (
				let fragmentIndex = 0;
				fragmentIndex < realization.fragments.length;
				fragmentIndex++
			) {
				entryLines.push(
					`const G${transitionIndex}_${sourceIndex}_${fragmentIndex}=g${transitionIndex}_${sourceIndex}_${fragmentIndex}(U${transitionIndex}_${sourceIndex});`
				);
			}
			entryLines.push(
				`const L${transitionIndex}_${sourceIndex}=l${transitionIndex}_${sourceIndex}(U${transitionIndex}_${sourceIndex},${Array.from(
					{ length: realization.fragments.length },
					(_, fragmentIndex) =>
						`G${transitionIndex}_${sourceIndex}_${fragmentIndex}`
				).join(",")});`
			);
		}
		for (let targetIndex = 0; targetIndex < 5; targetIndex++) {
			for (let sourceIndex = 0; sourceIndex < 5; sourceIndex++) {
				entryLines.push(
					`const D${transitionIndex}_${targetIndex}_${sourceIndex}=d${transitionIndex}_${targetIndex}_${sourceIndex}(L${transitionIndex}_${sourceIndex});`
				);
			}
			entryLines.push(
				`const z${transitionIndex}_${targetIndex}=w${transitionIndex}_${targetIndex}(${Array.from(
					{ length: 5 },
					(_, sourceIndex) =>
						`D${transitionIndex}_${targetIndex}_${sourceIndex}`
				).join(",")});`
			);
		}
		for (let targetIndex = 0; targetIndex < 5; targetIndex++) {
			entryLines.push(`c${targetIndex}=z${transitionIndex}_${targetIndex};`);
		}
	}

	const finalCover = covers[covers.length - 1]!;
	const inverseFinalMixing = invertMatrix(finalCover.mixing);
	for (let outputIndex = 0; outputIndex < realization.outputPorts.length; outputIndex++) {
		const port = realization.outputPorts[outputIndex]!;
		const inverseScale = inverse(port.basis.scale);
		const secretCoefficients = inverseFinalMixing[port.slot]!.map(
			(value) => multiply(inverseScale, value)
		);
		const projectionBase = subtract(
			subtract(0, multiply(port.basis.bias, inverseScale)),
			dot(secretCoefficients, finalCover.bias)
		);
		const weights = interpolationWeightsAtZero(
			finalCover.charts.map((chart) => chart.point)
		);
		for (let chartIndex = 0; chartIndex < 5; chartIndex++) {
			body.push(
				emitProjectionContribution(
					outputIndex,
					chartIndex,
					finalCover,
					secretCoefficients,
					weights[chartIndex]!,
					powers
				)
			);
			projectionCodeletCount++;
		}
		entryLines.push(
			`const y${outputIndex}=n(${fieldSource(projectionBase)}+${Array.from(
				{ length: 5 },
				(_, chartIndex) => `j${outputIndex}_${chartIndex}(c${chartIndex})`
			).join("+")});`
		);
	}
	entryLines.push(
		`return [${realization.outputPorts
			.map((port, outputIndex) =>
				outputExpression(
					`y${outputIndex}`,
					port.typeCode === 0 ? "number" : "boolean",
					realization.familyCode
				)
			)
			.join(",")}];`,
		"}"
	);

	body.push(...powers.source(), ...entryLines);
	const source = body.join("\n");
	return Object.freeze({
		source,
		entryName: "__ruamBprfCshSpike",
		byteLength: Buffer.byteLength(source, "utf8"),
		realizationId: realization.id,
		familyCode: realization.familyCode,
		coverIds: Object.freeze(covers.map((cover) => cover.id)),
		chartLocalCodeletCount,
		fragmentCodeletCount,
		contributorCodeletCount,
		reductionCount,
		projectionCodeletCount,
	});
}

function emitIngressChart(
	realization: BprfRealization,
	cover: ChartCover,
	chartIndex: number,
	residuals: readonly (readonly number[])[],
	powers: PowerRegistry
): string {
	const descriptor = cover.charts[chartIndex]!;
	const cells = Array.from({ length: cover.width }, (_, mixedLane) => {
		const terms = [fieldSource(cover.bias[mixedLane]!)];
		for (let inputIndex = 0; inputIndex < realization.inputPorts.length; inputIndex++) {
			const port = realization.inputPorts[inputIndex]!;
			const coordinate =
				port.typeCode === 0
					? `n(a[${inputIndex}])`
					: realization.familyCode === 0
						? `(a[${inputIndex}]?1:0)`
						: `(a[${inputIndex}]?1:${CSH_FIELD_MODULUS - 1})`;
			const encoded = `n((${coordinate})*${fieldSource(port.basis.scale)}+${fieldSource(port.basis.bias)})`;
			terms.push(
				`${fieldSource(cover.mixing[mixedLane]![port.slot]!)}*(${encoded})`
			);
		}
		let pointPower = descriptor.point;
		for (const residual of residuals[mixedLane]!) {
			terms.push(`${fieldSource(residual)}*${fieldSource(pointPower)}`);
			pointPower = multiply(pointPower, descriptor.point);
		}
		const raw = `n(${terms.join("+")})`;
		return `s${mixedLane}:${wrapExpression(
			raw,
			descriptor.cells[mixedLane]!,
			powers
		)}`;
	});
	return `function i${chartIndex}(a){return{${cells.join(",")}};}`;
}

function emitLocalChartOpening(
	transitionIndex: number,
	sourceIndex: number,
	cover: ChartCover,
	inverseMixing: readonly (readonly number[])[],
	powers: PowerRegistry
): string {
	const descriptor = cover.charts[sourceIndex]!;
	const rawNames = Array.from(
		{ length: cover.width },
		(_, lane) => `r${lane}`
	);
	const lines = rawNames.map(
		(name, lane) =>
			`const ${name}=${unwrapExpression(
				`c.s${lane}`,
				descriptor.cells[lane]!,
				powers
			)};`
	);
	const fields = Array.from({ length: cover.width }, (_, frameLane) => {
		const terms = Array.from(
			{ length: cover.width },
			(_, mixedLane) =>
				`${fieldSource(inverseMixing[frameLane]![mixedLane]!)}*n(${rawNames[mixedLane]}-${fieldSource(cover.bias[mixedLane]!)})`
		);
		return `s${frameLane}:n(${terms.join("+")})`;
	});
	return `function u${transitionIndex}_${sourceIndex}(c){${lines.join("")}return{${fields.join(",")}};}`;
}

function emitChartFragment(
	realization: BprfRealization,
	transitionIndex: number,
	sourceIndex: number,
	fragmentIndex: number,
	phase: number
): string {
	const transition = realization.transitions[phase]!;
	const fragment = realization.fragments[fragmentIndex]!;
	const fields = transition.writes.map((destination) => {
		const pieces = fragment.pieces.filter(
			(piece) =>
				piece.phase === phase && piece.destination === destination
		);
		if (pieces.length === 0) {
			throw new Error("RUAM_BPRF_CSH_EMITTER_MISSING_FRAGMENT_SHARE");
		}
		return `s${destination}:n(${pieces
			.map(fieldPieceExpression)
			.join("+")})`;
	});
	return `function g${transitionIndex}_${sourceIndex}_${fragmentIndex}(q){return{${fields.join(",")}};}`;
}

function emitLocalChartMerge(
	realization: BprfRealization,
	transitionIndex: number,
	sourceIndex: number,
	phase: number
): string {
	const transition = realization.transitions[phase]!;
	const writes = new Set(transition.writes);
	const parameters = [
		"q",
		...Array.from(
			{ length: realization.fragments.length },
			(_, fragmentIndex) => `p${fragmentIndex}`
		),
	];
	const fields = Array.from({ length: realization.frameSize }, (_, slot) => {
		if (!writes.has(slot)) return `s${slot}:q.s${slot}`;
		const pieces = realization.fragments.flatMap((fragment) =>
			fragment.pieces.filter(
				(piece) => piece.phase === phase && piece.destination === slot
			)
		);
		const basis = pieces[0]!.destinationBasis;
		const sum = Array.from(
			{ length: realization.fragments.length },
			(_, fragmentIndex) => `p${fragmentIndex}.s${slot}`
		).join("+");
		return `s${slot}:n(n(${sum})*${fieldSource(basis.scale)}+${fieldSource(basis.bias)})`;
	});
	return `function l${transitionIndex}_${sourceIndex}(${parameters.join(",")}){return{${fields.join(",")}};}`;
}

function emitDegreeContribution(
	transitionIndex: number,
	targetIndex: number,
	sourceIndex: number,
	to: ChartCover,
	sourceWeight: number,
	residuals: readonly (readonly number[])[],
): string {
	const target = to.charts[targetIndex]!;
	const fields = Array.from({ length: to.width }, (_, mixedLane) => {
		const mixedTerms = [
			fieldSource(to.bias[mixedLane]!),
			...Array.from(
				{ length: to.width },
				(_, frameLane) =>
					`${fieldSource(to.mixing[mixedLane]![frameLane]!)}*q.s${frameLane}`
			),
		];
		const terms = [
			`${fieldSource(sourceWeight)}*n(${mixedTerms.join("+")})`,
		];
		let pointPower = target.point;
		for (const residual of residuals[mixedLane]!) {
			terms.push(`${fieldSource(residual)}*${fieldSource(pointPower)}`);
			pointPower = multiply(pointPower, target.point);
		}
		return `s${mixedLane}:n(${terms.join("+")})`;
	});
	return `function d${transitionIndex}_${targetIndex}_${sourceIndex}(q){return{${fields.join(",")}};}`;
}

function emitTargetWrap(
	transitionIndex: number,
	targetIndex: number,
	to: ChartCover,
	powers: PowerRegistry
): string {
	const target = to.charts[targetIndex]!;
	const parameters = Array.from({ length: 5 }, (_, index) => `d${index}`);
	const fields = Array.from({ length: to.width }, (_, lane) => {
		const reduced = `n(${parameters
			.map((parameter) => `${parameter}.s${lane}`)
			.join("+")})`;
		return `s${lane}:${wrapExpression(
			reduced,
			target.cells[lane]!,
			powers
		)}`;
	});
	return `function w${transitionIndex}_${targetIndex}(${parameters.join(",")}){return{${fields.join(",")}};}`;
}

function emitProjectionContribution(
	outputIndex: number,
	chartIndex: number,
	cover: ChartCover,
	secretCoefficients: readonly number[],
	weight: number,
	powers: PowerRegistry
): string {
	const descriptor = cover.charts[chartIndex]!;
	const terms = Array.from({ length: cover.width }, (_, lane) => {
		const coefficient = multiply(secretCoefficients[lane]!, weight);
		return `${fieldSource(coefficient)}*(${unwrapExpression(
			`c.s${lane}`,
			descriptor.cells[lane]!,
			powers
		)})`;
	});
	return `function j${outputIndex}_${chartIndex}(c){return n(${terms.join("+")});}`;
}

function fieldPieceExpression(piece: BprfPiece): string {
	let expression = fieldSource(coefficientToField(piece.coefficient));
	for (const factor of piece.factors) {
		const inverseScale = inverse(factor.basis.scale);
		const coordinate = `n(n(q.s${factor.slot}-${fieldSource(factor.basis.bias)})*${fieldSource(inverseScale)})`;
		expression += `*n(${coordinate}+${fieldSource(factor.offset)})`;
	}
	return `n(${expression})`;
}

function wrapExpression(
	raw: string,
	transform: ChartCellTransform,
	powers: PowerRegistry
): string {
	return `${powers.name(transform.exponent)}(n(${fieldSource(transform.scale)}*(${raw})+${fieldSource(transform.offset)}))`;
}

function unwrapExpression(
	stored: string,
	transform: ChartCellTransform,
	powers: PowerRegistry
): string {
	return `n(n(${powers.name(transform.inverseExponent)}(${stored})-${fieldSource(transform.offset)})*${fieldSource(inverse(transform.scale))})`;
}

function createPowerRegistry(): PowerRegistry {
	const names = new Map<number, string>();
	const definitions: string[] = [];
	return {
		name(exponent: number): string {
			const existing = names.get(exponent);
			if (existing) return existing;
			const name = `k${names.size}`;
			names.set(exponent, name);
			const lines = [`function ${name}(x){let b=n(x),r=1;`];
			let remaining = exponent;
			while (remaining > 0) {
				if (remaining % 2 === 1) lines.push("r=n(r*b);");
				remaining = Math.floor(remaining / 2);
				if (remaining > 0) lines.push("b=n(b*b);");
			}
			lines.push("return r;}");
			definitions.push(lines.join(""));
			return name;
		},
		source(): string[] {
			return definitions.slice();
		},
	};
}

function emitInputAbi(realization: BprfRealization): string {
	const checks = [
		`if(!Array.isArray(a)||a.length!==${realization.inputPorts.length})throw new Error("RUAM_CSH_INPUT_ABI");`,
	];
	for (let index = 0; index < realization.inputPorts.length; index++) {
		const port = realization.inputPorts[index]!;
		checks.push(
			port.typeCode === 0
				? `if(typeof a[${index}]!=="number"||!Number.isSafeInteger(a[${index}])||Math.abs(a[${index}])>=${CSH_FIELD_MODULUS / 4})throw new Error("RUAM_CSH_INPUT_ABI");`
				: `if(typeof a[${index}]!=="boolean")throw new Error("RUAM_CSH_INPUT_ABI");`
		);
	}
	return checks.join("");
}

function outputExpression(
	fieldName: string,
	type: PureValueType,
	familyCode: 0 | 1
): string {
	if (type === "number") {
		return `(${fieldName}>${Math.floor(CSH_FIELD_MODULUS / 2)}?${fieldName}-${CSH_FIELD_MODULUS}:${fieldName})`;
	}
	if (familyCode === 0) return `(${fieldName}!==0)`;
	return `((${fieldName}>${Math.floor(CSH_FIELD_MODULUS / 2)}?${fieldName}-${CSH_FIELD_MODULUS}:${fieldName})>0)`;
}

function validatePlan(
	realization: BprfRealization,
	covers: readonly ChartCover[]
): void {
	if (covers.length !== realization.transitions.length + 1) {
		throw new Error("RUAM_BPRF_CSH_EMITTER_COVER_COUNT");
	}
	const ids = new Set<string>();
	const epochs = new Set<number>();
	for (const cover of covers) {
		validateCover(cover);
		if (
			cover.width !== realization.frameSize ||
			cover.charts.length !== 5 ||
			cover.threshold !== 3
		) {
			throw new Error("RUAM_BPRF_CSH_EMITTER_COVER_PROFILE");
		}
		if (ids.has(cover.id)) {
			throw new Error("RUAM_BPRF_CSH_EMITTER_COVER_REUSE");
		}
		if (epochs.has(cover.epoch)) {
			throw new Error("RUAM_BPRF_CSH_EMITTER_EPOCH_REUSE");
		}
		ids.add(cover.id);
		epochs.add(cover.epoch);
	}
}

function residualCube(
	outer: number,
	width: number,
	degree: number,
	seed: number
): number[][][] {
	const random = createSeededRandom(seed);
	return Array.from({ length: outer }, () =>
		Array.from({ length: width }, () =>
			Array.from(
				{ length: degree },
				() => random.nextUint32() % CSH_FIELD_MODULUS
			)
		)
	);
}

function residualMatrix(
	width: number,
	degree: number,
	seed: number
): number[][] {
	const random = createSeededRandom(seed);
	return Array.from({ length: width }, () =>
		Array.from(
			{ length: degree },
			() => random.nextUint32() % CSH_FIELD_MODULUS
		)
	);
}

function emitNormalizer(): string {
	return `function n(x){x=Math.trunc(x)%${CSH_FIELD_MODULUS};return x<0?x+${CSH_FIELD_MODULUS}:x;}`;
}

function fieldSource(value: number): string {
	return String(normalize(value));
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

function dot(left: readonly number[], right: readonly number[]): number {
	let value = 0;
	for (let index = 0; index < left.length; index++) {
		value = add(value, multiply(left[index]!, right[index]!));
	}
	return value;
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
