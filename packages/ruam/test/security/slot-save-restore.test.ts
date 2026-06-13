/**
 * Per-unit hoisted-slot save/restore minimization.
 *
 * The sync interpreter snapshots/restores ~17 shared IIFE-scope "slot"
 * variables per `exec()` call (recursion safety). Two groups are saved only
 * when the unit uses them, gated on compile-time flags packed on `U`:
 *   • EXC {PE,HPE,CT,CV} — `U.xh` (compiler/slot-analysis EXC_OPCODES)
 *   • TC  {TV,NT,HO}     — `U.tc` (compiler/slot-analysis THIS_CTX_OPCODES)
 *
 * SAFETY INVARIANT (the part that, if violated, silently corrupts nested or
 * mutually-recursive calls): a slot may be skipped for a unit ONLY if that
 * unit can never read OR write it. This file VERIFIES that invariant against
 * the live handler registry by introspecting every handler's emitted AST —
 * so the opcode sets remain a correct superset as handlers evolve — and
 * exercises the recursion/exception/this paths end-to-end across presets
 * (including `max` + opcodeMutation, the combination that surfaced the
 * physical-vs-logical opcode bug during development).
 */

import { describe, it, expect } from "bun:test";
import { registry, makeHandlerCtx } from "../../src/ruamvm/handlers/index.js";
import { Op } from "../../src/compiler/opcodes.js";
import {
	EXC_OPCODES,
	THIS_CTX_OPCODES,
} from "../../src/compiler/slot-analysis.js";
import { assertEquivalent } from "../helpers.js";

// --- Handler-AST introspection -------------------------------------------

/** Runtime-name field -> logical slot label, for the gated slots. */
const SLOT_FIELDS: Record<string, string> = {
	pEx: "PE",
	hPEx: "HPE",
	cType: "CT",
	cVal: "CV",
	tVal: "TV",
	nTgt: "NT",
	ho: "HO",
};

/** Build a ctx whose every name/temp resolves to a `@@SLOT@@<field>` sentinel. */
function probeCtx() {
	const namesProxy = new Proxy(
		{},
		{ get: (_t, p) => "@@SLOT@@" + String(p) }
	) as never;
	const tempsProxy = new Proxy(
		{},
		{ get: (_t, p) => "@@SLOT@@" + String(p) }
	) as never;
	return makeHandlerCtx(namesProxy, tempsProxy, false, false, false);
}

/** Collect every slot-field referenced anywhere in an AST subtree. */
function collectSlotFields(node: unknown, out: Set<string>): void {
	if (node == null) return;
	if (Array.isArray(node)) {
		for (const c of node) collectSlotFields(c, out);
		return;
	}
	if (typeof node !== "object") return;
	for (const k of Object.keys(node as Record<string, unknown>)) {
		const v = (node as Record<string, unknown>)[k];
		if (typeof v === "string" && v.startsWith("@@SLOT@@")) {
			out.add(v.slice("@@SLOT@@".length));
		} else if (v && typeof v === "object") {
			collectSlotFields(v, out);
		}
	}
}

/** opcode -> set of gated slot labels its handler references. */
function slotUsageByOpcode(): Map<number, Set<string>> {
	const ctx = probeCtx();
	const out = new Map<number, Set<string>>();
	for (const [op, fn] of registry.entries()) {
		const ids = new Set<string>();
		collectSlotFields(fn(ctx), ids);
		const labels = new Set<string>();
		for (const [field, label] of Object.entries(SLOT_FIELDS)) {
			if (ids.has(field)) labels.add(label);
		}
		out.set(op, labels);
	}
	return out;
}

const opName = (() => {
	const m = new Map<number, string>();
	for (const [k, v] of Object.entries(Op)) {
		if (typeof v === "number") m.set(v, k);
	}
	return m;
})();

