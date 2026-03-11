/**
 * Class definition opcode handlers using pure AST nodes.
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
 * All handlers use pure AST nodes — no raw() escape hatch.
 *
 * @module ruamvm/handlers/classes
 */

import { Op } from "../../compiler/opcodes.js";
import {
	type JsNode,
	id,
	lit,
	bin,
	un,
	assign,
	call,
	member,
	index,
	varDecl,
	exprStmt,
	ifStmt,
	returnStmt,
	fnExpr,
	ternary,
	breakStmt,
	obj,
} from "../nodes.js";
import { registry, type HandlerCtx } from "./registry.js";
import { debugTrace } from "./helpers.js";

// --- Helpers ---

/**
 * Build the IIFE-wrapped class constructor pattern.
 *
 * Creates a constructor proxy via an immediately-invoked function expression
 * to isolate `var _ctor` and prevent var-hoisting from sharing across classes.
 *
 * ```js
 * (function(){
 *   var c=null;
 *   var f=function(){if(c)return c.apply(this,arguments);};
 *   f.__setCtor=function(x){c=x;};
 *   return f;
 * })()
 * ```
 *
 * @returns JsNode — IIFE call expression producing the constructor proxy
 */
function buildCtorIIFE(): JsNode {
	return call(
		fnExpr(
			undefined,
			[],
			[
				varDecl("c", lit(null)),
				varDecl(
					"f",
					fnExpr(
						undefined,
						[],
						[
							ifStmt(id("c"), [
								returnStmt(
									call(member(id("c"), "apply"), [
										id("this"),
										id("arguments"),
									])
								),
							]),
						]
					)
				),
				exprStmt(
					assign(
						member(id("f"), "__setCtor"),
						fnExpr(
							undefined,
							["x"],
							[exprStmt(assign(id("c"), id("x")))]
						)
					)
				),
				returnStmt(id("f")),
			]
		),
		[]
	);
}

/**
 * Build prototype chain setup nodes for class inheritance.
 *
 * ```js
 * cls.prototype = Object.create(SuperClass.prototype);
 * cls.prototype.constructor = cls;
 * Object.setPrototypeOf(cls, SuperClass);
 * ```
 *
 * @param clsName - Local variable name for the class
 * @param superName - Local variable name for the superclass
 * @returns JsNode[] — prototype chain setup statements
 */
function buildPrototypeChain(clsName: string, superName: string): JsNode[] {
	return [
		exprStmt(
			assign(
				member(id(clsName), "prototype"),
				call(member(id("Object"), "create"), [
					member(id(superName), "prototype"),
				])
			)
		),
		exprStmt(
			assign(
				member(member(id(clsName), "prototype"), "constructor"),
				id(clsName)
			)
		),
		exprStmt(
			call(member(id("Object"), "setPrototypeOf"), [
				id(clsName),
				id(superName),
			])
		),
	];
}

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
	return [
		varDecl("hasSuperClass", id(ctx.O)),
		varDecl(
			"SuperClass",
			ternary(id("hasSuperClass"), ctx.pop(), lit(null))
		),
		...debugTrace(
			ctx,
			"NEW_CLASS",
			bin("+", lit("hasSuper="), un("!", un("!", id("hasSuperClass"))))
		),
		varDecl("cls", buildCtorIIFE()),
		ifStmt(id("SuperClass"), buildPrototypeChain("cls", "SuperClass")),
		exprStmt(ctx.push(id("cls"))),
		breakStmt(),
	];
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
	return [
		varDecl("SuperClass", ctx.pop()),
		...debugTrace(ctx, "NEW_DERIVED_CLASS"),
		varDecl("cls", buildCtorIIFE()),
		...buildPrototypeChain("cls", "SuperClass"),
		exprStmt(ctx.push(id("cls"))),
		breakStmt(),
	];
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
	return [
		varDecl("superCls", ctx.pop()),
		varDecl("cls", ctx.peek()),
		...buildPrototypeChain("cls", "superCls"),
		breakStmt(),
	];
}

// --- Method definition ---

/**
 * DEFINE_METHOD: define an instance or static method with home object stamping.
 * Operand packs name constant index in low 16 bits and isStatic flag in bit 16.
 * Constructor detection routes through `__setCtor` for IIFE-wrapped class constructors.
 * Includes debug trace when debug mode is enabled.
 */
