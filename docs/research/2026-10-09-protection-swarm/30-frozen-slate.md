# Round 3: integrated candidate slate

Revision: **r1**, frozen 2026-10-09 for three worker ballots. This incorporates the three round-two panels and their actual exchanges. It proposes research investment and an architecture target; no new protection result has been measured. Product source remains unchanged.

## Non-negotiable common contract

- Strictly offline, self-contained JavaScript execution. No remote secrets, services, activation, custody, trusted hardware or native/WASM execution backend. Ordinary compilation must work locally without an online model or service; local research tools may help generate/check candidates.
- The attacker knows the compiler and seed, owns every shipped byte and can instrument, patch, inspect, query, replay and reuse the complete artifact. Unchanged reuse is always possible and reported separately from semantic recovery.
- Every submitted authored executable contribution is owned by one compilation pipeline or the entire artifact is rejected. Supplied vendor/application modules cannot be disguised as platform APIs. Coverage is not a resistance claim.
- Preserve the declared program-visible execution contract: values, coercions, identities, effects, exceptions, ordering and qualified scheduling. Do not claim unrestricted contextual equivalence including original-source text. Attacker `toString` inspection sees generated code; it is allowed, not a correctness failure. Application/integration behavior requiring original authored text is a disclosed compatibility exclusion. Qualified ordinary host callbacks are not automatically rejected; unresolved legitimate source-dependent integrations require analysis or rejection. No intrinsic monkey-patch pretends to preserve the original text.
- Initial research profile admits complete closed synchronous roots, acyclic owned modules, qualified private objects/closures and qualified ordinary host boundaries. It rejects eval, Function constructors and string timers (including literals), arbitrary runtime source, and initially unqualified async/generator/cyclic-module cases. Finite inventoried local imports need verified native ordering. This is a scoped experiment, not a full-JavaScript release claim.
- Initial synthesis uses domains proven by unconditional authored semantics, never optimistic annotations or a guard with an easier equivalent fallback. General generated operations remain part of whole-artifact attacks. Score the cheapest successful lane.

## Competing system plans

| Plan ID | Investment | Advantage | Main reason to decline |
| --- | --- | --- | --- |
| `P-legacy` | Repair/requalify the existing VM, build the common attack harness, and prototype dependent multi-operation fusion within that backend before choosing a replacement. | Lower migration risk and existing broad semantic coverage; provides a stable usable control. | Shared interpreter state/dispatch remains a reusable recovery surface; fusion may leave the fundamental attack unchanged. |
| `P-regional` | Target one whole-root region compiler, deliver it through complete-root staged admission, and make expansion conditional on early attack falsifiers. Use shared analyses, fused necessary dependencies, live activations, one selected realization and one final writer. | Removes original private call/frame boundaries and avoids the central VM interface; overlaps with useful compiler/performance work. | Ordinary generated JS may normalize more cheaply than VM output; support and implementation cost are substantial. |
| `P-research` | Fund only baseline restoration, competent attack tools and competing small fusion/configuration experiments initially; postpone an architecture commitment until those measurements exist. | Limits another large unqualified rewrite and allows the strongest empirical candidate to win. | Does not yet select a cohesive target implementation; can stall without strict stopping rules. |

All three plans include common correctness, coverage and measurement foundations. Choosing `P-regional` approves a target and bounded prototype, not an unconditional rewrite. If its first attack/admission gates fail, stop expansion and retain only independently useful fixes.

## Component slate

Allowed dispositions: `foundation`, `prototype`, `defer`, `reject`. Foundation means necessary engineering/evidence investment, not proven resistance. Prototype means a falsifiable hypothesis awaiting results.

