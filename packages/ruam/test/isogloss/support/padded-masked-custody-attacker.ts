import { createHash } from "node:crypto";
import { deriveSeed } from "../../../src/naming/scope.js";
import { createSeededRandom } from "../../../src/random/entropy.js";
import type {
	ChartCustodyRequest,
	ChartCustodyResponse,
} from "../../../src/isogloss/csh/chart-custody-protocol.js";
import type { CustodyRequest } from "../../../src/isogloss/csh/custody-protocol.js";
import {
	applyMaskedTransitionResponse,
	createMaskedCustodyClientState,
	openMaskedCustodyProjection,
	prepareMaskedProjectionRequest,
	prepareMaskedTransitionRequest,
} from "../../../src/isogloss/csh/masked-custody-protocol.js";
import {
	createPaddedMaskedCustodyPlan,
	type PaddedMaskedCustodyPlan,
} from "../../../src/isogloss/csh/padded-masked-plan.js";
import {
	ReferenceMaskedChartCustodian,
	type HiddenMaskedTransition,
} from "../../../src/isogloss/csh/reference-masked-custodian.js";
import {
	CSH_FIELD_MODULUS,
	encodeIngressCharts,
	evaluateCertifiedProjection,
	transportAffineCharts,
	type ChartCover,
	type EncodedChart,
} from "../../../src/isogloss/csh/reference.js";

export const PADDED_MASKED_ATTACKER_REPORT_VERSION = 1 as const;

export interface PaddedMaskedAttackerReport {
	readonly schemaVersion: typeof PADDED_MASKED_ATTACKER_REPORT_VERSION;
	readonly decision: "supports-fixed-bucket-claim" | "leakage-detected";
	readonly acceptedBucketLeakage: {
		readonly width: number;
		readonly epochBucket: number;
		readonly exactBucketClassificationAccuracy: number;
		readonly leakedBy: readonly string[];
	};
	readonly structuralShape: {
		readonly placementShapeMatch: boolean;
		readonly stageCountShapeMatch: boolean;
		readonly perEpochShapeMatch: boolean;
		readonly signatureValuesExcludedFromNumericClassifier: boolean;
	};
	readonly placementDistribution: {
		readonly sampleCount: number;
		readonly expectedRealSlotRate: number;
		readonly correctedRealSlotCounts: readonly number[];
		readonly correctedMaximumDeviationPercentagePoints: number;
		readonly preFixRealSlotCounts: readonly number[];
		readonly preFixMaximumDeviationPercentagePoints: number;
		readonly preFixHeldOutBalancedAccuracy: number;
		readonly preFixDecision: "leakage-detected";
		readonly preFixLeakageCause: string;
	};
	readonly placementLeakage: {
		readonly realStageCount: number;
		readonly trainingTranscripts: number;
		readonly heldOutTranscripts: number;
		readonly heldOutSlotSamples: number;
		readonly chanceBalancedAccuracy: number;
		readonly heldOutBalancedAccuracy: number;
		readonly epochPriorBalancedAccuracy: number;
		readonly payloadOnlyBalancedAccuracy: number;
		readonly advantagePercentagePoints: number;
		readonly trainingRealSlotRateByEpoch: readonly number[];
		readonly finalOutputClassCount: number;
	};
	readonly stageCountLeakage: {
		readonly candidateStageCounts: readonly number[];
		readonly trainingTranscripts: number;
		readonly heldOutTranscripts: number;
		readonly chanceAccuracy: number;
		readonly heldOutAccuracy: number;
		readonly advantagePercentagePoints: number;
		readonly finalOutputClassCount: number;
	};
	readonly protocolSeparation: {
		readonly testedAtPaddingEpoch: number;
		readonly sharedServiceSecrets: boolean;
		readonly reusedNonceSequenceAcrossSessions: boolean;
		readonly directForeignResponseAccepted: boolean;
		readonly fieldReboundResponseAccepted: boolean;
		readonly protectedMaskedStateCoordinateMatch: number;
		readonly signedContributionCoordinateMatch: number;
		readonly stateSubstitutionAcceptedByNextServerBoundary: boolean;
	};
	readonly overhead: {
		readonly width: number;
		readonly chartCount: number;
		readonly threshold: number;
		readonly realStageCount: number;
		readonly paddedEpochCount: number;
		readonly paddingEpochCount: number;
		readonly transitionWorkMultiplier: number;
		readonly fullTraceFieldElements: number;
		readonly unpaddedTraceFieldElements: number;
		readonly fullTraceMultiplier: number;
		readonly residentChartFieldElements: number;
		readonly residentStorageMultiplierOverLogicalState: number;
	};
	readonly hooks: {
		readonly localizedHookFamilies: number;
		readonly transitionHookEvents: number;
		readonly finalOpeningHookEvents: number;
		readonly remainingSurfaces: readonly string[];
	};
	readonly classifierCaveat: string;
	readonly failedClaims: readonly string[];
}

const WIDTH = 3;
const BUCKET = 8 as const;
const CHART_COUNT = 5;
const THRESHOLD = 3;
const PLACEMENT_TRAIN_TRANSCRIPTS = 64;
const PLACEMENT_HELD_OUT_TRANSCRIPTS = 64;
const STAGE_TRAIN_PER_CLASS = 32;
const STAGE_HELD_OUT_PER_CLASS = 32;
const DISTRIBUTION_SAMPLES = 10_000;
const LEAKAGE_TOLERANCE = 0.1;
const INPUT = Object.freeze([2, 3, 5]);
const SHARED_SECRETS = Object.freeze({
	lineage: "padded-attacker-shared-lineage",
	mask: "padded-attacker-shared-mask",
	sharing: "padded-attacker-shared-sharing",
	response: "padded-attacker-shared-response",
});

const IDENTITY_TRANSPORT = Object.freeze({
	id: "padded_attacker_identity_transport",
	matrix: Object.freeze([
		Object.freeze([1, 0, 0]),
		Object.freeze([0, 1, 0]),
		Object.freeze([0, 0, 1]),
	]),
	bias: Object.freeze([0, 0, 0]),
});

