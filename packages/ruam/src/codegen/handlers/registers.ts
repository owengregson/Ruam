/** @module codegen/handlers/registers */

import { Op } from "../../compiler/opcodes.js";
import {
	type JsNode,
	id,
	lit,
	index,
	bin,
	un,
	member,
	ternary,
	raw,
	varDecl,
	exprStmt,
	breakStmt,
	assign,
} from "../nodes.js";
import type { HandlerCtx, HandlerFn } from "./registry.js";
import { registry } from "./registry.js";

// --- Helpers ---

/** Register slot expression: `R[O]` */
function rSlot(ctx: HandlerCtx): JsNode {
	return index(id(ctx.R), id(ctx.O));
}

/**
 * Build a compound assignment register handler.
 *
 * Pattern: `{var val=S[P--];R[O]=R[O] <op> val;S[++P]=R[O];break;}`
 *
 * @param op - JS binary operator string (e.g. `'+'`, `'-'`, `'*'`, `'/'`, `'%'`)
 * @returns Handler function producing the case body AST nodes
 */
function regAssignHandler(op: string): HandlerFn {
	return (ctx) => [
		varDecl("val", ctx.pop()),
		exprStmt(
			assign(rSlot(ctx), bin(op, index(id(ctx.R), id(ctx.O)), id("val")))
		),
		exprStmt(ctx.push(index(id(ctx.R), id(ctx.O)))),
		breakStmt(),
	];
}

// --- Register load/store ---

/** LOAD_REG: `S[++P]=R[O];break;` */
function LOAD_REG(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(rSlot(ctx))), breakStmt()];
}

/** STORE_REG: `R[O]=S[P--];break;` */
function STORE_REG(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(assign(rSlot(ctx), ctx.pop())), breakStmt()];
}

// --- Argument load/store ---

/** LOAD_ARG: `S[++P]=O<A.length?A[O]:void 0;break;` */
function LOAD_ARG(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(
			ctx.push(
				ternary(
					bin("<", id(ctx.O), member(id(ctx.A), "length")),
					index(id(ctx.A), id(ctx.O)),
					un("void", lit(0))
				)
			)
		),
		breakStmt(),
	];
}

/** STORE_ARG: `A[O]=S[P--];break;` */
function STORE_ARG(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(assign(index(id(ctx.A), id(ctx.O)), ctx.pop())),
		breakStmt(),
	];
}

/** LOAD_ARG_OR_DEFAULT: `S[++P]=O<A.length&&A[O]!==void 0?A[O]:void 0;break;` */
function LOAD_ARG_OR_DEFAULT(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(
			ctx.push(
				ternary(
					bin(
						"&&",
						bin("<", id(ctx.O), member(id(ctx.A), "length")),
						bin(
							"!==",
							index(id(ctx.A), id(ctx.O)),
							un("void", lit(0))
						)
					),
					index(id(ctx.A), id(ctx.O)),
					un("void", lit(0))
				)
			)
		),
		breakStmt(),
	];
}

/** GET_ARG_COUNT: `S[++P]=A.length;break;` */
function GET_ARG_COUNT(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(ctx.push(member(id(ctx.A), "length"))),
		breakStmt(),
	];
}

// --- Register increment/decrement ---

/** INC_REG: `R[O]=+R[O]+1;break;` */
function INC_REG(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(assign(rSlot(ctx), bin("+", un("+", rSlot(ctx)), lit(1)))),
		breakStmt(),
	];
}

/** DEC_REG: `R[O]=+R[O]-1;break;` */
function DEC_REG(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(assign(rSlot(ctx), bin("-", un("+", rSlot(ctx)), lit(1)))),
		breakStmt(),
	];
}

/** POST_INC_REG: `{var old=R[O];R[O]=+old+1;S[++P]=+old;break;}` */
function POST_INC_REG(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("old", rSlot(ctx)),
		exprStmt(assign(rSlot(ctx), bin("+", un("+", id("old")), lit(1)))),
		exprStmt(ctx.push(un("+", id("old")))),
		breakStmt(),
	];
}

/** POST_DEC_REG: `{var old=R[O];R[O]=+old-1;S[++P]=+old;break;}` */
function POST_DEC_REG(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("old", rSlot(ctx)),
		exprStmt(assign(rSlot(ctx), bin("-", un("+", id("old")), lit(1)))),
		exprStmt(ctx.push(un("+", id("old")))),
		breakStmt(),
	];
}

// --- Fast constant arithmetic ---

/** FAST_ADD_CONST: `S[P]=+S[P]+O;break;` */
function FAST_ADD_CONST(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(assign(ctx.peek(), bin("+", un("+", ctx.peek()), id(ctx.O)))),
		breakStmt(),
	];
}

/** FAST_SUB_CONST: `S[P]=+S[P]-O;break;` */
function FAST_SUB_CONST(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(assign(ctx.peek(), bin("-", un("+", ctx.peek()), id(ctx.O)))),
		breakStmt(),
	];
}

// --- Fast property access ---

/**
 * FAST_GET_PROP: scope-walking property access.
 *
 * Uses raw() because the while-loop with break is difficult to express
 * in AST form (the inner `break` exits the while loop, not the switch case).
 * The raw string contains both the while-break and the case-break.
 */
function FAST_GET_PROP(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var name=${ctx.C}[${ctx.O}&0xFFFF];var varName=${ctx.C}[(${ctx.O}>>16)&0xFFFF];` +
				`var s=${ctx.SC};while(s){if(varName in s.${ctx.sV}){${ctx.W}(s.${ctx.sV}[varName][name]);break;}s=s.${ctx.sPar};}break;`
		),
	];
}

// --- Fast global access ---

/** LOAD_GLOBAL_FAST: `{var g=_g;S[++P]=g[C[O]];break;}` */
function LOAD_GLOBAL_FAST(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("g", id("_g")),
		exprStmt(ctx.push(index(id("g"), index(id(ctx.C), id(ctx.O))))),
		breakStmt(),
	];
}

// --- Registration ---

registry.set(Op.LOAD_REG, LOAD_REG);
registry.set(Op.STORE_REG, STORE_REG);
registry.set(Op.LOAD_ARG, LOAD_ARG);
registry.set(Op.STORE_ARG, STORE_ARG);
registry.set(Op.LOAD_ARG_OR_DEFAULT, LOAD_ARG_OR_DEFAULT);
registry.set(Op.GET_ARG_COUNT, GET_ARG_COUNT);
registry.set(Op.INC_REG, INC_REG);
registry.set(Op.DEC_REG, DEC_REG);
registry.set(Op.POST_INC_REG, POST_INC_REG);
registry.set(Op.POST_DEC_REG, POST_DEC_REG);
registry.set(Op.ADD_ASSIGN_REG, regAssignHandler("+"));
registry.set(Op.SUB_ASSIGN_REG, regAssignHandler("-"));
registry.set(Op.MUL_ASSIGN_REG, regAssignHandler("*"));
registry.set(Op.DIV_ASSIGN_REG, regAssignHandler("/"));
registry.set(Op.MOD_ASSIGN_REG, regAssignHandler("%"));
registry.set(Op.FAST_ADD_CONST, FAST_ADD_CONST);
registry.set(Op.FAST_SUB_CONST, FAST_SUB_CONST);
registry.set(Op.FAST_GET_PROP, FAST_GET_PROP);
registry.set(Op.LOAD_GLOBAL_FAST, LOAD_GLOBAL_FAST);
