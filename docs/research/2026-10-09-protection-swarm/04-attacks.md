# S4 — Executable attack evaluation

Round 1 specialist brief, 2026-10-09. Strictly offline, server-free emitted JavaScript. This worker previously wrote S1; no peer proposal was read. All numeric thresholds below are proposed research gates, not security guarantees.

## Evidence and evaluation defects

At `f7f52c8`, `test/isogloss/support/local-dynamic-attacker.ts:111-125` uses one small arithmetic function, two build seeds, and twelve inputs. Its source/owner-data separation is useful, but several metrics cannot support protection claims:

- Line 320 defines `o90` as 90% of observations, not observations actually needed for recovery.
- Lines 368-371 assign one-hook operation F1 zero because the classifier predicts unknown.
- Lines 349-351 count every instrumented site as the discovered patch; they do not minimize a patch.
- Lines 773-809 score operation-name sequence adjacency and an empty def-use prediction, rather than an executable recovered model.
- Lines 813-830 compare repeated scoring with a trivial counting loop; this is not attacker reconstruction CPU.
- Lines 923-958 bound scope snapshots to depth two and 128 properties. That is not unrestricted debugger/heap access.

`test/isogloss/local-dynamic-attacker.test.ts:35-40` intentionally allows a correctly reported no-go result to pass. `1fb1a61:test/security/observation-resistance.test.ts` predominantly checks execution correctness. Preserve both purposes, but separate them from attack qualification. The BPRF report at `02c481d:docs/superpowers/baselines/2026-07-24-bprf-csh-spike-report.md:85-104` already demonstrates why artifact-aware recovery must outrank naive trace diversity.

## S4-A — Executable recovery tournament

**Mechanism.** Build a scorer process that alone receives original source, reference behavior, hidden inputs, and semantic labels. Attacker processes receive shipped artifacts, compiler/design source, public API/host contracts, and unrestricted local execution. They may patch before load, replace intrinsics, pause execution, inspect scopes/heaps, replay histories, and compile unlimited additional known-source examples within measured budgets. The process boundary prevents accidental owner-side evidence leakage; it is benchmark hygiene, never part of product security.

Run three cooperating attack lanes: AST/SSA normalization and constant/helper evaluation; debugger/taint/slicing with chosen inputs; and tool-using AI that writes and debugs extractors, invokes solvers, and synthesizes candidate implementations. Pin models, prompts, tool commits, hardware, and engine versions. Include an independently developed attacker and let the portfolio switch lanes. Charge all attempted work, including failed model calls and generated scripts.

**Goals.** Report unchanged-artifact transplantation as an expected offline reuse success. Separately require independently extracted executable semantics, or a preassigned meaningful behavioral edit, to claim recovery. A renamed wrapper calling the original artifact does not meet the extraction goal. Owner-side audit checks that distinction without demanding original identifiers or a preferred algorithm. Report exact source reconstruction separately; readability is secondary.

Validate candidates against 10,000 hidden cases where practical, including exceptional values, effect order, alias identity, reentry, and asynchronous histories. Stateful workloads additionally receive 100 hidden sequences of 100 operations. One mismatch defeats exact recovery for that target; partial accuracy remains visible. Passing these tests establishes tested generalization, not universal equivalence.

**Counterattack on the evaluation.** Memorized fixtures, guessed APIs, or easy semantic edits can inflate success or failure. Freeze target families and edit difficulty before emitting builds; keep final targets disjoint from attacker tuning. This harness adds no product runtime cost, but needs trustworthy semantic oracles and substantial attack engineering. Kill the harness's validity if weak controls cannot be recovered or hidden-source information reaches an attacker.

