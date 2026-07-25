import {
	applyMaskedTransitionResponse,
	createMaskedCustodyClientState,
	openMaskedCustodyProjection,
	prepareMaskedProjectionRequest,
	prepareMaskedTransitionRequest,
} from "../../../src/isogloss/csh/masked-custody-protocol.js";
import {
	ReferenceMaskedChartCustodian,
	type HiddenMaskedTransition,
} from "../../../src/isogloss/csh/reference-masked-custodian.js";
import {
	CSH_FIELD_MODULUS,
	createChartCover,
	encodeIngressCharts,
	evaluateCertifiedProjection,
	transportAffineCharts,
	type ChartCover,
} from "../../../src/isogloss/csh/reference.js";
import type {
	ChartCustodyRequest,
	ChartCustodyResponse,
} from "../../../src/isogloss/csh/chart-custody-protocol.js";

export const MASKED_CUSTODY_ATTACKER_REPORT_VERSION = 1 as const;

export type MaskedCustodyGateStatus = "pass" | "fail";

export interface MaskedCustodyGate {
	readonly id: string;
	readonly status: MaskedCustodyGateStatus;
	readonly measured: number | boolean | string;
	readonly required: string;
	readonly reason: string;
}

export interface MaskedCustodyAttackerReport {
	readonly schemaVersion: typeof MASKED_CUSTODY_ATTACKER_REPORT_VERSION;
	readonly decision: "go" | "no-go";
	readonly clientArtifact: {
		readonly contractFieldCount: number;
		readonly hiddenRelationMaterialPresent: boolean;
		readonly coverPathVisible: boolean;
	};
	readonly internalRecovery: {
		/** The ingress has no representation mask and is necessarily known. */
		readonly ingressLogicalStateRecovery: number;
		readonly maskedStateRecovery: number;
		readonly maskedTransitionDeltaRecovery: number;
		readonly protectedLogicalCoordinateGuessAccuracy: number;
		readonly unmaskedDeltaCoordinateGuessAccuracy: number;
		readonly compatibleLogicalStatesPerProtectedObservation: string;
		readonly freshMaskWholeStateGuessProbability: number;
	};
	readonly crossSession: {
		readonly directSignedResponseAccepted: boolean;
		readonly fieldReboundResponseAccepted: boolean;
		readonly maskedStateCoordinateTransferAccuracy: number;
		readonly maskedDeltaCoordinateTransferAccuracy: number;
		readonly finalProjectionTransferAccuracy: number;
		readonly sharedServiceSecrets: boolean;
		readonly nonceReuseAcrossSessions: boolean;
		readonly freshVerificationKeys: boolean;
	};
	readonly chosenInputOracle: {
		readonly relationStages: number;
		readonly totalDegreeBound: number;
		readonly trainingQueries: number;
		readonly heldOutQueries: number;
		readonly heldOutOutputAccuracy: number;
		readonly learnedScope: "complete-final-scalar-function";
		readonly evidenceSource: "black-box-io-only";
		readonly intermediateRelationRecovered: boolean;
		readonly intermediateStateRecovered: boolean;
	};
	readonly dynamicProxy: {
		readonly chartCount: number;
		readonly width: number;
		readonly threshold: number;
		readonly transitionCount: number;
		readonly interceptedRequests: number;
		readonly interceptedSignedResponses: number;
		readonly interceptedTraceFieldElements: number;
		readonly reconstructionChartCellReads: number;
		readonly semanticPlainTraceFieldElements: number;
		readonly plainDirectReads: number;
		readonly traceAmplificationRatio: number;
		readonly reconstructionWorkRatio: number;
		readonly residentStorageRatio: number;
		readonly localizedHookFamilies: number;
		readonly remainingHookSurfaces: readonly string[];
	};
	readonly gates: readonly MaskedCustodyGate[];
	readonly failedGates: readonly string[];
}

const WIDTH = 3;
const TRANSITION_COUNT = 2;
const TOTAL_DEGREE_BOUND = 3 ** TRANSITION_COUNT;
const CHART_COUNT = 5;
const THRESHOLD = 3;
const REQUIRED_AMPLIFICATION = 10;

