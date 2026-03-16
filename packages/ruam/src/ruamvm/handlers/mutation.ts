/**
 * Runtime opcode mutation handler.
 *
 * The MUTATE opcode permutes the handler table `_ht` at runtime,
 * changing which handler index each physical opcode maps to.
 * Uses the same deterministic swap algorithm as the build-time encoder.
 *
 * @module ruamvm/handlers/mutation
 */

import { Op } from "../../compiler/opcodes.js";
import { registry } from "./registry.js";
import type { HandlerCtx } from "./registry.js";
import {
	BOp,
	UpOp,
	id,
	lit,
	bin,
	un,
	assign,
	varDecl,
	forStmt,
	exprStmt,
	index,
	call,
	member,
	update,
} from "../nodes.js";
import type { JsNode } from "../nodes.js";

/** Number of swaps per mutation (must match compiler/opcode-mutation.ts). */
const SWAPS_PER_MUTATION = 4;

registry.set(Op.MUTATE, (ctx: HandlerCtx): JsNode[] => {
	// At runtime, this handler:
	// 1. Reads the mutation seed from the operand
	// 2. Performs SWAPS_PER_MUTATION deterministic swaps on _ht
	//
	// var _ms = O;
	// for (var _mk = 0; _mk < 4; _mk++) {
	//   _ms = imul(_ms, 1664525) + 1013904223 >>> 0;
	//   var _mi = (_ms >>> 16) % _ht.length;
	//   _ms = imul(_ms, 1664525) + 1013904223 >>> 0;
	//   var _mj = (_ms >>> 16) % _ht.length;
	//   var _mt = _ht[_mi]; _ht[_mi] = _ht[_mj]; _ht[_mj] = _mt;
	// }

	const ms = ctx.t("_ms"); // mutation seed state
	const mk = ctx.t("_mk"); // loop counter
	const mi = ctx.t("_mi"); // swap index i
	const mj = ctx.t("_mj"); // swap index j
	const mt = ctx.t("_mt"); // temp for swap
	const ht = ctx.t("_ht"); // handler table

	// LCG step: _ms = (imul(_ms, 1664525) + 1013904223) >>> 0
	const lcgStep = bin(
		BOp.Ushr,
		bin(
			BOp.Add,
			call(member(id("Math"), "imul"), [id(ms), lit(1664525)]),
			lit(1013904223)
		),
		lit(0)
	);

	// (_ms >>> 16) % _ht.length
	const modLen = bin(
		BOp.Mod,
		bin(BOp.Ushr, id(ms), lit(16)),
		member(id(ht), "length")
	);

	return [
		// var _ms = O
		varDecl(ms, id(ctx.O)),

		// for (var _mk = 0; _mk < SWAPS; _mk++)
		forStmt(
			varDecl(mk, lit(0)),
			bin(BOp.Lt, id(mk), lit(SWAPS_PER_MUTATION)),
			update(UpOp.Inc, true, id(mk)),
			[
				// _ms = LCG(_ms)
				exprStmt(assign(id(ms), lcgStep)),
				// var _mi = (_ms >>> 16) % _ht.length
				varDecl(mi, modLen),

				// _ms = LCG(_ms)
				exprStmt(assign(id(ms), lcgStep)),
				// var _mj = (_ms >>> 16) % _ht.length
				varDecl(mj, modLen),

				// var _mt = _ht[_mi]; _ht[_mi] = _ht[_mj]; _ht[_mj] = _mt
				varDecl(mt, index(id(ht), id(mi))),
				exprStmt(assign(index(id(ht), id(mi)), index(id(ht), id(mj)))),
				exprStmt(assign(index(id(ht), id(mj)), id(mt))),
			]
		),
	];
});
