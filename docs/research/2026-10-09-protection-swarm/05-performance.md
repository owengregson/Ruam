# S5 — Performance, resource allocation and build search

Independent brief, 2026-10-09. The target is strictly offline, self-contained JavaScript. Recommend one cost planner combining S5-A/B/C, with measured attack results as a qualification input. Runtime overhead is a price paid, not evidence of resistance.

## What the code actually offers

All code anchors are relative to `packages/ruam/src/`. Main is `1fb1a61`; PR7 is `b464a82`, whose substantive change is `5e2b246`.

* **Retain liveness and allocation work from PR3.** Main `compiler/slot-analysis.ts:4–29` computes exception/this-context slot requirements; `ruamvm/builders/interpreter.ts:1056–1064` uses scalar snapshots. Transfer those analyses to activation-local regional state, rather than retaining global interpreter slots.
* **Revalidate exactness before salvage.** The allocation-free integer encoding in `interpreter.ts:2771–2778` admits `-0` because `(v|0)===v`, then XOR converts it to positive zero. The comment at `:2737–2738` explicitly acknowledges that round trip. This is a code-level defect indicator, not a newly reproduced complete-artifact failure. Preserve negative zero in any replacement representation.
* **Reject decoded semantic caches as a default optimization.** Main `interpreter.ts:849–868` materializes handler-index/operand pairs for eligible presets. Its gating excludes max features, but its existence illustrates how a speed optimization creates a reusable recovery surface. At-rest encoding does not compensate under the stated attacker.
* **Retain PR7's engineering mechanisms.** `isogloss/bprf/scalar-source.ts:96–106` checks exact dyadic realizations; `:395–413` emits scalar contributions instead of per-fragment closures. `compiler/call-graph.ts:196–202,649–686` supplies resource limits and indexed SCC summaries. `compiler/pure-region-planning.ts:54–58,186–203` bounds attempts but still searches suffixes and allocates region slices. `browser-worker.ts:20,43–48` caps input bytes. These are foundations, not a complete global ledger.
* **Expand the benchmark.** PR7 `packages/ruam/scripts/bench.mjs:14–29,44–63,135–139` measures one small annotated arithmetic kernel after warmup and applies local budgets. It cannot validate full-JS coverage, cold startup, adversarial JIT behavior or extraction resistance. September's broken emitter must be repaired before becoming a measured baseline.

## S5-A — Whole-artifact constrained cost planner

For each semantically owned region, enumerate a bounded set of verified realizations and fusion boundaries. Every option must retain complete authored ownership and exact behavior. No option means leaving an authored body native or copying source through unchanged. Select a complete artifact subject to runtime, startup, memory, size and build budgets; reject publication when no qualifying complete selection exists.

Use profiles only to estimate execution frequency. Rare paths may receive expensive representations, but their semantics remain exact for every accepted input. Evaluate the full artifact's weakest recoverable paths and interfaces: local attack costs cannot be summed into a claimed global hardness score. Share an expensive transformed intermediate only when it performs necessary work for several real outputs. Reinvest allocation savings in transformations that survived attacks, rather than arbitrary noise.

**Hypothesis/attack.** The planner could spend a fixed overhead budget where it increases observed recovery cost. Its strongest bypass is attacking a cheap adjacent region, equivalent fallback or output oracle, bypassing the expensive region altogether. A second risk is overfitting the attack suite. Keep candidate Pareto vectors, including recoveries and censored attack timeouts; a timeout is not a hardness lower bound.

**Experiment/kill.** Compare uniform protection with planned allocation under equal size/runtime caps on held-out applications. Kill S5-A's protection claim if whole-artifact recovery needs no more work despite apparently better regional scores, or if its advantage disappears on held-out attacks. Ownership gaps and semantic mismatches invalidate the artifact immediately.

## S5-B — Liveness-shaped superblocks and bounded support sharing

Choose scalar locals for synchronous nonescaping values, identity-preserving cells for captured mutable bindings, and separate records containing only values live across each suspension. Fuse neighboring computations when effect/exception proofs permit. Specialize internal scalar returns and inline representation transfers to remove array/frame round trips. Keep generated function sizes bounded by splitting at verified continuations; never insert new asynchronous yields to satisfy a latency budget.

