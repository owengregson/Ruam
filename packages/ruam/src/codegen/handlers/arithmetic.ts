/**
 * Arithmetic and bitwise opcode handlers in AST node form.
 *
 * Covers 17 opcodes across two categories:
 *  - Arithmetic: ADD, SUB, MUL, DIV, MOD, POW, NEG, UNARY_PLUS, INC, DEC
 *  - Bitwise:    BIT_AND, BIT_OR, BIT_XOR, BIT_NOT, SHL, SHR, USHR
 *
 * @module codegen/handlers/arithmetic
 */

import { Op } from "../../compiler/opcodes.js";
import {
	id, index, update, varDecl, exprStmt, assign, bin, un, lit, breakStmt,
	type JsNode,
} from "../nodes.js";
import { registry, type HandlerCtx, type HandlerFn } from "./registry.js";

// --- Helpers ---

/** Stack-top expression: `S[P]` */
function sTop(ctx: HandlerCtx): JsNode {
	return index(id(ctx.S), id(ctx.P));
}

/** Pop-into-b expression: `S[P--]` */
function sPop(ctx: HandlerCtx): JsNode {
	return index(id(ctx.S), update('--', false, id(ctx.P)));
}

/**
 * Build a handler for binary ops: `{var b=S[P--];S[P]=S[P] op b;break;}`
 *
 * @param op - The JS binary operator string (e.g. `'+'`, `'&'`, `'<<'`)
 * @returns A handler function producing the AST for the case body
 */
function binaryHandler(op: string): HandlerFn {
	return (ctx) => [
		varDecl('b', sPop(ctx)),
		exprStmt(assign(sTop(ctx), bin(op, sTop(ctx), id('b')))),
		breakStmt(),
	];
}

/**
 * Build a handler for unary ops: `S[P]=op S[P];break;`
 *
 * @param op - The JS unary operator string (e.g. `'-'`, `'~'`)
 * @returns A handler function producing the AST for the case body
 */
function unaryHandler(op: string): HandlerFn {
	return (ctx) => [
		exprStmt(assign(sTop(ctx), un(op, sTop(ctx)))),
		breakStmt(),
	];
}

// --- Arithmetic handlers ---

registry.set(Op.ADD, binaryHandler('+'));
registry.set(Op.SUB, binaryHandler('-'));
registry.set(Op.MUL, binaryHandler('*'));
registry.set(Op.DIV, binaryHandler('/'));
registry.set(Op.MOD, binaryHandler('%'));
registry.set(Op.POW, binaryHandler('**'));

registry.set(Op.NEG, unaryHandler('-'));
registry.set(Op.UNARY_PLUS, unaryHandler('+'));

/** INC: `S[P]=+S[P]+1;break;` -- unary `+` for ToNumber coercion */
registry.set(Op.INC, (ctx) => [
	exprStmt(assign(sTop(ctx), bin('+', un('+', sTop(ctx)), lit(1)))),
	breakStmt(),
]);

/** DEC: `S[P]=+S[P]-1;break;` -- unary `+` for ToNumber coercion */
registry.set(Op.DEC, (ctx) => [
	exprStmt(assign(sTop(ctx), bin('-', un('+', sTop(ctx)), lit(1)))),
	breakStmt(),
]);

// --- Bitwise handlers ---

registry.set(Op.BIT_AND, binaryHandler('&'));
registry.set(Op.BIT_OR, binaryHandler('|'));
registry.set(Op.BIT_XOR, binaryHandler('^'));
registry.set(Op.BIT_NOT, unaryHandler('~'));
registry.set(Op.SHL, binaryHandler('<<'));
registry.set(Op.SHR, binaryHandler('>>'));
registry.set(Op.USHR, binaryHandler('>>>'));
