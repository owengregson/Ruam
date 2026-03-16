# Unified Naming System Design

**Date:** 2026-03-16
**Status:** Draft
**Scope:** Replace all 6 naming systems with a single `NameRegistry` + `NameScope` + `NameToken` architecture

## Problem

The codebase has 6 independent naming systems that generate randomized identifiers for the obfuscated output:

| System | Source File | Pattern | PRNG |
|--------|-------------|---------|------|
| RuntimeNames (~45 ids) | `encoding/names.ts` | 2-3 char, sometimes `_` prefix | LCG (main seed) |
| TempNames (~80 ids) | `encoding/names.ts` | 1-2 char, `_` prefix | Same LCG |
| Scatter fragment names | `assembler.ts` (`createScatterNameGen`) | 4 char, `_` prefix | Separate LCG (`seed ^ 0xfeed4321`) |
| Hex preprocessed names | `preprocess.ts` | `_0x0000` sequential | Not random |
| obfuscateLocals renames | `ruamvm/transforms.ts` | 2-3 char alpha | Independent LCG |
| Inline handler/builder locals | `ruamvm/handlers/*.ts`, `ruamvm/builders/*.ts` | 2-3 char via `obfuscateLocals` post-pass | Independent LCG |

Note: The codebase uses prototypal scope chains (`Object.create(parent)` / `Object.getPrototypeOf(scope)`), so there are no hardcoded `sPar`/`sVars`/`sTdz` property names to replace. Scope chain naming is not a separate naming system.

Problems:
- Scatter names use a completely separate LCG with their own `used` set — potential collisions with RuntimeNames/TempNames
- `obfuscateLocals` uses its own independent naming with its own collision logic
- Hundreds of hardcoded `varDecl("s", ...)` / `id("name")` calls across 30+ handler/builder files are renamed by `obfuscateLocals` post-pass — implicit, hard to trace
- LCG sequence stability hacks (unused `stp`, deferred poly names) needed to avoid breaking generation order
- Preprocessing uses sequential hex patterns, not randomized
- No single place to inspect, debug, or validate all names in a build
- Adding new features requires understanding which naming system to plug into

## Solution

A unified `NameRegistry` that owns ALL per-build randomized identifiers. Names exist as opaque `NameToken` handles throughout the entire pipeline. A single `resolveAll()` call assigns collision-free strings to every token at once.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Preprocessing names | Unified | One system for all names, including user code renames |
| Variable representation | Symbolic `NameToken` everywhere | No strings until final emit — fail-fast on premature access |
| Inline handler/builder locals | Claimed as tokens via `ctx.local()` | Eliminates `obfuscateLocals` post-pass |
| Shielded mode | Hierarchical namers (root + children per group) | Mirrors IIFE tier structure |
| PRNG seeding | Per-scope child PRNGs derived from parent seed | Isolation — adding names in one scope doesn't affect others |
| Character set | Full alphanumeric (`a-zA-Z0-9`) | Maximum entropy per character |
| obfuscateLocals | Eliminated | All names claimed as tokens upfront — no post-processing rename pass |
| `_` prefix | None | Collisions prevented structurally, not by prefix convention |
| Encoding alphabet | Owned by registry | Single source of truth for all seed-derived randomization |
| Architecture | Central `NameRegistry` (Approach 1) | Best expandability — global view, easy debugging, natural place for new features |

## Core Data Model

### NameToken

An opaque handle representing a name that doesn't have a string value yet.

```typescript
class NameToken {
  readonly key: string;                    // canonical key, e.g. "stack", "returnValue"
  readonly scope: NameScope;               // owning scope
  private _resolved: string | null = null;

  get name(): string {
    if (this._resolved === null) {
      throw new Error(`NameToken "${this.key}" not yet resolved`);
    }
    return this._resolved;
  }

  toString(): string {
    return this.name;  // same fail-fast behavior
  }

  resolve(value: string): void {
    this._resolved = value;
  }
}
```

