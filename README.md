# Ruam

JS VM obfuscator — compiles JavaScript functions into custom bytecode executed by an embedded virtual machine interpreter.

## How It Works

Ruam parses JavaScript source code, identifies target functions, and compiles their bodies into a custom bytecode instruction set. The original function bodies are replaced with calls to a generated VM interpreter that executes the bytecode at runtime. Each file gets:

- A **bytecode table** (`_BT`) containing all compiled function units
- A **VM runtime** with a stack-based interpreter, scope chain, and exception handling
- **Per-file opcode shuffling** so each build produces a different instruction encoding

## Installation

```bash
npm install ruam
```

## Quick Start

### CLI

```bash
# Obfuscate a single file in-place
ruam app.js

# Obfuscate to a new file
ruam app.js -o app.obf.js

# Obfuscate all JS files in a directory
ruam dist/

# With encryption and anti-debugger protection
ruam dist/ -e -d
```

### Programmatic API

```js
import { obfuscateCode, obfuscateFile, runVmObfuscation } from "ruam";

// Obfuscate a string
const result = obfuscateCode('function hello() { return "world"; }');

// Obfuscate a file
await obfuscateFile("src/app.js", "dist/app.js");

// Obfuscate a directory
await runVmObfuscation("dist/", {
  include: ["**/*.js"],
  exclude: ["**/node_modules/**"],
  options: { encryptBytecode: true },
});
```

## CLI Options

```
ruam <input> [options]

Options:
  -o, --output <path>       Output file or directory (default: overwrite input)
  -m, --mode <mode>         Target mode: "root" (default) or "comment"
  -e, --encrypt             Enable bytecode encryption (RC4 + environment fingerprint)
  -p, --preprocess          Rename all identifiers to hex names before compilation
  -d, --debug-protection    Inject anti-debugger timing loop
  --debug-logging           Inject verbose VM trace logging
  --include <glob>          File glob for directory mode (default: "**/*.js")
  --exclude <glob>          Exclude glob for directory mode
  -h, --help                Show help
  -v, --version             Show version
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `targetMode` | `"root" \| "comment"` | `"root"` | `"root"` compiles all top-level functions; `"comment"` only compiles functions preceded by `/* ruam:vm */` |
| `threshold` | `number` | `1.0` | Probability (0-1) that an eligible function is compiled |
| `preprocessIdentifiers` | `boolean` | `false` | Rename all local bindings to `_0x` hex names before compilation |
| `encryptBytecode` | `boolean` | `false` | RC4-encrypt bytecode using an environment fingerprint key |
| `debugProtection` | `boolean` | `false` | Inject an anti-debugger timing loop |
| `debugLogging` | `boolean` | `false` | Inject verbose trace logging into the VM interpreter |

## Architecture

```
src/
  index.ts                       Public API (obfuscateCode, obfuscateFile, runVmObfuscation)
  cli.ts                         CLI entry point
  transform.ts                   Main orchestrator (parse → compile → assemble)
  types.ts                       All TypeScript interfaces
  constants.ts                   Shared constants (parser plugins, globals, limits)
  preprocess.ts                  Optional identifier preprocessing

  compiler/
    index.ts                     Function compilation entry point
    opcodes.ts                   Opcode enum (150 instructions) + shuffle map
    emitter.ts                   Bytecode emitter + constant pool
    scope.ts                     Compile-time scope analysis + register allocation
    encode.ts                    Bytecode serialization (JSON + binary + RC4)
    visitors/
      index.ts                   Barrel exports
      statements.ts              Statement compilation (if, for, while, switch, try, etc.)
      expressions.ts             Expression compilation (calls, members, operators, etc.)
      classes.ts                 Class compilation (methods, properties, inheritance)
      patterns.ts                Destructuring pattern compilation

  runtime/
    vm.ts                        VM runtime code generator (interpreter + dispatch)
    fingerprint.ts               Environment fingerprinting for encryption
    decoder.ts                   RC4 + base64 codec
```

### Compilation Pipeline

```
Source JS
    │
    ▼
Parse (Babel) ──→ AST
    │
    ▼
Identify Target Functions (root-level or comment-annotated)
    │
    ▼
For Each Target Function:
    ├── Compile to BytecodeUnit
    │     ├── Emit opcodes for statements/expressions
    │     ├── Build constant pool
    │     ├── Recurse into nested functions → child units
    │     └── Scope analysis + register allocation
    │
    ├── Serialize (JSON or encrypted binary)
    │
    └── Replace function body with VM dispatch call
    │
    ▼
Generate VM Runtime (IIFE)
    │
    ▼
Assemble: runtime IIFE (with _BT inside) + modified AST
    │
    ▼
Output JS
```

### VM Instruction Set

The VM uses a stack-based architecture with 150 opcodes covering:

- **Stack**: push, pop, dup, swap, rot3
- **Arithmetic**: add, sub, mul, div, mod, pow, neg
- **Bitwise**: and, or, xor, not, shifts
- **Comparison**: eq, neq, seq, sneq, lt, lte, gt, gte
- **Control flow**: jmp, jmp_true, jmp_false, return, throw
- **Scope**: load/store scoped, declare var/let/const, push/pop scope
- **Property access**: static/dynamic get/set/delete, optional chaining
- **Calls**: call, call_method, call_new, super_call, spread
- **Classes**: new_class, define_method, define_getter/setter
- **Functions**: new_closure, new_function (async, generator, arrow support)
- **Iterators**: get_iterator, iter_next, iter_done, for-in
- **Exceptions**: try_push, try_pop, catch_bind, finally

Opcodes are shuffled per-file using a seeded Fisher-Yates permutation, so the same logical instruction maps to different physical byte values in each output.

## Requirements

- Node.js >= 18