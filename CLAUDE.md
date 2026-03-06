# Ruam

JS VM obfuscator — compiles JavaScript functions into custom bytecode executed by an embedded virtual machine interpreter.

## Quick Reference

- **Build**: `npm run build` (tsup, ESM-only)
- **Typecheck**: `npm run typecheck` (tsc --noEmit)
- **Test**: `npm run test` (vitest, 603 tests)
- **Test watch**: `npm run test:watch`
- **Node**: >= 18, **Module**: ESM (`"type": "module"`)

## Project Structure

```
src/
  index.ts                  Public API: obfuscateCode (sync), obfuscateFile, runVmObfuscation (async)
  cli.ts                    CLI entry point (bin: ruam)
  transform.ts              Main orchestrator: parse -> compile -> assemble
  types.ts                  TypeScript interfaces (VmObfuscationOptions, PresetName, BytecodeUnit, etc.)
  constants.ts              Shared constants (parser plugins, globals list, limits, watermark)
  presets.ts                Preset definitions (low/medium/high) + resolveOptions()
  preprocess.ts             Optional identifier renaming

  compiler/
    index.ts                Function compilation entry point
    opcodes.ts              Opcode enum (~279 opcodes in 24 categories) + per-file shuffle map
    emitter.ts              Bytecode emitter + constant pool
    scope.ts                Compile-time scope analysis + register allocation
    encode.ts               Bytecode serialization (JSON + binary + RC4)
    visitors/
      index.ts              Barrel exports
      statements.ts         Statement compilation (if, for, while, switch, try, etc.)
      expressions.ts        Expression compilation (calls, members, operators, etc.)
      classes.ts            Class compilation (methods, properties, inheritance)
      patterns.ts           Destructuring pattern compilation

  runtime/
    vm.ts                   VM runtime orchestrator (~100 lines, assembles IIFE from templates)
    names.ts                RuntimeNames interface + per-build randomized name generation (LCG PRNG)
    fingerprint.ts          Environment fingerprinting for encryption
    decoder.ts              RC4 + base64 codec
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
  *.test.ts                 Vitest test files

docs/
  v1-transformations.md     Archived v1 pipeline documentation
```

## Architecture Notes

- **Compilation pipeline**: Source JS -> Babel parse -> identify target functions -> compile each to BytecodeUnit -> serialize -> replace function body with VM dispatch call -> generate VM runtime IIFE -> assemble output
- **Per-file opcode shuffle**: Seeded Fisher-Yates (LCG) produces different instruction encodings per build. Seed + shuffle constants live in `constants.ts`.
- **Per-build identifier randomization**: All internal VM identifiers (`_vm`, `_BT`, `stack`, etc.) are replaced with random 2-3 char names generated via LCG PRNG (same seed as opcode shuffle). Managed by `RuntimeNames` interface in `runtime/names.ts`.
- **Watermark**: Every output contains `var _ru4m=!0;` — looks random but encodes "ruam" with a `4` for `a`.
- **Presets**: `low` (VM only), `medium` (+preprocess, encrypt, decoy/dynamic opcodes), `high` (+debug protection, dead code, stack encoding). Defined in `presets.ts`.
- **VM recursion limit**: 500 (`VM_MAX_RECURSION_DEPTH` in `constants.ts`)
- `obfuscateCode()` is synchronous; `obfuscateFile()` and `runVmObfuscation()` are async
- Many opcodes have VM runtime handlers but are not yet emitted by the compiler — they're ready for future compiler work
- Some preset options (`dynamicOpcodes`, `decoyOpcodes`, `deadCodeInjection`, `stackEncoding`) are defined in types but not yet implemented in runtime generation

## Code Conventions

- TypeScript with strict mode, ESM imports (`.js` extensions in import paths)
- `noUncheckedIndexedAccess: true` — always handle possible `undefined` from indexed access
- Tests use vitest globals (`describe`, `it`, `expect` — no imports needed)
- Test helper in `test/helpers.ts` wraps `obfuscateCode` + `eval` for round-trip verification
- No linter/formatter configured — follow existing style
- Runtime templates: each file in `runtime/templates/` exports a function accepting `RuntimeNames` and returning a JS source string

## Known Bug Fixes (do not regress)

- **NEW_CLASS**: IIFE-wrapped `_ctor` to prevent var-hoisting sharing across classes
- **Switch break**: `breakLabel` set before POP so break cleans discriminant off the stack
- **DEFINE_GETTER/SETTER**: `enumerable: false` to match native class behavior
- **Labeled continue**: `patchBreaksAndContinues` propagates inner loop's `continueLabel` to parent labeled context

## Directories to Ignore

- `TestInputExt/` and `TestOutputExt/` are manual test fixtures (a Chrome extension) — not part of the library
- `docs/` contains only archived v1 documentation
