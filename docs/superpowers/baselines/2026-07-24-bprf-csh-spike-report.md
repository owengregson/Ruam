# BPRF/CSH Spike Report

**Date:** 2026-07-24  
**Branch:** `codex/traveling-isogloss-replacement`  
**Decision state:** Go/no-go evaluation in progress; product schemas remain
unfrozen

## Purpose

This report records the first executable tranche of the revised Isogloss
architecture:

1. measure the legacy VM's dynamic-instrumentation choke point;
2. construct conservative effect-delimited canonical regions;
3. validate multiple BPRF ontologies without runtime semantic dispatch;
4. validate moving-cover CSH and a necessary custodied relation; and
5. prove that BPRF polynomial fragments can execute over CSH chart shares
   without reconstructing a transition frame.

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

The generic differential evaluator is not a production runtime. A specialized
source-emission spike and adversarial recovery measurements are the next gate.

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

## Correctness and build status

At this checkpoint:

- Isogloss-focused tests: **42 passed, 0 failed, 12,056 assertions**;
- full repository tests: **2,373 passed, 0 failed**;
- TypeScript typecheck: passed;
- package build: passed; and
- reference custodian/evaluator identifiers are absent from built package
  output.

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

Do not freeze artifact, certificate, carrier, or runtime schemas yet.

The next decision requires:

- a sound canonical-region-to-bounded-contract lowerer;
- a specialized emitted BPRF spike with no generic artifact evaluator;
- O(1)-hook and full-step recovery measurements;
- C90/G90 and cross-cover transfer measurements;
- legitimate size/runtime overhead measurements; and
- zero mismatches within every claimed eligible domain.

Mechanisms that do not beat the legacy one-hook control or whose attacker
amplification does not exceed user overhead will be removed rather than
carried into the product architecture.
