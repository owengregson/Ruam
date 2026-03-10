/**
 * Type operation and miscellaneous opcode handlers in AST node form.
 *
 * Covers 18 opcodes:
 *  - Type ops:  TYPEOF, VOID, TO_NUMBER, TO_STRING, TO_BOOLEAN, TO_OBJECT,
 *               TO_PROPERTY_KEY, TO_NUMERIC
 *  - Templates: TEMPLATE_LITERAL, TAGGED_TEMPLATE, CREATE_RAW_STRINGS
 *  - No-ops:    DEBUGGER_STMT, COMMA, SOURCE_MAP
 *  - Meta:      IMPORT_META, DYNAMIC_IMPORT
 *  - Assertions: ASSERT_DEFINED, ASSERT_FUNCTION
 *
 * Simple handlers use AST nodes directly.  Handlers with complex control flow
 * (loops, multi-statement var blocks, conditional logic) use raw() nodes.
 *
 * @module codegen/handlers/type-ops
 */

import { Op } from "../../compiler/opcodes.js";
import {
	type JsNode,
	id,
	lit,
	un,
	assign,
	call,
	exprStmt,
	breakStmt,
	raw,
} from "../nodes.js";
import { registry, type HandlerCtx } from "./registry.js";

// --- Simple type coercions (AST nodes) ---

/** `S[P]=typeof S[P];break;` */
function TYPEOF(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(assign(ctx.peek(), un("typeof", ctx.peek()))), breakStmt()];
}

/** `S[P]=void 0;break;` */
function VOID(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(assign(ctx.peek(), un("void", lit(0)))), breakStmt()];
}

/** `S[P]=Number(S[P]);break;` */
function TO_NUMBER(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(assign(ctx.peek(), call(id("Number"), [ctx.peek()]))),
		breakStmt(),
	];
}

/** `S[P]=String(S[P]);break;` */
function TO_STRING(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(assign(ctx.peek(), call(id("String"), [ctx.peek()]))),
		breakStmt(),
	];
}

/** `S[P]=Boolean(S[P]);break;` */
function TO_BOOLEAN(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(assign(ctx.peek(), call(id("Boolean"), [ctx.peek()]))),
		breakStmt(),
	];
}

/** `S[P]=Object(S[P]);break;` */
function TO_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(assign(ctx.peek(), call(id("Object"), [ctx.peek()]))),
		breakStmt(),
	];
}

// --- Complex type coercions (raw) ---

/**
 * TO_PROPERTY_KEY: `{var v=S[P];S[P]=typeof v==='symbol'?v:String(v);break;}`
 */
function TO_PROPERTY_KEY(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var v=${ctx.S}[${ctx.P}];${ctx.S}[${ctx.P}]=typeof v==='symbol'?v:String(v);break;`
		),
	];
}

/**
 * TO_NUMERIC: `{var v=S[P];S[P]=typeof v==='bigint'?v:Number(v);break;}`
 */
function TO_NUMERIC(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var v=${ctx.S}[${ctx.P}];${ctx.S}[${ctx.P}]=typeof v==='bigint'?v:Number(v);break;`
		),
	];
}

// --- Template handlers (raw — complex loops and string building) ---

/**
 * TEMPLATE_LITERAL: assemble template parts from the stack.
 *
 * ```
 * var exprCount=O;var parts=[];
 * for(var ti=exprCount*2;ti>=0;ti--)parts.unshift(X());
 * var result='';for(var ti=0;ti<parts.length;ti++)result+=String(parts[ti]!=null?parts[ti]:'');
 * W(result);break;
 * ```
 */
function TEMPLATE_LITERAL(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var exprCount=${ctx.O};var parts=[];` +
				`for(var ti=exprCount*2;ti>=0;ti--)parts.unshift(${ctx.X}());` +
				`var result='';for(var ti=0;ti<parts.length;ti++)result+=String(parts[ti]!=null?parts[ti]:'');` +
				`${ctx.W}(result);break;`
		),
	];
}

/**
 * TAGGED_TEMPLATE: call tag function with template arguments.
 *
 * ```
 * var argc=O;var callArgs=[];
 * for(var ai=0;ai<argc;ai++)callArgs.unshift(X());
 * var fn=X();W(fn.apply(void 0,callArgs));break;
 * ```
 */
function TAGGED_TEMPLATE(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var argc=${ctx.O};var callArgs=[];` +
				`for(var ai=0;ai<argc;ai++)callArgs.unshift(${ctx.X}());` +
				`var fn=${ctx.X}();${ctx.W}(fn.apply(void 0,callArgs));break;`
		),
	];
}

