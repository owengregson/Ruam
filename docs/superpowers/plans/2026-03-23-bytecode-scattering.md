# Bytecode Scattering Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the most obvious VM fingerprint — long encoded strings assigned to an object — by splitting each bytecode unit into heterogeneous fragments (strings, packed integers, char code arrays) scattered throughout the output.

**Architecture:** All code is generated via the `JsNode` AST system — no raw JS strings. Two components:

1. **Unpack builder** (`ruamvm/builders/unpack.ts`) — builds the packed-integer decoder as `JsNode[]`, included in the assembler's node tree so it goes through `obfuscateLocals`, MBA, structural transforms — just like every other runtime component.

2. **Scatter engine** (`ruamvm/bytecode-scatter.ts`) — takes encoded bytecode strings (available post-encoding in transform.ts), splits them into fragments, returns `JsNode[]` for fragment declarations and a `JsNode` reassembly expression. Lives in `ruamvm/` alongside other AST-based transforms (string-atomization, scattered-keys, handler-fragmentation). Transform.ts serializes these via `emit()` and parses with Babel for insertion, following the same flow as the existing runtime source.

Result: `bt["id"] = "veryLongString"` becomes scattered `var Xk = "sho"; var Rm = [0x7A386B4C, ...]; ... bt["id"] = Xk + _up(Rm) + Qd;`

**Tech Stack:** JsNode AST (`ruamvm/nodes.ts`), `emit()`, NameScope, existing LCG PRNG

---

## File Structure

| Action | Path (relative to `packages/ruam/`) | Responsibility |
|--------|------|----------------|
| Create | `src/ruamvm/builders/unpack.ts` | JsNode[] builder for packed-integer unpack function |
| Create | `src/ruamvm/bytecode-scatter.ts` | JsNode-based fragment generation + reassembly |
| Modify | `src/ruamvm/assembler.ts` | Include unpack builder in runtime when scattering enabled |
| Modify | `src/transform.ts` | Call scatter engine, emit/parse JsNodes, scatter fragments |
| Modify | `src/types.ts` | Add `bytecodeScattering` option |
| Modify | `src/presets.ts` | Enable in medium/max presets |
| Modify | `src/naming/claims.ts` | Add `unpack` to `RUNTIME_POST_TEMP_KEYS` + `SHARED_RUNTIME_KEYS` |
| Modify | `src/naming/compat-types.ts` | Add `unpack` to `RuntimeNames` |
| Modify | `src/naming/setup.ts` | Wire `unpack` into `buildRuntimeNames` |
| Create | `test/security/bytecode-scatter.test.ts` | Unit + integration tests |
| Modify | `test/security/feature-combinations.test.ts` | Scatter combo tests |

---

## Chunk 1: Unpack Builder + Naming

### Task 1: Naming system changes

**Files** (all relative to `packages/ruam/`):
- Modify: `src/types.ts`
- Modify: `src/naming/claims.ts`
- Modify: `src/naming/compat-types.ts`
- Modify: `src/naming/setup.ts`

- [ ] **Step 1: Add option to types**

In `VmObfuscationOptions` (after `opcodeMutation`):
```typescript
/** Split encoded bytecode into mixed-type fragments scattered through output. */
bytecodeScattering?: boolean;
```

- [ ] **Step 2: Add `unpack` to naming claims**

In `claims.ts`:
- Add `"unpack"` to `RUNTIME_POST_TEMP_KEYS`
- Add `"unpack"` to `SHARED_RUNTIME_KEYS` (shared across shielding groups)

- [ ] **Step 3: Add type + setup wiring**

In `compat-types.ts`: add `unpack: string;` to `RuntimeNames`.
In `setup.ts`: add `unpack: get("unpack"),` to `buildRuntimeNames()`.

- [ ] **Step 4: Typecheck + run full tests**

Run: `npm run typecheck && npm run test`
Expected: All pass

- [ ] **Step 5: Commit**

---

### Task 2: Build the unpack helper as JsNode[]

