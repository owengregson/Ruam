import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { compileNativeCandidateCode } from "../../src/transform.js";
import { IncompleteCompilationError } from "../../src/compilation-report.js";

const programs = {
	"loop control and coercive values": `function f(input) {
  var out=[], n={valueOf(){out.push('coerce');return 3}};
  for(var i=0;i<input;i++){if(i===2)continue;if(i===5)break;out.push(i+n)}
  return [out, -0, NaN, 2n+3n];
} f(8);`,
	"closures, recursion, reentry and lexical this": `function main(){
  var total=0; function f(n){total++;return n<2?1:n*f(n-1)}
  var obj={x:7,m(){return (v)=>this.x+v+total}};
  var g=obj.m();return [f(5),g(3),total];
}main();`,
	"nested finally and abrupt completion": `function main(){
  var log=[]; function f(n){try{try{if(n)throw 4;return 3}finally{log.push('inner')}}
  catch(e){log.push(e);return 9}finally{log.push('outer')}}
  return [f(0),f(1),log];
}main();`,
	"classes, descriptors, super and constructors": `function main(){
  class Base{constructor(v){this.v=v}get value(){return this.v}m(x){return this.v+x}}
  class Child extends Base{field=2;constructor(v){super(v)}m(x){return super.m(x)+this.field}}
  var c=new Child(7),d=Object.getOwnPropertyDescriptor(Child.prototype,'m');
  return [c.value,c.m(4),d.enumerable,d.writable,c instanceof Base];
}main();`,
	"optional reference and key evaluation": `function main(){
  var log=[],a={x:4,m(v){log.push(this.x);return v}};
  var x=a?.m?.((log.push('arg'),8));var y=null?.[(log.push('wrong'),'m')]();
  return [x,y,log];
}main();`,
	"async authored suspension and shared closure state": `function main(){
  var log=[],pending=false;async function f(x){if(pending)return 0;pending=true;
    log.push('start');try{await 0;log.push(x);return x*2}finally{pending=false;log.push('done')}}
  var a=f(3),b=f(4);log.push('caller');queueMicrotask(()=>log.push('micro'));
  return Promise.all([a,b]).then(v=>[v,log,pending]);
}main();`,
};

async function observe(code: string): Promise<string> {
	const value = await runInNewContext(code, { queueMicrotask }, { timeout: 3000 });
	return JSON.stringify(value, (_key, v) => typeof v === "bigint" ? `${v}n` :
		typeof v === "number" && Object.is(v, -0) ? "-0" :
		typeof v === "number" && Number.isNaN(v) ? "NaN" : v);
}

describe("experimental native specialization", () => {
	for (const [label, source] of Object.entries(programs)) test(label, async () => {
		const expected = await observe(source);
		for (const seed of [0, 1, 71, 0xffffffff]) {
			const { code, report } = compileNativeCandidateCode(source, { seed });
			expect(report.compilation.completeSelection).toBe(true);
			expect(report.protectionQualified).toBe(false);
			expect(await observe(code)).toBe(expected);
		}
	});
	test("emits deterministic research artifacts and fails closed on unsupported selection", () => {
		const source = "function f(x){return x*2}f(21);";
		expect(compileNativeCandidateCode(source, { seed: 31 })).toEqual(compileNativeCandidateCode(source, { seed: 31 }));
		for (const unsupported of ["function* f(){yield 1}", "async function f(xs){for await(const x of xs){return x}}", "var x=1;"]) {
			expect(() => compileNativeCandidateCode(unsupported, { seed: 1 })).toThrow(IncompleteCompilationError);
		}
		expect(() => compileNativeCandidateCode(source, { seed: -1 })).toThrow(RangeError);
	});
	test("keeps browser-extension runtime private and executes wrapped stubs", () => {
		const source = "(function(){var x=21;globalThis.answer=(()=>x*2)()})();";
		const { code, report } = compileNativeCandidateCode(source, { seed: 0, target: "browser-extension" });
		const context: Record<string, unknown> = {};
		runInNewContext(code, context, { timeout: 3000 });
		expect(context.answer).toBe(42);
		expect(Object.keys(context)).toEqual(["answer"]);
		expect(report.compilation.completeSelection).toBe(true);
	});
});
