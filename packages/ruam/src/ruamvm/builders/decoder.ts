/**
 * Decoder builder — assembles RC4, custom binary decoder, and string
 * decoder functions as AST nodes.
 *
 * All runtime JS is generated via pure AST construction — no raw() nodes.
 * Dense bit-manipulation expressions are composed via nested BinOp nodes.
 *
 * @module ruamvm/builders/decoder
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../encoding/names.js";
import type { SplitFn } from "../constant-splitting.js";
import {
	assign,
	bin,
	call,
	exprStmt,
	fn,
	forStmt,
	id,
	ifStmt,
	index,
	lit,
	member,
	newExpr,
	obj,
	returnStmt,
	un,
	update,
	varDecl,
} from "../nodes.js";

// --- Local helpers for dense bit manipulation ---

/** `a ^ b` */
const xor = (a: JsNode, b: JsNode): JsNode => bin("^", a, b);

/** `a & b` */
const band = (a: JsNode, b: JsNode): JsNode => bin("&", a, b);

/** `(expr) >>> 0` — unsigned coercion */
const u32 = (expr: JsNode): JsNode => bin(">>>", expr, lit(0));

// --- Custom binary decoder ---

/**
 * Build the custom binary decoder infrastructure as JsNode[].
 *
 * Produces:
 * 1. Alphabet variable declaration (`var _AL = "shuffled64chars"`)
 * 2. Binary decode function (same bit-packing as base64, custom alphabet)
 *
 * Always emitted — all bytecode units use custom binary encoding.
 *
 * @param names    - Randomized runtime identifier names.
 * @param alphabet - The shuffled 64-char alphabet string (from build-time).
 * @returns Array of JsNode containing the alphabet var and decode function.
 */
export function buildBinaryDecoderSource(
	names: RuntimeNames,
	alphabet: string
): JsNode[] {
	return [
		// var _AL = "shuffled64chars";
		varDecl(names.alpha, lit(alphabet)),
		buildCustomDecodeFunction(names),
	];
}

/**
 * Build the custom cipher function as JsNode[].
 *
 * Only emitted when bytecode encryption is enabled. Uses FNV-1a key
 * derivation + LCG keystream instead of RC4, avoiding the recognizable
 * S-box/KSA/PRGA pattern. Constants go through the splitter.
 *
 * @param names - Randomized runtime identifier names.
 * @param split - Optional constant splitter for numeric obfuscation.
 * @returns Single-element array containing the cipher function declaration.
 */
export function buildRc4Source(
	names: RuntimeNames,
	split?: SplitFn
): JsNode[] {
	return [buildCipherFunction(names, split)];
}

// --- Custom decode function ---

/**
 * Build the custom binary decode function.
 *
 * Reverses the custom 64-char alphabet encoding produced at build time.
 * Builds a reverse lookup table from the alphabet variable on each call
 * (O(64) — negligible since decode runs once per unit load).
 *
 * ```js
 * function _bd(str) {
 *   var T = {};
 *   var A = _AL;
 *   for (var k = 0; k < A.length; k++) T[A.charCodeAt(k)] = k;
 *   var n = str.length;
 *   var out = new Uint8Array((n * 3 >> 2) + 3);
 *   var j = 0;
 *   for (var i = 0; i < n; i += 4) {
 *     var a = T[str.charCodeAt(i)] | 0;
 *     var b = T[str.charCodeAt(i + 1)] | 0;
 *     var c = T[str.charCodeAt(i + 2)] | 0;
 *     var d = T[str.charCodeAt(i + 3)] | 0;
 *     out[j++] = (a << 2) | (b >> 4);
 *     if (i + 2 < n) out[j++] = ((b & 15) << 4) | (c >> 2);
 *     if (i + 3 < n) out[j++] = ((c & 3) << 6) | d;
 *   }
 *   return out.subarray(0, j);
 * }
 * ```
 */
