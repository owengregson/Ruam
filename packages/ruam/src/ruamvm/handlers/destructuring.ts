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
	BOp,
	UOp,
	UpOp,
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
 * var v=S[S.length-1];if(v===void 0){S.pop();var def=C[O];S.push(def);}break;
 * ```
 */
function DESTRUCTURE_DEFAULT(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(ctx.local("value"), ctx.peek()),
		ifStmt(bin(BOp.Seq, id(ctx.local("value")), un(UOp.Void, lit(0))), [
			exprStmt(ctx.pop()),
			varDecl(ctx.local("defaultVal"), index(id(ctx.C), id(ctx.O))),
			exprStmt(ctx.push(id(ctx.local("defaultVal")))),
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
		varDecl(ctx.local("iterObj"), ctx.pop()),
		varDecl(ctx.local("restVal"), arr()),
		whileStmt(
			un(UOp.Not, member(id(ctx.local("iterObj")), ctx.t("_done"))),
			[
				exprStmt(
					call(member(id(ctx.local("restVal")), "push"), [
						member(id(ctx.local("iterObj")), ctx.t("_value")),
					])
				),
				varDecl(
					ctx.local("next"),
					call(
						member(
							member(id(ctx.local("iterObj")), ctx.t("_iter")),
							"next"
						),
						[]
					)
				),
				exprStmt(
					assign(
						member(id(ctx.local("iterObj")), ctx.t("_done")),
						un(
							UOp.Not,
							un(UOp.Not, member(id(ctx.local("next")), "done"))
						)
					)
				),
				exprStmt(
					assign(
						member(id(ctx.local("iterObj")), ctx.t("_value")),
						member(id(ctx.local("next")), "value")
					)
				),
			]
		),
		exprStmt(ctx.push(id(ctx.local("restVal")))),
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
		varDecl(ctx.local("excludeKeys"), ctx.pop()),
		varDecl(ctx.local("src"), ctx.pop()),
		varDecl(ctx.local("restVal"), obj()),
		varDecl(
			ctx.local("keys"),
			call(member(id("Object"), "keys"), [id(ctx.local("src"))])
		),
		forStmt(
			varDecl(ctx.local("ki"), lit(0)),
			bin(
				BOp.Lt,
				id(ctx.local("ki")),
				member(id(ctx.local("keys")), "length")
			),
			update(UpOp.Inc, false, id(ctx.local("ki"))),
			[
				ifStmt(
					bin(
						BOp.Lt,
						call(member(id(ctx.local("excludeKeys")), "indexOf"), [
							index(id(ctx.local("keys")), id(ctx.local("ki"))),
						]),
						lit(0)
					),
					[
						exprStmt(
							assign(
								index(
									id(ctx.local("restVal")),
									index(
										id(ctx.local("keys")),
										id(ctx.local("ki"))
									)
								),
								index(
									id(ctx.local("src")),
									index(
										id(ctx.local("keys")),
										id(ctx.local("ki"))
									)
								)
							)
						),
					]
				),
			]
		),
		exprStmt(ctx.push(id(ctx.local("restVal")))),
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
		varDecl(ctx.local("array"), ctx.pop()),
		varDecl(
			ctx.local("iter"),
			call(
				index(id(ctx.local("array")), member(id("Symbol"), "iterator")),
				[]
			)
		),
		varDecl(
			ctx.local("first"),
			call(member(id(ctx.local("iter")), "next"), [])
		),
		exprStmt(
			ctx.push(
				obj(
					[ctx.t("_iter"), id(ctx.local("iter"))],
					[
						ctx.t("_done"),
						un(
							UOp.Not,
							un(UOp.Not, member(id(ctx.local("first")), "done"))
						),
					],
					[ctx.t("_value"), member(id(ctx.local("first")), "value")]
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
		varDecl(ctx.local("obj"), ctx.peek()),
		exprStmt(
			ctx.push(index(id(ctx.local("obj")), index(id(ctx.C), id(ctx.O))))
		),
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
