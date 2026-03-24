/**
 * Observation resistance — silently corrupt computation when
 * instrumentation is detected.
 *
 * Function identity binding saves references to critical internal
 * functions at IIFE creation. The verify function checks saved ===
 * current and returns a corruption XOR constant (0 if clean).
 *
 * Monotonic witness counter verifies handler execution order by
 * incrementing a counter in every handler and checking monotonicity
 * in a random subset.
 *
 * WeakMap canary plants a WeakMap-based sentinel at IIFE scope and
 * periodically verifies it has not been monkey-patched or replaced.
 *
 * Stack integrity probes push/pop a known sentinel object onto the
 * stack to detect proxy replacement or encoding tampering.
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
	un,
	id,
	lit,
	call,
	member,
	newExpr,
	ternary,
	BOp,
	UOp,
} from "./nodes.js";
import type { NameRegistry } from "../naming/registry.js";
import {
	LCG_MULTIPLIER,
	LCG_INCREMENT,
	OR_CORRUPT_IDENTITY,
	OR_CORRUPT_WITNESS,
	OR_CORRUPT_CANARY,
	OR_CORRUPT_PROBE,
} from "../constants.js";

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
		s = (Math.imul(s, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
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
		const corruptConst = (corruptSeed || OR_CORRUPT_IDENTITY) >>> 0;

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
			ifStmt(bin(BOp.Sneq, id(refNames[i]!), id(funcNames[i]!)), [
				exprStmt(
					assign(
						id("c"),
						bin(
							BOp.Ushr,
							bin(
								BOp.BitXor,
								id("c"),
								L(corruptionConstants[i]!)
							),
							lit(0)
						)
					)
				),
			])
		);
	}

	verifyBody.push(returnStmt(id("c")));

	// Build the verify function declaration
	const verifyFn = fn(names.orVerify, [], verifyBody);

	return { declarations, verifyFn };
}

// --- Monotonic Witness Counter ---

/** Result from building witness counter declarations and helpers. */
export interface WitnessCounterResult {
	/** IIFE-scope declarations: `var _orW = 0; var _orWv = 0;` */
	declarations: JsNode[];
	/**
	 * Build the increment statement to prepend to every handler body:
	 * `_orW = (_orW + 1) | 0;`
	 */
	incrementStmt: () => JsNode;
	/**
	 * Build the verification check to append to selected handler bodies:
	 * `if (_orW < _orWv) { rcState = (rcState ^ CORRUPT) >>> 0; } _orWv = _orW;`
	 */
	verifyStmts: () => JsNode[];
}

/**
 * Build monotonic witness counter declarations and helpers.
 *
 * Every handler increments a hidden counter. A random subset of
 * handlers verify the counter is still increasing. If someone skips
 * handlers, replays them, or modifies the counter, the verification
 * fails and silently corrupts `rcState`.
 *
 * @param names   Runtime identifier mapping.
 * @param temps   Temp identifier mapping.
 * @param seed    Per-build seed for corruption constant derivation.
 * @param split   Optional constant splitter for numeric obfuscation.
 * @returns Declarations and statement builder functions.
 */
export function buildWitnessCounter(
	names: RuntimeNames,
	temps: TempNames,
	seed: number,
	split?: SplitFn
): WitnessCounterResult {
	const L = (v: number): JsNode => (split ? split(v) : lit(v));

	const orW = temps["_orW"];
	const orWv = temps["_orWv"];
	if (orW === undefined || orWv === undefined) {
		throw new Error("Missing temp names: _orW/_orWv");
	}

	// Per-build corruption constant
	const corruptSeed = deriveSeed(seed, "witnessCorrupt");
	const corruptConst = (corruptSeed || OR_CORRUPT_WITNESS) >>> 0;

	const declarations: JsNode[] = [
		varDecl(orW, lit(0)),
		varDecl(orWv, lit(0)),
	];

	return {
		declarations,
		incrementStmt: () =>
			// _orW = (_orW + 1) | 0;
			exprStmt(
				assign(
					id(orW),
					bin(BOp.BitOr, bin(BOp.Add, id(orW), lit(1)), lit(0))
				)
			),
		verifyStmts: () => [
			// if (_orW < _orWv) { rcState = (rcState ^ CORRUPT) >>> 0; }
			ifStmt(bin(BOp.Lt, id(orW), id(orWv)), [
				exprStmt(
					assign(
						id(names.rcState),
						bin(
							BOp.Ushr,
							bin(BOp.BitXor, id(names.rcState), L(corruptConst)),
							lit(0)
						)
					)
				),
			]),
			// _orWv = _orW;
			exprStmt(assign(id(orWv), id(orW))),
		],
	};
}

// --- WeakMap Canary ---

