import {
	generateBprfArtifact,
	type BprfArtifact,
	type BprfCallerContext,
	type BprfRealization,
	type BprfWireBasis,
	type PureRegionContract,
	type PureScalar,
} from "../../../src/isogloss/bprf/index.js";
import {
	evaluateBprfReference,
	selectBprfRealization,
} from "../../../src/isogloss/bprf/testing-reference.js";
import {
	createCustodyClientState,
	openCustodiedProjection,
	prepareCustodyRequest,
} from "../../../src/isogloss/csh/custody-protocol.js";
import {
	applyCustodiedChartContribution,
	createChartCustodyClientState,
	prepareChartCustodyRequest,
	type ChartCustodyResponse,
} from "../../../src/isogloss/csh/chart-custody-protocol.js";
import { ReferenceChartRelationCustodian } from "../../../src/isogloss/csh/reference-chart-custodian.js";
import { ReferenceRelationCustodian } from "../../../src/isogloss/csh/reference-custodian.js";
import {
	CSH_FIELD_MODULUS,
	createChartCover,
	encodeIngressCharts,
	transportAffineCharts,
	type ChartCover,
	type EncodedChart,
} from "../../../src/isogloss/csh/reference.js";
import { evaluateBprfOverCshReference } from "../../../src/isogloss/csh/testing-bprf-reference.js";
import { buildLegacyVmBaselineReport } from "./dynamic-attacker.js";
import {
	DYNAMIC_ATTACKER_CORPUS_VERSION,
	DYNAMIC_ATTACKER_FIXTURES,
} from "./dynamic-attacker-fixtures.js";

export const REVISED_ATTACKER_REPORT_VERSION = 1 as const;

export type GateStatus = "pass" | "fail" | "not-evaluated";

export interface GateResult {
	readonly id: string;
	readonly status: GateStatus;
	readonly measured: number | boolean | string | null;
	readonly required: string;
	readonly reason: string;
}

export interface ContextTransferReport {
	/** Exact contextual event-identity recall on another context using a seen realization. */
	readonly seenRealizationIdentityRecall: number;
	/** Exact identity recall when the trained realization has never been seen. */
	readonly unseenRealizationIdentityRecall: number;
	/**
	 * Recall on that same unseen realization when the attacker consumes the
	 * complete artifact instead of relying only on prior traces.
	 */
	readonly artifactAwareUnseenRecall: number;
	readonly naiveTransferLossPercentagePoints: number;
	readonly artifactAwareTransferLossPercentagePoints: number;
	readonly contextsEnumeratedToReachAllRealizations: number;
}

export interface ArtifactRecoveryReport {
	readonly heldOutOutputAccuracy: number;
	readonly physicalTopologyRecall: number;
	readonly physicalDependencyEdges: number;
	readonly pieceEvaluations: number;
	readonly factorReads: number;
	readonly dynamicPrimitiveObservationsRequired: number;
	readonly clientFunctionallyComplete: boolean;
	readonly canonicalSourceMappingRecovered: boolean;
}

export interface C90Report {
	readonly configuredThreshold: number;
	readonly minimumContributionsFor90Percent: number | null;
	readonly recoveryByContributionCount: readonly {
		readonly contributions: number;
		readonly recovery: number;
	}[];
}

export interface CoverTransferReport {
	readonly sourceCoverAccuracy: number;
	readonly fixedDecoderUnseenAccuracy: number;
	readonly metadataAwareUnseenAccuracy: number;
	readonly fixedDecoderLossPercentagePoints: number;
	readonly metadataAwareLossPercentagePoints: number;
}

export interface AmplificationReport {
	readonly plainStateObservationsForG90: number;
	readonly cshCellReadsForG90: number;
	readonly g90WorkRatio: number;
	readonly residentStorageRatio: number;
	readonly fullTraceObservationRatio: number;
	readonly requiredRatio: number;
}

export interface CustodyAttackReport {
	readonly clientCompleteBeforeResponse: boolean;
	readonly standaloneWithoutResponseRejected: boolean;
	readonly relationPresentInClientContract: boolean;
	readonly replaySucceeded: boolean;
	readonly snapshotForkSucceeded: boolean;
	readonly learnedBypass: {
		readonly succeeded: boolean;
		readonly trainingQueries: number;
		readonly heldOutAccuracy: number;
		readonly localizedPatchSites: number | null;
	};
	readonly chartRelation: {
		readonly clientCompleteBeforeResponse: boolean;
		readonly minimumResponseContributionsForFullDelta: number | null;
		readonly logicalDeltaRecovery: number;
		readonly learnedBypass: {
			readonly succeeded: boolean;
			readonly trainingQueries: number;
			readonly heldOutAccuracy: number;
			readonly localizedPatchSites: number | null;
		};
	};
	readonly pfeTopologyRecoveryEvaluated: boolean;
}

export interface HookCollapseComparison {
	readonly legacy: {
		readonly probeSites: number;
		readonly boundaryRecall: number;
		readonly operationF1: number;
		readonly recoveredStream: "semantic";
	};
	readonly bprf: {
		readonly probeSites: number;
		readonly contextualIdentityRecall: number;
		readonly operationF1: null;
		readonly artifactOutputRecovery: number;
		readonly recoveredStream: "contextual-identity";
	};
	readonly csh: {
		readonly probeSites: number;
		readonly logicalStateRecovery: number;
		readonly operationF1: null;
		readonly recoveredStream: "chart-state";
	};
	readonly combined: {
		readonly probeSites: number;
		readonly contextualIdentityRecall: number;
		readonly finalFrameRecovery: number;
		readonly operationF1: null;
		readonly recoveredStream: "chart-and-contextual-identity";
	};
}

export interface RevisedAttackerGoNoGoReport {
	readonly schemaVersion: typeof REVISED_ATTACKER_REPORT_VERSION;
	readonly decision: "go" | "no-go";
	readonly bprf: {
		readonly contextTransfer: ContextTransferReport;
		readonly artifactRecovery: ArtifactRecoveryReport;
		readonly gates: readonly GateResult[];
	};
	readonly csh: {
		readonly c90: C90Report;
		readonly coverTransfer: CoverTransferReport;
		readonly amplification: AmplificationReport;
		readonly gates: readonly GateResult[];
	};
	readonly combined: {
		readonly outputAccuracy: number;
		readonly finalFrameRecovery: number;
		readonly amplification: AmplificationReport;
		readonly gates: readonly GateResult[];
	};
	readonly custody: {
		readonly attack: CustodyAttackReport;
		readonly gates: readonly GateResult[];
	};
	readonly hookCollapse: HookCollapseComparison;
	readonly failedGates: readonly string[];
	readonly unevaluatedGates: readonly string[];
}

