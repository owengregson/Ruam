/**
 * Ruam Isogloss public API.
 *
 * @module index
 */

import fs from "fs-extra";
import { globby } from "globby";
import path from "node:path";
import { obfuscateCode, protectCode } from "./transform.js";
import type { IsoglossSourceBuildResult } from "./isogloss/source-transform.js";
import type { RuamOptions } from "./isogloss/options.js";

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
export {
	createSourceExpressionMacroregionCallRiskEvidence,
	deriveIsoglossMacroregionCallRisk,
	digestCanonicalIsoglossBuildValue,
	planIsoglossProduct,
} from "./isogloss/plan.js";
export * from "./isogloss/types.js";

/** Protect one file and return the same honest metadata as {@link protectCode}. */
export async function protectFile(
	inputPath: string,
	outputPath?: string,
	options: RuamOptions = {}
): Promise<IsoglossSourceBuildResult> {
	const source = await fs.readFile(inputPath, "utf8");
	const result = protectCode(source, options);
	await fs.writeFile(outputPath ?? inputPath, result.code, "utf8");
	return result;
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
	const files = await globby(config.include ?? ["**/*.js"], {
		cwd: dir,
		ignore: [...(config.exclude ?? ["**/node_modules/**"])],
		absolute: false,
	});
	const results: ProtectedFileResult[] = [];
	for (const file of files) {
		const filePath = path.join(dir, file);
		const build = await protectFile(filePath, filePath, config.options);
		results.push(Object.freeze({ file, build }));
	}
	return Object.freeze(results);
}

// Keep the function type reachable without exporting implementation internals
// from the transform module's private deterministic-test entry point.
export type ProtectCode = typeof protectCode;
