/**
 * Deterministic compiler-side candidate planning for bounded pure regions.
 *
 * The planner does not infer JavaScript value types or duplicate the lowering
 * proof. Every eligible entry receives explicit assumptions from its caller,
 * and every candidate is accepted only by lowerEffectRegionsToPureContract.
 *
 * @module compiler/pure-region-planning
 */

import type { SemanticUnit } from "./ir.js";
import {
	lowerEffectRegionsToPureContract,
	type LoweredPureRegionContract,
	type PureRegionInputAssumption,
} from "./pure-region-lowering.js";
import type {
	EffectRegion,
	EffectRegionGraph,
	EffectRegionId,
} from "./regions.js";

const LOWERING_REJECTION_CODES = Object.freeze([
	"RUAM_PURE_REGION_CONTROL_JOIN",
	"RUAM_PURE_REGION_CYCLIC_SELECTION",
	"RUAM_PURE_REGION_DUPLICATE_ASSUMPTION",
	"RUAM_PURE_REGION_DYNAMIC_STACK",
	"RUAM_PURE_REGION_EXCEPTION_ENTRY",
	"RUAM_PURE_REGION_EXCEPTION_PATH_SELECTED",
	"RUAM_PURE_REGION_INPUT_TYPE_REQUIRED",
	"RUAM_PURE_REGION_INVALID_BINDING",
	"RUAM_PURE_REGION_NEGATIVE_ZERO_RISK",
	"RUAM_PURE_REGION_NONLINEAR_SELECTION",
	"RUAM_PURE_REGION_NUMERIC_DOMAIN_OVERFLOW",
	"RUAM_PURE_REGION_REQUIRES_BRAIDABLE_STEPS",
	"RUAM_PURE_REGION_REQUIRES_FALLTHROUGH",
	"RUAM_PURE_REGION_REQUIRES_INPUT",
	"RUAM_PURE_REGION_REQUIRES_OUTPUT",
	"RUAM_PURE_REGION_TYPE_MISMATCH",
	"RUAM_PURE_REGION_UNINITIALIZED_READ",
	"RUAM_PURE_REGION_UNREPRESENTABLE_CONTROL",
	"RUAM_PURE_REGION_UNREPRESENTABLE_STATE_OUTPUT",
	"RUAM_PURE_REGION_UNSAFE_NUMBER_LITERAL",
	"RUAM_PURE_REGION_UNSUPPORTED_OP",
	"RUAM_PURE_REGION_UNUSED_ASSUMPTION",
] as const);

const LOWERING_REJECTION_CODE_SET: ReadonlySet<string> = new Set(
	LOWERING_REJECTION_CODES
);
const NO_ASSUMPTIONS_CODE =
	"RUAM_PURE_REGION_PLAN_ASSUMPTIONS_UNAVAILABLE" as const;

export const PURE_REGION_PLANNING_LIMITS = Object.freeze({
	regions: 1_024,
	loweringAttempts: 4_096,
	retainedRejections: 512,
});

export type PureRegionLoweringRejectionCode =
	(typeof LOWERING_REJECTION_CODES)[number];
export type PureRegionCandidateRejectionCode =
	| PureRegionLoweringRejectionCode
	| typeof NO_ASSUMPTIONS_CODE;

/**
 * Called at most once for each unconsumed graph-order entry considered by the
 * planner. Returning undefined makes the entry ineligible; an empty array is
 * an explicit assumption set and is still submitted to the sound lowerer.
 */
export type PureRegionEntryAssumptionProvider = (
	entryRegion: EffectRegion,
	entryRegionIndex: number
) => readonly PureRegionInputAssumption[] | undefined;

/** Assumptions keyed by the region at which their guards would be installed. */
export type PureRegionEntryAssumptionMap = ReadonlyMap<
	EffectRegionId,
	readonly PureRegionInputAssumption[]
>;

export type PureRegionEntryAssumptionSource =
	| PureRegionEntryAssumptionMap
	| PureRegionEntryAssumptionProvider;

export interface PlannedPureRegionCandidate {
	entryRegionId: EffectRegionId;
	/** Inclusive index in EffectRegionGraph.regions. */
	startRegionIndex: number;
	/** Inclusive index in EffectRegionGraph.regions. */
	endRegionIndex: number;
	lowered: LoweredPureRegionContract;
}

/**
 * One deterministic failed lowering attempt. Diagnostics remain compiler-only
 * and may retain region identities; generated BPRF artifacts do not.
 */
export interface PureRegionCandidateRejection {
	entryRegionId: EffectRegionId;
	startRegionIndex: number;
	/** Inclusive attempted end, or the start for an untyped entry. */
	endRegionIndex: number;
	regionIds: readonly EffectRegionId[];
	code: PureRegionCandidateRejectionCode;
	detail: string | null;
}

export interface PureRegionCandidatePlan {
	unitId: string;
	candidates: readonly PlannedPureRegionCandidate[];
	rejections: readonly PureRegionCandidateRejection[];
	omittedRejectionCount: number;
}

