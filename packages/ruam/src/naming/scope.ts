/**
 * @module naming/scope
 * Child scope within a NameRegistry, owns tokens and a per-scope PRNG.
 */

import { NameToken } from "./token.js";
import {
	LCG_MULTIPLIER,
	LCG_INCREMENT,
	FNV_OFFSET_BASIS,
	FNV_PRIME,
} from "../constants.js";

// --- Length Tiers ---

export type LengthTier = "short" | "medium" | "long";

const LENGTH_RANGES: Record<LengthTier, readonly [min: number, max: number]> = {
	short: [2, 3],
	medium: [3, 4],
	long: [4, 5],
};

// --- Character Sets ---

const ALPHA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// --- Seed Derivation ---

/** Derive a child PRNG seed from parent seed + scope ID via FNV-1a. */
export function deriveSeed(parentSeed: number, scopeId: string): number {
	let h = (parentSeed ^ FNV_OFFSET_BASIS) >>> 0;
	for (let i = 0; i < scopeId.length; i++) {
		h = (h ^ scopeId.charCodeAt(i)) >>> 0;
		h = Math.imul(h, FNV_PRIME) >>> 0;
	}
	return h;
}

// --- NameScope ---

export class NameScope {
	readonly id: string;
	readonly parent: NameScope | null;
	readonly tokens: Map<string, NameToken> = new Map();
	readonly children: NameScope[] = [];
	readonly lengthTier: LengthTier;
	private _prngState: number;
	private _frozen = false;

	constructor(
		id: string,
		seed: number,
		lengthTier: LengthTier,
		parent: NameScope | null = null
	) {
		this.id = id;
		this.lengthTier = lengthTier;
		this.parent = parent;
		this._prngState = deriveSeed(seed, id);
	}

	/** Claim a token with the given canonical key. */
	claim(key: string): NameToken {
		if (this._frozen) {
			throw new Error(
				`NameScope "${this.id}" is frozen — cannot claim "${key}"`
			);
		}
		if (this.tokens.has(key)) {
			throw new Error(`Duplicate key "${key}" in scope "${this.id}"`);
		}
		const token = new NameToken(key, this);
		this.tokens.set(key, token);
		return token;
	}

	/** Batch-claim multiple keys. Returns a record of key -> token. */
	claimMany(keys: readonly string[]): Record<string, NameToken> {
		const result: Record<string, NameToken> = {};
		for (const key of keys) {
			result[key] = this.claim(key);
		}
		return result;
	}

	/** Freeze scope — no more claims allowed. */
	freeze(): void {
		this._frozen = true;
	}

	/** Step the LCG PRNG, return a 32-bit unsigned integer. */
	nextPrng(): number {
		this._prngState =
			(Math.imul(this._prngState, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
		return this._prngState;
	}

	/** Generate a random candidate name using the scope's PRNG and length tier. */
	generateCandidate(): string {
		const [minLen, maxLen] = LENGTH_RANGES[this.lengthTier];
		const len = minLen + (this.nextPrng() % (maxLen - minLen + 1));
		let name = ALPHA[this.nextPrng() % ALPHA.length]!;
		for (let i = 1; i < len; i++) {
			name += ALNUM[this.nextPrng() % ALNUM.length]!;
		}
		return name;
	}
}
