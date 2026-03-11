/**
 * Control flow opcode handlers in AST node form.
 *
 * Covers 15 opcodes:
 *  - Jumps:   JMP, JMP_TRUE, JMP_FALSE, JMP_NULLISH, JMP_UNDEFINED,
 *             JMP_TRUE_KEEP, JMP_FALSE_KEEP, JMP_NULLISH_KEEP
 *  - Returns: RETURN, RETURN_VOID
 *  - Throws:  THROW, RETHROW
 *  - Misc:    NOP, TABLE_SWITCH, LOOKUP_SWITCH
 *
 * All handlers use pure AST nodes.
 *
 * @module ruamvm/handlers/control-flow
 */

import { Op } from "../../compiler/opcodes.js";
import {
	type JsNode,
	id,
	lit,
	bin,
	un,
	exprStmt,
	assign,
	ifStmt,
	varDecl,
	breakStmt,
	returnStmt,
	throwStmt,
	call,
	member,
	index,
} from "../nodes.js";
import { registry, type HandlerCtx } from "./registry.js";
import { debugTrace } from "./helpers.js";

// --- Shorthand helpers ---

/** `IP=O*2;` — standard jump target assignment */
function ipAssign(ctx: HandlerCtx): JsNode {
	return exprStmt(assign(id(ctx.IP), bin("*", id(ctx.O), lit(2))));
}

// --- Jump handlers ---

/** `IP=O*2;break;` */
function JMP(ctx: HandlerCtx): JsNode[] {
	return [ipAssign(ctx), breakStmt()];
}

/** `if(S[P--])IP=O*2;break;` */
function JMP_TRUE(ctx: HandlerCtx): JsNode[] {
	return [ifStmt(ctx.pop(), [ipAssign(ctx)]), breakStmt()];
}

/** `if(!S[P--])IP=O*2;break;` */
function JMP_FALSE(ctx: HandlerCtx): JsNode[] {
	return [ifStmt(un("!", ctx.pop()), [ipAssign(ctx)]), breakStmt()];
}

/** `{var v=S[P--];if(v===null||v===void 0)IP=O*2;break;}` */
function JMP_NULLISH(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("v", ctx.pop()),
		ifStmt(
			bin(
				"||",
				bin("===", id("v"), lit(null)),
				bin("===", id("v"), un("void", lit(0)))
			),
			[ipAssign(ctx)]
		),
		breakStmt(),
	];
}

/** `{var v=S[P--];if(v===void 0)IP=O*2;break;}` */
function JMP_UNDEFINED(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("v", ctx.pop()),
		ifStmt(bin("===", id("v"), un("void", lit(0))), [ipAssign(ctx)]),
		breakStmt(),
	];
}

/** `if(S[P])IP=O*2;break;` — keeps value on stack */
function JMP_TRUE_KEEP(ctx: HandlerCtx): JsNode[] {
	return [ifStmt(ctx.peek(), [ipAssign(ctx)]), breakStmt()];
}

/** `if(!S[P])IP=O*2;break;` — keeps value on stack */
function JMP_FALSE_KEEP(ctx: HandlerCtx): JsNode[] {
	return [ifStmt(un("!", ctx.peek()), [ipAssign(ctx)]), breakStmt()];
}

/** `{var v=S[P];if(v===null||v===void 0)IP=O*2;break;}` — keeps value on stack */
function JMP_NULLISH_KEEP(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("v", ctx.peek()),
		ifStmt(
			bin(
				"||",
				bin("===", id("v"), lit(null)),
				bin("===", id("v"), un("void", lit(0)))
			),
			[ipAssign(ctx)]
		),
		breakStmt(),
	];
}

// --- Return / throw handlers ---

/**
 * RETURN: pop return value, optionally defer to finally handler, then return.
 *
 * ```
 * var _rv=S[P--];
 * <debug trace if enabled>
 * if(EX&&EX.length>0){var _h=EX[EX.length-1];if(_h._fi>=0){CT=1;CV=_rv;EX.pop();P=_h._sp;IP=_h._fi*2;break;}}
 * return _rv;
 * ```
 */
