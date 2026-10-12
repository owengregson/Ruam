# Algorithm and state replacement: architecture and attack review

Date: 2026-10-12. This is a source-backed implementation proposal and research review, not a protection result. It strengthens the [selected A1 design](../2026-10-09-ambitious-swarm/20-selected-design.md). No application root, new algorithm realization, AI attack campaign, or VM replacement is qualified by this document.

## Decision

The required replacement must handle the same JavaScript scope as current Ruam. A narrow A1 compiler alone is not an acceptable final product. The strongest concrete combined candidate is a general effect-preserving native compiler, augmented by algorithm/state replacement for complete source-qualified components and separately measured protection for the remaining selected functions. It must prove the relationship between source and generated state, preserve the entire existing API, and reject missing release evidence. A public source-to-source compiler cannot presently promise to prevent all AI-assisted deobfuscation. A useful measurable goal is to increase the cost of understanding private rule interactions and implementing partial semantic changes, subject to fixed legitimate cost limits.

The selected proposal explicitly requires a surviving real-root pilot before constructing its algorithm/state compiler. Implementing an attractive synthetic incremental evaluator first would not satisfy that condition. If the frozen root inventory has no eligible real component, or a sidecar solves the ticket cheaply, record that A1 stop and continue evaluating the combined backend candidates below. Neither difficulty finding a root nor a failed attack suite authorizes inventing a protection result or silently narrowing the required JavaScript scope.

## What the repository currently provides

| Component | Reusable capability | Missing obligation |
| --- | --- | --- |
| `src/regional/graph.ts` | Owns all supplied sources, applies aggregate budgets, preserves dependency inventory, records final artifact digest | Does not discover a semantic component or derive its transition relation |
| `src/regional/validation.ts` | Portable paths, data-only file snapshot, UTF-8 round trip, parser and graph validation, final-byte hashes | Parsing and hashing do not prove semantic equivalence or resistance |
| `src/regional/cost.ts` | Bounded files, nodes, bytes and expansion | No source-derived state cardinality proof, view-size proof, event latency or peak-memory qualification |
| `src/regional/publication.ts` | Compiler-process provenance and complete publication into an absent directory | Not artifact authentication against an attacker; publication intentionally remains unqualified |
| `src/regional/compiler/index.ts` | Babel integration, deterministic names, bounded transform recipes | Current fusion/configuration/branch-result recipes are not algorithm-family replacement |
| `src/regional/qualification/scorer.ts` | Artifact-only candidate execution, signed-zero/NaN comparisons, timeout, held-out cases | Supports only primitives and dense nonaliased arrays; fresh realm per call cannot validate a persistent object API, cross-call identity, effects or post-error state |
| `src/index.ts`, `src/types.ts` | Existing source, file and directory APIs and production VM options | VM covers constructs outside A1, including asynchronous units; generator flags alone do not establish working semantics; current root/function selection is not whole-component admission |

The regional compatibility policy also excludes original-source reflection and engine-source-dependent diagnostics. Those exclusions are part of that experimental contract; they do not automatically establish compatibility for existing VM users.

## Full-scope combined implementation candidates

The user requires the final design to retain Ruam's existing JavaScript scope. The language compatibility gate therefore applies to the complete product, while stricter relational admission applies only to the A1 transformation. Declining A1 does not justify rejecting a formerly supported program in the replacement. It also does not justify presenting untouched native logic as protected.

### Baseline inventory from actual source and tests

