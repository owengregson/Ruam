# Traveling Isogloss — Test Migration and Legacy-Deletion Matrix

**Date:** 2026-07-24  
**Status:** Phase 0 inventory  
**Scope:** Every file under `packages/ruam/test/` and every script under `packages/ruam/scripts/`  
**Parent plan:** [Traveling Isogloss — Rank 1 Implementation Plan](2026-07-24-traveling-isogloss-implementation-plan.md)

## 1. Classification contract

Every current test suite has one primary cutover classification:

| Code | Classification | Required cutover action |
|---|---|---|
| **C1** | JavaScript semantic correctness | Port unchanged in behavioral intent to native JavaScript vs TypeScript reference BCM vs emitted BCM. VM terminology and VM-only options are removed. |
| **C2** | Generic protection, code-generation, packaging, or performance property | Rewrite against Isogloss, the lattice artifact, or engine-independent runtime infrastructure. Do not preserve the legacy mechanism merely to preserve the test. |
| **C3** | VM-mechanism-only | Delete with the VM mechanism, but first extract any unique JavaScript program shape or generic security assertion identified in this matrix. |

Primary classification is by the reason the file exists. Several files contain mixed sections; those sections have explicit split dispositions below. A C3 file may not be deleted merely because its named mechanism is gone: every unique semantic fixture listed in Section 7 must first appear in a C1 Isogloss suite.

## 2. Inventory result

The current tree contains:

- **46 Bun test-suite files** (`*.test.ts`);
- **5 test support/fixture files**;
- **5 package scripts**;
- **56 total inventoried files**.

Primary classification of the 46 suite files:

| Classification | Suite files | Share |
|---|---:|---:|
| C1 — semantic correctness | 23 | 50.0% |
| C2 — generic/rewrite | 16 | 34.8% |
| C3 — VM-only/delete after extraction | 7 | 15.2% |
| **Total** | **46** | **100%** |

At validation time there are 1,247 lexical `it(` call sites in the 46 suite files. This is a sizing indicator, not the runtime test count: several suites generate cases in loops and the two large JavaScript fixtures run their own assertion catalogs.

### Common path exercised by C1 end-to-end tests

Most C1 suites call `test/helpers.ts`, which currently reaches:

```text
test/helpers.ts
  → src/transform.ts
  → src/compiler/index.ts
  → src/compiler/{emitter,scope,capture-analysis,optimizer}.ts
  → src/compiler/visitors/{expressions,statements,classes}.ts
  → src/ruamvm/assembler.ts
  → src/ruamvm/builders/{loader,runners,interpreter,deserializer}.ts
  → src/ruamvm/handlers/*.ts
```

After cutover, the permanent oracle path must be:

```text
test/helpers.ts
  ├→ native JavaScript
  ├→ canonical semantic IR evaluator
  ├→ src/isogloss/reference-runtime.ts
  └→ emitted BCM runtime
```

The VM may remain a migration-only fourth oracle before Phase 10. It must not remain in the final helper or product path.

## 3. C1 — JavaScript semantic suites to port

All files in this table remain active tests. Their assertions should be preserved unless an assertion itself encodes a VM mechanism.

