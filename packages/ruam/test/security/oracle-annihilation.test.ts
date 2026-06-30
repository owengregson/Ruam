import { describe, it, expect } from "bun:test";
import { assertEquivalent } from "../helpers.js";

// W1 — internal-oracle annihilation (dispatch hole-tolerance).
//
// The slow-path handler resolution now uses `_ht[PH] | 0`, mapping an
// out-of-range/hole index (only reachable under a WRONG decryption key) to
// handler 0 instead of throwing an "undefined opcode" error. `| 0` is identity
// on every valid handler index, so legitimate execution must be byte-for-byte
// unchanged. These tests exercise the SLOW path (decode cache gated off by
// opcodeMutation / observationResistance / incrementalCipher / max preset)
// across many seeds to lock that invariant.

const PROGRAMS: { name: string; src: string }[] = [
	{
		name: "arithmetic loop",
		src: "function f(n){var s=0;for(var i=0;i<n;i++){s+=i*i-(i%3);}return s}\nf(25)",
	},
	{
		name: "recursion",
		src: "function fib(n){return n<2?n:fib(n-1)+fib(n-2)}\nfib(15)",
	},
	{
		name: "try/catch + objects",
		src: "function g(){var o={a:1,b:2};try{o.c=o.a+o.b;if(o.c>2)throw new Error('x');}catch(e){o.c=-1;}return o.c}\ng()",
	},
	{
		name: "closures + arrays",
		src: "function h(){var a=[1,2,3,4,5];return a.map(function(x){return x*2}).reduce(function(p,c){return p+c},0)}\nh()",
	},
];

describe("oracle annihilation — slow-path dispatch correctness", () => {
	const slowPathConfigs: { name: string; opts: Record<string, unknown> }[] = [
		{ name: "max preset", opts: { preset: "max" } },
		{
			name: "opcodeMutation",
			opts: { rollingCipher: true, opcodeMutation: true },
		},
		{
			name: "observationResistance",
			opts: { observationResistance: true },
		},
		{
			name: "incrementalCipher",
			opts: { rollingCipher: true, incrementalCipher: true },
		},
	];

	for (const cfg of slowPathConfigs) {
		for (const prog of PROGRAMS) {
			it(`${cfg.name}: ${prog.name} round-trips across seeds`, () => {
				for (let iter = 0; iter < 12; iter++) {
					assertEquivalent(prog.src, {
						targetMode: "root",
						preprocessIdentifiers: false,
						...cfg.opts,
					});
				}
			});
		}
	}
});
