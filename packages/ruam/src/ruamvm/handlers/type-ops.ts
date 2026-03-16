/**
 * Type operation and miscellaneous opcode handlers in AST node form.
 *
 * Covers 18 opcodes:
 *  - Type ops:  TYPEOF, VOID, TO_NUMBER, TO_STRING, TO_BOOLEAN, TO_OBJECT,
 *               TO_PROPERTY_KEY, TO_NUMERIC
 *  - Templates: TEMPLATE_LITERAL, TAGGED_TEMPLATE, CREATE_RAW_STRINGS
 *  - No-ops:    DEBUGGER_STMT, COMMA, SOURCE_MAP
 *  - Meta:      IMPORT_META, DYNAMIC_IMPORT
 *  - Assertions: ASSERT_DEFINED, ASSERT_FUNCTION
 *
 * All handlers use pure AST nodes — no raw() escape hatch.
 *
 * @module ruamvm/handlers/type-ops
 */

import { Op } from "../../compiler/opcodes.js";
import {
	type JsNode,
	id,
	lit,
	un,
	bin,
	assign,
	call,
	member,
	index,
	ternary,
	newExpr,
	spread,
	varDecl,
	exprStmt,
	ifStmt,
	forStmt,
	throwStmt,
	breakStmt,
	update,
	importExpr,
	BOp,
	UOp,
	UpOp,
	AOp,
} from "../nodes.js";
import { registry, type HandlerCtx } from "./registry.js";

// --- Simple type coercions (AST nodes) ---

/** `S[P]=typeof S[P];break;` */
function TYPEOF(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(assign(ctx.peek(), un(UOp.Typeof, ctx.peek()))),
		breakStmt(),
	];
}

/** `S[P]=void 0;break;` */
function VOID(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(assign(ctx.peek(), un(UOp.Void, lit(0)))), breakStmt()];
}

/** `S[P]=Number(S[P]);break;` */
function TO_NUMBER(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(assign(ctx.peek(), call(id("Number"), [ctx.peek()]))),
		breakStmt(),
	];
}

/** `S[P]=String(S[P]);break;` */
function TO_STRING(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(assign(ctx.peek(), call(id("String"), [ctx.peek()]))),
		breakStmt(),
	];
}

/** `S[P]=Boolean(S[P]);break;` */
function TO_BOOLEAN(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(assign(ctx.peek(), call(id("Boolean"), [ctx.peek()]))),
		breakStmt(),
	];
}

/** `S[P]=Object(S[P]);break;` */
function TO_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(assign(ctx.peek(), call(id("Object"), [ctx.peek()]))),
		breakStmt(),
	];
}

// --- Conditional type coercions ---

/**
 * TO_PROPERTY_KEY: `{var v=S[P];S[P]=typeof v==='symbol'?v:String(v);break;}`
 */
function TO_PROPERTY_KEY(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("value"), ctx.peek()),
		exprStmt(
			assign(
				ctx.peek(),
				ternary(
					bin(
						BOp.Seq,
						un(UOp.Typeof, id(ctx.local("value"))),
						lit("symbol")
					),
					id(ctx.local("value")),
					call(id("String"), [id(ctx.local("value"))])
				)
			)
		),
		breakStmt(),
	];
}

/**
 * TO_NUMERIC: `{var v=S[P];S[P]=typeof v==='bigint'?v:Number(v);break;}`
 */
function TO_NUMERIC(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("value"), ctx.peek()),
		exprStmt(
			assign(
				ctx.peek(),
				ternary(
					bin(
						BOp.Seq,
						un(UOp.Typeof, id(ctx.local("value"))),
						lit("bigint")
					),
					id(ctx.local("value")),
					call(id("Number"), [id(ctx.local("value"))])
				)
			)
		),
		breakStmt(),
	];
}

// --- Template handlers ---

/**
 * TEMPLATE_LITERAL: assemble template parts from the stack.
 *
 * ```
 * var exprCount=O;var parts=[];
 * for(var ti=exprCount*2;ti>=0;ti--)parts.unshift(X());
 * var result='';for(var ti=0;ti<parts.length;ti++)result+=String(parts[ti]!=null?parts[ti]:'');
 * W(result);break;
 * ```
 */
function TEMPLATE_LITERAL(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("exprCount"), id(ctx.O)),
		varDecl(ctx.local("parts"), { type: "ArrayExpr", elements: [] }),
		forStmt(
			varDecl(
				ctx.local("idx"),
				bin(BOp.Mul, id(ctx.local("exprCount")), lit(2))
			),
			bin(BOp.Gte, id(ctx.local("idx")), lit(0)),
			update(UpOp.Dec, false, id(ctx.local("idx"))),
			[
				exprStmt(
					call(member(id(ctx.local("parts")), "unshift"), [ctx.pop()])
				),
			]
		),
		varDecl(ctx.local("result"), lit("")),
		forStmt(
			varDecl(ctx.local("idx"), lit(0)),
			bin(
				BOp.Lt,
				id(ctx.local("idx")),
				member(id(ctx.local("parts")), "length")
			),
			update(UpOp.Inc, false, id(ctx.local("idx"))),
			[
				exprStmt(
					assign(
						id(ctx.local("result")),
						call(id("String"), [
							ternary(
								bin(
									BOp.Neq,
									index(
										id(ctx.local("parts")),
										id(ctx.local("idx"))
									),
									lit(null)
								),
								index(
									id(ctx.local("parts")),
									id(ctx.local("idx"))
								),
								lit("")
							),
						]),
						AOp.Add
					)
				),
			]
		),
		exprStmt(ctx.push(id(ctx.local("result")))),
		breakStmt(),
	];
}

