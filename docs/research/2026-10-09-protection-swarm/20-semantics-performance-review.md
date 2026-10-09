# Round 2 — Semantics and performance panel

Reviewer: `swarm_compiler`, 2026-10-09. Read briefs S1–S9 and the decision method. This is one worker's deliberation, not three votes from its specialist roles. Recommendation: prototype S8-B through S8-C's narrow admission schedule, with the revisions below. No proposed combination has demonstrated stronger protection.

## Coherent combination

Use one source/module ownership graph, canonical semantics, value/effect SSA, alias/escape analysis, and liveness plan. S1-A/B, S3-A/B and S5-B describe overlapping compiler work: implement it once. Their foundational value is exact transformation and reduced materialization; give them no separate resistance score. S6-A/B supplies one offline compilation/publication route, while S9-A/B establishes evidence grades and real-host qualification.

The first protection experiment should join S2-A with S1's proven call/consumer fusion: one selected direct implementation of a genuinely dependent predicate/result relation, consuming typed private values without array/frame handoffs. S7-A extends this only after branch/loop proof support exists. S3-C/S7-B are a second targeted experiment for private immutable data-driven evaluators; they are the same specialization family, not independent layers. S5-A/C and S7-C become one deterministic cost/selection planner.

S2-B's activation ownership and projection contracts belong in the foundation. Its proposed invertible state representations remain a separately ablated experiment; changing basis is not itself protection. Defer composition across observable effects until alias invalidation and reentry are validated. This removes a major semantic risk without abandoning the useful hypothesis that consumer specialization removes recovery boundaries.

## Admission and proof obligations

Initial admission covers complete closed synchronous roots with fixed authored-module provenance, qualified ordinary private objects/closures, and proven scalar domains. Every executable authored contribution must use the same owned pipeline. Optimization-ineligible code may use exact general generated lowering, but that path remains part of whole-artifact attacks and cannot inherit the stronger region's result.

Do not claim full-JavaScript compatibility from this first tier. Reject arbitrary runtime source, eval/Function/string timers, async/generators, cyclic module initialization, and unqualified reflection boundaries initially. Broader syntax advances through separate evidence. Report all attempted roots and rejection reasons; paired comparisons use each baseline's genuinely protected intersection. A small admitted subset can justify a bounded result, never superiority over historical systems on unsupported programs.

Type guards are not an escape from this obligation. Prefer facts established by unconditional authored operations, such as a completed `x >>> 0`, and preserve that operation's original coercion/throw behavior. A guessed integer annotation does not permit modularizing general Number arithmetic. BigInt mixing, negative zero, NaN, overflow, and evaluation order remain explicit. Branch-to-select conversion requires both arms to be total and effect-free, not merely apparently arithmetic.

For private heap elimination, prove nonescape and known own-data accesses; do not assume freezing proves all accesses unobservable. Cross-module inlining must preserve initialized live-binding identities, TDZ, module order, and namespace observations. Unknown calls invalidate mutable facts. Captured bindings and mapped arguments require actual shared cells; separate activations must survive recursion independently.

Replace one-node/one-codelet correspondence with many-to-many transformation witnesses. Every elimination, fusion, exceptional successor and completion target needs justification. A final digest establishes byte identity, not semantics. Grade exact bitvector proofs separately from vetted templates plus differential tests. Mutation tests must break branch, alias, coercion and finally behavior while retaining/recomputing emitter metadata; otherwise qualification risks self-attestation.

## Weakest path and rejected combinations

The cheapest likely defeat is a general equivalent fallback followed by AST-to-SSA normalization and slicing. Even if the fallback's guard excludes integers, attackers may extract its generic arithmetic and use it on the integer target domain. Qualifying only the selected fast path is inadmissible. Score the cheapest successfully reusable lane, including forced guard failures, cold paths and fallback entry patched by the attacker.

Also reject independent-output bundling as evidence of increased semantic complexity: attackers can synthesize each projection separately. Necessary dependencies must survive ordinary optimization. Do not combine expensive region scores additively, multiply “diversity” measures, or count required hooks as analyst effort. Full artifact reuse remains available.

Other incompatible combinations are a dynamic interpreter inheriting static-region strength; shared projection helpers recreating a universal decoder; depth-only activation pools with suspended invocations; speculative state restoration across callbacks; post-qualification minification; and runtime time/depth limits used to enforce build budgets. Each either creates an easier path or changes admitted semantics.

