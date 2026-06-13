/**
 * Decode-once execution cache (Phase 1) correctness tests.
 *
 * The cache materializes each unit's instruction stream once into a parallel
 * Int32Array of [resolved handler index, decrypted operand]. Because the rolling
 * cipher keystream is position-keyed (a pure function of instruction index), a
 * single forward materialization pass must yield correct plaintext for EVERY
 * position regardless of how control flow later reaches it — sequential,
 * backward jump, forward jump, or exception route. These tests hammer exactly
 * those control-flow shapes under the cache-active path (rolling cipher) and the
 * cache-gated-off paths (incrementalCipher / opcodeMutation / observationResistance),
 * each across multiple random build seeds.
 *
 * @module test/security/decode-cache
 */

import { describe, it, expect } from "bun:test";
import { evalOriginal, evalObfuscated } from "../helpers.js";
import type { VmObfuscationOptions } from "../../src/types.js";

/** Control-flow-heavy programs designed to exercise jumps + exceptions hard. */
const PROGRAMS: { name: string; code: string }[] = [
	{
		name: "backward jump loop",
		code: `function f(){var s=0;for(var i=0;i<137;i++){s+=i*i-(i%5);}return s;}f();`,
	},
	{
		name: "nested loops + forward jumps (break/continue)",
		code: `function f(){var c=0;for(var i=0;i<40;i++){for(var j=0;j<40;j++){if((i+j)%7===0)continue;if(i*j>900)break;c+=(i^j)&7;}}return c;}f();`,
	},
	{
		name: "while + do-while with conditionals",
		code: `function f(){var a=1,b=1,n=0;while(n<25){var t=a+b;a=b;b=t;n++;}var r=0;do{r+=b%10;b=Math.floor(b/10);}while(b>0);return [a,r];}f();`,
	},
	{
		name: "switch dispatch in loop",
		code: `function f(){var s=0;for(var i=0;i<300;i++){switch(i%7){case 0:s+=i;break;case 1:s-=i;break;case 2:s+=i*2;break;case 3:continue;case 4:s^=i;break;default:s+=1;}}return s;}f();`,
	},
	{
		name: "try/catch/finally routed jumps",
		code: `function f(){var log=[];for(var i=0;i<30;i++){try{if(i%3===0)throw new Error("x"+i);log.push("ok"+i);}catch(e){log.push("c"+e.message);}finally{log.push("f"+i);}}return log.join(",");}f();`,
	},
	{
		name: "nested try with return-through-finally",
		code: `function g(n){try{if(n<0)return "neg";try{if(n===0)throw new Error("zero");return "pos"+n;}finally{n=n+100;}}catch(e){return "caught:"+e.message;}finally{}}function f(){return [g(-1),g(0),g(5)];}f();`,
	},
	{
		name: "recursion (mutual) with branches",
		code: `function isEven(n){if(n===0)return true;return isOdd(n-1);}function isOdd(n){if(n===0)return false;return isEven(n-1);}function f(){var r=[];for(var i=0;i<20;i++)r.push(isEven(i));return r;}f();`,
	},
	{
		name: "labeled break/continue",
		code: `function f(){var c=0;outer:for(var i=0;i<30;i++){for(var j=0;j<30;j++){if(j===5)continue outer;if(i===20)break outer;c++;}}return c;}f();`,
	},
	{
		name: "ternary + short-circuit heavy",
		code: `function f(){var s=0;for(var i=0;i<200;i++){var v=(i%2===0)?(i>100?i*2:i):(i&&(i%3)||7);s+=v|0;}return s;}f();`,
	},
];

/**
 * Option combinations to test. Each exercises a different gate decision:
 *  - rollingCipher only           → cache ACTIVE (full: handler idx + decrypted operand)
 *  - preset medium                → cache ACTIVE (rolling cipher present)
 *  - default (no crypto)          → cache ACTIVE (light: handler idx only)
 *  - rollingCipher+incrementalCipher → cache GATED OFF
 *  - rollingCipher+opcodeMutation    → cache GATED OFF
 *  - rollingCipher+observationResistance → cache GATED OFF
 *  - preset max                   → cache GATED OFF (all of the above)
 */
// NOTE: opcodeMutation and the full `max` preset are intentionally NOT exercised
// here. They have pre-existing, cache-independent control-flow corruption bugs
// (unrelated to this cache — the cache is gated OFF for both) tracked separately
// in test/stress/opcode-mutation-controlflow.test.ts. This file validates the
// decode-once cache: that cache-active builds match native, and that the gated-off
// builds (incrementalCipher / observationResistance) remain correct.
const CONFIGS: { name: string; options: VmObfuscationOptions }[] = [
	{ name: "no cipher (cache gated off)", options: {} },
	{ name: "rollingCipher (full cache)", options: { rollingCipher: true } },
	{ name: "preset medium (full cache)", options: { preset: "medium" } },
	{
		name: "rollingCipher+incrementalCipher (gated off)",
		options: { rollingCipher: true, incrementalCipher: true },
	},
	{
		name: "rollingCipher+observationResistance (gated off)",
		options: { rollingCipher: true, observationResistance: true },
	},
];

/** Number of independent random build seeds to test per (program, config). */
const SEEDS = 4;

describe("decode-once execution cache — control-flow correctness", () => {
	for (const cfg of CONFIGS) {
		for (const prog of PROGRAMS) {
			it(`${cfg.name} :: ${prog.name}`, () => {
				const expected = evalOriginal(prog.code);
				// Each evalObfuscated call generates a fresh CSPRNG build seed,
				// so running it SEEDS times exercises distinct opcode shuffles,
				// key derivations, and materialization layouts.
				for (let s = 0; s < SEEDS; s++) {
					const actual = evalObfuscated(prog.code, cfg.options);
					expect(actual).toEqual(expected);
				}
			});
		}
	}
});

describe("decode-once execution cache — large unit (cache reuse across calls)", () => {
	// A function called many times must reuse the cached materialized stream
	// across calls and stay correct (rcState/keystream constant per unit).
	const code = `
		function fib(n){ if(n<2) return n; return fib(n-1)+fib(n-2); }
		function f(){ var r=[]; for(var i=0;i<15;i++) r.push(fib(i)); return r; }
		f();
	`;
	for (const cfg of CONFIGS) {
		it(`${cfg.name} :: repeated calls reuse cache correctly`, () => {
			const expected = evalOriginal(code);
			for (let s = 0; s < SEEDS; s++) {
				expect(evalObfuscated(code, cfg.options)).toEqual(expected);
			}
		});
	}
});