| ID | Component and source proposals | Coordinator nomination |
| --- | --- | --- |
| C01 | Reproducible baselines and executor-neutral semantic corpus; fix observed blockers only in published baseline repair diffs. S8-A, S9-B. | foundation |
| C02 | One value/effect SSA, alias/escape/domain/completion analysis and many-to-many transformation witnesses. S1-A/B, S9-A. | foundation |
| C03 | Proven cross-call/module fusion, private-object/closure elimination and consumer specialization. S1-A/B, S3-A, S6-A. | prototype |
| C04 | Activation-local live state; true shared cells only for observable aliases; precise commit/invalidate/reread at reentry. S3-B, S5-B. | foundation |
| C05 | One verified dependent predicate/result or recurrence realization; genuinely dependent projections; exact int32/uint32/Boolean domains initially. S2-A, S1-C, S7-A. | prototype |
| C06 | Compose private-region state representation changes into necessary transitions without generic codecs or complete decoded tuples. No observable-effect crossing initially. S2-B. | prototype, after plain fusion control |
| C07 | Residualize proven private fixed configuration/constants with their consumers; score as a separate workload class. S3-C, S7-B. | prototype |
| C08 | One deterministic whole-build resource ledger and complete-artifact cost plan. Use fixed qualified recipes initially. S5-A/B/C. | foundation |
| C09 | Automated adversary-tested candidate search and learnability-based spending veto. S5-C, S7-C. | defer until simple fixed recipes show value |
| C10 | One frozen authored module graph, owner/client evidence separation, exact-final-byte qualification and package-atomic publication. S6-A/B. | foundation |
| C11 | Explicit ingress/host/reflection admission contract and complete-root expansion schedule. Revised S6-C, S8-C. | foundation |
| C12 | Independent final-artifact semantic validation, real-host tests, competent executable-recovery attacks and distinct evidence grades. S4-A/B/C, S9-A/B/C. | foundation |
| C13 | Encoded state across observable alias effects, reentrant callbacks and suspension. | defer until exact boundary protocol and plain-state controls pass |
| C14 | Cosmetic MBA/chart multiplication, embedded-key secrecy, self-hash anti-patching claims, dead trace noise, easy duplicate realizations, and counting variation/hooks as protection. | reject as security foundations |

Excluded by user constraint rather than subject to voting: services, server custody, external keys and trusted hardware. Deferred dynamic-source interpretation may not inherit this static compiler's claims or become its hidden fallback.

## How the nominated regional system composes

One owner-side `ProgramPlan` carries versioned immutable contracts. It is not emitted as a machine-readable reconstruction guide.

1. Freeze all authored source/modules and host requirements. Establish complete ownership and admission before transformation.
2. Lower to exact canonical values, control and completion semantics; produce value/effect SSA, alias/escape/domain/liveness facts.
3. Fuse proven private calls and consumers; scalar-replace unobservable private allocations. Build effect-respecting dependent regions. Do not cross a boundary merely to enlarge a graph.
4. Generate a bounded joint realization for eligible regions. Compose any experimental private representations with producer/consumer operations before choosing materialized values. Emit one implementation, not a menu of all alternatives.
5. Assign live activation state, alias cells, module bindings and exact host projections. Unknown calls invalidate affected mutable facts; reread after reentry. Never restore away legitimate callback writes.
6. Select a complete plan under one resource ledger. Emit local JavaScript with required support only; minify/package before final validation. Shared helpers cannot become an operation+operands dispatcher or complete-state decoder under another name.
7. Independently inventory/check final bytes; run correctness, resource and adversarial qualification at their declared grades. Publish the complete exact-byte package through one terminal writer. A failed stage emits no partially protected package.

### Worked integration target

Use a closed stateful parser/checksum/rule-processing root whose authored primitive coercions establish integer state. Today its private helpers, object fields, interpreter registers or BPRF arrays offer convenient cuts. C02 proves which structure is unobservable; C03 removes those cuts; C05 jointly changes the necessary branch/state update; C04 retains only live state; optional C06 is tested against the plain form. Required host effects expose their exact values. C08 limits cost and C12 tries to reconstruct the entire relation anyway.

