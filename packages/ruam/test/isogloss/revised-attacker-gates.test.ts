import { describe, expect, it } from "bun:test";
import {
	buildRevisedAttackerGoNoGoReport,
	REVISED_ATTACKER_REPORT_VERSION,
} from "./support/revised-attacker-gates.js";

describe("revised BPRF/CSH attacker gates", () => {
	it("is deterministic and records an honest no-go instead of hiding failures", () => {
		const first = buildRevisedAttackerGoNoGoReport();
		const replay = buildRevisedAttackerGoNoGoReport();

		expect(first.schemaVersion).toBe(REVISED_ATTACKER_REPORT_VERSION);
		expect(replay).toEqual(first);
		expect(first.decision).toBe("no-go");
		expect(first.failedGates).toEqual([
			"BPRF-ARTIFACT-AWARE-TRANSFER-DROP",
			"BPRF-FULL-STEP-O90",
			"CSH-G90-WORK-AMPLIFICATION",
			"CSH-STORAGE-AMPLIFICATION",
			"CSH-COVER-TRANSFER",
			"CSH-LOCAL-PROBE-COLLAPSE",
			"BPRF-CSH-G90-WORK-AMPLIFICATION",
			"BPRF-CSH-FULL-TRACE-AMPLIFICATION",
			"BPRF-CSH-CLIENT-TRACE-COMPLETENESS",
			"CUSTODY-BYPASS",
			"CUSTODY-CHART-DELTA-LEAKAGE",
		]);
		expect(first.unevaluatedGates).toEqual([
			"BPRF-O1-OP-F1",
			"BPRF-PATCH-COLLAPSE",
			"CUSTODY-PFE-TOPOLOGY",
		]);
	});

	it("distinguishes naive contextual diversity from artifact-aware recovery", () => {
		const report = buildRevisedAttackerGoNoGoReport();
		const transfer = report.bprf.contextTransfer;

		expect(transfer.seenRealizationIdentityRecall).toBe(1);
		expect(transfer.unseenRealizationIdentityRecall).toBe(0);
		expect(transfer.naiveTransferLossPercentagePoints).toBe(1);
		expect(transfer.artifactAwareUnseenRecall).toBe(1);
		expect(transfer.artifactAwareTransferLossPercentagePoints).toBe(0);
		expect(report.bprf.artifactRecovery.heldOutOutputAccuracy).toBe(1);
		expect(report.bprf.artifactRecovery.physicalTopologyRecall).toBe(1);
		expect(
			report.bprf.artifactRecovery.dynamicPrimitiveObservationsRequired
		).toBe(0);
		expect(report.bprf.artifactRecovery.clientFunctionallyComplete).toBe(true);
		expect(report.bprf.artifactRecovery.canonicalSourceMappingRecovered).toBe(
			false
		);
	});

	it("measures threshold recovery and both weak and strong cover-transfer attacks", () => {
		const report = buildRevisedAttackerGoNoGoReport();

		expect(report.csh.c90.configuredThreshold).toBe(3);
		expect(report.csh.c90.minimumContributionsFor90Percent).toBe(3);
		expect(
			report.csh.c90.recoveryByContributionCount.map((entry) => entry.recovery)
		).toEqual([0, 0, 1, 1, 1]);
		expect(report.csh.coverTransfer.sourceCoverAccuracy).toBe(1);
		expect(report.csh.coverTransfer.fixedDecoderUnseenAccuracy).toBe(0);
		expect(report.csh.coverTransfer.fixedDecoderLossPercentagePoints).toBe(1);
		expect(report.csh.coverTransfer.metadataAwareUnseenAccuracy).toBe(1);
		expect(report.csh.coverTransfer.metadataAwareLossPercentagePoints).toBe(0);
		expect(report.csh.amplification.g90WorkRatio).toBe(3);
		expect(report.csh.amplification.residentStorageRatio).toBe(5);
	});

	it("shows that combined traces amplify fivefold but remain client-decodable", () => {
		const report = buildRevisedAttackerGoNoGoReport();

		expect(report.combined.outputAccuracy).toBe(1);
		expect(report.combined.finalFrameRecovery).toBe(1);
		expect(report.combined.amplification.g90WorkRatio).toBe(3);
		expect(report.combined.amplification.residentStorageRatio).toBe(5);
		expect(report.combined.amplification.fullTraceObservationRatio).toBe(5);
	});

	it("credits custody replay protection while detecting the learnable reference relation", () => {
		const report = buildRevisedAttackerGoNoGoReport();
		const custody = report.custody.attack;

		expect(custody.clientCompleteBeforeResponse).toBe(false);
		expect(custody.standaloneWithoutResponseRejected).toBe(true);
		expect(custody.relationPresentInClientContract).toBe(false);
		expect(custody.replaySucceeded).toBe(false);
		expect(custody.snapshotForkSucceeded).toBe(false);
		expect(custody.learnedBypass).toEqual({
			succeeded: true,
			trainingQueries: 4,
			heldOutAccuracy: 1,
			localizedPatchSites: 1,
		});
		expect(custody.chartRelation).toEqual({
			clientCompleteBeforeResponse: false,
			minimumResponseContributionsForFullDelta: 3,
			logicalDeltaRecovery: 1,
			learnedBypass: {
				succeeded: true,
				trainingQueries: 4,
				heldOutAccuracy: 1,
				localizedPatchSites: 1,
			},
		});
		expect(custody.pfeTopologyRecoveryEvaluated).toBe(false);
	});

	it("compares observable collapse without pretending contextual IDs are operations", () => {
		const collapse = buildRevisedAttackerGoNoGoReport().hookCollapse;

		expect(collapse.legacy).toEqual({
			probeSites: 1,
			boundaryRecall: 1,
			operationF1: 1,
			recoveredStream: "semantic",
		});
		expect(collapse.bprf.probeSites).toBe(1);
		expect(collapse.bprf.contextualIdentityRecall).toBe(1);
		expect(collapse.bprf.operationF1).toBeNull();
		expect(collapse.csh.probeSites).toBe(1);
		expect(collapse.csh.logicalStateRecovery).toBe(1);
		expect(collapse.csh.operationF1).toBeNull();
		expect(collapse.combined.probeSites).toBe(1);
		expect(collapse.combined.finalFrameRecovery).toBe(1);
		expect(collapse.combined.operationF1).toBeNull();
	});
});
