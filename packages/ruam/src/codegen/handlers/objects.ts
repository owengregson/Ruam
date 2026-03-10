/**
 * Object and array opcode handlers in raw node form.
 *
 * Covers 29 opcodes across four categories:
 *  - Property access:  GET_PROP_STATIC, SET_PROP_STATIC, GET_PROP_DYNAMIC,
 *                      SET_PROP_DYNAMIC, DELETE_PROP_STATIC, DELETE_PROP_DYNAMIC,
 *                      OPT_CHAIN_GET, OPT_CHAIN_DYNAMIC
 *  - Operators:        IN_OP, INSTANCEOF
 *  - Super:            GET_SUPER_PROP, SET_SUPER_PROP
 *  - Private fields:   GET_PRIVATE_FIELD, SET_PRIVATE_FIELD, HAS_PRIVATE_FIELD
 *  - Object defs:      DEFINE_OWN_PROPERTY, NEW_OBJECT, NEW_ARRAY, NEW_ARRAY_WITH_SIZE,
 *                      ARRAY_PUSH, ARRAY_HOLE, SPREAD_ARRAY, SPREAD_OBJECT,
 *                      COPY_DATA_PROPERTIES, SET_PROTO, FREEZE_OBJECT, SEAL_OBJECT,
 *                      DEFINE_PROPERTY_DESC, CREATE_TEMPLATE_OBJECT
 *
 * All handlers use raw() — property access chains, try/catch fallbacks, and
 * complex iteration patterns are most cleanly expressed as literal JS.
 *
 * @module codegen/handlers/objects
 */

import { Op } from "../../compiler/opcodes.js";
import { type JsNode, raw } from "../nodes.js";
import { registry, type HandlerCtx } from "./registry.js";

// --- Property access handlers ---

/** `S[P]=S[P][C[O]];break;` */
function GET_PROP_STATIC(ctx: HandlerCtx): JsNode[] {
	return [
		raw(`${ctx.S}[${ctx.P}]=${ctx.S}[${ctx.P}][${ctx.C}[${ctx.O}]];break;`),
	];
}

/**
 * SET_PROP_STATIC: pop value, set on object with try/catch fallback.
 *
 * ```
 * var val=S[P--];var obj=S[P];var k=C[O];
 * try{obj[k]=val;}catch(_){Object.defineProperty(obj,k,{value:val,writable:true,configurable:true});}
 * break;
 * ```
 */
function SET_PROP_STATIC(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var val=${ctx.S}[${ctx.P}--];var obj=${ctx.S}[${ctx.P}];var k=${ctx.C}[${ctx.O}];` +
				`try{obj[k]=val;}catch(_){Object.defineProperty(obj,k,{value:val,writable:true,configurable:true});}break;`
		),
	];
}

/** `{var key=S[P--];S[P]=S[P][key];break;}` */
function GET_PROP_DYNAMIC(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var key=${ctx.S}[${ctx.P}--];${ctx.S}[${ctx.P}]=${ctx.S}[${ctx.P}][key];break;`
		),
	];
}

/** `{var val=S[P--];var key=S[P--];var obj=S[P];obj[key]=val;break;}` */
function SET_PROP_DYNAMIC(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var val=${ctx.S}[${ctx.P}--];var key=${ctx.S}[${ctx.P}--];var obj=${ctx.S}[${ctx.P}];obj[key]=val;break;`
		),
	];
}

/** `S[P]=delete S[P][C[O]];break;` */
function DELETE_PROP_STATIC(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`${ctx.S}[${ctx.P}]=delete ${ctx.S}[${ctx.P}][${ctx.C}[${ctx.O}]];break;`
		),
	];
}

/** `{var key=S[P--];S[P]=delete S[P][key];break;}` */
function DELETE_PROP_DYNAMIC(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var key=${ctx.S}[${ctx.P}--];${ctx.S}[${ctx.P}]=delete ${ctx.S}[${ctx.P}][key];break;`
		),
	];
}

/** `{var key=C[O];var obj=S[P];S[P]=obj==null?void 0:obj[key];break;}` */
function OPT_CHAIN_GET(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var key=${ctx.C}[${ctx.O}];var obj=${ctx.S}[${ctx.P}];${ctx.S}[${ctx.P}]=obj==null?void 0:obj[key];break;`
		),
	];
}

/** `{var key=S[P--];var obj=S[P];S[P]=obj==null?void 0:obj[key];break;}` */
function OPT_CHAIN_DYNAMIC(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var key=${ctx.S}[${ctx.P}--];var obj=${ctx.S}[${ctx.P}];${ctx.S}[${ctx.P}]=obj==null?void 0:obj[key];break;`
		),
	];
}

// --- Operators ---

/** `{var obj=S[P--];S[P]=S[P] in obj;break;}` */
function IN_OP(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var obj=${ctx.S}[${ctx.P}--];${ctx.S}[${ctx.P}]=${ctx.S}[${ctx.P}] in obj;break;`
		),
	];
}

/** `{var ctor=S[P--];S[P]=S[P] instanceof ctor;break;}` */
function INSTANCEOF(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var ctor=${ctx.S}[${ctx.P}--];${ctx.S}[${ctx.P}]=${ctx.S}[${ctx.P}] instanceof ctor;break;`
		),
	];
}