| Scope | Repository evidence | Required replacement behavior |
| --- | --- | --- |
| Ordinary values/operators and control flow | `test/core/arithmetic.test.ts`, `advanced.test.ts`, `control-flow.test.ts` | Preserve coercion order, short-circuiting, numeric edge values, loops, labels and completion records |
| Closures, activation identity, callbacks, `this`, arguments | `test/core/closures-scope.test.ts`, `indexed-slots.test.ts`, `functions.test.ts`; `test/stress/vm-breaker.test.ts` | Shared cells remain shared across native calls and reentry; no snapshot/restore that erases callback writes |
| Objects, arrays, methods and destructuring | `test/core/objects.test.ts`, `arrays.test.ts`, `destructuring.test.ts` | Native property/iterator operations retain their exact order; getter, proxy, iterator and coercion effects are barriers |
| Errors and abrupt completion | `test/core/exceptions.test.ts`, extensive nested `finally` cases in `control-flow.test.ts`; mutation regressions | Return, throw, break and continue traverse finally blocks correctly; a finally completion can override the pending completion |
| Async functions/methods and promise behavior | `test/core/async.test.ts`; `test/integration/chrome-ext-patterns.test.ts` | Native Promise/thenable adoption and scheduling remain correct across rejection, callbacks and repeated suspension |
| Classes and inheritance | `src/compiler/visitors/classes.ts`; `test/integration/chrome-ext-patterns.test.ts`; `test/stress/vm-breaker.test.ts` | Preserve construction, prototype identity, method receivers, initialization order and super operations |
| Dynamic import and native integration | `test/core/edge-cases.test.ts` has an executing `import()` case; `test/helpers.ts` installs native globals | Preserve the existing loader/host contract instead of applying regional static-graph rejection to the whole product |
| Generators | `src/compiler/visitors/expressions.ts` emits yield operations; `src/ruamvm/handlers/generators.ts` documents yield/lifecycle stubs | Establish real baseline behavior explicitly; add proper `next`, `throw`, `return`, delegation and finally tests rather than count opcode names as support |
| Top-level and unselected code | `transform.ts` compiles selected functions and returns original source when no units compile | Preserve the existing native top-level contract and selection controls; report selected-but-unprotected units |
| Failed VM compilation | `transform.ts` catches target compilation errors and keeps native source in both normal and shielded paths | Accepted input is not evidence of protected coverage; distinguish a compatibility pass from a protection pass |
| Product surfaces/options | `src/index.ts`, `cli.ts`, `browser-entry.ts`, `browser-worker.ts`, `types.ts`, `presets.ts` | Pin file/directory behavior, CLI/worker messages, target environments, presets and option migration before changing defaults |

The baseline includes globals such as Proxy and Reflect in test contexts, but their mere availability is not evidence that adversarial trap ordering is exhaustively tested. Add focused cross-boundary cases where the existing corpus is shallow. Use original native JavaScript as the semantics oracle and current VM as a compatibility/protection baseline. Do not preserve an acknowledged VM miscompile as the language specification.

### Candidate G1: statically specialize the existing compiler into native control flow

Reuse the front end's selected-unit inventory, binding/capture analysis, exception tables and unencoded instruction units. At build time, specialize each known instruction into native operations and compute a per-unit control-flow graph. Propagate known constants and stack positions only when proved, materialize shared captures as stable cells, and emit direct blocks and native host operations. Where irreducible control needs a trampoline, its labels select source-specific continuations rather than decoding an instruction stream. There is no generic opcode table, instruction decoder, runtime source compiler, encrypted bytecode, or second implementation in the distributable.

This is a concrete route to removing the general VM without first rediscovering all its front-end knowledge. Its semantics risk remains substantial: the handler implementations contain stubs and special cases, so blindly specializing them can reproduce bugs. Handle asynchronous suspension using native async boundaries or an independently verified resumption protocol; do not approximate `await` with arbitrary `.then` insertion. Preserve original native calls, property access and coercions as effectful operations. Preserve generator bodies natively until a correct native generator lowering exists; that compatibility path receives no added protection credit by itself.

A separate whole-component analysis can replace qualified regions of this general graph with A1 plans. Unqualified functions still require a measured general protection mechanism. G1 alone is likely easy to normalize because it performs much of an attacker's devirtualization work for them. Its cheapest falsifier is straightforward CFG recovery, stack-to-variable promotion and effect-preserving re-emission. Benchmark it before claiming that losing the VM improves protection.

### Candidate G2: new effect/control IR with native semantic boundaries

Build a general IR that distinguishes pure primitive operations from property access, coercion, calls, allocation, environment reads/writes, abrupt completion and suspension. Carry ordered effect dependencies and explicit completion records. Emit classes, object operations and host interactions using native JavaScript semantics where feasible. This avoids reimplementing the entire JavaScript object model and allows algorithm replacement only inside proven pure/owned components.

