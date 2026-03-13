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
 * Scope chain is prototypal: `Object.create(parent)` for push,
 * `Object.getPrototypeOf(scope)` for pop. Variables are own
 * properties on the scope object. The `in` operator traverses the
 * prototype chain automatically for reads; stores must walk with
 * `hasOwnProperty` to find the owning scope.
 *
 * TDZ uses a sentinel object (per-build unique, stored at IIFE scope).
 * `TDZ_CHECK` compares `SC[name] === sentinel`; `TDZ_MARK` is a no-op
 * (the subsequent assignment overwrites the sentinel).
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
	call,
	member,
	index,
	varDecl,
	exprStmt,
	ifStmt,
	whileStmt,
	throwStmt,
	breakStmt,
	newExpr,
} from "../nodes.js";
import type { HandlerCtx } from "./registry.js";
import { registry } from "./registry.js";

// --- Helpers ---

/**
 * Build `Object.prototype.hasOwnProperty.call(obj, key)` AST node.
 *
 * Root scopes created via `Object.create(null)` have no prototype,
 * so `obj.hasOwnProperty(key)` would throw. Using
 * `Object.prototype.hasOwnProperty.call` is safe for all scopes.
 */
function hasOwn(obj: JsNode, key: JsNode): JsNode {
	return call(
		member(
			member(member(id("Object"), "prototype"), "hasOwnProperty"),
			"call"
		),
		[obj, key]
	);
}

// --- Load / store scoped ---

/**
 * LOAD_SCOPED: use `in` operator to check prototype chain, fall back to global.
 *
 * The `in` operator traverses the prototype chain automatically, so a
 * single check replaces the old manual while-loop.
 */
function LOAD_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		// Fast path: read once, check for sentinel/undefined
		varDecl("_v", ctx.curSv()),
		// If the value is not undefined and not TDZ sentinel, push directly
		// (avoids the `in` prototype chain traversal entirely)
		ifStmt(
			bin("!==", id("_v"), un("void", lit(0))),
			[
				// TDZ check: if _v === tdzSentinel, throw
				ifStmt(bin("===", id("_v"), id(ctx.tdzSentinel)), [
					throwStmt(
						newExpr(id("ReferenceError"), [
							bin(
								"+",
								bin("+", lit("Cannot access '"), id("name")),
								lit("' before initialization")
							),
						])
					),
				]),
				exprStmt(ctx.push(id("_v"))),
				breakStmt(),
			]
		),
		// Slow path: value was undefined — need `in` to distinguish
		// "property exists with value undefined" from "property not found"
		ifStmt(bin("in", id("name"), id(ctx.SC)), [
			exprStmt(ctx.push(id("_v"))),
			breakStmt(),
		]),
		// Global fallback
		exprStmt(ctx.push(index(id(ctx.t("_g")), id("name")))),
		breakStmt(),
	];
}

/**
 * STORE_SCOPED: walk scope chain with hasOwnProperty to find owning scope.
 *
 * Must find the specific scope that owns the variable (can't use `in`
 * because that would always match the first scope in the chain). Falls
 * back to global assignment.
 */
function STORE_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		varDecl("val", ctx.pop()),
		// Walk to find owning scope
		varDecl("s", id(ctx.SC)),
		varDecl("found", lit(false)),
		whileStmt(id("s"), [
			ifStmt(hasOwn(id("s"), id("name")), [
				exprStmt(assign(ctx.sv(), id("val"))),
				exprStmt(assign(id("found"), lit(true))),
				breakStmt(),
			]),
			exprStmt(
				assign(
					id("s"),
					call(member(id("Object"), "getPrototypeOf"), [id("s")])
				)
			),
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
 * DECLARE_VAR: declare variable as own property on current scope.
 *
 * Only initializes to undefined if the name is not already an own property.
 */
function declareVarHandler(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		ifStmt(
			un("!", hasOwn(id(ctx.SC), id("name"))),
			[exprStmt(assign(ctx.curSv(), un("void", lit(0))))]
		),
		breakStmt(),
	];
}

/**
 * DECLARE_LET / DECLARE_CONST: declare variable with TDZ sentinel.
 *
 * Sets the variable to the TDZ sentinel value. TDZ_CHECK will throw
 * if the variable is still the sentinel when accessed.
 */
function declareLetConstHandler(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		exprStmt(assign(ctx.curSv(), id(ctx.tdzSentinel))),
		breakStmt(),
	];
}