The hybrid lane is motivated by [CASCADE v2, February 2026](https://arxiv.org/abs/2507.17691v2), which combines LLM helper identification with deterministic JavaScript IR transformations. Executable validation follows the failure mode highlighted by [JsDeObsBench, June 2025](https://arxiv.org/abs/2506.20170): plausible simplification can still break execution. Neither paper measures Ruam.

## S4-B — Patch collapse and oracle ceilings

**Mechanism.** Before expensive recovery, run a universal collapse portfolio: neutralize checks; fix randomized choices; replace decoders with observed values/functions; dump closure state; splice around representation transitions; and partially evaluate selected helpers. Automatically minimize successful patches while rechecking held-out behavior. Record edited locations, total tooling/setup cost, and recovered-model quality. One AST rewrite affecting 1,000 sites is one reusable automated transformation plus its measured execution cost, not 1,000 units of analyst work.

Instrument programmatic debugger breakpoints and inspect relevant scopes beyond the old depth-two helper. Also permit whole-artifact rewriting; “more than three hook sites” is not a defense. Effects constrain correctness-preserving patches, but instrumentation overhead is not itself resistance.

Include 24 calibration kernels: comparisons, `max`, affine arithmetic, low-degree polynomials, bitwise expressions, finite lookups, and simple state transitions. Give the synthesis lane arbitrary local queries; report success by query checkpoints 16, 256, 4,096, and 65,536, continuing until budget exhaustion. [Xyntia's author implementation](https://github.com/binsec/xyntia), checked 2026-10-09, provides sampling-based synthesis machinery; its supported bitvector grammar must be adapted rather than assumed to implement JavaScript coercions.

**Differentiating evidence.** A defense that hides internals but leaves a tiny learnable external function has reached an oracle ceiling. Kernel recoverability does not disprove resistance on larger programs; excluding easy kernels from published results would conceal an important limit. Full offline artifact reuse remains possible regardless.

**Kill criterion.** A portable patch/extractor recovering at least 80% of held-out builds within 60 seconds per build, following at most four hours of setup, immediately kills a general “stronger against automation” claim for that target family. Retain it as a permanent attack regression. Strongest evaluation bypass is overfitting the patch language; accept arbitrary attacker tools and independent implementations. Costs are laboratory compute and engineer time, not shipped protection overhead.

## S4-C — Preregistered paired cost and transfer gates

**Baselines.** Pin `main@1fb1a61` production `max`, the strongest validated offline PR5 configuration at `30f4563`, PR7 scalar BPRF at `b464a82`, and a minimally repaired `f7f52c8` with the repair diff published. Include the integrated candidate, native originals, ordinary compiler optimizations alone, and weak debug/no-hardening controls. PR5 excludes external bindings; bypassed bindings earn no credit. PR7 participates only on its genuinely protected eligible kernels. Repairing WIP is a prerequisite, not evidence of resistance. Attack only equally owned semantic coverage in paired comparisons with each historical baseline. Publish an additional full-language table with rejects/failures; never silently drop unsupported programs or count native/hybrid bodies as protected. PR8 aggregate performance is not an admissible protected comparator.

**Pilot.** Freeze six development programs and twelve hidden programs spanning numeric, object/closure, control/exception, and module/asynchronous families; use four independent build seeds each. These application targets must be nontrivial compositions, including general protected lanes, selected before results. Keep the 24 easy calibration kernels as a separately reported ceiling cohort: never require 10× resistance from `max`, exclude them silently, or mix them into a favorable aggregate. Allow eight hours of reusable attacker setup, then per-artifact limits of four CPU-hours, one wall-hour, 100,000 model tokens, and one analyst-hour, stopping at the first limit. These are measurement caps, not presumed attacker restrictions. Require zero semantic mismatches, recovery of at least 90% of weak controls, and at least eight hidden programs with solved protected baselines. Advance only if the conservative paired median recovery-CPU ratio is at least 5× against each protected baseline, without decreased recovery quality. Otherwise improve attacks or stop; do not credit inconclusive comparisons.

**Promotion.** Use thirty fresh hidden application programs and ten builds each, with 32 setup hours and fourfold per-artifact budgets. Require a program-clustered 95% confidence lower bound above 3× for the paired median recovery-CPU ratio, and its point estimate above 10×. Report every preregistered family, including failures; changing the eligible cohort requires a new frozen experiment. Require median legitimate runtime at most 1.5×, p95 at most 2×, emitted size at most 2×, and peak memory at most 1.5× the faster fully protected comparator; disclose native ratios separately. Also require median attack amplification divided by legitimate-runtime amplification above 5. These thresholds are demanding investment criteria, not universal constants.

Train on builds 1–3 and freeze the extractor before builds 4–10. Report setup cost, marginal recovery cost, and amortized totals for 1/10/100 builds. No single blended “work” score: retain CPU, wall time, tokens, dollars at dated prices, analyst minutes, queries, and storage separately. Confidence intervals cluster by program, not seed.

Timeouts are right-censored lower bounds, never infinite attack cost. Both sides censored means no demonstrated comparative win. Harness crashes and invalid artifacts are failures/inconclusive, never resistance. Observation counts remain diagnostics. Retain existing correctness evidence; replace proxy-based release gates; defer public strength claims until independent replication. All three candidates should be one qualification interface feeding the shared publication decision.
