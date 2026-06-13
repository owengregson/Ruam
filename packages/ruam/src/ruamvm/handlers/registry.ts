/**
 * Opcode handler registry and context type.
 *
 * Separated from index.ts to avoid circular dependencies:
 * handler files import from this module to register themselves,
 * while index.ts re-exports these types and triggers the
 * side-effect imports.
 *
 * @module ruamvm/handlers/registry
 */

import type { JsNode, Name } from "../nodes.js";
import {
	stackPush,
	stackPop,
	stackPeek,
	id,
	lit,
	index,
	member,
	bin,
	assign,
	call,
	ifStmt,
	whileStmt,
	exprStmt,
	breakStmt,
	BOp,
} from "../nodes.js";
import type { RuntimeNames, TempNames } from "../../naming/compat-types.js";
import type { Op } from "../../compiler/opcodes.js";

/**
 * Context passed to every opcode handler.
 * Contains obfuscated variable names and feature flags.
 */
export interface HandlerCtx {
	// Stack machine (uses Array.push/pop/length — no stack pointer)
	S: Name; // stack array

	// Interpreter state
	IP: Name; // instruction pointer
	C: Name; // constants array
	O: Name; // operand
	SC: Name; // scope
	R: Name; // registers
	EX: Name; // exception handler stack
	PE: Name; // pending exception
	HPE: Name; // has pending exception
	CT: Name; // completion type
	CV: Name; // completion value
	PH: Name; // physical opcode variable

	// Function parameters
	U: Name; // unit parameter
	A: Name; // args parameter
	OS: Name; // outerScope parameter
	TV: Name; // thisVal parameter
	NT: Name; // newTarget parameter
	HO: Name; // homeObject parameter

	// TDZ sentinel variable (IIFE-scope unique object)
	tdzSentinel: Name;

	// Infrastructure references
	exec: Name; // sync exec function name
	execAsync: Name; // async exec function name
	load: Name; // loader function name
	spreadSym: Name; // spread marker Symbol name
	hop: Name; // cached Object.prototype.hasOwnProperty reference
	depth: Name; // recursion depth counter
	callStack: Name; // call stack for error messages
	dbg: Name; // debug log function name
	fSlots: Name; // function slots array name

	// Flags
	isAsync: boolean; // true when building async interpreter variant
	debug: boolean; // true when debug logging is enabled

	/** Temp name lookup — maps canonical key (e.g. `"_ci"`) to per-build randomized name. */
	t: (key: string) => Name;

	/** Handler-local variable — returns a Name for a handler-local variable. */
	local: (key: string) => Name;

	// Stack operation factories. Without stackEncoding these emit plain
	// `S.push(v)` / `S.pop()` / `S[S.length-1]`. With stackEncoding they route
	// through the `stkEnc`/`stkDec` helpers so int32 stack values are stored
	// position-XOR-masked in memory (same representation as the legacy Proxy,
	// but without the per-access trap cost).
	push: (value: JsNode) => JsNode;
	pop: () => JsNode;
	peek: () => JsNode;

	/**
	 * Read a stack slot by absolute index, decoded. `idx` is a *thunk* that
	 * produces a FRESH index AST each call (the index is emitted twice under
	 * encoding — once for the lookup, once for the position key — and reusing a
	 * single node object would alias inside the mutating MBA/structural passes).
	 */
	slotRead: (idx: () => JsNode) => JsNode;

	/**
	 * Write `value` to a stack slot by absolute index, encoded for that index.
	 * `idx` is a fresh-AST thunk (see {@link HandlerCtx.slotRead}). Returns the
	 * assignment expression (caller wraps in `exprStmt`). Re-keying is automatic:
	 * a value read at one index via {@link HandlerCtx.slotRead} and written to a
	 * different index here is decoded with the old key and re-encoded with the new.
	 */
	slotWrite: (idx: () => JsNode, value: JsNode) => JsNode;

	/**
	 * Overwrite the top of stack in place with `value` (encoded if needed).
	 * Use this instead of `assign(peek(), …)` — under stackEncoding `peek()` is
	 * a decode *call* and cannot be an assignment target. The read side stays
	 * `peek()` (decoded); only the write target needs this. Returns the
	 * assignment expression (caller wraps in `exprStmt`).
	 */
	setTop: (value: JsNode) => JsNode;

	// Scope chain helpers — prototypal scope (Object.create chain)
	/** `s[key]` — scoped variable reference on walk variable (default key: `id("name")`) */
	sv: (key?: JsNode) => JsNode;
	/** `SC[key]` — current scope variable reference (default key: `id("name")`) */
	curSv: (key?: JsNode) => JsNode;
	/** Scope walk: `while(s){if(Object.prototype.hasOwnProperty.call(s,key)){<body>break;}s=Object.getPrototypeOf(s);}break;` */
	scopeWalk: (body: JsNode[], key?: JsNode) => JsNode[];
}

/** A handler function returns the case body as AST nodes. */
export type HandlerFn = (ctx: HandlerCtx) => JsNode[];

/** The handler registry: maps logical opcode to handler function. */
export const registry = new Map<Op, HandlerFn>();

/**
 * Build a HandlerCtx from RuntimeNames, TempNames, and flags.
 */
