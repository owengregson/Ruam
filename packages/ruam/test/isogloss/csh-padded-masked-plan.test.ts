import { describe, expect, it } from "bun:test";
import {
	applyMaskedTransitionResponse,
	createMaskedCustodyClientState,
	openMaskedCustodyProjection,
	prepareMaskedProjectionRequest,
	prepareMaskedTransitionRequest,
} from "../../src/isogloss/csh/masked-custody-protocol.js";
import {
	createPaddedMaskedCustodyPlan,
	MASKED_CUSTODY_TRANSCRIPT_BUCKETS,
	type PaddedMaskedCustodyPlan,
} from "../../src/isogloss/csh/padded-masked-plan.js";
import {
	ReferenceMaskedChartCustodian,
	type HiddenMaskedTransition,
} from "../../src/isogloss/csh/reference-masked-custodian.js";
import {
	CSH_FIELD_MODULUS,
	encodeIngressCharts,
	transportAffineCharts,
} from "../../src/isogloss/csh/reference.js";

const WIDTH = 3;

const realTransitions: readonly HiddenMaskedTransition[] = [
	{
		linear: [
			[1, 1, 0],
			[0, 1, 0],
			[0, 0, 1],
		],
		bias: [3, 5, 7],
		cubicTerms: [
			{
				inputProjection: [1, 0, 1],
				outputDirection: [1, 2, 0],
				coefficient: 11,
			},
		],
	},
	{
		linear: [
			[1, 0, 0],
			[1, 1, 0],
			[0, 0, 1],
		],
		bias: [13, 17, 19],
		cubicTerms: [
			{
				inputProjection: [0, 1, 1],
				outputDirection: [0, 1, 3],
				coefficient: 23,
			},
		],
	},
];

const exitProjection = {
	id: "padded_exit",
	coefficients: [1, 2, 3],
	bias: 29,
};

const identity = {
	id: "padded_identity_transport",
	matrix: [
		[1, 0, 0],
		[0, 1, 0],
		[0, 0, 1],
	],
	bias: [0, 0, 0],
};

interface Execution {
	readonly output: number;
	readonly contract: ReferenceMaskedChartCustodian["clientContract"];
	readonly responseShapes: readonly string[];
}

function executePlan(
	plan: PaddedMaskedCustodyPlan,
	sessionId: string
): Execution {
	const custodian = new ReferenceMaskedChartCustodian({
		sessionId,
		contractId: "padded_bucket_contract",
		covers: plan.covers,
		transitions: plan.transitions,
		exitProjection,
		initialLineageCommitment: "padded_genesis",
		lineageSecret: "padded_service_lineage",
		maskSecret: "padded_service_mask",
		sharingSecret: "padded_service_sharing",
		responseSecret: "padded_service_response",
	});
	let charts = encodeIngressCharts([2, 3, 5], plan.covers[0]!, 5151);
	let state = createMaskedCustodyClientState(custodian.clientContract);
	const responseShapes: string[] = [];
	for (let epoch = 0; epoch < plan.transitions.length; epoch++) {
		const request = prepareMaskedTransitionRequest(
			custodian.clientContract,
			state,
			charts,
			`padded_nonce_${epoch}`
		);
		const response = custodian.evaluateTransition(request);
		responseShapes.push(
			JSON.stringify({
				keys: Object.keys(response).sort(),
				contributions: response.chartContributions.length,
				cells: response.chartContributions.map(
					(contribution) => contribution.cells.length
				),
				signatureLength: response.signature.length,
			})
		);
		const target = plan.covers[epoch + 1]!;
		const local = transportAffineCharts(
			charts,
			plan.covers[epoch]!,
			target,
			identity,
			6161 + epoch
		);
		const applied = applyMaskedTransitionResponse(
			custodian.clientContract,
			state,
			local,
			target,
			response,
			request.nonce
		);
		charts = applied.charts;
		state = applied.state;
	}
	const request = prepareMaskedProjectionRequest(
		custodian.clientContract,
		state,
		charts,
		"padded_exit_nonce"
	);
	const opened = openMaskedCustodyProjection(
		custodian.clientContract,
		state,
		custodian.evaluateExitProjection(request),
		request.nonce
	);
	return Object.freeze({
		output: opened.projection,
		contract: custodian.clientContract,
		responseShapes: Object.freeze(responseShapes),
	});
}

function createPlan(placementSeed: number): PaddedMaskedCustodyPlan {
	return createPaddedMaskedCustodyPlan({
		realTransitions,
		width: WIDTH,
		bucketSize: 4,
		coverSeed: 4242,
		placementSeed,
	});
}

