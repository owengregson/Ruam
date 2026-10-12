# Algorithm/state replacement preflight

**The current result is NO-GO for replacing the VM.** This implements the first admission and attack checks for the [selected A1 design](../2026-10-09-ambitious-swarm/20-selected-design.md), and investigates combined architectures that retain current Ruam's JavaScript scope. It is not the requested completed replacement and does not establish AI resistance.

The user requires the final combined protector to handle the same JavaScript and protected-selection scope as current Ruam. A component's failure to qualify for A1 cannot narrow that requirement. The current production entry points and compiler remain unchanged.

## Executed findings

The [frozen inventory](roots.json) contains three existing compiler components: MutationState, NameRegistry with its returned scope/token/generator graph, and Emitter. The [source audit](inventory.md) records their full APIs and concrete rejection reasons. All three fail current A1 admission. They are existing compiler components, not independent production application evaluators; no synthetic replacement root is substituted to obtain a favorable result.

The first pilot, MutationState, stops at admission. Its source does not restrict its class API to the permutation domain an alternative relation model would need, and its TypeScript-private arrays are ordinary runtime properties. NameRegistry and Emitter expose mutable state and effects that cannot be dropped from their contracts. These findings do not prove that no future application component can qualify.

A separate **negative-control** ticket changes an unfrozen naming scope's duplicate claim to return the existing token, while preserving freeze errors and later generated names. A small sidecar calls the original operation, handles its duplicate error, and returns the public stored token. It retains the original implementation. This is a partial-edit bypass, not standalone recovery.

The runner evaluates identical public deterministic histories against ordinary bundled code, optimized bundled code, and an actual current VM `max` build. The VM control explicitly disables `debugProtection` to avoid periodic anti-debugging behavior during scoring; other `max` settings retain their defaults. It records compile warnings, final artifact hashes, options and behavioral results. Failed, timed-out or warning-producing VM builds receive no functional-baseline credit. A naïve patch that checks the token map before calling the original incorrectly suppresses frozen errors and fails the control.

The [checked-in report](preflight-report.json) records the actual results. Passing this control is not evidence of equal protected coverage, a protection multiplier, a successful A1 transformation, or a source-blind AI trial. The model author saw repository source while creating the attack. Script execution uses no model; authoring tokens and analyst effort remain unknown. The frozen candidate tickets in the root inventory have not advanced past admission and are not replaced by this easy control.

## Reproduce

From `packages/ruam`:

```sh
bun test test/algorithm-state/preflight.test.ts test/algorithm-state/sidecar.test.ts
bun run qualify:algorithm-state --report-only
```

Without `--report-only`, qualification writes the same report and exits **2** for the stopped gate. Operational errors exit **1**. `--report-only` means reproduce the research report; it does not approve release. Supply `--output /absolute/path/report.json` to write elsewhere. The runner can replace its own prior report, but refuses to overwrite source, the frozen manifest, unrelated files or symlinks.

The verifier checks exact current source bytes against the manifest and the original Git commit's blobs. It validates three distinct ordered roots, complete audit descriptions, source-linked rejection reasons and all three family assessments. A source change makes the audit stale. This is a verified record of a **manual source audit**, not an automated semantic admission proof. Editing a JSON status cannot establish admission or authorize compiler construction.

The output binds the harness and source snapshots and checks them again after execution. The VM control runs in a subprocess with a 15-second wall limit. The Node VM contexts execute repository-owned code; they are not a security sandbox for arbitrary hostile inputs. CPU/heap measurements are process observations with explicit limitations, not complete analyst or compilation-service cost accounting.

## Design improvements and remaining work

The [architecture review](architecture.md) considers full-scope native control-flow specialization, a new effect/control compiler with A1 optimizations, and a revised general VM. It incorporates primary-source research on AI-assisted normalization, semantic synthesis, verified expression diversification, incremental computation, and cryptographic obfuscation limits. Each candidate has a concrete cheapest attack to test. None has earned an AI-prevention claim.

The replacement still requires a surviving real application pilot, source-derived ownership/domain obligations, independently checked state refinements, full existing JavaScript compatibility, final-byte history validation, measured legitimate costs, functional comparative baselines, and held-out recovery/explanation/edit attacks. Missing evidence cannot be treated as a pass. Preserving compatibility by leaving selected logic unprotected cannot be treated as protection.

The implementation and review status is recorded in [review-record.md](review-record.md). This preflight can be merged as research infrastructure after review; the decision to supersede the VM remains blocked by the failed and unmeasured gates above.
