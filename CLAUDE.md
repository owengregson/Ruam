# Ruam

JS VM obfuscator — compiles JavaScript functions into custom bytecode executed by an embedded virtual machine interpreter.

## Quick Reference

- **Build**: `npm run build` (tsup, ESM-only)
- **Typecheck**: `npm run typecheck` (tsc --noEmit)
- **Test**: `npm run test` (vitest, 1657 tests)
- **Test watch**: `npm run test:watch`
- **Node**: >= 18, **Module**: ESM (`"type": "module"`)

## Project Structure

```
src/
  index.ts                  Public API: obfuscateCode (sync), obfuscateFile, runVmObfuscation (async)
  cli.ts                    CLI entry point (bin: ruam)
  transform.ts              Main orchestrator: parse -> compile -> assemble
  types.ts                  TypeScript interfaces (VmObfuscationOptions, PresetName, BytecodeUnit, etc.)
  constants.ts              Shared constants (parser plugins, globals list, limits, hash/mixing constants, binary tags)
  babel-compat.ts           Babel ESM/CJS compatibility layer (normalized traverse/generate exports)
  presets.ts                Preset definitions (low/medium/high) + resolveOptions()
  preprocess.ts             Optional identifier renaming

  compiler/
    index.ts                Function compilation entry point
    opcodes.ts              Opcode enum (~316 opcodes in 26 categories) + per-file shuffle map
    capture-analysis.ts     Capture analysis for register promotion (Tier 1)
    optimizer.ts            Peephole optimizer (Tier 2) + superinstruction fusion (Tier 3)
    emitter.ts              Bytecode emitter + constant pool
    scope.ts                Compile-time scope analysis + register allocation
    encode.ts               Bytecode serialization (JSON + binary + RC4) + string constant encoding
    visitors/
      index.ts              Barrel exports
      statements.ts         Statement compilation (if, for, while, switch, try, etc.)
      expressions.ts        Expression compilation (calls, members, operators, etc.)
      classes.ts            Class compilation (methods, properties, inheritance)

  runtime/
    vm.ts                   VM runtime orchestrator (~100 lines, assembles IIFE from templates)
    names.ts                RuntimeNames interface + per-build randomized name generation (LCG PRNG)
    fingerprint.ts          Environment fingerprinting for encryption
    decoder.ts              RC4 + base64 codec + string constant XOR decoder
    rolling-cipher.ts       Rolling cipher: position-dependent instruction encryption + implicit key derivation
    templates/
      interpreter.ts        Main interpreter core (sync + async exec, opcode switch)
      loader.ts             Bytecode loader, cache, depth tracking, _ru4m watermark
      runners.ts            VM dispatch functions (run/runAsync)
      deserializer.ts       Binary bytecode deserializer
      debug-protection.ts   Anti-debugger timing side-channel
      debug-logging.ts      Debug trace infrastructure
      globals.ts            Global exposure (globalThis binding)

test/
  helpers.ts                Test utility (wraps obfuscateCode + eval)
  core/                     Core JS language feature tests (arithmetic, strings, arrays, objects, etc.)
  stress/                   Stress tests, VM-breaker patterns, randomized fuzz tests
  security/                 Anti-reversing, string encoding, rolling cipher tests
  integration/              Real-world patterns (Chrome extension, RuamTester)

docs/
  v1-transformations.md     Archived v1 pipeline documentation
```

## Architecture Notes

