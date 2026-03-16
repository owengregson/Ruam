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
 * All handlers use pure AST nodes with bit-packing extraction from the operand
 * field and multi-step control flow for conditional jump variants.
 *
 * @module ruamvm/handlers/superinstructions
 */

import { Op } from "../../compiler/opcodes.js";
import {
	type JsNode,
	id,
	lit,
	bin,
	un,
	index,
	assign,
	varDecl,
	exprStmt,
	ifStmt,
	breakStmt,
	BOp,
	UOp,
	type BOpKind,
} from "../nodes.js";
import type { HandlerCtx, HandlerFn } from "./registry.js";
import { registry } from "./registry.js";

// --- Helpers ---

/**
 * Low 16 bits of the operand: `O & 0xFFFF`
 *
 * @param ctx - Handler context
 * @returns AST expression for `O & 0xFFFF`
 */
function lo16(ctx: HandlerCtx): JsNode {
	return bin(BOp.BitAnd, id(ctx.O), lit(0xffff));
}

/**
 * High 16 bits of the operand: `(O >>> 16) & 0xFFFF`
 *
 * @param ctx - Handler context
 * @returns AST expression for `(O >>> 16) & 0xFFFF`
 */
function hi16(ctx: HandlerCtx): JsNode {
	return bin(BOp.BitAnd, bin(BOp.Ushr, id(ctx.O), lit(16)), lit(0xffff));
}

/**
 * Low 8 bits of the operand: `O & 0xFF`
 *
 * @param ctx - Handler context
 * @returns AST expression for `O & 0xFF`
 */
function lo8(ctx: HandlerCtx): JsNode {
	return bin(BOp.BitAnd, id(ctx.O), lit(0xff));
}

/**
 * Bits 8-15 of the operand: `(O >>> 8) & 0xFF`
 *
 * @param ctx - Handler context
 * @returns AST expression for `(O >>> 8) & 0xFF`
 */
function mid8(ctx: HandlerCtx): JsNode {
	return bin(BOp.BitAnd, bin(BOp.Ushr, id(ctx.O), lit(8)), lit(0xff));
}

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
function regBinOp(op: BOpKind): HandlerFn {
	return (ctx) => [
		varDecl(ctx.local("regA"), lo16(ctx)),
		varDecl(ctx.local("regB"), hi16(ctx)),
		exprStmt(
			ctx.push(
				bin(
					op,
					index(id(ctx.R), id(ctx.local("regA"))),
					index(id(ctx.R), id(ctx.local("regB")))
				)
			)
		),
		breakStmt(),
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
function regConstOp(op: BOpKind): HandlerFn {
	return (ctx) => [
		varDecl(ctx.local("reg"), lo16(ctx)),
		varDecl(ctx.local("constIdx"), hi16(ctx)),
		exprStmt(
			assign(
				index(id(ctx.R), id(ctx.local("reg"))),
				bin(
					op,
					index(id(ctx.R), id(ctx.local("reg"))),
					index(id(ctx.C), id(ctx.local("constIdx")))
				)
			)
		),
		breakStmt(),
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
function regConstPush(op: BOpKind): HandlerFn {
	return (ctx) => [
		varDecl(ctx.local("reg"), lo16(ctx)),
		varDecl(ctx.local("constIdx"), hi16(ctx)),
		exprStmt(
			ctx.push(
				bin(
					op,
					index(id(ctx.R), id(ctx.local("reg"))),
					index(id(ctx.C), id(ctx.local("constIdx")))
				)
			)
		),
		breakStmt(),
	];
}

// --- Dual-register binary operations ---

registry.set(Op.REG_ADD, regBinOp(BOp.Add));
registry.set(Op.REG_SUB, regBinOp(BOp.Sub));
registry.set(Op.REG_MUL, regBinOp(BOp.Mul));
registry.set(Op.REG_DIV, regBinOp(BOp.Div));
registry.set(Op.REG_MOD, regBinOp(BOp.Mod));
registry.set(Op.REG_LT, regBinOp(BOp.Lt));
registry.set(Op.REG_LTE, regBinOp(BOp.Lte));
registry.set(Op.REG_GT, regBinOp(BOp.Gt));
registry.set(Op.REG_GTE, regBinOp(BOp.Gte));
registry.set(Op.REG_SEQ, regBinOp(BOp.Seq));
registry.set(Op.REG_SNEQ, regBinOp(BOp.Sneq));

// --- Register + constant operations ---

registry.set(Op.REG_ADD_CONST, regConstOp(BOp.Add));
registry.set(Op.REG_CONST_SUB, regConstPush(BOp.Sub));
registry.set(Op.REG_CONST_MUL, regConstPush(BOp.Mul));
registry.set(Op.REG_CONST_MOD, regConstPush(BOp.Mod));

// --- Property access ---

/**
 * REG_GET_PROP: get a named property from a register value.
 *
 * Extracts register index (low 16 bits) and property name constant index
 * (high 16 bits), then pushes `R[r][C[ni]]`.
 */
function REG_GET_PROP(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("reg"), lo16(ctx)),
		varDecl(ctx.local("nameIdx"), hi16(ctx)),
		exprStmt(
			ctx.push(
				index(
					index(id(ctx.R), id(ctx.local("reg"))),
					index(id(ctx.C), id(ctx.local("nameIdx")))
				)
			)
		),
		breakStmt(),
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
		varDecl(ctx.local("reg"), lo8(ctx)),
		varDecl(ctx.local("constIdx"), mid8(ctx)),
		varDecl(ctx.local("target"), hi16(ctx)),
		ifStmt(
			un(
				UOp.Not,
				bin(
					BOp.Lt,
					index(id(ctx.R), id(ctx.local("reg"))),
					index(id(ctx.C), id(ctx.local("constIdx")))
				)
			),
			[
				exprStmt(
					assign(
						id(ctx.IP),
						bin(BOp.Mul, id(ctx.local("target")), lit(2))
					)
				),
			]
		),
		breakStmt(),
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
		varDecl(ctx.local("regA"), lo8(ctx)),
		varDecl(ctx.local("regB"), mid8(ctx)),
		varDecl(ctx.local("target"), hi16(ctx)),
		ifStmt(
			un(
				UOp.Not,
				bin(
					BOp.Lt,
					index(id(ctx.R), id(ctx.local("regA"))),
					index(id(ctx.R), id(ctx.local("regB")))
				)
			),
			[
				exprStmt(
					assign(
						id(ctx.IP),
						bin(BOp.Mul, id(ctx.local("target")), lit(2))
					)
				),
			]
		),
		breakStmt(),
	];
}
registry.set(Op.REG_LT_REG_JF, REG_LT_REG_JF);
