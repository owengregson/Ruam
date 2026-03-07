/**
 * VM performance benchmark — measures the overhead multiplier of
 * obfuscated code vs native execution.
 *
 * Each benchmark runs the same workload natively and through the VM,
 * averaging over many iterations to produce a stable multiplier.
 */

import { obfuscateCode } from "../../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** High-resolution timer (ms). */
function now(): number {
  return performance.now();
}

/**
 * Time a function over `iterations` runs, returning the median time in ms.
 * Uses median instead of mean to reject outlier GC pauses.
 */
function benchmark(fn: () => unknown, iterations: number): number {
  // Warm up (JIT + caches)
  for (let i = 0; i < Math.min(iterations, 20); i++) fn();

  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = now();
    fn();
    times.push(now() - start);
  }
  times.sort((a, b) => a - b);

  // Trim top/bottom 10% and take mean of the middle 80%
  const trimCount = Math.floor(times.length * 0.1);
  const trimmed = times.slice(trimCount, times.length - trimCount);
  return trimmed.reduce((s, t) => s + t, 0) / trimmed.length;
}

/**
 * Wrap code in a function that can be called repeatedly for benchmarking.
 * Uses indirect eval so each call re-executes the full code.
 */
function makeRunner(code: string): () => unknown {
  // Use vm.Script for fast repeated execution without re-parsing
  const { Script } = require("node:vm");
  const script = new Script(code, { filename: "bench.js" });
  return () => script.runInThisContext();
}

/**
 * Run a performance comparison between native and VM execution.
 * Returns the slowdown multiplier (VM time / native time).
 */
function measureOverhead(
  code: string,
  iterations: number,
): { nativeMs: number; vmMs: number; multiplier: number } {
  const obfuscated = obfuscateCode(code);

  const nativeFn = makeRunner(code);
  const vmFn = makeRunner(obfuscated);

  // Verify correctness first
  const nativeResult = nativeFn();
  const vmResult = vmFn();
  expect(JSON.stringify(vmResult)).toBe(JSON.stringify(nativeResult));

  const nativeMs = benchmark(nativeFn, iterations);
  const vmMs = benchmark(vmFn, iterations);
  const multiplier = vmMs / nativeMs;

  return { nativeMs, vmMs, multiplier };
}

// ---------------------------------------------------------------------------
// Workloads — diverse computation patterns to measure different overheads
// ---------------------------------------------------------------------------

