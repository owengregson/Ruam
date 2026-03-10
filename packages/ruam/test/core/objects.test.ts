import { describe, it } from "vitest";
import { assertEquivalent } from "../helpers.js";

describe("object creation", () => {
  it("creates an empty object literal", () => {
    assertEquivalent(`
      function test() {
        var obj = {};
        return typeof obj;
      }
      test();
    `);
  });

  it("creates an object with properties via literal", () => {
    assertEquivalent(`
      function test() {
        var obj = { a: 1, b: "two", c: true, d: null };
        return [obj.a, obj.b, obj.c, obj.d];
      }
      test();
    `);
  });

  it("creates an object with new Object()", () => {
    assertEquivalent(`
      function test() {
        var obj = new Object();
        obj.x = 10;
        obj.y = 20;
        return [obj.x, obj.y];
      }
      test();
    `);
  });

  it("creates an object with Object.create(null)", () => {
    assertEquivalent(`
      function test() {
        var obj = Object.create(null);
        obj.name = "bare";
        return obj.name;
      }
      test();
    `);
  });

  it("creates an object with Object.create and a prototype", () => {
    assertEquivalent(`
      function test() {
        var proto = { greet: function() { return "hello from " + this.name; } };
        var obj = Object.create(proto);
        obj.name = "child";
        return obj.greet();
      }
      test();
    `);
  });
});

describe("property access", () => {
  it("accesses properties via dot notation", () => {
    assertEquivalent(`
      function test() {
        var obj = { foo: 42, bar: "baz" };
        return obj.foo + obj.bar;
      }
      test();
    `);
  });

  it("accesses properties via bracket notation with string", () => {
    assertEquivalent(`
      function test() {
        var obj = { "hello world": 99, "a-b": 7 };
        return [obj["hello world"], obj["a-b"]];
      }
      test();
    `);
  });

  it("accesses properties via computed bracket notation", () => {
    assertEquivalent(`
      function test() {
        var obj = { alpha: 1, beta: 2, gamma: 3 };
        var keys = ["alpha", "beta", "gamma"];
        var result = [];
        for (var i = 0; i < keys.length; i++) {
          result.push(obj[keys[i]]);
        }
        return result;
      }
      test();
    `);
  });

  it("accesses nested properties with mixed notation", () => {
    assertEquivalent(`
      function test() {
        var obj = { a: { b: { c: [10, 20, 30] } } };
        var key = "c";
        return obj.a["b"][key][1];
      }
      test();
    `);
  });

  it("returns undefined for missing properties", () => {
    assertEquivalent(`
      function test() {
        var obj = { x: 1 };
        return [obj.y, obj["z"]];
      }
      test();
    `);
  });
});

describe("property manipulation", () => {
  it("uses Object.defineProperty to create a non-writable property", () => {
    assertEquivalent(`
      function test() {
        var obj = {};
        Object.defineProperty(obj, "readOnly", {
          value: 42,
          writable: false,
          enumerable: true,
          configurable: false
        });
        return obj.readOnly;
      }
      test();
    `);
  });

  it("uses Object.defineProperty to create a non-enumerable property", () => {
    assertEquivalent(`
      function test() {
        var obj = { a: 1, b: 2 };
        Object.defineProperty(obj, "hidden", {
          value: 99,
          enumerable: false
        });
        return [Object.keys(obj).sort(), obj.hidden];
      }
      test();
    `);
  });

  it("uses Object.assign to merge objects", () => {
    assertEquivalent(`
      function test() {
        var target = { a: 1, b: 2 };
        var source1 = { b: 3, c: 4 };
        var source2 = { c: 5, d: 6 };
        var result = Object.assign(target, source1, source2);
        return [result.a, result.b, result.c, result.d, result === target];
      }
      test();
    `);
  });

  it("uses Object.keys to list enumerable own keys", () => {
    assertEquivalent(`
      function test() {
        var obj = { z: 3, a: 1, m: 2 };
        return Object.keys(obj).sort();
      }
      test();
    `);
  });

  it("uses Object.values to list values", () => {
    assertEquivalent(`
      function test() {
        var obj = { x: 10, y: 20, z: 30 };
        return Object.values(obj).sort(function(a, b) { return a - b; });
      }
      test();
    `);
  });

  it("uses Object.entries to list key-value pairs", () => {
    assertEquivalent(`
      function test() {
        var obj = { name: "Alice", age: 30 };
        var entries = Object.entries(obj).sort(function(a, b) {
          return a[0] < b[0] ? -1 : 1;
        });
        return entries;
      }
      test();
    `);
  });
});

