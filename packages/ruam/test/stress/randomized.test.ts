import { describe, it, expect } from "vitest";
import { assertEquivalent, evalOriginal, evalObfuscated } from "../helpers.js";

/**
 * Randomized / Fuzz-style Tests
 *
 * These tests generate random inputs at test-time to verify that
 * the VM produces identical results to native JS execution, regardless
 * of the specific values involved. This prevents the VM from being
 * "accidentally correct" only for hardcoded test constants.
 *
 * Each trial loop runs 3x more than the minimum to increase the
 * probability of catching non-deterministic edge cases.
 */

/** Multiplier for all trial loop counts — increase to catch rare edge cases. */
const FUZZ_MULTIPLIER = 3;

// ---------------------------------------------------------------------------
// Helpers: random value generators
// ---------------------------------------------------------------------------

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randString(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function randArray(len: number, gen: () => number): number[] {
  return Array.from({ length: len }, gen);
}

function randBool(): boolean {
  return Math.random() > 0.5;
}

// Generate a unique identifier safe for JS variable names
function randIdent(): string {
  return "_" + randString(randInt(3, 8));
}

// ---------------------------------------------------------------------------
// 1. Arithmetic with random operands
// ---------------------------------------------------------------------------

describe("randomized: arithmetic", () => {
  for (let trial = 0; trial < 10 * FUZZ_MULTIPLIER; trial++) {
    const a = randInt(-1000, 1000);
    const b = randInt(-1000, 1000);
    const bNonZero = b === 0 ? 1 : b;

    it(`addition: ${a} + ${b}`, () => {
      assertEquivalent(`
        function f(a, b) { return a + b; }
        f(${a}, ${b});
      `);
    });

    it(`subtraction: ${a} - ${b}`, () => {
      assertEquivalent(`
        function f(a, b) { return a - b; }
        f(${a}, ${b});
      `);
    });

    it(`multiplication: ${a} * ${b}`, () => {
      assertEquivalent(`
        function f(a, b) { return a * b; }
        f(${a}, ${b});
      `);
    });

    it(`division: ${a} / ${bNonZero}`, () => {
      assertEquivalent(`
        function f(a, b) { return a / b; }
        f(${a}, ${bNonZero});
      `);
    });

    it(`modulus: ${a} % ${bNonZero}`, () => {
      assertEquivalent(`
        function f(a, b) { return a % b; }
        f(${a}, ${bNonZero});
      `);
    });
  }

  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const base = randInt(0, 10);
    const exp = randInt(0, 6);
    it(`exponentiation: ${base} ** ${exp}`, () => {
      assertEquivalent(`
        function f(a, b) { return a ** b; }
        f(${base}, ${exp});
      `);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Bitwise operations with random operands
// ---------------------------------------------------------------------------

describe("randomized: bitwise", () => {
  for (let trial = 0; trial < 10 * FUZZ_MULTIPLIER; trial++) {
    const a = randInt(0, 0xFFFF);
    const b = randInt(0, 0xFFFF);
    const shift = randInt(0, 15);

    it(`bitwise ops on ${a} and ${b}`, () => {
      assertEquivalent(`
        function f(a, b) {
          return [a & b, a | b, a ^ b, ~a, a << ${shift}, a >> ${shift}, a >>> ${shift}];
        }
        f(${a}, ${b});
      `);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Comparison operators with random values
// ---------------------------------------------------------------------------

describe("randomized: comparisons", () => {
  for (let trial = 0; trial < 10 * FUZZ_MULTIPLIER; trial++) {
    const a = randInt(-100, 100);
    const b = randInt(-100, 100);

    it(`comparisons: ${a} vs ${b}`, () => {
      assertEquivalent(`
        function f(a, b) {
          return [a < b, a <= b, a > b, a >= b, a === b, a !== b];
        }
        f(${a}, ${b});
      `);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. String operations with random strings
// ---------------------------------------------------------------------------

describe("randomized: string operations", () => {
  for (let trial = 0; trial < 8 * FUZZ_MULTIPLIER; trial++) {
    const s = randString(randInt(5, 20));
    const needle = s.substring(randInt(0, 3), randInt(3, Math.min(6, s.length)));

    it(`string methods on "${s.substring(0, 10)}..."`, () => {
      assertEquivalent(`
        function f(s, needle) {
          return [
            s.length,
            s.toUpperCase(),
            s.toLowerCase(),
            s.indexOf(needle),
            s.slice(0, 5),
            s.charAt(0),
          ];
        }
        f("${s}", "${needle}");
      `);
    });
  }

  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const parts = randArray(randInt(2, 6), () => randInt(0, 100));
    const sep = [",", " ", "-", "|", "::"][randInt(0, 4)]!;

    it(`join/split round-trip with sep "${sep}" (${parts.length} items)`, () => {
      assertEquivalent(`
        function f(arr, sep) {
          var joined = arr.join(sep);
          var split = joined.split(sep);
          return [joined, split.length];
        }
        f([${parts.join(",")}], "${sep}");
      `);
    });
  }

  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const str = randString(randInt(10, 30));
    const start = randInt(0, 5);
    const end = randInt(start + 1, Math.min(start + 10, str.length));

    it(`substring/slice on "${str.substring(0, 8)}..." [${start}:${end}]`, () => {
      assertEquivalent(`
        function f(s) {
          return [s.substring(${start}, ${end}), s.slice(${start}, ${end})];
        }
        f("${str}");
      `);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Array operations with random data
// ---------------------------------------------------------------------------

describe("randomized: array operations", () => {
  for (let trial = 0; trial < 8 * FUZZ_MULTIPLIER; trial++) {
    const arr = randArray(randInt(5, 15), () => randInt(-50, 50));

    it(`sort ${arr.length} elements`, () => {
      assertEquivalent(`
        function f(arr) {
          return arr.slice().sort(function(a, b) { return a - b; });
        }
        f([${arr.join(",")}]);
      `);
    });

    it(`filter/map/reduce on ${arr.length} elements`, () => {
      const threshold = randInt(-20, 20);
      assertEquivalent(`
        function f(arr) {
          return arr
            .filter(function(x) { return x > ${threshold}; })
            .map(function(x) { return x * 2; })
            .reduce(function(a, b) { return a + b; }, 0);
        }
        f([${arr.join(",")}]);
      `);
    });

    it(`indexOf/includes on ${arr.length} elements`, () => {
      const searchVal = arr[randInt(0, arr.length - 1)]!;
      const missingVal = 9999;
      assertEquivalent(`
        function f(arr) {
          return [
            arr.indexOf(${searchVal}),
            arr.includes(${searchVal}),
            arr.indexOf(${missingVal}),
            arr.includes(${missingVal}),
          ];
        }
        f([${arr.join(",")}]);
      `);
    });
  }

  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const arr = randArray(randInt(3, 8), () => randInt(0, 20));
    const spliceStart = randInt(0, Math.max(0, arr.length - 2));
    const spliceDelete = randInt(0, 2);
    const spliceInsert = randArray(randInt(0, 3), () => randInt(100, 200));

    it(`splice at ${spliceStart} del ${spliceDelete} ins ${spliceInsert.length}`, () => {
      assertEquivalent(`
        function f() {
          var arr = [${arr.join(",")}];
          var removed = arr.splice(${spliceStart}, ${spliceDelete}${spliceInsert.length > 0 ? ", " + spliceInsert.join(",") : ""});
          return [arr, removed];
        }
        f();
      `);
    });
  }
});

// ---------------------------------------------------------------------------
// 6. Recursive algorithms with random inputs
// ---------------------------------------------------------------------------

describe("randomized: recursive algorithms", () => {
  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const n = randInt(1, 12);
    it(`factorial(${n})`, () => {
      assertEquivalent(`
        function factorial(n) {
          if (n <= 1) return 1;
          return n * factorial(n - 1);
        }
        factorial(${n});
      `);
    });
  }

  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const n = randInt(1, 15);
    it(`fibonacci(${n})`, () => {
      assertEquivalent(`
        function fib(n) {
          if (n <= 1) return n;
          return fib(n - 1) + fib(n - 2);
        }
        fib(${n});
      `);
    });
  }

  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const arr = randArray(randInt(5, 12), () => randInt(-100, 100));
    it(`merge sort of ${arr.length} elements`, () => {
      assertEquivalent(`
        function mergeSort(arr) {
          if (arr.length <= 1) return arr;
          var mid = Math.floor(arr.length / 2);
          var left = mergeSort(arr.slice(0, mid));
          var right = mergeSort(arr.slice(mid));
          var result = [], i = 0, j = 0;
          while (i < left.length && j < right.length) {
            if (left[i] <= right[j]) result.push(left[i++]);
            else result.push(right[j++]);
          }
          while (i < left.length) result.push(left[i++]);
          while (j < right.length) result.push(right[j++]);
          return result;
        }
        mergeSort([${arr.join(",")}]);
      `);
    });
  }

  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const a = randInt(10, 200);
    const b = randInt(10, 200);
    it(`gcd(${a}, ${b})`, () => {
      assertEquivalent(`
        function gcd(a, b) {
          while (b !== 0) {
            var t = b;
            b = a % b;
            a = t;
          }
          return a;
        }
        gcd(${a}, ${b});
      `);
    });
  }

  for (let trial = 0; trial < 3 * FUZZ_MULTIPLIER; trial++) {
    const n = randInt(2, 5);
    it(`tower of hanoi moves for n=${n}`, () => {
      assertEquivalent(`
        function hanoi(n) {
          if (n === 0) return 0;
          return 2 * hanoi(n - 1) + 1;
        }
        hanoi(${n});
      `);
    });
  }
});

// ---------------------------------------------------------------------------
// 7. Object manipulation with random keys/values
// ---------------------------------------------------------------------------

describe("randomized: object operations", () => {
  for (let trial = 0; trial < 8 * FUZZ_MULTIPLIER; trial++) {
    const numKeys = randInt(3, 8);
    const keys: string[] = [];
    for (let i = 0; i < numKeys; i++) keys.push("k" + randString(randInt(2, 5)));
    const vals = randArray(numKeys, () => randInt(-100, 100));
    const kvPairs = keys.map((k, i) => `${k}: ${vals[i]}`).join(", ");

    it(`object with ${numKeys} random keys`, () => {
      assertEquivalent(`
        function f() {
          var obj = {${kvPairs}};
          var result = [];
          var keys = Object.keys(obj).sort();
          for (var i = 0; i < keys.length; i++) {
            result.push(keys[i] + "=" + obj[keys[i]]);
          }
          return result.join(",");
        }
        f();
      `);
    });
  }

  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const count = randInt(3, 8);
    it(`dynamic property assignment (${count} props)`, () => {
      const indices = randArray(count, () => randInt(0, 100));
      assertEquivalent(`
        function f() {
          var obj = {};
          var indices = [${indices.join(",")}];
          for (var i = 0; i < indices.length; i++) {
            obj["prop_" + indices[i]] = indices[i] * indices[i];
          }
          return Object.keys(obj).sort().map(function(k) { return k + ":" + obj[k]; }).join(",");
        }
        f();
      `);
    });
  }
});

// ---------------------------------------------------------------------------
// 8. Closures with random captured values
// ---------------------------------------------------------------------------

describe("randomized: closures", () => {
  for (let trial = 0; trial < 8 * FUZZ_MULTIPLIER; trial++) {
    const base = randInt(-50, 50);

    it(`adder factory with base ${base}`, () => {
      const testValues = randArray(5, () => randInt(-100, 100));
      assertEquivalent(`
        function makeAdder(base) {
          return function(x) { return base + x; };
        }
        var add = makeAdder(${base});
        [${testValues.map(v => `add(${v})`).join(", ")}];
      `);
    });
  }

  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const multiplier = randInt(2, 10);
    const offset = randInt(-20, 20);

    it(`transform pipeline: *${multiplier} then +${offset}`, () => {
      const inputs = randArray(4, () => randInt(-50, 50));
      assertEquivalent(`
        function compose(f, g) {
          return function(x) { return g(f(x)); };
        }
        var transform = compose(
          function(x) { return x * ${multiplier}; },
          function(x) { return x + ${offset}; }
        );
        [${inputs.map(v => `transform(${v})`).join(", ")}];
      `);
    });
  }

  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const increments = randArray(randInt(3, 8), () => randInt(1, 10));
    it(`counter with ${increments.length} increments`, () => {
      assertEquivalent(`
        function makeCounter(start) {
          var val = start;
          return {
            add: function(n) { val += n; },
            get: function() { return val; }
          };
        }
        var c = makeCounter(0);
        ${increments.map(n => `c.add(${n});`).join("\n        ")}
        c.get();
      `);
    });
  }
});

// ---------------------------------------------------------------------------
// 9. Control flow with random conditions
// ---------------------------------------------------------------------------

describe("randomized: control flow", () => {
  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const n = randInt(5, 30);
    it(`sum of 1..${n}`, () => {
      assertEquivalent(`
        function sumTo(n) {
          var total = 0;
          for (var i = 1; i <= n; i++) total += i;
          return total;
        }
        sumTo(${n});
      `);
    });
  }

  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const values = randArray(randInt(5, 10), () => randInt(-50, 50));
    const threshold = randInt(-20, 20);
    it(`count values > ${threshold} in ${values.length} items`, () => {
      assertEquivalent(`
        function countAbove(arr, threshold) {
          var count = 0;
          for (var i = 0; i < arr.length; i++) {
            if (arr[i] > threshold) count++;
          }
          return count;
        }
        countAbove([${values.join(",")}], ${threshold});
      `);
    });
  }

  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const items = randArray(randInt(4, 8), () => randInt(0, 100));
    const target = items[randInt(0, items.length - 1)]!;
    it(`linear search for ${target} in ${items.length} items`, () => {
      assertEquivalent(`
        function find(arr, target) {
          for (var i = 0; i < arr.length; i++) {
            if (arr[i] === target) return i;
          }
          return -1;
        }
        find([${items.join(",")}], ${target});
      `);
    });
  }

  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const n = randInt(5, 20);
    it(`collatz steps for ${n}`, () => {
      assertEquivalent(`
        function collatz(n) {
          var steps = 0;
          while (n !== 1) {
            n = n % 2 === 0 ? n / 2 : 3 * n + 1;
            steps++;
          }
          return steps;
        }
        collatz(${n});
      `);
    });
  }
});

// ---------------------------------------------------------------------------
// 10. Switch statements with random cases
// ---------------------------------------------------------------------------

describe("randomized: switch", () => {
  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const numCases = randInt(3, 7);
    const caseValues = randArray(numCases, () => randInt(0, 20));
    const testValue = randBool() ? caseValues[randInt(0, numCases - 1)]! : randInt(0, 20);

    const cases = caseValues.map((v, i) => `case ${v}: return ${i + 1};`).join("\n            ");

    it(`switch with ${numCases} cases, testing ${testValue}`, () => {
      assertEquivalent(`
        function classify(x) {
          switch(x) {
            ${cases}
            default: return -1;
          }
        }
        classify(${testValue});
      `);
    });
  }
});

// ---------------------------------------------------------------------------
// 11. Complex expressions with random operands
// ---------------------------------------------------------------------------

describe("randomized: complex expressions", () => {
  for (let trial = 0; trial < 8 * FUZZ_MULTIPLIER; trial++) {
    const a = randInt(-50, 50);
    const b = randInt(-50, 50);
    const c = randInt(-50, 50);
    const bNonZero = b === 0 ? 1 : b;

    it(`mixed ops: a=${a}, b=${bNonZero}, c=${c}`, () => {
      assertEquivalent(`
        function f(a, b, c) {
          var r1 = (a + b) * c;
          var r2 = a * b + c;
          var r3 = (a - c) / b;
          var r4 = a % b + c * a;
          return [r1, r2, r3, r4];
        }
        f(${a}, ${bNonZero}, ${c});
      `);
    });
  }

  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const vals = randArray(5, () => randInt(-20, 20));
    it(`ternary chains with random values`, () => {
      assertEquivalent(`
        function f(a, b, c, d, e) {
          return a > 0 ? (b > 0 ? a + b : a - b) : (c > 0 ? c * d : d + e);
        }
        f(${vals.join(",")});
      `);
    });
  }
});

// ---------------------------------------------------------------------------
// 12. Class operations with random data
// ---------------------------------------------------------------------------

describe("randomized: classes", () => {
  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const x = randInt(-100, 100);
    const y = randInt(-100, 100);
    const dx = randInt(-50, 50);
    const dy = randInt(-50, 50);

    it(`Point(${x},${y}) + translate(${dx},${dy})`, () => {
      assertEquivalent(`
        function test() {
          class Point {
            constructor(x, y) { this.x = x; this.y = y; }
            translate(dx, dy) { return new Point(this.x + dx, this.y + dy); }
            toString() { return "(" + this.x + "," + this.y + ")"; }
          }
          var p = new Point(${x}, ${y});
          var p2 = p.translate(${dx}, ${dy});
          return [p.toString(), p2.toString()];
        }
        test();
      `);
    });
  }

  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const items = randArray(randInt(3, 6), () => randInt(1, 100));
    it(`Stack with ${items.length} random pushes`, () => {
      assertEquivalent(`
        function test() {
          class Stack {
            constructor() { this.items = []; }
            push(val) { this.items.push(val); return this; }
            pop() { return this.items.pop(); }
            peek() { return this.items[this.items.length - 1]; }
            size() { return this.items.length; }
          }
          var s = new Stack();
          ${items.map(v => `s.push(${v});`).join("\n          ")}
          var popped = [];
          while (s.size() > 0) popped.push(s.pop());
          return popped;
        }
        test();
      `);
    });
  }
});

// ---------------------------------------------------------------------------
// 13. Exception handling with random error values
// ---------------------------------------------------------------------------

describe("randomized: exceptions", () => {
  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const values = randArray(randInt(3, 8), () => randInt(-50, 50));
    const throwIdx = randInt(0, values.length - 1);

    it(`throw at index ${throwIdx} of ${values.length}`, () => {
      assertEquivalent(`
        function f() {
          var arr = [${values.join(",")}];
          var results = [];
          for (var i = 0; i < arr.length; i++) {
            try {
              if (i === ${throwIdx}) throw new Error("stop:" + arr[i]);
              results.push(arr[i] * 2);
            } catch (e) {
              results.push("E:" + e.message);
            }
          }
          return results;
        }
        f();
      `);
    });
  }
});

// ---------------------------------------------------------------------------
// 14. Rolling cipher correctness with random inputs
// ---------------------------------------------------------------------------

describe("randomized: rolling cipher correctness", () => {
  const rcOpts = { rollingCipher: true };

  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const a = randInt(-500, 500);
    const b = randInt(-500, 500);
    it(`rolling cipher: ${a} + ${b}`, () => {
      assertEquivalent(`
        function add(a, b) { return a + b; }
        add(${a}, ${b});
      `, rcOpts);
    });
  }

  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const arr = randArray(randInt(5, 10), () => randInt(-100, 100));
    it(`rolling cipher: sort ${arr.length} elements`, () => {
      assertEquivalent(`
        function f(arr) {
          return arr.slice().sort(function(a, b) { return a - b; });
        }
        f([${arr.join(",")}]);
      `, rcOpts);
    });
  }

  for (let trial = 0; trial < 3 * FUZZ_MULTIPLIER; trial++) {
    const n = randInt(5, 12);
    it(`rolling cipher: fibonacci(${n})`, () => {
      assertEquivalent(`
        function fib(n) {
          if (n <= 1) return n;
          return fib(n - 1) + fib(n - 2);
        }
        fib(${n});
      `, rcOpts);
    });
  }
});

