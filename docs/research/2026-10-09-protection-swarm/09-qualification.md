# Specialist 9: qualification and truthful artifact guarantees

Independent round, 2026-10-09. The target is strictly offline JavaScript. Qualification must separate four claims: **correctness** (preserved observations), **coverage** (authored semantics transformed), **provenance** (evidence binds these bytes and inputs), and **measured resistance** (specified attacks became more costly). No aggregate score or `fullyProtected` boolean should imply all four without separate evidence.

## Historical evidence

The local-only WIP `f7f52c8:packages/ruam/src/isogloss/protection-certificate.ts:105–169` binds exact artifact bytes, coverage, source ownership and architecture qualification. This is useful infrastructure, but `fullyProtected` is the conjunction of ownership and architecture checks, not an empirical security result. `architecture-qualification.ts:1539–1554` counts distinct realization topologies; `:1969–1989` binds descriptor/admission/coverage evidence under “regional equivalence.” Such checks can substantiate structural obligations without proving all input behaviors equivalent or attackers unable to normalize those structures.

`f7f52c8:packages/ruam/test/isogloss/release-environment-gates.test.ts:20–60` does run Node and Bun processes. Its “browser CSP realm” case at `:66–92`, however, bundles browser-target code and runs `node:vm`; that is not real browser, extension or CSP validation. Seed qualification uses 1,024 fixture/build pairs, not every fixture under every seed (`support/release-seed-qualification.ts:43–46,72–77`). These distinctions belong in release evidence.

[Commit 59e4122](https://github.com/owengregson/Ruam/commit/59e4122) removed 59 files and 24,186 lines, including broad language tests, during the replacement cutover. Reimplementing coverage counters cannot recover that behavioral corpus. The observed PR5 shielded-path bypass and WIP's missing `buildStructuredLoopLayouts` dependency demonstrate complementary failures: a green subset can miss integration gaps, and extensive architecture machinery can fail before its attacker gate executes.

## S9-A: artifact translation validation with explicit evidence grades

**Mechanism.** Maintain an owner-only many-to-many relation from source obligations to canonical effects to emitted AST regions. Fusion maps several obligations to one region; fission maps one obligation to several cooperating regions; elimination requires an explicit justification rather than disappearing from counts. Include exceptional edges, observable order, live-binding aliasing, suspension and completion propagation. Hash the final post-minification bytes, then reparse them with an independent artifact inventory pass.

A checker must derive executable reachability and region connections from emitted syntax, not merely accept emitter-supplied identifiers. Every executable authored contribution or runtime helper has a classified owner; unknown executable fragments fail admission. Absence of a lexical source substring does not establish ownership. Conversely, runtime support is not automatically authored plaintext merely because it uses normal JavaScript.

Use translation validation where its domain is tractable: exact bit-vector equivalence for admitted int32 kernels and bounded symbolic checks for small effect-free regions. General JS transformations require vetted semantic templates plus differential evidence. Label these grades separately; bounded checks are not proofs for arbitrary inputs. In particular, neither event counts nor topology differences establish contextual equivalence.

**Interfaces/cost.** `TransformationWitness`, `ObservableOrder`, `AliasRelation`, `CompletionContract`, final `ArtifactDigest` and `AdmissionReport` compose with compiler/state plans. Never ship witnesses, original IR or canonical maps. A timeout or unsupported checker obligation rejects that transformation or artifact; it cannot silently publish a weaker backend. Restrict expensive validation to changed templates and bounded candidate regions.

**Falsifiers.** Independently mutate an emitted branch, alias link, coercion order, exception edge and return value while keeping its old ownership metadata. Recompute the digest as a malicious emitter could. If qualification still grants a correctness claim, the gate is self-attestation. Also apply equivalent formatting/renaming so superficial syntax rejection cannot masquerade as semantic validation.

## S9-B: a preserved differential corpus on real execution hosts

**Mechanism.** Restore old semantic fixtures through a small source/expected-observation adapter; retain VM-internal structural tests only for the legacy baseline. Record every fixture as supported, intentionally rejected with reason, or failing. Never obtain a green migration by deleting failures or exempting authored modules.

Compare native and protected programs using identity-aware observation scripts, not JSON-only results. Preserve `-0`, NaN, symbol distinctions, object aliasing, thrown-value identity, property descriptors, getter/proxy order, TDZ, mapped arguments, generator `throw/return`, finally completions, async microtask order, module cycles/TLA and coercion-triggered reentry. Each host runs its native reference and the exact emitted artifact; cross-host differences are not automatically compiler bugs.

Run Node and Bun as separate processes, and actual Chromium, Firefox and WebKit pages for claimed browser support. Test declared extension worlds inside an installed test extension when those targets are claimed. Use real CSP headers, not only disabled `vm` string generation. Unsupported/unavailable environments are explicitly unqualified rather than simulated successes. Runtime remains offline; local harness infrastructure does not become a deployment dependency.

**Budget and interactions.** Begin with eight high-value semantic fixtures × sixteen build seeds × five input seeds per claimed engine, plus deterministically replayed regressions. Build seeds and input seeds are independent. Cover interactions of region partitioning, value layout, module linking and suspension; pairwise coverage supplements targeted three-way cases, never proves all combinations. Preserve reduced failures and their exact seeds permanently. Broaden only after the initial architecture works.

**Falsifiers.** One observation mismatch, unexplained rejection of a claimed-supported fixture, or missing real-host run blocks that support claim. Report tested seeds and cases; never call sampling “all-seeds proof.” Output uniqueness contributes zero resistance credit.

## S9-C: attacker-aware architecture and release gates

**Mechanism.** Maintain independent adversarial tools for syntax normalization, decoder lifting, operation/heap taps, intrinsic hooks, cross-build transfer and held-out behavioral reconstruction. Include main `max`, a deliberately weak control and equivalent-coverage candidates. Give attackers all shipped files, compiler/design knowledge and build seeds. Owner witnesses remain withheld. Reusing the unchanged artifact is always recorded as a successful reuse baseline, not confused with readable algorithm recovery.

Architecture review asks whether a universal operation carrier, complete decoded frame/cache, authored fallback, or reconstruction manifest survives under another name. Generic closure factories and lookup tables count if they fulfill the same role as dispatch. Static detectors are rejection heuristics; adaptive instrumentation and held-out reconstruction test whether the suspected choke point is useful.

Bind attack records to exact bytes, engine, attack version, budget and objective. Separate analyst setup, tool CPU, wall time, queries, output quality and semantic coverage. Freeze a meaningful improvement threshold before running a candidate; exceeding an attack budget yields censored evidence, not infinity. A test that successfully records “no-go” must remain visibly nonqualifying in the release decision.

**Falsifiers/cost.** Kill a protection hypothesis when a generic extractor matches baseline recovery at comparable cost, even if one named hook fails. Any native fallback or unclassified source ingress blocks publication independently of attack scores. Expensive adaptive campaigns run on frozen candidates; cheap regression attacks run on every relevant change.

## Ordered recommendation

First restore executable baseline and corpus adapters. Then validate one integrated regional transformation with S9-A/B and attack it with S9-C before migrating broad syntax. Extend ownership and real-host support incrementally; retain the legacy implementation as a measured control. Publish separate admission, correctness and resistance reports with exact scope, not a new universal guarantee. A small rejected hypothesis is a better outcome than another unqualified large rewrite.