- `key` is human-readable, used for debugging/lookup, never appears in output
- `name` and `toString()` both throw if accessed before resolution (fail-fast)
- `toString()` is critical: the emitter uses `params.join(",")` which calls `.toString()` on each element. Without it, `NameToken` in params arrays would emit as `[object Object]`.
- Created only via `NameScope.claim()`, never directly

### NameScope

A child scope within the registry with its own PRNG.

```typescript
class NameScope {
  readonly id: string;                     // e.g. "shared", "group0", "preprocessing"
  readonly parent: NameScope | null;
  readonly tokens: Map<string, NameToken>; // key -> token
  readonly children: NameScope[];
  readonly lengthTier: LengthTier;
  private prng: LCG;

  claim(key: string): NameToken;
  claimMany(keys: string[]): Record<string, NameToken>;
}
```

- `lengthTier` determines name length range for this scope
- PRNG derived deterministically: `childSeed = fnv1a(parentSeed, scopeId)` using the existing FNV-1a hash from `constants.ts`
- `claim()` validates key uniqueness within the scope

### NameRegistry

The central coordinator.

```typescript
class NameRegistry {
  private root: NameScope;
  private globalUsed: Set<string>;         // all resolved names across all scopes
  private resolved: boolean = false;

  createScope(id: string, opts?: {
    parent?: NameScope;
    lengthTier?: LengthTier;
  }): NameScope;
  resolveAll(): void;
  dumpAll(): Map<string, string>;          // key -> resolved name, for debugging
  getAlphabet(): string;                   // 64-char encoding alphabet
}
```

- `resolveAll()` walks scopes depth-first (parent before children), assigns random strings, checks against `globalUsed`
- Once resolved, registry is frozen — no new tokens can be claimed
- `globalUsed` is pre-populated with JS reserved words and excluded names

## Length Tiers

```typescript
type LengthTier = "short" | "medium" | "long";

const LENGTH_RANGES: Record<LengthTier, [min: number, max: number]> = {
  short:  [2, 3],   // high-frequency handler locals
  medium: [3, 4],   // infrastructure, preprocessing
  long:   [4, 5],   // scattered key fragments
};
```

PRNG picks length uniformly from tier range. First char always alphabetic (`a-zA-Z`, 52 options). Subsequent chars full alphanumeric (`a-zA-Z0-9`, 62 options).

## Scope Hierarchy

### Standard (non-shielded)

```
registry (root)
+-- "shared"        [medium]  -- VM infrastructure (cache, deserializer, fingerprint, etc.)
+-- "interpreter"   [short]   -- interpreter state (stack, IP, registers, etc.)
+-- "handlers"      [short]   -- handler locals (return value, target, iterator, etc.)
+-- "scatter"       [long]    -- scattered key fragments
+-- "preprocessing" [medium]  -- user code identifier renames
+-- "codec"         [N/A]     -- encoding alphabet (special resolution)
```

### Shielded

```
registry (root)
+-- "shared"        [medium]  -- cross-group infrastructure
+-- "codec"         [N/A]     -- encoding alphabet
+-- "group0"
|   +-- "interpreter" [short]
|   +-- "handlers"    [short]
|   +-- "scatter"     [long]
+-- "group1"
|   +-- "interpreter" [short]
|   +-- "handlers"    [short]
|   +-- "scatter"     [long]
+-- "preprocessing" [medium]
```

## Resolution Algorithm

### Order

`resolveAll()` walks depth-first, parent before children:

1. shared
2. codec (special: Fisher-Yates shuffle of `A-Za-z0-9_$`, not an identifier)
3. interpreter (or per-group interpreters)
4. handlers (or per-group handlers)
5. scatter (or per-group scatter)
6. preprocessing

### Per-Token

```
1. Draw length from scope's LengthTier range using scope PRNG
2. Generate candidate:
   - char[0]: PRNG pick from [a-zA-Z] (52 chars)
   - char[1..n]: PRNG pick from [a-zA-Z0-9] (62 chars)
3. If candidate in globalUsed or JS reserved word -> retry
4. Add candidate to globalUsed
5. Write candidate into token._resolved
```

