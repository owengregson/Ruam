/**
 * Ruam Isogloss public API.
 *
 * @module index
 */

import { obfuscateCode, protectCode } from "./transform.js";
import type { IsoglossSourceBuildResult } from "./isogloss/source-transform.js";
import type { RuamOptions } from "./isogloss/options.js";
import {
	commitDirectoryProtection,
	planDirectoryProtection,
	protectFileAtomically,
} from "./file-protection.js";

export { obfuscateCode, protectCode };
export {
	IsoglossSourceTransformError,
	type IsoglossBuildDiagnostic,
	type IsoglossBuildDiagnosticCode,
	type IsoglossOwnerRegionTrace,
	type IsoglossOwnerSidecar,
	type IsoglossSourceBuildResult,
	type IsoglossSourceBuildStats,
} from "./isogloss/source-transform.js";
export {
	DEFAULT_MINIMUM_EXACT_ATTACK_QUERIES,
	DEFAULT_MINIMUM_EXACT_ATTACK_QUERIES_TEXT,
	ISOGLOSS_OPTION_LIMITS,
	ISOGLOSS_FIXED_LOCAL_BPRF,
	REMOVED_LEGACY_VM_OPTION_HINTS,
	REMOVED_LEGACY_VM_OPTIONS,
	RuamOptionError,
	resolveRuamOptions,
	type IsoglossAttestationCapability,
	type IsoglossBooleanRegionDomain,
	type IsoglossCapabilityOptions,
	type IsoglossCustodianCapability,
	type IsoglossDeploymentProfile,
	type IsoglossMaximumCustodyOptions,
	type IsoglossNumericRegionDomain,
	type IsoglossOptions,
	type IsoglossOwnerTrace,
	type IsoglossPrivateFunctionCapability,
	type IsoglossRegionDomain,
	type IsoglossRegionDomains,
	type IsoglossTargetEnvironment,
	type IsoglossTargetMode,
	type ResolvedIsoglossOptions,
	type ResolvedRuamOptions,
	type RuamOptionErrorCode,
	type RuamOptions,
} from "./isogloss/options.js";
export { ISOGLOSS_SOURCE_LIMITS } from "./isogloss/source-transform.js";
export {
	createIsoglossProtectionCertificate,
	ISOGLOSS_PROTECTION_CERTIFICATE_FORMAT,
	IsoglossProtectionCertificateError,
	validateIsoglossProtectionCertificate,
	type IsoglossCanonicalNodeReference,
	type IsoglossProtectionCertificate,
	type IsoglossProtectionCertificateErrorCode,
	type IsoglossTargetRootProtection,
} from "./isogloss/protection-certificate.js";
export {
	FILE_PROTECTION_LIMITS,
	RuamFileSafetyError,
	type RuamFileSafetyErrorCode,
} from "./file-protection.js";

/** Protect one file and return the same honest metadata as {@link protectCode}. */
export async function protectFile(
	inputPath: string,
	outputPath?: string,
	options: RuamOptions = {}
): Promise<IsoglossSourceBuildResult> {
	return protectFileAtomically(inputPath, outputPath ?? inputPath, options);
}

/** String-only file alias for callers that do not consume build metadata. */
export async function obfuscateFile(
	inputPath: string,
	outputPath?: string,
	options: RuamOptions = {}
): Promise<void> {
	await protectFile(inputPath, outputPath, options);
}

export interface RunProtectionConfig {
	readonly include?: readonly string[];
	readonly exclude?: readonly string[];
	readonly options?: RuamOptions;
}

export interface ProtectedFileResult {
	readonly file: string;
	readonly build: IsoglossSourceBuildResult;
}

/** Protect matching JavaScript files without any legacy execution fallback. */
export async function runProtection(
	dir: string,
	config: RunProtectionConfig = {}
): Promise<readonly ProtectedFileResult[]> {
	const plans = await planDirectoryProtection(
		dir,
		config.include ?? ["**/*.js"],
		config.exclude ?? ["**/node_modules/**"],
		config.options
	);
	await commitDirectoryProtection(dir, plans);
	return Object.freeze(
		plans.map((plan) =>
			Object.freeze({ file: plan.file, build: plan.build })
		)
	);
}

// Keep the function type reachable without exporting implementation internals
// from the transform module's private deterministic-test entry point.
export type ProtectCode = typeof protectCode;
