# JS AST Builder Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all string-based runtime code generation with a purpose-built JS AST builder, eliminating ~1,200 lines of raw JS-in-template-literals and 5 fragile regex post-processing passes.

**Architecture:** ~36 AST node types with factory functions produce a tree representation of the runtime JS. A single recursive `emit()` function serializes the tree to minified output. Regex post-processing (inline stack ops, obfuscate locals, filter handlers, inject decoys, remap labels) becomes structural tree transformations. All 162 opcode case handlers move from one 1,645-line megafile into ~12 categorized handler files.

**Tech Stack:** TypeScript (strict ESM), vitest for testing, existing build/test infrastructure unchanged.

**Spec:** `docs/specs/2026-03-10-ruamvm-ast-builder-design.md`

**Design Notes:**

-   The spec's `ParamList` node is replaced by plain `string[]` in function/arrow params — simpler and sufficient since param lists don't need tree transforms.
-   `CaseClause.label` is `JsNode | null` (not just a number) — more general than the spec suggests, allowing arbitrary case expressions while using `null` for `default`.
-   Node types are narrowed to JS constructs actually used in the runtime templates. `LetDecl`, `ForOfStmt`, `DoWhileStmt` etc. are omitted since the generated runtime JS uses only `var`/`const`, `for-in`, and `while`.
-   `ExprStmt` wrapper node is added (not in spec's node table) for correct semicolon insertion when expressions appear in statement position.

---

## File Structure

### New Files

```
packages/ruam/src/ruamvm/
  nodes.ts              — AST node type definitions + ~30 factory functions (~150 lines)
  emit.ts               — Recursive emit(node): string with precedence-aware parens (~300 lines)
  transforms.ts         — Tree visitors: inlineStackOps, obfuscateLocals (~300 lines)
  handlers/
    arithmetic.ts       — ADD, SUB, MUL, DIV, MOD, NEG, INC, DEC, POW, UNARY_PLUS, BIT_*, SHL, SHR, USHR
    comparison.ts       — EQ, NEQ, SEQ, SNEQ, LT, GT, LTE, GTE
    logical.ts          — NOT, LOGICAL_AND, LOGICAL_OR, NULLISH_COALESCE
    stack.ts            — PUSH_CONST, PUSH_*, POP, POP_N, DUP, DUP2, SWAP, ROT3, ROT4, PICK
    control-flow.ts     — JMP, JMP_TRUE, JMP_FALSE, JMP_*, RETURN, RETURN_VOID, THROW, RETHROW, NOP, TABLE_SWITCH, LOOKUP_SWITCH
    scope.ts            — LOAD_SCOPED, STORE_SCOPED, DECLARE_*, PUSH_SCOPE, POP_SCOPE, TDZ_*, PUSH_WITH_SCOPE, DELETE_SCOPED, LOAD_GLOBAL, STORE_GLOBAL, TYPEOF_GLOBAL
    registers.ts        — LOAD_REG, STORE_REG, LOAD_ARG, STORE_ARG, LOAD_ARG_OR_DEFAULT, GET_ARG_COUNT, INC_REG, DEC_REG, POST_INC_REG, POST_DEC_REG, *_ASSIGN_REG, FAST_*
    functions.ts        — NEW_CLOSURE, NEW_FUNCTION, NEW_ARROW, NEW_ASYNC, NEW_GENERATOR, NEW_ASYNC_GENERATOR, SET_FUNC_NAME, SET_FUNC_LENGTH, BIND_THIS, MAKE_METHOD, PUSH_CLOSURE_VAR, STORE_CLOSURE_VAR
    calls.ts            — CALL, CALL_METHOD, CALL_NEW, SUPER_CALL, SPREAD_ARGS, CALL_OPTIONAL, CALL_METHOD_OPTIONAL, DIRECT_EVAL, CALL_TAGGED_TEMPLATE, CALL_SUPER_METHOD, CALL_0/1/2/3
    objects.ts          — GET_PROP_*, SET_PROP_*, DELETE_PROP_*, OPT_CHAIN_*, IN_OP, INSTANCEOF, GET_SUPER_PROP, SET_SUPER_PROP, GET_PRIVATE_FIELD, SET_PRIVATE_FIELD, HAS_PRIVATE_FIELD, DEFINE_OWN_PROPERTY, NEW_OBJECT, NEW_ARRAY, NEW_ARRAY_WITH_SIZE, ARRAY_*, SPREAD_*, COPY_DATA_PROPERTIES, SET_PROTO, FREEZE_OBJECT, SEAL_OBJECT, DEFINE_PROPERTY_DESC, CREATE_TEMPLATE_OBJECT
    classes.ts          — NEW_CLASS, NEW_DERIVED_CLASS, EXTEND_CLASS, DEFINE_METHOD, DEFINE_STATIC_METHOD, DEFINE_GETTER, DEFINE_SETTER, DEFINE_*_STATIC_*, DEFINE_FIELD, DEFINE_STATIC_FIELD, DEFINE_PRIVATE_*, CLASS_STATIC_BLOCK, FINALIZE_CLASS, INIT_PRIVATE_ENV, ADD_PRIVATE_BRAND, CHECK_PRIVATE_BRAND
    exceptions.ts       — TRY_PUSH, TRY_POP, CATCH_BIND, FINALLY_MARK, END_FINALLY, CATCH_BIND_PATTERN, THROW_IF_NOT_OBJECT, THROW_REF_ERROR, THROW_TYPE_ERROR, THROW_SYNTAX_ERROR
    iterators.ts        — GET_ITERATOR, ITER_NEXT, ITER_DONE, ITER_VALUE, ITER_CLOSE, ITER_RESULT_UNWRAP, FORIN_INIT, FORIN_NEXT, FORIN_DONE, GET_ASYNC_ITERATOR, ASYNC_ITER_*, FOR_AWAIT_NEXT, CREATE_ASYNC_FROM_SYNC_ITER
    generators.ts       — YIELD, YIELD_DELEGATE, AWAIT, CREATE_GENERATOR, GENERATOR_RESUME, GENERATOR_RETURN, GENERATOR_THROW, SUSPEND, RESUME, ASYNC_GENERATOR_*
    type-ops.ts         — TYPEOF, VOID, TO_NUMBER, TO_STRING, TO_BOOLEAN, TO_OBJECT, TO_PROPERTY_KEY, TO_NUMERIC, DEBUGGER_STMT, COMMA, SOURCE_MAP, ASSERT_*, IMPORT_META, DYNAMIC_IMPORT
    compound-scoped.ts  — INC_SCOPED, DEC_SCOPED, POST_INC_SCOPED, POST_DEC_SCOPED, *_ASSIGN_SCOPED, NULLISH_ASSIGN_SCOPED, ASSIGN_OP
    destructuring.ts    — DESTRUCTURE_BIND, DESTRUCTURE_DEFAULT, DESTRUCTURE_REST_ARRAY, DESTRUCTURE_REST_OBJECT, ARRAY_PATTERN_INIT, OBJECT_PATTERN_GET
    special.ts          — PUSH_THIS, PUSH_ARGUMENTS, PUSH_NEW_TARGET, PUSH_GLOBAL_THIS, PUSH_WELL_KNOWN_SYMBOL, CREATE_*_ARGS, CREATE_REST_ARGS, TEMPLATE_LITERAL, TAGGED_TEMPLATE, CREATE_RAW_STRINGS
    superinstructions.ts — REG_ADD, REG_SUB, REG_MUL, REG_LT, REG_LTE, REG_GT, REG_GTE, REG_SEQ, REG_SNEQ, REG_LT_CONST_JF, REG_GET_PROP, REG_ADD_CONST, REG_DIV, REG_MOD, REG_CONST_SUB, REG_CONST_MUL, REG_CONST_MOD, REG_LT_REG_JF
    index.ts            — Registry Map<Op, HandlerFn> + barrel exports
  builders/
    interpreter.ts      — buildInterpreter(): assembles HandlerCtx, switch, scaffolding
    loader.ts           — generateLoader() → JsNode[]
    runners.ts          — generateRunners(), generateRouter() → JsNode[]
    globals.ts          — generateGlobalExposure() → JsNode[]
    deserializer.ts     — generateDeserializer() → JsNode[]
    debug-logging.ts    — generateDebugLogging() → JsNode[]
    debug-protection.ts — generateDebugProtection() → JsNode[]
    rolling-cipher.ts   — generateRollingCipherSource() → JsNode[]
    decoder.ts          — generateDecoderSource(), generateStringDecoderSource() → JsNode[]
    fingerprint.ts      — generateFingerprintSource() → JsNode[]
    stack-encoding.ts   — generateStackEncodingProxy() → JsNode[]

packages/ruam/test/ruamvm/
  emit.test.ts          — Comprehensive emitter unit tests
  transforms.test.ts    — Tree transformation unit tests
```

### Modified Files

-   `packages/ruam/src/runtime/vm.ts` — switches from string assembly to AST node assembly + `emit()`

### Deleted After Migration (Step 9)

-   `packages/ruam/src/runtime/templates/` — entire directory (7 files)
-   `generateFingerprintSource()` from `src/runtime/fingerprint.ts`
-   `generateDecoderSource()`, `generateStringDecoderSource()` from `src/runtime/decoder.ts`
-   `generateRollingCipherSource()` from `src/runtime/rolling-cipher.ts`

### Unchanged

-   `packages/ruam/src/runtime/names.ts` — RuntimeNames interface untouched
-   `packages/ruam/src/compiler/` — entirely untouched
-   `packages/ruam/src/transform.ts` — continues using Babel parse/inject on `emit()`'d output string

---

## Chunk 1: Core Infrastructure

### Task 1: AST Node Types and Factory Functions

Create the foundational AST node type system with ~36 node types and factory functions.

**Files:**

-   Create: `packages/ruam/src/ruamvm/nodes.ts`

**Context:** Every subsequent task depends on this. The node types must cover all JS constructs used in the 11 template files. Factory function names are short since they're called thousands of times. The `Raw` node is the escape hatch that allows incremental migration — unconverted templates wrap their output in `raw()` and coexist with converted ones.

-   [ ] **Step 1: Create the ruamvm directory**

```bash
mkdir -p packages/ruam/src/ruamvm/handlers packages/ruam/src/ruamvm/builders
```

-   [ ] **Step 2: Write `nodes.ts` with all node types and factory functions**

```typescript
// packages/ruam/src/ruamvm/nodes.ts
/**
 * JS AST node types and factory functions for runtime code generation.
 *
 * Replaces raw template literal strings with a structured tree representation.
 * Factory function names are intentionally short — they're called thousands of times.
 *
 * @module ruamvm/nodes
 */

// --- Node type discriminants ---

export type JsNode =
	| VarDecl
	| ConstDecl
	| FnDecl
	| ExprStmt
	| Block
	| IfStmt
	| WhileStmt
	| ForStmt
	| ForInStmt
	| SwitchStmt
	| CaseClause
	| BreakStmt
	| ContinueStmt
	| ReturnStmt
	| ThrowStmt
	| TryCatchStmt
	| DebuggerStmt
	| Id
	| Literal
	| BinOp
	| UnaryOp
	| UpdateExpr
	| AssignExpr
	| CallExpr
	| MemberExpr
	| IndexExpr
	| TernaryExpr
	| ArrayExpr
	| ObjectExpr
	| FnExpr
	| ArrowFn
	| NewExpr
	| SequenceExpr
	| AwaitExpr
	| ImportExpr
	| RawNode;

// --- Declarations ---

export interface VarDecl {
	type: "VarDecl";
	name: string;
	init?: JsNode;
}
export interface ConstDecl {
	type: "ConstDecl";
	name: string;
	init?: JsNode;
}
export interface FnDecl {
	type: "FnDecl";
	name: string;
	params: string[];
	body: JsNode[];
	async: boolean;
}

// --- Statements ---

export interface ExprStmt {
	type: "ExprStmt";
	expr: JsNode;
}
export interface Block {
	type: "Block";
	body: JsNode[];
}
export interface IfStmt {
	type: "IfStmt";
	test: JsNode;
	then: JsNode[];
	else?: JsNode[];
}
export interface WhileStmt {
	type: "WhileStmt";
	test: JsNode;
	body: JsNode[];
}
export interface ForStmt {
	type: "ForStmt";
	init: JsNode | null;
	test: JsNode | null;
	update: JsNode | null;
	body: JsNode[];
}
export interface ForInStmt {
	type: "ForInStmt";
	decl: string;
	obj: JsNode;
	body: JsNode[];
}
export interface SwitchStmt {
	type: "SwitchStmt";
	disc: JsNode;
	cases: CaseClause[];
}
export interface CaseClause {
	type: "CaseClause";
	label: JsNode | null;
	body: JsNode[];
}
export interface BreakStmt {
	type: "BreakStmt";
}
export interface ContinueStmt {
	type: "ContinueStmt";
}
export interface ReturnStmt {
	type: "ReturnStmt";
	value?: JsNode;
}
export interface ThrowStmt {
	type: "ThrowStmt";
	value: JsNode;
}
export interface TryCatchStmt {
	type: "TryCatchStmt";
	body: JsNode[];
	param?: string;
	handler?: JsNode[];
	finalizer?: JsNode[];
}
export interface DebuggerStmt {
	type: "DebuggerStmt";
}

// --- Expressions ---

export interface Id {
	type: "Id";
	name: string;
}
export interface Literal {
	type: "Literal";
	value: string | number | boolean | null | RegExp;
}
export interface BinOp {
	type: "BinOp";
	op: string;
	left: JsNode;
	right: JsNode;
}
export interface UnaryOp {
	type: "UnaryOp";
	op: string;
	expr: JsNode;
}
export interface UpdateExpr {
	type: "UpdateExpr";
	op: "++" | "--";
	prefix: boolean;
	arg: JsNode;
}
export interface AssignExpr {
	type: "AssignExpr";
	target: JsNode;
	value: JsNode;
	op?: string;
}
export interface CallExpr {
	type: "CallExpr";
	callee: JsNode;
	args: JsNode[];
}
export interface MemberExpr {
	type: "MemberExpr";
	obj: JsNode;
	prop: string;
}
export interface IndexExpr {
	type: "IndexExpr";
	obj: JsNode;
	index: JsNode;
}
export interface TernaryExpr {
	type: "TernaryExpr";
	test: JsNode;
	then: JsNode;
	else: JsNode;
}
export interface ArrayExpr {
	type: "ArrayExpr";
	elements: JsNode[];
}
export interface ObjectExpr {
	type: "ObjectExpr";
	entries: [string | JsNode, JsNode][];
}
export interface FnExpr {
	type: "FnExpr";
	name?: string;
	params: string[];
	body: JsNode[];
	async: boolean;
}
export interface ArrowFn {
	type: "ArrowFn";
	params: string[];
	body: JsNode[];
	async: boolean;
}
export interface NewExpr {
	type: "NewExpr";
	callee: JsNode;
	args: JsNode[];
}
export interface SequenceExpr {
	type: "SequenceExpr";
	exprs: JsNode[];
}
export interface AwaitExpr {
	type: "AwaitExpr";
	expr: JsNode;
}
export interface ImportExpr {
	type: "ImportExpr";
	specifier: JsNode;
}
export interface RawNode {
	type: "Raw";
	code: string;
}

// --- Factory functions ---

export function fn(
	name: string,
	params: string[],
	body: JsNode[],
	opts?: { async?: boolean }
): FnDecl {
	return { type: "FnDecl", name, params, body, async: opts?.async ?? false };
}

export function varDecl(name: string, init?: JsNode): VarDecl {
	return { type: "VarDecl", name, init };
}

export function constDecl(name: string, init?: JsNode): ConstDecl {
	return { type: "ConstDecl", name, init };
}

export function exprStmt(expr: JsNode): ExprStmt {
	return { type: "ExprStmt", expr };
}

export function block(...body: JsNode[]): Block {
	return { type: "Block", body };
}

export function ifStmt(test: JsNode, then: JsNode[], els?: JsNode[]): IfStmt {
	return { type: "IfStmt", test, then, else: els };
}

export function whileStmt(test: JsNode, body: JsNode[]): WhileStmt {
	return { type: "WhileStmt", test, body };
}

export function forStmt(
	init: JsNode | null,
	test: JsNode | null,
	update: JsNode | null,
	body: JsNode[]
): ForStmt {
	return { type: "ForStmt", init, test, update, body };
}

export function forIn(decl: string, obj: JsNode, body: JsNode[]): ForInStmt {
	return { type: "ForInStmt", decl, obj, body };
}

export function switchStmt(disc: JsNode, cases: CaseClause[]): SwitchStmt {
	return { type: "SwitchStmt", disc, cases };
}

export function caseClause(label: JsNode | null, body: JsNode[]): CaseClause {
	return { type: "CaseClause", label, body };
}

export function breakStmt(): BreakStmt {
	return { type: "BreakStmt" };
}
export function continueStmt(): ContinueStmt {
	return { type: "ContinueStmt" };
}

export function returnStmt(value?: JsNode): ReturnStmt {
	return { type: "ReturnStmt", value };
}

export function throwStmt(value: JsNode): ThrowStmt {
	return { type: "ThrowStmt", value };
}

export function tryCatch(
	body: JsNode[],
	param?: string,
	handler?: JsNode[],
	finalizer?: JsNode[]
): TryCatchStmt {
	return { type: "TryCatchStmt", body, param, handler, finalizer };
}

export function debuggerStmt(): DebuggerStmt {
	return { type: "DebuggerStmt" };
}

export function id(name: string): Id {
	return { type: "Id", name };
}

export function lit(value: string | number | boolean | null | RegExp): Literal {
	return { type: "Literal", value };
}

export function bin(op: string, left: JsNode, right: JsNode): BinOp {
	return { type: "BinOp", op, left, right };
}

export function un(op: string, expr: JsNode): UnaryOp {
	return { type: "UnaryOp", op, expr };
}

export function update(
	op: "++" | "--",
	prefix: boolean,
	arg: JsNode
): UpdateExpr {
	return { type: "UpdateExpr", op, prefix, arg };
}

export function assign(target: JsNode, value: JsNode, op?: string): AssignExpr {
	return { type: "AssignExpr", target, value, op };
}

export function call(callee: JsNode, args: JsNode[]): CallExpr {
	return { type: "CallExpr", callee, args };
}

export function member(obj: JsNode, prop: string): MemberExpr {
	return { type: "MemberExpr", obj, prop };
}

export function index(obj: JsNode, idx: JsNode): IndexExpr {
	return { type: "IndexExpr", obj, index: idx };
}

export function ternary(test: JsNode, then: JsNode, els: JsNode): TernaryExpr {
	return { type: "TernaryExpr", test, then, else: els };
}

export function arr(...elements: JsNode[]): ArrayExpr {
	return { type: "ArrayExpr", elements };
}

export function obj(...entries: [string | JsNode, JsNode][]): ObjectExpr {
	return { type: "ObjectExpr", entries };
}

export function fnExpr(
	name: string | undefined,
	params: string[],
	body: JsNode[],
	opts?: { async?: boolean }
): FnExpr {
	return { type: "FnExpr", name, params, body, async: opts?.async ?? false };
}

export function arrowFn(
	params: string[],
	body: JsNode[],
	opts?: { async?: boolean }
): ArrowFn {
	return { type: "ArrowFn", params, body, async: opts?.async ?? false };
}

export function newExpr(callee: JsNode, args: JsNode[]): NewExpr {
	return { type: "NewExpr", callee, args };
}

export function seq(...exprs: JsNode[]): SequenceExpr {
	return { type: "SequenceExpr", exprs };
}

export function awaitExpr(expr: JsNode): AwaitExpr {
	return { type: "AwaitExpr", expr };
}

export function importExpr(specifier: JsNode): ImportExpr {
	return { type: "ImportExpr", specifier };
}

export function raw(code: string): RawNode {
	return { type: "Raw", code };
}

// --- Convenience ---

export function iife(body: Block): CallExpr {
	return call(fnExpr(undefined, [], body.body), []);
}

export function rest(name: string): string {
	return `...${name}`;
}
```

-   [ ] **Step 3: Verify the file compiles**

Run: `cd packages/ruam && npm run typecheck`
Expected: No errors

-   [ ] **Step 4: Commit**

```bash
git add packages/ruam/src/ruamvm/nodes.ts
git commit -m "feat(ruamvm): add AST node types and factory functions"
```

---

### Task 2: AST Emitter

The recursive `emit()` function that serializes the AST to minified JS.

**Files:**

-   Create: `packages/ruam/src/ruamvm/emit.ts`

**Context:** This is the second most important file. It must produce valid, minified JS for all 36+ node types. Key challenges: precedence-aware parenthesization for binary/unary operators, correct spacing for keyword operators (`in`, `instanceof`, `typeof`), proper string escaping, distinguishing prefix vs postfix update expressions, and compound assignment operators.

Refer to:

-   `packages/ruam/src/ruamvm/nodes.ts` — for all node type definitions
-   `packages/ruam/src/runtime/templates/interpreter.ts:605-1428` — for examples of the JS patterns the emitter must produce

-   [ ] **Step 1: Write `emit.ts` with the recursive emitter**

```typescript
// packages/ruam/src/ruamvm/emit.ts
/**
 * AST → JS source emitter.
 *
 * Single recursive function that serializes JsNode trees to minified JS.
 * Produces compact output with precedence-aware parenthesization.
 *
 * @module ruamvm/emit
 */

import type { JsNode, ReturnStmt } from "./nodes.js";

/** Operator precedence table (higher = tighter binding). */
const PREC: Record<string, number> = {
	",": 1,
	"=": 2,
	"+=": 2,
	"-=": 2,
	"*=": 2,
	"/=": 2,
	"%=": 2,
	"**=": 2,
	"<<=": 2,
	">>=": 2,
	">>>=": 2,
	"&=": 2,
	"|=": 2,
	"^=": 2,
	"&&=": 2,
	"||=": 2,
	"??=": 2,
	"?": 3,
	"||": 4,
	"??": 4,
	"&&": 5,
	"|": 6,
	"^": 7,
	"&": 8,
	"==": 9,
	"!=": 9,
	"===": 9,
	"!==": 9,
	"<": 10,
	">": 10,
	"<=": 10,
	">=": 10,
	in: 10,
	instanceof: 10,
	"<<": 11,
	">>": 11,
	">>>": 11,
	"+": 12,
	"-": 12,
	"*": 13,
	"/": 13,
	"%": 13,
	"**": 14,
};

/** Keyword binary operators that need spaces around them. */
const KEYWORD_BINOP = new Set(["in", "instanceof"]);

/** Keyword unary operators that need a space after them. */
const KEYWORD_UNOP = new Set(["typeof", "void", "delete"]);

function needsParens(
	child: JsNode,
	parentOp: string,
	isRight: boolean
): boolean {
	let cp: number;
	if (child.type === "BinOp") cp = PREC[child.op] ?? 0;
	else if (child.type === "AssignExpr")
		cp = PREC[child.op ? child.op + "=" : "="] ?? 2;
	else if (child.type === "TernaryExpr") cp = PREC["?"] ?? 3;
	else if (child.type === "SequenceExpr") cp = PREC[","] ?? 1;
	else return false;
	const pp = PREC[parentOp] ?? 0;
	if (cp < pp) return true;
	if (cp === pp && isRight) return true;
	return false;
}

/**
 * Serialize a JS AST node to minified source code.
 */
export function emit(node: JsNode): string {
	switch (node.type) {
		// --- Declarations ---
		case "VarDecl":
			return `var ${node.name}${node.init ? "=" + emit(node.init) : ""}`;
		case "ConstDecl":
			return `const ${node.name}${
				node.init ? "=" + emit(node.init) : ""
			}`;
		case "FnDecl":
			return `${node.async ? "async " : ""}function ${
				node.name
			}(${node.params.join(",")}){${emitBody(node.body)}}`;

		// --- Statements ---
		case "ExprStmt":
			return emit(node.expr) + ";";
		case "Block":
			return `{${emitBody(node.body)}}`;
		case "IfStmt":
			return `if(${emit(node.test)}){${emitBody(node.then)}}${
				node.else ? `else{${emitBody(node.else)}}` : ""
			}`;
		case "WhileStmt":
			return `while(${emit(node.test)}){${emitBody(node.body)}}`;
		case "ForStmt":
			return `for(${node.init ? emit(node.init) : ""};${
				node.test ? emit(node.test) : ""
			};${node.update ? emit(node.update) : ""}){${emitBody(node.body)}}`;
		case "ForInStmt":
			return `for(var ${node.decl} in ${emit(node.obj)}){${emitBody(
				node.body
			)}}`;
		case "SwitchStmt":
			return `switch(${emit(node.disc)}){${node.cases
				.map((c) => emit(c))
				.join("")}}`;
		case "CaseClause":
			return node.label === null
				? `default:{${emitBody(node.body)}}`
				: `case ${emit(node.label)}:{${emitBody(node.body)}}`;
		case "BreakStmt":
			return "break;";
		case "ContinueStmt":
			return "continue;";
		case "ReturnStmt":
			return node.value ? `return ${emit(node.value)};` : "return;";
		case "ThrowStmt":
			return `throw ${emit(node.value)};`;
		case "TryCatchStmt": {
			let s = `try{${emitBody(node.body)}}`;
			if (node.handler) {
				s += node.param
					? `catch(${node.param}){${emitBody(node.handler)}}`
					: `catch{${emitBody(node.handler)}}`;
			}
			if (node.finalizer) s += `finally{${emitBody(node.finalizer)}}`;
			return s;
		}
		case "DebuggerStmt":
			return "debugger;";

		// --- Expressions ---
		case "Id":
			return node.name;
		case "Literal":
			return emitLiteral(node.value);
		case "BinOp": {
			const left = needsParens(node.left, node.op, false)
				? `(${emit(node.left)})`
				: emit(node.left);
			const right = needsParens(node.right, node.op, true)
				? `(${emit(node.right)})`
				: emit(node.right);
			if (KEYWORD_BINOP.has(node.op))
				return `${left} ${node.op} ${right}`;
			return `${left}${node.op}${right}`;
		}
		case "UnaryOp":
			if (KEYWORD_UNOP.has(node.op))
				return `${node.op} ${emit(node.expr)}`;
			// Prevent --x from becoming ---x (double minus + negate)
			if (
				node.op === "-" &&
				node.expr.type === "UnaryOp" &&
				node.expr.op === "-"
			)
				return `-(${emit(node.expr)})`;
			return `${node.op}${emit(node.expr)}`;
		case "UpdateExpr":
			return node.prefix
				? `${node.op}${emit(node.arg)}`
				: `${emit(node.arg)}${node.op}`;
		case "AssignExpr":
			return `${emit(node.target)}${node.op ?? ""}=${emit(node.value)}`;
		case "CallExpr": {
			let callee = emit(node.callee);
			// Wrap function/arrow expressions in parens when used as callee (IIFE)
			if (node.callee.type === "FnExpr" || node.callee.type === "ArrowFn")
				callee = `(${callee})`;
			return `${callee}(${node.args.map((a) => emit(a)).join(",")})`;
		}
		case "MemberExpr":
			return `${emitObj(node.obj)}.${node.prop}`;
		case "IndexExpr":
			return `${emitObj(node.obj)}[${emit(node.index)}]`;
		case "TernaryExpr":
			return `${emit(node.test)}?${emit(node.then)}:${emit(node.else)}`;
		case "ArrayExpr":
			return `[${node.elements.map((e) => emit(e)).join(",")}]`;
		case "ObjectExpr":
			return `{${node.entries
				.map(
					([k, v]) =>
						`${typeof k === "string" ? k : `[${emit(k)}]`}:${emit(
							v
						)}`
				)
				.join(",")}}`;
		case "FnExpr":
			return `${node.async ? "async " : ""}function${
				node.name ? " " + node.name : ""
			}(${node.params.join(",")}){${emitBody(node.body)}}`;
		case "ArrowFn": {
			const params =
				node.params.length === 1 &&
				!node.params[0]!.startsWith("...") &&
				!node.async
					? node.params[0]!
					: `(${node.params.join(",")})`;
			let body: string;
			if (
				node.body.length === 1 &&
				node.body[0]!.type === "ReturnStmt" &&
				(node.body[0] as ReturnStmt).value
			) {
				const val = (node.body[0] as ReturnStmt).value!;
				const expr = emit(val);
				body = val.type === "ObjectExpr" ? `(${expr})` : expr;
			} else {
				body = `{${emitBody(node.body)}}`;
			}
			return `${node.async ? "async " : ""}${params}=>${body}`;
		}
		case "NewExpr":
			return `new ${emit(node.callee)}(${node.args
				.map((a) => emit(a))
				.join(",")})`;
		case "SequenceExpr":
			return `(${node.exprs.map((e) => emit(e)).join(",")})`;
		case "AwaitExpr":
			return `await ${emit(node.expr)}`;
		case "ImportExpr":
			return `import(${emit(node.specifier)})`;
		case "Raw":
			return node.code;
	}
}

/** Emit a statement list (body of function, block, etc). */
function emitBody(stmts: JsNode[]): string {
	return stmts.map((s) => emitStmt(s)).join("");
}

/** Emit a single statement — adds semicolons where needed. */
function emitStmt(node: JsNode): string {
	switch (node.type) {
		case "VarDecl":
		case "ConstDecl":
			return emit(node) + ";";
		case "FnDecl":
		case "Block":
		case "IfStmt":
		case "WhileStmt":
		case "ForStmt":
		case "ForInStmt":
		case "SwitchStmt":
		case "TryCatchStmt":
			// These already include their own structure (no trailing semicolon needed)
			return emit(node);
		case "ExprStmt":
		case "BreakStmt":
		case "ContinueStmt":
		case "ReturnStmt":
		case "ThrowStmt":
		case "DebuggerStmt":
			// These already emit with trailing semicolons
			return emit(node);
		case "CaseClause":
			return emit(node);
		default:
			// Expression used as statement — wrap in ExprStmt logic
			return emit(node) + ";";
	}
}

/** Emit an object expression part, wrapping in parens if needed. */
function emitObj(obj: JsNode): string {
	const s = emit(obj);
	// Numeric literals need parens before .prop: (0).toString
	if (obj.type === "Literal" && typeof obj.value === "number")
		return `(${s})`;
	// Call expressions and other low-precedence expressions are fine as-is
	return s;
}

/** Serialize a literal value. */
function emitLiteral(value: string | number | boolean | null | RegExp): string {
	if (value === null) return "null";
	if (value === true) return "true";
	if (value === false) return "false";
	if (typeof value === "number") {
		if (Object.is(value, -0)) return "-0";
		if (value === Infinity) return "Infinity";
		if (value === -Infinity) return "-Infinity";
		if (Number.isNaN(value)) return "NaN";
		return String(value);
	}
	if (typeof value === "string") {
		// Escape and single-quote
		return (
			"'" +
			value
				.replace(/\\/g, "\\\\")
				.replace(/'/g, "\\'")
				.replace(/\n/g, "\\n")
				.replace(/\r/g, "\\r")
				.replace(/\t/g, "\\t") +
			"'"
		);
	}
	if (value instanceof RegExp) return value.toString();
	return String(value);
}
```

-   [ ] **Step 2: Verify the file compiles**

Run: `cd packages/ruam && npm run typecheck`
Expected: No errors

-   [ ] **Step 3: Commit**

```bash
git add packages/ruam/src/ruamvm/emit.ts
git commit -m "feat(ruamvm): add recursive AST-to-JS emitter"
```

---

### Task 3: Emitter Unit Tests

Comprehensive tests for the emitter covering all node types.

**Files:**

-   Create: `packages/ruam/test/ruamvm/emit.test.ts`

**Context:** These tests validate every emit path in isolation before using the emitter for real template generation. They catch issues like missing semicolons, incorrect operator spacing, wrong precedence-driven parenthesization, and string escaping bugs that would otherwise show up as mysterious runtime failures.

-   [ ] **Step 1: Write emitter tests**

```typescript
// packages/ruam/test/ruamvm/emit.test.ts
import { describe, it, expect } from "vitest";
import { emit } from "../../src/ruamvm/emit.js";
import {
	fn,
	varDecl,
	constDecl,
	exprStmt,
	block,
	ifStmt,
	whileStmt,
	forStmt,
	forIn,
	switchStmt,
	caseClause,
	breakStmt,
	continueStmt,
	returnStmt,
	throwStmt,
	tryCatch,
	debuggerStmt,
	id,
	lit,
	bin,
	un,
	update,
	assign,
	call,
	member,
	index,
	ternary,
	arr,
	obj,
	fnExpr,
	arrowFn,
	newExpr,
	seq,
	awaitExpr,
	importExpr,
	raw,
	iife,
	rest,
} from "../../src/ruamvm/nodes.js";

describe("Emitter", () => {
	describe("declarations", () => {
		it("var without init", () => {
			expect(emit(varDecl("x"))).toBe("var x");
		});
		it("var with init", () => {
			expect(emit(varDecl("x", lit(0)))).toBe("var x=0");
		});
		it("const with init", () => {
			expect(emit(constDecl("PI", lit(3.14)))).toBe("const PI=3.14");
		});
		it("function declaration", () => {
			expect(
				emit(
					fn(
						"foo",
						["a", "b"],
						[returnStmt(bin("+", id("a"), id("b")))]
					)
				)
			).toBe("function foo(a,b){return a+b;}");
		});
		it("async function declaration", () => {
			expect(
				emit(
					fn("bar", [], [returnStmt(awaitExpr(id("x")))], {
						async: true,
					})
				)
			).toBe("async function bar(){return await x;}");
		});
		it("rest param", () => {
			expect(
				emit(fn("f", [rest("args")], [returnStmt(id("args"))]))
			).toBe("function f(...args){return args;}");
		});
	});

	describe("statements", () => {
		it("expression statement", () => {
			expect(emit(exprStmt(call(id("f"), [])))).toBe("f();");
		});
		it("block", () => {
			expect(emit(block(exprStmt(id("a"))))).toBe("{a;}");
		});
		it("if/else", () => {
			expect(
				emit(
					ifStmt(id("x"), [returnStmt(lit(1))], [returnStmt(lit(2))])
				)
			).toBe("if(x){return 1;}else{return 2;}");
		});
		it("if without else", () => {
			expect(emit(ifStmt(id("x"), [breakStmt()]))).toBe("if(x){break;}");
		});
		it("while loop", () => {
			expect(emit(whileStmt(lit(true), [breakStmt()]))).toBe(
				"while(true){break;}"
			);
		});
		it("for loop", () => {
			expect(
				emit(
					forStmt(
						varDecl("i", lit(0)),
						bin("<", id("i"), lit(10)),
						update("++", false, id("i")),
						[exprStmt(call(id("f"), [id("i")]))]
					)
				)
			).toBe("for(var i=0;i<10;i++){f(i);}");
		});
		it("for-in", () => {
			expect(
				emit(
					forIn("k", id("obj"), [exprStmt(call(id("f"), [id("k")]))])
				)
			).toBe("for(var k in obj){f(k);}");
		});
		it("switch", () => {
			expect(
				emit(
					switchStmt(id("x"), [
						caseClause(lit(1), [breakStmt()]),
						caseClause(null, [breakStmt()]),
					])
				)
			).toBe("switch(x){case 1:{break;}default:{break;}}");
		});
		it("return void", () => {
			expect(emit(returnStmt())).toBe("return;");
		});
		it("throw", () => {
			expect(emit(throwStmt(newExpr(id("Error"), [lit("fail")])))).toBe(
				"throw new Error('fail');"
			);
		});
		it("try/catch", () => {
			expect(
				emit(tryCatch([exprStmt(id("a"))], "e", [exprStmt(id("b"))]))
			).toBe("try{a;}catch(e){b;}");
		});
		it("try/catch/finally", () => {
			expect(
				emit(
					tryCatch(
						[exprStmt(id("a"))],
						"e",
						[exprStmt(id("b"))],
						[exprStmt(id("c"))]
					)
				)
			).toBe("try{a;}catch(e){b;}finally{c;}");
		});
		it("try/finally (no catch)", () => {
			expect(
				emit(
					tryCatch([exprStmt(id("a"))], undefined, undefined, [
						exprStmt(id("c")),
					])
				)
			).toBe("try{a;}finally{c;}");
		});
		it("debugger", () => {
			expect(emit(debuggerStmt())).toBe("debugger;");
		});
	});

	describe("expressions", () => {
		it("identifier", () => {
			expect(emit(id("foo"))).toBe("foo");
		});
		it("string literal", () => {
			expect(emit(lit("hello"))).toBe("'hello'");
		});
		it("string with escapes", () => {
			expect(emit(lit('it\'s a "test"\n'))).toBe(
				"'it\\'s a \"test\"\\n'"
			);
		});
		it("number literal", () => {
			expect(emit(lit(42))).toBe("42");
		});
		it("negative number", () => {
			expect(emit(lit(-1))).toBe("-1");
		});
		it("boolean literals", () => {
			expect(emit(lit(true))).toBe("true");
			expect(emit(lit(false))).toBe("false");
		});
		it("null literal", () => {
			expect(emit(lit(null))).toBe("null");
		});
		it("regex literal", () => {
			expect(emit(lit(/abc/gi))).toBe("/abc/gi");
		});
		it("binary operator", () => {
			expect(emit(bin("+", id("a"), id("b")))).toBe("a+b");
		});
		it("keyword binary (in)", () => {
			expect(emit(bin("in", id("a"), id("b")))).toBe("a in b");
		});
		it("keyword binary (instanceof)", () => {
			expect(emit(bin("instanceof", id("a"), id("B")))).toBe(
				"a instanceof B"
			);
		});
		it("precedence: a+b*c", () => {
			expect(emit(bin("+", id("a"), bin("*", id("b"), id("c"))))).toBe(
				"a+b*c"
			);
		});
		it("precedence: (a+b)*c", () => {
			expect(emit(bin("*", bin("+", id("a"), id("b")), id("c")))).toBe(
				"(a+b)*c"
			);
		});
		it("unary !", () => {
			expect(emit(un("!", id("x")))).toBe("!x");
		});
		it("unary typeof", () => {
			expect(emit(un("typeof", id("x")))).toBe("typeof x");
		});
		it("unary delete", () => {
			expect(emit(un("delete", member(id("o"), "k")))).toBe("delete o.k");
		});
		it("prefix ++", () => {
			expect(emit(update("++", true, id("x")))).toBe("++x");
		});
		it("postfix ++", () => {
			expect(emit(update("++", false, id("x")))).toBe("x++");
		});
		it("prefix --", () => {
			expect(emit(update("--", true, id("x")))).toBe("--x");
		});
		it("simple assign", () => {
			expect(emit(assign(id("x"), lit(1)))).toBe("x=1");
		});
		it("compound assign +=", () => {
			expect(emit(assign(id("x"), lit(1), "+"))).toBe("x+=1");
		});
		it("compound assign >>>=", () => {
			expect(emit(assign(id("x"), lit(16), ">>>"))).toBe("x>>>=16");
		});
		it("function call", () => {
			expect(emit(call(id("f"), [id("a"), id("b")]))).toBe("f(a,b)");
		});
		it("method call", () => {
			expect(emit(call(member(id("o"), "m"), []))).toBe("o.m()");
		});
		it("member access", () => {
			expect(emit(member(id("obj"), "prop"))).toBe("obj.prop");
		});
		it("index access", () => {
			expect(emit(index(id("arr"), lit(0)))).toBe("arr[0]");
		});
		it("ternary", () => {
			expect(emit(ternary(id("x"), lit(1), lit(2)))).toBe("x?1:2");
		});
		it("array", () => {
			expect(emit(arr(lit(1), lit(2), lit(3)))).toBe("[1,2,3]");
		});
		it("object", () => {
			expect(emit(obj(["a", lit(1)], ["b", lit(2)]))).toBe("{a:1,b:2}");
		});
		it("object with computed key", () => {
			expect(emit(obj([id("k"), lit(1)]))).toBe("{[k]:1}");
		});
		it("function expression", () => {
			expect(emit(fnExpr(undefined, ["x"], [returnStmt(id("x"))]))).toBe(
				"function(x){return x;}"
			);
		});
		it("named function expression", () => {
			expect(emit(fnExpr("f", [], []))).toBe("function f(){}");
		});
		it("async function expression", () => {
			expect(emit(fnExpr(undefined, [], [], { async: true }))).toBe(
				"async function(){}"
			);
		});
		it("arrow function (single param)", () => {
			expect(emit(arrowFn(["x"], [returnStmt(id("x"))]))).toBe("x=>x");
		});
		it("arrow function (multi param)", () => {
			expect(
				emit(
					arrowFn(
						["a", "b"],
						[returnStmt(bin("+", id("a"), id("b")))]
					)
				)
			).toBe("(a,b)=>a+b");
		});
		it("arrow function (body)", () => {
			expect(
				emit(
					arrowFn(
						["x"],
						[
							exprStmt(call(id("f"), [id("x")])),
							returnStmt(id("x")),
						]
					)
				)
			).toBe("(x)=>{f(x);return x;}");
		});
		it("arrow function (rest param)", () => {
			expect(emit(arrowFn([rest("a")], [returnStmt(id("a"))]))).toBe(
				"(...a)=>a"
			);
		});
		it("async arrow", () => {
			expect(
				emit(
					arrowFn(["x"], [returnStmt(awaitExpr(id("x")))], {
						async: true,
					})
				)
			).toBe("async (x)=>await x");
		});
		it("new expression", () => {
			expect(emit(newExpr(id("Foo"), [lit(1)]))).toBe("new Foo(1)");
		});
		it("sequence", () => {
			expect(emit(seq(id("a"), id("b"), id("c")))).toBe("(a,b,c)");
		});
		it("await", () => {
			expect(emit(awaitExpr(id("p")))).toBe("await p");
		});
		it("import()", () => {
			expect(emit(importExpr(lit("./mod")))).toBe("import('./mod')");
		});
		it("raw", () => {
			expect(emit(raw("x=1+2"))).toBe("x=1+2");
		});
	});

	describe("convenience", () => {
		it("IIFE", () => {
			expect(emit(iife(block(exprStmt(id("x")))))).toBe(
				"(function(){x;})()"
			);
		});
	});

	describe("nested structures", () => {
		it("nested member + index + call", () => {
			expect(
				emit(call(index(member(id("obj"), "arr"), lit(0)), [id("x")]))
			).toBe("obj.arr[0](x)");
		});
		it("assignment to index", () => {
			expect(
				emit(
					assign(index(id("S"), update("++", true, id("P"))), id("v"))
				)
			).toBe("S[++P]=v");
		});
		it("complex ternary with calls", () => {
			expect(
				emit(
					ternary(
						call(id("test"), []),
						call(id("a"), []),
						call(id("b"), [])
					)
				)
			).toBe("test()?a():b()");
		});
	});
});
```

-   [ ] **Step 2: Run the emitter tests**

Run: `cd packages/ruam && npx vitest run test/ruamvm/emit.test.ts`
Expected: All tests pass

-   [ ] **Step 3: Commit**

```bash
git add packages/ruam/test/ruamvm/emit.test.ts
git commit -m "test(ruamvm): add comprehensive emitter unit tests"
```

---

### Task 4: HandlerCtx Type and Builder Helpers

Define the `HandlerCtx` interface and helper function to construct it from `RuntimeNames`.

**Files:**

-   Create: `packages/ruam/src/ruamvm/handlers/index.ts`

**Context:** `HandlerCtx` is the "context object" passed to every opcode handler function. It contains ~35 string fields (the randomized variable names from `RuntimeNames`) plus `isAsync` and `debug` boolean flags. Handlers use these fields to construct AST nodes with the correct obfuscated names. The handler registry maps `Op` enum values to handler functions.

Refer to:

-   `packages/ruam/src/runtime/names.ts:17-116` — RuntimeNames interface (all field names)
-   `packages/ruam/src/runtime/templates/interpreter.ts:425-461` — how names map to template variables

-   [ ] **Step 1: Write the handler index with HandlerCtx and registry**

```typescript
// packages/ruam/src/ruamvm/handlers/index.ts
/**
 * Opcode handler registry and context type.
 *
 * Every opcode handler is a function that takes a HandlerCtx and returns
 * JsNode[] (the case body). The registry maps Op enum values to handlers.
 *
 * @module ruamvm/handlers
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../runtime/names.js";
import type { Op } from "../../compiler/opcodes.js";

/**
 * Context passed to every opcode handler.
 * Contains obfuscated variable names and feature flags.
 */
export interface HandlerCtx {
	// Stack machine
	S: string; // stack array
	P: string; // stack pointer
	W: string; // push function (pre-inline)
	X: string; // pop function (pre-inline)
	Y: string; // peek function (pre-inline)

	// Interpreter state
	IP: string; // instruction pointer
	C: string; // constants array
	O: string; // operand
	SC: string; // scope
	R: string; // registers
	EX: string; // exception handler stack
	PE: string; // pending exception
	HPE: string; // has pending exception
	CT: string; // completion type
	CV: string; // completion value
	PH: string; // physical opcode variable

	// Function parameters
	U: string; // unit parameter
	A: string; // args parameter
	OS: string; // outerScope parameter
	TV: string; // thisVal parameter
	NT: string; // newTarget parameter
	HO: string; // homeObject parameter

	// Scope property names
	sPar: string; // scope.parent
	sV: string; // scope.vars
	sTdz: string; // scope.tdzVars

	// Infrastructure references
	exec: string; // sync exec function name
	execAsync: string; // async exec function name
	load: string; // loader function name
	depth: string; // recursion depth counter
	callStack: string; // call stack for error messages
	dbg: string; // debug log function name
	fSlots: string; // function slots array name

	// Flags
	isAsync: boolean; // true when building async interpreter variant
	debug: boolean; // true when debug logging is enabled
}

/** A handler function returns the case body as AST nodes. */
export type HandlerFn = (ctx: HandlerCtx) => JsNode[];

/** The handler registry: maps logical opcode to handler function. */
export const registry = new Map<Op, HandlerFn>();

/**
 * Build a HandlerCtx from RuntimeNames and flags.
 */
export function makeHandlerCtx(
	names: RuntimeNames,
	isAsync: boolean,
	debug: boolean
): HandlerCtx {
	return {
		S: names.stk,
		P: names.stp,
		W: names.sPush,
		X: names.sPop,
		Y: names.sPeek,
		IP: names.ip,
		C: names.cArr,
		O: names.operand,
		SC: names.scope,
		R: names.regs,
		EX: names.exStk,
		PE: names.pEx,
		HPE: names.hPEx,
		CT: names.cType,
		CV: names.cVal,
		PH: names.phys,
		U: names.unit,
		A: names.args,
		OS: names.outer,
		TV: names.tVal,
		NT: names.nTgt,
		HO: names.ho,
		sPar: names.sPar,
		sV: names.sVars,
		sTdz: names.sTdz,
		exec: names.exec,
		execAsync: names.execAsync,
		load: names.load,
		depth: names.depth,
		callStack: names.callStack,
		dbg: names.dbg,
		fSlots: names.fSlots,
		isAsync,
		debug,
	};
}
```

-   [ ] **Step 2: Verify it compiles**

Run: `cd packages/ruam && npm run typecheck`
Expected: No errors

-   [ ] **Step 3: Commit**

```bash
git add packages/ruam/src/ruamvm/handlers/index.ts
git commit -m "feat(ruamvm): add HandlerCtx type and handler registry"
```

---

## Chunk 2: Simple Opcode Handlers

### Task 5: Stack Manipulation Handlers

Extract the ~20 stack manipulation opcode handlers into a dedicated file.

**Files:**

-   Create: `packages/ruam/src/ruamvm/handlers/stack.ts`
-   Modify: `packages/ruam/src/ruamvm/handlers/index.ts` — import and register

**Context:** These are the simplest handlers (most are single-expression). They operate directly on the stack (S) and stack pointer (P). The W/X/Y helpers are used pre-inlining; the tree transform will replace them later.

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:605-632` for the original template strings.

-   [ ] **Step 1: Write the stack handlers**

Each handler returns `JsNode[]` — the body of the `case` clause. Handlers should use the `W(expr)` pattern via `call(id(ctx.W), [expr])` since the inlineStackOps transform will rewrite these to direct `S[++P]=expr` later.

The file should export individual handler functions and register them in the registry:

```typescript
// packages/ruam/src/ruamvm/handlers/stack.ts
import { Op } from "../../compiler/opcodes.js";
import {
	id,
	call,
	lit,
	index,
	bin,
	assign,
	update,
	raw,
	breakStmt,
} from "../nodes.js";
import type { HandlerCtx, HandlerFn } from "./index.js";
import { registry } from "./index.js";

function PUSH_CONST(ctx: HandlerCtx) {
	/* return [call W with C[O], breakStmt()] */
}
function PUSH_UNDEFINED(ctx: HandlerCtx) {
	/* W(void 0) */
}
// ... etc for all PUSH_*, POP, POP_N, DUP, DUP2, SWAP, ROT3, ROT4, PICK
```

Pattern for each handler — translate the template literal `case ${Op.X}:...break;` into factory calls:

-   `${W}(${C}[${O}])` → `call(id(ctx.W), [index(id(ctx.C), id(ctx.O))])`
-   `${S}[${P}]` → `index(id(ctx.S), id(ctx.P))`
-   `${P}--` → `update('--', false, id(ctx.P))`
-   `${S}[++${P}]` → `index(id(ctx.S), update('++', true, id(ctx.P)))`
-   `var _a=...` → `varDecl('_a', ...)`

Every handler ends with `breakStmt()` in the returned array.

-   [ ] **Step 2: Register in index.ts**

Add `import './stack.js';` to `handlers/index.ts` so the side-effect registration runs.

-   [ ] **Step 3: Verify compilation**

Run: `cd packages/ruam && npm run typecheck`

-   [ ] **Step 4: Commit**

```bash
git add packages/ruam/src/ruamvm/handlers/stack.ts packages/ruam/src/ruamvm/handlers/index.ts
git commit -m "feat(ruamvm): extract stack manipulation opcode handlers"
```

---

### Task 6: Arithmetic and Bitwise Handlers

**Files:**

-   Create: `packages/ruam/src/ruamvm/handlers/arithmetic.ts`

**Context:** Binary ops follow a consistent pattern: `{var b=S[P--];S[P]=S[P]+b;break;}`. Unary ops: `S[P]=-S[P];break;`. The `INC`/`DEC` use `+S[P]+1` (unary plus for ToNumber coercion).

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:643-660`

-   [ ] **Step 1: Write arithmetic/bitwise handlers**

Covers: ADD, SUB, MUL, DIV, MOD, POW, NEG, UNARY_PLUS, INC, DEC, BIT_AND, BIT_OR, BIT_XOR, BIT_NOT, SHL, SHR, USHR.

-   [ ] **Step 2: Register and compile**
-   [ ] **Step 3: Commit**

---

### Task 7: Comparison and Logical Handlers

**Files:**

-   Create: `packages/ruam/src/ruamvm/handlers/comparison.ts`
-   Create: `packages/ruam/src/ruamvm/handlers/logical.ts`

**Context:** Comparison follows the binary pattern. Logical (AND/OR/NULLISH_COALESCE) have branching — they conditionally set `IP=O*2` or pop. NOT is a simple unary.

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:662-681` (comparisons), `662-671` (logical)

-   [ ] **Step 1: Write comparison handlers** (EQ, NEQ, SEQ, SNEQ, LT, LTE, GT, GTE)
-   [ ] **Step 2: Write logical handlers** (NOT, LOGICAL_AND, LOGICAL_OR, NULLISH_COALESCE)
-   [ ] **Step 3: Register, compile, commit**

---

### Task 8: Control Flow Handlers

**Files:**

-   Create: `packages/ruam/src/ruamvm/handlers/control-flow.ts`

**Context:** JMP/JMP_TRUE/JMP_FALSE set `IP=O*2`. RETURN/RETURN_VOID have complex exception-handler and finally logic. THROW is simple. These handlers have debug branching via `ctx.debug`.

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:682-709`

-   [ ] **Step 1: Write control-flow handlers** (JMP, JMP_TRUE, JMP_FALSE, JMP_NULLISH, JMP_UNDEFINED, JMP_TRUE_KEEP, JMP_FALSE_KEEP, JMP_NULLISH_KEEP, RETURN, RETURN_VOID, THROW, RETHROW, NOP, TABLE_SWITCH, LOOKUP_SWITCH)
-   [ ] **Step 2: Register, compile, commit**

---

### Task 9: Register and Argument Handlers

**Files:**

-   Create: `packages/ruam/src/ruamvm/handlers/registers.ts`

**Context:** Simple load/store to register array R[O] or args A[O]. The compound ops (INC*REG, POST_INC_REG, \*\_ASSIGN_REG) are straightforward. FAST*\* are inlined versions.

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:634-641, 1294-1322`

-   [ ] **Step 1: Write register handlers** (LOAD_REG, STORE_REG, LOAD_ARG, STORE_ARG, LOAD_ARG_OR_DEFAULT, GET_ARG_COUNT, INC_REG, DEC_REG, POST_INC_REG, POST_DEC_REG, \*\_ASSIGN_REG, FAST_ADD_CONST, FAST_SUB_CONST, FAST_GET_PROP, LOAD_GLOBAL_FAST)
-   [ ] **Step 2: Register, compile, commit**

---

### Task 10: Type Operations and Special Handlers

**Files:**

-   Create: `packages/ruam/src/ruamvm/handlers/type-ops.ts`
-   Create: `packages/ruam/src/ruamvm/handlers/special.ts`

**Context:** Type ops convert stack values. Special handlers push `this`, `arguments`, etc. PUSH_WELL_KNOWN_SYMBOL has a long array literal.

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:1080-1089, 1210-1219, 1324-1369`

-   [ ] **Step 1: Write type-ops and special handlers**
-   [ ] **Step 2: Register, compile, commit**

---

### Task 11: Destructuring Handlers

**Files:**

-   Create: `packages/ruam/src/ruamvm/handlers/destructuring.ts`

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:1343-1361`

-   [ ] **Step 1: Write destructuring handlers** (DESTRUCTURE_BIND, DESTRUCTURE_DEFAULT, DESTRUCTURE_REST_ARRAY, DESTRUCTURE_REST_OBJECT, ARRAY_PATTERN_INIT, OBJECT_PATTERN_GET)
-   [ ] **Step 2: Register, compile, commit**

---

### Task 12: Superinstruction Handlers

**Files:**

-   Create: `packages/ruam/src/ruamvm/handlers/superinstructions.ts`

**Context:** These use bit-packing with `O&0xFFFF` and `(O>>>16)&0xFFFF` to extract operands. REG_LT_CONST_JF and REG_LT_REG_JF use 3-way packing with 8-bit and 16-bit fields.

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:1371-1424`

-   [ ] **Step 1: Write superinstruction handlers** (REG_ADD through REG_LT_REG_JF)
-   [ ] **Step 2: Register, compile, commit**

---

## Chunk 3: Complex Opcode Handlers

### Task 13: Scope and Variable Handlers

**Files:**

-   Create: `packages/ruam/src/ruamvm/handlers/scope.ts`

**Context:** LOAD_SCOPED/STORE_SCOPED have scope-chain walking loops. TYPEOF_GLOBAL also walks scope. TDZ_CHECK/TDZ_MARK handle temporal dead zone. These handlers need careful AST construction for nested while loops and property access patterns like `SC.sPar`, `s.sV[name]`.

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:756-807`

-   [ ] **Step 1: Write scope handlers** (LOAD_SCOPED, STORE_SCOPED, DECLARE_VAR, DECLARE_LET, DECLARE_CONST, PUSH_SCOPE, PUSH_BLOCK_SCOPE, PUSH_CATCH_SCOPE, POP_SCOPE, TDZ_CHECK, TDZ_MARK, PUSH_WITH_SCOPE, DELETE_SCOPED, LOAD_GLOBAL, STORE_GLOBAL, TYPEOF_GLOBAL)
-   [ ] **Step 2: Register, compile, commit**

---

### Task 14: Compound Scoped Operation Handlers

**Files:**

-   Create: `packages/ruam/src/ruamvm/handlers/compound-scoped.ts`

**Context:** These are highly repetitive — each one walks the scope chain and applies an operator. There are 15+ variants for different assignment operators.

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:1236-1293`

-   [ ] **Step 1: Write compound-scoped handlers**

Use a helper function to reduce repetition:

```typescript
function compoundScoped(ctx: HandlerCtx, op: string): JsNode[] {
	/* scope walk + compound assign */
}
```

Register INC_SCOPED, DEC_SCOPED, POST_INC_SCOPED, POST_DEC_SCOPED, ADD_ASSIGN_SCOPED, SUB_ASSIGN_SCOPED, MUL_ASSIGN_SCOPED, DIV_ASSIGN_SCOPED, MOD_ASSIGN_SCOPED, POW_ASSIGN_SCOPED, BIT_AND/OR/XOR_ASSIGN_SCOPED, SHL/SHR/USHR_ASSIGN_SCOPED, AND/OR/NULLISH_ASSIGN_SCOPED, ASSIGN_OP.

-   [ ] **Step 2: Register, compile, commit**

---

### Task 15: Object and Property Handlers

**Files:**

-   Create: `packages/ruam/src/ruamvm/handlers/objects.ts`

**Context:** Covers property access (static/dynamic/optional-chain), object construction, array operations, spread, proto manipulation. GET_SUPER_PROP/SET_SUPER_PROP have complex HomeObject resolution.

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:711-956`

-   [ ] **Step 1: Write object handlers** (all GET*PROP*_, SET*PROP*_, DELETE*PROP*_, OPT*CHAIN*_, IN_OP, INSTANCEOF, GET_SUPER_PROP, SET_SUPER_PROP, GET/SET/HAS_PRIVATE_FIELD, DEFINE_OWN_PROPERTY, NEW_OBJECT, NEW_ARRAY, NEW_ARRAY_WITH_SIZE, ARRAY_PUSH, ARRAY_HOLE, SPREAD_ARRAY, SPREAD_OBJECT, COPY_DATA_PROPERTIES, SET_PROTO, FREEZE_OBJECT, SEAL_OBJECT, DEFINE_PROPERTY_DESC, CREATE_TEMPLATE_OBJECT)
-   [ ] **Step 2: Register, compile, commit**

---

### Task 16: Call and Construct Handlers

**Files:**

-   Create: `packages/ruam/src/ruamvm/handlers/calls.ts`

**Context:** CALL/CALL_METHOD have spread-argument flattening logic and debug branching. SUPER_CALL uses HomeObject. CALL_0/1/2/3 are fast-path variants.

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:811-918`

-   [ ] **Step 1: Write call handlers**

CALL and CALL_METHOD have the most complex bodies due to spread argument handling. Use `raw()` for the spread-flattening loop initially if needed, converting to full AST later.

-   [ ] **Step 2: Register, compile, commit**

---

### Task 17: Class Handlers

**Files:**

-   Create: `packages/ruam/src/ruamvm/handlers/classes.ts`

**Context:** NEW_CLASS/NEW_DERIVED_CLASS use IIFEs with `__setCtor`. DEFINE_METHOD/GETTER/SETTER stamp `fn._ho` (HomeObject). EXTEND_CLASS sets up prototype chain.

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:958-1042`

-   [ ] **Step 1: Write class handlers**

NEW_CLASS and NEW_DERIVED_CLASS are the most complex due to the IIFE pattern. These should use `raw()` for the IIFE initially and be converted to full AST later.

-   [ ] **Step 2: Register, compile, commit**

---

### Task 18: Exception Handlers

**Files:**

-   Create: `packages/ruam/src/ruamvm/handlers/exceptions.ts`

**Context:** TRY_PUSH packs catch/finally IPs into a single operand. END_FINALLY checks completion type for deferred returns.

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:1091-1117, 1172-1182`

-   [ ] **Step 1: Write exception handlers** (TRY_PUSH, TRY_POP, CATCH_BIND, FINALLY_MARK, END_FINALLY, CATCH_BIND_PATTERN, THROW_IF_NOT_OBJECT, THROW_REF_ERROR, THROW_TYPE_ERROR, THROW_SYNTAX_ERROR)
-   [ ] **Step 2: Register, compile, commit**

---

### Task 19: Iterator Handlers (Sync and Async)

**Files:**

-   Create: `packages/ruam/src/ruamvm/handlers/iterators.ts`

**Context:** Async iterators differ based on `ctx.isAsync` — the async version uses `await iter.next()`. FOR_AWAIT_NEXT also has this branching.

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:1119-1156, 1184-1208`

-   [ ] **Step 1: Write iterator handlers**
-   [ ] **Step 2: Register, compile, commit**

---

### Task 20: Generator/Async Handlers

**Files:**

-   Create: `packages/ruam/src/ruamvm/handlers/generators.ts`

**Context:** AWAIT differs by `isAsync` flag. Most generator handlers are stubs (break only).

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:1158-1170`

-   [ ] **Step 1: Write generator handlers** (YIELD, YIELD*DELEGATE, AWAIT, CREATE_GENERATOR, GENERATOR_RESUME/RETURN/THROW, SUSPEND, RESUME, ASYNC_GENERATOR*\*)
-   [ ] **Step 2: Register, compile, commit**

---

### Task 21: Function and Closure Handlers

**Files:**

-   Create: `packages/ruam/src/ruamvm/handlers/functions.ts`

**Context:** **This is the most complex handler file.** NEW_CLOSURE and NEW_FUNCTION have ~50+ lines each in the template, with nested IIFEs, async/sync branching, arrow vs regular, this-boxing, HomeObject forwarding, and debug tracing. NEW_ARROW, NEW_ASYNC, NEW_GENERATOR are simpler but still have IIFEs.

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:477-1078` (closure handler variable, plus the handler bodies)

**IMPORTANT:** Per the spec, using `raw()` for NEW_CLOSURE and NEW_FUNCTION is an acceptable pragmatic choice during initial migration. Converting them to full AST later is a separate effort.

-   [ ] **Step 1: Write function handlers**

For NEW_CLOSURE, NEW_FUNCTION: use `raw()` to emit the same template literal output. This preserves exact behavioral equivalence while moving the registration into the handler system.

For simpler handlers (NEW_ARROW, NEW_ASYNC, NEW_GENERATOR, SET_FUNC_NAME, SET_FUNC_LENGTH, BIND_THIS, MAKE_METHOD, PUSH_CLOSURE_VAR, STORE_CLOSURE_VAR): convert to full AST.

-   [ ] **Step 2: Register, compile, commit**

---

## Chunk 4: Interpreter Builder and Transforms

### Task 22: Interpreter Builder

Assembles the interpreter function from the handler registry.

**Files:**

-   Create: `packages/ruam/src/ruamvm/builders/interpreter.ts`

**Context:** This file replaces `generateExecBody()` from the old interpreter.ts. It constructs a `HandlerCtx`, iterates the registry to build switch cases, applies the shuffleMap to case labels (during construction, not as a regex post-pass), and wraps everything in the interpreter function with its scaffolding (var declarations, dispatch loop, try/catch exception handling).

Refer to:

-   `packages/ruam/src/runtime/templates/interpreter.ts:416-470` — variable declarations
-   `packages/ruam/src/runtime/templates/interpreter.ts:561-604` — interpreter scaffold (function signature, depth tracking, rolling cipher init, stack encoding, dispatch loop start)
-   `packages/ruam/src/runtime/templates/interpreter.ts:1430-1470` — exception handler and finally block
-   `packages/ruam/src/ruamvm/handlers/index.ts` — registry and HandlerCtx

-   [ ] **Step 1: Write `builders/interpreter.ts`**

```typescript
// packages/ruam/src/ruamvm/builders/interpreter.ts
import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../runtime/names.js";
import type { InterpreterOptions } from "../../runtime/templates/interpreter.js";
import {
	fn,
	varDecl,
	id,
	lit,
	raw,
	switchStmt,
	caseClause,
	breakStmt,
	block,
} from "../nodes.js";
import { registry, makeHandlerCtx } from "../handlers/index.js";
import { emit } from "../emit.js";

export function buildInterpreter(
	names: RuntimeNames,
	shuffleMap: number[],
	opts: {
		isAsync: boolean;
		debug: boolean;
		rollingCipher: boolean;
		integrityBinding: boolean;
		interpOpts: InterpreterOptions;
	}
): JsNode {
	const ctx = makeHandlerCtx(names, opts.isAsync, opts.debug);

	// Build switch cases from registry
	const cases: JsNode[] = [];
	for (const [op, handler] of registry) {
		if (
			opts.interpOpts.dynamicOpcodes &&
			opts.interpOpts.usedOpcodes &&
			!opts.interpOpts.usedOpcodes.has(op)
		)
			continue;
		cases.push(caseClause(lit(shuffleMap[op]!), handler(ctx)));
	}

	// Decoy handlers
	if (opts.interpOpts.decoyOpcodes && opts.interpOpts.usedOpcodes) {
		// Generate decoy cases for unused opcodes
		cases.push(
			...generateDecoyHandlers(
				ctx,
				shuffleMap,
				opts.interpOpts.usedOpcodes
			)
		);
	}

	// Default case
	cases.push(caseClause(null, [breakStmt()]));

	// Build the full interpreter function body as raw() initially,
	// wrapping the switch in the scaffolding (var declarations, dispatch loop,
	// try/catch, depth tracking, rolling cipher init, etc.)
	// The switch itself uses AST-built cases; the scaffolding uses raw()
	// for the first migration pass and can be converted to full AST later.
	const switchNode = switchStmt(id(ctx.PH), cases);

	// For initial migration, emit the switch to a string and inject it
	// into the raw scaffolding template. This allows the old scaffolding
	// code to remain unchanged while the handlers are AST-based.
	return raw(buildScaffold(names, opts, emit(switchNode)));
}
```

The `buildScaffold` function replicates the interpreter function wrapper from the old `generateExecBody()` but splices in the AST-generated switch string instead of the inline template literal.

-   [ ] **Step 2: Compile and commit**

---

### Task 23: Tree Transforms — inlineStackOps

Replace the regex-based `inlineStackOps()` with a structural tree visitor.

**Files:**

-   Create: `packages/ruam/src/ruamvm/transforms.ts`

**Context:** The old regex version does paren-counting string replacement of `W(expr)` → `S[++P]=expr`. The AST version pattern-matches `CallExpr(Id(W), [expr])` → `AssignExpr(IndexExpr(Id(S), UpdateExpr('++', true, Id(P))), expr)`. It also removes the W/X/Y function declarations from the tree.

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:303-360` — old regex implementation

-   [ ] **Step 1: Write `transforms.ts` with inlineStackOps**

```typescript
// packages/ruam/src/ruamvm/transforms.ts
import type { JsNode } from "./nodes.js";

/**
 * Walk a JsNode tree, replacing nodes via a visitor function.
 * Returns a new tree (does not mutate the original).
 */
function walk(node: JsNode, visitor: (n: JsNode) => JsNode | null): JsNode {
	// visitor returns null to keep original, or a replacement node
	// Recursively walk all child nodes first, then apply visitor
	// ... implementation for each node type ...
}

/**
 * Inline stack operations: replace W(expr) → S[++P]=expr, X() → S[P--], Y() → S[P].
 * Also removes the W/X/Y function declarations.
 */
export function inlineStackOps(
	nodes: JsNode[],
	S: string,
	P: string,
	W: string,
	X: string,
	Y: string
): JsNode[] {
	// Walk tree, pattern match calls to W/X/Y and replace with direct stack access
}
```

-   [ ] **Step 2: Write unit tests for inlineStackOps**
-   [ ] **Step 3: Commit**

---

### Task 24: Tree Transforms — obfuscateLocals

Replace the regex-based `obfuscateLocals()` with a structural tree visitor.

**Files:**

-   Modify: `packages/ruam/src/ruamvm/transforms.ts`
-   Create: `packages/ruam/test/ruamvm/transforms.test.ts`

**Context:** The old version uses `\bvar\s+([a-zA-Z][a-zA-Z0-9_]{2,})\b` to find var declarations and function params with names >= 3 chars. The AST version collects `VarDecl.name` and `FnDecl.params` / `FnExpr.params` entries, filters by the KEEP set, generates short replacements via LCG, and renames all matching `Id` references.

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:172-297` — old regex implementation (including KEEP set and reserved words)

-   [ ] **Step 1: Write obfuscateLocals tree visitor**

The KEEP set and reserved words set should be imported from (or co-located with) the transform. The LCG-based short name generator should produce the same names as the old implementation for a given seed.

-   [ ] **Step 2: Write unit tests**
-   [ ] **Step 3: Commit**

---

## Chunk 5: Template Builders (Small)

### Task 25: Globals Builder

**Files:**

-   Create: `packages/ruam/src/ruamvm/builders/globals.ts`

**Context:** The simplest builder — 4 `if/else if` checks for globalThis/window/global/self, then assigns the VM function.

Refer to: `packages/ruam/src/runtime/templates/globals.ts` (23 lines)

-   [ ] **Step 1: Write builder returning JsNode[]**
-   [ ] **Step 2: Commit**

---

### Task 26: Fingerprint Builder

**Files:**

-   Create: `packages/ruam/src/ruamvm/builders/fingerprint.ts`

**Context:** Single function that computes a hash from built-in function `.length` properties with XOR and Murmur3-style mixing.

Refer to: `packages/ruam/src/runtime/fingerprint.ts:25-27` (the generate function)

-   [ ] **Step 1: Write builder returning JsNode[]**
-   [ ] **Step 2: Commit**

---

### Task 27: Rolling Cipher Builder

**Files:**

-   Create: `packages/ruam/src/ruamvm/builders/rolling-cipher.ts`

**Context:** Two functions: `rcDeriveKey(unit)` and `rcMix(state, a, b)`. Uses FNV-1a constants. Optional integrity hash XOR.

Refer to: `packages/ruam/src/runtime/rolling-cipher.ts:106-117`

-   [ ] **Step 1: Write builder returning JsNode[]**
-   [ ] **Step 2: Commit**

---

### Task 28: Decoder Builder

**Files:**

-   Create: `packages/ruam/src/ruamvm/builders/decoder.ts`

**Context:** RC4 cipher function and base64 decoder. String constant decoder with optional implicit key. These are pure computation functions with no external dependencies.

Refer to: `packages/ruam/src/runtime/decoder.ts:18-50`

-   [ ] **Step 1: Write builder returning JsNode[]**
-   [ ] **Step 2: Commit**

---

## Chunk 6: Template Builders (Medium)

### Task 29: Loader Builder

**Files:**

-   Create: `packages/ruam/src/ruamvm/builders/loader.ts`

**Context:** The loader function with cache lookup, watermark guard, JSON parse or binary deserialize paths, string decoding, Int32Array conversion. Has two code paths (encrypt vs plain) and optional `skipSharedDecls` for shielded mode.

Refer to: `packages/ruam/src/runtime/templates/loader.ts` (67 lines)

-   [ ] **Step 1: Write builder returning JsNode[]**

The loader has branching based on `encrypt`, `hasStringEncoding`, `rollingCipher`, and `skipSharedDecls`. Use `ifStmt` nodes for these branches rather than string interpolation.

-   [ ] **Step 2: Commit**

---

### Task 30: Runners Builder

**Files:**

-   Create: `packages/ruam/src/ruamvm/builders/runners.ts`

**Context:** The VM dispatch function and its `.call` variant. The router for shielded mode maps unit IDs to group dispatch functions.

Refer to: `packages/ruam/src/runtime/templates/runners.ts` (78 lines)

-   [ ] **Step 1: Write builders for `generateRunners()` and `generateRouter()` returning JsNode[]**
-   [ ] **Step 2: Commit**

---

### Task 31: Deserializer Builder

**Files:**

-   Create: `packages/ruam/src/ruamvm/builders/deserializer.ts`

**Context:** Binary bytecode deserializer with DataView reads. Has a tag-based switch for constant types.

Refer to: `packages/ruam/src/runtime/templates/deserializer.ts` (68 lines)

-   [ ] **Step 1: Write builder returning JsNode[]**
-   [ ] **Step 2: Commit**

---

### Task 32: Stack Encoding Builder

**Files:**

-   Create: `packages/ruam/src/ruamvm/builders/stack-encoding.ts`

**Context:** Proxy-based wrapper that XOR-encodes numeric values. Has get/set traps with type-based tagging. This builder is called from `builders/interpreter.ts` (not from `vm.ts` directly) — the interpreter builder conditionally includes these nodes based on the `stackEncoding` option.

Refer to: `packages/ruam/src/runtime/templates/interpreter.ts:1513-1543` (implementation), `interpreter.ts:590` (call site)

-   [ ] **Step 1: Write builder returning JsNode[]**
-   [ ] **Step 2: Commit**

---

## Chunk 7: Complex Builders and Orchestrator

### Task 33: Debug Protection Builder

**Files:**

-   Create: `packages/ruam/src/ruamvm/builders/debug-protection.ts`

**Context:** The most complex builder — 6 detection layers, escalating response, polymorphic debugger invocation, FNV-1a self-verification, console API checking, timer scheduling with `.unref()`. Uses `names.thresh`, `names.bt`, `names.cache`, `names.dbgProt`.

Refer to: `packages/ruam/src/runtime/templates/debug-protection.ts` (71 lines)

-   [ ] **Step 1: Write builder returning JsNode[]**

This is a large and complex IIFE. Consider using `raw()` for the initial migration and converting to full AST in a follow-up effort. The key benefit of having it in the builder system is that vm.ts calls the builder and gets JsNode[] back, even if the node is a single Raw node internally.

-   [ ] **Step 2: Commit**

---

### Task 34: Debug Logging Builder

**Files:**

-   Create: `packages/ruam/src/ruamvm/builders/debug-logging.ts`

**Context:** Debug config object, logging function with rate limiting, opcode trace function with name table. Builds a large object literal for opcode name mapping.

Refer to: `packages/ruam/src/runtime/templates/debug-logging.ts` (81 lines)

-   [ ] **Step 1: Write builder returning JsNode[]**
-   [ ] **Step 2: Commit**

---

### Task 35: Update Orchestrator (vm.ts)

Switch `vm.ts` from string concatenation to AST node assembly + `emit()`.

**Files:**

-   Modify: `packages/ruam/src/runtime/vm.ts`

**Context:** Currently, `generateVmRuntime()` and `generateShieldedVmRuntime()` build a `parts: string[]` array by calling `generate*()` functions that return strings, then join with newlines. The new version calls builder functions that return `JsNode[]`, collects them into a flat array, wraps in an IIFE, and calls `emit()` once.

**IMPORTANT:** This is the big switchover. After this task, the old template functions are no longer called. All 1714 tests must pass.

Refer to:

-   `packages/ruam/src/runtime/vm.ts` — current orchestrator (304 lines)
-   All builder files in `packages/ruam/src/ruamvm/builders/`

-   [ ] **Step 1: Update `generateVmRuntime()` to use builders**

```typescript
import { emit } from "../ruamvm/emit.js";
import { iife, block, raw, exprStmt, varDecl, id, lit } from "../ruamvm/nodes.js";
import { buildInterpreter } from "../ruamvm/builders/interpreter.js";
// ... import all builders

export function generateVmRuntime(options: { ... }): string {
  const nodes: JsNode[] = [];

  // "use strict"
  nodes.push(exprStmt(lit('use strict')));

  // Optional encryption
  if (encrypt) {
    nodes.push(...generateFingerprint(names));
    nodes.push(...generateDecoder(names));
  }

  // ... assemble all nodes from builders ...

  // Wrap in IIFE and emit
  return emit(iife(block(...nodes))) + ';';
}
```

-   [ ] **Step 2: Update `generateShieldedVmRuntime()` to use builders**

Key structural differences from `generateVmRuntime()`:

-   **Shared infrastructure emitted once**: fingerprint, decoder, debug protection, deserializer — use `sharedNames`
-   **Per-group loop**: iterate `groups[]`, calling builders with each group's `names`, `shuffleMap`, `seed`, and `usedOpcodes`
-   **Per-group builders**: rolling cipher, interpreter, runners, string decoder, loader — each using `group.names` (not `sharedNames`)
-   **Forced options**: `dynamicOpcodes: true` always on in shielded mode, loader gets `skipSharedDecls: true`
-   **String decoder**: always called with `(gn, 0, true)` (implicit key, rolling cipher always on)
-   **Shared variable declarations**: `_ru4m`, `depth`, `callStack`, `cache` emitted once (after per-group loop)
-   **Router**: `generateRouter(sharedNames.router, groupRegistrations, sharedNames)` maps unit IDs to group dispatch functions
-   **Global exposure**: uses `sharedNames.router` (not `sharedNames.vm`)

-   [ ] **Step 3: Run the full test suite**

Run: `cd packages/ruam && npm test`
Expected: All 1714 tests pass

-   [ ] **Step 4: Commit**

```bash
git add packages/ruam/src/runtime/vm.ts
git commit -m "feat(ruamvm): switch vm.ts orchestrator to AST builder"
```

---

### Task 36: Run Full Test Suite and Fix Issues

**Files:**

-   Potentially any builder or handler file

**Context:** The AST emitter produces different (but functionally equivalent) minified JS compared to the old template literals. Some tests check for specific string patterns in the output (e.g., debug-protection tests check for `0x811C9DC5`, `[native code]`, `setTimeout`, `.unref`). These should still pass since the AST emitter preserves the same logical structure, but operator spacing, semicolon placement, and variable ordering may differ.

-   [ ] **Step 1: Run full test suite**

Run: `cd packages/ruam && npm test`

-   [ ] **Step 2: Fix any failing tests**

If tests fail, diagnose whether the issue is:
a. An emitter bug (wrong JS output) — fix in `emit.ts`
b. A handler bug (wrong AST construction) — fix in the handler file
c. A test that checks for exact string formatting — update the test

-   [ ] **Step 3: Commit fixes**

---

## Chunk 8: Cleanup

### Task 37: Delete Old Template Files

Remove the old string-based template system now that the AST builder has fully replaced it.

**Files:**

-   Delete: `packages/ruam/src/runtime/templates/` — entire directory (7 files)
-   Modify: `packages/ruam/src/runtime/fingerprint.ts` — remove `generateFingerprintSource()`
-   Modify: `packages/ruam/src/runtime/decoder.ts` — remove `generateDecoderSource()`, `generateStringDecoderSource()`
-   Modify: `packages/ruam/src/runtime/rolling-cipher.ts` — remove `generateRollingCipherSource()`
-   Modify: `packages/ruam/src/runtime/vm.ts` — remove old imports

**IMPORTANT:** Only do this after all 1714 tests pass with the new builder system. The old functions should already be dead code at this point.

-   [ ] **Step 1: Verify no imports of old template functions remain**

Run: `grep -r "from.*templates/" packages/ruam/src/ --include="*.ts" | grep -v ruamvm`
Expected: No matches (vm.ts imports should have been removed in Task 35)

Also verify the non-template generate functions are no longer imported:
Run: `grep -rE "generateFingerprintSource|generateDecoderSource|generateStringDecoderSource|generateRollingCipherSource" packages/ruam/src/ --include="*.ts"`
Expected: No matches

-   [ ] **Step 2: Delete old template directory**

```bash
rm -rf packages/ruam/src/runtime/templates/
```

-   [ ] **Step 3: Remove old generate functions from non-template files**

Remove `generateFingerprintSource()` from fingerprint.ts, `generateDecoderSource()`/`generateStringDecoderSource()` from decoder.ts, `generateRollingCipherSource()` from rolling-cipher.ts. Keep the build-time functions (`computeFingerprint()`, `rc4()`, `b64encode()`, `deriveImplicitKey()`, etc.).

-   [ ] **Step 4: Run full test suite**

Run: `cd packages/ruam && npm test`
Expected: All tests pass

-   [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove old string-based template system"
```

---

### Task 38: Update CLAUDE.md and Memory

**Files:**

-   Modify: `CLAUDE.md` — update project structure section, remove `runtime/templates/` references, add `ruamvm/` section
-   Modify: memory files — update architecture notes

-   [ ] **Step 1: Update CLAUDE.md**

Update the project structure to reflect the new `ruamvm/` directory and removal of `runtime/templates/`. Update the "Runtime templates" convention to describe the AST builder system instead.

-   [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for AST builder migration"
```
