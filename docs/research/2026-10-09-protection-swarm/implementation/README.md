# Offline regional implementation and evidence

The selected design is implemented as a **bounded research pipeline** with executable recovery tests. It is not a qualified replacement for the production VM. The design's early stopping rules apply before any full-language rewrite or protection-strength claim.

## Delivered behavior

- One browser-safe graph pipeline owns every supplied JavaScript source, preserves scripts versus static ESM contexts, rejects missing/bare/dynamic imports and cycles, and emits generated source with final-byte parse, dependency and UTF-8 evidence.
- Three independently switchable prototypes: fusion of proven private expression helpers; specialization of private nonescaping literal configuration; and composition of a Number-domain branch update into its terminal result. No shared opcode dispatcher, hidden legacy fallback, alternate unprotected backend, server, native runtime or WASM dependency is introduced into this pipeline.
- Shared JavaScript bindings and activation identity remain native. The compiler does not snapshot shared cells or restore over callback writes. Transformations decline outside their proven preconditions.
- One resource plan bounds files, bytes, AST nodes and expansion. Reports distinguish measured size from unmeasured execution and build performance. These structural caps do not claim that the frozen runtime/memory envelope has passed.
- Node publication writes only generated JavaScript into a staged directory, then publishes a complete new directory. Existing destinations are refused. Sources, reports, maps and reconstruction metadata are not copied into client output.
- Library, CLI and browser-worker research entry points use the same graph pipeline. Production VM calls keep their existing behavior; unsupported regional input throws rather than silently using that VM.
- The legacy stack encoder preserves negative zero, fixing incorrect reciprocals under `stackEncoding` and `max`.

## Usage

From the repository root:

```sh
bun run build:lib
node packages/ruam/dist/cli.js --regional-research input.js -o generated-package
node packages/ruam/dist/cli.js --regional-research source-js-directory -o generated-package --entry main.mjs --seed 7
```

The output directory must be absent and its parent must exist. Directory inputs must contain only regular `.js`/`.mjs` files; no assets, glob exclusions, symlinks, CommonJS or discovered external dependencies are inferred. Every file is inventoried even when it is not reachable from an entry. Static relative imports retain native ESM scheduling and live bindings. The receiving host must load modules as ESM; for Node 18, use `.mjs` or an ESM-enabled parent package. The publisher does not invent a `package.json`. Cross-module optimization is not claimed.

```js
import { compileRegionalCode, compileRegionalGraph, protectRegionalPath } from "ruamvm";

const { code, report } = compileRegionalCode(source, { seed: 7 });
// report.status === "experimental-unqualified"
// report.releaseApproved === false

const packageBuild = compileRegionalGraph({
  entryPoints: ["main.mjs"],
  files: {
    "main.mjs": 'import { value } from "./values.mjs"; export const answer = value + 1;',
    "values.mjs": "export const value = 41;"
  }
});

await protectRegionalPath("source-js-directory", "generated-package", {
  entryPoints: ["main.mjs"], compiler: { seed: 7 }
});
```

`fusion`, `joint` and `configuration` default to true in the research API. Set them independently to false for ablations. CLI equivalents are `--no-fusion`, `--no-joint` and `--no-configuration`. VM options and presets are not accepted by the research CLI.

Browser-worker messages may explicitly select `{ id, mode: "regional-research", code, regionalOptions }`; the response contains generated `result` and owner-side `report`. The existing worker protocol remains the default VM path. Browser-safe exports also include `compileRegionalGraph` for callers supplying complete module sources.

## What is deliberately not claimed

The analysis is bounded AST/dataflow analysis, not a completed general value/effect SSA compiler. The joint recipe handles one private branch/state/result relation; it is not whole-loop synthesis. Configuration specialization removes qualified literal table reads, not every private interpreter. General authored logic remains ordinary generated JavaScript, which may be easier to understand or reconstruct. Every report states `wholeSourceProtection: false`.

Structural final-byte evidence is not an independent semantic equivalence proof. A behavior-changing mutation with recomputed digests can pass structural validation and must fail executable differential scoring. Hashes establish which bytes were checked; they do not authenticate execution against an attacker.

Source text reflection, engine-specific stack/error diagnostics, runtime source ingress, async/generators and cyclic modules are outside this research contract. Known source capabilities and aliases are rejected conservatively. This is not a complete capability-flow analysis: unknown host callbacks must not supply runtime compilation capabilities or depend on original source text. Ordinary function callbacks retain native observable execution behavior.

Publication guarantees complete-directory visibility on the tested local filesystem. It does not promise crash durability or isolation from a hostile process concurrently replacing ancestor directories. Output is a new package, never an in-place update.

## Qualification and stopping rules

The executable qualification suite compares plain generation, fusion alone, the branch/result recipe, and configuration specialization over six dependent recurrence specimens, six fixed-configuration specimens and independent-output controls, across eight seeds. Artifact-only recovery performs declaration slicing, bounded scalar symbolic reduction, helper substitution and reconstruction of executable computations. A separate numeric oracle learner attacks easy controls. Neither attacker receives source witnesses or scorer inputs through its API.

These are public deterministic calibration specimens, not a blind external red-team trial. Timings remain local microbenchmarks; analyst setup effort is unknown. Historical controls are pinned separately, and failed or unsupported controls are not treated as protection successes. No baseline-comparative strength multiplier is implied by candidate-versus-plain timings.

Run the tools from `packages/ruam`:

```sh
bun run typecheck
bun test test/regional
bun scripts/regional-qualify.ts
```

The checked-in [qualification evidence](qualification/) records actual outcomes and baseline availability. The frozen design requires stopping expansion if recovery is cheap, complete representative roots cannot qualify, correctness fails, or resource gates fail. The full-language expansion and 5×/10× pilot/promotion campaign must not proceed on a failed early gate. They are not silently waived to label the implementation complete.

## Validation scope

Tests cover signed zero, NaN, throw/finally, coercion ordering, callback writes, shared closures, default-parameter timing, class initialization, BigInt domain rejection, scripts versus modules, dependency order/live bindings, Unicode bytes, budget refusal, publication failures, and attacker validation. The worker bundle is also exercised with dynamic code generation disabled in a Node test context. This is bundle/protocol evidence, not real-browser or extension qualification.

The separate [ambitious architecture track](../../2026-10-09-ambitious-swarm/README.md) selected one algorithm-and-state synthesis hypothesis from 23 overlapping nominations, with three conditional votes. Its [selected design](../../2026-10-09-ambitious-swarm/20-selected-design.md) specifies the shadow-evaluator attack that must precede a larger compiler investment. It is not an implemented mechanism or a measured improvement.
