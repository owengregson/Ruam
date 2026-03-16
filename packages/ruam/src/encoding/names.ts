/**
 * Runtime identifier name generator.
 *
 * Produces randomized internal variable names for the VM runtime
 * that look like minifier output (Terser/uglify-style) rather than
 * an obvious VM interpreter.
 *
 * Names are 1–2 character, lowercase letter-only identifiers drawn
 * from a per-build shuffled pool. All generated names (RuntimeNames +
 * TempNames) share a single collision-free `used` set.
 *
 * @module encoding/names
 */

import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";
import { RESERVED } from "../ruamvm/transforms.js";

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
	/** @deprecated Stack pointer eliminated — kept for LCG sequence stability. */
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

	// TDZ sentinel — unique per-build object for temporal dead zone checks
	/** TDZ sentinel variable (IIFE-scope empty object for `===` checks). */
	tdzSentinel: string;

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

	// Key anchor — derived from handler table, used in rolling cipher key derivation.
	// Stored as a closure variable so rcDeriveKey can't be extracted via new Function().
	/** Key anchor variable (combines handler table checksum + optional integrity hash). */
	keyAnchor: string;

	// VM Shielding router
	/** Router function name (used in vmShielding mode). */
	router: string;
	/** Route map object (maps unit IDs to group dispatch functions). */
	routeMap: string;

	// Custom binary encoding
	/** Shuffled alphabet variable for custom binary encoding. */
	alpha: string;

	// Built-in aliases (hoisted to IIFE scope for performance)
	/** Local alias for Math.imul. */
	imul: string;

	// Spread marker
	/** Spread marker Symbol. */
	spreadSym: string;

	// Cached built-in references (hoisted to IIFE scope for performance)
	/** Cached Object.prototype.hasOwnProperty reference. */
	hop: string;
	/** Cached globalThis reference (avoids per-call typeof chain). */
	globalRef: string;

	// Polymorphic decoder + string atomization
	/** Polymorphic decoder function (runtime string decode). */
	polyDec: string;
	/** Polymorphic decoder position seed variable. */
	polyPosSeed: string;
	/** Encoded string table variable. */
	strTbl: string;
	/** String table cache variable. */
	strCache: string;
	/** String table accessor function. */
	strAcc: string;
}

// --- TempNames ---

/**
 * Randomized names for handler/builder temporary variables and
 * internal object property keys.
 *
 * Every canonical key (e.g. `"_ci"`) maps to a per-build randomized
 * 1–2 char name, guaranteeing:
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
	"_psv", // (reserved — preserves LCG sequence)

	// --- Interpreter dispatch indirection ---
	"_ht", // handler lookup table (interpreter dispatch indirection)
	"_nf", // next-fragment variable (handler fragmentation dispatch)

	// --- Packed handler table decoding ---
	"_htd", // handler table packed data array
	"_htk", // handler table decode key
	"_hti", // handler table decode loop variable

	// --- Handler table decode loop temporaries ---
	"_htv", // handler table decode value (was hardcoded "_v")
	"_htw", // handler table decode weight (was hardcoded "_w")

	// --- Deserializer locals (object method pattern) ---
	"_dr", // reader object variable
	"_dv", // DataView property on reader
	"_dof", // offset property on reader
	"_du8", // readU8 method on reader
	"_du16", // readU16 method on reader
	"_du32", // readU32 method on reader
	"_di32", // readI32 method on reader
	"_df64", // readF64 method on reader
	"_drs", // readStr method on reader
	"_dfl", // flags variable
	"_dpc", // param count variable
	"_drc", // register count variable
	"_dcc", // constant count variable
	"_dcs", // constants array variable
	"_dic", // instruction count variable
	"_din", // instructions array variable

	// --- Deserializer switch-case locals (same function scope as reader) ---
	"_dtag", // constant tag variable
	"_del", // encoded string length
	"_dea", // encoded string array
	"_dei", // encoded string index

	// --- Function table dispatch (replaces switch) ---
	"_frs", // function table return sentinel
	"_frv", // function table return value
	"_fdi", // function table dispatch index
	"_fg0", // function table handler group 0
	"_fg1", // function table handler group 1
	"_fg2", // function table handler group 2
	"_fg3", // function table handler group 3

	// --- Runtime opcode mutation ---
	"_ms", // mutation seed state
	"_mk", // mutation loop counter
	"_mi", // mutation swap index i
	"_mj", // mutation swap index j
	"_mt", // mutation swap temp
] as const;

// --- Name pool ---

/**
 * Letter ordering inspired by English frequency analysis (similar to
 * what Terser uses for its short name allocator). This determines the
 * base alphabet for building the shuffled name pool.
 */
