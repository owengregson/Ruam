# Round 2 — Attacks and cryptanalysis panel

Panel: `swarm_runtime`, 2026-10-09. Read all nine briefs and the decision method. This worker authored S2/S5/S8; those proposals receive the same criticism. Recommendation: fund a bounded whole-root fusion/specialization experiment, with explicit cheaper controls. Defer encoded state across observable effects and general synthesis until the simpler experiment survives.

## The cheapest plausible defeat

The integrated proposal removes the universal VM event stream, but emits ordinary JavaScript whose syntax already identifies control, arithmetic, calls and property operations. My first attacker is therefore an artifact-to-SSA normalizer, not a custom VM decompiler:

1. Parse every shipped file; inline or partially evaluate generated helpers where sound; remove constant selectors and rename temporaries canonically.
2. Build effect-aware SSA and closure-capture/alias relations. Treat uncertain coercions and host calls conservatively instead of abandoning recovery.
3. Backward-slice each result, external write, branch predicate and continuation state update independently.
4. Simplify casts, masks, affine encodings and cancellation; infer remaining local relations from unrestricted patched execution.
5. Emit a standalone replacement and implement a preregistered behavioral edit, then validate hidden inputs and stateful histories.

S1-A/B, S3-A/B and S5-B may make this attacker faster by performing inlining, dead-state removal and scalar replacement first. Fewer hooks only matter if the recovered replacement becomes measurably harder to construct. One generic rewrite affecting thousands of sites is one amortizable tool, not thousands of analyst decisions.

The scorer must also distinguish recovery from a mere reprint of the generated artifact. Require an independently extracted semantic implementation or meaningful targeted edit, with original support/runtime artifacts removed; do not demand original names, source structure or a different algorithm. Record unchanged-artifact transplantation separately as expected success. S4-A's executable scoring is essential here.

## Attack the combination, not each component's sales pitch

**Fallback extraction.** A guarded island with an easier general implementation supplies an alternate oracle and semantic template. Force the general lane on integer inputs, lift it statically, or reproduce its behavior independently. A path's low natural execution frequency is irrelevant. Every equivalent emitted implementation bounds the whole computation's recovery cost. S2-A/S1-C should initially operate only after unconditional authored semantics prove their domains, such as an existing `x >>> 0`; preserving valid Number/BigInt/object behavior by shipping an easy duplicate does not protect the integer function.

**Independent projections.** Jointly emitting predicates and outputs is insufficient. If `y1=f(x)` and `y2=g(x)` remain independently sliceable, attack them separately and discard artificial coupling. Require genuine producer-consumer dependence or disappearance of useful cutpoints. S7-A's recurrence criterion improves S2-A: compare each useful projection's recovered complexity, not tuple width. Even dependent recurrences can often be split at observed intermediate assignments.

**Encoding inversion.** For S2-B's `E_next ◦ F ◦ E_prev^-1`, search for inverses in emitted algebra, propagate known values from boundaries, or solve local sampled relations. Compiling away explicit decoders may only inline them. Larger constants and nonlinear expressions do not automatically defeat inference: [XSmir, CCS 2025](https://binsec.github.io/assets/publications/papers/2025-ccs.pdf), explicitly combines search with rules for constants and affine/polynomial relations. Its binary results require a JS adaptation; they are a concrete attack lead, not a proof of defeat.

**Whole-function learning.** If the final function is a comparison, small finite mapping or low-degree relation, ignore internals. Preserve the easy-kernel cohort and constructive attack upper bounds in S4-B/S7-C. Encoding all private state cannot manufacture high input/output complexity. For stateful programs, learn transition behavior from resettable sessions and distinguishable input sequences; repeated effects may expose sufficient state even when outputs do not.

**Configuration extraction.** S7-B/S3-C remove the convenient table dump, but a residual decision graph may expose an even clearer ruleset. Extract branch predicates, minimize equivalent states, and learn acceptance boundaries with chosen inputs. Score equivalent behavior and useful edits, not only recovery of the original table bytes. Specialized parsers and validators deserve a separate cohort, not a general-JS headline.

