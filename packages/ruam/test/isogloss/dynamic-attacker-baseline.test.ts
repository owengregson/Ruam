import { describe, expect, it } from "bun:test";
import {
	buildLegacyVmBaselineReport,
	type DynamicTrace,
	scoreDynamicTrace,
} from "./support/dynamic-attacker.js";
import {
	DYNAMIC_ATTACKER_CORPUS_VERSION,
	DYNAMIC_ATTACKER_FIXTURES,
} from "./support/dynamic-attacker-fixtures.js";

describe("dynamic attacker control baseline", () => {
	it("keeps the fixture corpus versioned and covers every first-gate behavior", () => {
		expect(DYNAMIC_ATTACKER_CORPUS_VERSION).toBe(1);
		expect(DYNAMIC_ATTACKER_FIXTURES.map((fixture) => fixture.id)).toEqual([
			"pure-arithmetic-control",
			"direct-calls",
			"object-property-effects",
			"exceptions-and-finally",
		]);
		const categories = new Set(
			DYNAMIC_ATTACKER_FIXTURES.flatMap((fixture) => fixture.categories)
		);
		expect(categories).toEqual(
			new Set(["pure", "control", "call", "property-effect", "exception"])
		);
	});

	it("recovers the legacy VM semantic stream from one localized probe", () => {
		const report = buildLegacyVmBaselineReport(DYNAMIC_ATTACKER_FIXTURES, {
			buildSeed: 0x1badb002,
			repeatCount: 2,
			corpusVersion: DYNAMIC_ATTACKER_CORPUS_VERSION,
		});

		expect(report.executorId).toBe("legacy-vm/debug-console/v1");
		expect(report.aggregate.counts.operationEvents).toBeGreaterThan(100);
		expect(report.aggregate.counts.functionBoundaryEvents).toBeGreaterThan(0);
		expect(report.aggregate.counts.exceptionEvents).toBeGreaterThan(0);
		expect(report.aggregate.boundaryEvents.precision).toBe(1);
		expect(report.aggregate.boundaryEvents.recall).toBe(1);
		expect(report.aggregate.boundaryEvents.f1).toBe(1);
		expect(report.aggregate.operationLabels.accuracy).toBe(1);
		expect(report.aggregate.operationLabels.f1).toBe(1);
		expect(report.aggregate.operationLabels.macroF1).toBe(1);
		expect(report.aggregate.sequenceEdges.recall).toBe(1);
		expect(report.aggregate.dynamicCfgEdges.recall).toBe(1);
		expect(report.patchCollapse).toEqual({
			minimumLocalizedSites: 1,
			stableSemanticStream: true,
			correctnessPreserved: true,
			repeatCount: 2,
		});
		expect(report.runs.every((run) => !run.trace.traceTruncated)).toBe(true);
	});

	it("penalizes missed boundaries, wrong labels, and broken sequence edges", () => {
		const baseline = buildLegacyVmBaselineReport(
			[DYNAMIC_ATTACKER_FIXTURES[0]!],
			{ repeatCount: 2 }
		).runs[0]!.trace;
		const degraded: DynamicTrace = {
			...baseline,
			recovered: baseline.recovered
				.slice(1)
				.map((event, index) =>
					index === 1 && event.predictedOperation !== undefined
						? { ...event, predictedOperation: "WRONG_OPERATION" }
						: event
				),
		};
		const metrics = scoreDynamicTrace(degraded);

		expect(metrics.boundaryEvents.recall).toBeLessThan(1);
		expect(metrics.operationLabels.accuracy).toBeLessThan(1);
		expect(metrics.operationLabels.f1).toBeLessThan(1);
		expect(metrics.sequenceEdges.recall).toBeLessThan(1);
		expect(metrics.dynamicCfgEdges.precision).toBeLessThan(1);
	});
});