const IDENTITY_TRANSITION = Object.freeze({
	id: "masked_attacker_identity",
	matrix: Object.freeze([
		Object.freeze([1, 0, 0]),
		Object.freeze([0, 1, 0]),
		Object.freeze([0, 0, 1]),
	]),
	bias: Object.freeze([0, 0, 0]),
});

const HIDDEN_TRANSITIONS: readonly HiddenMaskedTransition[] = Object.freeze([
	Object.freeze({
		linear: Object.freeze([
			Object.freeze([1, 1, 0]),
			Object.freeze([0, 1, 0]),
			Object.freeze([0, 0, 1]),
		]),
		bias: Object.freeze([3, 5, 7]),
		cubicTerms: Object.freeze([
			Object.freeze({
				inputProjection: Object.freeze([1, 0, 1]),
				outputDirection: Object.freeze([1, 2, 0]),
				coefficient: 11,
			}),
		]),
	}),
	Object.freeze({
		linear: Object.freeze([
			Object.freeze([1, 0, 0]),
			Object.freeze([1, 1, 0]),
			Object.freeze([0, 0, 1]),
		]),
		bias: Object.freeze([13, 17, 19]),
		cubicTerms: Object.freeze([
			Object.freeze({
				inputProjection: Object.freeze([0, 1, 1]),
				outputDirection: Object.freeze([0, 1, 3]),
				coefficient: 23,
			}),
		]),
	}),
]);

const EXIT_PROJECTION = Object.freeze({
	id: "masked_attacker_exit",
	coefficients: Object.freeze([1, 2, 3]),
	bias: 29,
});

const COVERS = Object.freeze(
	Array.from({ length: TRANSITION_COUNT + 1 }, (_, epoch) =>
		createChartCover({
			seed: 91_700,
			epoch,
			width: WIDTH,
			chartCount: CHART_COUNT,
			threshold: THRESHOLD,
		})
	)
);

interface CapturedSession {
	readonly clientContract: ReferenceMaskedChartCustodian["clientContract"];
	readonly input: readonly number[];
	readonly ownerStates: readonly (readonly number[])[];
	readonly ownerDeltas: readonly (readonly number[])[];
	readonly maskedStates: readonly (readonly number[])[];
	readonly maskedDeltas: readonly (readonly number[])[];
	readonly output: number;
	readonly transitionRequests: number;
	readonly signedTransitionResponses: number;
	readonly projectionRequests: number;
	readonly signedProjectionResponses: number;
}

interface FirstTransitionCapture {
	readonly contract: ReferenceMaskedChartCustodian["clientContract"];
	readonly state: ReturnType<typeof createMaskedCustodyClientState>;
	readonly localCharts: ReturnType<typeof transportAffineCharts>;
	readonly response: ChartCustodyResponse;
	readonly request: ChartCustodyRequest;
}

/**
 * Exercise the full client-visible masked-custody surface. Owner states are
 * retained only by the test scorer; all attacker recoveries below consume
 * charts, public covers, requests, signed responses, and the opened projection.
 */
