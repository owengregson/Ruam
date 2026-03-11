/**
 * Decoder builder — assembles RC4, base64, and string decoder functions as AST nodes.
 *
 * All runtime JS is generated via pure AST construction — no raw() nodes.
 * Dense bit-manipulation expressions are composed via nested BinOp nodes.
 *
 * @module ruamvm/builders/decoder
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../encoding/names.js";
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

// --- RC4 + Base64 decoder ---

/**
 * Build the RC4 cipher and base64 decoder functions as JsNode[].
 *
 * Produces two function declarations:
 * - RC4 stream cipher (symmetric encrypt/decrypt)
 * - Base64 decoder (atob polyfill with Buffer fallback)
 *
 * @param names - Randomized runtime identifier names.
 * @returns An array of JsNode containing both function declarations.
 */
export function buildDecoderSource(names: RuntimeNames): JsNode[] {
	return [buildRc4Function(names), buildB64Function(names)];
}

// --- RC4 ---

/**
 * Build the RC4 stream cipher function.
 *
 * ```js
 * function rc4(data, key) {
 *   var S = new Array(256); var j = 0; var i;
 *   for (i = 0; i < 256; i++) S[i] = i;
 *   for (i = 0; i < 256; i++) {
 *     j = (j + S[i] + key.charCodeAt(i % key.length)) & 255;
 *     var t = S[i]; S[i] = S[j]; S[j] = t;
 *   }
 *   i = 0; j = 0;
 *   var out = new Uint8Array(data.length);
 *   for (var k = 0; k < data.length; k++) {
 *     i = (i + 1) & 255;
 *     j = (j + S[i]) & 255;
 *     var t = S[i]; S[i] = S[j]; S[j] = t;
 *     out[k] = data[k] ^ S[(S[i] + S[j]) & 255];
 *   }
 *   return out;
 * }
 * ```
 */
function buildRc4Function(names: RuntimeNames): JsNode {
	const S = id("S");
	const i = id("i");
	const j = id("j");
	const t = id("t");
	const data = id("data");
	const key = id("key");
	const k = id("k");
	const out = id("out");
	const Si = index(S, i); // S[i]
	const Sj = index(S, j); // S[j]

	const body: JsNode[] = [
		// var S = new Array(256);
		varDecl("S", newExpr(id("Array"), [lit(256)])),
		// var j = 0;
		varDecl("j", lit(0)),
		// var i;
		varDecl("i"),

		// --- KSA init: for(i=0; i<256; i++) S[i] = i; ---
		forStmt(
			assign(i, lit(0)),
			bin("<", i, lit(256)),
			update("++", false, i),
			[exprStmt(assign(Si, i))]
		),

		// --- KSA shuffle ---
		// for(i=0; i<256; i++) {
		//   j = (j + S[i] + key.charCodeAt(i % key.length)) & 255;
		//   var t = S[i]; S[i] = S[j]; S[j] = t;
		// }
		forStmt(
			assign(i, lit(0)),
			bin("<", i, lit(256)),
			update("++", false, i),
			[
				// j = (j + S[i] + key.charCodeAt(i % key.length)) & 255;
				exprStmt(
					assign(
						j,
						band(
							bin(
								"+",
								bin("+", j, Si),
								call(member(key, "charCodeAt"), [
									bin("%", i, member(key, "length")),
								])
							),
							lit(255)
						)
					)
				),
				// var t = S[i];
				varDecl("t", Si),
				// S[i] = S[j];
				exprStmt(assign(Si, Sj)),
				// S[j] = t;
				exprStmt(assign(Sj, t)),
			]
		),

		// i = 0;
		exprStmt(assign(i, lit(0))),
		// j = 0;
		exprStmt(assign(j, lit(0))),
		// var out = new Uint8Array(data.length);
		varDecl("out", newExpr(id("Uint8Array"), [member(data, "length")])),

		// --- PRGA ---
		// for(var k=0; k<data.length; k++) {
		//   i = (i + 1) & 255;
		//   j = (j + S[i]) & 255;
		//   var t = S[i]; S[i] = S[j]; S[j] = t;
		//   out[k] = data[k] ^ S[(S[i] + S[j]) & 255];
		// }
		forStmt(
			varDecl("k", lit(0)),
			bin("<", k, member(data, "length")),
			update("++", false, k),
			[
				// i = (i + 1) & 255;
				exprStmt(assign(i, band(bin("+", i, lit(1)), lit(255)))),
				// j = (j + S[i]) & 255;
				exprStmt(assign(j, band(bin("+", j, Si), lit(255)))),
				// var t = S[i];
				varDecl("t", Si),
				// S[i] = S[j];
				exprStmt(assign(Si, Sj)),
				// S[j] = t;
				exprStmt(assign(Sj, t)),
				// out[k] = data[k] ^ S[(S[i] + S[j]) & 255];
				exprStmt(
					assign(
						index(out, k),
						xor(
							index(data, k),
							index(S, band(bin("+", Si, Sj), lit(255)))
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

// --- Base64 ---

/**
 * Build the base64 decoder function.
 *
 * ```js
 * function b64(str) {
 *   if (typeof atob === 'function') {
 *     var bin = atob(str);
 *     var bytes = new Uint8Array(bin.length);
 *     for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
 *     return bytes;
 *   } else {
 *     return new Uint8Array(Buffer.from(str, 'base64'));
 *   }
 * }
 * ```
 */
function buildB64Function(names: RuntimeNames): JsNode {
	const str = id("str");
	const binVar = id("bin");
	const bytes = id("bytes");
	const i = id("i");

	const body: JsNode[] = [
		ifStmt(
			// typeof atob === 'function'
			bin("===", un("typeof", id("atob")), lit("function")),
			// then: atob path
			[
				// var bin = atob(str);
				varDecl("bin", call(id("atob"), [str])),
				// var bytes = new Uint8Array(bin.length);
				varDecl(
					"bytes",
					newExpr(id("Uint8Array"), [member(binVar, "length")])
				),
				// for(var i=0; i<bin.length; i++) bytes[i] = bin.charCodeAt(i);
				forStmt(
					varDecl("i", lit(0)),
					bin("<", i, member(binVar, "length")),
					update("++", false, i),
					[
						exprStmt(
							assign(
								index(bytes, i),
								call(member(binVar, "charCodeAt"), [i])
							)
						),
					]
				),
				// return bytes;
				returnStmt(bytes),
			],
			// else: Buffer path
			[
				returnStmt(
					newExpr(id("Uint8Array"), [
						call(member(id("Buffer"), "from"), [
							str,
							lit("base64"),
						]),
					])
				),
			]
		),
	];

	return fn(names.b64, ["str"], body);
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
 * @returns An array of JsNode containing the decoder function declaration.
 */
export function buildStringDecoderSource(
	names: RuntimeNames,
	stringKey: number,
	useImplicitKey: boolean
): JsNode[] {
	if (useImplicitKey) {
		return [buildStrDecFunction(names, undefined)];
	}
	return [buildStrDecFunction(names, stringKey)];
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
	embeddedKey: number | undefined
): JsNode {
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
		varDecl("k", u32(xor(keySource, bin("*", x, lit(0x9e3779b9))))),
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
						u32(
							bin("+", bin("*", k, lit(1664525)), lit(1013904223))
						)
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
