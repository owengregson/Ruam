/**
 * @module naming/registry
 * Central coordinator for all per-build randomized identifiers.
 */

import { NameScope, type LengthTier, deriveSeed } from "./scope.js";
import { RESERVED_WORDS, EXCLUDED_NAMES } from "./reserved.js";
import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";

// --- Alphabet ---

const ALPHABET_BASE =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_$";

// --- NameRegistry ---

export class NameRegistry {
	private readonly _seed: number;
	private readonly _scopes: NameScope[] = [];
	private readonly _globalUsed: Set<string>;
	private _resolved = false;
	private _alphabet: string | null = null;

	constructor(seed: number) {
		this._seed = seed >>> 0;
		this._globalUsed = new Set([...RESERVED_WORDS, ...EXCLUDED_NAMES]);
	}

	/** Whether resolveAll() has been called. */
	get isResolved(): boolean {
		return this._resolved;
	}

	/** Exclude additional names from generation. Must be called before resolveAll(). */
	exclude(names: Iterable<string>): void {
		if (this._resolved) {
			throw new Error(
				"Registry is frozen — cannot exclude after resolveAll()"
			);
		}
		for (const name of names) {
			this._globalUsed.add(name);
		}
	}

	/** Create a child scope. If parent is provided, the scope is nested under it. */
	createScope(
		id: string,
		opts?: { parent?: NameScope; lengthTier?: LengthTier }
	): NameScope {
		if (this._resolved) {
			throw new Error(
				"Registry is frozen — cannot create scope after resolveAll()"
			);
		}
		const parent = opts?.parent ?? null;
		const lengthTier = opts?.lengthTier ?? "medium";
		const scope = new NameScope(id, this._seed, lengthTier, parent);
		if (parent) {
			parent.children.push(scope);
		}
		this._scopes.push(scope);
		return scope;
	}

	/** Resolve all tokens across all scopes. Guarantees no collisions.
	 *  Uses depth-first tree walk (parent before children) — NOT registration order. */
	resolveAll(): void {
		if (this._resolved) {
			throw new Error("resolveAll() already called");
		}

		// Generate alphabet first (doesn't consume identifier namespace)
		this._generateAlphabet();

		// Depth-first walk: resolve root scopes, then their children recursively
		const rootScopes = this._scopes.filter((s) => s.parent === null);
		const walkResolve = (scope: NameScope): void => {
			this._resolveScope(scope);
			scope.freeze();
			for (const child of scope.children) {
				walkResolve(child);
			}
		};
		for (const root of rootScopes) {
			walkResolve(root);
		}

		this._resolved = true;
	}

	/** Get the 64-char encoding alphabet. Only available after resolveAll(). */
	getAlphabet(): string {
		if (this._alphabet === null) {
			throw new Error(
				"Alphabet not yet generated — call resolveAll() first"
			);
		}
		return this._alphabet;
	}

	/** Dump all resolved names for debugging. Returns scopeId:key -> resolved name. */
	dumpAll(): Map<string, string> {
		const result = new Map<string, string>();
		for (const scope of this._scopes) {
			for (const [key, token] of scope.tokens) {
				const qualifiedKey = `${scope.id}:${key}`;
				try {
					result.set(qualifiedKey, token.name);
				} catch {
					result.set(qualifiedKey, "<unresolved>");
				}
			}
		}
		return result;
	}

	/** Total number of tokens across all scopes. */
	get tokenCount(): number {
		let count = 0;
		for (const scope of this._scopes) {
			count += scope.tokens.size;
		}
		return count;
	}

	// --- Private ---

	private _resolveScope(scope: NameScope): void {
		const MAX_RETRIES = 50;
		const ALNUM =
			"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

		// Length bump carries across tokens within a scope — if previous
		// tokens needed longer names, subsequent tokens start at that
		// length instead of burning 50 retries each to rediscover it.
		let lengthBump = 0;

		for (const [, token] of scope.tokens) {
			let retries = 0;
			let candidate: string;

			do {
				candidate = scope.generateCandidate();
				// Force longer name when bump is active
				if (lengthBump > 0 && candidate.length < 2 + lengthBump) {
					while (candidate.length < 2 + lengthBump) {
						candidate += ALNUM[scope.nextPrng() % ALNUM.length]!;
					}
				}
				retries++;
				if (retries > MAX_RETRIES) {
					lengthBump++;
					retries = 0;
				}
			} while (this._globalUsed.has(candidate));

			this._globalUsed.add(candidate);
			token.resolve(candidate);
		}
	}

	private _generateAlphabet(): void {
		const chars = ALPHABET_BASE.split("");
		const codecSeed = deriveSeed(this._seed, "codec");
		let s = codecSeed;
		for (let i = chars.length - 1; i > 0; i--) {
			s = (Math.imul(s, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
			const j = s % (i + 1);
			const tmp = chars[i]!;
			chars[i] = chars[j]!;
			chars[j] = tmp;
		}
		this._alphabet = chars.join("");
	}
}