| Existing suite | Current production modules primarily exercised | Isogloss port target and required additions |
|---|---|---|
| `test/core/advanced.test.ts` | All compiler visitors; `handlers/{calls,classes,functions,objects,scope,special,type-ops}.ts` | `test/isogloss/runtime-core.test.ts` and `runtime-classes.test.ts`; retain all advanced expressions, prototypes, classes, and built-in interaction cases. |
| `test/core/arithmetic.test.ts` | `visitors/expressions.ts`; `handlers/{arithmetic,comparison,logical,mutation,type-ops}.ts` | Semantic-handler differential corpus plus `runtime-core.test.ts`; each `SemanticOp` family must also have a signature-table case. |
| `test/core/arrays.test.ts` | `visitors/{expressions,statements}.ts`; `handlers/{objects,iterators,destructuring,calls,special}.ts` | `runtime-core.test.ts`; add sparse-array, iterator-close, and accessor-reentrancy event logs. |
| `test/core/async.test.ts` | Async compilation in `compiler/index.ts`; `handlers/generators.ts` `AWAIT`; async interpreter/runners | `runtime-async.test.ts`; keep all 16 value cases, then add scheduling, interleaving, rejection recovery, and single-carrier assertions described in Section 8. |
| `test/core/basic.test.ts` | Target selection, function compilation, constants, stack/register handlers, return | Phase 3 reference-runtime smoke suite and `runtime-core.test.ts`. |
| `test/core/closures-basic.test.ts` | `capture-analysis.ts`, `scope.ts`; `handlers/{functions,scope,registers}.ts` | `runtime-closures.test.ts`; assert escaped closures retain their originating root group. |
| `test/core/closures-scope.test.ts` | Capture analysis, lexical scope chain, child units, call/function/scope handlers | `runtime-closures.test.ts`; add calls before and after unrelated carrier evolution. |
| `test/core/control-flow-basic.test.ts` | `visitors/statements.ts`; `handlers/control-flow.ts`; optimizer jump handling | Phase 2 CFG/lattice fixtures, `cfg-bisimulation.test.ts`, and `runtime-control-flow.test.ts`. |
| `test/core/control-flow.test.ts` | Full statement visitor, exception tables, jump patching, `handlers/{control-flow,exceptions,iterators}.ts` | Primary CFG-bisimulation and runtime-control-flow corpus. Preserve every nested `finally`, labeled break/continue, switch, and loop shape. |
| `test/core/destructuring.test.ts` | `visitors/{expressions,statements}.ts`; `handlers/destructuring.ts` | `runtime-core.test.ts`; operand-reservoir tests must include defaults, rest, holes, and computed keys. |
| `test/core/edge-cases.test.ts` | Parser plugins, target selection, expressions/statements, calls/special handlers, dynamic import harness | `runtime-core.test.ts` plus environment integration. Preserve dynamic import behavior but separate it from CSP proof. |
| `test/core/exceptions.test.ts` | Exception regions, `handlers/exceptions.ts`, interpreter catch routing | `runtime-exceptions.test.ts`; add post-uncaught-error carrier validity and exact event-order comparison. |
| `test/core/functions.test.ts` | Function/arrow/default/rest/arguments compilation; calls/functions/scope handlers | `runtime-core.test.ts`, `runtime-closures.test.ts`, and `runtime-reentrancy.test.ts`; recursion cases become single-carrier assertions. |
| `test/core/indexed-slots.test.ts` | Despite its name, current `capture-analysis.ts`, `scope.ts`, register promotion, scope-chain handlers, classes and catch scoping | Rename away from “indexed slots” and port the complete lexical-scope corpus to `runtime-closures.test.ts`; do not recreate VM slots. |
| `test/core/objects.test.ts` | Object/class expression visitors; `handlers/{objects,classes,calls,mutation,type-ops}.ts` | `runtime-core.test.ts`, `runtime-classes.test.ts`, and accessor-reentrancy cases. |
| `test/core/strings.test.ts` | Expression compiler, constant pool, calls/objects/type-ops handlers | Semantic-handler differential corpus and `runtime-core.test.ts`; keep Unicode and coercion cases independent of artifact string protection. |
| `test/integration/chrome-ext-patterns.test.ts` | `transform.ts`; async/class/call handlers; Node `vm` harness | Port as async/class semantics. It is **not** currently a browser-extension or CSP execution test; add real worker/MV3-style execution separately. |
| `test/integration/ruam-tester-lite.test.ts` | Full end-to-end pipeline over `RuamTesterLite.js` | Keep native/default semantic smoke cases. Delete the `vmShielding` case (C3). Rewrite the max-preset case for the Isogloss max profile (C2). |
| `test/integration/ruam-tester.test.ts` | Full end-to-end pipeline over `RuamTester.js` | Retain as the broad semantic acceptance fixture; compare native, reference BCM, and emitted BCM summaries. |
| `test/stress/randomized.test.ts` | Broad compiler/handler surface; rolling-cipher, integrity, and preset sections | Port arithmetic through exception and deep-nesting generators to deterministic Isogloss seed stress. Delete the rolling-cipher section (C3); rewrite integrity/preset sections (C2). Replace `Math.random()` with logged deterministic data seeds. |
| `test/stress/repro-exception.test.ts` | `transform.ts`; try/catch property-name/scoping collision; runtime exception route | Add verbatim to `runtime-exceptions.test.ts` and the 1,024-seed release tier. |
| `test/stress/stress-breaker.test.ts` | Capture/scope, `this`, exceptions, mutation, recursion, iterators, constructors, coercion | Split among closure, class, exception, reentrancy, and core Isogloss suites. Preserve all 51 cases. |
| `test/stress/vm-breaker.test.ts` | Broad semantic compiler and handler catalog | Rename to engine-neutral semantic adversarial tests and preserve all 70 cases. The “generator-like state machines” section is ordinary manual state-machine code and does **not** cover JavaScript generators. |