**Files** (relative to `packages/ruam/`):
- Create: `src/ruamvm/builders/unpack.ts`

The unpack function converts an array of packed 32-bit integers back to a string (4 chars per int, big-endian). Built as proper `JsNode[]` so it goes through `obfuscateLocals`, MBA, and structural transforms.

Equivalent JS:
```javascript
var _up = function(a) {
  var s = "", i, n;
  for (i = 0; i < a.length; i++) {
    n = a[i];
    s += String.fromCharCode(n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255);
  }
  return s;
};
```

- [ ] **Step 1: Implement the builder**

Create `packages/ruam/src/ruamvm/builders/unpack.ts`:

```typescript
/**
 * Unpack builder — packed-integer to string decoder for bytecode scattering.
 *
 * Builds a function that converts an array of 32-bit integers into a string
 * (4 characters per integer, big-endian byte order).
 *
 * @module ruamvm/builders/unpack
 */

import type { JsNode } from "../nodes.js";
import type { Name } from "../../naming/index.js";
import {
  id, lit, bin, assign, call, member, index,
  varDecl, exprStmt, forStmt, returnStmt, fnExpr, update,
  BOp, AOp, UpOp,
} from "../nodes.js";

/**
 * Build the unpack helper function as JsNode[].
 *
 * @param unpackName - Randomized name for the function (from RuntimeNames.unpack)
 * @returns JsNode[] containing a single var declaration
 */
export function buildUnpackFunction(unpackName: Name): JsNode[] {
  // Local variable names (will be renamed by obfuscateLocals)
  const a = "a", s = "s", i = "i", n = "n";

  // n >>> 24 & 255
  const byte0 = bin(BOp.BitAnd, bin(BOp.Ushr, id(n), lit(24)), lit(255));
  // n >>> 16 & 255
  const byte1 = bin(BOp.BitAnd, bin(BOp.Ushr, id(n), lit(16)), lit(255));
  // n >>> 8 & 255
  const byte2 = bin(BOp.BitAnd, bin(BOp.Ushr, id(n), lit(8)), lit(255));
  // n & 255
  const byte3 = bin(BOp.BitAnd, id(n), lit(255));

  // String.fromCharCode(byte0, byte1, byte2, byte3)
  const fromCharCode = call(
    member(id("String"), "fromCharCode"),
    [byte0, byte1, byte2, byte3]
  );

  // Function body:
  //   var s = "", i, n;
  //   for (i = 0; i < a.length; i++) {
  //     n = a[i];
  //     s += String.fromCharCode(...);
  //   }
  //   return s;
  const body: JsNode[] = [
    varDecl(s, lit("")),
    varDecl(i),
    varDecl(n),
    forStmt(
      assign(id(i), lit(0)),                              // init: i = 0
      bin(BOp.Lt, id(i), member(id(a), "length")),        // test: i < a.length
      update(UpOp.Inc, false, id(i)),                     // update: i++
      [
        exprStmt(assign(id(n), index(id(a), id(i)))),     // n = a[i]
        exprStmt(assign(id(s), fromCharCode, AOp.Add)),    // s += fromCharCode(...)
      ]
    ),
    returnStmt(id(s)),
  ];

  return [
    varDecl(unpackName, fnExpr(undefined, [a], body)),
  ];
}
```

**Note:** Uses the project's typed AST factory functions: `update(UpOp.Inc, ...)` for `i++`, `assign(target, value, AOp.Add)` for `s += ...`, and `fnExpr(undefined, ...)` for anonymous function expressions. These match the signatures in `nodes.ts`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (verify the builder compiles against real node APIs)

- [ ] **Step 3: Commit**

---

### Task 3: Include unpack in the assembler

**Files** (relative to `packages/ruam/`):
- Modify: `src/ruamvm/assembler.ts`

- [ ] **Step 1: Import and wire**

Import `buildUnpackFunction` from `"./builders/unpack.js"` (assembler is in `ruamvm/`, builder is in `ruamvm/builders/`).

