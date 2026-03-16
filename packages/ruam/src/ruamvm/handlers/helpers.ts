/**
 * Shared AST-building helpers for opcode handlers.
 *
 * Provides reusable patterns for this-boxing, debug tracing,
 * closure wrapping, and super property resolution.
 *
 * @module ruamvm/handlers/helpers
 */

import type { JsNode } from "../nodes.js";
import {
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
	returnStmt,
	fnExpr,
	ternary,
	BOp,
	UOp,
} from "../nodes.js";
import type { HandlerCtx } from "./registry.js";

// --- This-boxing ---

/**
 * Build sloppy-mode this-boxing AST nodes.
 *
 * Declares `_tv` from `this`, then boxes null->globalThis,
 * primitives->Object(). Used by non-arrow function handlers.
 *
 * @returns JsNode[] to insert in function body
 */
export function buildThisBoxing(ctx?: HandlerCtx): JsNode[] {
	const tvName = ctx ? ctx.t("_tv") : "_tv";
	const ttName = ctx ? ctx.t("_tt") : "_tt";
	return [
		varDecl(tvName, id("this")),
		ifStmt(un(UOp.Not, member(id("u"), "st")), [
			ifStmt(
				bin(BOp.Eq, id(tvName), lit(null)),
				[exprStmt(assign(id(tvName), id("globalThis")))],
				[
					varDecl(ttName, un(UOp.Typeof, id(tvName))),
					ifStmt(
						bin(
							BOp.And,
							bin(BOp.Sneq, id(ttName), lit("object")),
							bin(BOp.Sneq, id(ttName), lit("function"))
						),
						[
							exprStmt(
								assign(
									id(tvName),
									call(id("Object"), [id(tvName)])
								)
							),
						]
					),
				]
			),
		]),
	];
}

// --- Debug tracing ---

/**
 * Emit conditional debug trace call.
 *
 * Returns empty array when debug is off, so it can always be spread
 * into a statement list: `...debugTrace(ctx, 'NAME', args)`.
 *
 * @param ctx - Handler context with debug flag and dbg function name
 * @param name - Opcode name for the trace log
 * @param args - Additional AST nodes to pass to the debug function
 * @returns JsNode[] — empty when debug is off, otherwise a single exprStmt
 */
export function debugTrace(
	ctx: HandlerCtx,
	name: string,
	...args: JsNode[]
): JsNode[] {
	if (!ctx.debug) return [];
	return [exprStmt(call(id(ctx.dbg), [lit(name), ...args]))];
}

// --- Super property resolution ---

/**
 * Build the super prototype resolution expression.
 *
 * ```js
 * HO ? Object.getPrototypeOf(HO) : Object.getPrototypeOf(Object.getPrototypeOf(TV))
 * ```
 *
 * @param ctx - Handler context with HO and TV names
 * @returns JsNode — ternary expression resolving the super prototype
 */
export function superProto(ctx: HandlerCtx): JsNode {
	const gpo = (arg: JsNode) =>
		call(member(id("Object"), "getPrototypeOf"), [arg]);
	return ternary(id(ctx.HO), gpo(id(ctx.HO)), gpo(gpo(id(ctx.TV))));
}

/**
 * Build the super property key resolution expression.
 *
 * If operand >= 0, uses constant pool; otherwise pops from stack.
 * ```js
 * O >= 0 ? C[O] : S[P--]
 * ```
 *
 * @param ctx - Handler context with O, C names and pop() factory
 * @returns JsNode — ternary expression resolving the super key
 */
export function superKey(ctx: HandlerCtx): JsNode {
	return ternary(
		bin(BOp.Gte, id(ctx.O), lit(0)),
		index(id(ctx.C), id(ctx.O)),
		ctx.pop()
	);
}

// --- Closure IIFE builders ---

/**
 * Build an arrow-function closure IIFE (captures outer this + scope).
 *
 * ```js
 * (function(u,cs,ct){
 *   if(u.s) return async function(..._a){ return execAsync(u,_a,cs,ct); };
 *   return function(..._a){ return exec(u,_a,cs,ct); };
 * })(_cu, SC, TV)
 * ```
 *
 * @param ctx - Handler context with exec/execAsync names and SC/TV
 * @returns JsNode — IIFE call expression
 */
export function buildArrowClosureIIFE(ctx: HandlerCtx): JsNode {
	const execCall = (isAsync: boolean) =>
		returnStmt(
			call(id(isAsync ? ctx.execAsync : ctx.exec), [
				id("u"),
				id(ctx.t("_a")),
				id("cs"),
				id("ct"),
			])
		);
	return call(
		fnExpr(
			undefined,
			["u", "cs", "ct"],
			[
				ifStmt(member(id("u"), "s"), [
					returnStmt(
						fnExpr(
							undefined,
							["..." + ctx.t("_a")],
							[execCall(true)],
							{
								async: true,
							}
						)
					),
				]),
				returnStmt(
					fnExpr(undefined, ["..." + ctx.t("_a")], [execCall(false)])
				),
			]
		),
		[id(ctx.t("_cu")), id(ctx.SC), id(ctx.TV)]
	);
}

/**
 * Build a non-arrow closure IIFE (with this-boxing + home object).
 *
 * ```js
 * (function(u,cs){
 *   if(u.s) { var fn = async function(..._a){ <thisBoxing>; return execAsync(u,_a,cs,_tv,void 0,fn._ho); }; return fn; }
 *   var fn = function(..._a){ <thisBoxing>; return exec(u,_a,cs,_tv,void 0,fn._ho); }; return fn;
 * })(_cu, SC)
 * ```
 *
 * @param ctx - Handler context with exec/execAsync names and SC
 * @returns JsNode — IIFE call expression
 */
export function buildRegularClosureIIFE(ctx: HandlerCtx): JsNode {
	const fnBody = (isAsync: boolean): JsNode[] => [
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
			["u", "cs"],
			[
				ifStmt(member(id("u"), "s"), [
					varDecl(
						"fn",
						fnExpr(undefined, ["..." + ctx.t("_a")], fnBody(true), {
							async: true,
						})
					),
					returnStmt(id("fn")),
				]),
				varDecl(
					"fn",
					fnExpr(undefined, ["..." + ctx.t("_a")], fnBody(false))
				),
				returnStmt(id("fn")),
			]
		),
		[id(ctx.t("_cu")), id(ctx.SC)]
	);
}