function captureSession(
	sessionOrdinal: number,
	input: readonly number[]
): CapturedSession {
	const custodian = createFreshCustodian(sessionOrdinal);
	let charts = encodeIngressCharts(
		input,
		COVERS[0]!,
		ingressSeed(sessionOrdinal)
	);
	let clientState = createMaskedCustodyClientState(
		custodian.clientContract
	);
	let ownerState = input.map(normalize);
	const ownerStates: number[][] = [ownerState];
	const ownerDeltas: number[][] = [];
	const maskedStates: number[][] = [
		recoverMaskedState(charts, COVERS[0]!),
	];
	const maskedDeltas: number[][] = [];

	for (let epoch = 0; epoch < TRANSITION_COUNT; epoch++) {
		const nonce = transitionNonce(sessionOrdinal, epoch);
		const targetCover = COVERS[epoch + 1]!;
		const localCharts = transportAffineCharts(
			charts,
			COVERS[epoch]!,
			targetCover,
			IDENTITY_TRANSITION,
			transportSeed(sessionOrdinal, epoch)
		);
		const request = prepareMaskedTransitionRequest(
			custodian.clientContract,
			clientState,
			charts,
			nonce,
			localCharts,
			targetCover
		);
		const response = custodian.evaluateTransition(request);
		const recoveredMaskedDelta = recoverSignedMaskedDelta(
			response,
			targetCover
		);
		const applied = applyMaskedTransitionResponse(
			custodian.clientContract,
			clientState,
			localCharts,
			targetCover,
			response,
			request
		);
		const nextOwnerState = applyOwnerTransition(
			HIDDEN_TRANSITIONS[epoch]!,
			ownerState
		);

		ownerDeltas.push(
			nextOwnerState.map((value, lane) =>
				subtract(value, ownerState[lane]!)
			)
		);
		ownerState = nextOwnerState;
		ownerStates.push(ownerState);
		maskedDeltas.push(recoveredMaskedDelta);
		charts = applied.charts;
		clientState = applied.state;
		maskedStates.push(recoverMaskedState(charts, targetCover));
	}

	const projectionNonce = exitNonce(sessionOrdinal);
	const projectionRequest = prepareMaskedProjectionRequest(
		custodian.clientContract,
		clientState,
		charts,
		projectionNonce
	);
	const projectionResponse =
		custodian.evaluateExitProjection(projectionRequest);
	const opened = openMaskedCustodyProjection(
		custodian.clientContract,
		clientState,
		projectionResponse,
		projectionRequest
	);

	return Object.freeze({
		clientContract: custodian.clientContract,
		input: Object.freeze(input.map(normalize)),
		ownerStates: freezeMatrix(ownerStates),
		ownerDeltas: freezeMatrix(ownerDeltas),
		maskedStates: freezeMatrix(maskedStates),
		maskedDeltas: freezeMatrix(maskedDeltas),
		output: opened.projection,
		transitionRequests: TRANSITION_COUNT,
		signedTransitionResponses: TRANSITION_COUNT,
		projectionRequests: 1,
		signedProjectionResponses: 1,
	});
}

function createFreshCustodian(
	sessionOrdinal: number
): ReferenceMaskedChartCustodian {
	const tag = `fresh-${sessionOrdinal}`;
	return new ReferenceMaskedChartCustodian({
		sessionId: `masked-attacker-session-${tag}`,
		contractId: "masked-attacker-contract",
		covers: COVERS,
		transitions: HIDDEN_TRANSITIONS,
		exitProjection: EXIT_PROJECTION,
		initialLineageCommitment: `masked-attacker-genesis-${tag}`,
		lineageSecret: "shared-service-lineage-secret",
		maskSecret: "shared-service-mask-secret",
		sharingSecret: "shared-service-sharing-secret",
		responseSecret: "shared-service-response-secret",
	});
}

function captureFirstTransition(
	sessionOrdinal: number,
	input: readonly number[]
): FirstTransitionCapture {
	const custodian = createFreshCustodian(sessionOrdinal);
	const charts = encodeIngressCharts(
		input,
		COVERS[0]!,
		ingressSeed(sessionOrdinal)
	);
	const state = createMaskedCustodyClientState(
		custodian.clientContract
	);
	const nonce = transitionNonce(sessionOrdinal, 0);
	const localCharts = transportAffineCharts(
		charts,
		COVERS[0]!,
		COVERS[1]!,
		IDENTITY_TRANSITION,
		transportSeed(sessionOrdinal, 0)
	);
	const request = prepareMaskedTransitionRequest(
		custodian.clientContract,
		state,
		charts,
		nonce,
		localCharts,
		COVERS[1]!
	);
	const response = custodian.evaluateTransition(request);
	return Object.freeze({
		contract: custodian.clientContract,
		state,
		localCharts,
		response,
		request,
	});
}

function recoverMaskedState(
	charts: Parameters<typeof evaluateCertifiedProjection>[0],
	cover: ChartCover
): number[] {
	return Array.from({ length: cover.width }, (_, coordinate) =>
		evaluateCertifiedProjection(charts, cover, {
			id: `attacker_coordinate_${cover.epoch}_${coordinate}`,
			coefficients: Array.from(
				{ length: cover.width },
				(_, lane) => (lane === coordinate ? 1 : 0)
			),
			bias: 0,
		})
	);
}

/**
 * Independently recover the response's masked delta. Contributions are raw
 * Shamir shares of `targetCover.mixing * maskedDelta`; all interpolation and
 * mixing metadata needed to undo that representation is client-visible.
 */
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
						"MASKED_ATTACKER_MISSING_SIGNED_CONTRIBUTION"
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

