/**
 * Function creation and closure opcode handlers in AST node form.
 *
 * Covers 12 opcodes:
 *  - Closures:    NEW_CLOSURE, NEW_FUNCTION, NEW_ARROW, NEW_ASYNC,
 *                 NEW_GENERATOR, NEW_ASYNC_GENERATOR
 *  - Metadata:    SET_FUNC_NAME, SET_FUNC_LENGTH
 *  - Stubs:       BIND_THIS, MAKE_METHOD
 *  - Closure vars: PUSH_CLOSURE_VAR, STORE_CLOSURE_VAR
 *
 * All handlers use pure AST nodes — no raw() escape hatch.
 *
 * @module ruamvm/handlers/functions
 */

import { Op } from "../../compiler/opcodes.js";
import {
	type JsNode,
	id,
	lit,
	bin,
	un,
	assign,
	call,
	member,
	index,
	varDecl,
	exprStmt,
	ifStmt,
	fnExpr,
	returnStmt,
	tryCatch,
	breakStmt,
	obj,
	BOp,
	UOp,
} from "../nodes.js";
import type { HandlerCtx } from "./registry.js";
import { registry } from "./registry.js";
import {
	buildArrowClosureIIFE,
	buildRegularClosureIIFE,
	buildThisBoxing,
	debugTrace,
} from "./helpers.js";

// --- Debug closure IIFE builders ---

/**
 * Build a debug-mode arrow closure IIFE.
 *
 * Like buildArrowClosureIIFE but captures `uid` and emits debug trace calls
 * inside the wrapper function body.
 *
 * @param ctx - Handler context with debug function name
 * @returns JsNode — IIFE call expression
 */
function buildDebugArrowClosureIIFE(ctx: HandlerCtx): JsNode {
	const innerBody = (isAsync: boolean): JsNode[] => [
		exprStmt(
			call(id(ctx.dbg), [
				lit("CALL_CLOSURE"),
				bin(
					BOp.Add,
					lit(isAsync ? "async arrow uid=" : "arrow uid="),
					id("uid")
				),
				bin(BOp.Add, lit("args="), member(id(ctx.t("_a")), "length")),
			])
		),
		returnStmt(
			call(id(isAsync ? ctx.execAsync : ctx.exec), [
				id("u"),
				id(ctx.t("_a")),
				id("cs"),
				id("ct"),
			])
		),
	];
	return call(
		fnExpr(
			undefined,
			["u", "uid", "cs", "ct"],
			[
				ifStmt(member(id("u"), "s"), [
					returnStmt(
						fnExpr(
							undefined,
							["..." + ctx.t("_a")],
							innerBody(true),
							{
								async: true,
							}
						)
					),
				]),
				returnStmt(
					fnExpr(undefined, ["..." + ctx.t("_a")], innerBody(false))
				),
			]
		),
		[id(ctx.t("_cu")), id(ctx.t("_cuid")), id(ctx.SC), id(ctx.TV)]
	);
}

/**
 * Build a debug-mode regular (non-arrow) closure IIFE.
 *
 * Like buildRegularClosureIIFE but captures `uid` and emits debug trace calls
 * inside the wrapper function body.
 *
 * @param ctx - Handler context with debug function name
 * @returns JsNode — IIFE call expression
 */
function buildDebugRegularClosureIIFE(ctx: HandlerCtx): JsNode {
	const innerBody = (isAsync: boolean): JsNode[] => [
		exprStmt(
			call(id(ctx.dbg), [
				lit("CALL_CLOSURE"),
				bin(BOp.Add, lit(isAsync ? "async uid=" : "uid="), id("uid")),
				bin(BOp.Add, lit("args="), member(id(ctx.t("_a")), "length")),
			])
		),
		...buildThisBoxing(ctx),
		returnStmt(
			call(id(isAsync ? ctx.execAsync : ctx.exec), [
				id("u"),
				id(ctx.t("_a")),
				id("cs"),
				id(ctx.t("_tv")),
				un(UOp.Void, lit(0)),
				member(id("fn"), ctx.t("_ho")),
			])
		),
	];
	return call(
		fnExpr(
			undefined,
			["u", "uid", "cs"],
			[
				ifStmt(member(id("u"), "s"), [
					varDecl(
						"fn",
						fnExpr(
							undefined,
							["..." + ctx.t("_a")],
							innerBody(true),
							{
								async: true,
							}
						)
					),
					returnStmt(id("fn")),
				]),
				varDecl(
					"fn",
					fnExpr(undefined, ["..." + ctx.t("_a")], innerBody(false))
				),
				returnStmt(id("fn")),
			]
		),
		[id(ctx.t("_cu")), id(ctx.t("_cuid")), id(ctx.SC)]
	);
}