/**
 * CREATE_RAW_STRINGS: build frozen raw strings array.
 *
 * ```
 * var count=O;var raw=[];
 * for(var ri=0;ri<count;ri++)raw.unshift(X());
 * Object.freeze(raw);W(raw);break;
 * ```
 */
function CREATE_RAW_STRINGS(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var count=${ctx.O};var raw=[];` +
				`for(var ri=0;ri<count;ri++)raw.unshift(${ctx.X}());` +
				`Object.freeze(raw);${ctx.W}(raw);break;`
		),
	];
}

// --- No-op handlers (AST nodes — just break) ---

/** DEBUGGER_STMT: no-op in obfuscated output. */
function DEBUGGER_STMT(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

/** COMMA: no-op (value already on stack). */
function COMMA(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

/** SOURCE_MAP: no-op (debug information only). */
function SOURCE_MAP(_ctx: HandlerCtx): JsNode[] {
	return [breakStmt()];
}

// --- Meta / import handlers ---

/** `S[++P]={};break;` — import.meta stub */
function IMPORT_META(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(ctx.push({ type: "ObjectExpr", entries: [] })),
		breakStmt(),
	];
}

/**
 * DYNAMIC_IMPORT: `{var spec=X();W(import(spec));break;}`
 */
function DYNAMIC_IMPORT(ctx: HandlerCtx): JsNode[] {
	return [raw(`var spec=${ctx.X}();${ctx.W}(import(spec));break;`)];
}

// --- Assertion handlers (raw — conditional throw) ---

/**
 * ASSERT_DEFINED: `{var v=Y();if(v===void 0)throw new TypeError('Cannot read properties of undefined');break;}`
 */
function ASSERT_DEFINED(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var v=${ctx.Y}();if(v===void 0)throw new TypeError('Cannot read properties of undefined');break;`
		),
	];
}

/**
 * ASSERT_FUNCTION: `{var v=Y();if(typeof v!=='function')throw new TypeError(v+' is not a function');break;}`
 */
function ASSERT_FUNCTION(ctx: HandlerCtx): JsNode[] {
	return [
		raw(
			`var v=${ctx.Y}();if(typeof v!=='function')throw new TypeError(v+' is not a function');break;`
		),
	];
}

// --- Registration ---

registry.set(Op.TYPEOF, TYPEOF);
registry.set(Op.VOID, VOID);
registry.set(Op.TO_NUMBER, TO_NUMBER);
registry.set(Op.TO_STRING, TO_STRING);
registry.set(Op.TO_BOOLEAN, TO_BOOLEAN);
registry.set(Op.TO_OBJECT, TO_OBJECT);
registry.set(Op.TO_PROPERTY_KEY, TO_PROPERTY_KEY);
registry.set(Op.TO_NUMERIC, TO_NUMERIC);
registry.set(Op.TEMPLATE_LITERAL, TEMPLATE_LITERAL);
registry.set(Op.TAGGED_TEMPLATE, TAGGED_TEMPLATE);
registry.set(Op.CREATE_RAW_STRINGS, CREATE_RAW_STRINGS);
registry.set(Op.DEBUGGER_STMT, DEBUGGER_STMT);
registry.set(Op.COMMA, COMMA);
registry.set(Op.SOURCE_MAP, SOURCE_MAP);
registry.set(Op.IMPORT_META, IMPORT_META);
registry.set(Op.DYNAMIC_IMPORT, DYNAMIC_IMPORT);
registry.set(Op.ASSERT_DEFINED, ASSERT_DEFINED);
registry.set(Op.ASSERT_FUNCTION, ASSERT_FUNCTION);