function applyOwnerTransition(
	transition: HiddenMaskedTransition,
	input: readonly number[]
): number[] {
	const output = transition.linear.map((row, rowIndex) =>
		add(dot(row, input), transition.bias[rowIndex]!)
	);
	for (const term of transition.cubicTerms) {
		const projected = dot(term.inputProjection, input);
		const cubic = multiply(multiply(projected, projected), projected);
		for (let lane = 0; lane < output.length; lane++) {
			output[lane] = add(
				output[lane]!,
				multiply(
					multiply(term.coefficient, cubic),
					term.outputDirection[lane]!
				)
			);
		}
	}
	return output;
}

function buildSimplexTrainingSet(): {
	readonly samples: ReadonlyMap<string, number>;
	readonly captured: readonly CapturedSession[];
} {
	const samples = new Map<string, number>();
	const captured: CapturedSession[] = [];
	let sessionOrdinal = 1;
	for (let first = 0; first <= TOTAL_DEGREE_BOUND; first++) {
		for (
			let second = 0;
			second <= TOTAL_DEGREE_BOUND - first;
			second++
		) {
			for (
				let third = 0;
				third <= TOTAL_DEGREE_BOUND - first - second;
				third++
			) {
				const input = [first, second, third];
				const session = captureSession(sessionOrdinal++, input);
				samples.set(vectorKey(input), session.output);
				if (captured.length < 16) captured.push(session);
			}
		}
	}
	return Object.freeze({
		samples,
		captured: Object.freeze(captured),
	});
}

interface NewtonCoefficient {
	readonly index: readonly [number, number, number];
	readonly value: number;
}

/**
 * Learn the complete scalar polynomial from black-box I/O. A degree-nine
 * polynomial in three variables has C(12,3)=220 total-degree basis terms.
 * Values on the matching integer simplex yield its multivariate finite
 * differences without observing a chart, mask, contribution, or owner state.
 */
function learnFinalScalarPolynomial(
	samples: ReadonlyMap<string, number>
): readonly NewtonCoefficient[] {
	const coefficients: NewtonCoefficient[] = [];
	for (let first = 0; first <= TOTAL_DEGREE_BOUND; first++) {
		for (
			let second = 0;
			second <= TOTAL_DEGREE_BOUND - first;
			second++
		) {
			for (
				let third = 0;
				third <= TOTAL_DEGREE_BOUND - first - second;
				third++
			) {
				let difference = 0;
				for (let sampleFirst = 0; sampleFirst <= first; sampleFirst++) {
					for (
						let sampleSecond = 0;
						sampleSecond <= second;
						sampleSecond++
					) {
						for (
							let sampleThird = 0;
							sampleThird <= third;
							sampleThird++
						) {
							const sample = samples.get(
								vectorKey([
									sampleFirst,
									sampleSecond,
									sampleThird,
								])
							);
							if (sample === undefined) {
								throw new Error(
									"MASKED_ATTACKER_INCOMPLETE_SIMPLEX"
								);
							}
							const distance =
								first -
								sampleFirst +
								second -
								sampleSecond +
								third -
								sampleThird;
							const weight = multiply(
								multiply(
									binomialInteger(first, sampleFirst),
									binomialInteger(second, sampleSecond)
								),
								binomialInteger(third, sampleThird)
							);
							difference =
								distance % 2 === 0
									? add(difference, multiply(weight, sample))
									: subtract(
											difference,
											multiply(weight, sample)
										);
						}
					}
				}
				coefficients.push(
					Object.freeze({
						index: Object.freeze([
							first,
							second,
							third,
						]) as readonly [number, number, number],
						value: difference,
					})
				);
			}
		}
	}
	return Object.freeze(coefficients);
}

function evaluateLearnedPolynomial(
	coefficients: readonly NewtonCoefficient[],
	input: readonly number[]
): number {
	let output = 0;
	for (const coefficient of coefficients) {
		const basis = multiply(
			multiply(
				binomialField(input[0]!, coefficient.index[0]),
				binomialField(input[1]!, coefficient.index[1])
			),
			binomialField(input[2]!, coefficient.index[2])
		);
		output = add(output, multiply(coefficient.value, basis));
	}
	return output;
}

