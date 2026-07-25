/**
 * OWNER/SERVER-ONLY fixed-bucket planning for statefully masked custody.
 *
 * Real logical transitions retain their order but occupy secret slots among
 * identity epochs. Every slot still refreshes the custodian representation
 * mask and moves to a fresh cover, so the client transcript reveals only the
 * declared width/epoch bucket, not the number or positions of real stages.
 *
 * @module isogloss/csh/padded-masked-plan
 */

import { deriveSeed } from "../../naming/scope.js";
import { createSeededRandom } from "../../random/entropy.js";
import {
	createChartCover,
	type ChartCover,
} from "./reference.js";
import type { HiddenMaskedTransition } from "./reference-masked-custodian.js";

export const MASKED_CUSTODY_TRANSCRIPT_BUCKETS = Object.freeze([
	4, 8, 16, 32,
] as const);

export interface PaddedMaskedCustodyPlanOptions {
	readonly realTransitions: readonly HiddenMaskedTransition[];
	readonly width: number;
	readonly bucketSize: (typeof MASKED_CUSTODY_TRANSCRIPT_BUCKETS)[number];
	readonly coverSeed: number;
	readonly placementSeed: number;
}

/**
 * This complete object is owner/server material. Only `transcriptClassId` and
 * the resulting custodian client contract may cross the trust boundary.
 */
export interface PaddedMaskedCustodyPlan {
	readonly transcriptClassId: string;
	readonly covers: readonly ChartCover[];
	readonly transitions: readonly HiddenMaskedTransition[];
	readonly realTransitionSlots: readonly number[];
	readonly paddingTransitionCount: number;
}

export function createPaddedMaskedCustodyPlan(
	options: PaddedMaskedCustodyPlanOptions
): PaddedMaskedCustodyPlan {
	validateOptions(options);
	const transcriptClassId =
		`csh-masked-v1-w${options.width}-e${options.bucketSize}`;
	const realTransitionSlots = selectOrderedSlots(
		options.bucketSize,
		options.realTransitions.length,
		deriveSeed(
			options.placementSeed >>> 0,
			`${transcriptClassId}:placement`
		)
	);
	const realBySlot = new Map(
		realTransitionSlots.map((slot, index) => [
			slot,
			options.realTransitions[index]!,
		])
	);
	const identity = createIdentityTransition(options.width);
	const transitions = Array.from(
		{ length: options.bucketSize },
		(_, slot) => realBySlot.get(slot) ?? identity
	);
	const covers = Array.from(
		{ length: options.bucketSize + 1 },
		(_, epoch) =>
			createChartCover({
				seed: deriveSeed(
					options.coverSeed >>> 0,
					`${transcriptClassId}:cover`
				),
				epoch,
				width: options.width,
				chartCount: 5,
				threshold: 3,
			})
	);
	return Object.freeze({
		transcriptClassId,
		covers: Object.freeze(covers),
		transitions: Object.freeze(transitions),
		realTransitionSlots: Object.freeze(realTransitionSlots),
		paddingTransitionCount:
			options.bucketSize - options.realTransitions.length,
	});
}

function validateOptions(options: PaddedMaskedCustodyPlanOptions): void {
	if (
		!Number.isSafeInteger(options.width) ||
		options.width < 2
	) {
		throw new Error("RUAM_CSH_PADDED_PLAN_INVALID_WIDTH");
	}
	if (
		!MASKED_CUSTODY_TRANSCRIPT_BUCKETS.includes(options.bucketSize)
	) {
		throw new Error("RUAM_CSH_PADDED_PLAN_INVALID_BUCKET");
	}
	if (
		options.realTransitions.length === 0 ||
		options.realTransitions.length > options.bucketSize
	) {
		throw new Error("RUAM_CSH_PADDED_PLAN_TRANSITION_COUNT");
	}
	for (const value of [options.coverSeed, options.placementSeed]) {
		if (!Number.isSafeInteger(value)) {
			throw new Error("RUAM_CSH_PADDED_PLAN_INVALID_SEED");
		}
	}
}

function selectOrderedSlots(
	bucketSize: number,
	realCount: number,
	seed: number
): number[] {
	const random = createSeededRandom(seed);
	const slots = Array.from({ length: bucketSize }, (_, index) => index);
	for (let index = slots.length - 1; index > 0; index--) {
		const target = random.nextUint32() % (index + 1);
		[slots[index], slots[target]] = [slots[target]!, slots[index]!];
	}
	return slots.slice(0, realCount).sort((left, right) => left - right);
}

function createIdentityTransition(
	width: number
): HiddenMaskedTransition {
	return Object.freeze({
		linear: Object.freeze(
			Array.from(
				{ length: width },
				(_, row) =>
					Object.freeze(
						Array.from(
							{ length: width },
							(_, column) => (row === column ? 1 : 0)
						)
					)
			)
		),
		bias: Object.freeze(Array.from({ length: width }, () => 0)),
		cubicTerms: Object.freeze([]),
	});
}
