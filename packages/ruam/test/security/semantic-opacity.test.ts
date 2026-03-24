/**
 * Tests for the opaque predicate library.
 *
 * Each predicate is emitted to JS source, wrapped in a function(x){return <expr>;},
 * and evaluated against a range of integer inputs to verify the always-true /
 * always-false property holds at runtime.
 */
import { describe, it, expect } from "bun:test";
import { generateOpaquePredicate } from "../../src/ruamvm/opaque-predicates.js";
import { emit } from "../../src/ruamvm/emit.js";
import { id } from "../../src/ruamvm/nodes.js";

/** Integer test values covering negatives, zero, positives, and edge cases. */
const TEST_VALUES = [-1000, -100, -7, -2, -1, 0, 1, 2, 7, 42, 100, 1000];

/** Emit a predicate to a real JS function and invoke it with a test value. */
function evalPredicate(exprJs: string, x: number): boolean {
	// eslint-disable-next-line no-new-func
	return new Function("x", `return !!(${exprJs})`)!(x) as boolean;
}

describe("opaque predicates", () => {
	it("always-true predicates evaluate to true for all integer inputs", () => {
		for (let seed = 0; seed < 100; seed++) {
			const pred = generateOpaquePredicate(id("x"), seed, 0);
			if (!pred.alwaysTrue) continue;
			const js = emit(pred.expr);
			for (const x of TEST_VALUES) {
				const result = evalPredicate(js, x);
				expect(result).toBe(true);
			}
		}
	});

	it("always-false predicates evaluate to false for all integer inputs", () => {
		for (let seed = 0; seed < 100; seed++) {
			const pred = generateOpaquePredicate(id("x"), seed, 0);
			if (pred.alwaysTrue) continue;
			const js = emit(pred.expr);
			for (const x of TEST_VALUES) {
				const result = evalPredicate(js, x);
				expect(result).toBe(false);
			}
		}
	});

	it("produces different predicate families across seeds", () => {
		const exprs = new Set<string>();
		for (let seed = 0; seed < 50; seed++) {
			const pred = generateOpaquePredicate(id("x"), seed, 0);
			exprs.add(emit(pred.expr));
		}
		// At least 3 distinct predicate shapes should appear across 50 seeds
		expect(exprs.size).toBeGreaterThan(2);
	});

	it("is deterministic for the same seed and index", () => {
		const a = generateOpaquePredicate(id("x"), 42, 0);
		const b = generateOpaquePredicate(id("x"), 42, 0);
		expect(emit(a.expr)).toBe(emit(b.expr));
		expect(a.alwaysTrue).toBe(b.alwaysTrue);
	});

	it("different indices produce independent PRNG streams", () => {
		// With index isolation, index 0 and index 1 should sometimes differ
		const diffCount = Array.from({ length: 20 }, (_, i) => {
			const p0 = generateOpaquePredicate(id("x"), i, 0);
			const p1 = generateOpaquePredicate(id("x"), i, 1);
			return emit(p0.expr) !== emit(p1.expr) ? 1 : 0;
		}).reduce((a, b) => a + b, 0);
		expect(diffCount).toBeGreaterThan(0);
	});

	it("all 5 predicate families are reachable across seeds 0-200", () => {
		const seen = new Set<string>();
		for (let seed = 0; seed < 200; seed++) {
			const pred = generateOpaquePredicate(id("x"), seed, 0);
			seen.add(emit(pred.expr));
		}
		// 5 distinct families — all should appear within 200 seeds
		expect(seen.size).toBe(5);
	});
});
