/**
 * Handler fragmentation — splits opcode handlers into interleaved fragments.
 *
 * Each handler's case body is split into 2-3 fragments assigned unique
 * case labels from a shuffled pool. Non-terminal fragments chain to the
 * next via a next-fragment variable and `continue`; terminal fragments
 * `break` out normally. All fragments from all handlers are shuffled.
 *
 * The result is a flat state machine with hundreds of interleaved
 * micro-states — looking at any single `case` reveals only a fraction
 * of what an opcode does.
 *
 * @module ruamvm/handler-fragmentation
 */

import type { CaseClause, JsNode } from "./nodes.js";
import {
	caseClause,
	lit,
	exprStmt,
	assign,
	id,
	breakStmt,
	continueStmt,
} from "./nodes.js";
import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";

// --- LCG PRNG ---

function makeLcg(seed: number) {
	let s = seed >>> 0;
	return {
		next(): number {
			s = (s * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
			return s;
		},
	};
}

// --- Fragment splitting ---

/**
 * Determine how many fragments a handler body should be split into.
 * Bodies with <=1 real statement → no split.
 * Bodies with 2 real statements → 2 fragments.
 * Bodies with 3+ real statements → 2 or 3 fragments (seeded random).
 */
function chooseFragmentCount(
	realStmtCount: number,
	lcg: { next(): number }
): number {
	if (realStmtCount <= 1) return 1;
	if (realStmtCount === 2) return 2;
	return 2 + (lcg.next() % 2);
}

/**
 * Split statements into N roughly-equal groups.
 * Guarantees no empty groups (absorbs leftovers into last group).
 */
function splitIntoGroups(stmts: JsNode[], n: number): JsNode[][] {
	if (n <= 1 || stmts.length === 0) return [stmts];
	const groups: JsNode[][] = [];
	const base = Math.floor(stmts.length / n);
	const rem = stmts.length % n;
	let off = 0;
	for (let i = 0; i < n; i++) {
		const sz = base + (i < rem ? 1 : 0);
		groups.push(stmts.slice(off, off + sz));
		off += sz;
	}
	return groups.filter((g) => g.length > 0);
}

// --- Main API ---

/** Result of fragmenting handler cases. */
export interface FragmentResult {
	/** Fragmented + shuffled case clauses (with default case last). */
	cases: CaseClause[];
	/**
	 * Map from original handler-index label value to the first-fragment ID.
	 * Used to update the handler table init statements.
	 */
	labelMap: Map<number, number>;
}

/**
 * Fragment handler case clauses into interleaved micro-states.
 *
 * @param cases - Original handler case clauses (with handler-index labels).
 *                Must include a default case (label === null) as last entry.
 * @param nfName - Variable name for the next-fragment dispatch variable.
 * @param seed - LCG seed for deterministic splitting and shuffling.
 * @returns Fragmented cases and a label remapping table.
 */
export function fragmentCases(
	cases: CaseClause[],
	nfName: string,
	seed: number
): FragmentResult {
	const lcg = makeLcg(seed);

	// Separate real cases from default
	const realCases: CaseClause[] = [];
	let defaultCase: CaseClause | undefined;
	for (const c of cases) {
		if (c.label === null) defaultCase = c;
		else realCases.push(c);
	}

	// Plan fragments for each handler
	type FragPlan = {
		originalLabel: number; // handler-index value
		fragments: JsNode[][]; // statement groups (last includes break)
	};

	const plans: FragPlan[] = [];
	let totalFragments = 0;

	for (const c of realCases) {
		const labelVal =
			c.label!.type === "Literal" ? (c.label!.value as number) : -1;
		const body = c.body;

		// Separate break from logic
		const stmts = body.filter((s) => s.type !== "BreakStmt");
		const nFrags = chooseFragmentCount(stmts.length, lcg);

		if (nFrags <= 1) {
			// Keep as single fragment with break
			plans.push({ originalLabel: labelVal, fragments: [body] });
			totalFragments += 1;
		} else {
			const groups = splitIntoGroups(stmts, nFrags);
			plans.push({ originalLabel: labelVal, fragments: groups });
			totalFragments += groups.length;
		}
	}

	// Assign shuffled fragment IDs
	const fragIds = Array.from({ length: totalFragments }, (_, i) => i);
	for (let i = fragIds.length - 1; i > 0; i--) {
		const j = lcg.next() % (i + 1);
		[fragIds[i]!, fragIds[j]!] = [fragIds[j]!, fragIds[i]!];
	}

	// Build fragment case clauses and label map
	const labelMap = new Map<number, number>();
	const fragCases: CaseClause[] = [];
	let cursor = 0;

	for (const plan of plans) {
		const firstFragId = fragIds[cursor]!;
		labelMap.set(plan.originalLabel, firstFragId);

		for (let f = 0; f < plan.fragments.length; f++) {
			const fragId = fragIds[cursor]!;
			const fragBody = plan.fragments[f]!;
			const isTerminal = f === plan.fragments.length - 1;

			if (isTerminal) {
				// Terminal: keep body as-is (single-fragment handlers
				// already have break; multi-fragment terminals need break added)
				const hasBreak = fragBody.some((s) => s.type === "BreakStmt");
				fragCases.push(
					caseClause(
						lit(fragId),
						hasBreak ? fragBody : [...fragBody, breakStmt()]
					)
				);
			} else {
				// Non-terminal: chain to next fragment
				const nextFragId = fragIds[cursor + 1]!;
				fragCases.push(
					caseClause(lit(fragId), [
						...fragBody,
						exprStmt(assign(id(nfName), lit(nextFragId))),
						continueStmt(),
					])
				);
			}
			cursor++;
		}
	}

	// Shuffle all fragment cases
	for (let i = fragCases.length - 1; i > 0; i--) {
		const j = lcg.next() % (i + 1);
		[fragCases[i]!, fragCases[j]!] = [fragCases[j]!, fragCases[i]!];
	}

	// Append default case last
	if (defaultCase) {
		fragCases.push(defaultCase);
	} else {
		fragCases.push(caseClause(null, [breakStmt()]));
	}

	return { cases: fragCases, labelMap };
}