const PLACEMENT_TRANSITIONS: readonly HiddenMaskedTransition[] =
	Object.freeze([
		createAffineTransition(
			Object.freeze([
				Object.freeze([1, 1, 0]),
				Object.freeze([0, 1, 0]),
				Object.freeze([0, 0, 1]),
			]),
			[3, 5, 7],
			Object.freeze([
				Object.freeze({
					inputProjection: Object.freeze([1, 0, 1]),
					outputDirection: Object.freeze([1, 2, 0]),
					coefficient: 11,
				}),
			])
		),
		createAffineTransition(
			Object.freeze([
				Object.freeze([1, 0, 0]),
				Object.freeze([1, 1, 0]),
				Object.freeze([0, 0, 1]),
			]),
			[13, 17, 19],
			Object.freeze([
				Object.freeze({
					inputProjection: Object.freeze([0, 1, 1]),
					outputDirection: Object.freeze([0, 1, 3]),
					coefficient: 23,
				}),
			])
		),
	]);

const EXIT_PROJECTION = Object.freeze({
	id: "padded_attacker_exit",
	coefficients: Object.freeze([1, 2, 3]),
	bias: 29,
});

interface CapturedEpoch {
	readonly request: ChartCustodyRequest;
	readonly response: ChartCustodyResponse;
	readonly maskedBefore: readonly number[];
	readonly maskedAfter: readonly number[];
	readonly maskedDelta: readonly number[];
	readonly chartsAfter: readonly EncodedChart[];
}

interface CapturedPaddedTranscript {
	readonly contract: ReferenceMaskedChartCustodian["clientContract"];
	readonly covers: readonly ChartCover[];
	readonly epochs: readonly CapturedEpoch[];
	readonly projectionRequest: CustodyRequest;
	/** Scorer-only control value; never enters topology features. */
	readonly finalOutputForControl: number;
	readonly realTransitionSlots: readonly number[];
	readonly realStageCount: number;
	readonly structuralShape: string;
}

interface LivePaddedSession {
	readonly plan: PaddedMaskedCustodyPlan;
	readonly custodian: ReferenceMaskedChartCustodian;
	charts: readonly EncodedChart[];
	state: ReturnType<typeof createMaskedCustodyClientState>;
}

interface PreparedEpoch {
	readonly request: ChartCustodyRequest;
	readonly response: ChartCustodyResponse;
	readonly localCharts: readonly EncodedChart[];
	readonly maskedBefore: readonly number[];
	readonly maskedDelta: readonly number[];
}

interface NumericSample<Label extends string | number> {
	readonly features: readonly number[];
	readonly label: Label;
}

interface StandardizedCentroidModel<Label extends string | number> {
	readonly means: readonly number[];
	readonly scales: readonly number[];
	readonly centroids: ReadonlyMap<Label, readonly number[]>;
}

