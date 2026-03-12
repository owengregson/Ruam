/**
 * Runtime identifier name generator.
 *
 * Produces randomized internal variable names for the VM runtime,
 * making the output look like generic minified code rather than
 * an obvious VM interpreter.
 *
 * All generated names (RuntimeNames + TempNames) come from a single
 * LCG sequence sharing one `used` set, guaranteeing zero collisions
 * and per-build variation for every `_`-prefixed identifier in the output.
 *
 * @module encoding/names
 */

import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";

/**
 * Mapping of logical role to generated identifier name for all
 * runtime-internal variables and functions.
 */
export interface RuntimeNames {
	/** Bytecode table. */
	bt: string;
	/** VM dispatch function (exposed globally). */
	vm: string;
	/** Synchronous interpreter. */
	exec: string;
	/** Asynchronous interpreter. */
	execAsync: string;
	/** Bytecode unit loader. */
	load: string;
	/** Unit cache object. */
	cache: string;
	/** Recursion depth counter. */
	depth: string;
	/** Call stack for error messages. */
	callStack: string;
	/** Environment fingerprint function. */
	fp: string;
	/** RC4 cipher function. */
	rc4: string;
	/** Base64 decoder function. */
	b64: string;
	/** Binary deserializer function. */
	deser: string;
	/** Debug log function. */
	dbg: string;
	/** Debug opcode log function. */
	dbgOp: string;
	/** Debug config object. */
	dbgCfg: string;
	/** Debug protection IIFE name. */
	dbgProt: string;

	// Interpreter local names — disguise the stack-machine pattern
	/** Stack array (was `stack`). */
	stk: string;
	/** Stack pointer (was `sp`). */
	stp: string;

	// Interpreter internal locals — disguise the VM pattern
	/** operand variable */
	operand: string;
	/** scope variable */
	scope: string;
	/** regs (register array) variable */
	regs: string;
	/** ip (instruction pointer) variable */
	ip: string;
	/** C (constants array) variable */
	cArr: string;
	/** I (instructions array) variable */
	iArr: string;
	/** exStack (exception handler stack) */
	exStk: string;
	/** pendingEx variable */
	pEx: string;
	/** hasPendingEx variable */
	hPEx: string;
	/** Completion type (0=none, 1=return). */
	cType: string;
	/** Completion value (saved return). */
	cVal: string;
	/** unit parameter */
	unit: string;
	/** args parameter */
	args: string;
	/** outerScope parameter */
	outer: string;
	/** thisVal parameter */
	tVal: string;
	/** newTarget parameter */
	nTgt: string;
	/** homeObject parameter (for [[HomeObject]] / super resolution). */
	ho: string;
	/** phys (physical opcode) variable */
	phys: string;
	/** op (logical opcode) variable */
	opVar: string;
	/** threshold (debug protection) */
	thresh: string;

	// Scope object property names
	/** scope.parent */
	sPar: string;
	/** scope.vars */
	sVars: string;
	/** scope.tdzVars */
	sTdz: string;

	// String constant decoder
	/** String decoder function (XOR-decodes encoded constant pool strings). */
	strDec: string;

	// Indexed scope slots
	/** Function slots array (captured vars stored as indexed array). */
	fSlots: string;

	// Rolling cipher runtime names
	/** Rolling cipher state variable. */
	rcState: string;
	/** Rolling cipher derive-key function. */
	rcDeriveKey: string;
	/** Rolling cipher mix function. */
	rcMix: string;
	/** Integrity hash variable (stores computed hash). */
	ihash: string;
	/** Integrity hash function (FNV-1a). */
	ihashFn: string;

	// Watermark — looks like an essential variable
	/** Watermark variable name (_ru4m). */
	wm: string;

	// VM Shielding router
	/** Router function name (used in vmShielding mode). */
	router: string;
	/** Route map object (maps unit IDs to group dispatch functions). */
	routeMap: string;
}

// --- TempNames ---

/**
 * Randomized names for handler/builder temporary variables and
 * internal object property keys.
 *
 * Every `_`-prefixed identifier in the generated runtime code is
 * represented here. The canonical key (e.g. `"_ci"`) maps to a
 * per-build randomized name, guaranteeing:
 *   1. No collisions with RuntimeNames
 *   2. No fixed fingerprint across builds
 */
export type TempNames = Readonly<Record<string, string>>;

/**
 * Canonical names for all handler/builder temporaries.
 * Organized by scope of usage.
 */
