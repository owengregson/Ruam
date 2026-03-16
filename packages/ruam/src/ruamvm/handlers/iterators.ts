/**
 * Iterator opcode handlers in AST node form.
 *
 * Covers 16 opcodes across sync and async iteration:
 *  - Sync iterators:  GET_ITERATOR, ITER_NEXT, ITER_DONE, ITER_VALUE,
 *                     ITER_CLOSE, ITER_RESULT_UNWRAP
 *  - For-in:          FORIN_INIT, FORIN_NEXT, FORIN_DONE
 *  - Async iterators: GET_ASYNC_ITERATOR, ASYNC_ITER_NEXT, ASYNC_ITER_DONE,
 *                     ASYNC_ITER_VALUE, ASYNC_ITER_CLOSE, FOR_AWAIT_NEXT
 *  - Conversion:      CREATE_ASYNC_FROM_SYNC_ITER
 *
 * Async iterator handlers conditionally emit `await` when ctx.isAsync is true.
 * All handlers use pure AST nodes — no raw() escape hatch.
 *
 * @module ruamvm/handlers/iterators
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
	breakStmt,
	forIn,
	obj,
	arr,
	awaitExpr,
	update,
	UOp,
	UpOp,
	BOp,
} from "../nodes.js";
import type { HandlerCtx } from "./registry.js";
import { registry } from "./registry.js";

// --- Helpers ---

/** Wrap an expression with `await` when ctx.isAsync is true. */
function maybeAwait(ctx: HandlerCtx, expr: JsNode): JsNode {
	return ctx.isAsync ? awaitExpr(expr) : expr;
}

// --- Sync iterator handlers ---

/**
 * GET_ITERATOR: pop iterable, create iterator, advance to first result.
 *
 * ```
 * var iterable=X();var iter=iterable[Symbol.iterator]();
 * var first=iter.next();W({_iter:iter,_done:!!first.done,_value:first.value});break;
 * ```
 */
function GET_ITERATOR(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("iterable", ctx.pop()),
		varDecl(
			"iter",
			call(index(id("iterable"), member(id("Symbol"), "iterator")), [])
		),
		varDecl("first", call(member(id("iter"), "next"), [])),
		exprStmt(
			ctx.push(
				obj(
					[ctx.t("_iter"), id("iter")],
					[
						ctx.t("_done"),
						un(UOp.Not, un(UOp.Not, member(id("first"), "done"))),
					],
					[ctx.t("_value"), member(id("first"), "value")]
				)
			)
		),
		breakStmt(),
	];
}

/**
 * ITER_NEXT: pop iterator object, push current value, then advance.
 *
 * ```
 * var iterObj=X();W(iterObj._value);
 * var nxt=iterObj._iter.next();iterObj._done=!!nxt.done;iterObj._value=nxt.value;break;
 * ```
 */
function ITER_NEXT(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("iterObj", ctx.pop()),
		exprStmt(ctx.push(member(id("iterObj"), ctx.t("_value")))),
		varDecl(
			"nxt",
			call(member(member(id("iterObj"), ctx.t("_iter")), "next"), [])
		),
		exprStmt(
			assign(
				member(id("iterObj"), ctx.t("_done")),
				un(UOp.Not, un(UOp.Not, member(id("nxt"), "done")))
			)
		),
		exprStmt(
			assign(
				member(id("iterObj"), ctx.t("_value")),
				member(id("nxt"), "value")
			)
		),
		breakStmt(),
	];
}

/**
 * ITER_DONE: peek at iterator object, push its done flag.
 */
function ITER_DONE(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("iterObj", ctx.peek()),
		exprStmt(
			ctx.push(
				un(UOp.Not, un(UOp.Not, member(id("iterObj"), ctx.t("_done"))))
			)
		),
		breakStmt(),
	];
}

/**
 * ITER_VALUE: peek at iterator object, push its current value.
 */
function ITER_VALUE(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("iterObj", ctx.peek()),
		exprStmt(ctx.push(member(id("iterObj"), ctx.t("_value")))),
		breakStmt(),
	];
}

