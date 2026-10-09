import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, readdir, readFile, writeFile, mkdir, rm, realpath, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compileRegionalGraph } from "../../src/regional/graph.js";
import { publishRegionalPackage } from "../../src/regional/publication.js";

const roots:string[]=[];
async function temp() { const path=await realpath(await mkdtemp(join(tmpdir(),"ruam-regional-test-"))); roots.push(path);return path; }
afterEach(async()=>{await Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true})));});

describe("regional complete-package publication", () => {
	it("writes only generated JS and preserves native ESM order/live bindings", async () => {
		const root=await temp();
		const build=compileRegionalGraph({entryPoints:["main.mjs"],files:{
			"dep.mjs":'export let value=1; export function increment(){ value++; } export const order=["dependency"];',
			"main.mjs":'import {value,increment,order} from "./dep.mjs"; order.push("entry"); export {value,order}; export function read(){increment();return value;}'
		}});
		const result=await publishRegionalPackage(build,join(root,"out"));
		expect((await readdir(result.outputDirectory)).sort()).toEqual(["dep.mjs","main.mjs"]);
		const mod=await import(pathToFileURL(join(result.outputDirectory,"main.mjs")).href);
		expect(mod.order).toEqual(["dependency","entry"]);
		expect(mod.read()).toBe(2);
		expect(mod.value).toBe(2);
		expect(result.releaseApproved).toBe(false);
		expect(result.crashDurability).toBe("not-guaranteed");
	});
	it("publishes exact UTF-8 source while admitting escaped surrogates and astral text", async () => {
		const root=await temp();
		expect(()=>compileRegionalGraph({entryPoints:["a.mjs"],files:{"a.mjs":'export const value="'+String.fromCharCode(0xd800)+'";'}})).toThrow("INVALID_UTF8");
		const build=compileRegionalGraph({entryPoints:["a.mjs"],files:{"a.mjs":'export const value="\\ud800"; export const astral="🙂";'}});
		const output=join(root,"utf8"); await publishRegionalPackage(build,output);
		expect(await readFile(join(output,"a.mjs"),"utf8")).toBe(build.files["a.mjs"]);
		const mod=await import(pathToFileURL(join(output,"a.mjs")).href);
		expect(mod.value.charCodeAt(0)).toBe(0xd800); expect(mod.astral).toBe("🙂");
	});
	it("leaves previous output and sources unchanged on refusal", async () => {
		const root=await temp(); const target=join(root,"existing");
		await mkdir(target); await writeFile(join(target,"a.js"),"original bytes");
		const build=compileRegionalGraph({entryPoints:["a.js"],files:{"a.js":"var x=2;"}});
		await expect(publishRegionalPackage(build,target,{sourcePaths:[join(target,"a.js")]})).rejects.toThrow("OUTPUT_EXISTS");
		expect(await readFile(join(target,"a.js"),"utf8")).toBe("original bytes");
		expect(await readdir(root)).toEqual(["existing"]);
	});
	it("rejects untrusted build clones and symlink destinations without leakage", async () => {
		const root=await temp(); const build=compileRegionalGraph({entryPoints:["a.js"],files:{"a.js":"var x=1;"}});
		await expect(publishRegionalPackage({...build},join(root,"forged"))).rejects.toThrow("UNTRUSTED_BUILD");
		await mkdir(join(root,"real")); await symlink(join(root,"real"),join(root,"linked"),"dir");
		await expect(publishRegionalPackage(build,join(root,"linked","out"))).rejects.toThrow("UNSAFE_DESTINATION");
		expect(await readdir(join(root,"real"))).toEqual([]);
	});
	it("competing publishers expose one complete package and clean the failed stage", async () => {
		const root=await temp(); const target=join(root,"out");
		const a=compileRegionalGraph({entryPoints:["a.js"],files:{"a.js":"var value=1;","extra.js":"var extra=1;"}});
		const b=compileRegionalGraph({entryPoints:["a.js"],files:{"a.js":"var value=2;","extra.js":"var extra=2;"}});
		const results=await Promise.allSettled([publishRegionalPackage(a,target),publishRegionalPackage(b,target)]);
		expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
		expect(results.filter(result=>result.status==="rejected")).toHaveLength(1);
		const winner=results[0]!.status==="fulfilled"?a:b;
		for(const path of Object.keys(winner.files)) expect(await readFile(join(target,path),"utf8")).toBe(winner.files[path]);
		expect(await readdir(root)).toEqual(["out"]);
	});
});
