# Contributing to Ruam

Thanks for your interest in contributing! Ruam is a JS VM obfuscator that compiles JavaScript functions into custom bytecode executed by an embedded virtual machine.

## Prerequisites

- Node.js >= 18
- npm (ships with Node)

## Setup

```bash
git clone https://github.com/owengregson/ruam.git
cd ruam
npm install
```

This is an npm workspaces monorepo:

- `packages/ruam/` — the core library (TypeScript, ESM)
- `apps/web/` — the website (Next.js)

## Development

### Core library

```bash
# Build
npm run build

# Typecheck
npm run typecheck

# Run all tests (~1600 tests)
npm run test

# Watch mode
cd packages/ruam && npm run test:watch
```

### Website

```bash
npm run dev:web
```

## Project structure

```
packages/ruam/
  src/
    index.ts              Public API
    cli.ts                CLI entry point
    transform.ts          Compilation orchestrator
    compiler/             Bytecode compiler (opcodes, emitter, scope, visitors)
    runtime/              VM runtime generator (interpreter, loader, templates)
  test/
    core/                 Language feature tests
    stress/               Stress & fuzz tests
    security/             Anti-reversing tests
    integration/          Real-world pattern tests
```

## Code style

- TypeScript with strict mode
- ESM imports (use `.js` extensions in import paths)
- No linter/formatter — follow existing conventions
- `noUncheckedIndexedAccess: true` — always handle possible `undefined` from indexed access

## Writing tests

Tests use vitest with globals (`describe`, `it`, `expect` — no imports needed). The test helper in `test/helpers.ts` provides `assertEquivalent()` for round-trip verification (obfuscate + eval).

```ts
describe("my feature", () => {
  it("should work", () => {
    assertEquivalent(`
      function test() { return 42; }
    `);
  });
});
```

## Pull requests

1. Create a feature branch from `main`
2. Make your changes
3. Ensure `npm run typecheck` passes
4. Ensure `npm run test` passes
5. Open a PR against `main`

Keep PRs focused — one feature or fix per PR.

## License

By contributing, you agree that your contributions will be licensed under the [GNU Lesser General Public License v2.1](packages/ruam/LICENSE).
