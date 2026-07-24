/**
 * Build-time entropy and deterministic pseudo-random streams.
 *
 * Production builds draw independent 32-bit values from the platform CSPRNG.
 * Tests inject a deterministic source so every randomized build decision can
 * be reproduced from one seed.
 *
 * @module random/entropy
 */

import { randomBytes } from "node:crypto";
import { deriveSeed, lcgNext } from "../naming/scope.js";

/** Source of labeled 32-bit build-time entropy. */
export interface BuildEntropy {
	/**
	 * Return the next unsigned 32-bit value for a logical responsibility.
	 *
	 * Labels are diagnostic for production entropy and define independent,
	 * reproducible streams for deterministic test entropy.
	 */
	nextUint32(label: string): number;
}

/** Seeded stream used for deterministic selections within one responsibility. */
export interface SeededRandom {
	nextUint32(): number;
	nextFloat(): number;
}

/** Create the production CSPRNG-backed entropy source. */
export function createCryptoEntropy(): BuildEntropy {
	return {
		nextUint32(_label: string): number {
			return randomBytes(4).readUInt32LE(0);
		},
	};
}

/**
 * Create a deterministic entropy source for tests and failure reproduction.
 *
 * Each label owns an independent counter-derived stream, so adding entropy use
 * in one subsystem does not perturb existing values in another subsystem.
 */
export function createDeterministicEntropy(seed: number): BuildEntropy {
	const counters = new Map<string, number>();
	const root = seed >>> 0;

	return {
		nextUint32(label: string): number {
			const counter = counters.get(label) ?? 0;
			counters.set(label, counter + 1);
			return lcgNext(deriveSeed(root, `${label}:${counter}`));
		},
	};
}

/** Create a deterministic LCG stream from an already isolated seed. */
export function createSeededRandom(seed: number): SeededRandom {
	let state = seed >>> 0;
	return {
		nextUint32(): number {
			state = lcgNext(state);
			return state;
		},
		nextFloat(): number {
			state = lcgNext(state);
			return state / 0x1_0000_0000;
		},
	};
}