Retry bounded: after 50 retries at current length, bump minimum length by 1 (adaptive).

### Alphabet

Codec scope uses Fisher-Yates shuffle of `A-Za-z0-9_$` (64 chars) from codec PRNG. Not added to `globalUsed`.

## AST Integration

### JsNode Type Changes

The `NameToken | string` union type must be applied to ALL node types that carry identifier names, not just `Id`:

```typescript
type Name = NameToken | string;

// All affected node types:
interface Id         { type: "Id";        name: Name }
interface VarDecl    { type: "VarDecl";   name: Name; init?: JsNode }
interface ConstDecl  { type: "ConstDecl"; name: Name; init?: JsNode }
interface FnDecl     { type: "FnDecl";    name: Name; params: Name[]; body: JsNode[] }
interface FnExpr     { type: "FnExpr";    name?: Name; params: Name[]; body: JsNode[] }
interface ArrowFn    { type: "ArrowFn";   params: Name[]; body: JsNode | JsNode[] }
interface ForInStmt  { type: "ForIn";     decl: Name; ... }
interface TryCatch   { type: "TryCatch";  param?: Name; ... }
interface MemberExpr { type: "Member";    prop: Name; ... }  // computed=false only
// Stack nodes (StackPush.S, StackPop.S, StackPeek.S) also need Name

// Object entry sub-types:
interface GetterEntry { name: Name; body: JsNode[] }
interface SetterEntry { name: Name; param: Name; body: JsNode[] }
interface MethodEntry { name: Name | JsNode; params: Name[]; body: JsNode[] }
type PropEntry = [Name | JsNode, JsNode];  // string key becomes Name
```

All corresponding factory functions (`ident()`, `varDecl()`, `fnDecl()`, `getter()`, `setter()`, `method()`, etc.) accept `Name`. Raw strings remain valid for JS builtins (`"Object"`, `"Array"`, `"undefined"`, etc.) that must not be randomized.

Note: `structural-transforms.ts` creates synthetic `VarDecl` nodes with `name: "__chain__"` that are never emitted directly — these remain as plain strings.

### Emit Phase

`ruamvm/emit.ts` gains a helper to resolve names everywhere they appear:

```typescript
function resolveName(name: Name): string {
  return name instanceof NameToken ? name.name : name;
}
```

Every emit case that outputs an identifier calls `resolveName()`. This is a systematic change across all ~36 node type emit cases, but each change is mechanical: replace `node.name` with `resolveName(node.name)`.

**Emitter migration details:**

1. **`typeof === "string"` discrimination in `emitObjectEntry`**: The emitter uses `typeof k === "string"` to distinguish string property keys from computed `JsNode` keys (for `PropEntry`, `MethodEntry`). With `NameToken`, this becomes a three-way check. Use a type guard:
   ```typescript
   function isName(v: unknown): v is Name {
     return typeof v === "string" || v instanceof NameToken;
   }
   ```
   Replace `typeof k === "string"` with `isName(k)` in all object entry emit cases. Without this, `NameToken` keys would be treated as computed expressions and wrapped in `[...]` brackets.

2. **`startsWith("...")` for arrow param parenthesization**: The emitter uses `params[0].startsWith("...")` to decide whether single-param arrows need parentheses. Replace with `params[0] instanceof RestParam`.

3. **`params.join(",")` calls**: Already handled by `NameToken.toString()` and `RestParam.toString()`.

4. **Template literal interpolation** (`${node.name}`): Already handled by `NameToken.toString()`.

`resolveAll()` must be called before `emit()`. The fail-fast NameToken getter guarantees this.

### Rest Parameters

The current `rest(name: string): string` function returns `...${name}` — a string with `...` baked in. This is incompatible with `NameToken` since the token must resolve independently of the `...` prefix.