The differentiating hypothesis is that reusable recovery now requires reconstructing dependent application computations rather than lifting a common semantic machine. A generic AST-to-SSA slicer may refute it. Absence of a VM dispatcher, fewer arrays or more exotic algebra is not a successful experiment.

## Common gates and budget reconciliation

First show three realistic roots fit the initial profile without rewriting their source or hiding rejects. Restore a runnable semantic baseline and a competent independent extractor. Preserve simple learnable kernels as negative/ceiling controls.

The first falsifier compares plain optimized/fused JS, main production max, strongest validated functional offline PR5, eligible PR7 scalar BPRF, minimally repaired September, and candidate ablations on their actually protected intersections. Publish repair diffs, all support failures and full scope tables. A broken or bypassed baseline cannot manufacture improvement.

Use six dependent-recurrence specimens, six fixed-configuration evaluators and independent-output controls, eight builds each, with a bounded one-day normalization/slicing implementation. If a generic attack reconstructs valid standalone semantics within 2× comparable work and no added analyst effort, reject that protection rationale. Keep separately demonstrated speed/correctness benefits. This is a cheap rejection screen, not a shipping criterion.

Survivors use S4's frozen pilot (6 development/12 hidden application programs, 4 builds each, separate 24 easy kernels) and promotion (30 fresh hidden programs, 10 builds each) protocol. Controls must demonstrate attacker competence. Pilot target: conservative paired median recovery-CPU amplification at least 5×. Promotion target: point estimate at least 10×, program-clustered 95% lower bound above 3×, attack/runtime amplification above 5. Use the same admissible attacker portfolio and CPU/token/analyst budgets; report time to a valid replacement plus all resource dimensions. A cheaper successful alternate lane defeats the claim. No gain may be claimed by moving effort from CPU to model inference or people.

Timeouts are right-censored observations, not infinite security. Both comparators unsolved, invalid artifacts, or failed harnesses are inconclusive/failures. Require independently extracted semantics or a meaningful preregistered edit; mere artifact transplantation/reprinting is scored separately. Publish every preregistered cohort, not a favorable subset.

Provisional product-cost envelope for a recorded 100-KiB application tier is conjunctive:

- warm runtime geometric mean <=5× native and <=1.5× fastest validated equally protected comparator; each workload <=10× native and <=2× comparator;
- p95 interactive work <=20 ms where native p95 <=5 ms; added startup p95 <=150 ms desktop / <=500 ms declared low-end device;
- raw size <=10× input +64 KiB and <=2× comparator; compressed <=6× input +16 KiB and <=2× comparator;
- added steady heap <=32 MiB; peak RSS <=1.5× comparator;
- ordinary build <=60 CPU-seconds per 100 KiB and <=2 GiB peak RSS, plus deterministic search/expansion caps.

These are proposed measured gates, not observed performance or runtime restrictions on arbitrary programs. Freeze the precise hardware, sample aggregation and applicable comparator for each metric before experiments. Expensive research searches have their own disclosed budget; they cannot silently enter normal builds. Narrow component thresholds from earlier briefs are superseded by this common schedule.

## Ballot instructions

Each worker writes its own JSON in `ballots/worker-a.json`, `worker-b.json`, or `worker-c.json` without reading other ballots. Include exactly these fields: `worker`, `slateRevision` (`r1`), `preferredPlan`, `ranking` (each plan exactly once), `components` (all C01–C14, each with `disposition`, `reason`, `conditions`), `blockingObjections` (array), `dissent` (array), `cheapestExpectedAttack`, `firstExperiment`, `voteMeaning` (`approve-prototype-investment`), and `claimsDemonstratedSecurity` (`false`). Workers may disagree with any nomination. Identify blockers rather than silently assuming them solved.

If a worker votes for P-regional, the gate sequence and stopping rules are part of that vote. The coordinator will tally actual ballots, retain minority objections, and issue a final integrated design and work order. Votes do not substitute for security measurements.
