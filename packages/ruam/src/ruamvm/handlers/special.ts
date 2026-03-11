/**
 * Special value push and arguments opcode handlers in AST node form.
 *
 * Covers 8 opcodes:
 *  - Value push:  PUSH_THIS, PUSH_ARGUMENTS, PUSH_NEW_TARGET, PUSH_GLOBAL_THIS,
 *                 PUSH_WELL_KNOWN_SYMBOL
 *  - Arguments:   CREATE_UNMAPPED_ARGS, CREATE_MAPPED_ARGS, CREATE_REST_ARGS
 *
 * All handlers use pure AST nodes — no raw() escape hatch.
 *
 * @module ruamvm/handlers/special
 */

import { Op } from "../../compiler/opcodes.js";
import {
	type JsNode,
	id,
	bin,
	member,
	call,
	arr,
	spread,
	varDecl,
	exprStmt,
	breakStmt,
	index,
} from "../nodes.js";
import { registry, type HandlerCtx } from "./registry.js";

// --- Simple push handlers ---

/** `S[++P]=TV;break;` — push `this` value */
function PUSH_THIS(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(id(ctx.TV))), breakStmt()];
}

/** `S[++P]=A;break;` — push arguments object */
function PUSH_ARGUMENTS(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(id(ctx.A))), breakStmt()];
}

/** `S[++P]=NT;break;` — push new.target */
function PUSH_NEW_TARGET(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(id(ctx.NT))), breakStmt()];
}

// --- Complex push handlers ---

/**
 * PUSH_GLOBAL_THIS: `{var g=_g;W(g);break;}`
 *
 * Uses intermediate `var g` to match the original runtime pattern.
 */
function PUSH_GLOBAL_THIS(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("g", id(ctx.t("_g"))),
		exprStmt(ctx.push(id("g"))),
		breakStmt(),
	];
}

/**
 * PUSH_WELL_KNOWN_SYMBOL: push a well-known Symbol by index.
 *
 * ```
 * var syms=[Symbol.iterator,Symbol.asyncIterator,Symbol.hasInstance,
 *   Symbol.toPrimitive,Symbol.toStringTag,Symbol.species,
 *   Symbol.isConcatSpreadable,Symbol.match,Symbol.replace,
 *   Symbol.search,Symbol.split,Symbol.unscopables];
 * W(syms[O]||Symbol.iterator);break;
 * ```
 */
function PUSH_WELL_KNOWN_SYMBOL(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl(
			"syms",
			arr(
				member(id("Symbol"), "iterator"),
				member(id("Symbol"), "asyncIterator"),
				member(id("Symbol"), "hasInstance"),
				member(id("Symbol"), "toPrimitive"),
				member(id("Symbol"), "toStringTag"),
				member(id("Symbol"), "species"),
				member(id("Symbol"), "isConcatSpreadable"),
				member(id("Symbol"), "match"),
				member(id("Symbol"), "replace"),
				member(id("Symbol"), "search"),
				member(id("Symbol"), "split"),
				member(id("Symbol"), "unscopables")
			)
		),
		exprStmt(
			ctx.push(
				bin(
					"||",
					index(id("syms"), id(ctx.O)),
					member(id("Symbol"), "iterator")
				)
			)
		),
		breakStmt(),
	];
}

// --- Arguments handlers ---

/**
 * CREATE_UNMAPPED_ARGS / CREATE_MAPPED_ARGS: `W([...A]);break;`
 *
 * Both opcodes produce the same handler — a spread copy of the arguments object.
 */
function CREATE_ARGS_COPY(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(arr(spread(id(ctx.A))))), breakStmt()];
}

/**
 * CREATE_REST_ARGS: `W(A.slice(O));break;`
 *
 * Slices arguments from the operand index onward (rest parameter start).
 */
function CREATE_REST_ARGS(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(ctx.push(call(member(id(ctx.A), "slice"), [id(ctx.O)]))),
		breakStmt(),
	];
}

// --- Registration ---

registry.set(Op.PUSH_THIS, PUSH_THIS);
registry.set(Op.PUSH_ARGUMENTS, PUSH_ARGUMENTS);
registry.set(Op.PUSH_NEW_TARGET, PUSH_NEW_TARGET);
registry.set(Op.PUSH_GLOBAL_THIS, PUSH_GLOBAL_THIS);
registry.set(Op.PUSH_WELL_KNOWN_SYMBOL, PUSH_WELL_KNOWN_SYMBOL);
registry.set(Op.CREATE_UNMAPPED_ARGS, CREATE_ARGS_COPY);
registry.set(Op.CREATE_MAPPED_ARGS, CREATE_ARGS_COPY);
registry.set(Op.CREATE_REST_ARGS, CREATE_REST_ARGS);
