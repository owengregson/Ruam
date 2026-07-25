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
	const preprocessSeed = resolved.preprocessIdentifiers
		? entropy.nextUint32("isogloss-identifier-preprocess")
		: undefined;
	return buildLocalIsoglossSource(
		source,
		resolved,
		fileSeed,
		preprocessSeed
	);
}

/** Internal string-only deterministic compatibility for existing test tools. */
export function obfuscateCodeWithEntropy(
	source: string,
	options: RuamOptions,
	entropy: BuildEntropy
): string {
	return protectCodeWithEntropy(source, options, entropy).code;
}
