/** Bounded compiler evidence. These records are owner-side, not protection certificates.
 * @module regional/compiler/types
 */
export interface RegionalCompileOptions {
	seed?: number;
	fusion?: boolean;
	joint?: boolean;
	configuration?: boolean;
	maxNodes?: number;
	maxOutputBytes?: number;
}

export interface RegionalWitness {
	kind: "private-call-fusion" | "configuration-specialization" | "dependent-predicate-result";
	sourceStart: number;
	sourceEnd: number;
	preconditions: string[];
	validation: "checked-fixed-recipe";
	detail: string;
}

export interface RegionalCompileReport {
	status: "experimental-unqualified";
	sourceType: "script" | "module";
	seed: number;
	inputNodes: number;
	outputNodes: number;
	sourceBytes: number;
	outputBytes: number;
	transformations: { privateCallFusions: number; configurationReads: number; jointRegions: number };
	analysis: {
		kind: "bounded-ast-dataflow";
		functions: number;
		calls: number;
		propertyAccesses: number;
		potentialCoercions: number;
		exceptionRegions: number;
		domainFacts: string[];
		aliasPolicy: "native-binding-identity-no-state-snapshots";
		effectPolicy: "preserve-native-order-outside-proven-recipes";
		limitations: string[];
	};
	coverage: { inspectedNodes: number; transformedSourceNodes: number; wholeSourceProtection: false };
	compatibility: {
		sourceReflection: "generated-source";
		hostContract: "no-runtime-source-or-original-source-dependent-callbacks";
		diagnostics: "engine-source-dependent-stack-and-error-text-excluded";
	};
	witnesses: RegionalWitness[];
}

export type RegionalCompileErrorCode =
	| "REGIONAL_PARSE_ERROR"
	| "REGIONAL_INVALID_OPTIONS"
	| "REGIONAL_RESOURCE_LIMIT"
	| "REGIONAL_UNSUPPORTED_SYNTAX"
	| "REGIONAL_SOURCE_INGRESS"
	| "REGIONAL_MODULE_GRAPH_REQUIRED";

/** A rejected source never returns a partially emitted result. */
export class RegionalCompileError extends Error {
	readonly name = "RegionalCompileError";
	constructor(
		readonly code: RegionalCompileErrorCode,
		message: string,
		readonly offset: number | null = null,
	) {
		super(`${code}: ${message}`);
	}
}