const BPRF_CONTRACT: PureRegionContract = {
	inputs: [
		{ type: "number" },
		{ type: "number" },
		{ type: "boolean" },
	],
	steps: [
		{ type: "number", formula: { tag: "product", left: 0, right: 1 } },
		{ type: "number", formula: { tag: "sum", left: 0, right: 1 } },
		{ type: "number", formula: { tag: "difference", left: 3, right: 4 } },
		{ type: "boolean", formula: { tag: "not", value: 2 } },
		{
			type: "number",
			formula: {
				tag: "select",
				gate: 2,
				whenTrue: 5,
				whenFalse: 4,
			},
		},
	],
	outputs: [7, 6],
};

const BPRF_INPUTS = [
	[3, 5, true],
	[-4, 7, false],
	[6, -2, true],
	[0, 9, false],
	[8, 4, true],
	[-3, -5, false],
] as const satisfies readonly (readonly PureScalar[])[];

interface RecoveredArtifactEvaluation {
	readonly outputs: readonly PureScalar[];
	readonly pieceEvaluations: number;
	readonly factorReads: number;
}

function encodeCoordinate(value: number, basis: BprfWireBasis): number {
	return value * basis.scale + basis.bias;
}

function decodeCoordinate(value: number, basis: BprfWireBasis): number {
	return (value - basis.bias) / basis.scale;
}

/**
 * Independent artifact attacker. It consumes no logical contract and imports
 * no evaluator implementation; all executable algebra comes from the artifact.
 */
function evaluateRecoveredBprfArtifact(
	realization: BprfRealization,
	inputs: readonly PureScalar[]
): RecoveredArtifactEvaluation {
	const frame: Array<number | undefined> = Array.from(
		{ length: realization.frameSize },
		() => undefined
	);
	for (let index = 0; index < inputs.length; index++) {
		const port = realization.inputPorts[index]!;
		const input = inputs[index]!;
		const coordinate =
			port.typeCode === 0
				? (input as number)
				: realization.familyCode === 0
					? input
						? 1
						: 0
					: input
						? 1
						: -1;
		frame[port.slot] = encodeCoordinate(coordinate, port.basis);
	}
	let pieceEvaluations = 0;
	let factorReads = 0;
	for (const transition of realization.transitions) {
		const totals = new Map<number, number>();
		const bases = new Map<number, BprfWireBasis>();
		for (const fragment of realization.fragments) {
			for (const piece of fragment.pieces) {
				if (piece.phase !== transition.phase) continue;
				pieceEvaluations++;
				let contribution = piece.coefficient;
				for (const factor of piece.factors) {
					factorReads++;
					const stored = frame[factor.slot];
					if (stored === undefined) {
						throw new Error("ATTACKER_BPRF_READ_BEFORE_WRITE");
					}
					contribution *=
						decodeCoordinate(stored, factor.basis) + factor.offset;
				}
				totals.set(
					piece.destination,
					(totals.get(piece.destination) ?? 0) + contribution
				);
				bases.set(piece.destination, piece.destinationBasis);
			}
		}
		for (const destination of transition.writes) {
			const total = totals.get(destination);
			const basis = bases.get(destination);
			if (total === undefined || basis === undefined) {
				throw new Error("ATTACKER_BPRF_INCOMPLETE_TRANSITION");
			}
			frame[destination] = encodeCoordinate(total, basis);
		}
	}
	const outputs = realization.outputPorts.map((port): PureScalar => {
		const stored = frame[port.slot];
		if (stored === undefined) throw new Error("ATTACKER_BPRF_OUTPUT_MISSING");
		const coordinate = decodeCoordinate(stored, port.basis);
		if (port.typeCode === 0) return coordinate;
		return realization.familyCode === 0 ? coordinate > 0.5 : coordinate > 0;
	});
	return { outputs, pieceEvaluations, factorReads };
}

function contextsByRealization(
	artifact: BprfArtifact,
	perRealization: number
): {
	readonly contexts: ReadonlyMap<string, readonly BprfCallerContext[]>;
	readonly enumerated: number;
} {
	const buckets = new Map<string, BprfCallerContext[]>(
		artifact.realizations.map((realization) => [realization.id, []])
	);
	let enumerated = 0;
	while (
		[...buckets.values()].some((contexts) => contexts.length < perRealization)
	) {
		const context = {
			caller: `attacker-context-${enumerated % 17}`,
			epoch: Math.floor(enumerated / 17),
			lineage: enumerated * 13,
		};
		const selected = selectBprfRealization(artifact, context);
		const bucket = buckets.get(selected.id)!;
		if (bucket.length < perRealization) bucket.push(context);
		enumerated++;
		if (enumerated > 10_000) {
			throw new Error("ATTACKER_BPRF_CONTEXT_ENUMERATION_EXHAUSTED");
		}
	}
	return { contexts: buckets, enumerated };
}

function traceIdentitySet(
	result: ReturnType<typeof evaluateBprfReference>
): Set<string> {
	return new Set(
		result.trace.map(
			(event) =>
				`${event.realization}|${event.transition}|${event.fragment}|${event.phase}`
		)
	);
}

function artifactIdentitySet(realization: BprfRealization): Set<string> {
	const identities = new Set<string>();
	for (const transition of realization.transitions) {
		for (const fragment of realization.fragments) {
			if (fragment.pieces.some((piece) => piece.phase === transition.phase)) {
				identities.add(
					`${realization.id}|${transition.id}|${fragment.id}|${transition.phase}`
				);
			}
		}
	}
	return identities;
}

function setRecall(expected: ReadonlySet<string>, recovered: ReadonlySet<string>): number {
	if (expected.size === 0) return 1;
	let matched = 0;
	for (const value of expected) {
		if (recovered.has(value)) matched++;
	}
	return matched / expected.size;
}

function samePureOutputs(
	left: readonly PureScalar[],
	right: readonly PureScalar[]
): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => {
			const other = right[index];
			return typeof value === "number" && typeof other === "number"
				? Math.abs(value - other) < 1e-9
				: value === other;
		})
	);
}

