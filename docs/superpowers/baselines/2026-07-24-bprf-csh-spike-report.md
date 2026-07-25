# BPRF/CSH Spike Report

**Date:** 2026-07-24  
**Branch:** `codex/traveling-isogloss-replacement`  
**Decision state:** Initial local BPRF/CSH and first custody variants are
**no-go**; statefully masked custody prevents direct internal recovery but
remains **no-go** under the stricter black-box/overhead gates, and product
schemas remain unfrozen

## Purpose

This report records the first executable tranche of the revised Isogloss
architecture:

1. measure the legacy VM's dynamic-instrumentation choke point;
2. construct conservative effect-delimited canonical regions;
3. validate multiple BPRF ontologies without runtime semantic dispatch;
4. validate moving-cover CSH and a necessary custodied relation; and
5. prove that BPRF polynomial fragments can execute over CSH chart shares
   without reconstructing a transition frame;
6. attack the shipped artifacts rather than crediting contextual diversity by
   inspection; and
7. evolve custody so every intermediate client-visible state remains
   independently masked by custodian-held representation state.

The spike is not a product backend. The legacy VM remains only as the current
behavior oracle while the replacement is incomplete.

## Implemented controls and references

| Slice | Result |
|---|---|
| Legacy attacker control | Deterministic four-fixture corpus and executor-neutral scorer |
| Canonical analysis | Purity, throw, coercion, call, suspension, access, allocation, and completion facts |
| Region formation | Deterministic effect-delimited regions with typed exits and boundary contracts |
| BPRF | At least two causal families, contextual realization selection, fission, braiding, and wire rebasing |
| Local CSH | Five nonlinear charts, threshold three, changing covers, and scalar certified projections |
| BPRF over CSH | Degree-four product shares reduced by five contributors into a fresh degree-two cover |
| Direct custody | Signed response, one-response opening, mandatory remote relation, monotonic lineage, replay/fork rejection |
| Stateful masked custody | Keyed per-coordinate masks, pinned issued state, mandatory signed transitions, and final-only opening |

All generic BPRF/CSH evaluators are explicitly test/reference-only and are not
reachable from the package or CLI build entries.

## Legacy dynamic-attacker control

At seed `0x1badb002`, the legacy debug build exposes:

| Measurement | Result |
|---|---:|
| Fixtures | 4 |
| Owner/recovered boundaries | 278 / 278 |
| Operation events recovered | 254 / 254 |
| Boundary precision / recall / F1 | 1.0 / 1.0 / 1.0 |
| Operation accuracy / micro-F1 / macro-F1 | 1.0 / 1.0 / 1.0 |
| Sequence-edge recall | 1.0 |
| Executed dynamic-CFG recall | 1.0 |
| Minimum probe families | 1 |
| Result preservation | Complete |

This confirms the architectural defect: one passive console-probe family
produces a complete stable post-optimizer semantic stream.

## BPRF structural results

The bounded pure reference kernel currently proves:

- deterministic generation of `K >= 2` realizations;
- two structurally different causal families:
  dependency-layer polynomial dataflow and two-phase continuation residuals;
- indicator and signed boolean coordinate ontologies;
- caller-, epoch-, and lineage-conditioned realization selection;
- shifted-product and additive fission;
- every destination requires every configured fragment;
- every fragment is braided across multiple destinations;
- physical input, intermediate, and output wire bases differ; and
- serialized artifacts and traces contain no semantic operation, opcode,
  handler, canonical operand, formula tag, or source-node identity.

The generic differential evaluator is not a production runtime. The
specialized BPRF emitter removes the generic evaluator and artifact walker, but
all selected-realization algebra remains client-resident and statically
recoverable.

The artifact-aware attacker obtains:

| Measurement | Result |
|---|---:|
| Held-out output recovery from artifact alone | 1.0 |
| Physical dependency-topology recall | 1.0 |
| Dynamic primitive observations required | 0 |
| Artifact-aware unseen-realization recall | 1.0 |
| Artifact-aware transfer loss | 0 percentage points |

