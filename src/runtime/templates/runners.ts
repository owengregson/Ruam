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
  return `
function ${names.vm}(id,${A},${OS},${TV},${NT}){
  var ${U}=${names.load}(id);
  ${dbgEntry}
  if(${U}.s)return ${names.execAsync}(${U},${A}||[],${OS}||null,${TV},${NT});
  return ${names.exec}(${U},${A}||[],${OS}||null,${TV},${NT});
}
${names.vm}.call=function(${TV},id,${A},${OS}){
  var ${U}=${names.load}(id);
  ${dbgEntry}
  if(${U}.s)return ${names.execAsync}(${U},${A}||[],${OS}||null,${TV},void 0);
  return ${names.exec}(${U},${A}||[],${OS}||null,${TV},void 0);
};
`;
}
