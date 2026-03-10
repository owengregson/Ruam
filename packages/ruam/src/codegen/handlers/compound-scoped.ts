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
 * All handlers use raw() because scope chain walking involves while loops
 * with `break` statements that are ambiguous — the `break` exits the while
 * loop, not the enclosing switch case.
 *
 * @module codegen/handlers/compound-scoped
 */

import { Op } from "../../compiler/opcodes.js";
import { type JsNode, raw, breakStmt } from "../nodes.js";
import type { HandlerCtx, HandlerFn } from "./registry.js";
import { registry } from "./registry.js";

// --- Helpers ---

/**
 * Build a compound assignment handler that pops a value from the stack,
 * walks the scope chain, and applies the given compound operator.
 *
 * Pattern: `{var val=X();var name=C[O];var s=SC;while(s){if(name in s.sV){s.sV[name] <op>= val;W(s.sV[name]);break;}s=s.sPar;}break;}`
 *
 * @param assignOp - The compound assignment operator (e.g. `'+='`, `'-='`)
 * @returns Handler function producing the case body
 */
function compoundScopedAssign(assignOp: string): HandlerFn {
	return (ctx) => [
		raw(
			`var val=${ctx.X}();var name=${ctx.C}[${ctx.O}];var s=${ctx.SC};` +
				`while(s){if(name in s.${ctx.sV}){s.${ctx.sV}[name]${assignOp}val;${ctx.W}(s.${ctx.sV}[name]);break;}s=s.${ctx.sPar};}break;`
		),
	];
}

/**
 * Build a logical assignment handler that pops a value from the stack,
 * walks the scope chain, and applies the given logical operator as a
 * full assignment (not compound, since `&&=` is not a simple operator).
 *
 * Pattern: `s.sV[name] = s.sV[name] <op> val`
 *
 * @param logicalOp - The logical operator (`'&&'` or `'||'`)
 * @returns Handler function producing the case body
 */
function logicalScopedAssign(logicalOp: string): HandlerFn {
	return (ctx) => [
		raw(
			`var val=${ctx.X}();var name=${ctx.C}[${ctx.O}];var s=${ctx.SC};` +
				`while(s){if(name in s.${ctx.sV}){s.${ctx.sV}[name]=s.${ctx.sV}[name]${logicalOp}val;${ctx.W}(s.${ctx.sV}[name]);break;}s=s.${ctx.sPar};}break;`
		),
	];
}

// --- Increment / decrement ---

/**
 * INC_SCOPED: pre-increment a scoped variable.
 *
 * Walks scope chain, increments in-place, pushes new value.
 */
function INC_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var name=${ctx.C}[${ctx.O}];var s=${ctx.SC};` +
				`while(s){if(name in s.${ctx.sV}){s.${ctx.sV}[name]=s.${ctx.sV}[name]+1;${ctx.W}(s.${ctx.sV}[name]);break;}s=s.${ctx.sPar};}break;`
		),
	];
}

/**
 * DEC_SCOPED: pre-decrement a scoped variable.
 *
 * Walks scope chain, decrements in-place, pushes new value.
 */
function DEC_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var name=${ctx.C}[${ctx.O}];var s=${ctx.SC};` +
				`while(s){if(name in s.${ctx.sV}){s.${ctx.sV}[name]=s.${ctx.sV}[name]-1;${ctx.W}(s.${ctx.sV}[name]);break;}s=s.${ctx.sPar};}break;`
		),
	];
}

/**
 * POST_INC_SCOPED: post-increment a scoped variable.
 *
 * Walks scope chain, saves old value, increments, pushes old value.
 */
function POST_INC_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var name=${ctx.C}[${ctx.O}];var s=${ctx.SC};` +
				`while(s){if(name in s.${ctx.sV}){var old=s.${ctx.sV}[name];s.${ctx.sV}[name]=old+1;${ctx.W}(old);break;}s=s.${ctx.sPar};}break;`
		),
	];
}

/**
 * POST_DEC_SCOPED: post-decrement a scoped variable.
 *
 * Walks scope chain, saves old value, decrements, pushes old value.
 */
function POST_DEC_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var name=${ctx.C}[${ctx.O}];var s=${ctx.SC};` +
				`while(s){if(name in s.${ctx.sV}){var old=s.${ctx.sV}[name];s.${ctx.sV}[name]=old-1;${ctx.W}(old);break;}s=s.${ctx.sPar};}break;`
		),
	];
}

// --- Nullish assign (special: conditional assignment) ---

/**
 * NULLISH_ASSIGN_SCOPED: nullish coalescing assignment (`??=`).
 *
 * Only assigns if the current value is null or undefined.
 */
function NULLISH_ASSIGN_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var val=${ctx.X}();var name=${ctx.C}[${ctx.O}];var s=${ctx.SC};` +
				`while(s){if(name in s.${ctx.sV}){if(s.${ctx.sV}[name]==null)s.${ctx.sV}[name]=val;${ctx.W}(s.${ctx.sV}[name]);break;}s=s.${ctx.sPar};}break;`
		),
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
registry.set(Op.ADD_ASSIGN_SCOPED, compoundScopedAssign("+="));
registry.set(Op.SUB_ASSIGN_SCOPED, compoundScopedAssign("-="));
registry.set(Op.MUL_ASSIGN_SCOPED, compoundScopedAssign("*="));
registry.set(Op.DIV_ASSIGN_SCOPED, compoundScopedAssign("/="));
registry.set(Op.MOD_ASSIGN_SCOPED, compoundScopedAssign("%="));
registry.set(Op.POW_ASSIGN_SCOPED, compoundScopedAssign("**="));
registry.set(Op.BIT_AND_ASSIGN_SCOPED, compoundScopedAssign("&="));
registry.set(Op.BIT_OR_ASSIGN_SCOPED, compoundScopedAssign("|="));
registry.set(Op.BIT_XOR_ASSIGN_SCOPED, compoundScopedAssign("^="));
registry.set(Op.SHL_ASSIGN_SCOPED, compoundScopedAssign("<<="));
registry.set(Op.SHR_ASSIGN_SCOPED, compoundScopedAssign(">>="));
registry.set(Op.USHR_ASSIGN_SCOPED, compoundScopedAssign(">>>="));
registry.set(Op.AND_ASSIGN_SCOPED, logicalScopedAssign("&&"));
registry.set(Op.OR_ASSIGN_SCOPED, logicalScopedAssign("||"));
registry.set(Op.NULLISH_ASSIGN_SCOPED, NULLISH_ASSIGN_SCOPED);
registry.set(Op.ASSIGN_OP, ASSIGN_OP);