function buildCustomDecodeFunction(names: RuntimeNames): JsNode {
	const str = id("str");
	const T = id("T");
	const A = id("A");
	const n = id("n");
	const out = id("out");
	const j = id("j");
	const i = id("i");
	const k = id("k");

	// Helper: T[str.charCodeAt(idx)] | 0
	const lookup = (idx: JsNode): JsNode =>
		bin("|", index(T, call(member(str, "charCodeAt"), [idx])), lit(0));

	// Helper: out[j++] = expr
	const writeOut = (expr: JsNode): JsNode =>
		exprStmt(assign(index(out, update("++", false, j)), expr));

	const body: JsNode[] = [
		// var T = {};
		varDecl("T", obj()),
		// var A = _AL;
		varDecl("A", id(names.alpha)),

		// for (var k = 0; k < A.length; k++) T[A.charCodeAt(k)] = k;
		forStmt(
			varDecl("k", lit(0)),
			bin("<", k, member(A, "length")),
			update("++", false, k),
			[
				exprStmt(
					assign(
						index(T, call(member(A, "charCodeAt"), [k])),
						k
					)
				),
			]
		),

		// var n = str.length;
		varDecl("n", member(str, "length")),
		// var out = new Uint8Array((n * 3 >> 2) + 3);
		varDecl(
			"out",
			newExpr(id("Uint8Array"), [
				bin("+", bin(">>", bin("*", n, lit(3)), lit(2)), lit(3)),
			])
		),
		// var j = 0;
		varDecl("j", lit(0)),

		// Decode loop: for (var i = 0; i < n; i += 4) { ... }
		forStmt(
			varDecl("i", lit(0)),
			bin("<", i, n),
			assign(i, lit(4), "+"),
			[
				// var a = T[str.charCodeAt(i)] | 0;
				varDecl("a", lookup(i)),
				// var b = T[str.charCodeAt(i + 1)] | 0;
				varDecl("b", lookup(bin("+", i, lit(1)))),
				// var c = T[str.charCodeAt(i + 2)] | 0;
				varDecl("c", lookup(bin("+", i, lit(2)))),
				// var d = T[str.charCodeAt(i + 3)] | 0;
				varDecl("d", lookup(bin("+", i, lit(3)))),

				// out[j++] = (a << 2) | (b >> 4);
				writeOut(
					bin(
						"|",
						bin("<<", id("a"), lit(2)),
						bin(">>", id("b"), lit(4))
					)
				),

				// if (i + 2 < n) out[j++] = ((b & 15) << 4) | (c >> 2);
				ifStmt(bin("<", bin("+", i, lit(2)), n), [
					writeOut(
						bin(
							"|",
							bin("<<", band(id("b"), lit(15)), lit(4)),
							bin(">>", id("c"), lit(2))
						)
					),
				]),

				// if (i + 3 < n) out[j++] = ((c & 3) << 6) | d;
				ifStmt(bin("<", bin("+", i, lit(3)), n), [
					writeOut(
						bin(
							"|",
							bin("<<", band(id("c"), lit(3)), lit(6)),
							id("d")
						)
					),
				]),
			]
		),

		// return out.subarray(0, j);
		returnStmt(call(member(out, "subarray"), [lit(0), j])),
	];

	return fn(names.b64, ["str"], body);
}

// --- Custom cipher (replaces RC4) ---

/**
 * Build the custom cipher function — FNV-1a key derivation + LCG keystream.
 *
 * Avoids RC4's recognizable S-box/KSA/PRGA pattern. Uses the same
 * FNV-1a and LCG primitives already present in other runtime code,
 * making the cipher blend in as a hash-and-transform utility.
 *
 * ```js
 * function cipher(data, key) {
 *   var h = FNV_BASIS;
 *   for (var i = 0; i < key.length; i++) {
 *     h = Math.imul(h ^ key.charCodeAt(i), FNV_PRIME);
 *   }
 *   h = h >>> 0;
 *   var out = new Uint8Array(data.length);
 *   for (var i = 0; i < data.length; i++) {
 *     h = (Math.imul(h, LCG_MULT) + LCG_INC) >>> 0;
 *     out[i] = data[i] ^ (h >>> 16 & 255);
 *   }
 *   return out;
 * }
 * ```
 */
function buildCipherFunction(
	names: RuntimeNames,
	split?: SplitFn
): JsNode {
	const L = (v: number): JsNode => (split ? split(v) : lit(v));
	const data = id("data");
	const key = id("key");
	const h = id("h");
	const i = id("i");
	const out = id("out");

	const body: JsNode[] = [
		// var h = FNV_BASIS;
		varDecl("h", L(0x811c9dc5)),

		// for(var i=0; i<key.length; i++) {
		//   h = Math.imul(h ^ key.charCodeAt(i), FNV_PRIME);
		// }
		forStmt(
			varDecl("i", lit(0)),
			bin("<", i, member(key, "length")),
			update("++", false, i),
			[
				exprStmt(
					assign(
						h,
						call(member(id("Math"), "imul"), [
							xor(h, call(member(key, "charCodeAt"), [i])),
							L(0x01000193),
						])
					)
				),
			]
		),

		// h = h >>> 0;
		exprStmt(assign(h, u32(h))),

		// var out = new Uint8Array(data.length);
		varDecl("out", newExpr(id("Uint8Array"), [member(data, "length")])),

		// for(var i=0; i<data.length; i++) {
		//   h = (Math.imul(h, LCG_MULT) + LCG_INC) >>> 0;
		//   out[i] = data[i] ^ (h >>> 16 & 255);
		// }
		forStmt(
			assign(i, lit(0)),
			bin("<", i, member(data, "length")),
			update("++", false, i),
			[
				// h = (Math.imul(h, LCG_MULT) + LCG_INC) >>> 0;
				exprStmt(
					assign(
						h,
						u32(
							bin(
								"+",
								call(member(id("Math"), "imul"), [
									h,
									L(1664525),
								]),
								L(1013904223)
							)
						)
					)
				),
				// out[i] = data[i] ^ (h >>> 16 & 255);
				exprStmt(
					assign(
						index(out, i),
						xor(
							index(data, i),
							band(bin(">>>", h, lit(16)), lit(255))
						)
					)
				),
			]
		),

		// return out;
		returnStmt(out),
	];

	return fn(names.rc4, ["data", "key"], body);
}

