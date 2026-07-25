import { describe, expect, it } from "bun:test";
import { buildMaskedCustodyAttackerReport } from "./support/masked-custody-attacker.js";

describe("statefully masked custody dynamic-attacker gates", () => {
	it("separates internal masking strength from final-oracle learnability", () => {
		const report = buildMaskedCustodyAttackerReport();

		expect(report.decision).toBe("no-go");
		expect(report.clientArtifact.hiddenRelationMaterialPresent).toBe(false);

		expect(report.internalRecovery.ingressLogicalStateRecovery).toBe(1);
		expect(report.internalRecovery.maskedStateRecovery).toBe(1);
		expect(report.internalRecovery.maskedTransitionDeltaRecovery).toBe(1);
		expect(
			report.internalRecovery.protectedLogicalCoordinateGuessAccuracy
		).toBe(0);
		expect(
			report.internalRecovery.unmaskedDeltaCoordinateGuessAccuracy
		).toBe(0);
		expect(
			report.internalRecovery.compatibleLogicalStatesPerProtectedObservation
		).toBe("281281747415761");
		expect(
			report.internalRecovery.freshMaskWholeStateGuessProbability
		).toBeLessThan(1e-12);

		expect(report.crossSession.directSignedResponseAccepted).toBe(false);
		expect(report.crossSession.fieldReboundResponseAccepted).toBe(false);
		expect(
			report.crossSession.maskedStateCoordinateTransferAccuracy
		).toBe(0);
		expect(
			report.crossSession.maskedDeltaCoordinateTransferAccuracy
		).toBe(0);
		expect(report.crossSession.finalProjectionTransferAccuracy).toBe(1);
		expect(report.crossSession.sharedServiceSecrets).toBe(true);
		expect(report.crossSession.nonceReuseAcrossSessions).toBe(true);
		expect(report.crossSession.freshVerificationKeys).toBe(true);

		expect(report.chosenInputOracle.totalDegreeBound).toBe(9);
		expect(report.chosenInputOracle.trainingQueries).toBe(220);
		expect(report.chosenInputOracle.heldOutOutputAccuracy).toBe(1);
		expect(report.chosenInputOracle.evidenceSource).toBe(
			"black-box-io-only"
		);
		expect(
			report.chosenInputOracle.intermediateRelationRecovered
		).toBe(false);
		expect(report.chosenInputOracle.intermediateStateRecovered).toBe(
			false
		);

		expect(report.dynamicProxy.localizedHookFamilies).toBe(2);
		expect(report.dynamicProxy.traceAmplificationRatio).toBeLessThan(10);
		expect(report.dynamicProxy.reconstructionWorkRatio).toBeLessThan(10);
		expect(report.dynamicProxy.residentStorageRatio).toBeLessThan(10);

		expect(report.failedGates).toEqual([
			"MASKED-CUSTODY-FINAL-ORACLE-NONLEARNABILITY",
			"MASKED-CUSTODY-TRACE-AMPLIFICATION",
			"MASKED-CUSTODY-RECONSTRUCTION-WORK",
			"MASKED-CUSTODY-RESIDENT-STORAGE",
			"MASKED-CUSTODY-HOOK-COLLAPSE",
		]);
	});
});
