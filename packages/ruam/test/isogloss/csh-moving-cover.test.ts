import { describe, expect, it } from "bun:test";
import * as cshReference from "../../src/isogloss/csh/reference.js";
import {
	CSH_FIELD_MODULUS,
	createChartCover,
	encodeIngressCharts,
	evaluateCertifiedProjection,
	transportAffineCharts,
	validateCover,
	type AffineChartTransition,
	type CertifiedProjectionSite,
} from "../../src/isogloss/csh/reference.js";

const coordinate = (
	width: number,
	index: number,
	id = `projection_${index}`
): CertifiedProjectionSite => ({
	id,
	coefficients: Array.from({ length: width }, (_, lane) =>
		lane === index ? 1 : 0
	),
	bias: 0,
});

const applyAffine = (
	values: readonly number[],
	transition: AffineChartTransition
): number[] =>
	transition.matrix.map((row, rowIndex) => {
		let value = transition.bias[rowIndex]!;
		for (let column = 0; column < values.length; column++) {
			value += row[column]! * values[column]!;
		}
		value %= CSH_FIELD_MODULUS;
		return value < 0 ? value + CSH_FIELD_MODULUS : value;
	});

describe("moving-cover CSH reference", () => {
	it("creates deterministic nonlinear five-chart covers with threshold three", () => {
		const first = createChartCover({ seed: 41, epoch: 0, width: 3 });
		const replay = createChartCover({ seed: 41, epoch: 0, width: 3 });
		const next = createChartCover({ seed: 41, epoch: 1, width: 3 });

		expect(first).toEqual(replay);
		expect(first.charts).toHaveLength(5);
		expect(first.threshold).toBe(3);
		expect(new Set(first.charts.map((chart) => chart.point)).size).toBe(5);
		expect(first.charts.every((chart) => chart.overlaps.length === 4)).toBe(
			true
		);
		expect(
			first.charts.every((chart) =>
				chart.cells.every(
					(cell) =>
						cell.exponent > 1 &&
						(cell.exponent * cell.inverseExponent) %
							(CSH_FIELD_MODULUS - 1) ===
							1
				)
			)
		).toBe(true);
		expect(next.id).not.toBe(first.id);
		expect(next.mixing).not.toEqual(first.mixing);
		expect(next.charts.map((chart) => chart.owner)).not.toEqual(
			first.charts.map((chart) => chart.owner)
		);
		validateCover(first);
		validateCover(next);
	});

	it("requires threshold contributions and never exports a global decoder", () => {
		const cover = createChartCover({ seed: 73, epoch: 0, width: 3 });
		const charts = encodeIngressCharts([17, 29, 43], cover, 19);
		const site = coordinate(3, 1);

		for (const selection of [
			charts.slice(0, 3),
			charts.slice(1, 4),
			[charts[0]!, charts[2]!, charts[4]!],
			charts,
		]) {
			expect(evaluateCertifiedProjection(selection, cover, site)).toBe(29);
		}
		expect(() =>
			evaluateCertifiedProjection(charts.slice(0, 2), cover, site)
		).toThrow("RUAM_CSH_THRESHOLD_NOT_MET");
		expect(() =>
			evaluateCertifiedProjection([charts[0]!, charts[0]!, charts[1]!], cover, site)
		).toThrow("RUAM_CSH_DUPLICATE_CONTRIBUTION");
		expect(
			Object.keys(cshReference).some((name) =>
				/(decode|reconstruct|global.?frame|global.?section)/i.test(name)
			)
		).toBe(false);
	});

	it("transports two affine transitions across distinct covers without a frame API", () => {
		const covers = [0, 1, 2].map((epoch) =>
			createChartCover({ seed: 2026, epoch, width: 3 })
		);
		const firstTransition: AffineChartTransition = {
			id: "r0_r1",
			matrix: [
				[2, 1, 0],
				[0, 3, 1],
				[1, 0, 1],
			],
			bias: [5, 7, 11],
		};
		const secondTransition: AffineChartTransition = {
			id: "r1_r2",
			matrix: [
				[1, 0, 2],
				[4, 1, 0],
				[0, 1, 1],
			],
			bias: [13, 17, 19],
		};
		const initial = [23, 31, 47];
		const expectedOne = applyAffine(initial, firstTransition);
		const expectedTwo = applyAffine(expectedOne, secondTransition);
		const chartsZero = encodeIngressCharts(initial, covers[0]!, 101);
		const chartsOne = transportAffineCharts(
			chartsZero,
			covers[0]!,
			covers[1]!,
			firstTransition,
			103
		);
		const chartsTwo = transportAffineCharts(
			chartsOne,
			covers[1]!,
			covers[2]!,
			secondTransition,
			107
		);

		for (let coordinateIndex = 0; coordinateIndex < 3; coordinateIndex++) {
			expect(
				evaluateCertifiedProjection(
					chartsOne.slice(0, 3),
					covers[1]!,
					coordinate(3, coordinateIndex)
				)
			).toBe(expectedOne[coordinateIndex]);
			expect(
				evaluateCertifiedProjection(
					[chartsTwo[0]!, chartsTwo[2]!, chartsTwo[4]!],
					covers[2]!,
					coordinate(3, coordinateIndex)
				)
			).toBe(expectedTwo[coordinateIndex]);
		}
		expect(chartsOne.every((chart) => chart.coverId === covers[1]!.id)).toBe(
			true
		);
		expect(chartsTwo.every((chart) => chart.coverId === covers[2]!.id)).toBe(
			true
		);
		expect(() =>
			evaluateCertifiedProjection(
				chartsOne,
				covers[0]!,
				coordinate(3, 0)
			)
		).toThrow("RUAM_CSH_WRONG_COVER");
	});

	it("supports only site-specific scalar projection and rejects malformed cover changes", () => {
		const cover = createChartCover({ seed: 99, epoch: 0, width: 2 });
		const sameEpoch = createChartCover({ seed: 100, epoch: 0, width: 2 });
		const charts = encodeIngressCharts([9, 12], cover, 88);
		const sumSite: CertifiedProjectionSite = {
			id: "return_sum",
			coefficients: [1, 1],
			bias: 7,
		};
		expect(evaluateCertifiedProjection(charts, cover, sumSite)).toBe(28);
		expect(() =>
			transportAffineCharts(
				charts,
				cover,
				sameEpoch,
				{
					id: "invalid",
					matrix: [
						[1, 0],
						[0, 1],
					],
					bias: [0, 0],
				},
				5
			)
		).toThrow("RUAM_CSH_COVER_DID_NOT_CHANGE");
		expect(() =>
			createChartCover({
				seed: 1,
				epoch: 0,
				width: 2,
				chartCount: 4,
			})
		).toThrow("RUAM_CSH_INSUFFICIENT_CHARTS");
	});

	it("does not serialize canonical execution identities or a complete logical frame", () => {
		const cover = createChartCover({ seed: 53, epoch: 4, width: 3 });
		const charts = encodeIngressCharts([1, 2, 3], cover, 59);
		const serialized = JSON.stringify({ cover, charts }).toLowerCase();

		for (const forbidden of [
			"semanticop",
			"handler",
			"opcode",
			"operand",
			"sourcenode",
			"globalframe",
			"logicalvalues",
		]) {
			expect(serialized).not.toContain(forbidden);
		}
		expect(charts.every((chart) => chart.cells.length === 3)).toBe(true);
		expect(charts.every((chart) => Object.isFrozen(chart))).toBe(true);
	});
});
