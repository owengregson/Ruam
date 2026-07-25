import { describe, expect, it } from "bun:test";
import { buildPaddedMaskedCustodyAttackerReport } from "./support/padded-masked-custody-attacker.js";

describe("fixed-bucket masked custody attacker gates", () => {
	it(
		"leaks the declared bucket but does not empirically classify corrected placement or stage count",
		() => {
			const report = buildPaddedMaskedCustodyAttackerReport();

			expect(report.decision).toBe("supports-fixed-bucket-claim");
			expect(
				report.acceptedBucketLeakage
					.exactBucketClassificationAccuracy
			).toBe(1);
			expect(report.structuralShape.placementShapeMatch).toBe(true);
			expect(report.structuralShape.stageCountShapeMatch).toBe(true);
			expect(report.structuralShape.perEpochShapeMatch).toBe(true);

			expect(
				report.placementDistribution.preFixRealSlotCounts
			).toEqual([
				3_093, 2_978, 3_101, 2_893, 2_627, 2_016, 2_495, 797,
			]);
			expect(
				report.placementDistribution
					.preFixMaximumDeviationPercentagePoints
			).toBeGreaterThan(15);
			expect(report.placementDistribution.preFixDecision).toBe(
				"leakage-detected"
			);
			expect(
				report.placementDistribution
					.preFixHeldOutBalancedAccuracy
			).toBeGreaterThan(0.69);
			expect(
				report.placementDistribution.correctedRealSlotCounts
			).toEqual([
				2_462, 2_610, 2_517, 2_504, 2_512, 2_490, 2_434,
				2_471,
			]);
			expect(
				report.placementDistribution
					.correctedMaximumDeviationPercentagePoints
			).toBeLessThan(2);

			expect(report.placementLeakage.finalOutputClassCount).toBe(1);
			expect(
				report.placementLeakage.heldOutBalancedAccuracy
			).toBeLessThanOrEqual(
				report.placementLeakage.chanceBalancedAccuracy + 0.1
			);
			expect(
				report.placementLeakage.payloadOnlyBalancedAccuracy
			).toBeLessThanOrEqual(0.6);
			expect(report.stageCountLeakage.finalOutputClassCount).toBe(1);
			expect(
				report.stageCountLeakage.heldOutAccuracy
			).toBeLessThanOrEqual(
				report.stageCountLeakage.chanceAccuracy + 0.1
			);

			expect(
				report.protocolSeparation.directForeignResponseAccepted
			).toBe(false);
			expect(
				report.protocolSeparation.fieldReboundResponseAccepted
			).toBe(false);
			expect(
				report.protocolSeparation
					.protectedMaskedStateCoordinateMatch
			).toBeLessThan(1);
			expect(
				report.protocolSeparation
					.signedContributionCoordinateMatch
			).toBeLessThan(1);
			expect(
				report.protocolSeparation
					.stateSubstitutionAcceptedByNextServerBoundary
			).toBe(false);

			expect(report.overhead.transitionWorkMultiplier).toBe(4);
			expect(report.overhead.fullTraceMultiplier).toBeGreaterThan(3);
			expect(report.hooks.localizedHookFamilies).toBe(2);
			expect(report.hooks.transitionHookEvents).toBe(8);
			expect(report.failedClaims).toEqual([]);
			expect(report.classifierCaveat).toContain("not a proof");
		},
		// This deterministic statistical gate constructs hundreds of complete
		// padded custody transcripts. Slower shared CI runners need more than
		// Bun's default 5s and have occasionally crossed the former 15s cap.
		60_000
	);
});