/**
 * ITER_CLOSE: pop iterator object and call its return method if present.
 */
function ITER_CLOSE(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("iterObj", ctx.pop()),
		ifStmt(member(member(id("iterObj"), ctx.t("_iter")), "return"), [
			exprStmt(
				call(
					member(member(id("iterObj"), ctx.t("_iter")), "return"),
					[]
				)
			),
		]),
		breakStmt(),
	];
}

/**
 * ITER_RESULT_UNWRAP: peek at iterator, push value then done flag.
 */
function ITER_RESULT_UNWRAP(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("iterObj", ctx.peek()),
		exprStmt(ctx.push(member(id("iterObj"), ctx.t("_value")))),
		exprStmt(
			ctx.push(
				un(UOp.Not, un(UOp.Not, member(id("iterObj"), ctx.t("_done"))))
			)
		),
		breakStmt(),
	];
}

// --- For-in handlers ---

/**
 * FORIN_INIT: pop object, collect all enumerable keys.
 *
 * ```
 * var obj=X();var keys=[];for(var k in obj)keys.push(k);
 * W({_keys:keys,_idx:0});break;
 * ```
 */
function FORIN_INIT(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("obj", ctx.pop()),
		varDecl("keys", arr()),
		forIn("k", id("obj"), [
			exprStmt(call(member(id("keys"), "push"), [id("k")])),
		]),
		exprStmt(
			ctx.push(obj([ctx.t("_keys"), id("keys")], [ctx.t("_idx"), lit(0)]))
		),
		breakStmt(),
	];
}

/**
 * FORIN_NEXT: pop for-in state, push next key.
 */
function FORIN_NEXT(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("fi", ctx.pop()),
		exprStmt(
			ctx.push(
				index(
					member(id("fi"), ctx.t("_keys")),
					update(UpOp.Inc, false, member(id("fi"), ctx.t("_idx")))
				)
			)
		),
		breakStmt(),
	];
}

/**
 * FORIN_DONE: peek at for-in state, push whether iteration is complete.
 */
function FORIN_DONE(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("fi", ctx.peek()),
		exprStmt(
			ctx.push(
				bin(
					BOp.Gte,
					member(id("fi"), ctx.t("_idx")),
					member(member(id("fi"), ctx.t("_keys")), "length")
				)
			)
		),
		breakStmt(),
	];
}

// --- Async iterator handlers ---

/**
 * GET_ASYNC_ITERATOR: pop iterable, get async (or sync) iterator.
 *
 * Falls back to Symbol.iterator if Symbol.asyncIterator is not present.
 */
function GET_ASYNC_ITERATOR(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("iterable", ctx.pop()),
		varDecl(
			"method",
			bin(
				BOp.Or,
				index(id("iterable"), member(id("Symbol"), "asyncIterator")),
				index(id("iterable"), member(id("Symbol"), "iterator"))
			)
		),
		varDecl("iter", call(member(id("method"), "call"), [id("iterable")])),
		exprStmt(
			ctx.push(
				obj(
					[ctx.t("_iter"), id("iter")],
					[ctx.t("_done"), lit(false)],
					[ctx.t("_value"), un(UOp.Void, lit(0))],
					[ctx.t("_async"), lit(true)]
				)
			)
		),
		breakStmt(),
	];
}

/**
 * ASYNC_ITER_NEXT: advance async iterator, optionally awaiting the result.
 *
 * When ctx.isAsync is true, emits `await` before `iterObj._iter.next()`.
 */
function ASYNC_ITER_NEXT(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("iterObj", ctx.peek()),
		varDecl(
			"result",
			maybeAwait(
				ctx,
				call(member(member(id("iterObj"), ctx.t("_iter")), "next"), [])
			)
		),
		exprStmt(
			assign(
				member(id("iterObj"), ctx.t("_done")),
				un(UOp.Not, un(UOp.Not, member(id("result"), "done")))
			)
		),
		exprStmt(
			assign(
				member(id("iterObj"), ctx.t("_value")),
				member(id("result"), "value")
			)
		),
		breakStmt(),
	];
}

