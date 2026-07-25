import vm from "node:vm";
import type { VmObfuscationOptions } from "../../../src/types.js";
import { obfuscateCodeDeterministic } from "../../../src/testing.js";
import type { DynamicAttackerFixture } from "./dynamic-attacker-fixtures.js";

export const DYNAMIC_TRACE_SCHEMA_VERSION = 1 as const;

export type TraceBoundaryKind =
	| "operation"
	| "function-enter"
	| "function-exit"
	| "exception";

/** Owner-only normalized event. This record must never ship in an artifact. */
export interface GroundTruthEvent {
	id: string;
	ordinal: number;
	kind: TraceBoundaryKind;
	operation?: string;
	unit?: string;
}

/**
 * Attacker recovery normalized by an owner-side scorer.
 *
 * `attributedTruthId` is scorer attribution, not information available to the
 * attacker. Future executors can populate it with their own trace aligner.
 */
export interface RecoveredEvent {
	ordinal: number;
	predictedKind: TraceBoundaryKind;
	predictedOperation?: string;
	attributedTruthId?: string;
	probeSiteId: string;
}

export interface NormalizedOutcome {
	type: "return" | "throw";
	value?: unknown;
	errorName?: string;
	errorMessage?: string;
}

export interface DynamicTrace {
	schemaVersion: typeof DYNAMIC_TRACE_SCHEMA_VERSION;
	executorId: string;
	fixtureId: string;
	buildSeed: number;
	outcome: NormalizedOutcome;
	truth: readonly GroundTruthEvent[];
	recovered: readonly RecoveredEvent[];
	probeSiteIds: readonly string[];
	traceTruncated: boolean;
}

export interface DynamicTraceExecutor {
	readonly id: string;
	run(
		fixture: DynamicAttackerFixture,
		buildSeed: number
	): DynamicTrace | Promise<DynamicTrace>;
}

export interface BinaryMetrics {
	truePositive: number;
	falsePositive: number;
	falseNegative: number;
	precision: number;
	recall: number;
	f1: number;
}

export interface OperationMetrics extends BinaryMetrics {
	/** Correct operation labels divided by validly attributed boundaries. */
	accuracy: number;
	/**
	 * Mean per-operation F1 over labels present in truth or recovery. A wrong
	 * label is one false positive for the predicted class and one false
	 * negative for the owner class.
	 */
	macroF1: number;
}

export interface TraceCounts {
	truthEvents: number;
	recoveredEvents: number;
	operationEvents: number;
	functionBoundaryEvents: number;
	exceptionEvents: number;
	uniqueOperations: number;
	sequenceEdges: number;
	dynamicCfgEdges: number;
}

export interface DynamicTraceMetrics {
	/**
	 * A true positive is one unique owner event correctly attributed with the
	 * right boundary kind. Duplicate, unknown, or wrong-kind observations are
	 * false positives; unobserved owner events are false negatives.
	 */
	boundaryEvents: BinaryMetrics;
	operationLabels: OperationMetrics;
	/**
	 * Occurrence-sensitive adjacent owner-event pairs recovered consecutively.
	 */
	sequenceEdges: BinaryMetrics;
	/**
	 * Distinct adjacent operation-label pairs on the executed path. This is
	 * dynamic CFG coverage, not static canonical-CFG coverage.
	 */
	dynamicCfgEdges: BinaryMetrics;
	counts: TraceCounts;
}

export interface PatchCollapseMetrics {
	/**
	 * Smallest number of localized probe families that produced a complete,
	 * deterministic semantic stream while preserving the fixture result.
	 */
	minimumLocalizedSites: number | null;
	stableSemanticStream: boolean;
	correctnessPreserved: boolean;
	repeatCount: number;
}

export interface DynamicBaselineReport {
	schemaVersion: typeof DYNAMIC_TRACE_SCHEMA_VERSION;
	executorId: string;
	corpusVersion: number;
	runs: readonly {
		fixtureId: string;
		metrics: DynamicTraceMetrics;
		trace: DynamicTrace;
	}[];
	aggregate: DynamicTraceMetrics;
	patchCollapse: PatchCollapseMetrics;
}