describe("object spread", () => {
  it("spreads one object into another", () => {
    assertEquivalent(`
      function test() {
        var original = { a: 1, b: 2 };
        var copy = Object.assign({}, original, { c: 3 });
        return [copy.a, copy.b, copy.c];
      }
      test();
    `);
  });

  it("later spread properties override earlier ones", () => {
    assertEquivalent(`
      function test() {
        var obj1 = { a: 1, b: 2 };
        var obj2 = { b: 99, c: 3 };
        var merged = Object.assign({}, obj1, obj2);
        return [merged.a, merged.b, merged.c];
      }
      test();
    `);
  });

  it("spread creates a shallow copy", () => {
    assertEquivalent(`
      function test() {
        var inner = { val: 42 };
        var obj1 = { nested: inner };
        var obj2 = Object.assign({}, obj1);
        obj2.nested.val = 100;
        return [obj1.nested.val, obj2.nested.val, obj1.nested === obj2.nested];
      }
      test();
    `);
  });
});

describe("object destructuring", () => {
  it("destructures with matching variable names", () => {
    assertEquivalent(`
      function test() {
        var obj = { a: 10, b: 20, c: 30 };
        var a = obj.a, b = obj.b, c = obj.c;
        return [a, b, c];
      }
      test();
    `);
  });

  it("destructures with renaming", () => {
    assertEquivalent(`
      function test() {
        var obj = { firstName: "John", lastName: "Doe" };
        var x = obj.firstName, y = obj.lastName;
        return x + " " + y;
      }
      test();
    `);
  });

  it("destructures with defaults for missing properties", () => {
    assertEquivalent(`
      function test() {
        var obj = { a: 1 };
        var a = obj.a;
        var b = obj.b !== undefined ? obj.b : 42;
        return [a, b];
      }
      test();
    `);
  });

  it("destructures nested objects", () => {
    assertEquivalent(`
      function test() {
        var data = {
          user: {
            name: "Alice",
            address: { city: "NYC", zip: "10001" }
          }
        };
        var name = data.user.name;
        var city = data.user.address.city;
        var zip = data.user.address.zip;
        return [name, city, zip];
      }
      test();
    `);
  });
});

describe("property shorthand and computed properties", () => {
  it("uses shorthand property names", () => {
    assertEquivalent(`
      function test() {
        var x = 10, y = 20;
        var point = { x: x, y: y };
        return [point.x, point.y];
      }
      test();
    `);
  });

  it("uses computed property names via bracket access", () => {
    assertEquivalent(`
      function test() {
        var obj = { dynamic: "value", other: "stuff" };
        var key = "dynamic";
        return obj[key];
      }
      test();
    `);
  });

  it("reads multiple computed properties in a loop", () => {
    assertEquivalent(`
      function test() {
        var obj = { a: 10, b: 20, c: 30 };
        var keys = Object.keys(obj).sort();
        var values = [];
        for (var i = 0; i < keys.length; i++) {
          values.push(obj[keys[i]]);
        }
        return values;
      }
      test();
    `);
  });
});

