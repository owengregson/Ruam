/**
 * Debug logging builder — assembles the debug config, logging function,
 * and opcode trace function as AST nodes.
 *
 * Replaces the inline template-literal approach in
 * `runtime/templates/debug-logging.ts`. Since the function bodies involve
 * complex string formatting and console output logic, raw() is used for
 * the function bodies.
 *
 * @module codegen/builders/debug-logging
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../runtime/names.js";
import { raw } from "../nodes.js";
import { Op, OPCODE_COUNT } from "../../compiler/opcodes.js";

// --- Builder ---

/**
 * Build the debug logging infrastructure as JsNode[].
 *
 * Produces three declarations:
 * - Debug config object (enabled flag, log level, opcode name table)
 * - General-purpose debug log function (rate-limited console.log wrapper)
 * - Opcode trace function (detailed per-instruction trace output)
 *
 * @param reverseMap - Physical-to-logical opcode mapping (index = physical, value = logical).
 * @param names - Randomized runtime identifier names.
 * @returns An array of JsNode containing the config var and two function declarations.
 */
export function buildDebugLogging(reverseMap: number[], names: RuntimeNames): JsNode[] {
	// --- Build opcode name table: physical opcode -> name string ---

	const opNames = Object.entries(Op)
		.filter(([, v]) => typeof v === "number" && (v as number) < OPCODE_COUNT)
		.reduce((m, [name, num]) => {
			m[num as number] = name;
			return m;
		}, {} as Record<number, string>);

	const nameEntries: string[] = [];
	for (let phys = 0; phys < reverseMap.length; phys++) {
		const logical = reverseMap[phys]!;
		const name = opNames[logical] ?? `OP_${logical}`;
		nameEntries.push(`${phys}:"${name}"`);
	}

	// --- Shorthand aliases for readability ---

	const O = names.operand;
	const S = names.stk;
	const P = names.stp;
	const OP = names.opVar;
	const cfg = names.dbgCfg;

	// --- Config object ---

	const configNode = raw(
		`var ${cfg}={` +
		`enabled:true,` +
		`level:'trace',` +
		`filter:null,` +
		`maxLogs:10000,` +
		`_count:0,` +
		`_opNames:{${nameEntries.join(",")}},` +
		`levels:{trace:0,info:1,warn:2,error:3}` +
		`}`
	);

	// --- General debug log function ---

	const dbgFn = raw(
		`function ${names.dbg}(){` +
		`if(!${cfg}.enabled)return;` +
		`if(${cfg}._count>=${cfg}.maxLogs){` +
		`if(${cfg}._count===${cfg}.maxLogs){console.warn('[VM_DBG] max logs reached ('+${cfg}.maxLogs+'), silencing');${cfg}._count++;}` +
		`return;` +
		`}` +
		`${cfg}._count++;` +
		`var args=Array.prototype.slice.call(arguments);` +
		`console.log.apply(console,['[VM_DBG]'].concat(args));` +
		`}`
	);

	// --- Opcode trace function ---

	const dbgOpFn = raw(
		`function ${names.dbgOp}(${OP},${O},C,${P},${S}){` +
		`if(!${cfg}.enabled||${cfg}.levels[${cfg}.level]>0)return;` +
		`if(${cfg}._count>=${cfg}.maxLogs)return;` +
		`${cfg}._count++;` +
		`var name=${cfg}._opNames[${OP}]||('OP_'+${OP});` +
		`var topStr='(empty)';` +
		`if(${P}>=0){` +
		`var top=${S}[${P}];` +
		`topStr=typeof top==='function'?'[fn'+(top.name?':'+top.name:'')+']':typeof top==='object'&&top!==null?'[obj:'+Object.keys(top).slice(0,3).join(',')+']':String(top);` +
		`if(topStr.length>60)topStr=topStr.slice(0,60)+'...';` +
		`}` +
		`var constStr='';` +
		`if(typeof C[${O}]==='string')constStr=' c=\"'+C[${O}].slice(0,30)+'\"';` +
		`else if(typeof C[${O}]==='number')constStr=' c='+C[${O}];` +
		`console.log('[VM_TRACE] '+name+' op='+${O}+constStr+' sp='+${P}+' top='+topStr);` +
		`}`
	);

	return [configNode, dbgFn, dbgOpFn];
}