interface CapturedConsoleCall {
	level: "log" | "warn" | "error";
	args: unknown[];
}

interface RawExecution {
	outcome: NormalizedOutcome;
	consoleCalls: CapturedConsoleCall[];
}

const VM_TRACE_PREFIX = "[VM_TRACE] ";
const VM_DEBUG_PREFIX = "[VM_DBG]";
const LEGACY_CONSOLE_PROBE = "legacy-vm:console";

const LEGACY_BASELINE_OPTIONS: VmObfuscationOptions = {
	targetMode: "root",
	threshold: 1,
	preset: "low",
	encryptBytecode: false,
	preprocessIdentifiers: false,
	debugLogging: true,
	dynamicOpcodes: false,
	decoyOpcodes: false,
	deadCodeInjection: false,
	debugProtection: false,
	vmShielding: false,
};

function normalizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
	if (typeof value === "number") {
		if (Number.isNaN(value)) return { number: "NaN" };
		if (value === Infinity) return { number: "Infinity" };
		if (value === -Infinity) return { number: "-Infinity" };
		if (Object.is(value, -0)) return { number: "-0" };
		return value;
	}
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		typeof value === "undefined"
	) {
		return value;
	}
	if (typeof value === "bigint") return { bigint: value.toString() };
	if (typeof value === "symbol") return { symbol: String(value) };
	if (typeof value === "function") return { function: value.name || "(anonymous)" };
	if (seen.has(value)) return { circular: true };
	seen.add(value);
	if (Array.isArray(value)) {
		return value.map((entry) => normalizeValue(entry, seen));
	}
	const output: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) {
		output[key] = normalizeValue((value as Record<string, unknown>)[key], seen);
	}
	return output;
}

function normalizeError(error: unknown): NormalizedOutcome {
	if (error instanceof Error) {
		return {
			type: "throw",
			errorName: error.name,
			errorMessage: error.message,
		};
	}
	if (
		typeof error === "object" &&
		error !== null &&
		"name" in error &&
		"message" in error
	) {
		return {
			type: "throw",
			errorName: String((error as { name: unknown }).name),
			errorMessage: String((error as { message: unknown }).message),
		};
	}
	return {
		type: "throw",
		errorName: typeof error,
		errorMessage: String(error),
	};
}

function executeGenerated(
	code: string,
	consoleCalls: CapturedConsoleCall[] | null
): RawExecution {
	const capture = (
		level: CapturedConsoleCall["level"],
		args: unknown[]
	): void => {
		if (consoleCalls !== null) consoleCalls.push({ level, args });
	};
	const controlledConsole = Object.freeze({
		log: (...args: unknown[]) => capture("log", args),
		warn: (...args: unknown[]) => capture("warn", args),
		error: (...args: unknown[]) => capture("error", args),
	});
	const context = vm.createContext({ console: controlledConsole });
	try {
		const value = new vm.Script(code, {
			filename: "ruam-dynamic-attacker-fixture.js",
		}).runInContext(context, { timeout: 2_000 });
		return {
			outcome: { type: "return", value: normalizeValue(value) },
			consoleCalls: consoleCalls ?? [],
		};
	} catch (error) {
		return { outcome: normalizeError(error), consoleCalls: consoleCalls ?? [] };
	}
}

function consoleText(call: CapturedConsoleCall): string {
	return call.args.map((value) => String(value)).join(" ");
}

function parseOperation(line: string): string | undefined {
	if (!line.startsWith(VM_TRACE_PREFIX)) return undefined;
	return /^([A-Z][A-Z0-9_]*)\s/.exec(line.slice(VM_TRACE_PREFIX.length))?.[1];
}