export function buildPaddedMaskedCustodyAttackerReport(): PaddedMaskedAttackerReport {
	const distribution = measurePlacementDistribution();
	const placement = measurePlacementLeakage();
	const stageCount = measureStageCountLeakage();
	const bucket = measureBucketLeakage();
	const protocol = measureProtocolSeparation();
	const shapeClaimsPass =
		placement.shapeMatch &&
		stageCount.shapeMatch &&
		placement.perEpochShapeMatch;
	const placementLeakDetected =
		placement.balancedAccuracy >
		placement.chanceAccuracy + LEAKAGE_TOLERANCE;
	const stageLeakDetected =
		stageCount.accuracy >
		stageCount.chanceAccuracy + LEAKAGE_TOLERANCE;
	const failedClaims = [
		...(shapeClaimsPass ? [] : ["FIXED-STRUCTURAL-SHAPE"]),
		...(placementLeakDetected ? ["PLACEMENT-LEAKAGE"] : []),
		...(stageLeakDetected ? ["STAGE-COUNT-LEAKAGE"] : []),
		...(!protocol.separated ? ["SESSION-BINDING-SEPARATION"] : []),
		...(!protocol.substitutionRejected
			? ["PADDED-STATE-SUBSTITUTION"]
			: []),
	];
	const realStageCount = PLACEMENT_TRANSITIONS.length;
	const chartCells = CHART_COUNT * WIDTH;
	const fullTraceFieldElements =
		(BUCKET + 1) * chartCells +
		BUCKET * chartCells +
		6;
	const unpaddedTraceFieldElements =
		(realStageCount + 1) * chartCells +
		realStageCount * chartCells +
		6;

	return Object.freeze({
		schemaVersion: PADDED_MASKED_ATTACKER_REPORT_VERSION,
		decision:
			failedClaims.length === 0
				? "supports-fixed-bucket-claim"
				: "leakage-detected",
		acceptedBucketLeakage: Object.freeze({
			width: WIDTH,
			epochBucket: BUCKET,
			exactBucketClassificationAccuracy: bucket.accuracy,
			leakedBy: Object.freeze([
				"contract.coverIds.length - 1",
				"cover.width",
				"request/response epoch count",
			]),
		}),
		structuralShape: Object.freeze({
			placementShapeMatch: placement.shapeMatch,
			stageCountShapeMatch: stageCount.shapeMatch,
			perEpochShapeMatch: placement.perEpochShapeMatch,
			signatureValuesExcludedFromNumericClassifier: true,
		}),
		placementDistribution: Object.freeze({
			sampleCount: DISTRIBUTION_SAMPLES,
			expectedRealSlotRate:
				PLACEMENT_TRANSITIONS.length / BUCKET,
			correctedRealSlotCounts: distribution.correctedCounts,
			correctedMaximumDeviationPercentagePoints:
				distribution.correctedMaximumDeviationPercentagePoints,
			preFixRealSlotCounts: distribution.preFixCounts,
			preFixMaximumDeviationPercentagePoints:
				distribution.preFixMaximumDeviationPercentagePoints,
			preFixHeldOutBalancedAccuracy: 0.6979166666666667,
			preFixDecision: "leakage-detected",
			preFixLeakageCause:
				"The original LCG Fisher-Yates stream used correlated low bits through `% (index + 1)`; slot 7 held a real stage in only 797/10,000 SHA-256-distributed seeded plans.",
		}),
		placementLeakage: Object.freeze({
			realStageCount,
			trainingTranscripts: PLACEMENT_TRAIN_TRANSCRIPTS,
			heldOutTranscripts: PLACEMENT_HELD_OUT_TRANSCRIPTS,
			heldOutSlotSamples:
				PLACEMENT_HELD_OUT_TRANSCRIPTS * BUCKET,
			chanceBalancedAccuracy: placement.chanceAccuracy,
			heldOutBalancedAccuracy: placement.balancedAccuracy,
			epochPriorBalancedAccuracy:
				placement.epochPriorBalancedAccuracy,
			payloadOnlyBalancedAccuracy:
				placement.payloadOnlyBalancedAccuracy,
			advantagePercentagePoints:
				(placement.balancedAccuracy - placement.chanceAccuracy) *
				100,
			trainingRealSlotRateByEpoch:
				placement.trainingRealSlotRateByEpoch,
			finalOutputClassCount: placement.finalOutputClassCount,
		}),
		stageCountLeakage: Object.freeze({
			candidateStageCounts: Object.freeze([1, 2, 3, 4]),
			trainingTranscripts:
				STAGE_TRAIN_PER_CLASS * stageCount.classCount,
			heldOutTranscripts:
				STAGE_HELD_OUT_PER_CLASS * stageCount.classCount,
			chanceAccuracy: stageCount.chanceAccuracy,
			heldOutAccuracy: stageCount.accuracy,
			advantagePercentagePoints:
				(stageCount.accuracy - stageCount.chanceAccuracy) * 100,
			finalOutputClassCount: stageCount.finalOutputClassCount,
		}),
		protocolSeparation: Object.freeze({
			testedAtPaddingEpoch: protocol.paddingEpoch,
			sharedServiceSecrets: true,
			reusedNonceSequenceAcrossSessions: true,
			directForeignResponseAccepted: protocol.directAccepted,
			fieldReboundResponseAccepted: protocol.reboundAccepted,
			protectedMaskedStateCoordinateMatch:
				protocol.maskedStateCoordinateMatch,
			signedContributionCoordinateMatch:
				protocol.contributionCoordinateMatch,
			stateSubstitutionAcceptedByNextServerBoundary:
				!protocol.substitutionRejected,
		}),
		overhead: Object.freeze({
			width: WIDTH,
			chartCount: CHART_COUNT,
			threshold: THRESHOLD,
			realStageCount,
			paddedEpochCount: BUCKET,
			paddingEpochCount: BUCKET - realStageCount,
			transitionWorkMultiplier: BUCKET / realStageCount,
			fullTraceFieldElements,
			unpaddedTraceFieldElements,
			fullTraceMultiplier:
				fullTraceFieldElements / unpaddedTraceFieldElements,
			residentChartFieldElements: chartCells,
			residentStorageMultiplierOverLogicalState:
				chartCells / WIDTH,
		}),
		hooks: Object.freeze({
			localizedHookFamilies: 2,
			transitionHookEvents: BUCKET,
			finalOpeningHookEvents: 1,
			remainingSurfaces: Object.freeze([
				"applyMaskedTransitionResponse arguments and return",
				"openMaskedCustodyProjection arguments and return",
			]),
		}),
		classifierCaveat:
			"Chance-level deterministic classification is evidence for this corpus, not a proof that HMAC-derived masks and shares are pseudorandom, that session identifiers are globally unique, or that every adaptive classifier fails.",
		failedClaims: Object.freeze(failedClaims),
	});
}

function measurePlacementDistribution(): {
	readonly correctedCounts: readonly number[];
	readonly correctedMaximumDeviationPercentagePoints: number;
	readonly preFixCounts: readonly number[];
	readonly preFixMaximumDeviationPercentagePoints: number;
} {
	const counts = Array.from({ length: BUCKET }, () => 0);
	const preFixCounts = Array.from({ length: BUCKET }, () => 0);
	for (let index = 0; index < DISTRIBUTION_SAMPLES; index++) {
		const plan = createPaddedPlan(
			PLACEMENT_TRANSITIONS,
			BUCKET,
			placementSecret(5_000, index)
		);
		for (const slot of plan.realTransitionSlots) counts[slot]++;
		for (const slot of legacyPlacementSlots(index)) {
			preFixCounts[slot]++;
		}
	}
	const expectedRate = PLACEMENT_TRANSITIONS.length / BUCKET;
	const maximumDeviation = Math.max(
		...counts.map((count) =>
			Math.abs(count / DISTRIBUTION_SAMPLES - expectedRate)
		)
	);
	const preFixMaximumDeviation = Math.max(
		...preFixCounts.map((count) =>
			Math.abs(count / DISTRIBUTION_SAMPLES - expectedRate)
		)
	);
	return Object.freeze({
		correctedCounts: Object.freeze(counts),
		correctedMaximumDeviationPercentagePoints:
			maximumDeviation * 100,
		preFixCounts: Object.freeze(preFixCounts),
		preFixMaximumDeviationPercentagePoints:
			preFixMaximumDeviation * 100,
	});
}

function legacyPlacementSlots(index: number): readonly number[] {
	const placementSeedValue = createHash("sha256")
		.update(`slot-seed-${index}`)
		.digest()
		.readUInt32LE(0);
	const transcriptClassId = `csh-masked-v1-w${WIDTH}-e${BUCKET}`;
	const random = createSeededRandom(
		deriveSeed(
			placementSeedValue,
			`${transcriptClassId}:placement`
		)
	);
	const slots = Array.from({ length: BUCKET }, (_, slot) => slot);
	for (let slot = slots.length - 1; slot > 0; slot--) {
		const target = random.nextUint32() % (slot + 1);
		[slots[slot], slots[target]] = [
			slots[target]!,
			slots[slot]!,
		];
	}
	return slots
		.slice(0, PLACEMENT_TRANSITIONS.length)
		.sort((left, right) => left - right);
}

