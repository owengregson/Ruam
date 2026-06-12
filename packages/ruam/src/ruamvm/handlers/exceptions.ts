/**
 * Exception handling opcode handlers in AST node form.
 *
 * Covers 10 opcodes:
 *  - Try/catch:  TRY_PUSH, TRY_POP, CATCH_BIND, CATCH_BIND_PATTERN
 *  - Finally:    FINALLY_MARK, END_FINALLY
 *  - Guards:     THROW_IF_NOT_OBJECT
 *  - Error ctors: THROW_REF_ERROR, THROW_TYPE_ERROR, THROW_SYNTAX_ERROR
 *
 * @module ruamvm/handlers/exceptions
 */

import { Op } from "../../compiler/opcodes.js";
import {
	type JsNode,
	breakStmt,
	varDecl,
	exprStmt,
	ifStmt,
	id,
	lit,
	bin,
	un,
	assign,
	call,
	member,
	index,
	obj,
	arr,
	throwStmt,
	newExpr,
	returnStmt,
	whileStmt,
	BOp,
	UOp,
} from "../nodes.js";
import type { HandlerCtx } from "./registry.js";
import { registry } from "./registry.js";

// --- Try/catch handlers ---

/**
 * TRY_PUSH: push an exception handler frame onto the handler stack.
 *
 * Extracts catchIp and finallyIp from the packed operand.
 * 0xFFFF sentinel means no catch/finally target.
 *
 * ```
 * var _ci=(O>>16)&0xFFFF;var _fi=O&0xFFFF;
 * if(_ci===0xFFFF)_ci=-1;if(_fi===0xFFFF)_fi=-1;
 * if(!EX)EX=[];EX.push({_ci:_ci,_fi:_fi,_sp:S.length});break;
 * ```
 */
function TRY_PUSH(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(
			ctx.t("_ci"),
			bin(BOp.BitAnd, bin(BOp.Shr, id(ctx.O), lit(16)), lit(0xffff))
		),
		varDecl(ctx.t("_fi"), bin(BOp.BitAnd, id(ctx.O), lit(0xffff))),
		ifStmt(bin(BOp.Seq, id(ctx.t("_ci")), lit(0xffff)), [
			exprStmt(assign(id(ctx.t("_ci")), un(UOp.Neg, lit(1)))),
		]),
		ifStmt(bin(BOp.Seq, id(ctx.t("_fi")), lit(0xffff)), [
			exprStmt(assign(id(ctx.t("_fi")), un(UOp.Neg, lit(1)))),
		]),
		ifStmt(un(UOp.Not, id(ctx.EX)), [exprStmt(assign(id(ctx.EX), arr()))]),
		exprStmt(
			call(member(id(ctx.EX), "push"), [
				obj(
					[ctx.t("_ci"), id(ctx.t("_ci"))],
					[ctx.t("_fi"), id(ctx.t("_fi"))],
					[ctx.t("_sp"), member(id(ctx.S), "length")]
				),
			])
		),
		breakStmt(),
	];
}

/** TRY_POP: pop the top exception handler frame. */
function TRY_POP(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(call(member(id(ctx.EX), "pop"), [])), breakStmt()];
}

/**
 * CATCH_BIND: bind caught exception to a variable.
 *
 * If operand >= 0, uses constant pool for name and stores in scope vars
 * or register. Otherwise pushes the error onto the stack.
 *
 * ```
 * var err=S[P--];if(O>=0){var cname=C[O];if(typeof cname==='string'){SC.sV[cname]=err;}else{R[O]=err;}}else{W(err);}break;
 * ```
 */
function CATCH_BIND(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("error"), ctx.pop()),
		ifStmt(
			bin(BOp.Gte, id(ctx.O), lit(0)),
			[
				varDecl(ctx.local("catchName"), index(id(ctx.C), id(ctx.O))),
				ifStmt(
					bin(
						BOp.Seq,
						un(UOp.Typeof, id(ctx.local("catchName"))),
						lit("string")
					),
					[
						exprStmt(
							assign(
								index(id(ctx.SC), id(ctx.local("catchName"))),
								id(ctx.local("error"))
							)
						),
					],
					[
						exprStmt(
							assign(
								index(id(ctx.R), id(ctx.O)),
								id(ctx.local("error"))
							)
						),
					]
				),
			],
			[exprStmt(ctx.push(id(ctx.local("error"))))]
		),
		breakStmt(),
	];
}

/**
 * CATCH_BIND_PATTERN: bind caught exception for destructuring.
 *
 * Simply pops the exception from the internal state and pushes it onto
 * the stack for subsequent destructuring opcodes.
 */
function CATCH_BIND_PATTERN(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("error"), ctx.pop()),
		exprStmt(ctx.push(id(ctx.local("error")))),
		breakStmt(),
	];
}

// --- Finally handlers ---