function ownerGroundTruth(
	fixtureId: string,
	calls: readonly CapturedConsoleCall[]
): GroundTruthEvent[] {
	const truth: GroundTruthEvent[] = [];
	let ordinal = 0;
	for (const call of calls) {
		const line = consoleText(call);
		const operation = parseOperation(line);
		if (operation !== undefined) {
			truth.push({
				id: `${fixtureId}:event:${ordinal}`,
				ordinal,
				kind: "operation",
				operation,
			});
			ordinal++;
			continue;
		}
		if (call.args[0] !== VM_DEBUG_PREFIX) continue;
		const label = String(call.args[1] ?? "");
		if (label === "ENTER") {
			const unitPart = call.args.find(
				(value) => typeof value === "string" && value.startsWith("unit=")
			);
			truth.push({
				id: `${fixtureId}:event:${ordinal}`,
				ordinal,
				kind: "function-enter",
				unit:
					typeof unitPart === "string"
						? unitPart.slice("unit=".length)
						: undefined,
			});
			ordinal++;
		} else if (label === "RETURN" || label === "RETURN_VOID") {
			truth.push({
				id: `${fixtureId}:event:${ordinal}`,
				ordinal,
				kind: "function-exit",
			});
			ordinal++;
		} else if (
			label === "EXCEPTION" ||
			label === "CATCH" ||
			label === "FINALLY"
		) {
			truth.push({
				id: `${fixtureId}:event:${ordinal}`,
				ordinal,
				kind: "exception",
			});
			ordinal++;
		}
	}
	return truth;
}

function attackerRecoveryFromConsole(
	calls: readonly CapturedConsoleCall[],
	truth: readonly GroundTruthEvent[]
): RecoveredEvent[] {
	const recovered: RecoveredEvent[] = [];
	let truthCursor = 0;
	const append = (
		predictedKind: TraceBoundaryKind,
		predictedOperation?: string
	): void => {
		const attributedTruth = truth[truthCursor];
		recovered.push({
			ordinal: recovered.length,
			predictedKind,
			predictedOperation,
			attributedTruthId: attributedTruth?.id,
			probeSiteId: LEGACY_CONSOLE_PROBE,
		});
		truthCursor++;
	};
	for (const call of calls) {
		const line = consoleText(call);
		const operation = parseOperation(line);
		if (operation !== undefined) {
			append("operation", operation);
			continue;
		}
		if (call.args[0] !== VM_DEBUG_PREFIX) continue;
		const label = String(call.args[1] ?? "");
		if (label === "ENTER") append("function-enter");
		else if (label === "RETURN" || label === "RETURN_VOID") {
			append("function-exit");
		} else if (
			label === "EXCEPTION" ||
			label === "CATCH" ||
			label === "FINALLY"
		) {
			append("exception");
		}
	}
	return recovered;
}

/** Current VM control adapter. Production transform behavior is not modified. */
export class LegacyVmDynamicTraceExecutor implements DynamicTraceExecutor {
	readonly id = "legacy-vm/debug-console/v1";

	run(fixture: DynamicAttackerFixture, buildSeed: number): DynamicTrace {
		const artifact = obfuscateCodeDeterministic(
			fixture.source,
			LEGACY_BASELINE_OPTIONS,
			buildSeed
		);
		const consoleCalls: CapturedConsoleCall[] = [];
		const execution = executeGenerated(artifact, consoleCalls);
		const truth = ownerGroundTruth(fixture.id, execution.consoleCalls);
		const recovered = attackerRecoveryFromConsole(execution.consoleCalls, truth);
		return {
			schemaVersion: DYNAMIC_TRACE_SCHEMA_VERSION,
			executorId: this.id,
			fixtureId: fixture.id,
			buildSeed: buildSeed >>> 0,
			outcome: execution.outcome,
			truth,
			recovered,
			probeSiteIds: [LEGACY_CONSOLE_PROBE],
			traceTruncated: execution.consoleCalls.some((call) =>
				consoleText(call).includes("max logs reached")
			),
		};
	}

	runWithoutCapture(
		fixture: DynamicAttackerFixture,
		buildSeed: number
	): NormalizedOutcome {
		const artifact = obfuscateCodeDeterministic(
			fixture.source,
			LEGACY_BASELINE_OPTIONS,
			buildSeed
		);
		return executeGenerated(artifact, null).outcome;
	}
}

function ratio(numerator: number, denominator: number): number {
	if (denominator === 0) return numerator === 0 ? 1 : 0;
	return numerator / denominator;
}

