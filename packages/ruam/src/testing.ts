/**
 * Internal deterministic test entry points.
 *
 * This module is intentionally not exported from the package root.
 *
 * @module testing
 */

import {
	obfuscateCodeWithEntropy,
	protectCodeWithEntropy,
} from "./transform.js";
import type { RuamOptions } from "./isogloss/options.js";
import { createDeterministicEntropy } from "./random/entropy.js";

/** Obfuscate with reproducible build entropy for seed-stress tests. */
export function obfuscateCodeDeterministic(
	source: string,
	options: RuamOptions = {},
	seed = 0
): string {
	return obfuscateCodeWithEntropy(
		source,
		options,
		createDeterministicEntropy(seed)
	);
}

/** Build the complete deterministic Isogloss result, including honest stats. */
export function protectCodeDeterministic(
	source: string,
	options: RuamOptions = {},
	seed = 0
) {
	return protectCodeWithEntropy(
		source,
		options,
		createDeterministicEntropy(seed)
	);
}

export { createDeterministicEntropy } from "./random/entropy.js";
