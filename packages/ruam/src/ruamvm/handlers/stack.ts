/**
 * Stack manipulation opcode handlers in AST node form.
 *
 * Covers push/pop/dup/swap/rotate operations on the VM stack.
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
	update,
	assign,
	index,
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

function POP(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(update("--", false, id(ctx.P))), breakStmt()];
}

function POP_N(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(assign(id(ctx.P), id(ctx.O), "-")), breakStmt()];
}

// --- Duplication handlers ---

function DUP(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(
			assign(
				index(id(ctx.S), bin("+", id(ctx.P), lit(1))),
				index(id(ctx.S), id(ctx.P))
			)
		),
		exprStmt(update("++", false, id(ctx.P))),
		breakStmt(),
	];
}

function DUP2(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.t("_a"), index(id(ctx.S), bin("-", id(ctx.P), lit(1)))),
		varDecl(ctx.t("_b"), index(id(ctx.S), id(ctx.P))),
		exprStmt(
			assign(
				index(id(ctx.S), update("++", true, id(ctx.P))),
				id(ctx.t("_a"))
			)
		),
		exprStmt(
			assign(
				index(id(ctx.S), update("++", true, id(ctx.P))),
				id(ctx.t("_b"))
			)
		),
		breakStmt(),
	];
}

// --- Swap / rotate handlers ---

function SWAP(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("a", index(id(ctx.S), update("--", false, id(ctx.P)))),
		varDecl("b", index(id(ctx.S), update("--", false, id(ctx.P)))),
		exprStmt(
			assign(index(id(ctx.S), update("++", true, id(ctx.P))), id("a"))
		),
		exprStmt(
			assign(index(id(ctx.S), update("++", true, id(ctx.P))), id("b"))
		),
		breakStmt(),
	];
}

function ROT3(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("c", index(id(ctx.S), update("--", false, id(ctx.P)))),
		varDecl("b", index(id(ctx.S), update("--", false, id(ctx.P)))),
		varDecl("a", index(id(ctx.S), update("--", false, id(ctx.P)))),
		exprStmt(
			assign(index(id(ctx.S), update("++", true, id(ctx.P))), id("c"))
		),
		exprStmt(
			assign(index(id(ctx.S), update("++", true, id(ctx.P))), id("a"))
		),
		exprStmt(
			assign(index(id(ctx.S), update("++", true, id(ctx.P))), id("b"))
		),
		breakStmt(),
	];
}

function ROT4(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("d", index(id(ctx.S), update("--", false, id(ctx.P)))),
		varDecl("c", index(id(ctx.S), update("--", false, id(ctx.P)))),
		varDecl("b", index(id(ctx.S), update("--", false, id(ctx.P)))),
		varDecl("a", index(id(ctx.S), update("--", false, id(ctx.P)))),
		exprStmt(
			assign(index(id(ctx.S), update("++", true, id(ctx.P))), id("d"))
		),
		exprStmt(
			assign(index(id(ctx.S), update("++", true, id(ctx.P))), id("a"))
		),
		exprStmt(
			assign(index(id(ctx.S), update("++", true, id(ctx.P))), id("b"))
		),
		exprStmt(
			assign(index(id(ctx.S), update("++", true, id(ctx.P))), id("c"))
		),
		breakStmt(),
	];
}

// --- Pick handler ---

function PICK(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(
			assign(
				index(id(ctx.S), bin("+", id(ctx.P), lit(1))),
				index(id(ctx.S), bin("-", id(ctx.P), id(ctx.O)))
			)
		),
		exprStmt(update("++", false, id(ctx.P))),
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
