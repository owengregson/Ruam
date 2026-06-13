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
	BOp,
	UOp,
	AOp,
} from "../nodes.js";
import { type HandlerCtx, registry } from "./registry.js";

// --- Push handlers ---

function PUSH_CONST(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(index(id(ctx.C), id(ctx.O)))), breakStmt()];
}

function PUSH_UNDEFINED(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(un(UOp.Void, lit(0)))), breakStmt()];
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
	return [exprStmt(ctx.push(un(UOp.Neg, lit(1)))), breakStmt()];
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
	return [exprStmt(ctx.push(un(UOp.Neg, id("Infinity")))), breakStmt()];
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
		exprStmt(assign(member(id(ctx.S), "length"), id(ctx.O), AOp.Sub)),
		breakStmt(),
	];
}

// --- Duplication handlers ---

/** DUP: duplicate top of stack. */
function DUP(ctx: HandlerCtx): JsNode[] {
	// S.push(S[S.length-1])
	return [exprStmt(ctx.push(ctx.peek())), breakStmt()];
}

/** Fresh `S.length - k` AST (a new node each call — required by slotRead/slotWrite). */
function depth(ctx: HandlerCtx, k: number): () => JsNode {
	return () => bin(BOp.Sub, member(id(ctx.S), "length"), lit(k));
}

/** DUP2: duplicate top two elements. */
function DUP2(ctx: HandlerCtx): JsNode[] {
	return [
		// var _a=S[S.length-2], _b=S[S.length-1]  (decoded reads)
		varDecl(ctx.t("_a"), ctx.slotRead(depth(ctx, 2))),
		varDecl(ctx.t("_b"), ctx.peek()),
		// S.push(_a); S.push(_b)  (re-encoded at the new positions)
		exprStmt(ctx.push(id(ctx.t("_a")))),
		exprStmt(ctx.push(id(ctx.t("_b")))),
		breakStmt(),
	];
}

// --- Swap / rotate handlers ---
// Under stackEncoding, slotRead decodes at the source index and slotWrite
// re-encodes at the destination index, so every rotated value is correctly
// re-keyed to its new position (the legacy Proxy did this via get/set traps).

/** SWAP: swap top two elements via direct index access (no pop/push). */
function SWAP(ctx: HandlerCtx): JsNode[] {
	// var _t=S[len-1]; S[len-1]=S[len-2]; S[len-2]=_t;
	return [
		varDecl(ctx.local("swapTemp"), ctx.slotRead(depth(ctx, 1))),
		exprStmt(ctx.slotWrite(depth(ctx, 1), ctx.slotRead(depth(ctx, 2)))),
		exprStmt(ctx.slotWrite(depth(ctx, 2), id(ctx.local("swapTemp")))),
		breakStmt(),
	];
}

/** ROT3: rotate top 3 elements (abc -> cab) via direct index access. */
function ROT3(ctx: HandlerCtx): JsNode[] {
	// abc -> cab: S[top-2]=c, S[top-1]=a, S[top]=b
	return [
		varDecl(ctx.local("rotC"), ctx.slotRead(depth(ctx, 1))), // _c = top
		varDecl(ctx.local("rotB"), ctx.slotRead(depth(ctx, 2))), // _b
		varDecl(ctx.local("rotA"), ctx.slotRead(depth(ctx, 3))), // _a
		exprStmt(ctx.slotWrite(depth(ctx, 3), id(ctx.local("rotC")))),
		exprStmt(ctx.slotWrite(depth(ctx, 2), id(ctx.local("rotA")))),
		exprStmt(ctx.slotWrite(depth(ctx, 1), id(ctx.local("rotB")))),
		breakStmt(),
	];
}

/** ROT4: rotate top 4 elements (abcd -> dabc) via direct index access. */
function ROT4(ctx: HandlerCtx): JsNode[] {
	// abcd -> dabc
	return [
		varDecl(ctx.local("rotD"), ctx.slotRead(depth(ctx, 1))),
		varDecl(ctx.local("rotC"), ctx.slotRead(depth(ctx, 2))),
		varDecl(ctx.local("rotB"), ctx.slotRead(depth(ctx, 3))),
		varDecl(ctx.local("rotA"), ctx.slotRead(depth(ctx, 4))),
		exprStmt(ctx.slotWrite(depth(ctx, 4), id(ctx.local("rotD")))),
		exprStmt(ctx.slotWrite(depth(ctx, 3), id(ctx.local("rotA")))),
		exprStmt(ctx.slotWrite(depth(ctx, 2), id(ctx.local("rotB")))),
		exprStmt(ctx.slotWrite(depth(ctx, 1), id(ctx.local("rotC")))),
		breakStmt(),
	];
}

// --- Pick handler ---

/** PICK: copy element at depth O onto top of stack. */
function PICK(ctx: HandlerCtx): JsNode[] {
	// S.push(S[S.length-1-O])  — read at depth (1+O), re-encoded onto the top.
	const pickIdx = (): JsNode =>
		bin(
			BOp.Sub,
			bin(BOp.Sub, member(id(ctx.S), "length"), lit(1)),
			id(ctx.O)
		);
	return [
		exprStmt(ctx.push(ctx.slotRead(pickIdx))),
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
