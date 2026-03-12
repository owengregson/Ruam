/**
 * Stack manipulation opcode handlers in AST node form.
 *
 * Covers push/pop/dup/swap/rotate operations on the VM stack.
 * Uses Array.push()/pop() and length-based indexing instead of a
 * dedicated stack pointer variable — the stack looks like normal
 * array manipulation rather than a VM stack machine.
 *
 * @module ruamvm/handlers/stack
 */

import { Op } from "../../compiler/opcodes.js";
import {
	type JsNode,
	exprStmt,
	breakStmt,
	varDecl,
	id,
	lit,
	bin,
	un,
	assign,
	index,
	member,
	call,
} from "../nodes.js";
import { type HandlerCtx, registry } from "./registry.js";

// --- Push handlers ---

function PUSH_CONST(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(index(id(ctx.C), id(ctx.O)))), breakStmt()];
}

function PUSH_UNDEFINED(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(un("void", lit(0)))), breakStmt()];
}

function PUSH_NULL(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(lit(null))), breakStmt()];
}

function PUSH_TRUE(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(lit(true))), breakStmt()];
}

function PUSH_FALSE(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(lit(false))), breakStmt()];
}

function PUSH_ZERO(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(lit(0))), breakStmt()];
}

function PUSH_ONE(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(lit(1))), breakStmt()];
}

function PUSH_NEG_ONE(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(un("-", lit(1)))), breakStmt()];
}

function PUSH_EMPTY_STRING(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(lit(""))), breakStmt()];
}

function PUSH_NAN(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(id("NaN"))), breakStmt()];
}

function PUSH_INFINITY(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(id("Infinity"))), breakStmt()];
}

function PUSH_NEG_INFINITY(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(un("-", id("Infinity")))), breakStmt()];
}

// --- Pop / stack pointer handlers ---

/** POP: discard top of stack. */
function POP(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.pop()), breakStmt()];
}

/** POP_N: discard top N elements from stack. */
function POP_N(ctx: HandlerCtx): JsNode[] {
	// S.length -= O
	return [
		exprStmt(assign(member(id(ctx.S), "length"), id(ctx.O), "-")),
		breakStmt(),
	];
}

// --- Duplication handlers ---

/** DUP: duplicate top of stack. */
function DUP(ctx: HandlerCtx): JsNode[] {
	// S.push(S[S.length-1])
	return [exprStmt(ctx.push(ctx.peek())), breakStmt()];
}

/** DUP2: duplicate top two elements. */
function DUP2(ctx: HandlerCtx): JsNode[] {
	return [
		// var _a=S[S.length-2], _b=S[S.length-1]
		varDecl(
			ctx.t("_a"),
			index(id(ctx.S), bin("-", member(id(ctx.S), "length"), lit(2)))
		),
		varDecl(ctx.t("_b"), ctx.peek()),
		// S.push(_a); S.push(_b)
		exprStmt(ctx.push(id(ctx.t("_a")))),
		exprStmt(ctx.push(id(ctx.t("_b")))),
		breakStmt(),
	];
}

// --- Swap / rotate handlers ---

/** SWAP: swap top two elements. */
function SWAP(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("a", ctx.pop()),
		varDecl("b", ctx.pop()),
		exprStmt(ctx.push(id("a"))),
		exprStmt(ctx.push(id("b"))),
		breakStmt(),
	];
}

/** ROT3: rotate top 3 elements (abc -> cab). */
function ROT3(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("c", ctx.pop()),
		varDecl("b", ctx.pop()),
		varDecl("a", ctx.pop()),
		exprStmt(ctx.push(id("c"))),
		exprStmt(ctx.push(id("a"))),
		exprStmt(ctx.push(id("b"))),
		breakStmt(),
	];
}

/** ROT4: rotate top 4 elements (abcd -> dabc). */
function ROT4(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("d", ctx.pop()),
		varDecl("c", ctx.pop()),
		varDecl("b", ctx.pop()),
		varDecl("a", ctx.pop()),
		exprStmt(ctx.push(id("d"))),
		exprStmt(ctx.push(id("a"))),
		exprStmt(ctx.push(id("b"))),
		exprStmt(ctx.push(id("c"))),
		breakStmt(),
	];
}

// --- Pick handler ---

/** PICK: copy element at depth O onto top of stack. */
function PICK(ctx: HandlerCtx): JsNode[] {
	// S.push(S[S.length-1-O])
	return [
		exprStmt(
			ctx.push(
				index(
					id(ctx.S),
					bin(
						"-",
						bin("-", member(id(ctx.S), "length"), lit(1)),
						id(ctx.O)
					)
				)
			)
		),
		breakStmt(),
	];
}

// --- Registration ---

registry.set(Op.PUSH_CONST, PUSH_CONST);
registry.set(Op.PUSH_UNDEFINED, PUSH_UNDEFINED);
registry.set(Op.PUSH_NULL, PUSH_NULL);
registry.set(Op.PUSH_TRUE, PUSH_TRUE);
registry.set(Op.PUSH_FALSE, PUSH_FALSE);
registry.set(Op.PUSH_ZERO, PUSH_ZERO);
registry.set(Op.PUSH_ONE, PUSH_ONE);
registry.set(Op.PUSH_NEG_ONE, PUSH_NEG_ONE);
registry.set(Op.PUSH_EMPTY_STRING, PUSH_EMPTY_STRING);
registry.set(Op.PUSH_NAN, PUSH_NAN);
registry.set(Op.PUSH_INFINITY, PUSH_INFINITY);
registry.set(Op.PUSH_NEG_INFINITY, PUSH_NEG_INFINITY);
registry.set(Op.POP, POP);
registry.set(Op.POP_N, POP_N);
registry.set(Op.DUP, DUP);
registry.set(Op.DUP2, DUP2);
registry.set(Op.SWAP, SWAP);
registry.set(Op.ROT3, ROT3);
registry.set(Op.ROT4, ROT4);
registry.set(Op.PICK, PICK);
