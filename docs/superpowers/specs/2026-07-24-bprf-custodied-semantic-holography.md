# Project Kaleidoscope D3 — Custodied Semantic Holography

**Date:** 2026-07-24  
**Status:** Proposed BPRF evolution; implementation remains behind the dynamic-attacker spike gate  
**Parent:** [Project Kaleidoscope D2 — Dynamic-Instrumentation Ideation Results](2026-07-24-dynamic-instrumentation-ideation-results.md)  
**Goal:** Raise the minimum cost of full-access dynamic reconstruction beyond what an entirely client-resident BPRF can achieve

## 1. Outcome

The strongest evolution is **Custodied Semantic Holography (CSH)**:

1. BPRF still removes instruction dispatch, complete internal function bodies,
   stable frame layouts, and reusable single-ontology traces.
2. CSH represents protected state as overlapping partial semantic charts. No
   region, codelet, frame, or chart contains a complete logical before/after
   state.
3. The chart cover changes at regional transitions, so chart ownership and
   overlap relations do not stay aligned across calls or histories.
4. In the maximum profile, at least one necessary chart-gluing relation for
   selected high-value regions never ships to the client. A stateful custodian
   co-evaluates it using private-function evaluation or executes that narrowly
   typed relation remotely.
5. The custodian returns only a lineage-bound encoded chart contribution or
   certified effect projection—never source, a regional program, a handler,
   an operation identity, a next-codelet token, or a reusable decode key.

The combination is stronger than either parent:

- **BPRF** makes captured client execution contextual, fused, and
  multi-ontology.
- **Semantic holography** makes each captured local state incomplete and
  globally relational.
- **Custody** removes a necessary relation from the attacker's trust domain.

The recommended product name for the combined maximum profile is:

> **BPRF/CSH — Custodied Moving-Cover Isogloss**

## 2. Why BPRF alone still has a ceiling

BPRF eliminates the cheap:

```text
resolve -> SemanticOp -> handler
```

attack, but a full-step analyst can still:

1. record every client-resident regional realization;
2. capture complete regional input/output frames;
3. align a finite set of ontologies and caller contexts;
4. normalize changing wire bases after learning their transformations; and
5. eventually build a whole-client equivalent model.

Wire-basis drift changes the representation of a complete client-side state.
It does not remove the complete transition relation from the client.

CSH attacks that remaining weakness in two stages:

- the local stage removes complete region-owned state;
- the custodied stage removes client completeness itself.

## 3. Creativity and uniqueness gate

This ideation round required each candidate to change a different primary
property of BPRF:

| Candidate | Primary property changed |
|---|---|
| Moving-cover semantic holography | State is local-to-global rather than region-owned |
| Causal relation custody | A necessary transition relation leaves the client trust domain |
| Stateful query-fork control | The analyst cannot snapshot and fork one remote representation epoch |
| Universal-circuit phenotype foundry | Function topology and realization change per session |
| TEE-held chart | A hardware isolation boundary replaces the network custodian |
| Temporal convolutional state | One logical update is dispersed across an execution window |
| Cross-device semantic quorum | No single user device owns all relation shares |
| One-time regional capsules | A realization has bounded protocol reuse |

Near-duplicates were rejected:

- remote key fetch, remote opcode fetch, and downloadable missing code are all
  capturable-material delivery;
- remote integrity signatures and carrier attestations enforce execution but
  do not hide semantics;
- ordinary state secret-sharing with every share on the client is just a
  stronger wire encoding;
- topology-visible gate hiding is not accepted as private-function evaluation;
- rate limiting alone is a product policy, not a transformation;
- a TEE or server running the entire original function is a trust-domain move,
  but not a distinct Ruam execution architecture;
- self-erasing or one-time client code fails against pre-execution snapshots.

## 4. Ranked add-on slate

Scores are 1–5 and measure marginal value when added to BPRF.

