# Ruam

JS VM obfuscator — compiles JavaScript functions into custom bytecode executed by an embedded virtual machine interpreter.

## Quick Reference

-   **Package manager**: `bun` (bun workspaces)
-   **Build all**: `bun run build` (lib + worker + website)
-   **Build lib only**: `bun run build:lib` (tsup, ESM-only)
-   **Build worker**: `bun run build:worker` (esbuild + manifest generation)
-   **Build website**: `bun run build:web` (Next.js static export)
-   **Typecheck**: `bun run typecheck` (tsc --noEmit)
-   **Test**: `bun run test` (bun:test, 2204 tests)
-   **Test watch**: `bun run test:watch`
-   **Dev server**: `bun run dev` (Next.js dev)
-   **Stats**: `bun run stats`
-   **Clean**: `bun run clean` (remove dist, .next, caches)
-   **Fresh build**: `bun run build:fresh` (clean + build)
-   **Fresh test**: `bun run test:fresh` (clean + test)
-   **Node**: >= 18, **Module**: ESM (`"type": "module"`)

## Project Structure

```
src/
  index.ts                  Public API: obfuscateCode (sync), obfuscateFile, runVmObfuscation (async)
  cli.ts                    CLI entry point (bin: ruam)
  transform.ts              Main orchestrator: parse -> compile -> assemble
  types.ts                  TypeScript interfaces (VmObfuscationOptions, PresetName, BytecodeUnit, etc.)
  constants.ts              Shared constants (parser plugins, globals list, limits, hash/mixing constants, binary tags)
  babel-compat.ts           Babel ESM/CJS compatibility layer (normalized traverse/generate exports)
  presets.ts                Preset definitions (low/medium/max) + resolveOptions()
  tuning.ts                 Centralized tuning parameters: TuningProfile, getTuningProfile(intensity)
  option-meta.ts            Single source of truth for option metadata (labels, categories, CLI flags)
  preprocess.ts             Optional identifier renaming
  structural-choices.ts     Per-build structural variation: dispatch/return polymorphism, statement shuffling, expression noise
  browser-entry.ts          Browser ESM entry point (re-exports obfuscateCode, presets, types)
  browser-worker.ts         Web Worker for playground (message protocol: {id, code, options} → {id, result, elapsed})
  browser-crypto-shim.ts    Polyfill for Node.js crypto.randomBytes() using Web Crypto API

  compiler/
    index.ts                Function compilation entry point
    opcodes.ts              Opcode enum (~317 opcodes in 26 categories) + per-file shuffle map
    capture-analysis.ts     Capture analysis for register promotion (Tier 1)
    optimizer.ts            Peephole optimizer (Tier 2) + superinstruction fusion (Tier 3)
    emitter.ts              Bytecode emitter + constant pool
    scope.ts                Compile-time scope analysis + register allocation
    encode.ts               Bytecode serialization (binary + custom encoding + FNV-1a+LCG cipher) + string constant encoding
    crypto.ts               Build-time FNV-1a+LCG stream cipher + custom alphabet binary encoding
    fingerprint.ts          Build-time fingerprint computation
    rolling-cipher.ts       Build-time rolling cipher encryption + implicit key derivation
    basic-blocks.ts         Shared basic block identification (used by block permutation + incremental cipher)
    block-permutation.ts    Bytecode basic block shuffling via Fisher-Yates with fall-through JMP insertion
    incremental-cipher.ts   Block-epoch keyed instruction encryption (build-time)
    opcode-mutation.ts      MUTATE opcode insertion at pseudo-random intervals with cumulative mutation state
    visitors/
      index.ts              Barrel exports
      statements.ts         Statement compilation (if, for, while, switch, try, etc.)
      expressions.ts        Expression compilation (calls, members, operators, etc.)
      classes.ts            Class compilation (methods, properties, inheritance)

  naming/
    token.ts                NameToken class — opaque handle with fail-fast .name/.toString()
    scope.ts                NameScope class — child scope with own PRNG, claims tokens + deriveSeed()
    registry.ts             NameRegistry class — central coordinator, resolveAll(), alphabet, createDynamicGenerator()
    reserved.ts             JS reserved words + excluded names sets
    claims.ts               Canonical key definitions for RuntimeNames + TempNames scopes
    setup.ts                Bridge: NameRegistry → RuntimeNames/TempNames (backward compat)
    compat-types.ts         RuntimeNames and TempNames type interfaces
    index.ts                Barrel exports

  ruamvm/
    nodes.ts                JS AST node types (~36 node kinds) + factory functions
    emit.ts                 Recursive emitter: AST -> minified JS with precedence-aware parens
    assembler.ts            VM runtime orchestrator: assembles IIFE from AST builders, incl. shielded mode
    transforms.ts           AST tree transforms (obfuscateLocals)
    structural-transforms.ts Per-build AST walk: control flow, declaration style, expression noise transforms
    mba.ts                  Mixed Boolean Arithmetic AST tree transform
    opaque-predicates.ts    Opaque predicate library: 5 always-true/false mathematical families
    handler-aliasing.ts     Handler aliasing: structurally different implementations per build
    observation-resistance.ts  Observation resistance: identity binding, witnesses, canaries, stack probes
    constant-splitting.ts   Constant splitting: replaces well-known numeric literals with computed expressions
    handler-fragmentation.ts Handler fragmentation: splits handlers into interleaved fragments
    polymorphic-decoder.ts  Per-build decoder chain generator (4-8 reversible byte ops: xor, add, sub, not, rol, ror, swap_nibbles)
    scattered-keys.ts       Key material fragmentation across IIFE tiers (3-5 string fragments, 2-4 array chunks)
    string-atomization.ts   String literal atomization: collects, encodes, replaces with indexed table lookups
    bytecode-scatter.ts     Bytecode scattering: splits encoded strings into heterogeneous fragment types
    builders/
      interpreter.ts        Interpreter builder: assembles sync/async exec from handler registry
      loader.ts             Bytecode loader (binary-only: customDecode → RC4 → deser), cache, depth tracking
      runners.ts            VM dispatch functions (run/runAsync) + shielding router
      deserializer.ts       Binary bytecode deserializer
      fingerprint.ts        Environment fingerprinting runtime source
      decoder.ts            Custom FNV-1a+LCG stream cipher + custom alphabet codec + string constant XOR decoder
      rolling-cipher.ts     Rolling cipher runtime helpers (deriveKey, mix)
      incremental-cipher.ts   Incremental cipher runtime helpers (icBlockKey, icMix)
      debug-protection.ts   Multi-layered anti-debugger (3 detection layers + escalating response)
      debug-logging.ts      Debug trace infrastructure
      globals.ts            Global exposure (globalThis binding)
      unpack.ts             Packed-integer to string decoder for bytecode scattering
    handlers/
      registry.ts           Handler registry (Map<Op, HandlerFn>), HandlerCtx type, makeHandlerCtx
      helpers.ts            Shared handler helpers (buildThisBoxing, debugTrace, superProto, etc.)
      index.ts              Barrel module: re-exports + side-effect imports for 20 handler files
      stack.ts              Stack manipulation opcodes via Array.push/pop/length (PUSH, POP, DUP, SWAP, etc.)
      arithmetic.ts         Arithmetic opcodes (ADD, SUB, MUL, etc.)
      comparison.ts         Comparison opcodes (EQ, NEQ, LT, GT, etc.)
      logical.ts            Logical opcodes (AND, OR, NOT, etc.)
      control-flow.ts       Control flow opcodes (JUMP, JUMP_IF_FALSE, etc.)
      registers.ts          Register opcodes (LOAD_REG, STORE_REG, etc.)
      type-ops.ts           Type opcodes (TYPEOF, INSTANCEOF, etc.)
      special.ts            Special opcodes (PUSH_UNDEFINED, PUSH_NULL, etc.)
      destructuring.ts      Destructuring opcodes (array/object patterns)
      scope.ts              Scope opcodes (PUSH_SCOPE, POP_SCOPE, LOAD/STORE_SCOPED)
      compound-scoped.ts    Compound scoped opcodes (INC_SCOPED, ADD_ASSIGN_SCOPED, etc.)
      objects.ts            Object/array opcodes (NEW_OBJECT, SET_PROP, etc.)
      calls.ts              Call opcodes (CALL, NEW, etc.)
      classes.ts            Class opcodes (NEW_CLASS, DEFINE_METHOD, etc.)
      exceptions.ts         Exception opcodes (THROW, TRY_PUSH, etc.)
      iterators.ts          Iterator opcodes (FOR_IN, FOR_OF, etc.)
      generators.ts         Generator opcodes (YIELD, YIELD_DELEGATE, etc.)
      functions.ts          Function opcodes (CREATE_CLOSURE, RETURN, etc.)
      superinstructions.ts  Fused superinstruction opcodes (REG_ADD, REG_LT_CONST_JF, etc.)
      mutation.ts           Runtime MUTATE opcode handler: deterministic LCG-based handler table permutation

test/
  helpers.ts                Test utility (wraps obfuscateCode + eval)
  core/                     Core JS language feature tests (arithmetic, strings, arrays, objects, etc.)
  stress/                   Stress tests, VM-breaker patterns, randomized fuzz tests
  security/                 Anti-reversing, string encoding, rolling cipher, VM shielding, new feature tests
    incremental-cipher.test.ts  Incremental cipher unit + e2e tests
    semantic-opacity.test.ts    Semantic opacity e2e tests
    observation-resistance.test.ts  Observation resistance e2e tests
    kerckhoffs-hardening.test.ts  Feature combination tests
  integration/              Real-world patterns (Chrome extension, RuamTester)
  ruamvm/                   AST emitter and transform tests
  naming/                   Unified naming system tests (NameRegistry, AST integration, setup bridge)
```

