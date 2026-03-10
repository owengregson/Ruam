/**
 * Interpreter builder — assembles exec functions from the handler registry.
 *
 * Replaces the inline template-literal approach with AST-based handler
 * construction. The switch cases are built from the handler registry;
 * the surrounding scaffolding (dispatch loop, exception handling, etc.)
 * uses raw() for the initial migration.
 *
 * @module codegen/builders/interpreter
 */

import type { CaseClause } from "../nodes.js";
import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../runtime/names.js";
import { raw, caseClause, lit, switchStmt, id, breakStmt } from "../nodes.js";
import { registry, makeHandlerCtx } from "../handlers/index.js";
import { emit } from "../emit.js";
import {
	VM_MAX_RECURSION_DEPTH,
	LCG_MULTIPLIER,
	LCG_INCREMENT,
} from "../../constants.js";
import { KEEP, RESERVED } from "../transforms.js";

/** Options for interpreter filtering and hardening. */
export interface InterpreterBuildOptions {
	dynamicOpcodes?: boolean;
	decoyOpcodes?: boolean;
	stackEncoding?: boolean;
	usedOpcodes?: Set<number>;
}

/**
 * Build both sync and async interpreter functions as JsNode[].
 *
 * Each function is returned as a Raw node containing the complete
 * function declaration with AST-built switch cases.
 */
export function buildInterpreterFunctions(
	names: RuntimeNames,
	shuffleMap: number[],
	debug: boolean,
	rollingCipher: boolean,
	seed: number,
	interpOpts: InterpreterBuildOptions = {}
): JsNode[] {
	return [
		buildExecFunction(names, shuffleMap, {
			isAsync: false,
			debug,
			rollingCipher,
			seed,
			interpOpts,
		}),
		buildExecFunction(names, shuffleMap, {
			isAsync: true,
			debug,
			rollingCipher,
			seed,
			interpOpts,
		}),
	];
}

/**
 * Build a single interpreter function (sync or async) as a JsNode.
 */
export function buildExecFunction(
	names: RuntimeNames,
	shuffleMap: number[],
	opts: {
		isAsync: boolean;
		debug: boolean;
		rollingCipher: boolean;
		seed: number;
		interpOpts: InterpreterBuildOptions;
	}
): JsNode {
	const ctx = makeHandlerCtx(names, opts.isAsync, opts.debug);

	// Build switch cases from the handler registry
	const cases: CaseClause[] = [];
	for (const [op, handler] of registry) {
		// Dynamic opcodes: skip handlers for opcodes not used by any compiled unit
		if (
			opts.interpOpts.dynamicOpcodes &&
			opts.interpOpts.usedOpcodes &&
			!opts.interpOpts.usedOpcodes.has(op)
		) {
			continue;
		}
		const physicalOp = shuffleMap[op]!;
		cases.push(caseClause(lit(physicalOp), handler(ctx)));
	}

	// Generate decoy handlers for unused opcodes
	if (opts.interpOpts.decoyOpcodes && opts.interpOpts.usedOpcodes) {
		cases.push(
			...generateDecoyHandlers(
				names,
				shuffleMap,
				opts.interpOpts.usedOpcodes
			)
		);
	}

	// Default case
	cases.push(caseClause(null, [breakStmt()]));

	// Build the switch statement and emit it to a string
	const switchNode = switchStmt(id(ctx.PH), cases);
	const switchStr = emit(switchNode);

	// Build the scaffolding with the switch injected
	let funcStr = buildScaffold(
		names,
		opts.isAsync,
		opts.debug,
		opts.rollingCipher,
		opts.interpOpts,
		switchStr
	);

	// Apply string-based post-processing (same as the old template pipeline):
	// 1. Inline W/X/Y stack operation calls → direct array access
	// 2. Obfuscate remaining long local variable names
	funcStr = stringInlineStackOps(
		funcStr,
		names.stk,
		names.stp,
		names.sPush,
		names.sPop,
		names.sPeek
	);
	funcStr = stringObfuscateLocals(funcStr, opts.seed);

	return raw(funcStr);
}

// --- Scaffolding ---

/**
 * Build the interpreter function wrapper, splicing in the AST-generated switch.
 *
 * Replicates the old generateExecBody() scaffolding: function signature,
 * depth tracking, variable declarations, dispatch loop, exception handling.
 */