Naive trace-only transfer does fail on an unseen realization. That fact is not
credited because the shipped artifact enumerates every realization.

The specialized source-emission spike has no runtime artifact walker, generic
transition loop, semantic selector, frame array, or owner trace. Its remaining
hook surfaces include the scalar field normalizer, chart-local openings,
five-way reductions, final projection sites, and public region I/O. The
measured families emitted approximately **360 KB** and **1.67 MB** of source
and ran in approximately **415 μs** and **5.8 ms** per call. This is useful
mechanical evidence but not a production size/runtime shape.

## CSH structural results

The local moving-cover reference currently proves:

- five overlapping nonlinearly wrapped charts;
- a configured threshold of three;
- arbitrary valid threshold subsets recover only a declared scalar
  projection;
- every protected transition changes cover identity, mixing basis, chart
  points, wrapping maps, and ownership;
- affine transport accumulates old chart contributions directly into new
  charts without assembling the logical state; and
- there is no exported global-frame/global-section decoder.

The combined evaluator additionally executes BPRF product fragments over chart
shares. Products raise polynomial degree from two to four, so all five charts
are required for direct degree reduction into the next threshold-three cover.
No transition constructs an ordinary BPRF frame.

The stronger artifact-and-metadata-aware attacker changes the decision:

| Measurement | Result |
|---|---:|
| C90 | 3 contributions |
| Recovery with 1 / 2 / 3+ contributions | 0 / 0 / 1.0 |
| G90 work proxy | 3× plain state |
| Resident storage proxy | 5× plain state |
| Fixed-decoder unseen-cover accuracy | 0 |
| Metadata-aware unseen-cover accuracy | 1.0 |
| Metadata-aware transfer loss | 0 percentage points |
| Combined final-frame recovery | 1.0 |
| Combined full-trace amplification | 5× |

The configured chart threshold is real, but it does not meet the 10× work and
storage gates. Cover changes do not create genuine transfer loss once the
shipped cover metadata is admitted to the attack. Local CSH is therefore a
hard no-go as the maximum-protection architecture.

## Custody results

The direct-remote control holds one nonlinear projected relation outside the
client contract. The client receives only a signed, lineage-bound encoded
projection and a one-response opening for the native-visible scalar value.

Verified properties:

- no response means no local evaluation or fallback;
- the client contract contains neither the relation nor lineage/response
  secrets;
- every response advances the representation epoch;
- a consumed nonce is rejected;
- two requests forked from one client snapshot cannot both execute; and
- response tampering fails signature verification.

This is a direct-custody control, not private-function evaluation. The
custodian learns the declared input projection.

The adversarial gate found both first custody forms insufficient:

- the direct scalar relation is exactly learned from four fresh-session
  training queries and bypassed at one localized patch site;
- the chart-relation response exposes a complete unmasked logical delta after
  correlating three contributions; and
- the chart relation is likewise learned from four fresh sessions.

Replay and fork protection worked, but those controls did not prevent relation
learning.

The revised custody spike now carries charts for
`logicalState + custodianMask(epoch)`. Each signed response advances to
`F_epoch(logicalState) + custodianMask(epoch + 1)`, and only the terminal
site-specific scalar projection is opened. Representation masks and sharing
residuals are derived with keyed, domain-separated hashes. The custodian pins
the exact masked state it issued, so changing the client-side transport cannot
substitute a new logical input at the next epoch. Missing responses, replay,
snapshot forks, nonce substitution, signature tampering, and representation
substitution all fail closed.

The statefully masked evolution has now been attacked under full client
artifact, heap, request, response, and output visibility:

| Measurement | Result |
|---|---:|
| Protected logical-coordinate recovery | 0 |
| Unmasked transition-delta recovery | 0 |
| Masked state/delta recovery | 1.0 |
| Compatible logical states per width-three protected observation | 65,521³ |
| Cross-session masked state/delta transfer | 0 |
| Foreign/rebound signed response accepted | false / false |
| Shared service secrets and reused nonce | tested |
| Final output transfer | 1.0 |
| Localized client hook families | 2 |
| Trace / reconstruction / storage proxy | 5.0625× / 3× / 5× |

