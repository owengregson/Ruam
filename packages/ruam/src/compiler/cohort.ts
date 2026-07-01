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
import { deriveSeed } from "../naming/scope.js";

/** A source file participating in a cohort. */
export interface CohortFile {
	/** Path/identifier (used only for keying digests; never embedded). */
	path: string;
	/** Source text. */
	code: string;
}

/**
 * Declared cross-file runtime link (Layer 2 — opt-in, strict).
 *
 * The `provider` file writes a per-cohort secret to a shared global at load;
 * each `consumer` file folds that secret into its decryption key (strict — no
 * fallback), so a consumer file genuinely CANNOT decrypt/run without its
 * provider present-and-earlier in the same JS realm at runtime.
 *
 * The caller is responsible for the co-residence contract: the provider must be
 * present and load BEFORE every consumer in every realm a consumer enters
 * (Design: prove-or-don't-link; here the proof is the caller's explicit
 * declaration). Mis-declaring bricks the consumer (by design — strict binding).
 *
 * Paths are matched against each file's `path` by exact match OR basename.
 */
export interface CohortLink {
	/** The provider file (writes the shared secret). */
	provider: string;
	/** Consumer files that require the provider's runtime secret to decrypt. */
	consumers: string[];
}

/** Resolved per-cohort link material (slot name + secret value). */
export interface ResolvedLink {
	/** Shared global property name both sides agree on (a valid identifier). */
	slot: string;
	/** The secret value the provider writes and consumers fold. */
	secret: string;
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
	/**
	 * If {@link path} is the link provider, the slot+secret it must write to a
	 * shared global at load; otherwise undefined.
	 */
	providerLink(path: string): ResolvedLink | undefined;
	/**
	 * If {@link path} is a link consumer, the slot+secret it must fold into its
	 * key (and read from the shared global at runtime); otherwise undefined.
	 */
	consumerLink(path: string): ResolvedLink | undefined;
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

/** Basename of a path (last segment after `/` or `\`). */
function basename(p: string): string {
	const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
	return i >= 0 ? p.slice(i + 1) : p;
}

/** True if {@link filePath} matches a declared link path (exact or basename). */
function pathMatches(filePath: string, declared: string): boolean {
	return (
		filePath === declared ||
		basename(filePath) === declared ||
		basename(filePath) === basename(declared)
	);
}

/** Derive a valid-identifier global slot name from the cohort seed. */
function deriveSlot(seed: number): string {
	return "_" + (deriveSeed(seed, "linkSlot") >>> 0).toString(36);
}

/** Derive the link secret string from the cohort seed. */
function deriveSecret(seed: number): string {
	const a = (deriveSeed(seed, "linkSecretA") >>> 0).toString(36);
	const b = (deriveSeed(seed, "linkSecretB") >>> 0).toString(36);
	return a + b;
}

/**
 * Create a cohort context from a set of source files.
 *
 * @param files      The files participating in the cohort.
 * @param cohortSeed Per-build random seed (caller supplies a CSPRNG value).
 * @param link       Optional cross-file runtime link declaration (Layer 2).
 * @returns A {@link CohortContext}.
 */
export function createCohort(
	files: CohortFile[],
	cohortSeed: number,
	link?: CohortLink
): CohortContext {
	const fileDigests = new Map<string, number>();
	for (const f of files) {
		// If two files share a path, the later one wins — digests are keyed by
		// path only for introspection; digestAll() folds the values directly.
		fileDigests.set(f.path, fnv1aStr(f.code));
	}

	let cached: number | undefined;
	const seed = cohortSeed >>> 0;

	const resolvedLink: ResolvedLink | undefined = link
		? { slot: deriveSlot(seed), secret: deriveSecret(seed) }
		: undefined;

	return {
		cohortSeed: seed,
		fileDigests,
		providerLink(path: string): ResolvedLink | undefined {
			if (!link || !resolvedLink) return undefined;
			return pathMatches(path, link.provider) ? resolvedLink : undefined;
		},
		consumerLink(path: string): ResolvedLink | undefined {
			if (!link || !resolvedLink) return undefined;
			return link.consumers.some((c) => pathMatches(path, c))
				? resolvedLink
				: undefined;
		},
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
