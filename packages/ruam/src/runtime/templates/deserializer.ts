/**
 * Binary bytecode deserializer runtime template.
 *
 * Generates the `_deserialize` function that reads a compact binary
 * `Uint8Array` format back into a bytecode unit object at runtime.
 *
 * @module runtime/templates/deserializer
 */

import type { RuntimeNames } from "../names.js";

export function generateDeserializer(names: RuntimeNames): string {
	return `
function ${names.deser}(bytes){
  var view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  var offset=0;
  function readU8(){return view.getUint8(offset++);}
  function readU16(){var v=view.getUint16(offset,true);offset+=2;return v;}
  function readU32(){var v=view.getUint32(offset,true);offset+=4;return v;}
  function readI32(){var v=view.getInt32(offset,true);offset+=4;return v;}
  function readF64(){var v=view.getFloat64(offset,true);offset+=8;return v;}
  function readStr(){
    var len=readU32();
    var s='';
    for(var i=0;i<len;i++){s+=String.fromCharCode(readU8());}
    return s;
  }

  var version=readU8();
  var flags=readU16();
  var pCount=readU16();
  var rCount=readU16();

  var cCount=readU32();
  var constants=[];
  for(var i=0;i<cCount;i++){
    var tag=readU8();
    switch(tag){
      case 0:constants.push(null);break;
      case 1:constants.push(void 0);break;
      case 2:constants.push(false);break;
      case 3:constants.push(true);break;
      case 4:constants.push(view.getInt8(offset));offset+=1;break;
      case 5:constants.push(view.getInt16(offset,true));offset+=2;break;
      case 6:constants.push(readI32());break;
      case 7:constants.push(readF64());break;
      case 8:constants.push(BigInt(readStr()));break;
      case 9:{var p=readStr();var f=readStr();constants.push(new RegExp(p,f));break;}
      default:constants.push(readStr());break;
    }
  }

  var iCount=readU32();
  var instrs=new Array(iCount*2);
  for(var i=0;i<iCount;i++){
    instrs[i*2]=readU16();
    instrs[i*2+1]=readI32();
  }

  var isGen=!!(flags&1);
  var isAsync=!!(flags&2);
  var isStrict=!!(flags&4);
  var isArrow=!!(flags&8);

  return {c:constants,i:instrs,r:rCount,sl:0,p:pCount,g:isGen,s:isAsync,st:isStrict,a:isArrow};
}
`;
}
