/** Public fixed transcript classes supported by custody product planning. */
export const MASKED_CUSTODY_TRANSCRIPT_BUCKETS = Object.freeze([
	4, 8, 16, 32,
] as const);

export type MaskedCustodyTranscriptBucket =
	(typeof MASKED_CUSTODY_TRANSCRIPT_BUCKETS)[number];