S6-C's generated-source reflection is a disclosed compatibility boundary, not unrestricted contextual equivalence. Scanning for `toString` is insufficient to classify legitimate source-dependent behavior. Define correctness over declared application-visible observations and qualified host semantics. Ordinary DOM/event/timer callback ABIs may accept escaped functions when they do not feed original source text into application behavior. Attacker reflection is allowed and returns generated code; it need not be prevented. Reject unresolved legitimate original-source-dependent integrations, including borrowed-intrinsic cases, while keeping supplied integration/vendor code owned. Reports must name this observation contract rather than claim unrestricted full-JS exactness.

## One provisional cost and attack envelope

Use a recorded 100-KiB application tier and fixed engine/device profiles. All dimensions are conjunctive; measure complete packages and both general/specialized lanes. These replace competing component-level shipping thresholds:

| Dimension | Provisional admission/promotion envelope |
| --- | --- |
| Warm runtime | Geometric mean ≤5× native and ≤1.5× fastest validated protected comparator; every workload ≤10× native and ≤2× that comparator |
| Interactive/cold | p95 ≤20 ms where native p95 ≤5 ms; added startup p95 ≤150 ms desktop / ≤500 ms declared low-end device |
| Package size | Raw ≤10× input +64 KiB and ≤2× protected comparator; compressed ≤6× input +16 KiB and ≤2× comparator |
| Memory | Added steady heap ≤32 MiB; peak RSS ≤1.5× comparator on the same host, with GC/allocation telemetry reported separately |
| Ordinary build | ≤60 CPU-seconds per 100 KiB; ≤2 GiB peak RSS; deterministic solver/expansion caps |

Choose comparators per metric and workload from all applicable, semantically valid historical controls before results. State missing intersections. These are empirical qualification limits, not runtime restrictions on arbitrary input. S2's 15× size allowance is too loose for promotion; S5's blanket “no worse than main” is replaced by the explicit relative envelope. S7's expensive local tournaments belong to research qualification, outside the ordinary build cap; production uses frozen selections or replayable evidence, not timing-dependent choices. A watchdog aborts a build rather than selecting an unfinished plan.

Keep S4's pilot/promotion attack budgets and frozen cohorts: pilot median verified recovery-CPU amplification ≥5×; promotion point estimate ≥10× with program-clustered 95% lower bound >3×, plus attack/runtime amplification >5. S2/S3/S7's 2–3× thresholds are cheap **rejection screens**, not competing promotion criteria. Always report CPU, analyst effort, model tokens, wall time and quality independently. Censored runs do not manufacture ratios; if the comparative lower bound cannot be established, promotion is inconclusive. Tiny oracle-learnable kernels stay mandatory ceiling controls outside the predeclared nontrivial application promotion cohort.

Controls include main max, strongest validated offline PR5, eligible PR7 scalar BPRF, minimally repaired WIP, native, plain optimization and weak debug variants. Repairs and coverage differences remain visible; broken or bypassed configurations cannot be convenient opponents.

## Actual discussion and required revisions

I challenged `swarm_runtime` on extracting the general lane and stale state across callbacks. The reply supported statically proven domains and one emitted realization initially, minimum-cost-lane qualification, and deferring cross-effect encoding. Its concrete counterexample was `state.n++`, callback mutation to `40`, then returning `state.n`: a cached encoded value must not incorrectly return `2`. It added recursive reentry and throw/finally variants. Accordingly, the proposed boundary ABI now requires committing visible cells once at the original effect point and invalidating/rereading cached facts after unknown callbacks.

`legacy_review` challenged source reflection through escaped functions and finite eval under CSP. I initially emphasized conservative callback admission. The coordinator then distinguished attacker inspection from legitimate source-dependent observations; `legacy_review` and I accepted that correction. Qualified platform callbacks are admissible without proving that attackers never invoke reflection. Unknown legitimate source-sensitive integrations remain unsupported. Eval/Function should be rejected initially; finite local imports need qualified native module ordering. This narrowed my support for finite precompiled source ingress without banning ordinary callbacks.

Before voting, require the frozen slate to state these admission limits, fallback minimum-cost rule, reflection decision, deterministic budget envelope, and separate evidence grades. Fund the fallback-extraction and reentry counterexamples before broad emitter migration. They can invalidate the strongest integration assumption cheaply.
