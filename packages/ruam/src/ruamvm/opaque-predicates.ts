/**
 * Opaque predicate library for handler body injection.
 *
 * Generates always-true or always-false conditions from mathematical
 * properties that are hard to prove statically. Used by semantic opacity
 * to split handler bodies into "real" and "dead" paths.
 *
 * All predicates are valid for int32 inputs. The inputExpr should be
 * bitwise-coerced (e.g., x | 0) to ensure integer semantics.
 *
 * Predicate families:
 *  0 — Quadratic residue (always true):   ((x*x+1)%4) !== 2
 *  1 — Parity product   (always true):    ((x|1)*(x|1))%2 !== 0
 *  2 — Bitwise identity (always true):    (x^x) === 0
 *  3 — Squares mod 4    (always false):   ((x*x)%4) === 3
 *  4 — Double parity    (always false):   ((x&1)+(x&1))%2 !== 0
 *
 * @module ruamvm/opaque-predicates
 */

import { type JsNode, BOp, bin, lit, ifStmt } from "./nodes.js";
import { deriveSeed } from "../naming/scope.js";
import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";

// --- Public types ---

/** An opaque predicate expression together with its statically-known truth value. */
export interface OpaquePredicate {
	/** The condition AST node. Evaluates to `alwaysTrue` for every integer input. */
	expr: JsNode;
	/** True if `expr` is always-true; false if it is always-false. */
	alwaysTrue: boolean;
}

// --- Predicate families ---

/**
 * Generate an opaque predicate for the given input expression.
 *
 * Uses `deriveSeed(seed, "opaque_" + index)` for PRNG isolation so
 * successive calls with different `index` values produce independent streams.
 *
 * @param inputExpr - AST node for the integer input (e.g. `id("x")`)
 * @param seed      - Per-build master seed
 * @param index     - Predicate index for stream isolation
 * @returns An `OpaquePredicate` with `expr` and `alwaysTrue`
 */
export function generateOpaquePredicate(
	inputExpr: JsNode,
	seed: number,
	index: number
): OpaquePredicate {
	const derived = deriveSeed(seed, "opaque_" + index);
	const family =
		((Math.imul(derived, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0) % 5;

	const x = inputExpr;

	switch (family) {
		case 0: {
			// Always true: ((x * x) % 4) !== 2
			// Quadratic residues mod 4 are 0 and 1 — never 2 ✓
			// (The spec description mentions x²+1 but the correct always-true
			//  quadratic-residue predicate uses x² directly: squares mod 4 ∈ {0,1}.)
			const expr = bin(
				BOp.Sneq,
				bin(BOp.Mod, bin(BOp.Mul, x, x), lit(4)),
				lit(2)
			);
			return { expr, alwaysTrue: true };
		}

		case 1: {
			// Always true: ((x | 1) * (x | 1)) % 2 !== 0
			// (x|1) is always odd; odd*odd is always odd; odd%2 === 1 !== 0 ✓
			const xOr1 = bin(BOp.BitOr, x, lit(1));
			const expr = bin(
				BOp.Sneq,
				bin(BOp.Mod, bin(BOp.Mul, xOr1, xOr1), lit(2)),
				lit(0)
			);
			return { expr, alwaysTrue: true };
		}

		case 2: {
			// Always true: (x ^ x) === 0
			// Any value XOR'd with itself is 0 ✓
			const expr = bin(BOp.Seq, bin(BOp.BitXor, x, x), lit(0));
			return { expr, alwaysTrue: true };
		}

		case 3: {
			// Always false: ((x * x) % 4) === 3
			// Squares mod 4 ∈ {0, 1} — never 3 ✓
			const expr = bin(
				BOp.Seq,
				bin(BOp.Mod, bin(BOp.Mul, x, x), lit(4)),
				lit(3)
			);
			return { expr, alwaysTrue: false };
		}

		case 4: {
			// Always false: ((x & 1) + (x & 1)) % 2 !== 0
			// x&1 ∈ {0,1}; (x&1)+(x&1) ∈ {0,2}; both even → %2===0 → !==0 is false ✓
			const xAnd1 = bin(BOp.BitAnd, x, lit(1));
			const expr = bin(
				BOp.Sneq,
				bin(BOp.Mod, bin(BOp.Add, xAnd1, xAnd1), lit(2)),
				lit(0)
			);
			return { expr, alwaysTrue: false };
		}

		default:
			// Unreachable — exhaustive over 5 families
			throw new Error(`Unexpected predicate family: ${family}`);
	}
}

/**
 * Wrap a handler body behind an opaque predicate, routing the real body
 * to the always-taken branch and the dead body to the never-taken branch.
 *
 * @param body      - Real handler statements (executed)
 * @param deadBody  - Dead code statements (never executed)
 * @param predicate - Opaque predicate produced by `generateOpaquePredicate`
 * @returns Wrapped statement array containing a single `if` statement
 */
export function injectOpaquePredicate(
	body: JsNode[],
	deadBody: JsNode[],
	predicate: OpaquePredicate
): JsNode[] {
	if (predicate.alwaysTrue) {
		// Condition is always true → real body in `then`, dead body in `else`
		return [ifStmt(predicate.expr, body, deadBody)];
	} else {
		// Condition is always false → dead body in `then`, real body in `else`
		return [ifStmt(predicate.expr, deadBody, body)];
	}
}
