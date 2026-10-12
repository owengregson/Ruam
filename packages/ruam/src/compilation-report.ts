/** @module Explicit selected-function compilation evidence; not a security-strength certificate. */
export interface CompilationOutcome {
	name: string;
	line: number | null;
	column: number | null;
	status: "compiled" | "native-fallback" | "unsupported-runtime";
	bytecodeUnits: number;
	runtimeLimitations: Array<"generator-resumption" | "async-iteration">;
	message?: string;
}

export interface CompilationReport {
	schema: "ruam-compilation-report-v1";
	targetMode: "root" | "comment";
	selectedRoots: number;
	outcomes: CompilationOutcome[];
	completeSelection: boolean;
	/** The report does not audit native stubs, skipped syntax or unselected source. */
	wholeSourceProtection: false;
	protectionQualified: false;
	locationSpace: "after-optional-preprocessing";
}

export class IncompleteCompilationError extends Error {
	constructor(readonly report: CompilationReport) {
		super(`Ruam did not compile the complete selection: ${report.outcomes.filter(item => item.status !== "compiled").length} failed roots of ${report.selectedRoots} selected`);
		this.name = "IncompleteCompilationError";
	}
}

/** Internal accumulator passed per invocation; never shared across builds. */
export interface CompilationRecorder {
	selectedRoots: number;
	outcomes: CompilationOutcome[];
}
