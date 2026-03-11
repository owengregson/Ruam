# Eliminate Raw Nodes — Full AST Pipeline

**Date:** 2026-03-10
**Status:** Approved

## Problem

The `raw()` node is an escape hatch that wraps opaque JS strings as AST nodes. 47 `raw()` calls across handlers (36) and builders (11) bypass AST traversal, tree transforms, and type safety. Two regex-based string post-processing passes (`stringInlineStackOps`, `stringObfuscateLocals`) force the interpreter to become a string blob mid-pipeline, making the entire function opaque.

## Solution

Eliminate all `raw()` usage by expressing every JS pattern with the existing 35 typed AST node types. Move all post-processing into AST tree transforms. Nothing becomes a string until the final `emit()` call.

## Pipeline Change

**Before:**
```
Handlers → JsNode[] (with raw) → emit() → stringInlineStackOps() regex
→ stringObfuscateLocals() regex → raw() wrapper → final string
```

**After:**
```
Handlers → JsNode[] (pure) → obfuscateLocals() tree transform → emit() → final string
```

## Key Insight: Zero New AST Node Types

All 47 raw patterns map to existing node types:

| Raw pattern | Existing AST |
|---|---|
| `while(s){if(name in s.sV){...break;}...}` | `WhileStmt` + `IfStmt` + `BreakStmt` |
| `(function(u,cs){...})(_cu,SC)` | `CallExpr(FnExpr(...), [...])` |
| `typeof x !== "object"` | `BinOp("!==", UnaryOp("typeof",...), Literal(...))` |
| `delete obj[key]` | `UnaryOp("delete", IndexExpr(...))` |
| `S[++P]=expr` | `StackPush` (already exists) |
| `(h^(h>>>16))*0x45d9f3b` | Nested `BinOp` nodes |
| `new Proxy(arr, {set:..., get:...})` | `NewExpr` + `ObjectExpr` + `FnExpr` |

The `break` ambiguity (break inside while within switch case) is not actually ambiguous — JS semantics correctly scope break to the innermost loop. The raw usage was caused by `scopeWalk()` being string-based, not by any AST limitation.

## Removals

- `RawNode` type, `raw()` factory, `Raw` case in emit/CHILD_FIELDS
- `stringInlineStackOps()` — `StackPush`/`StackPop`/`StackPeek` emit inline directly
- `stringObfuscateLocals()` — replaced by existing tree-based `obfuscateLocals()` from `transforms.ts`
- `W`/`X`/`Y` function definitions in scaffold — stack ops are inline AST nodes
- `ctx.W`/`ctx.X`/`ctx.Y` string fields on HandlerCtx
- `RuntimeNames.sPush`/`sPop`/`sPeek` fields

## Additions: Composable AST Helpers

### HandlerCtx changes

`scopeWalk`, `sv()`, `curSv()` return `JsNode`/`JsNode[]` instead of strings:

```typescript
// scopeWalk returns AST
scopeWalk: (body: JsNode[], key?: JsNode): JsNode[] => [
  whileStmt(id("s"), [
    ifStmt(bin("in", key, member(id("s"), sV)), [
      ...body,
      breakStmt(),
    ]),
    exprStmt(assign(id("s"), member(id("s"), sPar))),
  ]),
  breakStmt(),
]

// sv() returns JsNode
sv: (key?: JsNode) => index(member(id("s"), sV), key)

// curSv() returns JsNode
curSv: (key?: JsNode) => index(member(id(scope), sV), key)
```

### Shared handler helpers

**`buildThisBoxing()`** — Returns `JsNode[]` for sloppy-mode this-boxing (used by 6+ handlers):
```typescript
function buildThisBoxing(): JsNode[] {
  return [
    varDecl("_tv", id("this")),
    ifStmt(un("!", member(id("u"), "st")), [
      ifStmt(bin("==", id("_tv"), lit(null)), [
        exprStmt(assign(id("_tv"), id("globalThis"))),
      ], [
        varDecl("_tt", un("typeof", id("_tv"))),
        ifStmt(bin("&&",
          bin("!==", id("_tt"), lit("object")),
          bin("!==", id("_tt"), lit("function"))
        ), [exprStmt(assign(id("_tv"), call(id("Object"), [id("_tv")])))]),
      ]),
    ]),
  ];
}
```

**`debugTrace()`** — Conditional debug call (returns `[]` when debug is off).

**`buildClosureIIFE()`** — Reusable IIFE wrapper for closure creation with sync/async branching.

**Bit-manipulation helpers** — File-local `xor()`, `ushr()`, `shl()`, `mul()` for crypto builders.

## Handler Migration Pattern

**Before (compound-scoped.ts):**
```typescript
function compoundScopedAssign(assignOp: string): HandlerFn {
  return (ctx) => {
    const sv = ctx.sv();
    return [
      raw(
        `var val=${ctx.X}();var name=${ctx.C}[${ctx.O}];var s=${ctx.SC};` +
          ctx.scopeWalk(`${sv}${assignOp}val;${ctx.W}(${sv});`)
      ),
    ];
  };
}
```