describe("getters and setters", () => {
  it("defines a getter with Object.defineProperty", () => {
    assertEquivalent(`
      function test() {
        var obj = { _temp: 100 };
        Object.defineProperty(obj, "tempF", {
          get: function() { return this._temp * 9 / 5 + 32; },
          enumerable: true
        });
        return obj.tempF;
      }
      test();
    `);
  });

  it("defines a setter with Object.defineProperty", () => {
    assertEquivalent(`
      function test() {
        var obj = { _name: "" };
        Object.defineProperty(obj, "name", {
          get: function() { return this._name; },
          set: function(v) { this._name = v.toUpperCase(); },
          enumerable: true
        });
        obj.name = "alice";
        return obj.name;
      }
      test();
    `);
  });

  it("getter and setter interact correctly", () => {
    assertEquivalent(`
      function test() {
        var log = [];
        var obj = { _val: 0 };
        Object.defineProperty(obj, "val", {
          get: function() { log.push("get"); return this._val; },
          set: function(v) { log.push("set:" + v); this._val = v * 2; }
        });
        obj.val = 5;
        var result = obj.val;
        return [result, log];
      }
      test();
    `);
  });
});

describe("property enumeration", () => {
  it("for...in enumerates own and inherited properties", () => {
    assertEquivalent(`
      function test() {
        var parent = { a: 1 };
        var child = Object.create(parent);
        child.b = 2;
        child.c = 3;
        var keys = [];
        for (var k in child) keys.push(k);
        return keys.sort();
      }
      test();
    `);
  });

  it("Object.keys returns only own enumerable properties", () => {
    assertEquivalent(`
      function test() {
        var parent = { inherited: true };
        var child = Object.create(parent);
        child.own = true;
        return Object.keys(child);
      }
      test();
    `);
  });

  it("Object.values returns only own enumerable values", () => {
    assertEquivalent(`
      function test() {
        var obj = { a: 1, b: 2, c: 3 };
        Object.defineProperty(obj, "hidden", { value: 999, enumerable: false });
        return Object.values(obj).sort(function(a, b) { return a - b; });
      }
      test();
    `);
  });

  it("Object.getOwnPropertyNames includes non-enumerable properties", () => {
    assertEquivalent(`
      function test() {
        var obj = { visible: 1 };
        Object.defineProperty(obj, "hidden", { value: 2, enumerable: false });
        return Object.getOwnPropertyNames(obj).sort();
      }
      test();
    `);
  });
});

describe("Object.freeze, Object.seal, Object.isFrozen", () => {
  it("Object.freeze prevents modifications", () => {
    assertEquivalent(`
      function test() {
        "use strict";
        var obj = { a: 1, b: 2 };
        Object.freeze(obj);
        var threw = false;
        try { obj.a = 99; } catch(e) { threw = true; }
        return [obj.a, obj.b, threw, Object.isFrozen(obj)];
      }
      test();
    `);
  });

  it("Object.isFrozen detects frozen objects", () => {
    assertEquivalent(`
      function test() {
        var obj1 = { x: 1 };
        var obj2 = { y: 2 };
        Object.freeze(obj2);
        return [Object.isFrozen(obj1), Object.isFrozen(obj2)];
      }
      test();
    `);
  });

  it("Object.seal prevents adding and deleting but allows modification", () => {
    assertEquivalent(`
      function test() {
        "use strict";
        var obj = { a: 1, b: 2 };
        Object.seal(obj);
        obj.a = 99;
        var addThrew = false;
        try { obj.c = 3; } catch(e) { addThrew = true; }
        var delThrew = false;
        try { delete obj.b; } catch(e) { delThrew = true; }
        return [obj.a, obj.b, addThrew, delThrew, Object.isSealed(obj)];
      }
      test();
    `);
  });
});

describe("prototype chain", () => {
  it("hasOwnProperty distinguishes own from inherited", () => {
    assertEquivalent(`
      function test() {
        var parent = { inherited: true };
        var child = Object.create(parent);
        child.own = true;
        return [
          child.hasOwnProperty("own"),
          child.hasOwnProperty("inherited"),
          "inherited" in child
        ];
      }
      test();
    `);
  });

  it("in operator checks full prototype chain", () => {
    assertEquivalent(`
      function test() {
        var proto = { shared: "yes" };
        var obj = Object.create(proto);
        obj.local = "mine";
        return ["shared" in obj, "local" in obj, "missing" in obj];
      }
      test();
    `);
  });

  it("instanceof checks the prototype chain", () => {
    assertEquivalent(`
      function test() {
        function Animal(name) { this.name = name; }
        function Dog(name) { Animal.call(this, name); }
        Dog.prototype = Object.create(Animal.prototype);
        Dog.prototype.constructor = Dog;
        var d = new Dog("Rex");
        return [d instanceof Dog, d instanceof Animal, d instanceof Object];
      }
      test();
    `);
  });

  it("Object.getPrototypeOf returns the prototype", () => {
    assertEquivalent(`
      function test() {
        var proto = { type: "parent" };
        var obj = Object.create(proto);
        return Object.getPrototypeOf(obj) === proto;
      }
      test();
    `);
  });
});