// ---------------------------------------------------------------------------
// 15. Integrity binding correctness with random inputs
// ---------------------------------------------------------------------------

describe("randomized: integrity binding correctness", () => {
  const ibOpts = { rollingCipher: true, integrityBinding: true };

  for (let trial = 0; trial < 5 * FUZZ_MULTIPLIER; trial++) {
    const a = randInt(-500, 500);
    const b = randInt(-500, 500);
    it(`integrity binding: ${a} * ${b}`, () => {
      assertEquivalent(`
        function mul(a, b) { return a * b; }
        mul(${a}, ${b});
      `, ibOpts);
    });
  }

  for (let trial = 0; trial < 3 * FUZZ_MULTIPLIER; trial++) {
    const arr = randArray(randInt(4, 8), () => randInt(0, 50));
    it(`integrity binding: reduce sum of ${arr.length} items`, () => {
      assertEquivalent(`
        function f(arr) {
          return arr.reduce(function(a, b) { return a + b; }, 0);
        }
        f([${arr.join(",")}]);
      `, ibOpts);
    });
  }

  for (let trial = 0; trial < 3 * FUZZ_MULTIPLIER; trial++) {
    const s = randString(randInt(5, 15));
    it(`integrity binding: string ops on "${s.substring(0, 8)}..."`, () => {
      assertEquivalent(`
        function f(s) {
          return [s.length, s.toUpperCase(), s.indexOf("${s.charAt(0)}")];
        }
        f("${s}");
      `, ibOpts);
    });
  }
});

