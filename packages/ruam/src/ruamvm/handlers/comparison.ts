/** @module ruamvm/handlers/comparison */

import { Op } from "../../compiler/opcodes.js";
import { id, bin, assign, varDecl, exprStmt, breakStmt } from "../nodes.js";
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
function cmpHandler(op: string): HandlerFn {
	return (ctx: HandlerCtx) => [
		varDecl("b", ctx.pop()),
		exprStmt(assign(ctx.peek(), bin(op, ctx.peek(), id("b")))),
		breakStmt(),
	];
}

// --- Registration ---

registry.set(Op.EQ, cmpHandler("=="));
registry.set(Op.NEQ, cmpHandler("!="));
registry.set(Op.SEQ, cmpHandler("==="));
registry.set(Op.SNEQ, cmpHandler("!=="));
registry.set(Op.LT, cmpHandler("<"));
registry.set(Op.LTE, cmpHandler("<="));
registry.set(Op.GT, cmpHandler(">"));
registry.set(Op.GTE, cmpHandler(">="));
