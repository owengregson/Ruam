/**
 * Function creation and closure opcode handlers in AST node form.
 *
 * Covers 12 opcodes:
 *  - Closures:    NEW_CLOSURE, NEW_FUNCTION, NEW_ARROW, NEW_ASYNC,
 *                 NEW_GENERATOR, NEW_ASYNC_GENERATOR
 *  - Metadata:    SET_FUNC_NAME, SET_FUNC_LENGTH
 *  - Stubs:       BIND_THIS, MAKE_METHOD
 *  - Closure vars: PUSH_CLOSURE_VAR, STORE_CLOSURE_VAR
 *
 * NEW_CLOSURE and NEW_FUNCTION are the most complex handlers in the entire
 * VM — they create closure wrappers with arrow/non-arrow branching, async
 * variants, this-boxing for sloppy mode, and home object forwarding for
 * super calls.  All function handlers use raw() due to nested IIFE patterns,
 * multi-branch conditionals, and runtime function construction.
 *
 * @module codegen/handlers/functions
 */

import { Op } from "../../compiler/opcodes.js";
import { type JsNode, raw, breakStmt } from "../nodes.js";
import type { HandlerCtx } from "./registry.js";
import { registry } from "./registry.js";

// --- Primary closure handlers ---

/**
 * NEW_CLOSURE: create a closure wrapper for a compiled unit.
 *
 * Branches on arrow (captures outer this/scope) vs regular (this-boxing),
 * sync vs async, with debug tracing when enabled.  Home object (`fn._ho`)
 * is forwarded for super call resolution.
 */
function NEW_CLOSURE(ctx: HandlerCtx): JsNode[] {
	if (ctx.debug) {
		return [
			raw(
				`var _cuid=${ctx.C}[${ctx.O}];var _cu=${ctx.load}(_cuid);_cu._dbgId=_cuid;` +
					`${ctx.dbg}('NEW_CLOSURE','uid='+_cuid,'async='+!!_cu.s,'params='+_cu.p,'arrow='+!!_cu.a);` +
					`if(_cu.a){if(_cu.s){${ctx.W}((function(u,uid,cs,ct){return async function(..._a){` +
					`${ctx.dbg}('CALL_CLOSURE','async arrow uid='+uid,'args='+_a.length);` +
					`return ${ctx.execAsync}(u,_a,cs,ct);` +
					`};})(_cu,_cuid,${ctx.SC},${ctx.TV}));}else{${ctx.W}((function(u,uid,cs,ct){return function(..._a){` +
					`${ctx.dbg}('CALL_CLOSURE','arrow uid='+uid,'args='+_a.length);` +
					`return ${ctx.exec}(u,_a,cs,ct);` +
					`};})(_cu,_cuid,${ctx.SC},${ctx.TV}));}}` +
					`else{if(_cu.s){${ctx.W}((function(u,uid,cs){var fn=async function(..._a){` +
					`${ctx.dbg}('CALL_CLOSURE','async uid='+uid,'args='+_a.length);` +
					`var _tv=this;if(!u.st){if(_tv==null)_tv=globalThis;else{var _tt=typeof _tv;if(_tt!=="object"&&_tt!=="function")_tv=Object(_tv);}}` +
					`return ${ctx.execAsync}(u,_a,cs,_tv,void 0,fn._ho);` +
					`};return fn;})(_cu,_cuid,${ctx.SC}));}else{${ctx.W}((function(u,uid,cs){var fn=function(..._a){` +
					`${ctx.dbg}('CALL_CLOSURE','uid='+uid,'args='+_a.length);` +
					`var _tv=this;if(!u.st){if(_tv==null)_tv=globalThis;else{var _tt=typeof _tv;if(_tt!=="object"&&_tt!=="function")_tv=Object(_tv);}}` +
					`return ${ctx.exec}(u,_a,cs,_tv,void 0,fn._ho);` +
					`};return fn;})(_cu,_cuid,${ctx.SC}));}}` +
					`break;`
			),
		];
	}
	return [
		raw(
			`var _cu=${ctx.load}(${ctx.C}[${ctx.O}]);` +
				`if(_cu.a){${ctx.W}((function(u,cs,ct){if(u.s){return async function(..._a){` +
				`return ${ctx.execAsync}(u,_a,cs,ct);` +
				`};}return function(..._a){` +
				`return ${ctx.exec}(u,_a,cs,ct);` +
				`};})(_cu,${ctx.SC},${ctx.TV}));}` +
				`else{${ctx.W}((function(u,cs){if(u.s){var fn=async function(..._a){` +
				`var _tv=this;if(!u.st){if(_tv==null)_tv=globalThis;else{var _tt=typeof _tv;if(_tt!=="object"&&_tt!=="function")_tv=Object(_tv);}}` +
				`return ${ctx.execAsync}(u,_a,cs,_tv,void 0,fn._ho);` +
				`};return fn;}var fn=function(..._a){` +
				`var _tv=this;if(!u.st){if(_tv==null)_tv=globalThis;else{var _tt=typeof _tv;if(_tt!=="object"&&_tt!=="function")_tv=Object(_tv);}}` +
				`return ${ctx.exec}(u,_a,cs,_tv,void 0,fn._ho);` +
				`};return fn;})(_cu,${ctx.SC}));}` +
				`break;`
		),
	];
}

