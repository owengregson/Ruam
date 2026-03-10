/**
 * Generator and async opcode handlers in AST node form.
 *
 * Covers 12 opcodes:
 *  - Generator:       YIELD, YIELD_DELEGATE, CREATE_GENERATOR,
 *                     GENERATOR_RESUME, GENERATOR_RETURN, GENERATOR_THROW
 *  - Async:           AWAIT
 *  - Suspend/resume:  SUSPEND, RESUME
 *  - Async generator: ASYNC_GENERATOR_YIELD, ASYNC_GENERATOR_NEXT,
 *                     ASYNC_GENERATOR_RETURN, ASYNC_GENERATOR_THROW
 *
 * AWAIT conditionally emits `await` when ctx.isAsync is true.
 * YIELD/YIELD_DELEGATE push undefined (generators are stub-executed).
 * Generator and async generator lifecycle opcodes are stubs (break only).
 *
 * @module codegen/handlers/generators
 */

import { Op } from "../../compiler/opcodes.js";
import {
	type JsNode,
	exprStmt,
	breakStmt,
	call,
	id,
	un,
	lit,
	raw,
} from "../nodes.js";
import type { HandlerCtx } from "./registry.js";
import { registry } from "./registry.js";

// --- Yield handlers ---

/**
 * YIELD / YIELD_DELEGATE: push undefined (stub — generators run to completion).
 *
 * `W(void 0);break;`
 */
function YIELD_HANDLER(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(call(id(ctx.W), [un("void", lit(0))])), breakStmt()];
}

// --- Await handler ---

/**
 * AWAIT: await the top-of-stack value when in async mode, otherwise replace with undefined.
 *
 * Async: `S[P]=await S[P];break;`
 * Sync:  `S[P]=void 0;break;`
 */
function AWAIT(ctx: HandlerCtx): JsNode[] {
	if (ctx.isAsync) {
		return [
			raw(
				(ctx.debug
					? `${ctx.dbg}('AWAIT','awaiting:',typeof ${ctx.S}[${ctx.P}]==='object'?'[Promise]':${ctx.S}[${ctx.P}]);`
					: "") + `${ctx.S}[${ctx.P}]=await ${ctx.S}[${ctx.P}];break;`
			),
		];
	}
	return [raw(`${ctx.S}[${ctx.P}]=void 0;break;`)];
}

// --- Stub handlers (no-op, just break) ---

/**
 * CREATE_GENERATOR / GENERATOR_RESUME / GENERATOR_RETURN / GENERATOR_THROW:
 * Generator lifecycle stubs. `break;`
 */
function GENERATOR_STUB(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

/**
 * SUSPEND / RESUME: coroutine suspension stubs. `break;`
 */
function SUSPEND_STUB(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

/**
 * ASYNC_GENERATOR_YIELD / ASYNC_GENERATOR_NEXT / ASYNC_GENERATOR_RETURN /
 * ASYNC_GENERATOR_THROW: async generator lifecycle stubs. `break;`
 */
function ASYNC_GENERATOR_STUB(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

// --- Registration ---

registry.set(Op.YIELD, YIELD_HANDLER);
registry.set(Op.YIELD_DELEGATE, YIELD_HANDLER);
registry.set(Op.AWAIT, AWAIT);
registry.set(Op.CREATE_GENERATOR, GENERATOR_STUB);
registry.set(Op.GENERATOR_RESUME, GENERATOR_STUB);
registry.set(Op.GENERATOR_RETURN, GENERATOR_STUB);
registry.set(Op.GENERATOR_THROW, GENERATOR_STUB);
registry.set(Op.SUSPEND, SUSPEND_STUB);
registry.set(Op.RESUME, SUSPEND_STUB);
registry.set(Op.ASYNC_GENERATOR_YIELD, ASYNC_GENERATOR_STUB);
registry.set(Op.ASYNC_GENERATOR_NEXT, ASYNC_GENERATOR_STUB);
registry.set(Op.ASYNC_GENERATOR_RETURN, ASYNC_GENERATOR_STUB);
registry.set(Op.ASYNC_GENERATOR_THROW, ASYNC_GENERATOR_STUB);
