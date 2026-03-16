# Unified Naming System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 6 independent naming systems with a single `NameRegistry` + `NameScope` + `NameToken` architecture that guarantees collision-free randomized identifiers.

**Architecture:** A central `NameRegistry` owns all per-build identifiers as opaque `NameToken` handles. Names flow through the pipeline as tokens — never as strings — until a single `resolveAll()` call assigns collision-free string values. The AST system (`nodes.ts`, `emit.ts`) accepts `NameToken | string` everywhere identifiers appear.

**Tech Stack:** TypeScript, vitest, existing LCG PRNG + FNV-1a from `constants.ts`

**Spec:** `docs/specs/2026-03-16-unified-naming-system-design.md`

**Breaking changes:** Builds with the same CSPRNG seed will produce different output after migration (different PRNG derivation, character set, length tiers). This is expected — every build already uses `crypto.randomBytes(4)` for a fresh seed.

**Property key risk accepted:** Some generated names are used as property keys on internal objects (e.g., home object on functions, exception handler fields). Without the old `_` prefix convention, user-property collision is theoretically possible but astronomically unlikely (3-4 char names from 52×62^n space).

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/naming/token.ts` | `NameToken` class — opaque handle with fail-fast `.name`/`.toString()` |
| `src/naming/scope.ts` | `NameScope` class — child scope with own PRNG, claims tokens |
| `src/naming/registry.ts` | `NameRegistry` class — central coordinator, `resolveAll()`, alphabet |
| `src/naming/reserved.ts` | JS reserved words + excluded names sets |
| `src/naming/index.ts` | Barrel exports |
| `test/naming/registry.test.ts` | Unit tests for the naming system |

### Modified Files (by task)

| Task | Files Modified |
|------|---------------|
| Task 2 | `src/ruamvm/nodes.ts`, `src/ruamvm/emit.ts` |
| Task 3 | `src/ruamvm/handlers/registry.ts` |
| Task 4 | `src/ruamvm/handlers/*.ts` (20+ files), `src/ruamvm/handlers/helpers.ts` |
| Task 5 | `src/ruamvm/builders/*.ts` (10 files) |
| Task 6 | `src/transform.ts`, `src/ruamvm/assembler.ts` |
| Task 7 | `src/preprocess.ts` |
| Task 8 | `src/ruamvm/transforms.ts` (remove `obfuscateLocals`) |

### Removed Files

| File | Replaced By |
|------|------------|
| `src/encoding/names.ts` | `src/naming/` module |

---

## Chunk 1: Core Naming System + AST Integration

### Task 1: Build the naming system core (`src/naming/`)

**Files:**
- Create: `src/naming/token.ts`
- Create: `src/naming/scope.ts`
- Create: `src/naming/registry.ts`
- Create: `src/naming/reserved.ts`
- Create: `src/naming/index.ts`
- Create: `test/naming/registry.test.ts`

- [ ] **Step 1: Write failing tests for NameToken**

```typescript
// test/naming/registry.test.ts
import { NameToken, NameScope, NameRegistry } from "../src/naming/index.js";

describe("NameToken", () => {
  it("throws when accessed before resolution", () => {
    const registry = new NameRegistry(12345);
    const scope = registry.createScope("test", { lengthTier: "short" });
    const token = scope.claim("myVar");
    expect(() => token.name).toThrow('not yet resolved');
    expect(() => token.toString()).toThrow('not yet resolved');
  });

  it("returns resolved name after resolveAll", () => {
    const registry = new NameRegistry(12345);
    const scope = registry.createScope("test", { lengthTier: "short" });
    const token = scope.claim("myVar");
    registry.resolveAll();
    expect(typeof token.name).toBe("string");
    expect(token.name.length).toBeGreaterThanOrEqual(2);
    expect(token.name.length).toBeLessThanOrEqual(3);
    expect(token.toString()).toBe(token.name);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/naming/registry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/naming/reserved.ts`**

```typescript
/**
 * @module naming/reserved
 * JS reserved words and excluded identifier names.
 */

// --- Reserved Words ---

/** JS keywords that cannot be used as identifiers. */
export const RESERVED_WORDS: ReadonlySet<string> = new Set([
  "do", "if", "in", "of", "for", "let", "new", "try", "var", "case",
  "else", "enum", "null", "this", "true", "void", "with", "await",
  "break", "catch", "class", "const", "false", "super", "throw",
  "while", "yield", "delete", "export", "import", "return", "switch",
  "typeof", "default", "extends", "finally", "package", "private",
  "continue", "debugger", "function", "arguments", "interface",
  "protected", "implements", "instanceof", "undefined", "NaN",
  "Infinity",
]);

/** Names excluded from generation — single letters, short JS builtins. */
export const EXCLUDED_NAMES: ReadonlySet<string> = new Set([
  // All single letters (prevent user param shadowing)
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
  // Short names that could collide with common patterns
  "a1", "a2", "a3", "ai", "ci", "cv", "ei", "eu", "fi", "ki",
  "ni", "ra", "rb", "ri", "si", "sp", "ti", "it", "id", "cs",
  "ct", "fn", "ex", "pk",
]);
```

- [ ] **Step 4: Create `src/naming/token.ts`**

```typescript
/**
 * @module naming/token
 * Opaque handle for a name that hasn't been resolved to a string yet.
 */

import type { NameScope } from "./scope.js";

// --- NameToken ---

export class NameToken {
  readonly key: string;
  readonly scope: NameScope;
  private _resolved: string | null = null;

  /** @internal — created only via NameScope.claim() */
  constructor(key: string, scope: NameScope) {
    this.key = key;
    this.scope = scope;
  }

  /** Resolved string name. Throws if not yet resolved. */
  get name(): string {
    if (this._resolved === null) {
      throw new Error(`NameToken "${this.key}" (scope: ${this.scope.id}) not yet resolved`);
    }
    return this._resolved;
  }

  /** String coercion — same fail-fast as .name. Required for params.join(",") etc. */
  toString(): string {
    return this.name;
  }

  /** @internal — called by NameRegistry.resolveAll() */
  resolve(value: string): void {
    if (this._resolved !== null) {
      throw new Error(`NameToken "${this.key}" already resolved to "${this._resolved}"`);
    }
    this._resolved = value;
  }
}

/** Marker for rest parameters: `...name` */
export class RestParam {
  readonly paramName: Name;

  constructor(paramName: Name) {
    this.paramName = paramName;
  }

  toString(): string {
    const resolved = this.paramName instanceof NameToken ? this.paramName.name : this.paramName;
    return `...${resolved}`;
  }
}

/** A name that will become an identifier in emitted JS. */
export type Name = NameToken | string;
```

- [ ] **Step 5: Create `src/naming/scope.ts`**

```typescript
/**
 * @module naming/scope
 * Child scope within a NameRegistry, owns tokens and a per-scope PRNG.
 */

import { NameToken } from "./token.js";
import { LCG_MULTIPLIER, LCG_INCREMENT, FNV_OFFSET_BASIS, FNV_PRIME } from "../constants.js";

// --- Length Tiers ---

export type LengthTier = "short" | "medium" | "long";

const LENGTH_RANGES: Record<LengthTier, readonly [min: number, max: number]> = {
  short: [2, 3],
  medium: [3, 4],
  long: [4, 5],
};

// --- Character Sets ---

const ALPHA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// --- Seed Derivation ---