function runBprfExperiments(artifact: BprfArtifact): {
	contextTransfer: ContextTransferReport;
	artifactRecovery: ArtifactRecoveryReport;
} {
	const contexts = contextsByRealization(artifact, 2);
	const seenRealizations = artifact.realizations.slice(
		0,
		Math.ceil(artifact.realizations.length / 2)
	);
	const unseenRealizations = artifact.realizations.slice(seenRealizations.length);
	const trainedIdentities = new Set<string>();
	for (const realization of seenRealizations) {
		const trainingContext = contexts.contexts.get(realization.id)![0]!;
		for (const identity of traceIdentitySet(
			evaluateBprfReference(artifact, BPRF_INPUTS[0], trainingContext)
		)) {
			trainedIdentities.add(identity);
		}
	}
	const seenExpected = new Set<string>();
	for (const realization of seenRealizations) {
		const testContext = contexts.contexts.get(realization.id)![1]!;
		for (const identity of traceIdentitySet(
			evaluateBprfReference(artifact, BPRF_INPUTS[1], testContext)
		)) {
			seenExpected.add(identity);
		}
	}
	const unseenExpected = new Set<string>();
	const artifactAwareUnseen = new Set<string>();
	for (const realization of unseenRealizations) {
		const testContext = contexts.contexts.get(realization.id)![1]!;
		for (const identity of traceIdentitySet(
			evaluateBprfReference(artifact, BPRF_INPUTS[2], testContext)
		)) {
			unseenExpected.add(identity);
		}
		for (const identity of artifactIdentitySet(realization)) {
			artifactAwareUnseen.add(identity);
		}
	}
	const seenRecall = setRecall(seenExpected, trainedIdentities);
	const unseenRecall = setRecall(unseenExpected, trainedIdentities);
	const artifactAwareRecall = setRecall(unseenExpected, artifactAwareUnseen);

	let correctOutputs = 0;
	let outputCases = 0;
	let pieceEvaluations = 0;
	let factorReads = 0;
	for (const realization of artifact.realizations) {
		const context = contexts.contexts.get(realization.id)![0]!;
		for (const inputs of BPRF_INPUTS.slice(3)) {
			const oracle = evaluateBprfReference(artifact, inputs, context);
			const recovered = evaluateRecoveredBprfArtifact(realization, inputs);
			if (samePureOutputs(oracle.outputs, recovered.outputs)) correctOutputs++;
			outputCases++;
			pieceEvaluations += recovered.pieceEvaluations;
			factorReads += recovered.factorReads;
		}
	}
	const topologyEdges = artifact.realizations.reduce(
		(total, realization) =>
			total +
			realization.fragments.reduce(
				(fragmentTotal, fragment) =>
					fragmentTotal +
					fragment.pieces.reduce(
						(pieceTotal, piece) => pieceTotal + piece.factors.length,
						0
					),
				0
			),
		0
	);
	return {
		contextTransfer: {
			seenRealizationIdentityRecall: seenRecall,
			unseenRealizationIdentityRecall: unseenRecall,
			artifactAwareUnseenRecall: artifactAwareRecall,
			naiveTransferLossPercentagePoints: seenRecall - unseenRecall,
			artifactAwareTransferLossPercentagePoints:
				seenRecall - artifactAwareRecall,
			contextsEnumeratedToReachAllRealizations: contexts.enumerated,
		},
		artifactRecovery: {
			heldOutOutputAccuracy: correctOutputs / outputCases,
			physicalTopologyRecall: 1,
			physicalDependencyEdges: topologyEdges,
			pieceEvaluations,
			factorReads,
			dynamicPrimitiveObservationsRequired: 0,
			clientFunctionallyComplete: correctOutputs === outputCases,
			canonicalSourceMappingRecovered: false,
		},
	};
}

function normalizeField(value: number): number {
	const normalized = Math.trunc(value) % CSH_FIELD_MODULUS;
	return normalized < 0 ? normalized + CSH_FIELD_MODULUS : normalized;
}

function fieldAdd(left: number, right: number): number {
	return normalizeField(normalizeField(left) + normalizeField(right));
}

function fieldSubtract(left: number, right: number): number {
	return normalizeField(normalizeField(left) - normalizeField(right));
}

function fieldMultiply(left: number, right: number): number {
	return normalizeField(normalizeField(left) * normalizeField(right));
}

function fieldPower(base: number, exponent: number): number {
	let result = 1;
	let factor = normalizeField(base);
	let remaining = exponent;
	while (remaining > 0) {
		if (remaining % 2 === 1) result = fieldMultiply(result, factor);
		factor = fieldMultiply(factor, factor);
		remaining = Math.floor(remaining / 2);
	}
	return result;
}

function fieldInverse(value: number): number {
	const normalized = normalizeField(value);
	if (normalized === 0) throw new Error("ATTACKER_FIELD_ZERO_INVERSE");
	return fieldPower(normalized, CSH_FIELD_MODULUS - 2);
}

function invertFieldMatrix(input: readonly (readonly number[])[]): number[][] {
	const width = input.length;
	const augmented = input.map((row, rowIndex) => [
		...row.map(normalizeField),
		...Array.from({ length: width }, (_, column) =>
			rowIndex === column ? 1 : 0
		),
	]);
	for (let column = 0; column < width; column++) {
		let pivot = column;
		while (pivot < width && augmented[pivot]![column] === 0) pivot++;
		if (pivot === width) throw new Error("ATTACKER_CSH_SINGULAR_MIXING");
		[augmented[column], augmented[pivot]] = [
			augmented[pivot]!,
			augmented[column]!,
		];
		const pivotInverse = fieldInverse(augmented[column]![column]!);
		for (let index = 0; index < width * 2; index++) {
			augmented[column]![index] = fieldMultiply(
				augmented[column]![index]!,
				pivotInverse
			);
		}
		for (let row = 0; row < width; row++) {
			if (row === column) continue;
			const factor = augmented[row]![column]!;
			for (let index = 0; index < width * 2; index++) {
				augmented[row]![index] = fieldSubtract(
					augmented[row]![index]!,
					fieldMultiply(factor, augmented[column]![index]!)
				);
			}
		}
	}
	return augmented.map((row) => row.slice(width));
}

function multiplyFieldMatrixVector(
	matrix: readonly (readonly number[])[],
	vector: readonly number[]
): number[] {
	return matrix.map((row) =>
		row.reduce(
			(total, value, index) =>
				fieldAdd(total, fieldMultiply(value, vector[index]!)),
			0
		)
	);
}

function interpolationWeightsAtZero(points: readonly number[]): number[] {
	return points.map((point, index) => {
		let numerator = 1;
		let denominator = 1;
		for (let other = 0; other < points.length; other++) {
			if (other === index) continue;
			numerator = fieldMultiply(
				numerator,
				fieldSubtract(0, points[other]!)
			);
			denominator = fieldMultiply(
				denominator,
				fieldSubtract(point, points[other]!)
			);
		}
		return fieldMultiply(numerator, fieldInverse(denominator));
	});
}

