/**
 * Comprehensive VM overhead benchmark harness.
 *
 * Measures obfuscated-vs-native execution overhead across presets, and
 * isolates one-time runtime bootstrap cost from steady-state execution so
 * per-instruction dispatch/crypto improvements are visible.
 *
 * Usage:
 *   bun scripts/bench.mjs                 # full table across presets
 *   bun scripts/bench.mjs --preset medium # single preset
 *   bun scripts/bench.mjs --profile       # heavy single workload for CPU profiling
 *   bun scripts/bench.mjs --quick         # fewer iterations
 */

import { obfuscateCode } from "../src/index.ts";
import vmMod from "node:vm";

const { Script } = vmMod;

// --- Timing ---------------------------------------------------------------

function median(times) {
	times.sort((a, b) => a - b);
	const trim = Math.floor(times.length * 0.1);
	const mid = times.slice(trim, times.length - trim);
	return mid.reduce((s, t) => s + t, 0) / mid.length;
}

function timeThunk(thunk, iters, warm = 20) {
	for (let i = 0; i < Math.min(iters, warm); i++) thunk();
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

// --- Workloads (heavier than the test suite so steady-state dominates) ----

const WORKLOADS = [
	{
		name: "arith-loop-200k",
		code: `function work(){var s=0;for(var i=0;i<200000;i++){s+=i*3-(i%7);}return s;}work();`,
	},
	{
		name: "fib-28",
		code: `function fib(n){if(n<=1)return n;return fib(n-1)+fib(n-2);}fib(28);`,
	},
	{
		name: "nested-loops-300",
		code: `function work(){var c=0;for(var i=0;i<300;i++){for(var j=0;j<300;j++){if((i+j)%3===0)c++;else if((i*j)%7===0)c+=2;else c--;}}return c;}work();`,
	},
	{
		name: "switch-dispatch-50k",
		code: `function work(){var s=0;for(var i=0;i<50000;i++){switch(i%6){case 0:s+=i;break;case 1:s-=i/2;break;case 2:s+=i*3;break;case 3:s-=i;break;case 4:s+=1;break;default:s+=i%10;break;}}return Math.round(s);}work();`,
	},
	{
		name: "string-build-5k",
		code: `function work(){var s="";for(var i=0;i<5000;i++){s+=String.fromCharCode(65+(i%26));}var p=[];for(var j=0;j<s.length;j+=10){p.push(s.slice(j,j+10));}return p.join("-").length;}work();`,
	},
	{
		name: "object-prop-20k",
		code: `function work(){var r=0;for(var i=0;i<20000;i++){var o={x:i,y:i*2,z:i*3};r+=o.x+o.y+o.z;}return r;}work();`,
	},
	{
		name: "array-ops-3k",
		code: `function work(){var a=[];for(var i=0;i<3000;i++)a.push((i*17)%100);a.sort(function(x,y){return x-y;});var m=a.map(function(x){return x*2+1;});return m.reduce(function(s,x){return s+x;},0);}work();`,
	},
	{
		name: "class-methods-2k",
		code: `function work(){class P{constructor(x,y){this.x=x;this.y=y;}d(o){var dx=this.x-o.x,dy=this.y-o.y;return Math.sqrt(dx*dx+dy*dy);}}var ps=[];for(var i=0;i<2000;i++)ps.push(new P(i,i*2));var t=0;for(var j=1;j<ps.length;j++)t+=ps[j].d(ps[j-1]);return Math.round(t);}work();`,
	},
];

const BOOTSTRAP_CODE = `function work(){return 0;}work();`;

// --- Presets to test ------------------------------------------------------

const PRESET_CONFIGS = {
	default: {},
	low: { preset: "low" },
	medium: { preset: "medium" },
	max: { preset: "max" },
};

// --- Runner ---------------------------------------------------------------

function fmt(n, w = 8) {
	return String(n).padStart(w);
}

function runPreset(presetName, opts, iters) {
	// Bootstrap cost for this preset (trivial fn — isolates runtime-build cost)
	const bootCode = obfuscateCode(BOOTSTRAP_CODE, opts);
	const bootMs = timeThunk(makeThunk(bootCode), Math.max(iters, 60));

	const rows = [];
	for (const wl of WORKLOADS) {
		const obf = obfuscateCode(wl.code, opts);
		const nativeThunk = makeThunk(wl.code);
		const vmThunk = makeThunk(obf);

		// correctness check
		const nr = JSON.stringify(nativeThunk());
		const vr = JSON.stringify(vmThunk());
		const ok = nr === vr;

		const nativeMs = timeThunk(nativeThunk, iters);
		const vmMs = timeThunk(vmThunk, iters);
		const execMs = Math.max(vmMs - bootMs, 0.0001);
		rows.push({
			name: wl.name,
			ok,
			nativeMs,
			vmMs,
			execMs,
			ovTotal: vmMs / nativeMs,
			ovExec: execMs / nativeMs,
			sizeKB: (obf.length / 1024),
		});
	}
	return { presetName, bootMs, rows };
}

function printResult(res) {
	console.log(
		`\n=== preset: ${res.presetName}  (bootstrap ${res.bootMs.toFixed(3)}ms) ===`
	);
	console.log(
		"  workload            ok   native(ms)   vm(ms)   exec(ms)   ov_total   ov_exec   size(KB)"
	);
	let sumExec = 0,
		sumNative = 0,
		worstExec = 0,
		worstName = "";
	for (const r of res.rows) {
		console.log(
			`  ${r.name.padEnd(18)} ${r.ok ? "ok" : "XX"}  ${fmt(
				r.nativeMs.toFixed(4),
				10
			)} ${fmt(r.vmMs.toFixed(3), 8)} ${fmt(r.execMs.toFixed(3), 9)}  ${fmt(
				r.ovTotal.toFixed(1) + "x",
				8
			)}  ${fmt(r.ovExec.toFixed(1) + "x", 7)}  ${fmt(r.sizeKB.toFixed(1), 7)}`
		);
		sumExec += r.execMs;
		sumNative += r.nativeMs;
		if (r.ovExec > worstExec) {
			worstExec = r.ovExec;
			worstName = r.name;
		}
	}
	const aggExec = sumExec / sumNative;
	console.log(
		`  --> aggregate exec overhead: ${aggExec.toFixed(
			1
		)}x   worst: ${worstExec.toFixed(1)}x (${worstName})`
	);
	return { presetName: res.presetName, aggExec, worstExec };
}

// --- Profile mode ---------------------------------------------------------

function profileMode() {
	// Heavy single workload, run many times in-process. Launch node with
	// --cpu-prof externally; here we just spin so the profiler captures exec.
	const code = WORKLOADS[0].code; // arith-loop-200k
	const obf = obfuscateCode(code, { preset: "medium" });
	const thunk = makeThunk(obf);
	const N = Number(process.env.PROF_N || 400);
	console.error(`[profile] running arith-loop-200k x${N} at medium...`);
	const t0 = performance.now();
	for (let i = 0; i < N; i++) thunk();
	console.error(`[profile] done in ${(performance.now() - t0).toFixed(0)}ms`);
}

// --- Main -----------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes("--profile")) {
	profileMode();
} else {
	const quick = args.includes("--quick");
	const iters = quick ? 30 : 100;
	const onePreset = args.includes("--preset")
		? args[args.indexOf("--preset") + 1]
		: null;
	const presets = onePreset
		? { [onePreset]: PRESET_CONFIGS[onePreset] }
		: PRESET_CONFIGS;

	const summary = [];
	for (const [name, opts] of Object.entries(presets)) {
		const res = runPreset(name, opts, iters);
		summary.push(printResult(res));
	}
	console.log("\n=== SUMMARY (exec-isolated overhead) ===");
	for (const s of summary) {
		console.log(
			`  ${s.presetName.padEnd(8)} aggregate ${s.aggExec
				.toFixed(1)
				.padStart(6)}x   worst ${s.worstExec.toFixed(1).padStart(6)}x`
		);
	}
}