function binaryMetrics(
	truePositive: number,
	falsePositive: number,
	falseNegative: number
): BinaryMetrics {
	const precision = ratio(truePositive, truePositive + falsePositive);
	const recall = ratio(truePositive, truePositive + falseNegative);
	return {
		truePositive,
		falsePositive,
		falseNegative,
		precision,
		recall,
		f1:
			precision + recall === 0
				? 0
				: (2 * precision * recall) / (precision + recall),
	};
}

function edgeKey(left: string, right: string): string {
	return `${left}\u0000${right}`;
}

function occurrenceEdgeMetrics(
	truth: readonly GroundTruthEvent[],
	recovered: readonly RecoveredEvent[]
): BinaryMetrics {
	const truthEdges = new Set<string>();
	for (let index = 1; index < truth.length; index++) {
		truthEdges.add(edgeKey(truth[index - 1]!.id, truth[index]!.id));
	}
	const recoveredEdges = new Set<string>();
	for (let index = 1; index < recovered.length; index++) {
		const left = recovered[index - 1]!.attributedTruthId;
		const right = recovered[index]!.attributedTruthId;
		if (left !== undefined && right !== undefined) {
			recoveredEdges.add(edgeKey(left, right));
		}
	}
	let truePositive = 0;
	for (const edge of recoveredEdges) {
		if (truthEdges.has(edge)) truePositive++;
	}
	return binaryMetrics(
		truePositive,
		recoveredEdges.size - truePositive,
		truthEdges.size - truePositive
	);
}

function cfgEdgeMetrics(
	truth: readonly GroundTruthEvent[],
	recovered: readonly RecoveredEvent[],
	truthById: ReadonlyMap<string, GroundTruthEvent>
): BinaryMetrics {
	const truthOps = truth.filter(
		(event): event is GroundTruthEvent & { operation: string } =>
			event.kind === "operation" && event.operation !== undefined
	);
	const truthEdges = new Set<string>();
	for (let index = 1; index < truthOps.length; index++) {
		truthEdges.add(
			edgeKey(truthOps[index - 1]!.operation, truthOps[index]!.operation)
		);
	}
	const recoveredOps = recovered.filter(
		(event): event is RecoveredEvent & { predictedOperation: string } =>
			event.predictedKind === "operation" &&
			event.predictedOperation !== undefined &&
			event.attributedTruthId !== undefined &&
			truthById.has(event.attributedTruthId)
	);
	const recoveredEdges = new Set<string>();
	for (let index = 1; index < recoveredOps.length; index++) {
		recoveredEdges.add(
			edgeKey(
				recoveredOps[index - 1]!.predictedOperation,
				recoveredOps[index]!.predictedOperation
			)
		);
	}
	let truePositive = 0;
	for (const edge of recoveredEdges) {
		if (truthEdges.has(edge)) truePositive++;
	}
	return binaryMetrics(
		truePositive,
		recoveredEdges.size - truePositive,
		truthEdges.size - truePositive
	);
}