function findDifferentlyPlacedPlans(): [
	PaddedMaskedCustodyPlan,
	PaddedMaskedCustodyPlan,
] {
	const first = createPlan(1);
	for (let seed = 2; seed < 1_000; seed++) {
		const candidate = createPlan(seed);
		if (
			JSON.stringify(candidate.realTransitionSlots) !==
			JSON.stringify(first.realTransitionSlots)
		) {
			return [first, candidate];
		}
	}
	throw new Error("Missing distinct padded placement");
}

describe("fixed-bucket statefully masked custody planning", () => {
	it("preserves output while hiding real transition positions", () => {
		const [firstPlan, secondPlan] = findDifferentlyPlacedPlans();
		const first = executePlan(firstPlan, "padded_session_a");
		const second = executePlan(secondPlan, "padded_session_b");
		let ownerState = [2, 3, 5];
		for (const transition of realTransitions) {
			ownerState = applyOwnerTransition(transition, ownerState);
		}
		const expected = add(
			dot(exitProjection.coefficients, ownerState),
			exitProjection.bias
		);

		expect(firstPlan.realTransitionSlots).not.toEqual(
			secondPlan.realTransitionSlots
		);
		expect(first.output).toBe(expected);
		expect(second.output).toBe(expected);
		expect(firstPlan.paddingTransitionCount).toBe(2);
		expect(secondPlan.paddingTransitionCount).toBe(2);
	});

	it("has one fixed client-visible shape for every epoch and placement", () => {
		const [firstPlan, secondPlan] = findDifferentlyPlacedPlans();
		const first = executePlan(firstPlan, "shape_session_a");
		const second = executePlan(secondPlan, "shape_session_b");

		expect(firstPlan.transcriptClassId).toBe(
			"csh-masked-v1-w3-e4"
		);
		expect(secondPlan.transcriptClassId).toBe(
			firstPlan.transcriptClassId
		);
		expect(firstPlan.covers).toEqual(secondPlan.covers);
		expect(first.contract.coverIds).toEqual(second.contract.coverIds);
		expect(first.contract.coverIds).toHaveLength(5);
		expect(new Set(first.responseShapes).size).toBe(1);
		expect(new Set(second.responseShapes).size).toBe(1);
		expect(first.responseShapes).toEqual(second.responseShapes);
	});

	it("keeps owner schedule and real stage count out of the client contract", () => {
		const plan = createPlan(9191);
		const execution = executePlan(plan, "secrecy_session");
		const serialized = JSON.stringify(execution.contract).toLowerCase();

		for (const forbidden of [
			"realtransitions",
			"realtransitionslots",
			"paddingtransitioncount",
			"placement",
			"identity",
			"linear",
			"cubic",
			"bias",
		]) {
			expect(serialized).not.toContain(forbidden);
		}
		expect(plan.realTransitionSlots).toHaveLength(2);
	});

	it("accepts only fixed transcript buckets and fitting real plans", () => {
		expect(MASKED_CUSTODY_TRANSCRIPT_BUCKETS).toEqual([4, 8, 16, 32]);
		expect(() =>
			createPaddedMaskedCustodyPlan({
				realTransitions,
				width: WIDTH,
				bucketSize: 3 as 4,
				coverSeed: 1,
				placementSeed: 2,
			})
		).toThrow("RUAM_CSH_PADDED_PLAN_INVALID_BUCKET");
		expect(() =>
			createPaddedMaskedCustodyPlan({
				realTransitions: Array.from(
					{ length: 5 },
					() => realTransitions[0]!
				),
				width: WIDTH,
				bucketSize: 4,
				coverSeed: 1,
				placementSeed: 2,
			})
		).toThrow("RUAM_CSH_PADDED_PLAN_TRANSITION_COUNT");
	});
});

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

function dot(left: readonly number[], right: readonly number[]): number {
	let result = 0;
	for (let index = 0; index < left.length; index++) {
		result = add(result, multiply(left[index]!, right[index]!));
	}
	return result;
}

function add(left: number, right: number): number {
	return normalize(normalize(left) + normalize(right));
}

function multiply(left: number, right: number): number {
	return normalize(normalize(left) * normalize(right));
}

function normalize(value: number): number {
	const reduced = Math.trunc(value) % CSH_FIELD_MODULUS;
	return reduced < 0 ? reduced + CSH_FIELD_MODULUS : reduced;
}