## Architecture Notes

-   **Compilation pipeline**: Source JS -> Babel parse -> identify target functions -> compile each to BytecodeUnit -> serialize -> replace function body with VM dispatch call -> build VM runtime AST -> emit IIFE -> assemble output
-   **JS AST builder system** (`ruamvm/`): All runtime JS is generated via a purpose-built AST with ~36 node types (`nodes.ts`), factory functions, and a recursive emitter (`emit.ts`). Supports modern JS syntax: spread elements (`...expr` in calls/arrays/new), object getters/setters (`{ get x() {} }`), shorthand methods (`{ method() {} }`), and object spread (`{ ...obj }`). Builder files in `ruamvm/builders/` produce `JsNode[]` for each runtime component. The interpreter is assembled from a handler registry (`ruamvm/handlers/`) where each opcode registers a `HandlerFn` returning AST nodes. Tree-based post-processing (`obfuscateLocals` in `transforms.ts`) renames local variables before final emission.
-   **Function table dispatch**: The interpreter uses grouped handler function arrays instead of a giant switch statement. Each opcode handler is a closure (function expression) stored in one of 2-4 balanced group arrays. An if-else chain routes to the correct group based on handler index ranges. Return signaling uses a sentinel object (`_frs = {}`): handlers return `(_frv = value, _frs)` to signal the exec loop to return `_frv`. Async interpreter handler closures are `async` so `await` remains valid inside handler bodies; dispatch calls use `await` for async handlers. Group counts differ between sync and async interpreters for structural differentiation. Physical-to-handler-index mapping uses a packed XOR-encoded array decoded at IIFE scope (resists regex extraction). Implemented in `ruamvm/builders/interpreter.ts` via `buildFunctionTableDispatch()` and `buildHandlerTableMeta()`.
-   **Key anchor**: FNV-1a checksum of the packed handler table data array, stored as a closure variable (`_ka`). Folded into the rolling cipher key derivation as the final XOR step. Prevents extraction of `rcDeriveKey` via `new Function()` (it references the closure variable). When `integrityBinding` is on, the integrity hash is also XOR'd into the key anchor. Computed by `buildHandlerTableMeta()`, consumed by `deriveImplicitKey()`'s `keyAnchor` parameter.
-   **2-pass compilation**: Units are compiled first (without encoding) to determine used opcodes. Then the VM runtime is generated (producing the key anchor value from the handler table). Finally units are encoded using the key anchor. Required because the key anchor depends on handler table structure, which depends on which opcodes are used.
-   **Per-file opcode shuffle**: Seeded Fisher-Yates (LCG) produces different instruction encodings per build. Seed + shuffle constants live in `constants.ts`.
-   **Always-binary format**: All bytecode units are serialized to compact binary (`Uint8Array`) and encoded with a per-build shuffled 64-char alphabet (`A-Za-z0-9_$`). Same bit-packing as base64 (3 bytes → 4 chars) but no padding and a randomized alphabet per build. Output looks like random identifier strings. Alphabet generated via Fisher-Yates shuffle seeded from build seed. JSON serialization path has been eliminated. Runtime decoder builds a reverse lookup table from the embedded alphabet string.
-   **Constant pool string encoding**: All string constants are XOR-encoded with an LCG key stream. Binary format uses `BINARY_TAG_ENCODED_STRING` (tag 11) with uint16 char codes. Decoded at load time by the `strDec` runtime function. When rolling cipher is on, the encoding key is derived implicitly from bytecode metadata (no plaintext seed). Strings remain encoded even after outer encryption is reversed. Build-time crypto operations (stream cipher, custom encoding, fingerprint, rolling cipher) are all in `compiler/`.
-   **Unified naming system** (`naming/`): A central `NameRegistry` + `NameScope` + `NameToken` architecture manages all per-build randomized identifiers. The registry creates scoped name pools, resolves all names collision-free via `resolveAll()`, and produces the encoding alphabet. For dynamic identifier needs (bytecode scattering, scattered keys), `createDynamicGenerator(scopeId)` provides on-demand name generation backed by the registry's global used-set. Seed derivation for all PRNG streams uses `deriveSeed(seed, id)` (FNV-1a-based). The `setupRegistry()` function bridges the registry to `RuntimeNames`/`TempNames` for backward compatibility. AST nodes accept `Name` (NameToken | string) for all identifier positions.
-   **Per-build identifier randomization**: All internal VM identifiers are replaced with random 2-5 char names via the NameRegistry's LCG PRNG (same seed as opcode shuffle). Three length tiers: short (2-3), medium (3-4), long (4-5). Adaptive retry increases length after collisions. The encoding alphabet (64-char, Fisher-Yates shuffled) is also generated by the registry. Handler-local variables are also renamed through the registry via `obfuscateLocals()`, which uses `createDynamicGenerator("handlerLocals")` for collision-safe naming.
-   **Watermark**: Steganographic — the WATERMARK_MAGIC constant (FNV-1a of "ruam" = `0x2812af9a`) is XOR-folded into the FNV offset basis used for key anchor computation. No visible variable, string, or pattern in output. Verified by comparing key anchor results: using standard FNV basis instead of watermarked basis breaks all rolling cipher decryption.
-   **Prototypal scope chain**: Scope chain uses `Object.create(parent)` / `Object.getPrototypeOf(scope)` instead of a `{sPar, sVars}` linked list. Variables are own properties on scope objects. `in` operator traverses the prototype chain for reads; `Object.prototype.hasOwnProperty.call` walk for stores. TDZ uses a per-build sentinel object at IIFE scope (identity comparison via `===`). Program scope is `Object.create(null)` with `defineProperty` bindings.
-   **Array-based stack**: Stack uses native `Array.push()`/`Array.pop()`/`S[S.length-1]` instead of a dedicated stack pointer variable (`S[++P]`/`S[P--]`/`S[P]`). The stack pointer (`stp`) is generated but unused (preserved for LCG sequence stability). Exception handlers save `S.length` as `_sp` and restore via `S.length=_h._sp`. Stack encoding Proxy intercepts `push()` set traps on numeric indices.
-   **Rolling cipher** (`rollingCipher` option): Position-dependent XOR encryption on every instruction. The master key is derived implicitly from bytecode metadata (instruction count, register count, param count, constant count) via FNV-1a, then XOR'd with the key anchor (closure-entangled with the handler table). No plaintext seed appears in the output. Each instruction is encrypted with `mixState(baseKey, index, index ^ 0x9E3779B9)`. Implemented in `compiler/rolling-cipher.ts` (build-time) and `ruamvm/builders/rolling-cipher.ts` (runtime). When enabled, string encoding also uses the implicit key.
-   **Integrity binding** (`integrityBinding` option): A per-build hash (FNV-1a of the interpreter template source) is XOR-folded into the key anchor (`_ka = (_ka ^ integrityHash) >>> 0`) instead of stored as a standalone variable. If an attacker modifies the interpreter, the key anchor changes, and all instruction decryption produces garbage. No longer a greppable `var _x = digits^` pattern. Requires `rollingCipher`.
-   **VM Shielding** (`vmShielding` option): Each root function gets its own micro-interpreter with unique opcode shuffle, identifier names, and rolling cipher key. A shared router function maps unit IDs to group dispatch functions. Shared infrastructure (cache, fingerprint, deserializer) is emitted once. Auto-enables `rollingCipher`. Implemented in `transform.ts` (`assembleShielded()`), `ruamvm/assembler.ts` (`generateShieldedVmRuntime()`), `encoding/names.ts` (`generateShieldedNames()`), and `ruamvm/builders/runners.ts` (`buildRouterSource()`).
-   **Presets**: `low` (VM only), `medium` (+preprocess, encrypt, rolling cipher, decoy/dynamic opcodes, string atomization, polymorphic decoder, scattered keys, bytecode scattering), `max` (+debug protection, integrity binding, dead code, stack encoding, VM shielding, MBA, handler fragmentation, block permutation, opcode mutation, incremental cipher, semantic opacity, observation resistance). Defined in `presets.ts`.
-   **VM recursion limit**: 500 (`VM_MAX_RECURSION_DEPTH` in `constants.ts`)
-   `obfuscateCode()` is synchronous; `obfuscateFile()` and `runVmObfuscation()` are async
-   **Home object (`[[HomeObject]]`)**: Class methods get `fn._ho = target` stamped at define-time. The home object is passed through the VM dispatch chain (`_vm.call` → `exec`) so `super` resolves correctly in multi-level inheritance. `GET_SUPER_PROP`, `SET_SUPER_PROP`, `CALL_SUPER_METHOD`, `SUPER_CALL` all use `Object.getPrototypeOf(homeObject)` when available.
-   **Dynamic opcodes** (`dynamicOpcodes` option): Filters unused opcode handlers from the interpreter, reducing the attack surface for static analysis. Implemented in `ruamvm/builders/interpreter.ts` via `filterUnusedOpcodeHandlers()`.
-   **Decoy opcodes** (`decoyOpcodes` option): Injects 8-16 realistic-looking fake opcode handler closures (arithmetic, stack, register, scope operations) for unused opcode slots. Implemented in `ruamvm/builders/interpreter.ts` via `injectDecoyHandlers()`.
-   **Dead code injection** (`deadCodeInjection` option): Inserts unreachable bytecode sequences after RETURN opcodes in compiled units. Jump targets are patched to maintain correctness. Implemented in `transform.ts` via `injectDeadCode()`.
-   **Stack encoding** (`stackEncoding` option): Wraps the VM stack array in a Proxy that XOR-encodes numeric values with position-dependent keys on set and decodes on get. Non-numeric values are tagged and stored transparently. Implemented in `ruamvm/builders/interpreter.ts` via `buildStackEncodingProxy()`.
-   **Mixed Boolean Arithmetic** (`mixedBooleanArithmetic` option, `--mba` CLI): Replaces arithmetic and bitwise operations in the interpreter with equivalent MBA expressions. Bitwise ops (`^`, `&`, `|`) are always transformed. Arithmetic ops (`+`, `-`) are wrapped with a runtime int32 guard: `(a|0)===a && (b|0)===b ? MBA(a,b) : a+b`. MBA expressions are nested to depth 2 for additional opacity. Implemented in `ruamvm/mba.ts` as an AST tree transform applied to handler case bodies.
-   **Handler Fragmentation** (`handlerFragmentation` option, `--handler-fragmentation` CLI): Splits each opcode handler into 2-3 fragments scattered across the switch as separate case labels. A `_nf` (next-fragment) variable chains fragments via `continue`. The switch becomes a `for(;;){ switch(_nf){...} break; }` flat state machine with hundreds of interleaved micro-states. Fragment IDs are shuffled via Fisher-Yates. Implemented in `ruamvm/handler-fragmentation.ts`. **Note**: Auto-disabled when function table dispatch is active (the default), since handler closures already provide natural isolation. Only applies to the legacy switch-based dispatch path.
-   **String atomization** (`stringAtomization` option): All string literals in the interpreter body (handler cases, builder bodies) are collected, encoded via the polymorphic decoder, and replaced with indexed table lookups (`_sa(index)`). Zero hardcoded strings remain in output — property names like `"prototype"`, `"length"` become opaque table references. Lazy decoding with caching at runtime. Auto-enables `polymorphicDecoder`. Implemented in `ruamvm/string-atomization.ts`.
-   **Polymorphic decoder** (`polymorphicDecoder` option): Generates a per-build random chain of 4-8 reversible byte operations (XOR, ADD, SUB, NOT, ROL, ROR, swap_nibbles) for string encoding/decoding. Each operation uses position-dependent key variation. Deterministically derived from build seed. The AST-generated decoder inherits MBA and structural transforms. Implemented in `ruamvm/polymorphic-decoder.ts`.
-   **Scattered keys** (`scatteredKeys` option): Key materials (alphabet string, handler table data, decoder keys) are split into 3-5 fragments scattered across IIFE scope tiers (tier0–tier4). Fragments are reassembled via per-build random strategies (concat, array.join, spread). Forces attackers to trace the full closure chain to recover key material. Implemented in `ruamvm/scattered-keys.ts`.
-   **Block permutation** (`blockPermutation` option): Identifies basic blocks in each bytecode unit and shuffles their order via Fisher-Yates. The entry block (IP 0) stays in place; all other blocks are permuted. Explicit JMP instructions are inserted for fall-through blocks. All jump targets, exception table entries, and jump table entries are rewritten to new positions. Zero runtime overhead. Implemented in `compiler/block-permutation.ts`.
-   **Opcode mutation** (`opcodeMutation` option): MUTATE opcodes are inserted into bytecode at pseudo-random intervals (every 20-50 instructions). Each MUTATE performs 4 deterministic LCG-driven swaps on the handler table at runtime, so the same physical opcode byte executes different handlers at different execution points. Mutations are cumulative — each builds on the previous state. Makes static disassembly impossible. Auto-enables `rollingCipher` (entangled key derivation). Implemented in `compiler/opcode-mutation.ts` (insertion) and `ruamvm/handlers/mutation.ts` (runtime handler).
-   **Incremental cipher** (`incrementalCipher` option, `--incremental-cipher` CLI): Adds a second encryption layer on top of the rolling cipher. Instructions stay encrypted in the cached unit until the dispatch loop decrypts them JIT. Uses block-epoch keying: each basic block gets a base key derived from (masterKey, blockId), and within a block, each instruction's decryption key chains from the previous instruction's decrypted values via `chainMix()`. Block leaders are computed at runtime from jump/exception table metadata and stored in `U.bl`. At block boundaries (jumps), the chain state resets to `icBlockKey(masterKey, blockId)`. Build-time: `compiler/incremental-cipher.ts` (`deriveBlockKey`, `chainMix`, `incrementalEncrypt`). Runtime: `ruamvm/builders/incremental-cipher.ts` (`icBlockKey`, `icMix`). Requires `rollingCipher` (auto-enabled).
-   **Semantic opacity** (`semanticOpacity` option, `--semantic-opacity` CLI): Three techniques that make emitted handler logic resist automated semantic analysis. (1) **Opaque predicates** — 5 mathematical families (quadratic residue, parity product, bitwise identity, squares mod 4, double parity) generate always-true/false conditions injected into ~50% of handlers with 3+ statements. Dead code fills the false branch. (2) **Handler aliasing** — ~40% of handler bodies are structurally transformed via if/else inversion, sequence expression wrapping, and no-op prefix injection. Different builds select different variants. (3) **Per-handler MBA variants** — when MBA is enabled, each handler gets a unique seed for MBA variant selection, so the same operation (e.g., XOR) looks structurally different across handlers. Implemented in `ruamvm/opaque-predicates.ts`, `ruamvm/handler-aliasing.ts`, and `ruamvm/builders/interpreter.ts`.
-   **Observation resistance** (`observationResistance` option, `--observation-resistance` CLI): Four non-timing-based techniques that silently corrupt computation when instrumentation is detected. All corruption XORs into `rcState`, producing plausible but wrong decrypted instructions. (1) **Function identity binding** — saves references to N critical internal functions at IIFE scope; `orVerify()` checks `saved === current` every ~256 instructions, returns 0 if clean, per-build corruption constant if hooked. (2) **Monotonic witness counter** — every handler increments `_orW`; ~25% of handlers verify the counter is non-decreasing. (3) **WeakMap canaries** — a WeakMap+object pair is planted at IIFE scope; `instanceof` and `.get()` checks detect monkey-patching. (4) **Stack integrity probes** — ~5% of handlers push/pop the TDZ sentinel and verify identity, detecting stack proxy replacement. Requires `rollingCipher` (auto-enabled). Implemented in `ruamvm/observation-resistance.ts`.
-   **Bytecode scattering** (`bytecodeScattering` option, `--bytecode-scattering` CLI): Splits each encoded bytecode string into 2-6 heterogeneous fragments — plain string literals, packed 32-bit integer arrays, or char code arrays. Fragments are scattered throughout the output as individual `var` declarations. The reassembly expression concatenates them back at runtime. An `unpack` function (AST-built, goes through `obfuscateLocals`/MBA/structural transforms) converts packed int arrays to strings. Fragment variable names are generated via `NameRegistry.createDynamicGenerator()` for collision-free naming. Disabled in vmShielding mode (each group already has unique bytecode). Implemented in `ruamvm/bytecode-scatter.ts` (fragment engine), `ruamvm/builders/unpack.ts` (unpack builder), and `transform.ts` (`buildScatteredBtParts`).
-   **Centralized tuning** (`tuning.ts`): A `TuningProfile` interface maps ~20 numeric parameters (mutation intervals, fragment counts, decoder chain lengths, dead code probability, etc.) from three intensity levels (0=conservative, 1=moderate, 2=aggressive) derived from the preset. Modules import from `tuning.ts` instead of hardcoding magic numbers.
-   **Option manifest** (`option-meta.ts` + `scripts/generate-manifest.mjs`): Single source of truth for option metadata (labels, categories, descriptions, CLI flags). Build-time script generates `dist/option-manifest.json` consumed by the website. Adding a new option only requires updating `option-meta.ts` and `presets.ts` — the website picks it up automatically after rebuild.
-   **Conditional async emit**: When no compiled units are async (`hasAsyncUnits = false`), the full async interpreter is skipped entirely. Instead, a simple alias `var execAsync = exec` is emitted (dead-code-path safety). Saves ~46% output size for sync-only code. When both interpreters are needed, they use different handler group counts (e.g., sync=4 groups, async=3 groups via `asyncGroupOffset`) for structural differentiation. Implemented in `ruamvm/builders/interpreter.ts` (`buildInterpreterFunctions`), wired through `ruamvm/assembler.ts` and `transform.ts`.
-   **Natural function stubs**: Compiled function bodies use rest parameters (`...args`) instead of `Array.prototype.slice.call(arguments)`. Regular functions call `vm(id, args, scope, this)` directly instead of `vm.call(this, id, args, scope)` — this-boxing is handled inside the `vm()` dispatch function (guarded by `TV !== void 0` so closures calling `exec` directly are unaffected). A decoy body statement (`var _n = __args.length | 0`) breaks the bare one-liner pattern. Arrow functions omit `this` from the dispatch call. Implemented in `transform.ts` (`replaceFunctionBody`) and `ruamvm/builders/runners.ts` (this-boxing in `buildRunners`).
-   **Target environment** (`target` option, `--target` CLI): Controls environment-specific output settings. Three targets: `"node"` (Node.js CJS/ESM), `"browser"` (plain `<script>` tags, default), `"browser-extension"` (Chrome extension MAIN world — wraps output in IIFE to avoid TrustedScript CSP errors on pages with `require-trusted-types-for 'script'`). Target defaults can be overridden by explicit options. Not included in presets — set independently.
-   **Per-build structural variation** (`structural-choices.ts`): A `StructuralChoices` object is derived from the build seed via `deriveSeed(seed, "structural")` so it doesn't perturb existing PRNG sequences. Controls: (1) **dispatch polymorphism** — three dispatch styles (function-table/direct-array/object-lookup) produce structurally different interpreter bodies, (2) **return mechanism polymorphism** — three return signaling patterns (sentinel/tagged/flag) change how handlers communicate return values, (3) **statement order shuffling** within 5 dependency tiers (~6.2M orderings), (4) **control flow transforms** (if/else↔ternary, for↔while), (5) **function form variation** (FnDecl↔var=FnExpr), (6) **declaration style** (individual/chained/mixed `var` statements), (7) **expression noise** (dot↔bracket notation, `===`↔`!(  !==)`, numeric literal computed equivalents). Dispatch/return polymorphism is wired through `buildInterpreterFunctions`; other transforms applied as a post-processing AST walk in `ruamvm/structural-transforms.ts`. All transforms are semantics-preserving. Combined: 3 dispatch × 3 return × ~6.2M orderings × exponential per-node variations = effectively unique output per build.
-   **CSPRNG seed**: Per-file opcode shuffle seed uses `crypto.randomBytes(4)` instead of `Date.now() ^ Math.random()`.
-   **Babel compat layer**: Shared `babel-compat.ts` normalizes ESM/CJS dual-export shapes for `@babel/traverse` and `@babel/generator`.
-   **Auto-enable rules** in `resolveOptions()`: `integrityBinding` → auto-enables `rollingCipher`; `vmShielding` → auto-enables `rollingCipher`; `stringAtomization` → auto-enables `polymorphicDecoder`; `opcodeMutation` → auto-enables `rollingCipher`; `incrementalCipher` → auto-enables `rollingCipher`; `observationResistance` → auto-enables `rollingCipher`.
-   **Debug protection** (`debugProtection` option, `--no-debug-protection` CLI to override presets): Multi-layered anti-debugger system with 3 independent detection layers: (1) built-in prototype integrity (Object/Array/JSON method monkey-patch detection), (2) environment analysis (--inspect flags, stack traces), (3) function integrity self-verification (FNV-1a checksum). No eval(), new Function(), `debugger` statements, or console.log() calls — fully Chrome extension CSP/TrustedScript compatible. Escalating response requires 3 consecutive detection rounds before acting: silent bytecode corruption → cache/constants wipe → total bytecode annihilation + infinite busy loop. Uses recursive setTimeout with jitter and `.unref()` for Node.js compatibility. Error messages mimic native V8 messages. Implemented in `ruamvm/builders/debug-protection.ts`.
-   **Browser support**: `browser-entry.ts` provides a clean ESM entry point re-exporting `obfuscateCode`, presets, and types. `browser-worker.ts` implements a Web Worker message protocol for playground use (`{id, code, options}` → `{id, result, elapsed}`). `browser-crypto-shim.ts` polyfills Node.js `crypto.randomBytes()` using Web Crypto API.

