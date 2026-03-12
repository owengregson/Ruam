# MBA + Handler Fragmentation Design Spec

## Overview

Two new obfuscation features for the Ruam VM interpreter:

1. **Mixed Boolean Arithmetic (MBA)** — Replaces arithmetic/bitwise operations in the interpreter with equivalent mixed boolean-arithmetic expressions
2. **Handler Fragmentation** — Splits opcode handlers into interleaved fragments with chained dispatch

Both are toggleable flags on `VmObfuscationOptions`. The `max` preset enables both.

---

## Feature 1: Mixed Boolean Arithmetic

### Option

`mixedBooleanArithmetic: boolean` — default `false`.

CLI: `--mba`

### Implementation

New file `src/ruamvm/mba.ts` exports an AST tree transform `applyMBA(nodes: JsNode[], seed: number): JsNode[]`.

### MBA Identities

| Operation | Variants |
|-----------|----------|
| `x + y` | `(x ^ y) + 2 * (x & y)`, `(x \| y) + (x & y)`, `2 * (x \| y) - (x ^ y)` |
| `x - y` | `(x ^ y) - 2 * (~x & y)`, `(x & ~y) - (~x & y)` |
| `x ^ y` | `(x \| y) & ~(x & y)`, `(~x & y) \| (x & ~y)` |
| `x & y` | `~(~x \| ~y)`, `(x \| y) ^ (x ^ y)` |
| `x \| y` | `~(~x & ~y)`, `(x ^ y) + (x & y)` |

Variant selection is seeded (LCG from build seed). Nesting depth 2: inner MBA sub-expressions are themselves MBA'd.

### Application Modes

**Infrastructure ops** (stack pointer math, IP, indices, handler table, cipher/hash): Transformed directly — always int32.

**User-value ops** (`+`, `-` in handlers like ADD, SUB): Wrapped with int32 guard:
```js
(a | 0) === a && (b | 0) === b ? MBA_EXPR : a + b
```

### Integration Point

Applied in `buildExecFunction()` after handler assembly, before `obfuscateLocals()`.

---

## Feature 2: Handler Fragmentation

### Option

`handlerFragmentation: boolean` — default `false`.

CLI: `--handler-fragmentation`

### Implementation

New file `src/ruamvm/handler-fragmentation.ts` exports a function that takes assembled switch cases and returns fragmented/shuffled cases.

### Algorithm

1. For each handler case clause (statements ending with `breakStmt`):
   - Strip terminal `breakStmt`
   - Split remaining statements into 2-3 fragments (seeded random split points)
   - Single-statement handlers: 2 fragments (statement + empty terminal)
2. Assign each fragment a unique ID from Fisher-Yates shuffled pool
3. Non-terminal fragments: append `_nf = nextId; continue;`
4. Terminal fragments: append `break;` (exits switch → for-loop break)
5. Handler table maps opcodes to first-fragment IDs
6. All fragments from all handlers shuffled into one flat case list

### Interpreter Structure

```js
// Before
switch (_ht[PH]) { case N: ...; break; }

// After
_nf = _ht[PH];
for (;;) {
  switch (_nf) {
    case 47: var b = S[P--]; _nf = 183; continue;
    case 183: S[P] = S[P] + b; break;
    // ...hundreds of interleaved fragments...
  }
  break;
}
```

`var` declarations hoist to function scope — visible across all fragments.

### RuntimeNames

`_nf` added to name generation pool in `src/encoding/names.ts`.

---

## Files Changed

| File | Change |
|------|--------|
| `src/types.ts` | Add `mixedBooleanArithmetic`, `handlerFragmentation` |
| `src/presets.ts` | Add both to `max` preset |
| `src/cli.ts` | Add `--mba`, `--handler-fragmentation` flags |
| `src/encoding/names.ts` | Add `_nf` to RuntimeNames |
| `src/ruamvm/mba.ts` | **New** — MBA transform |
| `src/ruamvm/handler-fragmentation.ts` | **New** — Fragmentation transform |
| `src/ruamvm/builders/interpreter.ts` | Apply transforms, restructure dispatch |
| `src/ruamvm/assembler.ts` | Thread options to interpreter builder |
| `src/transform.ts` | Thread options through pipeline |

## Presets

- `low`: both `false`
- `medium`: both `false`
- `max`: both `true`