function buildScaffold(
	n: RuntimeNames,
	isAsync: boolean,
	debug: boolean,
	rollingCipher: boolean,
	interpOpts: InterpreterBuildOptions,
	switchStr: string
): string {
	const fnName = isAsync ? n.execAsync : n.exec;
	const fnDecl = isAsync ? `async function ${fnName}` : `function ${fnName}`;
	const fnLabel = isAsync ? n.execAsync : n.exec;

	const S = n.stk,
		P = n.stp,
		W = n.sPush,
		X = n.sPop,
		Y = n.sPeek;
	const O = n.operand,
		SC = n.scope,
		R = n.regs,
		IP = n.ip;
	const C = n.cArr,
		I = n.iArr,
		EX = n.exStk;
	const PE = n.pEx,
		HPE = n.hPEx,
		CT = n.cType,
		CV = n.cVal;
	const U = n.unit,
		A = n.args,
		OS = n.outer;
	const TV = n.tVal,
		NT = n.nTgt,
		HO = n.ho,
		PH = n.phys;
	const sPar = n.sPar,
		sV = n.sVars;

	const dbgTrace = debug ? `${n.dbgOp}(${PH},${O},${C},${P},${S});` : "";

	const rcInit = rollingCipher
		? `\n  var ${n.rcState}=${n.rcDeriveKey}(${U});`
		: "";

	const rcDecrypt = rollingCipher
		? `
    var _ri=(${IP}-2)>>>1;
    var _ks=${n.rcMix}(${n.rcState},_ri,_ri^0x9E3779B9);
    ${PH}=(${PH}^(_ks&0xFFFF))&0xFFFF;
    ${O}=(${O}^_ks)|0;`
		: "";

	const stackEncoding = interpOpts.stackEncoding
		? "\n  " + buildStackEncodingProxy(n)
		: "";

	const debugEntry = debug
		? `\n  var _uid=${U}._dbgId||'?';${n.dbg}('ENTER','${fnLabel}','unit='+_uid,'params='+${U}.p,'args='+${A}.length,'async='+!!${U}.s,'regs='+${U}.r,'depth='+${n.depth});`
		: "";

	const debugException = debug
		? `\n    ${n.dbg}('EXCEPTION','error=',e&&e.message?e.message:e,'${EX}='+(${EX}?${EX}.length:0));`
		: "";

	const debugCatch = debug
		? `\n        ${n.dbg}('CATCH','ip='+_h._ci,'sp='+_h._sp);`
		: "";

	const debugFinally = debug
		? `\n        ${n.dbg}('FINALLY','ip='+_h._fi,'sp='+_h._sp);`
		: "";

	const debugUncaught = debug
		? `\n    ${n.dbg}('UNCAUGHT','error=',e&&e.message?e.message:e);`
		: "";

	return `
${fnDecl}(${U},${A},${OS},${TV},${NT},${HO}){
  ${n.depth}++;
  var _uid_=(${U}._dbgId||'?');
  ${n.callStack}.push(_uid_);
  if(${n.depth}>${VM_MAX_RECURSION_DEPTH}){${n.depth}--;${n.callStack}.pop();throw new RangeError('Maximum call '+'s'+'tack size exceeded');}
  try{
  var ${S}=[];
  var ${R}=new Array(${U}.r);
  var ${IP}=0;
  var ${C}=${U}.c;
  var ${I}=${U}.i;
  var ${EX}=null;
  var ${PE}=null;
  var ${HPE}=false;
  var ${CT}=0;
  var ${CV}=void 0;
  var ${SC}={${sPar}:${OS},${sV}:{}};
  var ${P}=-1;
  var _g=typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:typeof global!=='undefined'?global:typeof self!=='undefined'?self:{};${debugEntry}
  ${rcInit}
${stackEncoding}
  function ${W}(v){${S}[++${P}]=v;}
  function ${X}(){return ${S}[${P}--];}
  function ${Y}(){return ${S}[${P}];}

  var _il=${I}.length;
  for(;;){
  try{
  while(${IP}<_il){
    var ${PH}=${I}[${IP}];
    var ${O}=${I}[${IP}+1];
    ${IP}+=2;${rcDecrypt}
    ${dbgTrace}

    ${switchStr}
  }
  return void 0;
  }catch(e){${debugException}
    ${HPE}=false;${PE}=null;${CT}=0;${CV}=void 0;
    if(${EX}&&${EX}.length>0){
      var _h=${EX}.pop();
      if(_h._ci>=0){${debugCatch}
        ${P}=_h._sp;
        ${W}(e);
        ${IP}=_h._ci*2;
        continue;
      }
      if(_h._fi>=0){${debugFinally}
        ${P}=_h._sp;
        ${PE}=e;${HPE}=true;
        ${IP}=_h._fi*2;
        continue;
      }
    }${debugUncaught}
    throw e;
  }
  }
  }finally{${n.depth}--;${n.callStack}.pop();}
}
`;
}

