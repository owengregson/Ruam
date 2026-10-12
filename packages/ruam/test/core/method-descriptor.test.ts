import { expect, it } from "bun:test";
import { createContext, Script } from "node:vm";
import { obfuscateCode } from "../../src/index.js";

const source = `function run(){
 install();
 var methods={3(){return 17},named(){return 19}};
 var descriptor=Object.getOwnPropertyDescriptor(methods,'3');
 return [methods[3](),methods.named(),Object.keys(methods),
  Object.getPrototypeOf(methods)===Object.prototype,
  descriptor.writable,descriptor.enumerable,descriptor.configurable];
}globalThis.result=run();`;

function observe(code: string, setup: string) {
	const context = createContext({});
	// Install after VM setup, immediately before the object literal under test.
	new Script(`globalThis.events=[];globalThis.install=function(){${setup}};`).runInContext(context);
	new Script(code).runInContext(context, { timeout: 4000 });
	return new Script("[result,events]").runInContext(context);
}

it("constructs method descriptors without invoking inherited field setters", () => {
	const setup = `for(const key of ['value','writable','enumerable','configurable']){
 Object.defineProperty(Object.prototype,key,{__proto__:null,set(value){events.push(key)},configurable:true});
 }`;
	const expected = observe(source, setup);
	expect(expected[1]).toEqual([]);
	for (const preset of ["low", "max"] as const) {
		const warnings: unknown[][] = [], previousWarn = console.warn;
		let code: string;
		try { console.warn = (...args) => { warnings.push(args); };
			code = obfuscateCode(source, { preset, targetMode: "root", debugProtection: false });
		} finally { console.warn = previousWarn; }
		expect(warnings).toEqual([]);
		expect(observe(code, setup)).toEqual(expected);
	}
});

it("does not use a mutable prototype-setting intrinsic for internal descriptors", () => {
	const setup = `Object.setPrototypeOf=function(){throw new Error('unexpected prototype call')};`;
	const code = obfuscateCode(source, { preset: "low", targetMode: "root", debugProtection: false });
	expect(observe(code, setup)).toEqual(observe(source, setup));
});