function RETURN(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.t("_rv"), ctx.pop()),
		...debugTrace(ctx, "RETURN", lit("value="), id(ctx.t("_rv"))),
		ifStmt(
			bin(
				"&&",
				id(ctx.EX),
				bin(">", member(id(ctx.EX), "length"), lit(0))
			),
			[
				varDecl(
					ctx.t("_h"),
					index(
						id(ctx.EX),
						bin("-", member(id(ctx.EX), "length"), lit(1))
					)
				),
				ifStmt(bin(">=", member(id(ctx.t("_h")), ctx.t("_fi")), lit(0)), [
					exprStmt(assign(id(ctx.CT), lit(1))),
					exprStmt(assign(id(ctx.CV), id(ctx.t("_rv")))),
					exprStmt(call(member(id(ctx.EX), "pop"), [])),
					exprStmt(assign(id(ctx.P), member(id(ctx.t("_h")), ctx.t("_sp")))),
					exprStmt(
						assign(
							id(ctx.IP),
							bin("*", member(id(ctx.t("_h")), ctx.t("_fi")), lit(2))
						)
					),
					breakStmt(),
				]),
			]
		),
		returnStmt(id(ctx.t("_rv"))),
	];
}

/**
 * RETURN_VOID: return undefined, deferring to finally if present.
 *
 * ```
 * <debug trace if enabled>
 * if(EX&&EX.length>0){var _h=EX[EX.length-1];if(_h._fi>=0){CT=1;CV=void 0;EX.pop();P=_h._sp;IP=_h._fi*2;break;}}
 * return void 0;
 * ```
 */
function RETURN_VOID(ctx: HandlerCtx): JsNode[] {
	return [
		...debugTrace(ctx, "RETURN_VOID"),
		ifStmt(
			bin(
				"&&",
				id(ctx.EX),
				bin(">", member(id(ctx.EX), "length"), lit(0))
			),
			[
				varDecl(
					ctx.t("_h"),
					index(
						id(ctx.EX),
						bin("-", member(id(ctx.EX), "length"), lit(1))
					)
				),
				ifStmt(bin(">=", member(id(ctx.t("_h")), ctx.t("_fi")), lit(0)), [
					exprStmt(assign(id(ctx.CT), lit(1))),
					exprStmt(assign(id(ctx.CV), un("void", lit(0)))),
					exprStmt(call(member(id(ctx.EX), "pop"), [])),
					exprStmt(assign(id(ctx.P), member(id(ctx.t("_h")), ctx.t("_sp")))),
					exprStmt(
						assign(
							id(ctx.IP),
							bin("*", member(id(ctx.t("_h")), ctx.t("_fi")), lit(2))
						)
					),
					breakStmt(),
				]),
			]
		),
		returnStmt(un("void", lit(0))),
	];
}

/**
 * THROW: pop value and throw it.
 *
 * ```
 * var _te=S[P--];
 * <debug trace if enabled>
 * throw _te;
 * ```
 */
function THROW(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.t("_te"), ctx.pop()),
		...debugTrace(ctx, "THROW", lit("value="), id(ctx.t("_te"))),
		throwStmt(id(ctx.t("_te"))),
	];
}

/**
 * RETHROW: re-throw pending exception if one exists.
 *
 * ```
 * if(HPE){var ex=PE;PE=null;HPE=false;throw ex;}break;
 * ```
 */
function RETHROW(ctx: HandlerCtx): JsNode[] {
	return [
		ifStmt(id(ctx.HPE), [
			varDecl("ex", id(ctx.PE)),
			exprStmt(assign(id(ctx.PE), lit(null))),
			exprStmt(assign(id(ctx.HPE), lit(false))),
			throwStmt(id("ex")),
		]),
		breakStmt(),
	];
}

// --- Misc handlers ---

/** NOP: no-op, just break. */
function NOP(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

/**
 * TABLE_SWITCH / LOOKUP_SWITCH: at runtime these are already resolved to
 * a JMP target. The handler just sets IP=O*2.
 */
function SWITCH_JMP(ctx: HandlerCtx): JsNode[] {
	return [ipAssign(ctx), breakStmt()];
}

// --- Registration ---

registry.set(Op.JMP, JMP);
registry.set(Op.JMP_TRUE, JMP_TRUE);
registry.set(Op.JMP_FALSE, JMP_FALSE);
registry.set(Op.JMP_NULLISH, JMP_NULLISH);
registry.set(Op.JMP_UNDEFINED, JMP_UNDEFINED);
registry.set(Op.JMP_TRUE_KEEP, JMP_TRUE_KEEP);
registry.set(Op.JMP_FALSE_KEEP, JMP_FALSE_KEEP);
registry.set(Op.JMP_NULLISH_KEEP, JMP_NULLISH_KEEP);
registry.set(Op.RETURN, RETURN);
registry.set(Op.RETURN_VOID, RETURN_VOID);
registry.set(Op.THROW, THROW);
registry.set(Op.RETHROW, RETHROW);
registry.set(Op.NOP, NOP);
registry.set(Op.TABLE_SWITCH, SWITCH_JMP);
registry.set(Op.LOOKUP_SWITCH, SWITCH_JMP);