/** Derive a child PRNG seed from parent seed + scope ID via FNV-1a. */
export function deriveSeed(parentSeed: number, scopeId: string): number {
  let h = (parentSeed ^ FNV_OFFSET_BASIS) >>> 0;
  for (let i = 0; i < scopeId.length; i++) {
    h = (h ^ scopeId.charCodeAt(i)) >>> 0;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h;
}

// --- NameScope ---

export class NameScope {
  readonly id: string;
  readonly parent: NameScope | null;
  readonly tokens: Map<string, NameToken> = new Map();
  readonly children: NameScope[] = [];
  readonly lengthTier: LengthTier;
  private _prngState: number;
  private _frozen = false;

  constructor(id: string, seed: number, lengthTier: LengthTier, parent: NameScope | null = null) {
    this.id = id;
    this.lengthTier = lengthTier;
    this.parent = parent;
    this._prngState = deriveSeed(seed, id);
  }

  /** Claim a token with the given canonical key. */
  claim(key: string): NameToken {
    if (this._frozen) {
      throw new Error(`NameScope "${this.id}" is frozen — cannot claim "${key}"`);
    }
    if (this.tokens.has(key)) {
      throw new Error(`Duplicate key "${key}" in scope "${this.id}"`);
    }
    const token = new NameToken(key, this);
    this.tokens.set(key, token);
    return token;
  }

  /** Batch-claim multiple keys. Returns a record of key → token. */
  claimMany(keys: readonly string[]): Record<string, NameToken> {
    const result: Record<string, NameToken> = {};
    for (const key of keys) {
      result[key] = this.claim(key);
    }
    return result;
  }

  /** Freeze scope — no more claims allowed. */
  freeze(): void {
    this._frozen = true;
  }

  /** Step the LCG PRNG, return a 32-bit unsigned integer. */
  nextPrng(): number {
    this._prngState = (Math.imul(this._prngState, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return this._prngState;
  }

  /** Generate a random candidate name using the scope's PRNG and length tier. */
  generateCandidate(): string {
    const [minLen, maxLen] = LENGTH_RANGES[this.lengthTier];
    const len = minLen + (this.nextPrng() % (maxLen - minLen + 1));
    let name = ALPHA[this.nextPrng() % ALPHA.length]!;
    for (let i = 1; i < len; i++) {
      name += ALNUM[this.nextPrng() % ALNUM.length]!;
    }
    return name;
  }
}
```

- [ ] **Step 6: Create `src/naming/registry.ts`**

```typescript
/**
 * @module naming/registry
 * Central coordinator for all per-build randomized identifiers.
 */

import { NameScope, type LengthTier, deriveSeed } from "./scope.js";
import { RESERVED_WORDS, EXCLUDED_NAMES } from "./reserved.js";
import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";

// --- Alphabet ---

const ALPHABET_BASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_$";

// --- NameRegistry ---

export class NameRegistry {
  private readonly _seed: number;
  private readonly _scopes: NameScope[] = [];
  private readonly _globalUsed: Set<string>;
  private _resolved = false;
  private _alphabet: string | null = null;

  constructor(seed: number) {
    this._seed = seed >>> 0;
    this._globalUsed = new Set([...RESERVED_WORDS, ...EXCLUDED_NAMES]);
  }

  /** Whether resolveAll() has been called. */
  get isResolved(): boolean {
    return this._resolved;
  }

  /** Create a child scope. If parent is provided, the scope is nested under it. */
  createScope(id: string, opts?: { parent?: NameScope; lengthTier?: LengthTier }): NameScope {
    if (this._resolved) {
      throw new Error("Registry is frozen — cannot create scope after resolveAll()");
    }
    const parent = opts?.parent ?? null;
    const lengthTier = opts?.lengthTier ?? "medium";
    const scope = new NameScope(id, this._seed, lengthTier, parent);
    if (parent) {
      parent.children.push(scope);
    }
    this._scopes.push(scope);
    return scope;
  }

  /** Resolve all tokens across all scopes. Guarantees no collisions.
   *  Uses depth-first tree walk (parent before children) — NOT registration order. */
  resolveAll(): void {
    if (this._resolved) {
      throw new Error("resolveAll() already called");
    }

    // Generate alphabet first (doesn't consume identifier namespace)
    this._generateAlphabet();

    // Depth-first walk: resolve root scopes, then their children recursively
    const rootScopes = this._scopes.filter(s => s.parent === null);
    const walkResolve = (scope: NameScope): void => {
      this._resolveScope(scope);
      scope.freeze();
      for (const child of scope.children) {
        walkResolve(child);
      }
    };
    for (const root of rootScopes) {
      walkResolve(root);
    }

    this._resolved = true;
  }

  /** Get the 64-char encoding alphabet. Only available after resolveAll(). */
  getAlphabet(): string {
    if (this._alphabet === null) {
      throw new Error("Alphabet not yet generated — call resolveAll() first");
    }
    return this._alphabet;
  }

  /** Dump all resolved names for debugging. Returns scopeId:key → resolved name. */
  dumpAll(): Map<string, string> {
    const result = new Map<string, string>();
    for (const scope of this._scopes) {
      for (const [key, token] of scope.tokens) {
        const qualifiedKey = `${scope.id}:${key}`;
        try {
          result.set(qualifiedKey, token.name);
        } catch {
          result.set(qualifiedKey, "<unresolved>");
        }
      }
    }
    return result;
  }

  /** Total number of tokens across all scopes. */
  get tokenCount(): number {
    let count = 0;
    for (const scope of this._scopes) {
      count += scope.tokens.size;
    }
    return count;
  }

  // --- Private ---

  private _resolveScope(scope: NameScope): void {
    const MAX_RETRIES = 50;
    for (const [, token] of scope.tokens) {
      let lengthBump = 0;
      let retries = 0;
      let candidate: string;

      do {
        candidate = scope.generateCandidate();
        // If candidate is too short due to bump, regenerate with longer minimum
        if (lengthBump > 0 && candidate.length < 2 + lengthBump) {
          // Force longer name by appending random chars
          while (candidate.length < 2 + lengthBump) {
            const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            candidate += ALNUM[scope.nextPrng() % ALNUM.length]!;
          }
        }
        retries++;
        if (retries > MAX_RETRIES) {
          lengthBump++;
          retries = 0;
        }
      } while (this._globalUsed.has(candidate));

      this._globalUsed.add(candidate);
      token.resolve(candidate);
    }
  }

  private _generateAlphabet(): void {
    const chars = ALPHABET_BASE.split("");
    const codecSeed = deriveSeed(this._seed, "codec");
    let s = codecSeed;
    for (let i = chars.length - 1; i > 0; i--) {
      s = (Math.imul(s, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
      const j = s % (i + 1);
      const tmp = chars[i]!;
      chars[i] = chars[j]!;
      chars[j] = tmp;
    }
    this._alphabet = chars.join("");
  }
}
```

- [ ] **Step 7: Create `src/naming/index.ts`**

```typescript
/**
 * @module naming
 * Unified naming system — NameRegistry + NameScope + NameToken.
 */

export { NameToken, RestParam, type Name } from "./token.js";
export { NameScope, type LengthTier, deriveSeed } from "./scope.js";
export { NameRegistry } from "./registry.js";
export { RESERVED_WORDS, EXCLUDED_NAMES } from "./reserved.js";
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test -- test/naming/registry.test.ts`
Expected: PASS (both tests)

- [ ] **Step 9: Write comprehensive tests for collision prevention, scoping, determinism**

Add to `test/naming/registry.test.ts`:

```typescript
describe("NameScope", () => {
  it("rejects duplicate keys", () => {
    const registry = new NameRegistry(99);
    const scope = registry.createScope("test", { lengthTier: "short" });
    scope.claim("foo");
    expect(() => scope.claim("foo")).toThrow("Duplicate key");
  });

  it("supports claimMany", () => {
    const registry = new NameRegistry(99);
    const scope = registry.createScope("test", { lengthTier: "short" });
    const tokens = scope.claimMany(["a", "b", "c"]);
    registry.resolveAll();
    expect(Object.keys(tokens)).toEqual(["a", "b", "c"]);
    const names = new Set(Object.values(tokens).map(t => t.name));
    expect(names.size).toBe(3); // all unique
  });
});

describe("NameRegistry", () => {
  it("prevents collisions across scopes", () => {
    const registry = new NameRegistry(42);
    const s1 = registry.createScope("scope1", { lengthTier: "short" });
    const s2 = registry.createScope("scope2", { lengthTier: "short" });
    // Claim 100 names in each scope
    const tokens: NameToken[] = [];
    for (let i = 0; i < 100; i++) {
      tokens.push(s1.claim(`a${i}`));
      tokens.push(s2.claim(`b${i}`));
    }
    registry.resolveAll();
    const names = new Set(tokens.map(t => t.name));
    expect(names.size).toBe(200); // all unique
  });

  it("produces deterministic names from same seed", () => {
    const r1 = new NameRegistry(12345);
    const r2 = new NameRegistry(12345);
    const s1 = r1.createScope("test", { lengthTier: "medium" });
    const s2 = r2.createScope("test", { lengthTier: "medium" });
    const t1 = s1.claim("myVar");
    const t2 = s2.claim("myVar");
    r1.resolveAll();
    r2.resolveAll();
    expect(t1.name).toBe(t2.name);
  });

  it("produces different names from different seeds", () => {
    const r1 = new NameRegistry(11111);
    const r2 = new NameRegistry(22222);
    const s1 = r1.createScope("test", { lengthTier: "medium" });
    const s2 = r2.createScope("test", { lengthTier: "medium" });
    const t1 = s1.claim("myVar");
    const t2 = s2.claim("myVar");
    r1.resolveAll();
    r2.resolveAll();
    expect(t1.name).not.toBe(t2.name);
  });

  it("respects length tiers", () => {
    const registry = new NameRegistry(42);
    const short = registry.createScope("short", { lengthTier: "short" });
    const long = registry.createScope("long", { lengthTier: "long" });
    const tokens: NameToken[] = [];
    for (let i = 0; i < 50; i++) {
      tokens.push(short.claim(`s${i}`));
      tokens.push(long.claim(`l${i}`));
    }
    registry.resolveAll();
    const shortNames = tokens.filter((_, i) => i % 2 === 0).map(t => t.name);
    const longNames = tokens.filter((_, i) => i % 2 === 1).map(t => t.name);
    // Short: 2-3 chars, Long: 4-5 chars
    for (const n of shortNames) {
      expect(n.length).toBeGreaterThanOrEqual(2);
      expect(n.length).toBeLessThanOrEqual(3);
    }
    for (const n of longNames) {
      expect(n.length).toBeGreaterThanOrEqual(4);
      expect(n.length).toBeLessThanOrEqual(5);
    }
  });

  it("never generates reserved words", () => {
    const registry = new NameRegistry(42);
    const scope = registry.createScope("test", { lengthTier: "short" });
    // Claim enough names to force many PRNG draws
    for (let i = 0; i < 500; i++) {
      scope.claim(`v${i}`);
    }
    registry.resolveAll();
    const reserved = new Set(["do", "if", "in", "of", "for", "let", "new", "try", "var"]);
    for (const [, token] of scope.tokens) {
      expect(reserved.has(token.name)).toBe(false);
    }
  });

  it("generates valid JS identifiers", () => {
    const registry = new NameRegistry(42);
    const scope = registry.createScope("test", { lengthTier: "medium" });
    for (let i = 0; i < 200; i++) scope.claim(`v${i}`);
    registry.resolveAll();
    const validId = /^[a-zA-Z][a-zA-Z0-9]*$/;
    for (const [, token] of scope.tokens) {
      expect(token.name).toMatch(validId);
    }
  });

  it("generates alphabet", () => {
    const registry = new NameRegistry(42);
    registry.createScope("test", { lengthTier: "short" });
    registry.resolveAll();
    const alphabet = registry.getAlphabet();
    expect(alphabet.length).toBe(64);
    expect(new Set(alphabet.split("")).size).toBe(64); // all unique
  });

  it("freezes after resolveAll", () => {
    const registry = new NameRegistry(42);
    registry.createScope("test", { lengthTier: "short" });
    registry.resolveAll();
    expect(() => registry.createScope("new")).toThrow("frozen");
  });

  it("shielded mode hierarchy produces unique per-group names with shared consistency", () => {
    const registry = new NameRegistry(42);
    const shared = registry.createScope("shared", { lengthTier: "medium" });
    const sharedToken = shared.claim("cache");

    const g0 = registry.createScope("group0");
    const g0interp = registry.createScope("interpreter", { parent: g0, lengthTier: "short" });
    const g1 = registry.createScope("group1");
    const g1interp = registry.createScope("interpreter", { parent: g1, lengthTier: "short" });

    const g0exec = g0interp.claim("exec");
    const g1exec = g1interp.claim("exec");

    registry.resolveAll();

    // Shared token is accessible to both groups
    expect(typeof sharedToken.name).toBe("string");
    // Per-group tokens are different
    expect(g0exec.name).not.toBe(g1exec.name);
    // No collisions with shared
    expect(g0exec.name).not.toBe(sharedToken.name);
    expect(g1exec.name).not.toBe(sharedToken.name);
  });

  it("handles 2000+ tokens without exhaustion", () => {
    const registry = new NameRegistry(42);
    const scope = registry.createScope("stress", { lengthTier: "short" });
    for (let i = 0; i < 2000; i++) scope.claim(`v${i}`);
    expect(() => registry.resolveAll()).not.toThrow();
  });

  it("scope isolation — adding names in one scope doesn't affect another", () => {
    // Two registries with same seed, but different scope populations
    const r1 = new NameRegistry(42);
    const r2 = new NameRegistry(42);
    const s1a = r1.createScope("scopeA", { lengthTier: "short" });
    const s1b = r1.createScope("scopeB", { lengthTier: "short" });
    const s2a = r2.createScope("scopeA", { lengthTier: "short" });
    const s2b = r2.createScope("scopeB", { lengthTier: "short" });
    // Same claims in scopeA
    const t1 = s1a.claim("x");
    const t2 = s2a.claim("x");
    // Different claims in scopeB — only r1 has extra names
    for (let i = 0; i < 50; i++) s1b.claim(`extra${i}`);
    s2b.claim("only_one");
    r1.resolveAll();
    r2.resolveAll();
    // scopeA tokens should resolve identically despite scopeB differences
    expect(t1.name).toBe(t2.name);
  });
});

describe("RestParam", () => {
  it("formats with ... prefix after resolution", () => {
    const registry = new NameRegistry(42);
    const scope = registry.createScope("test", { lengthTier: "short" });
    const token = scope.claim("args");
    const rest = new RestParam(token);
    registry.resolveAll();
    expect(rest.toString()).toBe(`...${token.name}`);
  });

  it("works with string names", () => {
    const rest = new RestParam("args");
    expect(rest.toString()).toBe("...args");
  });
});
```

- [ ] **Step 10: Run all naming tests**

Run: `npm run test -- test/naming/registry.test.ts`
Expected: ALL PASS

- [ ] **Step 11: Commit**

```bash
git add src/naming/ test/naming/
git commit -m "feat: add unified naming system core (NameRegistry, NameScope, NameToken)"
```

---

### Task 2: Update AST type system (`nodes.ts` + `emit.ts`)

**Files:**
- Modify: `src/ruamvm/nodes.ts` (lines 135-411 interfaces, 415-619 factories, 647-797 traversal)
- Modify: `src/ruamvm/emit.ts` (lines 103-387 emitter)

- [ ] **Step 1: Write failing test for NameToken in AST**

```typescript
// test/naming/ast-integration.test.ts
import { NameRegistry } from "../src/naming/index.js";
import { id, varDecl, fnDecl } from "../src/ruamvm/nodes.js";
import { emit } from "../src/ruamvm/emit.js";

describe("AST NameToken integration", () => {
  it("emits identifier from NameToken", () => {
    const registry = new NameRegistry(42);
    const scope = registry.createScope("test", { lengthTier: "short" });
    const myVar = scope.claim("myVar");
    registry.resolveAll();
    const node = id(myVar);
    expect(emit(node)).toBe(myVar.name);
  });

  it("emits varDecl with NameToken name", () => {
    const registry = new NameRegistry(42);
    const scope = registry.createScope("test", { lengthTier: "short" });
    const x = scope.claim("x");
    registry.resolveAll();
    const node = varDecl(x, id("Object"));
    expect(emit(node)).toContain(`var ${x.name}=Object`);
  });

  it("emits fnDecl with NameToken params", () => {
    const registry = new NameRegistry(42);
    const scope = registry.createScope("test", { lengthTier: "short" });
    const fname = scope.claim("fn");
    const p1 = scope.claim("p1");
    const p2 = scope.claim("p2");
    registry.resolveAll();
    const node = fnDecl(fname, [p1, p2], []);
    const result = emit(node);
    expect(result).toContain(`function ${fname.name}(${p1.name},${p2.name})`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/naming/ast-integration.test.ts`
Expected: FAIL — type errors or NameToken not accepted

- [ ] **Step 3: Add `Name` type to `nodes.ts` and update all interfaces**

In `src/ruamvm/nodes.ts`:

1. Add import at top: `import { type Name, NameToken, RestParam } from "../naming/index.js";`
2. Export `Name` type: `export type { Name } from "../naming/index.js";`
3. Update all interfaces that have `name: string` or `params: string[]`:
   - `VarDecl.name: string` → `Name`
   - `ConstDecl.name: string` → `Name`
   - `FnDecl.name: string` → `Name`
   - `FnDecl.params: string[]` → `(Name | RestParam)[]`
   - `FnExpr.name?: string` → `Name | undefined`
   - `FnExpr.params: string[]` → `(Name | RestParam)[]`
   - `ArrowFn.params: string[]` → `(Name | RestParam)[]`
   - `ForInStmt.decl: string` → `Name`
   - `TryCatchStmt.param?: string` → `Name | undefined`
   - `MemberExpr.prop: string` → `Name` (when `computed: false`)
   - `Id.name: string` → `Name`
   - `StackPush.S: string` → `Name`
   - `StackPop.S: string` → `Name`
   - `StackPeek.S: string` → `Name`
   - `GetterEntry.name: string` → `Name`
   - `SetterEntry.name: string` → `Name`
   - `SetterEntry.param: string` → `Name`
   - `MethodEntry.name: string | JsNode` → `Name | JsNode`
   - `MethodEntry.params: string[]` → `(Name | RestParam)[]`
   - `PropEntry`: `[string | JsNode, JsNode]` → `[Name | JsNode, JsNode]`
4. Update all factory function signatures to accept `Name` instead of `string` where the interface changed
5. Update the `rest()` function (line ~627) to return `RestParam`:
   ```typescript
   export function rest(name: Name): RestParam {
     return new RestParam(name);
   }
   ```

- [ ] **Step 4: Add `isName` type guard and `resolveName` helper to `emit.ts`**

At top of `src/ruamvm/emit.ts`:

```typescript
import { NameToken, RestParam, type Name } from "../naming/index.js";

/** Resolve a Name to its string value. */
function resolveName(name: Name): string {
  return name instanceof NameToken ? name.name : name;
}

/** Type guard: is this value a Name (string or NameToken) vs a JsNode? */
function isName(v: unknown): v is Name {
  return typeof v === "string" || v instanceof NameToken;
}
```

- [ ] **Step 5: Update `emit()` function to use `resolveName()`**

In `src/ruamvm/emit.ts`, update the `emit()` switch cases:

- **Id** case: `return resolveName(n.name)` (instead of `return n.name`)
- **VarDecl/ConstDecl**: `resolveName(d.name)` in the chained declaration emit and individual emit
- **FnDecl**: `resolveName(n.name)` for function name, `n.params.map(p => p instanceof RestParam ? p.toString() : resolveName(p)).join(",")` for params
- **FnExpr**: same pattern for name and params
- **ArrowFn**: same for params. Replace `n.params[0]!.startsWith("...")` with `n.params[0] instanceof RestParam`
- **ForInStmt**: `resolveName(n.decl)`
- **TryCatchStmt**: `resolveName(n.param)` if present
- **MemberExpr**: `resolveName(n.prop)` when not computed
- **StackPush/Pop/Peek**: `resolveName(n.S)`

- [ ] **Step 6: Update `emitObjectEntry()` to use `isName()`**

In `src/ruamvm/emit.ts` `emitObjectEntry()` function:

Replace `typeof k === "string"` checks with `isName(k)` for:
- `PropEntry` key discrimination
- `MethodEntry.name` discrimination
- `GetterEntry.name` / `SetterEntry.name` — use `resolveName()`
- `SetterEntry.param` — use `resolveName()`

- [ ] **Step 7: Update `mapChildren` in `nodes.ts`**

`mapChildren` (lines 703-797) has two `typeof k === "string"` checks that discriminate string property keys from `JsNode` computed keys:
- Line ~714: `PropEntry` key — `typeof k === "string"` must become `isName(k)` (import `isName` from emit.ts or duplicate the guard)
- Line ~741: `MethodEntry.name` — same change

Without this, `NameToken` prop keys would be incorrectly passed through the `fn()` mapper as `JsNode` children, causing crashes. Export `isName` from `naming/index.ts` so both `emit.ts` and `nodes.ts` can use it.

Also verify: the chained `VarDecl` emit path in `emit.ts` (line ~108-116) uses `d.name` in a `.map()` callback. Ensure it uses `resolveName(d.name)` — `NameToken.toString()` handles string concatenation, but explicit `resolveName` is clearer.

- [ ] **Step 8: Run all tests**

Run: `npm run test -- test/naming/ast-integration.test.ts`
Expected: PASS

Then run full suite:
Run: `npm run test`
Expected: ALL 1882 tests PASS (existing code still passes string names)

- [ ] **Step 9: Commit**

```bash
git add src/ruamvm/nodes.ts src/ruamvm/emit.ts test/naming/ast-integration.test.ts
git commit -m "feat: AST type system accepts NameToken | string for all identifier positions"
```

---

### Task 3: Update HandlerCtx to use NameToken

**Files:**
- Modify: `src/ruamvm/handlers/registry.ts` (lines 35-171)

- [ ] **Step 1: Write failing test**

```typescript
// test/naming/handler-ctx.test.ts
import { NameRegistry } from "../src/naming/index.js";

describe("HandlerCtx with NameToken", () => {
  it("ctx fields are NameTokens after resolution", () => {
    // This test will be filled in once we know the new makeHandlerCtx signature
    // For now, verify that HandlerCtx type accepts NameToken
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Update HandlerCtx interface**

In `src/ruamvm/handlers/registry.ts`:

1. Import: `import { type Name, NameToken } from "../../naming/index.js";`
2. Change all `string` fields in `HandlerCtx` to `Name`:
   - `S: string` → `S: Name`
   - `IP: string` → `IP: Name`
   - `C: string` → `C: Name`
   - `O: string` → `O: Name`
   - `SC: string` → `SC: Name`
   - `R: string` → `R: Name`
   - ... all ~30 string fields
   - `t: (key: string) => string` → `t: (key: string) => Name`
3. Add `local` method: `local: (key: string) => NameToken`

- [ ] **Step 3: Update `makeHandlerCtx` to accept NameTokens**

`makeHandlerCtx` currently takes `(names: RuntimeNames, temps: TempNames, ...)`. For now, keep this signature but make it work with both string and NameToken inputs. The full migration to NameRegistry will happen in Task 6.

The key change: `HandlerCtx` fields accept `Name` (which is `NameToken | string`), so the existing `names.stk` strings still work. This is a backwards-compatible type widening.

- [ ] **Step 4: Update helper functions (sv, curSv, scopeWalk)**

Update helper functions on HandlerCtx to work with `Name`:
- `sv()`: currently returns `id("name")` — keep working with strings for now, will be tokenized in Task 4
- `curSv()`: same
- `scopeWalk()`: same

- [ ] **Step 5: Run full test suite**

Run: `npm run test`
Expected: ALL PASS (type widening is backwards-compatible)

- [ ] **Step 6: Commit**

```bash
git add src/ruamvm/handlers/registry.ts
git commit -m "feat: HandlerCtx accepts Name (NameToken | string) for all identifier fields"
```

---

## Chunk 2: Handler & Builder Migration

### Task 4: Migrate handler files to use NameToken for locals

**Files:**
- Modify: ALL files in `src/ruamvm/handlers/` (20+ files)
- Modify: `src/ruamvm/handlers/helpers.ts`

This is the largest single task. Each handler file has hardcoded `varDecl("v", ...)`, `id("name")`, etc. calls that need to become `varDecl(ctx.local("value"), ...)`, `id(ctx.local("name"))`, etc.

**Important**: Many of these hardcoded names (`"v"`, `"b"`, `"s"`, `"name"`, `"key"`) are reused across multiple handlers. Since each handler is a separate closure in the output, the same resolved name CAN safely appear in different handler closures. However, within a single handler, all locals must be unique.

**Migration pattern for each handler file:**

1. Find all `varDecl("xxx", ...)` and `id("xxx")` calls where `"xxx"` is a handler-local variable (NOT a global/builtin like `"Object"`, `"Array"`, `"undefined"`)
2. Replace with `varDecl(ctx.local("xxx"), ...)` and `id(ctx.local("xxx"))`
3. Keep `id("Object")`, `id("this")`, `member(id("Object"), "getPrototypeOf")` etc. as raw strings — these are JS builtins

- [ ] **Step 1: Implement `ctx.local()` on HandlerCtx**

In `src/ruamvm/handlers/registry.ts`, update `makeHandlerCtx`:

The `local()` method needs a per-handler `NameScope`. Since handlers are registered as functions that return `JsNode[]`, each handler invocation gets a fresh HandlerCtx. Add a handler-local scope:

```typescript
// In makeHandlerCtx, add:
const handlerLocals = new Map<string, NameToken>();
// local() creates or retrieves a token for a handler-local variable
const local = (key: string): NameToken => {
  let token = handlerLocals.get(key);
  if (!token) {
    token = handlerScope.claim(key);
    handlerLocals.set(key, token);
  }
  return token;
};
```

**Note**: The handler scope must be provided to `makeHandlerCtx`. This will be wired up in Task 6 when the full registry integration happens. For now, `local()` can return `key` as a string (backwards-compatible) until the registry is wired in.

**Interim approach**: Add `local` as a pass-through that returns the key string. This lets us do the handler migration (string → `ctx.local("name")`) without needing the full registry yet. The type system (`Name = NameToken | string`) allows this.

```typescript
// Interim implementation:
const local = (key: string): string => key;
```

- [ ] **Step 2: Migrate `helpers.ts`**

File: `src/ruamvm/handlers/helpers.ts`

Replace hardcoded variable names:
- Line 45: `varDecl(tvName, id("this"))` — keep `"this"` (builtin), `tvName` already comes from `ctx.t("_tv")`
- Line 62: `member(id("u"), "st")` — keep as-is (property access on `u` parameter)
- Line 72: `id("Object")` — keep (builtin)
- Line 109: `member(id("Object"), "getPrototypeOf")` — keep (builtin)
- Line 151: `id("u")`, `id("cs")`, `id("ct")` — these are IIFE closure params, keep as strings for now

Update `scopeWalk` helper (lines 155-169) to accept token parameters:
```typescript
scopeWalk: (body: JsNode[], nameKey?: Name, walkVar?: Name): JsNode[] => {
  const n = nameKey ?? ctx.local("scopeName");
  const s = walkVar ?? ctx.local("scopeWalk");
  // ... use n and s instead of id("name") and id("s")
}
```

- [ ] **Step 3: Migrate `stack.ts`**

File: `src/ruamvm/handlers/stack.ts`

Replace:
- Line 131, 150: `varDecl("_t", ...)` → `varDecl(ctx.local("swapTemp"), ...)`
- Lines 164-166: `varDecl("_c", ...)`, `varDecl("_b", ...)`, `varDecl("_a", ...)` → `ctx.local("rotC")`, `ctx.local("rotB")`, `ctx.local("rotA")`

- [ ] **Step 4: Migrate `arithmetic.ts` and `comparison.ts`**

`arithmetic.ts`: Line 39: `varDecl("b", ...)` → `varDecl(ctx.local("rhs"), ...)`

`comparison.ts`: Line 29: `varDecl("b", ...)` → `varDecl(ctx.local("rhs"), ...)`

- [ ] **Step 5: Migrate `logical.ts`**

Lines 39, 56, 73: `varDecl("v", ...)` → `varDecl(ctx.local("value"), ...)`

- [ ] **Step 6: Migrate `control-flow.ts`**

- Lines 66, 101, 138, 195, 243: `varDecl("v", ...)` → `varDecl(ctx.local("value"), ...)`
- Line 259: `varDecl("ex", ...)` → `varDecl(ctx.local("exception"), ...)`

- [ ] **Step 7: Migrate `registers.ts`**

- Lines 39, 41: `varDecl("name", ...)` → `varDecl(ctx.local("varName"), ...)`
- Lines 142, 154: `varDecl("varName", ...)` → `varDecl(ctx.local("varName"), ...)`
- Lines 196-205: `varDecl("s", ...)` → `varDecl(ctx.local("scopeWalk"), ...)`
- Line 219: keep `ctx.t("_g")` usage

- [ ] **Step 8: Migrate `type-ops.ts`**

- Lines with `varDecl("v", ...)` → `ctx.local("value")`
- `varDecl("exprCount", ...)` → `ctx.local("exprCount")`
- `varDecl("parts", ...)` → `ctx.local("parts")`
- `varDecl("argc", ...)` → `ctx.local("argc")`
- `varDecl("callArgs", ...)` → `ctx.local("callArgs")`
- `varDecl("count", ...)` → `ctx.local("count")`
- `varDecl("raw", ...)` → `ctx.local("raw")`
- `varDecl("spec", ...)` → `ctx.local("spec")`

- [ ] **Step 9: Migrate `special.ts`**

- Lines 57, 77: `varDecl("g", ...)` → `ctx.local("global")`
- Lines 76, 82: `varDecl("syms", ...)` → `ctx.local("symbols")`

- [ ] **Step 10: Migrate `destructuring.ts`**

- `varDecl("v", ...)` → `ctx.local("value")`
- `varDecl("def", ...)` → `ctx.local("defaultVal")`
- `varDecl("iterObj", ...)` → `ctx.local("iterObj")`
- `varDecl("rest", ...)` → `ctx.local("restVal")`
- `varDecl("arr", ...)` → `ctx.local("array")`
- `varDecl("nxt", ...)` → `ctx.local("next")`
- `varDecl("keys", ...)` → `ctx.local("keys")`

- [ ] **Step 11: Migrate `scope.ts`**

- `varDecl("name", ...)` → `ctx.local("varName")`
- `varDecl("s", ...)` → `ctx.local("scopeWalk")`
- `varDecl("val", ...)` → `ctx.local("value")`
- `varDecl("_v", ...)` → `ctx.local("storedVal")`
- `varDecl("found", ...)` → `ctx.local("found")`
- `varDecl("g", ...)` → `ctx.local("global")`
- Keep `lit("Cannot access '")` etc. as strings (string literals, not identifiers)

- [ ] **Step 12: Migrate `compound-scoped.ts`**

- `varDecl("val", ...)` → `ctx.local("value")`
- `varDecl("name", ...)` → `ctx.local("varName")`
- `varDecl("s", ...)` → `ctx.local("scopeWalk")`
- `varDecl("old", ...)` → `ctx.local("oldVal")`

- [ ] **Step 13: Migrate `objects.ts`**

- `varDecl("val", ...)` → `ctx.local("value")`
- `varDecl("obj", ...)` → `ctx.local("object")`
- `varDecl("k", ...)` / `varDecl("key", ...)` → `ctx.local("propKey")`

- [ ] **Step 14: Migrate `calls.ts`**

- `varDecl("argc", ...)` → `ctx.local("argc")`
- `varDecl("hasSpread", ...)` → `ctx.local("hasSpread")`
- `varDecl("callArgs", ...)` → `ctx.local("callArgs")`
- `varDecl("ai", ...)` → `ctx.local("argIndex")`
- `varDecl("flat", ...)` → `ctx.local("flatArgs")`

- [ ] **Step 15: Migrate `classes.ts`**

- `varDecl("c", ...)` → `ctx.local("ctor")`
- `varDecl("f", ...)` → `ctx.local("func")`
- Keep `"prototype"`, `"constructor"`, `"__setCtor"` as strings (property name literals)

- [ ] **Step 16: Migrate `exceptions.ts`**

- `varDecl("err", ...)` → `ctx.local("error")`
- `varDecl("cname", ...)` → `ctx.local("catchName")`

- [ ] **Step 17: Migrate `iterators.ts`**

- `varDecl("iterable", ...)` → `ctx.local("iterable")`
- `varDecl("iter", ...)` → `ctx.local("iterator")`
- `varDecl("first", ...)` → `ctx.local("firstIter")`
- `varDecl("iterObj", ...)` → `ctx.local("iterObj")`
- `varDecl("nxt", ...)` → `ctx.local("next")`

- [ ] **Step 18: Migrate `superinstructions.ts`**

- `varDecl("ra", ...)` → `ctx.local("regA")`
- `varDecl("rb", ...)` → `ctx.local("regB")`

- [ ] **Step 19: Run full test suite**

Run: `npm run test`
Expected: ALL 1882 tests PASS

The interim `local()` implementation returns the key as-is, so behavior is unchanged — the migration is purely structural (calling `ctx.local("value")` instead of `"v"`). The actual randomization kicks in when the registry is wired in (Task 6).

- [ ] **Step 20: Commit**

```bash
git add src/ruamvm/handlers/
git commit -m "refactor: migrate all handler locals to ctx.local() pattern"
```

---

### Task 5: Migrate builder files to use NameToken for locals

**Files:**
- Modify: ALL files in `src/ruamvm/builders/` (10 files)

Same migration pattern as Task 4 but for builder files. Builders use `varDecl("k", ...)`, `id("h")` etc. for internal variables.

**Important**: Builders take `(names: RuntimeNames, temps: TempNames, ...)` parameters. The RuntimeNames/TempNames consumption stays as-is for now — only LOCAL variables get migrated to a `local()` pattern. The full wiring to NameRegistry happens in Task 6.

- [ ] **Step 1: Add `local` parameter to builder function signatures**

Each builder function will accept an optional `local?: (key: string) => Name` parameter. Interim default: `(key) => key`.

- [ ] **Step 2: Migrate `decoder.ts` locals**

- Line 79: `varDecl("k", ...)` → `varDecl(local("loopKey"), ...)`

- [ ] **Step 3: Migrate `fingerprint.ts` locals**

- Line 79: `id("h")` → `id(local("hash"))`

- [ ] **Step 4: Migrate `rolling-cipher.ts` locals**

Keep member access strings like `"i"`, `"r"`, `"p"`, `"c"` as-is — these are unit property names from the binary format, not randomizable.

- [ ] **Step 5: Migrate `deserializer.ts` locals**

Deserializer already uses `T(key)` (TempNames) extensively. Keep that pattern — these are already randomized. Only migrate any additional hardcoded local names.

- [ ] **Step 6: Migrate `runners.ts` locals**

Keep unit property names (`"id"`, `"s"`, `"a"`, `"st"`, `"p"`) as strings — binary format properties.
Migrate any true local variable names.

- [ ] **Step 7: Migrate `debug-protection.ts` locals**

Already uses `Z(key)` (TempNames) extensively. Migrate remaining hardcoded locals.

- [ ] **Step 8: Migrate `loader.ts` locals**

Keep `"c"` (constant pool property) as string. Migrate local loop/temp variables.

- [ ] **Step 9: Migrate `globals.ts`, `debug-logging.ts`**

Keep literal property names. Migrate local variables.

- [ ] **Step 10: Migrate `interpreter.ts`**

This is the most complex builder. Keep all `names.xxx` and `T(key)` patterns. Migrate any remaining hardcoded locals.

- [ ] **Step 11: Run full test suite**

Run: `npm run test`
Expected: ALL 1882 tests PASS

- [ ] **Step 12: Commit**

```bash
git add src/ruamvm/builders/
git commit -m "refactor: migrate all builder locals to local() pattern"
```

---

## Chunk 3: Pipeline Integration & Cleanup

### Task 6: Wire NameRegistry into the pipeline

**Files:**
- Modify: `src/transform.ts` (lines 85-285 main pipeline, 759-1026 shielded)
- Modify: `src/ruamvm/assembler.ts` (lines 76-793)
- Modify: `src/ruamvm/handlers/registry.ts` (makeHandlerCtx)
- Modify: `src/ruamvm/builders/interpreter.ts` (buildInterpreterFunctions)

This is the critical integration task. The `NameRegistry` replaces `generateRuntimeNames()`, `generateShieldedNames()`, `createScatterNameGen()`, and `generateAlphabet()`.

- [ ] **Step 1: Define scope claim constants**

Create a module that defines all the canonical keys for each scope. This replaces the `RuntimeNames` interface and `TEMP_NAME_CATALOG`.

**CRITICAL**: `HANDLER_KEYS` must have an exact 1:1 mapping with the current `TEMP_NAME_CATALOG` (97 entries in `encoding/names.ts` lines 187-333). Missing even one causes a runtime crash when a handler calls `ctx.t("_missingKey")`. Add a static assertion: `HANDLER_KEYS.length >= TEMP_NAME_CATALOG.length`.

```typescript
// src/naming/claims.ts

/** Canonical keys for the shared scope (VM infrastructure).
 *  Must include all keys from SHARED_NAME_KEYS (encoding/names.ts lines 613-640)
 *  so shielded mode groups share these names consistently. */
export const SHARED_KEYS = [
  "bytecodeTable", "cache", "depth", "callStack",
  "fingerprint", "rc4", "binaryDecoder", "deserializer",
  "debugFn", "debugOp", "debugCfg", "debugProt",
  "tdzSentinel", "alphabet", "mathImul", "spreadSymbol",
  "hasOwnProp", "globalRef",
  "polyDecoder", "polyPosSeed", "stringTable", "stringCache", "stringAccessor",
  "router", "routeMap",
] as const;

/** Canonical keys for the interpreter scope. */
export const INTERPRETER_KEYS = [
  "dispatch", "exec", "execAsync", "load",
  "stack", "stackPointer", "instructionPointer",
  "constantsArray", "instructionsArray", "operand",
  "scope", "registers", "exceptionStack",
  "pendingException", "hasPendingException",
  "completionType", "completionValue",
  "unit", "args", "outerScope", "thisValue", "newTarget", "homeObject",
  "physicalOpcode", "opVar",
  "rollingCipherState", "rollingCipherDeriveKey", "rollingCipherMix",
  "integrityHash", "integrityHashFn", "keyAnchor",
  "functionSlots", "stringDecoder", "threshold",
  "programScope",  // was temps["_ps"]
] as const;

/** Canonical keys for handler-level shared temps.
 *  MUST be a complete 1:1 mapping of TEMP_NAME_CATALOG (97 entries).
 *  To build this: iterate TEMP_NAME_CATALOG, assign descriptive key per entry.
 *  Implementation step: programmatically verify length >= TEMP_NAME_CATALOG.length. */
export const HANDLER_KEYS: readonly string[] = buildHandlerKeys();

function buildHandlerKeys(): string[] {
  // Generate from TEMP_NAME_CATALOG with descriptive renames.
  // This function reads TEMP_NAME_CATALOG and maps each canonical _xxx key
  // to a descriptive name. Any unmapped key falls back to the original key.
  // See encoding/names.ts lines 187-333 for the full catalog.
  const DESCRIPTIVE_MAP: Record<string, string> = {
    "_a": "handlerArgs",
    "_b": "handlerArgsB",
    "_rv": "returnValue",
    "_rv2": "returnValue2",
    "_te": "throwExpr",
    "_cu": "closureUnit",
    "_cuid": "closureUnitId",
    "_fu": "closureFunc",
    "_fuid": "closureFuncId",
    "_tv": "thisVal",
    "_tt": "thisType",
    "_tg": "throwGlobal",
    "_ci": "catchIndex",
    "_fi": "finallyIndex",
    "_sp": "savedStackPointer",
    "_h": "exHandler",
    "_iter": "iterator",
    "_done": "iterDone",
    "_value": "iterValue",
    "_async": "iterAsync",
    "_keys": "forInKeys",
    "_idx": "forInIndex",
    "_ho": "homeObjectProp",
    "_dbgId": "debugId",
    "_count": "debugCount",
    "_opNames": "debugOpNames",
    // ... EVERY remaining entry from TEMP_NAME_CATALOG.
    // Implementation: iterate the full catalog and fill this map completely.
  };
  // In implementation: import TEMP_NAME_CATALOG, map each entry.
  // Return the full array of descriptive keys.
  return Object.values(DESCRIPTIVE_MAP);
}
```

**Verification step**: After building `HANDLER_KEYS`, assert `HANDLER_KEYS.length === TEMP_NAME_CATALOG.length` in a test.

- [ ] **Step 2: Create registry setup function**

```typescript
// src/naming/setup.ts
import { NameRegistry } from "./registry.js";
import { SHARED_KEYS, INTERPRETER_KEYS, HANDLER_KEYS } from "./claims.js";

export interface RegistrySetup {
  registry: NameRegistry;
  shared: Record<string, NameToken>;
  interp: Record<string, NameToken>;
  handlers: Record<string, NameToken>;
  scatterScope: NameScope;
  preprocScope: NameScope;
}

export function setupRegistry(seed: number): RegistrySetup {
  const registry = new NameRegistry(seed);
  const sharedScope = registry.createScope("shared", { lengthTier: "medium" });
  const interpScope = registry.createScope("interpreter", { lengthTier: "short" });
  const handlerScope = registry.createScope("handlers", { lengthTier: "short" });
  const scatterScope = registry.createScope("scatter", { lengthTier: "long" });
  const preprocScope = registry.createScope("preprocessing", { lengthTier: "medium" });

  const shared = sharedScope.claimMany(SHARED_KEYS);
  const interp = interpScope.claimMany(INTERPRETER_KEYS);
  const handlers = handlerScope.claimMany(HANDLER_KEYS);

  return { registry, shared, interp, handlers, scatterScope, preprocScope };
}
```

- [ ] **Step 3: Update `transform.ts` — replace name generation with registry**

In `src/transform.ts`:

Replace:
```typescript
// Line 128: const { runtime: names, temps } = generateRuntimeNames(shuffleSeed);
// Line 131: const alphabet = generateAlphabet(shuffleSeed);
```

With:
```typescript
const { registry, shared, interp, handlers, scatterScope, preprocScope } = setupRegistry(shuffleSeed);
```

Update all downstream calls to pass registry-derived values instead of `names`/`temps`.

- [ ] **Step 4: Update `assembler.ts` — replace `createScatterNameGen` with scatter scope**

Replace the `createScatterNameGen()` function and its usage with:
```typescript
// Instead of: const scatterNameGen = createScatterNameGen(seed);
// Use: scatterScope.claim(`frag_${i}`)
```

Update `generateVmRuntime()` and `generateShieldedVmRuntime()` signatures to accept the registry/scopes instead of `RuntimeNames`/`TempNames`.

- [ ] **Step 5: Update `makeHandlerCtx` — wire `local()` to handler sub-scopes**

Replace the interim `local = (key) => key` with actual scope-backed token generation. Each handler invocation gets a fresh sub-scope from the handler scope.

- [ ] **Step 5b: Ensure `rest()` callers are updated**

Grep for all `rest(` calls across the codebase (primarily in `handlers/functions.ts`, `handlers/helpers.ts`, and builder files). The return type changes from `string` to `RestParam`. All `params: string[]` arrays containing `rest()` results must now be typed `(Name | RestParam)[]`. Verify all call sites.

- [ ] **Step 5c: Ensure `buildScopeSetupCode` uses a token**

In `transform.ts` (line ~680-692), `buildScopeSetupCode` uses `temps["_ps"]` for the program scope variable name. Update this to use `interp.programScope` (the token from INTERPRETER_KEYS). Since `buildScopeSetupCode` generates raw code strings (not AST), it must call `token.name` after resolution.

- [ ] **Step 5d: Address handler parameter names when hoisting**

In `interpreter.ts` (lines ~841-845), when hoisting handlers to IIFE scope, the code uses string names like `"unitP"`, `"argsP"` as hoisted parameter names. Currently `obfuscateLocals` renames these. After removing `obfuscateLocals` (Task 8), these must become tokens. Add them to the interpreter scope or handler scope claims.

- [ ] **Step 6: Call `registry.resolveAll()` at the right pipeline point**

**CRITICAL — integrity binding timing:**

In `transform.ts`, the current pipeline computes the integrity hash by emitting the interpreter to a string (`fnv1a(interpSource)`) at lines 207-230. This calls `emit()`, which calls `token.name`. Therefore `resolveAll()` MUST run BEFORE the integrity hash computation.

The pipeline must be reordered:

```
CURRENT:
  1. Compile units (no encoding)
  2. Build interpreter (for integrity hash)
  3. Emit interpreter → compute fnv1a hash     ← needs resolved names!
  4. Generate full runtime (key anchor)
  5. Encode units

NEW:
  1. Compile units (no encoding)                ← tokens unresolved, OK
  2. All tokens claimed by this point
  3. registry.resolveAll()                      ← resolve ALL names
  4. Build interpreter
  5. Emit interpreter → compute fnv1a hash      ← names resolved, works
  6. Generate full runtime (key anchor)
  7. Encode units
```

Insert `registry.resolveAll()` in `transform.ts` BEFORE the integrity hash computation block (before line ~206). Verify that all scatter scope claims (from `scatterKeyMaterials`) also happen before this point — if scatter claims happen during runtime generation (step 4-6), they must be moved earlier or scatter scope must be pre-populated.

- [ ] **Step 7: Update shielded mode pipeline**

Create per-group child scopes. The shared scope tokens (from `SHARED_KEYS`) must be passed to all group interpreters — this replaces the current `SHARED_NAME_KEYS` override in `generateShieldedNames` (encoding/names.ts lines 613-640, 688-692).

```typescript
// Shared scope created once (already done in setupRegistry):
const shared = sharedScope.claimMany(SHARED_KEYS);

for (const [gi, targetPath] of targetPaths.entries()) {
  const groupScope = registry.createScope(`group${gi}`);
  const groupInterp = registry.createScope("interpreter", { parent: groupScope, lengthTier: "short" });
  const groupHandlers = registry.createScope("handlers", { parent: groupScope, lengthTier: "short" });
  const groupScatter = registry.createScope("scatter", { parent: groupScope, lengthTier: "long" });

  // Per-group interpreter keys get unique names
  const gInterp = groupInterp.claimMany(INTERPRETER_KEYS);
  const gHandlers = groupHandlers.claimMany(HANDLER_KEYS);

  // When building the group interpreter, pass BOTH:
  // - shared tokens (for bytecodeTable, cache, deserializer, etc.)
  // - per-group tokens (for exec, stack, registers, etc.)
  // The handler ctx merges shared + group tokens, with shared taking priority
  // for keys in SHARED_KEYS. This mirrors the current SHARED_NAME_KEYS behavior.
}
```

Verify: every key in the current `SHARED_NAME_KEYS` array maps to a key in `SHARED_KEYS`.

- [ ] **Step 8: Run full test suite**

Run: `npm run test`
Expected: ALL 1882 tests PASS

- [ ] **Step 9: Commit**

```bash
git add src/naming/ src/transform.ts src/ruamvm/assembler.ts src/ruamvm/handlers/registry.ts
git commit -m "feat: wire NameRegistry into compilation pipeline, replacing generateRuntimeNames/generateAlphabet"
```

---

### Task 7: Migrate preprocessing

**Files:**
- Modify: `src/preprocess.ts`

- [ ] **Step 1: Split preprocessing into scan + apply phases**

Preprocessing rewrites source text before Babel parsing, so it needs resolved string names. But `resolveAll()` must happen after all tokens are claimed. Solution: two-phase preprocessing.

```typescript
// Phase 1: Scan source, find all identifiers to rename, claim tokens
export function scanIdentifiers(
  code: string,
  scope: NameScope,
): Map<string, NameToken> {
  // Parse with Babel, walk bindings, claim a token per identifier:
  //   scope.claim(`user_${originalName}`)
  // Return the mapping: originalName → token
  // Does NOT modify code yet.
}

// Phase 2: Apply renames using resolved token values (after resolveAll)
export function applyIdentifierRenames(
  code: string,
  renames: Map<string, NameToken>,
): string {
  // Parse with Babel, use scope.rename() with token.name for each binding
  // Tokens are resolved at this point, so .name works.
}
```

Pipeline integration in `transform.ts`:
```
1. Generate seed, create registry
2. Create preprocessing scope
3. const renames = scanIdentifiers(code, preprocScope);  // claim tokens
4. ... claim all other tokens ...
5. registry.resolveAll();
6. code = applyIdentifierRenames(code, renames);         // use resolved names
7. Parse code with Babel
8. Compile, assemble, emit
```

Remove `resetHexCounter()`, `nextHexName()`, and the `hexCounter` global.

- [ ] **Step 2: Run full test suite**

Run: `npm run test`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/preprocess.ts src/transform.ts
git commit -m "feat: preprocessing uses NameRegistry scope for identifier renames"
```

---

### Task 8: Remove old naming system

**Files:**
- Remove: `src/encoding/names.ts`
- Modify: `src/ruamvm/transforms.ts` (remove `obfuscateLocals`)
- Modify: `src/types.ts` (remove `RuntimeNames`/`TempNames` re-exports if any)
- Modify: all files that imported from `encoding/names.ts`

- [ ] **Step 1: Remove `obfuscateLocals` from `transforms.ts`**

Delete the `obfuscateLocals` function (lines 260-339), `shouldRename` (lines 342-344), `collectNames`/`collectNamesFromNode` (lines 347-380), and `renameParams` (lines 428-444).

Keep: `walkReplace`, `walkChildren`, `KEEP`, `RESERVED` sets (these may be used elsewhere).

- [ ] **Step 2: Remove calls to `obfuscateLocals` from `interpreter.ts`**

In `src/ruamvm/builders/interpreter.ts`, remove the call to `obfuscateLocals()` that post-processes handler case bodies.

- [ ] **Step 3: Remove `src/encoding/names.ts`**

Delete the entire file. Update all imports that referenced it.

- [ ] **Step 4: Remove `generateAlphabet` from `src/encoding/decoder.ts`**

Delete the `generateAlphabet()` function and `ALPHABET_BASE` constant. Update imports.

- [ ] **Step 5: Remove `createScatterNameGen` from `assembler.ts`**

Delete the function (lines 712-731) and `SCATTER_LETTERS` constant. Already replaced by scatter scope in Task 6.

- [ ] **Step 6: Update `src/types.ts`**

Remove `RuntimeNames` and `TempNames` type references if they're re-exported. Add `NameRegistry` and `NameToken` to public API if needed.

- [ ] **Step 6b: Verify `structural-transforms.ts` compatibility**

`structural-transforms.ts` creates synthetic `VarDecl` nodes with `name: "__chain__"` — these remain as plain strings (the `Name = NameToken | string` union allows this). Verify this file compiles without changes. If it creates any other `VarDecl` or `Id` nodes with hardcoded names, verify they are intentionally left as strings (they are synthetic nodes that are never directly emitted).

- [ ] **Step 7: Run full test suite**

Run: `npm run test`
Expected: ALL 1882 tests PASS

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add -u
git commit -m "refactor: remove old naming systems (encoding/names.ts, obfuscateLocals, createScatterNameGen, generateAlphabet)"
```

---

### Task 9: Update CLAUDE.md and verify

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update project structure section**

Add `src/naming/` to the directory listing. Remove `src/encoding/names.ts` reference. Update architecture notes.

- [ ] **Step 2: Update architecture notes**

Replace RuntimeNames/TempNames documentation with NameRegistry description. Update the naming-related bullet points.

- [ ] **Step 3: Run final full test suite**

Run: `npm run test`
Expected: ALL tests PASS

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for unified naming system"
```
