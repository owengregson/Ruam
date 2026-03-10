/**
 * Stack encoding builder — assembles the stack encoding Proxy as AST nodes.
 *
 * Extracts the stack encoding proxy from the interpreter builder into its
 * own file. The proxy wraps the VM stack array so that numeric values are
 * XOR-encoded with position-dependent keys on set and decoded on get.
 *
 * @module codegen/builders/stack-encoding
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../runtime/names.js";
import { raw } from "../nodes.js";

/**
 * Build the stack encoding Proxy setup as JsNode[].
 *
 * Emits a raw code block that:
 * 1. Derives a stack encoding key from unit metadata.
 * 2. Creates a raw backing array.
 * 3. Wraps the stack variable in a Proxy with set/get traps that
 *    XOR-encode int32 numeric values using position-dependent keys.
 *    Booleans, strings, and other values are tagged and stored
 *    transparently.
 *
 * @param names - Randomized runtime identifier names.
 * @returns An array containing a single RawNode with the Proxy setup code.
 */
export function buildStackEncodingProxy(names: RuntimeNames): JsNode[] {
	const S = names.stk;
	const U = names.unit;

	return [
		raw(
			`var _sek=(${U}.i.length^${U}.r^0x5A3C96E1)>>>0;` +
				`var _seRaw=[];` +
				`${S}=new Proxy(_seRaw,{` +
				`set:function(_,k,v){` +
				`var i=+k;` +
				`if(i===i&&i>=0){` +
				`var t=typeof v;` +
				`if(t==='number'&&(v|0)===v){_seRaw[i]=[0,v^((_sek^(i*0x9E3779B9))>>>0)];}` +
				`else if(t==='boolean'){_seRaw[i]=[1,v?1:0];}` +
				`else if(t==='string'){_seRaw[i]=[2,v];}` +
				`else{_seRaw[i]=[3,v];}` +
				`}else{_seRaw[k]=v;}` +
				`return true;` +
				`},` +
				`get:function(_,k){` +
				`var i=+k;` +
				`if(i===i&&i>=0){` +
				`var e=_seRaw[i];` +
				`if(!e)return void 0;` +
				`if(e[0]===0)return e[1]^((_sek^(i*0x9E3779B9))>>>0);` +
				`if(e[0]===1)return !!e[1];` +
				`return e[1];` +
				`}` +
				`if(k==='length')return _seRaw.length;` +
				`return _seRaw[k];` +
				`}` +
				`});`
		),
	];
}
