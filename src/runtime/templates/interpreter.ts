/**
 * VM interpreter core runtime template.
 *
 * Generates `_exec` (synchronous) and `_execAsync` (asynchronous)
 * interpreter functions that execute bytecode units via a giant
 * switch dispatch loop.
 *
 * All internal variable names are obfuscated to avoid revealing
 * the stack-machine architecture.
 *
 * @module runtime/templates/interpreter
 */

import type { RuntimeNames } from "../names.js";
import { Op } from "../../compiler/opcodes.js";
import { VM_MAX_RECURSION_DEPTH } from "../../constants.js";
import { LCG_MULTIPLIER, LCG_INCREMENT } from "../../constants.js";

// ---------------------------------------------------------------------------
// Post-processing: rename all remaining multi-char case-local variables
// so the output looks like generic minified code.
// ---------------------------------------------------------------------------

/** Names that must NOT be renamed (JS built-ins, APIs, short names). */
const KEEP = new Set([
  // JS built-ins
  "undefined", "null", "true", "false", "NaN", "Infinity", "void",
  "typeof", "instanceof", "delete", "new", "this", "arguments",
  // Globals used in the output
  "Object", "Array", "Symbol", "String", "Number", "Boolean", "BigInt",
  "RegExp", "Math", "JSON", "Date", "Error", "TypeError", "RangeError",
  "ReferenceError", "SyntaxError", "Uint8Array", "DataView", "Buffer",
  "globalThis", "window", "global", "self", "console", "atob", "eval",
  "setInterval", "setTimeout", "clearInterval", "clearTimeout",
  // Short generic names (already look minified)
  "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "s", "v", "w", "x",
  "a1", "a2", "a3", "ai", "ki", "si", "ri", "ti",
  // Object property/method names that are part of the language API
  "length", "push", "pop", "call", "apply", "bind", "keys", "value",
  "done", "next", "return", "get", "set", "create", "freeze",
  "seal", "from", "assign", "prototype", "constructor", "name",
  "writable", "configurable", "enumerable", "slice", "concat",
  "indexOf", "join", "charCodeAt", "toString", "getPrototypeOf",
  "setPrototypeOf", "defineProperty", "isArray", "getUint8",
  "getUint16", "getUint32", "getInt32", "getFloat64", "getInt8",
  "getInt16", "buffer", "byteOffset", "byteLength", "fromCharCode",
  "reduce", "floor", "parse", "stringify", "iterator", "asyncIterator",
  "hasInstance", "toPrimitive", "toStringTag", "species",
  "isConcatSpreadable", "match", "replace", "search", "split",
  "unscopables", "raw", "log", "warn", "message",
  // These are used as computed identifiers but not as var names
  "id", "uid", "cs", "ct",
]);

/**
 * Rename all case-local `var` declarations with names >= 3 chars
 * that aren't in the KEEP set and don't start with `_`.
 */
