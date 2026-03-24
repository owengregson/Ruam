/**
 * Observation resistance — silently corrupt computation when
 * instrumentation is detected.
 *
 * Function identity binding saves references to critical internal
 * functions at IIFE creation. The verify function checks saved ===
 * current and returns a corruption XOR constant (0 if clean).
 *
 * @module ruamvm/observation-resistance
 */

import type { RuntimeNames, TempNames } from "../naming/compat-types.js";
import type { JsNode } from "./nodes.js";
import type { SplitFn } from "./constant-splitting.js";
import { deriveSeed } from "../naming/scope.js";
import {
	varDecl,
	fn,
	returnStmt,
	ifStmt,
	exprStmt,
	assign,
	bin,
	id,
	lit,
	BOp,
} from "./nodes.js";
import type { NameRegistry } from "../naming/registry.js";

// --- Candidate Functions ---

/**
 * All candidate RuntimeNames keys for identity binding, ordered by
 * priority.  Each has a `requires` tag so we skip functions that
 * were not actually emitted in the current build.
 */
const BINDING_CANDIDATES: {
	key: keyof RuntimeNames;
	/** Feature gate — the function only exists when this gate is true.
	 *  `"always"` means the function is always emitted. */
	gate: "always" | "rollingCipher" | "encrypt" | "incrementalCipher";
}[] = [
	{ key: "exec", gate: "always" },
	{ key: "load", gate: "always" },
	{ key: "deser", gate: "always" },
	{ key: "vm", gate: "always" },
	{ key: "rcDeriveKey", gate: "rollingCipher" },
	{ key: "rcMix", gate: "rollingCipher" },
	{ key: "b64", gate: "always" },
	{ key: "icBlockKey", gate: "incrementalCipher" },
	{ key: "icMix", gate: "incrementalCipher" },
];

/** Feature gates active for the current build. */
export interface IdentityBindingGates {
	rollingCipher?: boolean;
	encrypt?: boolean;
	incrementalCipher?: boolean;
}

/** Result from building identity binding declarations. */
export interface IdentityBindingResult {
	/** `var _orRefN = functionName;` declarations for IIFE scope. */
	declarations: JsNode[];
	/** `function orVerify(){ ... }` — returns 0 if untampered. */
	verifyFn: JsNode;
}

/**
 * Build function identity binding declarations and a verify function.
 *
 * Selects up to `bindingCount` internal functions from the candidate
 * pool (filtered by active feature gates), saves their references as
 * IIFE-scope variables, and builds an `orVerify()` function that
 * returns a corruption XOR constant when any reference has been
 * replaced (0 when all are clean).
 *
 * @param names        Runtime identifier mapping.
 * @param temps        Temp identifier mapping.
 * @param seed         Per-build seed for deterministic selection.
 * @param bindingCount Number of functions to bind (from tuning).
 * @param gates        Which features are active (controls candidate pool).
 * @param split        Optional constant splitter for numeric obfuscation.
 * @param registry     NameRegistry for collision-safe dynamic naming.
 * @returns Declarations and verify function AST nodes.
 */
export function buildIdentityBindings(
	names: RuntimeNames,
	temps: TempNames,
	seed: number,
	bindingCount: number,
	gates: IdentityBindingGates,
	split?: SplitFn,
	registry?: NameRegistry
): IdentityBindingResult {
	const L = (v: number): JsNode => (split ? split(v) : lit(v));

	// Filter candidates by active feature gates
	const available = BINDING_CANDIDATES.filter((c) => {
		if (c.gate === "always") return true;
		if (c.gate === "rollingCipher") return gates.rollingCipher;
		if (c.gate === "encrypt") return gates.encrypt;
		if (c.gate === "incrementalCipher") return gates.incrementalCipher;
		return false;
	});

	// Deterministic shuffle via seeded LCG
	const selSeed = deriveSeed(seed, "orSelect");
	const pool = available.map((c) => c.key);

	let s = selSeed >>> 0;
	const lcgNext = (): number => {
		s = (Math.imul(s, 0x41c64e6d) + 0x3039) >>> 0;
		return s;
	};
	for (let i = pool.length - 1; i > 0; i--) {
		const j = lcgNext() % (i + 1);
		[pool[i], pool[j]] = [pool[j]!, pool[i]!];
	}

	// Take up to bindingCount
	const selected = pool.slice(0, Math.min(bindingCount, pool.length));

	// Generate dynamic names for the reference variables
	const nameGen = registry
		? registry.createDynamicGenerator("orRef")
		: undefined;

	// Per-build corruption constants derived from seed
	const refNames: string[] = [];
	const funcNames: string[] = [];
	const corruptionConstants: number[] = [];

	for (let i = 0; i < selected.length; i++) {
		const key = selected[i]!;
		const funcName = names[key];

		// Generate a unique reference variable name
		const refName = nameGen
			? nameGen()
			: temps["_orRef"]
				? `${temps["_orRef"]}${i}`
				: `_orRef${i}`;

		// Per-build corruption constant via deriveSeed
		const corruptSeed = deriveSeed(seed, `orCorruption_${i}`);
		// Use the full 32-bit value, ensure non-zero
		const corruptConst = (corruptSeed || 0xdeadbeef) >>> 0;

		refNames.push(refName);
		funcNames.push(funcName);
		corruptionConstants.push(corruptConst);
	}

	// Build declarations: var refName = funcName;
	const declarations: JsNode[] = [];
	for (let i = 0; i < selected.length; i++) {
		declarations.push(varDecl(refNames[i]!, id(funcNames[i]!)));
	}

	// Build verify function body
	// var c = 0;
	// if (refName0 !== funcName0) c = (c ^ CORRUPT0) >>> 0;
	// if (refName1 !== funcName1) c = (c ^ CORRUPT1) >>> 0;
	// ...
	// return c;
	const verifyBody: JsNode[] = [varDecl("c", lit(0))];

	for (let i = 0; i < selected.length; i++) {
		verifyBody.push(
			ifStmt(
				bin(BOp.Sneq, id(refNames[i]!), id(funcNames[i]!)),
				[
					exprStmt(
						assign(
							id("c"),
							bin(
								BOp.Ushr,
								bin(BOp.BitXor, id("c"), L(corruptionConstants[i]!)),
								lit(0)
							)
						)
					),
				]
			)
		);
	}

	verifyBody.push(returnStmt(id("c")));

	// Build the verify function declaration
	const verifyFn = fn(names.orVerify, [], verifyBody);

	return { declarations, verifyFn };
}
