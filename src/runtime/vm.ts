/**
 * VM runtime code generator.
 *
 * Produces a self-contained IIFE that contains:
 *   - The reverse shuffle map (`_RM`)
 *   - The interpreter cores (`_exec` / `_execAsync`)
 *   - The dispatch functions (`_vm` / `_vm.call`)
 *   - A bytecode loader + cache (`_load`)
 *   - Optional: fingerprint + RC4 decoder, debug protection, debug logging
 *
 * The generated code is meant to be prepended to the obfuscated source file
 * with the bytecode table (`_BT`) injected inside the IIFE.
 *
 * @module runtime/vm
 */

import { Op, OPCODE_COUNT } from "../compiler/opcodes.js";
import { VM_MAX_RECURSION_DEPTH } from "../constants.js";
import { generateFingerprintSource } from "./fingerprint.js";
import { generateDecoderSource } from "./decoder.js";

/**
 * Generate the complete VM runtime source code.
 *
 * @returns A JS source string containing the runtime IIFE.
 */
export function generateVmRuntime(options: {
  opcodeShuffleMap: number[];
  encrypt: boolean;
  debugProtection: boolean;
  debugLogging?: boolean;
}): string {
  const { opcodeShuffleMap, encrypt, debugProtection, debugLogging = false } = options;

  const reverseMap = new Array<number>(OPCODE_COUNT);
  for (let i = 0; i < opcodeShuffleMap.length; i++) {
    reverseMap[opcodeShuffleMap[i]!] = i;
  }

  const parts: string[] = [];
  parts.push(`(function(){`);
  parts.push(`"use strict";`);

  if (encrypt) {
    parts.push(generateFingerprintSource());
    parts.push(generateDecoderSource());
  }

  if (debugProtection) {
    parts.push(generateDebugProtection());
  }

  if (debugLogging) {
    parts.push(generateDebugLogging(reverseMap));
  }

  parts.push(`var _RM=[${reverseMap.join(",")}];`);
  parts.push(generateInterpreterCore(debugLogging));
  parts.push(generateRunners(debugLogging));
  parts.push(`
var _vmDepth=0;
var _vmStack=[];
var _cache={};
function _load(id){
  if(_cache[id])return _cache[id];
  var raw=_BT[id];
  if(typeof raw==='string'){
    ${encrypt ? `var bytes=_b64decode(raw);var key=_fingerprint().toString(16);var dec=_rc4(bytes,key);_cache[id]=_deserialize(dec);` : `var u=JSON.parse(raw);for(var j=0;j<u.c.length;j++){var cv=u.c[j];if(cv&&cv.__regex__){u.c[j]=new RegExp(cv.p,cv.f);}else if(cv&&cv.__bigint__){u.c[j]=BigInt(cv.v);}}_cache[id]=u;`}
  }else{
    if(raw&&raw.c){for(var j=0;j<raw.c.length;j++){var cv=raw.c[j];if(cv&&cv.__regex__){raw.c[j]=new RegExp(cv.p,cv.f);}else if(cv&&cv.__bigint__){raw.c[j]=BigInt(cv.v);}}}
    _cache[id]=raw;
  }
  return _cache[id];
}
`);

  parts.push(generateDeserializer());

  parts.push(`
if(typeof globalThis!=='undefined'){globalThis._vm=_vm;}
else if(typeof window!=='undefined'){window._vm=_vm;}
else if(typeof global!=='undefined'){global._vm=_vm;}
else if(typeof self!=='undefined'){self._vm=_vm;}
`);

  parts.push(`})();`);

  return parts.join("\n");
}

function generateDebugProtection(): string {
  return `
(function _dbgProt(){
  var threshold=100;
  setInterval(function(){
    var start=Date.now();
    debugger;
    if(Date.now()-start>threshold){
      while(true){debugger;}
    }
  },4000);
})();
`;
}

function generateDebugLogging(reverseMap: number[]): string {
  // Build opcode name table: physical opcode → name string
  const opNames = Object.entries(Op)
    .filter(([, v]) => typeof v === "number" && v < OPCODE_COUNT)
    .reduce((m, [name, num]) => { m[num as number] = name; return m; }, {} as Record<number, string>);

  // Map physical opcodes to names via the reverse map
  const nameEntries: string[] = [];
  for (let phys = 0; phys < reverseMap.length; phys++) {
    const logical = reverseMap[phys]!;
    const name = opNames[logical] ?? `OP_${logical}`;
    nameEntries.push(`${phys}:"${name}"`);
  }

  return `
var _vmDbg={
  enabled:true,
  level:'trace',
  filter:null,
  maxLogs:10000,
  _count:0,
  _opNames:{${nameEntries.join(',')}},
  levels:{trace:0,info:1,warn:2,error:3}
};
function _dbg(){
  if(!_vmDbg.enabled)return;
  if(_vmDbg._count>=_vmDbg.maxLogs){
    if(_vmDbg._count===_vmDbg.maxLogs){console.warn('[VM_DBG] max logs reached ('+_vmDbg.maxLogs+'), silencing');_vmDbg._count++;}
    return;
  }
  _vmDbg._count++;
  var args=Array.prototype.slice.call(arguments);
  console.log.apply(console,['[VM_DBG]'].concat(args));
}
function _dbgOp(op,operand,C,sp,stack){
  if(!_vmDbg.enabled||_vmDbg.levels[_vmDbg.level]>0)return;
  if(_vmDbg._count>=_vmDbg.maxLogs)return;
  _vmDbg._count++;
  var name=_vmDbg._opNames[op]||('OP_'+op);
  var topStr='(empty)';
  if(sp>=0){
    var top=stack[sp];
    topStr=typeof top==='function'?'[fn'+(top.name?':'+top.name:'')+']':typeof top==='object'&&top!==null?'[obj:'+Object.keys(top).slice(0,3).join(',')+']':String(top);
    if(topStr.length>60)topStr=topStr.slice(0,60)+'...';
  }
  var constStr='';
  if(typeof C[operand]==='string')constStr=' c="'+C[operand].slice(0,30)+'"';
  else if(typeof C[operand]==='number')constStr=' c='+C[operand];
  console.log('[VM_TRACE] '+name+' op='+operand+constStr+' sp='+sp+' top='+topStr);
}
`;
}

function generateInterpreterCore(debug: boolean = false): string {
  return generateExecBody(false, debug) + '\n' + generateExecBody(true, debug);
}

