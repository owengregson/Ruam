import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { compileSegmentedStringCode } from "../../src/algorithm-state/native/segmented-string.js";
import { obfuscateCodeWithReport } from "../../src/transform.js";

const source = `"use strict";
function simulate(events) {
  let output = "";
  for (const event of events) {
    switch (event.kind) {
      case "add": output += event.value; break;
      case "cut": if (output.length > 0) { output = output.slice(0, -1); } break;
      case "hold": break;
    }
  }
  return output;
}`;
function execute(code: string, script: string): unknown {
  return runInNewContext(`${code};const log=[];try {${script}} catch(error) {globalThis.observed={error:error.name,log};} observed;`, {});
}

test("changes the complete string accumulation algorithm and preserves UTF16 histories", () => {
  for (const seed of [0, 1, 93, 0xffffffff]) {
    const result = compileSegmentedStringCode(source, {seed});
    expect(result.report.transformedFunctions).toHaveLength(1);
    expect(result.report.scope.runtimeInputsFiltered).toBe(false);
    expect(result.report.scope.protectionQualified).toBe(false);
    expect(result.report.scope.resourceExceptionTiming).toBe("not-preserved");
    for (const values of [[], ["a","bc",""], ["\ud83d\ude00","\ud800","\udc00"], [null,undefined,1,1n,true,false], Array.from({length:256},(_,index)=>String.fromCharCode(index))]) {
      const input = values.flatMap((value,index)=>[{kind:"add",value},...(index%3===0?[{kind:"cut"}]:[]),{kind:"hold"}]);
      const original = runInNewContext(`${source};simulate(input)`,{input});
      expect(runInNewContext(`${result.code};simulate(input)`,{input})).toBe(original);
    }
  }
});

test("keeps iterator, property, default coercion, and dynamic slice receiver effects in order", () => {
  const result=compileSegmentedStringCode(source);
  const scenario=`
    const native=String.prototype.slice;
    Object.defineProperty(String.prototype,"slice",{configurable:true,get(){
      log.push(["slice-get",typeof this,this]);
      return function(a,b){log.push(["slice-call",typeof this,this,a,b]);return native.call(this,a,b);};
    }});
    const input={*[Symbol.iterator](){
      try {
        log.push("next1"); yield {
          get kind(){log.push("kind1");return "add";},
          get value(){log.push("value1");return {[Symbol.toPrimitive](hint){log.push(["coerce",hint]);return "abc";}};}
        };
        log.push("next2"); yield {kind:"add",value:"def"};
        log.push("next3"); yield {kind:"cut"};
        log.push("next4"); yield {kind:"add",value:"gh"};
      } finally {log.push("iterator-finally");}
    }};
    globalThis.observed={result:simulate(input),log};`;
  expect(execute(result.code,scenario)).toEqual(execute(source,scenario));
});

test("preserves arbitrary opaque slice returns, reentry and abrupt completions", () => {
  const result=compileSegmentedStringCode(source);
  const scenarios=[
    `String.prototype.slice=function(){log.push("slice");return 9;};globalThis.observed={result:simulate([{kind:"add",value:"abc"},{kind:"cut"},{kind:"add",value:5},{kind:"cut"},{kind:"add",value:"z"}]),log};`,
    `const marker={get length(){log.push("length");return {[Symbol.toPrimitive](hint){log.push(hint);return 1;}};},get slice(){log.push("get opaque slice");return function(){log.push(this===marker);return marker;};},[Symbol.toPrimitive](hint){log.push(["opaque-coerce",hint]);return 7;}};String.prototype.slice=function(){return marker;};const value=simulate([{kind:"add",value:"abc"},{kind:"cut"},{kind:"cut"}]);globalThis.observed={same:value===marker,log};`,
    `String.prototype.slice=function(){return {[Symbol.toPrimitive](hint){log.push(["opaque-coerce",hint]);return 7;}};};globalThis.observed={result:simulate([{kind:"add",value:"abc"},{kind:"cut"},{kind:"add",get value(){log.push("key-read");return 5;}}]),log};`,
    `String.prototype.slice=function(){return null;};globalThis.observed={result:simulate([{kind:"add",value:"abc"},{kind:"cut"},{kind:"cut"}]),log};`,
    `String.prototype.slice=function(){return Symbol("opaque");};globalThis.observed={result:simulate([{kind:"add",value:"abc"},{kind:"cut"},{kind:"add",value:"x"}]),log};`,
    `String.prototype.slice=function(){return 2n;};globalThis.observed={result:simulate([{kind:"add",value:"abc"},{kind:"cut"},{kind:"add",value:3n}]),log};`,
    `const input={*[Symbol.iterator](){try{yield {kind:"add",value:"a"};yield {kind:"add",value:Symbol("x")};}finally{log.push("closed");}}};globalThis.observed={result:simulate(input),log};`,
    `const input=[{kind:"add",value:"a"},{kind:"add",value:{[Symbol.toPrimitive](hint){log.push([hint,simulate([{kind:"add",value:"nested"},{kind:"cut"}])]);return "b";}}}];globalThis.observed={result:simulate(input),log};`,
  ];
  for(const scenario of scenarios) expect(execute(result.code,scenario)).toEqual(execute(source,scenario));
});

test("retains the authored slice semantic-edit boundary and rejects an unedited negative control", () => {
  const result=compileSegmentedStringCode(source);
  const oracle=source.replace("slice(0, -1)","slice(0, -2)");
  const edited=result.code.replace("slice(0, -1)","slice(0, -2)");
  const script=`globalThis.observed=simulate([{kind:"add",value:"abcd"},{kind:"cut"},{kind:"add",value:"ef"},{kind:"cut"}]);`;
  expect(execute(edited,script)).toBe(execute(oracle,script));
  expect(execute(result.code,script)).not.toBe(execute(oracle,script));
});

test("refuses additional accumulator observations and altered completion behavior", () => {
  for(const changed of [
    source.replace("event.value","observe(output,event.value)"),
    source.replace("for (const event of events)","for (const event of observe(output,events))"),
    source.replace('let output = "";', 'let output = ""; eval("output");'),
    source.replace('case "hold": break;', 'case "hold": output = "new"; break;'),
    source.replace("slice(0, -1)","slice(0, -2)"),
    source.replace('case "hold": break;', 'case "hold": continue;'),
    source.replace("simulate(events)","simulate(output,events)").replace('let output = "";', 'var output = "";'),
  ]) expect(compileSegmentedStringCode(changed).report.transformedFunctions).toHaveLength(0);
});

test("composes with the existing VM without counting residual native code as protected", () => {
  const transformed=compileSegmentedStringCode(source,{seed:109});
  const program=`${transformed.code};globalThis.result=simulate([{kind:"add",value:"abcd"},{kind:"cut"},{kind:"add",value:"ef"},{kind:"cut"}]);`;
  const {code,report}=obfuscateCodeWithReport(program,{preset:"low",debugProtection:false});
  expect(report.completeSelection).toBe(true);
  expect(runInNewContext(`${code};result`,{TextDecoder,TextEncoder,Buffer,setTimeout})).toBe("abce");
});
