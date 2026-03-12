/**
 * Loader builder — assembles the bytecode loader function and shared
 * declarations as AST nodes.
 *
 * All runtime JS is generated via pure AST construction — no raw() nodes.
 *
 * @module ruamvm/builders/loader
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../encoding/names.js";
import { WATERMARK_NAME } from "../../encoding/names.js";
import {
	arr,
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
	ternary,
	un,
	update,
	varDecl,
} from "../nodes.js";

// --- Builder ---

/**
 * Build the bytecode loader function and optional shared declarations
 * as JsNode[].
 *
 * Returns an array containing:
 * 1. Shared variable declarations (watermark, depth, callStack, cache) —
 *    omitted when `options.skipSharedDecls` is true.
 * 2. The `load(id)` function declaration.
 *
 * The loader resolves bytecode units by ID from the bytecode table,
 * handles both encrypted (binary) and unencrypted (JSON) formats,
 * revives RegExp/BigInt constants, decodes XOR-encoded strings when
 * string encoding is enabled, and converts instruction arrays to
 * Int32Array for performance.
 *
 * @param encrypt            Whether bytecode is RC4-encrypted (binary format).
 * @param names              Runtime identifier mapping.
 * @param hasStringEncoding  Whether constant pool strings are XOR-encoded.
 * @param rollingCipher      Whether rolling cipher is enabled (affects string decode key derivation).
 * @param options            Additional options.
 * @returns Array of JsNode representing the shared declarations and loader function.
 */
export function buildLoader(
	encrypt: boolean,
	names: RuntimeNames,
	hasStringEncoding: boolean = false,
	rollingCipher: boolean = false,
	options?: { skipSharedDecls?: boolean }
): JsNode[] {
	const nodes: JsNode[] = [];

	// --- Shared declarations ---

	if (!options?.skipSharedDecls) {
		nodes.push(
			varDecl(WATERMARK_NAME, un("!", lit(0))),
			varDecl(names.depth, lit(0)),
			varDecl(names.callStack, arr()),
			varDecl(names.cache, obj())
		);
	}

	// --- Load function ---

	nodes.push(
		buildLoadFunction(encrypt, names, hasStringEncoding, rollingCipher)
	);

	return nodes;
}

// --- Internals ---

/** Shorthand: `cache[id]` index expression */
function cacheId(names: RuntimeNames): JsNode {
	return index(id(names.cache), id("id"));
}

/**
 * Build the string decode branch for a constant at index j in the constant
 * pool `target`. Returns an IfStmt or undefined if string encoding is off.
 *
 * Produces: `if(Array.isArray(cv)){target.c[j] = strDec([key,] cv, j);}`
 */
function buildStrDecodeCheck(
	names: RuntimeNames,
	hasStringEncoding: boolean,
	rollingCipher: boolean,
	target: string
): JsNode | undefined {
	if (!hasStringEncoding) return undefined;

	// strDec(cv, j)  or  strDec(rcDeriveKey(target), cv, j)
	const args: JsNode[] = rollingCipher
		? [call(id(names.rcDeriveKey), [id(target)]), id("cv"), id("j")]
		: [id("cv"), id("j")];

	return ifStmt(call(member(id("Array"), "isArray"), [id("cv")]), [
		exprStmt(
			assign(
				index(member(id(target), "c"), id("j")),
				call(id(names.strDec), args)
			)
		),
	]);
}

/**
 * Build the constant revival loop for a unit variable named `target`.
 *
 * ```js
 * for(var j=0; j<target.c.length; j++){
 *   var cv = target.c[j];
 *   if(cv && cv.__regex__){ target.c[j] = new RegExp(cv.p, cv.f); }
 *   else if(cv && cv.__bigint__){ target.c[j] = BigInt(cv.v); }
 *   [else if(Array.isArray(cv)){ target.c[j] = strDec(...); }]
 * }
 * ```
 */
