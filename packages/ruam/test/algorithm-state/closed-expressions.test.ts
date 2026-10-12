import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { compileClosedExpressionFusion } from "../../src/algorithm-state/native/closed-expressions.js";

test("fuses a closed multivalue graph while preserving published allocation identity and host order", () => {
  const source = `(() => {
    function point(a,b) { return {first:a,second:b}; }
    function row(a,b,tag) { return {where:point(a,b),tag,valid:tag!==null}; }
    return publish([row(2,-3,"a"),row(2,-3,"a"),row(4,5,null)]);
  })()`;
  const result = compileClosedExpressionFusion(source);
  expect(result.report.admittedFunctions).toBe(2);
  expect(result.report.fusedCallSites).toBe(3);
  expect(result.code).not.toContain("function row");
  expect(result.code).not.toContain("function point");
  const observe = (code: string) => runInNewContext(code, { publish(values: any[]) {
    return { values, distinct: values[0] !== values[1] && values[0].where !== values[1].where, keys: Object.keys(values[0]), innerKeys: Object.keys(values[0].where) };
  } });
  expect(observe(result.code)).toEqual(observe(source));
  expect(result.report.scope.protectionQualified).toBe(false);
  expect(result.report.scope.algorithmReplacement).toBe(false);
});

test("retains actual surrounding effects at their original evaluation boundaries", () => {
  const source = `(() => {function make(a,b){return {a,b};} return host.sink(before(),make(1,2),after());})()`;
  const transformed = compileClosedExpressionFusion(source);
  const execute = (code: string) => {
    const events: string[] = [];
    const result = runInNewContext(code, { host: { get sink() { events.push("get sink"); return (...args: unknown[]) => {events.push("call sink"); return args;} } }, before() {events.push("before");return 8;}, after() {events.push("after");return 9;} });
    return {events,result};
  };
  expect(execute(transformed.code)).toEqual(execute(source));
  expect(execute(transformed.code).events).toEqual(["get sink","before","after","call sink"]);
});

test("rejects aliases, callbacks, globals, hidden allocations and unproved argument domains", () => {
  const sources = [
    `function pair(a){return {a};} pair(1);`,
    `(() => {function pair(a){return {a};} expose(pair);return pair(1);})()`,
    `(() => {function pair(a){return {a};} return pair(input);})()`,
    `(() => {function pair(a){return {a};} return pair(effect());})()`,
    `(() => {function pair(a){return {a};} return pair({});})()`,
    `(() => {function pair(a){return {a:a.value};} return pair(1);})()`,
    `(() => {function pair(a){return {a:Math.abs(a)};} return pair(-1);})()`,
    `(() => {function pair(a){return {a,...a};} return pair(1);})()`,
    `(() => {function pair(a){return {a:()=>a};} return pair(1);})()`,
    `(() => {function pair(a=1){return {a};} return pair(1);})()`,
    `(() => {function pair(a){return pair(a);} return pair(1);})()`,
    `(() => {function pair(a){return {a};} eval("pair=external");return pair(1);})()`,
    `(() => {function leaf(a){return {a};} function caller(a){return leaf(a);} expose(caller);return caller(1);})()`,
    `(function(){if(true){function pair(a){return {a};} pair(1);} return pair;})()`,
  ];
  for (const source of sources) {
    const result = compileClosedExpressionFusion(source);
    expect(result.report.admittedFunctions).toBe(0);
    expect(result.code).toBe(source);
    expect(result.report.functions.some((fn) => fn.reasons.length > 0)).toBe(true);
  }
});

test("preserves missing arguments, shorthand proto data fields, and explicit proto setters", () => {
  const source = `(() => {function make(__proto__,a,b){return {__proto__,a,b,inner:{__proto__:null}};} return make(3);})()`;
  const result = compileClosedExpressionFusion(source);
  expect(result.report.admittedFunctions).toBe(1);
  for (const code of [source,result.code]) {
    const value = runInNewContext(code);
    expect(Object.hasOwn(value,"__proto__")).toBe(true);
    expect(value.__proto__).toBe(3);
    expect(value.a).toBeUndefined();
    expect(Object.getPrototypeOf(value.inner)).toBeNull();
  }
});

test("declines whole sources with sloppy Annex B rebinding outside the lexical graph", () => {
  const nodeObservation = (code: string) => JSON.parse(execFileSync("node", ["-e", "process.stdout.write(JSON.stringify(require('node:vm').runInNewContext(process.argv[1])))", code], { encoding: "utf8", timeout: 5000 }));
  const declarations = [
    `if(true){function make(a){return {b:a}}}`,
    `switch(1){case 1:function make(a){return {b:a}}}`,
    `label: function make(a){return {b:a}}`,
    `if(true){function make(a){"use strict";return {b:a}}}`,
  ];
  for (const declaration of declarations) {
    const source = `(()=>{function make(a){return {a}} ${declaration} return make(1)})()`;
    const result = compileClosedExpressionFusion(source);
    expect(nodeObservation(source)).toEqual({ b: 1 });
    expect(result.code).toBe(source);
    expect(result.report.admittedFunctions).toBe(0);
    expect(result.report.fusedCallSites).toBe(0);
    expect(result.report.declined[0]!.reason).toContain("Annex B");
    expect(nodeObservation(result.code)).toEqual(nodeObservation(source));
  }
  const strict = `(()=>{"use strict";function make(a){return {a}} if(true){function make(a){return {b:a}}}return make(1)})()`;
  const result = compileClosedExpressionFusion(strict);
  expect(result.report.declined).toHaveLength(0);
  expect(result.report.admittedFunctions).toBe(1);
  expect(nodeObservation(result.code)).toEqual({ a: 1 });
});