In `generateVmRuntime()`, when `bytecodeScattering` is enabled:
- Add `buildUnpackFunction(names.unpack)` to a tier 0 or tier 1 component
- The unpack function is a foundational declaration, so add it to `tier0Components`

In `generateShieldedVmRuntime()`:
- Add `buildUnpackFunction(sharedNames.unpack)` to the shared nodes (since unpack is in `SHARED_RUNTIME_KEYS`)

- [ ] **Step 2: Add `bytecodeScattering` to the assembler's options interface**

Both `generateVmRuntime` and `generateShieldedVmRuntime` need a `bytecodeScattering?: boolean` option.

- [ ] **Step 3: Export `createScatterNameGen` from assembler**

`createScatterNameGen()` is currently a private function in `assembler.ts`. Export it so transform.ts can use it for bytecode fragment name generation (same pattern the assembler already uses for scattered keys).

- [ ] **Step 4: Thread from transform.ts**

Pass `bytecodeScattering` from `obfuscateCode()` → `generateVmRuntime()` options.
Pass from `assembleShielded()` → `generateShieldedVmRuntime()` options.
Add `bytecodeScattering` to the `assembleShielded` opts interface (alongside `scatteredKeys`, etc.).

- [ ] **Step 5: Typecheck + test**

Run: `npm run typecheck && npm run test`
Expected: All pass (unpack is emitted but not called yet)

- [ ] **Step 6: Commit**

---

## Chunk 2: Fragment Engine + Integration

### Task 4: Create the JsNode-based fragment engine

**Files** (relative to `packages/ruam/`):
- Create: `src/ruamvm/bytecode-scatter.ts`
- Create: `test/security/bytecode-scatter.test.ts`

The scatter engine splits an encoded bytecode string into fragments, returning:
- `fragments: JsNode[]` — `varDecl` nodes for each fragment
- `reassembly: JsNode` — expression node that concatenates fragments back
- `needsUnpack: boolean` — whether any packed-int fragments were generated

All expressions are `JsNode`, serialized later by `emit()`.

- [ ] **Step 1: Write unit tests**