### C1 source-to-target ownership

| Current semantic implementation | Existing coverage | Target ownership |
|---|---|---|
| `compiler/visitors/expressions.ts` | Arithmetic, arrays, objects, strings, functions, advanced, breakers | `compiler/ir.ts`, `compiler/semantic-ops.ts`, and handler differential suites |
| `compiler/visitors/statements.ts` | Control flow, exceptions, arrays/iterators, breakers | `compiler/cfg.ts`, `cfg-bisimulation.test.ts`, runtime control/exception suites |
| `compiler/visitors/classes.ts` | Advanced, objects, Chrome-extension patterns, breakers | `runtime-classes.test.ts` |
| `compiler/capture-analysis.ts` and `compiler/scope.ts` | Closure, indexed-slots, function, breaker suites | `runtime-closures.test.ts` and reentrancy suite |
| `ruamvm/handlers/*.ts` language behavior | All C1 suites | Move to `runtime/handlers/*.ts`; direct native differential test for every semantic family |
| VM interpreter/runners/loader | Incidental coverage in every C1 suite | Replaced by reference and emitted BCM oracles; no VM-specific assertion survives |

## 4. C2 — Generic properties to rewrite for Isogloss

| Existing suite | Current production modules primarily exercised | Required rewrite |
|---|---|---|
| `test/core/deterministic-entropy.test.ts` | `src/testing.ts`, `random/entropy.ts`, and the complete transform path | Retain as the deterministic build foundation. Rename its helper for `protectCode`, remove legacy cipher options, add stable output/certificate assertions, and keep labeled stream-isolation coverage. |
| `test/isogloss/semantic-signatures.test.ts` | Transitional `compiler/{opcodes,semantic-ops,semantic-signatures,ir}.ts` | Retain and strengthen. The current `SemanticOp === Op` alias assertions are migration-only and must be deleted with `opcodes.ts`; add exhaustiveness, exact signature facts, dynamic stack effects, and a proof that no VM-only `MUTATE` semantic remains at cutover. |
| `test/naming/ast-integration.test.ts` | `naming/{registry,scope,token}.ts`; `ruamvm/{nodes,emit}.ts` | Repoint to `runtime/{nodes,emit}.ts`; preserve NameToken-to-AST integration. |
| `test/naming/registry.test.ts` | `naming/{registry,scope,token,reserved}.ts` | Retain and add Isogloss scope/claim collision cases plus deterministic stream isolation. |
| `test/naming/setup.test.ts` | `naming/{setup,claims,compat-types}.ts` | Rewrite `setupRegistry` expectations for BCM names. Delete `setupShieldedRegistry` assertions; root groups are not shielding. |
| `test/ruamvm/emit.test.ts` | `ruamvm/{nodes,emit}.ts` | Move unchanged in intent to `test/runtime/emit.test.ts` against `runtime/{nodes,emit}.ts`. Remove `debuggerStmt` from the production-capable API or prove it cannot enter output. |
| `test/ruamvm/transforms.test.ts` | `ruamvm/{nodes,emit,transforms}.ts` | Move only engine-independent AST transforms to `runtime/`; rewrite names and import boundaries. |
| `test/security/anti-reversing.test.ts` | `transform.ts`, `compiler/{opcodes,encode}.ts`, interpreter table, naming, string encoding | Replace opcode-array/function-table regexes with `novelty-invariants.test.ts` and a format-aware `static-extractor.test.ts`. Keep plaintext absence and per-build variation only where the Isogloss artifact makes the same claim. |
| `test/security/debug-protection.test.ts` | `ruamvm/builders/debug-protection.ts`, assembler, presets, naming | The option is removed at cutover, then redesigned. Preserve the generic CSP/no-eval/no-`new Function`/no-`debugger` requirements in a runtime-wide CSP suite. Rewrite feature-specific assertions only when the engine-independent replacement exists. |
| `test/security/feature-combinations.test.ts` | `presets.ts`, `types.ts`, `transform.ts`, nearly all legacy hardening modules, preprocessing/naming | Preserve the compact language fixtures. Rebuild the pair/triple matrix only from Isogloss-native Phase 9 options and add metadata-driven coverage. |
| `test/security/kerckhoffs-hardening.test.ts` | Incremental cipher, semantic opacity, observation resistance through the full pipeline | Preserve the principle and language fixtures, not the three VM mechanisms. Rewrite as a known-design Isogloss hardening/novelty suite. |
| `test/security/new-features.test.ts` | `polymorphic-decoder.ts`, `string-atomization.ts`, `scattered-keys.ts`, `block-permutation.ts`, `opcode-mutation.ts` | Split: decoder and string atomization become later engine-independent artifact/runtime tests; scattered keys, block permutation, and opcode mutation are C3 deletions; combined cases become Isogloss hardening-profile tests. |
| `test/security/observation-resistance.test.ts` | `ruamvm/observation-resistance.ts`, interpreter witnesses/canaries/probes, legacy feature interactions | Redesign as BCM observation-resistance tests only after a BCM-specific threat model exists. Preserve its language fixtures in C1 meanwhile. |
| `test/security/semantic-opacity.test.ts` | `opaque-predicates.ts`, `handler-aliasing.ts`, `mba.ts`, interpreter builder | Reuse proven predicate/alias properties for `isogloss/constraints.test.ts` and semantic-alias tests. Do not preserve the VM handler-table injection path. Replace test-only `new Function` predicate evaluation with an AST-evaluated or isolated CSP-neutral oracle. |
| `test/security/string-encoding.test.ts` | `compiler/encode.ts`, runtime decoder/deserializer, constants | Rewrite as Isogloss artifact string round-trip and plaintext-inspection coverage. Preserve ASCII, Unicode, special-character, long-string, property-name, regex, error, closure, and class fixtures. |
| `test/stress/performance.test.ts` | `index.ts`, complete transform/runtime, Node `vm` | Convert to a budgeted Isogloss performance smoke test or move measurements into scripts. It currently always passes regardless of speed and therefore enforces no release gate. |