const LETTERS = "etnoiasuclfdphmgvbwykxjqz";

/**
 * Names that must NOT appear in the generated name pool.
 *
 * This set combines:
 *   - Handler case-body locals (hardcoded in handler/*.ts files)
 *   - JS reserved words (from transforms.ts RESERVED set)
 *   - Short names in the KEEP set that handlers use freely
 *
 * This prevents scope-level collisions between generated runtime
 * names and handler-local variables.
 */
const EXCLUDED_NAMES: ReadonlySet<string> = /*@__PURE__*/ (() => {
	const s = new Set<string>();

	// ALL single letters — excluded because function stubs reference
	// top-level RuntimeNames identifiers (like vm, scope) inside
	// function bodies where user parameter names could shadow them.
	// Single-letter params (n, x, i, etc.) are extremely common in
	// user code, so any single-letter RuntimeName risks collision.
	for (const ch of LETTERS) s.add(ch);

	// Two-char handler locals / KEEP entries — these are hardcoded in
	// handler case bodies and must not collide with RuntimeNames
	for (const n of [
		"a1",
		"a2",
		"a3",
		"ai",
		"ci",
		"cv",
		"ei",
		"eu",
		"fi",
		"ki",
		"ni",
		"ra",
		"rb",
		"ri",
		"si",
		"sp",
		"ti",
		"it",
		"id",
		"cs",
		"ct",
		"fn",
		"ex",
	])
		s.add(n);

	// JS reserved words (1–2 char subset)
	for (const w of RESERVED) {
		if (w.length <= 2) s.add(w);
	}

	return s;
})();

// --- Name generation ---

/**
 * Create an LCG-based name generator that produces minifier-style
 * 1–2 character identifiers from a per-build shuffled pool.
 *
 * The pool contains all single lowercase letters + all two-letter
 * lowercase combinations, minus reserved words and handler locals.
 * Fisher-Yates shuffle with the LCG ensures different name
 * assignments per build seed.
 *
 * An external `used` set can be provided to enforce cross-generator
 * uniqueness (e.g. across shielding groups).
 */
