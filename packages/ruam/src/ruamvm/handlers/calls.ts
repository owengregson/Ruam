/**
 * Call opcode handlers using pure AST nodes.
 *
 * Covers 14 opcodes:
 *  - Basic calls:    CALL, CALL_METHOD, CALL_NEW, SUPER_CALL
 *  - Spread:         SPREAD_ARGS
 *  - Optional:       CALL_OPTIONAL, CALL_METHOD_OPTIONAL
 *  - Eval:           DIRECT_EVAL
 *  - Templates:      CALL_TAGGED_TEMPLATE
 *  - Super methods:  CALL_SUPER_METHOD
 *  - Fast-path:      CALL_0, CALL_1, CALL_2, CALL_3
 *
 * All handlers use pure AST nodes — no raw() escape hatch.
 *
 * @module ruamvm/handlers/calls
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
	forStmt,
	breakStmt,
	newExpr,
	ternary,
	update,
	arr,
	obj,
	spread,
} from "../nodes.js";
import { registry, type HandlerCtx } from "./registry.js";
import { debugTrace, superProto } from "./helpers.js";

// --- Helpers ---

/**
 * Build the common spread-flattening preamble for call handlers as AST nodes.
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
function spreadPreamble(ctx: HandlerCtx): JsNode[] {
	return [
		// var argc=O;var hasSpread=argc<0;
		varDecl("argc", id(ctx.O)),
		varDecl("hasSpread", bin("<", id("argc"), lit(0))),
		// if(hasSpread)argc=-argc;
		ifStmt(id("hasSpread"), [
			exprStmt(assign(id("argc"), un("-", id("argc")))),
		]),
		// var callArgs=new Array(argc);
		varDecl("callArgs", newExpr(id("Array"), [id("argc")])),
		// for(var ai=argc-1;ai>=0;ai--)callArgs[ai]=S[P--];
		forStmt(
			varDecl("ai", bin("-", id("argc"), lit(1))),
			bin(">=", id("ai"), lit(0)),
			update("--", false, id("ai")),
			[exprStmt(assign(index(id("callArgs"), id("ai")), ctx.pop()))]
		),
		// if(hasSpread){...flatten spread markers...}
		ifStmt(id("hasSpread"), [
			varDecl("flat", arr()),
			forStmt(
				varDecl("ai", lit(0)),
				bin("<", id("ai"), member(id("callArgs"), "length")),
				update("++", false, id("ai")),
				[
					ifStmt(
						bin(
							"&&",
							index(id("callArgs"), id("ai")),
							member(
								index(id("callArgs"), id("ai")),
								"__spread__"
							)
						),
						[
							forStmt(
								varDecl("si", lit(0)),
								bin(
									"<",
									id("si"),
									member(
										member(
											index(id("callArgs"), id("ai")),
											"items"
										),
										"length"
									)
								),
								update("++", false, id("si")),
								[
									exprStmt(
										call(member(id("flat"), "push"), [
											index(
												member(
													index(
														id("callArgs"),
														id("ai")
													),
													"items"
												),
												id("si")
											),
										])
									),
								]
							),
						],
						[
							exprStmt(
								call(member(id("flat"), "push"), [
									index(id("callArgs"), id("ai")),
								])
							),
						]
					),
				]
			),
			exprStmt(assign(id("callArgs"), id("flat"))),
		]),
	];
}

/**
 * Build a simple (no-spread) argument collection preamble as AST nodes.
 *
 * Generates:
 * ```
 * var argc=O;var callArgs=new Array(argc);
 * for(var ai=argc-1;ai>=0;ai--)callArgs[ai]=X();
 * ```
 */
function simplePreamble(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("argc", id(ctx.O)),
		varDecl("callArgs", newExpr(id("Array"), [id("argc")])),
		forStmt(
			varDecl("ai", bin("-", id("argc"), lit(1))),
			bin(">=", id("ai"), lit(0)),
			update("--", false, id("ai")),
			[exprStmt(assign(index(id("callArgs"), id("ai")), ctx.pop()))]
		),
	];
}

// --- Call handlers ---

/**
 * CALL: pop arguments, pop function, apply with spread flattening.
 * Includes debug trace when debug mode is enabled.
 */