## 5. C3 — VM-mechanism suites to delete after extraction

| Existing suite | VM modules exercised | What must be extracted before deletion |
|---|---|---|
| `test/security/bytecode-scatter.test.ts` | `ruamvm/bytecode-scatter.ts`, `ruamvm/emit.ts` | No bytecode-scatter logic survives. Its fragment round-trip concept may inform `artifactScattering`, but there is no required code port. |
| `test/security/decode-cache.test.ts` | `builders/loader.ts`, `builders/interpreter.ts`, rolling/incremental cipher gates, opcode mutation and observation resistance | Port the control-flow-heavy `PROGRAMS` corpus, especially repeated calls, backward jumps, mutual recursion, and nested return-through-finally. Delete all cache-active/cache-disabled assertions. |
| `test/security/incremental-cipher.test.ts` | `compiler/{incremental-cipher,basic-blocks,opcodes}.ts`, `BytecodeUnit`, runtime incremental decoder | Port unique end-to-end async/control/exception fixtures; delete block-key, epoch, encryption, and instruction-array assertions. |
| `test/security/rolling-cipher.test.ts` | `compiler/{rolling-cipher,encode}.ts`, runtime rolling decoder, integrity binding, bytecode format, dead-code injection | Extract the unique semantics and generic artifact-integrity/plaintext properties listed in Section 7. Delete rolling-key, instruction encryption, binary-bytecode, and cipher-combination assertions. |
| `test/security/slot-save-restore.test.ts` | `compiler/{slot-analysis,opcodes}.ts`, VM handler AST registry, VM interpreter hoisted slots | Port its recursion/exception/`this` end-to-end programs to single-carrier reentrancy tests. Delete slot-set introspection and VM snapshot/restore assertions. |
| `test/security/vm-shielding.test.ts` | Shielded branch in `transform.ts`, `ruamvm/assembler.ts`, per-group opcode shuffles/ciphers, shielded naming | Port independent-root, cross-function, escaped-closure, async, and class fixtures to root-group/carrier tests. Delete shuffle, auto-cipher, and shielding-option assertions. |
| `test/stress/opcode-mutation-controlflow.test.ts` | `compiler/{opcode-mutation,block-permutation,rolling-cipher}.ts`, mutable VM handler table | Port all three programs to `cfg-bisimulation`, exception, and fixed-seed stress suites. Delete only the mechanism/options. |

