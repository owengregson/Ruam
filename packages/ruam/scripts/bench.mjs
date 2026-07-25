#!/usr/bin/env bun
/**
 * Product-shaped Isogloss build, size, and steady-state runtime benchmark.
 *
 * This reports engineering costs only. It is not a secrecy or hardness
 * measurement: holographic-local remains complete under client instrumentation.
 */

import { protectCode } from "../src/index.ts";

const QUICK = process.argv.includes("--quick");
const ITERATIONS = QUICK ? 5_000 : 50_000;
const ROUNDS = QUICK ? 5 : 9;
const SOURCE = `
/* ruam:isogloss */
function guardedKernel(x, y, z) {
  return (x * y) + (z * z) + (x * z) + (y * 2) + 17;
}
`;
const OPTIONS = {
	targetMode: "comment",
	regionDomains: {
		guardedKernel: {
			x: { type: "number", min: 1, max: 31 },
			y: { type: "number", min: 1, max: 31 },
			z: { type: "number", min: 1, max: 31 },
		},
	},
};

function materialize(code) {
	return Function(`"use strict";${code};return guardedKernel;`)();
}

function expected(x, y, z) {
	return (x * y) + (z * z) + (x * z) + (y * 2) + 17;
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

function measure(fn) {
	let checksum = 0;
	for (let i = 0; i < 1_000; i++) {
		const x = (i % 31) + 1;
		const y = ((i * 7) % 31) + 1;
		const z = ((i * 13) % 31) + 1;
		checksum += fn(x, y, z);
	}
	const samples = [];
	for (let round = 0; round < ROUNDS; round++) {
		const started = performance.now();
		for (let i = 0; i < ITERATIONS; i++) {
			const x = (i % 31) + 1;
			const y = ((i * 7) % 31) + 1;
			const z = ((i * 13) % 31) + 1;
			checksum += fn(x, y, z);
		}
		samples.push(performance.now() - started);
	}
	return { milliseconds: median(samples), checksum };
}

const buildStarted = performance.now();
const build = protectCode(SOURCE, OPTIONS);
const buildMilliseconds = performance.now() - buildStarted;
const native = materialize(SOURCE);
const protectedKernel = materialize(build.code);

for (let x = 1; x <= 31; x += 5) {
	for (let y = 1; y <= 31; y += 7) {
		for (let z = 1; z <= 31; z += 11) {
			const want = expected(x, y, z);
			const got = protectedKernel(x, y, z);
			if (got !== want) {
				throw new Error(
					`differential mismatch at (${x},${y},${z}): ${got} !== ${want}`
				);
			}
		}
	}
}

const nativeTiming = measure(native);
const protectedTiming = measure(protectedKernel);
const sourceBytes = new TextEncoder().encode(SOURCE).byteLength;
const outputBytes = new TextEncoder().encode(build.code).byteLength;
const runtimeOverhead =
	protectedTiming.milliseconds / nativeTiming.milliseconds;

console.log("Ruam Isogloss local benchmark");
console.table({
	build: {
		value: buildMilliseconds.toFixed(3),
		unit: "ms",
	},
	"source size": {
		value: sourceBytes,
		unit: "bytes",
	},
	"protected size": {
		value: outputBytes,
		unit: "bytes",
	},
	"size expansion": {
		value: (outputBytes / sourceBytes).toFixed(2),
		unit: "x",
	},
	"native execution": {
		value: nativeTiming.milliseconds.toFixed(3),
		unit: `ms / ${ITERATIONS}`,
	},
	"protected execution": {
		value: protectedTiming.milliseconds.toFixed(3),
		unit: `ms / ${ITERATIONS}`,
	},
	"runtime overhead": {
		value: runtimeOverhead.toFixed(2),
		unit: "x",
	},
});
console.log({
	engine: build.stats.engine,
	profile: build.stats.profile,
	protectedRegions: build.stats.protectedRegionCount,
	realizations: build.stats.realizationCount,
	clientCompleteness: build.stats.clientCompleteness,
	hardnessLowerBound: build.stats.hardnessLowerBound,
	checksumAgreement:
		nativeTiming.checksum === protectedTiming.checksum,
});

const budgets = {
	maxBuildMilliseconds: 2_000,
	maxOutputBytes: 18_000,
	maxQuickProtectedMilliseconds: 250,
};
if (
	nativeTiming.checksum !== protectedTiming.checksum ||
	buildMilliseconds > budgets.maxBuildMilliseconds ||
	outputBytes > budgets.maxOutputBytes ||
	(QUICK &&
		protectedTiming.milliseconds >
			budgets.maxQuickProtectedMilliseconds)
) {
	throw new Error(
		`RUAM_BENCHMARK_BUDGET_EXCEEDED: ${JSON.stringify({
			buildMilliseconds,
			outputBytes,
			protectedMilliseconds: protectedTiming.milliseconds,
			budgets,
		})}`
	);
}
