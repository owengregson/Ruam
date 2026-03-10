/** @module codegen/handlers/logical */

import { Op } from "../../compiler/opcodes.js";
import {
	id, index, lit, bin, un, assign, update,
	varDecl, exprStmt, ifStmt, breakStmt,
} from "../nodes.js";
import type { HandlerCtx } from "./registry.js";
import { registry } from "./registry.js";

// --- NOT ---

/**
 * `S[P]=!S[P];break;`
 */
registry.set(Op.NOT, (ctx: HandlerCtx) => [
	exprStmt(assign(index(id(ctx.S), id(ctx.P)), un('!', index(id(ctx.S), id(ctx.P))))),
	breakStmt(),
]);

// --- LOGICAL_AND ---

/**
 * `{var v=S[P];if(!v){IP=O*2;}else{P--;}break;}`
 *
 * Short-circuit: if falsy, jump to operand target; otherwise pop TOS and continue.
 */
registry.set(Op.LOGICAL_AND, (ctx: HandlerCtx) => [
	varDecl('v', index(id(ctx.S), id(ctx.P))),
	ifStmt(
		un('!', id('v')),
		[exprStmt(assign(id(ctx.IP), bin('*', id(ctx.O), lit(2))))],
		[exprStmt(update('--', false, id(ctx.P)))],
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
	varDecl('v', index(id(ctx.S), id(ctx.P))),
	ifStmt(
		id('v'),
		[exprStmt(assign(id(ctx.IP), bin('*', id(ctx.O), lit(2))))],
		[exprStmt(update('--', false, id(ctx.P)))],
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
	varDecl('v', index(id(ctx.S), id(ctx.P))),
	ifStmt(
		bin('&&', bin('!==', id('v'), lit(null)), bin('!==', id('v'), un('void', lit(0)))),
		[exprStmt(assign(id(ctx.IP), bin('*', id(ctx.O), lit(2))))],
		[exprStmt(update('--', false, id(ctx.P)))],
	),
	breakStmt(),
]);