Share generated support for necessary language infrastructure, with explicit leakage contracts. Avoid a universal `operation + operands + frame` ABI or a shared complete-state decoder. Module bookkeeping may be shareable; private-state projection helpers and arithmetic handler catalogs recreate high-value hooks. A per-build fixed private layout is preferable to repeatedly changing object shape merely for diversity. V8 documents the relationship between property layout and optimization in [Fast properties, 2017-08-30](https://v8.dev/blog/fast-properties); this motivates measurement, not a promise across engines.

**Hypothesis/attack.** Larger necessary computations and fewer materialized intermediate values can simultaneously save runtime and remove observation cuts. Conversely, scalarization, common-subexpression elimination and inlining can reveal a simpler SSA graph. Attack the optimized output; compare against plain fused/scalarized controls. Moving every helper inline is not automatically stronger.

**Semantics/cost.** Reentrant calls retain distinct activations. Closure identity, mapped arguments, completion state, `finally`, iterator closing and suspended resumptions constrain reuse. A depth-only pool is unsafe for independently suspended activations. Runtime recursion caps or timeouts would change behavior and cannot quietly enforce compilation policy.

**Experiment/kill.** Stress recursion, callbacks, mixed value types, allocation-heavy closures and interleaved generators. Kill unsafe pooling on any alias/identity mismatch. Reject a shared helper if one probe family reconstructs the same protected state stream across held-out regions/builds. Retain a speed optimization alone only with honest accounting that it supplied no demonstrated protection gain.

## S5-C — Deterministic, attack-qualified build search

Use one owner-only immutable graph index and a shared ledger for parsed bytes/nodes/depth, edges, candidate expansions, solver steps, emitted bytes and peak retained state. Represent trial regions as spans; keep representative diagnostics plus counts. Search ordering and tie-breaking derive from a recorded seed, compiler version and input digest. Cache proofs and measured candidate results by semantic contract, transformation version and target-engine profile. Cached owner evidence never ships.

Select from a frozen measurement database or record a chosen plan for deterministic replay. Machine-time noise must not silently change emitted bytes. Solver-step budgets terminate candidate search deterministically; a wall-clock watchdog aborts the build rather than publishing whichever incomplete result happened to finish. Local build workers may parallelize independent regions; output ordering remains deterministic. No runtime compiler downloads, server requests or native execution backend are introduced.

**Hypothesis/attack.** Automated search can discard repeatedly solvable designs without paying runtime cost. It can also optimize directly against yesterday's tools and repeatedly emit recognizable templates. Reserve unseen programs, seeds and attack strategies for final qualification; compiler familiarity belongs to the attacker.

**Experiment/kill.** Rebuild twice on different worker schedules and require identical artifacts. Kill stale proof reuse on any contract mismatch. Compare search against fixed recipes under equal build budgets; abandon expensive search if it fails to improve held-out attack outcomes.

## One contract, provisional budgets

For an initial 100-KiB application tier, record hardware and engine versions and provisionally require:

| Dimension | Proposed qualification cap |
|---|---|
| Warm execution | Geometric mean ≤5× unprotected; each workload ≤10× and no worse than main max |
| Interactive work | Protected p95 ≤20 ms where native p95 ≤5 ms; measure cold and polymorphic inputs separately |
| Cold startup | Added parse/compile/first-call p95 ≤150 ms desktop, ≤500 ms representative low-end device |
| Size/memory | Raw ≤10× input +64 KiB; compressed ≤6× +16 KiB; added steady heap ≤32 MiB |
| Build | Default ≤60 CPU-seconds/100 KiB, ≤2 GiB peak RSS; release search explicitly budgeted separately |

These are proposed gates, not observed results or bounds on every possible runtime input. Capture GC, tiering and deoptimization separately; [V8's Maglev account, 2023-12-05](https://v8.dev/blog/maglev), explains why warm loops and short-lived application code exercise different tiers. Benchmark current V8, SpiderMonkey and JavaScriptCore rather than extrapolating historical numbers.

The interface is `CostPlan {ownershipDigest,realizationChoices,liveStateLayouts,supportGroups,resourceLedger,measurementProfile,attackEvidenceRefs}`. It follows semantic/representation planning and precedes final verification and atomic publication. Report attack CPU, wall time, analyst/tool effort, queries, output fidelity and reuse scope separately. Unchanged-artifact copying remains outside any claimed recovery-cost improvement. Defer adaptive runtime morphing and generic table interpreters; prioritize measured, complete artifacts over a fast aggregate containing unprotected paths.