| Rank | Add-on | Dynamic floor | BPRF synergy | Correctness | Efficiency | Trust change | Decision |
|---:|---|---:|---:|---:|---:|---|---|
| 1 | Moving-cover holography + causal relation custody | 5 | 5 | 3 | 2 | Remote or TEE | Adopt as CSH |
| 2 | Moving-cover semantic holography, local-only | 4 | 5 | 3 | 3 | None | Base CSH research layer |
| 3 | Stateful universal-circuit phenotype foundry | 5 | 4 | 2 | 1 | Remote | Optional custodian implementation |
| 4 | TEE-held semantic chart | 5 | 4 | 3 | 4 | Hardware | Deployment alternative |
| 5 | Temporal convolutional state | 3 | 4 | 2 | 2 | None | Spike only |
| 6 | Multi-custodian threshold relation | 5 | 3 | 2 | 1 | Multiple remotes | Infrastructure hardening |
| 7 | Cross-device semantic quorum | 4 | 3 | 1 | 1 | Other devices | Product-pivot research |
| 8 | One-time regional capsules | 3 | 3 | 3 | 2 | Remote | Reject as primary |

The local-only candidate raises analysis cost but does not change the
impossibility boundary. Rank 1 combines it with relation custody because the
request is to raise the floor as high as possible.

## 5. Source-domain mechanism

The nonlocal state model is borrowed from cellular sheaves and overlapping
coordinate charts:

- each location owns a local view;
- related views overlap but use different local coordinates;
- compatibility maps describe how overlap data agrees;
- a complete globally consistent object is a **global section**;
- no local view is the global object.