// --- String constant decoder ---

/**
 * Build the string constant decoder function as JsNode[].
 *
 * The decoder XOR-decodes encoded constant pool strings at load time
 * using an LCG key stream.
 *
 * When `useImplicitKey` is true, the generated function accepts the
 * master key as its first parameter (derived at load time from unit
 * metadata by the caller). Otherwise the key is embedded as a numeric
 * literal.
 *
 * @param names - Randomized runtime identifier names.
 * @param stringKey - The numeric XOR key for string encoding.
 * @param useImplicitKey - Whether the key is passed as a parameter (true) or embedded (false).
 * @param split - Optional constant splitter for numeric obfuscation.
 * @returns An array of JsNode containing the decoder function declaration.
 */
export function buildStringDecoderSource(
	names: RuntimeNames,
	stringKey: number,
	useImplicitKey: boolean,
	split?: SplitFn
): JsNode[] {
	if (useImplicitKey) {
		return [buildStrDecFunction(names, undefined, split)];
	}
	return [buildStrDecFunction(names, stringKey, split)];
}

/**
 * Build the strDec function.
 *
 * When `embeddedKey` is undefined, the function takes `mk` as first parameter
 * (implicit key mode):
 * ```js
 * function strDec(mk, b, x) {
 *   var k = (mk ^ (x * 0x9E3779B9)) >>> 0; var s = '';
 *   for (var i = 0; i < b.length; i++) {
 *     k = (k * 1664525 + 1013904223) >>> 0;
 *     s += String.fromCharCode(b[i] ^ (k & 65535));
 *   }
 *   return s;
 * }
 * ```
 *
 * When `embeddedKey` is provided, the key is embedded as a literal:
 * ```js
 * function strDec(b, x) {
 *   var k = (KEY ^ (x * 0x9E3779B9)) >>> 0; var s = '';
 *   ...
 * }
 * ```
 */
function buildStrDecFunction(
	names: RuntimeNames,
	embeddedKey: number | undefined,
	split?: SplitFn
): JsNode {
	const L = (v: number): JsNode => (split ? split(v) : lit(v));
	const implicit = embeddedKey === undefined;
	const params = implicit ? ["mk", "b", "x"] : ["b", "x"];

	const b = id("b");
	const x = id("x");
	const k = id("k");
	const s = id("s");
	const i = id("i");

	// The key source: either the `mk` parameter or the embedded numeric literal
	const keySource: JsNode = implicit ? id("mk") : lit(embeddedKey >>> 0);

	const body: JsNode[] = [
		// var k = (keySource ^ (x * 0x9E3779B9)) >>> 0;
		varDecl("k", u32(xor(keySource, bin("*", x, L(0x9e3779b9))))),
		// var s = '';
		varDecl("s", lit("")),

		// for(var i=0; i<b.length; i++) {
		//   k = (k * 1664525 + 1013904223) >>> 0;
		//   s += String.fromCharCode(b[i] ^ (k & 65535));
		// }
		forStmt(
			varDecl("i", lit(0)),
			bin("<", i, member(b, "length")),
			update("++", false, i),
			[
				// k = (k * 1664525 + 1013904223) >>> 0;
				exprStmt(
					assign(
						k,
						u32(bin("+", bin("*", k, L(1664525)), L(1013904223)))
					)
				),
				// s += String.fromCharCode(b[i] ^ (k & 65535));
				exprStmt(
					assign(
						s,
						call(member(id("String"), "fromCharCode"), [
							xor(index(b, i), band(k, lit(65535))),
						]),
						"+"
					)
				),
			]
		),

		// return s;
		returnStmt(s),
	];

	return fn(names.strDec, params, body);
}
