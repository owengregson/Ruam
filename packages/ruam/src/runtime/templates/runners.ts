/**
 * VM dispatch functions runtime template.
 *
 * Generates the dispatch function and its `.call` variant
 * which serve as the public interface for invoking bytecode units.
 *
 * @module runtime/templates/runners
 */

import type { RuntimeNames } from "../names.js";

export function generateRunners(
  debug: boolean,
  names: RuntimeNames,
): string {
  const U = names.unit;
  const A = names.args;
  const OS = names.outer;
  const TV = names.tVal;
  const NT = names.nTgt;
  const dbgEntry = debug
    ? `${names.dbg}('VM_DISPATCH','id='+id,'async='+!!${U}.s,'params='+${U}.p);${U}._dbgId=id;`
    : '';
  const HO = names.ho;
  return `
function ${names.vm}(id,${A},${OS},${TV},${NT},${HO}){
  var ${U}=${names.load}(id);
  ${dbgEntry}
  if(${U}.s)return ${names.execAsync}(${U},${A}||[],${OS}||null,${TV},${NT},${HO});
  return ${names.exec}(${U},${A}||[],${OS}||null,${TV},${NT},${HO});
}
${names.vm}.call=function(${TV},id,${A},${OS},${HO}){
  var ${U}=${names.load}(id);
  ${dbgEntry}
  if(!${U}.a&&!${U}.st){if(${TV}==null)${TV}=globalThis;else{var _t=typeof ${TV};if(_t!=="object"&&_t!=="function")${TV}=Object(${TV});}}
  if(${U}.s)return ${names.execAsync}(${U},${A}||[],${OS}||null,${TV},void 0,${HO});
  return ${names.exec}(${U},${A}||[],${OS}||null,${TV},void 0,${HO});
};
`;
}

/**
 * Generate the router function for VM Shielding mode.
 *
 * The router maps unit IDs to their group's dispatch function and
 * serves as the single global entry point. External function bodies
 * call the router, which delegates to the correct micro-interpreter.
 *
 * @param routerName - The global router function name.
 * @param groupRegistrations - Per-group unit ID lists and dispatch function names.
 * @param names - Shared RuntimeNames (for parameter names).
 */
export function generateRouter(
  routerName: string,
  groupRegistrations: { unitIds: string[]; dispatchName: string }[],
  names: RuntimeNames,
): string {
  const A = names.args;
  const OS = names.outer;
  const TV = names.tVal;
  const NT = names.nTgt;
  const HO = names.ho;

  const entries: string[] = [];
  for (const { unitIds, dispatchName } of groupRegistrations) {
    for (const id of unitIds) {
      entries.push(`_rm["${id}"]=${dispatchName};`);
    }
  }

  return `
var _rm={};
${entries.join("")}
function ${routerName}(id,${A},${OS},${TV},${NT},${HO}){
  return _rm[id](id,${A},${OS},${TV},${NT},${HO});
}
${routerName}.call=function(${TV},id,${A},${OS},${HO}){
  return _rm[id].call(${TV},id,${A},${OS},${HO});
};
`;
}
