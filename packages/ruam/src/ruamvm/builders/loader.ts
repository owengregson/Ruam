/**
 * Loader builder — assembles the bytecode loader function and shared
 * declarations as AST nodes.
 *
 * All bytecode units are always in binary format (custom-alphabet
 * encoded strings). The loader decodes, optionally RC4-decrypts,
 * deserializes, and caches each unit on first access.
 *
 * @module ruamvm/builders/loader
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../encoding/names.js";
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
	update,
	varDecl,
} from "../nodes.js";

// --- Builder ---

/**
 * Build the bytecode loader function and optional shared declarations
 * as JsNode[].
 *
 * Returns an array containing:
 * 1. Shared variable declarations (depth, callStack, cache) —
 *    omitted when `options.skipSharedDecls` is true.
 * 2. The `load(id)` function declaration.
 *
 * The loader always decodes from custom binary encoding, optionally
 * RC4-decrypts, deserializes via the binary deserializer, decodes
 * XOR-encoded strings when string encoding is enabled, and converts
 * instruction arrays to Int32Array for performance.
 *
 * @param encrypt            Whether bytecode is RC4-encrypted.
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
 * Build the string decode loop for encoded constant pool strings.
 *
 * In binary format, encoded strings are deserialized as number arrays.
 * This loop detects them via `Array.isArray(cv)` and decodes in-place.
 *
 * Produces:
 * ```js
 * for(var j=0; j<target.c.length; j++){
 *   var cv = target.c[j];
 *   if(Array.isArray(cv)){
 *     target.c[j] = strDec([key,] cv, j);
 *   }
 * }
 * ```
 */
function buildStringDecodeLoop(
	names: RuntimeNames,
	target: string,
	rollingCipher: boolean
): JsNode {
	const tgt = id(target);
	const cArr = member(tgt, "c"); // target.c
	const cJ = index(cArr, id("j")); // target.c[j]

	// strDec(cv, j)  or  strDec(rcDeriveKey(target), cv, j)
	const decodeArgs: JsNode[] = rollingCipher
		? [call(id(names.rcDeriveKey), [id(target)]), id("cv"), id("j")]
		: [id("cv"), id("j")];

	return forStmt(
		varDecl("j", lit(0)),
		bin("<", id("j"), member(cArr, "length")),
		update("++", false, id("j")),
		[
			// var cv = target.c[j];
			varDecl("cv", cJ),
			// if(Array.isArray(cv)){ target.c[j] = strDec(...); }
			ifStmt(call(member(id("Array"), "isArray"), [id("cv")]), [
				exprStmt(
					assign(cJ, call(id(names.strDec), decodeArgs))
				),
			]),
		]
	);
}

/**
 * Build the load(id) function as a FnDecl AST node.
 *
 * All units are in binary format (custom-alphabet encoded strings).
 * The function:
 * 1. Checks the cache
 * 2. Decodes the custom encoding → Uint8Array
 * 3. Optionally RC4-decrypts
 * 4. Deserializes binary → unit object
 * 5. Decodes XOR-encoded strings (if enabled)
 * 6. Converts instructions to Int32Array
 * 7. Caches and returns
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

	// --- var raw = bt[id]; ---
	body.push(varDecl("raw", index(id(names.bt), id("id"))));

	// --- Decode from custom encoding: var bytes = _bd(raw); ---
	body.push(varDecl("bytes", call(id(names.b64), [id("raw")])));

	if (encrypt) {
		// --- RC4 decrypt ---
		// var key = fp().toString(16);
		body.push(
			varDecl(
				"key",
				call(member(call(id(names.fp), []), "toString"), [lit(16)])
			)
		);
		// bytes = rc4(bytes, key);
		body.push(
			exprStmt(
				assign(
					id("bytes"),
					call(id(names.rc4), [id("bytes"), id("key")])
				)
			)
		);
	}

	// --- Deserialize binary: var eu = deser(bytes); ---
	body.push(varDecl("eu", call(id(names.deser), [id("bytes")])));

	// --- Decode XOR-encoded strings (if string encoding is on) ---
	if (hasStringEncoding) {
		body.push(buildStringDecodeLoop(names, "eu", rollingCipher));
	}

	// Instructions are already Int32Array from the deserializer — no conversion needed.

	// --- Cache: cache[id] = eu; ---
	body.push(exprStmt(assign(cacheId(names), id("eu"))));

	// --- return cache[id]; ---
	body.push(returnStmt(cacheId(names)));

	return fn(names.load, ["id"], body);
}
