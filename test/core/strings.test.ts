import { describe, it } from "vitest";
import { assertEquivalent } from "../helpers.js";

describe("comprehensive string operations", () => {
  // === 1. String concatenation ===

  it("concatenates two strings with +", () => {
    assertEquivalent(`
      function f() { return "hello" + " " + "world"; }
      f();
    `);
  });

  it("concatenates with += operator", () => {
    assertEquivalent(`
      function f() {
        var s = "foo";
        s += "bar";
        s += "baz";
        return s;
      }
      f();
    `);
  });

  it("concatenates multiple strings in a single expression", () => {
    assertEquivalent(`
      function f() {
        var a = "one";
        var b = "two";
        var c = "three";
        return a + "-" + b + "-" + c;
      }
      f();
    `);
  });

  // === 2. String methods: charAt, charCodeAt, indexOf, lastIndexOf, includes, startsWith, endsWith ===

  it("charAt returns character at given index", () => {
    assertEquivalent(`
      function f() {
        var s = "abcdef";
        return [s.charAt(0), s.charAt(3), s.charAt(5), s.charAt(100)];
      }
      f();
    `);
  });

  it("charCodeAt returns Unicode value at index", () => {
    assertEquivalent(`
      function f() {
        var s = "ABC";
        return [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2)];
      }
      f();
    `);
  });

  it("indexOf finds first occurrence of substring", () => {
    assertEquivalent(`
      function f() {
        var s = "hello world hello";
        return [s.indexOf("hello"), s.indexOf("world"), s.indexOf("xyz")];
      }
      f();
    `);
  });

  it("indexOf with fromIndex parameter", () => {
    assertEquivalent(`
      function f() {
        var s = "abcabc";
        return [s.indexOf("abc", 0), s.indexOf("abc", 1), s.indexOf("abc", 4)];
      }
      f();
    `);
  });

  it("lastIndexOf finds last occurrence of substring", () => {
    assertEquivalent(`
      function f() {
        var s = "banana";
        return [s.lastIndexOf("a"), s.lastIndexOf("na"), s.lastIndexOf("z")];
      }
      f();
    `);
  });

  it("includes checks for substring presence", () => {
    assertEquivalent(`
      function f() {
        var s = "the quick brown fox";
        return [s.includes("quick"), s.includes("slow"), s.includes("fox")];
      }
      f();
    `);
  });

  it("startsWith checks string prefix", () => {
    assertEquivalent(`
      function f() {
        var s = "JavaScript";
        return [s.startsWith("Java"), s.startsWith("Script"), s.startsWith("Jav")];
      }
      f();
    `);
  });

  it("endsWith checks string suffix", () => {
    assertEquivalent(`
      function f() {
        var s = "JavaScript";
        return [s.endsWith("Script"), s.endsWith("Java"), s.endsWith("pt")];
      }
      f();
    `);
  });

  // === 3. String manipulation: slice, substring, substr, replace, replaceAll, split, join ===

  it("slice extracts a portion of the string", () => {
    assertEquivalent(`
      function f() {
        var s = "Hello, World!";
        return [s.slice(0, 5), s.slice(7), s.slice(-6)];
      }
      f();
    `);
  });

  it("slice with negative indices", () => {
    assertEquivalent(`
      function f() {
        var s = "abcdefgh";
        return [s.slice(-3), s.slice(-5, -2), s.slice(2, -1)];
      }
      f();
    `);
  });

  it("substring extracts characters between two indices", () => {
    assertEquivalent(`
      function f() {
        var s = "Mozilla";
        return [s.substring(0, 3), s.substring(3, 7), s.substring(3)];
      }
      f();
    `);
  });

  it("substring swaps arguments when start > end", () => {
    assertEquivalent(`
      function f() {
        var s = "abcdef";
        return [s.substring(4, 1), s.substring(1, 4)];
      }
      f();
    `);
  });

  it("substr extracts from start for given length", () => {
    assertEquivalent(`
      function f() {
        var s = "Hello World";
        return [s.substr(0, 5), s.substr(6), s.substr(-5)];
      }
      f();
    `);
  });

  it("replace replaces first occurrence", () => {
    assertEquivalent(`
      function f() {
        var s = "foo bar foo";
        return s.replace("foo", "baz");
      }
      f();
    `);
  });

  it("replaceAll replaces all occurrences", () => {
    assertEquivalent(`
      function f() {
        var s = "aabbcc aabbcc";
        return s.replaceAll("aa", "xx");
      }
      f();
    `);
  });

  it("split divides string into array", () => {
    assertEquivalent(`
      function f() {
        var s = "one,two,three,four";
        return s.split(",");
      }
      f();
    `);
  });

  it("split with limit parameter", () => {
    assertEquivalent(`
      function f() {
        var s = "a-b-c-d-e";
        return s.split("-", 3);
      }
      f();
    `);
  });

  it("split then join round-trips", () => {
    assertEquivalent(`
      function f() {
        var s = "hello world foo";
        var parts = s.split(" ");
        return parts.join("-");
      }
      f();
    `);
  });

  // === 4. String transformation: toUpperCase, toLowerCase, trim, trimStart, trimEnd, padStart, padEnd ===

  it("toUpperCase converts to uppercase", () => {
    assertEquivalent(`
      function f() { return "hello World 123".toUpperCase(); }
      f();
    `);
  });

  it("toLowerCase converts to lowercase", () => {
    assertEquivalent(`
      function f() { return "HELLO World 123".toLowerCase(); }
      f();
    `);
  });

  it("trim removes whitespace from both ends", () => {
    assertEquivalent(`
      function f() { return "  hello world  ".trim(); }
      f();
    `);
  });

  it("trimStart removes leading whitespace", () => {
    assertEquivalent(`
      function f() { return "  hello  ".trimStart(); }
      f();
    `);
  });

  it("trimEnd removes trailing whitespace", () => {
    assertEquivalent(`
      function f() { return "  hello  ".trimEnd(); }
      f();
    `);
  });

  it("padStart pads string from the beginning", () => {
    assertEquivalent(`
      function f() {
        return ["5".padStart(3, "0"), "42".padStart(5, " "), "abc".padStart(6, "xyz")];
      }
      f();
    `);
  });

  it("padEnd pads string at the end", () => {
    assertEquivalent(`
      function f() {
        return ["5".padEnd(3, "0"), "hi".padEnd(5, "!"), "abc".padEnd(6, "xyz")];
      }
      f();
    `);
  });

  // === 5. String searching: search, match ===

  it("search finds index of a simple pattern", () => {
    assertEquivalent(`
      function f() {
        var s = "hello world";
        return s.search("world");
      }
      f();
    `);
  });

  it("search returns -1 when pattern not found", () => {
    assertEquivalent(`
      function f() {
        var s = "hello world";
        return s.search("xyz");
      }
      f();
    `);
  });

  it("match returns first match for a string pattern", () => {
    assertEquivalent(`
      function f() {
        var s = "cat bat hat";
        var m = s.match("bat");
        return m ? m[0] : null;
      }
      f();
    `);
  });

  // === 6. Template literal behavior via string concat ===

  it("simulates template literal with expressions", () => {
    assertEquivalent(`
      function f() {
        var name = "Alice";
        var age = 30;
        return "My name is " + name + " and I am " + age + " years old.";
      }
      f();
    `);
  });

  it("simulates multi-line template via concatenation", () => {
    assertEquivalent(`
      function f() {
        var x = 10;
        var y = 20;
        return "x = " + x + "\\n" + "y = " + y + "\\n" + "sum = " + (x + y);
      }
      f();
    `);
  });

  // === 7. String coercion ===

  it("number + string coerces number to string", () => {
    assertEquivalent(`
      function f() {
        return [42 + "px", "" + 100, 3.14 + " rad"];
      }
      f();
    `);
  });

  it("boolean + string coerces boolean to string", () => {
    assertEquivalent(`
      function f() {
        return [true + " value", false + " flag", "" + true];
      }
      f();
    `);
  });

  it("String() constructor converts values to strings", () => {
    assertEquivalent(`
      function f() {
        return [String(42), String(true), String(null), String(undefined), String([1,2,3])];
      }
      f();
    `);
  });

  it("coercion with null and undefined in concatenation", () => {
    assertEquivalent(`
      function f() {
        return ["val:" + null, "val:" + undefined];
      }
      f();
    `);
  });

  // === 8. String comparison ===

  it("strict equality between strings", () => {
    assertEquivalent(`
      function f() {
        return ["abc" === "abc", "abc" === "def", "abc" !== "def"];
      }
      f();
    `);
  });

  it("loose equality between string and number", () => {
    assertEquivalent(`
      function f() {
        return ["5" == 5, "5" === 5, "0" == false, "" == false];
      }
      f();
    `);
  });

  it("lexicographic comparison with < and >", () => {
    assertEquivalent(`
      function f() {
        return ["a" < "b", "z" > "a", "abc" < "abd", "abc" > "abb", "A" < "a"];
      }
      f();
    `);
  });

  it("localeCompare compares strings", () => {
    assertEquivalent(`
      function f() {
        var a = "apple";
        var b = "banana";
        var c = "apple";
        return [a.localeCompare(b) < 0, b.localeCompare(a) > 0, a.localeCompare(c) === 0];
      }
      f();
    `);
  });

  // === 9. String.fromCharCode ===

  it("String.fromCharCode creates string from char codes", () => {
    assertEquivalent(`
      function f() {
        return String.fromCharCode(72, 101, 108, 108, 111);
      }
      f();
    `);
  });

  it("round-trips through charCodeAt and fromCharCode", () => {
    assertEquivalent(`
      function f() {
        var s = "Test";
        var codes = [];
        for (var i = 0; i < s.length; i++) {
          codes.push(s.charCodeAt(i));
        }
        return String.fromCharCode.apply(null, codes);
      }
      f();
    `);
  });

  // === 10. repeat, at, String() constructor ===

  it("repeat duplicates the string", () => {
    assertEquivalent(`
      function f() {
        return ["ha".repeat(3), "-".repeat(10), "abc".repeat(0)];
      }
      f();
    `);
  });

  it("at accesses character by index including negative", () => {
    assertEquivalent(`
      function f() {
        var s = "hello";
        return [s.at(0), s.at(2), s.at(-1), s.at(-2)];
      }
      f();
    `);
  });

  it("String constructor wraps primitives", () => {
    assertEquivalent(`
      function f() {
        return [String(0), String(-0), String(NaN), String(Infinity), String(-Infinity)];
      }
      f();
    `);
  });

  // === Additional comprehensive tests ===

  it("string length property", () => {
    assertEquivalent(`
      function f() {
        return ["".length, "abc".length, "hello world".length];
      }
      f();
    `);
  });

  it("bracket notation access for characters", () => {
    assertEquivalent(`
      function f() {
        var s = "abcdef";
        return [s[0], s[2], s[5], s[100]];
      }
      f();
    `);
  });

  it("chaining multiple string methods", () => {
    assertEquivalent(`
      function f() {
        return "  Hello, World!  ".trim().toLowerCase().split(" ").join("_");
      }
      f();
    `);
  });

  it("replace with empty string to remove substring", () => {
    assertEquivalent(`
      function f() {
        return "hello world".replace("world", "").trim();
      }
      f();
    `);
  });

  it("split on empty string produces character array", () => {
    assertEquivalent(`
      function f() {
        return "abc".split("");
      }
      f();
    `);
  });

  it("concat method as alternative to + operator", () => {
    assertEquivalent(`
      function f() {
        return "hello".concat(" ", "world", "!");
      }
      f();
    `);
  });
});