```typescript
import { describe, it, expect } from "vitest";
import { scatterBytecodeUnit } from "../../src/ruamvm/bytecode-scatter.js";
import { emit } from "../../src/ruamvm/emit.js";

describe("bytecode scattering engine", () => {
  function makeNameGen(): () => string {
    let i = 0;
    return () => "_f" + (i++);
  }

  it("returns JsNode varDecl fragments", () => {
    const result = scatterBytecodeUnit(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij", 42,
      makeNameGen(), new Set(), "__up"
    );
    expect(result.fragments.length).toBeGreaterThanOrEqual(2);
    for (const f of result.fragments) {
      expect(f.type).toBe("VarDecl");
    }
  });

  it("reassembly emits valid JS", () => {
    const result = scatterBytecodeUnit(
      "ABCDEFGHIJKLMNOPabcdefghijklmnop", 99,
      makeNameGen(), new Set(), "__up"
    );
    const reassemblyStr = emit(result.reassembly);
    // Should reference fragment names
    expect(reassemblyStr).toBeTruthy();
    expect(typeof reassemblyStr).toBe("string");
  });

  it("round-trips: fragments + reassembly = original", () => {
    const encoded = "testString_$ABC123xyz";
    const result = scatterBytecodeUnit(encoded, 555, makeNameGen(), new Set(), "__up");

    // Build executable code: emit all fragments + reassembly
    const unpackFn = `var __up=function(a){var s="",i,n;for(i=0;i<a.length;i++){n=a[i];s+=String.fromCharCode(n>>>24&255,n>>>16&255,n>>>8&255,n&255)}return s};`;
    const fragCode = result.fragments.map(f => emit(f)).join("\n");
    const evalCode = unpackFn + "\n" + fragCode + "\n" + emit(result.reassembly);

    // The reassembly node is an expression — eval it
    const fn = new Function(evalCode.replace(/;$/, "") + ";");
    // Actually need to capture the result... use a wrapper
    const wrapper = new Function(
      unpackFn + fragCode + "\nreturn " + emit(result.reassembly) + ";"
    );
    expect(wrapper()).toBe(encoded);
  });

  it("handles short strings (no split)", () => {
    const result = scatterBytecodeUnit("AB", 1, makeNameGen(), new Set(), "__up");
    expect(result.fragments.length).toBe(1);
  });

  it("avoids excluded names", () => {
    const excluded = new Set(["_f0", "_f1", "_f2", "_f3", "_f4"]);
    const result = scatterBytecodeUnit(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij", 42,
      makeNameGen(), excluded, "__up"
    );
    for (const f of result.fragments) {
      if (f.type === "VarDecl") {
        // The varDecl name should not be in excluded
        // (checking via emit — the name appears at start)
        const emitted = emit(f);
        for (const ex of excluded) {
          expect(emitted.startsWith("var " + ex)).toBe(false);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Implement `ruamvm/bytecode-scatter.ts`**

The module (`@module ruamvm/bytecode-scatter`) exports `scatterBytecodeUnit()` which:
1. Splits the encoded string into 1–6 chunks based on length + LCG
2. For each chunk, chooses a representation (string / charCodes / packed) via LCG
3. Builds a `varDecl(name, value)` JsNode for each fragment
4. Builds a reassembly expression as a `JsNode` (BinOp chain of Add, or array `.join("")`)
5. Returns `{ fragments: JsNode[], reassembly: JsNode, needsUnpack: boolean }`

Key JsNode constructions:
- **String fragment**: `varDecl(name, lit("abc"))` → `var Xk = "abc"`
- **Char code array**: `varDecl(name, arr(lit(97), lit(98), lit(99)))` → `var Rm = [97, 98, 99]`
- **Packed int array**: `varDecl(name, arr(lit(0x41424344), ...))` → `var Qd = [1094861636, ...]`
  - Note: emit as decimal; the numeric variation structural transform may convert some to hex

Reassembly expression JsNodes:
- String fragment ref: `id(name)`
- Char code reassembly: `call(member(member(id("String"), "fromCharCode"), "apply"), [lit(null), id(name)])`
- Packed reassembly: `call(id(unpackName), [id(name)])` — with `.slice(0, N)` if trailing padding
- Concatenation: chain of `bin(BOp.Add, left, right)`
- Or: `call(member(arr(...parts), "join"), [lit("")])`

Name generation: Accept a `nameGen: () => string` callback (same pattern as `scatterKeyMaterials` in `scattered-keys.ts`). The caller (transform.ts) passes `createScatterNameGen(seed)` from the assembler — this reuses the existing LCG-based name generator with collision avoidance. The scatter engine does NOT create its own NameScope or access the registry directly.

- [ ] **Step 3: Run tests**

Run: `npx vitest run test/security/bytecode-scatter.test.ts`
Expected: All PASS

- [ ] **Step 4: Commit**

---

### Task 5: Wire into transform.ts

**Files** (relative to `packages/ruam/`):
- Modify: `src/transform.ts`
- Modify: `src/presets.ts`

- [ ] **Step 1: Add to presets**

In `presets.ts`, add `bytecodeScattering: true` to medium and max presets.
Also add `bytecodeScattering: false` to the `low` preset (matching the convention that all options are explicitly listed in every preset).

- [ ] **Step 2: Import and extract option**

In `transform.ts`:
```typescript
import { scatterBytecodeUnit } from "./ruamvm/bytecode-scatter.js";
```
(`emit` is already imported in transform.ts)

Extract `bytecodeScattering = false` from resolved options in `obfuscateCode()`.

- [ ] **Step 3: Create `buildScatteredBtParts()` using JsNode**

Instead of returning raw strings, this function:
1. Calls `scatterBytecodeUnit()` for each encoded unit → gets `JsNode[]` fragments + `JsNode` reassembly
2. Calls `emit()` on each JsNode to produce strings
3. Returns the same `{ init, fragmentDecls: string[], assignments: string[] }` shape (strings from `emit()`)

The `init` (`var bt = {};`) should also be built as JsNode:
```typescript
const initNode = varDecl(btName, obj([]));
const init = emit(initNode);
```

Each assignment: `bt["id"] = reassemblyExpr` as JsNode:
```typescript
const assignNode = exprStmt(assign(index(id(btName), lit(unitId)), reassembly));
const assignStr = emit(assignNode);
```

This way ALL code generation goes through `JsNode → emit()`. No hand-written JS strings.

- [ ] **Step 4: Update `assembleOutputFromParts` — BOTH branches**

When `bytecodeScattering` is true:
- Parse emitted fragment declarations via Babel → scatter in first 2/3 of runtime
- Parse emitted reassembly assignments via Babel → scatter in last 1/3
- Parse emitted unpack + bt init → scatter in first 1/3

When false: existing behavior (use `buildBtParts` as-is for now).

Handle both `wrapOutput` branches.

- [ ] **Step 5: Thread through shielded path**

Pass `bytecodeScattering` through `assembleShielded()` → its `assembleOutputFromParts()` call.

- [ ] **Step 6: Typecheck + full test suite**

Run: `npm run typecheck && npm run test`
Expected: All pass

- [ ] **Step 7: Commit**

---

## Chunk 3: Tests + Polish

### Task 6: Integration + combination tests

**Files** (relative to `packages/ruam/`):
- Modify: `test/security/bytecode-scatter.test.ts`
- Modify: `test/security/feature-combinations.test.ts`

- [ ] **Step 1: Add integration tests**

```typescript
import { describe, it, expect } from "vitest";
import { assertEquivalent } from "../helpers.js";
import { obfuscateCode } from "../../src/transform.js";