/**
 * Independent full-state decoder assembled solely from public cover metadata.
 * Its existence is intentionally counted against the local CSH gate.
 */
function decodeChartsFromPublicMetadata(
	charts: readonly EncodedChart[],
	cover: ChartCover
): number[] {
	if (charts.length === 0) throw new Error("ATTACKER_CSH_CHARTS_REQUIRED");
	const descriptors = new Map(
		cover.charts.map((descriptor) => [descriptor.id, descriptor])
	);
	const selected = charts.map((chart) => {
		if (chart.coverId !== cover.id) {
			throw new Error("ATTACKER_CSH_WRONG_COVER");
		}
		const descriptor = descriptors.get(chart.chartId);
		if (descriptor === undefined) {
			throw new Error("ATTACKER_CSH_UNKNOWN_CHART");
		}
		return { chart, descriptor };
	});
	const weights = interpolationWeightsAtZero(
		selected.map(({ descriptor }) => descriptor.point)
	);
	const mixedConstant = Array.from({ length: cover.width }, (_, lane) => {
		let constant = 0;
		for (let index = 0; index < selected.length; index++) {
			const { chart, descriptor } = selected[index]!;
			const transform = descriptor.cells[lane]!;
			const raw = fieldMultiply(
				fieldSubtract(
					fieldPower(chart.cells[lane]!, transform.inverseExponent),
					transform.offset
				),
				fieldInverse(transform.scale)
			);
			constant = fieldAdd(
				constant,
				fieldMultiply(weights[index]!, raw)
			);
		}
		return constant;
	});
	return multiplyFieldMatrixVector(
		invertFieldMatrix(cover.mixing),
		mixedConstant.map((value, lane) =>
			fieldSubtract(value, cover.bias[lane]!)
		)
	);
}

function exactFieldRecovery(
	expected: readonly number[],
	recovered: readonly number[]
): number {
	let correct = 0;
	for (let index = 0; index < expected.length; index++) {
		if (normalizeField(expected[index]!) === recovered[index]) correct++;
	}
	return correct / expected.length;
}

function runCshExperiments(): {
	c90: C90Report;
	coverTransfer: CoverTransferReport;
	amplification: AmplificationReport;
	logicalStateRecovery: number;
} {
	const width = 4;
	const covers = [0, 1, 2].map((epoch) =>
		createChartCover({
			seed: 0xc510,
			epoch,
			width,
			chartCount: 5,
			threshold: 3,
		})
	);
	const logicalStates = Array.from({ length: 12 }, (_, index) => [
		index + 1,
		index * 3 + 2,
		index * 5 + 4,
		index * 7 + 8,
	]);
	const recoveryByContributionCount = Array.from(
		{ length: covers[0]!.charts.length },
		(_, countIndex) => {
			const contributions = countIndex + 1;
			let recoveredCoordinates = 0;
			let totalCoordinates = 0;
			for (let coverIndex = 0; coverIndex < covers.length; coverIndex++) {
				const cover = covers[coverIndex]!;
				for (let stateIndex = 0; stateIndex < logicalStates.length; stateIndex++) {
					const state = logicalStates[stateIndex]!;
					const charts = encodeIngressCharts(
						state,
						cover,
						0x9100 + coverIndex * 100 + stateIndex
					);
					const recovered = decodeChartsFromPublicMetadata(
						charts.slice(0, contributions),
						cover
					);
					recoveredCoordinates +=
						exactFieldRecovery(state, recovered) * state.length;
					totalCoordinates += state.length;
				}
			}
			return {
				contributions,
				recovery: recoveredCoordinates / totalCoordinates,
			};
		}
	);
	const c90Entry = recoveryByContributionCount.find(
		(entry) => entry.recovery >= 0.9
	);

	const sourceCover = covers[0]!;
	const sourceState = logicalStates[0]!;
	const sourceCharts = encodeIngressCharts(sourceState, sourceCover, 0xa001);
	const sourceAccuracy = exactFieldRecovery(
		sourceState,
		decodeChartsFromPublicMetadata(
			sourceCharts.slice(0, sourceCover.threshold),
			sourceCover
		)
	);
	let fixedCorrect = 0;
	let metadataCorrect = 0;
	let transferCases = 0;
	for (const targetCover of covers.slice(1)) {
		for (let index = 0; index < logicalStates.length; index++) {
			const state = logicalStates[index]!;
			const charts = encodeIngressCharts(
				state,
				targetCover,
				0xb000 + targetCover.epoch * 100 + index
			);
			try {
				fixedCorrect += exactFieldRecovery(
					state,
					decodeChartsFromPublicMetadata(
						charts.slice(0, targetCover.threshold),
						sourceCover
					)
				);
			} catch {
				// The source-cover decoder rejects target chart identities.
			}
			metadataCorrect += exactFieldRecovery(
				state,
				decodeChartsFromPublicMetadata(
					charts.slice(0, targetCover.threshold),
					targetCover
				)
			);
			transferCases++;
		}
	}
	const fixedAccuracy = fixedCorrect / transferCases;
	const metadataAccuracy = metadataCorrect / transferCases;
	const g90Targets = Math.ceil(width * 0.9);
	const c90 = c90Entry?.contributions ?? null;
	const g90Reads = c90 === null ? Number.POSITIVE_INFINITY : c90 * g90Targets;
	return {
		c90: {
			configuredThreshold: sourceCover.threshold,
			minimumContributionsFor90Percent: c90,
			recoveryByContributionCount,
		},
		coverTransfer: {
			sourceCoverAccuracy: sourceAccuracy,
			fixedDecoderUnseenAccuracy: fixedAccuracy,
			metadataAwareUnseenAccuracy: metadataAccuracy,
			fixedDecoderLossPercentagePoints: sourceAccuracy - fixedAccuracy,
			metadataAwareLossPercentagePoints: sourceAccuracy - metadataAccuracy,
		},
		amplification: {
			plainStateObservationsForG90: g90Targets,
			cshCellReadsForG90: g90Reads,
			g90WorkRatio: g90Reads / g90Targets,
			residentStorageRatio: sourceCover.charts.length,
			fullTraceObservationRatio: sourceCover.charts.length,
			requiredRatio: 10,
		},
		logicalStateRecovery: metadataAccuracy,
	};
}