/** FINALLY_MARK: no-op marker for finally block entry. */
function FINALLY_MARK(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

/**
 * END_FINALLY: complete a finally block.
 *
 * Re-throws a pending exception if one exists. Otherwise, if a `return` was
 * deferred to run this finally (CT===1), the return must continue through any
 * *outer* enclosing `finally` blocks before completing — so the handler stack
 * is unwound to the next finally (preserving the deferred value in CV) and
 * control transfers there; only when no further finally remains does the
 * function actually return. This makes `return`-through-`finally` correct for
 * arbitrarily nested `try`/`finally`, not just a single level.
 *
 * The unwind loop is driven purely by its condition (no inner
 * `break`/`continue`/`return`) so it survives the handler-body break/return
 * transforms applied by every dispatch style.
 *
 * ```
 * if(HPE){var ex=PE;PE=null;HPE=false;throw ex;}
 * if(CT===1){
 *   var _df=1;
 *   while(_df&&EX&&EX.length>0){var _h=EX.pop();S.length=_h._sp;if(_h._fi>=0){IP=_h._fi*2;_df=0;}}
 *   if(_df){var _rv2=CV;CT=0;CV=void 0;return _rv2;}
 * }
 * break;
 * ```
 */
function END_FINALLY(ctx: HandlerCtx): JsNode[] {
	const flag = ctx.local("retDefer");
	return [
		ifStmt(id(ctx.HPE), [
			varDecl(ctx.local("error"), id(ctx.PE)),
			exprStmt(assign(id(ctx.PE), lit(null))),
			exprStmt(assign(id(ctx.HPE), lit(false))),
			throwStmt(id(ctx.local("error"))),
		]),
		ifStmt(bin(BOp.Seq, id(ctx.CT), lit(1)), [
			varDecl(flag, lit(1)),
			whileStmt(
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
						bin(
							BOp.Gte,
							member(id(ctx.t("_h")), ctx.t("_fi")),
							lit(0)
						),
						[
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
			),
			ifStmt(id(flag), [
				varDecl(ctx.t("_rv2"), id(ctx.CV)),
				exprStmt(assign(id(ctx.CT), lit(0))),
				exprStmt(assign(id(ctx.CV), un(UOp.Void, lit(0)))),
				returnStmt(id(ctx.t("_rv2"))),
			]),
		]),
		breakStmt(),
	];
}

// --- Guard handlers ---

/**
 * THROW_IF_NOT_OBJECT: throw TypeError if top-of-stack is not an object.
 *
 * Peeks at the stack top without consuming it.
 */
function THROW_IF_NOT_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("value"), ctx.peek()),
		ifStmt(
			bin(
				BOp.Or,
				bin(
					BOp.Sneq,
					un(UOp.Typeof, id(ctx.local("value"))),
					lit("object")
				),
				bin(BOp.Seq, id(ctx.local("value")), lit(null))
			),
			[
				throwStmt(
					newExpr(id("TypeError"), [lit("Value is not an object")])
				),
			]
		),
		breakStmt(),
	];
}

// --- Error constructor handlers ---

/**
 * THROW_REF_ERROR: throw a ReferenceError with message from constant pool.
 */
function THROW_REF_ERROR(ctx: HandlerCtx): JsNode[] {
	return [
		throwStmt(
			newExpr(id("ReferenceError"), [
				bin(BOp.Or, index(id(ctx.C), id(ctx.O)), lit("not defined")),
			])
		),
	];
}

/**
 * THROW_TYPE_ERROR: throw a TypeError with message from constant pool.
 */
function THROW_TYPE_ERROR(ctx: HandlerCtx): JsNode[] {
	return [
		throwStmt(
			newExpr(id("TypeError"), [
				bin(BOp.Or, index(id(ctx.C), id(ctx.O)), lit("type error")),
			])
		),
	];
}

/**
 * THROW_SYNTAX_ERROR: throw a SyntaxError with message from constant pool.
 */
function THROW_SYNTAX_ERROR(ctx: HandlerCtx): JsNode[] {
	return [
		throwStmt(
			newExpr(id("SyntaxError"), [
				bin(BOp.Or, index(id(ctx.C), id(ctx.O)), lit("syntax error")),
			])
		),
	];
}

// --- Registration ---

registry.set(Op.TRY_PUSH, TRY_PUSH);
registry.set(Op.TRY_POP, TRY_POP);
registry.set(Op.CATCH_BIND, CATCH_BIND);
registry.set(Op.CATCH_BIND_PATTERN, CATCH_BIND_PATTERN);
registry.set(Op.FINALLY_MARK, FINALLY_MARK);
registry.set(Op.END_FINALLY, END_FINALLY);
registry.set(Op.THROW_IF_NOT_OBJECT, THROW_IF_NOT_OBJECT);
registry.set(Op.THROW_REF_ERROR, THROW_REF_ERROR);
registry.set(Op.THROW_TYPE_ERROR, THROW_TYPE_ERROR);
registry.set(Op.THROW_SYNTAX_ERROR, THROW_SYNTAX_ERROR);