## 6. Test support and fixture files

| File | Classification | Disposition |
|---|---|---|
| `test/helpers.ts` | C1/C2 foundation | Replace `VmObfuscationOptions` and `evalObfuscated()` with native/reference/emitted BCM helpers. Add value, error, event-order, carrier-evolution, and fixed-entropy APIs. VM oracle access must live in a migration-only helper deleted at Phase 10. |
| `test/RuamTester.js` | C1 fixture | Retain the semantic catalog, rename VM-oriented comments, and run through all permanent oracles. |
| `test/RuamTesterLite.js` | C1 fixture | Retain as the fast smoke fixture, rename VM-oriented comments, and run through reference and emitted BCM. |
| `test/RuamTesterLiteO.js` | C3 generated legacy artifact | It is not referenced by any test and has no recorded seed/provenance. Move to the frozen Phase 0 legacy-output archive with metadata if it is useful; otherwise delete at cutover. Never use it as an Isogloss oracle. |
| `test/webpack-scope-repro.js` | C1 dormant fixture | It is currently unreferenced. Add a Bun integration wrapper and port it as class field, closure, module-factory, getter-export, and source-selection coverage. Replace its uncontrolled `Math.random()` use for deterministic testing. |

## 7. Mandatory semantic extraction before C3 deletion

These cases are easy to lose because they currently live inside mechanism suites.

| Source suite/section | Destination before deletion |
|---|---|
| `decode-cache`: backward loop, nested forward jumps, switch+continue, try/catch/finally routes, recursion, labeled break/continue | `runtime-control-flow.test.ts`, `runtime-exceptions.test.ts`, `persistence.test.ts`, and seed-stress curated fixtures |
| `incremental-cipher` end-to-end: async function and any unique exception/block-boundary programs | `runtime-async.test.ts`, `runtime-exceptions.test.ts`, `cfg-bisimulation.test.ts` |
| `rolling-cipher` correctness: deep closures, class inheritance, many/rest parameters, multiple independent roots, recursive closures, thrown exit, async, optional-access Chrome pattern | Corresponding C1 runtime suites |
| `rolling-cipher` integrity/plaintext sections | `format-roundtrip.test.ts`, `novelty-invariants.test.ts`, and future lattice/runtime integrity tests; preserve the property, not cipher constants |
| `rolling-cipher` dead-code section: nested finally, multiple returns, switch returns | `runtime-exceptions.test.ts` and `runtime-control-flow.test.ts` |
| `slot-save-restore` end-to-end: recursion, nested exceptions, `this`/`new.target` context | `runtime-reentrancy.test.ts`, `runtime-exceptions.test.ts`, `runtime-classes.test.ts` |
| `vm-shielding`: independent roots, cross-root calls, shared closure, async root, classes | `pipeline/groups` tests, root-group carrier-isolation tests, closure and async suites |
| `opcode-mutation-controlflow`: all three regression programs | Fixed-seed CFG, exception, and topology stress corpus |
| `new-features`: block-permutation and opcode-mutation semantic programs | C1 control-flow/exception/core suites before their mechanism sections are deleted |
| `randomized`: rolling-cipher section | Delete; semantic generators already remain. Any distinct fixture discovered during porting is moved to the engine-neutral randomized corpus. |