This is a structural transfer, not naming. Cellular sheaves are used to model
local computations whose globally consistent solutions are global sections:
[A Sheaf-Theoretic Characterization of Tasks in Distributed Systems](https://arxiv.org/abs/2503.02556).

CSH maps this structure into Ruam:

| Sheaf concept | CSH concept |
|---|---|
| Base complex / cover | Root-group regional continuation graph |
| Local chart / stalk | Partial encoded frame owned by a BPRF fragment neighborhood |
| Restriction map | Overlap compatibility relation between chart fragments |
| Global section | One complete canonical logical state, which production never materializes |
| Change of cover | Carrier-driven chart split, merge, transport, and reownership |
| Local projection | Site-specific value needed for one host effect or contract |
| Missing gluing map | Custodian-owned relation that never ships to the client |

The cryptographic custody mechanism is grounded in private function evaluation
(PFE), where one party evaluates a private function on another party's input
without revealing the function beyond its outputs. Actively secure,
constant-round, linear-complexity PFE constructions exist in the literature:
[Making Private Function Evaluation Safer, Faster, and Simpler](https://eprint.iacr.org/2021/1682).

This does not make arbitrary JavaScript PFE practical. CSH restricts custody to
typed, pure, effect-delimited macroregions and treats feasibility as a mandatory
spike gate.

## 6. Concrete state model

Let canonical protected state at an analysis boundary be `x`. Production never
stores `x`.

Choose a changing cover:

```text
U(t) = { U1, U2, ..., Un }
```

Each chart stores a partial encoded view:

```text
si = encode_i(project_i(x), localResidual_i, coverEpoch)
```

Related charts satisfy overlap constraints:

```text
Rij(si, sj, glue_ij, coverEpoch) = 0
```

Properties:

1. No individual `si` decodes a source variable or complete frame.
2. The configured chart threshold is required to derive any certified
   protected projection.
3. Charts overlap across several source values and several regional
   transitions; they are not one share set per variable.
4. Chart ownership crosses continuation and function boundaries.
5. After a regional transition, the carrier changes the cover by splitting,
   merging, transporting, or reassigning charts.
6. Old and new covers overlap only enough to transport the required global
   consistency class.
7. No global `decode(x)` routine exists.

A site-specific host effect receives only its required projection:

```text
effectValue =
    project_effect(
        chartContribution_a,
        chartContribution_b,
        ...,
        custodiedContribution
    )
```

The ordinary value is observable at that effect because JavaScript semantics
require it. Other logical state remains distributed.

## 7. Moving-cover execution

One protected regional transition becomes:

```text
incoming continuation contract
    -> activate a BPRF regional realization
    -> update several local charts
    -> reconcile only required overlaps
    -> transport consistency into a new cover
    -> optionally request one custodied relation contribution
    -> materialize only a certified effect/return projection
    -> continue with the new chart cover
```

Important distinctions from current BPRF:

- BPRF frame-layout drift can still be described as `x' = A x + b`.
- CSH has no production `x`; only partial charts and overlap relations exist.
- BPRF variants change how one regional transition is computed.
- CSH changes which collection of local partial states can jointly denote a
  transition at all.
- BPRF can be normalized by covering all finite realizations.
- Custodied CSH remains incomplete after full client realization coverage.

## 8. Custodied relation protocol

### 8.1 What remains remote

For each selected crown-jewel macroregion, the custodian owns at least one of:

- a nonlinear chart-gluing relation;
- a hidden universal-circuit programming string;
- a regional transition residual;
- an output/effect projection relation;
- state needed to transport one cover epoch into the next.

The complete regional transition cannot be evaluated from client artifacts and
client state alone.

### 8.2 What crosses the boundary

The client sends:

- opaque session and contract identifiers;
- a carrier-lineage commitment;
- encoded chart contributions;
- optional privately encoded input values;
- an anti-replay protocol nonce.

The custodian returns:

- an encoded chart contribution;
- or one site-specific encoded effect projection;
- plus protocol authenticity needed to reject malformed transport.

It never returns:

- source or canonical IR;
- a semantic operation or handler identity;
- a regional codelet or schedule;
- a next-region identifier;
- a general decode key;
- the missing gluing relation;
- an owner sidecar or source map;
- a reusable offline evaluator.

### 8.3 Function and topology privacy

Gate-hiding alone is insufficient. Recent work demonstrates SAT recovery of
hidden gate functions from public topology, with large speedups from
topology-aware simplification:
[Function Recovery Attacks in Gate-Hiding Garbled Circuits](https://arxiv.org/abs/2601.13271).

Therefore the maximum profile requires:

- a universal or set-universal circuit per padded size/effect class;
- no region-specific public topology;
- active security against a client that deviates from the protocol;
- transcript padding where size would identify the macroregion;
- fresh wire labels and representation state per session/epoch;
- a test that attempts topology-based function recovery.

### 8.4 Stateful representation custody

The custodian maintains a representation state:

```text
sigma = {
    session,
    rootGroup,
    coverEpoch,
    lineageCommitment,
    consumedNonces,
    custodiedChartState
}
```

Successful evaluation advances `sigma`. Replaying a consumed transition is
rejected. A client snapshot cannot fork the same server representation epoch
into arbitrary counterfactual queries.

This is not claimed to stop all chosen-input analysis:

- an authorized attacker may create fresh sessions;
- outputs remain a black-box oracle;
- rate limits and licensing policy are separate product controls;
- simple functions may still be learned from very few I/O examples.

The stateful protocol prevents free fork-and-replay of one internal
representation; it does not manufacture query hardness for an intrinsically
simple function.

## 9. Deployment profiles

### 9.1 `holographic-local`

All charts and gluing relations ship with the artifact.

- No network or trusted hardware.
- Highest floor available without changing the trust domain.
- Full client instrumentation can eventually reconstruct the entire system.
- Security claim is analysis amplification and trace nonlocality only.

### 9.2 `holographic-custodied`

One necessary relation is held by a developer-controlled service.

- Full client traces are structurally incomplete.
- Critical region extraction becomes black-box/function-recovery analysis.
- Availability and latency become product requirements.
- There is no offline fallback containing the missing relation.

### 9.3 `holographic-private`

Use private-function evaluation so the custodian learns no protected client
input beyond the declared leakage, while the client learns no function detail
beyond outputs and declared transcript leakage.

- Highest cryptographic goal.
- Practical only for restricted typed macroregions until benchmarks prove more.
- Universal-circuit and active-security costs may be substantial.

### 9.4 `holographic-tee`

Place the missing chart relation in a hardware-backed isolated component.

- Lower latency and possible offline execution.
- Changes the threat model to the hardware/attestation boundary.
- Target-specific and exposed to platform side-channel/fault limitations.
- Not a universal browser solution.

### 9.5 `holographic-threshold`

Split the custodied relation across several non-colluding services.

- Avoids one infrastructure provider holding the complete hidden relation.
- Can improve service resilience and developer trust separation.
- Adds protocol rounds, operational complexity, and another failure surface.
- It does not meaningfully improve client extraction over one honest
  uncompromised custodian; it improves custody assurance.

## 10. Non-negotiable CSH invariants

| ID | Invariant |
|---|---|
| CSH-01 | Production never stores a complete canonical logical frame for a protected CSH region. |
| CSH-02 | No chart is a one-variable share set or independently decodes a source variable. |
| CSH-03 | Certified projections require the configured minimum number of independently owned chart contributions. |
| CSH-04 | Chart ownership crosses region and, where valid, continuation/function boundaries. |
| CSH-05 | Every protected regional transition changes the chart cover or its restriction maps. |
| CSH-06 | No universal global-section solver or decode helper exists in production. |
| CSH-07 | Effects and returns use distributed site-specific projections. |
| CSH-08 | Ordinary values materialize only where native JavaScript observability requires them. |
| CSH-09 | The custodied relation is necessary for the selected macroregion's correct transition. |
| CSH-10 | No client artifact, cache, error path, development flag, or fallback contains the custodied relation. |
| CSH-11 | A custodian response is an encoded chart/projection contribution, never an operation, codelet, route, or reusable key. |
| CSH-12 | Public PFE topology is fixed within padded size/effect buckets and independent of the protected region. |
| CSH-13 | The custodian protocol is secure against an actively deviating client for the declared profile. |
| CSH-14 | Custodied representation state advances monotonically and consumed transitions cannot be replayed in one session. |
| CSH-15 | A client snapshot cannot fork one custodied representation epoch. |
| CSH-16 | Exact getter, proxy, coercion, call, throw, `finally`, await, yield, and scheduling behavior remains unchanged. |
| CSH-17 | Network failure is explicit; the maximum profile never silently falls back to a complete local implementation. |
| CSH-18 | Every observable effect, ordinary-value projection, transcript-size class, and remote call is inventoried in the certificate. |
| CSH-19 | Local-only and custodied profiles use different, honest security claims. |
| CSH-20 | The owner sidecar and source-origin scorer never ship to the client production artifact or custodian response. |

## 11. What this does to BPRF

### 11.1 Region graph

Add:

- chart ownership sets;
- overlap/restriction edges;
- cover-transition contracts;
- certified projection sites;
- custodied-relation dependencies;
- public transcript leakage classes.

### 11.2 Carrier

Add:

- current cover ID and epoch;
- active chart ownership map;
- overlap reconciliation phase;
- pending custodian protocol continuation;
- lineage commitment;
- custodian session binding.

Do not add:

- global frame state;
- expected chart solution;
- a global decode key;
- a semantic operation;
- a next-region token received from the server.

### 11.3 Regional realizations

Each BPRF ontology must lower to chart-local transitions:

- predicated dataflow updates one overlap neighborhood;
- continuation residuals transport another;
- algebraic variants operate over coded chart coordinates;
- effect sinks request and materialize only their certified projection.

An ontology that reconstructs a complete frame before execution is not
CSH-compatible.

### 11.4 Verifier

In addition to BPRF equivalence, verify:

- local chart transitions glue to the intended canonical state transition;
- overlap constraints remain satisfiable and uniquely determine only the
  certified projection, not an emitted global frame;
- all cover changes preserve the global consistency class;
- threshold/necessity properties hold for chart contributions;
- removal of any required contribution changes or blocks the projection;
- no global decoder or complete client transition exists;
- custodied and local relations compose correctly;
- transcript and effect leakage match the certificate;
- every failure mode preserves native-visible error/ordering contracts where
  the API promises them.

## 12. Dynamic-attacker evaluation

Retain every BPRF metric and add:

| Metric | Meaning |
|---|---|
| Client completeness | Whether client artifact + full client trace determines the selected regional transition without the custodian |
| C90 | Minimum simultaneously correlated chart probes for 90% logical-state recovery |
| G90 | Work required to reconstruct a consistent global section for 90% of reached state |
| Cover transfer | Recovery accuracy after an unseen cover split/merge/reownership sequence |
| Projection leakage | Logical state recoverable from one certified effect projection beyond the native effect value |
| Fork success | Ability to evaluate two counterfactual transitions from one custodied epoch |
| Transcript transfer | Function/region classification accuracy from network transcripts |
| Topology recovery | Function recovery from public PFE topology and chosen outputs |
| Custody bypass | Smallest client patch that preserves output without a custodian call |
| Oracle learnability | Queries and compute needed to learn an equivalent crown-jewel macroregion from I/O |

Run four attacker classes:

1. O(1)-hook BPRF choke-point search;
2. full-step, full-heap client trace and graph alignment;
3. client snapshot/fork/replay with an actively modified protocol client;
4. topology-aware PFE/function-recovery plus chosen-input black-box learning.

## 13. Go/no-go gates

### 13.1 Local holography

- No complete frame appears at a regional boundary.
- C90 is at least the configured chart threshold.
- Full-step G90 and storage rise by at least 10x over plain BPRF for the spike
  while legitimate overhead remains lower than attacker amplification.
- Cross-cover transfer loses at least 30 percentage points.
- No three or fewer localized hooks recover a stable source-variable map.
- Any scheme reducible to one fixed linear recombination is deleted.

### 13.2 Custodied mode

- Client completeness is false by construction and by extraction test.
- Removing the custodian relation prevents correct standalone evaluation.
- No client error/fallback/debug path exposes the missing relation.
- Function/region classification from padded transcripts is no better than the
  declared size/effect-class leakage.
- Topology-aware recovery does not distinguish protected regions within a
  universal-circuit bucket beyond the accepted leakage.
- Snapshot/fork of one custodied epoch fails.
- A client patch cannot convert custodian responses into a canonical operation
  or reusable offline evaluator.
- The service returns no more than the output/effect leakage declared by the
  protected contract.

### 13.3 Correctness

- Zero native/reference/BPRF-CSH value mismatches.
- Zero event-order, proxy/getter, exception, async, or generator mismatches.
- No favorable-seed dependence.
- Failure and retry semantics are explicit and deterministic.
- Maximum profile never falls back to a locally complete artifact.

## 14. Kill criteria

Remove or redesign CSH if:

- a complete logical frame or fixed decoder appears anywhere in production;
- moving covers normalize to one stable slot transform cheaply;
- chart overlap adds only fake dependencies removable by slicing;
- a client dump is sufficient to evaluate a custodied region offline;
- the custodian returns missing code, semantic tokens, or reusable keys;
- public circuit topology identifies the protected region;
- remote state can be forked freely from one captured client snapshot;
- correctness requires suppressing real JavaScript effects;
- the only benefit is rate limiting, integrity enforcement, or anti-hooking;
- private-function evaluation is impractical and direct remote execution is
  unacceptable for the product;
- attacker amplification does not exceed legitimate overhead in local mode.

## 15. Incremental spike

1. Finish BPRF's dynamic attacker baseline and region/effect annotations.
2. Select a typed, pure crown-jewel fixture with branches and direct calls.
3. Encode its state into at least five overlapping charts with threshold three.
4. Implement two changing covers and chart transport without a global frame in
   the reference evaluator.
5. Add owner-only global-section reconstruction solely to score the attacker;
   keep it out of production modules.
6. Run full-step dynamic slicing and test whether moving covers materially
   increase C90/G90 and reduce cross-cover transfer.
7. Delete linear/fake-dependency schemes that normalize cheaply.
8. Move one necessary nonlinear gluing relation behind a mock custodian API.
9. Prove there is no correct standalone client evaluator for that fixture.
10. Implement a direct remote relation evaluator as the performance/control
    baseline.
11. Implement one actively secure, topology-hidden PFE prototype for the same
    typed relation.
12. Run topology recovery, active-client, fork/replay, and black-box learning
    experiments.
13. Compare local holography, direct custody, PFE custody, and plain BPRF on
    correctness, client completeness, attack cost, latency, bandwidth, and size.
14. Freeze CSH types/protocols only if the appropriate profile clears every
    gate.

## 16. Product decision

If Ruam must remain entirely offline and server-free, adopt only
`holographic-local` and retain the existing honest ceiling:

> Full client recovery remains possible; CSH raises the synchronization and
> global-reconstruction cost.

If the requirement is truly to raise the floor **as high as possible**, adopt
`holographic-custodied` or `holographic-private` for marked crown-jewel
macroregions:

> A full client trace is intentionally incomplete. Recovery of the missing
> regional relation requires compromising the custodian/PFE assumption or
> learning equivalent behavior from the permitted input/output oracle.

That is the first proposed BPRF layer that changes the full-access client
boundary rather than only making client-side normalization more expensive.