function obfuscateLocals(source: string, seed: number): string {
  let s = seed >>> 0;
  function lcg(): number {
    s = (s * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
    return s;
  }
  const alpha = "abcdefghijklmnopqrstuvwxyz";
  const alnum = "abcdefghijklmnopqrstuvwxyz0123456789";
  const used = new Set<string>();

  // JS reserved words and keywords that can't be used as identifiers
  const reserved = new Set([
    "do", "if", "in", "of", "as", "is",
    "for", "let", "new", "try", "var", "int",
    "case", "else", "enum", "null", "this", "true", "void", "with",
    "await", "break", "catch", "class", "const", "false", "super",
    "throw", "while", "yield", "delete", "export", "import", "public",
    "return", "static", "switch", "typeof",
    "default", "extends", "finally", "package", "private",
    "continue", "debugger", "function", "abstract", "volatile",
    "protected", "interface", "instanceof", "implements",
  ]);

  function genShort(): string {
    for (;;) {
      const c1 = alpha[lcg() % alpha.length]!;
      const c2 = alnum[lcg() % alnum.length]!;
      const name = c1 + c2;
      if (!used.has(name) && !KEEP.has(name) && !reserved.has(name)) {
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

  // Also find function parameter names (for inner IIFEs etc)
  // that are revealing, like `handler`
  const paramPattern = /function\s*\w*\s*\(([^)]+)\)/g;
  while ((m = paramPattern.exec(source)) !== null) {
    const params = m[1]!.split(",").map(p => p.trim());
    for (const p of params) {
      if (p.length >= 3 && !KEEP.has(p) && !p.startsWith("_")) {
        toRename.add(p);
      }
    }
  }

  if (toRename.size === 0) return source;

  // Build rename map
  const renameMap = new Map<string, string>();
  for (const name of toRename) {
    renameMap.set(name, genShort());
  }

  // Apply renames using word-boundary replacements (longest first to avoid partial matches)
  let result = source;
  const sorted = [...renameMap.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [oldName, newName] of sorted) {
    result = result.replace(new RegExp(`\\b${oldName}\\b`, "g"), newName);
  }

  return result;
}

/**
 * Generate both sync and async interpreter bodies.
 */
export function generateInterpreterCore(
  debug: boolean,
  names: RuntimeNames,
  seed: number,
  shuffleMap: number[],
  rollingCipher: boolean = false,
  integrityBinding: boolean = false,
): string {
  const raw = generateExecBody(false, debug, names, shuffleMap, rollingCipher, integrityBinding) + '\n' + generateExecBody(true, debug, names, shuffleMap, rollingCipher, integrityBinding);
  return obfuscateLocals(raw, seed);
}

/**
 * Generate a single interpreter function body (sync or async).
 */
function generateExecBody(
  isAsync: boolean,
  debug: boolean,
  n: RuntimeNames,
  shuffleMap: number[],
  rollingCipher: boolean = false,
  integrityBinding: boolean = false,
): string {
  const fnName = isAsync ? n.execAsync : n.exec;
  const fnDecl = isAsync ? `async function ${fnName}` : `function ${fnName}`;
  const fnLabel = isAsync ? n.execAsync : n.exec;

  // Stack operation names (disguised)
  const S = n.stk;    // stack array
  const P = n.stp;    // stack pointer
  const W = n.sPush;  // push
  const X = n.sPop;   // pop
  const Y = n.sPeek;  // peek

  // Interpreter locals (disguised)
  const O = n.operand;  // operand
  const SC = n.scope;   // scope
  const R = n.regs;     // registers
  const IP = n.ip;      // instruction pointer
  const C = n.cArr;     // constants array
  const I = n.iArr;     // instructions array
  const EX = n.exStk;   // exception handler stack
  const PE = n.pEx;     // pending exception
  const HPE = n.hPEx;   // has pending exception
  const U = n.unit;     // unit parameter
  const A = n.args;     // args parameter
  const OS = n.outer;   // outerScope parameter
  const TV = n.tVal;    // thisVal parameter
  const NT = n.nTgt;    // newTarget parameter
  const PH = n.phys;    // physical opcode
  const OP = n.opVar;   // logical opcode

  // Scope property names (disguised)
  const sPar = n.sPar;
  const sV = n.sVars;
  const sCV = n.sCVars;
  const sTdz = n.sTdz;

  // Watermark — used as an XOR key in the dispatch guard
  const WM = n.wm;

  const awaitHandler = isAsync
    ? `case ${Op.AWAIT}:{${debug ? `${n.dbg}('AWAIT','awaiting:',typeof ${Y}()==='object'?'[Promise]':${Y}());` : ''}${W}(await ${X}());break;}`
    : `case ${Op.AWAIT}:${W}(void 0);break;`;

  // Closure handler (debug vs non-debug)
  const closureHandler = debug ? `
    case ${Op.NEW_CLOSURE}:{
      var _cuid=${C}[${O}];var _cu=${n.load}(_cuid);
      ${n.dbg}('NEW_CLOSURE','uid='+_cuid,'async='+!!_cu.s,'params='+_cu.p,'arrow='+!!_cu.a);
      if(_cu.a){if(_cu.s){${W}((function(uid,cs,ct){return async function(){
        ${n.dbg}('CALL_CLOSURE','async arrow uid='+uid,'args='+arguments.length);
        return ${n.vm}.call(ct,uid,Array.prototype.slice.call(arguments),cs);
      };})(${C}[${O}],${SC},${TV}));}else{${W}((function(uid,cs,ct){return function(){
        ${n.dbg}('CALL_CLOSURE','arrow uid='+uid,'args='+arguments.length);
        return ${n.vm}.call(ct,uid,Array.prototype.slice.call(arguments),cs);
      };})(${C}[${O}],${SC},${TV}));}}
      else{if(_cu.s){${W}((function(uid,cs){return async function(){
        ${n.dbg}('CALL_CLOSURE','async uid='+uid,'args='+arguments.length);
        return ${n.vm}.call(this,uid,Array.prototype.slice.call(arguments),cs);
      };})(${C}[${O}],${SC}));}else{${W}((function(uid,cs){return function(){
        ${n.dbg}('CALL_CLOSURE','uid='+uid,'args='+arguments.length);
        return ${n.vm}.call(this,uid,Array.prototype.slice.call(arguments),cs);
      };})(${C}[${O}],${SC}));}}
      break;
    }
    case ${Op.NEW_FUNCTION}:{
      var _fuid=${C}[${O}];var _fu=${n.load}(_fuid);
      ${n.dbg}('NEW_FUNCTION','uid='+_fuid,'async='+!!_fu.s,'params='+_fu.p);
      if(_fu.s){${W}((function(uid,cs){return async function(){
        ${n.dbg}('CALL_FUNCTION','async uid='+uid,'args='+arguments.length);
        return ${n.vm}.call(this,uid,Array.prototype.slice.call(arguments),cs);
      };})(${C}[${O}],${SC}));}else{${W}((function(uid,cs){return function(){
        ${n.dbg}('CALL_FUNCTION','uid='+uid,'args='+arguments.length);
        return ${n.vm}.call(this,uid,Array.prototype.slice.call(arguments),cs);
      };})(${C}[${O}],${SC}));}
      break;
    }` : `
    case ${Op.NEW_CLOSURE}:{
      var _cuid=${C}[${O}];var _cu=${n.load}(_cuid);
      if(_cu.a){${W}((function(uid,cs,ct){if(_cu.s){return async function(){
        return ${n.vm}.call(ct,uid,Array.prototype.slice.call(arguments),cs);
      };}return function(){
        return ${n.vm}.call(ct,uid,Array.prototype.slice.call(arguments),cs);
      };})(${C}[${O}],${SC},${TV}));}
      else{${W}((function(uid,cs){if(_cu.s){return async function(){
        return ${n.vm}.call(this,uid,Array.prototype.slice.call(arguments),cs);
      };}return function(){
        return ${n.vm}.call(this,uid,Array.prototype.slice.call(arguments),cs);
      };})(${C}[${O}],${SC}));}
      break;
    }
    case ${Op.NEW_FUNCTION}:{
      ${W}((function(uid,cs){var u=${n.load}(uid);if(u.s){return async function(){
        return ${n.vm}.call(this,uid,Array.prototype.slice.call(arguments),cs);
      };}return function(){
        return ${n.vm}.call(this,uid,Array.prototype.slice.call(arguments),cs);
      };})(${C}[${O}],${SC}));
      break;
    }`;

  // Debug pre-opcode trace
  const dbgTrace = debug ? `${n.dbgOp}(${PH},${O},${C},${P},${S});` : '';

  // Rolling cipher: initialization and per-instruction decryption
  const rcInit = rollingCipher ? `
  var ${n.rcState}=${n.rcDeriveKey}(${U});` : '';

  // When rolling cipher is enabled, decrypt each instruction pair.
  // Position-dependent: key depends on instruction index and base key only.
  const rcDecrypt = rollingCipher ? `
    var _ri=(${IP}-2)>>>1;
    var _ks=${n.rcMix}(${n.rcState},_ri,_ri^0x9E3779B9);
    ${PH}=(${PH}^(_ks&0xFFFF))&0xFFFF;
    ${O}=(${O}^_ks)|0;` : '';

  const template = `
${fnDecl}(${U},${A},${OS},${TV},${NT}){
  ${n.depth}++;
  var _uid_=(${U}._dbgId||'?');
  ${n.callStack}.push(_uid_);
  if(${n.depth}>${VM_MAX_RECURSION_DEPTH}){var _last20=${n.callStack}.slice(-20).join(' > ');${n.depth}--;${n.callStack}.pop();throw new RangeError(${WM}+'\\x20'+${n.depth});}
  try{
  var ${S}=[];
  var ${R}=new Array(${U}.r);
  var ${IP}=0;
  var ${C}=${U}.c;
  var ${I}=${U}.i;
  var ${EX}=[];
  var ${PE}=null;
  var ${HPE}=false;
  var ${SC}={${sPar}:${OS},${sV}:{},${sCV}:{},${sTdz}:{}};
  var ${P}=-1;
  ${debug ? `var _uid=${U}._dbgId||'?';${n.dbg}('ENTER','${fnLabel}','unit='+_uid,'params='+${U}.p,'args='+${A}.length,'async='+!!${U}.s,'regs='+${U}.r,'depth='+${n.depth});` : ''}
  ${rcInit}

  function ${W}(v){${S}[++${P}]=v;}
  function ${X}(){return ${S}[${P}--];}
  function ${Y}(){return ${S}[${P}];}

  for(;;){
  try{
  while(${IP}<${I}.length){
    var ${PH}=${I}[${IP}];
    var ${O}=${I}[${IP}+1];
    ${IP}+=2;${rcDecrypt}
    ${dbgTrace}

    switch(${PH}){
    case ${Op.PUSH_CONST}:${W}(${C}[${O}]);break;
    case ${Op.PUSH_UNDEFINED}:${W}(void 0);break;
    case ${Op.PUSH_NULL}:${W}(null);break;
    case ${Op.PUSH_TRUE}:${W}(true);break;
    case ${Op.PUSH_FALSE}:${W}(false);break;
    case ${Op.PUSH_ZERO}:${W}(0);break;
    case ${Op.PUSH_ONE}:${W}(1);break;
    case ${Op.PUSH_NEG_ONE}:${W}(-1);break;
    case ${Op.PUSH_EMPTY_STRING}:${W}('');break;
    case ${Op.PUSH_NAN}:${W}(NaN);break;
    case ${Op.PUSH_INFINITY}:${W}(Infinity);break;
    case ${Op.PUSH_NEG_INFINITY}:${W}(-Infinity);break;
    case ${Op.POP}:${P}--;break;
    case ${Op.POP_N}:${P}-=${O};break;
    case ${Op.DUP}:${W}(${Y}());break;
    case ${Op.DUP2}:{var _a=${S}[${P}-1];var _b=${S}[${P}];${W}(_a);${W}(_b);break;}
    case ${Op.SWAP}:{var a=${X}();var b=${X}();${W}(a);${W}(b);break;}
    case ${Op.ROT3}:{var c=${X}();var b=${X}();var a=${X}();${W}(c);${W}(a);${W}(b);break;}
    case ${Op.ROT4}:{var d=${X}();var c=${X}();var b=${X}();var a=${X}();${W}(d);${W}(a);${W}(b);${W}(c);break;}
    case ${Op.PICK}:{${W}(${S}[${P}-${O}]);break;}

    case ${Op.LOAD_REG}:${W}(${R}[${O}]);break;
    case ${Op.STORE_REG}:${R}[${O}]=${X}();break;
    case ${Op.LOAD_ARG}:${W}(${O}<${A}.length?${A}[${O}]:void 0);break;
    case ${Op.STORE_ARG}:${A}[${O}]=${X}();break;
    case ${Op.LOAD_ARG_OR_DEFAULT}:${W}(${O}<${A}.length&&${A}[${O}]!==void 0?${A}[${O}]:void 0);break;
    case ${Op.GET_ARG_COUNT}:${W}(${A}.length);break;

    case ${Op.ADD}:{var b=${X}();var a=${X}();${W}(a+b);break;}
    case ${Op.SUB}:{var b=${X}();var a=${X}();${W}(a-b);break;}
    case ${Op.MUL}:{var b=${X}();var a=${X}();${W}(a*b);break;}
    case ${Op.DIV}:{var b=${X}();var a=${X}();${W}(a/b);break;}
    case ${Op.MOD}:{var b=${X}();var a=${X}();${W}(a%b);break;}
    case ${Op.POW}:{var b=${X}();var a=${X}();${W}(a**b);break;}
    case ${Op.NEG}:${W}(-${X}());break;
    case ${Op.UNARY_PLUS}:${W}(+${X}());break;
    case ${Op.INC}:${W}(${X}()+1);break;
    case ${Op.DEC}:${W}(${X}()-1);break;

    case ${Op.BIT_AND}:{var b=${X}();var a=${X}();${W}(a&b);break;}
    case ${Op.BIT_OR}:{var b=${X}();var a=${X}();${W}(a|b);break;}
    case ${Op.BIT_XOR}:{var b=${X}();var a=${X}();${W}(a^b);break;}
    case ${Op.BIT_NOT}:${W}(~${X}());break;
    case ${Op.SHL}:{var b=${X}();var a=${X}();${W}(a<<b);break;}
    case ${Op.SHR}:{var b=${X}();var a=${X}();${W}(a>>b);break;}
    case ${Op.USHR}:{var b=${X}();var a=${X}();${W}(a>>>b);break;}

    case ${Op.NOT}:${W}(!${X}());break;
    case ${Op.LOGICAL_AND}:{var v=${Y}();if(!v){${IP}=${O}*2;}else{${P}--;}break;}
    case ${Op.LOGICAL_OR}:{var v=${Y}();if(v){${IP}=${O}*2;}else{${P}--;}break;}
    case ${Op.NULLISH_COALESCE}:{var v=${Y}();if(v!==null&&v!==void 0){${IP}=${O}*2;}else{${P}--;}break;}

    case ${Op.EQ}:{var b=${X}();var a=${X}();${W}(a==b);break;}
    case ${Op.NEQ}:{var b=${X}();var a=${X}();${W}(a!=b);break;}
    case ${Op.SEQ}:{var b=${X}();var a=${X}();${W}(a===b);break;}
    case ${Op.SNEQ}:{var b=${X}();var a=${X}();${W}(a!==b);break;}
    case ${Op.LT}:{var b=${X}();var a=${X}();${W}(a<b);break;}
    case ${Op.LTE}:{var b=${X}();var a=${X}();${W}(a<=b);break;}
    case ${Op.GT}:{var b=${X}();var a=${X}();${W}(a>b);break;}
    case ${Op.GTE}:{var b=${X}();var a=${X}();${W}(a>=b);break;}

    case ${Op.JMP}:${IP}=${O}*2;break;
    case ${Op.JMP_TRUE}:if(${X}())${IP}=${O}*2;break;
    case ${Op.JMP_FALSE}:if(!${X}())${IP}=${O}*2;break;
    case ${Op.JMP_NULLISH}:{var v=${X}();if(v===null||v===void 0)${IP}=${O}*2;break;}
    case ${Op.JMP_UNDEFINED}:{var v=${X}();if(v===void 0)${IP}=${O}*2;break;}
    case ${Op.JMP_TRUE_KEEP}:if(${Y}())${IP}=${O}*2;break;
    case ${Op.JMP_FALSE_KEEP}:if(!${Y}())${IP}=${O}*2;break;
    case ${Op.JMP_NULLISH_KEEP}:{var v=${Y}();if(v===null||v===void 0)${IP}=${O}*2;break;}
    case ${Op.RETURN}:{var _rv=${X}();${debug ? `${n.dbg}('RETURN','value=',_rv);` : ''}return _rv;}
    case ${Op.RETURN_VOID}:${debug ? `${n.dbg}('RETURN_VOID');` : ''}return void 0;
    case ${Op.THROW}:{var _te=${X}();${debug ? `${n.dbg}('THROW','error=',_te);` : ''}throw _te;}
    case ${Op.RETHROW}:{if(${HPE}){var ex=${PE};${PE}=null;${HPE}=false;throw ex;}break;}
    case ${Op.NOP}:break;
    case ${Op.TABLE_SWITCH}:case ${Op.LOOKUP_SWITCH}:{${IP}=${O}*2;break;}

    case ${Op.GET_PROP_STATIC}:{var obj=${X}();${W}(obj[${C}[${O}]]);break;}
    case ${Op.SET_PROP_STATIC}:{var val=${X}();var obj=${X}();var k=${C}[${O}];try{obj[k]=val;}catch(_){Object.defineProperty(obj,k,{value:val,writable:true,configurable:true});}${W}(obj);break;}
    case ${Op.GET_PROP_DYNAMIC}:{var key=${X}();var obj=${X}();${W}(obj[key]);break;}
    case ${Op.SET_PROP_DYNAMIC}:{var val=${X}();var key=${X}();var obj=${X}();obj[key]=val;${W}(obj);break;}
    case ${Op.DELETE_PROP_STATIC}:{var obj=${X}();${W}(delete obj[${C}[${O}]]);break;}
    case ${Op.DELETE_PROP_DYNAMIC}:{var key=${X}();var obj=${X}();${W}(delete obj[key]);break;}
    case ${Op.OPT_CHAIN_GET}:{var key=${C}[${O}];var obj=${X}();${W}(obj==null?void 0:obj[key]);break;}
    case ${Op.OPT_CHAIN_DYNAMIC}:{var key=${X}();var obj=${X}();${W}(obj==null?void 0:obj[key]);break;}
    case ${Op.IN_OP}:{var obj=${X}();var key=${X}();${W}(key in obj);break;}
    case ${Op.INSTANCEOF}:{var ctor=${X}();var obj=${X}();${W}(obj instanceof ctor);break;}
    case ${Op.GET_SUPER_PROP}:{var sp2=Object.getPrototypeOf(Object.getPrototypeOf(${TV}));var key=${O}>=0?${C}[${O}]:${X}();${W}(sp2?sp2[key]:void 0);break;}
    case ${Op.SET_SUPER_PROP}:{var val=${X}();var sp2=Object.getPrototypeOf(Object.getPrototypeOf(${TV}));var key=${O}>=0?${C}[${O}]:${X}();if(sp2)sp2[key]=val;${W}(val);break;}
    case ${Op.GET_PRIVATE_FIELD}:{var obj=${X}();var name=${C}[${O}];${W}(obj[name]);break;}
    case ${Op.SET_PRIVATE_FIELD}:{var val=${X}();var obj=${X}();var name=${C}[${O}];obj[name]=val;${W}(val);break;}
    case ${Op.HAS_PRIVATE_FIELD}:{var obj=${X}();var name=${C}[${O}];${W}(name in obj);break;}
    case ${Op.DEFINE_OWN_PROPERTY}:{var desc=${X}();var key=${X}();var obj=${X}();Object.defineProperty(obj,key,desc);${W}(obj);break;}

    case ${Op.LOAD_SCOPED}:{
      var name=${C}[${O}];
      var s=${SC};
      var found=false;
      while(s){
        if(name in s.${sV}){${W}(s.${sV}[name]);found=true;break;}
        s=s.${sPar};
      }
      if(!found){
        var g=typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:typeof global!=='undefined'?global:typeof self!=='undefined'?self:{};
        ${W}(g[name]);
      }
      break;
    }
    case ${Op.STORE_SCOPED}:{
      var name=${C}[${O}];
      var val=${X}();
      var s=${SC};
      var found=false;
      while(s){
        if(name in s.${sV}){s.${sV}[name]=val;found=true;break;}
        s=s.${sPar};
      }
      if(!found){
        var g=typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:typeof global!=='undefined'?global:typeof self!=='undefined'?self:{};
        g[name]=val;
      }
      break;
    }
    case ${Op.DECLARE_VAR}:case ${Op.DECLARE_LET}:case ${Op.DECLARE_CONST}:{
      var name=${C}[${O}];
      if(!(name in ${SC}.${sV}))${SC}.${sV}[name]=void 0;
      break;
    }

    case ${Op.PUSH_SCOPE}:case ${Op.PUSH_BLOCK_SCOPE}:case ${Op.PUSH_CATCH_SCOPE}:${SC}={${sPar}:${SC},${sV}:{},${sCV}:{},${sTdz}:{}};break;
    case ${Op.POP_SCOPE}:${SC}=${SC}.${sPar}||${SC};break;
    case ${Op.TDZ_CHECK}:{var name=${C}[${O}];if(${SC}.${sTdz}&&${SC}.${sTdz}[name])throw new ReferenceError("Cannot access '"+name+"' before initialization");break;}
    case ${Op.TDZ_MARK}:{var name=${C}[${O}];if(${SC}.${sTdz})delete ${SC}.${sTdz}[name];break;}
    case ${Op.PUSH_WITH_SCOPE}:{var wObj=${X}();${SC}={${sPar}:${SC},${sV}:wObj,${sCV}:{},${sTdz}:{}};break;}
    case ${Op.DELETE_SCOPED}:{var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){${W}(delete s.${sV}[name]);break;}s=s.${sPar};}break;}

    case ${Op.LOAD_GLOBAL}:{
      var g=typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:typeof global!=='undefined'?global:typeof self!=='undefined'?self:{};
      ${W}(g[${C}[${O}]]);break;
    }
    case ${Op.STORE_GLOBAL}:{
      var g=typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:typeof global!=='undefined'?global:typeof self!=='undefined'?self:{};
      g[${C}[${O}]]=${X}();break;
    }

    case ${Op.CALL}:{
      var argc=${O};
      var hasSpread=argc<0;
      if(hasSpread)argc=-argc;
      var callArgs=[];
      for(var ai=0;ai<argc;ai++)callArgs.unshift(${X}());
      if(hasSpread){
        var flat=[];
        for(var ai=0;ai<callArgs.length;ai++){
          if(callArgs[ai]&&callArgs[ai].__spread__){
            for(var si=0;si<callArgs[ai].items.length;si++)flat.push(callArgs[ai].items[si]);
          }else flat.push(callArgs[ai]);
        }
        callArgs=flat;
      }
      var fn=${X}();
      ${debug ? `${n.dbg}('CALL','fn=',typeof fn,'argc='+callArgs.length,fn&&fn.name?'name='+fn.name:'');if(typeof fn!=='function')${n.dbg}('CALL_ERR','NOT A FUNCTION:',fn,'${S} depth='+${P});` : ''}
      ${W}(fn.apply(void 0,callArgs));
      break;
    }
    case ${Op.CALL_METHOD}:{
      var argc=${O};
      var hasSpread=argc<0;
      if(hasSpread)argc=-argc;
      var callArgs=[];
      for(var ai=0;ai<argc;ai++)callArgs.unshift(${X}());
      if(hasSpread){
        var flat=[];
        for(var ai=0;ai<callArgs.length;ai++){
          if(callArgs[ai]&&callArgs[ai].__spread__){
            for(var si=0;si<callArgs[ai].items.length;si++)flat.push(callArgs[ai].items[si]);
          }else flat.push(callArgs[ai]);
        }
        callArgs=flat;
      }
      var recv=${X}();
      var fn=${X}();
      ${debug ? `${n.dbg}('CALL_METHOD','fn=',typeof fn,'recv=',typeof recv,'argc='+callArgs.length,fn&&fn.name?'name='+fn.name:'');if(typeof fn!=='function')${n.dbg}('CALL_METHOD_ERR','NOT A FUNCTION:',fn,'recv=',recv);` : ''}
      ${W}(fn.apply(recv,callArgs));
      break;
    }
    case ${Op.CALL_NEW}:{
      var argc=${O};
      var callArgs=[];
      for(var ai=0;ai<argc;ai++)callArgs.unshift(${X}());
      var Ctor=${X}();
      ${W}(new (Ctor.bind.apply(Ctor,[null].concat(callArgs)))());
      break;
    }
    case ${Op.SUPER_CALL}:{
      var argc=${O};
      var callArgs=[];
      for(var ai=0;ai<argc;ai++)callArgs.unshift(${X}());
      var superProto=Object.getPrototypeOf(Object.getPrototypeOf(${TV}));
      ${debug ? `${n.dbg}('SUPER_CALL','argc='+argc,'superProto=',!!superProto,'superCtor=',superProto&&typeof superProto.constructor);` : ''}
      if(superProto&&superProto.constructor){
        superProto.constructor.apply(${TV},callArgs);
      }
      ${W}(${TV});
      break;
    }

    case ${Op.SPREAD_ARGS}:{var v=${X}();${W}({__spread__:true,items:Array.from(v)});break;}
    case ${Op.CALL_OPTIONAL}:{
      var argc=${O};var hasSpread=argc<0;if(hasSpread)argc=-argc;
      var callArgs=[];for(var ai=0;ai<argc;ai++)callArgs.unshift(${X}());
      if(hasSpread){var flat=[];for(var ai=0;ai<callArgs.length;ai++){if(callArgs[ai]&&callArgs[ai].__spread__){for(var si=0;si<callArgs[ai].items.length;si++)flat.push(callArgs[ai].items[si]);}else flat.push(callArgs[ai]);}callArgs=flat;}
      var fn=${X}();${W}(fn==null?void 0:fn.apply(void 0,callArgs));break;
    }
    case ${Op.CALL_METHOD_OPTIONAL}:{
      var argc=${O};var hasSpread=argc<0;if(hasSpread)argc=-argc;
      var callArgs=[];for(var ai=0;ai<argc;ai++)callArgs.unshift(${X}());
      if(hasSpread){var flat=[];for(var ai=0;ai<callArgs.length;ai++){if(callArgs[ai]&&callArgs[ai].__spread__){for(var si=0;si<callArgs[ai].items.length;si++)flat.push(callArgs[ai].items[si]);}else flat.push(callArgs[ai]);}callArgs=flat;}
      var recv=${X}();var fn=${X}();${W}(fn==null?void 0:fn.apply(recv,callArgs));break;
    }
    case ${Op.DIRECT_EVAL}:{var code=${X}();${W}(eval(code));break;}
    case ${Op.CALL_TAGGED_TEMPLATE}:{
      var argc=${O};var callArgs=[];for(var ai=0;ai<argc;ai++)callArgs.unshift(${X}());
      var fn=${X}();${W}(fn.apply(void 0,callArgs));break;
    }
    case ${Op.CALL_SUPER_METHOD}:{
      var argc=${O}&0xFFFF;var nameIdx=(${O}>>16)&0xFFFF;
      var callArgs=[];for(var ai=0;ai<argc;ai++)callArgs.unshift(${X}());
      var sp2=Object.getPrototypeOf(Object.getPrototypeOf(${TV}));
      var fn=sp2?sp2[${C}[nameIdx]]:void 0;${W}(fn?fn.apply(${TV},callArgs):void 0);break;
    }
    case ${Op.CALL_0}:{var fn=${X}();${W}(fn());break;}
    case ${Op.CALL_1}:{var a1=${X}();var fn=${X}();${W}(fn(a1));break;}
    case ${Op.CALL_2}:{var a2=${X}();var a1=${X}();var fn=${X}();${W}(fn(a1,a2));break;}
    case ${Op.CALL_3}:{var a3=${X}();var a2=${X}();var a1=${X}();var fn=${X}();${W}(fn(a1,a2,a3));break;}

    case ${Op.NEW_OBJECT}:${W}({});break;
    case ${Op.NEW_ARRAY}:${W}([]);break;
    case ${Op.NEW_ARRAY_WITH_SIZE}:${W}(new Array(${O}));break;
    case ${Op.ARRAY_PUSH}:{var val=${X}();var arr=${Y}();arr.push(val);break;}
    case ${Op.ARRAY_HOLE}:{var arr=${Y}();arr.length++;break;}
    case ${Op.SPREAD_ARRAY}:{
      var src=${X}();
      var target=${Y}();
      if(Array.isArray(target)){
        var items=Array.from(src);
        for(var si=0;si<items.length;si++)target.push(items[si]);
      }else{
        Object.assign(target,src);
      }
      break;
    }
    case ${Op.SPREAD_OBJECT}:{var src=${X}();var target=${Y}();Object.assign(target,src);break;}
    case ${Op.COPY_DATA_PROPERTIES}:{
      var excludeKeys=${X}();var src=${X}();var target=${Y}();
      var keys=Object.keys(src);
      for(var ki=0;ki<keys.length;ki++){if(!excludeKeys||excludeKeys.indexOf(keys[ki])<0)target[keys[ki]]=src[keys[ki]];}
      break;
    }
    case ${Op.SET_PROTO}:{var proto=${X}();var obj=${X}();Object.setPrototypeOf(obj,proto);${W}(obj);break;}
    case ${Op.FREEZE_OBJECT}:{Object.freeze(${Y}());break;}
    case ${Op.SEAL_OBJECT}:{Object.seal(${Y}());break;}
    case ${Op.DEFINE_PROPERTY_DESC}:{var desc=${X}();var key=${X}();var obj=${Y}();Object.defineProperty(obj,key,desc);break;}
    case ${Op.CREATE_TEMPLATE_OBJECT}:{
      var raw=${X}();var cooked=${X}();Object.defineProperty(cooked,'raw',{value:Object.freeze(raw)});
      Object.freeze(cooked);${W}(cooked);break;
    }

    case ${Op.DEFINE_METHOD}:{
      var fn=${X}();var cls=${Y}();var name=${C}[${O}&0xFFFF];var isStatic=(${O}>>16)&1;
      ${debug ? `${n.dbg}('DEFINE_METHOD','name='+name,'static='+!!isStatic,'isCtor='+(name==='constructor'));` : ''}
      if(name==='constructor'){if(cls.__setCtor)cls.__setCtor(fn);cls.prototype.constructor=fn;}
      else if(isStatic){cls[name]=fn;}else{(cls.prototype||cls)[name]=fn;}
      break;
    }
    case ${Op.DEFINE_STATIC_METHOD}:{var fn=${X}();var cls=${Y}();cls[${C}[${O}]]=fn;break;}
    case ${Op.DEFINE_GETTER}:{
      var fn=${X}();var cls=${Y}();var name=${C}[${O}&0xFFFF];var isStatic=(${O}>>16)&1;
      var target=isStatic?cls:(cls.prototype||cls);
      Object.defineProperty(target,name,{get:fn,configurable:true,enumerable:false});break;
    }
    case ${Op.DEFINE_STATIC_GETTER}:{var fn=${X}();var cls=${Y}();Object.defineProperty(cls,${C}[${O}],{get:fn,configurable:true,enumerable:false});break;}
    case ${Op.DEFINE_SETTER}:{
      var fn=${X}();var cls=${Y}();var name=${C}[${O}&0xFFFF];var isStatic=(${O}>>16)&1;
      var target=isStatic?cls:(cls.prototype||cls);
      Object.defineProperty(target,name,{set:fn,configurable:true,enumerable:false});break;
    }
    case ${Op.DEFINE_STATIC_SETTER}:{var fn=${X}();var cls=${Y}();Object.defineProperty(cls,${C}[${O}],{set:fn,configurable:true,enumerable:false});break;}
    case ${Op.DEFINE_FIELD}:{var val=${X}();var name=${C}[${O}];var obj=${Y}();obj[name]=val;break;}
    case ${Op.DEFINE_STATIC_FIELD}:{var val=${X}();var cls=${Y}();cls[${C}[${O}]]=val;break;}
    case ${Op.DEFINE_PRIVATE_METHOD}:{var fn=${X}();var cls=${Y}();(cls.prototype||cls)[${C}[${O}]]=fn;break;}
    case ${Op.DEFINE_PRIVATE_GETTER}:{var fn=${X}();var cls=${Y}();Object.defineProperty(cls.prototype||cls,${C}[${O}],{get:fn,configurable:true});break;}
    case ${Op.DEFINE_PRIVATE_SETTER}:{var fn=${X}();var cls=${Y}();Object.defineProperty(cls.prototype||cls,${C}[${O}],{set:fn,configurable:true});break;}
    case ${Op.DEFINE_PRIVATE_FIELD}:{var val=${X}();var obj=${Y}();obj[${C}[${O}]]=val;break;}
    case ${Op.DEFINE_STATIC_PRIVATE_FIELD}:{var val=${X}();var cls=${Y}();cls[${C}[${O}]]=val;break;}
    case ${Op.DEFINE_STATIC_PRIVATE_METHOD}:{var fn=${X}();var cls=${Y}();cls[${C}[${O}]]=fn;break;}
    case ${Op.CLASS_STATIC_BLOCK}:{var fn=${X}();var cls=${Y}();fn.call(cls);break;}
    case ${Op.FINALIZE_CLASS}:break;
    case ${Op.INIT_PRIVATE_ENV}:case ${Op.ADD_PRIVATE_BRAND}:case ${Op.CHECK_PRIVATE_BRAND}:break;
    case ${Op.EXTEND_CLASS}:{var superCls=${X}();var cls=${Y}();cls.prototype=Object.create(superCls.prototype);cls.prototype.constructor=cls;Object.setPrototypeOf(cls,superCls);break;}
    case ${Op.NEW_DERIVED_CLASS}:{
      var SuperClass=${X}();
      ${debug ? `${n.dbg}('NEW_DERIVED_CLASS');` : ''}
      var cls=(function(){var c=null;var f=function(){if(c)return c.apply(this,arguments);};f.__setCtor=function(x){c=x;};return f;})();
      cls.prototype=Object.create(SuperClass.prototype);cls.prototype.constructor=cls;Object.setPrototypeOf(cls,SuperClass);
      ${W}(cls);break;
    }

    case ${Op.NEW_CLASS}:{
      var hasSuperClass=${O};
      var SuperClass=hasSuperClass?${X}():null;
      ${debug ? `${n.dbg}('NEW_CLASS','hasSuper='+!!hasSuperClass);` : ''}
      var cls=(function(){var c=null;var f=function(){if(c)return c.apply(this,arguments);};f.__setCtor=function(x){c=x;};return f;})();
      if(SuperClass){
        cls.prototype=Object.create(SuperClass.prototype);
        cls.prototype.constructor=cls;
        Object.setPrototypeOf(cls,SuperClass);
      }
      ${W}(cls);
      break;
    }

    ${closureHandler}

    case ${Op.NEW_ARROW}:{
      ${W}((function(uid,cs,ct){var u=${n.load}(uid);if(u.s){return async function(){return ${n.vm}.call(ct,uid,Array.prototype.slice.call(arguments),cs);};}
      return function(){return ${n.vm}.call(ct,uid,Array.prototype.slice.call(arguments),cs);};})(${C}[${O}],${SC},${TV}));break;
    }
    case ${Op.NEW_ASYNC}:{
      ${W}((function(uid,cs){return async function(){return ${n.vm}.call(this,uid,Array.prototype.slice.call(arguments),cs);};})(${C}[${O}],${SC}));break;
    }
    case ${Op.NEW_GENERATOR}:case ${Op.NEW_ASYNC_GENERATOR}:{
      ${W}((function(uid,cs){return function(){return ${n.vm}.call(this,uid,Array.prototype.slice.call(arguments),cs);};})(${C}[${O}],${SC}));break;
    }
    case ${Op.SET_FUNC_NAME}:{var fn=${Y}();try{Object.defineProperty(fn,'name',{value:${C}[${O}],configurable:true});}catch(e){}break;}
    case ${Op.SET_FUNC_LENGTH}:{var fn=${Y}();try{Object.defineProperty(fn,'length',{value:${O},configurable:true});}catch(e){}break;}
    case ${Op.BIND_THIS}:case ${Op.MAKE_METHOD}:break;
    case ${Op.PUSH_CLOSURE_VAR}:{var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){${W}(s.${sV}[name]);break;}s=s.${sPar};}break;}
    case ${Op.STORE_CLOSURE_VAR}:{var name=${C}[${O}];var val=${X}();var s=${SC};while(s){if(name in s.${sV}){s.${sV}[name]=val;break;}s=s.${sPar};}break;}

    case ${Op.TYPEOF}:${W}(typeof ${X}());break;
    case ${Op.TYPEOF_GLOBAL}:{
      var name=${C}[${O}];
      var g=typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:typeof global!=='undefined'?global:typeof self!=='undefined'?self:{};
      ${W}(typeof g[name]);
      break;
    }
    case ${Op.VOID}:${X}();${W}(void 0);break;
    case ${Op.DEBUGGER_STMT}:break;

    case ${Op.TRY_PUSH}:{
      var catchIp=(${O}>>16)&0xFFFF;
      var finallyIp=${O}&0xFFFF;
      if(catchIp===0xFFFF)catchIp=-1;
      if(finallyIp===0xFFFF)finallyIp=-1;
      ${EX}.push({catchIp:catchIp,finallyIp:finallyIp,sp:${P}});
      break;
    }
    case ${Op.TRY_POP}:${EX}.pop();break;
    case ${Op.CATCH_BIND}:{
      var err=${X}();
      if(${O}>=0){
        var cname=${C}[${O}];
        if(typeof cname==='string'){${SC}.${sV}[cname]=err;}
        else{${R}[${O}]=err;}
      }else{
        ${W}(err);
      }
      break;
    }
    case ${Op.FINALLY_MARK}:break;
    case ${Op.END_FINALLY}:{
      if(${HPE}){var ex=${PE};${PE}=null;${HPE}=false;throw ex;}
      break;
    }

    case ${Op.GET_ITERATOR}:{
      var iterable=${X}();
      var iter=iterable[Symbol.iterator]();
      var first=iter.next();
      ${W}({_iter:iter,_done:!!first.done,_value:first.value});
      break;
    }
    case ${Op.ITER_NEXT}:{
      var iterObj=${X}();
      ${W}(iterObj._value);
      var nxt=iterObj._iter.next();
      iterObj._done=!!nxt.done;
      iterObj._value=nxt.value;
      break;
    }
    case ${Op.ITER_DONE}:{
      var iterObj=${Y}();
      ${W}(!!iterObj._done);
      break;
    }

    case ${Op.FORIN_INIT}:{
      var obj=${X}();
      var keys=[];
      for(var k in obj)keys.push(k);
      ${W}({_keys:keys,_idx:0});
      break;
    }
    case ${Op.FORIN_NEXT}:{
      var fi=${X}();
      ${W}(fi._keys[fi._idx++]);
      break;
    }
    case ${Op.FORIN_DONE}:{
      var fi=${Y}();
      ${W}(fi._idx>=fi._keys.length);
      break;
    }

    case ${Op.YIELD}:case ${Op.YIELD_DELEGATE}:${W}(void 0);break;
    ${awaitHandler}

    case ${Op.CREATE_GENERATOR}:case ${Op.GENERATOR_RESUME}:case ${Op.GENERATOR_RETURN}:case ${Op.GENERATOR_THROW}:break;
    case ${Op.SUSPEND}:case ${Op.RESUME}:break;
    case ${Op.ASYNC_GENERATOR_YIELD}:case ${Op.ASYNC_GENERATOR_NEXT}:case ${Op.ASYNC_GENERATOR_RETURN}:case ${Op.ASYNC_GENERATOR_THROW}:break;
    case ${Op.CREATE_ASYNC_FROM_SYNC_ITER}:{var it=${X}();${W}({_iter:it,_done:false,_value:void 0});break;}

    case ${Op.CATCH_BIND_PATTERN}:{var err=${X}();${W}(err);break;}
    case ${Op.THROW_IF_NOT_OBJECT}:{var v=${Y}();if(typeof v!=='object'||v===null)throw new TypeError('Value is not an object');break;}
    case ${Op.THROW_REF_ERROR}:{throw new ReferenceError(${C}[${O}]||'not defined');}
    case ${Op.THROW_TYPE_ERROR}:{throw new TypeError(${C}[${O}]||'type error');}
    case ${Op.THROW_SYNTAX_ERROR}:{throw new SyntaxError(${C}[${O}]||'syntax error');}

    case ${Op.ITER_VALUE}:{var iterObj=${Y}();${W}(iterObj._value);break;}
    case ${Op.ITER_CLOSE}:{var iterObj=${X}();if(iterObj._iter.return)iterObj._iter.return();break;}
    case ${Op.ITER_RESULT_UNWRAP}:{var iterObj=${Y}();${W}(iterObj._value);${W}(!!iterObj._done);break;}

    case ${Op.GET_ASYNC_ITERATOR}:{
      var iterable=${X}();
      var method=iterable[Symbol.asyncIterator]||iterable[Symbol.iterator];
      var iter=method.call(iterable);
      ${W}({_iter:iter,_done:false,_value:void 0,_async:true});break;
    }
    case ${Op.ASYNC_ITER_NEXT}:{var iterObj=${Y}();var result=${isAsync ? 'await iterObj._iter.next()' : 'iterObj._iter.next()'};iterObj._done=!!result.done;iterObj._value=result.value;break;}
    case ${Op.ASYNC_ITER_DONE}:{var iterObj=${Y}();${W}(!!iterObj._done);break;}
    case ${Op.ASYNC_ITER_VALUE}:{var iterObj=${Y}();${W}(iterObj._value);break;}
    case ${Op.ASYNC_ITER_CLOSE}:{var iterObj=${X}();if(iterObj._iter.return)${isAsync ? 'await iterObj._iter.return()' : 'iterObj._iter.return()'};break;}
    case ${Op.FOR_AWAIT_NEXT}:{var iterObj=${Y}();var result=${isAsync ? 'await iterObj._iter.next()' : 'iterObj._iter.next()'};iterObj._done=!!result.done;iterObj._value=result.value;${W}(result.value);break;}

    case ${Op.TO_NUMBER}:${W}(Number(${X}()));break;
    case ${Op.TO_STRING}:${W}(String(${X}()));break;
    case ${Op.TO_BOOLEAN}:${W}(Boolean(${X}()));break;
    case ${Op.TO_OBJECT}:${W}(Object(${X}()));break;
    case ${Op.TO_PROPERTY_KEY}:{var v=${X}();${W}(typeof v==='symbol'?v:String(v));break;}
    case ${Op.TO_NUMERIC}:{var v=${X}();${W}(typeof v==='bigint'?v:Number(v));break;}

    case ${Op.TEMPLATE_LITERAL}:{
      var exprCount=${O};var parts=[];
      for(var ti=exprCount*2;ti>=0;ti--)parts.unshift(${X}());
      var result='';for(var ti=0;ti<parts.length;ti++)result+=String(parts[ti]!=null?parts[ti]:'');
      ${W}(result);break;
    }
    case ${Op.TAGGED_TEMPLATE}:{
      var argc=${O};var callArgs=[];for(var ai=0;ai<argc;ai++)callArgs.unshift(${X}());
      var fn=${X}();${W}(fn.apply(void 0,callArgs));break;
    }
    case ${Op.CREATE_RAW_STRINGS}:{
      var count=${O};var raw=[];for(var ri=0;ri<count;ri++)raw.unshift(${X}());
      Object.freeze(raw);${W}(raw);break;
    }

    case ${Op.INC_SCOPED}:{var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){s.${sV}[name]=s.${sV}[name]+1;${W}(s.${sV}[name]);break;}s=s.${sPar};}break;}
    case ${Op.DEC_SCOPED}:{var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){s.${sV}[name]=s.${sV}[name]-1;${W}(s.${sV}[name]);break;}s=s.${sPar};}break;}
    case ${Op.POST_INC_SCOPED}:{var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){var old=s.${sV}[name];s.${sV}[name]=old+1;${W}(old);break;}s=s.${sPar};}break;}
    case ${Op.POST_DEC_SCOPED}:{var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){var old=s.${sV}[name];s.${sV}[name]=old-1;${W}(old);break;}s=s.${sPar};}break;}
    case ${Op.ADD_ASSIGN_SCOPED}:{var val=${X}();var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){s.${sV}[name]+=val;${W}(s.${sV}[name]);break;}s=s.${sPar};}break;}
    case ${Op.SUB_ASSIGN_SCOPED}:{var val=${X}();var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){s.${sV}[name]-=val;${W}(s.${sV}[name]);break;}s=s.${sPar};}break;}
    case ${Op.MUL_ASSIGN_SCOPED}:{var val=${X}();var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){s.${sV}[name]*=val;${W}(s.${sV}[name]);break;}s=s.${sPar};}break;}
    case ${Op.DIV_ASSIGN_SCOPED}:{var val=${X}();var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){s.${sV}[name]/=val;${W}(s.${sV}[name]);break;}s=s.${sPar};}break;}
    case ${Op.MOD_ASSIGN_SCOPED}:{var val=${X}();var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){s.${sV}[name]%=val;${W}(s.${sV}[name]);break;}s=s.${sPar};}break;}
    case ${Op.POW_ASSIGN_SCOPED}:{var val=${X}();var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){s.${sV}[name]**=val;${W}(s.${sV}[name]);break;}s=s.${sPar};}break;}
    case ${Op.BIT_AND_ASSIGN_SCOPED}:{var val=${X}();var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){s.${sV}[name]&=val;${W}(s.${sV}[name]);break;}s=s.${sPar};}break;}
    case ${Op.BIT_OR_ASSIGN_SCOPED}:{var val=${X}();var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){s.${sV}[name]|=val;${W}(s.${sV}[name]);break;}s=s.${sPar};}break;}
    case ${Op.BIT_XOR_ASSIGN_SCOPED}:{var val=${X}();var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){s.${sV}[name]^=val;${W}(s.${sV}[name]);break;}s=s.${sPar};}break;}
    case ${Op.SHL_ASSIGN_SCOPED}:{var val=${X}();var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){s.${sV}[name]<<=val;${W}(s.${sV}[name]);break;}s=s.${sPar};}break;}
    case ${Op.SHR_ASSIGN_SCOPED}:{var val=${X}();var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){s.${sV}[name]>>=val;${W}(s.${sV}[name]);break;}s=s.${sPar};}break;}
    case ${Op.USHR_ASSIGN_SCOPED}:{var val=${X}();var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){s.${sV}[name]>>>=val;${W}(s.${sV}[name]);break;}s=s.${sPar};}break;}
    case ${Op.AND_ASSIGN_SCOPED}:{var val=${X}();var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){s.${sV}[name]=s.${sV}[name]&&val;${W}(s.${sV}[name]);break;}s=s.${sPar};}break;}
    case ${Op.OR_ASSIGN_SCOPED}:{var val=${X}();var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){s.${sV}[name]=s.${sV}[name]||val;${W}(s.${sV}[name]);break;}s=s.${sPar};}break;}
    case ${Op.NULLISH_ASSIGN_SCOPED}:{var val=${X}();var name=${C}[${O}];var s=${SC};while(s){if(name in s.${sV}){if(s.${sV}[name]==null)s.${sV}[name]=val;${W}(s.${sV}[name]);break;}s=s.${sPar};}break;}
    case ${Op.ASSIGN_OP}:break;
    case ${Op.INC_REG}:${R}[${O}]=(${R}[${O}]||0)+1;break;
    case ${Op.DEC_REG}:${R}[${O}]=(${R}[${O}]||0)-1;break;
    case ${Op.FAST_ADD_CONST}:${W}(${X}()+${O});break;
    case ${Op.FAST_SUB_CONST}:${W}(${X}()-${O});break;
    case ${Op.FAST_GET_PROP}:{var name=${C}[${O}&0xFFFF];var varName=${C}[(${O}>>16)&0xFFFF];var s=${SC};while(s){if(varName in s.${sV}){${W}(s.${sV}[varName][name]);break;}s=s.${sPar};}break;}
    case ${Op.LOAD_GLOBAL_FAST}:{var g=typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:typeof global!=='undefined'?global:typeof self!=='undefined'?self:{};${W}(g[${C}[${O}]]);break;}

    case ${Op.PUSH_THIS}:${W}(${TV});break;
    case ${Op.PUSH_ARGUMENTS}:${W}(${A});break;
    case ${Op.PUSH_NEW_TARGET}:${W}(${NT});break;
    case ${Op.PUSH_GLOBAL_THIS}:{var g=typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:typeof global!=='undefined'?global:typeof self!=='undefined'?self:{};${W}(g);break;}
    case ${Op.PUSH_WELL_KNOWN_SYMBOL}:{var syms=[Symbol.iterator,Symbol.asyncIterator,Symbol.hasInstance,Symbol.toPrimitive,Symbol.toStringTag,Symbol.species,Symbol.isConcatSpreadable,Symbol.match,Symbol.replace,Symbol.search,Symbol.split,Symbol.unscopables];${W}(syms[${O}]||Symbol.iterator);break;}
    case ${Op.IMPORT_META}:${W}({});break;
    case ${Op.DYNAMIC_IMPORT}:{var spec=${X}();${W}(import(spec));break;}
    case ${Op.DEBUGGER_STMT}:break;
    case ${Op.COMMA}:break;
    case ${Op.SOURCE_MAP}:break;
    case ${Op.ASSERT_DEFINED}:{var v=${Y}();if(v===void 0)throw new TypeError('Cannot read properties of undefined');break;}
    case ${Op.ASSERT_FUNCTION}:{var v=${Y}();if(typeof v!=='function')throw new TypeError(v+' is not a function');break;}

    case ${Op.DESTRUCTURE_BIND}:break;
    case ${Op.DESTRUCTURE_DEFAULT}:{var v=${Y}();if(v===void 0){${P}--;var def=${C}[${O}];${W}(def);}break;}
    case ${Op.DESTRUCTURE_REST_ARRAY}:{
      var iterObj=${X}();var rest=[];
      while(!iterObj._done){rest.push(iterObj._value);var nxt=iterObj._iter.next();iterObj._done=!!nxt.done;iterObj._value=nxt.value;}
      ${W}(rest);break;
    }
    case ${Op.DESTRUCTURE_REST_OBJECT}:{
      var excludeKeys=${X}();var src=${X}();var rest={};
      var keys=Object.keys(src);for(var ki=0;ki<keys.length;ki++){if(excludeKeys.indexOf(keys[ki])<0)rest[keys[ki]]=src[keys[ki]];}
      ${W}(rest);break;
    }
    case ${Op.ARRAY_PATTERN_INIT}:{
      var arr=${X}();var iter=arr[Symbol.iterator]();var first=iter.next();
      ${W}({_iter:iter,_done:!!first.done,_value:first.value});break;
    }
    case ${Op.OBJECT_PATTERN_GET}:{var obj=${Y}();${W}(obj[${C}[${O}]]);break;}

    case ${Op.CREATE_UNMAPPED_ARGS}:case ${Op.CREATE_MAPPED_ARGS}:${W}(Array.prototype.slice.call(${A}));break;
    case ${Op.CREATE_REST_ARGS}:${W}(Array.prototype.slice.call(${A},${O}));break;

    default:break;
    }
  }
  return void 0;
  }catch(e){
    ${debug ? `${n.dbg}('EXCEPTION','error=',e&&e.message?e.message:e,'${EX}='+${EX}.length);` : ''}
    ${HPE}=false;${PE}=null;
    if(${EX}.length>0){
      var handler=${EX}.pop();
      if(handler.catchIp>=0){
        ${debug ? `${n.dbg}('CATCH','ip='+handler.catchIp,'sp='+handler.sp);` : ''}
        ${P}=handler.sp;
        ${W}(e);
        ${IP}=handler.catchIp*2;
        continue;
      }
      if(handler.finallyIp>=0){
        ${debug ? `${n.dbg}('FINALLY','ip='+handler.finallyIp,'sp='+handler.sp);` : ''}
        ${P}=handler.sp;
        ${PE}=e;${HPE}=true;
        ${IP}=handler.finallyIp*2;
        continue;
      }
    }
    ${debug ? `${n.dbg}('UNCAUGHT','error=',e&&e.message?e.message:e);` : ''}
    throw e;
  }
  }
  }finally{${n.depth}--;${n.callStack}.pop();}
}
`;

  // Remap case labels from logical opcode numbers to physical (shuffled) numbers.
  // This eliminates the need for a plaintext reverse opcode map in the output.
  return template.replace(/\bcase (\d+):/g, (_, numStr) => {
    const logical = parseInt(numStr, 10);
    return `case ${shuffleMap[logical]!}:`;
  });
}