## Design Principles

These principles govern all contributions to Ruam. They are non-negotiable.

1.  **One centralized system per responsibility.** If Ruam has a universal system for something (naming, seed derivation, tuning), ALL code must use it. No parallel systems, no separate dictionaries, no workarounds that bypass the canonical system. New features work _around_ and _into_ existing architecture, not around it.

2.  **All seeds, all tests, all the time.** Every test must pass deterministically with any randomized seed. There is no such thing as a "flaky" test — if a test sometimes fails, the code has a real bug. Seed-dependent features must be verified across the full range of PRNG outputs.

3.  **`deriveSeed()` for all PRNG isolation.** When a module needs an independent PRNG stream, derive it via `deriveSeed(seed, "descriptiveId")` from `naming/scope.ts`. Never use ad-hoc `seed ^ 0xCONSTANT` — FNV-1a-based derivation provides proper stream independence. All seed derivation is centralized in one mechanism.

4.  **NameRegistry for all identifiers.** Every generated identifier in the output must go through the `NameRegistry` system (`naming/`). For fixed-count identifiers, use `createScope()` + `claim()` + `resolveAll()`. For dynamic/on-demand identifiers (scatter names, fragment names), use `createDynamicGenerator()`. The registry's global used-set guarantees collision-free output without prefix hacks.

