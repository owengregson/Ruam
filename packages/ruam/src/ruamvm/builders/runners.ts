/**
 * Runners builder — assembles VM dispatch and router functions as AST nodes.
 *
 * Produces structured AST nodes for the VM dispatch function, its .call
 * variant, and the shielding router — no raw() escape hatches.
 *
 * @module ruamvm/builders/runners
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames, TempNames } from "../../encoding/names.js";
import {
	id,
	lit,
	bin,
	un,
	assign,
	call,
	member,
	index,
	fn,
	fnExpr,
	varDecl,
	exprStmt,
	ifStmt,
	returnStmt,
	obj,
	arr,
} from "../nodes.js";

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
export function buildRunners(
	debug: boolean,
	names: RuntimeNames,
	temps: TempNames
): JsNode[] {
	const U = names.unit;
	const A = names.args;
	const OS = names.outer;
	const TV = names.tVal;
	const NT = names.nTgt;
	const HO = names.ho;

	/** Common args: (unit, args||[], outer||null, thisVal, newTarget, homeObject) */
	const execArgs: JsNode[] = [
		id(U),
		bin("||", id(A), arr()),
		bin("||", id(OS), lit(null)),
		id(TV),
		id(NT),
		id(HO),
	];

	/** Shared: var U = load(id); */
	const loadUnit: JsNode = varDecl(U, call(id(names.load), [id("id")]));

	/** Optional debug trace statements */
	const dbgStmts: JsNode[] = debug
		? [
				exprStmt(
					call(id(names.dbg), [
						lit("VM_DISPATCH"),
						bin("+", lit("id="), id("id")),
						bin(
							"+",
							lit("async="),
							un("!", un("!", member(id(U), "s")))
						),
						bin("+", lit("params="), member(id(U), "p")),
					])
				),
				exprStmt(assign(member(id(U), temps["_dbgId"]!), id("id"))),
		  ]
		: [];

	// --- Main dispatch function: function vm(id, A, OS, TV, NT, HO) { ... } ---
	const dispatchFn: JsNode = fn(
		names.vm,
		["id", A, OS, TV, NT, HO],
		[
			loadUnit,
			...dbgStmts,
			// if (U.s) return execAsync(U, A||[], OS||null, TV, NT, HO);
			ifStmt(member(id(U), "s"), [
				returnStmt(call(id(names.execAsync), execArgs)),
			]),
			// return exec(U, A||[], OS||null, TV, NT, HO);
			returnStmt(call(id(names.exec), execArgs)),
		]
	);

	// --- vm.call = function(TV, id, A, OS, HO) { ... }; ---
	// This-boxing: if not arrow and not strict:
	//   if (TV == null) TV = globalThis;
	//   else { var _t = typeof TV; if (_t !== "object" && _t !== "function") TV = Object(TV); }
	const thisBoxing: JsNode = ifStmt(
		un("!", bin("||", member(id(U), "a"), member(id(U), "st"))),
		[
			ifStmt(
				bin("==", id(TV), lit(null)),
				// then: TV = globalThis
				[exprStmt(assign(id(TV), id("globalThis")))],
				// else: type check + box
				[
					varDecl(temps["_t"]!, un("typeof", id(TV))),
					ifStmt(
						bin(
							"&&",
							bin("!==", id(temps["_t"]!), lit("object")),
							bin("!==", id(temps["_t"]!), lit("function"))
						),
						[exprStmt(assign(id(TV), call(id("Object"), [id(TV)])))]
					),
				]
			),
		]
	);

	/** exec args for .call — newTarget is void 0 */
	const callExecArgs: JsNode[] = [
		id(U),
		bin("||", id(A), arr()),
		bin("||", id(OS), lit(null)),
		id(TV),
		un("void", lit(0)),
		id(HO),
	];

	const callFn: JsNode = exprStmt(
		assign(
			member(id(names.vm), "call"),
			fnExpr(
				undefined,
				[TV, "id", A, OS, HO],
				[
					loadUnit,
					...dbgStmts,
					thisBoxing,
					// if (U.s) return execAsync(U, A||[], OS||null, TV, void 0, HO);
					ifStmt(member(id(U), "s"), [
						returnStmt(call(id(names.execAsync), callExecArgs)),
					]),
					// return exec(U, A||[], OS||null, TV, void 0, HO);
					returnStmt(call(id(names.exec), callExecArgs)),
				]
			)
		)
	);

	return [dispatchFn, callFn];
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

	// var RM = {};
	const routeMapDecl: JsNode = varDecl(RM, obj());

	// RM["id1"] = dispatch1; RM["id2"] = dispatch1; ...
	const registrations: JsNode[] = [];
	for (const { unitIds, dispatchName } of groupRegistrations) {
		for (const uid of unitIds) {
			registrations.push(
				exprStmt(assign(index(id(RM), lit(uid)), id(dispatchName)))
			);
		}
	}

	// function routerName(id, A, OS, TV, NT, HO) { return RM[id](id, A, OS, TV, NT, HO); }
	const routerFn: JsNode = fn(
		routerName,
		["id", A, OS, TV, NT, HO],
		[
			returnStmt(
				call(index(id(RM), id("id")), [
					id("id"),
					id(A),
					id(OS),
					id(TV),
					id(NT),
					id(HO),
				])
			),
		]
	);

	// routerName.call = function(TV, id, A, OS, HO) { return RM[id].call(TV, id, A, OS, HO); };
	const routerCall: JsNode = exprStmt(
		assign(
			member(id(routerName), "call"),
			fnExpr(
				undefined,
				[TV, "id", A, OS, HO],
				[
					returnStmt(
						call(member(index(id(RM), id("id")), "call"), [
							id(TV),
							id("id"),
							id(A),
							id(OS),
							id(HO),
						])
					),
				]
			)
		)
	);

	return [routeMapDecl, ...registrations, routerFn, routerCall];
}
