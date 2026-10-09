# Round 2: architecture and deployment panel

Worker C (`legacy_review`), 2026-10-09. Reviewed briefs 01–09 and decision method 10. This is deliberation before the frozen slate and ballot. All execution is offline JavaScript. The most coherent experimental direction is S8-B implemented through S8-C, after a bounded foundation/attack phase. That direction has not demonstrated greater resistance; a foundation-and-attacks-only alternative is legitimate if its first falsifier succeeds.

## Compatibility and decisions

| Combination | Fit and required resolution | Proposed disposition |
|---|---|---|
| S1-A/B + S3-A/B + S5-B | Shared effect/escape SSA, consumer specialization, private-state elimination and live activations are overlapping responsibilities. Implement once, not as stacked passes recreating each other's frames. | Foundation analyses; transformed behavior prototype-gated |
| S2-A + S1-C + S7-A | Joint predicate/result synthesis and dependent recurrence fusion fit one exact-domain relation generator. Whole-island resynthesis is a later search strategy, not another mandatory runtime layer. | Prototype bounded branch/state regions; defer broad synthesis |
| S2-B + S3-B | Compose representation transfers before emission; retain identity and live-cell aliases. No universal encoder/decoder or full decoded tuple. | Prototype only after plain scalarization control |
| S3-C + S7-B | Constant consumers and fixed private evaluator/configuration pairs fit one partial-evaluation subsystem. | Workload-specific prototype; no general-JS strength credit |
| S5-A/C + S7-C | One deterministic resource ledger and selection engine. Cheap attack probes constrain selection; expensive attacks qualify frozen outputs separately. | Adopt ledger; gate adaptive search on benefit |
| S6-A/B + S9-A/B + S4 | One owner graph, final-byte validation, real-host differential testing, artifact-only writer and executable recovery tournament. | Adopt as foundations; evidence remains separately scoped |
| S8-B + WIP dynamic interpreter, generic projection helpers, or native fallback | Recreates a second semantic machine, reusable state tap, or cheaper equivalent implementation. | Reject integration in initial profile |

None of these rows justifies additive security scores. The combined computation may normalize as cheaply as each part. S7's learnability veto should reject unnecessary expenditure, not reject compilation merely because an output function is simple. The lean general generated lane remains owned, but its ownership is not resistance evidence.

## Shared contract and sole pipeline

Use one owner-only `ProgramPlan` containing: immutable source/module graph and digests; exact host/CSP/admission contract; canonical values and completion edges; effect/coercion/alias/escape facts; domain proofs; region live-in/live-out and boundary projections; activation/module-cell identities; realization and resource choices; many-to-many transformation witnesses; final-byte evidence. Each stage consumes a versioned immutable predecessor. A complete declaration of emitted support helpers is part of the plan.

Required order is: snapshot and admission → parse/ownership → canonical semantics → effect/escape/liveness analysis → fusion and private-state specialization → joint relation/representation composition → cost selection → specialized emission and final minification → independent artifact inventory/translation validation → differential/resource/attacker reports → exact-byte publication. Per-file conveniences build singleton graphs through this path. No `max`, shielding, module or browser branch can return output before the common admission and writer gates.

Validation responsibilities must remain distinct. An owner witness can prove correspondence; it cannot prove its emitter correct by recounting the emitter's own annotations. Mutation tests must alter actual behavior while updating the digest, ensuring the semantic gate is stronger than checksum verification. Full general-JS correctness remains tested/template-justified unless a stated proof domain supports stronger language. Public reports identify evidence grades instead of saying “all seeds proved.”

Client output consists of generated JS, necessary local assets and minimal loading metadata. Compiler IR, layouts, source maps, original bodies, proof witnesses and per-node reconstruction maps remain outside the package. Runtime support may share ordinary language infrastructure with an explicit observation surface; semantic-op selectors, complete-frame services and generic private-state projections are disallowed. Inlining every helper is not automatically better: the whole-artifact attack, not naming, decides whether shared support creates a useful universal tap.

## Module and effect boundaries

S6-A's graph ownership is necessary but is not a sibling-secret mechanism. Every supplied application/vendor module stays authored ownership; platform APIs are an inventoried, qualified host boundary. Native ESM can preserve live bindings and loader ordering while executing only generated authored bodies. Initial cross-module specialization is limited to proven initialized immutable bindings in closed synchronous graphs. Cycles, dynamic binding mutation and top-level await require separate qualification, not optimistic inlining.