/**
 * Discover disjoint maximal lowerable spans in canonical graph order.
 *
 * At each unconsumed entry with explicit assumptions, ends are attempted from
 * longest to shortest. The first success is therefore maximal for that entry
 * under precisely those guards. Its complete span is consumed before planning
 * resumes, which makes candidates disjoint and gives deterministic left-to-
 * right precedence.
 *
 * Only recognized proof failures become diagnostics. Malformed canonical
 * inputs, lowerer invariant failures, provider exceptions, and all unexpected
 * errors propagate instead of being mislabeled as ordinary ineligibility.
 */
export function planPureRegionCandidates(
	unit: SemanticUnit,
	graph: EffectRegionGraph,
	assumptionSource: PureRegionEntryAssumptionSource
): PureRegionCandidatePlan {
	if (graph.unitId !== unit.id) {
		throw new Error(
			`RUAM_PURE_REGION_PLAN_UNIT_MISMATCH: ${String(graph.unitId)}:${unit.id}`
		);
	}
	if (graph.regions.length > PURE_REGION_PLANNING_LIMITS.regions) {
		throw new Error(
			`RUAM_PURE_REGION_PLAN_RESOURCE_LIMIT: regions:${graph.regions.length}`
		);
	}

	const candidates: PlannedPureRegionCandidate[] = [];
	const rejections: PureRegionCandidateRejection[] = [];
	let omittedRejectionCount = 0;
	let loweringAttempts = 0;
	const recordRejection = (
		rejection: PureRegionCandidateRejection
	): void => {
		if (
			rejections.length <
			PURE_REGION_PLANNING_LIMITS.retainedRejections
		) {
			rejections.push(freezeRejection(rejection));
		} else {
			omittedRejectionCount++;
		}
	};
	let startRegionIndex = 0;

	while (startRegionIndex < graph.regions.length) {
		const entryRegion = graph.regions[startRegionIndex]!;
		const assumptions = resolveAssumptions(
			assumptionSource,
			entryRegion,
			startRegionIndex
		);

		if (assumptions === undefined) {
			recordRejection(
				{
					entryRegionId: entryRegion.id,
					startRegionIndex,
					endRegionIndex: startRegionIndex,
					regionIds: Object.freeze([entryRegion.id]),
					code: NO_ASSUMPTIONS_CODE,
					detail: null,
				}
			);
			startRegionIndex++;
			continue;
		}

		let accepted: PlannedPureRegionCandidate | undefined;
		for (
			let endRegionIndex = graph.regions.length - 1;
			endRegionIndex >= startRegionIndex;
			endRegionIndex--
		) {
			loweringAttempts++;
			if (
				loweringAttempts >
				PURE_REGION_PLANNING_LIMITS.loweringAttempts
			) {
				throw new Error(
					`RUAM_PURE_REGION_PLAN_RESOURCE_LIMIT: lowering-attempts:${loweringAttempts}`
				);
			}
			const regionIds = Object.freeze(
				graph.regions
					.slice(startRegionIndex, endRegionIndex + 1)
					.map((region) => region.id)
			);
			try {
				const lowered = lowerEffectRegionsToPureContract(unit, graph, {
					regionIds,
					assumptions,
				});
				accepted = Object.freeze({
					entryRegionId: entryRegion.id,
					startRegionIndex,
					endRegionIndex,
					lowered,
				});
				break;
			} catch (error) {
				const rejection = classifyOrdinaryRejection(error);
				if (!rejection) throw error;
				recordRejection(
					{
						entryRegionId: entryRegion.id,
						startRegionIndex,
						endRegionIndex,
						regionIds,
						code: rejection.code,
						detail: rejection.detail,
					}
				);
			}
		}

		if (accepted) {
			candidates.push(accepted);
			startRegionIndex = accepted.endRegionIndex + 1;
		} else {
			startRegionIndex++;
		}
	}

	return Object.freeze({
		unitId: unit.id,
		candidates: Object.freeze(candidates),
		rejections: Object.freeze(rejections),
		omittedRejectionCount,
	});
}

function resolveAssumptions(
	source: PureRegionEntryAssumptionSource,
	entryRegion: EffectRegion,
	entryRegionIndex: number
): readonly PureRegionInputAssumption[] | undefined {
	const assumptions =
		typeof source === "function"
			? source(entryRegion, entryRegionIndex)
			: source.get(entryRegion.id);
	if (assumptions === undefined) return undefined;

	return Object.freeze(
		assumptions.map((assumption) =>
			Object.freeze({
				binding: Object.freeze({ ...assumption.binding }),
				domain: Object.freeze({ ...assumption.domain }),
			})
		)
	);
}

function classifyOrdinaryRejection(
	error: unknown
): { code: PureRegionLoweringRejectionCode; detail: string | null } | null {
	if (!(error instanceof Error)) return null;
	const match = /^(RUAM_PURE_REGION_[A-Z_]+)(?:: (.*))?$/.exec(
		error.message
	);
	if (!match || !LOWERING_REJECTION_CODE_SET.has(match[1]!)) return null;
	return {
		code: match[1] as PureRegionLoweringRejectionCode,
		detail: match[2] ?? null,
	};
}

function freezeRejection(
	rejection: PureRegionCandidateRejection
): PureRegionCandidateRejection {
	return Object.freeze(rejection);
}