function measurePlacementLeakage(): {
	readonly chanceAccuracy: number;
	readonly balancedAccuracy: number;
	readonly epochPriorBalancedAccuracy: number;
	readonly payloadOnlyBalancedAccuracy: number;
	readonly trainingRealSlotRateByEpoch: readonly number[];
	readonly shapeMatch: boolean;
	readonly perEpochShapeMatch: boolean;
	readonly finalOutputClassCount: number;
} {
	const training: NumericSample<"padding" | "real">[] = [];
	const heldOut: NumericSample<"padding" | "real">[] = [];
	const payloadTraining: NumericSample<"padding" | "real">[] = [];
	const payloadHeldOut: NumericSample<"padding" | "real">[] = [];
	const heldOutEpochs: number[] = [];
	const trainingRealByEpoch = Array.from(
		{ length: BUCKET },
		() => 0
	);
	const shapes = new Set<string>();
	const epochShapes = new Set<string>();
	const outputs = new Set<number>();
	for (
		let transcriptIndex = 0;
		transcriptIndex <
		PLACEMENT_TRAIN_TRANSCRIPTS + PLACEMENT_HELD_OUT_TRANSCRIPTS;
		transcriptIndex++
	) {
		const plan = createPaddedPlan(
			PLACEMENT_TRANSITIONS,
			BUCKET,
			placementSecret(10_000, transcriptIndex)
		);
		const transcript = captureTranscript(
			plan,
			100_000 + transcriptIndex
		);
		shapes.add(transcript.structuralShape);
		outputs.add(transcript.finalOutputForControl);
		const target =
			transcriptIndex < PLACEMENT_TRAIN_TRANSCRIPTS
				? training
				: heldOut;
		for (let epoch = 0; epoch < BUCKET; epoch++) {
			const label = plan.realTransitionSlots.includes(epoch)
				? "real"
				: "padding";
			if (
				transcriptIndex < PLACEMENT_TRAIN_TRANSCRIPTS &&
				label === "real"
			) {
				trainingRealByEpoch[epoch]++;
			}
			const epochCapture = transcript.epochs[epoch]!;
			epochShapes.add(
				JSON.stringify(epochStructuralShape(epochCapture))
			);
			target.push(
				Object.freeze({
					features: slotNumericFeatures(
						transcript,
						epoch
					),
					label,
				})
			);
			const payloadTarget =
				transcriptIndex < PLACEMENT_TRAIN_TRANSCRIPTS
					? payloadTraining
					: payloadHeldOut;
			payloadTarget.push(
				Object.freeze({
					features: slotPayloadFeatures(
						transcript,
						epoch
					),
					label,
				})
			);
			if (transcriptIndex >= PLACEMENT_TRAIN_TRANSCRIPTS) {
				heldOutEpochs.push(epoch);
			}
		}
	}
	const model = fitCentroidClassifier(training);
	const predictions = heldOut.map((sample) =>
		predictCentroid(model, sample.features)
	);
	const payloadModel = fitCentroidClassifier(payloadTraining);
	const payloadPredictions = payloadHeldOut.map((sample) =>
		predictCentroid(payloadModel, sample.features)
	);
	const trainingRealSlotRateByEpoch = Object.freeze(
		trainingRealByEpoch.map(
			(count) => count / PLACEMENT_TRAIN_TRANSCRIPTS
		)
	);
	const globalRealRate = PLACEMENT_TRANSITIONS.length / BUCKET;
	const epochPriorPredictions = heldOutEpochs.map((epoch) =>
		trainingRealSlotRateByEpoch[epoch]! >= globalRealRate
			? "real"
			: "padding"
	);
	const heldOutLabels = heldOut.map((sample) => sample.label);
	return Object.freeze({
		chanceAccuracy: 0.5,
		balancedAccuracy: balancedBinaryAccuracy(
			heldOutLabels,
			predictions,
			"real",
			"padding"
		),
		epochPriorBalancedAccuracy: balancedBinaryAccuracy(
			heldOutLabels,
			epochPriorPredictions,
			"real",
			"padding"
		),
		payloadOnlyBalancedAccuracy: balancedBinaryAccuracy(
			heldOutLabels,
			payloadPredictions,
			"real",
			"padding"
		),
		trainingRealSlotRateByEpoch,
		shapeMatch: shapes.size === 1,
		perEpochShapeMatch: epochShapes.size === 1,
		finalOutputClassCount: outputs.size,
	});
}

function measureStageCountLeakage(): {
	readonly classCount: number;
	readonly chanceAccuracy: number;
	readonly accuracy: number;
	readonly shapeMatch: boolean;
	readonly finalOutputClassCount: number;
} {
	const stageCounts = [1, 2, 3, 4] as const;
	const training: NumericSample<number>[] = [];
	const heldOut: NumericSample<number>[] = [];
	const shapes = new Set<string>();
	const outputs = new Set<number>();
	let sessionOrdinal = 200_000;
	for (let repetition = 0; repetition <
		STAGE_TRAIN_PER_CLASS + STAGE_HELD_OUT_PER_CLASS; repetition++) {
		for (const stageCount of stageCounts) {
			const plan = createPaddedPlan(
				createEquivalentStages(stageCount),
				BUCKET,
				placementSecret(
					30_000 + stageCount * 1_009,
					repetition
				)
			);
			const transcript = captureTranscript(plan, sessionOrdinal++);
			shapes.add(transcript.structuralShape);
			outputs.add(transcript.finalOutputForControl);
			const target =
				repetition < STAGE_TRAIN_PER_CLASS
					? training
					: heldOut;
			target.push(
				Object.freeze({
					features: transcriptNumericFeatures(transcript),
					label: stageCount,
				})
			);
		}
	}
	const model = fitCentroidClassifier(training);
	const predictions = heldOut.map((sample) =>
		predictCentroid(model, sample.features)
	);
	const matches = predictions.filter(
		(prediction, index) => prediction === heldOut[index]!.label
	).length;
	return Object.freeze({
		classCount: stageCounts.length,
		chanceAccuracy: 1 / stageCounts.length,
		accuracy: matches / heldOut.length,
		shapeMatch: shapes.size === 1,
		finalOutputClassCount: outputs.size,
	});
}

