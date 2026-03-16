/**
 * Compound scoped assignment opcode handlers in AST node form.
 *
 * Covers 20 opcodes for in-place scope chain modifications:
 *  - Increment/decrement: INC_SCOPED, DEC_SCOPED, POST_INC_SCOPED, POST_DEC_SCOPED
 *  - Arithmetic assign:   ADD_ASSIGN_SCOPED, SUB_ASSIGN_SCOPED, MUL_ASSIGN_SCOPED,
 *                          DIV_ASSIGN_SCOPED, MOD_ASSIGN_SCOPED, POW_ASSIGN_SCOPED
 *  - Bitwise assign:      BIT_AND_ASSIGN_SCOPED, BIT_OR_ASSIGN_SCOPED,
 *                          BIT_XOR_ASSIGN_SCOPED, SHL_ASSIGN_SCOPED,
 *                          SHR_ASSIGN_SCOPED, USHR_ASSIGN_SCOPED
 *  - Logical assign:      AND_ASSIGN_SCOPED, OR_ASSIGN_SCOPED, NULLISH_ASSIGN_SCOPED
 *  - No-op:               ASSIGN_OP
 *
 * All handlers use ctx.scopeWalk() for structured AST scope chain walking.
 *
 * @module ruamvm/handlers/compound-scoped
 */

import { Op } from "../../compiler/opcodes.js";
import { type JsNode, id, index, assign, bin, lit, varDecl, exprStmt, ifStmt, breakStmt, BOp, AOp, type AOpKind, type BOpKind } from "../nodes.js";
import type { HandlerCtx, HandlerFn } from "./registry.js";
import { registry } from "./registry.js";

// --- Helpers ---

/**
 * Build a compound assignment handler that pops a value from the stack,
 * walks the scope chain, and applies the given compound operator.
 *
 * @param assignOp - The operator prefix (e.g. `'+'`, `'-'`, `'**'`)
 * @returns Handler function producing the case body
 */
function compoundScopedAssign(assignOp: AOpKind): HandlerFn {
	return (ctx) => [
		varDecl("val", ctx.pop()),
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		varDecl("s", id(ctx.SC)),
		...ctx.scopeWalk([
			exprStmt(assign(ctx.sv(), id("val"), assignOp)),
			exprStmt(ctx.push(ctx.sv())),
		]),
	];
}

/**
 * Build a logical assignment handler that pops a value from the stack,
 * walks the scope chain, and applies the given logical operator as a
 * full assignment (not compound, since `&&=` is not a simple operator).
 *
 * @param logicalOp - The logical operator (`'&&'` or `'||'`)
 * @returns Handler function producing the case body
 */
function logicalScopedAssign(logicalOp: BOpKind): HandlerFn {
	return (ctx) => [
		varDecl("val", ctx.pop()),
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		varDecl("s", id(ctx.SC)),
		...ctx.scopeWalk([
			exprStmt(assign(ctx.sv(), bin(logicalOp, ctx.sv(), id("val")))),
			exprStmt(ctx.push(ctx.sv())),
		]),
	];
}

// --- Increment / decrement ---

/** INC_SCOPED: pre-increment a scoped variable, push new value. */
function INC_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		varDecl("s", id(ctx.SC)),
		...ctx.scopeWalk([
			exprStmt(assign(ctx.sv(), bin(BOp.Add, ctx.sv(), lit(1)))),
			exprStmt(ctx.push(ctx.sv())),
		]),
	];
}

/** DEC_SCOPED: pre-decrement a scoped variable, push new value. */
function DEC_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		varDecl("s", id(ctx.SC)),
		...ctx.scopeWalk([
			exprStmt(assign(ctx.sv(), bin(BOp.Sub, ctx.sv(), lit(1)))),
			exprStmt(ctx.push(ctx.sv())),
		]),
	];
}

/** POST_INC_SCOPED: post-increment a scoped variable, push old value. */
function POST_INC_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		varDecl("s", id(ctx.SC)),
		...ctx.scopeWalk([
			varDecl("old", ctx.sv()),
			exprStmt(assign(ctx.sv(), bin(BOp.Add, id("old"), lit(1)))),
			exprStmt(ctx.push(id("old"))),
		]),
	];
}

/** POST_DEC_SCOPED: post-decrement a scoped variable, push old value. */
function POST_DEC_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		varDecl("s", id(ctx.SC)),
		...ctx.scopeWalk([
			varDecl("old", ctx.sv()),
			exprStmt(assign(ctx.sv(), bin(BOp.Sub, id("old"), lit(1)))),
			exprStmt(ctx.push(id("old"))),
		]),
	];
}

// --- Nullish assign (special: conditional assignment) ---

/** NULLISH_ASSIGN_SCOPED: `??=` — only assign if current value is null/undefined. */
function NULLISH_ASSIGN_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("val", ctx.pop()),
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		varDecl("s", id(ctx.SC)),
		...ctx.scopeWalk([
			ifStmt(bin(BOp.Eq, ctx.sv(), lit(null)), [
				exprStmt(assign(ctx.sv(), id("val"))),
			]),
			exprStmt(ctx.push(ctx.sv())),
		]),
	];
}

// --- ASSIGN_OP (no-op marker) ---

/** ASSIGN_OP: no-op marker opcode, just break. */
function ASSIGN_OP(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

// --- Registration ---

registry.set(Op.INC_SCOPED, INC_SCOPED);
registry.set(Op.DEC_SCOPED, DEC_SCOPED);
registry.set(Op.POST_INC_SCOPED, POST_INC_SCOPED);
registry.set(Op.POST_DEC_SCOPED, POST_DEC_SCOPED);
registry.set(Op.ADD_ASSIGN_SCOPED, compoundScopedAssign(AOp.Add));
registry.set(Op.SUB_ASSIGN_SCOPED, compoundScopedAssign(AOp.Sub));
registry.set(Op.MUL_ASSIGN_SCOPED, compoundScopedAssign(AOp.Mul));
registry.set(Op.DIV_ASSIGN_SCOPED, compoundScopedAssign(AOp.Div));
registry.set(Op.MOD_ASSIGN_SCOPED, compoundScopedAssign(AOp.Mod));
registry.set(Op.POW_ASSIGN_SCOPED, compoundScopedAssign(AOp.Pow));
registry.set(Op.BIT_AND_ASSIGN_SCOPED, compoundScopedAssign(AOp.BitAnd));
registry.set(Op.BIT_OR_ASSIGN_SCOPED, compoundScopedAssign(AOp.BitOr));
registry.set(Op.BIT_XOR_ASSIGN_SCOPED, compoundScopedAssign(AOp.BitXor));
registry.set(Op.SHL_ASSIGN_SCOPED, compoundScopedAssign(AOp.Shl));
registry.set(Op.SHR_ASSIGN_SCOPED, compoundScopedAssign(AOp.Shr));
registry.set(Op.USHR_ASSIGN_SCOPED, compoundScopedAssign(AOp.Ushr));
registry.set(Op.AND_ASSIGN_SCOPED, logicalScopedAssign(BOp.And));
registry.set(Op.OR_ASSIGN_SCOPED, logicalScopedAssign(BOp.Or));
registry.set(Op.NULLISH_ASSIGN_SCOPED, NULLISH_ASSIGN_SCOPED);
registry.set(Op.ASSIGN_OP, ASSIGN_OP);