/**
 * NEW_FUNCTION: create a function wrapper (no arrow variant).
 *
 * Simpler than NEW_CLOSURE — always non-arrow, so always includes
 * this-boxing and home object forwarding.
 */
function NEW_FUNCTION(ctx: HandlerCtx): JsNode[] {
	if (ctx.debug) {
		return [
			raw(
				`var _fuid=${ctx.C}[${ctx.O}];var _fu=${ctx.load}(_fuid);_fu._dbgId=_fuid;` +
					`${ctx.dbg}('NEW_FUNCTION','uid='+_fuid,'async='+!!_fu.s,'params='+_fu.p);` +
					`if(_fu.s){${ctx.W}((function(u,uid,cs){var fn=async function(..._a){` +
					`${ctx.dbg}('CALL_FUNCTION','async uid='+uid,'args='+_a.length);` +
					`var _tv=this;if(!u.st){if(_tv==null)_tv=globalThis;else{var _tt=typeof _tv;if(_tt!=="object"&&_tt!=="function")_tv=Object(_tv);}}` +
					`return ${ctx.execAsync}(u,_a,cs,_tv,void 0,fn._ho);` +
					`};return fn;})(_fu,_fuid,${ctx.SC}));}else{${ctx.W}((function(u,uid,cs){var fn=function(..._a){` +
					`${ctx.dbg}('CALL_FUNCTION','uid='+uid,'args='+_a.length);` +
					`var _tv=this;if(!u.st){if(_tv==null)_tv=globalThis;else{var _tt=typeof _tv;if(_tt!=="object"&&_tt!=="function")_tv=Object(_tv);}}` +
					`return ${ctx.exec}(u,_a,cs,_tv,void 0,fn._ho);` +
					`};return fn;})(_fu,_fuid,${ctx.SC}));}` +
					`break;`
			),
		];
	}
	return [
		raw(
			`${ctx.W}((function(u,cs){if(u.s){var fn=async function(..._a){` +
				`var _tv=this;if(!u.st){if(_tv==null)_tv=globalThis;else{var _tt=typeof _tv;if(_tt!=="object"&&_tt!=="function")_tv=Object(_tv);}}` +
				`return ${ctx.execAsync}(u,_a,cs,_tv,void 0,fn._ho);` +
				`};return fn;}var fn=function(..._a){` +
				`var _tv=this;if(!u.st){if(_tv==null)_tv=globalThis;else{var _tt=typeof _tv;if(_tt!=="object"&&_tt!=="function")_tv=Object(_tv);}}` +
				`return ${ctx.exec}(u,_a,cs,_tv,void 0,fn._ho);` +
				`};return fn;})(${ctx.load}(${ctx.C}[${ctx.O}]),${ctx.SC}));` +
				`break;`
		),
	];
}

// --- Specialized function creation handlers ---

/**
 * NEW_ARROW: create an arrow function (captures outer this + scope).
 *
 * No this-boxing — arrow functions inherit `this` from enclosing context.
 */
function NEW_ARROW(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`${ctx.W}((function(u,cs,ct){if(u.s){return async function(..._a){` +
				`return ${ctx.execAsync}(u,_a,cs,ct);` +
				`};}return function(..._a){` +
				`return ${ctx.exec}(u,_a,cs,ct);` +
				`};})( ${ctx.load}(${ctx.C}[${ctx.O}]),${ctx.SC},${ctx.TV}));break;`
		),
	];
}