export function scoreDynamicTrace(trace: DynamicTrace): DynamicTraceMetrics {
	const truthById = new Map(trace.truth.map((event) => [event.id, event]));
	const matchedIds = new Set<string>();
	let boundaryTruePositive = 0;
	let boundaryFalsePositive = 0;
	for (const event of trace.recovered) {
		const truth = event.attributedTruthId
			? truthById.get(event.attributedTruthId)
			: undefined;
		if (
			truth !== undefined &&
			truth.kind === event.predictedKind &&
			!matchedIds.has(truth.id)
		) {
			matchedIds.add(truth.id);
			boundaryTruePositive++;
		} else {
			boundaryFalsePositive++;
		}
	}
	const boundaryEvents = binaryMetrics(
		boundaryTruePositive,
		boundaryFalsePositive,
		trace.truth.length - boundaryTruePositive
	);

	const truthOperations = trace.truth.filter(
		(event): event is GroundTruthEvent & { operation: string } =>
			event.kind === "operation" && event.operation !== undefined
	);
	const labels = new Set(truthOperations.map((event) => event.operation));
	const perLabel = new Map<
		string,
		{ truePositive: number; falsePositive: number; falseNegative: number }
	>();
	const truthLabelCounts = new Map<string, number>();
	for (const truth of truthOperations) {
		truthLabelCounts.set(
			truth.operation,
			(truthLabelCounts.get(truth.operation) ?? 0) + 1
		);
	}
	const labelCounts = (label: string) => {
		let counts = perLabel.get(label);
		if (counts === undefined) {
			counts = { truePositive: 0, falsePositive: 0, falseNegative: 0 };
			perLabel.set(label, counts);
		}
		return counts;
	};
	let correctLabels = 0;
	let attributedOperations = 0;
	let labelFalsePositive = 0;
	for (const recovered of trace.recovered) {
		if (
			recovered.predictedKind !== "operation" ||
			recovered.predictedOperation === undefined
		) {
			continue;
		}
		labels.add(recovered.predictedOperation);
		const truth =
			recovered.attributedTruthId === undefined
				? undefined
				: truthById.get(recovered.attributedTruthId);
		if (truth?.kind === "operation" && truth.operation !== undefined) {
			attributedOperations++;
			if (truth.operation === recovered.predictedOperation) {
				correctLabels++;
				labelCounts(truth.operation).truePositive++;
			} else {
				labelFalsePositive++;
				labelCounts(recovered.predictedOperation).falsePositive++;
			}
		} else {
			labelFalsePositive++;
			labelCounts(recovered.predictedOperation).falsePositive++;
		}
	}
	for (const [label, truthCount] of truthLabelCounts) {
		const counts = labelCounts(label);
		counts.falseNegative = truthCount - counts.truePositive;
	}
	const labelMetrics = binaryMetrics(
		correctLabels,
		labelFalsePositive,
		truthOperations.length - correctLabels
	);
	const macroF1 =
		labels.size === 0
			? 1
			: [...labels].reduce((sum, label) => {
					const counts = labelCounts(label);
					return (
						sum +
						binaryMetrics(
							counts.truePositive,
							counts.falsePositive,
							counts.falseNegative
						).f1
					);
			  }, 0) / labels.size;

	const operationLabels: OperationMetrics = {
		...labelMetrics,
		accuracy: ratio(correctLabels, attributedOperations),
		macroF1,
	};
	const sequenceEdges = occurrenceEdgeMetrics(trace.truth, trace.recovered);
	const dynamicCfgEdges = cfgEdgeMetrics(
		trace.truth,
		trace.recovered,
		truthById
	);
	const operationEvents = truthOperations.length;
	const functionBoundaryEvents = trace.truth.filter(
		(event) =>
			event.kind === "function-enter" || event.kind === "function-exit"
	).length;
	const exceptionEvents = trace.truth.filter(
		(event) => event.kind === "exception"
	).length;
	const uniqueOperations = new Set(
		truthOperations.map((event) => event.operation)
	).size;
	const dynamicCfgEdgeSet = new Set<string>();
	for (let index = 1; index < truthOperations.length; index++) {
		dynamicCfgEdgeSet.add(
			edgeKey(
				truthOperations[index - 1]!.operation,
				truthOperations[index]!.operation
			)
		);
	}
	return {
		boundaryEvents,
		operationLabels,
		sequenceEdges,
		dynamicCfgEdges,
		counts: {
			truthEvents: trace.truth.length,
			recoveredEvents: trace.recovered.length,
			operationEvents,
			functionBoundaryEvents,
			exceptionEvents,
			uniqueOperations,
			sequenceEdges: Math.max(0, trace.truth.length - 1),
			dynamicCfgEdges: dynamicCfgEdgeSet.size,
		},
	};
}