function measureBucketLeakage(): { readonly accuracy: number } {
	const buckets = [4, 8, 16] as const;
	let matches = 0;
	for (let index = 0; index < buckets.length; index++) {
		const bucket = buckets[index]!;
		const transcript = captureTranscript(
			createPaddedPlan(
				createEquivalentStages(1),
				bucket,
				placementSecret(70_000, index)
			),
			400_000 + index
		);
		const inferredBucket = transcript.contract.coverIds.length - 1;
		if (
			inferredBucket === bucket &&
			transcript.covers[0]!.width === WIDTH &&
			transcript.epochs.length === bucket
		) {
			matches++;
		}
	}
	return Object.freeze({ accuracy: matches / buckets.length });
}

function measureProtocolSeparation(): {
	readonly paddingEpoch: number;
	readonly directAccepted: boolean;
	readonly reboundAccepted: boolean;
	readonly maskedStateCoordinateMatch: number;
	readonly contributionCoordinateMatch: number;
	readonly substitutionRejected: boolean;
	readonly separated: boolean;
} {
	const plan = createPaddedPlan(
		PLACEMENT_TRANSITIONS,
		BUCKET,
		placementSecret(90_000, 0)
	);
	const paddingEpoch =
		Array.from({ length: BUCKET - 1 }, (_, epoch) => epoch).find(
			(epoch) => !plan.realTransitionSlots.includes(epoch)
		) ?? 0;
	const first = createLiveSession(plan, 500_001);
	const second = createLiveSession(plan, 500_002);
	for (let epoch = 0; epoch < paddingEpoch; epoch++) {
		advanceLiveSession(first, epoch);
		advanceLiveSession(second, epoch);
	}
	const firstPrepared = prepareLiveEpoch(first, paddingEpoch);
	const secondPrepared = prepareLiveEpoch(second, paddingEpoch);
	const directAccepted = doesNotThrow(() =>
		applyMaskedTransitionResponse(
			second.custodian.clientContract,
			second.state,
			secondPrepared.localCharts,
			plan.covers[paddingEpoch + 1]!,
			firstPrepared.response,
			secondPrepared.request.nonce
		)
	);
	const rebound: ChartCustodyResponse = Object.freeze({
		...firstPrepared.response,
		sessionId: second.custodian.clientContract.sessionId,
		contractId: second.custodian.clientContract.contractId,
		requestNonce: secondPrepared.request.nonce,
	});
	const reboundAccepted = doesNotThrow(() =>
		applyMaskedTransitionResponse(
			second.custodian.clientContract,
			second.state,
			secondPrepared.localCharts,
			plan.covers[paddingEpoch + 1]!,
			rebound,
			secondPrepared.request.nonce
		)
	);
	const firstApplied = applyPrepared(first, paddingEpoch, firstPrepared);
	const secondApplied = applyPrepared(
		second,
		paddingEpoch,
		secondPrepared
	);
	const maskedStateCoordinateMatch = coordinateMatch(
		recoverMaskedState(
			firstApplied.charts,
			plan.covers[paddingEpoch + 1]!
		),
		recoverMaskedState(
			secondApplied.charts,
			plan.covers[paddingEpoch + 1]!
		)
	);
	const contributionCoordinateMatch = coordinateMatch(
		firstPrepared.response.chartContributions.flatMap(
			(contribution) => contribution.cells
		),
		secondPrepared.response.chartContributions.flatMap(
			(contribution) => contribution.cells
		)
	);
	const substitutionRejected = testPaddedStateSubstitution(
		plan,
		paddingEpoch
	);
	const separated =
		!directAccepted &&
		!reboundAccepted &&
		maskedStateCoordinateMatch < 1 &&
		contributionCoordinateMatch < 1;
	return Object.freeze({
		paddingEpoch,
		directAccepted,
		reboundAccepted,
		maskedStateCoordinateMatch,
		contributionCoordinateMatch,
		substitutionRejected,
		separated,
	});
}

function testPaddedStateSubstitution(
	plan: PaddedMaskedCustodyPlan,
	paddingEpoch: number
): boolean {
	const live = createLiveSession(plan, 600_001);
	for (let epoch = 0; epoch < paddingEpoch; epoch++) {
		advanceLiveSession(live, epoch);
	}
	const prepared = prepareLiveEpoch(live, paddingEpoch);
	const substituted = prepared.localCharts.map((chart, chartIndex) =>
		chartIndex === 0
			? Object.freeze({
					...chart,
					cells: Object.freeze(
						chart.cells.map((cell, lane) =>
							lane === 0 ? add(cell, 1) : cell
						)
					),
				})
			: chart
	);
	const applied = applyMaskedTransitionResponse(
		live.custodian.clientContract,
		live.state,
		substituted,
		plan.covers[paddingEpoch + 1]!,
		prepared.response,
		prepared.request.nonce
	);
	live.charts = applied.charts;
	live.state = applied.state;
	if (paddingEpoch + 1 < plan.transitions.length) {
		const nextRequest = prepareMaskedTransitionRequest(
			live.custodian.clientContract,
			live.state,
			live.charts,
			sharedNonce(paddingEpoch + 1)
		);
		return !doesNotThrow(() =>
			live.custodian.evaluateTransition(nextRequest)
		);
	}
	const exitRequest = prepareMaskedProjectionRequest(
		live.custodian.clientContract,
		live.state,
		live.charts,
		sharedExitNonce()
	);
	return !doesNotThrow(() =>
		live.custodian.evaluateExitProjection(exitRequest)
	);
}

function captureTranscript(
	plan: PaddedMaskedCustodyPlan,
	sessionOrdinal: number
): CapturedPaddedTranscript {
	const live = createLiveSession(plan, sessionOrdinal);
	const epochs: CapturedEpoch[] = [];
	for (let epoch = 0; epoch < plan.transitions.length; epoch++) {
		epochs.push(advanceLiveSession(live, epoch));
	}
	const projectionRequest = prepareMaskedProjectionRequest(
		live.custodian.clientContract,
		live.state,
		live.charts,
		sharedExitNonce()
	);
	const projectionResponse =
		live.custodian.evaluateExitProjection(projectionRequest);
	const opened = openMaskedCustodyProjection(
		live.custodian.clientContract,
		live.state,
		projectionResponse,
		projectionRequest.nonce
	);
	const provisional = {
		contract: live.custodian.clientContract,
		covers: plan.covers,
		epochs: Object.freeze(epochs),
		projectionRequest,
		finalOutputForControl: opened.projection,
		realTransitionSlots: plan.realTransitionSlots,
		realStageCount: plan.realTransitionSlots.length,
	};
	return Object.freeze({
		...provisional,
		structuralShape: transcriptStructuralShape(provisional),
	});
}