5.  **Debug via tracing, not guessing.** When a test fails: add `debugLogging` or targeted trace output, run once to collect evidence, analyze, then implement a fix that provably works. Never re-run failing tests hoping for a different result. Never guess at solutions.

6.  **Statement ordering must respect dependencies.** When inserting generated code (bytecode assignments, fragment declarations) into runtime statements at randomized positions, the insertion point must be AFTER all declarations that the inserted code references. Validate this for every possible shuffle ordering, not just the ones you tested.

## Code Conventions

-   TypeScript with strict mode, ESM imports (`.js` extensions in import paths)
-   `noUncheckedIndexedAccess: true` — always handle possible `undefined` from indexed access
-   Tests use bun:test globals (`describe`, `it`, `expect` — import from `"bun:test"`)
-   Test helper in `test/helpers.ts` wraps `obfuscateCode` + `eval` for round-trip verification
-   No linter/formatter configured — follow existing style
-   JSDoc: every module has `@module` tag, sections use `// --- Name ---` dividers, exported functions have `@param`/`@returns`
-   Runtime ruamvm: builder files in `ruamvm/builders/` export functions accepting `RuntimeNames` and returning `JsNode[]` (AST). Handler files in `ruamvm/handlers/` register `(ctx: HandlerCtx) => JsNode[]` functions in a shared `Map<Op, HandlerFn>` registry. All runtime code uses typed AST nodes — no opaque string snippets.