// --- Super property access ---

/**
 * GET_SUPER_PROP: resolve super prototype, get property by constant or dynamic key.
 *
 * ```
 * var sp2=HO?Object.getPrototypeOf(HO):Object.getPrototypeOf(Object.getPrototypeOf(TV));
 * var key=O>=0?C[O]:X();
 * W(sp2?sp2[key]:void 0);break;
 * ```
 */
function GET_SUPER_PROP(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var sp2=${ctx.HO}?Object.getPrototypeOf(${ctx.HO}):Object.getPrototypeOf(Object.getPrototypeOf(${ctx.TV}));` +
				`var key=${ctx.O}>=0?${ctx.C}[${ctx.O}]:${ctx.X}();` +
				`${ctx.W}(sp2?sp2[key]:void 0);break;`
		),
	];
}

/**
 * SET_SUPER_PROP: resolve super prototype, set property value.
 *
 * ```
 * var val=X();
 * var sp2=HO?Object.getPrototypeOf(HO):Object.getPrototypeOf(Object.getPrototypeOf(TV));
 * var key=O>=0?C[O]:X();
 * if(sp2)sp2[key]=val;W(val);break;
 * ```
 */
function SET_SUPER_PROP(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var val=${ctx.X}();` +
				`var sp2=${ctx.HO}?Object.getPrototypeOf(${ctx.HO}):Object.getPrototypeOf(Object.getPrototypeOf(${ctx.TV}));` +
				`var key=${ctx.O}>=0?${ctx.C}[${ctx.O}]:${ctx.X}();` +
				`if(sp2)sp2[key]=val;${ctx.W}(val);break;`
		),
	];
}

// --- Private field access ---

/** `{var obj=X();var name=C[O];W(obj[name]);break;}` */
function GET_PRIVATE_FIELD(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var obj=${ctx.X}();var name=${ctx.C}[${ctx.O}];${ctx.W}(obj[name]);break;`
		),
	];
}

/** `{var val=X();var obj=X();var name=C[O];obj[name]=val;W(val);break;}` */
function SET_PRIVATE_FIELD(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var val=${ctx.X}();var obj=${ctx.X}();var name=${ctx.C}[${ctx.O}];obj[name]=val;${ctx.W}(val);break;`
		),
	];
}

/** `{var obj=X();var name=C[O];W(name in obj);break;}` */
function HAS_PRIVATE_FIELD(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var obj=${ctx.X}();var name=${ctx.C}[${ctx.O}];${ctx.W}(name in obj);break;`
		),
	];
}

// --- Object/array construction ---

/** `{var desc=X();var key=X();var obj=X();Object.defineProperty(obj,key,desc);W(obj);break;}` */
function DEFINE_OWN_PROPERTY(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var desc=${ctx.X}();var key=${ctx.X}();var obj=${ctx.X}();Object.defineProperty(obj,key,desc);${ctx.W}(obj);break;`
		),
	];
}

/** `W({});break;` */
function NEW_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [raw(`${ctx.W}({});break;`)];
}

/** `W([]);break;` */
function NEW_ARRAY(ctx: HandlerCtx): JsNode[] {
	return [raw(`${ctx.W}([]);break;`)];
}

/** `W(new Array(O));break;` */
function NEW_ARRAY_WITH_SIZE(ctx: HandlerCtx): JsNode[] {
	return [raw(`${ctx.W}(new Array(${ctx.O}));break;`)];
}

/** `{var val=X();var arr=Y();arr.push(val);break;}` */
function ARRAY_PUSH(ctx: HandlerCtx): JsNode[] {
	return [raw(`var val=${ctx.X}();var arr=${ctx.Y}();arr.push(val);break;`)];
}

/** `{var arr=Y();arr.length++;break;}` */
function ARRAY_HOLE(ctx: HandlerCtx): JsNode[] {
	return [raw(`var arr=${ctx.Y}();arr.length++;break;`)];
}

/**
 * SPREAD_ARRAY: spread source into target array or object.
 *
 * ```
 * var src=X();var target=Y();
 * if(Array.isArray(target)){var items=Array.from(src);for(var si=0;si<items.length;si++)target.push(items[si]);}
 * else{Object.assign(target,src);}
 * break;
 * ```
 */
function SPREAD_ARRAY(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var src=${ctx.X}();var target=${ctx.Y}();` +
				`if(Array.isArray(target)){var items=Array.from(src);for(var si=0;si<items.length;si++)target.push(items[si]);}` +
				`else{Object.assign(target,src);}break;`
		),
	];
}

/** `{var src=X();var target=Y();Object.assign(target,src);break;}` */
function SPREAD_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var src=${ctx.X}();var target=${ctx.Y}();Object.assign(target,src);break;`
		),
	];
}

