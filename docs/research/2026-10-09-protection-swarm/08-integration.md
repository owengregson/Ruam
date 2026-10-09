# S8 — Cohesive offline architecture and migration

Independent brief, 2026-10-09. Recommend **S8-B as the target architecture, delivered through S8-C's admission schedule**, with S8-A retained as a separately labeled baseline. This is a vote for investigation, not demonstrated protection. Every emitted dependency is local JavaScript; copying the unchanged artifact remains possible.

## Evidence constraining integration

Code anchors are relative to `packages/ruam/src/`. Main `ruamvm/handlers/registry.ts:37–74,130–134` exposes the conceptual operand/frame/handler seam. September (`f7f52c8`) offers better compiler foundations: `isogloss/source-program.ts:55–74,98–104` owns complete scripts/modules and separates module instantiation/live cells; `isogloss/whole-source-transform.ts:149–242` links frontend, ownership, emission and artifact evidence. Its broken structured-loop implementation still prevents qualification.

September also contains an incompatible second execution architecture. `isogloss/dynamic-source/regions.ts:1–7` explicitly calls its closure combinators a universal dynamic boundary; `:25–40` supplies shared environment state; `:118–124` introduces a step-limit exception. `dynamic-source/runtime.ts:378–396` parses and executes strings through it. Removing opcode names does not eliminate this reusable lowering/execution seam. That subsystem cannot inherit the static architecture's protection claim.

## S8-A — Minimally rehabilitated legacy baseline

Freeze main's max semantics and interfaces, restore missing regression coverage, fix confirmed correctness defects, retain allocation/liveness improvements, and eliminate misleading source-authentication claims. Keep deterministic production max artifacts, not debug/low artifacts, in the attacker corpus. Do not transplant bytecode caches into max.

This is the fastest route to a stable control and protects previous users from a broken wholesale replacement. It retains a known general operation machine, however, so it fails the intended no-universal-semantic-router architecture. Per-handler expansion or moving the table cannot resolve that defect. Treat it as baseline maintenance, never an automatically selected backend for the new contract.

**Experiment/kill:** establish semantic and resource baselines across seeds, then run artifact-aware state/handler instrumentation. Abandon any claimed architectural security upgrade if the same reusable extractor survives cosmetic changes. Performance improvements alone remain useful engineering.

## S8-B — Whole-root semantic compiler with joint realizations

Compile every authored body in the submitted module graph into one semantic ownership universe. General effectful JavaScript receives exact generated control and object operations. Proven regions additionally receive joint predicate/result synthesis; escape analysis combines private state across regions; representation transfers are composed before materialization; one cost planner chooses a complete artifact. These mechanisms compound: larger proven regions remove operation cuts, private-state composition prevents immediate recreation of those cuts, and attack qualification rejects optimization choices that reconstruct them.

Emit one selected implementation per contract. No native authored lane, easy duplicate realization, global opcode router, or option-driven alternate assembly path is available. A guarded specialized path is allowed only when its general path receives the same final qualification and cannot cheaply replace the protected computation. Prefer proof of the domain from program semantics over such guards.

**Example:** an authored pipeline computes `s'=branch(x,s)`, calls `notify(s'&1)`, updates `(s',t)`, then returns `finish(t)`. A VM reveals each operation and decoded register. Naive regional output reveals `s'` at an array handoff. The proposed emitter keeps a coupled private representation across the notification, opens only its required bit, and composes the following update directly. The attacker must now recover the relationship across those sites or learn the external function. This is a change in the cheapest proposed extractor, not proof that the latter attacks are expensive.

**Strongest attack/cost:** symbolic normalization may reconstruct that relationship immediately, and many JS effects expose nearly everything useful. Joint synthesis, code growth and proof search may cost more than recovery. Kill the proposal if held-out whole-artifact recovery remains comparable to plain fused compilation at matched coverage, or budgets cannot be met. Do not count branch/function renaming as successful diversity.

## S8-C — Complete admitted roots, narrow initial rollout

Deploy the S8-B pipeline first for complete, closed synchronous libraries with fixed module provenance and sufficiently provable numeric/private-state regions. Accept the entire submitted root or reject the artifact. This is not automatic selection of an annotated “secret” function while silently leaving the rest authored and native.

