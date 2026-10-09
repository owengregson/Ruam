# S7 — Research and cryptanalysis assessment

Round 1 specialist brief, 2026-10-09. This worker also authored S1/S4; no peer briefs were read. Execution must remain self-contained offline JavaScript. Build-time solvers and analysis tools are permissible; none supplies a runtime secret or trusted boundary.

## What the research actually supports

[XSmir, CCS 2025](https://binsec.github.io/assets/publications/papers/2025-ccs.pdf), extends Xyntia with local inference for arbitrary constants, masks, affine forms, and polynomial relations. Its published limitations concern grammar expressiveness, sampling, and reverse-window selection; loops or branches are not inherently unsynthesizable. Skilled attackers can choose smaller windows or extend the grammar. Therefore “large random constants,” “nonlinear,” and “not in the default grammar” are poor security arguments.

[Loki, USENIX Security 2022](https://www.usenix.org/system/files/sec22-schloegel.pdf), provides a useful distinction: concatenating independent outputs leaves each easy to synthesize; composing dependent operations changes the local semantic problem. Its evaluation concerns a native-code prototype and automated attacks, including then-current Syntia. The paper explicitly excludes measured human performance, and its selective protection economics do not establish acceptable whole-JavaScript costs. Its headline success rate must not become a Ruam target or prediction.

[SiMBA, 2022](https://arxiv.org/abs/2209.06335), attacks linear MBA; [GAMBA, 2023](https://arxiv.org/abs/2305.06763), adds practical nonlinear simplification. [Equality saturation with egg, POPL 2021](https://arxiv.org/abs/2004.03082), offers a practical mechanism for exploring equivalences and extracting simpler expressions. These are complementary attacker techniques, not a proof that every expression is efficiently solvable. [CASCADE v2, February 2026](https://arxiv.org/abs/2507.17691v2), combines AI helper recognition with deterministic JS IR transformations: a modern adversary should write normalization tooling, not merely summarize unreadable source.

Ruam has a sound starting warning: `f7f52c8:compiler/pure-region-learnability.ts:1-6,102-116,190-195` labels enumeration/interpolation costs as constructive attack **upper** bounds and never hardness lower bounds. Retain this analysis offline while removing custody-specific product terminology. `isogloss/bprf/generate.ts:347-425` exposes a small algebraic formula family. Its complexity should be tested after simplification, not counted before it.

## S7-A — Fuse dependent recurrences, not independent outputs

**Mechanism.** Extend value/effect SSA selection beyond straight-line expressions to closed, side-effect-free branch/loop regions. Select real chains whose outputs feed later computation, inline downstream consumers, and compose two to four iterations of bounded recurrences where exactness is provable. Emit specialized structured JavaScript with liveness-based elimination of obsolete intermediate states. Preserve genuine dependencies among surviving outputs; do not fabricate high degree with canceling terms.

A useful first target is a parser accumulator whose branch choice and next state both depend on an earlier update. A poor target is a tuple of unrelated arithmetic results. Multiple outputs alone increase no synthesis difficulty: each output can be targeted independently. Fusion is promising only if individual useful projections themselves become larger dependent relations, or profitable intermediate cutpoints disappear.

**Assumptions and cost.** Inputs are proven primitive values; private state does not escape. No fusion across getters, proxies, coercion hooks, exceptions, suspension, or reentry unless a stronger effect proof explicitly permits it. A public branch keeps its original evaluation order; executing both arms requires both to be total and effect-free. Start with existing guarded integer contracts in `compiler/pure-region-lowering.ts:136-147,695-707,894-910`, which already reject negative-zero and overflow hazards. The old single-fallthrough lowerer cannot simply be relabeled loop-capable. Code growth, live ranges, and JIT tiering may erase speed gains.

**Strongest bypass.** Pause between arithmetic operations, reconstruct SSA, and split the recurrence into small windows; recover each projection with inference rules and combine them. The emitted source and host implementation are attacker-visible. No assertion that a transient value is unobservable is allowed.

**Cheap disproof.** Use six real recurrence kernels and six independent-output controls, eight seeds each. Compare fusion with ordinary optimization and equal-budget protection without fusion. Give an attacker a generic AST-to-SSA slicer plus XSmir-compatible sampling and custom branch rules. Reject the security rationale if a one-day implementation reconstructs the original-size windows automatically and median verified recovery takes less than twice the comparator cost. Any semantic mismatch vetoes implementation. This is an investment test, not the later promotion gate.

## S7-B — Specialize private data-driven programs into residual code

**Mechanism.** Where an authored interpreter/evaluator consumes compiler-proven immutable private configuration, partially evaluate the pair. Compile a fixed ruleset, parser grammar, or state-transition specification into direct residual JavaScript control/dataflow. Fold configuration-dependent branches, eliminate interpreted instruction arrays and generic evaluator frames, and inline consumers before final protection. No universal language dispatcher or recoverable copy of the original private program/configuration should remain solely for execution.

This changes a concrete attacker target: the convenient pair “generic evaluator + declarative algorithm data” disappears. It can also pay for protection by removing genuine interpretation overhead. It is a specialization optimization with a testable recovery consequence, not encryption of the ruleset.

**Assumptions and exactness.** Configuration immutability, nonescape, and exact evaluator targets must be proven. Do not inspect arbitrary objects during compilation, execute owner code to guess constants, or treat `Object.freeze` as proof against every observable access. Unknown properties, identity observations, dynamic source, and externally mutated configuration remain in the general fully owned path. Preserve observable exceptions and module initialization order. Reject unsupported specialization rather than retaining unprotected authored bodies.

**Strongest bypass.** Symbolically execute the residual decision graph or actively learn its acceptance/state-transition relation. Specialization may actually produce a cleaner program. All public inputs/outputs remain available, and a small finite protocol remains cheap to enumerate.

**Cheap disproof.** Protect six fixed-config evaluators before and after specialization; allow an attacker to learn the public relation and rebuild a compact ruleset. Kill the protection rationale if equivalent residual behavior is recovered with unchanged tools and no greater effort, even when literal configuration recovery becomes harder. Cap emitted-code growth at 2× and compile time at 30 seconds per pilot specimen. Keep measured speed improvements separately. This candidate applies only to a preregistered workload class; it cannot justify general-JS strength claims.

## S7-C — Adversary-tested selection and a learnability veto

**Mechanism.** Make candidate selection a bounded build-time tournament: generate several proven-equivalent implementations of A/B regions, run inexpensive normalization and local synthesis probes, and retain only Pareto candidates under runtime, size, and compiler budgets. Public rule libraries are assumed known. The selection record contains semantic proof obligations, measured attack recipes, budget limits, and why a candidate survived; keep it owner-side.

Use the existing enumeration/interpolation analyzer to veto expensive protection when a cheap known attack already meets the recovery goal. This veto rejects spending on a mechanism, not compilation of the user's program. No known cheap attack is merely “unknown,” never “hard.” For simple functions, use the lean general protected implementation and report the oracle ceiling.

**Strongest bypass and disproof.** The selector overfits its own attackers; an independently written normalizer or AI-generated helper evaluator collapses every winner. Freeze selection, train a second attacker on three builds, then test seven fresh builds and new programs. Reject the selector if marginal attack cost returns to baseline or gains are explained by slower legitimate execution. Cache reusable attacker rules across the entire test, and separately charge initial setup. Begin with sixteen candidates and a five-minute local analysis budget per region; larger budgets need measured benefit.

## Recommendation

Prototype A and B behind one proof/effect interface, with C as a resource-allocation discipline. Retain exact general lowering and cheap-function controls. Reject local key hiding, polynomial-degree inflation, affine masking, and standalone MBA expansion as foundations; they may be incidental representations only after whole-artifact attacks justify their cost. Defer broad loop resynthesis and partial-escape materialization.

The shared runtime must preserve completion order and host identities while exposing only the necessary ABI; the attacker still sees every shipped byte and can inspect JIT/runtime state. None of these candidates establishes new cryptographic hardness, prevents artifact reuse, or gains a secret merely from offline randomness.
