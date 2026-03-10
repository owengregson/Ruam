/**
 * Global exposure builder — AST-based replacement for the template-literal
 * approach in runtime/templates/globals.ts.
 *
 * Builds the if/else-if chain that assigns the VM dispatch function
 * to whichever global object is available (globalThis, window, global, self).
 *
 * @module codegen/builders/globals
 */

import type { JsNode } from "../nodes.js";
import { ifStmt, exprStmt, assign, member, id, bin, un, lit } from "../nodes.js";

// --- Helpers ---

/** Build `typeof <name> !== 'undefined'` */
function typeofCheck(name: string): JsNode {
	return bin("!==", un("typeof", id(name)), lit("undefined"));
}

/** Build `<globalName>.<vmName> = <vmName>;` as an ExprStmt */
function globalAssign(globalName: string, vmName: string): JsNode {
	return exprStmt(assign(member(id(globalName), vmName), id(vmName)));
}

// --- Builder ---

/**
 * Build the global exposure if/else-if chain.
 *
 * Produces four branches that check for globalThis, window, global, and self
 * in order, assigning the VM function to the first available global object.
 *
 * @param vmName - The VM dispatch function name (already resolved)
 * @returns AST nodes representing the if/else-if chain
 */
export function buildGlobalExposure(vmName: string): JsNode[] {
	const globals = ["globalThis", "window", "global", "self"] as const;

	// Build the chain from the inside out (last else-if has no else clause)
	// Start with the last branch: if(typeof self !== 'undefined') { self.vm = vm; }
	let current = ifStmt(
		typeofCheck(globals[3]),
		[globalAssign(globals[3], vmName)]
	);

	// Build remaining branches in reverse: global, window, globalThis
	for (let i = globals.length - 2; i >= 0; i--) {
		const name = globals[i]!;
		current = ifStmt(
			typeofCheck(name),
			[globalAssign(name, vmName)],
			[current]
		);
	}

	return [current];
}