function coversForCombined(
	realization: BprfRealization,
	seed: number
): readonly ChartCover[] {
	return Array.from(
		{ length: realization.transitions.length + 1 },
		(_, epoch) =>
			createChartCover({
				seed,
				epoch,
				width: realization.frameSize,
				chartCount: 5,
				threshold: 3,
			})
	);
}

function runCombinedExperiment(
	artifact: BprfArtifact,
	context: BprfCallerContext,
	c90: number
): {
	outputAccuracy: number;
	finalFrameRecovery: number;
	amplification: AmplificationReport;
	contextualIdentityRecall: number;
} {
	const realization = selectBprfRealization(artifact, context);
	const covers = coversForCombined(realization, 0xc05e);
	let correctOutputs = 0;
	let outputCount = 0;
	let finalFrameRecovery = 0;
	let contextualIdentityRecall = 0;
	let plainTraceEvents = 0;
	let combinedTraceEvents = 0;
	for (let index = 0; index < BPRF_INPUTS.length; index++) {
		const inputs = BPRF_INPUTS[index]!;
		const plain = evaluateBprfReference(artifact, inputs, context);
		const combined = evaluateBprfOverCshReference(
			artifact,
			inputs,
			context,
			covers,
			0xc500 + index
		);
		for (let outputIndex = 0; outputIndex < plain.outputs.length; outputIndex++) {
			const left = combined.outputs[outputIndex];
			const right = plain.outputs[outputIndex];
			if (
				typeof left === "number" &&
				typeof right === "number" &&
				Math.abs(left - right) < 1e-9
			) {
				correctOutputs++;
			} else if (left === right) {
				correctOutputs++;
			}
			outputCount++;
		}
		const finalCover = covers[covers.length - 1]!;
		const recoveredFrame = decodeChartsFromPublicMetadata(
			combined.charts.slice(0, c90),
			finalCover
		);
		const recoveredOutputs = realization.outputPorts.map((port): PureScalar => {
			const coordinate = fieldMultiply(
				fieldSubtract(recoveredFrame[port.slot]!, port.basis.bias),
				fieldInverse(port.basis.scale)
			);
			if (port.typeCode === 0) {
				const signed =
					coordinate > CSH_FIELD_MODULUS / 2
						? coordinate - CSH_FIELD_MODULUS
						: coordinate;
				return Object.is(signed, -0) ? 0 : signed;
			}
			return realization.familyCode === 0
				? coordinate !== 0
				: coordinate > 0 && coordinate <= CSH_FIELD_MODULUS / 2;
		});
		if (samePureOutputs(combined.outputs, recoveredOutputs)) {
			finalFrameRecovery++;
		}
		const plainIdentities = new Set(
			plain.trace.map(
				(event) =>
					`${event.realization}|${event.transition}|${event.fragment}|${event.phase}`
			)
		);
		const combinedIdentities = new Set(
			combined.trace.map(
				(event) =>
					`${event.realization}|${event.transition}|${event.fragment}|${event.phase}`
			)
		);
		contextualIdentityRecall += setRecall(plainIdentities, combinedIdentities);
		plainTraceEvents += plain.trace.length;
		combinedTraceEvents += combined.trace.length;
	}
	const g90Targets = Math.ceil(realization.frameSize * 0.9);
	return {
		outputAccuracy: correctOutputs / outputCount,
		finalFrameRecovery: finalFrameRecovery / BPRF_INPUTS.length,
		contextualIdentityRecall:
			contextualIdentityRecall / BPRF_INPUTS.length,
		amplification: {
			plainStateObservationsForG90: g90Targets,
			cshCellReadsForG90: c90 * g90Targets,
			g90WorkRatio: c90,
			residentStorageRatio:
				(covers[0]!.charts.length * realization.frameSize) /
				realization.frameSize,
			fullTraceObservationRatio: combinedTraceEvents / plainTraceEvents,
			requiredRatio: 10,
		},
	};
}

const CUSTODY_RELATION = {
	projectionSite: {
		id: "custodied_input",
		coefficients: [2, 3, 5],
		bias: 19,
	},
	cubic: 37,
	linear: 41,
	bias: 43,
} as const;

function createCustodyFixture(sessionOrdinal: number, firstCoordinate: number) {
	const cover = createChartCover({ seed: 808, epoch: 3, width: 3 });
	const charts = encodeIngressCharts(
		[firstCoordinate, 11, 13],
		cover,
		809 + sessionOrdinal
	);
	const custodian = new ReferenceRelationCustodian({
		sessionId: `session_${sessionOrdinal}`,
		contractId: "contract_crown",
		cover,
		initialLineageCommitment: "lineage_genesis",
		lineageSecret: "server-only-lineage-secret",
		responseSecret: "server-only-response-secret",
		relation: CUSTODY_RELATION,
	});
	return { cover, charts, custodian };
}

function queryCustodian(sessionOrdinal: number, firstCoordinate: number): number {
	const { charts, custodian } = createCustodyFixture(
		sessionOrdinal,
		firstCoordinate
	);
	const contract = custodian.clientContract;
	const state = createCustodyClientState(contract);
	const request = prepareCustodyRequest(
		contract,
		state,
		charts,
		`nonce_query_${sessionOrdinal}`
	);
	const response = custodian.evaluate(request);
	return openCustodiedProjection(
		contract,
		state,
		response,
		request.nonce
	).projection;
}

function interpolateFieldAt(
	samples: readonly { x: number; y: number }[],
	target: number
): number {
	let result = 0;
	for (let index = 0; index < samples.length; index++) {
		let basis = 1;
		for (let other = 0; other < samples.length; other++) {
			if (other === index) continue;
			basis = fieldMultiply(
				basis,
				fieldMultiply(
					fieldSubtract(target, samples[other]!.x),
					fieldInverse(
						fieldSubtract(samples[index]!.x, samples[other]!.x)
					)
				)
			);
		}
		result = fieldAdd(
			result,
			fieldMultiply(samples[index]!.y, basis)
		);
	}
	return result;
}

const CHART_IDENTITY_TRANSITION = {
	id: "attacker_local_identity",
	matrix: [
		[1, 0, 0],
		[0, 1, 0],
		[0, 0, 1],
	],
	bias: [0, 0, 0],
} as const;

const CHART_CUSTODY_RELATION = {
	inputProjection: {
		id: "hidden_input",
		coefficients: [2, 1, 3],
		bias: 5,
	},
	cubic: 7,
	linear: 11,
	bias: 17,
	outputDirection: [1, 2, 0],
} as const;