function CALL(ctx: HandlerCtx): JsNode[] {
	return [
		...spreadPreamble(ctx),
		varDecl("fn", ctx.pop()),
		...debugTrace(
			ctx,
			"CALL",
			lit("fn="),
			un("typeof", id("fn")),
			bin("+", lit("argc="), member(id("callArgs"), "length")),
			ternary(
				bin("&&", id("fn"), member(id("fn"), "name")),
				bin("+", lit("name="), member(id("fn"), "name")),
				lit("")
			)
		),
		...(ctx.debug
			? [
					ifStmt(
						bin("!==", un("typeof", id("fn")), lit("function")),
						[
							exprStmt(
								call(id(ctx.dbg), [
									lit("CALL_ERR"),
									lit("NOT A FUNCTION:"),
									id("fn"),
									bin("+", lit(ctx.S + " depth="), member(id(ctx.S), "length")),
								])
							),
						]
					),
			  ]
			: []),
		exprStmt(
			ctx.push(
				call(member(id("fn"), "apply"), [
					un("void", lit(0)),
					id("callArgs"),
				])
			)
		),
		breakStmt(),
	];
}

/**
 * CALL_METHOD: pop arguments, pop receiver, pop function, apply with receiver.
 * Includes debug trace when debug mode is enabled.
 */
function CALL_METHOD(ctx: HandlerCtx): JsNode[] {
	return [
		...spreadPreamble(ctx),
		varDecl("recv", ctx.pop()),
		varDecl("fn", ctx.pop()),
		...debugTrace(
			ctx,
			"CALL_METHOD",
			lit("fn="),
			un("typeof", id("fn")),
			lit("recv="),
			un("typeof", id("recv")),
			bin("+", lit("argc="), member(id("callArgs"), "length")),
			ternary(
				bin("&&", id("fn"), member(id("fn"), "name")),
				bin("+", lit("name="), member(id("fn"), "name")),
				lit("")
			)
		),
		...(ctx.debug
			? [
					ifStmt(
						bin("!==", un("typeof", id("fn")), lit("function")),
						[
							exprStmt(
								call(id(ctx.dbg), [
									lit("CALL_METHOD_ERR"),
									lit("NOT A FUNCTION:"),
									id("fn"),
									lit("recv="),
									id("recv"),
								])
							),
						]
					),
			  ]
			: []),
		exprStmt(
			ctx.push(
				call(member(id("fn"), "apply"), [id("recv"), id("callArgs")])
			)
		),
		breakStmt(),
	];
}

/**
 * CALL_NEW: pop arguments, pop constructor, invoke with `new`.
 *
 * ```
 * var argc=O;var callArgs=new Array(argc);
 * for(var ai=argc-1;ai>=0;ai--)callArgs[ai]=X();
 * var Ctor=X();W(new Ctor(...callArgs));break;
 * ```
 */
function CALL_NEW(ctx: HandlerCtx): JsNode[] {
	return [
		...simplePreamble(ctx),
		varDecl("Ctor", ctx.pop()),
		exprStmt(ctx.push(newExpr(id("Ctor"), [spread(id("callArgs"))]))),
		breakStmt(),
	];
}

/**
 * SUPER_CALL: pop arguments, resolve super constructor via home object, apply to this.
 * Includes debug trace when debug mode is enabled.
 */
function SUPER_CALL(ctx: HandlerCtx): JsNode[] {
	return [
		...simplePreamble(ctx),
		varDecl("superProto", superProto(ctx)),
		...debugTrace(
			ctx,
			"SUPER_CALL",
			bin("+", lit("argc="), id("argc")),
			lit("superProto="),
			un("!", un("!", id("superProto"))),
			lit("superCtor="),
			bin(
				"&&",
				id("superProto"),
				un("typeof", member(id("superProto"), "constructor"))
			)
		),
		ifStmt(
			bin(
				"&&",
				id("superProto"),
				member(id("superProto"), "constructor")
			),
			[
				exprStmt(
					call(
						member(
							member(id("superProto"), "constructor"),
							"apply"
						),
						[id(ctx.TV), id("callArgs")]
					)
				),
			]
		),
		exprStmt(ctx.push(id(ctx.TV))),
		breakStmt(),
	];
}

// --- Spread ---

/**
 * SPREAD_ARGS: wrap top-of-stack value in a spread marker object.
 *
 * `S[P]={__spread__:true,items:Array.from(S[P])};break;`
 */
function SPREAD_ARGS(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(
			assign(
				ctx.peek(),
				obj(
					["__spread__", lit(true)],
					["items", call(member(id("Array"), "from"), [ctx.peek()])]
				)
			)
		),
		breakStmt(),
	];
}

// --- Optional calls ---

/**
 * CALL_OPTIONAL: like CALL but returns undefined if function is nullish.
 *
 * ```
 * ...spread preamble...
 * var fn=X();W(fn==null?void 0:fn(...callArgs));break;
 * ```
 */