/** Result from building WeakMap canary declarations and check expression. */
export interface WeakMapCanaryResult {
	/** IIFE-scope declarations: canary object, WeakMap, and initial set. */
	declarations: JsNode[];
	/**
	 * Build the verification expression that returns a corruption constant
	 * when the canary has been tampered with, or 0 when clean.
	 * `(!(_orExp instanceof WeakMap) || _orExp.get(_orRef) !== true) ? CORRUPT : 0`
	 */
	checkExpr: () => JsNode;
}

/**
 * Build WeakMap canary declarations and a verification expression.
 *
 * Plants a WeakMap-based canary at IIFE scope. The canary object is
 * stored as a key in the WeakMap with value `true`. Periodically
 * verify the WeakMap and canary value are intact. Detects
 * monkey-patching of WeakMap or replacement of IIFE-scope variables.
 *
 * @param names   Runtime identifier mapping.
 * @param temps   Temp identifier mapping.
 * @param seed    Per-build seed for corruption constant derivation.
 * @param split   Optional constant splitter for numeric obfuscation.
 * @param registry NameRegistry for collision-safe dynamic naming.
 * @returns Declarations and check expression builder.
 */
export function buildWeakMapCanary(
	names: RuntimeNames,
	temps: TempNames,
	seed: number,
	split?: SplitFn,
	registry?: NameRegistry
): WeakMapCanaryResult {
	const L = (v: number): JsNode => (split ? split(v) : lit(v));

	// Use the canary variable names from temps
	const canaryRef = temps["_orRef"];
	const canaryWm = temps["_orExp"];
	if (canaryRef === undefined || canaryWm === undefined) {
		throw new Error("Missing temp names: _orRef/_orExp");
	}

	// Per-build corruption constant
	const corruptSeed = deriveSeed(seed, "canaryCorrupt");
	const corruptConst = (corruptSeed || OR_CORRUPT_CANARY) >>> 0;

	const declarations: JsNode[] = [
		// var _orRef = {};
		varDecl(canaryRef, call(member(id("Object"), "create"), [lit(null)])),
		// var _orExp = new WeakMap();
		varDecl(canaryWm, newExpr(id("WeakMap"), [])),
		// _orExp.set(_orRef, true);
		exprStmt(call(member(id(canaryWm), "set"), [id(canaryRef), lit(true)])),
	];

	return {
		declarations,
		checkExpr: () =>
			// (!(_orExp instanceof WeakMap) || _orExp.get(_orRef) !== true) ? CORRUPT : 0
			ternary(
				bin(
					BOp.Or,
					un(
						UOp.Not,
						bin(BOp.Instanceof, id(canaryWm), id("WeakMap"))
					),
					bin(
						BOp.Sneq,
						call(member(id(canaryWm), "get"), [id(canaryRef)]),
						lit(true)
					)
				),
				L(corruptConst),
				lit(0)
			),
	};
}

// --- Stack Integrity Probes ---

/** Result from building stack probe statements. */
export interface StackProbeResult {
	/**
	 * Build the probe statements to inject into a handler body.
	 * Pushes tdzSentinel onto the stack, pops it, and verifies identity.
	 * `S.push(tdzSentinel); if (S.pop() !== tdzSentinel) { rcState = (rcState ^ CORRUPT) >>> 0; }`
	 */
	probeStmts: () => JsNode[];
}

/**
 * Build stack integrity probe statements.
 *
 * At pseudo-random intervals, pushes a known sentinel value onto the
 * stack, immediately pops it, and verifies it is the same object
 * (identity check). Detects stack proxy replacement or encoding
 * tampering.
 *
 * @param names   Runtime identifier mapping.
 * @param seed    Per-build seed for corruption constant derivation.
 * @param split   Optional constant splitter for numeric obfuscation.
 * @returns Statement builder function.
 */
export function buildStackProbe(
	names: RuntimeNames,
	seed: number,
	split?: SplitFn
): StackProbeResult {
	const L = (v: number): JsNode => (split ? split(v) : lit(v));

	// Per-build corruption constant
	const corruptSeed = deriveSeed(seed, "probeCorrupt");
	const corruptConst = (corruptSeed || OR_CORRUPT_PROBE) >>> 0;

	return {
		probeStmts: () => [
			// S.push(tdzSentinel);
			exprStmt(
				call(member(id(names.stk), "push"), [id(names.tdzSentinel)])
			),
			// if (S.pop() !== tdzSentinel) { rcState = (rcState ^ CORRUPT) >>> 0; }
			ifStmt(
				bin(
					BOp.Sneq,
					call(member(id(names.stk), "pop"), []),
					id(names.tdzSentinel)
				),
				[
					exprStmt(
						assign(
							id(names.rcState),
							bin(
								BOp.Ushr,
								bin(
									BOp.BitXor,
									id(names.rcState),
									L(corruptConst)
								),
								lit(0)
							)
						)
					),
				]
			),
		],
	};
}
