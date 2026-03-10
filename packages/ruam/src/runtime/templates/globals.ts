/**
 * Global exposure runtime template.
 *
 * Exposes the VM dispatch function on the global object so that
 * compiled function bodies can call it from outside the IIFE.
 *
 * @module runtime/templates/globals
 */

import type { RuntimeNames } from "../names.js";

export function generateGlobalExposure(
	names: RuntimeNames,
	overrideName?: string
): string {
	const n = overrideName ?? names.vm;
	return `
if(typeof globalThis!=='undefined'){globalThis.${n}=${n};}
else if(typeof window!=='undefined'){window.${n}=${n};}
else if(typeof global!=='undefined'){global.${n}=${n};}
else if(typeof self!=='undefined'){self.${n}=${n};}
`;
}
