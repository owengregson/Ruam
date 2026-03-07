/**
 * Anti-debugger protection runtime template.
 *
 * Generates a self-executing function that periodically checks for
 * open developer tools via a `debugger` timing side-channel.
 *
 * @module runtime/templates/debug-protection
 */

import type { RuntimeNames } from "../names.js";

export function generateDebugProtection(names: RuntimeNames): string {
  const T = names.thresh;
  return `
(function ${names.dbgProt}(){
  var ${T}=100;
  setInterval(function(){
    var start=Date.now();
    debugger;
    if(Date.now()-start>${T}){
      while(true){debugger;}
    }
  },4000);
})();
`;
}
