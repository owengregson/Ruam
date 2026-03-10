/**
 * Destructuring opcode handlers in AST node form.
 *
 * Covers 6 opcodes:
 *  - DESTRUCTURE_BIND, DESTRUCTURE_DEFAULT
 *  - DESTRUCTURE_REST_ARRAY, DESTRUCTURE_REST_OBJECT
 *  - ARRAY_PATTERN_INIT, OBJECT_PATTERN_GET
 *
 * DESTRUCTURE_BIND is a simple no-op (break only).  All other handlers use
 * raw() nodes due to complex control flow (while loops, conditional logic,
 * multi-step property iteration).
 *
 * @module codegen/handlers/destructuring
 */

import { Op } from "../../compiler/opcodes.js";
import {
	type JsNode,
	breakStmt, raw,
} from "../nodes.js";
import { registry, type HandlerCtx } from "./index.js";

// --- Simple handler ---

/** DESTRUCTURE_BIND: no-op marker, just break. */
function DESTRUCTURE_BIND(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

// --- Complex handlers (raw — loops and conditional logic) ---

/**
 * DESTRUCTURE_DEFAULT: apply default value if top-of-stack is undefined.
 *
 * ```
 * var v=Y();if(v===void 0){P--;var def=C[O];W(def);}break;
 * ```
 */
function DESTRUCTURE_DEFAULT(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var v=${ctx.Y}();if(v===void 0){${ctx.P}--;var def=${ctx.C}[${ctx.O}];${ctx.W}(def);}break;`
	)];
}

/**
 * DESTRUCTURE_REST_ARRAY: collect remaining iterator values into a rest array.
 *
 * ```
 * var iterObj=X();var rest=[];
 * while(!iterObj._done){rest.push(iterObj._value);
 *   var nxt=iterObj._iter.next();iterObj._done=!!nxt.done;iterObj._value=nxt.value;}
 * W(rest);break;
 * ```
 */
function DESTRUCTURE_REST_ARRAY(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var iterObj=${ctx.X}();var rest=[];` +
		`while(!iterObj._done){rest.push(iterObj._value);` +
		`var nxt=iterObj._iter.next();iterObj._done=!!nxt.done;iterObj._value=nxt.value;}` +
		`${ctx.W}(rest);break;`
	)];
}

/**
 * DESTRUCTURE_REST_OBJECT: collect remaining object keys into a rest object.
 *
 * ```
 * var excludeKeys=X();var src=X();var rest={};
 * var keys=Object.keys(src);
 * for(var ki=0;ki<keys.length;ki++){
 *   if(excludeKeys.indexOf(keys[ki])<0)rest[keys[ki]]=src[keys[ki]];}
 * W(rest);break;
 * ```
 */
function DESTRUCTURE_REST_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var excludeKeys=${ctx.X}();var src=${ctx.X}();var rest={};` +
		`var keys=Object.keys(src);` +
		`for(var ki=0;ki<keys.length;ki++){` +
		`if(excludeKeys.indexOf(keys[ki])<0)rest[keys[ki]]=src[keys[ki]];}` +
		`${ctx.W}(rest);break;`
	)];
}

/**
 * ARRAY_PATTERN_INIT: initialize array destructuring iterator.
 *
 * ```
 * var arr=X();var iter=arr[Symbol.iterator]();
 * var first=iter.next();
 * W({_iter:iter,_done:!!first.done,_value:first.value});break;
 * ```
 */
function ARRAY_PATTERN_INIT(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var arr=${ctx.X}();var iter=arr[Symbol.iterator]();` +
		`var first=iter.next();` +
		`${ctx.W}({_iter:iter,_done:!!first.done,_value:first.value});break;`
	)];
}

/**
 * OBJECT_PATTERN_GET: get a property from the object on top of stack.
 *
 * ```
 * var obj=Y();W(obj[C[O]]);break;
 * ```
 */
function OBJECT_PATTERN_GET(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var obj=${ctx.Y}();${ctx.W}(obj[${ctx.C}[${ctx.O}]]);break;`
	)];
}

// --- Registration ---

registry.set(Op.DESTRUCTURE_BIND, DESTRUCTURE_BIND);
registry.set(Op.DESTRUCTURE_DEFAULT, DESTRUCTURE_DEFAULT);
registry.set(Op.DESTRUCTURE_REST_ARRAY, DESTRUCTURE_REST_ARRAY);
registry.set(Op.DESTRUCTURE_REST_OBJECT, DESTRUCTURE_REST_OBJECT);
registry.set(Op.ARRAY_PATTERN_INIT, ARRAY_PATTERN_INIT);
registry.set(Op.OBJECT_PATTERN_GET, OBJECT_PATTERN_GET);
