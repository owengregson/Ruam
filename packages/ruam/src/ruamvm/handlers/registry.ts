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
	ifStmt,
	whileStmt,
	exprStmt,
	breakStmt,
} from "../nodes.js";
import type { RuntimeNames } from "../../encoding/names.js";
import type { Op } from "../../compiler/opcodes.js";

/**
 * Context passed to every opcode handler.
 * Contains obfuscated variable names and feature flags.
 */
export interface HandlerCtx {
	// Stack machine
	S: string; // stack array
	P: string; // stack pointer

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

	// Scope property names
	sPar: string; // scope.parent
	sV: string; // scope.vars
	sTdz: string; // scope.tdzVars

	// Infrastructure references
	exec: string; // sync exec function name
	execAsync: string; // async exec function name
	load: string; // loader function name
	depth: string; // recursion depth counter
	callStack: string; // call stack for error messages
	dbg: string; // debug log function name
	fSlots: string; // function slots array name

	// Flags
	isAsync: boolean; // true when building async interpreter variant
	debug: boolean; // true when debug logging is enabled

	// Stack operation factories — emit directly as S[++P]=expr, S[P--], S[P]
	push: (value: JsNode) => StackPush;
	pop: () => StackPop;
	peek: () => StackPeek;

	// Scope chain helpers — AST-returning versions for structured composition
	/** `s.sV[key]` — scoped variable reference as AST node (default key: `id("name")`) */
	sv: (key?: JsNode) => JsNode;
	/** `SC.sV[key]` — current scope variable reference as AST node (default key: `id("name")`) */
	curSv: (key?: JsNode) => JsNode;
	/** Scope walk pattern as AST nodes: `while(s){if(key in s.sV){<body>break;}s=s.sPar;}break;` */
	scopeWalk: (body: JsNode[], key?: JsNode) => JsNode[];
}

/** A handler function returns the case body as AST nodes. */
export type HandlerFn = (ctx: HandlerCtx) => JsNode[];

/** The handler registry: maps logical opcode to handler function. */
export const registry = new Map<Op, HandlerFn>();

/**
 * Build a HandlerCtx from RuntimeNames and flags.
 */
export function makeHandlerCtx(
	names: RuntimeNames,
	isAsync: boolean,
	debug: boolean
): HandlerCtx {
	return {
		S: names.stk,
		P: names.stp,
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
		sPar: names.sPar,
		sV: names.sVars,
		sTdz: names.sTdz,
		exec: names.exec,
		execAsync: names.execAsync,
		load: names.load,
		depth: names.depth,
		callStack: names.callStack,
		dbg: names.dbg,
		fSlots: names.fSlots,
		isAsync,
		debug,
		push: (value: JsNode) => stackPush(names.stk, names.stp, value),
		pop: () => stackPop(names.stk, names.stp),
		peek: () => stackPeek(names.stk, names.stp),

		// AST-returning scope helpers
		sv: (key: JsNode = id("name")) =>
			index(member(id("s"), names.sVars), key),
		curSv: (key: JsNode = id("name")) =>
			index(member(id(names.scope), names.sVars), key),
		scopeWalk: (body: JsNode[], key: JsNode = id("name")): JsNode[] => [
			whileStmt(id("s"), [
				ifStmt(bin("in", key, member(id("s"), names.sVars)), [
					...body,
					breakStmt(),
				]),
				exprStmt(assign(id("s"), member(id("s"), names.sPar))),
			]),
			breakStmt(),
		],
	};
}