No C3 deletion commit is complete until an automated fixture manifest maps each row above to its new test file.

## 8. Coverage gaps against the implementation plan

### P0 — release-blocking gaps

| Gap | Existing evidence | Missing authoritative evidence |
|---|---|---|
| **Real JavaScript generators** | No test or fixture under `packages/ruam/test` contains `function*` or an executed `yield`. `test/stress/vm-breaker.test.ts` only tests hand-written “generator-like” state machines. `ruamvm/handlers/generators.ts` implements generator lifecycle operations as stubs. | `runtime-generators.test.ts` covering `next`, sent values, `yield*`, `throw`, `return`, `finally`, escaped generators, multiple parked generators in one root group, async generators, abandonment cleanup, and carrier uniqueness. Generator support is currently **unproven**. |
| **Reference BCM oracle** | `test/helpers.ts` compares only native and emitted legacy VM values. | Native vs canonical IR evaluator vs reference BCM vs emitted BCM, including minimized reproducible state diagnostics. |
| **Carrier correctness/persistence** | Decode-cache tests repeat calls, but only validate stable VM decoded instructions. | Carrier changes after every semantic transition, remains one-per-root-group, persists across successful/throwing calls, remains valid after uncaught errors, and never grows append-only history. |
| **Reentrancy** | Scattered getters/setters, `valueOf`, recursion, and callback tests exercise JavaScript semantics but do not intentionally call back into the same protected root while a handler is active. | Dedicated accessor, Proxy trap, `Symbol.toPrimitive`, `valueOf`, user callback, constructor, and cross-root reentry cases with frame/resume-gate and one-live-carrier assertions. |
| **Adversarial static extractor** | `anti-reversing.test.ts` uses output regexes for numeric arrays, strings, names, and a giant switch. | Full-format parser/deserializer with knowledge of resolver, catalog, reservoirs, and topology; TI-01 through TI-07 checks; site-to-handler recovery attempt; lineage-transfer and next-lineage-prediction measurements. |
| **No-legacy cutover proof** | No current test inventories imports, package contents, CLI aliases, types, flags, loaders, or fallback paths. | `migration/no-legacy-vm.test.ts` and package-surface inventory enforcing TI-14. |
| **Verifier/property coverage** | Existing semantic tests only show executions that happened to run. | Certificate, constraint, candidate-mask cardinality, non-boundary uniqueness, operand-reuse, cell-reuse, phase-cycle, CFG-bisimulation, and finite verifier-state property suites. |

### P1 — required before async/browser/performance gates

| Gap | Existing evidence | Required addition |
|---|---|---|
| **Async scheduling and interleaving** | `core/async.test.ts` has 16 useful value cases; `chrome-ext-patterns.test.ts` has 11 realistic async/class cases. Most assert only final values. | Side-effect event logs for two interleaved calls, nested awaits, rejection then later success, callbacks that reenter, host microtask order, continuation cleanup, and an assertion that Ruam adds no queue. |
| **CSP/environment execution** | `debug-protection.test.ts` checks strings for `debugger`, `eval`, and `new Function`. `chrome-ext-patterns.test.ts` executes in Node `vm`, not Chrome. `build-browser.mjs` bundles a worker but does not execute a CSP fixture. | Actual Node, browser page, dedicated worker, and MV3/service-worker-style fixtures under a restrictive CSP; scan and execute production output; verify no network/storage/timer dependency is required. |
| **Performance release budgets** | `stress/performance.test.ts` is informational and ends with `expect(true)`. `bench.mjs` measures native vs total/boot/steady execution and size. `bench-attribution.mjs` only removes legacy VM features. | Versioned JSON; build-phase timings; payload/runtime/sidecar bytes; bootstrap/first/repeated call; recursion, loop, property, exception, async-interleave workloads; peak/retained memory; enforced median/P95 release thresholds from the plan. |
| **Deterministic fuzzing and seeds** | `core/deterministic-entropy.test.ts` now proves fixed-build reproduction and labeled stream isolation. `randomized.test.ts` still uses unseeded `Math.random()`, and the stress corpus does not yet record a reproducible build/data seed pair. | Use `src/testing.ts` fixed entropy plus a separate deterministic data seed; print both on failure; enforce 8/32/256/1,024 seed tiers. |
| **Errors as observable behavior** | Helpers generally compare values with `toEqual`; exception suites do not provide a common error oracle. | Compare error constructor/name/message where specified, explicit side-effect log, thrown value identity where required, and post-error carrier state. |
| **Owner sidecar and runtime trace** | No current coverage. | Sidecar schema/round-trip, absence from production payload, event decoding, source-span mapping, runtime-trace scheduling neutrality, and security/performance exclusion. |
| **Removed-option and metadata drift** | Feature suites pass legacy option objects directly. The CLI and manifest are not cross-checked. | Removed-option tombstone tests, generalized metadata/CLI/preset/manifest drift tests, unknown nested-property rejection, and pre-parse failure evidence. |
| **Frozen Phase 0 outputs** | `RuamTesterLiteO.js` is one unreferenced generated artifact without recorded seed or provenance. | Versioned output/measurement fixtures for core, closure, exception, class, async, generator-known-unsupported baseline, and max preset, each with source, options, seed, tool revision, and checksum. |