function createChartCustodyFixture(
	sessionOrdinal: number,
	firstCoordinate: number
) {
	const from = createChartCover({ seed: 2027, epoch: 0, width: 3 });
	const to = createChartCover({ seed: 2027, epoch: 1, width: 3 });
	const values = [firstCoordinate, 11, 13] as const;
	const incoming = encodeIngressCharts(values, from, 3030 + sessionOrdinal);
	const local = transportAffineCharts(
		incoming,
		from,
		to,
		CHART_IDENTITY_TRANSITION,
		4030 + sessionOrdinal
	);
	const custodian = new ReferenceChartRelationCustodian({
		sessionId: `chart_session_${sessionOrdinal}`,
		contractId: "hidden_glue",
		fromCover: from,
		toCover: to,
		initialLineageCommitment: "chart_genesis",
		lineageSecret: "server-chart-lineage",
		sharingSecret: "server-chart-sharing",
		relation: CHART_CUSTODY_RELATION,
	});
	return { from, to, values, incoming, local, custodian };
}

function recoverLogicalDeltaFromChartResponse(
	response: ChartCustodyResponse,
	targetCover: ChartCover,
	contributionCount: number
): number[] {
	const selected = response.chartContributions.slice(0, contributionCount);
	const descriptors = new Map(
		targetCover.charts.map((descriptor) => [descriptor.id, descriptor])
	);
	const points = selected.map((contribution) => {
		const descriptor = descriptors.get(contribution.chartId);
		if (descriptor === undefined) {
			throw new Error("ATTACKER_CHART_CUSTODY_UNKNOWN_CONTRIBUTION");
		}
		return descriptor.point;
	});
	const weights = interpolationWeightsAtZero(points);
	const mixedDelta = Array.from({ length: targetCover.width }, (_, lane) =>
		selected.reduce(
			(total, contribution, index) =>
				fieldAdd(
					total,
					fieldMultiply(weights[index]!, contribution.cells[lane]!)
				),
			0
		)
	);
	return multiplyFieldMatrixVector(
		invertFieldMatrix(targetCover.mixing),
		mixedDelta
	);
}

function expectedChartLogicalDelta(firstCoordinate: number): number[] {
	const projected = normalizeField(
		2 * firstCoordinate + 11 + 3 * 13 + 5
	);
	const residual = fieldAdd(
		fieldAdd(
			fieldMultiply(
				CHART_CUSTODY_RELATION.cubic,
				fieldMultiply(fieldMultiply(projected, projected), projected)
			),
			fieldMultiply(CHART_CUSTODY_RELATION.linear, projected)
		),
		CHART_CUSTODY_RELATION.bias
	);
	return CHART_CUSTODY_RELATION.outputDirection.map((direction) =>
		fieldMultiply(direction, residual)
	);
}

function queryChartCustodian(
	sessionOrdinal: number,
	firstCoordinate: number,
	contributionCount = 3
): {
	readonly logicalDelta: readonly number[];
	readonly response: ChartCustodyResponse;
} {
	const fixture = createChartCustodyFixture(sessionOrdinal, firstCoordinate);
	const contract = fixture.custodian.clientContract;
	const state = createChartCustodyClientState(contract);
	const request = prepareChartCustodyRequest(
		contract,
		state,
		fixture.incoming,
		`chart_query_${sessionOrdinal}`
	);
	const response = fixture.custodian.evaluate(request);
	return {
		logicalDelta: recoverLogicalDeltaFromChartResponse(
			response,
			fixture.to,
			contributionCount
		),
		response,
	};
}

function runChartCustodyExperiment(): CustodyAttackReport["chartRelation"] {
	const incomplete = createChartCustodyFixture(400, 7);
	const incompleteContract = incomplete.custodian.clientContract;
	const incompleteState = createChartCustodyClientState(incompleteContract);
	const incompleteRequest = prepareChartCustodyRequest(
		incompleteContract,
		incompleteState,
		incomplete.incoming,
		"chart_missing_0400"
	);
	let missingResponseRejected = false;
	try {
		applyCustodiedChartContribution(
			incompleteContract,
			incompleteState,
			incomplete.local,
			incomplete.to,
			undefined,
			incompleteRequest.nonce
		);
	} catch (error) {
		missingResponseRejected = String(error).includes(
			"RUAM_CSH_CUSTODIAN_REQUIRED"
		);
	}

	const probeInputs = [1, 3, 7, 11, 17, 23, 29, 31];
	const recoveryByCount = [1, 2, 3, 4, 5].map((contributionCount) => {
		let recoveredCoordinates = 0;
		let totalCoordinates = 0;
		for (let index = 0; index < probeInputs.length; index++) {
			const firstCoordinate = probeInputs[index]!;
			const recovered = queryChartCustodian(
				500 + contributionCount * 100 + index,
				firstCoordinate,
				contributionCount
			).logicalDelta;
			const expected = expectedChartLogicalDelta(firstCoordinate);
			recoveredCoordinates +=
				exactFieldRecovery(expected, recovered) * expected.length;
			totalCoordinates += expected.length;
		}
		return {
			contributionCount,
			recovery: recoveredCoordinates / totalCoordinates,
		};
	});
	const minimumForFullDelta =
		recoveryByCount.find((entry) => entry.recovery >= 0.9)
			?.contributionCount ?? null;

	const trainingX = [1, 7, 13, 19];
	const samples = trainingX.map((x, index) => ({
		x,
		y: queryChartCustodian(1_100 + index, x).logicalDelta[0]!,
	}));
	const heldOutX = [3, 11, 23, 29];
	let correctPredictions = 0;
	for (let index = 0; index < heldOutX.length; index++) {
		const x = heldOutX[index]!;
		const predictedResidual = interpolateFieldAt(samples, x);
		const predicted = [
			predictedResidual,
			fieldMultiply(2, predictedResidual),
			0,
		];
		const observed = queryChartCustodian(
			1_200 + index,
			x
		).logicalDelta;
		if (exactFieldRecovery(observed, predicted) === 1) {
			correctPredictions++;
		}
	}
	const heldOutAccuracy = correctPredictions / heldOutX.length;
	return {
		clientCompleteBeforeResponse: !missingResponseRejected,
		minimumResponseContributionsForFullDelta: minimumForFullDelta,
		logicalDeltaRecovery:
			recoveryByCount.find((entry) => entry.contributionCount === 3)
				?.recovery ?? 0,
		learnedBypass: {
			succeeded: heldOutAccuracy === 1,
			trainingQueries: trainingX.length,
			heldOutAccuracy,
			localizedPatchSites: heldOutAccuracy === 1 ? 1 : null,
		},
	};
}

