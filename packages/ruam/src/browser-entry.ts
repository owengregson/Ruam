/**
 * Browser entry point for the Ruam Isogloss source transform.
 *
 * @module browser-entry
 */

export { obfuscateCode, protectCode } from "./transform.js";
export {
	resolveRuamOptions,
	type IsoglossOptions,
	type IsoglossRegionDomain,
	type IsoglossRegionDomains,
	type RuamOptions,
} from "./isogloss/options.js";
export type {
	IsoglossSourceBuildResult,
	IsoglossSourceBuildStats,
} from "./isogloss/source-transform.js";