Solution: `rest()` becomes a marker on the param, not string manipulation. Two options:

**Option chosen: emit-time prefix.** `rest()` wraps the name in a `RestParam` marker object:

```typescript
class RestParam {
  constructor(readonly name: Name) {}
  toString(): string {
    return `...${resolveName(this.name)}`;
  }
}
function rest(name: Name): RestParam { return new RestParam(name); }
```

Params type becomes `(Name | RestParam)[]`. The emitter handles `RestParam` by emitting `...` + the resolved name. `obfuscateLocals` no longer needs to strip/re-add `...` prefixes since it's eliminated.

### HandlerCtx Helper Methods

`HandlerCtx` currently has convenience methods like `sv()`, `curSv()`, and `scopeWalk()` that create AST fragments using hardcoded local names like `id("s")` and `id("name")`. These are handler-local names that `obfuscateLocals` renames.

In the new system, these helpers accept a `NameToken` parameter instead of using hardcoded defaults:

```typescript
// Before: scopeWalk(expr) -> uses hardcoded id("s"), id("name")
// After:  scopeWalk(expr, ctx.local("walkScope"), ctx.local("walkName"))
```

The helper methods are updated to require token parameters. Each handler calls `ctx.local()` for its own scope and passes the tokens to the helper. This ensures handler-local scoping is respected.

### Babel AST Boundary

`replaceFunctionBody` in `transform.ts` builds function stubs using Babel AST nodes (`t.identifier()`), which require `string` not `NameToken`. This code runs AFTER `resolveAll()`, so it calls `token.name` to get the resolved string. This boundary is explicitly post-resolution.

## Replacement Mapping

### RuntimeNames -> Shared + Interpreter Scopes

The ~45 RuntimeNames fields become token claims across scopes:

```typescript
const shared = registry.createScope("shared", { lengthTier: "medium" });
const interp = registry.createScope("interpreter", { lengthTier: "short" });

// Shared infrastructure
const cache    = shared.claim("cache");
const depth    = shared.claim("depth");
const deser    = shared.claim("deserializer");

// Interpreter state
const stk      = interp.claim("stack");
const ip       = interp.claim("instructionPointer");
const regs     = interp.claim("registers");
```

Canonical keys are descriptive (`"stack"` not `"stk"`) — they're documentation, never emitted.

### TempNames -> Handlers Scope

The ~80 TempNames become claims in the handlers scope:

```typescript
const handlers = registry.createScope("handlers", { lengthTier: "short" });

const returnValue  = handlers.claim("returnValue");
const catchIndex   = handlers.claim("catchIndex");
const iterator     = handlers.claim("iterator");
```

### HandlerCtx

All fields become `NameToken`:

```typescript
interface HandlerCtx {
  S: NameToken;      // stack
  IP: NameToken;     // instruction pointer
  C: NameToken;      // constants array
  O: NameToken;      // operand
  // ... all other fields
  t: (key: string) => NameToken;  // handler-level shared locals
  local: (key: string) => NameToken;  // per-handler locals (see below)
}
```

Handler code is unchanged at the call site — `ident(ctx.S)` works the same, just with a token instead of a string.

### Handler-Local Variables (replacing obfuscateLocals)

Currently, handlers use hardcoded short names like `varDecl("s", ...)`, `id("name")`, `id("val")` across 30+ files. `obfuscateLocals()` renames these post-hoc. In the new system:

**Shared handler locals** (`ctx.t()`): Variables that appear across many handlers with the same semantic meaning (e.g., `"_rv"` for return value, `"_a"` for arguments array) are pre-claimed in the handlers scope. These get ONE token shared across all handlers — the same resolved name appears in every handler that uses it. This matches the current TempNames behavior. ~80 tokens.

**Per-handler locals** (`ctx.local()`): Variables unique to a single handler's implementation (e.g., `"s"` for a scope walk variable in one handler, `"cls"` for a class reference in another). These are claimed lazily via `ctx.local(key)` which creates a token in a per-handler sub-scope. Tokens are scoped to the handler closure, so the same canonical key in different handlers gets different resolved names (since each handler has its own sub-scope).

