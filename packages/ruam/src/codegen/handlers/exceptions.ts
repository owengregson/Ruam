/**
 * Exception handling opcode handlers in AST node form.
 *
 * Covers 10 opcodes:
 *  - Try/catch:  TRY_PUSH, TRY_POP, CATCH_BIND, CATCH_BIND_PATTERN
 *  - Finally:    FINALLY_MARK, END_FINALLY
 *  - Guards:     THROW_IF_NOT_OBJECT
 *  - Error ctors: THROW_REF_ERROR, THROW_TYPE_ERROR, THROW_SYNTAX_ERROR
 *
 * @module codegen/handlers/exceptions
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
 * if(!EX)EX=[];EX.push({_ci:_ci,_fi:_fi,_sp:P});break;
 * ```
 */
function TRY_PUSH(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(
			"_ci",
			bin("&", bin(">>", id(ctx.O), lit(16)), lit(0xffff))
		),
		varDecl("_fi", bin("&", id(ctx.O), lit(0xffff))),
		ifStmt(bin("===", id("_ci"), lit(0xffff)), [
			exprStmt(assign(id("_ci"), un("-", lit(1)))),
		]),
		ifStmt(bin("===", id("_fi"), lit(0xffff)), [
			exprStmt(assign(id("_fi"), un("-", lit(1)))),
		]),
		ifStmt(un("!", id(ctx.EX)), [
			exprStmt(assign(id(ctx.EX), arr())),
		]),
		exprStmt(
			call(member(id(ctx.EX), "push"), [
				obj(
					["_ci", id("_ci")],
					["_fi", id("_fi")],
					["_sp", id(ctx.P)]
				),
			])
		),
		breakStmt(),
	];
}

/** TRY_POP: pop the top exception handler frame. */
function TRY_POP(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(call(member(id(ctx.EX), "pop"), [])),
		breakStmt(),
	];
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
		varDecl("err", ctx.pop()),
		ifStmt(
			bin(">=", id(ctx.O), lit(0)),
			[
				varDecl("cname", index(id(ctx.C), id(ctx.O))),
				ifStmt(
					bin("===", un("typeof", id("cname")), lit("string")),
					[
						exprStmt(
							assign(
								index(
									member(id(ctx.SC), ctx.sV),
									id("cname")
								),
								id("err")
							)
						),
					],
					[
						exprStmt(
							assign(
								index(id(ctx.R), id(ctx.O)),
								id("err")
							)
						),
					]
				),
			],
			[exprStmt(ctx.push(id("err")))]
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
		varDecl("err", ctx.pop()),
		exprStmt(ctx.push(id("err"))),
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
 * Re-throws pending exception if one exists.
 * Completes deferred return if completion type is set.
 *
 * ```
 * if(HPE){var ex=PE;PE=null;HPE=false;throw ex;}
 * if(CT===1){var _rv2=CV;CT=0;CV=void 0;return _rv2;}break;
 * ```
 */
function END_FINALLY(ctx: HandlerCtx): JsNode[] {
	return [
		ifStmt(id(ctx.HPE), [
			varDecl("ex", id(ctx.PE)),
			exprStmt(assign(id(ctx.PE), lit(null))),
			exprStmt(assign(id(ctx.HPE), lit(false))),
			throwStmt(id("ex")),
		]),
		ifStmt(bin("===", id(ctx.CT), lit(1)), [
			varDecl("_rv2", id(ctx.CV)),
			exprStmt(assign(id(ctx.CT), lit(0))),
			exprStmt(assign(id(ctx.CV), un("void", lit(0)))),
			returnStmt(id("_rv2")),
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
		varDecl("v", ctx.peek()),
		ifStmt(
			bin(
				"||",
				bin("!==", un("typeof", id("v")), lit("object")),
				bin("===", id("v"), lit(null))
			),
			[
				throwStmt(
					newExpr(id("TypeError"), [
						lit("Value is not an object"),
					])
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
				bin(
					"||",
					index(id(ctx.C), id(ctx.O)),
					lit("not defined")
				),
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
				bin(
					"||",
					index(id(ctx.C), id(ctx.O)),
					lit("type error")
				),
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
				bin(
					"||",
					index(id(ctx.C), id(ctx.O)),
					lit("syntax error")
				),
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
