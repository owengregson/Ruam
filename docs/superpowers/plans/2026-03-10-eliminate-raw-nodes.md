# Eliminate Raw Nodes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all 202 `raw()` calls so that every JS construct is represented as typed AST nodes until final `emit()`.

**Architecture:** Convert all handler and builder raw strings to compositions of the existing 35 AST node types. Replace string-based post-processing (`stringInlineStackOps`, `stringObfuscateLocals`) with the existing tree-based `obfuscateLocals()`. The interpreter scaffold becomes a `FnDecl` AST node. `RawNode` is removed from the type system.

**Tech Stack:** TypeScript, vitest (1803 tests), existing JsNode AST system in `src/ruamvm/nodes.ts`

**Spec:** `docs/superpowers/specs/2026-03-10-eliminate-raw-nodes-design.md`

**Execution notes:**

-   Tasks 3-12 (Chunk 2) are all independent and can execute in parallel once Tasks 1-2 are complete.
-   Tasks 18-27 (Chunk 4) are all independent and can execute in parallel once Chunks 1-3 are complete.
-   Run `npm run test` after EVERY task to catch regressions immediately.
-   **Output equivalence**: After completing Task 3 (first handler migration), run a quick sanity check — obfuscate a simple function with `integrityBinding: true` and verify the output still executes correctly. The `stringObfuscateLocals` (still active at this stage) may discover a slightly different set of names from the raw-string era vs the AST era if any handler's emitted variable names changed. If tests pass, this is fine — the tree-based `obfuscateLocals` (which replaces it in Task 28) will handle naming consistently.

---

## Chunk 1: Infrastructure

### Task 1: Update HandlerCtx — AST-returning scope helpers

**Files:**

-   Modify: `packages/ruam/src/ruamvm/handlers/registry.ts`

The current `sv()`, `curSv()`, `scopeWalk()` return strings for interpolation into raw templates. They need to return `JsNode` / `JsNode[]` for AST composition.

-   [ ] **Step 1: Change `sv()` to return JsNode**

In `registry.ts`, update the `HandlerCtx` interface and `makeHandlerCtx`:

```typescript
// In HandlerCtx interface, change:
sv: (key?: string) => string;
// To:
sv: (key?: JsNode) => JsNode;
```

In `makeHandlerCtx`, change:

```typescript
// From:
sv: (key = "name") => `s.${names.sVars}[${key}]`,
// To:
sv: (key: JsNode = id("name")) => index(member(id("s"), names.sVars), key),
```

Add imports at top of registry.ts:

```typescript
import {
	stackPush,
	stackPop,
	stackPeek,
	id,
	index,
	member,
	bin,
	assign,
	ifStmt,
	whileStmt,
	exprStmt,
	breakStmt,
} from "../nodes.js";
```

-   [ ] **Step 2: Change `curSv()` to return JsNode**

```typescript
// Interface:
curSv: (key?: JsNode) => JsNode;

// Implementation:
curSv: (key: JsNode = id("name")) => index(member(id(names.scope), names.sVars), key),
```

-   [ ] **Step 3: Change `scopeWalk()` to return JsNode[]**

```typescript
// Interface:
scopeWalk: (body: JsNode[], key?: JsNode) => JsNode[];

// Implementation:
scopeWalk: (body: JsNode[], key: JsNode = id("name")): JsNode[] => [
  whileStmt(id("s"), [
    ifStmt(bin("in", key, member(id("s"), names.sVars)), [
      ...body,
      breakStmt(),
    ]),
    exprStmt(assign(id("s"), member(id("s"), names.sPar))),
  ]),
  breakStmt(),
],
```

-   [ ] **Step 4: Remove W/X/Y string fields from HandlerCtx**

> **ATOMICITY WARNING:** Steps 4 through 8 must be executed together in a single session. The codebase will not compile between Step 4 (removing fields) and Step 7 (updating callers). Do NOT run tests until Step 8.

Remove these fields from the interface:

```typescript
W: string; // push function (pre-inline)
X: string; // pop function (pre-inline)
Y: string; // peek function (pre-inline)
```

And their initialization in `makeHandlerCtx`:

```typescript
W: names.sPush,
X: names.sPop,
Y: names.sPeek,
```

-   [ ] **Step 5: Verify typecheck catches all callers**

Run: `npx tsc --noEmit 2>&1 | head -100`

Expected: Type errors in all handler/builder files that reference `ctx.W`, `ctx.X`, `ctx.Y`, `ctx.sv()`, `ctx.curSv()`, `ctx.scopeWalk()` — these are the files that need migration. Do NOT fix them yet.

-   [ ] **Step 6: Temporarily keep backward-compatible overloads**

To allow incremental migration, add legacy string-returning helpers alongside the new ones. Add to HandlerCtx interface:

```typescript
/** @deprecated Use sv() which returns JsNode */
svStr: (key?: string) => string;
/** @deprecated Use curSv() which returns JsNode */
curSvStr: (key?: string) => string;
/** @deprecated Use scopeWalk() which returns JsNode[] */
scopeWalkStr: (body: string, key?: string) => string;
/** @deprecated Use pop() */
popStr: () => string;
/** @deprecated Use peek() */
peekStr: () => string;
/** @deprecated Use push() — returns string like `W(expr)` */
pushStr: (expr: string) => string;
```

In `makeHandlerCtx`:

```typescript
svStr: (key = "name") => `s.${names.sVars}[${key}]`,
curSvStr: (key = "name") => `${names.scope}.${names.sVars}[${key}]`,
scopeWalkStr: (body: string, key = "name") =>
  `while(s){if(${key} in s.${names.sVars}){${body}break;}s=s.${names.sPar};}break;`,
popStr: () => `${names.stk}[${names.stp}--]`,
peekStr: () => `${names.stk}[${names.stp}]`,
pushStr: (expr: string) => `${names.sPush}(${expr})`,
```

-   [ ] **Step 7: Update all handler files to use legacy helpers temporarily**

In every handler file that currently uses `ctx.W(...)`, `ctx.X()`, `ctx.Y()`, `ctx.sv()`, `ctx.curSv()`, `ctx.scopeWalk()`, do a find-and-replace:

-   `ctx.W(` → `ctx.pushStr(`
-   `ctx.X()` → `ctx.popStr()`
-   `ctx.Y()` → `ctx.peekStr()`
-   `ctx.sv(` → `ctx.svStr(`
-   `ctx.curSv(` → `ctx.curSvStr(`
-   `ctx.scopeWalk(` → `ctx.scopeWalkStr(`

Also update string concatenations using `${ctx.S}[${ctx.P}--]` → `ctx.popStr()` and `${ctx.S}[${ctx.P}]` → `ctx.peekStr()` where they appear in raw strings.

-   [ ] **Step 8: Run tests**

Run: `npm run test`
Expected: All 1803 tests pass. The legacy helpers produce identical output to the old fields.

-   [ ] **Step 9: Commit**

```bash
git add packages/ruam/src/ruamvm/handlers/registry.ts packages/ruam/src/ruamvm/handlers/*.ts
git commit -m "refactor: add AST-returning scope helpers to HandlerCtx with legacy compat"
```

---

### Task 2: Create shared handler helper functions

**Files:**

-   Create: `packages/ruam/src/ruamvm/handlers/helpers.ts`

This file provides reusable AST-building functions for patterns repeated across many handlers.

-   [ ] **Step 1: Create helpers.ts**

````typescript
/**
 * Shared AST-building helpers for opcode handlers.
 *
 * Provides reusable patterns for this-boxing, debug tracing,
 * closure wrapping, and super property resolution.
 *
 * @module ruamvm/handlers/helpers
 */

import type { JsNode } from "../nodes.js";
import {
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
	returnStmt,
	fnExpr,
	ternary,
	breakStmt,
} from "../nodes.js";
import type { HandlerCtx } from "./registry.js";