function buildRevivalLoop(
	names: RuntimeNames,
	target: string,
	hasStringEncoding: boolean,
	rollingCipher: boolean
): JsNode {
	const tgt = id(target);
	const cArr = member(tgt, "c"); // target.c
	const cJ = index(cArr, id("j")); // target.c[j]
	const cv = id("cv");

	// --- Loop body ---
	const body: JsNode[] = [];

	// var cv = target.c[j];
	body.push(varDecl("cv", cJ));

	// Build the if/else-if chain from inside out:
	// Start with the innermost else-if (string decode, if enabled)
	const strCheck = buildStrDecodeCheck(
		names,
		hasStringEncoding,
		rollingCipher,
		target
	);

	// else if(cv && cv.__bigint__){ target.c[j] = BigInt(cv.v); }
	const bigintBranch = ifStmt(
		bin("&&", cv, member(cv, "__bigint__")),
		[exprStmt(assign(cJ, call(id("BigInt"), [member(cv, "v")])))],
		strCheck ? [strCheck] : undefined
	);

	// if(cv && cv.__regex__){ target.c[j] = new RegExp(cv.p, cv.f); }
	// else if(cv && cv.__bigint__){ ... }
	body.push(
		ifStmt(
			bin("&&", cv, member(cv, "__regex__")),
			[
				exprStmt(
					assign(
						cJ,
						newExpr(id("RegExp"), [
							member(cv, "p"),
							member(cv, "f"),
						])
					)
				),
			],
			[bigintBranch]
		)
	);

	return forStmt(
		varDecl("j", lit(0)),
		bin("<", id("j"), member(cArr, "length")),
		update("++", false, id("j")),
		body
	);
}

/**
 * Build: `if(target.i) target.i = new Int32Array(target.i);`
 */
function buildInt32Conversion(target: string): JsNode {
	const tgt = id(target);
	return ifStmt(member(tgt, "i"), [
		exprStmt(
			assign(
				member(tgt, "i"),
				newExpr(id("Int32Array"), [member(tgt, "i")])
			)
		),
	]);
}

/**
 * Build: `if(target.i && !(target.i instanceof Int32Array)) target.i = new Int32Array(target.i);`
 */
function buildInt32ConversionGuarded(target: string): JsNode {
	const tgt = id(target);
	return ifStmt(
		bin(
			"&&",
			member(tgt, "i"),
			un("!", bin("instanceof", member(tgt, "i"), id("Int32Array")))
		),
		[
			exprStmt(
				assign(
					member(tgt, "i"),
					newExpr(id("Int32Array"), [member(tgt, "i")])
				)
			),
		]
	);
}

/**
 * Build the load(id) function as a FnDecl AST node.
 *
 * The function has three paths:
 * - Cache hit: return immediately.
 * - String value (JSON or encrypted): parse/decrypt, revive constants, cache.
 * - Object value (pre-parsed): revive constants in-place, cache.
 */
function buildLoadFunction(
	encrypt: boolean,
	names: RuntimeNames,
	hasStringEncoding: boolean,
	rollingCipher: boolean
): JsNode {
	const body: JsNode[] = [];

	// --- Cache check: if(cache[id]) return cache[id]; ---
	body.push(ifStmt(cacheId(names), [returnStmt(cacheId(names))]));

	// --- var raw = _ru4m ? bt[id] : void 0; ---
	body.push(
		varDecl(
			"raw",
			ternary(
				id(WATERMARK_NAME),
				index(id(names.bt), id("id")),
				un("void", lit(0))
			)
		)
	);

	// --- String branch vs Object branch ---
	const stringBranchBody = encrypt
		? buildEncryptedPath(names, hasStringEncoding, rollingCipher)
		: buildJsonPath(names, hasStringEncoding, rollingCipher);

	const objectBranchBody = buildObjectPath(
		names,
		hasStringEncoding,
		rollingCipher
	);

	body.push(
		ifStmt(
			bin("===", un("typeof", id("raw")), lit("string")),
			stringBranchBody,
			objectBranchBody
		)
	);

	// --- return cache[id]; ---
	body.push(returnStmt(cacheId(names)));

	return fn(names.load, ["id"], body);
}