describe("bytecode scattering integration", () => {
  it("simple function round-trip", () => {
    assertEquivalent("function add(a, b) { return a + b; } add(3, 7);",
      { bytecodeScattering: true });
  });

  it("multiple functions", () => {
    assertEquivalent(
      "function d(x){return x*2} function t(x){return x*3} d(5)+t(3);",
      { bytecodeScattering: true });
  });

  it("with rollingCipher", () => {
    assertEquivalent(
      "function fib(n){let a=0,b=1;for(let i=0;i<n;i++){[a,b]=[b,a+b]}return a} fib(10);",
      { bytecodeScattering: true, rollingCipher: true });
  });

  it("preset medium includes scattering", () => {
    assertEquivalent("function g(n){return 'Hi '+n} g('x');", { preset: "medium" });
  });

  it("eliminates long contiguous encoded strings", () => {
    const src = "function c(n){let s=0;for(let i=0;i<n;i++)for(let j=0;j<i;j++)s+=i*j;return s} c(10);";
    const result = obfuscateCode(src, { bytecodeScattering: true });
    const longStrings = [...result.matchAll(/"([A-Za-z0-9_$]{80,})"/g)];
    expect(longStrings.length).toBe(0);
  });

  it("output contains numeric arrays from packed fragments", () => {
    const result = obfuscateCode(
      "function t(x){return x*x+x} t(7);",
      { bytecodeScattering: true });
    // Packed ints or char code arrays
    expect(/\[\d+(?:,\d+){2,}]/.test(result)).toBe(true);
  });
});
```

- [ ] **Step 2: Add to feature-combinations**

Add to pairs array:
```typescript
["scattering + MBA", { bytecodeScattering: true, mixedBooleanArithmetic: true }],
["scattering + rolling", { bytecodeScattering: true, rollingCipher: true }],
["scattering + stringAtom", { bytecodeScattering: true, stringAtomization: true, polymorphicDecoder: true }],
```

- [ ] **Step 3: Full test suite**

Run: `npm run test`
Expected: All pass

- [ ] **Step 4: Commit**

---

### Task 7: Build + docs

- [ ] **Step 1: Build**

```bash
npm run build
cd packages/ruam && npm run build:browser && cd ../..
```

- [ ] **Step 2: Update CLAUDE.md**

Add bytecode scattering entry to architecture notes.

- [ ] **Step 3: Final commit**
