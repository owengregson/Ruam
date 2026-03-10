/**
 * Class definition opcode handlers in raw node form.
 *
 * Covers 22 opcodes:
 *  - Class creation:   NEW_CLASS, NEW_DERIVED_CLASS, EXTEND_CLASS
 *  - Methods:          DEFINE_METHOD, DEFINE_STATIC_METHOD
 *  - Accessors:        DEFINE_GETTER, DEFINE_STATIC_GETTER,
 *                      DEFINE_SETTER, DEFINE_STATIC_SETTER
 *  - Fields:           DEFINE_FIELD, DEFINE_STATIC_FIELD
 *  - Private members:  DEFINE_PRIVATE_METHOD, DEFINE_PRIVATE_GETTER,
 *                      DEFINE_PRIVATE_SETTER, DEFINE_PRIVATE_FIELD,
 *                      DEFINE_STATIC_PRIVATE_FIELD, DEFINE_STATIC_PRIVATE_METHOD
 *  - Static blocks:    CLASS_STATIC_BLOCK
 *  - Finalization:     FINALIZE_CLASS
 *  - Private env:      INIT_PRIVATE_ENV, ADD_PRIVATE_BRAND, CHECK_PRIVATE_BRAND
 *
 * All handlers use raw() — IIFE class constructors, property access chains,
 * home object stamping, and prototype setup are most cleanly expressed as literal JS.
 *
 * @module codegen/handlers/classes
 */

import { Op } from "../../compiler/opcodes.js";
import { type JsNode, raw, breakStmt } from "../nodes.js";
import { registry, type HandlerCtx } from "./index.js";

// --- Class creation ---

/**
 * NEW_CLASS: create a new class with optional superclass.
 * Uses IIFE-wrapped `_ctor` to prevent var-hoisting sharing across classes.
 * Includes debug trace when debug mode is enabled.
 *
 * ```
 * var hasSuperClass=O;var SuperClass=hasSuperClass?X():null;
 * var cls=(function(){var c=null;var f=function(){if(c)return c.apply(this,arguments);};
 *   f.__setCtor=function(x){c=x;};return f;})();
 * if(SuperClass){cls.prototype=Object.create(SuperClass.prototype);
 *   cls.prototype.constructor=cls;Object.setPrototypeOf(cls,SuperClass);}
 * W(cls);break;
 * ```
 */
function NEW_CLASS(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var hasSuperClass=${ctx.O};var SuperClass=hasSuperClass?${ctx.X}():null;` +
		(ctx.debug ? `${ctx.dbg}('NEW_CLASS','hasSuper='+!!hasSuperClass);` : '') +
		`var cls=(function(){var c=null;var f=function(){if(c)return c.apply(this,arguments);};f.__setCtor=function(x){c=x;};return f;})();` +
		`if(SuperClass){cls.prototype=Object.create(SuperClass.prototype);cls.prototype.constructor=cls;Object.setPrototypeOf(cls,SuperClass);}` +
		`${ctx.W}(cls);break;`
	)];
}

/**
 * NEW_DERIVED_CLASS: create a derived class (always has superclass).
 * Includes debug trace when debug mode is enabled.
 *
 * ```
 * var SuperClass=X();
 * var cls=(function(){var c=null;var f=function(){if(c)return c.apply(this,arguments);};
 *   f.__setCtor=function(x){c=x;};return f;})();
 * cls.prototype=Object.create(SuperClass.prototype);cls.prototype.constructor=cls;
 * Object.setPrototypeOf(cls,SuperClass);W(cls);break;
 * ```
 */
function NEW_DERIVED_CLASS(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var SuperClass=${ctx.X}();` +
		(ctx.debug ? `${ctx.dbg}('NEW_DERIVED_CLASS');` : '') +
		`var cls=(function(){var c=null;var f=function(){if(c)return c.apply(this,arguments);};f.__setCtor=function(x){c=x;};return f;})();` +
		`cls.prototype=Object.create(SuperClass.prototype);cls.prototype.constructor=cls;Object.setPrototypeOf(cls,SuperClass);` +
		`${ctx.W}(cls);break;`
	)];
}

/**
 * EXTEND_CLASS: set up prototype chain for class inheritance.
 *
 * ```
 * var superCls=X();var cls=Y();
 * cls.prototype=Object.create(superCls.prototype);
 * cls.prototype.constructor=cls;Object.setPrototypeOf(cls,superCls);break;
 * ```
 */
