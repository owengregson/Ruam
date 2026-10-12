import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { obfuscateCodeWithReport } from "../../src/transform.js";

test("class methods define own non-enumerable properties without inherited setters", () => {
	const source = `function main(){
    var log=[],sym=Symbol('method');
    class Base {set method(v){log.push('setter')}static set method(v){log.push('static setter')}}
    class Derived extends Base {
      constructor(){super()}
      method(){return 1}
      static method(){return 2}
      [sym](){return 3}
      ['computed'](){return 4}
      static ['computed'](){return 5}
      static constructor(){return 7}
    }
    var value=new Derived();
    function flags(o,k){var d=Object.getOwnPropertyDescriptor(o,k);return [d.enumerable,d.configurable,d.writable]}
    return [log,value.method(),Derived.method(),value[sym](),value.computed(),Derived.computed(),Derived.constructor(),
      flags(Derived.prototype,'method'),
      flags(Derived,'method'),flags(Derived.prototype,sym),flags(Derived.prototype,'computed'),flags(Derived,'computed')];
  } main();`;
	const expected = JSON.stringify(runInNewContext(source));
	for (const preset of ["low", "medium", "max"] as const) {
		const { code, report } = obfuscateCodeWithReport(source, { preset, debugProtection: false });
		expect(report.completeSelection).toBe(true);
		expect(JSON.stringify(runInNewContext(code))).toBe(expected);
	}
});

test("source mutation of Object.defineProperty does not intercept class language definitions", () => {
	const source = `function main(){
    var old=Object.defineProperty;Object.defineProperty=function(){throw 9};
    try{class B{base(){return 3}}class C extends B{constructor(){super()}method(){return 1}['computed'](){return 2}get value(){return 4}}
      var c=new C();return [c.method(),c.computed(),c.base(),c.value]
    }finally{Object.defineProperty=old}
  }main();`;
	const expected = JSON.stringify(runInNewContext(source));
	for (const preset of ["low", "medium", "max"] as const) {
		expect(JSON.stringify(runInNewContext(obfuscateCodeWithReport(source, { preset, debugProtection: false }).code))).toBe(expected);
	}
});

test("existing object-literal descriptor lowering retains the mutable call receiver", () => {
	const source = `function main(){var old=Object.defineProperty;
    Object.defineProperty=function(o,k,d){if(this!==Object)throw 9;return old(o,k,d)};
    try{var x={method(){return 3}};return x.method()}finally{Object.defineProperty=old}
  }main();`;
	for (const preset of ["low", "max"] as const) {
		expect(runInNewContext(obfuscateCodeWithReport(source, { preset, debugProtection: false }).code)).toBe(3);
	}
});
