/**
 * Object and array opcode handlers using pure AST nodes.
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
 * @module ruamvm/handlers/objects
 */

import { Op } from "../../compiler/opcodes.js";
import { type JsNode, id, lit, bin, un, assign, call, member, index, varDecl, exprStmt, ifStmt, forStmt, tryCatch, breakStmt, obj, arr, newExpr, ternary, update, BOp, UOp, UpOp } from "../nodes.js";
import { registry, type HandlerCtx } from "./registry.js";
import { superProto, superKey } from "./helpers.js";

// --- Property access handlers ---

/** `S[P]=S[P][C[O]];break;` */
function GET_PROP_STATIC(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(
			assign(ctx.peek(), index(ctx.peek(), index(id(ctx.C), id(ctx.O))))
		),
		breakStmt(),
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
		varDecl("val", ctx.pop()),
		varDecl("obj", ctx.peek()),
		varDecl("k", index(id(ctx.C), id(ctx.O))),
		tryCatch(
			[exprStmt(assign(index(id("obj"), id("k")), id("val")))],
			"_",
			[
				exprStmt(
					call(member(id("Object"), "defineProperty"), [
						id("obj"),
						id("k"),
						obj(
							["value", id("val")],
							["writable", lit(true)],
							["configurable", lit(true)]
						),
					])
				),
			]
		),
		breakStmt(),
	];
}

/** `{var key=S[P--];S[P]=S[P][key];break;}` */
function GET_PROP_DYNAMIC(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("key", ctx.pop()),
		exprStmt(assign(ctx.peek(), index(ctx.peek(), id("key")))),
		breakStmt(),
	];
}

/** `{var val=S[P--];var key=S[P--];var obj=S[P];obj[key]=val;break;}` */
function SET_PROP_DYNAMIC(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("val", ctx.pop()),
		varDecl("key", ctx.pop()),
		varDecl("obj", ctx.peek()),
		exprStmt(assign(index(id("obj"), id("key")), id("val"))),
		breakStmt(),
	];
}

/** `S[P]=delete S[P][C[O]];break;` */
function DELETE_PROP_STATIC(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(
			assign(
				ctx.peek(),
				un(UOp.Delete, index(ctx.peek(), index(id(ctx.C), id(ctx.O))))
			)
		),
		breakStmt(),
	];
}

/** `{var key=S[P--];S[P]=delete S[P][key];break;}` */
function DELETE_PROP_DYNAMIC(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("key", ctx.pop()),
		exprStmt(
			assign(ctx.peek(), un(UOp.Delete, index(ctx.peek(), id("key"))))
		),
		breakStmt(),
	];
}

/** `{var key=C[O];var obj=S[P];S[P]=obj==null?void 0:obj[key];break;}` */
function OPT_CHAIN_GET(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("key", index(id(ctx.C), id(ctx.O))),
		varDecl("obj", ctx.peek()),
		exprStmt(
			assign(
				ctx.peek(),
				ternary(
					bin(BOp.Eq, id("obj"), lit(null)),
					un(UOp.Void, lit(0)),
					index(id("obj"), id("key"))
				)
			)
		),
		breakStmt(),
	];
}

/** `{var key=S[P--];var obj=S[P];S[P]=obj==null?void 0:obj[key];break;}` */
function OPT_CHAIN_DYNAMIC(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("key", ctx.pop()),
		varDecl("obj", ctx.peek()),
		exprStmt(
			assign(
				ctx.peek(),
				ternary(
					bin(BOp.Eq, id("obj"), lit(null)),
					un(UOp.Void, lit(0)),
					index(id("obj"), id("key"))
				)
			)
		),
		breakStmt(),
	];
}

// --- Operators ---

/** `{var obj=S[P--];S[P]=S[P] in obj;break;}` */
function IN_OP(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("obj", ctx.pop()),
		exprStmt(assign(ctx.peek(), bin(BOp.In, ctx.peek(), id("obj")))),
		breakStmt(),
	];
}

/** `{var ctor=S[P--];S[P]=S[P] instanceof ctor;break;}` */
function INSTANCEOF(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("ctor", ctx.pop()),
		exprStmt(assign(ctx.peek(), bin(BOp.Instanceof, ctx.peek(), id("ctor")))),
		breakStmt(),
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
		varDecl("sp2", superProto(ctx)),
		varDecl("key", superKey(ctx)),
		exprStmt(
			ctx.push(
				ternary(
					id("sp2"),
					index(id("sp2"), id("key")),
					un(UOp.Void, lit(0))
				)
			)
		),
		breakStmt(),
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
		varDecl("val", ctx.pop()),
		varDecl("sp2", superProto(ctx)),
		varDecl("key", superKey(ctx)),
		ifStmt(id("sp2"), [
			exprStmt(assign(index(id("sp2"), id("key")), id("val"))),
		]),
		exprStmt(ctx.push(id("val"))),
		breakStmt(),
	];
}

// --- Private field access ---

/** `{var obj=X();var name=C[O];W(obj[name]);break;}` */
function GET_PRIVATE_FIELD(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("obj", ctx.pop()),
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		exprStmt(ctx.push(index(id("obj"), id("name")))),
		breakStmt(),
	];
}

/** `{var val=X();var obj=X();var name=C[O];obj[name]=val;W(val);break;}` */
function SET_PRIVATE_FIELD(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("val", ctx.pop()),
		varDecl("obj", ctx.pop()),
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		exprStmt(assign(index(id("obj"), id("name")), id("val"))),
		exprStmt(ctx.push(id("val"))),
		breakStmt(),
	];
}