/**
 * Build a debug-mode function (non-arrow, no arrow branch) closure IIFE.
 *
 * Like buildDebugRegularClosureIIFE but uses "CALL_FUNCTION" trace label
 * and captures `_fuid` as the unit ID.
 *
 * @param ctx - Handler context with debug function name
 * @returns JsNode — IIFE call expression
 */
function buildDebugFunctionClosureIIFE(ctx: HandlerCtx): JsNode {
	const innerBody = (isAsync: boolean): JsNode[] => [
		exprStmt(
			call(id(ctx.dbg), [
				lit("CALL_FUNCTION"),
				bin(BOp.Add, lit(isAsync ? "async uid=" : "uid="), id("uid")),
				bin(BOp.Add, lit("args="), member(id(ctx.t("_a")), "length")),
			])
		),
		...buildThisBoxing(ctx),
		returnStmt(
			call(id(isAsync ? ctx.execAsync : ctx.exec), [
				id("u"),
				id(ctx.t("_a")),
				id("cs"),
				id(ctx.t("_tv")),
				un(UOp.Void, lit(0)),
				member(id("fn"), ctx.t("_ho")),
			])
		),
	];
	return call(
		fnExpr(
			undefined,
			["u", "uid", "cs"],
			[
				ifStmt(member(id("u"), "s"), [
					varDecl(
						"fn",
						fnExpr(
							undefined,
							["..." + ctx.t("_a")],
							innerBody(true),
							{
								async: true,
							}
						)
					),
					returnStmt(id("fn")),
				]),
				varDecl(
					"fn",
					fnExpr(undefined, ["..." + ctx.t("_a")], innerBody(false))
				),
				returnStmt(id("fn")),
			]
		),
		[id(ctx.t("_fu")), id(ctx.t("_fuid")), id(ctx.SC)]
	);
}

// --- Primary closure handlers ---

/**
 * NEW_CLOSURE: create a closure wrapper for a compiled unit.
 *
 * Branches on arrow (captures outer this/scope) vs regular (this-boxing),
 * sync vs async, with debug tracing when enabled.  Home object (`fn._ho`)
 * is forwarded for super call resolution.
 */
function NEW_CLOSURE(ctx: HandlerCtx): JsNode[] {
	if (ctx.debug) {
		return [
			varDecl(ctx.t("_cuid"), index(id(ctx.C), id(ctx.O))),
			varDecl(ctx.t("_cu"), call(id(ctx.load), [id(ctx.t("_cuid"))])),
			exprStmt(
				assign(
					member(id(ctx.t("_cu")), ctx.t("_dbgId")),
					id(ctx.t("_cuid"))
				)
			),
			exprStmt(
				call(id(ctx.dbg), [
					lit("NEW_CLOSURE"),
					bin(BOp.Add, lit("uid="), id(ctx.t("_cuid"))),
					bin(
						BOp.Add,
						lit("async="),
						un(UOp.Not, un(UOp.Not, member(id(ctx.t("_cu")), "s")))
					),
					bin(BOp.Add, lit("params="), member(id(ctx.t("_cu")), "p")),
					bin(
						BOp.Add,
						lit("arrow="),
						un(UOp.Not, un(UOp.Not, member(id(ctx.t("_cu")), "a")))
					),
				])
			),
			ifStmt(
				member(id(ctx.t("_cu")), "a"),
				[exprStmt(ctx.push(buildDebugArrowClosureIIFE(ctx)))],
				[exprStmt(ctx.push(buildDebugRegularClosureIIFE(ctx)))]
			),
			breakStmt(),
		];
	}
	return [
		varDecl(
			ctx.t("_cu"),
			call(id(ctx.load), [index(id(ctx.C), id(ctx.O))])
		),
		ifStmt(
			member(id(ctx.t("_cu")), "a"),
			[exprStmt(ctx.push(buildArrowClosureIIFE(ctx)))],
			[exprStmt(ctx.push(buildRegularClosureIIFE(ctx)))]
		),
		breakStmt(),
	];
}