const TEMP_NAME_CATALOG: readonly string[] = [
	// --- Handler case-body local variables (interpreter function scope) ---
	"_a", // arguments array (stack.ts, helpers.ts, functions.ts)
	"_b", // temp (stack.ts)
	"_rv", // return value (control-flow.ts)
	"_rv2", // return value 2 (exceptions.ts)
	"_te", // thrown exception (control-flow.ts)
	"_cu", // current unit (functions.ts, helpers.ts)
	"_cuid", // closure unit ID (functions.ts)
	"_fu", // function unit (functions.ts)
	"_fuid", // function unit ID (functions.ts)
	"_tv", // this value (helpers.ts, functions.ts)
	"_tt", // type test (helpers.ts)
	"_tgt", // target (classes.ts)
	"_tf", // type found (scope.ts)

	// --- Internal object property keys (cross-handler consistency) ---
	"_ci", // catch index (exception handler objects)
	"_fi", // finally index (exception handler objects)
	"_sp", // stack pointer (exception handler objects)
	"_iter", // iterator (iterator objects)
	"_done", // done flag (iterator objects)
	"_value", // value (iterator objects)
	"_async", // async flag (iterator objects)
	"_keys", // keys array (for-in objects)
	"_idx", // index (for-in objects)
	"_ho", // home object (function objects)
	"_dbgId", // debug ID (unit objects)
	"_count", // counter (debug config)
	"_opNames", // opcode names (debug config)

	// --- Interpreter scaffold locals ---
	"_uid_", // unit ID for stack trace
	"_uid", // unit ID for debug
	"_g", // global scope
	"_il", // instruction length
	"_ri", // rolling cipher index
	"_ks", // rolling cipher key schedule / object keys
	"_h", // exception handler variable
	"_sek", // stack encoding key
	"_seRaw", // stack encoding raw array

	// --- Runner locals ---
	"_t", // type variable (runners.ts)

	// --- Debug protection locals ---
	"_sev", // severity
	"_dm", // (reserved — preserves LCG sequence)
	"_now", // (reserved — preserves LCG sequence)
	"_th", // (reserved — preserves LCG sequence)
	"_tl", // (reserved — preserves LCG sequence)
	"_pb", // probe list
	"_fh", // FNV hash initial
	"_o", // object (console formatting detection)
	"_hr", // (reserved — preserves LCG sequence)
	"_src", // source code
	"_it", // timeout ID
	"_act", // action handler
	"_gk", // (reserved — preserves LCG sequence)
	"_k", // key (for-in)
	"_p1", // detector function 1 (console formatting)
	"_p2", // (reserved — preserves LCG sequence)
	"_p3", // detector function 3 (environment analysis)
	"_p4", // detector function 4 (integrity self-check)
	"_p5", // (reserved — preserves LCG sequence)
	"_p6", // (reserved — preserves LCG sequence)
	"_run", // debug protection runner
	"_s1", // (reserved — preserves LCG sequence)
	"_s2", // (reserved — preserves LCG sequence)
	"_e1", // (reserved — preserves LCG sequence)
	"_e2", // (reserved — preserves LCG sequence)
	"_ts", // toString result
	"_i", // loop iterator
	"_s", // (reserved — preserves LCG sequence)
	"_sm", // (reserved — preserves LCG sequence)
	"_av", // (reserved — preserves LCG sequence)
	"_vr", // (reserved — preserves LCG sequence)
	"_d", // difference / detection flag
	"_st", // stack trace
	"_cs", // checksum source
	"_ch", // checksum hash
	"_nc", // native code string
	"_fn", // function list
	"_ft", // function toString
	"_n", // count
	"_det", // detection flag
	"_nx", // next timeout
	"_tid", // timeout ID
	"_ki", // keys index
	"_ue", // user entry
	"_ji", // jitter index
	"_ps", // program scope (outer scope for top-level dispatch)
	"_psv", // program scope vars reference

	// --- Interpreter dispatch indirection ---
	"_ht", // handler lookup table (interpreter dispatch indirection)
	"_nf", // next-fragment variable (handler fragmentation dispatch)
] as const;

/** The watermark variable name — always `_ru4m`. */
export const WATERMARK_NAME = "_ru4m";

const ALPHA = "abcdefghijklmnopqrstuvwxyz";
const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";

// --- Name generation ---

/**
 * Create an LCG-based name generator.
 *
 * All names produced by the returned `genName()` are guaranteed unique
 * within the `used` set. An external `used` set can be provided to
 * enforce cross-generator uniqueness (e.g. across shielding groups
 * that share the same IIFE scope).
 */
