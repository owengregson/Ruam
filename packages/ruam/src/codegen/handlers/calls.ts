/**
 * Call opcode handlers in raw node form.
 *
 * Covers 16 opcodes:
 *  - Basic calls:    CALL, CALL_METHOD, CALL_NEW, SUPER_CALL
 *  - Spread:         SPREAD_ARGS
 *  - Optional:       CALL_OPTIONAL, CALL_METHOD_OPTIONAL
 *  - Eval:           DIRECT_EVAL
 *  - Templates:      CALL_TAGGED_TEMPLATE
 *  - Super methods:  CALL_SUPER_METHOD
 *  - Fast-path:      CALL_0, CALL_1, CALL_2, CALL_3
 *
 * All handlers use raw() — spread flattening loops, debug branches, and
 * complex apply patterns are most cleanly expressed as literal JS.
 *
 * @module codegen/handlers/calls
 */

import { Op } from "../../compiler/opcodes.js";
import { type JsNode, raw } from "../nodes.js";
import { registry, type HandlerCtx } from "./registry.js";

// --- Helpers ---

/**
 * Build the common spread-flattening preamble for call handlers.
 *
 * Generates:
 * ```
 * var argc=O;var hasSpread=argc<0;if(hasSpread)argc=-argc;
 * var callArgs=new Array(argc);for(var ai=argc-1;ai>=0;ai--)callArgs[ai]=X();
 * if(hasSpread){var flat=[];for(var ai=0;ai<callArgs.length;ai++){
 *   if(callArgs[ai]&&callArgs[ai].__spread__){
 *     for(var si=0;si<callArgs[ai].items.length;si++)flat.push(callArgs[ai].items[si]);
 *   }else flat.push(callArgs[ai]);}callArgs=flat;}
 * ```
 */
function spreadPreamble(ctx: HandlerCtx): string {
	return (
		`var argc=${ctx.O};var hasSpread=argc<0;if(hasSpread)argc=-argc;` +
		`var callArgs=new Array(argc);for(var ai=argc-1;ai>=0;ai--)callArgs[ai]=${ctx.X}();` +
		`if(hasSpread){var flat=[];for(var ai=0;ai<callArgs.length;ai++){` +
		`if(callArgs[ai]&&callArgs[ai].__spread__){` +
		`for(var si=0;si<callArgs[ai].items.length;si++)flat.push(callArgs[ai].items[si]);` +
		`}else flat.push(callArgs[ai]);}callArgs=flat;}`
	);
}

/**
 * Build a simple (no-spread) argument collection preamble.
 *
 * Generates: `var argc=O;var callArgs=new Array(argc);for(var ai=argc-1;ai>=0;ai--)callArgs[ai]=X();`
 */
function simplePreamble(ctx: HandlerCtx): string {
	return (
		`var argc=${ctx.O};var callArgs=new Array(argc);` +
		`for(var ai=argc-1;ai>=0;ai--)callArgs[ai]=${ctx.X}();`
	);
}

// --- Call handlers ---

/**
 * CALL: pop arguments, pop function, apply with spread flattening.
 * Includes debug trace when debug mode is enabled.
 */
function CALL(ctx: HandlerCtx): JsNode[] {
	return [raw(
		spreadPreamble(ctx) +
		`var fn=${ctx.X}();` +
		(ctx.debug
			? `${ctx.dbg}('CALL','fn=',typeof fn,'argc='+callArgs.length,fn&&fn.name?'name='+fn.name:'');` +
			  `if(typeof fn!=='function')${ctx.dbg}('CALL_ERR','NOT A FUNCTION:',fn,'${ctx.S} depth='+${ctx.P});`
			: '') +
		`${ctx.W}(fn.apply(void 0,callArgs));break;`
	)];
}

/**
 * CALL_METHOD: pop arguments, pop receiver, pop function, apply with receiver.
 * Includes debug trace when debug mode is enabled.
 */
