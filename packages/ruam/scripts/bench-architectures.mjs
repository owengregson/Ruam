#!/usr/bin/env bun
/**
 * Reproducible Isogloss-vs-legacy-VM architecture benchmark.
 *
 * The legacy implementation is loaded from the frozen commit immediately
 * before PR 6 production work. It is never copied back into the product tree.
 * Unsupported legacy workloads are reported as such instead of disappearing
 * from the comparison.
 */

import { gzipSync } from "node:zlib";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { Script } from "node:vm";
import {
	protectCode,
	validateIsoglossProtectionCertificate,
} from "../src/index.ts";

const LEGACY_REF = "e8cecb56ba89d47512a16e325d81cf46f64b2ecb";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, "..");
const ROOT_LOOKUP = spawnSync("git", ["rev-parse", "--show-toplevel"], {
	cwd: PACKAGE_DIR,
	encoding: "utf8",
});
if (ROOT_LOOKUP.status !== 0) {
	throw new Error(ROOT_LOOKUP.stderr || "not inside a git repository");
}
const REPO_ROOT = ROOT_LOOKUP.stdout.trim();
const QUICK = process.argv.includes("--quick");
const STRICT_PROTECTION = process.argv.includes("--strict-protection");
const JSON_INDEX = process.argv.indexOf("--json");
const JSON_PATH =
	JSON_INDEX === -1
		? null
		: path.resolve(process.cwd(), process.argv[JSON_INDEX + 1] ?? "");
const PRESET_INDEX = process.argv.indexOf("--legacy-preset");
const PRESET_ARG =
	PRESET_INDEX === -1 ? null : process.argv[PRESET_INDEX + 1];
const LEGACY_PRESETS = PRESET_ARG
	? [PRESET_ARG]
	: ["default", "medium", "max"];
const BUILD_ROUNDS = QUICK ? 3 : 7;
const TIMING_ROUNDS = QUICK ? 5 : 11;
const CALLS_PER_ROUND = QUICK ? 3 : 10;

for (const preset of LEGACY_PRESETS) {
	if (!["default", "low", "medium", "max"].includes(preset)) {
		throw new Error(`unknown legacy preset: ${preset}`);
	}
}
if (JSON_INDEX !== -1 && !process.argv[JSON_INDEX + 1]) {
	throw new Error("--json requires an output path");
}

