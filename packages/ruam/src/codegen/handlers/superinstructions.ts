/**
 * Superinstruction opcode handlers in AST node form.
 *
 * Covers 18 fused opcodes that combine register access with arithmetic,
 * comparison, property access, and conditional jumps:
 *  - Dual-register binary: REG_ADD, REG_SUB, REG_MUL, REG_DIV, REG_MOD,
 *                          REG_LT, REG_LTE, REG_GT, REG_GTE, REG_SEQ, REG_SNEQ
 *  - Register+constant:    REG_ADD_CONST, REG_CONST_SUB, REG_CONST_MUL, REG_CONST_MOD
 *  - Property access:      REG_GET_PROP
 *  - Conditional jumps:    REG_LT_CONST_JF, REG_LT_REG_JF
 *
 * All handlers use raw() due to bit-packing extraction from the operand field
 * and multi-step control flow for conditional jump variants.
 *
 * @module codegen/handlers/superinstructions
 */

import { Op } from "../../compiler/opcodes.js";
import { type JsNode, raw } from "../nodes.js";
import type { HandlerCtx, HandlerFn } from "./registry.js";
import { registry } from "./registry.js";

// --- Helpers ---

/**
 * Build a dual-register binary operation handler.
 *
 * Extracts two register indices from the packed operand (low 16 bits = ra,
 * high 16 bits = rb) and pushes the result of `R[ra] <op> R[rb]`.
 *
 * Pattern: `{var ra=O&0xFFFF;var rb=(O>>>16)&0xFFFF;W(R[ra] <op> R[rb]);break;}`
 *
 * @param op - The JS binary operator string (e.g. `'+'`, `'<'`, `'==='`)
 * @returns Handler function producing the case body
 */
function regBinOp(op: string): HandlerFn {
	return (ctx) => [
		raw(
			`var ra=${ctx.O}&0xFFFF;var rb=(${ctx.O}>>>16)&0xFFFF;` +
				`${ctx.pushStr(ctx.R+"[ra]"+op+ctx.R+"[rb]")};break;`
		),
	];
}

/**
 * Build a register + constant pool operation handler.
 *
 * Extracts register index (low 16 bits) and constant index (high 16 bits),
 * then applies the operation and stores back to the register.
 *
 * Pattern: `{var r=O&0xFFFF;var ci=(O>>>16)&0xFFFF;R[r]=R[r] <op> C[ci];break;}`
 *
 * @param op - The JS binary operator string
 * @returns Handler function producing the case body
 */
function regConstOp(op: string): HandlerFn {
	return (ctx) => [
		raw(
			`var r=${ctx.O}&0xFFFF;var ci=(${ctx.O}>>>16)&0xFFFF;` +
				`${ctx.R}[r]=${ctx.R}[r]${op}${ctx.C}[ci];break;`
		),
	];
}

/**
 * Build a register + constant pool operation that pushes the result.
 *
 * Same operand packing as regConstOp, but pushes to stack instead of
 * storing back to register.
 *
 * Pattern: `{var r=O&0xFFFF;var ci=(O>>>16)&0xFFFF;W(R[r] <op> C[ci]);break;}`
 *
 * @param op - The JS binary operator string
 * @returns Handler function producing the case body
 */
function regConstPush(op: string): HandlerFn {
	return (ctx) => [
		raw(
			`var r=${ctx.O}&0xFFFF;var ci=(${ctx.O}>>>16)&0xFFFF;` +
				`${ctx.pushStr(ctx.R+"[r]"+op+ctx.C+"[ci]")};break;`
		),
	];
}

// --- Dual-register binary operations ---

registry.set(Op.REG_ADD, regBinOp("+"));
registry.set(Op.REG_SUB, regBinOp("-"));
registry.set(Op.REG_MUL, regBinOp("*"));
registry.set(Op.REG_DIV, regBinOp("/"));
registry.set(Op.REG_MOD, regBinOp("%"));
registry.set(Op.REG_LT, regBinOp("<"));
registry.set(Op.REG_LTE, regBinOp("<="));
registry.set(Op.REG_GT, regBinOp(">"));
registry.set(Op.REG_GTE, regBinOp(">="));
registry.set(Op.REG_SEQ, regBinOp("==="));
registry.set(Op.REG_SNEQ, regBinOp("!=="));

// --- Register + constant operations ---

registry.set(Op.REG_ADD_CONST, regConstOp("+"));
registry.set(Op.REG_CONST_SUB, regConstPush("-"));
registry.set(Op.REG_CONST_MUL, regConstPush("*"));
registry.set(Op.REG_CONST_MOD, regConstPush("%"));

// --- Property access ---

/**
 * REG_GET_PROP: get a named property from a register value.
 *
 * Extracts register index (low 16 bits) and property name constant index
 * (high 16 bits), then pushes `R[r][C[ni]]`.
 */
function REG_GET_PROP(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var r=${ctx.O}&0xFFFF;var ni=(${ctx.O}>>>16)&0xFFFF;` +
				`${ctx.pushStr(ctx.R+"[r]["+ctx.C+"[ni]]")};break;`
		),
	];
}
registry.set(Op.REG_GET_PROP, REG_GET_PROP);

// --- Conditional jump operations ---

/**
 * REG_LT_CONST_JF: compare register < constant, jump if false.
 *
 * Operand packing: r=low 8 bits, ci=bits 8-15, tgt=bits 16-31.
 *
 * ```
 * var r=O&0xFF;var ci=(O>>>8)&0xFF;var tgt=(O>>>16)&0xFFFF;
 * if(!(R[r]<C[ci]))IP=tgt*2;break;
 * ```
 */
function REG_LT_CONST_JF(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var r=${ctx.O}&0xFF;var ci=(${ctx.O}>>>8)&0xFF;var tgt=(${ctx.O}>>>16)&0xFFFF;` +
				`if(!(${ctx.R}[r]<${ctx.C}[ci]))${ctx.IP}=tgt*2;break;`
		),
	];
}
registry.set(Op.REG_LT_CONST_JF, REG_LT_CONST_JF);

/**
 * REG_LT_REG_JF: compare register < register, jump if false.
 *
 * Operand packing: ra=low 8 bits, rb=bits 8-15, tgt=bits 16-31.
 *
 * ```
 * var ra=O&0xFF;var rb=(O>>>8)&0xFF;var tgt=(O>>>16)&0xFFFF;
 * if(!(R[ra]<R[rb]))IP=tgt*2;break;
 * ```
 */
function REG_LT_REG_JF(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var ra=${ctx.O}&0xFF;var rb=(${ctx.O}>>>8)&0xFF;var tgt=(${ctx.O}>>>16)&0xFFFF;` +
				`if(!(${ctx.R}[ra]<${ctx.R}[rb]))${ctx.IP}=tgt*2;break;`
		),
	];
}
registry.set(Op.REG_LT_REG_JF, REG_LT_REG_JF);
