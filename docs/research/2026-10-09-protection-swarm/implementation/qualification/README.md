# Qualification evidence — no-go

These are research calibration results, not a demonstrated security improvement or a qualified replacement for the legacy product. The full public `compileRegionalCode` package path emits every candidate in the regional run. Final byte hashes and compiler, graph, attacker, scorer, fixture and runner source hashes bind that run; `sourcesUnchangedDuringRun` must be true before using it. Owner inventories and hashes are provenance, not runtime protection.

## Reproduce

Run from the repository root with installed dependencies:

```sh
bun test packages/ruam/test/regional/qualification-recovery.test.ts packages/ruam/test/regional/qualification-negative-zero.test.ts
bun packages/ruam/scripts/regional-qualify.ts
bun packages/ruam/scripts/regional-baselines.ts
bun packages/ruam/scripts/regional-repair-baseline.ts
```

The baseline runner exports pinned commits into temporary directories and symlinks existing dependencies. Missing commits are reported unavailable. It never checks out historical product code over the working branch. The repair runner consumes the fresh historical report and changes only its isolated WIP archive; rerunning it requires fresh archives. Each historical worker has a 15-second whole-process timeout. Timeout covers compilation, behavior validation and attacks together: it is not a measured lower bound on recovery work alone.

## What is actually tested

The regional matrix has six synthetic dependent integer recurrences, six private fixed-configuration computations, and six independent-output controls; four ablations and eight requested seeds produce 576 builds. Each recurrence receives 96 previously undisclosed-to-the-attacker variable-length input histories. Integer cases receive 106 inputs, including signed zero, NaN, infinities and int32 boundaries. These public, generated calibration families are not real applications or a blinded independent red team. Eight requested seeds are not necessarily eight distinct artifacts: recipes that allocate no generated names can emit identical bytes. Inspect artifact hashes before claiming diversity. The selected recurrence/configuration families do not exercise private-call fusion, so that ablation can coincide with plain output.

The primary attacker receives only an emitted artifact and its public entry. It slices declarations, symbolically substitutes scalar assignments and branches, reduces static literal-table reads, inlines eligible local helpers, and generates an independent function. An unchanged function, a wrapper around the artifact, or a retained interpreter earns no recovery credit. SSA formatting alone earns no credit. Residual private helpers must reduce to the closed scalar-expression grammar; recursive evaluators, dynamic calls, generic dispatch, and non-history loops are unsupported. The history-loop lane retains the ordinary scan-and-append scaffold while replacing the scalar transition. Regression tests cover both switch dispatch and recursive retained interpreters hidden behind trivial wrapper arithmetic.

An independent oracle-only lane fits numeric constant, affine, XOR and quadratic candidates, then submits them to the same hidden scorer. Unsupported grammars and query-domain errors stay visible. No historical VM lifter, debugger/taint lane, model-driven attacker, or broadly trained solver was implemented. The lack of these attacks cannot count as protection.

Correctness scoring is restricted to primitives and dense nonaliased arrays. It rejects empty or misaligned oracle sets and unsupported expected objects. It does not prove object identity, effects, async ordering, exception semantics, or general equivalence. Each call gets a fresh realm; ordered histories exercise state within that call. Real timer APIs are available for legacy max artifacts and outstanding handles are cancelled at the synchronous observation boundary. Background guard behavior is therefore outside this protocol. The recorded Bun/JSC runtime is not a browser simulation or real cross-host validation.

CPU, wall time, oracle queries, retained heap deltas and process-wide peak RSS remain separate. Analyst time is unknown, not zero; model tokens in these executable attacks are zero. Both compared sides must have eight successful seed runs before the small-sample median CPU ratio can trigger the <=2x early falsifier. This is not the preregistered 5x/10x promotion experiment. The machine report intentionally says `NO-GO`, `claimsDemonstratedSecurity:false`, and `stopExpansion:true`.

## Complete-root and historical limits

Six unchanged repository roots are inspected: the two RuamTester harnesses, the webpack reproduction, the product web worker, and two release/build scripts. The harnesses and reproduction are honestly labeled test/integration roots. Syntax compilation does not establish complete protection. The compiler reports `wholeSourceProtection:false`; no complete root has cross-host qualification, so the required three-root gate fails. Generated arithmetic kernels cannot replace those roots.

`historical-report.json` pins full commit IDs. Main max and PR5 offline max each pass all ten selected synchronous behavior runs after the real timer/public-entry harness adapter; neither has deterministic public build entropy, so their seed column labels repeated builds. The oracle-only learner recovers affine and constant controls. AST VM lifting remains unsupported, so no comparative multiplier is available. PR5 receives no external-key or remote-service credit.

PR7 passes the selected runs, but the four ordinary families have **zero protected regions** and receive no protection credit. A separate relation adapted from PR7's own source-transform test supplies its required explicit numeric domain, obtaining one protected region over inputs 1 through 20. Those twenty distinct values are repeated five times; this is not one hundred independent tests. The generic learner queries outside that contract and reports failure rather than inventing a result.

Unmodified local-only `f7f52c8` fails all ten runs with the missing `buildStructuredLoopLayouts` symbol. `wip-natural-loop-repair.patch` supplies the missing type and a bounded natural-loop layout builder only in the exported archive. It is a new experimental repair, not a recovered original implementation or a general JavaScript loop proof. The patch hash and before/after source hashes are published separately. Follow-up results, including timeout censoring and a simple loop probe, are in `wip-repair-report.json`. Successful owner statistics that say `full-javascript` are historical claims, not conclusions adopted by this evaluation.

## Narrow legacy correctness repair

The legacy stack encoder used `(v | 0) === v` to decide whether XOR encoding was safe. That admits negative zero, and XOR changes its observable sign: `1 / run(-0)` became positive infinity with stack encoding and max. The product fix boxes `-0` while preserving the allocation-free path for other int32 values. Two regression configurations run eight randomized builds each and check negative zero, positive zero, and reciprocal sign through nested calls/array results (48 assertions). This is a correctness fix, not a protection-strength claim.