function CALL_METHOD(ctx: HandlerCtx): JsNode[] {
	return [raw(
		spreadPreamble(ctx) +
		`var recv=${ctx.X}();var fn=${ctx.X}();` +
		(ctx.debug
			? `${ctx.dbg}('CALL_METHOD','fn=',typeof fn,'recv=',typeof recv,'argc='+callArgs.length,fn&&fn.name?'name='+fn.name:'');` +
			  `if(typeof fn!=='function')${ctx.dbg}('CALL_METHOD_ERR','NOT A FUNCTION:',fn,'recv=',recv);`
			: '') +
		`${ctx.W}(fn.apply(recv,callArgs));break;`
	)];
}

/**
 * CALL_NEW: pop arguments, pop constructor, invoke with `new`.
 *
 * ```
 * var argc=O;var callArgs=new Array(argc);
 * for(var ai=argc-1;ai>=0;ai--)callArgs[ai]=X();
 * var Ctor=X();W(new (Ctor.bind.apply(Ctor,[null].concat(callArgs)))());break;
 * ```
 */
function CALL_NEW(ctx: HandlerCtx): JsNode[] {
	return [raw(
		simplePreamble(ctx) +
		`var Ctor=${ctx.X}();` +
		`${ctx.W}(new (Ctor.bind.apply(Ctor,[null].concat(callArgs)))());break;`
	)];
}

/**
 * SUPER_CALL: pop arguments, resolve super constructor via home object, apply to this.
 * Includes debug trace when debug mode is enabled.
 */
function SUPER_CALL(ctx: HandlerCtx): JsNode[] {
	return [raw(
		simplePreamble(ctx) +
		`var superProto=${ctx.HO}?Object.getPrototypeOf(${ctx.HO}):Object.getPrototypeOf(Object.getPrototypeOf(${ctx.TV}));` +
		(ctx.debug
			? `${ctx.dbg}('SUPER_CALL','argc='+argc,'superProto=',!!superProto,'superCtor=',superProto&&typeof superProto.constructor);`
			: '') +
		`if(superProto&&superProto.constructor){superProto.constructor.apply(${ctx.TV},callArgs);}` +
		`${ctx.W}(${ctx.TV});break;`
	)];
}

// --- Spread ---

/** `S[P]={__spread__:true,items:Array.from(S[P])};break;` */
function SPREAD_ARGS(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`${ctx.S}[${ctx.P}]={__spread__:true,items:Array.from(${ctx.S}[${ctx.P}])};break;`
	)];
}

// --- Optional calls ---

/**
 * CALL_OPTIONAL: like CALL but returns undefined if function is nullish.
 *
 * ```
 * ...spread preamble...
 * var fn=X();W(fn==null?void 0:fn.apply(void 0,callArgs));break;
 * ```
 */
function CALL_OPTIONAL(ctx: HandlerCtx): JsNode[] {
	return [raw(
		spreadPreamble(ctx) +
		`var fn=${ctx.X}();${ctx.W}(fn==null?void 0:fn.apply(void 0,callArgs));break;`
	)];
}

/**
 * CALL_METHOD_OPTIONAL: like CALL_METHOD but returns undefined if function is nullish.
 *
 * ```
 * ...spread preamble...
 * var recv=X();var fn=X();W(fn==null?void 0:fn.apply(recv,callArgs));break;
 * ```
 */
function CALL_METHOD_OPTIONAL(ctx: HandlerCtx): JsNode[] {
	return [raw(
		spreadPreamble(ctx) +
		`var recv=${ctx.X}();var fn=${ctx.X}();${ctx.W}(fn==null?void 0:fn.apply(recv,callArgs));break;`
	)];
}

// --- Eval ---