export function makeHandlerCtx(
	names: RuntimeNames,
	temps: TempNames,
	isAsync: boolean,
	debug: boolean,
	stackEncoding = false
): HandlerCtx {
	// Interim pass-through: returns the key as-is (string).
	// Will be wired to NameScope in Task 6.
	const localFn = (key: string): Name => key;

	// --- Stack access factories (encoding-aware) ---------------------------
	// When stackEncoding is on, values are stored as `[tag,payload]` entries
	// with int32s position-XOR-masked, accessed through the IIFE-scope helpers
	// `stkEnc(value, index, key)` / `stkDec(entry, index, key)`. The per-unit
	// key `_sek` is an exec-local computed at entry (see buildStackEncodingKeyInit).
	const stk = names.stk;
	const sLen = (): JsNode => member(id(stk), "length");
	const sLenMinus = (k: number): JsNode => bin(BOp.Sub, sLen(), lit(k));

	let pushFn: (value: JsNode) => JsNode;
	let popFn: () => JsNode;
	let peekFn: () => JsNode;
	let slotReadFn: (idx: () => JsNode) => JsNode;
	let slotWriteFn: (idx: () => JsNode, value: JsNode) => JsNode;

	if (stackEncoding) {
		const enc = names.stkEnc;
		const dec = names.stkDec;
		const sek = temps["_sek"];
		if (sek === undefined) {
			throw new Error("stackEncoding requires temp name _sek");
		}
		const encOf = (value: JsNode, idx: JsNode): JsNode =>
			call(id(enc), [value, idx, id(sek)]);
		const decOf = (entry: JsNode, idx: JsNode): JsNode =>
			call(id(dec), [entry, idx, id(sek)]);

		// push: S.push(stkEnc(v, S.length, _sek)) — S.length is read BEFORE the
		// append, i.e. it equals the target index. Arg evaluated before .push runs.
		pushFn = (value: JsNode) => stackPush(stk, encOf(value, sLen()));
		// pop: stkDec(S.pop(), S.length, _sek) — left-to-right eval: pop() first
		// (length decrements), then S.length reads the just-vacated index.
		popFn = () => decOf(stackPop(stk), sLen());
		// peek: stkDec(S[S.length-1], S.length-1, _sek)
		peekFn = () => decOf(index(id(stk), sLenMinus(1)), sLenMinus(1));
		// slotRead: stkDec(S[idx], idx, _sek) — idx thunk called twice (fresh AST)
		slotReadFn = (idx) => decOf(index(id(stk), idx()), idx());
		// slotWrite: S[idx] = stkEnc(value, idx, _sek)
		slotWriteFn = (idx, value) =>
			assign(index(id(stk), idx()), encOf(value, idx()));
	} else {
		pushFn = (value: JsNode) => stackPush(stk, value);
		popFn = () => stackPop(stk);
		peekFn = () => stackPeek(stk);
		slotReadFn = (idx) => index(id(stk), idx());
		slotWriteFn = (idx, value) => assign(index(id(stk), idx()), value);
	}

	// setTop: write to the top slot (depth 1). Encoding-aware via slotWrite.
	const setTopFn = (value: JsNode): JsNode =>
		slotWriteFn(() => sLenMinus(1), value);

	return {
		S: names.stk,
		IP: names.ip,
		C: names.cArr,
		O: names.operand,
		SC: names.scope,
		R: names.regs,
		EX: names.exStk,
		PE: names.pEx,
		HPE: names.hPEx,
		CT: names.cType,
		CV: names.cVal,
		PH: names.phys,
		U: names.unit,
		A: names.args,
		OS: names.outer,
		TV: names.tVal,
		NT: names.nTgt,
		HO: names.ho,
		tdzSentinel: names.tdzSentinel,
		exec: names.exec,
		execAsync: names.execAsync,
		load: names.load,
		spreadSym: names.spreadSym,
		hop: names.hop,
		depth: names.depth,
		callStack: names.callStack,
		dbg: names.dbg,
		fSlots: names.fSlots,
		isAsync,
		debug,
		t: (key: string): Name => {
			const name = temps[key];
			if (name === undefined) {
				throw new Error(`Unknown temp name key: ${key}`);
			}
			return name;
		},
		local: localFn,
		push: pushFn,
		pop: popFn,
		peek: peekFn,
		slotRead: slotReadFn,
		slotWrite: slotWriteFn,
		setTop: setTopFn,

		// AST-returning scope helpers — prototypal scope chain
		sv: (key: JsNode = id(localFn("varName"))) =>
			index(id(localFn("scopeWalk")), key),
		curSv: (key: JsNode = id(localFn("varName"))) =>
			index(id(names.scope), key),
		scopeWalk: (
			body: JsNode[],
			key: JsNode = id(localFn("varName"))
		): JsNode[] => [
			whileStmt(id(localFn("scopeWalk")), [
				ifStmt(
					call(member(id(names.hop), "call"), [
						id(localFn("scopeWalk")),
						key,
					]),
					[...body, breakStmt()]
				),
				exprStmt(
					assign(
						id(localFn("scopeWalk")),
						call(member(id("Object"), "getPrototypeOf"), [
							id(localFn("scopeWalk")),
						])
					)
				),
			]),
			breakStmt(),
		],
	};
}
