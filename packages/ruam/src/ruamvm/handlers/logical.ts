/** @module ruamvm/handlers/logical */

import { Op } from "../../compiler/opcodes.js";
import { id, lit, bin, un, assign, update, varDecl, exprStmt, ifStmt, breakStmt, BOp, UOp } from "../nodes.js";
import type { HandlerCtx } from "./registry.js";
import { registry } from "./registry.js";

// --- NOT ---

/**
 * `S[P]=!S[P];break;`
 */
registry.set(Op.NOT, (ctx: HandlerCtx) => [
	exprStmt(assign(ctx.peek(), un(UOp.Not, ctx.peek()))),
	breakStmt(),
]);

// --- LOGICAL_AND ---

/**
 * `{var v=S[P];if(!v){IP=O*2;}else{P--;}break;}`
 *
 * Short-circuit: if falsy, jump to operand target; otherwise pop TOS and continue.
 */
registry.set(Op.LOGICAL_AND, (ctx: HandlerCtx) => [
	varDecl("v", ctx.peek()),
	ifStmt(
		un(UOp.Not, id("v")),
		[exprStmt(assign(id(ctx.IP), bin(BOp.Mul, id(ctx.O), lit(2))))],
		[exprStmt(ctx.pop())]
	),
	breakStmt(),
]);

// --- LOGICAL_OR ---

/**
 * `{var v=S[P];if(v){IP=O*2;}else{P--;}break;}`
 *
 * Short-circuit: if truthy, jump to operand target; otherwise pop TOS and continue.
 */
registry.set(Op.LOGICAL_OR, (ctx: HandlerCtx) => [
	varDecl("v", ctx.peek()),
	ifStmt(
		id("v"),
		[exprStmt(assign(id(ctx.IP), bin(BOp.Mul, id(ctx.O), lit(2))))],
		[exprStmt(ctx.pop())]
	),
	breakStmt(),
]);

// --- NULLISH_COALESCE ---

/**
 * `{var v=S[P];if(v!==null&&v!==void 0){IP=O*2;}else{P--;}break;}`
 *
 * Short-circuit: if non-nullish (not null and not undefined), jump; otherwise pop and continue.
 */
registry.set(Op.NULLISH_COALESCE, (ctx: HandlerCtx) => [
	varDecl("v", ctx.peek()),
	ifStmt(
		bin(BOp.And,
			bin(BOp.Sneq, id("v"), lit(null)),
			bin(BOp.Sneq, id("v"), un(UOp.Void, lit(0)))
		),
		[exprStmt(assign(id(ctx.IP), bin(BOp.Mul, id(ctx.O), lit(2))))],
		[exprStmt(ctx.pop())]
	),
	breakStmt(),
]);