/**
 * NEW_FUNCTION: create a function wrapper (no arrow variant).
 *
 * Simpler than NEW_CLOSURE — always non-arrow, so always includes
 * this-boxing and home object forwarding.
 */
function NEW_FUNCTION(ctx: HandlerCtx): JsNode[] {
	if (ctx.debug) {
		return [
			varDecl(ctx.t("_fuid"), index(id(ctx.C), id(ctx.O))),
			varDecl(ctx.t("_fu"), call(id(ctx.load), [id(ctx.t("_fuid"))])),
			exprStmt(
				assign(
					member(id(ctx.t("_fu")), ctx.t("_dbgId")),
					id(ctx.t("_fuid"))
				)
			),
			exprStmt(
				call(id(ctx.dbg), [
					lit("NEW_FUNCTION"),
					bin(BOp.Add, lit("uid="), id(ctx.t("_fuid"))),
					bin(
						BOp.Add,
						lit("async="),
						un(UOp.Not, un(UOp.Not, member(id(ctx.t("_fu")), "s")))
					),
					bin(BOp.Add, lit("params="), member(id(ctx.t("_fu")), "p")),
				])
			),
			exprStmt(ctx.push(buildDebugFunctionClosureIIFE(ctx))),
			breakStmt(),
		];
	}
	return [
		varDecl(
			ctx.t("_cu"),
			call(id(ctx.load), [index(id(ctx.C), id(ctx.O))])
		),
		exprStmt(ctx.push(buildRegularClosureIIFE(ctx))),
		breakStmt(),
	];
}

// --- Specialized function creation handlers ---

/**
 * NEW_ARROW: create an arrow function (captures outer this + scope).
 *
 * No this-boxing — arrow functions inherit `this` from enclosing context.
 */
function NEW_ARROW(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(
			ctx.t("_cu"),
			call(id(ctx.load), [index(id(ctx.C), id(ctx.O))])
		),
		exprStmt(ctx.push(buildArrowClosureIIFE(ctx))),
		breakStmt(),
	];
}

/**
 * NEW_ASYNC: create an async function with this-boxing.
 *
 * Always async, always non-arrow — uses execAsync with this-boxing.
 */
function NEW_ASYNC(ctx: HandlerCtx): JsNode[] {
	const asyncBody: JsNode[] = [
		...buildThisBoxing(ctx),
		returnStmt(
			call(id(ctx.execAsync), [
				id("u"),
				id(ctx.t("_a")),
				id("cs"),
				id(ctx.t("_tv")),
			])
		),
	];
	return [
		varDecl(
			ctx.t("_cu"),
			call(id(ctx.load), [index(id(ctx.C), id(ctx.O))])
		),
		exprStmt(
			ctx.push(
				call(
					fnExpr(
						undefined,
						["u", "cs"],
						[
							returnStmt(
								fnExpr(
									undefined,
									["..." + ctx.t("_a")],
									asyncBody,
									{
										async: true,
									}
								)
							),
						]
					),
					[id(ctx.t("_cu")), id(ctx.SC)]
				)
			)
		),
		breakStmt(),
	];
}

/**
 * NEW_GENERATOR / NEW_ASYNC_GENERATOR: create a generator function.
 *
 * Both are handled identically — generators are stub-executed (run to completion).
 * Always non-arrow, always sync, uses exec with this-boxing.
 */