function createNameGenerator(seed: number, externalUsed?: Set<string>) {
	const used = externalUsed ?? new Set<string>();
	let s = seed >>> 0;

	function lcg(): number {
		s = (s * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
		return s;
	}

	function genName(): string {
		let minLen = 2;
		for (let attempt = 0; ; attempt++) {
			if (attempt > 10000) {
				throw new Error("Runtime name pool exhausted");
			}
			// After repeated collisions, increase minimum length
			// to skip saturated short-name buckets.
			if (attempt > 0 && attempt % 50 === 0 && minLen < 6) {
				minLen++;
			}
			const range = 7 - minLen; // e.g. minLen=2 → range=5 (2–6)
			const len = minLen + (lcg() % range); // minLen–6 chars after '_'
			let name = "_" + ALPHA[lcg() % ALPHA.length]!;
			for (let i = 1; i < len; i++) {
				name += ALNUM[lcg() % ALNUM.length]!;
			}
			if (!used.has(name)) {
				used.add(name);
				return name;
			}
		}
	}

	return { genName, used };
}

/**
 * Generate randomized runtime identifiers and temp names from a seed.
 *
 * Both RuntimeNames and TempNames are produced from a single LCG
 * sequence with a shared collision-free `used` set, guaranteeing
 * that no two names in the entire output can collide.
 *
 * @param seed - LCG seed for deterministic name generation.
 * @returns RuntimeNames and TempNames.
 */
export function generateRuntimeNames(
	seed: number,
	sharedUsed?: Set<string>
): {
	runtime: RuntimeNames;
	temps: TempNames;
} {
	const { genName } = createNameGenerator(seed, sharedUsed);

	const runtime: RuntimeNames = {
		bt: genName(),
		vm: genName(),
		exec: genName(),
		execAsync: genName(),
		load: genName(),
		cache: genName(),
		depth: genName(),
		callStack: genName(),
		fp: genName(),
		rc4: genName(),
		b64: genName(),
		deser: genName(),
		dbg: genName(),
		dbgOp: genName(),
		dbgCfg: genName(),
		dbgProt: genName(),
		stk: genName(),
		stp: genName(),
		operand: genName(),
		scope: genName(),
		regs: genName(),
		ip: genName(),
		cArr: genName(),
		iArr: genName(),
		exStk: genName(),
		pEx: genName(),
		hPEx: genName(),
		cType: genName(),
		cVal: genName(),
		unit: genName(),
		args: genName(),
		outer: genName(),
		tVal: genName(),
		nTgt: genName(),
		ho: genName(),
		phys: genName(),
		opVar: genName(),
		thresh: genName(),
		sPar: genName(),
		sVars: genName(),
		sTdz: genName(),
		strDec: genName(),
		fSlots: genName(),
		rcState: genName(),
		rcDeriveKey: genName(),
		rcMix: genName(),
		ihash: genName(),
		ihashFn: genName(),
		wm: WATERMARK_NAME,
		router: genName(),
		routeMap: genName(),
	};

	// Generate temp names from the same LCG + used set
	const temps: Record<string, string> = {};
	for (const key of TEMP_NAME_CATALOG) {
		temps[key] = genName();
	}

	return { runtime, temps: temps as TempNames };
}

/** Fields of {@link RuntimeNames} that are shared across all shielding groups. */
const SHARED_NAME_KEYS = [
	"bt",
	"cache",
	"depth",
	"callStack",
	"fp",
	"rc4",
	"b64",
	"deser",
	"dbg",
	"dbgOp",
	"dbgCfg",
	"dbgProt",
	"wm",
	"router",
	"routeMap",
	"sPar",
	"sVars",
	"sTdz",
] as const;

/**
 * Generate a set of shared names plus unique per-group name sets for
 * VM Shielding mode.
 *
 * Shared names (bytecode table, cache, depth, debug, etc.) are
 * consistent across all groups. Per-group names (interpreter locals,
 * rolling cipher, temps, etc.) are unique per group.
 *
 * All groups share a single `used` set to guarantee cross-group
 * uniqueness — all per-group code is emitted into the same IIFE
 * scope, so name collisions between groups would produce runtime
 * errors.
 *
 * @param sharedSeed - Seed for shared infrastructure names.
 * @param groupSeeds - One seed per shielding group.
 * @returns An object with the shared names and an array of per-group names.
 */
export function generateShieldedNames(
	sharedSeed: number,
	groupSeeds: number[]
): {
	shared: RuntimeNames;
	sharedTemps: TempNames;
	groups: RuntimeNames[];
	groupTemps: TempNames[];
} {
	// Single used set shared across all generators to prevent
	// cross-group name collisions in the shared IIFE scope.
	const globalUsed = new Set<string>();

	// Generate shared names from the shared seed
	const { runtime: shared, temps: sharedTemps } = generateRuntimeNames(
		sharedSeed,
		globalUsed
	);

	// Generate per-group names with the shared used set
	const groups: RuntimeNames[] = [];
	const groupTemps: TempNames[] = [];

	for (const groupSeed of groupSeeds) {
		const { runtime: groupNames, temps } = generateRuntimeNames(
			groupSeed,
			globalUsed
		);

		// Override shared fields for cross-group consistency
		for (const key of SHARED_NAME_KEYS) {
			(groupNames as unknown as Record<string, string>)[key] =
				shared[key];
		}

		groups.push(groupNames);
		groupTemps.push(temps);
	}

	return { shared, sharedTemps, groups, groupTemps };
}