Expand admission in verified increments: ordinary objects/closures and exceptions; cyclic module cells; generators/async; finally the difficult dynamic-source cases. The same contracts and final writer remain throughout. This reduces the initial semantic proof surface and produces usable experiments sooner, but excludes substantial existing JavaScript and risks selecting only toy workloads whose outputs are easily learned.

**Experiment/kill:** qualify three realistic closed libraries with changing inputs, callbacks and module boundaries, publishing rejection reasons and coverage denominators. Stop presenting C as a practical rollout if no representative application fits without source rewrites, or if only low-complexity functions remain eligible. Do not expand admission merely to improve benchmark acceptance rates.

## Shared contracts and exact pass order

Owner-only records are `SourceOwnership`, `SemanticRoot`, `EffectEscapeGraph`, `RegionContract`, `RepresentationPlan`, `CostPlan`, `HostABI`, and `ArtifactEvidence`. Semantic nodes carry value domains, reads/writes, possible coercion/throw/call/suspension and completion successors. Physical layouts never become canonical runtime frame schemas.

The sole publication pipeline is:

1. Snapshot source/module bytes and host/CSP contract; parse and establish complete ownership.
2. Construct canonical control, lexical and module-cell semantics; verify evaluation order and completion edges.
3. Analyze effects, escape, liveness and exact domains; select closed clusters and region boundaries.
4. Generate and verify joint realizations; compose representation transfers and activation layouts.
5. Select costs and helper sharing; emit generated JS; run safe optimization.
6. Reverify ownership/equivalence obligations against final structure; execute differential, cost and attacker qualification on final bytes.
7. Bind owner evidence to source/frontend/compiler/seed/policy/output digests; publish atomically.

Minification, packaging or concatenation after step 6 invalidates its binding. Coverage evidence establishes correspondence, not resistance. Public entry points accept source, a host contract and budgets; they cannot accept arbitrary caller-created IR/evidence or choose an unqualified emitter. Keep development baselines outside this assembly route.

## Semantics and admission matrix

| Surface | S8-A | S8-B target | S8-C initial |
|---|---|---|---|
| Router-free joint regions | No | Required | Same B implementation |
| Owned static scripts/modules | Existing support requalified | Complete graph ownership | Closed synchronous graph |
| Exceptions/reentry | Regression baseline | Explicit completion/activation contracts | Only qualified forms |
| Async/generators/cyclic TLA | Existing behavior tested separately | Staged qualification | Reject initially |
| Arbitrary runtime source | Existing support assessed honestly | Unresolved; reject until compatible | Reject |
| Source-text-sensitive behavior | Explicit admission review | Reject if exactness/protection conflict | Reject |

Exceptions require normal/return/throw/break/continue and target-sensitive `finally` handling. Reentry commits externally observable state before the call and uses separate activations. Generated native `await`/`yield` expressions may preserve host scheduling while the surrounding authored body remains transformed; September `runtime/regional-continuation-lowerings.ts:18–56` supplies a starting point. Prove thenable assimilation, iterator closing and resume order. Modules require instantiation before evaluation, identity-preserving live bindings and qualified cycle/TLA scheduling.

Host calls necessarily reveal arguments, identities, effects, order and results. Shared helpers may implement declared language infrastructure but must not accept canonical opcodes, whole cleartext state or reusable private-state decoding schemas. Shared projections require attack evidence; safe code reuse is not inferred from a helper's name.

## Dynamic source, reflection and migration limits

Strict CSP can block runtime string compilation; executing arbitrary source through a replacement interpreter creates another general semantic substrate. Preserving native CSP rejection is itself behavior: precompiling a literal `eval` must not silently turn a blocked program into a successful one. Initially reject such sources; finite predeclared dynamic imports may use the owned local graph. [CSP Level 3, accessed 2026-10-09](https://www.w3.org/TR/CSP3/#integration-with-ecmascript).

`Function.prototype.toString` can expose source text. Programs or host integrations requiring exact authored text conflict directly with concealing it. Admit only contracts where that observation is absent/proven irrelevant, or reject; do not redefine “exact” silently. [ECMAScript, accessed 2026-10-09](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-function.prototype.tostring).

Migration preserves legacy suites and expected outcomes in an executor-neutral harness. Add September cases; never delete failing families during cutover. Gate each admission expansion independently, retain original/native execution only as a test oracle, and switch publication only after semantic, ownership, resource and attacker gates pass. No single certificate or successful vote substitutes for that evidence.
