/**
 * Scope opcode handlers in AST node form.
 *
 * Covers 16 opcodes across scope chain operations:
 *  - Load/store:  LOAD_SCOPED, STORE_SCOPED
 *  - Declare:     DECLARE_VAR, DECLARE_LET, DECLARE_CONST
 *  - Push/pop:    PUSH_SCOPE, PUSH_BLOCK_SCOPE, PUSH_CATCH_SCOPE, POP_SCOPE
 *  - TDZ:         TDZ_CHECK, TDZ_MARK
 *  - With:        PUSH_WITH_SCOPE
 *  - Delete:      DELETE_SCOPED
 *  - Global:      LOAD_GLOBAL, STORE_GLOBAL, TYPEOF_GLOBAL
 *
 * All handlers use pure AST nodes — no raw() escape hatch.
 *
 * LOAD_SCOPED, STORE_SCOPED, and TYPEOF_GLOBAL use manual while-loop
 * construction (not ctx.scopeWalk()) because they need a global fallback
 * after the while loop instead of a trailing break.
 *
 * @module ruamvm/handlers/scope
 */

import { Op } from "../../compiler/opcodes.js";
import {
	type JsNode,
	id,
	lit,
	bin,
	un,
	assign,
	member,
	index,
	varDecl,
	exprStmt,
	ifStmt,
	whileStmt,
	throwStmt,
	breakStmt,
	obj,
	newExpr,
} from "../nodes.js";
import type { HandlerCtx } from "./registry.js";
import { registry } from "./registry.js";

// --- Load / store scoped ---

/**
 * LOAD_SCOPED: walk scope chain to find variable, fall back to global.
 *
 * Fast path checks current scope first, then walks parent chain.
 * Does NOT use ctx.scopeWalk() because the global fallback runs after
 * the while loop instead of a trailing break.
 */
function LOAD_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		// Fast path: check current scope first
		ifStmt(bin("in", id("name"), member(id(ctx.SC), ctx.sV)), [
			exprStmt(ctx.push(ctx.curSv())),
			breakStmt(),
		]),
		// Walk parent scopes
		varDecl("s", member(id(ctx.SC), ctx.sPar)),
		varDecl("found", lit(false)),
		whileStmt(id("s"), [
			ifStmt(bin("in", id("name"), member(id("s"), ctx.sV)), [
				exprStmt(ctx.push(ctx.sv())),
				exprStmt(assign(id("found"), lit(true))),
				breakStmt(),
			]),
			exprStmt(assign(id("s"), member(id("s"), ctx.sPar))),
		]),
		// Global fallback
		ifStmt(un("!", id("found")), [
			exprStmt(ctx.push(index(id(ctx.t("_g")), id("name")))),
		]),
		breakStmt(),
	];
}

/**
 * STORE_SCOPED: walk scope chain to find variable slot, fall back to global.
 *
 * Pops value from stack, assigns to first scope that contains the name.
 * Does NOT use ctx.scopeWalk() because the global fallback runs after
 * the while loop instead of a trailing break.
 */
function STORE_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		varDecl("val", ctx.pop()),
		// Fast path: check current scope first
		ifStmt(bin("in", id("name"), member(id(ctx.SC), ctx.sV)), [
			exprStmt(assign(ctx.curSv(), id("val"))),
			breakStmt(),
		]),
		// Walk parent scopes
		varDecl("s", member(id(ctx.SC), ctx.sPar)),
		varDecl("found", lit(false)),
		whileStmt(id("s"), [
			ifStmt(bin("in", id("name"), member(id("s"), ctx.sV)), [
				exprStmt(assign(ctx.sv(), id("val"))),
				exprStmt(assign(id("found"), lit(true))),
				breakStmt(),
			]),
			exprStmt(assign(id("s"), member(id("s"), ctx.sPar))),
		]),
		// Global fallback
		ifStmt(un("!", id("found")), [
			exprStmt(assign(index(id(ctx.t("_g")), id("name")), id("val"))),
		]),
		breakStmt(),
	];
}

// --- Declarations ---

/**
 * DECLARE_VAR / DECLARE_LET / DECLARE_CONST: declare variable in current scope.
 *
 * Only initializes to undefined if the name is not already present.
 */
function declareHandler(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		ifStmt(un("!", bin("in", id("name"), member(id(ctx.SC), ctx.sV))), [
			exprStmt(assign(ctx.curSv(), un("void", lit(0)))),
		]),
		breakStmt(),
	];
}

// --- Push / pop scope ---

/**
 * PUSH_SCOPE / PUSH_BLOCK_SCOPE / PUSH_CATCH_SCOPE: create a new scope frame.
 *
 * All three share the same handler — a new scope with empty vars and a parent
 * pointer to the current scope.
 */
function pushScopeHandler(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(
			assign(id(ctx.SC), obj([ctx.sPar, id(ctx.SC)], [ctx.sV, obj()]))
		),
		breakStmt(),
	];
}