- **Compilation pipeline**: Source JS -> Babel parse -> identify target functions -> compile each to BytecodeUnit -> serialize -> replace function body with VM dispatch call -> generate VM runtime IIFE -> assemble output
- **Direct physical dispatch**: The interpreter switch uses physical (shuffled) opcode numbers as case labels directly — no reverse opcode map is emitted in the output. Each build has unique case label assignments.
- **Per-file opcode shuffle**: Seeded Fisher-Yates (LCG) produces different instruction encodings per build. Seed + shuffle constants live in `constants.ts`.
- **Constant pool string encoding**: All string constants in the JSON bytecode format are XOR-encoded with an LCG key stream derived from the build seed. Decoded at load time by the `strDec` runtime function. Hides variable names, property names, and string literals.
- **Per-build identifier randomization**: All internal VM identifiers (`_vm`, `_BT`, `stack`, etc.) are replaced with random 2-3 char names generated via LCG PRNG (same seed as opcode shuffle). Managed by `RuntimeNames` interface in `runtime/names.ts`.
- **Watermark**: Every output contains `var _ru4m=!0;` — looks random but encodes "ruam" with a `4` for `a`.
- **Rolling cipher** (`rollingCipher` option): Position-dependent XOR encryption on every instruction. The master key is derived implicitly from bytecode metadata (instruction count, register count, param count, constant count) via FNV-1a — no plaintext seed appears in the output. Each instruction is encrypted with `mixState(baseKey, index, index ^ 0x9E3779B9)`. Implemented in `runtime/rolling-cipher.ts`. When enabled, string encoding also uses the implicit key instead of a plaintext literal.
- **Integrity binding** (`integrityBinding` option): A per-build hash (FNV-1a of the interpreter template source) is folded into the rolling cipher's base key (`baseKey = masterKey XOR integrityHash`). The hash is embedded as a numeric literal in the IIFE. If an attacker modifies the hash value, all instruction decryption produces garbage. Requires `rollingCipher`.
- **Presets**: `low` (VM only), `medium` (+preprocess, encrypt, rolling cipher, decoy/dynamic opcodes), `high` (+debug protection, integrity binding, dead code, stack encoding). Defined in `presets.ts`.
- **VM recursion limit**: 500 (`VM_MAX_RECURSION_DEPTH` in `constants.ts`)
- `obfuscateCode()` is synchronous; `obfuscateFile()` and `runVmObfuscation()` are async
- **Home object (`[[HomeObject]]`)**: Class methods get `fn._ho = target` stamped at define-time. The home object is passed through the VM dispatch chain (`_vm.call` → `exec`) so `super` resolves correctly in multi-level inheritance. `GET_SUPER_PROP`, `SET_SUPER_PROP`, `CALL_SUPER_METHOD`, `SUPER_CALL` all use `Object.getPrototypeOf(homeObject)` when available.
- **Dynamic opcodes** (`dynamicOpcodes` option): Filters unused opcode case handlers from the interpreter switch, reducing the attack surface for static analysis. Implemented in `runtime/templates/interpreter.ts` via `filterUnusedOpcodeHandlers()`.
- **Decoy opcodes** (`decoyOpcodes` option): Injects 8-16 realistic-looking fake opcode handlers (arithmetic, stack, register, scope operations) into the interpreter switch for unused opcode slots. Implemented in `runtime/templates/interpreter.ts` via `injectDecoyHandlers()`.
- **Dead code injection** (`deadCodeInjection` option): Inserts unreachable bytecode sequences after RETURN opcodes in compiled units. Jump targets are patched to maintain correctness. Implemented in `transform.ts` via `injectDeadCode()`.
- **Stack encoding** (`stackEncoding` option): Wraps the VM stack array in a Proxy that XOR-encodes numeric values with position-dependent keys on set and decodes on get. Non-numeric values are tagged and stored transparently. Implemented in `runtime/templates/interpreter.ts` via `generateStackEncodingProxy()`.
- **CSPRNG seed**: Per-file opcode shuffle seed uses `crypto.randomBytes(4)` instead of `Date.now() ^ Math.random()`.
- **Babel compat layer**: Shared `babel-compat.ts` normalizes ESM/CJS dual-export shapes for `@babel/traverse` and `@babel/generator`.
- **Auto-enable rollingCipher**: `resolveOptions()` automatically enables `rollingCipher` when `integrityBinding` is set.

## Code Conventions

- TypeScript with strict mode, ESM imports (`.js` extensions in import paths)
- `noUncheckedIndexedAccess: true` — always handle possible `undefined` from indexed access
- Tests use vitest globals (`describe`, `it`, `expect` — no imports needed)
- Test helper in `test/helpers.ts` wraps `obfuscateCode` + `eval` for round-trip verification
- No linter/formatter configured — follow existing style
- JSDoc: every module has `@module` tag, sections use `// --- Name ---` dividers, exported functions have `@param`/`@returns`
- Runtime templates: each file in `runtime/templates/` exports a function accepting `RuntimeNames` and returning a JS source string

## Known Bug Fixes (do not regress)

- **NEW_CLASS**: IIFE-wrapped `_ctor` to prevent var-hoisting sharing across classes
- **Switch break**: `breakLabel` set before POP so break cleans discriminant off the stack
- **DEFINE_GETTER/SETTER**: `enumerable: false` to match native class behavior
- **Labeled continue**: `patchBreaksAndContinues` propagates inner loop's `continueLabel` to parent labeled context
- **Super expressions**: All `super.prop`, `super.method()`, `super.prop = val`, `super.prop++` patterns compile via dedicated `GET_SUPER_PROP`/`SET_SUPER_PROP`/`CALL_SUPER_METHOD` opcodes instead of trying to compile `Super` as a regular expression
- **Home object for super**: Multi-level inheritance works correctly via `fn._ho` property stamped by `DEFINE_METHOD`/`DEFINE_GETTER`/`DEFINE_SETTER`, forwarded through closure wrappers
- **Finally after return**: `cType`/`cVal` completion tracking defers `return` until `finally` executes
- **Per-iteration `let` bindings**: `for (let ...)` loops emit `PUSH_SCOPE`/`POP_SCOPE` per iteration with variable copying
- **Sparse array holes**: `[1,,3]` emits `ARRAY_HOLE` (not `PUSH_UNDEFINED + ARRAY_PUSH`)
- **Computed class methods**: Compile key expression at runtime, use `SET_PROP_DYNAMIC` with home object stamping

## Directories to Ignore

- `TestInputExt/` and `TestOutputExt/` are manual test fixtures (a Chrome extension) — not part of the library
- `docs/` contains only archived v1 documentation
