/**
 * Deserializer builder — assembles the binary bytecode deserializer as AST nodes.
 *
 * Replaces the template-literal approach in `runtime/templates/deserializer.ts`
 * with AST-based construction. Since the deserializer involves complex binary
 * parsing (DataView reads, constant pool tag switch, instruction interleaving),
 * raw() is used for the function body.
 *
 * @module codegen/builders/deserializer
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../runtime/names.js";
import { raw } from "../nodes.js";

// --- Builder ---

/**
 * Build the binary bytecode deserializer function as JsNode[].
 *
 * Produces a single function declaration that reads a compact binary
 * `Uint8Array` format back into a bytecode unit object at runtime.
 * The function parses the version byte, flags, parameter/register counts,
 * the tagged constant pool, and the interleaved instruction array
 * (opcode u16 + operand i32 pairs).
 *
 * @param names - Per-build randomized runtime identifiers.
 * @returns A single-element array containing the deserializer function.
 */
export function buildDeserializer(names: RuntimeNames): JsNode[] {
	return [
		raw(
			`function ${names.deser}(bytes){` +
			`var view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);` +
			`var offset=0;` +
			`function readU8(){return view.getUint8(offset++);}` +
			`function readU16(){var v=view.getUint16(offset,true);offset+=2;return v;}` +
			`function readU32(){var v=view.getUint32(offset,true);offset+=4;return v;}` +
			`function readI32(){var v=view.getInt32(offset,true);offset+=4;return v;}` +
			`function readF64(){var v=view.getFloat64(offset,true);offset+=8;return v;}` +
			`function readStr(){` +
			`var len=readU32();` +
			`var s='';` +
			`for(var i=0;i<len;i++){s+=String.fromCharCode(readU8());}` +
			`return s;` +
			`}` +
			`var version=readU8();` +
			`var flags=readU16();` +
			`var pCount=readU16();` +
			`var rCount=readU16();` +
			`var cCount=readU32();` +
			`var constants=[];` +
			`for(var i=0;i<cCount;i++){` +
			`var tag=readU8();` +
			`switch(tag){` +
			`case 0:constants.push(null);break;` +
			`case 1:constants.push(void 0);break;` +
			`case 2:constants.push(false);break;` +
			`case 3:constants.push(true);break;` +
			`case 4:constants.push(view.getInt8(offset));offset+=1;break;` +
			`case 5:constants.push(view.getInt16(offset,true));offset+=2;break;` +
			`case 6:constants.push(readI32());break;` +
			`case 7:constants.push(readF64());break;` +
			`case 8:constants.push(BigInt(readStr()));break;` +
			`case 9:{var p=readStr();var f=readStr();constants.push(new RegExp(p,f));break;}` +
			`default:constants.push(readStr());break;` +
			`}` +
			`}` +
			`var iCount=readU32();` +
			`var instrs=new Array(iCount*2);` +
			`for(var i=0;i<iCount;i++){` +
			`instrs[i*2]=readU16();` +
			`instrs[i*2+1]=readI32();` +
			`}` +
			`var isGen=!!(flags&1);` +
			`var isAsync=!!(flags&2);` +
			`var isStrict=!!(flags&4);` +
			`var isArrow=!!(flags&8);` +
			`return {c:constants,i:instrs,r:rCount,sl:0,p:pCount,g:isGen,s:isAsync,st:isStrict,a:isArrow};` +
			`}`
		),
	];
}
