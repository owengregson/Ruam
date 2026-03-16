/** @module ruamvm/handlers/comparison */

import { Op } from "../../compiler/opcodes.js";
import { id, bin, assign, varDecl, exprStmt, breakStmt, BOp, type BOpKind } from "../nodes.js";
import type { HandlerCtx, HandlerFn } from "./registry.js";
import { registry } from "./registry.js";

// --- Helpers ---

/**
 * Build a binary comparison handler.
 *
 * Pattern: `{var b=S[P--];S[P]=S[P] <op> b;break;}`
 *
 * @param op - JS comparison operator (`==`, `!=`, `===`, `!==`, `<`, `<=`, `>`, `>=`)
 * @returns Handler function producing the case body AST nodes
 */
function cmpHandler(op: BOpKind): HandlerFn {
	return (ctx: HandlerCtx) => [
		varDecl("b", ctx.pop()),
		exprStmt(assign(ctx.peek(), bin(op, ctx.peek(), id("b")))),
		breakStmt(),
	];
}

// --- Registration ---

registry.set(Op.EQ, cmpHandler(BOp.Eq));
registry.set(Op.NEQ, cmpHandler(BOp.Neq));
registry.set(Op.SEQ, cmpHandler(BOp.Seq));
registry.set(Op.SNEQ, cmpHandler(BOp.Sneq));
registry.set(Op.LT, cmpHandler(BOp.Lt));
registry.set(Op.LTE, cmpHandler(BOp.Lte));
registry.set(Op.GT, cmpHandler(BOp.Gt));
registry.set(Op.GTE, cmpHandler(BOp.Gte));
