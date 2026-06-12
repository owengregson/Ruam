/**
 * Max-preset feature-attribution harness.
 *
 * Starts from the full `max` option set and toggles each runtime-relevant
 * feature OFF one at a time (and a few in combination), measuring the
 * aggregate exec-isolated overhead. The delta vs `max` is that feature's
 * runtime cost contribution *in the context of the full stack* — i.e. what
 * removing it would actually save (Amdahl-correct prioritization).
 *
 * Key combination configs:
 *   - "cache-trio-off": removes {opcodeMutation, incrementalCipher,
 *     observationResistance} → re-enables the Phase-1 decode cache.
 *   - "+no-proxy": also removes stackEncoding (the Proxy stack).
 *   - "+no-mba": also removes mixedBooleanArithmetic.
 *
 * Usage:
 *   bun scripts/bench-attribution.mjs            # default iters
 *   bun scripts/bench-attribution.mjs --iters 16
 *   bun scripts/bench-attribution.mjs --full     # heavier workloads
 */

import { obfuscateCode } from "../src/index.ts";
import { PRESETS } from "../src/presets.ts";
import vmMod from "node:vm";

const { Script } = vmMod;

// --- Timing ---------------------------------------------------------------

function median(times) {
	times.sort((a, b) => a - b);
	const trim = Math.floor(times.length * 0.1);
	const mid = times.slice(trim, times.length - trim);
	return mid.reduce((s, t) => s + t, 0) / mid.length;
}

function timeThunk(thunk, iters, warm) {
	for (let i = 0; i < warm; i++) thunk();
	const times = [];
	for (let i = 0; i < iters; i++) {
		const t0 = performance.now();
		thunk();
		times.push(performance.now() - t0);
	}
	return median(times);
}

function makeThunk(code) {
	const script = new Script(code, { filename: "bench.js" });
	return () => script.runInThisContext();
}

// --- Workloads ------------------------------------------------------------
// Moderate sizes so `max` (~1400x) stays fast enough for many configs.

const args = process.argv.slice(2);
const FULL = args.includes("--full");
const ITERS = args.includes("--iters")
	? Number(args[args.indexOf("--iters") + 1])
	: 12;
const WARM = 3;

const WORKLOADS = FULL
	? [
			{ name: "arith-loop-100k", code: `function work(){var s=0;for(var i=0;i<100000;i++){s+=i*3-(i%7);}return s;}work();` },
			{ name: "fib-26", code: `function fib(n){if(n<=1)return n;return fib(n-1)+fib(n-2);}fib(26);` },
			{ name: "switch-dispatch-30k", code: `function work(){var s=0;for(var i=0;i<30000;i++){switch(i%6){case 0:s+=i;break;case 1:s-=i/2;break;case 2:s+=i*3;break;case 3:s-=i;break;case 4:s+=1;break;default:s+=i%10;break;}}return Math.round(s);}work();` },
			{ name: "object-prop-15k", code: `function work(){var r=0;for(var i=0;i<15000;i++){var o={x:i,y:i*2,z:i*3};r+=o.x+o.y+o.z;}return r;}work();` },
	  ]
	: [
			{ name: "arith-loop-40k", code: `function work(){var s=0;for(var i=0;i<40000;i++){s+=i*3-(i%7);}return s;}work();` },
			{ name: "fib-23", code: `function fib(n){if(n<=1)return n;return fib(n-1)+fib(n-2);}fib(23);` },
			{ name: "switch-dispatch-15k", code: `function work(){var s=0;for(var i=0;i<15000;i++){switch(i%6){case 0:s+=i;break;case 1:s-=i/2;break;case 2:s+=i*3;break;case 3:s-=i;break;case 4:s+=1;break;default:s+=i%10;break;}}return Math.round(s);}work();` },
			{ name: "object-prop-8k", code: `function work(){var r=0;for(var i=0;i<8000;i++){var o={x:i,y:i*2,z:i*3};r+=o.x+o.y+o.z;}return r;}work();` },
	  ];

const BOOTSTRAP_CODE = `function work(){return 0;}work();`;

// --- Config matrix --------------------------------------------------------

const MAX = { preset: "max" };
function maxMinus(...flags) {
	const o = { preset: "max" };
	for (const f of flags) o[f] = false;
	return o;
}

