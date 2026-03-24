/**
 * Packed-integer decoder for bytecode scattering.
 *
 * Builds a function that converts packed 32-bit integer(s) into a string.
 * Handles both single integers (4 chars) and arrays of integers (N*4 chars).
 * Single ints are wrapped in an array internally so one code path handles both.
 *
 * @module ruamvm/builders/unpack
 */

import type { JsNode } from "../nodes.js";
import type { Name } from "../../naming/index.js";
import {
	id,
	lit,
	bin,
	un,
	assign,
	call,
	member,
	index,
	varDecl,
	arr,
	exprStmt,
	ifStmt,
	forStmt,
	returnStmt,
	fnExpr,
	update,
	BOp,
	UOp,
	AOp,
	UpOp,
} from "../nodes.js";

/**
 * Build the decode helper function as JsNode[].
 *
 * Equivalent JS:
 * ```js
 * var D = function(v) {
 *   if (typeof v === "number") v = [v];
 *   var s = "", i, n;
 *   for (i = 0; i < v.length; i++) {
 *     n = v[i];
 *     s += String.fromCharCode(n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255);
 *   }
 *   return s;
 * };
 * ```
 *
 * @param decodeName - Randomized name for the function
 * @returns JsNode[] containing a single var declaration
 */
export function buildDecodeFunction(decodeName: Name): JsNode[] {
	const v = "v",
		s = "s",
		i = "i",
		n = "n";

	// n >>> 24 & 255
	const byte0 = bin(BOp.BitAnd, bin(BOp.Ushr, id(n), lit(24)), lit(255));
	// n >>> 16 & 255
	const byte1 = bin(BOp.BitAnd, bin(BOp.Ushr, id(n), lit(16)), lit(255));
	// n >>> 8 & 255
	const byte2 = bin(BOp.BitAnd, bin(BOp.Ushr, id(n), lit(8)), lit(255));
	// n & 255
	const byte3 = bin(BOp.BitAnd, id(n), lit(255));

	const fromCharCode = call(member(id("String"), "fromCharCode"), [
		byte0,
		byte1,
		byte2,
		byte3,
	]);

	const body: JsNode[] = [
		// if (typeof v === "number") v = [v];
		ifStmt(bin(BOp.Seq, un(UOp.Typeof, id(v)), lit("number")), [
			exprStmt(assign(id(v), arr(id(v)))),
		]),
		varDecl(s, lit("")),
		varDecl(i),
		varDecl(n),
		forStmt(
			assign(id(i), lit(0)),
			bin(BOp.Lt, id(i), member(id(v), "length")),
			update(UpOp.Inc, false, id(i)),
			[
				exprStmt(assign(id(n), index(id(v), id(i)))),
				exprStmt(assign(id(s), fromCharCode, AOp.Add)),
			]
		),
		returnStmt(id(s)),
	];

	return [varDecl(decodeName, fnExpr(undefined, [v], body))];
}
