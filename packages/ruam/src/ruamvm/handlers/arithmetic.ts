/**
 * Arithmetic and bitwise opcode handlers in AST node form.
 *
 * Covers 17 opcodes across two categories:
 *  - Arithmetic: ADD, SUB, MUL, DIV, MOD, POW, NEG, UNARY_PLUS, INC, DEC
 *  - Bitwise:    BIT_AND, BIT_OR, BIT_XOR, BIT_NOT, SHL, SHR, USHR
 *
 * @module ruamvm/handlers/arithmetic
 */

import { Op } from "../../compiler/opcodes.js";
import {
	id,
	varDecl,
	exprStmt,
	assign,
	bin,
	un,
	lit,
	breakStmt,
	type JsNode,
	BOp,
	UOp,
	type BOpKind,
	type UOpKind,
} from "../nodes.js";
import { registry, type HandlerCtx, type HandlerFn } from "./registry.js";

// --- Helpers ---

/**
 * Build a handler for binary ops: `{var b=S[P--];S[P]=S[P] op b;break;}`
 *
 * @param op - The JS binary operator string (e.g. `'+'`, `'&'`, `'<<'`)
 * @returns A handler function producing the AST for the case body
 */
function binaryHandler(op: BOpKind): HandlerFn {
	return (ctx) => [
		varDecl("b", ctx.pop()),
		exprStmt(assign(ctx.peek(), bin(op, ctx.peek(), id("b")))),
		breakStmt(),
	];
}

/**
 * Build a handler for unary ops: `S[P]=op S[P];break;`
 *
 * @param op - The JS unary operator string (e.g. `'-'`, `'~'`)
 * @returns A handler function producing the AST for the case body
 */
function unaryHandler(op: UOpKind): HandlerFn {
	return (ctx) => [
		exprStmt(assign(ctx.peek(), un(op, ctx.peek()))),
		breakStmt(),
	];
}

// --- Arithmetic handlers ---

registry.set(Op.ADD, binaryHandler(BOp.Add));
registry.set(Op.SUB, binaryHandler(BOp.Sub));
registry.set(Op.MUL, binaryHandler(BOp.Mul));
registry.set(Op.DIV, binaryHandler(BOp.Div));
registry.set(Op.MOD, binaryHandler(BOp.Mod));
registry.set(Op.POW, binaryHandler(BOp.Pow));

registry.set(Op.NEG, unaryHandler(UOp.Neg));
registry.set(Op.UNARY_PLUS, unaryHandler(UOp.Pos));

/** INC: `S[P]=+S[P]+1;break;` -- unary `+` for ToNumber coercion */
registry.set(Op.INC, (ctx) => [
	exprStmt(assign(ctx.peek(), bin(BOp.Add, un(UOp.Pos, ctx.peek()), lit(1)))),
	breakStmt(),
]);

/** DEC: `S[P]=+S[P]-1;break;` -- unary `+` for ToNumber coercion */
registry.set(Op.DEC, (ctx) => [
	exprStmt(assign(ctx.peek(), bin(BOp.Sub, un(UOp.Pos, ctx.peek()), lit(1)))),
	breakStmt(),
]);

// --- Bitwise handlers ---

registry.set(Op.BIT_AND, binaryHandler(BOp.BitAnd));
registry.set(Op.BIT_OR, binaryHandler(BOp.BitOr));
registry.set(Op.BIT_XOR, binaryHandler(BOp.BitXor));
registry.set(Op.BIT_NOT, unaryHandler(UOp.BitNot));
registry.set(Op.SHL, binaryHandler(BOp.Shl));
registry.set(Op.SHR, binaryHandler(BOp.Shr));
registry.set(Op.USHR, binaryHandler(BOp.Ushr));