**After:**
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

**Before (RETURN handler):**
```typescript
function RETURN(ctx: HandlerCtx): JsNode[] {
  return [
    raw(
      `var _rv=${ctx.S}[${ctx.P}--];` +
        `if(${ctx.EX}&&${ctx.EX}.length>0){var _h=${ctx.EX}[${ctx.EX}.length-1];` +
        `if(_h._fi>=0){${ctx.CT}=1;${ctx.CV}=_rv;${ctx.EX}.pop();` +
        `${ctx.P}=_h._sp;${ctx.IP}=_h._fi*2;break;}}return _rv;`
    ),
  ];
}
```

**After:**
```typescript
function RETURN(ctx: HandlerCtx): JsNode[] {
  return [
    varDecl("_rv", ctx.pop()),
    ...debugTrace(ctx, "RETURN", lit("value="), id("_rv")),
    ifStmt(
      bin("&&", id(ctx.EX), bin(">", member(id(ctx.EX), "length"), lit(0))),
      [
        varDecl("_h", index(id(ctx.EX), bin("-", member(id(ctx.EX), "length"), lit(1)))),
        ifStmt(bin(">=", member(id("_h"), "_fi"), lit(0)), [
          exprStmt(assign(id(ctx.CT), lit(1))),
          exprStmt(assign(id(ctx.CV), id("_rv"))),
          exprStmt(call(member(id(ctx.EX), "pop"), [])),
          exprStmt(assign(id(ctx.P), member(id("_h"), "_sp"))),
          exprStmt(assign(id(ctx.IP), bin("*", member(id("_h"), "_fi"), lit(2)))),
          breakStmt(),
        ]),
      ]
    ),
    returnStmt(id("_rv")),
  ];
}
```

## Builder Migration Pattern

All builder files (`runners.ts`, `loader.ts`, `decoder.ts`, `rolling-cipher.ts`, `fingerprint.ts`, `debug-protection.ts`, `debug-logging.ts`, `stack-encoding.ts`, `deserializer.ts`) convert from template strings to AST composition with file-local helpers for repeated patterns.

**`buildRunners()` example — before:**
```typescript
return [
  raw(`function ${names.vm}(id,${A},...){var ${U}=${names.load}(id);...}`),
  raw(`${names.vm}.call=function(${TV},id,...){...};`),
];
```

**After:**
```typescript
return [
  fn(names.vm, ["id", A, OS, TV, NT, HO], [
    varDecl(U, call(id(names.load), [id("id")])),
    ifStmt(member(id(U), "s"), [
      returnStmt(call(id(names.execAsync), [id(U), bin("||", id(A), arr()), ...])),
    ]),
    returnStmt(call(id(names.exec), [id(U), bin("||", id(A), arr()), ...])),
  ]),
  exprStmt(assign(member(id(names.vm), "call"),
    fnExpr(undefined, [TV, "id", A, OS, HO], [
      ...buildThisBoxing(),
      // ...dispatch logic...
    ])
  )),
];
```

## Interpreter Pipeline Change

**`buildExecFunction()` — before:**
```typescript
const switchStr = emit(switchNode);
let funcStr = buildScaffold(..., switchStr);
funcStr = stringInlineStackOps(funcStr, ...);
funcStr = stringObfuscateLocals(funcStr, ...);
return raw(funcStr);
```

**After:**
```typescript
const fnNode = buildScaffoldAST(..., switchNode);  // returns FnDecl
return obfuscateLocalsNode(fnNode, opts.seed);       // tree transform
// emit() called by final assembly stage
```

`buildScaffoldAST()` returns a `FnDecl` node with the dispatch loop (`ForStmt(null,null,null,[TryCatchStmt(...)])`) containing the switch directly as an AST node. Stack operations in the scaffold use `StackPush` nodes. The `W`/`X`/`Y` function definitions are not emitted.

## Implementation Order

Each step must preserve all 1803 passing tests.

1. Add AST-returning overloads to HandlerCtx (`sv()`, `curSv()`, `scopeWalk()`)
2. Convert handler files one at a time (19 files)
3. Convert builder files one at a time (12 files)
4. Convert interpreter scaffold to AST
5. Wire up tree-based `obfuscateLocals()` as sole renaming pass
6. Remove string-based post-processing (`stringInlineStackOps`, `stringObfuscateLocals`, W/X/Y defs)
7. Remove `RawNode` from type system
8. Clean up unused RuntimeNames fields

## Metrics

| Metric | Before | After |
|---|---|---|
| `raw()` calls | 47 | 0 |
| AST node types | 36 (incl. Raw) | 35 |
| Obfuscation mechanisms | 2 (tree + regex) | 1 (tree) |
| Post-processing regex passes | 2 | 0 |
| String intermediates | 2 | 0 |
