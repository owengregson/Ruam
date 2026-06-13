/**
 * Regression tests — opcode mutation + complex control flow (FIXED).
 *
 * These shapes used to corrupt dispatch on a subset of build seeds. Two distinct
 * root causes were fixed:
 *  1. `opcodeMutation` placed MUTATE opcodes at positions reachable in non-linear
 *     order (forward-jump targets, jump-only successors), desyncing the runtime
 *     mutation state from the linear build-time encoding. Fixed in
 *     `compiler/opcode-mutation.ts` (`findUnsafeMutationIPs`).
 *  2. `blockPermutation` only remapped the catch IP (upper 16 bits) of `TRY_PUSH`,
 *     leaving the finally IP (lower 16 bits) pointing at a stale pre-permutation
 *     position. Fixed in `compiler/block-permutation.ts`.
 *
 * Per project policy these must pass across ALL seeds; SEEDS is set high enough to
 * catch a regression of either bug.
 *
 * @module test/stress/opcode-mutation-controlflow
 */

import { describe, it, expect } from "bun:test";
import { evalOriginal, evalObfuscated } from "../helpers.js";

const SEEDS = 16;

function checkAcrossSeeds(code: string, options: object): void {
	const expected = evalOriginal(code);
	for (let s = 0; s < SEEDS; s++) {
		expect(evalObfuscated(code, options)).toEqual(expected);
	}
}

describe("opcodeMutation + complex control flow (regression)", () => {
	it("switch with continue inside a loop", () => {
		checkAcrossSeeds(
			`function f(){var s=0;for(var i=0;i<300;i++){switch(i%7){case 0:s+=i;break;case 3:continue;case 4:s^=i;break;default:s+=1;}}return s;}f();`,
			{ rollingCipher: true, opcodeMutation: true }
		);
	});

	it("nested try with return-through-finally (preset max)", () => {
		checkAcrossSeeds(
			`function g(n){try{if(n<0)return "neg";try{if(n===0)throw new Error("zero");return "pos"+n;}finally{n=n+100;}}catch(e){return "caught:"+e.message;}finally{}}function f(){return [g(-1),g(0),g(5)];}f();`,
			{ preset: "max" }
		);
	});

	it("nested loops with break/continue (preset max)", () => {
		checkAcrossSeeds(
			`function f(){var c=0;for(var i=0;i<40;i++){for(var j=0;j<40;j++){if((i+j)%7===0)continue;if(i*j>900)break;c+=(i^j)&7;}}return c;}f();`,
			{ preset: "max" }
		);
	});
});