// --- Push / pop scope ---

/**
 * PUSH_SCOPE / PUSH_BLOCK_SCOPE / PUSH_CATCH_SCOPE: create a new scope.
 *
 * Uses `Object.create(SC)` — the current scope becomes the prototype,
 * so `in` operator and property lookups naturally traverse the chain.
 */
function pushScopeHandler(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(
			assign(
				id(ctx.SC),
				call(member(id("Object"), "create"), [id(ctx.SC)])
			)
		),
		breakStmt(),
	];
}

/**
 * POP_SCOPE: restore parent scope via Object.getPrototypeOf.
 *
 * If already at root (prototype is null), stay at current scope.
 */
function POP_SCOPE(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(
			assign(
				id(ctx.SC),
				bin(
					"||",
					call(member(id("Object"), "getPrototypeOf"), [id(ctx.SC)]),
					id(ctx.SC)
				)
			)
		),
		breakStmt(),
	];
}

// --- TDZ (Temporal Dead Zone) ---

/**
 * TDZ_CHECK: throw ReferenceError if variable is still the TDZ sentinel.
 */
function TDZ_CHECK(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		ifStmt(bin("===", ctx.curSv(), id(ctx.tdzSentinel)), [
			throwStmt(
				newExpr(id("ReferenceError"), [
					bin(
						"+",
						bin("+", lit("Cannot access '"), id("name")),
						lit("' before initialization")
					),
				])
			),
		]),
		breakStmt(),
	];
}

/**
 * TDZ_MARK: variable has been initialized — no-op.
 *
 * The subsequent STORE_SCOPED / assignment overwrites the sentinel,
 * so TDZ_MARK doesn't need to do anything.
 */
function TDZ_MARK(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

// --- With scope ---

/**
 * PUSH_WITH_SCOPE: pop an object from the stack and create a scope
 * that delegates to it via `Object.create`.
 *
 * The `with` object's properties become the scope's own properties
 * through prototype delegation — `in` operator finds them naturally.
 */
function PUSH_WITH_SCOPE(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("wObj", ctx.pop()),
		// Create a scope whose prototype is the current scope,
		// then copy the with-object's properties as own properties.
		// Object.assign(Object.create(SC), wObj) gives us both:
		// with-object properties as own, parent chain as prototype.
		exprStmt(
			assign(
				id(ctx.SC),
				call(member(id("Object"), "assign"), [
					call(member(id("Object"), "create"), [id(ctx.SC)]),
					id("wObj"),
				])
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
 * TYPEOF_GLOBAL: check prototype chain first (for closures), then fall
 * back to `typeof _g[name]` for true globals.
 *
 * Uses `in` operator on SC (traverses prototype chain) for fast check.
 */
function TYPEOF_GLOBAL(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		ifStmt(bin("in", id("name"), id(ctx.SC)), [
			exprStmt(ctx.push(un("typeof", ctx.curSv()))),
			breakStmt(),
		]),
		exprStmt(
			ctx.push(un("typeof", index(id(ctx.t("_g")), id("name"))))
		),
		breakStmt(),
	];
}

// --- Registration ---

registry.set(Op.LOAD_SCOPED, LOAD_SCOPED);
registry.set(Op.STORE_SCOPED, STORE_SCOPED);
registry.set(Op.DECLARE_VAR, declareVarHandler);
registry.set(Op.DECLARE_LET, declareLetConstHandler);
registry.set(Op.DECLARE_CONST, declareLetConstHandler);
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
