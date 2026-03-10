/**
 * Bytecode loader and cache runtime template.
 *
 * Generates the loader function (with cache), recursion depth
 * tracking, and the watermark variable.
 *
 * The watermark `_ru4m` is woven into the loader logic as a
 * type-check guard — if it's removed or changed to a non-truthy
 * value, all bytecode loads will silently fail.
 *
 * @module runtime/templates/loader
 */

import type { RuntimeNames } from "../names.js";
import { WATERMARK_NAME } from "../names.js";

export function generateLoader(
	encrypt: boolean,
	names: RuntimeNames,
	hasStringEncoding: boolean = false,
	rollingCipher: boolean = false,
	options?: { skipSharedDecls?: boolean }
): string {
	// _ru4m is used as a guard in the loader: if falsy, raw is forced to undefined,
	// so every bytecode load silently fails and the program breaks.

	// When rolling cipher is enabled, the string decoder takes the key as its first arg.
	// We derive it from the unit metadata using rcDeriveKey.
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

	const sharedDecls = options?.skipSharedDecls
		? ""
		: `
var ${WATERMARK_NAME}=!0;
var ${names.depth}=0;
var ${names.callStack}=[];
var ${names.cache}={};`;

	return `${sharedDecls}
function ${names.load}(id){
  if(${names.cache}[id])return ${names.cache}[id];
  var raw=${WATERMARK_NAME}?${names.bt}[id]:void 0;
  if(typeof raw==='string'){
    ${
		encrypt
			? `var bytes=${names.b64}(raw);var key=${names.fp}().toString(16);var dec=${names.rc4}(bytes,key);var eu=${names.deser}(dec);if(eu&&eu.i)eu.i=new Int32Array(eu.i);${names.cache}[id]=eu;`
			: `var u=JSON.parse(raw);for(var j=0;j<u.c.length;j++){var cv=u.c[j];if(cv&&cv.__regex__){u.c[j]=new RegExp(cv.p,cv.f);}else if(cv&&cv.__bigint__){u.c[j]=BigInt(cv.v);}${strDecodeCheck}}if(u.i)u.i=new Int32Array(u.i);${names.cache}[id]=u;`
	}
  }else{
    if(raw&&raw.c){for(var j=0;j<raw.c.length;j++){var cv=raw.c[j];if(cv&&cv.__regex__){raw.c[j]=new RegExp(cv.p,cv.f);}else if(cv&&cv.__bigint__){raw.c[j]=BigInt(cv.v);}${strDecodeCheckRaw}}}
    if(raw&&raw.i&&!(raw.i instanceof Int32Array))raw.i=new Int32Array(raw.i);
    ${names.cache}[id]=raw;
  }
  return ${names.cache}[id];
}
`;
}