function measureDirectInternalRecovery(
	sessions: readonly CapturedSession[]
): {
	readonly maskedStateRecovery: number;
	readonly maskedDeltaRecovery: number;
	readonly protectedLogicalGuess: number;
	readonly unmaskedDeltaGuess: number;
} {
	let maskedStateMatches = 0;
	let maskedStateTotal = 0;
	let maskedDeltaMatches = 0;
	let maskedDeltaTotal = 0;
	let logicalGuessMatches = 0;
	let logicalGuessTotal = 0;
	let unmaskedDeltaGuessMatches = 0;
	let unmaskedDeltaGuessTotal = 0;

	for (const session of sessions) {
		for (let epoch = 0; epoch < TRANSITION_COUNT; epoch++) {
			for (let lane = 0; lane < WIDTH; lane++) {
				const expectedMaskedDelta = subtract(
					session.maskedStates[epoch + 1]![lane]!,
					session.maskedStates[epoch]![lane]!
				);
				if (
					session.maskedDeltas[epoch]![lane] ===
					expectedMaskedDelta
				) {
					maskedDeltaMatches++;
				}
				maskedDeltaTotal++;
				if (
					session.maskedDeltas[epoch]![lane] ===
					session.ownerDeltas[epoch]![lane]
				) {
					unmaskedDeltaGuessMatches++;
				}
				unmaskedDeltaGuessTotal++;
			}
		}
		for (let epoch = 0; epoch <= TRANSITION_COUNT; epoch++) {
			for (let lane = 0; lane < WIDTH; lane++) {
				if (Number.isInteger(session.maskedStates[epoch]![lane])) {
					maskedStateMatches++;
				}
				maskedStateTotal++;
				if (
					epoch > 0 &&
					session.maskedStates[epoch]![lane] ===
						session.ownerStates[epoch]![lane]
				) {
					logicalGuessMatches++;
				}
				if (epoch > 0) logicalGuessTotal++;
			}
		}
	}

	return Object.freeze({
		maskedStateRecovery: fraction(
			maskedStateMatches,
			maskedStateTotal
		),
		maskedDeltaRecovery: fraction(
			maskedDeltaMatches,
			maskedDeltaTotal
		),
		protectedLogicalGuess: fraction(
			logicalGuessMatches,
			logicalGuessTotal
		),
		unmaskedDeltaGuess: fraction(
			unmaskedDeltaGuessMatches,
			unmaskedDeltaGuessTotal
		),
	});
}

function measureCrossSessionTransfer(): {
	readonly directAccepted: boolean;
	readonly reboundAccepted: boolean;
	readonly stateAccuracy: number;
	readonly deltaAccuracy: number;
	readonly outputAccuracy: number;
	readonly freshKeys: boolean;
} {
	const input = [17, 19, 23];
	const first = captureSession(20_001, input);
	const second = captureSession(20_002, input);
	const firstTransition = captureFirstTransition(20_003, input);
	const secondTransition = captureFirstTransition(20_004, input);

	const directAccepted = doesNotThrow(() =>
		applyMaskedTransitionResponse(
			secondTransition.contract,
			secondTransition.state,
			secondTransition.localCharts,
			COVERS[1]!,
			firstTransition.response,
			secondTransition.request
		)
	);
	const reboundResponse: ChartCustodyResponse = Object.freeze({
		...firstTransition.response,
		sessionId: secondTransition.contract.sessionId,
		contractId: secondTransition.contract.contractId,
		requestNonce: secondTransition.request.nonce,
	});
	const reboundAccepted = doesNotThrow(() =>
		applyMaskedTransitionResponse(
			secondTransition.contract,
			secondTransition.state,
			secondTransition.localCharts,
			COVERS[1]!,
			reboundResponse,
			secondTransition.request
		)
	);

	return Object.freeze({
		directAccepted,
		reboundAccepted,
		stateAccuracy: exactCoordinateAccuracy(
			first.maskedStates.slice(1),
			second.maskedStates.slice(1)
		),
		deltaAccuracy: exactCoordinateAccuracy(
			first.maskedDeltas,
			second.maskedDeltas
		),
		outputAccuracy: first.output === second.output ? 1 : 0,
		freshKeys:
			first.clientContract.verificationKey !==
			second.clientContract.verificationKey,
	});
}