/**
 * COPY_DATA_PROPERTIES: copy own keys from source to target, excluding given keys.
 *
 * ```
 * var excludeKeys=X();var src=X();var target=Y();
 * var keys=Object.keys(src);
 * for(var ki=0;ki<keys.length;ki++){if(!excludeKeys||excludeKeys.indexOf(keys[ki])<0)target[keys[ki]]=src[keys[ki]];}
 * break;
 * ```
 */
function COPY_DATA_PROPERTIES(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var excludeKeys=${ctx.X}();var src=${ctx.X}();var target=${ctx.Y}();` +
				`var keys=Object.keys(src);` +
				`for(var ki=0;ki<keys.length;ki++){if(!excludeKeys||excludeKeys.indexOf(keys[ki])<0)target[keys[ki]]=src[keys[ki]];}break;`
		),
	];
}

/** `{var proto=X();var obj=X();Object.setPrototypeOf(obj,proto);W(obj);break;}` */
function SET_PROTO(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var proto=${ctx.X}();var obj=${ctx.X}();Object.setPrototypeOf(obj,proto);${ctx.W}(obj);break;`
		),
	];
}

/** `{Object.freeze(Y());break;}` */
function FREEZE_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [raw(`Object.freeze(${ctx.Y}());break;`)];
}

/** `{Object.seal(Y());break;}` */
function SEAL_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [raw(`Object.seal(${ctx.Y}());break;`)];
}

/** `{var desc=X();var key=X();var obj=Y();Object.defineProperty(obj,key,desc);break;}` */
function DEFINE_PROPERTY_DESC(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var desc=${ctx.X}();var key=${ctx.X}();var obj=${ctx.Y}();Object.defineProperty(obj,key,desc);break;`
		),
	];
}

/**
 * CREATE_TEMPLATE_OBJECT: build frozen tagged template object with raw property.
 *
 * ```
 * var raw=X();var cooked=X();
 * Object.defineProperty(cooked,'raw',{value:Object.freeze(raw)});
 * Object.freeze(cooked);W(cooked);break;
 * ```
 */
function CREATE_TEMPLATE_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var raw=${ctx.X}();var cooked=${ctx.X}();` +
				`Object.defineProperty(cooked,'raw',{value:Object.freeze(raw)});` +
				`Object.freeze(cooked);${ctx.W}(cooked);break;`
		),
	];
}

// --- Registration ---

registry.set(Op.GET_PROP_STATIC, GET_PROP_STATIC);
registry.set(Op.SET_PROP_STATIC, SET_PROP_STATIC);
registry.set(Op.GET_PROP_DYNAMIC, GET_PROP_DYNAMIC);
registry.set(Op.SET_PROP_DYNAMIC, SET_PROP_DYNAMIC);
registry.set(Op.DELETE_PROP_STATIC, DELETE_PROP_STATIC);
registry.set(Op.DELETE_PROP_DYNAMIC, DELETE_PROP_DYNAMIC);
registry.set(Op.OPT_CHAIN_GET, OPT_CHAIN_GET);
registry.set(Op.OPT_CHAIN_DYNAMIC, OPT_CHAIN_DYNAMIC);
registry.set(Op.IN_OP, IN_OP);
registry.set(Op.INSTANCEOF, INSTANCEOF);
registry.set(Op.GET_SUPER_PROP, GET_SUPER_PROP);
registry.set(Op.SET_SUPER_PROP, SET_SUPER_PROP);
registry.set(Op.GET_PRIVATE_FIELD, GET_PRIVATE_FIELD);
registry.set(Op.SET_PRIVATE_FIELD, SET_PRIVATE_FIELD);
registry.set(Op.HAS_PRIVATE_FIELD, HAS_PRIVATE_FIELD);
registry.set(Op.DEFINE_OWN_PROPERTY, DEFINE_OWN_PROPERTY);
registry.set(Op.NEW_OBJECT, NEW_OBJECT);
registry.set(Op.NEW_ARRAY, NEW_ARRAY);
registry.set(Op.NEW_ARRAY_WITH_SIZE, NEW_ARRAY_WITH_SIZE);
registry.set(Op.ARRAY_PUSH, ARRAY_PUSH);
registry.set(Op.ARRAY_HOLE, ARRAY_HOLE);
registry.set(Op.SPREAD_ARRAY, SPREAD_ARRAY);
registry.set(Op.SPREAD_OBJECT, SPREAD_OBJECT);
registry.set(Op.COPY_DATA_PROPERTIES, COPY_DATA_PROPERTIES);
registry.set(Op.SET_PROTO, SET_PROTO);
registry.set(Op.FREEZE_OBJECT, FREEZE_OBJECT);
registry.set(Op.SEAL_OBJECT, SEAL_OBJECT);
registry.set(Op.DEFINE_PROPERTY_DESC, DEFINE_PROPERTY_DESC);
registry.set(Op.CREATE_TEMPLATE_OBJECT, CREATE_TEMPLATE_OBJECT);
