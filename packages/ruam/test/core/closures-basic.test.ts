import { describe, it } from "vitest";
import { assertEquivalent } from "../helpers.js";

describe("closures", () => {
	it("basic closure captures variable", () => {
		assertEquivalent(`
      function makeAdder(x) {
        return function(y) { return x + y; };
      }
      var add5 = makeAdder(5);
      add5(3);
    `);
	});

	it("counter factory", () => {
		assertEquivalent(`
      function makeCounter() {
        var count = 0;
        return function() { return ++count; };
      }
      var c = makeCounter();
      [c(), c(), c()];
    `);
	});

	it("closure in loop (var)", () => {
		assertEquivalent(`
      function makeArray() {
        var fns = [];
        for (var i = 0; i < 3; i++) {
          fns.push((function(j) { return function() { return j; }; })(i));
        }
        return [fns[0](), fns[1](), fns[2]()];
      }
      makeArray();
    `);
	});

	it("multiple closures sharing scope", () => {
		assertEquivalent(`
      function makeState(init) {
        var val = init;
        return {
          get: function() { return val; },
          set: function(v) { val = v; },
        };
      }
      var s = makeState(10);
      s.set(42);
      s.get();
    `);
	});

	it("nested closures", () => {
		assertEquivalent(`
      function outer(a) {
        return function middle(b) {
          return function inner(c) {
            return a + b + c;
          };
        };
      }
      outer(1)(2)(3);
    `);
	});
});
