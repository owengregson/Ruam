/**
 * Internal deterministic test entry points.
 *
 * This module is intentionally not exported from the package root.
 *
 * @module testing
 */

import { obfuscateCodeWithEntropy } from "./transform.js";
import type { VmObfuscationOptions } from "./types.js";
import { createDeterministicEntropy } from "./random/entropy.js";

/** Obfuscate with reproducible build entropy for seed-stress tests. */
export function obfuscateCodeDeterministic(
	source: string,
	options: VmObfuscationOptions = {},
	seed = 0
): string {
	return obfuscateCodeWithEntropy(
		source,
		options,
		createDeterministicEntropy(seed)
	);
}

export { createDeterministicEntropy } from "./random/entropy.js";
