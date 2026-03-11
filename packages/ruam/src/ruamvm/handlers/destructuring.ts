/**
 * Destructuring opcode handlers in AST node form.
 *
 * Covers 6 opcodes:
 *  - DESTRUCTURE_BIND, DESTRUCTURE_DEFAULT
 *  - DESTRUCTURE_REST_ARRAY, DESTRUCTURE_REST_OBJECT
 *  - ARRAY_PATTERN_INIT, OBJECT_PATTERN_GET
 *
 * DESTRUCTURE_BIND is a simple no-op (break only).  All other handlers use
 * pure AST nodes for structured code generation.
 *
 * @module ruamvm/handlers/destructuring
 */

import { Op } from "../../compiler/opcodes.js";
import {
	type JsNode,
	breakStmt,
	varDecl,
	id,
	lit,
	bin,
	un,
	assign,
	call,
	member,
	index,
	exprStmt,
	ifStmt,
	whileStmt,
	forStmt,
	obj,
	arr,
	update,
} from "../nodes.js";
import { registry, type HandlerCtx } from "./registry.js";

// --- Simple handler ---

/** DESTRUCTURE_BIND: no-op marker, just break. */
function DESTRUCTURE_BIND(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

// --- Converted handlers (pure AST) ---

/**
 * DESTRUCTURE_DEFAULT: apply default value if top-of-stack is undefined.
 *
 * ```
 * var v=S[P];if(v===void 0){P--;var def=C[O];S[++P]=def;}break;
 * ```
 */
function DESTRUCTURE_DEFAULT(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("v", ctx.peek()),
		ifStmt(bin("===", id("v"), un("void", lit(0))), [
			exprStmt(update("--", false, id(ctx.P))),
			varDecl("def", index(id(ctx.C), id(ctx.O))),
			exprStmt(ctx.push(id("def"))),
		]),
		breakStmt(),
	];
}

/**
 * DESTRUCTURE_REST_ARRAY: collect remaining iterator values into a rest array.
 *
 * ```
 * var iterObj=S[P--];var rest=[];
 * while(!iterObj._done){rest.push(iterObj._value);
 *   var nxt=iterObj._iter.next();iterObj._done=!!nxt.done;iterObj._value=nxt.value;}
 * S[++P]=rest;break;
 * ```
 */
function DESTRUCTURE_REST_ARRAY(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("iterObj", ctx.pop()),
		varDecl("rest", arr()),
		whileStmt(un("!", member(id("iterObj"), ctx.t("_done"))), [
			exprStmt(
				call(member(id("rest"), "push"), [
					member(id("iterObj"), ctx.t("_value")),
				])
			),
			varDecl(
				"nxt",
				call(member(member(id("iterObj"), ctx.t("_iter")), "next"), [])
			),
			exprStmt(
				assign(
					member(id("iterObj"), ctx.t("_done")),
					un("!", un("!", member(id("nxt"), "done")))
				)
			),
			exprStmt(
				assign(
					member(id("iterObj"), ctx.t("_value")),
					member(id("nxt"), "value")
				)
			),
		]),
		exprStmt(ctx.push(id("rest"))),
		breakStmt(),
	];
}

/**
 * DESTRUCTURE_REST_OBJECT: collect remaining object keys into a rest object.
 *
 * ```
 * var excludeKeys=S[P--];var src=S[P--];var rest={};
 * var keys=Object.keys(src);
 * for(var ki=0;ki<keys.length;ki++){
 *   if(excludeKeys.indexOf(keys[ki])<0)rest[keys[ki]]=src[keys[ki]];}
 * S[++P]=rest;break;
 * ```
 */
function DESTRUCTURE_REST_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("excludeKeys", ctx.pop()),
		varDecl("src", ctx.pop()),
		varDecl("rest", obj()),
		varDecl("keys", call(member(id("Object"), "keys"), [id("src")])),
		forStmt(
			varDecl("ki", lit(0)),
			bin("<", id("ki"), member(id("keys"), "length")),
			update("++", false, id("ki")),
			[
				ifStmt(
					bin(
						"<",
						call(member(id("excludeKeys"), "indexOf"), [
							index(id("keys"), id("ki")),
						]),
						lit(0)
					),
					[
						exprStmt(
							assign(
								index(id("rest"), index(id("keys"), id("ki"))),
								index(id("src"), index(id("keys"), id("ki")))
							)
						),
					]
				),
			]
		),
		exprStmt(ctx.push(id("rest"))),
		breakStmt(),
	];
}

/**
 * ARRAY_PATTERN_INIT: initialize array destructuring iterator.
 *
 * ```
 * var arr=S[P--];var iter=arr[Symbol.iterator]();
 * var first=iter.next();
 * S[++P]={_iter:iter,_done:!!first.done,_value:first.value};break;
 * ```
 */
function ARRAY_PATTERN_INIT(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("arr", ctx.pop()),
		varDecl(
			"iter",
			call(index(id("arr"), member(id("Symbol"), "iterator")), [])
		),
		varDecl("first", call(member(id("iter"), "next"), [])),
		exprStmt(
			ctx.push(
				obj(
					[ctx.t("_iter"), id("iter")],
					[
						ctx.t("_done"),
						un("!", un("!", member(id("first"), "done"))),
					],
					[ctx.t("_value"), member(id("first"), "value")]
				)
			)
		),
		breakStmt(),
	];
}

/**
 * OBJECT_PATTERN_GET: get a property from the object on top of stack.
 *
 * ```
 * var obj=S[P];S[++P]=obj[C[O]];break;
 * ```
 */
function OBJECT_PATTERN_GET(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("obj", ctx.peek()),
		exprStmt(ctx.push(index(id("obj"), index(id(ctx.C), id(ctx.O))))),
		breakStmt(),
	];
}

// --- Registration ---

registry.set(Op.DESTRUCTURE_BIND, DESTRUCTURE_BIND);
registry.set(Op.DESTRUCTURE_DEFAULT, DESTRUCTURE_DEFAULT);
registry.set(Op.DESTRUCTURE_REST_ARRAY, DESTRUCTURE_REST_ARRAY);
registry.set(Op.DESTRUCTURE_REST_OBJECT, DESTRUCTURE_REST_OBJECT);
registry.set(Op.ARRAY_PATTERN_INIT, ARRAY_PATTERN_INIT);
registry.set(Op.OBJECT_PATTERN_GET, OBJECT_PATTERN_GET);
