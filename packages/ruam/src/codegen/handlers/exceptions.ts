/**
 * Exception handling opcode handlers in AST node form.
 *
 * Covers 10 opcodes:
 *  - Try/catch:  TRY_PUSH, TRY_POP, CATCH_BIND, CATCH_BIND_PATTERN
 *  - Finally:    FINALLY_MARK, END_FINALLY
 *  - Guards:     THROW_IF_NOT_OBJECT
 *  - Error ctors: THROW_REF_ERROR, THROW_TYPE_ERROR, THROW_SYNTAX_ERROR
 *
 * All handlers use raw() because of multi-step control flow, conditional
 * logic with early breaks, and exception state management.
 *
 * @module codegen/handlers/exceptions
 */

import { Op } from "../../compiler/opcodes.js";
import { type JsNode, raw, breakStmt } from "../nodes.js";
import type { HandlerCtx } from "./registry.js";
import { registry } from "./registry.js";

// --- Try/catch handlers ---

/**
 * TRY_PUSH: push an exception handler frame onto the handler stack.
 *
 * Extracts catchIp and finallyIp from the packed operand.
 * 0xFFFF sentinel means no catch/finally target.
 *
 * ```
 * var catchIp=(O>>16)&0xFFFF;var finallyIp=O&0xFFFF;
 * if(catchIp===0xFFFF)catchIp=-1;if(finallyIp===0xFFFF)finallyIp=-1;
 * if(!EX)EX=[];EX.push({catchIp:catchIp,finallyIp:finallyIp,sp:P});break;
 * ```
 */
function TRY_PUSH(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var catchIp=(${ctx.O}>>16)&0xFFFF;var finallyIp=${ctx.O}&0xFFFF;` +
		`if(catchIp===0xFFFF)catchIp=-1;if(finallyIp===0xFFFF)finallyIp=-1;` +
		`if(!${ctx.EX})${ctx.EX}=[];${ctx.EX}.push({catchIp:catchIp,finallyIp:finallyIp,sp:${ctx.P}});break;`
	)];
}

/** TRY_POP: pop the top exception handler frame. */
function TRY_POP(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`${ctx.EX}.pop();break;`
	)];
}

/**
 * CATCH_BIND: bind caught exception to a variable.
 *
 * If operand >= 0, uses constant pool for name and stores in scope vars
 * or register. Otherwise pushes the error onto the stack.
 *
 * ```
 * var err=X();if(O>=0){var cname=C[O];if(typeof cname==='string'){SC.sV[cname]=err;}else{R[O]=err;}}else{W(err);}break;
 * ```
 */
function CATCH_BIND(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var err=${ctx.X}();` +
		`if(${ctx.O}>=0){var cname=${ctx.C}[${ctx.O}];` +
		`if(typeof cname==='string'){${ctx.SC}.${ctx.sV}[cname]=err;}` +
		`else{${ctx.R}[${ctx.O}]=err;}}` +
		`else{${ctx.W}(err);}break;`
	)];
}

/**
 * CATCH_BIND_PATTERN: bind caught exception for destructuring.
 *
 * Simply pops the exception from the internal state and pushes it onto
 * the stack for subsequent destructuring opcodes.
 */
function CATCH_BIND_PATTERN(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var err=${ctx.X}();${ctx.W}(err);break;`
	)];
}

// --- Finally handlers ---

/** FINALLY_MARK: no-op marker for finally block entry. */
function FINALLY_MARK(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

/**
 * END_FINALLY: complete a finally block.
 *
 * Re-throws pending exception if one exists.
 * Completes deferred return if completion type is set.
 *
 * ```
 * if(HPE){var ex=PE;PE=null;HPE=false;throw ex;}
 * if(CT===1){var _rv2=CV;CT=0;CV=void 0;return _rv2;}break;
 * ```
 */
function END_FINALLY(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`if(${ctx.HPE}){var ex=${ctx.PE};${ctx.PE}=null;${ctx.HPE}=false;throw ex;}` +
		`if(${ctx.CT}===1){var _rv2=${ctx.CV};${ctx.CT}=0;${ctx.CV}=void 0;return _rv2;}break;`
	)];
}

// --- Guard handlers ---

/**
 * THROW_IF_NOT_OBJECT: throw TypeError if top-of-stack is not an object.
 *
 * Peeks at the stack top without consuming it.
 */
function THROW_IF_NOT_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var v=${ctx.Y}();if(typeof v!=='object'||v===null)throw new TypeError('Value is not an object');break;`
	)];
}

// --- Error constructor handlers ---

/**
 * THROW_REF_ERROR: throw a ReferenceError with message from constant pool.
 */
function THROW_REF_ERROR(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`throw new ReferenceError(${ctx.C}[${ctx.O}]||'not defined');`
	)];
}

/**
 * THROW_TYPE_ERROR: throw a TypeError with message from constant pool.
 */
function THROW_TYPE_ERROR(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`throw new TypeError(${ctx.C}[${ctx.O}]||'type error');`
	)];
}

/**
 * THROW_SYNTAX_ERROR: throw a SyntaxError with message from constant pool.
 */
function THROW_SYNTAX_ERROR(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`throw new SyntaxError(${ctx.C}[${ctx.O}]||'syntax error');`
	)];
}

// --- Registration ---

registry.set(Op.TRY_PUSH, TRY_PUSH);
registry.set(Op.TRY_POP, TRY_POP);
registry.set(Op.CATCH_BIND, CATCH_BIND);
registry.set(Op.CATCH_BIND_PATTERN, CATCH_BIND_PATTERN);
registry.set(Op.FINALLY_MARK, FINALLY_MARK);
registry.set(Op.END_FINALLY, END_FINALLY);
registry.set(Op.THROW_IF_NOT_OBJECT, THROW_IF_NOT_OBJECT);
registry.set(Op.THROW_REF_ERROR, THROW_REF_ERROR);
registry.set(Op.THROW_TYPE_ERROR, THROW_TYPE_ERROR);
registry.set(Op.THROW_SYNTAX_ERROR, THROW_SYNTAX_ERROR);
