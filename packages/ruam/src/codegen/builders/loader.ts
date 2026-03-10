/**
 * Loader builder — assembles the bytecode loader function and shared
 * declarations as AST nodes.
 *
 * Replaces the template-literal approach in runtime/templates/loader.ts
 * with AST-based construction. The function body uses raw() because the
 * loader has complex branching with string-type checks, JSON parsing,
 * constant pool revival, and encrypted/unencrypted paths.
 *
 * @module codegen/builders/loader
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../runtime/names.js";
import { WATERMARK_NAME } from "../../runtime/names.js";
import { raw, varDecl, id, lit, un } from "../nodes.js";

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
			varDecl(names.callStack, raw("[]")),
			varDecl(names.cache, raw("{}"))
		);
	}

	// --- Load function ---

	nodes.push(
		raw(buildLoadFunction(encrypt, names, hasStringEncoding, rollingCipher))
	);

	return nodes;
}

// --- Internals ---

/**
 * Build the load(id) function body as a raw string.
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
): string {
	const strDecodeCheck = hasStringEncoding
		? rollingCipher
			? `else if(Array.isArray(cv)){u.c[j]=${names.strDec}(${names.rcDeriveKey}(u),cv,j);}`
			: `else if(Array.isArray(cv)){u.c[j]=${names.strDec}(cv,j);}`
		: "";

	const strDecodeCheckRaw = hasStringEncoding
		? rollingCipher
			? `else if(Array.isArray(cv)){raw.c[j]=${names.strDec}(${names.rcDeriveKey}(raw),cv,j);}`
			: `else if(Array.isArray(cv)){raw.c[j]=${names.strDec}(cv,j);}`
		: "";

	const encryptedPath =
		`var bytes=${names.b64}(raw);` +
		`var key=${names.fp}().toString(16);` +
		`var dec=${names.rc4}(bytes,key);` +
		`var eu=${names.deser}(dec);` +
		`if(eu&&eu.i)eu.i=new Int32Array(eu.i);` +
		`${names.cache}[id]=eu;`;

	const jsonPath =
		`var u=JSON.parse(raw);` +
		`for(var j=0;j<u.c.length;j++){` +
		`var cv=u.c[j];` +
		`if(cv&&cv.__regex__){u.c[j]=new RegExp(cv.p,cv.f);}` +
		`else if(cv&&cv.__bigint__){u.c[j]=BigInt(cv.v);}` +
		strDecodeCheck +
		`}` +
		`if(u.i)u.i=new Int32Array(u.i);` +
		`${names.cache}[id]=u;`;

	const stringBranch = encrypt ? encryptedPath : jsonPath;

	return (
		`function ${names.load}(id){` +
		`\n  if(${names.cache}[id])return ${names.cache}[id];` +
		`\n  var raw=${WATERMARK_NAME}?${names.bt}[id]:void 0;` +
		`\n  if(typeof raw==='string'){` +
		`\n    ${stringBranch}` +
		`\n  }else{` +
		`\n    if(raw&&raw.c){for(var j=0;j<raw.c.length;j++){var cv=raw.c[j];if(cv&&cv.__regex__){raw.c[j]=new RegExp(cv.p,cv.f);}else if(cv&&cv.__bigint__){raw.c[j]=BigInt(cv.v);}${strDecodeCheckRaw}}}` +
		`\n    if(raw&&raw.i&&!(raw.i instanceof Int32Array))raw.i=new Int32Array(raw.i);` +
		`\n    ${names.cache}[id]=raw;` +
		`\n  }` +
		`\n  return ${names.cache}[id];` +
		`\n}`
	);
}