const WORKLOADS = [
	{
		name: "bprf-arithmetic-hot-loop",
		category: "finite-pure",
		source: `
function guarded(x, y, z) {
	return (x * y) + (z * z) + (x * z) + (y * 2) + 17;
}
function work() {
	let total = 0;
	for (let i = 0; i < 10000; i++) {
		total += guarded((i % 31) + 1, ((i * 7) % 31) + 1, ((i * 13) % 31) + 1);
	}
	return total;
}
`,
		options: {
			regionDomains: {
				guarded: {
					x: { type: "number", min: 1, max: 31 },
					y: { type: "number", min: 1, max: 31 },
					z: { type: "number", min: 1, max: 31 },
				},
				work: {},
			},
		},
	},
	{
		name: "arithmetic-control-flow",
		category: "native-statements",
		source: `
function work() {
	let total = 0;
	for (let i = 0; i < 100000; i++) {
		switch (i % 5) {
			case 0: total += i * 3; break;
			case 1: total -= i >>> 2; break;
			case 2: total ^= i; break;
			case 3: total += i % 17; break;
			default: total -= 1;
		}
	}
	return total;
}
`,
		options: { regionDomains: { work: {} } },
	},
	{
		name: "recursive-closures",
		category: "functions",
		source: `
function work() {
	function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
	let captured = 3;
	const adjust = (value) => value + captured++;
	return adjust(fib(24)) + adjust(fib(20));
}
`,
		options: { regionDomains: { work: {} } },
	},
	{
		name: "strings-arrays-objects",
		category: "data-structures",
		source: `
function work() {
	const rows = [];
	for (let i = 0; i < 5000; i++) rows.push({ key: "k" + (i % 97), value: (i * 17) % 101 });
	rows.sort((a, b) => a.value - b.value || a.key.localeCompare(b.key));
	return rows.map((row) => row.key + ":" + row.value).join("|").length;
}
`,
		options: { regionDomains: { work: {} } },
	},
	{
		name: "classes-private-super",
		category: "classes",
		source: `
function work() {
	class Point {
		#x;
		#y;
		constructor(x, y) { this.#x = x; this.#y = y; }
		distance(other) { return Math.hypot(this.#x - other.#x, this.#y - other.#y); }
	}
	class NamedPoint extends Point {
		static count = 0;
		constructor(x, y) { super(x, y); NamedPoint.count++; }
	}
	const points = [];
	for (let i = 0; i < 5000; i++) points.push(new NamedPoint(i, i * 2));
	let total = 0;
	for (let i = 1; i < points.length; i++) total += points[i].distance(points[i - 1]);
	return Math.round(total) + NamedPoint.count;
}
`,
		options: { regionDomains: { work: {} } },
	},
	{
		name: "exceptions-proxy-coercion",
		category: "effects",
		source: `
function work() {
	let total = 0;
	const target = { value: 2, [Symbol.toPrimitive]() { return this.value; } };
	const proxy = new Proxy(target, {
		get(object, key, receiver) { return Reflect.get(object, key, receiver); },
		set(object, key, value, receiver) { return Reflect.set(object, key, value, receiver); },
	});
	for (let i = 0; i < 20000; i++) {
		try {
			if (i % 997 === 0) throw new RangeError("sample");
			proxy.value = i % 13;
			total += proxy + 1;
		} catch (error) {
			total += error.message.length;
		}
	}
	return total;
}
`,
		options: { regionDomains: { work: {} } },
	},
	{
		name: "generators-iteration",
		category: "generators",
		source: `
function* sequence(limit) {
	for (let i = 0; i < limit; i++) yield (i * 17) % 101;
}
function work() {
	let total = 0;
	for (const value of sequence(30000)) total += value;
	return total;
}
`,
		options: { regionDomains: { sequence: {}, work: {} } },
	},
	{
		name: "async-await",
		category: "async",
		async: true,
		source: `
async function work() {
	let total = 0;
	for (let i = 0; i < 1000; i++) total += await Promise.resolve(i % 29);
	return total;
}
`,
		options: { regionDomains: { work: {} } },
	},
	{
		name: "hybrid-pure-effectful",
		category: "hybrid",
		source: `
function score(x, object) {
	if (object.native) return object.value;
	return (x + 3) * (x + 2);
}
function work() {
	let total = 0;
	for (let i = 0; i < 10000; i++) total += score((i % 10) + 1, { native: i % 11 === 0, value: i % 7 });
	return total;
}
`,
		options: {
			regionDomains: {
				score: { x: { type: "number", min: 1, max: 10 } },
				work: {},
			},
		},
	},
];

const legacyDir = await mkdtemp(path.join(tmpdir(), "ruam-legacy-bench-"));
let worktreeAdded = false;