## 9. Required new suite map

| Planned suite | Best reusable current input | Net-new requirement |
|---|---|---|
| `test/isogloss/certificate.test.ts` | None | Certificate counts/digest/schema and encoded-lattice match |
| `test/isogloss/cfg-bisimulation.test.ts` | Core control-flow plus extracted C3 regressions | Mechanical edge-by-edge CFG/refold equivalence |
| `test/isogloss/constraints.test.ts` | Semantic-opacity predicate/alias ideas | TI-02 through TI-05, UNSAT diagnostics, attempt budgets |
| `test/isogloss/format-roundtrip.test.ts` | String encoding and generic fragment round trips | Isogloss envelope only; absence of legacy payload variants |
| `test/isogloss/novelty-invariants.test.ts` | Generic claims from anti-reversing | TI-01 through TI-07 and TI-12 architecture checks |
| `test/isogloss/operands.test.ts` | Destructuring/constants/register semantic fixtures | Projection uniqueness, reservoir reuse, decoys, no site-local operand |
| `test/isogloss/persistence.test.ts` | Decode-cache repeated-call programs | Evolved lineage/carrier state across return and throw |
| `test/isogloss/reference-runtime.test.ts` | Core basic/arithmetic/control fixtures | Canonical IR vs reference BCM with diagnostic state |
| `test/isogloss/runtime-async.test.ts` | Core async and Chrome-extension fixtures | Interleaving, order, cleanup, one carrier |
| `test/isogloss/runtime-classes.test.ts` | Objects, advanced, breakers | `super`, home object, computed methods, `new.target`, reentry |
| `test/isogloss/runtime-closures.test.ts` | Closure and indexed-slots suites | Evolved root-group state and escaped closures |
| `test/isogloss/runtime-control-flow.test.ts` | Both control-flow suites plus C3 extracted programs | Carrier phase/variant movement through loops |
| `test/isogloss/runtime-core.test.ts` | Core basic/arithmetic/arrays/objects/strings/functions | Native/reference/emitted permanent oracle |
| `test/isogloss/runtime-exceptions.test.ts` | Exception/control-flow/repro suites plus C3 programs | Non-transactional motion and post-uncaught recovery |
| `test/isogloss/runtime-generators.test.ts` | None | Entire generator and async-generator surface |
| `test/isogloss/runtime-reentrancy.test.ts` | Breaker coercion/accessor/recursion snippets | Intentional protected callback reentry and resume gates |
| `test/isogloss/seed-stress.test.ts` | Randomized and opcode-mutation regression shapes | Fixed build/data seeds and CI tiers |
| `test/isogloss/semantic-signatures.test.ts` | A transitional suite now exists and aliases `SemanticOp` to legacy `Op`; slot-analysis provides an additional exhaustiveness pattern | Remove the legacy alias and VM-only operations, then enforce exhaustive `satisfies Record<SemanticOp, SemanticSignature>`, exact facts, and dynamic stack effects |
| `test/isogloss/sidecar.test.ts` | None | Schema, source map, production absence, event decode |
| `test/isogloss/static-extractor.test.ts` | Anti-reversing threat ideas only | Hostile full-format extractor and lineage experiments |
| `test/migration/removed-vm-options.test.ts` | Legacy option list/feature combinations | Actionable error code and migration hint before parsing |
| `test/migration/no-legacy-vm.test.ts` | None | Source, exports, CLI, package, manifest, output, and fallback inventory |
| `test/options/metadata-drift.test.ts` | Feature combinations and manifest script | One source of truth across API, CLI, presets, worker manifest |