```typescript
// Before (hardcoded string, renamed by obfuscateLocals):
const s = varDecl("s", expr);

// After (claimed token, no post-processing):
const s = varDecl(ctx.local("scopeWalk"), expr);
```

**Token count**: ~80 shared (same as TempNames today) + ~5-15 per handler × ~100 handlers = ~500-1500 per-handler tokens. Well within LCG capacity at 2-3 char length (52 × 62 = 3,224 unique 2-char names).

**Implementation**: `makeHandlerCtx` creates a handler-local `NameScope` child per handler. The `local()` method claims from that child scope. Since each handler's closure is an independent function, name reuse across handler closures is safe — but the unified system still prevents collisions globally.

Similarly, each builder file (`builders/*.ts`) that creates local variables gets its own builder-local scope via the same mechanism.

### Scatter Names -> Scatter Scope

`createScatterNameGen()` eliminated. Fragment names from scatter scope:

```typescript
const scatter = registry.createScope("scatter", { lengthTier: "long" });

// When fragmenting key material:
for (let i = 0; i < fragmentCount; i++) {
  const fragToken = scatter.claim(`${material.name}_frag${i}`);
}
```

### obfuscateLocals -> Eliminated

Every variable builders create is a claimed token (via `ctx.local()` for per-handler locals, or `ctx.t()` for shared handler locals). No post-processing rename pass. See "Handler-Local Variables" section above for the detailed migration mechanism.

### Preprocessing -> Preprocessing Scope

```typescript
const preproc = registry.createScope("preprocessing", { lengthTier: "medium" });

// For each user identifier:
const renamed = preproc.claim(`user_${originalName}`);
```

No more sequential `_0x0000` pattern — fully randomized.

### Encoding Alphabet -> Codec Scope

```typescript
const codec = registry.createScope("codec");
const alphabet = registry.getAlphabet();  // resolved during resolveAll()
```

## Pipeline Integration

### Standard Pipeline

```
1. Generate CSPRNG seed
2. Create NameRegistry(seed)
3. Create scopes (shared, interpreter, handlers, scatter, preprocessing, codec)
4. Claim all infrastructure tokens (shared, interpreter state, handler locals)
5. Run preprocessing (claims user identifier tokens in preprocessing scope)
6. Parse source -> identify target functions
7. Compile each function to BytecodeUnit (compiler uses scope chain property tokens)
8. Registry.resolveAll() — all tokens get string values, guaranteed collision-free
9. Generate VM runtime AST (builders use resolved tokens via .name getter)
10. Encode bytecode units (using resolved alphabet + key anchor)
11. Emit final JS output
```

Step 8 is the single resolution point. Everything before it works with tokens. Everything after reads `.name`.

### Shielded Pipeline

```
1. Generate CSPRNG seed + per-group seeds
2. Create NameRegistry(seed)
3. Create shared scope + codec scope
4. Claim shared infrastructure tokens
5. For each shielding group:
   a. Create group scope (child of root)
   b. Create interpreter/handlers/scatter scopes (children of group)
   c. Claim per-group tokens
6. Create preprocessing scope, claim user identifier tokens
7. Compile all units
8. Registry.resolveAll() — resolves shared first, then each group's tree
9. Generate per-group VM runtime ASTs
10. Encode units per-group
11. Emit output
```

### 2-Pass Compilation Compatibility

- Pass 1 (compile): uses tokens, doesn't need resolved names
- Pass 2 (generate runtime): builds AST with tokens, produces key anchor from handler table structure
- **Resolution**: `resolveAll()` runs between AST construction and emit
- Pass 3 (encode): uses resolved alphabet + key anchor