/** `{var code=X();W(eval(code));break;}` */
function DIRECT_EVAL(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var code=${ctx.X}();${ctx.W}(eval(code));break;`
	)];
}

// --- Tagged template call ---

/**
 * CALL_TAGGED_TEMPLATE: pop arguments, pop tag function, apply.
 *
 * ```
 * var argc=O;var callArgs=new Array(argc);
 * for(var ai=argc-1;ai>=0;ai--)callArgs[ai]=X();
 * var fn=X();W(fn.apply(void 0,callArgs));break;
 * ```
 */
function CALL_TAGGED_TEMPLATE(ctx: HandlerCtx): JsNode[] {
	return [raw(
		simplePreamble(ctx) +
		`var fn=${ctx.X}();${ctx.W}(fn.apply(void 0,callArgs));break;`
	)];
}

// --- Super method call ---

/**
 * CALL_SUPER_METHOD: call a named method on the super prototype.
 * Operand packs argc in low 16 bits and name constant index in high 16 bits.
 *
 * ```
 * var argc=O&0xFFFF;var nameIdx=(O>>16)&0xFFFF;
 * var callArgs=new Array(argc);for(var ai=argc-1;ai>=0;ai--)callArgs[ai]=X();
 * var sp2=HO?Object.getPrototypeOf(HO):Object.getPrototypeOf(Object.getPrototypeOf(TV));
 * var fn=sp2?sp2[C[nameIdx]]:void 0;W(fn?fn.apply(TV,callArgs):void 0);break;
 * ```
 */
function CALL_SUPER_METHOD(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var argc=${ctx.O}&0xFFFF;var nameIdx=(${ctx.O}>>16)&0xFFFF;` +
		`var callArgs=new Array(argc);for(var ai=argc-1;ai>=0;ai--)callArgs[ai]=${ctx.X}();` +
		`var sp2=${ctx.HO}?Object.getPrototypeOf(${ctx.HO}):Object.getPrototypeOf(Object.getPrototypeOf(${ctx.TV}));` +
		`var fn=sp2?sp2[${ctx.C}[nameIdx]]:void 0;${ctx.W}(fn?fn.apply(${ctx.TV},callArgs):void 0);break;`
	)];
}

// --- Fast-path calls (no spread, fixed arity) ---

/** `{var fn=X();W(fn());break;}` */
function CALL_0(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var fn=${ctx.X}();${ctx.W}(fn());break;`
	)];
}

/** `{var a1=X();var fn=X();W(fn(a1));break;}` */
function CALL_1(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var a1=${ctx.X}();var fn=${ctx.X}();${ctx.W}(fn(a1));break;`
	)];
}

/** `{var a2=X();var a1=X();var fn=X();W(fn(a1,a2));break;}` */
function CALL_2(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var a2=${ctx.X}();var a1=${ctx.X}();var fn=${ctx.X}();${ctx.W}(fn(a1,a2));break;`
	)];
}

/** `{var a3=X();var a2=X();var a1=X();var fn=X();W(fn(a1,a2,a3));break;}` */
function CALL_3(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var a3=${ctx.X}();var a2=${ctx.X}();var a1=${ctx.X}();var fn=${ctx.X}();${ctx.W}(fn(a1,a2,a3));break;`
	)];
}

// --- Registration ---

registry.set(Op.CALL, CALL);
registry.set(Op.CALL_METHOD, CALL_METHOD);
registry.set(Op.CALL_NEW, CALL_NEW);
registry.set(Op.SUPER_CALL, SUPER_CALL);
registry.set(Op.SPREAD_ARGS, SPREAD_ARGS);
registry.set(Op.CALL_OPTIONAL, CALL_OPTIONAL);
registry.set(Op.CALL_METHOD_OPTIONAL, CALL_METHOD_OPTIONAL);
registry.set(Op.DIRECT_EVAL, DIRECT_EVAL);
registry.set(Op.CALL_TAGGED_TEMPLATE, CALL_TAGGED_TEMPLATE);
registry.set(Op.CALL_SUPER_METHOD, CALL_SUPER_METHOD);
registry.set(Op.CALL_0, CALL_0);
registry.set(Op.CALL_1, CALL_1);
registry.set(Op.CALL_2, CALL_2);
registry.set(Op.CALL_3, CALL_3);