## 10. Script migration matrix

| Script | Classification | Current modules/data | Required Isogloss disposition |
|---|---|---|---|
| `scripts/bench.mjs` | C2 | `src/index.ts`, Node `vm`, legacy presets; eight workloads; bootstrap, total/steady time, output size | Rewrite as the primary Isogloss benchmark. Add JSON output, phase timings, first/repeated calls, exception/async/reentrancy workloads, memory, payload/runtime/sidecar bytes, and release-budget evaluation. Preserve the legacy measurement JSON, not a VM import. |
| `scripts/bench-attribution.mjs` | C2 | `src/index.ts`, `src/presets.ts`; removes legacy features from max | Freeze its legacy results, then replace the matrix with Isogloss profile/parameter and Phase 9 hardening attribution. It must not import legacy presets after Phase 10. |
| `scripts/build-browser.mjs` | C2 | `src/browser-worker.ts`, `browser-crypto-shim.ts`, generated option manifest, esbuild | Retain and point at the detailed Isogloss API. Add an executable browser/worker CSP smoke step; bundling success alone is insufficient. |
| `scripts/collect-stats.mjs` | C2 | Dist API, test output parsing, opcode/source statistics, simple performance/size, generated hero snippet | Remove opcode and VM terminology; ingest versioned benchmark JSON and expose Isogloss groups/cells/clauses/certificate/expansion statistics. Fix or remove the current `preset: "high"` reference in favor of valid Isogloss profiles/presets. |
| `scripts/generate-manifest.mjs` | C2 | `OPTION_META`, `AUTO_ENABLE_RULES`, `PRESETS` from dist | Rewrite for typed Isogloss metadata, nested options, artifact options, and removed-option tombstones. Add `metadata-drift.test.ts`; do not filter only boolean keys. |

## 11. Cutover gates derived from this audit

The test migration is complete only when all of the following are evidenced:

1. All 23 C1 suite files have an explicit destination and pass through native, reference BCM, and emitted BCM where applicable.
2. All mixed C2/C3 sections have been split; no test is kept by retaining a legacy VM mechanism.
3. Every Section 7 semantic fixture appears in the generated fixture manifest before its C3 source file is deleted.
4. True generator coverage exists and passes; manual state-machine tests do not count.
5. Async and reentrant tests assert event order and carrier uniqueness, not only final values.
6. CSP passes by executing generated output in Node, browser, worker, and browser-extension-style environments.
7. The static extractor parses the real production format with full design knowledge.
8. Performance scripts emit versioned data and enforce the plan's size, bootstrap, steady-state, P95, and retained-memory gates.
9. Fixed build and data seeds reproduce every randomized failure.
10. `no-legacy-vm.test.ts` proves the source tree, package surface, generated output, CLI, manifest, and runtime contain no VM fallback.

## 12. Highest-risk conclusion

The existing suite provides a large and valuable JavaScript semantic corpus, especially for control flow, closures, exceptions, classes, and coercion. It does **not** currently prove the properties most specific to Traveling Isogloss:

- true generator suspension;
- one-carrier behavior under async and reentrancy;
- history-dependent boundary motion and persistence;
- verifier/lattice invariants;
- resistance to a format-aware static extractor;
- actual CSP execution outside Node `vm`;
- enforceable performance and memory budgets;
- absence of a legacy fallback.

Those gaps are release blockers, not follow-up hardening. The destructive VM deletion should occur only after the new suites supply direct evidence for them.