function generateExecBody(isAsync: boolean, debug: boolean = false): string {
  const fnDecl = isAsync ? 'async function _execAsync' : 'function _exec';
  const fnLabel = isAsync ? '_execAsync' : '_exec';
  const awaitHandler = isAsync
    ? `case ${Op.AWAIT}:{${debug ? `_dbg('AWAIT','awaiting:',typeof peek()==='object'?'[Promise]':peek());` : ''}push(await pop());break;}`
    : `case ${Op.AWAIT}:push(void 0);break;`;

  // Debug-aware closure handler
  const closureHandler = debug ? `
    case ${Op.NEW_CLOSURE}:{
      var _cuid=C[operand];var _cu=_load(_cuid);
      _dbg('NEW_CLOSURE','uid='+_cuid,'async='+!!_cu.s,'params='+_cu.p,'arrow='+!!_cu.a);
      if(_cu.a){if(_cu.s){push((function(uid,cs,ct){return async function(){
        _dbg('CALL_CLOSURE','async arrow uid='+uid,'args='+arguments.length);
        return _vm.call(ct,uid,Array.prototype.slice.call(arguments),cs);
      };})(C[operand],scope,thisVal));}else{push((function(uid,cs,ct){return function(){
        _dbg('CALL_CLOSURE','arrow uid='+uid,'args='+arguments.length);
        return _vm.call(ct,uid,Array.prototype.slice.call(arguments),cs);
      };})(C[operand],scope,thisVal));}}
      else{if(_cu.s){push((function(uid,cs){return async function(){
        _dbg('CALL_CLOSURE','async uid='+uid,'args='+arguments.length);
        return _vm.call(this,uid,Array.prototype.slice.call(arguments),cs);
      };})(C[operand],scope));}else{push((function(uid,cs){return function(){
        _dbg('CALL_CLOSURE','uid='+uid,'args='+arguments.length);
        return _vm.call(this,uid,Array.prototype.slice.call(arguments),cs);
      };})(C[operand],scope));}}
      break;
    }
    case ${Op.NEW_FUNCTION}:{
      var _fuid=C[operand];var _fu=_load(_fuid);
      _dbg('NEW_FUNCTION','uid='+_fuid,'async='+!!_fu.s,'params='+_fu.p);
      if(_fu.s){push((function(uid,cs){return async function(){
        _dbg('CALL_FUNCTION','async uid='+uid,'args='+arguments.length);
        return _vm.call(this,uid,Array.prototype.slice.call(arguments),cs);
      };})(C[operand],scope));}else{push((function(uid,cs){return function(){
        _dbg('CALL_FUNCTION','uid='+uid,'args='+arguments.length);
        return _vm.call(this,uid,Array.prototype.slice.call(arguments),cs);
      };})(C[operand],scope));}
      break;
    }` : `
    case ${Op.NEW_CLOSURE}:{
      var _cuid=C[operand];var _cu=_load(_cuid);
      if(_cu.a){push((function(uid,cs,ct){if(_cu.s){return async function(){
        return _vm.call(ct,uid,Array.prototype.slice.call(arguments),cs);
      };}return function(){
        return _vm.call(ct,uid,Array.prototype.slice.call(arguments),cs);
      };})(C[operand],scope,thisVal));}
      else{push((function(uid,cs){if(_cu.s){return async function(){
        return _vm.call(this,uid,Array.prototype.slice.call(arguments),cs);
      };}return function(){
        return _vm.call(this,uid,Array.prototype.slice.call(arguments),cs);
      };})(C[operand],scope));}
      break;
    }
    case ${Op.NEW_FUNCTION}:{
      push((function(uid,cs){var u=_load(uid);if(u.s){return async function(){
        return _vm.call(this,uid,Array.prototype.slice.call(arguments),cs);
      };}return function(){
        return _vm.call(this,uid,Array.prototype.slice.call(arguments),cs);
      };})(C[operand],scope));
      break;
    }`;

  // Debug pre-opcode trace (emitted before each opcode dispatch)
  const dbgTrace = debug
    ? `_dbgOp(op,operand,C,sp,stack);`
    : '';

  return `
${fnDecl}(unit,args,outerScope,thisVal,newTarget){
  _vmDepth++;
  var _uid_=(unit._dbgId||'?');
  _vmStack.push(_uid_);
  if(_vmDepth>${VM_MAX_RECURSION_DEPTH}){var _last20=_vmStack.slice(-20).join(' > ');_vmDepth--;_vmStack.pop();throw new RangeError('VM recursion limit (depth='+_vmDepth+'): '+_last20);}
  try{
  var stack=[];
  var regs=new Array(unit.r);
  var ip=0;
  var C=unit.c;
  var I=unit.i;
  var exStack=[];
  var pendingEx=null;
  var hasPendingEx=false;
  var scope={parent:outerScope,vars:{},constVars:{},tdzVars:{}};
  var sp=-1;
  ${debug ? `var _uid=unit._dbgId||'?';_dbg('ENTER','${fnLabel}','unit='+_uid,'params='+unit.p,'args='+args.length,'async='+!!unit.s,'regs='+unit.r,'depth='+_vmDepth);` : ''}

  function push(v){stack[++sp]=v;}
  function pop(){return stack[sp--];}
  function peek(){return stack[sp];}

  for(;;){
  try{
  while(ip<I.length){
    var phys=I[ip];
    var operand=I[ip+1];
    var op=_RM[phys];
    ip+=2;
    ${dbgTrace}

    switch(op){
    case ${Op.PUSH_CONST}:push(C[operand]);break;
    case ${Op.PUSH_UNDEFINED}:push(void 0);break;
    case ${Op.PUSH_NULL}:push(null);break;
    case ${Op.PUSH_TRUE}:push(true);break;
    case ${Op.PUSH_FALSE}:push(false);break;
    case ${Op.PUSH_ZERO}:push(0);break;
    case ${Op.PUSH_ONE}:push(1);break;
    case ${Op.PUSH_NEG_ONE}:push(-1);break;
    case ${Op.PUSH_EMPTY_STRING}:push('');break;
    case ${Op.PUSH_NAN}:push(NaN);break;
    case ${Op.PUSH_INFINITY}:push(Infinity);break;
    case ${Op.PUSH_NEG_INFINITY}:push(-Infinity);break;
    case ${Op.POP}:sp--;break;
    case ${Op.POP_N}:sp-=operand;break;
    case ${Op.DUP}:push(peek());break;
    case ${Op.DUP2}:{var _a=stack[sp-1];var _b=stack[sp];push(_a);push(_b);break;}
    case ${Op.SWAP}:{var a=pop();var b=pop();push(a);push(b);break;}
    case ${Op.ROT3}:{var c=pop();var b=pop();var a=pop();push(c);push(a);push(b);break;}
    case ${Op.ROT4}:{var d=pop();var c=pop();var b=pop();var a=pop();push(d);push(a);push(b);push(c);break;}
    case ${Op.PICK}:{push(stack[sp-operand]);break;}

    case ${Op.LOAD_REG}:push(regs[operand]);break;
    case ${Op.STORE_REG}:regs[operand]=pop();break;
    case ${Op.LOAD_ARG}:push(operand<args.length?args[operand]:void 0);break;
    case ${Op.STORE_ARG}:args[operand]=pop();break;
    case ${Op.LOAD_ARG_OR_DEFAULT}:push(operand<args.length&&args[operand]!==void 0?args[operand]:void 0);break;
    case ${Op.GET_ARG_COUNT}:push(args.length);break;

    case ${Op.ADD}:{var b=pop();var a=pop();push(a+b);break;}
    case ${Op.SUB}:{var b=pop();var a=pop();push(a-b);break;}
    case ${Op.MUL}:{var b=pop();var a=pop();push(a*b);break;}
    case ${Op.DIV}:{var b=pop();var a=pop();push(a/b);break;}
    case ${Op.MOD}:{var b=pop();var a=pop();push(a%b);break;}
    case ${Op.POW}:{var b=pop();var a=pop();push(a**b);break;}
    case ${Op.NEG}:push(-pop());break;
    case ${Op.UNARY_PLUS}:push(+pop());break;
    case ${Op.INC}:push(pop()+1);break;
    case ${Op.DEC}:push(pop()-1);break;

    case ${Op.BIT_AND}:{var b=pop();var a=pop();push(a&b);break;}
    case ${Op.BIT_OR}:{var b=pop();var a=pop();push(a|b);break;}
    case ${Op.BIT_XOR}:{var b=pop();var a=pop();push(a^b);break;}
    case ${Op.BIT_NOT}:push(~pop());break;
    case ${Op.SHL}:{var b=pop();var a=pop();push(a<<b);break;}
    case ${Op.SHR}:{var b=pop();var a=pop();push(a>>b);break;}
    case ${Op.USHR}:{var b=pop();var a=pop();push(a>>>b);break;}

    case ${Op.NOT}:push(!pop());break;
    case ${Op.LOGICAL_AND}:{var v=peek();if(!v){ip=operand*2;}else{sp--;}break;}
    case ${Op.LOGICAL_OR}:{var v=peek();if(v){ip=operand*2;}else{sp--;}break;}
    case ${Op.NULLISH_COALESCE}:{var v=peek();if(v!==null&&v!==void 0){ip=operand*2;}else{sp--;}break;}

    case ${Op.EQ}:{var b=pop();var a=pop();push(a==b);break;}
    case ${Op.NEQ}:{var b=pop();var a=pop();push(a!=b);break;}
    case ${Op.SEQ}:{var b=pop();var a=pop();push(a===b);break;}
    case ${Op.SNEQ}:{var b=pop();var a=pop();push(a!==b);break;}
    case ${Op.LT}:{var b=pop();var a=pop();push(a<b);break;}
    case ${Op.LTE}:{var b=pop();var a=pop();push(a<=b);break;}
    case ${Op.GT}:{var b=pop();var a=pop();push(a>b);break;}
    case ${Op.GTE}:{var b=pop();var a=pop();push(a>=b);break;}

    case ${Op.JMP}:ip=operand*2;break;
    case ${Op.JMP_TRUE}:if(pop())ip=operand*2;break;
    case ${Op.JMP_FALSE}:if(!pop())ip=operand*2;break;
    case ${Op.JMP_NULLISH}:{var v=pop();if(v===null||v===void 0)ip=operand*2;break;}
    case ${Op.JMP_UNDEFINED}:{var v=pop();if(v===void 0)ip=operand*2;break;}
    case ${Op.JMP_TRUE_KEEP}:if(peek())ip=operand*2;break;
    case ${Op.JMP_FALSE_KEEP}:if(!peek())ip=operand*2;break;
    case ${Op.JMP_NULLISH_KEEP}:{var v=peek();if(v===null||v===void 0)ip=operand*2;break;}
    case ${Op.RETURN}:{var _rv=pop();${debug ? `_dbg('RETURN','value=',_rv);` : ''}return _rv;}
    case ${Op.RETURN_VOID}:${debug ? `_dbg('RETURN_VOID');` : ''}return void 0;
    case ${Op.THROW}:{var _te=pop();${debug ? `_dbg('THROW','error=',_te);` : ''}throw _te;}
    case ${Op.RETHROW}:{if(hasPendingEx){var ex=pendingEx;pendingEx=null;hasPendingEx=false;throw ex;}break;}
    case ${Op.NOP}:break;
    case ${Op.TABLE_SWITCH}:case ${Op.LOOKUP_SWITCH}:{ip=operand*2;break;}

    case ${Op.GET_PROP_STATIC}:{var obj=pop();push(obj[C[operand]]);break;}
    case ${Op.SET_PROP_STATIC}:{var val=pop();var obj=pop();var k=C[operand];try{obj[k]=val;}catch(_){Object.defineProperty(obj,k,{value:val,writable:true,configurable:true});}push(obj);break;}
    case ${Op.GET_PROP_DYNAMIC}:{var key=pop();var obj=pop();push(obj[key]);break;}
    case ${Op.SET_PROP_DYNAMIC}:{var val=pop();var key=pop();var obj=pop();obj[key]=val;push(obj);break;}
    case ${Op.DELETE_PROP_STATIC}:{var obj=pop();push(delete obj[C[operand]]);break;}
    case ${Op.DELETE_PROP_DYNAMIC}:{var key=pop();var obj=pop();push(delete obj[key]);break;}
    case ${Op.OPT_CHAIN_GET}:{var key=C[operand];var obj=pop();push(obj==null?void 0:obj[key]);break;}
    case ${Op.OPT_CHAIN_DYNAMIC}:{var key=pop();var obj=pop();push(obj==null?void 0:obj[key]);break;}
    case ${Op.IN_OP}:{var obj=pop();var key=pop();push(key in obj);break;}
    case ${Op.INSTANCEOF}:{var ctor=pop();var obj=pop();push(obj instanceof ctor);break;}
    case ${Op.GET_SUPER_PROP}:{var sp2=Object.getPrototypeOf(Object.getPrototypeOf(thisVal));var key=operand>=0?C[operand]:pop();push(sp2?sp2[key]:void 0);break;}
    case ${Op.SET_SUPER_PROP}:{var val=pop();var sp2=Object.getPrototypeOf(Object.getPrototypeOf(thisVal));var key=operand>=0?C[operand]:pop();if(sp2)sp2[key]=val;push(val);break;}
    case ${Op.GET_PRIVATE_FIELD}:{var obj=pop();var name=C[operand];push(obj[name]);break;}
    case ${Op.SET_PRIVATE_FIELD}:{var val=pop();var obj=pop();var name=C[operand];obj[name]=val;push(val);break;}
    case ${Op.HAS_PRIVATE_FIELD}:{var obj=pop();var name=C[operand];push(name in obj);break;}
    case ${Op.DEFINE_OWN_PROPERTY}:{var desc=pop();var key=pop();var obj=pop();Object.defineProperty(obj,key,desc);push(obj);break;}

    case ${Op.LOAD_SCOPED}:{
      var name=C[operand];
      var s=scope;
      var found=false;
      while(s){
        if(name in s.vars){push(s.vars[name]);found=true;break;}
        s=s.parent;
      }
      if(!found){
        var g=typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:typeof global!=='undefined'?global:typeof self!=='undefined'?self:{};
        push(g[name]);
      }
      break;
    }
    case ${Op.STORE_SCOPED}:{
      var name=C[operand];
      var val=pop();
      var s=scope;
      var found=false;
      while(s){
        if(name in s.vars){s.vars[name]=val;found=true;break;}
        s=s.parent;
      }
      if(!found){
        var g=typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:typeof global!=='undefined'?global:typeof self!=='undefined'?self:{};
        g[name]=val;
      }
      break;
    }
    case ${Op.DECLARE_VAR}:case ${Op.DECLARE_LET}:case ${Op.DECLARE_CONST}:{
      var name=C[operand];
      if(!(name in scope.vars))scope.vars[name]=void 0;
      break;
    }

    case ${Op.PUSH_SCOPE}:case ${Op.PUSH_BLOCK_SCOPE}:case ${Op.PUSH_CATCH_SCOPE}:scope={parent:scope,vars:{},constVars:{},tdzVars:{}};break;
    case ${Op.POP_SCOPE}:scope=scope.parent||scope;break;
    case ${Op.TDZ_CHECK}:{var name=C[operand];if(scope.tdzVars&&scope.tdzVars[name])throw new ReferenceError("Cannot access '"+name+"' before initialization");break;}
    case ${Op.TDZ_MARK}:{var name=C[operand];if(scope.tdzVars)delete scope.tdzVars[name];break;}
    case ${Op.PUSH_WITH_SCOPE}:{var wObj=pop();scope={parent:scope,vars:wObj,constVars:{},tdzVars:{}};break;}
    case ${Op.DELETE_SCOPED}:{var name=C[operand];var s=scope;while(s){if(name in s.vars){push(delete s.vars[name]);break;}s=s.parent;}break;}

    case ${Op.LOAD_GLOBAL}:{
      var g=typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:typeof global!=='undefined'?global:typeof self!=='undefined'?self:{};
      push(g[C[operand]]);break;
    }
    case ${Op.STORE_GLOBAL}:{
      var g=typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:typeof global!=='undefined'?global:typeof self!=='undefined'?self:{};
      g[C[operand]]=pop();break;
    }

    case ${Op.CALL}:{
      var argc=operand;
      var hasSpread=argc<0;
      if(hasSpread)argc=-argc;
      var callArgs=[];
      for(var ai=0;ai<argc;ai++)callArgs.unshift(pop());
      if(hasSpread){
        var flat=[];
        for(var ai=0;ai<callArgs.length;ai++){
          if(callArgs[ai]&&callArgs[ai].__spread__){
            for(var si=0;si<callArgs[ai].items.length;si++)flat.push(callArgs[ai].items[si]);
          }else flat.push(callArgs[ai]);
        }
        callArgs=flat;
      }
      var fn=pop();
      ${debug ? `_dbg('CALL','fn=',typeof fn,'argc='+callArgs.length,fn&&fn.name?'name='+fn.name:'');if(typeof fn!=='function')_dbg('CALL_ERR','NOT A FUNCTION:',fn,'stack depth='+sp);` : ''}
      push(fn.apply(void 0,callArgs));
      break;
    }
    case ${Op.CALL_METHOD}:{
      var argc=operand;
      var hasSpread=argc<0;
      if(hasSpread)argc=-argc;
      var callArgs=[];
      for(var ai=0;ai<argc;ai++)callArgs.unshift(pop());
      if(hasSpread){
        var flat=[];
        for(var ai=0;ai<callArgs.length;ai++){
          if(callArgs[ai]&&callArgs[ai].__spread__){
            for(var si=0;si<callArgs[ai].items.length;si++)flat.push(callArgs[ai].items[si]);
          }else flat.push(callArgs[ai]);
        }
        callArgs=flat;
      }
      var recv=pop();
      var fn=pop();
      ${debug ? `_dbg('CALL_METHOD','fn=',typeof fn,'recv=',typeof recv,'argc='+callArgs.length,fn&&fn.name?'name='+fn.name:'');if(typeof fn!=='function')_dbg('CALL_METHOD_ERR','NOT A FUNCTION:',fn,'recv=',recv);` : ''}
      push(fn.apply(recv,callArgs));
      break;
    }
    case ${Op.CALL_NEW}:{
      var argc=operand;
      var callArgs=[];
      for(var ai=0;ai<argc;ai++)callArgs.unshift(pop());
      var Ctor=pop();
      push(new (Ctor.bind.apply(Ctor,[null].concat(callArgs)))());
      break;
    }
    case ${Op.SUPER_CALL}:{
      var argc=operand;
      var callArgs=[];
      for(var ai=0;ai<argc;ai++)callArgs.unshift(pop());
      var superProto=Object.getPrototypeOf(Object.getPrototypeOf(thisVal));
      ${debug ? `_dbg('SUPER_CALL','argc='+argc,'superProto=',!!superProto,'superCtor=',superProto&&typeof superProto.constructor);` : ''}
      if(superProto&&superProto.constructor){
        superProto.constructor.apply(thisVal,callArgs);
      }
      push(thisVal);
      break;
    }

    case ${Op.SPREAD_ARGS}:{var v=pop();push({__spread__:true,items:Array.from(v)});break;}
    case ${Op.CALL_OPTIONAL}:{
      var argc=operand;var hasSpread=argc<0;if(hasSpread)argc=-argc;
      var callArgs=[];for(var ai=0;ai<argc;ai++)callArgs.unshift(pop());
      if(hasSpread){var flat=[];for(var ai=0;ai<callArgs.length;ai++){if(callArgs[ai]&&callArgs[ai].__spread__){for(var si=0;si<callArgs[ai].items.length;si++)flat.push(callArgs[ai].items[si]);}else flat.push(callArgs[ai]);}callArgs=flat;}
      var fn=pop();push(fn==null?void 0:fn.apply(void 0,callArgs));break;
    }
    case ${Op.CALL_METHOD_OPTIONAL}:{
      var argc=operand;var hasSpread=argc<0;if(hasSpread)argc=-argc;
      var callArgs=[];for(var ai=0;ai<argc;ai++)callArgs.unshift(pop());
      if(hasSpread){var flat=[];for(var ai=0;ai<callArgs.length;ai++){if(callArgs[ai]&&callArgs[ai].__spread__){for(var si=0;si<callArgs[ai].items.length;si++)flat.push(callArgs[ai].items[si]);}else flat.push(callArgs[ai]);}callArgs=flat;}
      var recv=pop();var fn=pop();push(fn==null?void 0:fn.apply(recv,callArgs));break;
    }
    case ${Op.DIRECT_EVAL}:{var code=pop();push(eval(code));break;}
    case ${Op.CALL_TAGGED_TEMPLATE}:{
      var argc=operand;var callArgs=[];for(var ai=0;ai<argc;ai++)callArgs.unshift(pop());
      var fn=pop();push(fn.apply(void 0,callArgs));break;
    }
    case ${Op.CALL_SUPER_METHOD}:{
      var argc=operand&0xFFFF;var nameIdx=(operand>>16)&0xFFFF;
      var callArgs=[];for(var ai=0;ai<argc;ai++)callArgs.unshift(pop());
      var sp2=Object.getPrototypeOf(Object.getPrototypeOf(thisVal));
      var fn=sp2?sp2[C[nameIdx]]:void 0;push(fn?fn.apply(thisVal,callArgs):void 0);break;
    }
    case ${Op.CALL_0}:{var fn=pop();push(fn());break;}
    case ${Op.CALL_1}:{var a1=pop();var fn=pop();push(fn(a1));break;}
    case ${Op.CALL_2}:{var a2=pop();var a1=pop();var fn=pop();push(fn(a1,a2));break;}
    case ${Op.CALL_3}:{var a3=pop();var a2=pop();var a1=pop();var fn=pop();push(fn(a1,a2,a3));break;}

    case ${Op.NEW_OBJECT}:push({});break;
    case ${Op.NEW_ARRAY}:push([]);break;
    case ${Op.NEW_ARRAY_WITH_SIZE}:push(new Array(operand));break;
    case ${Op.ARRAY_PUSH}:{var val=pop();var arr=peek();arr.push(val);break;}
    case ${Op.ARRAY_HOLE}:{var arr=peek();arr.length++;break;}
    case ${Op.SPREAD_ARRAY}:{
      var src=pop();
      var target=peek();
      if(Array.isArray(target)){
        var items=Array.from(src);
        for(var si=0;si<items.length;si++)target.push(items[si]);
      }else{
        Object.assign(target,src);
      }
      break;
    }
    case ${Op.SPREAD_OBJECT}:{var src=pop();var target=peek();Object.assign(target,src);break;}
    case ${Op.COPY_DATA_PROPERTIES}:{
      var excludeKeys=pop();var src=pop();var target=peek();
      var keys=Object.keys(src);
      for(var ki=0;ki<keys.length;ki++){if(!excludeKeys||excludeKeys.indexOf(keys[ki])<0)target[keys[ki]]=src[keys[ki]];}
      break;
    }
    case ${Op.SET_PROTO}:{var proto=pop();var obj=pop();Object.setPrototypeOf(obj,proto);push(obj);break;}
    case ${Op.FREEZE_OBJECT}:{Object.freeze(peek());break;}
    case ${Op.SEAL_OBJECT}:{Object.seal(peek());break;}
    case ${Op.DEFINE_PROPERTY_DESC}:{var desc=pop();var key=pop();var obj=peek();Object.defineProperty(obj,key,desc);break;}
    case ${Op.CREATE_TEMPLATE_OBJECT}:{
      var raw=pop();var cooked=pop();Object.defineProperty(cooked,'raw',{value:Object.freeze(raw)});
      Object.freeze(cooked);push(cooked);break;
    }

    case ${Op.DEFINE_METHOD}:{
      var fn=pop();var cls=peek();var name=C[operand&0xFFFF];var isStatic=(operand>>16)&1;
      ${debug ? `_dbg('DEFINE_METHOD','name='+name,'static='+!!isStatic,'isCtor='+(name==='constructor'));` : ''}
      if(name==='constructor'){if(cls.__setCtor)cls.__setCtor(fn);cls.prototype.constructor=fn;}
      else if(isStatic){cls[name]=fn;}else{(cls.prototype||cls)[name]=fn;}
      break;
    }
    case ${Op.DEFINE_STATIC_METHOD}:{var fn=pop();var cls=peek();cls[C[operand]]=fn;break;}
    case ${Op.DEFINE_GETTER}:{
      var fn=pop();var cls=peek();var name=C[operand&0xFFFF];var isStatic=(operand>>16)&1;
      var target=isStatic?cls:(cls.prototype||cls);
      Object.defineProperty(target,name,{get:fn,configurable:true,enumerable:false});break;
    }
    case ${Op.DEFINE_STATIC_GETTER}:{var fn=pop();var cls=peek();Object.defineProperty(cls,C[operand],{get:fn,configurable:true,enumerable:false});break;}
    case ${Op.DEFINE_SETTER}:{
      var fn=pop();var cls=peek();var name=C[operand&0xFFFF];var isStatic=(operand>>16)&1;
      var target=isStatic?cls:(cls.prototype||cls);
      Object.defineProperty(target,name,{set:fn,configurable:true,enumerable:false});break;
    }
    case ${Op.DEFINE_STATIC_SETTER}:{var fn=pop();var cls=peek();Object.defineProperty(cls,C[operand],{set:fn,configurable:true,enumerable:false});break;}
    case ${Op.DEFINE_FIELD}:{var val=pop();var name=C[operand];var obj=peek();obj[name]=val;break;}
    case ${Op.DEFINE_STATIC_FIELD}:{var val=pop();var cls=peek();cls[C[operand]]=val;break;}
    case ${Op.DEFINE_PRIVATE_METHOD}:{var fn=pop();var cls=peek();(cls.prototype||cls)[C[operand]]=fn;break;}
    case ${Op.DEFINE_PRIVATE_GETTER}:{var fn=pop();var cls=peek();Object.defineProperty(cls.prototype||cls,C[operand],{get:fn,configurable:true});break;}
    case ${Op.DEFINE_PRIVATE_SETTER}:{var fn=pop();var cls=peek();Object.defineProperty(cls.prototype||cls,C[operand],{set:fn,configurable:true});break;}
    case ${Op.DEFINE_PRIVATE_FIELD}:{var val=pop();var obj=peek();obj[C[operand]]=val;break;}
    case ${Op.DEFINE_STATIC_PRIVATE_FIELD}:{var val=pop();var cls=peek();cls[C[operand]]=val;break;}
    case ${Op.DEFINE_STATIC_PRIVATE_METHOD}:{var fn=pop();var cls=peek();cls[C[operand]]=fn;break;}
    case ${Op.CLASS_STATIC_BLOCK}:{var fn=pop();var cls=peek();fn.call(cls);break;}
    case ${Op.FINALIZE_CLASS}:break;
    case ${Op.INIT_PRIVATE_ENV}:case ${Op.ADD_PRIVATE_BRAND}:case ${Op.CHECK_PRIVATE_BRAND}:break;
    case ${Op.EXTEND_CLASS}:{var superCls=pop();var cls=peek();cls.prototype=Object.create(superCls.prototype);cls.prototype.constructor=cls;Object.setPrototypeOf(cls,superCls);break;}
    case ${Op.NEW_DERIVED_CLASS}:{
      var SuperClass=pop();
      ${debug ? `_dbg('NEW_DERIVED_CLASS');` : ''}
      var cls=(function(){var c=null;var f=function(){if(c)return c.apply(this,arguments);};f.__setCtor=function(x){c=x;};return f;})();
      cls.prototype=Object.create(SuperClass.prototype);cls.prototype.constructor=cls;Object.setPrototypeOf(cls,SuperClass);
      push(cls);break;
    }

    case ${Op.NEW_CLASS}:{
      var hasSuperClass=operand;
      var SuperClass=hasSuperClass?pop():null;
      ${debug ? `_dbg('NEW_CLASS','hasSuper='+!!hasSuperClass);` : ''}
      var cls=(function(){var c=null;var f=function(){if(c)return c.apply(this,arguments);};f.__setCtor=function(x){c=x;};return f;})();
      if(SuperClass){
        cls.prototype=Object.create(SuperClass.prototype);
        cls.prototype.constructor=cls;
        Object.setPrototypeOf(cls,SuperClass);
      }
      push(cls);
      break;
    }

    ${closureHandler}

    case ${Op.NEW_ARROW}:{
      push((function(uid,cs,ct){var u=_load(uid);if(u.s){return async function(){return _vm.call(ct,uid,Array.prototype.slice.call(arguments),cs);};}
      return function(){return _vm.call(ct,uid,Array.prototype.slice.call(arguments),cs);};})(C[operand],scope,thisVal));break;
    }
    case ${Op.NEW_ASYNC}:{
      push((function(uid,cs){return async function(){return _vm.call(this,uid,Array.prototype.slice.call(arguments),cs);};})(C[operand],scope));break;
    }
    case ${Op.NEW_GENERATOR}:case ${Op.NEW_ASYNC_GENERATOR}:{
      push((function(uid,cs){return function(){return _vm.call(this,uid,Array.prototype.slice.call(arguments),cs);};})(C[operand],scope));break;
    }
    case ${Op.SET_FUNC_NAME}:{var fn=peek();try{Object.defineProperty(fn,'name',{value:C[operand],configurable:true});}catch(e){}break;}
    case ${Op.SET_FUNC_LENGTH}:{var fn=peek();try{Object.defineProperty(fn,'length',{value:operand,configurable:true});}catch(e){}break;}
    case ${Op.BIND_THIS}:case ${Op.MAKE_METHOD}:break;
    case ${Op.PUSH_CLOSURE_VAR}:{var name=C[operand];var s=scope;while(s){if(name in s.vars){push(s.vars[name]);break;}s=s.parent;}break;}
    case ${Op.STORE_CLOSURE_VAR}:{var name=C[operand];var val=pop();var s=scope;while(s){if(name in s.vars){s.vars[name]=val;break;}s=s.parent;}break;}

    case ${Op.TYPEOF}:push(typeof pop());break;
    case ${Op.TYPEOF_GLOBAL}:{
      var name=C[operand];
      var g=typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:typeof global!=='undefined'?global:typeof self!=='undefined'?self:{};
      push(typeof g[name]);
      break;
    }
    case ${Op.VOID}:pop();push(void 0);break;
    case ${Op.DEBUGGER_STMT}:break;

    case ${Op.TRY_PUSH}:{
      var catchIp=(operand>>16)&0xFFFF;
      var finallyIp=operand&0xFFFF;
      if(catchIp===0xFFFF)catchIp=-1;
      if(finallyIp===0xFFFF)finallyIp=-1;
      exStack.push({catchIp:catchIp,finallyIp:finallyIp,sp:sp});
      break;
    }
    case ${Op.TRY_POP}:exStack.pop();break;
    case ${Op.CATCH_BIND}:{
      var err=pop();
      if(operand>=0){
        var cname=C[operand];
        if(typeof cname==='string'){scope.vars[cname]=err;}
        else{regs[operand]=err;}
      }else{
        push(err);
      }
      break;
    }
    case ${Op.FINALLY_MARK}:break;
    case ${Op.END_FINALLY}:{
      if(hasPendingEx){var ex=pendingEx;pendingEx=null;hasPendingEx=false;throw ex;}
      break;
    }

    case ${Op.GET_ITERATOR}:{
      var iterable=pop();
      var iter=iterable[Symbol.iterator]();
      var first=iter.next();
      push({_iter:iter,_done:!!first.done,_value:first.value});
      break;
    }
    case ${Op.ITER_NEXT}:{
      var iterObj=pop();
      push(iterObj._value);
      var nxt=iterObj._iter.next();
      iterObj._done=!!nxt.done;
      iterObj._value=nxt.value;
      break;
    }
    case ${Op.ITER_DONE}:{
      var iterObj=peek();
      push(!!iterObj._done);
      break;
    }

    case ${Op.FORIN_INIT}:{
      var obj=pop();
      var keys=[];
      for(var k in obj)keys.push(k);
      push({_keys:keys,_idx:0});
      break;
    }
    case ${Op.FORIN_NEXT}:{
      var fi=pop();
      push(fi._keys[fi._idx++]);
      break;
    }
    case ${Op.FORIN_DONE}:{
      var fi=peek();
      push(fi._idx>=fi._keys.length);
      break;
    }

    case ${Op.YIELD}:case ${Op.YIELD_DELEGATE}:push(void 0);break;
    ${awaitHandler}

    case ${Op.CREATE_GENERATOR}:case ${Op.GENERATOR_RESUME}:case ${Op.GENERATOR_RETURN}:case ${Op.GENERATOR_THROW}:break;
    case ${Op.SUSPEND}:case ${Op.RESUME}:break;
    case ${Op.ASYNC_GENERATOR_YIELD}:case ${Op.ASYNC_GENERATOR_NEXT}:case ${Op.ASYNC_GENERATOR_RETURN}:case ${Op.ASYNC_GENERATOR_THROW}:break;
    case ${Op.CREATE_ASYNC_FROM_SYNC_ITER}:{var it=pop();push({_iter:it,_done:false,_value:void 0});break;}

    case ${Op.CATCH_BIND_PATTERN}:{var err=pop();push(err);break;}
    case ${Op.THROW_IF_NOT_OBJECT}:{var v=peek();if(typeof v!=='object'||v===null)throw new TypeError('Value is not an object');break;}
    case ${Op.THROW_REF_ERROR}:{throw new ReferenceError(C[operand]||'not defined');}
    case ${Op.THROW_TYPE_ERROR}:{throw new TypeError(C[operand]||'type error');}
    case ${Op.THROW_SYNTAX_ERROR}:{throw new SyntaxError(C[operand]||'syntax error');}

    case ${Op.ITER_VALUE}:{var iterObj=peek();push(iterObj._value);break;}
    case ${Op.ITER_CLOSE}:{var iterObj=pop();if(iterObj._iter.return)iterObj._iter.return();break;}
    case ${Op.ITER_RESULT_UNWRAP}:{var iterObj=peek();push(iterObj._value);push(!!iterObj._done);break;}

    case ${Op.GET_ASYNC_ITERATOR}:{
      var iterable=pop();
      var method=iterable[Symbol.asyncIterator]||iterable[Symbol.iterator];
      var iter=method.call(iterable);
      push({_iter:iter,_done:false,_value:void 0,_async:true});break;
    }
    case ${Op.ASYNC_ITER_NEXT}:{var iterObj=peek();var result=${isAsync ? 'await iterObj._iter.next()' : 'iterObj._iter.next()'};iterObj._done=!!result.done;iterObj._value=result.value;break;}
    case ${Op.ASYNC_ITER_DONE}:{var iterObj=peek();push(!!iterObj._done);break;}
    case ${Op.ASYNC_ITER_VALUE}:{var iterObj=peek();push(iterObj._value);break;}
    case ${Op.ASYNC_ITER_CLOSE}:{var iterObj=pop();if(iterObj._iter.return)${isAsync ? 'await iterObj._iter.return()' : 'iterObj._iter.return()'};break;}
    case ${Op.FOR_AWAIT_NEXT}:{var iterObj=peek();var result=${isAsync ? 'await iterObj._iter.next()' : 'iterObj._iter.next()'};iterObj._done=!!result.done;iterObj._value=result.value;push(result.value);break;}

    case ${Op.TO_NUMBER}:push(Number(pop()));break;
    case ${Op.TO_STRING}:push(String(pop()));break;
    case ${Op.TO_BOOLEAN}:push(Boolean(pop()));break;
    case ${Op.TO_OBJECT}:push(Object(pop()));break;
    case ${Op.TO_PROPERTY_KEY}:{var v=pop();push(typeof v==='symbol'?v:String(v));break;}
    case ${Op.TO_NUMERIC}:{var v=pop();push(typeof v==='bigint'?v:Number(v));break;}

    case ${Op.TEMPLATE_LITERAL}:{
      var exprCount=operand;var parts=[];
      for(var ti=exprCount*2;ti>=0;ti--)parts.unshift(pop());
      var result='';for(var ti=0;ti<parts.length;ti++)result+=String(parts[ti]!=null?parts[ti]:'');
      push(result);break;
    }
    case ${Op.TAGGED_TEMPLATE}:{
      var argc=operand;var callArgs=[];for(var ai=0;ai<argc;ai++)callArgs.unshift(pop());
      var fn=pop();push(fn.apply(void 0,callArgs));break;
    }
    case ${Op.CREATE_RAW_STRINGS}:{
      var count=operand;var raw=[];for(var ri=0;ri<count;ri++)raw.unshift(pop());
      Object.freeze(raw);push(raw);break;
    }

    case ${Op.INC_SCOPED}:{var name=C[operand];var s=scope;while(s){if(name in s.vars){s.vars[name]=s.vars[name]+1;push(s.vars[name]);break;}s=s.parent;}break;}
    case ${Op.DEC_SCOPED}:{var name=C[operand];var s=scope;while(s){if(name in s.vars){s.vars[name]=s.vars[name]-1;push(s.vars[name]);break;}s=s.parent;}break;}
    case ${Op.POST_INC_SCOPED}:{var name=C[operand];var s=scope;while(s){if(name in s.vars){var old=s.vars[name];s.vars[name]=old+1;push(old);break;}s=s.parent;}break;}
    case ${Op.POST_DEC_SCOPED}:{var name=C[operand];var s=scope;while(s){if(name in s.vars){var old=s.vars[name];s.vars[name]=old-1;push(old);break;}s=s.parent;}break;}
    case ${Op.ADD_ASSIGN_SCOPED}:{var val=pop();var name=C[operand];var s=scope;while(s){if(name in s.vars){s.vars[name]+=val;push(s.vars[name]);break;}s=s.parent;}break;}
    case ${Op.SUB_ASSIGN_SCOPED}:{var val=pop();var name=C[operand];var s=scope;while(s){if(name in s.vars){s.vars[name]-=val;push(s.vars[name]);break;}s=s.parent;}break;}
    case ${Op.MUL_ASSIGN_SCOPED}:{var val=pop();var name=C[operand];var s=scope;while(s){if(name in s.vars){s.vars[name]*=val;push(s.vars[name]);break;}s=s.parent;}break;}
    case ${Op.DIV_ASSIGN_SCOPED}:{var val=pop();var name=C[operand];var s=scope;while(s){if(name in s.vars){s.vars[name]/=val;push(s.vars[name]);break;}s=s.parent;}break;}
    case ${Op.MOD_ASSIGN_SCOPED}:{var val=pop();var name=C[operand];var s=scope;while(s){if(name in s.vars){s.vars[name]%=val;push(s.vars[name]);break;}s=s.parent;}break;}
    case ${Op.POW_ASSIGN_SCOPED}:{var val=pop();var name=C[operand];var s=scope;while(s){if(name in s.vars){s.vars[name]**=val;push(s.vars[name]);break;}s=s.parent;}break;}
    case ${Op.BIT_AND_ASSIGN_SCOPED}:{var val=pop();var name=C[operand];var s=scope;while(s){if(name in s.vars){s.vars[name]&=val;push(s.vars[name]);break;}s=s.parent;}break;}
    case ${Op.BIT_OR_ASSIGN_SCOPED}:{var val=pop();var name=C[operand];var s=scope;while(s){if(name in s.vars){s.vars[name]|=val;push(s.vars[name]);break;}s=s.parent;}break;}
    case ${Op.BIT_XOR_ASSIGN_SCOPED}:{var val=pop();var name=C[operand];var s=scope;while(s){if(name in s.vars){s.vars[name]^=val;push(s.vars[name]);break;}s=s.parent;}break;}
    case ${Op.SHL_ASSIGN_SCOPED}:{var val=pop();var name=C[operand];var s=scope;while(s){if(name in s.vars){s.vars[name]<<=val;push(s.vars[name]);break;}s=s.parent;}break;}
    case ${Op.SHR_ASSIGN_SCOPED}:{var val=pop();var name=C[operand];var s=scope;while(s){if(name in s.vars){s.vars[name]>>=val;push(s.vars[name]);break;}s=s.parent;}break;}
    case ${Op.USHR_ASSIGN_SCOPED}:{var val=pop();var name=C[operand];var s=scope;while(s){if(name in s.vars){s.vars[name]>>>=val;push(s.vars[name]);break;}s=s.parent;}break;}
    case ${Op.AND_ASSIGN_SCOPED}:{var val=pop();var name=C[operand];var s=scope;while(s){if(name in s.vars){s.vars[name]=s.vars[name]&&val;push(s.vars[name]);break;}s=s.parent;}break;}
    case ${Op.OR_ASSIGN_SCOPED}:{var val=pop();var name=C[operand];var s=scope;while(s){if(name in s.vars){s.vars[name]=s.vars[name]||val;push(s.vars[name]);break;}s=s.parent;}break;}
    case ${Op.NULLISH_ASSIGN_SCOPED}:{var val=pop();var name=C[operand];var s=scope;while(s){if(name in s.vars){if(s.vars[name]==null)s.vars[name]=val;push(s.vars[name]);break;}s=s.parent;}break;}
    case ${Op.ASSIGN_OP}:break;
    case ${Op.INC_REG}:regs[operand]=(regs[operand]||0)+1;break;
    case ${Op.DEC_REG}:regs[operand]=(regs[operand]||0)-1;break;
    case ${Op.FAST_ADD_CONST}:push(pop()+operand);break;
    case ${Op.FAST_SUB_CONST}:push(pop()-operand);break;
    case ${Op.FAST_GET_PROP}:{var name=C[operand&0xFFFF];var varName=C[(operand>>16)&0xFFFF];var s=scope;while(s){if(varName in s.vars){push(s.vars[varName][name]);break;}s=s.parent;}break;}
    case ${Op.LOAD_GLOBAL_FAST}:{var g=typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:typeof global!=='undefined'?global:typeof self!=='undefined'?self:{};push(g[C[operand]]);break;}

    case ${Op.PUSH_THIS}:push(thisVal);break;
    case ${Op.PUSH_ARGUMENTS}:push(args);break;
    case ${Op.PUSH_NEW_TARGET}:push(newTarget);break;
    case ${Op.PUSH_GLOBAL_THIS}:{var g=typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:typeof global!=='undefined'?global:typeof self!=='undefined'?self:{};push(g);break;}
    case ${Op.PUSH_WELL_KNOWN_SYMBOL}:{var syms=[Symbol.iterator,Symbol.asyncIterator,Symbol.hasInstance,Symbol.toPrimitive,Symbol.toStringTag,Symbol.species,Symbol.isConcatSpreadable,Symbol.match,Symbol.replace,Symbol.search,Symbol.split,Symbol.unscopables];push(syms[operand]||Symbol.iterator);break;}
    case ${Op.IMPORT_META}:push({});break;
    case ${Op.DYNAMIC_IMPORT}:{var spec=pop();push(import(spec));break;}
    case ${Op.DEBUGGER_STMT}:break;
    case ${Op.COMMA}:break;
    case ${Op.SOURCE_MAP}:break;
    case ${Op.ASSERT_DEFINED}:{var v=peek();if(v===void 0)throw new TypeError('Cannot read properties of undefined');break;}
    case ${Op.ASSERT_FUNCTION}:{var v=peek();if(typeof v!=='function')throw new TypeError(v+' is not a function');break;}

    case ${Op.DESTRUCTURE_BIND}:break;
    case ${Op.DESTRUCTURE_DEFAULT}:{var v=peek();if(v===void 0){sp--;var def=C[operand];push(def);}break;}
    case ${Op.DESTRUCTURE_REST_ARRAY}:{
      var iterObj=pop();var rest=[];
      while(!iterObj._done){rest.push(iterObj._value);var nxt=iterObj._iter.next();iterObj._done=!!nxt.done;iterObj._value=nxt.value;}
      push(rest);break;
    }
    case ${Op.DESTRUCTURE_REST_OBJECT}:{
      var excludeKeys=pop();var src=pop();var rest={};
      var keys=Object.keys(src);for(var ki=0;ki<keys.length;ki++){if(excludeKeys.indexOf(keys[ki])<0)rest[keys[ki]]=src[keys[ki]];}
      push(rest);break;
    }
    case ${Op.ARRAY_PATTERN_INIT}:{
      var arr=pop();var iter=arr[Symbol.iterator]();var first=iter.next();
      push({_iter:iter,_done:!!first.done,_value:first.value});break;
    }
    case ${Op.OBJECT_PATTERN_GET}:{var obj=peek();push(obj[C[operand]]);break;}

    case ${Op.CREATE_UNMAPPED_ARGS}:case ${Op.CREATE_MAPPED_ARGS}:push(Array.prototype.slice.call(args));break;
    case ${Op.CREATE_REST_ARGS}:push(Array.prototype.slice.call(args,operand));break;

    default:break;
    }
  }
  return void 0;
  }catch(e){
    ${debug ? `_dbg('EXCEPTION','error=',e&&e.message?e.message:e,'exStack='+exStack.length);` : ''}
    hasPendingEx=false;pendingEx=null;
    if(exStack.length>0){
      var handler=exStack.pop();
      if(handler.catchIp>=0){
        ${debug ? `_dbg('CATCH','ip='+handler.catchIp,'sp='+handler.sp);` : ''}
        sp=handler.sp;
        push(e);
        ip=handler.catchIp*2;
        continue;
      }
      if(handler.finallyIp>=0){
        ${debug ? `_dbg('FINALLY','ip='+handler.finallyIp,'sp='+handler.sp);` : ''}
        sp=handler.sp;
        pendingEx=e;hasPendingEx=true;
        ip=handler.finallyIp*2;
        continue;
      }
    }
    ${debug ? `_dbg('UNCAUGHT','error=',e&&e.message?e.message:e);` : ''}
    throw e;
  }
  }
  }finally{_vmDepth--;_vmStack.pop();}
}
`;

}

function generateRunners(debug: boolean = false): string {
  const dbgEntry = debug
    ? `_dbg('VM_DISPATCH','id='+id,'async='+!!unit.s,'params='+unit.p);unit._dbgId=id;`
    : '';
  return `
function _vm(id,args,outerScope,thisVal,newTarget){
  var unit=_load(id);
  ${dbgEntry}
  if(unit.s)return _execAsync(unit,args||[],outerScope||null,thisVal,newTarget);
  return _exec(unit,args||[],outerScope||null,thisVal,newTarget);
}
_vm.call=function(thisVal,id,args,outerScope){
  var unit=_load(id);
  ${dbgEntry}
  if(unit.s)return _execAsync(unit,args||[],outerScope||null,thisVal,void 0);
  return _exec(unit,args||[],outerScope||null,thisVal,void 0);
};
`;
}

function generateDeserializer(): string {
  return `
function _deserialize(bytes){
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

  return {c:constants,i:instrs,r:rCount,p:pCount,g:isGen,s:isAsync,st:isStrict,a:isArrow};
}
`;
}