function CALL_OPTIONAL(ctx: HandlerCtx): JsNode[] {
	return [
		...spreadPreamble(ctx),
		varDecl("fn", ctx.pop()),
		exprStmt(
			ctx.push(
				ternary(
					bin("==", id("fn"), lit(null)),
					un("void", lit(0)),
					call(id("fn"), [spread(id("callArgs"))])
				)
			)
		),
		breakStmt(),
	];
}

/**
 * CALL_METHOD_OPTIONAL: like CALL_METHOD but returns undefined if function is nullish.
 *
 * ```
 * ...spread preamble...
 * var recv=X();var fn=X();W(fn==null?void 0:fn.call(recv,...callArgs));break;
 * ```
 */
function CALL_METHOD_OPTIONAL(ctx: HandlerCtx): JsNode[] {
	return [
		...spreadPreamble(ctx),
		varDecl("recv", ctx.pop()),
		varDecl("fn", ctx.pop()),
		exprStmt(
			ctx.push(
				ternary(
					bin("==", id("fn"), lit(null)),
					un("void", lit(0)),
					call(member(id("fn"), "call"), [
						id("recv"),
						spread(id("callArgs")),
					])
				)
			)
		),
		breakStmt(),
	];
}

// --- Eval ---

/** `{var code=X();W(eval(code));break;}` */
function DIRECT_EVAL(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("code", ctx.pop()),
		exprStmt(ctx.push(call(id("eval"), [id("code")]))),
		breakStmt(),
	];
}

// --- Tagged template call ---

/**
 * CALL_TAGGED_TEMPLATE: pop arguments, pop tag function, call with spread.
 *
 * ```
 * var argc=O;var callArgs=new Array(argc);
 * for(var ai=argc-1;ai>=0;ai--)callArgs[ai]=X();
 * var fn=X();W(fn(...callArgs));break;
 * ```
 */
function CALL_TAGGED_TEMPLATE(ctx: HandlerCtx): JsNode[] {
	return [
		...simplePreamble(ctx),
		varDecl("fn", ctx.pop()),
		exprStmt(ctx.push(call(id("fn"), [spread(id("callArgs"))]))),
		breakStmt(),
	];
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
	return [
		varDecl("argc", bin("&", id(ctx.O), lit(0xffff))),
		varDecl(
			"nameIdx",
			bin("&", bin(">>", id(ctx.O), lit(16)), lit(0xffff))
		),
		varDecl("callArgs", newExpr(id("Array"), [id("argc")])),
		forStmt(
			varDecl("ai", bin("-", id("argc"), lit(1))),
			bin(">=", id("ai"), lit(0)),
			update("--", false, id("ai")),
			[exprStmt(assign(index(id("callArgs"), id("ai")), ctx.pop()))]
		),
		varDecl("sp2", superProto(ctx)),
		varDecl(
			"fn",
			ternary(
				id("sp2"),
				index(id("sp2"), index(id(ctx.C), id("nameIdx"))),
				un("void", lit(0))
			)
		),
		exprStmt(
			ctx.push(
				ternary(
					id("fn"),
					call(member(id("fn"), "call"), [
						id(ctx.TV),
						spread(id("callArgs")),
					]),
					un("void", lit(0))
				)
			)
		),
		breakStmt(),
	];
}

// --- Fast-path calls (no spread, fixed arity) ---

/** `{var fn=X();W(fn());break;}` */
function CALL_0(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("fn", ctx.pop()),
		exprStmt(ctx.push(call(id("fn"), []))),
		breakStmt(),
	];
}

/** `{var a1=X();var fn=X();W(fn(a1));break;}` */
function CALL_1(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("a1", ctx.pop()),
		varDecl("fn", ctx.pop()),
		exprStmt(ctx.push(call(id("fn"), [id("a1")]))),
		breakStmt(),
	];
}

/** `{var a2=X();var a1=X();var fn=X();W(fn(a1,a2));break;}` */
function CALL_2(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("a2", ctx.pop()),
		varDecl("a1", ctx.pop()),
		varDecl("fn", ctx.pop()),
		exprStmt(ctx.push(call(id("fn"), [id("a1"), id("a2")]))),
		breakStmt(),
	];
}

/** `{var a3=X();var a2=X();var a1=X();var fn=X();W(fn(a1,a2,a3));break;}` */
function CALL_3(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("a3", ctx.pop()),
		varDecl("a2", ctx.pop()),
		varDecl("a1", ctx.pop()),
		varDecl("fn", ctx.pop()),
		exprStmt(ctx.push(call(id("fn"), [id("a1"), id("a2"), id("a3")]))),
		breakStmt(),
	];
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