function DEFINE_METHOD(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("fn", ctx.pop()),
		varDecl("cls", ctx.peek()),
		varDecl("name", index(id(ctx.C), bin("&", id(ctx.O), lit(0xffff)))),
		varDecl("isStatic", bin("&", bin(">>", id(ctx.O), lit(16)), lit(1))),
		...debugTrace(
			ctx,
			"DEFINE_METHOD",
			bin("+", lit("name="), id("name")),
			bin("+", lit("static="), un("!", un("!", id("isStatic")))),
			bin("+", lit("isCtor="), bin("===", id("name"), lit("constructor")))
		),
		ifStmt(
			bin("===", id("name"), lit("constructor")),
			[
				ifStmt(member(id("cls"), "__setCtor"), [
					exprStmt(call(member(id("cls"), "__setCtor"), [id("fn")])),
				]),
				exprStmt(
					assign(
						member(id("fn"), ctx.t("_ho")),
						member(id("cls"), "prototype")
					)
				),
				exprStmt(
					assign(
						member(member(id("cls"), "prototype"), "constructor"),
						id("fn")
					)
				),
			],
			[
				ifStmt(
					id("isStatic"),
					[
						exprStmt(assign(member(id("fn"), ctx.t("_ho")), id("cls"))),
						exprStmt(
							assign(index(id("cls"), id("name")), id("fn"))
						),
					],
					[
						varDecl(
							ctx.t("_tgt"),
							bin("||", member(id("cls"), "prototype"), id("cls"))
						),
						exprStmt(assign(member(id("fn"), ctx.t("_ho")), id(ctx.t("_tgt")))),
						exprStmt(
							assign(index(id(ctx.t("_tgt")), id("name")), id("fn"))
						),
					]
				),
			]
		),
		breakStmt(),
	];
}

/** `{var fn=X();var cls=Y();fn._ho=cls;cls[C[O]]=fn;break;}` */
function DEFINE_STATIC_METHOD(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("fn", ctx.pop()),
		varDecl("cls", ctx.peek()),
		exprStmt(assign(member(id("fn"), ctx.t("_ho")), id("cls"))),
		exprStmt(
			assign(index(id("cls"), index(id(ctx.C), id(ctx.O))), id("fn"))
		),
		breakStmt(),
	];
}

// --- Accessor definition ---

/**
 * DEFINE_GETTER: define a getter with home object stamping and `enumerable: false`.
 * Operand packs name constant index in low 16 bits and isStatic flag in bit 16.
 */
function DEFINE_GETTER(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("fn", ctx.pop()),
		varDecl("cls", ctx.peek()),
		varDecl("name", index(id(ctx.C), bin("&", id(ctx.O), lit(0xffff)))),
		varDecl("isStatic", bin("&", bin(">>", id(ctx.O), lit(16)), lit(1))),
		varDecl(
			"target",
			ternary(
				id("isStatic"),
				id("cls"),
				bin("||", member(id("cls"), "prototype"), id("cls"))
			)
		),
		exprStmt(assign(member(id("fn"), ctx.t("_ho")), id("target"))),
		exprStmt(
			call(member(id("Object"), "defineProperty"), [
				id("target"),
				id("name"),
				obj(
					["get", id("fn")],
					["configurable", lit(true)],
					["enumerable", lit(false)]
				),
			])
		),
		breakStmt(),
	];
}

/** `{var fn=X();var cls=Y();fn._ho=cls;Object.defineProperty(cls,C[O],{get:fn,configurable:true,enumerable:false});break;}` */
function DEFINE_STATIC_GETTER(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("fn", ctx.pop()),
		varDecl("cls", ctx.peek()),
		exprStmt(assign(member(id("fn"), ctx.t("_ho")), id("cls"))),
		exprStmt(
			call(member(id("Object"), "defineProperty"), [
				id("cls"),
				index(id(ctx.C), id(ctx.O)),
				obj(
					["get", id("fn")],
					["configurable", lit(true)],
					["enumerable", lit(false)]
				),
			])
		),
		breakStmt(),
	];
}

/**
 * DEFINE_SETTER: define a setter with home object stamping and `enumerable: false`.
 * Operand packs name constant index in low 16 bits and isStatic flag in bit 16.
 */
function DEFINE_SETTER(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("fn", ctx.pop()),
		varDecl("cls", ctx.peek()),
		varDecl("name", index(id(ctx.C), bin("&", id(ctx.O), lit(0xffff)))),
		varDecl("isStatic", bin("&", bin(">>", id(ctx.O), lit(16)), lit(1))),
		varDecl(
			"target",
			ternary(
				id("isStatic"),
				id("cls"),
				bin("||", member(id("cls"), "prototype"), id("cls"))
			)
		),
		exprStmt(assign(member(id("fn"), ctx.t("_ho")), id("target"))),
		exprStmt(
			call(member(id("Object"), "defineProperty"), [
				id("target"),
				id("name"),
				obj(
					["set", id("fn")],
					["configurable", lit(true)],
					["enumerable", lit(false)]
				),
			])
		),
		breakStmt(),
	];
}

