import { describe, it, expect } from "bun:test";
import { compileRegionalGraph } from "../../src/regional/graph.js";
import { resolveRegionalGraphOptions, planRegionalCost } from "../../src/regional/cost.js";
import { inventoryRegionalFile } from "../../src/regional/validation.js";

describe("regional deterministic resource planning", () => {
	for (const key of ["maxFiles","maxNodes","maxInputBytes","maxOutputBytes"] as const) {
		it(`validates ${key} rather than silently defaulting`, () => {
			for (const value of [0,-1,1.1,NaN,Infinity,null,"5"]) expect(()=>resolveRegionalGraphOptions({[key]:value} as any)).toThrow("INVALID_LIMIT");
		});
	}
	it("rejects invalid seed, ratio and flags", () => {
		for (const seed of [-1,1.2,NaN,0x100000000,null]) expect(()=>resolveRegionalGraphOptions({seed} as any)).toThrow();
		for (const maxExpansionRatio of [0,NaN,Infinity,null,1001]) expect(()=>resolveRegionalGraphOptions({maxExpansionRatio} as any)).toThrow();
		expect(()=>resolveRegionalGraphOptions({fusion:"true"} as any)).toThrow();
	});
	it("rejects limits beyond compiler ceilings at option admission", () => {
		for (const options of [{maxNodes:1_000_001},{maxInputBytes:8*1024*1024+1},{maxOutputBytes:64*1024*1024+1}]) expect(()=>resolveRegionalGraphOptions(options)).toThrow("INVALID_LIMIT");
	});
	it("applies aggregate caps over multiple files", () => {
		const input = {entryPoints:["a.js"],files:{"a.js":"const a=1;","b.js":"const b=2;"}};
		expect(()=>compileRegionalGraph(input,{maxFiles:1})).toThrow("RESOURCE_LIMIT");
		expect(()=>compileRegionalGraph(input,{maxInputBytes:15})).toThrow("RESOURCE_LIMIT");
		expect(()=>compileRegionalGraph(input,{maxNodes:5})).toThrow("RESOURCE_LIMIT");
		expect(()=>compileRegionalGraph(input,{maxOutputBytes:1})).toThrow();
		const build=compileRegionalGraph(input);
		expect(build.cost.inputBytes).toBe(20);
		expect(build.cost.runtimePerformance).toBe("not-measured");
		expect(build.cost.buildTiming).toBe("not-measured");
	});
	it("applies expansion and output-node caps independently", () => {
		const input = inventoryRegionalFile("a.js","1;");
		const output = {...input,bytes:70_000};
		expect(()=>planRegionalCost([input],[output],resolveRegionalGraphOptions({maxExpansionRatio:1}))).toThrow("output expansion");
		expect(()=>planRegionalCost([input],[{...input,nodes:100}],resolveRegionalGraphOptions({maxNodes:10}))).toThrow("output nodes");
	});
});
