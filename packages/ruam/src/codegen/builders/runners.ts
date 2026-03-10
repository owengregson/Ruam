/**
 * Runners builder — assembles VM dispatch and router functions as AST nodes.
 *
 * Replaces the template-literal approach in runtime/templates/runners.ts with
 * AST-based construction. The function bodies use raw() because the dispatch
 * logic involves dense conditional expressions and this-boxing that benefit
 * from verbatim output.
 *
 * @module codegen/builders/runners
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../runtime/names.js";
import { raw } from "../nodes.js";

// --- VM dispatch functions ---

/**
 * Build the VM dispatch function and its `.call` variant as JsNode[].
 *
 * The dispatch function loads a bytecode unit by ID and routes to the
 * sync or async interpreter. The `.call` variant handles sloppy-mode
 * this-boxing (null/undefined -> globalThis, primitives -> Object()).
 *
 * @param debug - Whether to emit debug trace calls at dispatch entry.
 * @param names - Randomized runtime identifier names.
 * @returns An array of JsNode containing the dispatch function and its .call property.
 */
export function buildRunners(debug: boolean, names: RuntimeNames): JsNode[] {
	const U = names.unit;
	const A = names.args;
	const OS = names.outer;
	const TV = names.tVal;
	const NT = names.nTgt;
	const HO = names.ho;

	const dbgEntry = debug
		? `${names.dbg}('VM_DISPATCH','id='+id,'async='+!!${U}.s,'params='+${U}.p);${U}._dbgId=id;`
		: "";

	return [
		raw(
			`function ${names.vm}(id,${A},${OS},${TV},${NT},${HO}){` +
			`var ${U}=${names.load}(id);` +
			dbgEntry +
			`if(${U}.s)return ${names.execAsync}(${U},${A}||[],${OS}||null,${TV},${NT},${HO});` +
			`return ${names.exec}(${U},${A}||[],${OS}||null,${TV},${NT},${HO});` +
			`}`
		),
		raw(
			`${names.vm}.call=function(${TV},id,${A},${OS},${HO}){` +
			`var ${U}=${names.load}(id);` +
			dbgEntry +
			`if(!${U}.a&&!${U}.st){if(${TV}==null)${TV}=globalThis;else{var _t=typeof ${TV};if(_t!=="object"&&_t!=="function")${TV}=Object(${TV});}}` +
			`if(${U}.s)return ${names.execAsync}(${U},${A}||[],${OS}||null,${TV},void 0,${HO});` +
			`return ${names.exec}(${U},${A}||[],${OS}||null,${TV},void 0,${HO});` +
			`};`
		),
	];
}

// --- Shielding router ---

/**
 * Build the router function for VM Shielding mode as JsNode[].
 *
 * The router maps unit IDs to their group's dispatch function and
 * serves as the single global entry point. External function bodies
 * call the router, which delegates to the correct micro-interpreter.
 *
 * @param routerName          - The global router function name.
 * @param groupRegistrations  - Per-group unit ID lists and dispatch function names.
 * @param names               - Shared RuntimeNames (for parameter names).
 * @returns An array of JsNode containing the route map, router function, and its .call property.
 */
export function buildRouter(
	routerName: string,
	groupRegistrations: { unitIds: string[]; dispatchName: string }[],
	names: RuntimeNames
): JsNode[] {
	const RM = names.routeMap;
	const A = names.args;
	const OS = names.outer;
	const TV = names.tVal;
	const NT = names.nTgt;
	const HO = names.ho;

	const entries: string[] = [];
	for (const { unitIds, dispatchName } of groupRegistrations) {
		for (const id of unitIds) {
			entries.push(`${RM}["${id}"]=${dispatchName};`);
		}
	}

	return [
		raw(`var ${RM}={};${entries.join("")}`),
		raw(
			`function ${routerName}(id,${A},${OS},${TV},${NT},${HO}){` +
			`return ${RM}[id](id,${A},${OS},${TV},${NT},${HO});` +
			`}`
		),
		raw(
			`${routerName}.call=function(${TV},id,${A},${OS},${HO}){` +
			`return ${RM}[id].call(${TV},id,${A},${OS},${HO});` +
			`};`
		),
	];
}