/**
 * NEW_ASYNC: create an async function with this-boxing.
 */
function NEW_ASYNC(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`${ctx.W}((function(u,cs){return async function(..._a){` +
				`var _tv=this;if(!u.st){if(_tv==null)_tv=globalThis;else{var _tt=typeof _tv;if(_tt!=="object"&&_tt!=="function")_tv=Object(_tv);}}` +
				`return ${ctx.execAsync}(u,_a,cs,_tv);` +
				`};})( ${ctx.load}(${ctx.C}[${ctx.O}]),${ctx.SC}));break;`
		),
	];
}

/**
 * NEW_GENERATOR / NEW_ASYNC_GENERATOR: create a generator function.
 *
 * Both are handled identically — generators are stub-executed (run to completion).
 */
function NEW_GENERATOR_HANDLER(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`${ctx.W}((function(u,cs){return function(..._a){` +
				`var _tv=this;if(!u.st){if(_tv==null)_tv=globalThis;else{var _tt=typeof _tv;if(_tt!=="object"&&_tt!=="function")_tv=Object(_tv);}}` +
				`return ${ctx.exec}(u,_a,cs,_tv);` +
				`};})( ${ctx.load}(${ctx.C}[${ctx.O}]),${ctx.SC}));break;`
		),
	];
}

// --- Metadata handlers ---

/**
 * SET_FUNC_NAME: set the `name` property on the function at stack top.
 *
 * Uses Object.defineProperty for configurable-only (non-writable, non-enumerable).
 */
function SET_FUNC_NAME(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var fn=${ctx.Y}();try{Object.defineProperty(fn,'name',{value:${ctx.C}[${ctx.O}],configurable:true});}catch(e){}break;`
		),
	];
}

/**
 * SET_FUNC_LENGTH: set the `length` property on the function at stack top.
 */
function SET_FUNC_LENGTH(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var fn=${ctx.Y}();try{Object.defineProperty(fn,'length',{value:${ctx.O},configurable:true});}catch(e){}break;`
		),
	];
}

// --- Stub handlers ---

/** BIND_THIS / MAKE_METHOD: no-op stubs. */
function BIND_STUB(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

// --- Closure variable handlers ---

/**
 * PUSH_CLOSURE_VAR: walk scope chain to find a captured variable, push its value.
 *
 * Uses raw() because the while-loop with `break` exits the loop, not the case.
 */
function PUSH_CLOSURE_VAR(ctx: HandlerCtx): JsNode[] {
	const sv = ctx.sv();
	return [
		raw(
			`var name=${ctx.C}[${ctx.O}];var s=${ctx.SC};` +
				ctx.scopeWalk(`${ctx.W}(${sv});`)
		),
	];
}

/**
 * STORE_CLOSURE_VAR: walk scope chain to find a captured variable, store a value.
 *
 * Pops the value from the stack, then walks the scope chain to find the slot.
 */
function STORE_CLOSURE_VAR(ctx: HandlerCtx): JsNode[] {
	const sv = ctx.sv();
	return [
		raw(
			`var name=${ctx.C}[${ctx.O}];var val=${ctx.X}();var s=${ctx.SC};` +
				ctx.scopeWalk(`${sv}=val;`)
		),
	];
}

// --- Registration ---

registry.set(Op.NEW_CLOSURE, NEW_CLOSURE);
registry.set(Op.NEW_FUNCTION, NEW_FUNCTION);
registry.set(Op.NEW_ARROW, NEW_ARROW);
registry.set(Op.NEW_ASYNC, NEW_ASYNC);
registry.set(Op.NEW_GENERATOR, NEW_GENERATOR_HANDLER);
registry.set(Op.NEW_ASYNC_GENERATOR, NEW_GENERATOR_HANDLER);
registry.set(Op.SET_FUNC_NAME, SET_FUNC_NAME);
registry.set(Op.SET_FUNC_LENGTH, SET_FUNC_LENGTH);
registry.set(Op.BIND_THIS, BIND_STUB);
registry.set(Op.MAKE_METHOD, BIND_STUB);
registry.set(Op.PUSH_CLOSURE_VAR, PUSH_CLOSURE_VAR);
registry.set(Op.STORE_CLOSURE_VAR, STORE_CLOSURE_VAR);