**Integrity binding timing**: When `integrityBinding` is enabled, the integrity hash is computed by emitting the interpreter to a string (`fnv1a(interpSource)`). This requires resolved names since `emit()` calls `token.name`. Therefore `resolveAll()` must run BEFORE the integrity hash computation — i.e., after AST construction but before the integrity emit. The integrity hash naturally incorporates per-build randomized names (this matches current behavior where RuntimeNames are already resolved before integrity computation).

Pipeline with integrity binding:
```
1-7. (same as standard pipeline)
8. Registry.resolveAll()
9. Build interpreter AST (tokens already resolved)
10. Emit interpreter to string -> compute integrity hash
11. Fold integrity hash into key anchor
12. Encode bytecode units
13. Emit final output
```

## Property Key Collision Risk

Some generated names are used as property keys on internal objects (e.g., `_ho` on function objects for home object, exception handler object properties). These coexist with user-code properties. Without the old `_` prefix convention, there is a theoretical collision risk where a user object has a property matching a random generated name.

Mitigation: these property names are claimed tokens in the shared or handler scope. The `globalUsed` set prevents them from colliding with each other. User-property collision is astronomically unlikely at 3-4 char names from a 52×62^n space, and the current `_` prefix provides no real namespace isolation either (users can have `_ho` properties too). The risk is accepted.

## Determinism Note

Builds with the same CSPRNG seed will produce DIFFERENT output after migration (different PRNG derivation, different character set, different length tiers). This is expected and acceptable — every build already uses `crypto.randomBytes(4)` for a fresh seed, so no two builds produce the same output anyway. There is no backwards-compatibility constraint on output format.

## File Changes

### New Files

- `src/naming/registry.ts` — `NameRegistry` class
- `src/naming/scope.ts` — `NameScope` class
- `src/naming/token.ts` — `NameToken` class
- `src/naming/index.ts` — barrel exports
- `src/naming/reserved.ts` — JS reserved words, excluded names

### Major Modifications

**Core type system (high impact):**
- `src/ruamvm/nodes.ts` — ALL node types with name fields accept `NameToken | string` (Id, VarDecl, ConstDecl, FnDecl, FnExpr, ArrowFn, ForInStmt, TryCatch, MemberExpr, Stack nodes)
- `src/ruamvm/emit.ts` — `resolveName()` helper called in every emit case that outputs an identifier (~36 node types)

**Pipeline orchestration:**
- `src/transform.ts` — create registry, claim tokens, call `resolveAll()`, integrity binding timing
- `src/ruamvm/assembler.ts` — receive scopes instead of `RuntimeNames`/`TempNames`, remove `createScatterNameGen()`

**Handler/builder migration (largest scope of change):**
- `src/ruamvm/handlers/registry.ts` — `HandlerCtx` fields become `NameToken`, add `local()` method
- `src/ruamvm/handlers/*.ts` — ALL 20+ handler files: convert every `varDecl("s", ...)` / `id("name")` to `varDecl(ctx.local("scopeWalk"), ...)` / `ident(ctx.local("name"))`. ~100-200 call sites across all handler files.
- `src/ruamvm/builders/*.ts` — ALL 10 builder files: same migration for builder-local variables. Each builder gets its own local scope. ~50-100 call sites.

**Other:**
- `src/preprocess.ts` — use preprocessing scope instead of hex counter
- `src/types.ts` — update `RuntimeNames`/`TempNames` type references if still exported

### Removed

- `src/encoding/names.ts` — entirely replaced by `src/naming/`
- `obfuscateLocals()` from `src/ruamvm/transforms.ts` (keep `renameNode()` if used by other transforms)
- `createScatterNameGen()` from `assembler.ts`
- `generateAlphabet()` from `encoding/decoder.ts` (moved into registry)

### Test Impact

- All 1882 tests should still pass — behavioral semantics unchanged
- Test helper wraps `obfuscateCode` + `eval`, so output format changes are transparent
- Some `test/security/` tests that assert output characteristics (name patterns, randomization properties) may need updating since the naming format changes
- New unit tests for `NameRegistry`, `NameScope`, `NameToken`