// ---------------------------------------------------------------------------
// 16. Presets with random inputs
// ---------------------------------------------------------------------------

describe("randomized: presets", () => {
  const presets = ["low", "medium", "high"] as const;

  for (const preset of presets) {
    for (let trial = 0; trial < 3 * FUZZ_MULTIPLIER; trial++) {
      const a = randInt(-100, 100);
      const b = randInt(-100, 100);
      it(`preset "${preset}": add(${a}, ${b})`, () => {
        assertEquivalent(`
          function add(a, b) { return a + b; }
          add(${a}, ${b});
        `, { preset });
      });
    }

    for (let trial = 0; trial < 2 * FUZZ_MULTIPLIER; trial++) {
      const arr = randArray(randInt(3, 6), () => randInt(0, 50));
      it(`preset "${preset}": sum of ${arr.length} items`, () => {
        assertEquivalent(`
          function sum(arr) {
            var total = 0;
            for (var i = 0; i < arr.length; i++) total += arr[i];
            return total;
          }
          sum([${arr.join(",")}]);
        `, { preset });
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 17. Deep nesting with random depth/values
// ---------------------------------------------------------------------------

describe("randomized: deep nesting", () => {
  for (let trial = 0; trial < 3 * FUZZ_MULTIPLIER; trial++) {
    const depth = randInt(3, 7);
    const values = randArray(depth, () => randInt(1, 10));

    it(`${depth}-level nested closures`, () => {
      // Build nested function source dynamically
      let src = `function test() {\n`;
      for (let i = 0; i < depth; i++) {
        src += `${"  ".repeat(i + 1)}var v${i} = ${values[i]};\n`;
        if (i < depth - 1) {
          src += `${"  ".repeat(i + 1)}function f${i}() {\n`;
        }
      }
      // Innermost: return sum of all values
      const sumExpr = values.map((_, i) => `v${i}`).join(" + ");
      src += `${"  ".repeat(depth)}return ${sumExpr};\n`;
      for (let i = depth - 2; i >= 0; i--) {
        src += `${"  ".repeat(i + 1)}}\n`;
        src += `${"  ".repeat(i + 1)}return f${i}();\n`;
      }
      src += `}\ntest();`;
      assertEquivalent(src);
    });
  }

  for (let trial = 0; trial < 3 * FUZZ_MULTIPLIER; trial++) {
    const depth = randInt(3, 6);
    const values = randArray(depth, () => randInt(1, 20));

    it(`${depth}-level nested if/else`, () => {
      const conditions = values.map((v, i) =>
        `${"  ".repeat(i + 2)}if (x > ${v * (depth - i)}) {\n${"  ".repeat(i + 3)}result = "${i}:above";\n${"  ".repeat(i + 2)}} else {`
      ).join("\n");
      const closes = values.map((_, i) =>
        `${"  ".repeat(depth - i + 1)}}`
      ).join("\n");

      assertEquivalent(`
        function classify(x) {
          var result = "base";
${conditions}
${"  ".repeat(depth + 2)}result = "bottom";
${closes}
          return result;
        }
        classify(${randInt(0, 100)});
      `);
    });
  }
});