export function buildMaskedCustodyAttackerReport(): MaskedCustodyAttackerReport {
	const training = buildSimplexTrainingSet();
	const learnedPolynomial = learnFinalScalarPolynomial(training.samples);
	const heldOutInputs = Object.freeze([
		Object.freeze([11, 13, 17]),
		Object.freeze([21, 8, 14]),
		Object.freeze([31, 7, 2]),
		Object.freeze([15, 22, 9]),
	]);
	const heldOutMatches = heldOutInputs.filter((input, index) => {
		const actual = captureSession(10_001 + index, input).output;
		return evaluateLearnedPolynomial(learnedPolynomial, input) === actual;
	}).length;
	const heldOutAccuracy = fraction(
		heldOutMatches,
		heldOutInputs.length
	);
	const directRecovery = measureDirectInternalRecovery(training.captured);
	const crossSession = measureCrossSessionTransfer();
	const representative = training.captured[0]!;
	const contractKeys = Object.keys(representative.clientContract);
	const serializedContract = JSON.stringify(
		representative.clientContract
	).toLowerCase();
	const hiddenRelationMaterialPresent = [
		"transitions",
		"linear",
		"cubicterms",
		"masksecret",
		"sharingsecret",
		"responsesecret",
		"lineagesecret",
	].some((token) => serializedContract.includes(token));
	const chartCells = CHART_COUNT * WIDTH;
	const interceptedRequests =
		representative.transitionRequests +
		representative.projectionRequests;
	const interceptedSignedResponses =
		representative.signedTransitionResponses +
		representative.signedProjectionResponses;
	const requestChartFieldElements = interceptedRequests * chartCells;
	const contributionFieldElements =
		TRANSITION_COUNT * CHART_COUNT * WIDTH;
	const finalResponseAndOpeningFieldElements = 5;
	const openedProjectionFieldElements = 1;
	const interceptedTraceFieldElements =
		requestChartFieldElements +
		contributionFieldElements +
		finalResponseAndOpeningFieldElements +
		openedProjectionFieldElements;
	const reconstructionChartCellReads =
		(TRANSITION_COUNT + 1) * THRESHOLD * WIDTH +
		TRANSITION_COUNT * THRESHOLD * WIDTH;
	const semanticPlainTraceFieldElements =
		(TRANSITION_COUNT + 1) * WIDTH +
		TRANSITION_COUNT * WIDTH +
		1;
	const plainDirectReads =
		(TRANSITION_COUNT + 1) * WIDTH + TRANSITION_COUNT * WIDTH;
	const traceAmplificationRatio =
		interceptedTraceFieldElements / semanticPlainTraceFieldElements;
	const reconstructionWorkRatio =
		reconstructionChartCellReads / plainDirectReads;
	const residentStorageRatio = chartCells / WIDTH;
	const compatibleStateCount =
		BigInt(CSH_FIELD_MODULUS) ** BigInt(WIDTH);
	const freshMaskWholeStateGuessProbability =
		1 / Number(compatibleStateCount);
	const trainingQueries = training.samples.size;
	const expectedTrainingQueries = binomialInteger(
		TOTAL_DEGREE_BOUND + WIDTH,
		WIDTH
	);

	if (trainingQueries !== expectedTrainingQueries) {
		throw new Error("MASKED_ATTACKER_BAD_TRAINING_CARDINALITY");
	}

	const gates: MaskedCustodyGate[] = [
		Object.freeze({
			id: "MASKED-CUSTODY-DIRECT-INTERNAL-RECOVERY",
			status:
				directRecovery.protectedLogicalGuess === 0 &&
				directRecovery.unmaskedDeltaGuess === 0
					? "pass"
					: "fail",
			measured: Math.max(
				directRecovery.protectedLogicalGuess,
				directRecovery.unmaskedDeltaGuess
			),
			required:
				"0 exact protected coordinates from decoded masked state/delta",
			reason:
				"Full chart and contribution interception reconstructs the masked representation exactly, while every protected logical vector remains compatible with P^width masks.",
		}),
		Object.freeze({
			id: "MASKED-CUSTODY-CROSS-SESSION-TRANSFER",
			status:
				!crossSession.directAccepted &&
				!crossSession.reboundAccepted &&
				crossSession.stateAccuracy === 0 &&
				crossSession.deltaAccuracy === 0
					? "pass"
					: "fail",
			measured: Math.max(
				crossSession.stateAccuracy,
				crossSession.deltaAccuracy
			),
			required:
				"0 internal coordinate transfer and no accepted foreign response",
			reason:
				"Fresh masks prevent raw state/delta transfer; session fields and fresh signing keys reject direct and field-rebound signed responses.",
		}),
		Object.freeze({
			id: "MASKED-CUSTODY-FINAL-ORACLE-NONLEARNABILITY",
			status: heldOutAccuracy <= 0.1 ? "pass" : "fail",
			measured: heldOutAccuracy,
			required:
				"<= 0.10 held-out output accuracy from chosen-input final outputs",
			reason:
				"The complete degree-nine final scalar function is interpolated from black-box outputs only; this does not recover an intermediate state or relation.",
		}),
		Object.freeze({
			id: "MASKED-CUSTODY-TRACE-AMPLIFICATION",
			status:
				traceAmplificationRatio >= REQUIRED_AMPLIFICATION
					? "pass"
					: "fail",
			measured: traceAmplificationRatio,
			required: `>= ${REQUIRED_AMPLIFICATION}x client-visible trace volume`,
			reason:
				"Chart requests, signed contributions, and the final opening produce only a small constant-factor trace expansion over direct semantic values.",
		}),
		Object.freeze({
			id: "MASKED-CUSTODY-RECONSTRUCTION-WORK",
			status:
				reconstructionWorkRatio >= REQUIRED_AMPLIFICATION
					? "pass"
					: "fail",
			measured: reconstructionWorkRatio,
			required: `>= ${REQUIRED_AMPLIFICATION}x field-read work`,
			reason:
				"Three threshold charts recover each masked state or response delta with low linear work.",
		}),
		Object.freeze({
			id: "MASKED-CUSTODY-RESIDENT-STORAGE",
			status:
				residentStorageRatio >= REQUIRED_AMPLIFICATION
					? "pass"
					: "fail",
			measured: residentStorageRatio,
			required: `>= ${REQUIRED_AMPLIFICATION}x resident representation`,
			reason:
				"Five charts store five cells per logical coordinate, below the dynamic-floor target.",
		}),
		Object.freeze({
			id: "MASKED-CUSTODY-HOOK-COLLAPSE",
			status: "fail",
			measured: 2,
			required:
				"> 2 localized client hook families for all client-visible intermediate and final values",
			reason:
				"Hooking transition application and final opening captures every signed contribution, masked state, and ordinary output.",
		}),
	];
	const failedGates = gates
		.filter((gate) => gate.status === "fail")
		.map((gate) => gate.id);

	return Object.freeze({
		schemaVersion: MASKED_CUSTODY_ATTACKER_REPORT_VERSION,
		decision: failedGates.length === 0 ? "go" : "no-go",
		clientArtifact: Object.freeze({
			contractFieldCount: contractKeys.length,
			hiddenRelationMaterialPresent,
			coverPathVisible:
				representative.clientContract.coverIds.length ===
				TRANSITION_COUNT + 1,
		}),
		internalRecovery: Object.freeze({
			ingressLogicalStateRecovery: exactVectorAccuracy(
				representative.input,
				representative.maskedStates[0]!
			),
			maskedStateRecovery: directRecovery.maskedStateRecovery,
			maskedTransitionDeltaRecovery:
				directRecovery.maskedDeltaRecovery,
			protectedLogicalCoordinateGuessAccuracy:
				directRecovery.protectedLogicalGuess,
			unmaskedDeltaCoordinateGuessAccuracy:
				directRecovery.unmaskedDeltaGuess,
			compatibleLogicalStatesPerProtectedObservation:
				String(compatibleStateCount),
			freshMaskWholeStateGuessProbability,
		}),
		crossSession: Object.freeze({
			directSignedResponseAccepted: crossSession.directAccepted,
			fieldReboundResponseAccepted: crossSession.reboundAccepted,
			maskedStateCoordinateTransferAccuracy:
				crossSession.stateAccuracy,
			maskedDeltaCoordinateTransferAccuracy:
				crossSession.deltaAccuracy,
			finalProjectionTransferAccuracy: crossSession.outputAccuracy,
			sharedServiceSecrets: true,
			nonceReuseAcrossSessions: true,
			freshVerificationKeys: crossSession.freshKeys,
		}),
		chosenInputOracle: Object.freeze({
			relationStages: TRANSITION_COUNT,
			totalDegreeBound: TOTAL_DEGREE_BOUND,
			trainingQueries,
			heldOutQueries: heldOutInputs.length,
			heldOutOutputAccuracy: heldOutAccuracy,
			learnedScope: "complete-final-scalar-function",
			evidenceSource: "black-box-io-only",
			intermediateRelationRecovered: false,
			intermediateStateRecovered: false,
		}),
		dynamicProxy: Object.freeze({
			chartCount: CHART_COUNT,
			width: WIDTH,
			threshold: THRESHOLD,
			transitionCount: TRANSITION_COUNT,
			interceptedRequests,
			interceptedSignedResponses,
			interceptedTraceFieldElements,
			reconstructionChartCellReads,
			semanticPlainTraceFieldElements,
			plainDirectReads,
			traceAmplificationRatio,
			reconstructionWorkRatio,
			residentStorageRatio,
			localizedHookFamilies: 2,
			remainingHookSurfaces: Object.freeze([
				"applyMaskedTransitionResponse arguments and return",
				"openMaskedCustodyProjection arguments and return",
			]),
		}),
		gates: Object.freeze(gates),
		failedGates: Object.freeze(failedGates),
	});
}