function EXTEND_CLASS(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var superCls=${ctx.X}();var cls=${ctx.Y}();` +
		`cls.prototype=Object.create(superCls.prototype);cls.prototype.constructor=cls;Object.setPrototypeOf(cls,superCls);break;`
	)];
}

// --- Method definition ---

/**
 * DEFINE_METHOD: define an instance or static method with home object stamping.
 * Operand packs name constant index in low 16 bits and isStatic flag in bit 16.
 * Constructor detection routes through `__setCtor` for IIFE-wrapped class constructors.
 * Includes debug trace when debug mode is enabled.
 */
function DEFINE_METHOD(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var fn=${ctx.X}();var cls=${ctx.Y}();var name=${ctx.C}[${ctx.O}&0xFFFF];var isStatic=(${ctx.O}>>16)&1;` +
		(ctx.debug
			? `${ctx.dbg}('DEFINE_METHOD','name='+name,'static='+!!isStatic,'isCtor='+(name==='constructor'));`
			: '') +
		`if(name==='constructor'){if(cls.__setCtor)cls.__setCtor(fn);fn._ho=cls.prototype;cls.prototype.constructor=fn;}` +
		`else if(isStatic){fn._ho=cls;cls[name]=fn;}else{var _tgt=(cls.prototype||cls);fn._ho=_tgt;_tgt[name]=fn;}break;`
	)];
}

/** `{var fn=X();var cls=Y();fn._ho=cls;cls[C[O]]=fn;break;}` */
function DEFINE_STATIC_METHOD(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var fn=${ctx.X}();var cls=${ctx.Y}();fn._ho=cls;cls[${ctx.C}[${ctx.O}]]=fn;break;`
	)];
}

// --- Accessor definition ---

/**
 * DEFINE_GETTER: define a getter with home object stamping and `enumerable: false`.
 * Operand packs name constant index in low 16 bits and isStatic flag in bit 16.
 */
function DEFINE_GETTER(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var fn=${ctx.X}();var cls=${ctx.Y}();var name=${ctx.C}[${ctx.O}&0xFFFF];var isStatic=(${ctx.O}>>16)&1;` +
		`var target=isStatic?cls:(cls.prototype||cls);fn._ho=target;` +
		`Object.defineProperty(target,name,{get:fn,configurable:true,enumerable:false});break;`
	)];
}

/** `{var fn=X();var cls=Y();fn._ho=cls;Object.defineProperty(cls,C[O],{get:fn,configurable:true,enumerable:false});break;}` */
function DEFINE_STATIC_GETTER(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var fn=${ctx.X}();var cls=${ctx.Y}();fn._ho=cls;` +
		`Object.defineProperty(cls,${ctx.C}[${ctx.O}],{get:fn,configurable:true,enumerable:false});break;`
	)];
}

/**
 * DEFINE_SETTER: define a setter with home object stamping and `enumerable: false`.
 * Operand packs name constant index in low 16 bits and isStatic flag in bit 16.
 */
function DEFINE_SETTER(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var fn=${ctx.X}();var cls=${ctx.Y}();var name=${ctx.C}[${ctx.O}&0xFFFF];var isStatic=(${ctx.O}>>16)&1;` +
		`var target=isStatic?cls:(cls.prototype||cls);fn._ho=target;` +
		`Object.defineProperty(target,name,{set:fn,configurable:true,enumerable:false});break;`
	)];
}

/** `{var fn=X();var cls=Y();fn._ho=cls;Object.defineProperty(cls,C[O],{set:fn,configurable:true,enumerable:false});break;}` */
function DEFINE_STATIC_SETTER(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var fn=${ctx.X}();var cls=${ctx.Y}();fn._ho=cls;` +
		`Object.defineProperty(cls,${ctx.C}[${ctx.O}],{set:fn,configurable:true,enumerable:false});break;`
	)];
}

// --- Field definition ---

/** `{var val=X();var name=C[O];var obj=Y();obj[name]=val;break;}` */
function DEFINE_FIELD(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var val=${ctx.X}();var name=${ctx.C}[${ctx.O}];var obj=${ctx.Y}();obj[name]=val;break;`
	)];
}

/** `{var val=X();var cls=Y();cls[C[O]]=val;break;}` */
function DEFINE_STATIC_FIELD(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var val=${ctx.X}();var cls=${ctx.Y}();cls[${ctx.C}[${ctx.O}]]=val;break;`
	)];
}

// --- Private member definition ---

/** `{var fn=X();var cls=Y();(cls.prototype||cls)[C[O]]=fn;break;}` */
function DEFINE_PRIVATE_METHOD(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var fn=${ctx.X}();var cls=${ctx.Y}();(cls.prototype||cls)[${ctx.C}[${ctx.O}]]=fn;break;`
	)];
}