/** `{var obj=X();var name=C[O];W(name in obj);break;}` */
function HAS_PRIVATE_FIELD(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("obj", ctx.pop()),
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		exprStmt(ctx.push(bin(BOp.In, id("name"), id("obj")))),
		breakStmt(),
	];
}

// --- Object/array construction ---

/** `{var desc=X();var key=X();var obj=X();Object.defineProperty(obj,key,desc);W(obj);break;}` */
function DEFINE_OWN_PROPERTY(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("desc", ctx.pop()),
		varDecl("key", ctx.pop()),
		varDecl("obj", ctx.pop()),
		exprStmt(
			call(member(id("Object"), "defineProperty"), [
				id("obj"),
				id("key"),
				id("desc"),
			])
		),
		exprStmt(ctx.push(id("obj"))),
		breakStmt(),
	];
}

/** `W({});break;` */
function NEW_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(obj())), breakStmt()];
}

/** `W([]);break;` */
function NEW_ARRAY(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(arr())), breakStmt()];
}

/** `W(new Array(O));break;` */
function NEW_ARRAY_WITH_SIZE(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(newExpr(id("Array"), [id(ctx.O)]))), breakStmt()];
}

/** `{var val=X();var arr=Y();arr.push(val);break;}` */
function ARRAY_PUSH(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("val", ctx.pop()),
		varDecl("arr", ctx.peek()),
		exprStmt(call(member(id("arr"), "push"), [id("val")])),
		breakStmt(),
	];
}

/** `{var arr=Y();arr.length++;break;}` */
function ARRAY_HOLE(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("arr", ctx.peek()),
		exprStmt(update(UpOp.Inc, false, member(id("arr"), "length"))),
		breakStmt(),
	];
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
		varDecl("src", ctx.pop()),
		varDecl("target", ctx.peek()),
		ifStmt(
			call(member(id("Array"), "isArray"), [id("target")]),
			[
				varDecl(
					"items",
					call(member(id("Array"), "from"), [id("src")])
				),
				forStmt(
					varDecl("si", lit(0)),
					bin(BOp.Lt, id("si"), member(id("items"), "length")),
					update(UpOp.Inc, false, id("si")),
					[
						exprStmt(
							call(member(id("target"), "push"), [
								index(id("items"), id("si")),
							])
						),
					]
				),
			],
			[
				exprStmt(
					call(member(id("Object"), "assign"), [
						id("target"),
						id("src"),
					])
				),
			]
		),
		breakStmt(),
	];
}

/** `{var src=X();var target=Y();Object.assign(target,src);break;}` */
function SPREAD_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("src", ctx.pop()),
		varDecl("target", ctx.peek()),
		exprStmt(
			call(member(id("Object"), "assign"), [id("target"), id("src")])
		),
		breakStmt(),
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
		varDecl("excludeKeys", ctx.pop()),
		varDecl("src", ctx.pop()),
		varDecl("target", ctx.peek()),
		// Build exclude set as plain object for O(1) lookup
		varDecl("_ex", obj()),
		ifStmt(id("excludeKeys"), [
			forStmt(
				varDecl("_ei", lit(0)),
				bin(BOp.Lt, id("_ei"), member(id("excludeKeys"), "length")),
				update(UpOp.Inc, false, id("_ei")),
				[
					exprStmt(
						assign(
							index(
								id("_ex"),
								index(id("excludeKeys"), id("_ei"))
							),
							lit(1)
						)
					),
				]
			),
		]),
		varDecl("keys", call(member(id("Object"), "keys"), [id("src")])),
		forStmt(
			varDecl("ki", lit(0)),
			bin(BOp.Lt, id("ki"), member(id("keys"), "length")),
			update(UpOp.Inc, false, id("ki")),
			[
				ifStmt(un(UOp.Not, index(id("_ex"), index(id("keys"), id("ki")))), [
					exprStmt(
						assign(
							index(id("target"), index(id("keys"), id("ki"))),
							index(id("src"), index(id("keys"), id("ki")))
						)
					),
				]),
			]
		),
		breakStmt(),
	];
}

/** `{var proto=X();var obj=X();Object.setPrototypeOf(obj,proto);W(obj);break;}` */
function SET_PROTO(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("proto", ctx.pop()),
		varDecl("obj", ctx.pop()),
		exprStmt(
			call(member(id("Object"), "setPrototypeOf"), [
				id("obj"),
				id("proto"),
			])
		),
		exprStmt(ctx.push(id("obj"))),
		breakStmt(),
	];
}

/** `{Object.freeze(Y());break;}` */
function FREEZE_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(call(member(id("Object"), "freeze"), [ctx.peek()])),
		breakStmt(),
	];
}

/** `{Object.seal(Y());break;}` */
function SEAL_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(call(member(id("Object"), "seal"), [ctx.peek()])),
		breakStmt(),
	];
}

/** `{var desc=X();var key=X();var obj=Y();Object.defineProperty(obj,key,desc);break;}` */
function DEFINE_PROPERTY_DESC(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("desc", ctx.pop()),
		varDecl("key", ctx.pop()),
		varDecl("obj", ctx.peek()),
		exprStmt(
			call(member(id("Object"), "defineProperty"), [
				id("obj"),
				id("key"),
				id("desc"),
			])
		),
		breakStmt(),
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
		varDecl("raw", ctx.pop()),
		varDecl("cooked", ctx.pop()),
		exprStmt(
			call(member(id("Object"), "defineProperty"), [
				id("cooked"),
				lit("raw"),
				obj([
					"value",
					call(member(id("Object"), "freeze"), [id("raw")]),
				]),
			])
		),
		exprStmt(call(member(id("Object"), "freeze"), [id("cooked")])),
		exprStmt(ctx.push(id("cooked"))),
		breakStmt(),
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