function exactCoordinateAccuracy(
	left: readonly (readonly number[])[],
	right: readonly (readonly number[])[]
): number {
	let matches = 0;
	let total = 0;
	for (let row = 0; row < left.length; row++) {
		for (let lane = 0; lane < (left[row]?.length ?? 0); lane++) {
			if (left[row]![lane] === right[row]?.[lane]) matches++;
			total++;
		}
	}
	return fraction(matches, total);
}

function exactVectorAccuracy(
	left: readonly number[],
	right: readonly number[]
): number {
	return exactCoordinateAccuracy([left], [right]);
}

function doesNotThrow(operation: () => unknown): boolean {
	try {
		operation();
		return true;
	} catch {
		return false;
	}
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
		if (pivot < 0) throw new Error("MASKED_ATTACKER_SINGULAR_MATRIX");
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
	return matrix.map((row) => dot(row, vector));
}

function dot(
	left: readonly number[],
	right: readonly number[]
): number {
	let result = 0;
	for (let index = 0; index < left.length; index++) {
		result = add(result, multiply(left[index]!, right[index]!));
	}
	return result;
}

function binomialInteger(total: number, chosen: number): number {
	if (chosen < 0 || chosen > total) return 0;
	const count = Math.min(chosen, total - chosen);
	let value = 1;
	for (let index = 1; index <= count; index++) {
		value = (value * (total - count + index)) / index;
	}
	return value;
}

