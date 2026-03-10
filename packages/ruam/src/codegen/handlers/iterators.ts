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
 * All handlers use raw() due to multi-step object manipulation and iterator
 * protocol calls.
 *
 * @module codegen/handlers/iterators
 */

import { Op } from "../../compiler/opcodes.js";
import { type JsNode, raw } from "../nodes.js";
import type { HandlerCtx } from "./registry.js";
import { registry } from "./registry.js";

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
		raw(
			`var iterable=${ctx.popStr()};var iter=iterable[Symbol.iterator]();` +
				`var first=iter.next();` +
				`${ctx.pushStr("{_iter:iter,_done:!!first.done,_value:first.value}")};break;`
		),
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
		raw(
			`var iterObj=${ctx.popStr()};${ctx.pushStr("iterObj._value")};` +
				`var nxt=iterObj._iter.next();iterObj._done=!!nxt.done;iterObj._value=nxt.value;break;`
		),
	];
}

/**
 * ITER_DONE: peek at iterator object, push its done flag.
 */
function ITER_DONE(ctx: HandlerCtx): JsNode[] {
	return [raw(`var iterObj=${ctx.peekStr()};${ctx.pushStr("!!iterObj._done")};break;`)];
}

/**
 * ITER_VALUE: peek at iterator object, push its current value.
 */
function ITER_VALUE(ctx: HandlerCtx): JsNode[] {
	return [raw(`var iterObj=${ctx.peekStr()};${ctx.pushStr("iterObj._value")};break;`)];
}

/**
 * ITER_CLOSE: pop iterator object and call its return method if present.
 */
function ITER_CLOSE(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var iterObj=${ctx.popStr()};if(iterObj._iter.return)iterObj._iter.return();break;`
		),
	];
}

/**
 * ITER_RESULT_UNWRAP: peek at iterator, push value then done flag.
 */
function ITER_RESULT_UNWRAP(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var iterObj=${ctx.peekStr()};${ctx.pushStr("iterObj._value")};${ctx.pushStr("!!iterObj._done")};break;`
		),
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
		raw(
			`var obj=${ctx.popStr()};var keys=[];for(var k in obj)keys.push(k);` +
				`${ctx.pushStr("{_keys:keys,_idx:0}")};break;`
		),
	];
}

/**
 * FORIN_NEXT: pop for-in state, push next key.
 */
function FORIN_NEXT(ctx: HandlerCtx): JsNode[] {
	return [raw(`var fi=${ctx.popStr()};${ctx.pushStr("fi._keys[fi._idx++]")};break;`)];
}

/**
 * FORIN_DONE: peek at for-in state, push whether iteration is complete.
 */
function FORIN_DONE(ctx: HandlerCtx): JsNode[] {
	return [raw(`var fi=${ctx.peekStr()};${ctx.pushStr("fi._idx>=fi._keys.length")};break;`)];
}

// --- Async iterator handlers ---

/**
 * GET_ASYNC_ITERATOR: pop iterable, get async (or sync) iterator.
 *
 * Falls back to Symbol.iterator if Symbol.asyncIterator is not present.
 */
function GET_ASYNC_ITERATOR(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var iterable=${ctx.popStr()};` +
				`var method=iterable[Symbol.asyncIterator]||iterable[Symbol.iterator];` +
				`var iter=method.call(iterable);` +
				`${ctx.pushStr("{_iter:iter,_done:false,_value:void 0,_async:true}")};break;`
		),
	];
}

/**
 * ASYNC_ITER_NEXT: advance async iterator, optionally awaiting the result.
 *
 * When ctx.isAsync is true, emits `await` before `iterObj._iter.next()`.
 */
function ASYNC_ITER_NEXT(ctx: HandlerCtx): JsNode[] {
	const awaitKw = ctx.isAsync ? "await " : "";
	return [
		raw(
			`var iterObj=${ctx.peekStr()};` +
				`var result=${awaitKw}iterObj._iter.next();` +
				`iterObj._done=!!result.done;iterObj._value=result.value;break;`
		),
	];
}

/**
 * ASYNC_ITER_DONE: peek at async iterator, push its done flag.
 */
function ASYNC_ITER_DONE(ctx: HandlerCtx): JsNode[] {
	return [raw(`var iterObj=${ctx.peekStr()};${ctx.pushStr("!!iterObj._done")};break;`)];
}

/**
 * ASYNC_ITER_VALUE: peek at async iterator, push its current value.
 */
function ASYNC_ITER_VALUE(ctx: HandlerCtx): JsNode[] {
	return [raw(`var iterObj=${ctx.peekStr()};${ctx.pushStr("iterObj._value")};break;`)];
}

/**
 * ASYNC_ITER_CLOSE: pop async iterator and call its return method if present.
 *
 * When ctx.isAsync is true, emits `await` before the return call.
 */
function ASYNC_ITER_CLOSE(ctx: HandlerCtx): JsNode[] {
	const awaitKw = ctx.isAsync ? "await " : "";
	return [
		raw(
			`var iterObj=${ctx.popStr()};if(iterObj._iter.return)${awaitKw}iterObj._iter.return();break;`
		),
	];
}

/**
 * FOR_AWAIT_NEXT: advance async iterator, push the value.
 *
 * When ctx.isAsync is true, emits `await` before `iterObj._iter.next()`.
 */
function FOR_AWAIT_NEXT(ctx: HandlerCtx): JsNode[] {
	const awaitKw = ctx.isAsync ? "await " : "";
	return [
		raw(
			`var iterObj=${ctx.peekStr()};` +
				`var result=${awaitKw}iterObj._iter.next();` +
				`iterObj._done=!!result.done;iterObj._value=result.value;` +
				`${ctx.pushStr("result.value")};break;`
		),
	];
}

// --- Conversion handler ---

/**
 * CREATE_ASYNC_FROM_SYNC_ITER: pop sync iterator, wrap as async-compatible.
 */
function CREATE_ASYNC_FROM_SYNC_ITER(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var it=${ctx.popStr()};${ctx.pushStr("{_iter:it,_done:false,_value:void 0}")};break;`
		),
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