function runCustodyExperiment(): CustodyAttackReport {
	const first = createCustodyFixture(100, 7);
	const contract = first.custodian.clientContract;
	const initialState = createCustodyClientState(contract);
	let standaloneRejected = false;
	try {
		openCustodiedProjection(
			contract,
			initialState,
			undefined,
			"nonce_missing_response"
		);
	} catch (error) {
		standaloneRejected = String(error).includes("RUAM_CSH_CUSTODIAN_REQUIRED");
	}
	const serializedContract = JSON.stringify(contract).toLowerCase();
	const relationPresentInClientContract = [
		"projectionsite",
		"cubic",
		"linear",
		"server-only",
	].some((token) => serializedContract.includes(token));

	const fork = createCustodyFixture(101, 9);
	const forkContract = fork.custodian.clientContract;
	const forkState = createCustodyClientState(forkContract);
	const firstRequest = prepareCustodyRequest(
		forkContract,
		forkState,
		fork.charts,
		"nonce_fork_1001"
	);
	const secondRequest = prepareCustodyRequest(
		forkContract,
		forkState,
		fork.charts,
		"nonce_fork_1002"
	);
	fork.custodian.evaluate(firstRequest);
	let replaySucceeded = true;
	let snapshotForkSucceeded = true;
	try {
		fork.custodian.evaluate(firstRequest);
	} catch {
		replaySucceeded = false;
	}
	try {
		fork.custodian.evaluate(secondRequest);
	} catch {
		snapshotForkSucceeded = false;
	}

	const trainingX = [1, 7, 13, 19];
	const samples = trainingX.map((x, index) => ({
		x,
		y: queryCustodian(200 + index, x),
	}));
	const heldOutX = [3, 11, 23, 29];
	let correct = 0;
	for (let index = 0; index < heldOutX.length; index++) {
		const x = heldOutX[index]!;
		const predicted = interpolateFieldAt(samples, x);
		const observed = queryCustodian(300 + index, x);
		if (predicted === observed) correct++;
	}
	const heldOutAccuracy = correct / heldOutX.length;
	const chartRelation = runChartCustodyExperiment();
	return {
		clientCompleteBeforeResponse: !standaloneRejected,
		standaloneWithoutResponseRejected: standaloneRejected,
		relationPresentInClientContract,
		replaySucceeded,
		snapshotForkSucceeded,
		learnedBypass: {
			succeeded: heldOutAccuracy === 1,
			trainingQueries: trainingX.length,
			heldOutAccuracy,
			localizedPatchSites: heldOutAccuracy === 1 ? 1 : null,
		},
		chartRelation,
		pfeTopologyRecoveryEvaluated: false,
	};
}

function gate(
	id: string,
	status: GateStatus,
	measured: GateResult["measured"],
	required: string,
	reason: string
): GateResult {
	return Object.freeze({ id, status, measured, required, reason });
}

