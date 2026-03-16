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
	BOp,
	UOp,
	UpOp,
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
		varDecl(ctx.local("argc"), id(ctx.O)),
		varDecl(
			ctx.local("hasSpread"),
			bin(BOp.Lt, id(ctx.local("argc")), lit(0))
		),
		// if(hasSpread)argc=-argc;
		ifStmt(id(ctx.local("hasSpread")), [
			exprStmt(
				assign(
					id(ctx.local("argc")),
					un(UOp.Neg, id(ctx.local("argc")))
				)
			),
		]),
		// var callArgs=new Array(argc);
		varDecl(
			ctx.local("callArgs"),
			newExpr(id("Array"), [id(ctx.local("argc"))])
		),
		// for(var ai=argc-1;ai>=0;ai--)callArgs[ai]=S[P--];
		forStmt(
			varDecl(
				ctx.local("argIndex"),
				bin(BOp.Sub, id(ctx.local("argc")), lit(1))
			),
			bin(BOp.Gte, id(ctx.local("argIndex")), lit(0)),
			update(UpOp.Dec, false, id(ctx.local("argIndex"))),
			[
				exprStmt(
					assign(
						index(
							id(ctx.local("callArgs")),
							id(ctx.local("argIndex"))
						),
						ctx.pop()
					)
				),
			]
		),
		// if(hasSpread){...flatten spread markers...}
		ifStmt(id(ctx.local("hasSpread")), [
			varDecl(ctx.local("flatArgs"), arr()),
			forStmt(
				varDecl(ctx.local("argIndex"), lit(0)),
				bin(
					BOp.Lt,
					id(ctx.local("argIndex")),
					member(id(ctx.local("callArgs")), "length")
				),
				update(UpOp.Inc, false, id(ctx.local("argIndex"))),
				[
					ifStmt(
						bin(
							BOp.And,
							index(
								id(ctx.local("callArgs")),
								id(ctx.local("argIndex"))
							),
							index(
								index(
									id(ctx.local("callArgs")),
									id(ctx.local("argIndex"))
								),
								id(ctx.spreadSym)
							)
						),
						[
							// Spread value IS the array now — iterate directly
							forStmt(
								varDecl(ctx.local("spreadIdx"), lit(0)),
								bin(
									BOp.Lt,
									id(ctx.local("spreadIdx")),
									member(
										index(
											id(ctx.local("callArgs")),
											id(ctx.local("argIndex"))
										),
										"length"
									)
								),
								update(
									UpOp.Inc,
									false,
									id(ctx.local("spreadIdx"))
								),
								[
									exprStmt(
										call(
											member(
												id(ctx.local("flatArgs")),
												"push"
											),
											[
												index(
													index(
														id(
															ctx.local(
																"callArgs"
															)
														),
														id(
															ctx.local(
																"argIndex"
															)
														)
													),
													id(ctx.local("spreadIdx"))
												),
											]
										)
									),
								]
							),
						],
						[
							exprStmt(
								call(
									member(id(ctx.local("flatArgs")), "push"),
									[
										index(
											id(ctx.local("callArgs")),
											id(ctx.local("argIndex"))
										),
									]
								)
							),
						]
					),
				]
			),
			exprStmt(
				assign(id(ctx.local("callArgs")), id(ctx.local("flatArgs")))
			),
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
		varDecl(ctx.local("argc"), id(ctx.O)),
		varDecl(
			ctx.local("callArgs"),
			newExpr(id("Array"), [id(ctx.local("argc"))])
		),
		forStmt(
			varDecl(
				ctx.local("argIndex"),
				bin(BOp.Sub, id(ctx.local("argc")), lit(1))
			),
			bin(BOp.Gte, id(ctx.local("argIndex")), lit(0)),
			update(UpOp.Dec, false, id(ctx.local("argIndex"))),
			[
				exprStmt(
					assign(
						index(
							id(ctx.local("callArgs")),
							id(ctx.local("argIndex"))
						),
						ctx.pop()
					)
				),
			]
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
		varDecl(ctx.local("func"), ctx.pop()),
		...debugTrace(
			ctx,
			"CALL",
			lit("fn="),
			un(UOp.Typeof, id(ctx.local("func"))),
			bin(
				BOp.Add,
				lit("argc="),
				member(id(ctx.local("callArgs")), "length")
			),
			ternary(
				bin(
					BOp.And,
					id(ctx.local("func")),
					member(id(ctx.local("func")), "name")
				),
				bin(
					BOp.Add,
					lit("name="),
					member(id(ctx.local("func")), "name")
				),
				lit("")
			)
		),
		...(ctx.debug
			? [
					ifStmt(
						bin(
							BOp.Sneq,
							un(UOp.Typeof, id(ctx.local("func"))),
							lit("function")
						),
						[
							exprStmt(
								call(id(ctx.dbg), [
									lit("CALL_ERR"),
									lit("NOT A FUNCTION:"),
									id(ctx.local("func")),
									bin(
										BOp.Add,
										lit(ctx.S + " depth="),
										member(id(ctx.S), "length")
									),
								])
							),
						]
					),
			  ]
			: []),
		exprStmt(
			ctx.push(
				call(member(id(ctx.local("func")), "apply"), [
					un(UOp.Void, lit(0)),
					id(ctx.local("callArgs")),
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
		varDecl(ctx.local("receiver"), ctx.pop()),
		varDecl(ctx.local("func"), ctx.pop()),
		...debugTrace(
			ctx,
			"CALL_METHOD",
			lit("fn="),
			un(UOp.Typeof, id(ctx.local("func"))),
			lit("recv="),
			un(UOp.Typeof, id(ctx.local("receiver"))),
			bin(
				BOp.Add,
				lit("argc="),
				member(id(ctx.local("callArgs")), "length")
			),
			ternary(
				bin(
					BOp.And,
					id(ctx.local("func")),
					member(id(ctx.local("func")), "name")
				),
				bin(
					BOp.Add,
					lit("name="),
					member(id(ctx.local("func")), "name")
				),
				lit("")
			)
		),
		...(ctx.debug
			? [
					ifStmt(
						bin(
							BOp.Sneq,
							un(UOp.Typeof, id(ctx.local("func"))),
							lit("function")
						),
						[
							exprStmt(
								call(id(ctx.dbg), [
									lit("CALL_METHOD_ERR"),
									lit("NOT A FUNCTION:"),
									id(ctx.local("func")),
									lit("recv="),
									id(ctx.local("receiver")),
								])
							),
						]
					),
			  ]
			: []),
		exprStmt(
			ctx.push(
				call(member(id(ctx.local("func")), "apply"), [
					id(ctx.local("receiver")),
					id(ctx.local("callArgs")),
				])
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
		varDecl(ctx.local("Ctor"), ctx.pop()),
		exprStmt(
			ctx.push(
				newExpr(id(ctx.local("Ctor")), [
					spread(id(ctx.local("callArgs"))),
				])
			)
		),
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
		varDecl(ctx.local("superProto"), superProto(ctx)),
		...debugTrace(
			ctx,
			"SUPER_CALL",
			bin(BOp.Add, lit("argc="), id(ctx.local("argc"))),
			lit("superProto="),
			un(UOp.Not, un(UOp.Not, id(ctx.local("superProto")))),
			lit("superCtor="),
			bin(
				BOp.And,
				id(ctx.local("superProto")),
				un(
					UOp.Typeof,
					member(id(ctx.local("superProto")), "constructor")
				)
			)
		),
		ifStmt(
			bin(
				BOp.And,
				id(ctx.local("superProto")),
				member(id(ctx.local("superProto")), "constructor")
			),
			[
				exprStmt(
					call(
						member(
							member(id(ctx.local("superProto")), "constructor"),
							"apply"
						),
						[id(ctx.TV), id(ctx.local("callArgs"))]
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
	// Tag the array with a Symbol instead of wrapping in a marker object
	return [
		varDecl(
			ctx.local("spreadArr"),
			call(member(id("Array"), "from"), [ctx.peek()])
		),
		exprStmt(
			assign(
				index(id(ctx.local("spreadArr")), id(ctx.spreadSym)),
				lit(true)
			)
		),
		exprStmt(assign(ctx.peek(), id(ctx.local("spreadArr")))),
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
		varDecl(ctx.local("func"), ctx.pop()),
		exprStmt(
			ctx.push(
				ternary(
					bin(BOp.Eq, id(ctx.local("func")), lit(null)),
					un(UOp.Void, lit(0)),
					call(id(ctx.local("func")), [
						spread(id(ctx.local("callArgs"))),
					])
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
		varDecl(ctx.local("receiver"), ctx.pop()),
		varDecl(ctx.local("func"), ctx.pop()),
		exprStmt(
			ctx.push(
				ternary(
					bin(BOp.Eq, id(ctx.local("func")), lit(null)),
					un(UOp.Void, lit(0)),
					call(member(id(ctx.local("func")), "call"), [
						id(ctx.local("receiver")),
						spread(id(ctx.local("callArgs"))),
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
		varDecl(ctx.local("code"), ctx.pop()),
		exprStmt(ctx.push(call(id("eval"), [id(ctx.local("code"))]))),
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
		varDecl(ctx.local("func"), ctx.pop()),
		exprStmt(
			ctx.push(
				call(id(ctx.local("func")), [spread(id(ctx.local("callArgs")))])
			)
		),
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
		varDecl(ctx.local("argc"), bin(BOp.BitAnd, id(ctx.O), lit(0xffff))),
		varDecl(
			ctx.local("nameIdx"),
			bin(BOp.BitAnd, bin(BOp.Shr, id(ctx.O), lit(16)), lit(0xffff))
		),
		varDecl(
			ctx.local("callArgs"),
			newExpr(id("Array"), [id(ctx.local("argc"))])
		),
		forStmt(
			varDecl(
				ctx.local("argIndex"),
				bin(BOp.Sub, id(ctx.local("argc")), lit(1))
			),
			bin(BOp.Gte, id(ctx.local("argIndex")), lit(0)),
			update(UpOp.Dec, false, id(ctx.local("argIndex"))),
			[
				exprStmt(
					assign(
						index(
							id(ctx.local("callArgs")),
							id(ctx.local("argIndex"))
						),
						ctx.pop()
					)
				),
			]
		),
		varDecl(ctx.local("superProto"), superProto(ctx)),
		varDecl(
			ctx.local("func"),
			ternary(
				id(ctx.local("superProto")),
				index(
					id(ctx.local("superProto")),
					index(id(ctx.C), id(ctx.local("nameIdx")))
				),
				un(UOp.Void, lit(0))
			)
		),
		exprStmt(
			ctx.push(
				ternary(
					id(ctx.local("func")),
					call(member(id(ctx.local("func")), "call"), [
						id(ctx.TV),
						spread(id(ctx.local("callArgs"))),
					]),
					un(UOp.Void, lit(0))
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
		varDecl(ctx.local("func"), ctx.pop()),
		exprStmt(ctx.push(call(id(ctx.local("func")), []))),
		breakStmt(),
	];
}

/** `{var a1=X();var fn=X();W(fn(a1));break;}` */
function CALL_1(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("arg1"), ctx.pop()),
		varDecl(ctx.local("func"), ctx.pop()),
		exprStmt(
			ctx.push(call(id(ctx.local("func")), [id(ctx.local("arg1"))]))
		),
		breakStmt(),
	];
}

/** `{var a2=X();var a1=X();var fn=X();W(fn(a1,a2));break;}` */
function CALL_2(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("arg2"), ctx.pop()),
		varDecl(ctx.local("arg1"), ctx.pop()),
		varDecl(ctx.local("func"), ctx.pop()),
		exprStmt(
			ctx.push(
				call(id(ctx.local("func")), [
					id(ctx.local("arg1")),
					id(ctx.local("arg2")),
				])
			)
		),
		breakStmt(),
	];
}

/** `{var a3=X();var a2=X();var a1=X();var fn=X();W(fn(a1,a2,a3));break;}` */
function CALL_3(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("arg3"), ctx.pop()),
		varDecl(ctx.local("arg2"), ctx.pop()),
		varDecl(ctx.local("arg1"), ctx.pop()),
		varDecl(ctx.local("func"), ctx.pop()),
		exprStmt(
			ctx.push(
				call(id(ctx.local("func")), [
					id(ctx.local("arg1")),
					id(ctx.local("arg2")),
					id(ctx.local("arg3")),
				])
			)
		),
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