// --- Decoy handlers ---

/**
 * Generate fake case handlers for unused opcode slots.
 *
 * These are never called but make the interpreter appear more complex,
 * hardening against static analysis.
 */
function generateDecoyHandlers(
	n: RuntimeNames,
	shuffleMap: number[],
	usedOpcodes: Set<number>
): CaseClause[] {
	const S = n.stk,
		P = n.stp,
		C = n.cArr,
		O = n.operand;
	const R = n.regs,
		SC = n.scope,
		sV = n.sVars;

	// Collect unused logical opcodes
	const unused: number[] = [];
	for (let i = 0; i < shuffleMap.length; i++) {
		if (!usedOpcodes.has(i)) unused.push(i);
	}
	if (unused.length === 0) return [];

	// Select 8-16 decoys (deterministic based on shuffleMap)
	const count = Math.min(unused.length, 8 + (shuffleMap[0]! % 9));
	const selected: number[] = [];
	for (let i = 0; i < count; i++) {
		const idx =
			(shuffleMap[i % shuffleMap.length]! + i * 7) % unused.length;
		const op = unused[idx]!;
		if (!selected.includes(op)) selected.push(op);
	}

	// Fake handler bodies — look like real arithmetic, stack, register, scope ops
	const decoyBodies = [
		`var b=${S}[${P}--];${S}[${P}]=${S}[${P}]+b`,
		`var b=${S}[${P}--];${S}[${P}]=${S}[${P}]-b`,
		`var b=${S}[${P}--];${S}[${P}]=${S}[${P}]*b`,
		`${S}[${P}]=~${S}[${P}]`,
		`${S}[++${P}]=${C}[${O}]`,
		`${R}[${O}]=${S}[${P}--]`,
		`${S}[++${P}]=${R}[${O}]`,
		`var s=${SC};if(s&&s.${sV}){s.${sV}[${C}[${O}]]=${S}[${P}--];}`,
		`${S}[${P}]=!${S}[${P}]`,
		`var b=${S}[${P}--];${S}[${P}]=${S}[${P}]&b`,
		`var b=${S}[${P}--];${S}[${P}]=${S}[${P}]|b`,
		`${S}[${P}]=-${S}[${P}]`,
		`${S}[${P}]=+${S}[${P}]+1`,
		`${S}[${P}]=typeof ${S}[${P}]`,
		`${P}--`,
		`${S}[${P}+1]=${S}[${P}];${P}++`,
	];

	return selected.map((logicalOp, i) => {
		const body = decoyBodies[(logicalOp + i) % decoyBodies.length]!;
		const physicalOp = shuffleMap[logicalOp]!;
		return caseClause(lit(physicalOp), [raw(body), breakStmt()]);
	});
}

// --- Stack encoding proxy ---

/**
 * Build the Proxy-based stack encoding wrapper.
 *
 * Wraps the raw stack array in a Proxy that XOR-encodes numeric values
 * on set and decodes on get. Transparent to all opcode handlers.
 */
function buildStackEncodingProxy(n: RuntimeNames): string {
	const S = n.stk;
	const U = n.unit;
	return `var _sek=(${U}.i.length^${U}.r^0x5A3C96E1)>>>0;
  var _seRaw=[];
  ${S}=new Proxy(_seRaw,{
    set:function(_,k,v){
      var i=+k;
      if(i===i&&i>=0){
        var t=typeof v;
        if(t==='number'&&(v|0)===v){_seRaw[i]=[0,v^((_sek^(i*0x9E3779B9))>>>0)];}
        else if(t==='boolean'){_seRaw[i]=[1,v?1:0];}
        else if(t==='string'){_seRaw[i]=[2,v];}
        else{_seRaw[i]=[3,v];}
      }else{_seRaw[k]=v;}
      return true;
    },
    get:function(_,k){
      var i=+k;
      if(i===i&&i>=0){
        var e=_seRaw[i];
        if(!e)return void 0;
        if(e[0]===0)return e[1]^((_sek^(i*0x9E3779B9))>>>0);
        if(e[0]===1)return !!e[1];
        return e[1];
      }
      if(k==='length')return _seRaw.length;
      return _seRaw[k];
    }
  });`;
}

// --- String-based post-processing transforms ---