function createLiveSession(
	plan: PaddedMaskedCustodyPlan,
	sessionOrdinal: number
): LivePaddedSession {
	const custodian = new ReferenceMaskedChartCustodian({
		sessionId: `padded-attacker-session-${sessionOrdinal}`,
		contractId: "padded-attacker-contract",
		covers: plan.covers,
		transitions: plan.transitions,
		exitProjection: EXIT_PROJECTION,
		initialLineageCommitment: "padded-attacker-genesis",
		lineageSecret: SHARED_SECRETS.lineage,
		maskSecret: SHARED_SECRETS.mask,
		sharingSecret: SHARED_SECRETS.sharing,
		responseSecret: SHARED_SECRETS.response,
	});
	const charts = encodeIngressCharts(
		INPUT,
		plan.covers[0]!,
		700_000 + sessionOrdinal * 17
	);
	return {
		plan,
		custodian,
		charts,
		state: createMaskedCustodyClientState(custodian.clientContract),
	};
}

function advanceLiveSession(
	live: LivePaddedSession,
	epoch: number
): CapturedEpoch {
	const prepared = prepareLiveEpoch(live, epoch);
	const applied = applyPrepared(live, epoch, prepared);
	const maskedAfter = recoverMaskedState(
		applied.charts,
		live.plan.covers[epoch + 1]!
	);
	return Object.freeze({
		request: prepared.request,
		response: prepared.response,
		maskedBefore: Object.freeze([...prepared.maskedBefore]),
		maskedAfter: Object.freeze(maskedAfter),
		maskedDelta: Object.freeze([...prepared.maskedDelta]),
		chartsAfter: applied.charts,
	});
}

function prepareLiveEpoch(
	live: LivePaddedSession,
	epoch: number
): PreparedEpoch {
	const request = prepareMaskedTransitionRequest(
		live.custodian.clientContract,
		live.state,
		live.charts,
		sharedNonce(epoch)
	);
	const response = live.custodian.evaluateTransition(request);
	const localCharts = transportAffineCharts(
		live.charts,
		live.plan.covers[epoch]!,
		live.plan.covers[epoch + 1]!,
		IDENTITY_TRANSPORT,
		800_000 + epoch * 101
	);
	return Object.freeze({
		request,
		response,
		localCharts,
		maskedBefore: Object.freeze(
			recoverMaskedState(
				live.charts,
				live.plan.covers[epoch]!
			)
		),
		maskedDelta: Object.freeze(
			recoverSignedMaskedDelta(
				response,
				live.plan.covers[epoch + 1]!
			)
		),
	});
}

function applyPrepared(
	live: LivePaddedSession,
	epoch: number,
	prepared: PreparedEpoch
): { readonly charts: readonly EncodedChart[] } {
	const applied = applyMaskedTransitionResponse(
		live.custodian.clientContract,
		live.state,
		prepared.localCharts,
		live.plan.covers[epoch + 1]!,
		prepared.response,
		prepared.request.nonce
	);
	live.charts = applied.charts;
	live.state = applied.state;
	return Object.freeze({ charts: applied.charts });
}

function slotNumericFeatures(
	transcript: CapturedPaddedTranscript,
	epoch: number
): readonly number[] {
	const capture = transcript.epochs[epoch]!;
	return Object.freeze([
		epoch,
		...coverNumericFeatures(transcript.covers[epoch]!),
		...coverNumericFeatures(transcript.covers[epoch + 1]!),
		...capture.request.charts.flatMap((chart) => chart.cells),
		capture.request.epoch,
		...lineageNumericFeatures(capture.request.lineageCommitment),
		capture.response.epoch,
		capture.response.nextEpoch,
		...lineageNumericFeatures(
			capture.response.nextLineageCommitment
		),
		...capture.response.chartContributions.flatMap(
			(contribution) => contribution.cells
		),
		...capture.maskedBefore,
		...capture.maskedAfter,
		...capture.maskedDelta,
	].map(normalizedFeature));
}

/**
 * Isolate field-valued payloads from explicit epoch and cover metadata. The
 * full classifier above remains the attacker result; this control determines
 * whether any advantage comes from the masked payload itself.
 */
function slotPayloadFeatures(
	transcript: CapturedPaddedTranscript,
	epoch: number
): readonly number[] {
	const capture = transcript.epochs[epoch]!;
	return Object.freeze(
		[
			...capture.request.charts.flatMap((chart) => chart.cells),
			...lineageNumericFeatures(
				capture.request.lineageCommitment
			),
			...lineageNumericFeatures(
				capture.response.nextLineageCommitment
			),
			...capture.response.chartContributions.flatMap(
				(contribution) => contribution.cells
			),
			...capture.maskedBefore,
			...capture.maskedAfter,
			...capture.maskedDelta,
		].map(normalizedFeature)
	);
}

function transcriptNumericFeatures(
	transcript: CapturedPaddedTranscript
): readonly number[] {
	return Object.freeze([
		transcript.contract.coverIds.length,
		...transcript.covers.flatMap(coverNumericFeatures),
		...transcript.epochs.flatMap((_, epoch) =>
			slotNumericFeatures(transcript, epoch)
		),
		transcript.projectionRequest.epoch,
		...lineageNumericFeatures(
			transcript.projectionRequest.lineageCommitment
		),
		...transcript.projectionRequest.charts.flatMap(
			(chart) => chart.cells
		),
	]);
}