/** `{var fn=X();var cls=Y();fn._ho=cls;Object.defineProperty(cls,C[O],{set:fn,configurable:true,enumerable:false});break;}` */
function DEFINE_STATIC_SETTER(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("fn", ctx.pop()),
		varDecl("cls", ctx.peek()),
		exprStmt(assign(member(id("fn"), ctx.t("_ho")), id("cls"))),
		exprStmt(
			call(member(id("Object"), "defineProperty"), [
				id("cls"),
				index(id(ctx.C), id(ctx.O)),
				obj(
					["set", id("fn")],
					["configurable", lit(true)],
					["enumerable", lit(false)]
				),
			])
		),
		breakStmt(),
	];
}

// --- Field definition ---

/** `{var val=X();var name=C[O];var obj=Y();obj[name]=val;break;}` */
function DEFINE_FIELD(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("val", ctx.pop()),
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		varDecl("obj", ctx.peek()),
		exprStmt(assign(index(id("obj"), id("name")), id("val"))),
		breakStmt(),
	];
}

/** `{var val=X();var cls=Y();cls[C[O]]=val;break;}` */
function DEFINE_STATIC_FIELD(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("val", ctx.pop()),
		varDecl("cls", ctx.peek()),
		exprStmt(
			assign(index(id("cls"), index(id(ctx.C), id(ctx.O))), id("val"))
		),
		breakStmt(),
	];
}

// --- Private member definition ---

/** `{var fn=X();var cls=Y();var _tgt=(cls.prototype||cls);_tgt[C[O]]=fn;break;}` */
function DEFINE_PRIVATE_METHOD(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("fn", ctx.pop()),
		varDecl("cls", ctx.peek()),
		varDecl(ctx.t("_tgt"), bin("||", member(id("cls"), "prototype"), id("cls"))),
		exprStmt(
			assign(index(id(ctx.t("_tgt")), index(id(ctx.C), id(ctx.O))), id("fn"))
		),
		breakStmt(),
	];
}

/** `{var fn=X();var cls=Y();Object.defineProperty(cls.prototype||cls,C[O],{get:fn,configurable:true});break;}` */
function DEFINE_PRIVATE_GETTER(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("fn", ctx.pop()),
		varDecl("cls", ctx.peek()),
		exprStmt(
			call(member(id("Object"), "defineProperty"), [
				bin("||", member(id("cls"), "prototype"), id("cls")),
				index(id(ctx.C), id(ctx.O)),
				obj(["get", id("fn")], ["configurable", lit(true)]),
			])
		),
		breakStmt(),
	];
}

/** `{var fn=X();var cls=Y();Object.defineProperty(cls.prototype||cls,C[O],{set:fn,configurable:true});break;}` */
function DEFINE_PRIVATE_SETTER(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("fn", ctx.pop()),
		varDecl("cls", ctx.peek()),
		exprStmt(
			call(member(id("Object"), "defineProperty"), [
				bin("||", member(id("cls"), "prototype"), id("cls")),
				index(id(ctx.C), id(ctx.O)),
				obj(["set", id("fn")], ["configurable", lit(true)]),
			])
		),
		breakStmt(),
	];
}

/** `{var val=X();var obj=Y();obj[C[O]]=val;break;}` */
function DEFINE_PRIVATE_FIELD(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("val", ctx.pop()),
		varDecl("obj", ctx.peek()),
		exprStmt(
			assign(index(id("obj"), index(id(ctx.C), id(ctx.O))), id("val"))
		),
		breakStmt(),
	];
}

/** `{var val=X();var cls=Y();cls[C[O]]=val;break;}` */
function DEFINE_STATIC_PRIVATE_FIELD(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("val", ctx.pop()),
		varDecl("cls", ctx.peek()),
		exprStmt(
			assign(index(id("cls"), index(id(ctx.C), id(ctx.O))), id("val"))
		),
		breakStmt(),
	];
}

/** `{var fn=X();var cls=Y();cls[C[O]]=fn;break;}` */
function DEFINE_STATIC_PRIVATE_METHOD(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("fn", ctx.pop()),
		varDecl("cls", ctx.peek()),
		exprStmt(
			assign(index(id("cls"), index(id(ctx.C), id(ctx.O))), id("fn"))
		),
		breakStmt(),
	];
}

// --- Static block ---

/** `{var fn=X();var cls=Y();fn.call(cls);break;}` */
function CLASS_STATIC_BLOCK(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("fn", ctx.pop()),
		varDecl("cls", ctx.peek()),
		exprStmt(call(member(id("fn"), "call"), [id("cls")])),
		breakStmt(),
	];
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
