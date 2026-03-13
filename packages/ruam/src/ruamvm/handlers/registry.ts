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

import type { JsNode, StackPush, StackPop, StackPeek } from "../nodes.js";
import {
	stackPush,
	stackPop,
	stackPeek,
	id,
	index,
	member,
	bin,
	assign,
	call,
	ifStmt,
	whileStmt,
	exprStmt,
	breakStmt,
} from "../nodes.js";
import type { RuntimeNames, TempNames } from "../../encoding/names.js";
import type { Op } from "../../compiler/opcodes.js";

/**
 * Context passed to every opcode handler.
 * Contains obfuscated variable names and feature flags.
 */
export interface HandlerCtx {
	// Stack machine (uses Array.push/pop/length — no stack pointer)
	S: string; // stack array

	// Interpreter state
	IP: string; // instruction pointer
	C: string; // constants array
	O: string; // operand
	SC: string; // scope
	R: string; // registers
	EX: string; // exception handler stack
	PE: string; // pending exception
	HPE: string; // has pending exception
	CT: string; // completion type
	CV: string; // completion value
	PH: string; // physical opcode variable

	// Function parameters
	U: string; // unit parameter
	A: string; // args parameter
	OS: string; // outerScope parameter
	TV: string; // thisVal parameter
	NT: string; // newTarget parameter
	HO: string; // homeObject parameter

	// TDZ sentinel variable (IIFE-scope unique object)
	tdzSentinel: string;

	// Infrastructure references
	exec: string; // sync exec function name
	execAsync: string; // async exec function name
	load: string; // loader function name
	spreadSym: string; // spread marker Symbol name
	hop: string; // cached Object.prototype.hasOwnProperty reference
	depth: string; // recursion depth counter
	callStack: string; // call stack for error messages
	dbg: string; // debug log function name
	fSlots: string; // function slots array name

	// Flags
	isAsync: boolean; // true when building async interpreter variant
	debug: boolean; // true when debug logging is enabled

	/** Temp name lookup — maps canonical key (e.g. `"_ci"`) to per-build randomized name. */
	t: (key: string) => string;

	// Stack operation factories — emit directly as S[++P]=expr, S[P--], S[P]
	push: (value: JsNode) => StackPush;
	pop: () => StackPop;
	peek: () => StackPeek;

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
	debug: boolean
): HandlerCtx {
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
		t: (key: string): string => {
			const name = temps[key];
			if (name === undefined) {
				throw new Error(`Unknown temp name key: ${key}`);
			}
			return name;
		},
		push: (value: JsNode) => stackPush(names.stk, value),
		pop: () => stackPop(names.stk),
		peek: () => stackPeek(names.stk),

		// AST-returning scope helpers — prototypal scope chain
		sv: (key: JsNode = id("name")) => index(id("s"), key),
		curSv: (key: JsNode = id("name")) => index(id(names.scope), key),
		scopeWalk: (body: JsNode[], key: JsNode = id("name")): JsNode[] => [
			whileStmt(id("s"), [
				ifStmt(call(member(id(names.hop), "call"), [id("s"), key]), [
					...body,
					breakStmt(),
				]),
				exprStmt(
					assign(
						id("s"),
						call(member(id("Object"), "getPrototypeOf"), [id("s")])
					)
				),
			]),
			breakStmt(),
		],
	};
}
