import { describe, it } from "vitest";
import { assertEquivalent } from "./helpers.js";

describe("comprehensive array operations", () => {
  // === 1. Array creation ===

  it("creates array with literal syntax", () => {
    assertEquivalent(`
      function f() { return [1, 2, 3, 4, 5]; }
      f();
    `);
  });

  it("creates array with new Array and fill method", () => {
    assertEquivalent(`
      function f() {
        var arr = new Array(5).fill(0);
        return arr.map(function(_, i) { return i * 2; });
      }
      f();
    `);
  });

  it("creates array with Array.from on array-like", () => {
    assertEquivalent(`
      function f() {
        return Array.from({length: 5}, function(_, i) { return i + 1; });
      }
      f();
    `);
  });

  it("creates array with Array.from on string", () => {
    assertEquivalent(`
      function f() {
        return Array.from("hello");
      }
      f();
    `);
  });

  it("creates array with Array.of", () => {
    assertEquivalent(`
      function f() {
        return Array.of(1, 2, 3, 4);
      }
      f();
    `);
  });

  it("Array.of vs Array constructor difference", () => {
    assertEquivalent(`
      function f() {
        return [Array.of(3).length, Array.of(3)[0]];
      }
      f();
    `);
  });

  // === 2. Array methods: push, pop, shift, unshift, splice, slice ===

  it("push appends elements and returns new length", () => {
    assertEquivalent(`
      function f() {
        var arr = [1, 2];
        var len = arr.push(3, 4, 5);
        return [arr, len];
      }
      f();
    `);
  });

  it("pop removes and returns last element", () => {
    assertEquivalent(`
      function f() {
        var arr = [10, 20, 30];
        var last = arr.pop();
        return [arr, last];
      }
      f();
    `);
  });

  it("shift removes and returns first element", () => {
    assertEquivalent(`
      function f() {
        var arr = [10, 20, 30];
        var first = arr.shift();
        return [arr, first];
      }
      f();
    `);
  });

  it("unshift prepends elements and returns new length", () => {
    assertEquivalent(`
      function f() {
        var arr = [3, 4];
        var len = arr.unshift(1, 2);
        return [arr, len];
      }
      f();
    `);
  });

  it("splice removes elements from middle", () => {
    assertEquivalent(`
      function f() {
        var arr = [1, 2, 3, 4, 5];
        var removed = arr.splice(1, 2);
        return [arr, removed];
      }
      f();
    `);
  });

  it("splice inserts elements at position", () => {
    assertEquivalent(`
      function f() {
        var arr = [1, 4, 5];
        arr.splice(1, 0, 2, 3);
        return arr;
      }
      f();
    `);
  });

  it("splice replaces elements", () => {
    assertEquivalent(`
      function f() {
        var arr = [1, 2, 3, 4, 5];
        var removed = arr.splice(2, 1, 30, 40);
        return [arr, removed];
      }
      f();
    `);
  });

  it("slice extracts a portion without mutation", () => {
    assertEquivalent(`
      function f() {
        var arr = [10, 20, 30, 40, 50];
        return [arr.slice(1, 3), arr.slice(-2), arr.slice(0), arr];
      }
      f();
    `);
  });

  // === 3. Array iteration: forEach, map, filter, reduce, reduceRight, every, some, find, findIndex ===

  it("forEach iterates and accumulates side effects", () => {
    assertEquivalent(`
      function f() {
        var result = [];
        [1, 2, 3].forEach(function(x) { result.push(x * 10); });
        return result;
      }
      f();
    `);
  });

  it("map transforms each element", () => {
    assertEquivalent(`
      function f() {
        return [1, 2, 3, 4].map(function(x) { return x * x; });
      }
      f();
    `);
  });

  it("map passes index as second argument", () => {
    assertEquivalent(`
      function f() {
        return ["a", "b", "c"].map(function(val, idx) { return idx + ":" + val; });
      }
      f();
    `);
  });

  it("filter selects matching elements", () => {
    assertEquivalent(`
      function f() {
        return [1, 2, 3, 4, 5, 6].filter(function(x) { return x % 2 === 0; });
      }
      f();
    `);
  });

  it("reduce accumulates a single value left-to-right", () => {
    assertEquivalent(`
      function f() {
        return [1, 2, 3, 4, 5].reduce(function(acc, x) { return acc + x; }, 0);
      }
      f();
    `);
  });

  it("reduce without initial value uses first element", () => {
    assertEquivalent(`
      function f() {
        return [10, 20, 30].reduce(function(acc, x) { return acc + x; });
      }
      f();
    `);
  });

  it("reduceRight accumulates right-to-left", () => {
    assertEquivalent(`
      function f() {
        return [[1, 2], [3, 4], [5, 6]].reduceRight(function(acc, x) { return acc.concat(x); }, []);
      }
      f();
    `);
  });

  it("every checks all elements satisfy predicate", () => {
    assertEquivalent(`
      function f() {
        return [
          [2, 4, 6, 8].every(function(x) { return x % 2 === 0; }),
          [2, 4, 5, 8].every(function(x) { return x % 2 === 0; })
        ];
      }
      f();
    `);
  });

  it("some checks at least one element satisfies predicate", () => {
    assertEquivalent(`
      function f() {
        return [
          [1, 3, 5, 6].some(function(x) { return x % 2 === 0; }),
          [1, 3, 5, 7].some(function(x) { return x % 2 === 0; })
        ];
      }
      f();
    `);
  });

  it("find returns first matching element", () => {
    assertEquivalent(`
      function f() {
        var arr = [5, 12, 8, 130, 44];
        return arr.find(function(x) { return x > 10; });
      }
      f();
    `);
  });

  it("find returns undefined when no match", () => {
    assertEquivalent(`
      function f() {
        var arr = [1, 2, 3];
        return arr.find(function(x) { return x > 100; });
      }
      f();
    `);
  });

  it("findIndex returns index of first match", () => {
    assertEquivalent(`
      function f() {
        var arr = [5, 12, 8, 130, 44];
        return arr.findIndex(function(x) { return x > 10; });
      }
      f();
    `);
  });

  it("findIndex returns -1 when no match", () => {
    assertEquivalent(`
      function f() {
        return [1, 2, 3].findIndex(function(x) { return x > 100; });
      }
      f();
    `);
  });

  // === 4. Array transformation: flat, flatMap, concat, reverse, sort ===

  it("flat flattens one level by default", () => {
    assertEquivalent(`
      function f() {
        return [1, [2, 3], [4, [5]]].flat();
      }
      f();
    `);
  });

  it("flat with depth parameter", () => {
    assertEquivalent(`
      function f() {
        return [1, [2, [3, [4]]]].flat(2);
      }
      f();
    `);
  });

  it("flatMap maps then flattens one level", () => {
    assertEquivalent(`
      function f() {
        return [1, 2, 3].flatMap(function(x) { return [x, x * 2]; });
      }
      f();
    `);
  });

  it("concat merges arrays without mutation", () => {
    assertEquivalent(`
      function f() {
        var a = [1, 2];
        var b = [3, 4];
        var c = a.concat(b, [5, 6]);
        return [a, b, c];
      }
      f();
    `);
  });

  it("reverse mutates and returns the array", () => {
    assertEquivalent(`
      function f() {
        var arr = [1, 2, 3, 4, 5];
        var reversed = arr.reverse();
        return [arr, reversed, arr === reversed];
      }
      f();
    `);
  });

  it("sort with numeric comparator", () => {
    assertEquivalent(`
      function f() {
        return [30, 1, 4, 15, 9, 2].sort(function(a, b) { return a - b; });
      }
      f();
    `);
  });

  it("sort with descending comparator", () => {
    assertEquivalent(`
      function f() {
        return [30, 1, 4, 15, 9, 2].sort(function(a, b) { return b - a; });
      }
      f();
    `);
  });

  it("sort strings lexicographically by default", () => {
    assertEquivalent(`
      function f() {
        return ["banana", "apple", "cherry", "date"].sort();
      }
      f();
    `);
  });

  // === 5. Array spread ===

  it("spread copies array", () => {
    assertEquivalent(`
      function f() {
        var arr = [1, 2, 3];
        var copy = [].concat(arr);
        copy.push(4);
        return [arr, copy];
      }
      f();
    `);
  });

  it("spread merges two arrays", () => {
    assertEquivalent(`
      function f() {
        var a = [1, 2, 3];
        var b = [4, 5, 6];
        return a.concat(b);
      }
      f();
    `);
  });

  // === 6. Array destructuring ===

  it("destructuring assigns first elements", () => {
    assertEquivalent(`
      function f() {
        var arr = [10, 20, 30];
        var a = arr[0], b = arr[1], c = arr[2];
        return [a, b, c];
      }
      f();
    `);
  });

  it("destructuring with rest via slice", () => {
    assertEquivalent(`
      function f() {
        var arr = [1, 2, 3, 4, 5];
        var first = arr[0];
        var rest = arr.slice(1);
        return [first, rest];
      }
      f();
    `);
  });

  it("destructuring skips elements", () => {
    assertEquivalent(`
      function f() {
        var arr = [1, 2, 3, 4, 5];
        var a = arr[0], c = arr[2], e = arr[4];
        return [a, c, e];
      }
      f();
    `);
  });

  // === 7. Array.isArray ===

  it("Array.isArray distinguishes arrays from non-arrays", () => {
    assertEquivalent(`
      function f() {
        return [
          Array.isArray([]),
          Array.isArray([1, 2]),
          Array.isArray("hello"),
          Array.isArray({length: 3}),
          Array.isArray(null),
          Array.isArray(undefined)
        ];
      }
      f();
    `);
  });

  // === 8. Nested arrays and multi-dimensional operations ===

  it("accesses elements of nested arrays", () => {
    assertEquivalent(`
      function f() {
        var matrix = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
        return [matrix[0][0], matrix[1][1], matrix[2][2]];
      }
      f();
    `);
  });

  it("maps over nested arrays", () => {
    assertEquivalent(`
      function f() {
        var matrix = [[1, 2], [3, 4], [5, 6]];
        return matrix.map(function(row) {
          return row.map(function(x) { return x * 10; });
        });
      }
      f();
    `);
  });

  it("flattens a 2D array with reduce and concat", () => {
    assertEquivalent(`
      function f() {
        var nested = [[1, 2], [3, 4], [5, 6]];
        return nested.reduce(function(acc, row) { return acc.concat(row); }, []);
      }
      f();
    `);
  });

  // === 9. Chaining: arr.filter(...).map(...).reduce(...) ===

  it("chains filter then map", () => {
    assertEquivalent(`
      function f() {
        return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
          .filter(function(x) { return x % 3 === 0; })
          .map(function(x) { return x * x; });
      }
      f();
    `);
  });

  it("chains filter, map, and reduce", () => {
    assertEquivalent(`
      function f() {
        return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
          .filter(function(x) { return x % 2 === 0; })
          .map(function(x) { return x * 3; })
          .reduce(function(acc, x) { return acc + x; }, 0);
      }
      f();
    `);
  });

  it("chains map then sort then join", () => {
    assertEquivalent(`
      function f() {
        return [3, 1, 4, 1, 5, 9]
          .map(function(x) { return x * 2; })
          .sort(function(a, b) { return a - b; })
          .join(", ");
      }
      f();
    `);
  });

  // === 10. Additional array operations ===

  it("indexOf finds element position", () => {
    assertEquivalent(`
      function f() {
        var arr = [10, 20, 30, 20, 10];
        return [arr.indexOf(20), arr.indexOf(50), arr.indexOf(20, 2)];
      }
      f();
    `);
  });

  it("lastIndexOf finds last occurrence", () => {
    assertEquivalent(`
      function f() {
        var arr = [1, 2, 3, 2, 1];
        return [arr.lastIndexOf(2), arr.lastIndexOf(1), arr.lastIndexOf(5)];
      }
      f();
    `);
  });

  it("includes checks for element presence", () => {
    assertEquivalent(`
      function f() {
        var arr = [1, 2, 3, 4, 5];
        return [arr.includes(3), arr.includes(6), arr.includes(1)];
      }
      f();
    `);
  });

  it("join with various separators", () => {
    assertEquivalent(`
      function f() {
        var arr = [1, 2, 3];
        return [arr.join(","), arr.join(" - "), arr.join(""), arr.join()];
      }
      f();
    `);
  });

  it("fill fills elements with a static value", () => {
    assertEquivalent(`
      function f() {
        var arr = [1, 2, 3, 4, 5];
        arr.fill(0, 2, 4);
        return arr;
      }
      f();
    `);
  });

  it("copyWithin copies within the array", () => {
    assertEquivalent(`
      function f() {
        var arr = [1, 2, 3, 4, 5];
        arr.copyWithin(0, 3);
        return arr;
      }
      f();
    `);
  });

  it("entries returns index-value pairs", () => {
    assertEquivalent(`
      function f() {
        var arr = ["a", "b", "c"];
        var result = [];
        var entries = arr.entries();
        var next = entries.next();
        while (!next.done) {
          result.push(next.value);
          next = entries.next();
        }
        return result;
      }
      f();
    `);
  });

  it("keys returns array indices", () => {
    assertEquivalent(`
      function f() {
        var arr = ["x", "y", "z"];
        var result = [];
        var keys = arr.keys();
        var next = keys.next();
        while (!next.done) {
          result.push(next.value);
          next = keys.next();
        }
        return result;
      }
      f();
    `);
  });

  it("values returns array elements via iterator", () => {
    assertEquivalent(`
      function f() {
        var arr = [10, 20, 30];
        var result = [];
        var vals = arr.values();
        var next = vals.next();
        while (!next.done) {
          result.push(next.value);
          next = vals.next();
        }
        return result;
      }
      f();
    `);
  });

  it("array length property and truncation", () => {
    assertEquivalent(`
      function f() {
        var arr = [1, 2, 3, 4, 5];
        arr.length = 3;
        return arr;
      }
      f();
    `);
  });
});