**Cross-build familiarization.** Know the compiler, seed and rewrite vocabulary. Generate chosen-source training artifacts, correlate dataflow motifs, and cache helper eliminators across builds. Teach the tool new cases through an AI-assisted deterministic rewriting workflow; [CASCADE v2, February 2026](https://arxiv.org/abs/2507.17691v2), is a relevant JavaScript example. Report one-time setup and marginal cost at 1/10/100 builds. A seed-held-out result alone does not measure adaptation to a familiar compiler.

## Real competing investment options

| Option | Why it is credible | Primary concern |
|---|---|---|
| Baseline rehabilitation plus qualification | Restores semantic confidence and produces a competent attacker before another rewrite; preserves broad existing behavior | Universal VM seams remain; no new strength claim |
| Whole-root fusion and liveness, then gated synthesis | Removes real function/frame cuts and can reduce runtime; reuses WIP ownership and effect analysis | Direct generated JS may normalize almost for free |
| Fixed-configuration residual specialization | Removes a specific valuable declarative program/evaluator pair and may fund protection through speed savings | Narrow applicability; rule learning may recover equivalent behavior cheaply |

I prefer the second as the architecture direction, with the third as a separately scored workload-specific experiment. Use S8-C admission discipline, S6-A/B publication, S9-A/B correctness evidence and S4-A/B/C attacks. Keep S1-C/S2-A prototype-gated after fusion controls; S5/S7-C selection is a build discipline, not a strength score. S3-B activations are foundation work; S2-B cross-effect encoding is deferred.

Reject standalone MBA expansion, chart multiplication, local key hiding, canceling polynomial inflation, source hashes as runtime authentication, and topology diversity as evidence. Reject combining the new static protection claim with the old dynamic closure interpreter. Certificates and packaging reduce accidental exposure; they do not resist an authorized attacker editing local bytes.

## Actual peer exchange and changed recommendation

`swarm_compiler` challenged my S2-A fallback and S2-B reentry assumptions. I agreed to statically proven domains and one realization initially, and supplied this regression: `state.n++ ; cb(); return state.n`, starting from 1 with `cb` assigning 40, must return 40 rather than stale encoded 2. Recursive reentry and throw/finally variants are required. The shared decision is commit visible cells at the original point, invalidate cached alias facts, and reread after unknown callbacks. Cross-effect encoding is deferred until that protocol passes; nonescaping private scalars remain a separate case. The compiler panel confirmed this narrowing.

I challenged `legacy_review` on borrowed native `toString`, CSP-blocked literal eval, host assertions and certificates. It accepted rejecting eval/Function/string timers initially, including finite literals, until native rejection and lexical semantics are modeled; finite inventoried local imports remain eligible. Supplied vendor/application JS remains authored ownership; platform ABI inventory cannot exempt it. It confirmed hashes/brands establish build provenance only. This is an actual scope reduction from S6-C's broader finite-ingress proposal.

The coordinator and architecture panel subsequently clarified the reflection scope, and I accept it: attackers may always call native `toString` and inspect generated source. Correctness concerns declared program-visible execution observations and qualified legitimate host APIs, not unrestricted hostile contextual equivalence. Ordinary DOM/event/timer callbacks may therefore be admitted when their specified API behavior does not feed original source text back into application behavior. Unknown legitimate source-dependent integrations remain unresolved and must reject/defer; a HostContract assertion alone does not settle them. This clarification prevents my earlier callback caveat from becoming a blanket callback ban.

## First falsifier and required gate changes

Before a broad compiler rewrite, give one attacker engineer a day to build normalization/slicing against six dependent-recurrence kernels, six fixed-config evaluators and independent-output controls, with eight builds each. Compare ordinary optimized JS, main production max, strongest functional offline PR5, eligible PR7 scalar BPRF, repaired September, fusion-only, and the proposed composition, pairing only equivalent coverage. Provide compiler source and seeds; withhold owner maps. Validate standalone replacements and targeted edits on hidden observations.

If reusable normalization restores comparable models within 2× attack CPU and no additional analyst work, kill that protection rationale and retain only performance benefits. A failed attacker or two censored baselines is inconclusive. Survivors then face S4's larger paired campaign, independent attacker, build-transfer and resource gates. Freeze one shared threshold schedule rather than selecting whichever brief's 2×/3×/5× threshold happens to pass. The coordinator's metric challenge is adopted: use the same admissible attack portfolio and CPU/token/analyst budgets, report time to valid replacement plus every resource dimension, and award no win when a cheaper alternative lane succeeds. Moving work into model inference or humans cannot manufacture CPU amplification.

Blocking issues are the easy equivalent lane, unresolved observable alias reentry, dynamic-source/CSP mismatch, and unproven reflection assumptions. The strongest remaining attack is normalized per-output slicing plus local inference. Nothing reviewed supplies a cryptographic secret or prevents unchanged offline reuse.