This clears the central custody property: complete client observation does not
determine an intermediate logical state or unmasked transition. It does not
clear the broader experimental no-go report. The chosen-input attacker learns
the complete degree-nine, three-input final scalar function from **220**
fresh-session output queries and reaches **1.0** accuracy on held-out inputs.
That attack uses black-box input/output pairs only and recovers neither hidden
transition nor intermediate state.

The distinction is architectural:

- stateful masking successfully changes client completeness from true to
  false for protected internals;
- exact native-visible outputs remain an unavoidable oracle; and
- a simple deterministic function can be learned from that oracle regardless
  of how its internals execute.

Ruam must not describe the first property as black-box nonlearnability. Raising
the oracle floor further requires an external query-authorization constraint,
keeping the final value outside the hostile client, or protecting a function
whose intrinsic query complexity is high. None can be manufactured by a
semantics-preserving client transform alone.

To remove transition-count and stage-position leakage from the remote
transcript, the owner/server planner now places real transitions, in order,
among mask-refreshing identity epochs in one of four fixed epoch buckets:
**4, 8, 16, or 32**. Every slot changes cover and representation mask and
returns the same signed chart shape. Different secret placements produce the
same client cover path and exact final output. The owner schedule and padding
count are reference/server-only and are kept unreachable from package entries.
Adversarial placement/stage classification is the next transcript gate.

## Correctness and build status

At the current branch checkpoint:

- full repository tests: **2,421 passed, 0 failed, 28,998 assertions**;
- TypeScript typecheck: passed;
- package build: passed; and
- reference custodian/evaluator identifiers are absent from built package
  output.

The same run measured the still-legacy VM control at **43.0× weighted average
runtime overhead** across its ten-workload performance suite. That is a
replacement ceiling, not an Isogloss result.

## Explicit spike limitations

These are blockers to schema freeze, not deferred documentation:

1. The pure BPRF algebra is a bounded research language, not general
   JavaScript.
2. The CSH integration uses finite-field integer/boolean coordinates. It does
   not represent IEEE-754 `NaN`, infinities, negative zero, fractional
   rounding, or overflow exactly.
3. BPRF algebraic reassociation is therefore eligible only where a compiler
   proof establishes an exact bounded domain. Untyped JavaScript arithmetic
   must remain an observable/coercive boundary or use an exact specialized
   realization.
4. The current reference evaluators intentionally expose generic loops and
   arrays to tests. They cannot ship because those would create artificial
   runtime choke points.
5. Local CSH is still entirely client-resident. Full client recovery remains
   possible, and the dynamic-attacker gate must measure whether its
   amplification exceeds legitimate overhead.
6. Direct custody changes the trust and availability boundary and does not
   provide input privacy.
7. Calls, recursion, effects, exceptions, `finally`, async, and generators are
   not yet lowered through BPRF/CSH.

## Current decision

The deterministic revised report records **11 failed gates** and **3
unevaluated gates** for the initial BPRF/CSH/custody composition. The failed
set includes artifact-aware transfer, full-step BPRF recovery, CSH work and
storage amplification, metadata-aware cover transfer, localized hook
collapse, combined client completeness, custody bypass, and chart-delta
leakage. Canonical operation F1, patch collapse, and topology-hidden PFE remain
unevaluated.

Do not freeze artifact, certificate, carrier, or runtime schemas yet.

The next decision requires:

- an actively secure, topology-hidden PFE feasibility decision if the private
  profile remains in scope;
- padded transcript and opaque contract-bucket measurements for direct
  custody;
- canonical-operation and patch-collapse measurements on product-shaped
  emitted code;
- legitimate size/runtime/latency/bandwidth measurements; and
- zero mismatches within every claimed eligible domain.

Mechanisms that do not beat the legacy one-hook control or whose attacker
amplification does not exceed user overhead will be removed rather than
carried into the product architecture.