/** Build the deterministic, owner-only D2/D3 go/no-go report. */
export function buildRevisedAttackerGoNoGoReport(): RevisedAttackerGoNoGoReport {
	const artifact = generateBprfArtifact(BPRF_CONTRACT, {
		seed: 0x51c0ffee,
		realizationCount: 4,
		fragmentCount: 3,
	});
	const bprf = runBprfExperiments(artifact);
	const csh = runCshExperiments();
	const context = contextsByRealization(artifact, 1).contexts.get(
		artifact.realizations[0]!.id
	)![0]!;
	const combined = runCombinedExperiment(
		artifact,
		context,
		csh.c90.minimumContributionsFor90Percent ?? 3
	);
	const custody = runCustodyExperiment();
	const legacy = buildLegacyVmBaselineReport(DYNAMIC_ATTACKER_FIXTURES, {
		buildSeed: 0x1badb002,
		repeatCount: 2,
		corpusVersion: DYNAMIC_ATTACKER_CORPUS_VERSION,
	});

	const bprfGates = [
		gate(
			"BPRF-NO-SEMANTIC-EVENT",
			"pass",
			false,
			"no trace event emits a semantic operation or source identity",
			"Reference traces contain only realization, transition, fragment, and phase identities."
		),
		gate(
			"BPRF-ARTIFACT-AWARE-TRANSFER-DROP",
			bprf.contextTransfer.artifactAwareTransferLossPercentagePoints >= 0.3
				? "pass"
				: "fail",
			bprf.contextTransfer.artifactAwareTransferLossPercentagePoints,
			">= 0.30 loss on unseen realizations/contexts",
			"Naive identity transfer collapses, but all unseen realization topology and identities are enumerable from the shipped artifact."
		),
		gate(
			"BPRF-FULL-STEP-O90",
			"fail",
			bprf.artifactRecovery.dynamicPrimitiveObservationsRequired,
			">= 10x legacy dynamic observations for 90% recovery",
			"The independent attacker evaluates held-out behavior exactly from artifact algebra with zero dynamic observations."
		),
		gate(
			"BPRF-O1-OP-F1",
			"not-evaluated",
			null,
			"< 0.50 canonical operation F1",
			"The pure reference has no canonical source-operation owner sidecar, so assigning zero would game the gate."
		),
		gate(
			"BPRF-PATCH-COLLAPSE",
			"not-evaluated",
			1,
			"no <=3-site patch emits a stable canonical stream",
			"One reference-result probe emits a stable contextual stream, but it is not a canonical semantic stream and there is no product runtime to patch."
		),
	] as const;

	const cshGates = [
		gate(
			"CSH-C90-THRESHOLD",
			csh.c90.minimumContributionsFor90Percent !== null &&
				csh.c90.minimumContributionsFor90Percent >=
					csh.c90.configuredThreshold
				? "pass"
				: "fail",
			csh.c90.minimumContributionsFor90Percent,
			`>= configured threshold ${csh.c90.configuredThreshold}`,
			"Fewer contributions fail empirically; the configured threshold reconstructs every tested coordinate."
		),
		gate(
			"CSH-G90-WORK-AMPLIFICATION",
			csh.amplification.g90WorkRatio >= 10 ? "pass" : "fail",
			csh.amplification.g90WorkRatio,
			">= 10x plain BPRF",
			"Minimum correlated cell reads scale with threshold three, not ten."
		),
		gate(
			"CSH-STORAGE-AMPLIFICATION",
			csh.amplification.residentStorageRatio >= 10 ? "pass" : "fail",
			csh.amplification.residentStorageRatio,
			">= 10x plain BPRF",
			"Five full-width charts provide only a fivefold resident-cell proxy."
		),
		gate(
			"CSH-COVER-TRANSFER",
			csh.coverTransfer.metadataAwareLossPercentagePoints >= 0.3
				? "pass"
				: "fail",
			csh.coverTransfer.metadataAwareLossPercentagePoints,
			">= 0.30 loss on unseen covers",
			"A frozen cover decoder fails, but one metadata-driven algorithm recovers every unseen cover because all transforms, mixing, and biases are public."
		),
		gate(
			"CSH-LOCAL-PROBE-COLLAPSE",
			"fail",
			1,
			">3 localized probes for a stable logical-state map",
			"One result/chart-collection probe plus public cover metadata reconstructs the entire logical vector."
		),
	] as const;

	const combinedGates = [
		gate(
			"BPRF-CSH-CORRECTNESS",
			combined.outputAccuracy === 1 ? "pass" : "fail",
			combined.outputAccuracy,
			"1.0 held-out output accuracy",
			"Combined reference outputs match plain BPRF on every measured input."
		),
		gate(
			"BPRF-CSH-G90-WORK-AMPLIFICATION",
			combined.amplification.g90WorkRatio >= 10 ? "pass" : "fail",
			combined.amplification.g90WorkRatio,
			">= 10x plain BPRF",
			"The minimum final-frame recovery proxy remains threshold-times-width."
		),
		gate(
			"BPRF-CSH-FULL-TRACE-AMPLIFICATION",
			combined.amplification.fullTraceObservationRatio >= 10
				? "pass"
				: "fail",
			combined.amplification.fullTraceObservationRatio,
			">= 10x plain BPRF",
			"Chart-local tracing multiplies contextual events by five, below the tenfold gate."
		),
		gate(
			"BPRF-CSH-CLIENT-TRACE-COMPLETENESS",
			combined.finalFrameRecovery < 0.9 ? "pass" : "fail",
			combined.finalFrameRecovery,
			"< 0.90 final-frame recovery",
			"The returned charts and public final-cover metadata reconstruct all held-out final frames."
		),
	] as const;

	const custodyGates = [
		gate(
			"CUSTODY-CLIENT-INCOMPLETE",
			!custody.clientCompleteBeforeResponse ? "pass" : "fail",
			custody.clientCompleteBeforeResponse,
			"false before custodian response",
			"The client opening API rejects a missing response and its contract carries no relation."
		),
		gate(
			"CUSTODY-REPLAY-FORK",
			!custody.replaySucceeded && !custody.snapshotForkSucceeded
				? "pass"
				: "fail",
			custody.replaySucceeded || custody.snapshotForkSucceeded,
			"no replay or second fork succeeds",
			"Consumed nonce and stale-lineage checks reject both attacks."
		),
		gate(
			"CUSTODY-BYPASS",
			custody.learnedBypass.succeeded ||
				custody.chartRelation.learnedBypass.succeeded
				? "fail"
				: "pass",
			Math.max(
				custody.learnedBypass.heldOutAccuracy,
				custody.chartRelation.learnedBypass.heldOutAccuracy
			),
			"no compact offline substitute preserves held-out outputs",
			"Four fresh-session queries interpolate both bounded cubic references on the measured one-dimensional input slices; one-site substitutes predict every held-out query."
		),
		gate(
			"CUSTODY-CHART-DELTA-LEAKAGE",
			custody.chartRelation.logicalDeltaRecovery < 0.9 ? "pass" : "fail",
			custody.chartRelation.logicalDeltaRecovery,
			"< 0.90 recovery of the hidden transition's logical delta from one response",
			"Three intercepted additive chart contributions plus the public target cover reconstruct the complete per-input logical delta. This is not yet offline relation recovery, which is measured separately."
		),
		gate(
			"CUSTODY-PFE-TOPOLOGY",
			"not-evaluated",
			null,
			"topology-hidden actively secure PFE recovery at accepted leakage",
			"The committed reference is direct remote evaluation, not a universal-circuit PFE prototype."
		),
	] as const;

	const hookCollapse: HookCollapseComparison = {
		legacy: {
			probeSites: legacy.patchCollapse.minimumLocalizedSites ?? 1,
			boundaryRecall: legacy.aggregate.boundaryEvents.recall,
			operationF1: legacy.aggregate.operationLabels.f1,
			recoveredStream: "semantic",
		},
		bprf: {
			probeSites: 1,
			contextualIdentityRecall: 1,
			operationF1: null,
			artifactOutputRecovery: bprf.artifactRecovery.heldOutOutputAccuracy,
			recoveredStream: "contextual-identity",
		},
		csh: {
			probeSites: 1,
			logicalStateRecovery: csh.logicalStateRecovery,
			operationF1: null,
			recoveredStream: "chart-state",
		},
		combined: {
			probeSites: 1,
			contextualIdentityRecall: combined.contextualIdentityRecall,
			finalFrameRecovery: combined.finalFrameRecovery,
			operationF1: null,
			recoveredStream: "chart-and-contextual-identity",
		},
	};

	const allGates = [
		...bprfGates,
		...cshGates,
		...combinedGates,
		...custodyGates,
	];
	const failedGates = allGates
		.filter((result) => result.status === "fail")
		.map((result) => result.id);
	const unevaluatedGates = allGates
		.filter((result) => result.status === "not-evaluated")
		.map((result) => result.id);
	return Object.freeze({
		schemaVersion: REVISED_ATTACKER_REPORT_VERSION,
		decision: failedGates.length === 0 && unevaluatedGates.length === 0
			? "go"
			: "no-go",
		bprf: Object.freeze({
			contextTransfer: Object.freeze(bprf.contextTransfer),
			artifactRecovery: Object.freeze(bprf.artifactRecovery),
			gates: Object.freeze(bprfGates),
		}),
		csh: Object.freeze({
			c90: Object.freeze(csh.c90),
			coverTransfer: Object.freeze(csh.coverTransfer),
			amplification: Object.freeze(csh.amplification),
			gates: Object.freeze(cshGates),
		}),
		combined: Object.freeze({
			outputAccuracy: combined.outputAccuracy,
			finalFrameRecovery: combined.finalFrameRecovery,
			amplification: Object.freeze(combined.amplification),
			gates: Object.freeze(combinedGates),
		}),
		custody: Object.freeze({
			attack: Object.freeze(custody),
			gates: Object.freeze(custodyGates),
		}),
		hookCollapse: Object.freeze(hookCollapse),
		failedGates: Object.freeze(failedGates),
		unevaluatedGates: Object.freeze(unevaluatedGates),
	});
}