## Known Bug Fixes (do not regress)

-   **NEW_CLASS**: IIFE-wrapped `_ctor` to prevent var-hoisting sharing across classes
-   **Switch break**: `breakLabel` set before POP so break cleans discriminant off the stack
-   **DEFINE_GETTER/SETTER**: `enumerable: false` to match native class behavior
-   **Labeled continue**: `patchBreaksAndContinues` propagates inner loop's `continueLabel` to parent labeled context
-   **Super expressions**: All `super.prop`, `super.method()`, `super.prop = val`, `super.prop++` patterns compile via dedicated `GET_SUPER_PROP`/`SET_SUPER_PROP`/`CALL_SUPER_METHOD` opcodes instead of trying to compile `Super` as a regular expression
-   **Home object for super**: Multi-level inheritance works correctly via `fn._ho` property stamped by `DEFINE_METHOD`/`DEFINE_GETTER`/`DEFINE_SETTER`, forwarded through closure wrappers
-   **Finally after return**: `cType`/`cVal` completion tracking defers `return` until `finally` executes
-   **Per-iteration `let` bindings**: `for (let ...)` loops emit `PUSH_SCOPE`/`POP_SCOPE` per iteration with variable copying
-   **Sparse array holes**: `[1,,3]` emits `ARRAY_HOLE` (not `PUSH_UNDEFINED + ARRAY_PUSH`)
-   **Computed class methods**: Compile key expression at runtime, use `SET_PROP_DYNAMIC` with home object stamping
-   **Block permutation jump patching**: All jump targets, exception entries, and jump table entries are rewritten to new IP positions after block reordering
-   **Bytecode scatter statement ordering**: Bytecode table assignments that reference `unpack()` must be inserted AFTER all runtime variable/function declarations. `scatterStatements` finds the last declaration index and uses it as the safe insertion floor. Without this, randomized insertion positions could place assignments before the `unpack` function definition.

## Directories to Ignore

-   `TestInputExt/` and `TestOutputExt/` are manual test fixtures (a Chrome extension) — not part of the library
