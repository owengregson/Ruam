# Project Kaleidoscope D2 — Dynamic-Instrumentation Ideation Results

**Date:** 2026-07-24  
**Status:** Architecture decision candidate; security-sensitive Isogloss work paused pending review  
**Parent:** [Traveling Isogloss implementation plan](2026-07-24-traveling-isogloss-implementation-plan.md)  
**Attacker:** Full artifact and runtime access, chosen inputs, stepping, hooks, heap/closure snapshots, patching, repeated runs, and design knowledge

## 1. Executive decision

The original Traveling Isogloss design does not materially resist a full-access
dynamic analyst because it eventually publishes this event:

```text
left clause + right clause + carrier witness
    -> one SemanticOp + one operand projection
    -> one semantic handler
```

That is a stable semantic choke point. An analyst can instrument the resolver or
handler edge and recover a reusable, ordered semantic trace. Ambiguity before
resolution does not protect the answer after the runtime repeatedly exposes it.

The recommended redesign is **Braided Poly-Ontology Region Fabric (BPRF)**:

1. Partition canonical IR at source-observable JavaScript effects.
2. Fuse multiple pure data/control operations into regional transitions.
3. Split direct calls across caller-owned entry and return continuations.
4. Generate several genuinely different regional realization families.
5. Change internal frame layouts and wire bases at regional boundaries.
6. Emit unavoidable JavaScript effects at distributed, site-specific sinks.
7. Let the carrier route region/continuation contracts, never language
   operations.

`SemanticOp` remains compiler-side vocabulary and a reference-oracle tool. It
must not exist as a production runtime event, value, table key, or handler
identity.

The security-sensitive lattice schema, artifact schema, resolver, verifier,
handler runtime, and carrier witness design remain paused. Deterministic entropy,
canonical semantic IR, source origins, CFG/effect analysis, baselines, and test
infrastructure remain valid and may continue.

## 2. Honest impossibility boundary

No server-free JavaScript artifact can hide its extensional behavior from this
attacker:

- Inputs, returns, thrown values, and host-visible effects are observable.
- The client must possess enough information to produce each concrete result.
- Client-generated or client-consumed randomness is observable diversity, not
  a secret.
- A finite implementation family can eventually be covered and normalized.
- A finite input domain can be queried exhaustively; an infinite-domain artifact
  remains a behavioral oracle.
- The attacker can redistribute or invoke the protected artifact unchanged even
  if recovering source-like code remains costly.
- Work imposed on exhaustive tracing is paid at least partly by legitimate users.

The defensible goal is therefore:

> Remove cheap semantic choke points and make recovery of a reusable,
> source-like function model require whole-region, multi-context,
> multi-realization reconstruction.

Claims of confidentiality, anti-hooking, cryptographic secrecy, or prevention of
eventual recovery would be false without a different trust domain such as a
server-held secret, trusted hardware, attestation, or query limitation.

This boundary is consistent with foundational limits on general virtual
black-box obfuscation and with practical dynamic deobfuscation results. Syntia,
for example, reports learning more than 94% of arithmetic handlers in two
virtualization obfuscators, while later work such as Loki explicitly targets
trace slicing, symbolic extraction, and synthesis. See:

