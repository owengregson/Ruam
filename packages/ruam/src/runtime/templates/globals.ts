/**
 * Global exposure runtime template.
 *
 * Exposes the VM dispatch function on the global object so that
 * compiled function bodies can call it from outside the IIFE.
 *
 * @module runtime/templates/globals
 */

import type { RuntimeNames } from "../names.js";

export function generateGlobalExposure(names: RuntimeNames): string {
  return `
if(typeof globalThis!=='undefined'){globalThis.${names.vm}=${names.vm};}
else if(typeof window!=='undefined'){window.${names.vm}=${names.vm};}
else if(typeof global!=='undefined'){global.${names.vm}=${names.vm};}
else if(typeof self!=='undefined'){self.${names.vm}=${names.vm};}
`;
}
