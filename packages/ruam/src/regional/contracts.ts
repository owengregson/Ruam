/** Experimental build contracts. None of these records is a security certificate. */
export class RegionalPackageError extends Error {
	readonly name = "RegionalPackageError";
	constructor(readonly code: string, detail: string) {
		super(`${code}: ${detail}`);
	}
}

export interface RegionalGraphInput {
	readonly entryPoints: readonly string[];
	readonly files: Readonly<Record<string, string>>;
}

export interface RegionalGraphOptions {
	readonly seed?: number;
	readonly fusion?: boolean;
	readonly joint?: boolean;
	readonly configuration?: boolean;
	/** Aggregate input and output AST node caps, checked separately. */
	readonly maxNodes?: number;
	readonly maxInputBytes?: number;
	readonly maxOutputBytes?: number;
	readonly maxFiles?: number;
	/** Output <= input * ratio + 64 KiB, also subject to maxOutputBytes. */
	readonly maxExpansionRatio?: number;
}

export interface RegionalResolvedOptions {
	readonly seed: number;
	readonly fusion: boolean;
	readonly joint: boolean;
	readonly configuration: boolean;
	readonly maxNodes: number;
	readonly maxInputBytes: number;
	readonly maxOutputBytes: number;
	readonly maxFiles: number;
	readonly maxExpansionRatio: number;
}

export interface RegionalFileInventory {
	readonly path: string;
	readonly sha256: string;
	readonly bytes: number;
	readonly nodes: number;
	readonly sourceType: "script" | "module";
	/** Ordered source specifiers; includes side-effect imports and reexports. */
	readonly imports: readonly string[];
}

export interface RegionalCostReport {
	readonly files: number;
	readonly inputBytes: number;
	readonly outputBytes: number;
	readonly inputNodes: number;
	readonly outputNodes: number;
	readonly expansionRatio: number;
	readonly runtimePerformance: "not-measured";
	readonly buildTiming: "not-measured";
}

export interface RegionalValidationEvidence {
	readonly kind: "final-byte-parse-and-inventory";
	readonly packageSha256: string;
	readonly files: readonly RegionalFileInventory[];
	readonly semanticEquivalence: "not-proven";
	readonly resistance: "not-measured";
}

export interface RegionalPackageBuild {
	readonly format: "ruam-regional-package-v1";
	readonly status: "experimental-unqualified";
	readonly files: Readonly<Record<string, string>>;
	readonly entryPoints: readonly string[];
	/** Deterministic dependency-first inventory, not a replacement ESM scheduler. */
	readonly moduleOrder: readonly string[];
	readonly options: RegionalResolvedOptions;
	readonly sourceInventory: readonly RegionalFileInventory[];
	readonly reports: Readonly<Record<string, unknown>>;
	readonly cost: RegionalCostReport;
	readonly evidence: RegionalValidationEvidence;
	readonly wholeSourceProtection: false;
	readonly crossModuleOptimization: false;
	readonly releaseApproved: false;
}