- [The impossibility of obfuscation with auxiliary input or a universal simulator](https://arxiv.org/abs/1401.0348)
- [Syntia: Synthesizing the Semantics of Obfuscated Code](https://www.usenix.org/conference/usenixsecurity17/technical-sessions/presentation/blazytko)
- [Loki: Hardening Code Obfuscation](https://www.usenix.org/system/files/sec22-schloegel.pdf)
- [Defeating State-of-the-Art White-Box Countermeasures with Advanced Gray-Box Attacks](https://eprint.iacr.org/2020/413)

## 3. Uniqueness protocol

The campaign reused Project Kaleidoscope's novelty discipline:

1. A candidate needed one primary mechanism not shared by another candidate.
2. Opcode churn, encryption, anti-hooking, dead code, and other known Ruam/VM
   mechanisms were forbidden as primary ideas.
3. Feasibility annotated ideas but did not delete unusual ideas.
4. Near-duplicates were clustered and rejected explicitly.
5. The final recommendation had to be a fusion whose dynamic reconstruction
   problem was not reducible to any one parent.

`Recognizability` ranges from 0 to 1; lower is more structurally novel. Values at
or above 0.75 are iterations rather than invention and cannot become Rank 1
without a genuinely new fusion.

The engineering score uses 1–5 values and this weighting:

```text
30% dynamic extraction cost
20% cross-input amortization resistance
15% trace non-transferability
10% patch resistance without detection
15% correctness feasibility
10% runtime/build/size efficiency
```

Scores are hypotheses for falsification, not security ratings.

## 4. Ranked slate

| Rank | Direction | Primary mechanism | Recognizability | Engineering score |
|---:|---|---|---:|---:|
| 1 | Multi-ontology regional realizations | Change the causal execution model | 0.46 | 4.15 |
| 2 | Region-fused contextual linearization | Destroy operation/function granularity | 0.57 | 4.05 |
| 3 | Encoded state and wire-basis drift | Change value identity and representation | 0.71 | 3.95 |
| 4 | Distributed effect sinks | Disperse unavoidable semantic choke points | 0.60 | 3.65 |
| 5 | Program-wide root fusion | Enlarge the minimum reconstruction scope | 0.65 | 3.60 |
| 6 | Cross-invocation braiding | Make traces history/context dependent | 0.54 | 3.55 |
| 7 | Solver/constraint execution | Replace imperative steps with relations | 0.63 | 3.55 |
| 8 | All-path effect predication | Remove taken-path control traces | 0.68 | 3.50 |
| 9 | Distributed continuation mesh | Decentralize execution transport | 0.72 | 3.45 |
| 10 | Input-conditioned transient specialization | Change topology per invocation | 0.67 | 3.30 |
| 11 | Counterfactual worlds | Dilute attribution across valid states | 0.56 | 3.25 |
| 12 | Transactional shadow heap | Defer stateful host observability | 0.70 | 3.05 |
| 13 | Multi-input cohort coding | Couple one query to neighboring behaviors | 0.49 | 2.95 |
| 14 | Reversible compute/uncompute | Remove durable intermediate residue | 0.79 | 2.15 |

## 5. Candidate details

### 5.1 Multi-ontology regional realizations

**Mechanism.** Lower one effect-delimited region into structurally different
execution ontologies, such as predicated dataflow, continuation residuals,
decision diagrams, or algebraic transitions. Renaming, block reordering, and
encoding changes do not count.

**Dynamic value.** A lifter trained on one realization cannot assume the same
node, value, or control vocabulary in another.

**Observable choke point.** Region contracts and host-effect sites.

**Risks and cost.** Exact equivalence across coercion, throwing, allocation,
property access, and evaluation order is difficult. Begin with proven pure
regions. Build complexity and artifact size are high.

**Falsification.** Train graph alignment across families. Reject a family if a
small normalizer maps it to canonical IR after only a few examples.

### 5.2 Region-fused contextual linearization

**Mechanism.** Fuse several data/control operations into one regional
transition. Split direct callees into caller-specific entry fragments and
return continuations so no internal generated function contains a complete
logical source function.

**Dynamic value.** One hook observes a regional/contextual transition rather
than one language operation or complete callee.

**Observable choke point.** Public/indirect entries and regional effects.

**Risks and cost.** Calls, recursion, exceptions, reentrancy, async, `this`, and
exact effect ordering require a continuation verifier. Code size is high, while
runtime can improve relative to interpretation.

**Falsification.** Instrument every codelet. Reject if a stable closed subgraph
contains a complete callee or one trace maps linearly to source operations.

### 5.3 Encoded state and wire-basis drift

**Mechanism.** Represent eligible locals, predicates, and pure results across
shares or encoded wires. Rebase and permute the representation at every
region/continuation transition.

**Dynamic value.** Def-use recovery must correlate several locations across
changing bases rather than follow one stable virtual register.

**Observable choke point.** Entry encoding and materialization at effects,
throws, or return.

**Risks and cost.** This is diversity, not secrecy. Objects, identity, symbols,
proxies, closures, and coercive operations generally cannot stay encoded.
Arithmetic/memory overhead is high, and higher-order analysis can defeat masks.

**Falsification.** Reject if one fixed recombination or slot permutation
recovers most logical intermediates across histories.

### 5.4 Distributed effect sinks

**Mechanism.** Emit property operations, calls, construction, throws,
coercions, and suspension at contextual site-specific sinks rather than one
effect broker or language handler catalog.

**Dynamic value.** One helper hook no longer yields the whole effect stream.

**Observable choke point.** The host operations themselves; they are
unavoidably observable.

**Risks and cost.** Exact getter, proxy, coercion, exception, and evaluation
order must be preserved at every generated site. Size grows; runtime cost can
remain low.

**Falsification.** Reject if a shared packet format, decoder, helper, or
capability table reconstructs all effect identities.

### 5.5 Program-wide root fusion

**Mechanism.** Fuse several selected roots into one protected component so a
target function is not an independently extractable unit.

**Dynamic value.** Recovery starts from a broader program-level graph.

**Observable choke point.** Exports and target-specific output/effect slices.

**Risks and cost.** Unrelated APIs become coupled; tree-shaking, reentrancy,
load time, and failure isolation worsen.

**Falsification.** Slice backward from one export. If the target separates
cleanly and unrelated roots contribute no necessary dependency, fusion was
only concatenation.

### 5.6 Cross-invocation braiding

**Mechanism.** Make representation bases, variant contracts, residuals, and
continuation roles depend on persistent root-group history. Overlapping async
work may interleave live fragments; completed synchronous semantics may not be
deferred.

**Dynamic value.** The same input produces traces that align poorly under
different warm, recursive, reentrant, or async histories.

**Observable choke point.** Per-call I/O and persistent carrier state.

**Risks and cost.** Fresh-process analysis resets history. Reentrancy,
reproducibility, and async order are difficult.

**Falsification.** Reject if fresh-process analysis remains easy or one captured
carrier transform aligns every history.

### 5.7 Solver/constraint execution

**Mechanism.** Lower pure regions to exact relations and use a generic
solver/eliminator to derive the next frame.

**Dynamic value.** Solver iterations do not directly correspond to source
operations.

**Observable choke point.** Constraint-instance construction and output
variables.

**Risks and cost.** General JavaScript relations are unwieldy. Effects, dynamic
types, loops, and exceptions make this practical only for narrow islands.

**Falsification.** Dump the constraint instance into commodity simplifiers.
Reject if they recover operation families or CFGs more cheaply than fused code.

### 5.8 All-path effect predication

**Mechanism.** Linearize candidate pure paths together, produce predicated
effect tokens, and commit only the selected effects in exact source order.

**Dynamic value.** Execution no longer directly identifies the taken source
edge inside the region. Constantine demonstrates that aggressive control/data
flow linearization can be practical for selected native workloads, although
Ruam's dynamic JavaScript problem is materially harder:
[Constantine](https://arxiv.org/abs/2104.10749).

**Observable choke point.** Effect commitment and output projection.

**Risks and cost.** Getters, proxies, calls, throwing, allocation,
nontermination, and path explosion make broad predication unsafe.

**Falsification.** Reject if dynamic taint cheaply identifies one winning lane
or if extra paths are removable dead work.

### 5.9 Distributed continuation mesh

**Mechanism.** Route work among small transducers and continuation contracts,
without one interpreter loop.

**Dynamic value.** No single function edge reports the semantic sequence.

**Observable choke point.** Message/continuation movement.

**Risks and cost.** A shared queue is likely to become a new dispatcher.
Ordering and memory traffic are expensive.

**Falsification.** Instrument enqueue/dequeue. Reject if one hook reconstructs
the ordered computation.

### 5.10 Input-conditioned transient specialization

**Mechanism.** Compose a per-invocation data schedule from precompiled
templates using input shape and carrier history. No source generation, `eval`,
or CSP violation is permitted.

**Dynamic value.** One captured realization transfers poorly to other input
shapes or histories.

**Observable choke point.** The specialization builder and schedule.

**Risks and cost.** The schedule may merely publish canonical IR in another
form. Entry latency and payload size rise.

**Falsification.** Hook schedule construction. Reject if normalization produces
a stable operation/node sequence.

### 5.11 Counterfactual worlds

**Mechanism.** Carry several valid candidate states and derive the next encoded
frame relationally across them, delaying attribution.

**Dynamic value.** Hooks see several plausible histories.

**Observable choke point.** Late commitment and external effects.

**Risks and cost.** The real input often identifies the real world through
taint. Effectful or nonterminating worlds cannot execute normally. Runtime and
memory multiply by world count.

**Falsification.** Perturb inputs and correlate lanes to output/effects. Reject
if the actual lane becomes obvious after a small number of runs.

### 5.12 Transactional shadow heap

**Mechanism.** Execute protected state changes in a virtual graph or journal and
commit externally visible deltas only at barriers.

**Dynamic value.** Ordinary host hooks see fewer intermediate state operations.

**Observable choke point.** Commit and any proxy/host callback.

**Risks and cost.** Identity, prototypes, accessors, proxies, `WeakMap`,
symbols, reflection, and host objects make exact virtualization exceptionally
hard.

**Falsification.** Use a proxy/reflection-heavy differential suite. Reject on
any semantic mismatch or if commits encode one packet per source operation.

### 5.13 Multi-input cohort coding

**Mechanism.** Evaluate a requested pure input alongside derived neighbors and
project the requested coordinate only at return.

**Dynamic value.** One trace contains several behaviors, complicating
attribution.

**Observable choke point.** Cohort construction and output projection.

**Risks and cost.** The attacker sees all inputs, and effects invalidate extra
evaluations. Runtime multiplies by cohort size.

**Falsification.** Hook the projector or freeze neighboring lanes. Reject if
the actual lane is directly labeled.

### 5.14 Reversible compute/uncompute

**Mechanism.** Evaluate pure regions reversibly, project the required result,
then uncompute intermediate state.

**Dynamic value.** Post-call snapshots retain less residue.

**Observable choke point.** The complete forward trace.

**Risks and cost.** A full tracer records the forward computation; effects are
irreversible; runtime approximately doubles. This is not novel enough to become
a primary architecture.

**Falsification.** Record only the forward half. Reject if it is as recoverable
as ordinary execution.

## 6. Rejected near-duplicates and theater

The following do not qualify as distinct directions:

- Dynamic opcode maps, handler shuffles, witness rekeying, and alias churn are
  one mapping-churn family. They fail when runtime returns a handler or opcode.
- Splitting a resolver or fragmenting generic handlers leaves the
  dispatch-to-handler edge intact.
- Payload/value encryption with a client-side key creates a hookable
  decode/materialization seam.
- Random block or schedule permutation without a new topology or causal model
  is normalization work.
- Runtime source generation, `eval`, and self-modifying code are capturable and
  break the CSP rail.
- Dead operations, fake messages, opaque predicates, and trace flooding are
  removable unless their outputs are semantically necessary.
- Fake counterfactual lanes are dead-code injection.
- Program-wide concatenation is not fusion unless results require shared
  fragments.
- Variants that differ only in names, order, or encodings are not multiple
  ontologies.
- Anti-debugging, timing, environment, integrity, and self-checks are
  patchable detection mechanisms.
- Hash chains and memory-hard carrier updates impose comparable work on users
  while leaving semantics visible.
- Moving the same model into Wasm or native code changes tools, not the attacker
  model.
- A generic universal handler catalog with extra metadata recreates the exact
  choke point being removed.

## 7. Best fusions

### H1. Braided Poly-Ontology Region Fabric — Rank 1

Region-fused contextual linearization + caller/continuation fission +
interprocedural braiding + multiple structural ontologies + wire-basis drift
inside eligible pure regions + distributed effect sinks.

This fusion removes both stable instruction boundaries and stable internal
function bodies while retaining a credible path to exact JavaScript effects.

### H2. Oblivious Relational Region Fabric

Wire-basis drift + all-path predication + counterfactual worlds + constraint
fragments. It offers stronger pure-code trace dilution but unacceptable
general-JavaScript correctness and performance risk.

### H3. Transactional Constraint Isogloss

Solver execution + shadow heap + distributed effect commits. It is credible
for a narrow data-processing language, not Ruam's declared JavaScript surface.

### H4. Transient Continuation Mesh

Input-conditioned specialization + contextual frame layouts + continuation
routing + poly-ontology templates. Its main risk is recreating a hookable
schedule-description seam.

### H5. Program-Braided Cohort Isogloss

Program-wide fusion + cross-invocation state + cohort/counterfactual coding.
Coupling and overhead make this a research profile, not the base engine.

## 8. Rank 1 architecture: BPRF

### 8.1 Pipeline

```text
canonical semantic IR
  -> exact effect/purity/throw/coercion annotation
  -> effect-delimited region graph
  -> caller-context continuation expansion
  -> K poly-ontology regional realizations
  -> interprocedural fission and braiding
  -> wire-basis and virtual-frame assignment
  -> Isogloss fragment lattice
  -> generated region fabric and distributed effect sinks
```

### 8.2 New non-negotiable invariants

| ID | Invariant |
|---|---|
| DR-01 | Production execution never materializes `SemanticOp`, handler identity, canonical operand projection, or source-node identity. |
| DR-02 | No production table, function result, metadata record, or packet maps a boundary/fragment to a language operation. |
| DR-03 | One carrier transition advances a regional fragment composition, never one canonical operation. |
| DR-04 | Except for explicit public/indirect/reflection boundaries, a logical function is split across at least two continuation-owned regions. |
| DR-05 | Eligible direct-call SCCs include at least one caller-fused or cross-function fragment; no closed generated body owns the whole internal function. |
| DR-06 | Hardened mode provides at least three reachable contextual realizations per eligible region and at least two verified structural ontologies. |
| DR-07 | Renaming, block permutation, layout-only changes, and encoding-only changes do not satisfy the poly-ontology requirement. |
| DR-08 | A source local/temporary has no stable generated slot, register, wire, or closure-field identity across protected regional transitions. |
| DR-09 | Each hardened pure result depends on at least two independently located necessary fragments/shares; no single lane computes the ordinary result. |
| DR-10 | Runtime never exposes a durable winning-lane, operation-selector, or semantic-dispatch scalar. |
| DR-11 | Getter, proxy, coercion, call, construction, throw, `finally`, await, and yield order is exactly equivalent to canonical IR. |
| DR-12 | No universal production handler, effect broker, packet decoder, runtime switch, or message queue covers all language effects. |
| DR-13 | Ordinary values materialize only at certified contract/effect boundaries and are re-encoded on protected re-entry where eligible. |
| DR-14 | One root group still owns one live carrier through recursion, reentrancy, and suspension. |
| DR-15 | Exports, callbacks, indirect calls, reflection-sensitive entries, and host effects are inventoried as reduced-protection boundaries. |

### 8.3 Lattice and carrier changes

Replace handler candidate masks and operand projections with fragments for:

- regional transitions;
- continuation routes;
- contextual frame maps;
- wire-basis/share refresh;
- effect gates and commit order;
- realization-family constraints;
- entry and return continuation contracts.

Local ambiguity remains useful, but it is no longer the primary security claim.
The active neighborhood contributes pieces of a contextual regional transition;
it never resolves a canonical semantic event.

The carrier tracks:

- continuation contract;
- regional fragment neighborhood;
- phase and lineage;
- realization/ontology epoch;
- virtual-frame layout basis;
- share-refresh/basis state;
- call, exception, and suspension continuations.

It does not store or derive a semantic opcode, handler index, canonical operand,
or instruction pointer.

### 8.4 Runtime changes

Delete these production concepts:

- semantic handler catalog;
- `resolve(): { handler, operand }`;
- opcode dispatch;
- generic language-effect executor;
- instruction interpreter loop.

Production uses generated contextual region/effect codelets plus narrowly
generic fragment-combination kernels. Pure codelets contain fused regional
work, not one language operation. Effect sinks are site-specific. Generic
language handlers may exist temporarily only as migration/reference semantics
and compiler-lowering specifications.

### 8.5 Verifier changes

The verifier must check:

- canonical IR to region-graph bisimulation;
- exact observable effect and exception ordering;
- equivalence and legitimate reachability of every regional realization;
- call, return, throw, await, yield, and resume contracts;
- minimum structural difference across ontology families;
- changing frame/binding ownership;
- necessity of all protected pure-result fragments/shares;
- absence of production semantic-dispatch metadata and values;
- absence of complete internal function bodies where fission is required;
- explicit inventory of all ordinary-value and host-effect boundaries.

## 9. Dynamic-attacker benchmark

The owner source-origin sidecar is used only to score recovery. The attacker
does not receive it.

### 9.1 Baseline attacker

Instrument the paused design's `resolve -> SemanticOp/operand -> handler` seam.
Record the handler, operand, boundary, frame change, and successor. This should
recover almost all executed semantic events with one or two hook families and
provides the control result BPRF must beat.

### 9.2 Metrics

| Metric | Meaning |
|---|---|
| H90 | Minimum hook sites required to label 90% of reached source nodes |
| O90 | Dynamic primitive observations required for 90% reached-node recovery |
| T90 | Input/context executions required for 90% source-node and CFG coverage |
| Op-F1 | Recovered semantic-operation classification |
| CFG recall | Recovered canonical CFG edges |
| Def-use F1 | Recovered logical producer/consumer relations |
| Cross-input transfer | Lifter accuracy on unseen inputs |
| Cross-history transfer | Accuracy under fresh, warm, recursive, reentrant, and async histories |
| Context coverage | Caller contexts needed for a reusable callee model |
| Patch-collapse size | Smallest localized patch producing a stable semantic stream while preserving correctness |
| Effect leakage | Control structure inferable only from unavoidable host effects |
| Attack amplification | Trace storage and offline CPU per recovered source event |
| Security efficiency | Attack amplification divided by legitimate runtime/size overhead |

Run two attackers:

1. an O(1)-hook attacker searching for runtime choke points; and
2. a full-step attacker instrumenting every generated expression/function and
   performing taint, graph alignment, clustering, and trace slicing.

Effect-sliced reconstruction remains a relevant control because BinSim shows
that dynamic slicing from system effects can recover fine-grained relations
across obfuscated traces:
[BinSim](https://www.usenix.org/conference/usenixsecurity17/technical-sessions/presentation/ming).

### 9.3 Initial go/no-go gates

Relative to a baseline expected to recover at least 95% of executed semantic
events:

- no hook family directly emits a semantic operation or source-site identity;
- O(1)-hook Op-F1 is below 0.50 on held-out inputs;
- cross-input or cross-context transfer loses at least 30 percentage points;
- full-step O90 rises at least 10x and offline reconstruction CPU at least 5x;
- no patch touching three or fewer localized sites creates a stable canonical
  stream while preserving the spike corpus;
- attacker amplification exceeds legitimate slowdown;
- values, errors, effects, and scheduling remain exactly differential-correct.

These are experimental kill gates, not security guarantees.

## 10. Incremental spike

1. Build the resolver/handler baseline extractor, full-step instrumenter,
   source-origin scorer, and curated dynamic corpus.
2. Add exact purity, throwing, coercion, allocation, host-effect, suspension,
   call-edge, and continuation annotations to canonical IR.
3. Support a pure regional subset: numbers, booleans, locals, branches, bounded
   loops, and direct calls.
4. Generate roughly several-node fused regions with three contextual variants
   across at least two ontologies, initially predicated dataflow and
   continuation residuals.
5. Introduce fragment cells and a carrier that routes regional contracts.
6. Prove by architecture test that production execution cannot create a
   `SemanticOp`, handler identity, or canonical operand tuple.
7. Add frame/wire-basis drift and require at least two necessary residual
   fragments for each protected pure result.
8. Add one callee reached from at least four callers, then recursion and mutual
   recursion; verify no stable complete generated callee body exists.
9. Add property read, coercion, call, throw, and `finally` through distributed
   site-specific sinks. Never speculatively execute host effects.
10. Run both attacker harnesses and delete mechanisms whose attacker
    amplification does not exceed user overhead.
11. Freeze the revised lattice, certificate, artifact, and runtime schemas only
    after the dynamic go/no-go gates pass.

## 11. Work disposition

### Paused

- handler candidate masks keyed by `SemanticOp`;
- unique handler/operand resolution;
- production handler catalog extraction;
- operand projector and interpreter interfaces;
- opcode-selecting carrier witnesses;
- certificates mapping boundaries to operations;
- artifact formats encoding those structures;
- runtime and verifier code that assumes instruction-at-a-time execution.

### Continuing

- deterministic entropy and reproducible builds;
- canonical semantic IR and source origins;
- canonical CFG, call graph, purity, effect, throw, coercion, and suspension
  analysis;
- baseline and test-migration inventories;
- native/reference semantic and effect-trace differential infrastructure;
- root-group lifecycle abstractions that do not freeze operation-witness fields;
- generic graph, bitset, hashing, serialization, and verifier utilities that do
  not assume semantic dispatch;
- generic JavaScript semantics only as compiler/reference oracles.

## 12. Decision gate

Do not resume lattice/runtime implementation by merely editing the old candidate
mask schema. First implement the dynamic attacker baseline and the pure BPRF
spike. The BPRF design becomes the replacement architecture only if it clears
the quantitative go/no-go gates with zero semantic/effect mismatches and an
attacker-amplification ratio greater than its user cost.