/**
 * ASYNC_ITER_DONE: peek at async iterator, push its done flag.
 */
function ASYNC_ITER_DONE(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("iterObj", ctx.peek()),
		exprStmt(
			ctx.push(
				un(UOp.Not, un(UOp.Not, member(id("iterObj"), ctx.t("_done"))))
			)
		),
		breakStmt(),
	];
}

/**
 * ASYNC_ITER_VALUE: peek at async iterator, push its current value.
 */
function ASYNC_ITER_VALUE(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("iterObj", ctx.peek()),
		exprStmt(ctx.push(member(id("iterObj"), ctx.t("_value")))),
		breakStmt(),
	];
}

/**
 * ASYNC_ITER_CLOSE: pop async iterator and call its return method if present.
 *
 * When ctx.isAsync is true, emits `await` before the return call.
 */
function ASYNC_ITER_CLOSE(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("iterObj", ctx.pop()),
		ifStmt(member(member(id("iterObj"), ctx.t("_iter")), "return"), [
			exprStmt(
				maybeAwait(
					ctx,
					call(
						member(member(id("iterObj"), ctx.t("_iter")), "return"),
						[]
					)
				)
			),
		]),
		breakStmt(),
	];
}

/**
 * FOR_AWAIT_NEXT: advance async iterator, push the value.
 *
 * When ctx.isAsync is true, emits `await` before `iterObj._iter.next()`.
 */
function FOR_AWAIT_NEXT(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("iterObj", ctx.peek()),
		varDecl(
			"result",
			maybeAwait(
				ctx,
				call(member(member(id("iterObj"), ctx.t("_iter")), "next"), [])
			)
		),
		exprStmt(
			assign(
				member(id("iterObj"), ctx.t("_done")),
				un(UOp.Not, un(UOp.Not, member(id("result"), "done")))
			)
		),
		exprStmt(
			assign(
				member(id("iterObj"), ctx.t("_value")),
				member(id("result"), "value")
			)
		),
		exprStmt(ctx.push(member(id("result"), "value"))),
		breakStmt(),
	];
}

// --- Conversion handler ---

/**
 * CREATE_ASYNC_FROM_SYNC_ITER: pop sync iterator, wrap as async-compatible.
 */
function CREATE_ASYNC_FROM_SYNC_ITER(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("it", ctx.pop()),
		exprStmt(
			ctx.push(
				obj(
					[ctx.t("_iter"), id("it")],
					[ctx.t("_done"), lit(false)],
					[ctx.t("_value"), un(UOp.Void, lit(0))]
				)
			)
		),
		breakStmt(),
	];
}

// --- Registration ---

registry.set(Op.GET_ITERATOR, GET_ITERATOR);
registry.set(Op.ITER_NEXT, ITER_NEXT);
registry.set(Op.ITER_DONE, ITER_DONE);
registry.set(Op.ITER_VALUE, ITER_VALUE);
registry.set(Op.ITER_CLOSE, ITER_CLOSE);
registry.set(Op.ITER_RESULT_UNWRAP, ITER_RESULT_UNWRAP);
registry.set(Op.FORIN_INIT, FORIN_INIT);
registry.set(Op.FORIN_NEXT, FORIN_NEXT);
registry.set(Op.FORIN_DONE, FORIN_DONE);
registry.set(Op.GET_ASYNC_ITERATOR, GET_ASYNC_ITERATOR);
registry.set(Op.ASYNC_ITER_NEXT, ASYNC_ITER_NEXT);
registry.set(Op.ASYNC_ITER_DONE, ASYNC_ITER_DONE);
registry.set(Op.ASYNC_ITER_VALUE, ASYNC_ITER_VALUE);
registry.set(Op.ASYNC_ITER_CLOSE, ASYNC_ITER_CLOSE);
registry.set(Op.FOR_AWAIT_NEXT, FOR_AWAIT_NEXT);
registry.set(Op.CREATE_ASYNC_FROM_SYNC_ITER, CREATE_ASYNC_FROM_SYNC_ITER);