/**
 * TAGGED_TEMPLATE: call tag function with template arguments.
 *
 * ```
 * var argc=O;var callArgs=[];
 * for(var ai=0;ai<argc;ai++)callArgs.unshift(X());
 * var fn=X();W(fn(...callArgs));break;
 * ```
 */
function TAGGED_TEMPLATE(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("argc"), id(ctx.O)),
		varDecl(ctx.local("callArgs"), { type: "ArrayExpr", elements: [] }),
		forStmt(
			varDecl(ctx.local("idx"), lit(0)),
			bin(BOp.Lt, id(ctx.local("idx")), id(ctx.local("argc"))),
			update(UpOp.Inc, false, id(ctx.local("idx"))),
			[
				exprStmt(
					call(member(id(ctx.local("callArgs")), "unshift"), [
						ctx.pop(),
					])
				),
			]
		),
		varDecl(ctx.local("tagFn"), ctx.pop()),
		exprStmt(
			ctx.push(
				call(id(ctx.local("tagFn")), [
					spread(id(ctx.local("callArgs"))),
				])
			)
		),
		breakStmt(),
	];
}

/**
 * CREATE_RAW_STRINGS: build frozen raw strings array.
 *
 * ```
 * var count=O;var raw=[];
 * for(var ri=0;ri<count;ri++)raw.unshift(X());
 * Object.freeze(raw);W(raw);break;
 * ```
 */
function CREATE_RAW_STRINGS(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("count"), id(ctx.O)),
		varDecl(ctx.local("rawArr"), { type: "ArrayExpr", elements: [] }),
		forStmt(
			varDecl(ctx.local("idx"), lit(0)),
			bin(BOp.Lt, id(ctx.local("idx")), id(ctx.local("count"))),
			update(UpOp.Inc, false, id(ctx.local("idx"))),
			[
				exprStmt(
					call(member(id(ctx.local("rawArr")), "unshift"), [
						ctx.pop(),
					])
				),
			]
		),
		exprStmt(
			call(member(id("Object"), "freeze"), [id(ctx.local("rawArr"))])
		),
		exprStmt(ctx.push(id(ctx.local("rawArr")))),
		breakStmt(),
	];
}

// --- No-op handlers (AST nodes — just break) ---

/** DEBUGGER_STMT: no-op in obfuscated output. */
function DEBUGGER_STMT(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

/** COMMA: no-op (value already on stack). */
function COMMA(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

/** SOURCE_MAP: no-op (debug information only). */
function SOURCE_MAP(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

// --- Meta / import handlers ---

/** `S[++P]={};break;` — import.meta stub */
function IMPORT_META(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(ctx.push({ type: "ObjectExpr", entries: [] })),
		breakStmt(),
	];
}

/**
 * DYNAMIC_IMPORT: `{var spec=X();W(import(spec));break;}`
 */
function DYNAMIC_IMPORT(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("specifier"), ctx.pop()),
		exprStmt(ctx.push(importExpr(id(ctx.local("specifier"))))),
		breakStmt(),
	];
}

// --- Assertion handlers ---

/**
 * ASSERT_DEFINED: `{var v=Y();if(v===void 0)throw new TypeError('Cannot read properties of undefined');break;}`
 */
function ASSERT_DEFINED(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("value"), ctx.peek()),
		ifStmt(bin(BOp.Seq, id(ctx.local("value")), un(UOp.Void, lit(0))), [
			throwStmt(
				newExpr(id("TypeError"), [
					lit("Cannot read properties of undefined"),
				])
			),
		]),
		breakStmt(),
	];
}

/**
 * ASSERT_FUNCTION: `{var v=Y();if(typeof v!=='function')throw new TypeError(v+' is not a function');break;}`
 */
function ASSERT_FUNCTION(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("value"), ctx.peek()),
		ifStmt(
			bin(
				BOp.Sneq,
				un(UOp.Typeof, id(ctx.local("value"))),
				lit("function")
			),
			[
				throwStmt(
					newExpr(id("TypeError"), [
						bin(
							BOp.Add,
							id(ctx.local("value")),
							lit(" is not a function")
						),
					])
				),
			]
		),
		breakStmt(),
	];
}

// --- Registration ---

registry.set(Op.TYPEOF, TYPEOF);
registry.set(Op.VOID, VOID);
registry.set(Op.TO_NUMBER, TO_NUMBER);
registry.set(Op.TO_STRING, TO_STRING);
registry.set(Op.TO_BOOLEAN, TO_BOOLEAN);
registry.set(Op.TO_OBJECT, TO_OBJECT);
registry.set(Op.TO_PROPERTY_KEY, TO_PROPERTY_KEY);
registry.set(Op.TO_NUMERIC, TO_NUMERIC);
registry.set(Op.TEMPLATE_LITERAL, TEMPLATE_LITERAL);
registry.set(Op.TAGGED_TEMPLATE, TAGGED_TEMPLATE);
registry.set(Op.CREATE_RAW_STRINGS, CREATE_RAW_STRINGS);
registry.set(Op.DEBUGGER_STMT, DEBUGGER_STMT);
registry.set(Op.COMMA, COMMA);
registry.set(Op.SOURCE_MAP, SOURCE_MAP);
registry.set(Op.IMPORT_META, IMPORT_META);
registry.set(Op.DYNAMIC_IMPORT, DYNAMIC_IMPORT);
registry.set(Op.ASSERT_DEFINED, ASSERT_DEFINED);
registry.set(Op.ASSERT_FUNCTION, ASSERT_FUNCTION);