function binomialField(value: number, chosen: number): number {
	let numerator = 1;
	let denominator = 1;
	for (let index = 0; index < chosen; index++) {
		numerator = multiply(numerator, subtract(value, index));
		denominator = multiply(denominator, index + 1);
	}
	return multiply(numerator, inverse(denominator));
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
	if (normalized === 0) throw new Error("MASKED_ATTACKER_ZERO_INVERSE");
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

function fraction(numerator: number, denominator: number): number {
	return denominator === 0 ? 0 : numerator / denominator;
}

function vectorKey(vector: readonly number[]): string {
	return vector.join(",");
}

function ingressSeed(sessionOrdinal: number): number {
	return 100_000 + sessionOrdinal * 17;
}

function transportSeed(sessionOrdinal: number, epoch: number): number {
	return 200_000 + sessionOrdinal * 31 + epoch;
}

function transitionNonce(sessionOrdinal: number, epoch: number): string {
	void sessionOrdinal;
	return `reused-transition-nonce-${epoch}`;
}

function exitNonce(sessionOrdinal: number): string {
	void sessionOrdinal;
	return "reused-projection-nonce";
}

function freezeMatrix(
	matrix: readonly (readonly number[])[]
): readonly (readonly number[])[] {
	return Object.freeze(
		matrix.map((row) => Object.freeze([...row]))
	);
}