describe("optional chaining", () => {
  it("optional chaining on existing property returns value", () => {
    assertEquivalent(`
      function test() {
        var obj = { a: { b: { c: 42 } } };
        var result = obj && obj.a && obj.a.b && obj.a.b.c;
        return result;
      }
      test();
    `);
  });

  it("optional chaining on null returns undefined", () => {
    assertEquivalent(`
      function test() {
        var obj = { a: null };
        var result = obj.a && obj.a.b;
        return result;
      }
      test();
    `);
  });

  it("optional chaining on method call", () => {
    assertEquivalent(`
      function test() {
        var obj = {
          greet: function() { return "hello"; }
        };
        var result1 = obj.greet ? obj.greet() : undefined;
        var obj2 = {};
        var result2 = obj2.greet ? obj2.greet() : undefined;
        return [result1, result2];
      }
      test();
    `);
  });

  it("deeply nested optional chaining safety", () => {
    assertEquivalent(`
      function test() {
        var data = { level1: { level2: null } };
        var safe = data && data.level1 && data.level1.level2 && data.level1.level2.level3;
        return safe;
      }
      test();
    `);
  });

  it("optional call on property: obj.prop?.method?.()", () => {
    assertEquivalent(`
      function test() {
        var win = { sessionStorage: { getItem: function(k) { return 'v_' + k; } } };
        var winNull = { sessionStorage: null };
        var winMissing = {};
        var r1 = win.sessionStorage?.getItem?.('key1');
        var r2 = winNull.sessionStorage?.getItem?.('key2');
        var r3 = winMissing.sessionStorage?.getItem?.('key3');
        return [r1, r2, r3];
      }
      test();
    `);
  });

  it("optional call with nullish coalescing: obj.prop?.method?.() ?? fallback", () => {
    assertEquivalent(`
      function test() {
        var win = { sessionStorage: { getItem: function(k) { return 'v_' + k; } } };
        var winNull = { sessionStorage: null };
        var r1 = win.sessionStorage?.getItem?.('key1') ?? 'fallback1';
        var r2 = winNull.sessionStorage?.getItem?.('key2') ?? 'fallback2';
        return [r1, r2];
      }
      test();
    `);
  });

  it("optional call inside try/catch", () => {
    assertEquivalent(`
      function test() {
        var obj = null;
        try {
          return obj?.method?.('arg') ?? 'default';
        } catch(_) {
          return 'caught';
        }
      }
      test();
    `);
  });
});

describe("nullish coalescing with objects", () => {
  it("returns object when not null or undefined", () => {
    assertEquivalent(`
      function test() {
        var obj = { val: 10 };
        var fallback = { val: 99 };
        var result = obj !== null && obj !== undefined ? obj : fallback;
        return result.val;
      }
      test();
    `);
  });

  it("returns default when property is null", () => {
    assertEquivalent(`
      function test() {
        var config = { timeout: null, retries: 3 };
        var timeout = config.timeout !== null && config.timeout !== undefined ? config.timeout : 5000;
        var retries = config.retries !== null && config.retries !== undefined ? config.retries : 1;
        return [timeout, retries];
      }
      test();
    `);
  });

  it("distinguishes null/undefined from falsy values", () => {
    assertEquivalent(`
      function test() {
        var obj = { a: 0, b: "", c: false, d: null, e: undefined };
        var results = [];
        var keys = ["a", "b", "c", "d", "e"];
        for (var i = 0; i < keys.length; i++) {
          var val = obj[keys[i]];
          results.push(val !== null && val !== undefined ? val : "default");
        }
        return results;
      }
      test();
    `);
  });
});
