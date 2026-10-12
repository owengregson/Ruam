import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { applyWordSteps, buildWordTables, compileWordFusionCode, composeWordColumns, verifyWordTables, type WordShiftStep } from "../../src/algorithm-state/native/word-fusion.js";
import { obfuscateCode } from "../../src/index.js";

// Independently authored public fixture: no private application source/constants.
const fixture = `function make(seed) {
  "use strict";
  let word = seed >>> 0;
  return function next() {
    word ^= word << 7;
    word ^= word >>> 11;
    word ^= word << 3;
    word >>>= 0;
    return word;
  };
}`;
const localFixture = `function sequence(seed, count, observe) {
  "use strict";
  let word = seed >>> 0;
  const values = [];
  for (let i = 0; i < count; i++) {
    word ^= word << 7;
    word ^= word >>> 11;
    word ^= word << 3;
    word >>>= 0;
    values.push(word);
    if (observe) observe(word, i);
  }
  return values;
}`;
function load(code: string): (seed: unknown, count: number, observe?: (value: number, index: number) => void) => number[] {
  return runInNewContext(`${code};sequence`, {});
}

describe("experimental linear word transition resynthesis", () => {
  test("composes an entire adjacent transition and verifies all linear table entries", () => {
    const steps: WordShiftStep[] = [{ direction: "left", amount: 7 }, { direction: "right", amount: 11 }, { direction: "left", amount: 3 }];
    const columns = composeWordColumns(steps);
    const tables = buildWordTables(columns);
    expect(verifyWordTables(steps, tables)).toBe(true);
    for (const word of [0, 1, 0x7fffffff, 0x80000000, 0xffffffff, 0x12345678]) {
      let fused = 0;
      for (let nibble = 0; nibble < 8; nibble++) fused ^= tables[nibble]![(word >>> (nibble * 4)) & 15]!;
      expect(fused >>> 0).toBe(applyWordSteps(word, steps));
    }
    tables[3]![6] = tables[3]![6]! ^ 1;
    expect(verifyWordTables(steps, tables)).toBe(false);
  });

  test("preserves boundary inputs, long trajectories, callbacks, and generated names", () => {
    const original = load(localFixture);
    for (const seed of [0, 1, 19, 0xffffffff]) {
      const result = compileWordFusionCode(localFixture, { seed });
      expect(result.regions).toHaveLength(1);
      expect(result.regions[0]!.inputProof).toBe("authored-number-coercion");
      expect(result.code).not.toContain("word ^=");
      expect(result.code).toContain('"use strict"');
      expect(result.scope.wholeProgramReplacement).toBe(false);
      const emitted = load(result.code);
      for (const input of [0, -0, 1, -1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, NaN, Infinity, -Infinity, 1.75, "4294967295", null, undefined, true]) {
        const expectedTrace: number[][] = [];
        const actualTrace: number[][] = [];
        expect(emitted(input, 1024, (value, index) => actualTrace.push([value, index]))).toEqual(original(input, 1024, (value, index) => expectedTrace.push([value, index])));
        expect(actualTrace).toEqual(expectedTrace);
      }
      for (const input of [1n, Symbol("seed")]) expect(() => emitted(input, 1)).toThrow();
      const originalEvents: string[] = [];
      const emittedEvents: string[] = [];
      expect(emitted({ [Symbol.toPrimitive](hint: string) { emittedEvents.push(hint); return 9; } }, 5)).toEqual(original({ [Symbol.toPrimitive](hint: string) { originalEvents.push(hint); return 9; } }, 5));
      expect(emittedEvents).toEqual(originalEvents);
    }
  });

  test("proves Number return from a stable module helper without assuming its mutable calls are pure", () => {
    const source = `export function sequence(seed, count) {
      let word = initialize(seed);
      let output = [];
      for(let index=0;index<count;index++) {
        word ^= word << 9; word ^= word >> 5; word >>>= 0;
        output.push(word);
      }
      return output;
    }
    function initialize(seed) { if (seed === null) return 0; return Math.imul(seed, 17) >>> 0; }`;
    const result = compileWordFusionCode(source);
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]!.inputProof).toBe("stable-local-word-return");
    const nativeSource = source.replace("export ", "");
    const nativeEmitted = result.code.replace("export ", "");
    const events: string[] = [];
    const hostMath = { imul(a: unknown, b: unknown) { events.push(`${String(a)}:${String(b)}`); return { valueOf() { events.push("valueOf"); return 81; } }; } };
    const actual = runInNewContext(`${nativeEmitted};sequence(4,20)`, { Math: hostMath });
    const actualEvents = [...events]; events.length = 0;
    const expected = runInNewContext(`${nativeSource};sequence(4,20)`, { Math: hostMath });
    expect(actual).toEqual(expected);
    expect(actualEvents).toEqual(events);
    expect(actualEvents).toEqual(["4:17", "valueOf"]);
  });

  test("declines effects, unproved state, global helper mutation, and dynamic scope", () => {
    const declined = [
      fixture, // Captured state requires an additional ownership/domain proof.
      localFixture.replace("seed >>> 0", "seed"),
      localFixture.replace("word ^= word >>> 11;", "word = observe(word);"),
      localFixture.replace("word ^= word >>> 11;", "word ^= observe(word);"),
      localFixture.replace("let word = seed >>> 0;", "let word = initialize(seed);") + "function initialize(seed){return seed>>>0;}",
      localFixture.replace("const values = [];", "const values = []; eval('word = 1n');"),
      localFixture.replace("let word = seed >>> 0;", "if(seed) { var word = seed >>> 0; }"),
      localFixture.replace("let word = seed >>> 0;", "let word: number = seed;"),
    ];
    for (const source of declined) {
      const result = compileWordFusionCode(source);
      expect(result.regions).toHaveLength(0);
      expect(result.code).toBe(source);
    }
  });

  test("resynthesizes signed output, separate transitions, and supports current VM composition", () => {
    const source = `function sequence(seed, count) {
      let word = seed >>> 0;
      const output = [];
      for(let i=0;i<count;i++) {
        word ^= word << 9; word ^= word >> 5;
        output.push(word);
        word ^= word >>> 4; word ^= word << 2;
        output.push(word);
      }
      return output;
    }`;
    const result = compileWordFusionCode(source, { seed: 401 });
    expect(result.regions).toHaveLength(2);
    expect(result.regions.map((region) => region.output)).toEqual(["int32", "int32"]);
    const expected = load(source)(0xfefefefe, 32);
    expect(load(result.code)(0xfefefefe, 32)).toEqual(expected);
    const wrapped = obfuscateCode(`${result.code};globalThis.result=sequence(0xfefefefe,32);`, { preset: "low", debugProtection: false });
    expect(runInNewContext(`${wrapped};result`, { TextDecoder, TextEncoder, Buffer, setTimeout })).toEqual(expected);
  });

  test("declines sloppy Annex B writes to state and word-return helpers without changing source", () => {
    const nodeObservation = (code: string) => JSON.parse(execFileSync("node", ["-e", "process.stdout.write(JSON.stringify(require('node:vm').runInNewContext(process.argv[1])))", code], { encoding: "utf8", timeout: 5000 }));
    const declarations = [
      `if(true){function word(){}}`,
      `switch(1){case 1:function word(){}}`,
      `label: function word(){}`,
      `if(true){function word(){"use strict";}}`,
    ];
    const sources = declarations.map((declaration) => `function sequence(seed){var word=seed>>>0;${declaration} var log=[];word.valueOf=function(){log.push('coerce');return 7};word^=word<<1;word^=word>>>2;return [word,log.length];}sequence(3);`);
    sources.push(`function sequence(){const log=[];function initialize(){return 7}if(true){function initialize(){return {valueOf(){log.push('coerce');return 7}}}}let word=initialize();word^=word<<1;word^=word>>>2;return [word,log.length];}sequence();`);
    for (const [index, source] of sources.entries()) {
      const result = compileWordFusionCode(source);
      // V8 hoists the labeled declaration before the var initializer; unlike
      // the block/switch cases, the numeric initializer then overwrites it.
      expect(nodeObservation(source)).toEqual(index === 2 ? [4, 0] : [11, 2]);
      expect(result.code).toBe(source);
      expect(result.regions).toHaveLength(0);
      expect(result.declined[0]!.reason).toContain("Annex B");
      expect(nodeObservation(result.code)).toEqual(nodeObservation(source));
    }
    const strict = `function sequence(seed){"use strict";var word=seed>>>0;if(true){function word(){}}word^=word<<1;word^=word>>>2;return word;}sequence(3);`;
    const result = compileWordFusionCode(strict);
    expect(result.regions).toHaveLength(1);
    expect(result.declined).toHaveLength(0);
    expect(nodeObservation(result.code)).toBe(nodeObservation(strict));
  });
});
