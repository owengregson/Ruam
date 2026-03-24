/**
 * @module naming/compat-types
 * RuntimeNames and TempNames interfaces — extracted from encoding/names.ts.
 * These interfaces are used throughout the codebase as the shape of
 * randomized identifier mappings produced by the NameRegistry.
 */

/**
 * Mapping of logical role to generated identifier name for all
 * runtime-internal variables and functions.
 */
export interface RuntimeNames {
	bt: string;
	vm: string;
	exec: string;
	execAsync: string;
	load: string;
	cache: string;
	depth: string;
	callStack: string;
	fp: string;
	rc4: string;
	b64: string;
	deser: string;
	dbg: string;
	dbgOp: string;
	dbgCfg: string;
	dbgProt: string;
	stk: string;
	stp: string;
	operand: string;
	scope: string;
	regs: string;
	ip: string;
	cArr: string;
	iArr: string;
	exStk: string;
	pEx: string;
	hPEx: string;
	cType: string;
	cVal: string;
	unit: string;
	args: string;
	outer: string;
	tVal: string;
	nTgt: string;
	ho: string;
	phys: string;
	opVar: string;
	thresh: string;
	tdzSentinel: string;
	strDec: string;
	fSlots: string;
	rcState: string;
	rcDeriveKey: string;
	rcMix: string;
	ihash: string;
	ihashFn: string;
	keyAnchor: string;
	router: string;
	routeMap: string;
	alpha: string;
	imul: string;
	spreadSym: string;
	hop: string;
	globalRef: string;
	polyDec: string;
	polyPosSeed: string;
	strTbl: string;
	strCache: string;
	strAcc: string;
	unpack: string;
}

/**
 * Randomized names for handler/builder temporary variables and
 * internal object property keys.
 */
export type TempNames = Readonly<Record<string, string>>;