try {
	git(["worktree", "add", "--detach", legacyDir, LEGACY_REF]);
	worktreeAdded = true;
	await symlink(path.join(REPO_ROOT, "node_modules"), path.join(legacyDir, "node_modules"));
	await symlink(
		path.join(PACKAGE_DIR, "node_modules"),
		path.join(legacyDir, "packages/ruam/node_modules")
	);
	const legacyModule = await import(
		`${pathToFileURL(path.join(legacyDir, "packages/ruam/src/index.ts")).href}?bench=${Date.now()}`
	);

	const rows = [];
	for (const workload of WORKLOADS) {
		const source = exposeWork(workload.source);
		const nativeProgram = materialize(source);
		const nativeResult = await nativeProgram.work();
		const nativeTiming = await measure(
			nativeProgram.work,
			Boolean(workload.async)
		);

			const currentBuild = await measureBuild(() =>
				protectCode(source, workload.options)
			);
			const protectionCertificate = currentProtectionCertificate(
				currentBuild.value,
				workload.name
			);
			const currentProgram = materialize(currentBuild.value.code);
		const currentResult = await currentProgram.work();
		const currentTiming = await measure(
			currentProgram.work,
			Boolean(workload.async)
		);
		const expected = canonical(nativeResult);
		if (canonical(currentResult) !== expected) {
			throw new Error(`Isogloss correctness mismatch: ${workload.name}`);
		}

		const legacy = {};
			for (const preset of LEGACY_PRESETS) {
				const options = preset === "default" ? {} : { preset };
				try {
					const warningCapture = await captureWarnings(() =>
						measureBuild(() => ({
							code: legacyModule.obfuscateCode(source, options),
						}))
					);
					const legacyBuild = warningCapture.value;
					const legacyProgram = materialize(legacyBuild.value.code);
				const legacyResult = await legacyProgram.work();
				const legacyTiming = await measure(
					legacyProgram.work,
					Boolean(workload.async)
				);
				const correct = canonical(legacyResult) === expected;
					if (!correct) {
						throw new Error(`legacy correctness mismatch: ${workload.name}:${preset}`);
					}
					const protectionStatus = classifyLegacyProtection(
						legacyBuild.value.code,
						warningCapture.warnings
					);
					legacy[preset] = {
						protectionStatus,
						correct,
						compileWarnings: warningCapture.warnings,
						buildMilliseconds: legacyBuild.milliseconds,
					bootstrapMilliseconds: legacyProgram.bootstrapMilliseconds,
					runtimeMilliseconds: legacyTiming,
					outputBytes: bytes(legacyBuild.value.code),
					gzipBytes: gzipBytes(legacyBuild.value.code),
				};
				} catch (error) {
					legacy[preset] = {
						protectionStatus: "failed",
						correct: false,
						error: error instanceof Error ? error.message : String(error),
				};
			}
		}

		rows.push({
			name: workload.name,
			category: workload.category,
			async: Boolean(workload.async),
			sourceBytes: bytes(source),
			native: {
				bootstrapMilliseconds: nativeProgram.bootstrapMilliseconds,
				runtimeMilliseconds: nativeTiming,
			},
				isogloss: {
					correct: true,
					fullyProtected: protectionCertificate !== null,
					protectionCertificate:
						protectionCertificate === null
							? null
							: certificateSummary(protectionCertificate),
					buildMilliseconds: currentBuild.milliseconds,
				bootstrapMilliseconds: currentProgram.bootstrapMilliseconds,
				runtimeMilliseconds: currentTiming,
				outputBytes: bytes(currentBuild.value.code),
				gzipBytes: gzipBytes(currentBuild.value.code),
				protectedRegions: currentBuild.value.stats.protectedRegionCount,
				nativeRegions: currentBuild.value.stats.nativeRegionCount,
				targetFunctions: currentBuild.value.stats.targetFunctionCount,
				hybridFunctions: currentBuild.value.stats.hybridFunctionCount,
			},
			legacy,
		});
	}

	const result = {
			schemaVersion: 2,
		purpose: "Isogloss versus frozen pre-PR-6 VM architecture engineering benchmark",
		legacyRef: LEGACY_REF,
		mode: QUICK ? "quick" : "full",
			parameters: {
				strictProtection: STRICT_PROTECTION,
			buildRounds: BUILD_ROUNDS,
			timingRounds: TIMING_ROUNDS,
			callsPerRound: CALLS_PER_ROUND,
			legacyPresets: LEGACY_PRESETS,
		},
		environment: {
			date: new Date().toISOString(),
			platform: `${process.platform}-${process.arch}`,
			osRelease: os.release(),
			cpu: os.cpus()[0]?.model ?? "unknown",
			logicalCpuCount: os.cpus().length,
			memoryBytes: os.totalmem(),
			node: process.version,
			bun: Bun.version,
		},
		rows,
		summary: summarize(rows),
	};

	print(result);
	if (JSON_PATH) {
		await writeFile(JSON_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
		console.log(`\nwrote ${JSON_PATH}`);
	}
} finally {
	if (worktreeAdded) {
		spawnSync("git", ["worktree", "remove", "--force", legacyDir], {
			cwd: REPO_ROOT,
			stdio: "ignore",
		});
	}
	await rm(legacyDir, { recursive: true, force: true });
}

function materialize(code) {
	const started = performance.now();
	const work = new Script(`(()=>{${code}\n;const exposed=globalThis.__ruamBenchWork;delete globalThis.__ruamBenchWork;return exposed;})()`, {
		filename: "architecture-benchmark.js",
	}).runInThisContext();
	if (typeof work !== "function") throw new Error("workload did not expose work()");
	return {
		work,
		bootstrapMilliseconds: performance.now() - started,
	};
}

function exposeWork(source) {
	return `${source}\n;globalThis.__ruamBenchWork=work;`;
}

async function measure(work, isAsync) {
	for (let index = 0; index < 2; index++) await work();
	const samples = [];
	for (let round = 0; round < TIMING_ROUNDS; round++) {
		const started = performance.now();
		if (isAsync) {
			for (let call = 0; call < CALLS_PER_ROUND; call++) await work();
		} else {
			for (let call = 0; call < CALLS_PER_ROUND; call++) work();
		}
		samples.push((performance.now() - started) / CALLS_PER_ROUND);
	}
	return median(samples);
}

async function measureBuild(build) {
	const samples = [];
	let value;
	for (let round = 0; round < BUILD_ROUNDS; round++) {
		const started = performance.now();
		value = build();
		samples.push(performance.now() - started);
	}
	return { value, milliseconds: median(samples) };
}

function summarize(rows) {
	const isogloss = {
		allCorrect: rows.every((row) => row.isogloss.correct),
		totalSourceBytes: sum(rows, (row) => row.sourceBytes),
		totalOutputBytes: sum(rows, (row) => row.isogloss.outputBytes),
		medianBuildMilliseconds: median(rows.map((row) => row.isogloss.buildMilliseconds)),
		geometricRuntimeOverheadVsNative: geometricMean(
			rows.map((row) => row.isogloss.runtimeMilliseconds / row.native.runtimeMilliseconds)
		),
	};
	const legacy = {};
	for (const preset of LEGACY_PRESETS) {
		const supported = rows.filter((row) => row.legacy[preset].supported);
		legacy[preset] = {
			supportedWorkloads: supported.length,
			unsupportedWorkloads: rows.length - supported.length,
			totalOutputBytes: sum(supported, (row) => row.legacy[preset].outputBytes),
			medianBuildMilliseconds:
				supported.length === 0
					? null
					: median(supported.map((row) => row.legacy[preset].buildMilliseconds)),
			geometricRuntimeOverheadVsNative:
				supported.length === 0
					? null
					: geometricMean(
						supported.map(
							(row) =>
								row.legacy[preset].runtimeMilliseconds /
								row.native.runtimeMilliseconds
						)
					),
			geometricIsoglossSpeedup:
				supported.length === 0
					? null
					: geometricMean(
						supported.map(
							(row) =>
								row.legacy[preset].runtimeMilliseconds /
								row.isogloss.runtimeMilliseconds
						)
					),
		};
	}
	return { isogloss, legacy };
}

function print(result) {
	console.log(`Ruam architecture benchmark (${result.mode})`);
	console.log(`legacy ref: ${result.legacyRef}`);
	for (const preset of LEGACY_PRESETS) {
		console.log(`\nlegacy preset: ${preset}`);
		console.table(
			result.rows.map((row) => {
				const legacy = row.legacy[preset];
				return {
					workload: row.name,
					lane:
						row.isogloss.protectedRegions === 0
							? "native"
							: row.isogloss.hybridFunctions > 0
								? "hybrid"
								: "bprf",
					"native ms": fixed(row.native.runtimeMilliseconds),
					"isogloss ms": fixed(row.isogloss.runtimeMilliseconds),
					"legacy ms": legacy.supported ? fixed(legacy.runtimeMilliseconds) : "unsupported",
					"iso bytes": row.isogloss.outputBytes,
					"legacy bytes": legacy.supported ? legacy.outputBytes : "unsupported",
					"iso speedup": legacy.supported
						? `${(legacy.runtimeMilliseconds / row.isogloss.runtimeMilliseconds).toFixed(2)}x`
						: "n/a",
				};
			})
		);
		console.log(result.summary.legacy[preset]);
	}
	console.log("\nIsogloss summary", result.summary.isogloss);
}

function git(args) {
	const result = spawnSync("git", args, {
		cwd: REPO_ROOT,
		encoding: "utf8",
	});
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
	}
	return result.stdout;
}

function canonical(value) {
	return JSON.stringify(value, (_key, item) =>
		typeof item === "bigint" ? `${item}n` : item
	);
}

function bytes(value) {
	return Buffer.byteLength(value, "utf8");
}

function gzipBytes(value) {
	return gzipSync(value, { level: 9 }).byteLength;
}

function median(values) {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.floor(sorted.length / 2)];
}

function geometricMean(values) {
	return Math.exp(sum(values, (value) => Math.log(value)) / values.length);
}

function sum(values, pick) {
	return values.reduce((total, value) => total + pick(value), 0);
}

function fixed(value) {
	return value.toFixed(3);
}
