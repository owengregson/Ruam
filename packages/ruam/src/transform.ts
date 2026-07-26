/**
 * Public Isogloss source transformation.
 *
 * This is the only shipped execution transform. It contains no bytecode
 * compiler, loader, dispatcher, interpreter, or compatibility route to the
 * removed VM architecture.
 *
 * @module transform
 */

import {
	buildLocalIsoglossSource,
	type IsoglossSourceBuildResult,
} from "./isogloss/source-transform.js";
import {
	resolveRuamOptions,
	type RuamOptions,
} from "./isogloss/options.js";
import { preprocessIdentifiers } from "./preprocess.js";
import {
	createCryptoEntropy,
	type BuildEntropy,
} from "./random/entropy.js";

/** Build protected source and return its honest Isogloss metadata. */
export function protectCode(
	source: string,
	options: RuamOptions = {}
): IsoglossSourceBuildResult {
	return protectCodeWithEntropy(source, options, createCryptoEntropy());
}

/**
 * Convenience string-only API.
 *
 * This alias remains source-oriented; it invokes exactly the same Isogloss
 * transform as {@link protectCode} and never routes through a VM.
 */
export function obfuscateCode(
	source: string,
	options: RuamOptions = {}
): string {
	return protectCode(source, options).code;
}

/** Internal deterministic entry point used by qualification tests. */
export function protectCodeWithEntropy(
	source: string,
	options: RuamOptions,
	entropy: BuildEntropy
): IsoglossSourceBuildResult {
	const resolved = resolveRuamOptions(options);
	const fileSeed = entropy.nextUint32("isogloss-file-seed");
	const built = buildLocalIsoglossSource(source, resolved, fileSeed);
	if (!resolved.preprocessIdentifiers || built.stats.protectedRegionCount === 0) {
		return built;
	}

	// Region discovery and domain matching use author-written binding names.
	// Rename only the completed output so configuration can never accidentally
	// describe a different binding after preprocessing.
	const preprocessed = preprocessIdentifiers(
		built.code,
		entropy.nextUint32("isogloss-identifier-preprocess")
	);
	const outputBytes = new TextEncoder().encode(preprocessed.code).byteLength;
	const stats = Object.freeze({
		...built.stats,
		outputBytes,
		expansionRatio:
			built.stats.originalBytes === 0
				? 1
				: outputBytes / built.stats.originalBytes,
	});
	return Object.freeze({
		...built,
		code: preprocessed.code,
		stats,
	});
}

/** Internal string-only deterministic compatibility for existing test tools. */
export function obfuscateCodeWithEntropy(
	source: string,
	options: RuamOptions,
	entropy: BuildEntropy
): string {
	return protectCodeWithEntropy(source, options, entropy).code;
}