/**
 * Inline stack operations: replace W(expr)->S[++P]=expr, X()->S[P--], Y()->S[P].
 *
 * This eliminates function call overhead on every single opcode dispatch.
 * Ported from the old template-literal pipeline.
 */
function stringInlineStackOps(
	source: string,
	S: string,
	P: string,
	W: string,
	X: string,
	Y: string
): string {
	// Remove the push/pop/peek function definitions
	const defPattern = new RegExp(
		`function ${W}\\(v\\)\\{${S}\\[\\+\\+${P}\\]=v;\\}\\s*` +
			`function ${X}\\(\\)\\{return ${S}\\[${P}--\\];\\}\\s*` +
			`function ${Y}\\(\\)\\{return ${S}\\[${P}\\];\\}`,
		"g"
	);
	let result = source.replace(defPattern, "");

	// Replace X() -> S[P--]  (simple token, no args)
	result = result.replace(new RegExp(`${X}\\(\\)`, "g"), `${S}[${P}--]`);

	// Replace Y() -> S[P]   (simple token, no args)
	result = result.replace(new RegExp(`${Y}\\(\\)`, "g"), `${S}[${P}]`);

	// Replace W(expr) with inline stack push.
	const popToken = `${S}[${P}--]`;
	const wCall = `${W}(`;
	let out = "";
	let i = 0;
	while (i < result.length) {
		const idx = result.indexOf(wCall, i);
		if (idx < 0) {
			out += result.slice(i);
			break;
		}
		out += result.slice(i, idx);
		// Find the matching closing paren
		let depth = 1;
		let j = idx + wCall.length;
		while (j < result.length && depth > 0) {
			if (result[j] === "(") depth++;
			else if (result[j] === ")") depth--;
			j++;
		}
		const expr = result.slice(idx + wCall.length, j - 1);
		if (!expr.includes(popToken) && !expr.includes(`${S}[${P}]`)) {
			// No stack reads in expr — safe to use S[++P]=expr directly
			out += `${S}[++${P}]=${expr}`;
		} else {
			// Expr reads from stack — evaluate first, then push
			out += `${S}[++${P}]=((${expr}))`;
		}
		i = j;
	}

	return out;
}

/**
 * Rename all case-local `var` declarations with names >= 3 chars
 * that aren't in the KEEP set and don't start with `_`.
 *
 * Ported from the old template-literal pipeline.
 */
function stringObfuscateLocals(source: string, seed: number): string {
	let s = seed >>> 0;
	function lcg(): number {
		s = (s * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
		return s;
	}
	const alpha = "abcdefghijklmnopqrstuvwxyz";
	const alnum = "abcdefghijklmnopqrstuvwxyz0123456789";
	const used = new Set<string>();

	function genShort(): string {
		for (;;) {
			const c1 = alpha[lcg() % alpha.length]!;
			const c2 = alnum[lcg() % alnum.length]!;
			const name = c1 + c2;
			if (!used.has(name) && !KEEP.has(name) && !RESERVED.has(name)) {
				used.add(name);
				return name;
			}
		}
	}

	// Find all `var <name>` declarations where name is 3+ chars, not starting with _
	const varPattern = /\bvar\s+([a-zA-Z][a-zA-Z0-9_]{2,})\b/g;
	const toRename = new Set<string>();
	let m: RegExpExecArray | null;
	while ((m = varPattern.exec(source)) !== null) {
		const name = m[1]!;
		if (!KEEP.has(name) && !name.startsWith("_")) {
			toRename.add(name);
		}
	}

	// Also find function parameter names that are revealing
	const paramPattern = /function\s*\w*\s*\(([^)]+)\)/g;
	while ((m = paramPattern.exec(source)) !== null) {
		const params = m[1]!.split(",").map((p) => p.trim());
		for (const p of params) {
			const clean = p.replace(/^\.\.\./, "");
			if (
				clean.length >= 3 &&
				!KEEP.has(clean) &&
				!clean.startsWith("_")
			) {
				toRename.add(clean);
			}
		}
	}

	if (toRename.size === 0) return source;

	// Build rename map
	const renameMap = new Map<string, string>();
	for (const name of toRename) {
		renameMap.set(name, genShort());
	}

	// Apply renames using word-boundary replacements (longest first)
	let result = source;
	const sorted = [...renameMap.entries()].sort(
		(a, b) => b[0].length - a[0].length
	);
	for (const [oldName, newName] of sorted) {
		result = result.replace(new RegExp(`\\b${oldName}\\b`, "g"), newName);
	}

	return result;
}
