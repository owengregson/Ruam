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
	whileStmt,
	call,
	member,
	BOp,
	UOp,
} from "../nodes.js";
import { registry, type HandlerCtx } from "./registry.js";
import { debugTrace } from "./helpers.js";

// --- Shorthand helpers ---

/** `IP=O*2;` — standard jump target assignment */
function ipAssign(ctx: HandlerCtx): JsNode {
	return exprStmt(assign(id(ctx.IP), bin(BOp.Mul, id(ctx.O), lit(2))));
}

// --- Jump handlers ---

/** `IP=O*2;break;` */
function JMP(ctx: HandlerCtx): JsNode[] {
	return [ipAssign(ctx), breakStmt()];
}

/** `if(S.pop())IP=O*2;break;` */
function JMP_TRUE(ctx: HandlerCtx): JsNode[] {
	return [ifStmt(ctx.pop(), [ipAssign(ctx)]), breakStmt()];
}

/** `if(!S.pop())IP=O*2;break;` */
function JMP_FALSE(ctx: HandlerCtx): JsNode[] {
	return [ifStmt(un(UOp.Not, ctx.pop()), [ipAssign(ctx)]), breakStmt()];
}

/** `{var v=S.pop();if(v===null||v===void 0)IP=O*2;break;}` */
function JMP_NULLISH(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("value"), ctx.pop()),
		ifStmt(
			bin(
				BOp.Or,
				bin(BOp.Seq, id(ctx.local("value")), lit(null)),
				bin(BOp.Seq, id(ctx.local("value")), un(UOp.Void, lit(0)))
			),
			[ipAssign(ctx)]
		),
		breakStmt(),
	];
}

/** `{var v=S.pop();if(v===void 0)IP=O*2;break;}` */
function JMP_UNDEFINED(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("value"), ctx.pop()),
		ifStmt(bin(BOp.Seq, id(ctx.local("value")), un(UOp.Void, lit(0))), [
			ipAssign(ctx),
		]),
		breakStmt(),
	];
}

/** `if(S[S.length-1])IP=O*2;break;` — keeps value on stack */
function JMP_TRUE_KEEP(ctx: HandlerCtx): JsNode[] {
	return [ifStmt(ctx.peek(), [ipAssign(ctx)]), breakStmt()];
}

/** `if(!S[S.length-1])IP=O*2;break;` — keeps value on stack */
function JMP_FALSE_KEEP(ctx: HandlerCtx): JsNode[] {
	return [ifStmt(un(UOp.Not, ctx.peek()), [ipAssign(ctx)]), breakStmt()];
}

/** `{var v=S[S.length-1];if(v===null||v===void 0)IP=O*2;break;}` — keeps value on stack */
function JMP_NULLISH_KEEP(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("value"), ctx.peek()),
		ifStmt(
			bin(
				BOp.Or,
				bin(BOp.Seq, id(ctx.local("value")), lit(null)),
				bin(BOp.Seq, id(ctx.local("value")), un(UOp.Void, lit(0)))
			),
			[ipAssign(ctx)]
		),
		breakStmt(),
	];
}

// --- Return / throw handlers ---

/**
 * Unwind the exception-handler stack toward the nearest enclosing `finally`
 * for a deferred completion (return).
 *
 * Pops handler frames (restoring the stack depth saved on each) until either a
 * frame carrying a `finally` is found — in which case `IP` is set to that
 * finally and the deferral flag is cleared so control transfers there — or the
 * stack is exhausted. Catch-only frames in between are popped without running
 * (a `catch` does not execute during an abrupt return). This makes
 * `return`-through-`finally` work for arbitrarily nested `try`/`finally`, not
 * just a single level.
 *
 * `completionValue` is the value assigned to `CV` when a finally is found; the
 * finally's `END_FINALLY` later resumes the deferral. The loop is driven purely
 * by its condition (no inner `break`/`continue`/`return`) so it survives the
 * handler-body break/return transforms applied by every dispatch style.
 */
function unwindToFinally(ctx: HandlerCtx, completionValue: JsNode): JsNode {
	const flag = ctx.local("retDefer");
	return whileStmt(
		bin(
			BOp.And,
			id(flag),
			bin(
				BOp.And,
				id(ctx.EX),
				bin(BOp.Gt, member(id(ctx.EX), "length"), lit(0))
			)
		),
		[
			varDecl(ctx.t("_h"), call(member(id(ctx.EX), "pop"), [])),
			exprStmt(
				assign(
					member(id(ctx.S), "length"),
					member(id(ctx.t("_h")), ctx.t("_sp"))
				)
			),
			ifStmt(
				bin(BOp.Gte, member(id(ctx.t("_h")), ctx.t("_fi")), lit(0)),
				[
					exprStmt(assign(id(ctx.CT), lit(1))),
					exprStmt(assign(id(ctx.CV), completionValue)),
					exprStmt(
						assign(
							id(ctx.IP),
							bin(
								BOp.Mul,
								member(id(ctx.t("_h")), ctx.t("_fi")),
								lit(2)
							)
						)
					),
					exprStmt(assign(id(flag), lit(0))),
				]
			),
		]
	);
}

/**
 * RETURN: pop return value, run any enclosing `finally` blocks first
 * (deferring via completion tracking), then return.
 *
 * ```
 * var _rv=S.pop();
 * <debug trace if enabled>
 * var _df=1;
 * while(_df&&EX&&EX.length>0){var _h=EX.pop();S.length=_h._sp;if(_h._fi>=0){CT=1;CV=_rv;IP=_h._fi*2;_df=0;}}
 * if(_df)return _rv;
 * break;
 * ```
 */
function RETURN(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.t("_rv"), ctx.pop()),
		...debugTrace(ctx, "RETURN", lit("value="), id(ctx.t("_rv"))),
		varDecl(ctx.local("retDefer"), lit(1)),
		unwindToFinally(ctx, id(ctx.t("_rv"))),
		ifStmt(id(ctx.local("retDefer")), [returnStmt(id(ctx.t("_rv")))]),
		breakStmt(),
	];
}

/**
 * RETURN_VOID: return undefined, running any enclosing `finally` blocks first.
 *
 * ```
 * <debug trace if enabled>
 * var _df=1;
 * while(_df&&EX&&EX.length>0){var _h=EX.pop();S.length=_h._sp;if(_h._fi>=0){CT=1;CV=void 0;IP=_h._fi*2;_df=0;}}
 * if(_df)return void 0;
 * break;
 * ```
 */
function RETURN_VOID(ctx: HandlerCtx): JsNode[] {
	return [
		...debugTrace(ctx, "RETURN_VOID"),
		varDecl(ctx.local("retDefer"), lit(1)),
		unwindToFinally(ctx, un(UOp.Void, lit(0))),
		ifStmt(id(ctx.local("retDefer")), [
			returnStmt(un(UOp.Void, lit(0))),
		]),
		breakStmt(),
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
			varDecl(ctx.local("exception"), id(ctx.PE)),
			exprStmt(assign(id(ctx.PE), lit(null))),
			exprStmt(assign(id(ctx.HPE), lit(false))),
			throwStmt(id(ctx.local("exception"))),
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