function NEW_GENERATOR_HANDLER(ctx: HandlerCtx): JsNode[] {
	const fnBody: JsNode[] = [
		...buildThisBoxing(ctx),
		returnStmt(
			call(id(ctx.exec), [
				id("u"),
				id(ctx.t("_a")),
				id("cs"),
				id(ctx.t("_tv")),
			])
		),
	];
	return [
		varDecl(
			ctx.t("_cu"),
			call(id(ctx.load), [index(id(ctx.C), id(ctx.O))])
		),
		exprStmt(
			ctx.push(
				call(
					fnExpr(
						undefined,
						["u", "cs"],
						[
							returnStmt(
								fnExpr(undefined, ["..." + ctx.t("_a")], fnBody)
							),
						]
					),
					[id(ctx.t("_cu")), id(ctx.SC)]
				)
			)
		),
		breakStmt(),
	];
}

// --- Metadata handlers ---

/**
 * SET_FUNC_NAME: set the `name` property on the function at stack top.
 *
 * Uses Object.defineProperty for configurable-only (non-writable, non-enumerable).
 */
function SET_FUNC_NAME(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("func"), ctx.peek()),
		tryCatch(
			[
				exprStmt(
					call(member(id("Object"), "defineProperty"), [
						id(ctx.local("func")),
						lit("name"),
						obj(
							["value", index(id(ctx.C), id(ctx.O))],
							["configurable", lit(true)]
						),
					])
				),
			],
			ctx.local("catchErr"),
			[]
		),
		breakStmt(),
	];
}

/**
 * SET_FUNC_LENGTH: set the `length` property on the function at stack top.
 */
function SET_FUNC_LENGTH(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("func"), ctx.peek()),
		tryCatch(
			[
				exprStmt(
					call(member(id("Object"), "defineProperty"), [
						id(ctx.local("func")),
						lit("length"),
						obj(["value", id(ctx.O)], ["configurable", lit(true)]),
					])
				),
			],
			ctx.local("catchErr"),
			[]
		),
		breakStmt(),
	];
}

// --- Stub handlers ---

/** BIND_THIS / MAKE_METHOD: no-op stubs. */
function BIND_STUB(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

// --- Closure variable handlers ---

/**
 * PUSH_CLOSURE_VAR: walk scope chain to find a captured variable, push its value.
 *
 * Uses ctx.scopeWalk() for structured scope chain traversal.
 */
function PUSH_CLOSURE_VAR(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("varName"), index(id(ctx.C), id(ctx.O))),
		varDecl(ctx.local("scopeWalk"), id(ctx.SC)),
		...ctx.scopeWalk(
			[exprStmt(ctx.push(ctx.sv(id(ctx.local("varName")))))],
			id(ctx.local("varName"))
		),
	];
}

/**
 * STORE_CLOSURE_VAR: walk scope chain to find a captured variable, store a value.
 *
 * Pops the value from the stack, then walks the scope chain to find the slot.
 */
function STORE_CLOSURE_VAR(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("varName"), index(id(ctx.C), id(ctx.O))),
		varDecl(ctx.local("value"), ctx.pop()),
		varDecl(ctx.local("scopeWalk"), id(ctx.SC)),
		...ctx.scopeWalk(
			[
				exprStmt(
					assign(
						ctx.sv(id(ctx.local("varName"))),
						id(ctx.local("value"))
					)
				),
			],
			id(ctx.local("varName"))
		),
	];
}

// --- Registration ---

registry.set(Op.NEW_CLOSURE, NEW_CLOSURE);
registry.set(Op.NEW_FUNCTION, NEW_FUNCTION);
registry.set(Op.NEW_ARROW, NEW_ARROW);
registry.set(Op.NEW_ASYNC, NEW_ASYNC);
registry.set(Op.NEW_GENERATOR, NEW_GENERATOR_HANDLER);
registry.set(Op.NEW_ASYNC_GENERATOR, NEW_GENERATOR_HANDLER);
registry.set(Op.SET_FUNC_NAME, SET_FUNC_NAME);
registry.set(Op.SET_FUNC_LENGTH, SET_FUNC_LENGTH);
registry.set(Op.BIND_THIS, BIND_STUB);
registry.set(Op.MAKE_METHOD, BIND_STUB);
registry.set(Op.PUSH_CLOSURE_VAR, PUSH_CLOSURE_VAR);
registry.set(Op.STORE_CLOSURE_VAR, STORE_CLOSURE_VAR);
