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

import { createHmac } from "node:crypto";
import { deriveSeed } from "../../naming/scope.js";
import {
	createChartCover,
	type ChartCover,
} from "./reference.js";
import type { HiddenMaskedTransition } from "./reference-masked-custodian.js";
export {
	MASKED_CUSTODY_TRANSCRIPT_BUCKETS,
	type MaskedCustodyTranscriptBucket,
} from "./transcript-buckets.js";
import { MASKED_CUSTODY_TRANSCRIPT_BUCKETS } from "./transcript-buckets.js";

export interface PaddedMaskedCustodyPlanOptions {
	readonly realTransitions: readonly HiddenMaskedTransition[];
	readonly width: number;
	readonly bucketSize: (typeof MASKED_CUSTODY_TRANSCRIPT_BUCKETS)[number];
	readonly coverSeed: number;
	/** Server-only high-entropy key; never included in the client contract. */
	readonly placementSecret: string;
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
		options.placementSecret,
		transcriptClassId
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
	if (!Number.isSafeInteger(options.coverSeed)) {
		throw new Error("RUAM_CSH_PADDED_PLAN_INVALID_SEED");
	}
	if (options.placementSecret.length < 16) {
		throw new Error("RUAM_CSH_PADDED_PLAN_WEAK_PLACEMENT_SECRET");
	}
}

function selectOrderedSlots(
	bucketSize: number,
	realCount: number,
	secret: string,
	transcriptClassId: string
): number[] {
	const nextWord = createKeyedWordStream(
		secret,
		`${transcriptClassId}:real-count:${realCount}:placement`
	);
	const slots = Array.from({ length: bucketSize }, (_, index) => index);
	for (let index = slots.length - 1; index > 0; index--) {
		const target = uniformBelow(nextWord, index + 1);
		[slots[index], slots[target]] = [slots[target]!, slots[index]!];
	}
	return slots.slice(0, realCount).sort((left, right) => left - right);
}

function createKeyedWordStream(
	secret: string,
	domain: string
): () => number {
	let counter = 0;
	return () =>
		createHmac("sha256", secret)
			.update(domain)
			.update("|")
			.update(String(counter++))
			.digest()
			.readUInt32LE(0);
}

function uniformBelow(
	nextWord: () => number,
	upperExclusive: number
): number {
	const wordRange = 0x1_0000_0000;
	const limit =
		wordRange - (wordRange % upperExclusive);
	for (;;) {
		const word = nextWord();
		if (word < limit) return word % upperExclusive;
	}
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