function coverNumericFeatures(cover: ChartCover): readonly number[] {
	return [
		cover.epoch,
		cover.width,
		cover.threshold,
		...cover.mixing.flat(),
		...cover.bias,
		...cover.charts.flatMap((chart) => [
			chart.point,
			chart.overlaps.length,
			...chart.cells.flatMap((cell) => [
				cell.scale,
				cell.offset,
				cell.exponent,
				cell.inverseExponent,
			]),
		]),
	];
}

function lineageNumericFeatures(value: string): readonly number[] {
	if (/^[0-9a-f]{64}$/u.test(value)) {
		return Array.from({ length: 8 }, (_, index) =>
			Number.parseInt(value.slice(index * 8, index * 8 + 8), 16)
		);
	}
	return Array.from({ length: 8 }, (_, index) =>
		stableStringHash(`${index}|${value}`)
	);
}

function transcriptStructuralShape(transcript: {
	readonly contract: ReferenceMaskedChartCustodian["clientContract"];
	readonly covers: readonly ChartCover[];
	readonly epochs: readonly CapturedEpoch[];
	readonly projectionRequest: CustodyRequest;
}): string {
	return JSON.stringify({
		contract: {
			keys: Object.keys(transcript.contract).sort(),
			coverIds: transcript.contract.coverIds.length,
			verificationKeyLength:
				transcript.contract.verificationKey.length,
		},
		covers: transcript.covers.map((cover) => ({
			keys: Object.keys(cover).sort(),
			width: cover.width,
			threshold: cover.threshold,
			mixing: [
				cover.mixing.length,
				...cover.mixing.map((row) => row.length),
			],
			bias: cover.bias.length,
			charts: cover.charts.map((chart) => ({
				keys: Object.keys(chart).sort(),
				cells: chart.cells.map((cell) =>
					Object.keys(cell).sort()
				),
				overlaps: chart.overlaps.length,
			})),
		})),
		epochs: transcript.epochs.map(epochStructuralShape),
		projectionRequest: {
			keys: Object.keys(transcript.projectionRequest).sort(),
			charts: chartStructuralShape(
				transcript.projectionRequest.charts
			),
		},
	});
}

function epochStructuralShape(epoch: CapturedEpoch): unknown {
	return {
		request: {
			keys: Object.keys(epoch.request).sort(),
			charts: chartStructuralShape(epoch.request.charts),
		},
		response: {
			keys: Object.keys(epoch.response).sort(),
			contributions: epoch.response.chartContributions.map(
				(contribution) => ({
					keys: Object.keys(contribution).sort(),
					cells: contribution.cells.length,
				})
			),
			signatureLength: epoch.response.signature.length,
		},
		maskedBefore: epoch.maskedBefore.length,
		maskedAfter: epoch.maskedAfter.length,
		maskedDelta: epoch.maskedDelta.length,
		chartsAfter: chartStructuralShape(epoch.chartsAfter),
	};
}

function chartStructuralShape(
	charts: readonly EncodedChart[]
): readonly unknown[] {
	return charts.map((chart) => ({
		keys: Object.keys(chart).sort(),
		cells: chart.cells.length,
	}));
}

function fitCentroidClassifier<Label extends string | number>(
	samples: readonly NumericSample<Label>[]
): StandardizedCentroidModel<Label> {
	const width = samples[0]?.features.length ?? 0;
	if (
		width === 0 ||
		samples.some((sample) => sample.features.length !== width)
	) {
		throw new Error("PADDED_ATTACKER_BAD_CLASSIFIER_FEATURE_SHAPE");
	}
	const means = Array.from({ length: width }, (_, feature) =>
		mean(samples.map((sample) => sample.features[feature]!))
	);
	const scales = Array.from({ length: width }, (_, feature) => {
		const variance = mean(
			samples.map((sample) => {
				const centered = sample.features[feature]! - means[feature]!;
				return centered * centered;
			})
		);
		const scale = Math.sqrt(variance);
		return scale === 0 ? 1 : scale;
	});
	const byLabel = new Map<Label, NumericSample<Label>[]>();
	for (const sample of samples) {
		const group = byLabel.get(sample.label) ?? [];
		group.push(sample);
		byLabel.set(sample.label, group);
	}
	const centroids = new Map<Label, readonly number[]>();
	for (const [label, group] of byLabel) {
		centroids.set(
			label,
			Object.freeze(
				Array.from({ length: width }, (_, feature) =>
					mean(
						group.map(
							(sample) =>
								(sample.features[feature]! -
									means[feature]!) /
								scales[feature]!
						)
					)
				)
			)
		);
	}
	return Object.freeze({
		means: Object.freeze(means),
		scales: Object.freeze(scales),
		centroids,
	});
}

function predictCentroid<Label extends string | number>(
	model: StandardizedCentroidModel<Label>,
	features: readonly number[]
): Label {
	let bestLabel: Label | undefined;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const [label, centroid] of model.centroids) {
		let distance = 0;
		for (let feature = 0; feature < features.length; feature++) {
			const standardized =
				(features[feature]! - model.means[feature]!) /
				model.scales[feature]!;
			const delta = standardized - centroid[feature]!;
			distance += delta * delta;
		}
		if (distance < bestDistance) {
			bestDistance = distance;
			bestLabel = label;
		}
	}
	if (bestLabel === undefined) {
		throw new Error("PADDED_ATTACKER_EMPTY_CLASSIFIER");
	}
	return bestLabel;
}

function balancedBinaryAccuracy<Label extends string | number>(
	actual: readonly Label[],
	predicted: readonly Label[],
	positive: Label,
	negative: Label
): number {
	let positiveCorrect = 0;
	let positiveTotal = 0;
	let negativeCorrect = 0;
	let negativeTotal = 0;
	for (let index = 0; index < actual.length; index++) {
		if (actual[index] === positive) {
			positiveTotal++;
			if (predicted[index] === positive) positiveCorrect++;
		} else if (actual[index] === negative) {
			negativeTotal++;
			if (predicted[index] === negative) negativeCorrect++;
		}
	}
	return (
		(positiveCorrect / positiveTotal + negativeCorrect / negativeTotal) /
		2
	);
}