const CONFIGS = [
	{ label: "default", opts: {} },
	{ label: "medium", opts: { preset: "medium" } },
	{ label: "MAX (baseline)", opts: MAX },
	// single-feature removals
	{ label: "−stackEncoding", opts: maxMinus("stackEncoding") },
	{ label: "−mixedBooleanArithmetic", opts: maxMinus("mixedBooleanArithmetic") },
	{ label: "−observationResistance", opts: maxMinus("observationResistance") },
	{ label: "−opcodeMutation", opts: maxMinus("opcodeMutation") },
	{ label: "−incrementalCipher", opts: maxMinus("incrementalCipher") },
	{ label: "−semanticOpacity", opts: maxMinus("semanticOpacity") },
	{ label: "−vmShielding", opts: maxMinus("vmShielding") },
	{ label: "−deadCodeInjection", opts: maxMinus("deadCodeInjection") },
	{ label: "−debugProtection", opts: maxMinus("debugProtection") },
	{ label: "−blockPermutation (sanity ~0)", opts: maxMinus("blockPermutation") },
	{ label: "−integrityBinding", opts: maxMinus("integrityBinding") },
	// combination removals — the decode-cache story
	{
		label: "−cache-trio (mut+inc+obs)  [CACHE ON]",
		opts: maxMinus("opcodeMutation", "incrementalCipher", "observationResistance"),
	},
	{
		label: "−cache-trio −stackEncoding  [CACHE ON]",
		opts: maxMinus("opcodeMutation", "incrementalCipher", "observationResistance", "stackEncoding"),
	},
	{
		label: "−cache-trio −proxy −MBA  [CACHE ON]",
		opts: maxMinus("opcodeMutation", "incrementalCipher", "observationResistance", "stackEncoding", "mixedBooleanArithmetic"),
	},
	{
		label: "−cache-trio −proxy −MBA −semOpacity",
		opts: maxMinus("opcodeMutation", "incrementalCipher", "observationResistance", "stackEncoding", "mixedBooleanArithmetic", "semanticOpacity"),
	},
];

// --- Measure one config ---------------------------------------------------

function measure(opts) {
	const bootCode = obfuscateCode(BOOTSTRAP_CODE, opts);
	const bootMs = timeThunk(makeThunk(bootCode), Math.max(ITERS, 30), WARM);

	let sumExec = 0, sumNative = 0, allOk = true, worst = 0, worstName = "";
	const perWl = [];
	for (const wl of WORKLOADS) {
		const obf = obfuscateCode(wl.code, opts);
		const nativeThunk = makeThunk(wl.code);
		const vmThunk = makeThunk(obf);
		const ok = JSON.stringify(nativeThunk()) === JSON.stringify(vmThunk());
		if (!ok) allOk = false;
		const nativeMs = timeThunk(nativeThunk, ITERS, WARM);
		const vmMs = timeThunk(vmThunk, ITERS, WARM);
		const execMs = Math.max(vmMs - bootMs, 0.0001);
		sumExec += execMs;
		sumNative += nativeMs;
		const ov = execMs / nativeMs;
		perWl.push({ name: wl.name, ov });
		if (ov > worst) { worst = ov; worstName = wl.name; }
	}
	return { aggExec: sumExec / sumNative, allOk, worst, worstName, perWl, bootMs };
}

// --- Run ------------------------------------------------------------------

console.log(`attribution harness  iters=${ITERS} warm=${WARM} full=${FULL}`);
console.log(`workloads: ${WORKLOADS.map((w) => w.name).join(", ")}\n`);

const results = [];
for (const cfg of CONFIGS) {
	process.stdout.write(`  measuring ${cfg.label.padEnd(40)} ... `);
	const r = measure(cfg.opts);
	results.push({ label: cfg.label, ...r });
	console.log(
		`agg ${r.aggExec.toFixed(1).padStart(7)}x  worst ${r.worst
			.toFixed(0)
			.padStart(5)}x (${r.worstName})  ${r.allOk ? "ok" : "*** MISMATCH ***"}`
	);
}

// --- Attribution table ----------------------------------------------------

const max = results.find((r) => r.label.startsWith("MAX"));
console.log(`\n=== Attribution vs MAX (${max.aggExec.toFixed(1)}x aggregate) ===`);
console.log(`  ${"config".padEnd(42)} ${"agg".padStart(9)}  ${"Δ vs max".padStart(10)}  ${"% of max".padStart(9)}`);
for (const r of results) {
	const delta = r.aggExec - max.aggExec;
	const pct = (r.aggExec / max.aggExec) * 100;
	const sign = delta > 0 ? "+" : "";
	console.log(
		`  ${r.label.padEnd(42)} ${r.aggExec.toFixed(1).padStart(8)}x  ${(sign + delta.toFixed(1)).padStart(9)}x  ${pct.toFixed(0).padStart(8)}%`
	);
}

console.log(`\n=== Per-feature cost (max − feature; more negative Δ = costlier feature) ===`);
const singles = results.filter((r) => r.label.startsWith("−") && !r.label.includes("cache-trio"));
singles.sort((a, b) => a.aggExec - b.aggExec);
for (const r of singles) {
	const saved = max.aggExec - r.aggExec;
	const savedPct = (saved / max.aggExec) * 100;
	console.log(
		`  ${r.label.padEnd(42)} saves ${saved.toFixed(1).padStart(7)}x  (${savedPct.toFixed(0).padStart(3)}% of max overhead)`
	);
}