Retain stable environment identity across callbacks, references and suspension. Distinguish per-iteration lexical environments, default-parameter environments, strict/sloppy behavior, method home objects and `super`. Do not introduce asynchronous turns, assimilate thenables twice, reorder observable getters or replace direct eval with indirect eval. Open-world calls can mutate any reachable state; unknown effects block movement, not whole-program compatibility. Module scheduling and live bindings remain native under the existing input contract.

Native continuation restructuring, selective closure conversion and independently verified expression synthesis can obscure nonrelational computations, but are candidate mechanisms, not proof of strong protection. The cheapest attacks are defunctionalization reversal, completion-state simplification, source-equivalent reconstruction from native operations and AI-assisted domain recognition. If those recover the non-A1 portion at comparable cost, the combined proposal has failed the user's full-scope protection objective even when A1 performs well.

G2 has the cleanest long-term semantic boundary and the largest implementation cost. JavaScript core calculi and mechanized specifications illustrate the necessary distinction between language semantics, lowering correctness and test evidence; their historical language coverage cannot be treated as a ready implementation of modern JavaScript. [The Essence of JavaScript](https://www.khoury.northeastern.edu/home/arjunguha/main/papers/guha-js.html), [JSCert/JSRef](https://www.doc.ic.ac.uk/~pg/publications/Bodin2014Trusted.html)

### Candidate G3: retain a redesigned VM in a combined protector

A new VM with stronger verified handler synthesis can cover existing general units while A1 handles suitable components. This offers an incremental compatibility route, but it violates the selected A1 artifact condition if that condition is interpreted as forbidding any generic interpreter in the final combined package. More VM variation is also vulnerable to semantic handler recovery. It must therefore be presented as a different revised architecture, tested against AI-assisted lifting and program synthesis, rather than silently called implementation of the selected no-interpreter design. The old VM may remain a development oracle; silently emitting it as a production fallback cannot count as replacement.

### Recommended development order under the full-scope requirement

1. Freeze actual supported semantics and protected scope from the entire existing corpus, including current native-skip behavior and known stubs. Add missing semantic regressions before pinning a promotion decision.
2. Run A1 admission/ticket attacks in parallel with a bounded G1 direct-lowering experiment and its matching clean-CFG attacker. G1 needs compatibility evidence even if its protection result is negative.
3. Prefer G2 only if pilot evidence identifies an exact general mechanism worth its cost. Do not build a complete general semantic compiler merely because the narrower A1 pilot failed.
4. Evaluate the combined final application bytes across the full original scope. Publish transformation coverage and cheapest attacks separately for A1 and general logic, then take the weakest relevant route for the user-facing protection claim.
5. Replace defaults only after general compatibility, general protection, A1 correctness where used, legitimate costs and artifact qualification all pass. A successful narrow subsystem cannot waive failure elsewhere.

## Exact compiler architecture after a surviving pilot

### 1. Frozen component inventory

Begin with three existing components chosen before alternative implementations or attacks. Keep original file hashes, provenance, module dependencies, exported factory and methods, initialization paths, reset/import/export, all events, all observations, error paths, aliasing and identity observations. Record rejected components and inapplicable families alongside admitted ones. A handwritten substitute, clipped helper, synthetic fixture, or altered API is not the original root.

Source snapshots are build inputs. A caller declaration such as `maxRecords: 1000` or `allInputsAreIntegers: true` is a request, not evidence. Every asserted semantic bound must point to an authored guard or a proved invariant over every reachable transition. An engineering compiler cap can stop compilation, but cannot turn an unbounded source into a bounded program.

### 2. Source-qualified transition model

Represent each complete evaluator as initialization `I`, transition `T`, observation `O`, and reset/error transitions. Use a small typed relation language with:

- primitive domains and exact equality/coercion operations;
- bags versus sets, keys versus record identity, multiplicity and insertion order;
- ordered effect and exception boundaries, including state committed before a throw;
- explicit retained base data and all public projections;
- provenance for every numeric, cardinality, ownership and purity fact.

This is a domain IR, not an assertion that arbitrary JavaScript has become a pure relation. A general function callback, unknown import, getter/proxy access, escaping mutable record, dynamic code capability, host clock, random source, asynchronous suspension or reentrant transaction needs an exact supported model or rejection. Merely scanning for forbidden identifier spellings is insufficient capability analysis.

Prefer source interfaces already using primitive arguments and owned immutable records for the first pilot. A `typeof` guard can establish a primitive. A TypeScript annotation cannot. Reading a property can invoke a getter or proxy; introducing descriptor checks may itself add effects. Copying input properties once changes behavior if the source reads them repeatedly. Do not invent those changes as validation. Preserve any admitted native coercion at the same boundary and prove that reentrancy cannot expose prematurely updated derived state.

### 3. Exact arithmetic and collection semantics

Algorithm changes routinely reorder work. General IEEE-754 addition is not associative, and deleting from an incrementally maintained rounded sum need not recover a scan's result. Choose a Number-forcing modular domain already authored in the source, or prove every intermediate integer remains exactly representable. Prove bounds for products, join multiplicities and temporary deltas as well as final outputs. Preserve `-0`, NaN, infinities, BigInt behavior and error order wherever the original API admits them. An operator such as unary `~` alone does not prove Number rather than BigInt.

Maintain explicit bag multiplicity; deletion must match the source's first/last/all-record policy and missing-key behavior. `Map` equality, object-property key coercion and array index order are different semantics. Floating aggregates, ordered selection and duplicate joins must not silently become commutative mathematical bags.

### 4. Alternative planning and necessary shared state

For each admitted relation, enumerate only genuinely applicable plans:

1. Specialized decision/dataflow evaluation that shares predicates and output dependencies.
2. Indexed relational evaluation with necessary key partitions and join indexes.
3. Incremental maintenance of shared views with jointly derived initialization, insertion, deletion, amendment and output projections.

Changes of seed, helper inlining, renaming, local arithmetic identities and randomly encoded counters are not separate algorithm families. A pilot may have fewer applicable plans; the broader design's three-family requirement then remains unmet.

Make view selection dependency-driven. Every retained derived field must support a public output or a future required update. Remove a base representation only after proving that no future observation or update requires it. Delete-by-key, exporting original records, stable identities and retry ordering often require retaining original information. Retention belongs in the owner report and attacker inventory.

Bound candidate count, total explored nodes, total estimated view entries and compilation work across failed plans. A per-plan cap alone permits unbounded total search. Public seeds may select among validated plans but cannot affect correctness or count as secrets.

### 5. Independent refinement checks

For each emitted plan, define a relation `R(sourceState, generatedState)`. Check:

- initial states and all reset variants satisfy `R`;
- every admitted event produces matching return/throw/effect outcomes and related successor states;
- every observation matches, including order and identity where admitted;
- exceptional and invalid-input histories preserve the original future behavior;
- every generated state domain and resource invariant is closed under transitions.

Hand checks of small first realizations and a separate evaluator are useful, but randomized histories alone are not a universal proof. Exact bounded models can use exhaustive state exploration where feasible. Larger models need sound local proof rules with independently checked obligations, plus adversarial differential histories. Report each evidence kind separately and never relabel test counts as proof strength.

### 6. Direct code generation and final-byte qualification

Emit one native JavaScript realization with native effect boundaries. Do not ship a relation interpreter, bytecode dispatcher, source model, original source, reference evaluator, debug invariant oracle or reconstruction report. Do not retain an easy scan implementation as a runtime fallback. This prevents an avoidable duplicate implementation; the surviving emitted semantics still remain available to an attacker.

Reparse and validate the exact distributable package, then execute that package through its real API in the qualification harness. Bind compiler version, source inventory, contract version, chosen plan, seeds, final hashes, test protocol and resource measurements in owner evidence. Reports and source models are owner-side files, separate from publication. A digest identifies checked bytes; it is not an anti-tamper trust boundary on an attacker-controlled host.

## A stronger qualification protocol

Use persistent instances with full event histories. Compare cold creation, resets, empty states, duplicate inserts, missing and repeated deletes, amendments, maximum cardinality, arithmetic boundaries, errors followed by valid events, and observations at every legal point. Where identity is part of the contract, compare relationships across outputs rather than serializing to JSON. Include differential errors and external effect traces. Run candidate programs in disposable processes with wall time and memory limits; `node:vm` is not a hostile-code security boundary.

Freeze genuine partial edit tickets before plan selection. Give ordinary and transformed artifacts identical public schemas, tickets, execution access and resource budgets. Score the unchanged behavior hidden from the ticket as well as the requested change. Use fully specified replacement tickets and easy threshold edits as negative controls. Allow added state, full replacement, event omission/injection, reset, replay, output patches, extra indexes and symbolic or model-assisted analysis.

The first attacker is the cheapest ticket-driven shadow evaluator. Next, normalize the generated transitions into a clean standalone state machine. This counts as functional recovery even if it retains every materialized view and never recovers original names. Then test partial-rule reconstruction, incremental-view recognition, algebraic simplification, dynamic slicing, chosen histories and AI-plus-compiler rewriting. Beautification, unchanged reuse, executable recovery, valid explanation and correct edits are separate outcomes.

An explanation must state checkable invariants and predict unseen consequences. A confident prose description is not a passing result. AI-generated edits must run against held-out histories. Report model identity/version, prompts, tokens and tool actions; do not report zero model use merely because a scripted attack was tested instead. Unknown analyst effort stays unknown. Charge reusable extractor development separately and amortize it across held-out components.

Use the cheapest successful attack for each objective. Compare to ordinary optimized code and functional historical baselines on the same protected scope. Report clone success independently, even if explanation or edit costs increase. Normalize for larger artifacts and slower execution. Require measured improvement in both comprehension and partial edits before a larger preregistered study; an attack timing timeout alone does not establish a robust security property.

## AI resistance: what the research supports

General virtual-black-box obfuscation is impossible for all program families. That result does not show that every restricted transformation is useless or that every particular program is immediately recoverable. It does rule out using a general “nothing beyond black-box behavior can be learned” guarantee as Ruam's acceptance criterion. [Barak et al., original paper and author summary](https://www.boazbarak.org/papers/obfuscate)

Indistinguishability obfuscation has constructions under explicit cryptographic assumptions. Its guarantee concerns indistinguishability of equivalent same-size circuits, not automatic concealment of a program's observable behavior. This is not evidence that a deployable ordinary-JavaScript compiler for Ruam's full semantics and resource envelope exists. Treat such deployment feasibility as unestablished, not as disproved by the virtual-black-box result. [Jain, Lin and Sahai](https://arxiv.org/abs/2008.09317)

CASCADE combines model recognition with deterministic IR transformations. Its reported target is primarily Obfuscator.IO string/API obfuscation, so it does not by itself defeat A1. It does make model-plus-normalization a necessary attack lane and weakens any argument based on unfamiliar names or removing fixed pattern matches. [CASCADE, author-hosted paper](https://shanjiang98.github.io/assets/pdf/papers/cascade.pdf)

Syntia learns small semantic windows from input/output behavior, including arithmetic VM handlers. Its evaluated success is scoped to those tasks; it is not a universal deobfuscator. The relevant inference for Ruam is to test semantic learning and fresh implementation even when symbolic analysis of the original realization is difficult. [Syntia, USENIX Security 2017](https://www.usenix.org/conference/usenixsecurity17/technical-sessions/presentation/blazytko)

Loki demonstrates that formally verified diverse expressions and combined defenses can outperform fixed recipes against evaluated automated attacks. It is a native VM-handler research prototype, and its results do not transfer into an AI-proof JavaScript claim. Its published attack tooling is valuable as an evaluation design reference; its existence also argues against testing only one attack family. [Loki paper](https://www.usenix.org/conference/usenixsecurity22/presentation/schloegel), [authors' implementation](https://github.com/RUB-SysSec/loki)

White-box key hiding is not a substitute for the missing trust boundary. Differential computation analysis extracted keys from evaluated white-box implementations without reconstructing their private designs. This does not prove every conceivable white-box construction insecure, but it rules out treating code-local encryption as an inaccessible runtime secret. [Bos et al., CHES 2016](https://research.tue.nl/en/publications/differential-computation-analysis-hiding-your-white-box-designs-i-2/)

## Concrete alternatives and improvements to test

| Candidate | Concrete improvement | Cheapest falsifier | Disposition |
| --- | --- | --- | --- |
| Exact incremental relational realization | Replace repeated scans/joins with necessary jointly derived views and deltas across the complete API | Ticket-driven event-log sidecar; clean transition extractor; recognize query from view maintenance equations | Main conditional A1 candidate |
| Multi-output decision/dataflow resynthesis | Jointly optimize coupled predicates and outputs; eliminate original helper partition where a real evaluator admits it | Extract/reduce the decision graph or synthesize rules from chosen inputs | Alternative plan inside A1, not automatically an independent defense |
| Finite-domain table/trie/automaton specialization | Compile an already bounded domain into an exact specialized algorithm | Extract the table/automaton and minimize it | Legitimate optimization; reject protection claim if extraction is cheap |
| Synthesis-aware plan selection | Choose exact plans using a portfolio of measured attacks, then evaluate unseen roots/attacks | A held-out normalizer or one reusable inverse pass defeats all selected plans | Useful research machinery after a surviving pilot; avoid training on the evaluation set |
| Verified expression diversification around necessary computations | Explore exact large semantic expressions rather than a small public rewrite dictionary | Synthesis, MBA simplification, slicing or compiler normalization restores a cheap equivalent | Small separate ablation only; not algorithm replacement by itself |
| Local encryption, more decoys, seed churn, AI-directed comments | Change representation or presentation without a new inaccessible trust boundary | Execute/instrument decoder, strip irrelevant work, ignore comments | No new protection argument; do not prioritize |

DBToaster gives a concrete source of higher-order delta and shared-view techniques. DBSP supplies a compositional model for deriving incremental computations. These are foundations for correctness and performance; neither paper claims resistance to reverse engineering. Their algebra must be instantiated with exact admitted JavaScript domains rather than silently treating Number arithmetic as an arbitrary mathematical ring. [DBToaster](https://arxiv.org/abs/1207.0137), [DBSP](https://www.vldb.org/pvldb/vol16/p1601-budiu.pdf)

No additional offline candidate in this review justifies an absolute AI-prevention promise. If no candidate survives the cheapest attacks, the correct output is the failed experiment and a narrower supported compiler objective. Server execution or trusted hardware can change the disclosure boundary, but they violate this design's offline ordinary-JavaScript constraint and are not silently introduced as a replacement.

## Migration gates

| Gate | Required evidence | Failure behavior |
| --- | --- | --- |
| Root inventory | Three unmodified real roots and frozen tasks, with provenance and complete APIs | No synthetic substitution or clipped API |
| Source admission | Ownership, effects, domains and bounds proved from source | Refuse that root before emitting an artifact |
| Ticket audit | Unspecified original behavior is actually required for the partial edit | Cheap fully specified replacement is a negative control |
| First attack | Sidecar/reset/replay fails to solve the intended ticket at comparable cost | Stop the corresponding protection claim |
| Correctness | Independent refinement obligations and full-history differential results on final bytes | No artifact promotion |
| Resource envelope | Preregistered total build, cold-start, event, byte and memory limits pass | Refuse the candidate; no silently relaxed limits |
| Protection | Cheapest successful attacks show improvement in both comprehension and edits on held-out roots; clone results disclosed | No strength or AI-resistance claim |
| API migration | Existing VM entry points, CLI/worker protocols, file behavior and supported semantics are covered or explicitly migrated | Keep the default VM; do not route unsupported source through an uncredited easy fallback |
| Release | Evidence bound to the exact release artifact and independent review complete | Keep `releaseApproved: false` |

The current `obfuscateCode(source, options): string` API and VM option semantics cannot truthfully become this narrow compiler by changing one default. An explicit experimental entry point may report admission and evidence; promoting it to the replacement requires the gates above. A general native JavaScript generator that transforms a small admitted portion is a useful compiler product, but it is not whole-program algorithm/state protection and must report the residual scope.

The completed state for a VM replacement is therefore an evidence-backed release decision, not the presence of a new directory or a larger generated artifact. When the selected design's early gates fail, completing the authorized investigation means publishing a reproducible rejection and continuing bounded candidate research, without misrepresenting an unqualified backend as ready to supersede the VM.
