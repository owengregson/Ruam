/**
 * Unpack builder — packed-integer to string decoder for bytecode scattering.
 *
 * Builds a function that converts an array of 32-bit integers into a string
 * (4 characters per integer, big-endian byte order).
 *
 * @module ruamvm/builders/unpack
 */

import type { JsNode } from "../nodes.js";
import type { Name } from "../../naming/index.js";
import {
	id,
	lit,
	bin,
	assign,
	call,
	member,
	index,
	varDecl,
	exprStmt,
	forStmt,
	returnStmt,
	fnExpr,
	update,
	BOp,
	AOp,
	UpOp,
} from "../nodes.js";

/**
 * Build the unpack helper function as JsNode[].
 *
 * Equivalent JS:
 * ```js
 * var _up = function(a) {
 *   var s = "", i, n;
 *   for (i = 0; i < a.length; i++) {
 *     n = a[i];
 *     s += String.fromCharCode(n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255);
 *   }
 *   return s;
 * };
 * ```
 *
 * @param unpackName - Randomized name for the function (from RuntimeNames.unpack)
 * @returns JsNode[] containing a single var declaration
 */
export function buildUnpackFunction(unpackName: Name): JsNode[] {
	// Local variable names (will be renamed by obfuscateLocals)
	const a = "a",
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

	// String.fromCharCode(byte0, byte1, byte2, byte3)
	const fromCharCode = call(member(id("String"), "fromCharCode"), [
		byte0,
		byte1,
		byte2,
		byte3,
	]);

	const body: JsNode[] = [
		varDecl(s, lit("")),
		varDecl(i),
		varDecl(n),
		forStmt(
			assign(id(i), lit(0)),
			bin(BOp.Lt, id(i), member(id(a), "length")),
			update(UpOp.Inc, false, id(i)),
			[
				exprStmt(assign(id(n), index(id(a), id(i)))),
				exprStmt(assign(id(s), fromCharCode, AOp.Add)),
			]
		),
		returnStmt(id(s)),
	];

	return [varDecl(unpackName, fnExpr(undefined, [a], body))];
}