/**
 * Build the encrypted path body:
 * ```js
 * var bytes = b64(raw);
 * var key = fp().toString(16);
 * var dec = rc4(bytes, key);
 * var eu = deser(dec);
 * // string decode loop (if string encoding is on)
 * if(eu && eu.i) eu.i = new Int32Array(eu.i);
 * cache[id] = eu;
 * ```
 */
function buildEncryptedPath(
	names: RuntimeNames,
	hasStringEncoding: boolean,
	rollingCipher: boolean
): JsNode[] {
	const nodes: JsNode[] = [
		// var bytes = b64(raw);
		varDecl("bytes", call(id(names.b64), [id("raw")])),
		// var key = fp().toString(16);
		varDecl(
			"key",
			call(member(call(id(names.fp), []), "toString"), [lit(16)])
		),
		// var dec = rc4(bytes, key);
		varDecl("dec", call(id(names.rc4), [id("bytes"), id("key")])),
		// var eu = deser(dec);
		varDecl("eu", call(id(names.deser), [id("dec")])),
	];

	// String decode loop (same revival as JSON path)
	if (hasStringEncoding) {
		nodes.push(
			buildRevivalLoop(names, "eu", hasStringEncoding, rollingCipher)
		);
	}

	nodes.push(
		// if(eu && eu.i) eu.i = new Int32Array(eu.i);
		ifStmt(bin("&&", id("eu"), member(id("eu"), "i")), [
			exprStmt(
				assign(
					member(id("eu"), "i"),
					newExpr(id("Int32Array"), [member(id("eu"), "i")])
				)
			),
		]),
		// cache[id] = eu;
		exprStmt(assign(cacheId(names), id("eu")))
	);

	return nodes;
}

/**
 * Build the JSON parse path body:
 * ```js
 * var u = JSON.parse(raw);
 * for(var j=0; j<u.c.length; j++){ ... revival ... }
 * if(u.i) u.i = new Int32Array(u.i);
 * cache[id] = u;
 * ```
 */
function buildJsonPath(
	names: RuntimeNames,
	hasStringEncoding: boolean,
	rollingCipher: boolean
): JsNode[] {
	return [
		// var u = JSON.parse(raw);
		varDecl("u", call(member(id("JSON"), "parse"), [id("raw")])),
		// constant revival loop
		buildRevivalLoop(names, "u", hasStringEncoding, rollingCipher),
		// if(u.i) u.i = new Int32Array(u.i);
		buildInt32Conversion("u"),
		// cache[id] = u;
		exprStmt(assign(cacheId(names), id("u"))),
	];
}

/**
 * Build the object (pre-parsed) branch body:
 * ```js
 * if(raw && raw.c){ for(var j=0; ...) { ... revival ... } }
 * if(raw && raw.i && !(raw.i instanceof Int32Array)) raw.i = new Int32Array(raw.i);
 * cache[id] = raw;
 * ```
 */
function buildObjectPath(
	names: RuntimeNames,
	hasStringEncoding: boolean,
	rollingCipher: boolean
): JsNode[] {
	return [
		// if(raw && raw.c){ revival loop }
		ifStmt(bin("&&", id("raw"), member(id("raw"), "c")), [
			buildRevivalLoop(names, "raw", hasStringEncoding, rollingCipher),
		]),
		// if(raw && raw.i && !(raw.i instanceof Int32Array)) raw.i = new Int32Array(raw.i);
		buildInt32ConversionGuarded("raw"),
		// cache[id] = raw;
		exprStmt(assign(cacheId(names), id("raw"))),
	];
}
