/**
 * Debug trace logging runtime template.
 *
 * Generates the debug infrastructure (config, logging and
 * opcode-trace functions) along with an opcode name table.
 *
 * @module runtime/templates/debug-logging
 */

import type { RuntimeNames } from "../names.js";
import { Op, OPCODE_COUNT } from "../../compiler/opcodes.js";

export function generateDebugLogging(
	reverseMap: number[],
	names: RuntimeNames
): string {
	// Build opcode name table: physical opcode -> name string
	const opNames = Object.entries(Op)
		.filter(([, v]) => typeof v === "number" && v < OPCODE_COUNT)
		.reduce((m, [name, num]) => {
			m[num as number] = name;
			return m;
		}, {} as Record<number, string>);

	// Map physical opcodes to names via the reverse map
	const nameEntries: string[] = [];
	for (let phys = 0; phys < reverseMap.length; phys++) {
		const logical = reverseMap[phys]!;
		const name = opNames[logical] ?? `OP_${logical}`;
		nameEntries.push(`${phys}:"${name}"`);
	}

	const O = names.operand;
	const S = names.stk;
	const P = names.stp;
	const OP = names.opVar;

	return `
var ${names.dbgCfg}={
  enabled:true,
  level:'trace',
  filter:null,
  maxLogs:10000,
  _count:0,
  _opNames:{${nameEntries.join(",")}},
  levels:{trace:0,info:1,warn:2,error:3}
};
function ${names.dbg}(){
  if(!${names.dbgCfg}.enabled)return;
  if(${names.dbgCfg}._count>=${names.dbgCfg}.maxLogs){
    if(${names.dbgCfg}._count===${
		names.dbgCfg
	}.maxLogs){console.warn('[VM_DBG] max logs reached ('+${
		names.dbgCfg
	}.maxLogs+'), silencing');${names.dbgCfg}._count++;}
    return;
  }
  ${names.dbgCfg}._count++;
  var args=Array.prototype.slice.call(arguments);
  console.log.apply(console,['[VM_DBG]'].concat(args));
}
function ${names.dbgOp}(${OP},${O},C,${P},${S}){
  if(!${names.dbgCfg}.enabled||${names.dbgCfg}.levels[${
		names.dbgCfg
	}.level]>0)return;
  if(${names.dbgCfg}._count>=${names.dbgCfg}.maxLogs)return;
  ${names.dbgCfg}._count++;
  var name=${names.dbgCfg}._opNames[${OP}]||('OP_'+${OP});
  var topStr='(empty)';
  if(${P}>=0){
    var top=${S}[${P}];
    topStr=typeof top==='function'?'[fn'+(top.name?':'+top.name:'')+']':typeof top==='object'&&top!==null?'[obj:'+Object.keys(top).slice(0,3).join(',')+']':String(top);
    if(topStr.length>60)topStr=topStr.slice(0,60)+'...';
  }
  var constStr='';
  if(typeof C[${O}]==='string')constStr=' c="'+C[${O}].slice(0,30)+'"';
  else if(typeof C[${O}]==='number')constStr=' c='+C[${O}];
  console.log('[VM_TRACE] '+name+' op='+${O}+constStr+' sp='+${P}+' top='+topStr);
}
`;
}