// --- This-boxing ---

/**
 * Build sloppy-mode this-boxing AST nodes.
 *
 * Declares `_tv` from `this`, then boxes null→globalThis,
 * primitives→Object(). Used by non-arrow function handlers.
 *
 * @returns JsNode[] to insert in function body
 */
export function buildThisBoxing(): JsNode[] {
	return [
		varDecl("_tv", id("this")),
		ifStmt(un("!", member(id("u"), "st")), [
			ifStmt(
				bin("==", id("_tv"), lit(null)),
				[exprStmt(assign(id("_tv"), id("globalThis")))],
				[
					varDecl("_tt", un("typeof", id("_tv"))),
					ifStmt(
						bin(
							"&&",
							bin("!==", id("_tt"), lit("object")),
							bin("!==", id("_tt"), lit("function"))
						),
						[
							exprStmt(
								assign(
									id("_tv"),
									call(id("Object"), [id("_tv")])
								)
							),
						]
					),
				]
			),
		]),
	];
}

// --- Debug tracing ---

/**
 * Emit conditional debug trace call.
 *
 * Returns empty array when debug is off, so it can always be spread
 * into a statement list: `...debugTrace(ctx, 'NAME', args)`.
 */
export function debugTrace(
	ctx: HandlerCtx,
	name: string,
	...args: JsNode[]
): JsNode[] {
	if (!ctx.debug) return [];
	return [exprStmt(call(id(ctx.dbg), [lit(name), ...args]))];
}

// --- Super property resolution ---

/**
 * Build the super prototype resolution expression.
 *
 * ```js
 * HO ? Object.getPrototypeOf(HO) : Object.getPrototypeOf(Object.getPrototypeOf(TV))
 * ```
 */
export function superProto(ctx: HandlerCtx): JsNode {
	const gpo = (arg: JsNode) =>
		call(member(id("Object"), "getPrototypeOf"), [arg]);
	return ternary(id(ctx.HO), gpo(id(ctx.HO)), gpo(gpo(id(ctx.TV))));
}

/**
 * Build the super property key resolution expression.
 *
 * If operand >= 0, uses constant pool; otherwise pops from stack.
 * ```js
 * O >= 0 ? C[O] : S[P--]
 * ```
 */
export function superKey(ctx: HandlerCtx): JsNode {
	return ternary(
		bin(">=", id(ctx.O), lit(0)),
		index(id(ctx.C), id(ctx.O)),
		ctx.pop()
	);
}

// --- Closure IIFE builders ---

/**
 * Build an arrow-function closure IIFE (captures outer this + scope).
 *
 * ```js
 * (function(u,cs,ct){
 *   if(u.s) return async function(..._a){ return execAsync(u,_a,cs,ct); };
 *   return function(..._a){ return exec(u,_a,cs,ct); };
 * })(_cu, SC, TV)
 * ```
 */
export function buildArrowClosureIIFE(ctx: HandlerCtx): JsNode {
	const execCall = (isAsync: boolean) =>
		returnStmt(
			call(id(isAsync ? ctx.execAsync : ctx.exec), [
				id("u"),
				id("_a"),
				id("cs"),
				id("ct"),
			])
		);
	return call(
		fnExpr(
			undefined,
			["u", "cs", "ct"],
			[
				ifStmt(member(id("u"), "s"), [
					returnStmt(
						fnExpr(undefined, ["..._a"], [execCall(true)], {
							async: true,
						})
					),
				]),
				returnStmt(fnExpr(undefined, ["..._a"], [execCall(false)])),
			]
		),
		[id("_cu"), id(ctx.SC), id(ctx.TV)]
	);
}

/**
 * Build a non-arrow closure IIFE (with this-boxing + home object).
 *
 * ```js
 * (function(u,cs){
 *   if(u.s) { var fn = async function(..._a){ <thisBoxing>; return execAsync(u,_a,cs,_tv,void 0,fn._ho); }; return fn; }
 *   var fn = function(..._a){ <thisBoxing>; return exec(u,_a,cs,_tv,void 0,fn._ho); }; return fn;
 * })(_cu, SC)
 * ```
 */
export function buildRegularClosureIIFE(ctx: HandlerCtx): JsNode {
	const fnBody = (isAsync: boolean): JsNode[] => [
		...buildThisBoxing(),
		returnStmt(
			call(id(isAsync ? ctx.execAsync : ctx.exec), [
				id("u"),
				id("_a"),
				id("cs"),
				id("_tv"),
				un("void", lit(0)),
				member(id("fn"), "_ho"),
			])
		),
	];
	return call(
		fnExpr(
			undefined,
			["u", "cs"],
			[
				ifStmt(member(id("u"), "s"), [
					varDecl(
						"fn",
						fnExpr(undefined, ["..._a"], fnBody(true), {
							async: true,
						})
					),
					returnStmt(id("fn")),
				]),
				varDecl("fn", fnExpr(undefined, ["..._a"], fnBody(false))),
				returnStmt(id("fn")),
			]
		),
		[id("_cu"), id(ctx.SC)]
	);
}
````