function createNameGenerator(seed: number, externalUsed?: Set<string>) {
	const used = externalUsed ?? new Set<string>();
	let s = seed >>> 0;

	function lcg(): number {
		s = (s * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
		return s;
	}

	// --- Build name pool: two-letter combos (letter + letter) ---
	// Single letters are excluded to prevent shadowing collisions
	// with user function parameters in function stubs.
	const pool: string[] = [];

	for (const c1 of LETTERS) {
		for (const c2 of LETTERS) {
			const name = c1 + c2;
			if (!EXCLUDED_NAMES.has(name)) pool.push(name);
		}
	}

	// Shuffle pool deterministically with Fisher-Yates + LCG.
	// Different seeds produce completely different name orderings.
	for (let i = pool.length - 1; i > 0; i--) {
		const j = lcg() % (i + 1);
		const tmp = pool[i]!;
		pool[i] = pool[j]!;
		pool[j] = tmp;
	}

	let poolIdx = 0;

	// Per-build name variation: a separate LCG stream decides whether
	// each name gets a prefix (`_` or `$`), turning 2-char names into
	// 3-char names. This breaks the "all IIFE names are 2 chars"
	// fingerprint without changing the pool sequence or perturbing
	// the main LCG state.
	//
	// Prefixed names (`_et`, `$et`) can never collide with the pool
	// (which is lowercase-only) or handler locals (alpha+alnum only),
	// making this approach collision-safe by construction.
	let variantState = (seed ^ 0x4a3b2c1d) >>> 0;
	function variantLcg(): number {
		variantState =
			(Math.imul(variantState, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
		return variantState;
	}
	// Per-build prefix probability: 20-50% of names get prefixed
	const prefixBias = 0.2 + ((variantLcg() >>> 0) / 0x100000000) * 0.3;
	const PREFIXES = ["_"];

	function maybePrefix(name: string): string {
		if ((variantLcg() >>> 0) / 0x100000000 >= prefixBias) {
			return name;
		}
		const prefix = PREFIXES[variantLcg() % PREFIXES.length]!;
		const prefixed = prefix + name;
		if (!used.has(prefixed) && !RESERVED.has(prefixed)) {
			return prefixed;
		}
		return name;
	}

	function genName(): string {
		// Draw from the shuffled pool — most builds use only a fraction
		while (poolIdx < pool.length) {
			const baseName = pool[poolIdx++]!;
			if (!used.has(baseName)) {
				const name = maybePrefix(baseName);
				used.add(name);
				return name;
			}
		}

		// Pool exhausted (very large shielded builds): generate 3-char
		// names that still look like minifier overflow (e.g. "etn", "oia")
		for (let attempt = 0; ; attempt++) {
			if (attempt > 10000) {
				throw new Error("Runtime name pool exhausted");
			}
			const c1 = LETTERS[lcg() % LETTERS.length]!;
			const c2 = LETTERS[lcg() % LETTERS.length]!;
			const c3 = LETTERS[lcg() % LETTERS.length]!;
			const name = c1 + c2 + c3;
			if (!used.has(name) && !RESERVED.has(name)) {
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
 * @returns RuntimeNames, TempNames, and the shared used set.
 */
export function generateRuntimeNames(
	seed: number,
	sharedUsed?: Set<string>
): {
	runtime: RuntimeNames;
	temps: TempNames;
	used: Set<string>;
} {
	const { genName, used } = createNameGenerator(seed, sharedUsed);

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
		stp: genName(), // reserved — preserves LCG sequence (stack pointer eliminated)
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
		tdzSentinel: genName(),
		strDec: genName(),
		fSlots: genName(),
		rcState: genName(),
		rcDeriveKey: genName(),
		rcMix: genName(),
		ihash: genName(),
		ihashFn: genName(),
		keyAnchor: genName(),
		router: genName(),
		routeMap: genName(),
		alpha: genName(),
		imul: genName(),
		spreadSym: genName(),
		hop: genName(),
		globalRef: genName(),
		// Placeholder — filled below AFTER TempNames to preserve LCG sequence
		polyDec: "",
		polyPosSeed: "",
		strTbl: "",
		strCache: "",
		strAcc: "",
	};

	// Generate temp names from the same LCG + used set
	const temps: Record<string, string> = {};
	for (const key of TEMP_NAME_CATALOG) {
		temps[key] = genName();
	}

	// Generate new feature names AFTER temps — preserves the existing LCG
	// sequence so temp names are unchanged across builds.
	runtime.polyDec = genName();
	runtime.polyPosSeed = genName();
	runtime.strTbl = genName();
	runtime.strCache = genName();
	runtime.strAcc = genName();

	return { runtime, temps: temps as TempNames, used };
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
	"router",
	"routeMap",
	"tdzSentinel",
	"alpha",
	"imul",
	"spreadSym",
	"hop",
	"globalRef",
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