const WORKLOADS: { name: string; code: string }[] = [
  {
    name: "arithmetic loop (10k iterations)",
    code: `
      function work() {
        var sum = 0;
        for (var i = 0; i < 10000; i++) {
          sum += i * 3 - (i % 7);
        }
        return sum;
      }
      work();
    `,
  },
  {
    name: "fibonacci (recursive, n=20)",
    code: `
      function fib(n) {
        if (n <= 1) return n;
        return fib(n - 1) + fib(n - 2);
      }
      fib(20);
    `,
  },
  {
    name: "array manipulation (sort + map + reduce)",
    code: `
      function work() {
        var arr = [];
        for (var i = 0; i < 500; i++) arr.push((i * 17) % 100);
        arr.sort(function(a, b) { return a - b; });
        var mapped = arr.map(function(x) { return x * 2 + 1; });
        return mapped.reduce(function(s, x) { return s + x; }, 0);
      }
      work();
    `,
  },
  {
    name: "string operations (concatenation + manipulation)",
    code: `
      function work() {
        var s = "";
        for (var i = 0; i < 500; i++) {
          s += String.fromCharCode(65 + (i % 26));
        }
        var parts = [];
        for (var j = 0; j < s.length; j += 10) {
          parts.push(s.slice(j, j + 10));
        }
        return parts.join("-");
      }
      work();
    `,
  },
  {
    name: "object creation + property access",
    code: `
      function work() {
        var results = [];
        for (var i = 0; i < 500; i++) {
          var obj = { x: i, y: i * 2, z: i * 3 };
          results.push(obj.x + obj.y + obj.z);
        }
        return results.length;
      }
      work();
    `,
  },
  {
    name: "closures + higher-order functions",
    code: `
      function work() {
        function makeAdder(n) { return function(x) { return x + n; }; }
        var adders = [];
        for (var i = 0; i < 200; i++) adders.push(makeAdder(i));
        var sum = 0;
        for (var j = 0; j < adders.length; j++) sum += adders[j](j);
        return sum;
      }
      work();
    `,
  },
  {
    name: "class instantiation + method calls",
    code: `
      function work() {
        class Point {
          constructor(x, y) { this.x = x; this.y = y; }
          distTo(other) {
            var dx = this.x - other.x;
            var dy = this.y - other.y;
            return Math.sqrt(dx * dx + dy * dy);
          }
        }
        var points = [];
        for (var i = 0; i < 200; i++) points.push(new Point(i, i * 2));
        var total = 0;
        for (var j = 1; j < points.length; j++) total += points[j].distTo(points[j - 1]);
        return Math.round(total * 100) / 100;
      }
      work();
    `,
  },
  {
    name: "try/catch in loop",
    code: `
      function work() {
        var caught = 0;
        for (var i = 0; i < 500; i++) {
          try {
            if (i % 5 === 0) throw new Error("e");
            caught += i;
          } catch (e) {
            caught++;
          }
        }
        return caught;
      }
      work();
    `,
  },
  {
    name: "nested loops with conditionals",
    code: `
      function work() {
        var count = 0;
        for (var i = 0; i < 100; i++) {
          for (var j = 0; j < 100; j++) {
            if ((i + j) % 3 === 0) count++;
            else if ((i * j) % 7 === 0) count += 2;
            else count--;
          }
        }
        return count;
      }
      work();
    `,
  },
  {
    name: "switch statement dispatch",
    code: `
      function work() {
        var sum = 0;
        for (var i = 0; i < 2000; i++) {
          switch (i % 6) {
            case 0: sum += i; break;
            case 1: sum -= i / 2; break;
            case 2: sum += i * 3; break;
            case 3: sum -= i; break;
            case 4: sum += 1; break;
            default: sum += i % 10; break;
          }
        }
        return Math.round(sum);
      }
      work();
    `,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const ITERATIONS = 100; // Per-workload iteration count for stable averaging

describe("VM performance benchmarks", () => {
  const results: { name: string; nativeMs: number; vmMs: number; multiplier: number }[] = [];

  for (const workload of WORKLOADS) {
    it(`benchmark: ${workload.name}`, () => {
      const result = measureOverhead(workload.code, ITERATIONS);
      results.push({ name: workload.name, ...result });

      // Log individual result
      console.log(
        `  ${workload.name}: ${result.multiplier.toFixed(1)}x ` +
        `(native: ${result.nativeMs.toFixed(3)}ms, VM: ${result.vmMs.toFixed(3)}ms)`,
      );

      // Sanity check: VM should produce correct results (already verified in measureOverhead)
      // We don't assert on speed — this is informational
      expect(result.multiplier).toBeGreaterThan(0);
    });
  }

  it("summary: overall VM overhead", () => {
    expect(results.length).toBe(WORKLOADS.length);

    // Compute weighted average (weight by native time to emphasize heavier workloads)
    const totalNative = results.reduce((s, r) => s + r.nativeMs, 0);
    const weightedSum = results.reduce((s, r) => s + r.multiplier * (r.nativeMs / totalNative), 0);

    // Also compute simple median
    const sorted = [...results].sort((a, b) => a.multiplier - b.multiplier);
    const median = sorted[Math.floor(sorted.length / 2)]!.multiplier;

    // Min and max
    const min = sorted[0]!;
    const max = sorted[sorted.length - 1]!;

    console.log("\n  ═══════════════════════════════════════════════════");
    console.log("  VM PERFORMANCE SUMMARY");
    console.log("  ═══════════════════════════════════════════════════");
    console.log(`  Weighted average overhead: ${weightedSum.toFixed(1)}x`);
    console.log(`  Median overhead:           ${median.toFixed(1)}x`);
    console.log(`  Fastest workload:          ${min.multiplier.toFixed(1)}x (${min.name})`);
    console.log(`  Slowest workload:          ${max.multiplier.toFixed(1)}x (${max.name})`);
    console.log("  ═══════════════════════════════════════════════════\n");

    // This test always passes — it's purely informational
    expect(true).toBe(true);
  });
});
