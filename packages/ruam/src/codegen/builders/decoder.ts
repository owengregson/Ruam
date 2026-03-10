/**
 * Decoder builder — assembles RC4, base64, and string decoder functions as AST nodes.
 *
 * Replaces the inline template-literal approach in `runtime/decoder.ts` with
 * AST-based construction. Since the function bodies involve complex crypto
 * logic (RC4 key scheduling, XOR streams, base64 polyfill), raw() is used
 * for the function bodies.
 *
 * @module codegen/builders/decoder
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../runtime/names.js";
import { raw } from "../nodes.js";

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
	return [
		raw(
			`function ${names.rc4}(data,key){` +
			`var S=new Array(256);var j=0;var i;` +
			`for(i=0;i<256;i++)S[i]=i;` +
			`for(i=0;i<256;i++){j=(j+S[i]+key.charCodeAt(i%key.length))&255;var t=S[i];S[i]=S[j];S[j]=t;}` +
			`i=0;j=0;var out=new Uint8Array(data.length);` +
			`for(var k=0;k<data.length;k++){i=(i+1)&255;j=(j+S[i])&255;var t=S[i];S[i]=S[j];S[j]=t;out[k]=data[k]^S[(S[i]+S[j])&255];}` +
			`return out;}`
		),
		raw(
			`function ${names.b64}(str){` +
			`if(typeof atob==='function'){var bin=atob(str);var bytes=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes;}` +
			`else{return new Uint8Array(Buffer.from(str,'base64'));}` +
			`;}`
		),
	];
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
		// Key is passed as first argument by the loader
		return [
			raw(
				`function ${names.strDec}(mk,b,x){` +
				`var k=(mk^(x*0x9E3779B9))>>>0;var s='';` +
				`for(var i=0;i<b.length;i++){k=(k*1664525+1013904223)>>>0;s+=String.fromCharCode(b[i]^(k&65535));}` +
				`return s;}`
			),
		];
	}

	return [
		raw(
			`function ${names.strDec}(b,x){` +
			`var k=(${stringKey >>> 0}^(x*0x9E3779B9))>>>0;var s='';` +
			`for(var i=0;i<b.length;i++){k=(k*1664525+1013904223)>>>0;s+=String.fromCharCode(b[i]^(k&65535));}` +
			`return s;}`
		),
	];
}
