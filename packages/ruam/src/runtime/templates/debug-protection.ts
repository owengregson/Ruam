/**
 * Anti-debugger protection runtime template.
 *
 * Generates a defense-in-depth system with 6 independent detection layers
 * and an escalating response mechanism that silently corrupts VM state
 * before falling back to hard lockout.
 *
 * Detection layers:
 *   1. Polymorphic debugger invocation with dual-clock timing
 *   2. Statistical jitter analysis (multiple rapid probes, variance check)
 *   3. Environment analysis (--inspect flags, stack trace anomalies)
 *   4. Function integrity self-verification (FNV-1a checksum of own source)
 *   5. Native API integrity (console methods, Function.prototype.toString)
 *   6. Global property trap canary (browser DevTools enumeration)
 *
 * Response escalation:
 *   Level 1-2: Silent bytecode instruction corruption (wrong opcode dispatch)
 *   Level 3-4: Cache wipe + constants array destruction
 *   Level 5+:  Infinite debugger loop (hard lockout)
 *
 * @module runtime/templates/debug-protection
 */

import type { RuntimeNames } from "../names.js";

/**
 * Generate the multi-layered anti-debugger protection IIFE.
 *
 * @param names - Randomized runtime identifier names.
 * @returns JS source string for the debug protection IIFE.
 */
export function generateDebugProtection(names: RuntimeNames): string {
  const T = names.thresh;
  const BT = names.bt;
  const CA = names.cache;

  return `
(function ${names.dbgProt}(){
var ${T}=100;
var _dm=[function(){debugger;},function(){try{(new Function("de"+"bu"+"gger"))();}catch(_){debugger;}},function(){try{eval("de"+"bug"+"ger");}catch(_){debugger;}},function(){try{(0,eval)("deb"+"ugger");}catch(_){debugger;}}];
var _hr=(typeof performance!=='undefined'&&typeof performance.now==='function')?performance:null;
var _now=_hr?function(){return _hr.now();}:Date.now;
var _sev=0;
function _act(){
_sev++;
if(_sev<=2){try{var _ks=Object.keys(${BT});for(var _ki=0;_ki<_ks.length;_ki++){var _ue=${BT}[_ks[_ki]];if(_ue&&_ue.i){for(var _ji=0;_ji<_ue.i.length;_ji+=2){_ue.i[_ji]=(_ue.i[_ji]+_sev*7)&0xFFFF;}}}}catch(_){}}
else if(_sev<=4){try{for(var _k in ${CA})delete ${CA}[_k];}catch(_){}try{var _ks=Object.keys(${BT});for(var _ki=0;_ki<_ks.length;_ki++){var _ue=${BT}[_ks[_ki]];if(_ue)_ue.c=[];}}catch(_){}}
else{while(true){debugger;}}
}
function _p1(){var _s1=_now();var _s2=Date.now();_dm[(_s2&3)]();var _e1=_now()-_s1;var _e2=Date.now()-_s2;return _e1>${T}||_e2>${T};}
function _p2(){var _ts=[];for(var _i=0;_i<3;_i++){var _s=_now();_dm[_i%_dm.length]();_ts.push(_now()-_s);}var _sm=0;for(var _i=0;_i<_ts.length;_i++)_sm+=_ts[_i];var _av=_sm/_ts.length;var _vr=0;for(var _i=0;_i<_ts.length;_i++){var _d=_ts[_i]-_av;_vr+=_d*_d;}return(_vr/_ts.length)>500||_av>50;}
function _p3(){try{var _st=(new Error()).stack||'';if(/--inspect|--debug/i.test(_st))return true;}catch(_){}if(typeof process!=='undefined'){try{if(process.execArgv){for(var _i=0;_i<process.execArgv.length;_i++){if(/--inspect|--debug/.test(process.execArgv[_i]))return true;}}}catch(_){}}return false;}
var _src=${names.dbgProt}.toString();var _fh=0x811C9DC5;for(var _fi=0;_fi<_src.length;_fi++){_fh=((_fh^_src.charCodeAt(_fi))>>>0)*0x01000193>>>0;}
function _p4(){var _cs=${names.dbgProt}.toString();var _ch=0x811C9DC5;for(var _ci=0;_ci<_cs.length;_ci++){_ch=((_ch^_cs.charCodeAt(_ci))>>>0)*0x01000193>>>0;}return _ch!==_fh;}
function _p5(){try{if(typeof console==='undefined')return false;var _nc='[native code]';var _fn=['log','warn','error','table','dir','trace','clear'];for(var _i=0;_i<_fn.length;_i++){if(typeof console[_fn[_i]]==='function'){var _ts=Function.prototype.toString.call(console[_fn[_i]]);if(_ts.indexOf(_nc)===-1)return true;}}var _ft=Function.prototype.toString.toString();if(_ft.indexOf(_nc)===-1)return true;}catch(_){}return false;}
var _th=0;var _tl=0;
if(typeof window!=='undefined'){try{var _gk='__'+Math.random().toString(36).slice(2,6);Object.defineProperty(window,_gk,{get:function(){_th++;return void 0;},configurable:true,enumerable:true});}catch(_){}}
function _p6(){var _d=_th-_tl;_tl=_th;return _d>3;}
var _pb=[_p1,_p2,_p3,_p4,_p5,_p6];
function _run(){
var _n=2+((Math.random()*2)|0);
var _det=false;
for(var _i=0;_i<_n;_i++){var _idx=(Math.random()*_pb.length)|0;try{if(_pb[_idx]()){_det=true;break;}}catch(_){}}
if(_det)_act();
if(_sev<5){var _nx=2000+((Math.random()*5000)|0);var _tid=setTimeout(_run,_nx);if(typeof _tid==='object'&&_tid.unref)_tid.unref();}
}
var _it=setTimeout(function(){_run();},500+((Math.random()*1500)|0));
if(typeof _it==='object'&&_it.unref)_it.unref();
})();
`;
}