function aggregateMetrics(
	metrics: readonly DynamicTraceMetrics[]
): DynamicTraceMetrics {
	const combineBinary = (
		select: (metric: DynamicTraceMetrics) => BinaryMetrics
	): BinaryMetrics =>
		binaryMetrics(
			metrics.reduce((sum, metric) => sum + select(metric).truePositive, 0),
			metrics.reduce((sum, metric) => sum + select(metric).falsePositive, 0),
			metrics.reduce((sum, metric) => sum + select(metric).falseNegative, 0)
		);
	const operationBinary = combineBinary((metric) => metric.operationLabels);
	const attributed = metrics.reduce(
		(sum, metric) =>
			sum +
			metric.operationLabels.truePositive +
			metric.operationLabels.falsePositive,
		0
	);
	const operationLabels: OperationMetrics = {
		...operationBinary,
		accuracy: ratio(operationBinary.truePositive, attributed),
		macroF1:
			metrics.length === 0
				? 1
				: metrics.reduce(
						(sum, metric) => sum + metric.operationLabels.macroF1,
						0
				  ) / metrics.length,
	};
	const sumCount = (key: keyof TraceCounts): number =>
		metrics.reduce((sum, metric) => sum + metric.counts[key], 0);
	return {
		boundaryEvents: combineBinary((metric) => metric.boundaryEvents),
		operationLabels,
		sequenceEdges: combineBinary((metric) => metric.sequenceEdges),
		dynamicCfgEdges: combineBinary((metric) => metric.dynamicCfgEdges),
		counts: {
			truthEvents: sumCount("truthEvents"),
			recoveredEvents: sumCount("recoveredEvents"),
			operationEvents: sumCount("operationEvents"),
			functionBoundaryEvents: sumCount("functionBoundaryEvents"),
			exceptionEvents: sumCount("exceptionEvents"),
			uniqueOperations: sumCount("uniqueOperations"),
			sequenceEdges: sumCount("sequenceEdges"),
			dynamicCfgEdges: sumCount("dynamicCfgEdges"),
		},
	};
}

function sameOutcome(left: NormalizedOutcome, right: NormalizedOutcome): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function semanticStream(trace: DynamicTrace): string {
	return trace.recovered
		.filter((event) => event.predictedKind === "operation")
		.map((event) => event.predictedOperation ?? "?")
		.join("\u0000");
}

export function buildLegacyVmBaselineReport(
	fixtures: readonly DynamicAttackerFixture[],
	options: {
		buildSeed?: number;
		repeatCount?: number;
		corpusVersion?: number;
	} = {}
): DynamicBaselineReport {
	const buildSeed = options.buildSeed ?? 0x1badb002;
	const repeatCount = options.repeatCount ?? 2;
	if (!Number.isSafeInteger(repeatCount) || repeatCount < 2) {
		throw new Error("RUAM_DYNAMIC_BASELINE_REPEATS_MUST_BE_AT_LEAST_TWO");
	}
	const executor = new LegacyVmDynamicTraceExecutor();
	const runs = fixtures.map((fixture) => {
		const trace = executor.run(fixture, buildSeed);
		return { fixtureId: fixture.id, trace, metrics: scoreDynamicTrace(trace) };
	});
	const repeated = Array.from({ length: repeatCount }, () =>
		fixtures.map((fixture) => executor.run(fixture, buildSeed))
	);
	const stableSemanticStream = fixtures.every((_, fixtureIndex) => {
		const expectedStream = semanticStream(repeated[0]![fixtureIndex]!);
		return repeated.every(
			(batch) => semanticStream(batch[fixtureIndex]!) === expectedStream
		);
	});
	const correctnessPreserved = fixtures.every((fixture, fixtureIndex) => {
		const observed = runs[fixtureIndex]!.trace.outcome;
		const unobserved = executor.runWithoutCapture(fixture, buildSeed);
		const expected: NormalizedOutcome = {
			type: "return",
			value: normalizeValue(fixture.expected),
		};
		return sameOutcome(observed, unobserved) && sameOutcome(observed, expected);
	});
	const completeRecovery = runs.every(
		(run) =>
			run.metrics.boundaryEvents.recall === 1 &&
			run.metrics.operationLabels.f1 === 1 &&
			!run.trace.traceTruncated
	);
	const distinctProbeSites = new Set(
		runs.flatMap((run) => [...run.trace.probeSiteIds])
	).size;
	const patchCollapse: PatchCollapseMetrics = {
		minimumLocalizedSites:
			completeRecovery && stableSemanticStream && correctnessPreserved
				? distinctProbeSites
				: null,
		stableSemanticStream,
		correctnessPreserved,
		repeatCount,
	};
	return {
		schemaVersion: DYNAMIC_TRACE_SCHEMA_VERSION,
		executorId: executor.id,
		corpusVersion: options.corpusVersion ?? 1,
		runs,
		aggregate: aggregateMetrics(runs.map((run) => run.metrics)),
		patchCollapse,
	};
}
