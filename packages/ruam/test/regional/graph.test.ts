import { describe, it, expect } from "bun:test";
import { compileRegionalGraph } from "../../src/regional/graph.js";
import { runInNewContext } from "node:vm";

describe("regional frozen package ownership", () => {
	it("inventories and compiles every supplied contribution, including unused modules", () => {
		const build = compileRegionalGraph({entryPoints:["main.mjs"],files:{"main.mjs":'import { value } from "./dep.mjs"; export const answer = value + 1;',"dep.mjs":"export const value = 4;","unused.mjs":"export const spare = 9;"}});
		expect(Object.keys(build.files)).toEqual(["dep.mjs","main.mjs","unused.mjs"]);
		expect(build.sourceInventory).toHaveLength(3);
		expect(build.evidence.files).toHaveLength(3);
		expect(build.moduleOrder.indexOf("dep.mjs")).toBeLessThan(build.moduleOrder.indexOf("main.mjs"));
		expect(build.status).toBe("experimental-unqualified");
		expect(build.wholeSourceProtection).toBe(false);
		expect(build.crossModuleOptimization).toBe(false);
		expect(build.releaseApproved).toBe(false);
		expect(Object.isFrozen(build.files)).toBe(true);
	});
	it("rejects known CommonJS module loading aliases and entry globals", () => {
		for (const code of ['const r=require;r("./unowned.js");','globalThis["require"]("./unowned.js");','globalThis["re"+"quire"]("./unowned.js");','const {require:r}=globalThis;','module.exports=1;','exports.answer=1;']) expect(()=>compileRegionalGraph({entryPoints:["a.js"],files:{"a.js":code}})).toThrow("ADMISSION_FAILED");
	});
	it("preserves standalone script grammar and establishes module grammar from static edges", () => {
		const script=compileRegionalGraph({entryPoints:["a.js"],files:{"a.js":"function f(a,a){return this===undefined;} var result=f();"}});
		expect(script.sourceInventory[0]!.sourceType).toBe("script");
		expect(runInNewContext(script.files["a.js"]!+";result")).toBe(false);
		const graph=compileRegionalGraph({entryPoints:["main.mjs"],files:{"main.mjs":'import "./dep.js";',"dep.js":"var n=1;"}});
		expect(graph.sourceInventory.find(file=>file.path==="dep.js")!.sourceType).toBe("module");
		expect(graph.evidence.files.find(file=>file.path==="dep.js")!.sourceType).toBe("module");
		expect(()=>compileRegionalGraph({entryPoints:["main.mjs"],files:{"main.mjs":'import "./dep.js";',"dep.js":"function f(a,a){}"}})).toThrow("PARSE_FAILED");
	});
	it("inventories nonenumerable supplied files rather than silently skipping them", () => {
		const files=Object.defineProperty({"main.js":"var x=1;"},"hidden.js",{value:"var y=2;"});
		expect(compileRegionalGraph({entryPoints:["main.js"],files}).sourceInventory.map(file=>file.path)).toEqual(["hidden.js","main.js"]);
	});
	it("is deterministic despite record insertion order", () => {
		const a = {"a.mjs":"export const a=1;","b.mjs":'export {a} from "./a.mjs";'};
		const b = {"b.mjs":a["b.mjs"],"a.mjs":a["a.mjs"]};
		const first = compileRegionalGraph({entryPoints:["b.mjs"],files:a},{seed:123});
		const second = compileRegionalGraph({entryPoints:["b.mjs"],files:b},{seed:123});
		expect(first.files).toEqual(second.files);
		expect(first.cost).toEqual(second.cost);
		expect(first.evidence).toEqual(second.evidence);
	});
	for (const [label,files] of [
		["missing",{"a.mjs":'import "./missing.mjs";'}],
		["bare",{"a.mjs":'import "node:fs";'}],
		["cycle",{"a.mjs":'import "./b.mjs";',"b.mjs":'import "./a.mjs";'}],
		["dynamic",{"a.mjs":'export const p = import("./b.mjs");',"b.mjs":"export const b=1;"}],
		["case",{"a.mjs":"export const a=1;","A.mjs":"export const b=1;"}],
		["URL",{"a.mjs":'import "./b.mjs?x=1";',"b.mjs":"export const b=1;"}],
		["encoded path",{"a.mjs":'import "./%62.mjs";',"b.mjs":"export const b=1;"}],
		["outside root",{"a.mjs":'import "../b.mjs";',"b.mjs":"export const b=1;"}],
		["file directory collision",{"a.mjs":"export const a=1;","a.mjs/b.mjs":"export const b=1;"}],
	] as const) it(`rejects ${label} before a package is returned`, () => {
		expect(()=>compileRegionalGraph({entryPoints:["a.mjs"],files:files as Record<string,string>})).toThrow();
	});
	it("rejects ambiguous paths, non-JS files, duplicate entries and getter source records", () => {
		for (const path of ["../a.js","a/../b.js","/a.js","a\\b.js","a%20b.js","a.js.map","owner.json","CON.js","é.js"]) {
			expect(()=>compileRegionalGraph({entryPoints:[path],files:{[path]:"1;"}})).toThrow();
		}
		expect(()=>compileRegionalGraph({entryPoints:["a.js","a.js"],files:{"a.js":"1;"}})).toThrow("DUPLICATE_ENTRY");
		let called = false;
		const files = Object.defineProperty({},"a.js",{enumerable:true,get(){called=true;return "1;";}});
		expect(()=>compileRegionalGraph({entryPoints:["a.js"],files})).toThrow("INVALID_FILES");
		expect(called).toBe(false);
	});
	it("does not ignore an unsupported unused contribution", () => {
		expect(()=>compileRegionalGraph({entryPoints:["main.js"],files:{"main.js":"var n=1;","unused.js":'eval("1")'}})).toThrow("ADMISSION_FAILED");
	});
});