-   [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No new errors from helpers.ts.

-   [ ] **Step 3: Commit**

```bash
git add packages/ruam/src/ruamvm/handlers/helpers.ts
git commit -m "feat: add shared AST helper functions for handler migration"
```

---

## Chunk 2: Handler Migrations — Simple Patterns

Each task converts one handler file from `raw()` to pure AST. The general pattern:

1. Replace `import { raw } from "../nodes.js"` with imports of the AST factories used
2. Convert each handler from `raw(template_string)` to AST node composition
3. Run `npm run test` after each file

### Conversion Reference

**Stack operations in raw strings → AST nodes:**

-   `${ctx.W}(expr)` → `exprStmt(ctx.push(expr))` (statement) or `ctx.push(expr)` (expression)
-   `${ctx.X}()` → `ctx.pop()` (expression)
-   `${ctx.Y}()` → `ctx.peek()` (expression)
-   `${ctx.S}[${ctx.P}--]` → `ctx.pop()`
-   `${ctx.S}[${ctx.P}]` → `ctx.peek()`
-   `${ctx.S}[++${ctx.P}]=expr` → `ctx.push(expr)`
-   `${ctx.S}[${ctx.P}]=expr` → `exprStmt(assign(ctx.peek(), expr))`

**Common patterns:**

-   `var x=S[P--];` → `varDecl("x", ctx.pop())`
-   `var x=S[P];` → `varDecl("x", ctx.peek())`
-   `var x=C[O];` → `varDecl("x", index(id(ctx.C), id(ctx.O)))`
-   `obj[key]=val;` → `exprStmt(assign(index(id("obj"), id("key")), id("val")))`
-   `Object.defineProperty(obj,k,desc)` → `exprStmt(call(member(id("Object"), "defineProperty"), [id("obj"), id("k"), id("desc")]))`
-   `Object.freeze(x)` → `exprStmt(call(member(id("Object"), "freeze"), [id("x")]))`
-   `break;` → `breakStmt()`
-   `x in obj` → `bin("in", id("x"), id("obj"))`
-   `x instanceof y` → `bin("instanceof", id("x"), id("y"))`
-   `typeof x` → `un("typeof", id("x"))`
-   `delete obj[key]` → `un("delete", index(id("obj"), id("key")))`
-   `void 0` → `un("void", lit(0))`
-   `!expr` → `un("!", expr)`
-   `try{...}catch(_){...}` → `tryCatch(body, "_", handler)`
-   `obj==null?void 0:obj[key]` → `ternary(bin("==",id("obj"),lit(null)), un("void",lit(0)), index(id("obj"),id("key")))`
-   `throw new ReferenceError(msg)` → `throwStmt(newExpr(id("ReferenceError"), [msg]))`

**Breaking out of raw strings — the key insight:**
Every `raw()` call ends with `break;`. In AST form, this becomes `breakStmt()` as the last element in the returned `JsNode[]` array. The switch case builder in `interpreter.ts` already wraps handler output in a `CaseClause`.

---

### Task 3: Convert objects.ts (30 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/handlers/objects.ts`

All 30 handlers in this file follow simple patterns: stack pop/peek/push with property access, Object.\* calls, try-catch fallback.

-   [ ] **Step 1: Update imports**

Replace:

```typescript
import { type JsNode, raw } from "../nodes.js";
```

With:

```typescript
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
	forStmt,
	tryCatch,
	breakStmt,
	obj,
	arr,
	newExpr,
	ternary,
	update,
} from "../nodes.js";
```

-   [ ] **Step 2: Convert all 30 handlers**

Each handler follows the conversion reference above. Full conversions for representative handlers:

**GET_PROP_STATIC** — inline peek-and-assign:

```typescript
function GET_PROP_STATIC(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(
			assign(ctx.peek(), index(ctx.peek(), index(id(ctx.C), id(ctx.O))))
		),
		breakStmt(),
	];
}
```

**SET_PROP_STATIC** — try/catch fallback:

```typescript
function SET_PROP_STATIC(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("val", ctx.pop()),
		varDecl("obj", ctx.peek()),
		varDecl("k", index(id(ctx.C), id(ctx.O))),
		tryCatch(
			[exprStmt(assign(index(id("obj"), id("k")), id("val")))],
			"_",
			[
				exprStmt(
					call(member(id("Object"), "defineProperty"), [
						id("obj"),
						id("k"),
						obj(
							["value", id("val")],
							["writable", lit(true)],
							["configurable", lit(true)]
						),
					])
				),
			]
		),
		breakStmt(),
	];
}
```

**GET_PROP_DYNAMIC:**

```typescript
function GET_PROP_DYNAMIC(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("key", ctx.pop()),
		exprStmt(assign(ctx.peek(), index(ctx.peek(), id("key")))),
		breakStmt(),
	];
}
```

**SET_PROP_DYNAMIC:**

```typescript
function SET_PROP_DYNAMIC(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("val", ctx.pop()),
		varDecl("key", ctx.pop()),
		varDecl("obj", ctx.peek()),
		exprStmt(assign(index(id("obj"), id("key")), id("val"))),
		breakStmt(),
	];
}
```

**DELETE_PROP_STATIC:**

```typescript
function DELETE_PROP_STATIC(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(
			assign(
				ctx.peek(),
				un("delete", index(ctx.peek(), index(id(ctx.C), id(ctx.O))))
			)
		),
		breakStmt(),
	];
}
```

**DELETE_PROP_DYNAMIC:**

```typescript
function DELETE_PROP_DYNAMIC(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("key", ctx.pop()),
		exprStmt(
			assign(ctx.peek(), un("delete", index(ctx.peek(), id("key"))))
		),
		breakStmt(),
	];
}
```

**OPT_CHAIN_GET:**

```typescript
function OPT_CHAIN_GET(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("key", index(id(ctx.C), id(ctx.O))),
		varDecl("obj", ctx.peek()),
		exprStmt(
			assign(
				ctx.peek(),
				ternary(
					bin("==", id("obj"), lit(null)),
					un("void", lit(0)),
					index(id("obj"), id("key"))
				)
			)
		),
		breakStmt(),
	];
}
```

**OPT_CHAIN_DYNAMIC:**

```typescript
function OPT_CHAIN_DYNAMIC(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("key", ctx.pop()),
		varDecl("obj", ctx.peek()),
		exprStmt(
			assign(
				ctx.peek(),
				ternary(
					bin("==", id("obj"), lit(null)),
					un("void", lit(0)),
					index(id("obj"), id("key"))
				)
			)
		),
		breakStmt(),
	];
}
```

**IN_OP:**

```typescript
function IN_OP(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("obj", ctx.pop()),
		exprStmt(assign(ctx.peek(), bin("in", ctx.peek(), id("obj")))),
		breakStmt(),
	];
}
```

**INSTANCEOF:**

```typescript
function INSTANCEOF(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("ctor", ctx.pop()),
		exprStmt(assign(ctx.peek(), bin("instanceof", ctx.peek(), id("ctor")))),
		breakStmt(),
	];
}
```

**GET_SUPER_PROP:** (use `superProto` and `superKey` from helpers.ts)

```typescript
import { superProto, superKey } from "./helpers.js";

function GET_SUPER_PROP(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("sp2", superProto(ctx)),
		varDecl("key", superKey(ctx)),
		exprStmt(
			ctx.push(
				ternary(
					id("sp2"),
					index(id("sp2"), id("key")),
					un("void", lit(0))
				)
			)
		),
		breakStmt(),
	];
}
```

**SET_SUPER_PROP:**

```typescript
function SET_SUPER_PROP(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("val", ctx.pop()),
		varDecl("sp2", superProto(ctx)),
		varDecl("key", superKey(ctx)),
		ifStmt(id("sp2"), [
			exprStmt(assign(index(id("sp2"), id("key")), id("val"))),
		]),
		exprStmt(ctx.push(id("val"))),
		breakStmt(),
	];
}
```

**GET_PRIVATE_FIELD:**

```typescript
function GET_PRIVATE_FIELD(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("obj", ctx.pop()),
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		exprStmt(ctx.push(index(id("obj"), id("name")))),
		breakStmt(),
	];
}
```

**SET_PRIVATE_FIELD:**

```typescript
function SET_PRIVATE_FIELD(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("val", ctx.pop()),
		varDecl("obj", ctx.pop()),
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		exprStmt(assign(index(id("obj"), id("name")), id("val"))),
		exprStmt(ctx.push(id("val"))),
		breakStmt(),
	];
}
```

**HAS_PRIVATE_FIELD:**

```typescript
function HAS_PRIVATE_FIELD(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("obj", ctx.pop()),
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		exprStmt(ctx.push(bin("in", id("name"), id("obj")))),
		breakStmt(),
	];
}
```

**DEFINE_OWN_PROPERTY:**

```typescript
function DEFINE_OWN_PROPERTY(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("desc", ctx.pop()),
		varDecl("key", ctx.pop()),
		varDecl("obj", ctx.pop()),
		exprStmt(
			call(member(id("Object"), "defineProperty"), [
				id("obj"),
				id("key"),
				id("desc"),
			])
		),
		exprStmt(ctx.push(id("obj"))),
		breakStmt(),
	];
}
```

**NEW_OBJECT:**

```typescript
function NEW_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(obj())), breakStmt()];
}
```

**NEW_ARRAY:**

```typescript
function NEW_ARRAY(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(arr())), breakStmt()];
}
```

**NEW_ARRAY_WITH_SIZE:**

```typescript
function NEW_ARRAY_WITH_SIZE(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(newExpr(id("Array"), [id(ctx.O)]))), breakStmt()];
}
```

**ARRAY_PUSH:**

```typescript
function ARRAY_PUSH(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("val", ctx.pop()),
		varDecl("arr", ctx.peek()),
		exprStmt(call(member(id("arr"), "push"), [id("val")])),
		breakStmt(),
	];
}
```

**ARRAY_HOLE:**

```typescript
function ARRAY_HOLE(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("arr", ctx.peek()),
		exprStmt(update("++", false, member(id("arr"), "length"))),
		breakStmt(),
	];
}
```

**SPREAD_ARRAY:**

```typescript
function SPREAD_ARRAY(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("src", ctx.pop()),
		varDecl("target", ctx.peek()),
		ifStmt(
			call(member(id("Array"), "isArray"), [id("target")]),
			[
				varDecl(
					"items",
					call(member(id("Array"), "from"), [id("src")])
				),
				forStmt(
					varDecl("si", lit(0)),
					bin("<", id("si"), member(id("items"), "length")),
					update("++", false, id("si")),
					[
						exprStmt(
							call(member(id("target"), "push"), [
								index(id("items"), id("si")),
							])
						),
					]
				),
			],
			[
				exprStmt(
					call(member(id("Object"), "assign"), [
						id("target"),
						id("src"),
					])
				),
			]
		),
		breakStmt(),
	];
}
```

**SPREAD_OBJECT:**

```typescript
function SPREAD_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("src", ctx.pop()),
		varDecl("target", ctx.peek()),
		exprStmt(
			call(member(id("Object"), "assign"), [id("target"), id("src")])
		),
		breakStmt(),
	];
}
```

**COPY_DATA_PROPERTIES:**

```typescript
function COPY_DATA_PROPERTIES(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("excludeKeys", ctx.pop()),
		varDecl("src", ctx.pop()),
		varDecl("target", ctx.peek()),
		varDecl("keys", call(member(id("Object"), "keys"), [id("src")])),
		forStmt(
			varDecl("ki", lit(0)),
			bin("<", id("ki"), member(id("keys"), "length")),
			update("++", false, id("ki")),
			[
				ifStmt(
					bin(
						"||",
						un("!", id("excludeKeys")),
						bin(
							"<",
							call(member(id("excludeKeys"), "indexOf"), [
								index(id("keys"), id("ki")),
							]),
							lit(0)
						)
					),
					[
						exprStmt(
							assign(
								index(
									id("target"),
									index(id("keys"), id("ki"))
								),
								index(id("src"), index(id("keys"), id("ki")))
							)
						),
					]
				),
			]
		),
		breakStmt(),
	];
}
```

**SET_PROTO:**

```typescript
function SET_PROTO(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("proto", ctx.pop()),
		varDecl("obj", ctx.pop()),
		exprStmt(
			call(member(id("Object"), "setPrototypeOf"), [
				id("obj"),
				id("proto"),
			])
		),
		exprStmt(ctx.push(id("obj"))),
		breakStmt(),
	];
}
```

**FREEZE_OBJECT:**

```typescript
function FREEZE_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(call(member(id("Object"), "freeze"), [ctx.peek()])),
		breakStmt(),
	];
}
```

**SEAL_OBJECT:**

```typescript
function SEAL_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(call(member(id("Object"), "seal"), [ctx.peek()])),
		breakStmt(),
	];
}
```

**DEFINE_PROPERTY_DESC:**

```typescript
function DEFINE_PROPERTY_DESC(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("desc", ctx.pop()),
		varDecl("key", ctx.pop()),
		varDecl("obj", ctx.peek()),
		exprStmt(
			call(member(id("Object"), "defineProperty"), [
				id("obj"),
				id("key"),
				id("desc"),
			])
		),
		breakStmt(),
	];
}
```

**CREATE_TEMPLATE_OBJECT:**

```typescript
function CREATE_TEMPLATE_OBJECT(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("raw", ctx.pop()),
		varDecl("cooked", ctx.pop()),
		exprStmt(
			call(member(id("Object"), "defineProperty"), [
				id("cooked"),
				lit("raw"),
				obj([
					"value",
					call(member(id("Object"), "freeze"), [id("raw")]),
				]),
			])
		),
		exprStmt(call(member(id("Object"), "freeze"), [id("cooked")])),
		exprStmt(ctx.push(id("cooked"))),
		breakStmt(),
	];
}
```

-   [ ] **Step 3: Remove `raw` from imports** — verify no raw() calls remain in this file

-   [ ] **Step 4: Run tests**

Run: `npm run test`
Expected: All 1803 tests pass.

-   [ ] **Step 5: Commit**

```bash
git add packages/ruam/src/ruamvm/handlers/objects.ts
git commit -m "refactor: convert objects.ts handlers from raw() to pure AST"
```

---

### Task 4: Convert special.ts (5 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/handlers/special.ts`

-   [ ] **Step 1: Read file, update imports, convert all handlers**

Apply the same conversion patterns as objects.ts. Key conversions:

**PUSH_GLOBAL_THIS:** `var g=_g;W(g);` →

```typescript
[varDecl("g", id("_g")), exprStmt(ctx.push(id("g"))), breakStmt()];
```

**CREATE_ARGS_COPY:** `W(Array.prototype.slice.call(A));` →

```typescript
[
	exprStmt(
		ctx.push(
			call(
				member(
					member(member(id("Array"), "prototype"), "slice"),
					"call"
				),
				[id(ctx.A)]
			)
		)
	),
	breakStmt(),
];
```

**CREATE_REST_ARGS:** `W(Array.prototype.slice.call(A,O));` →

```typescript
[
	exprStmt(
		ctx.push(
			call(
				member(
					member(member(id("Array"), "prototype"), "slice"),
					"call"
				),
				[id(ctx.A), id(ctx.O)]
			)
		)
	),
	breakStmt(),
];
```

-   [ ] **Step 2: Run tests** — `npm run test` — all pass
-   [ ] **Step 3: Commit**

---

### Task 5: Convert type-ops.ts (9 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/handlers/type-ops.ts`

-   [ ] **Step 1: Read file, update imports, convert all handlers**

Patterns: typeof, instanceof, void, delete, await, import(). Representative conversions:

**TYPEOF:** `S[P]=typeof S[P];break;` →

```typescript
function TYPEOF(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(assign(ctx.peek(), un("typeof", ctx.peek()))),
		breakStmt(),
	];
}
```

**AWAIT_OP:** `W(await X());break;` →

```typescript
function AWAIT_OP(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(ctx.push(awaitExpr(ctx.pop()))), breakStmt()];
}
```

**DYNAMIC_IMPORT:** `var spec=X();W(import(spec));break;` →

```typescript
function DYNAMIC_IMPORT(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("spec", ctx.pop()),
		exprStmt(ctx.push(importExpr(id("spec")))),
		breakStmt(),
	];
}
```

**VOID_OP:** `S[P--];W(void 0);break;` →

```typescript
function VOID_OP(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(ctx.pop()),
		exprStmt(ctx.push(un("void", lit(0)))),
		breakStmt(),
	];
}
```

Apply same patterns to remaining handlers. All follow the pop-transform-push pattern.

-   [ ] **Step 2: Run tests** — all pass
-   [ ] **Step 3: Commit**

---

### Task 6: Convert exceptions.ts (10 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/handlers/exceptions.ts`

Key patterns: `throw new ErrorType(msg)`, `EX.pop()`, `EX.push({...})`, error construction with string concatenation. Representative conversions:

**TRY_PUSH:** Pushes exception handler frame onto EX stack:

```typescript
function TRY_PUSH(ctx: HandlerCtx): JsNode[] {
	// Lazy init EX: if(!EX)EX=[];
	return [
		ifStmt(un("!", id(ctx.EX)), [exprStmt(assign(id(ctx.EX), arr()))]),
		exprStmt(
			call(member(id(ctx.EX), "push"), [
				obj(
					["_ci" /* catch IP from operand or constant */],
					["_fi" /* finally IP */],
					["_sp", id(ctx.P)]
				),
			])
		),
		breakStmt(),
	];
}
```

**TRY_POP:** `EX.pop();break;` →

```typescript
function TRY_POP(ctx: HandlerCtx): JsNode[] {
	return [exprStmt(call(member(id(ctx.EX), "pop"), [])), breakStmt()];
}
```

**THROW_REF_ERROR:** `throw new ReferenceError(C[O]||'not defined');` →

```typescript
function THROW_REF_ERROR(ctx: HandlerCtx): JsNode[] {
	return [
		throwStmt(
			newExpr(id("ReferenceError"), [
				bin("||", index(id(ctx.C), id(ctx.O)), lit("not defined")),
			])
		),
	];
}
```

Read the file to understand the exact TRY_PUSH frame structure (catch IP, finally IP fields) — these vary based on operand encoding. Apply patterns to all 10 handlers.

-   [ ] **Step 1: Read file, update imports, convert all handlers**
-   [ ] **Step 2: Run tests** — all pass
-   [ ] **Step 3: Commit**

---

### Task 7: Convert destructuring.ts (6 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/handlers/destructuring.ts`

-   [ ] **Step 1: Read file, update imports, convert all handlers**
-   [ ] **Step 2: Run tests** — all pass
-   [ ] **Step 3: Commit**

---

### Task 8: Convert calls.ts (15 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/handlers/calls.ts`

Key patterns: `fn.call(obj, args)`, method calls with dynamic this, spread args, variable-length argument collection. Representative conversions:

**CALL_0:** `var fn=X();W(fn());break;` →

```typescript
function CALL_0(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("fn", ctx.pop()),
		exprStmt(ctx.push(call(id("fn"), []))),
		breakStmt(),
	];
}
```

**CALL (generic):** Pops N args then fn. The operand encodes argument count. Key pattern — pop args in reverse, then pop function, then call:

```typescript
function CALL(ctx: HandlerCtx): JsNode[] {
	// Operand = arg count. Build arg collection loop:
	return [
		varDecl("_n", id(ctx.O)),
		varDecl("_args", newExpr(id("Array"), [id("_n")])),
		forStmt(
			varDecl("_i", bin("-", id("_n"), lit(1))),
			bin(">=", id("_i"), lit(0)),
			update("--", true, id("_i")),
			[exprStmt(assign(index(id("_args"), id("_i")), ctx.pop()))]
		),
		varDecl("fn", ctx.pop()),
		exprStmt(
			ctx.push(
				call(member(id("fn"), "apply"), [
					un("void", lit(0)),
					id("_args"),
				])
			)
		),
		breakStmt(),
	];
}
```

**CALL_METHOD:** Similar but pops object first, uses `fn.apply(obj, args)`.

**DIRECT_EVAL:** `var code=X();W(eval(code));break;` →

```typescript
function DIRECT_EVAL(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("code", ctx.pop()),
		exprStmt(ctx.push(call(id("eval"), [id("code")]))),
		breakStmt(),
	];
}
```

Read the file to understand exact operand encoding for CALL, CALL_METHOD, CALL_NEW (arg count may be packed differently). Some use `forStmt` loops to collect variable-length args; others use fixed CALL_0/CALL_1/CALL_2/CALL_3 optimizations.

-   [ ] **Step 1: Read file, update imports, convert all handlers**
-   [ ] **Step 2: Run tests** — all pass
-   [ ] **Step 3: Commit**

---

### Task 9: Convert iterators.ts (17 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/handlers/iterators.ts`

Key patterns: iterator protocol property access (`._done`, `._value`, `._keys`, `._idx`), post-increment indexing, for-in/for-of state management. Representative conversions:

**ITER_DONE:** `var iterObj=Y();W(!!iterObj._done);break;` →

```typescript
function ITER_DONE(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("iterObj", ctx.peek()),
		exprStmt(ctx.push(un("!", un("!", member(id("iterObj"), "_done"))))),
		breakStmt(),
	];
}
```

**ITER_VALUE:** `var iterObj=Y();W(iterObj._value);break;` →

```typescript
function ITER_VALUE(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("iterObj", ctx.peek()),
		exprStmt(ctx.push(member(id("iterObj"), "_value"))),
		breakStmt(),
	];
}
```

**FORIN_NEXT:** `var fi=X();W(fi._keys[fi._idx++]);break;` →

```typescript
function FORIN_NEXT(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("fi", ctx.pop()),
		exprStmt(
			ctx.push(
				index(
					member(id("fi"), "_keys"),
					update("++", false, member(id("fi"), "_idx"))
				)
			)
		),
		breakStmt(),
	];
}
```

**FORIN_DONE:** `var fi=Y();W(fi._idx>=fi._keys.length);break;` →

```typescript
function FORIN_DONE(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("fi", ctx.peek()),
		exprStmt(
			ctx.push(
				bin(
					">=",
					member(id("fi"), "_idx"),
					member(member(id("fi"), "_keys"), "length")
				)
			)
		),
		breakStmt(),
	];
}
```

**GET_ITERATOR / FOR_OF_INIT:** More complex — calls `Symbol.iterator` on an object, creates iterator state. Use `member(id("Symbol"), "iterator")` for the well-known symbol.

**ASYNC variants:** Same patterns but may involve `awaitExpr()` for async iteration.

Read file for exact patterns. Apply to all 17 handlers.

-   [ ] **Step 1: Read file, update imports, convert all handlers**
-   [ ] **Step 2: Run tests** — all pass
-   [ ] **Step 3: Commit**

---

### Task 10: Convert registers.ts (2 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/handlers/registers.ts`

-   [ ] **Step 1: Read file, update imports, convert handlers**
-   [ ] **Step 2: Run tests** — all pass
-   [ ] **Step 3: Commit**

---

### Task 11: Convert generators.ts (2 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/handlers/generators.ts`

-   [ ] **Step 1: Read file, update imports, convert handlers**
-   [ ] **Step 2: Run tests** — all pass
-   [ ] **Step 3: Commit**

---

### Task 12: Convert superinstructions.ts (7 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/handlers/superinstructions.ts`

Superinstructions pack multiple operands into a single int32. The patterns involve bit extraction (`(O >>> 16) & 0xFFFF`, `O & 0xFFFF`) which maps to `bin("&", bin(">>>", id(ctx.O), lit(16)), lit(0xFFFF))`.

-   [ ] **Step 1: Read file, update imports, convert all handlers**
-   [ ] **Step 2: Run tests** — all pass
-   [ ] **Step 3: Commit**

---

## Chunk 3: Handler Migrations — Complex Patterns

### Task 13: Convert scope.ts (13 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/handlers/scope.ts`

This file has scope chain walking patterns that DON'T use `scopeWalk()` because they have global fallback logic after the while loop. Convert these manually.

-   [ ] **Step 1: Update imports**

```typescript
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
	obj,
	newExpr,
} from "../nodes.js";
```

-   [ ] **Step 2: Convert LOAD_SCOPED**

```typescript
function LOAD_SCOPED(ctx: HandlerCtx): JsNode[] {
	const curScope = member(id(ctx.SC), ctx.sV);
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		ifStmt(bin("in", id("name"), curScope), [
			exprStmt(ctx.push(index(curScope, id("name")))),
			breakStmt(),
		]),
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
		ifStmt(un("!", id("found")), [
			exprStmt(ctx.push(index(id("_g"), id("name")))),
		]),
		breakStmt(),
	];
}
```

-   [ ] **Step 3: Convert STORE_SCOPED** — same pattern with assignment instead of push

-   [ ] **Step 4: Convert declareHandler, pushScopeHandler, POP_SCOPE, TDZ_CHECK, TDZ_MARK, PUSH_WITH_SCOPE, DELETE_SCOPED, LOAD_GLOBAL, STORE_GLOBAL, TYPEOF_GLOBAL**

Each follows patterns from the conversion reference. `DELETE_SCOPED` uses `ctx.scopeWalk()`. `TYPEOF_GLOBAL` uses the manual while-loop pattern with global fallback.

-   [ ] **Step 5: Run tests** — all pass
-   [ ] **Step 6: Commit**

---

### Task 14: Convert compound-scoped.ts (8 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/handlers/compound-scoped.ts`

All handlers use `ctx.scopeWalk()`. With the new AST-returning `scopeWalk()`, conversion is mechanical.

-   [ ] **Step 1: Update imports and convert**

```typescript
import {
	type JsNode,
	id,
	index,
	member,
	assign,
	varDecl,
	exprStmt,
	ifStmt,
	breakStmt,
} from "../nodes.js";
```

**compoundScopedAssign:**

```typescript
function compoundScopedAssign(assignOp: string): HandlerFn {
	return (ctx) => [
		varDecl("val", ctx.pop()),
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		varDecl("s", id(ctx.SC)),
		...ctx.scopeWalk([
			exprStmt(assign(ctx.sv(), id("val"), assignOp)),
			exprStmt(ctx.push(ctx.sv())),
		]),
	];
}
```

**INC_SCOPED:**

```typescript
function INC_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		varDecl("s", id(ctx.SC)),
		...ctx.scopeWalk([
			exprStmt(assign(ctx.sv(), bin("+", ctx.sv(), lit(1)))),
			exprStmt(ctx.push(ctx.sv())),
		]),
	];
}
```

**POST_INC_SCOPED:**

```typescript
function POST_INC_SCOPED(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("name", index(id(ctx.C), id(ctx.O))),
		varDecl("s", id(ctx.SC)),
		...ctx.scopeWalk([
			varDecl("old", ctx.sv()),
			exprStmt(assign(ctx.sv(), bin("+", id("old"), lit(1)))),
			exprStmt(ctx.push(id("old"))),
		]),
	];
}
```

Apply the same pattern to DEC_SCOPED, POST_DEC_SCOPED, logicalScopedAssign, NULLISH_ASSIGN_SCOPED.

-   [ ] **Step 2: Run tests** — all pass
-   [ ] **Step 3: Commit**

---

### Task 15: Convert control-flow.ts (5 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/handlers/control-flow.ts`

-   [ ] **Step 1: Convert RETURN, RETURN_VOID, THROW, RETHROW**

See the spec document for complete RETURN conversion. THROW:

```typescript
function THROW(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("_te", ctx.pop()),
		...debugTrace(ctx, "THROW", lit("value="), id("_te")),
		throwStmt(id("_te")),
	];
}
```

RETHROW:

```typescript
function RETHROW(ctx: HandlerCtx): JsNode[] {
	return [
		ifStmt(id(ctx.HPE), [
			varDecl("ex", id(ctx.PE)),
			exprStmt(assign(id(ctx.PE), lit(null))),
			exprStmt(assign(id(ctx.HPE), lit(false))),
			throwStmt(id("ex")),
		]),
		breakStmt(),
	];
}
```

-   [ ] **Step 2: Run tests** — all pass
-   [ ] **Step 3: Commit**

---

### Task 16: Convert functions.ts (13 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/handlers/functions.ts`

This is the most complex handler file. Uses IIFE patterns with arrow/non-arrow branching, this-boxing, debug variants. Use helpers from `helpers.ts`.

-   [ ] **Step 1: Convert NEW_CLOSURE (non-debug)**

```typescript
function NEW_CLOSURE(ctx: HandlerCtx): JsNode[] {
	const nodes: JsNode[] = [
		varDecl("_cu", call(id(ctx.load), [index(id(ctx.C), id(ctx.O))])),
	];
	if (ctx.debug) {
		nodes.unshift(varDecl("_cuid", index(id(ctx.C), id(ctx.O))));
		// ... debug variant with _cuid tracing ...
	}
	nodes.push(
		ifStmt(
			member(id("_cu"), "a"),
			[exprStmt(ctx.push(buildArrowClosureIIFE(ctx)))],
			[exprStmt(ctx.push(buildRegularClosureIIFE(ctx)))]
		),
		breakStmt()
	);
	return nodes;
}
```

-   [ ] **Step 2: Convert NEW_FUNCTION, NEW_ARROW, NEW_ASYNC, NEW_GENERATOR_HANDLER**

Each is a simpler subset of NEW_CLOSURE. NEW_FUNCTION always uses `buildRegularClosureIIFE`. NEW_ARROW always uses `buildArrowClosureIIFE`. Build debug variants using `debugTrace()` helper.

-   [ ] **Step 3: Convert SET_FUNC_NAME, SET_FUNC_LENGTH** — try/catch with Object.defineProperty
-   [ ] **Step 4: Convert PUSH_CLOSURE_VAR, STORE_CLOSURE_VAR** — use `ctx.scopeWalk()`
-   [ ] **Step 5: Run tests** — all pass
-   [ ] **Step 6: Commit**

---

### Task 17: Convert classes.ts (19 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/handlers/classes.ts`

-   [ ] **Step 1: Read file, convert all handlers**

Key patterns: Object.defineProperty for methods/getters/setters, Object.create for prototype chain, IIFE-wrapped class construction, home object stamping (`fn._ho = target`). Representative conversions:

**DEFINE_METHOD:** `var fn=X();var target=Y();var key=C[O];Object.defineProperty(target,key,{value:fn,...});fn._ho=target;break;` →

```typescript
function DEFINE_METHOD(ctx: HandlerCtx): JsNode[] {
	return [
		varDecl("fn", ctx.pop()),
		varDecl("target", ctx.peek()),
		varDecl("key", index(id(ctx.C), id(ctx.O))),
		exprStmt(
			call(member(id("Object"), "defineProperty"), [
				id("target"),
				id("key"),
				obj(
					["value", id("fn")],
					["writable", lit(true)],
					["configurable", lit(true)],
					["enumerable", lit(false)]
				),
			])
		),
		exprStmt(assign(member(id("fn"), "_ho"), id("target"))),
		breakStmt(),
	];
}
```

**NEW_CLASS:** IIFE-wrapped constructor creation. This is the most complex pattern in classes.ts — uses an IIFE to isolate `var _ctor` so it doesn't hoist across multiple classes:

```typescript
function NEW_CLASS(ctx: HandlerCtx): JsNode[] {
	return [
		exprStmt(
			ctx.push(
				call(
					fnExpr(
						undefined,
						[],
						[
							// var _ctor = function(..._a){ ... };
							// ... prototype setup, extends ...
							returnStmt(id("_ctor")),
						]
					),
					[]
				)
			)
		),
		breakStmt(),
	];
}
```

**EXTENDS:** `var parent=X();var cls=Y();cls.prototype=Object.create(parent.prototype);...` — uses `call(member(id("Object"), "create"), [...])`.

**Home object stamping** pattern (`fn._ho = target`) repeats in DEFINE_METHOD, DEFINE_GETTER, DEFINE_SETTER — standardize with:

```typescript
exprStmt(assign(member(id("fn"), "_ho"), id("target")));
```

Read the file carefully — some handlers use dynamic (computed) keys via `SET_PROP_DYNAMIC` patterns, and DEFINE_GETTER/SETTER use `{get: fn}` / `{set: fn}` descriptor objects.

-   [ ] **Step 2: Run tests** — all pass
-   [ ] **Step 3: Commit**

---

## Chunk 4: Builder Migrations

### Task 18: Convert runners.ts (6 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/builders/runners.ts`

-   [ ] **Step 1: Convert buildRunners()**

```typescript
import {
	type JsNode,
	id,
	lit,
	bin,
	un,
	assign,
	call,
	member,
	fn,
	fnExpr,
	varDecl,
	exprStmt,
	ifStmt,
	returnStmt,
	arr,
} from "../nodes.js";
import { buildThisBoxing, debugTrace } from "../handlers/helpers.js";

export function buildRunners(debug: boolean, names: RuntimeNames): JsNode[] {
	const U = names.unit,
		A = names.args,
		OS = names.outer;
	const TV = names.tVal,
		NT = names.nTgt,
		HO = names.ho;

	const loadUnit = varDecl(U, call(id(names.load), [id("id")]));
	const debugEntry = debugTrace(
		{ debug, dbg: names.dbg } as any,
		"VM_DISPATCH",
		bin("+", lit("id="), id("id"))
	);
	const dispatchArgs = [
		id(U),
		bin("||", id(A), arr()),
		bin("||", id(OS), lit(null)),
		id(TV),
		id(NT),
		id(HO),
	];

	return [
		fn(
			names.vm,
			["id", A, OS, TV, NT, HO],
			[
				loadUnit,
				...debugEntry,
				ifStmt(member(id(U), "s"), [
					returnStmt(call(id(names.execAsync), dispatchArgs)),
				]),
				returnStmt(call(id(names.exec), dispatchArgs)),
			]
		),
		exprStmt(
			assign(
				member(id(names.vm), "call"),
				fnExpr(
					undefined,
					[TV, "id", A, OS, HO],
					[
						varDecl(U, call(id(names.load), [id("id")])),
						// this-boxing for .call variant
						ifStmt(
							bin(
								"&&",
								un("!", member(id(U), "a")),
								un("!", member(id(U), "st"))
							),
							[
								ifStmt(
									bin("==", id(TV), lit(null)),
									[
										exprStmt(
											assign(id(TV), id("globalThis"))
										),
									],
									[
										varDecl("_t", un("typeof", id(TV))),
										ifStmt(
											bin(
												"&&",
												bin(
													"!==",
													id("_t"),
													lit("object")
												),
												bin(
													"!==",
													id("_t"),
													lit("function")
												)
											),
											[
												exprStmt(
													assign(
														id(TV),
														call(id("Object"), [
															id(TV),
														])
													)
												),
											]
										),
									]
								),
							]
						),
						ifStmt(member(id(U), "s"), [
							returnStmt(
								call(id(names.execAsync), [
									id(U),
									bin("||", id(A), arr()),
									bin("||", id(OS), lit(null)),
									id(TV),
									un("void", lit(0)),
									id(HO),
								])
							),
						]),
						returnStmt(
							call(id(names.exec), [
								id(U),
								bin("||", id(A), arr()),
								bin("||", id(OS), lit(null)),
								id(TV),
								un("void", lit(0)),
								id(HO),
							])
						),
					]
				)
			)
		),
	];
}
```

-   [ ] **Step 2: Convert buildRouter()** — similar pattern with route map object and dispatch functions
-   [ ] **Step 3: Run tests** — all pass
-   [ ] **Step 4: Commit**

---

### Task 19: Convert loader.ts (4 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/builders/loader.ts`

-   [ ] **Step 1: Convert shared declarations** — replace `raw("[]")` with `arr()` and `raw("{}")` with `obj()`

-   [ ] **Step 2: Convert buildLoadFunction()** — The load function body has cache check, string branch (JSON parse or encrypted), object branch, constant revival loop. All expressible as ifStmt, forStmt, varDecl, call nodes.

-   [ ] **Step 3: Run tests** — all pass
-   [ ] **Step 4: Commit**

---

### Task 20: Convert decoder.ts (5 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/builders/decoder.ts`

RC4 cipher (key scheduling + stream generation), base64 polyfill, string constant decoder. All bit manipulation and loops — convert to nested BinOp, ForStmt, WhileStmt nodes.

-   [ ] **Step 1: Read file, convert all functions**
-   [ ] **Step 2: Run tests** — all pass
-   [ ] **Step 3: Commit**

---

### Task 21: Convert rolling-cipher.ts (3 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/builders/rolling-cipher.ts`

FNV-1a hash derivation and mix function. Dense bit manipulation — use file-local helpers:

```typescript
const xor = (a: JsNode, b: JsNode) => bin("^", a, b);
const ushr = (a: JsNode, n: number) => bin(">>>", a, lit(n));
```

-   [ ] **Step 1: Read file, convert all functions**
-   [ ] **Step 2: Run tests** — all pass
-   [ ] **Step 3: Commit**

---

### Task 22: Convert fingerprint.ts (6 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/builders/fingerprint.ts`

Murmur3-style hash finalizer. Same bit-manipulation pattern as rolling-cipher.

-   [ ] **Step 1: Read file, convert all functions**
-   [ ] **Step 2: Run tests** — all pass
-   [ ] **Step 3: Commit**

---

### Task 23: Convert stack-encoding.ts (1 raw call)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/builders/stack-encoding.ts`

> **NOTE:** There are TWO `buildStackEncodingProxy` functions — one in `stack-encoding.ts` (exported but possibly unused) and one private in `interpreter.ts` (line 360, the active one). Check which is actually called. If `stack-encoding.ts` is dead code, delete it and convert only the one in `interpreter.ts` (handled in Task 28 Step 5). If it IS used, convert it here and remove the duplicate from `interpreter.ts`.

Proxy handler for stack XOR encoding. Convert to `newExpr(id("Proxy"), [id("_seRaw"), obj(["set", fnExpr(...)], ["get", fnExpr(...)])])`.

-   [ ] **Step 1: Check import graph — determine which copy is active**
-   [ ] **Step 2: Convert or delete accordingly**
-   [ ] **Step 3: Run tests** — all pass
-   [ ] **Step 4: Commit**

---

### Task 24: Convert debug-logging.ts (4 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/builders/debug-logging.ts`

Debug config object, trace functions. Standard function declarations and console API calls.

-   [ ] **Step 1: Read file, convert all functions**
-   [ ] **Step 2: Run tests** — all pass
-   [ ] **Step 3: Commit**

---

### Task 25: Convert deserializer.ts (2 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/builders/deserializer.ts`

Binary bytecode deserialization with DataView reads. Complex but all standard JS: WhileStmt with DataView method calls, switch on tag values, array construction.

-   [ ] **Step 1: Read file, convert**
-   [ ] **Step 2: Run tests** — all pass
-   [ ] **Step 3: Commit**

---

### Task 26: Convert debug-protection.ts (2 raw calls)

**Files:**

-   Modify: `packages/ruam/src/ruamvm/builders/debug-protection.ts`

6-layer anti-debugger IIFE. Most complex builder — many nested functions, setTimeout, try-catch, timing checks. Still all standard JS constructs in AST form. Use file-local helpers for repeated patterns.

-   [ ] **Step 1: Read file, convert**
-   [ ] **Step 2: Run tests** — all pass
-   [ ] **Step 3: Commit**

---

### Task 27: Convert runtime/vm.ts (5 raw calls)

**Files:**

-   Modify: `packages/ruam/src/runtime/vm.ts`

Simple initialization patterns: integrity hash variable, watermark, callStack array, cache object.

-   [ ] **Step 1: Convert raw calls**

```typescript
// raw(`var ${names.ihash}=${integrityHash}`) →
varDecl(names.ihash, lit(integrityHash));

// raw("[]") → arr()
// raw("{}") → obj()
```

-   [ ] **Step 2: Run tests** — all pass
-   [ ] **Step 3: Commit**

---

## Chunk 5: Interpreter Pipeline + Cleanup

### Task 28: Convert interpreter scaffold to AST

**Files:**

-   Modify: `packages/ruam/src/ruamvm/builders/interpreter.ts`

This is the keystone change. The `buildScaffold()` template string becomes `buildScaffoldAST()` returning a `FnDecl` node. The switch is already AST — it just gets composed into the function body directly instead of being emitted to a string.

-   [ ] **Step 1: Create buildScaffoldAST() returning FnDecl**

The scaffold structure in AST:

```typescript
fn(
	fnName,
	[U, A, OS, TV, NT, HO],
	[
		// depth++
		exprStmt(update("++", false, id(depth))),
		// callStack.push(uid)
		varDecl("_uid_", bin("||", member(id(U), "_dbgId"), lit("?"))),
		exprStmt(call(member(id(callStack), "push"), [id("_uid_")])),
		// recursion guard
		ifStmt(bin(">", id(depth), lit(VM_MAX_RECURSION_DEPTH)), [
			exprStmt(update("--", false, id(depth))),
			exprStmt(call(member(id(callStack), "pop"), [])),
			throwStmt(
				newExpr(id("RangeError"), [
					bin(
						"+",
						bin("+", lit("Maximum call "), lit("s")),
						lit("tack size exceeded")
					),
				])
			),
		]),
		// try { ... } finally { depth--; callStack.pop(); }
		tryCatch(
			[
				// var declarations
				varDecl(S, arr()),
				varDecl(R, newExpr(id("Array"), [member(id(U), "r")])),
				varDecl(IP, lit(0)),
				// ... all other var declarations ...
				// _g global resolution
				varDecl("_g" /* typeof globalThis chain */),
				// rolling cipher init (conditional)
				// stack encoding (conditional)
				// dispatch loop: for(;;){ try { while(IP<_il) { switch... } } catch { ... } }
				varDecl("_il", member(id(I), "length")),
				forStmt(null, null, null, [
					tryCatch(
						[
							whileStmt(bin("<", id(IP), id("_il")), [
								varDecl(PH, index(id(I), id(IP))),
								varDecl(
									O,
									index(id(I), bin("+", id(IP), lit(1)))
								),
								exprStmt(
									assign(id(IP), bin("+", id(IP), lit(2)))
								),
								// rolling cipher decrypt (conditional)
								// debug trace (conditional)
								switchNode, // THE SWITCH — passed as parameter
							]),
							returnStmt(un("void", lit(0))),
						],
						"e",
						[
							// exception handling: EX check, catch/finally routing, continue
							// ... complete exception handler logic ...
						]
					),
				]),
			],
			undefined,
			undefined,
			[
				// finally block
				exprStmt(update("--", false, id(depth))),
				exprStmt(call(member(id(callStack), "pop"), [])),
			]
		),
	],
	{ async: isAsync }
);
```

-   [ ] **Step 2: Update buildExecFunction()**

```typescript
export function buildExecFunction(...): JsNode {
  const ctx = makeHandlerCtx(names, opts.isAsync, opts.debug);
  // Build switch cases
  const cases: CaseClause[] = [];
  for (const [op, handler] of registry) { ... }
  cases.push(caseClause(null, [breakStmt()])); // default
  const switchNode = switchStmt(id(ctx.PH), cases);

  // Build the complete function as AST
  const fnNode = buildScaffoldAST(names, opts.isAsync, opts.debug,
    opts.rollingCipher, opts.interpOpts, switchNode);

  // Apply tree-based local obfuscation
  return obfuscateLocalsNode(fnNode, opts.seed);
}
```

-   [ ] **Step 3: Add obfuscateLocalsNode() helper in transforms.ts**

```typescript
export function obfuscateLocalsNode(node: JsNode, seed: number): JsNode {
	if (node.type === "FnDecl") {
		const obfuscated = obfuscateLocals(node.body, seed);
		return { ...node, body: obfuscated };
	}
	return node;
}
```

-   [ ] **Step 4: Convert decoy handlers to AST**

Replace the raw string decoy bodies with AST-building functions:

```typescript
const decoyBuilders: ((
	S: string,
	P: string,
	C: string,
	O: string,
	R: string,
	SC: string,
	sV: string
) => JsNode[])[] = [
	(S, P) => [
		varDecl("b", stackPop(S, P)),
		exprStmt(assign(stackPeek(S, P), bin("+", stackPeek(S, P), id("b")))),
	],
	// ... 15 more patterns ...
];
```

-   [ ] **Step 5: Convert buildStackEncodingProxy() to return JsNode[]**

-   [ ] **Step 6: Run tests** — all pass
-   [ ] **Step 7: Commit**

---

### Task 29: Remove string-based post-processing

**Files:**

-   Modify: `packages/ruam/src/ruamvm/builders/interpreter.ts`

-   [ ] **Step 1: Delete `stringInlineStackOps()` function** (lines ~400-455)
-   [ ] **Step 2: Delete `stringObfuscateLocals()` function** (lines ~463-530)
-   [ ] **Step 3: Remove the W/X/Y function definitions from the scaffold AST** (they should already be gone from Task 28)
-   [ ] **Step 4: Run tests** — all pass
-   [ ] **Step 5: Commit**

---

### Task 30: Remove RawNode from the type system

**Files:**

-   Modify: `packages/ruam/src/ruamvm/nodes.ts`
-   Modify: `packages/ruam/src/ruamvm/emit.ts`
-   Modify: `packages/ruam/src/ruamvm/transforms.ts` (if needed)
-   Modify: `packages/ruam/test/ruamvm/emit.test.ts`
-   Modify: `packages/ruam/test/ruamvm/transforms.test.ts`

-   [ ] **Step 1: Verify no raw() calls remain anywhere**

Run: `grep -r "raw(" packages/ruam/src/ --include="*.ts" | grep -v "// " | grep -v "__regex__" | grep -v "\.raw"`
Expected: Only the `raw()` factory definition in nodes.ts and the `raw` property name references (unrelated).

-   [ ] **Step 2: Remove RawNode from nodes.ts**

Remove from `JsNode` union (line 51):

```typescript
| RawNode;
```

Remove interface (lines 253-256):

```typescript
export interface RawNode {
	type: "Raw";
	code: string;
}
```

Remove factory (lines 437-439):

```typescript
export function raw(code: string): RawNode { ... }
```

Remove from `CHILD_FIELDS` map (line 509):

```typescript
Raw: {},
```

**IMPORTANT:** All four removals are required. Missing the `CHILD_FIELDS` entry leaves dead metadata that suggests Raw nodes still exist.

-   [ ] **Step 3: Remove Raw case from emit.ts**

Remove:

```typescript
case "Raw":
  return node.code;
```

-   [ ] **Step 4: Update test files**

Remove raw node tests from `emit.test.ts` and `transforms.test.ts`.

-   [ ] **Step 5: Run typecheck to verify exhaustiveness**

Run: `npx tsc --noEmit`
Expected: Clean — the `assertNever` default case in emit.ts still covers all remaining node types.

-   [ ] **Step 6: Run tests** — all pass
-   [ ] **Step 7: Commit**

---

### Task 31: Remove legacy compat helpers and unused RuntimeNames fields

**Files:**

-   Modify: `packages/ruam/src/ruamvm/handlers/registry.ts`
-   Modify: `packages/ruam/src/runtime/names.ts`

-   [ ] **Step 1: Remove deprecated `svStr`, `curSvStr`, `scopeWalkStr`, `popStr`, `peekStr`, `pushStr` from HandlerCtx**

-   [ ] **Step 2: Remove `sPush`, `sPop`, `sPeek` from RuntimeNames interface and generation**

These fields are no longer emitted in the output since the W/X/Y function definitions are gone.

-   [ ] **Step 3: Update BLACKLIST in names.ts** — remove entries for the deleted names

-   [ ] **Step 4: Run tests** — all pass

-   [ ] **Step 5: Commit**

```bash
git commit -m "refactor: remove Raw node type, legacy helpers, and unused RuntimeNames fields"
```

---

### Task 32: Final verification and cleanup

-   [ ] **Step 1: Grep for any remaining raw() references**

```bash
grep -rn "raw(" packages/ruam/src/ --include="*.ts"
grep -rn "RawNode" packages/ruam/src/ --include="*.ts"
grep -rn "stringInlineStackOps\|stringObfuscateLocals" packages/ruam/src/ --include="*.ts"
```

Expected: Zero results.

-   [ ] **Step 2: Run full test suite**

Run: `npm run test`
Expected: All 1803 tests pass.

-   [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: Clean.

-   [ ] **Step 4: Build**

Run: `npm run build`
Expected: Clean build.

-   [ ] **Step 5: Run performance benchmark**

Run: `npx vitest run test/stress/performance.test.ts`
Expected: No regression — VM overhead multiplier should be within ~5% of baseline (~38-44x weighted average).

-   [ ] **Step 6: Update module JSDoc headers** in modified files to remove references to raw()

-   [ ] **Step 7: Commit**

```bash
git commit -m "chore: final cleanup — remove all raw() references from docs and comments"
```
