/**
 * Cross-file cohort context (Layer 1 — build-time tangle).
 *
 * When a directory / bundle of files is obfuscated together they form a
 * *cohort*. A single cohort term — an order-independent digest over every
 * file's source, folded with a per-build cohort seed — is XOR-folded into each
 * file's key anchor (the same seam {@link ../ruamvm/builders/interpreter}'s
 * `_ka` and {@link ./encode}'s `keyAnchor` use for the integrity hash).
 *
 * Effect (honest framing): this raises the unit of *static correlation* from a
 * single file to the whole bundle and makes identical source produce different
 * keys in different bundles/builds (killing cross-sample transfer). It is
 * **work-factor**, not cryptographic: an attacker who holds the whole bundle
 * can recompute the term. The genuine "a file cannot run without its siblings"
 * dependency is the opt-in runtime co-residence link (Layer 2) and the
 * off-device secret (`externalKeyBinding`), which live elsewhere.
 *
 * The term is only meaningful when `rollingCipher` is enabled for a file (it is
 * folded into the implicit key derivation); for files without rolling cipher it
 * is a no-op.
 *
 * @module compiler/cohort
 */

import { FNV_OFFSET_BASIS, FNV_PRIME } from "../constants.js";

/** A source file participating in a cohort. */
export interface CohortFile {
	/** Path/identifier (used only for keying digests; never embedded). */
	path: string;
	/** Source text. */
	code: string;
}

/**
 * Build-time cohort context. Holds per-file source digests and produces the
 * single cohort term folded into every member's key anchor.
 */
export interface CohortContext {
	/** Per-build random seed; makes the cohort term unique across builds. */
	readonly cohortSeed: number;
	/** Per-file FNV-1a source digests, keyed by path. */
	readonly fileDigests: ReadonlyMap<string, number>;
	/**
	 * The single 32-bit cohort term folded into each file's key anchor.
	 * Order-independent (sorted fold), depends on every file and the cohort
	 * seed, and stable across calls.
	 */
	digestAll(): number;
}

/** FNV-1a over a string's char codes (matches the build-time `fnv1a` helper). */
function fnv1aStr(s: string): number {
	let h = FNV_OFFSET_BASIS;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, FNV_PRIME);
	}
	return h >>> 0;
}

/**
 * Create a cohort context from a set of source files.
 *
 * @param files      The files participating in the cohort.
 * @param cohortSeed Per-build random seed (caller supplies a CSPRNG value).
 * @returns A {@link CohortContext}.
 */
export function createCohort(
	files: CohortFile[],
	cohortSeed: number
): CohortContext {
	const fileDigests = new Map<string, number>();
	for (const f of files) {
		// If two files share a path, the later one wins — digests are keyed by
		// path only for introspection; digestAll() folds the values directly.
		fileDigests.set(f.path, fnv1aStr(f.code));
	}

	let cached: number | undefined;
	const seed = cohortSeed >>> 0;

	return {
		cohortSeed: seed,
		fileDigests,
		digestAll(): number {
			if (cached !== undefined) return cached;
			// Sort the per-file digests so the term is independent of file
			// ordering (Design principle: works for ANY file-set ordering) and
			// free of XOR self-cancellation when two files are identical.
			const sorted = [...fileDigests.values()].sort((a, b) => a - b);
			let h = (FNV_OFFSET_BASIS ^ seed) >>> 0;
			for (const d of sorted) {
				h = Math.imul(h ^ (d & 0xffff), FNV_PRIME) >>> 0;
				h = Math.imul(h ^ (d >>> 16), FNV_PRIME) >>> 0;
			}
			// Avalanche so small input changes diffuse across all bits.
			h ^= h >>> 16;
			h = Math.imul(h, 0x45d9f3b) >>> 0;
			h ^= h >>> 13;
			cached = h >>> 0;
			return cached;
		},
	};
}
