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
  types.ts                  TypeScript interfaces
  constants.ts              Shared constants (parser plugins, globals list, limits)
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
    vm.ts                   VM runtime code generator (stack-based interpreter + dispatch)
    fingerprint.ts          Environment fingerprinting for encryption
    decoder.ts              RC4 + base64 codec

test/
  helpers.ts                Test utility (wraps obfuscateCode + eval)
  *.test.ts                 Vitest test files

docs/
  v1-transformations.md     Archived v1 pipeline documentation
```

## Architecture Notes

- **Compilation pipeline**: Source JS -> Babel parse -> identify target functions -> compile each to BytecodeUnit -> serialize -> replace function body with VM dispatch call -> generate VM runtime IIFE -> assemble output
- **Per-file opcode shuffle**: Seeded Fisher-Yates (LCG) produces different instruction encodings per build. Seed + shuffle constants live in `constants.ts`.
- **VM recursion limit**: 500 (`VM_MAX_RECURSION_DEPTH` in `constants.ts`)
- `obfuscateCode()` is synchronous; `obfuscateFile()` and `runVmObfuscation()` are async
- Many opcodes have VM runtime handlers but are not yet emitted by the compiler — they're ready for future compiler work

## Code Conventions

- TypeScript with strict mode, ESM imports (`.js` extensions in import paths)
- `noUncheckedIndexedAccess: true` — always handle possible `undefined` from indexed access
- Tests use vitest globals (`describe`, `it`, `expect` — no imports needed)
- Test helper in `test/helpers.ts` wraps `obfuscateCode` + `eval` for round-trip verification
- No linter/formatter configured — follow existing style

## Known Bug Fixes (do not regress)

- **NEW_CLASS**: IIFE-wrapped `_ctor` to prevent var-hoisting sharing across classes
- **Switch break**: `breakLabel` set before POP so break cleans discriminant off the stack
- **DEFINE_GETTER/SETTER**: `enumerable: false` to match native class behavior

## Directories to Ignore

- `TestInputExt/` and `TestOutputExt/` are manual test fixtures (a Chrome extension) — not part of the library
- `docs/` contains only archived v1 documentation
