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
 * All handlers use raw() because scope chain walking involves while loops
 * with `break` statements that are ambiguous — the `break` exits the while
 * loop, not the enclosing switch case.
 *
 * @module codegen/handlers/scope
 */

import { Op } from "../../compiler/opcodes.js";
import { type JsNode, raw, breakStmt } from "../nodes.js";
import type { HandlerCtx } from "./index.js";
import { registry } from "./index.js";

// --- Load / store scoped ---

/**
 * LOAD_SCOPED: walk scope chain to find variable, fall back to global.
 *
 * Fast path checks current scope first, then walks parent chain.
 */
function LOAD_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var name=${ctx.C}[${ctx.O}];` +
		`if(name in ${ctx.SC}.${ctx.sV}){${ctx.W}(${ctx.SC}.${ctx.sV}[name]);break;}` +
		`var s=${ctx.SC}.${ctx.sPar};var found=false;` +
		`while(s){if(name in s.${ctx.sV}){${ctx.W}(s.${ctx.sV}[name]);found=true;break;}s=s.${ctx.sPar};}` +
		`if(!found){${ctx.W}(_g[name]);}` +
		`break;`
	)];
}

/**
 * STORE_SCOPED: walk scope chain to find variable slot, fall back to global.
 *
 * Pops value from stack, assigns to first scope that contains the name.
 */
function STORE_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var name=${ctx.C}[${ctx.O}];var val=${ctx.S}[${ctx.P}--];` +
		`if(name in ${ctx.SC}.${ctx.sV}){${ctx.SC}.${ctx.sV}[name]=val;break;}` +
		`var s=${ctx.SC}.${ctx.sPar};var found=false;` +
		`while(s){if(name in s.${ctx.sV}){s.${ctx.sV}[name]=val;found=true;break;}s=s.${ctx.sPar};}` +
		`if(!found){_g[name]=val;}` +
		`break;`
	)];
}

// --- Declarations ---

/**
 * DECLARE_VAR / DECLARE_LET / DECLARE_CONST: declare variable in current scope.
 *
 * Only initializes to undefined if the name is not already present.
 */
function declareHandler(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var name=${ctx.C}[${ctx.O}];if(!(name in ${ctx.SC}.${ctx.sV}))${ctx.SC}.${ctx.sV}[name]=void 0;break;`
	)];
}

// --- Push / pop scope ---

/**
 * PUSH_SCOPE / PUSH_BLOCK_SCOPE / PUSH_CATCH_SCOPE: create a new scope frame.
 *
 * All three share the same handler — a new scope with empty vars and a parent
 * pointer to the current scope.
 */
function pushScopeHandler(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`${ctx.SC}={${ctx.sPar}:${ctx.SC},${ctx.sV}:{}};break;`
	)];
}

/** POP_SCOPE: restore parent scope (or stay if already at root). */
function POP_SCOPE(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`${ctx.SC}=${ctx.SC}.${ctx.sPar}||${ctx.SC};break;`
	)];
}

// --- TDZ (Temporal Dead Zone) ---

/**
 * TDZ_CHECK: throw ReferenceError if variable is still in temporal dead zone.
 */
function TDZ_CHECK(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var name=${ctx.C}[${ctx.O}];` +
		`if(${ctx.SC}.${ctx.sTdz}&&${ctx.SC}.${ctx.sTdz}[name])` +
		`throw new ReferenceError("Cannot access '"+name+"' before initialization");break;`
	)];
}

/** TDZ_MARK: remove variable from TDZ set (it has been initialized). */
function TDZ_MARK(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var name=${ctx.C}[${ctx.O}];if(${ctx.SC}.${ctx.sTdz})delete ${ctx.SC}.${ctx.sTdz}[name];break;`
	)];
}

// --- With scope ---

/**
 * PUSH_WITH_SCOPE: pop an object from the stack and use it as the scope's
 * variable bag (for `with` statements).
 */
function PUSH_WITH_SCOPE(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var wObj=${ctx.X}();${ctx.SC}={${ctx.sPar}:${ctx.SC},${ctx.sV}:wObj};break;`
	)];
}

// --- Delete scoped ---

/**
 * DELETE_SCOPED: walk scope chain to find and delete variable.
 *
 * Pushes the result of `delete` onto the stack.
 */
function DELETE_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var name=${ctx.C}[${ctx.O}];var s=${ctx.SC};` +
		`while(s){if(name in s.${ctx.sV}){${ctx.W}(delete s.${ctx.sV}[name]);break;}s=s.${ctx.sPar};}break;`
	)];
}

// --- Global access ---

/** LOAD_GLOBAL: load a global variable by name. */
function LOAD_GLOBAL(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var g=_g;${ctx.W}(g[${ctx.C}[${ctx.O}]]);break;`
	)];
}

/** STORE_GLOBAL: store a value to a global variable by name. */
function STORE_GLOBAL(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var g=_g;g[${ctx.C}[${ctx.O}]]=${ctx.X}();break;`
	)];
}

/**
 * TYPEOF_GLOBAL: walk scope chain first (for closures), then fall back to
 * `typeof _g[name]` for true globals.
 *
 * This ensures `typeof x` works correctly in closures where `x` is captured.
 */
function TYPEOF_GLOBAL(ctx: HandlerCtx): JsNode[] {
	return [raw(
		`var name=${ctx.C}[${ctx.O}];` +
		`var s=${ctx.SC};var _tf=false;` +
		`while(s){if(name in s.${ctx.sV}){${ctx.W}(typeof s.${ctx.sV}[name]);_tf=true;break;}s=s.${ctx.sPar};}` +
		`if(!_tf){${ctx.W}(typeof _g[name]);}` +
		`break;`
	)];
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