/** `{var fn=X();var cls=Y();Object.defineProperty(cls.prototype||cls,C[O],{get:fn,configurable:true});break;}` */
function DEFINE_PRIVATE_GETTER(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var fn=${ctx.X}();var cls=${ctx.Y}();Object.defineProperty(cls.prototype||cls,${ctx.C}[${ctx.O}],{get:fn,configurable:true});break;`
	)];
}

/** `{var fn=X();var cls=Y();Object.defineProperty(cls.prototype||cls,C[O],{set:fn,configurable:true});break;}` */
function DEFINE_PRIVATE_SETTER(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var fn=${ctx.X}();var cls=${ctx.Y}();Object.defineProperty(cls.prototype||cls,${ctx.C}[${ctx.O}],{set:fn,configurable:true});break;`
	)];
}

/** `{var val=X();var obj=Y();obj[C[O]]=val;break;}` */
function DEFINE_PRIVATE_FIELD(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var val=${ctx.X}();var obj=${ctx.Y}();obj[${ctx.C}[${ctx.O}]]=val;break;`
	)];
}

/** `{var val=X();var cls=Y();cls[C[O]]=val;break;}` */
function DEFINE_STATIC_PRIVATE_FIELD(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var val=${ctx.X}();var cls=${ctx.Y}();cls[${ctx.C}[${ctx.O}]]=val;break;`
	)];
}

/** `{var fn=X();var cls=Y();cls[C[O]]=fn;break;}` */
function DEFINE_STATIC_PRIVATE_METHOD(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var fn=${ctx.X}();var cls=${ctx.Y}();cls[${ctx.C}[${ctx.O}]]=fn;break;`
	)];
}

// --- Static block ---

/** `{var fn=X();var cls=Y();fn.call(cls);break;}` */
function CLASS_STATIC_BLOCK(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var fn=${ctx.X}();var cls=${ctx.Y}();fn.call(cls);break;`
	)];
}

// --- No-op class handlers ---

/** FINALIZE_CLASS: no-op, just break. */
function FINALIZE_CLASS(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

/** INIT_PRIVATE_ENV / ADD_PRIVATE_BRAND / CHECK_PRIVATE_BRAND: no-op stubs. */
function PRIVATE_ENV_NOP(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

// --- Registration ---

registry.set(Op.NEW_CLASS, NEW_CLASS);
registry.set(Op.NEW_DERIVED_CLASS, NEW_DERIVED_CLASS);
registry.set(Op.EXTEND_CLASS, EXTEND_CLASS);
registry.set(Op.DEFINE_METHOD, DEFINE_METHOD);
registry.set(Op.DEFINE_STATIC_METHOD, DEFINE_STATIC_METHOD);
registry.set(Op.DEFINE_GETTER, DEFINE_GETTER);
registry.set(Op.DEFINE_STATIC_GETTER, DEFINE_STATIC_GETTER);
registry.set(Op.DEFINE_SETTER, DEFINE_SETTER);
registry.set(Op.DEFINE_STATIC_SETTER, DEFINE_STATIC_SETTER);
registry.set(Op.DEFINE_FIELD, DEFINE_FIELD);
registry.set(Op.DEFINE_STATIC_FIELD, DEFINE_STATIC_FIELD);
registry.set(Op.DEFINE_PRIVATE_METHOD, DEFINE_PRIVATE_METHOD);
registry.set(Op.DEFINE_PRIVATE_GETTER, DEFINE_PRIVATE_GETTER);
registry.set(Op.DEFINE_PRIVATE_SETTER, DEFINE_PRIVATE_SETTER);
registry.set(Op.DEFINE_PRIVATE_FIELD, DEFINE_PRIVATE_FIELD);
registry.set(Op.DEFINE_STATIC_PRIVATE_FIELD, DEFINE_STATIC_PRIVATE_FIELD);
registry.set(Op.DEFINE_STATIC_PRIVATE_METHOD, DEFINE_STATIC_PRIVATE_METHOD);
registry.set(Op.CLASS_STATIC_BLOCK, CLASS_STATIC_BLOCK);
registry.set(Op.FINALIZE_CLASS, FINALIZE_CLASS);
registry.set(Op.INIT_PRIVATE_ENV, PRIVATE_ENV_NOP);
registry.set(Op.ADD_PRIVATE_BRAND, PRIVATE_ENV_NOP);
registry.set(Op.CHECK_PRIVATE_BRAND, PRIVATE_ENV_NOP);