Before a host call, publish the state observable to legitimate reentrant entry points. After a callback, invalidate facts about mutable shared cells and reload when required. Distinct invocations own distinct locals; shared closure/module state remains genuinely shared. Snapshotting all state before reentry and restoring it afterward would erase legitimate callback writes. Completion contracts include normal, return, throw, break and continue targets plus finally overrides. Preserve object/function identities and avoid broad proxy substitution.

Publish one immutable versioned package with imports pinned to that version, then switch one entry artifact; or publish one final archive. A series of file renames is not graph-atomic. Hash and qualify post-minification/package bytes, and never copy a source tree then assume extension filters remove every leak. Reproducible build seeds are disclosed in attacker experiments, so none of this depends on embedded entropy being secret.

## Actual discussion and resolved narrowing

The attack panel (`swarm_runtime`) challenged my S6-C proposal: a host callback can borrow native `Function.prototype.toString`, a host declaration alone cannot prove that absent, and precompiled literal eval can replace native CSP rejection with successful execution. It also requested an explicit vendor/host boundary and confirmation that certificate hashes are only provenance.

I accepted those objections. I sent the compiler panel (`swarm_compiler`) a concrete challenge on escaped functions, unknown callback observers and finite eval. Its response agreed that authored-text reflection must be proven irrelevant over the admitted host, otherwise rejected; scanning authored code for `toString` is insufficient. It characterized generated-source reflection as an unresolved product exception requiring an explicit later decision. The attack panel then accepted this narrowing and recommended the proof/qualified-host option for the current contract.

Accordingly, **revise round-one S6-C**: initial admission rejects eval, Function constructors and string timers, including finite literal cases. Finite inventoried local imports require qualified native ordering. Arbitrary adapters cannot exempt supplied code; source-dependent application behavior cannot silently change. Certificates/brands/hashes provide build provenance and publication hygiene, never runtime authenticity, anti-patching or resistance. These are exchanged positions, not votes or an empirical consensus.

The coordinator subsequently distinguished attacker reflection from compatibility, and I accepted the clarification: an attacker may call native `toString` and inspect generated source. Correctness does not promise original-source responses to every hostile context. Define preserved program-visible execution observations explicitly. Ordinary DOM/event/timer-function callbacks remain admissible under qualified platform semantics when source text does not influence application behavior. Unknown legitimate source-sensitive integrations require analysis or rejection; escape alone is not disqualifying. The proposed source-reflection compatibility exclusion must be public, not an implicit claim of unrestricted contextual equivalence.

## Alternatives and staged migration

**S8-A alone** is the smallest restoration effort and a useful stable control. It retains the reusable VM operation interface, so it does not satisfy the intended new architecture. Maintain it separately; never silently select it as the new contract's backend.

**Foundation and attacks only** invests in baseline restoration, corpus adapters, real-host tests and competent extractors before synthesizing a new architecture. This is attractive if mainstream workloads fail narrow admission, the normalizer collapses plain fused output, or attack instrumentation remains invalid. It must have a stopping rule rather than become indefinite documentation work.

**S8-B through S8-C** has the clearest integrated hypothesis: remove original private call/state boundaries, jointly transform necessary dependencies, then preserve those relationships through projection-only effects. First repair reproduced baseline defects and the WIP loop path; retain old semantic fixtures in an executor-neutral harness. Then implement one closed synchronous root with branching, private state and a qualified effect boundary. Compare ordinary fused compilation, representation composition and joint realization as ablations before adding broad language support.

Before freezing the slate, require: three realistic eligible workloads without source rewrites; explicit reflection/host admission checks; one common completion/alias contract; no easy duplicate fallback; one agreed cost ledger; and a functioning independent extractor. Reconcile S2 kernel ceilings, S5 whole-artifact ceilings and S4 promotion gates explicitly rather than choosing the friendliest number after results. Five-minute per-region search cannot fit an undeclared sixty-second whole-build budget; expensive release search needs a separate recorded cap.

If the first generic SSA/slicing attack recovers the candidate at ordinary fused-compilation cost, stop the protection expansion and retain only justified correctness/performance work. The strongest reason to prefer this integrated experiment is that it can fail early and clearly, before another large unqualified replacement.