function createPaddedPlan(
	realTransitions: readonly HiddenMaskedTransition[],
	bucketSize: 4 | 8 | 16,
	secret: string
): PaddedMaskedCustodyPlan {
	return createPaddedMaskedCustodyPlan({
		realTransitions,
		width: WIDTH,
		bucketSize,
		coverSeed: 42_424,
		placementSecret: secret,
	});
}

function createEquivalentStages(
	stageCount: number
): readonly HiddenMaskedTransition[] {
	const targetBias = [12, 20, 28];
	const biases: number[][] = [];
	const used = [0, 0, 0];
	for (let stage = 1; stage < stageCount; stage++) {
		const bias = [stage, stage * 2, stage * 3];
		biases.push(bias);
		for (let lane = 0; lane < WIDTH; lane++) {
			used[lane] = add(used[lane]!, bias[lane]!);
		}
	}
	biases.push(
		targetBias.map((value, lane) => subtract(value, used[lane]!))
	);
	return Object.freeze(
		biases.map((bias) =>
			createAffineTransition(identityMatrix(), bias, Object.freeze([]))
		)
	);
}

function createAffineTransition(
	linear: readonly (readonly number[])[],
	bias: readonly number[],
	cubicTerms: HiddenMaskedTransition["cubicTerms"]
): HiddenMaskedTransition {
	return Object.freeze({
		linear,
		bias: Object.freeze([...bias]),
		cubicTerms,
	});
}

function identityMatrix(): readonly (readonly number[])[] {
	return Object.freeze(
		Array.from({ length: WIDTH }, (_, row) =>
			Object.freeze(
				Array.from(
					{ length: WIDTH },
					(_, column) => (row === column ? 1 : 0)
				)
			)
		)
	);
}

function recoverMaskedState(
	charts: readonly EncodedChart[],
	cover: ChartCover
): number[] {
	return Array.from({ length: cover.width }, (_, coordinate) =>
		evaluateCertifiedProjection(charts, cover, {
			id: `padded_attacker_coordinate_${cover.epoch}_${coordinate}`,
			coefficients: Array.from(
				{ length: cover.width },
				(_, lane) => (lane === coordinate ? 1 : 0)
			),
			bias: 0,
		})
	);
}

function recoverSignedMaskedDelta(
	response: ChartCustodyResponse,
	targetCover: ChartCover
): number[] {
	const contributionById = new Map(
		response.chartContributions.map((contribution) => [
			contribution.chartId,
			contribution,
		])
	);
	const selected = targetCover.charts.slice(0, targetCover.threshold);
	const weights = interpolationWeightsAtZero(
		selected.map((chart) => chart.point)
	);
	const mixedDelta = Array.from(
		{ length: targetCover.width },
		(_, lane) => {
			let constant = 0;
			for (let index = 0; index < selected.length; index++) {
				const contribution = contributionById.get(
					selected[index]!.id
				);
				if (contribution === undefined) {
					throw new Error(
						"PADDED_ATTACKER_MISSING_CONTRIBUTION"
					);
				}
				constant = add(
					constant,
					multiply(contribution.cells[lane]!, weights[index]!)
				);
			}
			return constant;
		}
	);
	return multiplyMatrixVector(invertMatrix(targetCover.mixing), mixedDelta);
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
	matrix: readonly (readonly number[])[]
): number[][] {
	const width = matrix.length;
	const augmented = matrix.map((row, rowIndex) => [
		...row.map(normalize),
		...Array.from(
			{ length: width },
			(_, column) => (column === rowIndex ? 1 : 0)
		),
	]);
	for (let column = 0; column < width; column++) {
		const pivot = augmented.findIndex(
			(row, rowIndex) => rowIndex >= column && row[column] !== 0
		);
		if (pivot < 0) throw new Error("PADDED_ATTACKER_SINGULAR_MATRIX");
		[augmented[column], augmented[pivot]] = [
			augmented[pivot]!,
			augmented[column]!,
		];
		const pivotInverse = inverse(augmented[column]![column]!);
		augmented[column] = augmented[column]!.map((value) =>
			multiply(value, pivotInverse)
		);
		for (let row = 0; row < width; row++) {
			if (row === column) continue;
			const factor = augmented[row]![column]!;
			augmented[row] = augmented[row]!.map((value, lane) =>
				subtract(
					value,
					multiply(factor, augmented[column]![lane]!)
				)
			);
		}
	}
	return augmented.map((row) => row.slice(width));
}

function multiplyMatrixVector(
	matrix: readonly (readonly number[])[],
	vector: readonly number[]
): number[] {
	return matrix.map((row) => {
		let result = 0;
		for (let lane = 0; lane < row.length; lane++) {
			result = add(result, multiply(row[lane]!, vector[lane]!));
		}
		return result;
	});
}

function coordinateMatch(
	left: readonly number[],
	right: readonly number[]
): number {
	let matches = 0;
	for (let index = 0; index < left.length; index++) {
		if (left[index] === right[index]) matches++;
	}
	return matches / left.length;
}

function placementSecret(domain: number, index: number): string {
	return createHash("sha256")
		.update("padded-attacker-placement")
		.update("|")
		.update(String(domain))
		.update("|")
		.update(String(index))
		.digest("hex");
}

function sharedNonce(epoch: number): string {
	return `padded-shared-nonce-${epoch}`;
}

function sharedExitNonce(): string {
	return "padded-shared-exit-nonce";
}

function normalizedFeature(value: number): number {
	return normalize(value) / CSH_FIELD_MODULUS;
}

function stableStringHash(value: string): number {
	let hash = 2_166_136_261;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16_777_619);
	}
	return hash >>> 0;
}

function mean(values: readonly number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function doesNotThrow(operation: () => unknown): boolean {
	try {
		operation();
		return true;
	} catch {
		return false;
	}
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

function inverse(value: number): number {
	const normalized = normalize(value);
	if (normalized === 0) throw new Error("PADDED_ATTACKER_ZERO_INVERSE");
	return power(normalized, CSH_FIELD_MODULUS - 2);
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
	const reduced = Math.trunc(value) % CSH_FIELD_MODULUS;
	return reduced < 0 ? reduced + CSH_FIELD_MODULUS : reduced;
}
