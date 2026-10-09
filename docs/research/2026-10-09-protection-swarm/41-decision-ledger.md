# Round 4 decision ledger and objections

Date: 2026-10-09. Ballots cover frozen slate r1. The coordinator ran `node docs/research/2026-10-09-protection-swarm/tally.mjs`, which validated voter identity, revision, complete rankings, all 14 component choices and the absence of demonstrated-security claims. [Machine tally](40-vote-tally.json).

## Actual votes

| Worker | Specialist briefs | Ranking |
| --- | --- | --- |
| [A](ballots/worker-a.json) | Compiler, attacks, research | P-regional > P-research > P-legacy |
| [B](ballots/worker-b.json) | Runtime, performance, integration | P-regional > P-research > P-legacy |
| [C](ballots/worker-c.json) | State, deployment, qualification | P-regional > P-research > P-legacy |

Result: **3/3 for P-regional as a conditional prototype direction**. Three persistent model workers discussed common evidence; this is not nine independent voters or statistical evidence of security. The coordinator did not add a fourth ballot.

| Component | Foundation | Prototype | Defer | Reject | Final disposition |
| --- | ---: | ---: | ---: | ---: | --- |
| C01 Baselines and semantic corpus | 3 | 0 | 0 | 0 | Foundation |
| C02 Shared value/effect/alias/domain analysis | 3 | 0 | 0 | 0 | Foundation |
| C03 Private call/heap/consumer fusion | 0 | 3 | 0 | 0 | Prototype |
| C04 Live activations and reentry correctness | 3 | 0 | 0 | 0 | Foundation |
| C05 Dependent predicate/result realization | 0 | 3 | 0 | 0 | Prototype |
| C06 Additional private state representations | 0 | 0 | 3 | 0 | **Defer; changed from coordinator nomination** |
| C07 Private configuration residualization | 0 | 3 | 0 | 0 | Prototype, separate workload cohort |
| C08 Deterministic global cost ledger | 3 | 0 | 0 | 0 | Foundation |
| C09 Automated adversarial build search | 0 | 0 | 3 | 0 | Defer |
| C10 Graph ownership and final publication | 3 | 0 | 0 | 0 | Foundation |
| C11 Explicit admission/observation contract | 3 | 0 | 0 | 0 | Foundation |
| C12 Independent correctness and recovery evidence | 3 | 0 | 0 | 0 | Foundation |
| C13 Encoding across effects/reentry/suspension | 0 | 0 | 3 | 0 | Defer |
| C14 Cosmetic/secret/noise claims and proxy metrics | 0 | 0 | 0 | 3 | Reject as security foundations |

## What deliberation changed

1. Overlapping compiler/state/performance ideas become one shared analysis and planning subsystem, not three independently configured layers.
2. Synthesis initially requires domains proven by unconditional authored semantics. An easy general fallback cannot sit beside a difficult specialized implementation and escape attack scoring.
3. Multiple outputs only matter when useful projections contain genuine dependencies. Independent-output bundles and removable coupling earn no credit.
4. The three ballots unanimously deferred C06. The first protection experiment excludes new change-of-basis/encoding machinery, so a failed experiment cannot be obscured by simultaneous masking changes.
5. Cross-effect encoding was deferred after the concrete callback counterexample: a callback mutates a shared value to 40, so reentry must not return or restore the stale encoded value 2.
6. Literal eval precompilation was removed from initial admission because it can change CSP rejection and lexical behavior. Finite inventoried local imports remain a separately qualified case.
7. Reflection was clarified after coordinator challenge: attackers may inspect generated source. Original-source-dependent application behavior is a disclosed compatibility exclusion. Qualified ordinary platform callbacks are not blanket-rejected.
8. Conflicting component budgets became one conjunctive schedule, with inexpensive rejection screens separated from pilot and promotion gates. CPU inflation cannot substitute for total attack cost if a cheaper model-assisted or human-assisted route exists.

## Objections retained

There is no minority plan vote. There is unanimous dissent from the coordinator's initial C06 nomination, which the final design adopts. The following unresolved concerns remain conditions on the winning plan:

- Plain compiler optimization may make recovery easier. Artifact-to-SSA normalization plus per-output slicing and local synthesis is the first adversary, not a hypothetical later review.
- No new architecture measurements or three-real-workload admission result exist yet. A vote approves investigation only.
- Correctness validation must catch altered final behavior even when an emitter recomputes hashes and metadata. A certificate cannot validate itself.
- Narrow initial support can produce a misleading toy-only result. Publish rejected roots and keep existing full-language support tables; do not call the experiment full JavaScript.
- All equivalent general/cold paths and host-observable projections are attack surfaces. The cheapest successful route determines the result.
- Public outputs and the entire offline artifact remain available to an attacker. Simple functions may remain cheaply learnable, and copying the artifact remains possible.

## Coordinator disposition

Accept the majority plan and all component outcomes. The selected architecture is the target of a bounded experiment. The implementation order starts with runnable baselines, real semantic observations and a competent extractor, then tests C03+C05 and C07 separately. C06/C09/C13 are not prerequisites and must not expand the initial project.

If representative roots cannot be admitted, semantic validation fails, resource gates fail, or the reusable first extractor defeats the candidate at comparable cost, stop protection expansion and switch investment to P-research. Retain only independently measured correctness/performance/hygiene improvements. This stopping rule is part of the unanimous vote, not an optional future reconsideration.