/** POP_SCOPE: restore parent scope (or stay if already at root). */
function POP_SCOPE(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(
			assign(
				id(ctx.SC),
				bin("||", member(id(ctx.SC), ctx.sPar), id(ctx.SC))
			)
		),
		breakStmt(),
	];
}

// --- TDZ (Temporal Dead Zone) ---

/**
 * TDZ_CHECK: throw ReferenceError if variable is still in temporal dead zone.
 */
function TDZ_CHECK(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		ifStmt(
			bin(
				"&&",
				member(id(ctx.SC), ctx.sTdz),
				index(member(id(ctx.SC), ctx.sTdz), id("name"))
			),
			[
				throwStmt(
					newExpr(id("ReferenceError"), [
						bin(
							"+",
							bin("+", lit("Cannot access '"), id("name")),
							lit("' before initialization")
						),
					])
				),
			]
		),
		breakStmt(),
	];
}

/** TDZ_MARK: remove variable from TDZ set (it has been initialized). */
function TDZ_MARK(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		ifStmt(member(id(ctx.SC), ctx.sTdz), [
			exprStmt(
				un("delete", index(member(id(ctx.SC), ctx.sTdz), id("name")))
			),
		]),
		breakStmt(),
	];
}

// --- With scope ---

/**
 * PUSH_WITH_SCOPE: pop an object from the stack and use it as the scope's
 * variable bag (for `with` statements).
 */
function PUSH_WITH_SCOPE(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("wObj", ctx.pop()),
		exprStmt(
			assign(
				id(ctx.SC),
				obj([ctx.sPar, id(ctx.SC)], [ctx.sV, id("wObj")])
			)
		),
		breakStmt(),
	];
}

// --- Delete scoped ---

/**
 * DELETE_SCOPED: walk scope chain to find and delete variable.
 *
 * Pushes the result of `delete` onto the stack.
 * Uses ctx.scopeWalk() since the trailing break after the while loop is correct.
 */
function DELETE_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		varDecl("s", id(ctx.SC)),
		...ctx.scopeWalk([exprStmt(ctx.push(un("delete", ctx.sv())))]),
	];
}

// --- Global access ---

/** LOAD_GLOBAL: load a global variable by name. */
function LOAD_GLOBAL(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("g", id(ctx.t("_g"))),
		exprStmt(ctx.push(index(id("g"), index(id(ctx.C), id(ctx.O))))),
		breakStmt(),
	];
}

/** STORE_GLOBAL: store a value to a global variable by name. */
function STORE_GLOBAL(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("g", id(ctx.t("_g"))),
		exprStmt(
			assign(index(id("g"), index(id(ctx.C), id(ctx.O))), ctx.pop())
		),
		breakStmt(),
	];
}

/**
 * TYPEOF_GLOBAL: walk scope chain first (for closures), then fall back to
 * `typeof _g[name]` for true globals.
 *
 * Does NOT use ctx.scopeWalk() because the global `typeof` fallback runs
 * after the while loop instead of a trailing break.
 */
function TYPEOF_GLOBAL(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		varDecl("s", id(ctx.SC)),
		varDecl(ctx.t("_tf"), lit(false)),
		whileStmt(id("s"), [
			ifStmt(bin("in", id("name"), member(id("s"), ctx.sV)), [
				exprStmt(ctx.push(un("typeof", ctx.sv()))),
				exprStmt(assign(id(ctx.t("_tf")), lit(true))),
				breakStmt(),
			]),
			exprStmt(assign(id("s"), member(id("s"), ctx.sPar))),
		]),
		ifStmt(un("!", id(ctx.t("_tf"))), [
			exprStmt(ctx.push(un("typeof", index(id(ctx.t("_g")), id("name"))))),
		]),
		breakStmt(),
	];
}

// --- Registration ---

registry.set(Op.LOAD_SCOPED, LOAD_SCOPED);
registry.set(Op.STORE_SCOPED, STORE_SCOPED);
registry.set(Op.DECLARE_VAR, declareHandler);
registry.set(Op.DECLARE_LET, declareHandler);
registry.set(Op.DECLARE_CONST, declareHandler);
registry.set(Op.PUSH_SCOPE, pushScopeHandler);
registry.set(Op.PUSH_BLOCK_SCOPE, pushScopeHandler);
registry.set(Op.PUSH_CATCH_SCOPE, pushScopeHandler);
registry.set(Op.POP_SCOPE, POP_SCOPE);
registry.set(Op.TDZ_CHECK, TDZ_CHECK);
registry.set(Op.TDZ_MARK, TDZ_MARK);
registry.set(Op.PUSH_WITH_SCOPE, PUSH_WITH_SCOPE);
registry.set(Op.DELETE_SCOPED, DELETE_SCOPED);
registry.set(Op.LOAD_GLOBAL, LOAD_GLOBAL);
registry.set(Op.STORE_GLOBAL, STORE_GLOBAL);
registry.set(Op.TYPEOF_GLOBAL, TYPEOF_GLOBAL);
