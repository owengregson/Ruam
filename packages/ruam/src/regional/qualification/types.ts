export interface ResourceObservation {
	wallMilliseconds: number;
	cpuUserMilliseconds: number;
	cpuSystemMilliseconds: number;
	retainedHeapDeltaBytes: number;
	peakRssBytes: number;
	queries: number;
	analystMinutes: null;
	modelTokens: number;
}
export interface RecoveryCandidate {
	kind: "static-extraction" | "blackbox-learning";
	status: "candidate" | "unsupported" | "artifact-transplant-only" | "error";
	code?: string;
	entry?: string;
	reason: string;
	transformations: Record<string, number>;
	resources: ResourceObservation;
}
export interface BehavioralValidation {
	status: "pass" | "mismatch" | "error" | "timeout";
	cases: number;
	mismatches: number;
	firstFailure?: string;
}
export interface AttackResult extends RecoveryCandidate {
	validation?: BehavioralValidation;
	verifiedStandaloneRecovery: boolean;
}
export const PINNED_BASELINES = [
	{ id: "main-max", ref: "1fb1a61", options: { preset: "max" }, protectedScope: "legacy virtualized functions; top-level source may remain native", deterministicSeed: false },
	{ id: "pr5-offline-max", ref: "30f4563", options: { preset: "max" }, protectedScope: "legacy functions, offline-only; no external-key credit", deterministicSeed: false },
	{ id: "pr7-local", ref: "b464a82", options: { isogloss: { profile: "holographic-local" } }, protectedScope: "only owner-report-confirmed protected regions; no native/hybrid credit", deterministicSeed: true },
	{ id: "september-local", ref: "f7f52c8", options: { isogloss: { profile: "holographic-local" } }, protectedScope: "local WIP; any repair is separately hashed and published", deterministicSeed: true },
] as const;