describe("slot-analysis op-set completeness (handler-AST introspection)", () => {
	const usage = slotUsageByOpcode();

	it("EXC slots (PE/HPE/CT/CV) are only referenced by EXC_OPCODES (+RETURN/RETURN_VOID)", () => {
		// RETURN/RETURN_VOID write CT/CV ONLY inside the `if(_h._fi>=0)` unwind
		// branch, reachable only when EX holds a finally frame — which requires
		// a TRY_PUSH (∈ EXC_OPCODES). So a unit without EXC_OPCODES has empty EX
		// and never writes CT/CV via RETURN. They are the only permitted extra.
		const allowed = new Set<Op>([
			...EXC_OPCODES,
			Op.RETURN,
			Op.RETURN_VOID,
		]);
		const offenders: string[] = [];
		for (const [op, labels] of usage) {
			const touchesExc = ["PE", "HPE", "CT", "CV"].some((l) =>
				labels.has(l)
			);
			if (touchesExc && !allowed.has(op as Op)) {
				offenders.push(opName.get(op) ?? String(op));
			}
		}
		expect(offenders).toEqual([]);
	});

	it("TC slots (TV/NT/HO) are only referenced by THIS_CTX_OPCODES", () => {
		const offenders: string[] = [];
		for (const [op, labels] of usage) {
			const touchesTc = ["TV", "NT", "HO"].some((l) => labels.has(l));
			if (touchesTc && !THIS_CTX_OPCODES.has(op as Op)) {
				offenders.push(opName.get(op) ?? String(op));
			}
		}
		expect(offenders).toEqual([]);
	});

	it("every EXC_OPCODES / THIS_CTX_OPCODES entry is a real registered opcode", () => {
		for (const op of EXC_OPCODES) expect(registry.has(op)).toBe(true);
		for (const op of THIS_CTX_OPCODES) expect(registry.has(op)).toBe(true);
	});
});

// --- End-to-end recursion / exception / this correctness ------------------

const PRESETS = [
	{ label: "default", opts: {} },
	{ label: "medium", opts: { preset: "medium" as const } },
	{ label: "max", opts: { preset: "max" as const } },
	{ label: "opcodeMutation", opts: { opcodeMutation: true } },
];

const PROGRAMS: Record<string, string> = {
	"deep recursion": `function s(n){return n<=0?0:n+s(n-1);}s(300);`,
	"mutual recursion": `function ev(n){return n===0?true:od(n-1);}function od(n){return n===0?false:ev(n-1);}[ev(31),od(31),ev(20)];`,
	"throw caught across call": `function g(n){if(n===0)throw "boom"+n;return g(n-1);}function h(){try{g(6);}catch(e){return "c:"+e;}}h();`,
	"throw Error across deep call": `function a(n){if(n===0)throw new Error("E");return a(n-1);}function b(){try{a(9);return "no";}catch(e){return e.message;}}b();`,
	"recursion through try/finally": `function f(n,log){if(n<=0)return;try{if(n===2)throw n;}catch(e){log.push("c"+e);}finally{log.push("f"+n);}f(n-1,log);}function run(){var l=[];f(3,l);return l;}run();`,
	"nested finally with return": `function f(){try{try{return 2;}finally{}}finally{}}function g(){var x=0;try{x=1;return x;}finally{x=99;}}[f(),g()];`,
	"this through recursion": `class C{constructor(v){this.v=v;}rec(n){if(n<=0)return this.v;return this.rec(n-1)+1;}}new C(7).rec(8);`,
	"super through recursion": `class A{f(n){return n;}}class B extends A{f(n){if(n<=0)return 0;return super.f(n)+this.f(n-1);}}new B().f(6);`,
	"closures capturing loop var": `function mk(){var fns=[];for(let i=0;i<6;i++){fns.push(function(){return i*i;});}return fns.map(f=>f());}mk();`,
	"recursion mutating outer var": `function f(){var sum=0;function add(n){if(n>0){sum+=n;add(n-1);}}add(12);return sum;}f();`,
	"this after nested call": `var o={v:9,helper(){return this.v+1;},run(){var a=this.helper();var b=this.v;return a+b;}};o.run();`,
	"exception across several levels": `function f(n){if(n===0)throw {code:42};return f(n-1);}function g(){try{f(7);}catch(e){return e.code;}}g();`,
};

for (const { label, opts } of PRESETS) {
	describe(`recursion/exception/this equivalence [${label}]`, () => {
		for (const [name, src] of Object.entries(PROGRAMS)) {
			it(name, () => {
				assertEquivalent(src, opts);
			});
		}
	});
}
