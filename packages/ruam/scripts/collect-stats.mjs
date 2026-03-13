#!/usr/bin/env node
/**
 * Collects project statistics and writes stats.json.
 *
 * README badges use shields.io dynamic JSON badges that read directly
 * from the committed stats.json on GitHub — no README modification needed.
 *
 * Usage:
 *   node scripts/collect-stats.mjs            # Code metrics + cached test/bench results
 *   node scripts/collect-stats.mjs --test      # Also run tests
 *   node scripts/collect-stats.mjs --bench     # Also run performance/size benchmarks (requires build)
 *   node scripts/collect-stats.mjs --all       # Everything
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const REPO_ROOT = join(PKG_ROOT, "..", "..");
const STATS_PATH = join(PKG_ROOT, "stats.json");
const TEST_RESULTS_PATH = join(PKG_ROOT, "test-results.json");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function walkFiles(dir, ext) {
	const results = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) results.push(...walkFiles(full, ext));
		else if (entry.name.endsWith(ext)) results.push(full);
	}
	return results;
}

function countLines(files) {
	let total = 0;
	for (const f of files) total += readFileSync(f, "utf8").split("\n").length;
	return total;
}

function fmtNum(n) {
	return n.toLocaleString("en-US");
}

function fmtK(n) {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function loadPrevStats() {
	if (!existsSync(STATS_PATH)) return null;
	try {
		return JSON.parse(readFileSync(STATS_PATH, "utf8"));
	} catch {
		return null;
	}
}

// ─── Code Metrics ────────────────────────────────────────────────────────────

function collectOpcodeStats() {
	const src = readFileSync(join(PKG_ROOT, "src/compiler/opcodes.ts"), "utf8");

	// Enum members
	const enumMatch = src.match(/export\s+enum\s+Op\s*\{([\s\S]*?)\n\}/);
	if (!enumMatch) throw new Error("Could not find Op enum");
	const members = (enumMatch[1].match(/^\s+[A-Z][A-Z_0-9]+/gm) ?? []).map(
		(m) => m.trim()
	);
	const count = members.length;

	// Category headings (// N. Category Name)
	const catNums = new Set();
	for (const m of src.matchAll(/\/\/\s*(\d+)\.\s+[A-Z]/g)) catNums.add(m[1]);

	// Superinstructions (REG_ prefixed fused opcodes)
	const superinstructions = members.filter((m) =>
		m.startsWith("REG_")
	).length;

	// Compound / fast-path opcodes
	const compounds = members.filter((m) => {
		return (
			m.startsWith("POST_INC_") ||
			m.startsWith("POST_DEC_") ||
			m.startsWith("PRE_INC_") ||
			m.startsWith("PRE_DEC_") ||
			m.includes("_ASSIGN_") ||
			m === "INC_SCOPED" ||
			m === "DEC_SCOPED" ||
			m === "INC_SLOT" ||
			m === "DEC_SLOT"
		);
	}).length;

	// Slot-based opcodes (Tier 4)
	const slotOpcodes = members.filter((m) => m.endsWith("_SLOT")).length;

	return {
		count,
		categories: catNums.size,
		superinstructions,
		compounds,
		slotOpcodes,
	};
}

function collectSourceStats() {
	const srcFiles = walkFiles(join(PKG_ROOT, "src"), ".ts");
	const srcLines = countLines(srcFiles);

	const testDir = join(PKG_ROOT, "test");
	const testFiles = existsSync(testDir) ? walkFiles(testDir, ".ts") : [];
	const testLines = countLines(testFiles);

	// Runtime template files
	const templatesDir = join(PKG_ROOT, "src/runtime/templates");
	const templateCount = existsSync(templatesDir)
		? walkFiles(templatesDir, ".ts").length
		: 0;

	// Compiler visitor files
	const visitorsDir = join(PKG_ROOT, "src/compiler/visitors");
	const visitorCount = existsSync(visitorsDir)
		? walkFiles(visitorsDir, ".ts").length
		: 0;

	return {
		files: srcFiles.length,
		lines: srcLines,
		testFiles: testFiles.length,
		testLines,
		totalFiles: srcFiles.length + testFiles.length,
		totalLines: srcLines + testLines,
		templateFiles: templateCount,
		visitorFiles: visitorCount,
	};
}

// ─── Test Results ────────────────────────────────────────────────────────────

function collectTestStats(runTests) {
	if (runTests) {
		console.log("  Running tests...");
		try {
			execSync(
				"npx vitest run --reporter=default --reporter=json --outputFile.json=test-results.json",
				{
					cwd: PKG_ROOT,
					stdio: ["ignore", "pipe", "pipe"],
					timeout: 600_000,
				}
			);
		} catch {
			if (!existsSync(TEST_RESULTS_PATH)) {
				console.error("  Tests failed — no results file produced.");
				return null;
			}
		}
	}

	if (!existsSync(TEST_RESULTS_PATH)) return null;

	try {
		const json = JSON.parse(readFileSync(TEST_RESULTS_PATH, "utf8"));

		// Count test categories from suite names
		const suiteNames = (json.testResults ?? []).map((r) => r.name ?? "");
		const categories = new Set(
			suiteNames
				.map((n) => {
					const m = n.match(/test[/\\](\w+)[/\\]/);
					return m ? m[1] : null;
				})
				.filter(Boolean)
		);

		return {
			total: json.numTotalTests,
			passed: json.numPassedTests,
			failed: json.numFailedTests ?? 0,
			suites: json.numTotalTestSuites ?? 0,
			categories: [...categories],
			durationMs: json.startTime ? Date.now() - json.startTime : null,
		};
	} catch {
		console.error("  Could not parse test-results.json");
		return null;
	}
}

// ─── Benchmarks ──────────────────────────────────────────────────────────────

async function collectBenchmarks() {
	const distIndex = join(PKG_ROOT, "dist/index.js");
	if (!existsSync(distIndex)) {
		console.error(
			"  Build not found — run `npm run build` first for benchmarks."
		);
		return null;
	}

	const { obfuscateCode } = await import(distIndex);

	// ── Size analysis ──────────────────────────────────────────────────────────
	const sampleCode = `function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}
fibonacci(10);`;

	const obfLow = obfuscateCode(sampleCode);
	const obfMed = obfuscateCode(sampleCode, { preset: "medium" });
	const obfHigh = obfuscateCode(sampleCode, { preset: "high" });

	const inputBytes = Buffer.byteLength(sampleCode, "utf8");
	const lowBytes = Buffer.byteLength(obfLow, "utf8");
	const medBytes = Buffer.byteLength(obfMed, "utf8");
	const highBytes = Buffer.byteLength(obfHigh, "utf8");

	// ── Performance analysis ───────────────────────────────────────────────────
	const workloads = [
		{
			name: "arithmetic loop (10k)",
			code: `function work(){var s=0;for(var i=0;i<10000;i++)s+=i*3-(i%7);return s}work();`,
		},
		{
			name: "fibonacci (n=20)",
			code: `function fib(n){if(n<=1)return n;return fib(n-1)+fib(n-2)}fib(20);`,
		},
		{
			name: "array ops",
			code: `function work(){var a=[];for(var i=0;i<500;i++)a.push((i*17)%100);a.sort(function(x,y){return x-y});return a.map(function(x){return x*2+1}).reduce(function(s,x){return s+x},0)}work();`,
		},
		{
			name: "string ops",
			code: `function work(){var s="";for(var i=0;i<500;i++)s+=String.fromCharCode(65+(i%26));var p=[];for(var j=0;j<s.length;j+=10)p.push(s.slice(j,j+10));return p.join("-")}work();`,
		},
		{
			name: "object creation",
			code: `function work(){var r=[];for(var i=0;i<500;i++){var o={x:i,y:i*2,z:i*3};r.push(o.x+o.y+o.z)}return r.length}work();`,
		},
		{
			name: "closures + HOF",
			code: `function work(){function mk(n){return function(x){return x+n}}var a=[];for(var i=0;i<200;i++)a.push(mk(i));var s=0;for(var j=0;j<a.length;j++)s+=a[j](j);return s}work();`,
		},
		{
			name: "class + methods",
			code: `function work(){class P{constructor(x,y){this.x=x;this.y=y}d(o){var a=this.x-o.x,b=this.y-o.y;return Math.sqrt(a*a+b*b)}}var ps=[];for(var i=0;i<200;i++)ps.push(new P(i,i*2));var t=0;for(var j=1;j<ps.length;j++)t+=ps[j].d(ps[j-1]);return Math.round(t*100)/100}work();`,
		},
		{
			name: "nested loops",
			code: `function work(){var c=0;for(var i=0;i<100;i++)for(var j=0;j<100;j++){if((i+j)%3===0)c++;else if((i*j)%7===0)c+=2;else c--}return c}work();`,
		},
		{
			name: "switch dispatch",
			code: `function work(){var s=0;for(var i=0;i<2000;i++){switch(i%6){case 0:s+=i;break;case 1:s-=i/2;break;case 2:s+=i*3;break;case 3:s-=i;break;case 4:s+=1;break;default:s+=i%10;break}}return Math.round(s)}work();`,
		},
		{
			name: "try/catch",
			code: `function work(){var c=0;for(var i=0;i<500;i++){try{if(i%5===0)throw new Error("e");c+=i}catch(e){c++}}return c}work();`,
		},
	];

	const { Script } = await import("node:vm");
	const iterations = 80;

	function bench(code) {
		const script = new Script(code, { filename: "bench.js" });
		const run = () => script.runInThisContext();
		for (let i = 0; i < 15; i++) run(); // warm up
		const times = [];
		for (let i = 0; i < iterations; i++) {
			const s = performance.now();
			run();
			times.push(performance.now() - s);
		}
		times.sort((a, b) => a - b);
		const trim = Math.floor(times.length * 0.1);
		const mid = times.slice(trim, times.length - trim);
		return mid.reduce((s, t) => s + t, 0) / mid.length;
	}

	const results = [];
	for (const w of workloads) {
		const obf = obfuscateCode(w.code);
		const nativeMs = bench(w.code);
		const vmMs = bench(obf);
		const multiplier = vmMs / nativeMs;
		results.push({ name: w.name, nativeMs, vmMs, multiplier });
		console.log(
			`    ${w.name}: ${multiplier.toFixed(
				1
			)}x (native: ${nativeMs.toFixed(3)}ms, VM: ${vmMs.toFixed(3)}ms)`
		);
	}

	const totalNative = results.reduce((s, r) => s + r.nativeMs, 0);
	const weightedAvg = results.reduce(
		(s, r) => s + r.multiplier * (r.nativeMs / totalNative),
		0
	);
	const sorted = [...results].sort((a, b) => a.multiplier - b.multiplier);
	const median = sorted[Math.floor(sorted.length / 2)].multiplier;

	return {
		performance: {
			weightedAvg: +weightedAvg.toFixed(1),
			median: +median.toFixed(1),
			fastest: {
				name: sorted[0].name,
				multiplier: +sorted[0].multiplier.toFixed(1),
			},
			slowest: {
				name: sorted[sorted.length - 1].name,
				multiplier: +sorted[sorted.length - 1].multiplier.toFixed(1),
			},
			workloadCount: workloads.length,
			workloads: results.map((r) => ({
				name: r.name,
				multiplier: +r.multiplier.toFixed(1),
				nativeMs: +r.nativeMs.toFixed(3),
				vmMs: +r.vmMs.toFixed(3),
			})),
		},
		size: {
			sampleInputBytes: inputBytes,
			low: {
				bytes: lowBytes,
				ratio: +(lowBytes / inputBytes).toFixed(1),
			},
			medium: {
				bytes: medBytes,
				ratio: +(medBytes / inputBytes).toFixed(1),
			},
			high: {
				bytes: highBytes,
				ratio: +(highBytes / inputBytes).toFixed(1),
			},
		},
	};
}

// ─── Hero Snippet ────────────────────────────────────────────────────────────

async function generateHeroSnippet() {
	const distIndex = join(PKG_ROOT, "dist/index.js");
	if (!existsSync(distIndex)) return null;

	const { obfuscateCode } = await import(distIndex);

	const sampleCode = `function fibonacci(n) {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  return b;
}`;

	const output = obfuscateCode(sampleCode);
	const allLines = output.split("\n");
	const totalLines = allLines.length;

	// Skip "use strict" and blank lines at the top
	const contentStart = allLines.findIndex(
		(l) => l.trim() && l.trim() !== '"use strict";'
	);

	// First 5 interesting lines, truncate long ones
	const MAX_LEN = 55;
	const head = allLines.slice(contentStart, contentStart + 5).map((l) =>
		l.length > MAX_LEN ? l.slice(0, MAX_LEN - 3) + "..." : l
	);

	// Find the function replacement at the end
	const fnIdx = allLines.findIndex((l) => /function\s+fibonacci/.test(l));
	const tail = fnIdx >= 0
		? allLines.slice(fnIdx).filter((l) => l.trim())
		: allLines.slice(-3).filter((l) => l.trim());

	return { head, totalLines, tail };
}

// ─── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const runTests = args.includes("--test") || args.includes("--all");
const runBench = args.includes("--bench") || args.includes("--all");

console.log("Collecting stats...\n");

const prev = loadPrevStats();

// Static code metrics
const opcodes = collectOpcodeStats();
const source = collectSourceStats();
console.log(
	`  Opcodes:      ${opcodes.count} (${opcodes.categories} categories, ${opcodes.superinstructions} superinstructions, ${opcodes.compounds} compounds)`
);
console.log(
	`  Source:       ${source.files} files, ${fmtNum(source.lines)} lines`
);
console.log(
	`  Tests code:   ${source.testFiles} files, ${fmtNum(
		source.testLines
	)} lines`
);
console.log(
	`  Total:        ${source.totalFiles} files, ${fmtNum(
		source.totalLines
	)} lines`
);

// Test results
let tests = collectTestStats(runTests);
if (!tests && prev?.tests) {
	tests = prev.tests;
	console.log(
		`  Tests:        ${fmtNum(tests.passed)}/${fmtNum(
			tests.total
		)} passing (cached)`
	);
} else if (tests) {
	console.log(
		`  Tests:        ${fmtNum(tests.passed)}/${fmtNum(tests.total)} passing`
	);
} else {
	console.log(
		"  Tests:        no results (run with --test or `npm test` first)"
	);
}

// Benchmarks — always run when build is available, fall back to cached only if no build
let perfData = null;
let sizeData = null;
if (runBench || existsSync(join(PKG_ROOT, "dist/index.js"))) {
	if (runBench) console.log("\n  Running benchmarks...");
	const bench = await collectBenchmarks();
	if (bench) {
		perfData = bench.performance;
		sizeData = bench.size;
		console.log(`  Weighted avg overhead: ${perfData.weightedAvg}x`);
		console.log(`  Median overhead:      ${perfData.median}x`);
		console.log(
			`  Size (low preset):    ${sizeData.low.ratio}x (${fmtNum(
				sizeData.low.bytes
			)} bytes)`
		);
		console.log(
			`  Size (high preset):   ${sizeData.high.ratio}x (${fmtNum(
				sizeData.high.bytes
			)} bytes)`
		);
	}
} else {
	perfData = prev?.performance ?? null;
	sizeData = prev?.size ?? null;
	if (perfData)
		console.log(
			`  Performance:  ${perfData.weightedAvg}x weighted avg (cached — no build)`
		);
	if (sizeData)
		console.log(`  Size (low):   ${sizeData.low.ratio}x ratio (cached — no build)`);
}

// Hero snippet
let heroSnippet = null;
try {
	heroSnippet = await generateHeroSnippet();
	if (heroSnippet) {
		console.log(`  Hero snippet: ${fmtNum(heroSnippet.totalLines)} lines`);
	}
} catch (e) {
	console.error("  Hero snippet: failed -", e.message);
}
if (!heroSnippet && prev?.heroSnippet) {
	heroSnippet = prev.heroSnippet;
	console.log(
		`  Hero snippet: ${fmtNum(heroSnippet.totalLines)} lines (cached)`
	);
}

// ─── Build stats.json ────────────────────────────────────────────────────────

const stats = {
	version: JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"))
		.version,
	collectedAt: new Date().toISOString(),

	opcodes,
	source,
	tests,
	performance: perfData,
	size: sizeData,
	heroSnippet,

	// Pre-formatted display values for shields.io dynamic JSON badges.
	// Query with e.g. $.badges.tests — no suffix/formatting needed client-side.
	badges: {
		tests: tests ? fmtNum(tests.passed) : null,
		testsPassing: tests ? `${fmtNum(tests.passed)} passing` : null,
		opcodes: String(opcodes.count),
		categories: String(opcodes.categories),
		loc: fmtK(source.lines),
		totalLoc: fmtK(source.totalLines),
		overhead: perfData ? `~${perfData.weightedAvg}x` : null,
		overheadMedian: perfData ? `~${perfData.median}x` : null,
		sizeRatioLow: sizeData ? `${sizeData.low.ratio}x` : null,
		sizeRatioHigh: sizeData ? `${sizeData.high.ratio}x` : null,
	},
};

writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2) + "\n");
console.log(`\nWrote ${relative(REPO_ROOT, STATS_PATH)}`);
