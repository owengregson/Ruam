# Actual architecture discussion — worker B

Status: open discussion on 2026-10-09, not a final vote or implementation approval. I generated `01-architectures.md` before reading the coordinator's `02-coordinator-candidates.md`. This record distinguishes messages actually exchanged from proposals that have not been accepted. I have not read worker C's independent new brief at this point.

## The objective and what counts as recovery

The coordinator clarified that the user's newer wording explicitly values reconstructing source and understanding logic. Consequently this ambitious track can separately measure meaningful edits and comprehension. That does **not** change the original functional-recovery gate or retroactively turn a failed clone-resistance hypothesis into a win.

Mechanical AST-to-SSA conversion, pretty-printing, or renaming alone is not recovery. Conversely, a generic extractor that removes the protective machinery and produces a clean usable circuit, relation evaluator or state machine does count, even if the result does not recreate owner names or original data structures. Any experiment must say which happened and demonstrate the replacement or edit. This distinction prevents both a tautological “every executable JS program loses by reprinting” argument and an equally tautological “the attacker did not reconstruct the exact owner's representation” victory.

## Coordinator challenge to B1 and B2

The coordinator challenged B1/R1 algorithm diversity because all families may normalize to the same rules or automaton. Poor transfer between syntactic lifters is insufficient if a domain learner bypasses every family. The coordinator separately challenged B2 incremental views because differential queries and heap traces may reveal the state basis; retaining all known updates can avoid needing original state meanings.

My response: I cannot give an honest domain restriction that, by itself, defeats a clean full-state machine extractor for the same-function replacement task. If the attacker can eliminate the protective machinery, preserve every live view and initialization/update rule, and emit a clean evaluator cheaply, the clone-resistance hypothesis fails. Larger state and missing owner names do not alter that result. I proposed dropping B2 as an independent **clone-resistance** architecture. B3 quotient minimization may make cloning easier; B7's public predicate is directly portable; B8 exposes reusable input encoders. None should advance as a general solution merely because it invokes information loss or cryptography.

The coordinator accepted the objective distinction and requested that we debate one combined B1+B2 semantic-edit/comprehension hypothesis against R2 residual automata. The coordinator explicitly allowed only one finalist if a second does not survive. No final selection was made in that exchange.

## Worker A challenge and my response

Worker A independently challenged B1/B2: a seed/compiler-aware adversary can lift initialization, updates and output projections into a fresh evaluator while keeping every materialized view. Family labels expose which lifter to use; no invariant inference is necessary for preserving existing behavior. Worker A tentatively favored one B1+B2 composite **only** as a targeted-rule-edit/comprehension hypothesis, with cheap machine lifting disclosed as a defeat of clone claims.

I agreed on this limitation and supplied a concrete domain below. After the coordinator clarified that mechanical SSA recoding alone is insufficient, I relayed that clarification to A and asked whether R2 offers a stronger target. A responded in favor of **one conditional B1+B2 research hypothesis** over R2, requiring actual edit/comprehension wins and disclosure of cheap clean-machine extraction or clone failure. A had no stronger R2 target and agreed that state count alone cannot establish difficulty. This is an actual shared provisional preference, not a final vote or protection result.

A also challenged my base-tuple removal premise: delete-by-key or exported record identity may require the original relation to remain. I accepted the challenge. The event/observation interface must freeze before selecting the architecture; full-tuple deletes are available only if already guaranteed by the authored interface. Delete-by-key requires enough key-to-record information, and escaping identities must remain correct. Removing base tuples is permitted only when that particular representation is proved unnecessary for every original future observation. No new API or cardinality restriction may silently remove valid inputs. If that proof fails, disclose retained state or reject the candidate; do not redesign the workload to make the hypothesis work.

## A bounded domain with a real remaining interaction

Proposed experimental inputs are existing stateful multiset evaluators with:

- Owned initialization and a public finite event vocabulary: insert/delete tuples, query the existing outputs, and reset.
- Source-established bounds on keys and integer multiplicities; exact arithmetic and explicit invalid-event behavior.
- Multiple outputs depending on joins and predicates over the same tuples, with duplicates and deletions semantically meaningful.
- No host aliases to internal collections, unknown coercions, source reflection, async suspension, or unmodeled effects inside the selected transition system.
- All valid event histories retained in correctness obligations. No secret event stream, hidden initialization, unavailable seed, restricted instrumentation, or new no-reset assumption.

For example, a private evaluator maintains eligibility and amounts for orders joined to account and policy relations. Original execution scans or indexes base tuples. The candidate specializes the domain, derives mixed views and delta updates, and removes base representations when they are unnecessary for every original future observation. A single source rule contributes to several shared maintained quantities. The residual implementation need not retain a neat one-to-one tuple or field encoding.

The remaining interaction is narrow: identifying a linear basis of stored columns is not sufficient to derive how a changed join predicate, duplicate multiplicity rule or eligibility condition must change **all** affected update and output formulas. This is a hypothesis about consistent modification and explanation across histories, not secret state. Merely changing a final threshold or coefficient is generally too easy and should be a negative control. Likewise a change that requires information the original source never retained is not a fair edit task.

A valid edit must be defined on the owner source, applied to a real supported rule, and checked from reset over held-out insert/delete histories. The attacker may add state and instrument every event. A valid comprehension result must describe the relevant original behavior and maintained invariants accurately enough to predict previously unseen traces and justify the edit; an attractive prose explanation is not evidence. Symbolic differentiation of extracted update rules, active event learning, or plain domain recognition may still solve both tasks cheaply.

## One composite versus residual automata

Combining B1+B2 could yield **one** coherent pipeline: recognize a qualified domain; construct the exact event/output relation; explore genuinely different incremental and direct algorithm families; choose one implementation; synthesize its shared state and updates; emit native JS; verify complete event semantics. Supporting techniques from R5/R7 are allowed only when they remove a real evaluator boundary or shared domain model. They do not become separate architectures or optional easy realizations.

R2 instead composes necessary finite-state submachines and minimizes residual future behavior before transition synthesis. This has a cleaner finite correctness story and a credible scope in parsers or protocols. Its weakness is that reachable transition extraction, distinguishing sequences, and minimization may produce a cleaner machine directly; changing a token transition can be easier after minimization. Its strongest version would require an existing protocol whose policy edit affects interactions between several residual histories, rather than a hand-built giant automaton. The state count alone is not an obstacle when symbolic transitions remain compact.

My current preference for discussion is the relational composite because it supplies an explicit interaction between update invariants, duplicate semantics and outputs. That is not a vote or a demonstrated advantage over R2. R2 may be more buildable and may win after a concrete target is examined. The most defensible outcome could also be to stop both protection claims while retaining useful compiler optimizations.

## Worker C's sidecar attack changes the task design

After publishing `03-adversarial-designs.md`, C challenged the proposed edit target: unrestricted observation of insert/delete/reset events lets an attacker retain tuples and history in a sidecar and implement the changed rule in an ordinary evaluator. The edit ticket and public schema may already specify that evaluator, bypassing maintained-view recovery entirely. C explicitly asked that added state and replay remain permitted. C also acknowledged that its C1 residual-machine proposal may merge with B3/R2 and may make extraction or editing easier; C did not insist on occupying a second slot.

I read C's independent brief and accepted this attack. No valid task can demand that an attacker decode residual state as the method of solving it. If the ticket fully specifies the new behavior, building it from public inputs may be enough; protection cannot receive credit because the attacker used the “wrong” route. Logging, added state, reset, black-box queries, artifact patching and synthetic event replay all remain allowed.

The narrower possible target is a **partial** behavioral edit to an existing component while preserving other, unspecified private coupled semantics. An illustrative ticket might say that a failed amendment no longer consumes a credit, while preserving existing retry ordering, valuation effects, other event behavior and every future output. The ticket would not hand over the complete original evaluator. A sidecar may still win, but it must obtain the unchanged coupled behavior from the artifact or observations, or demonstrate that replay/intervention implements the edit. That is a potentially measurable comprehension/reconstruction task, not a claim that hidden state has become unavailable.

This example is not an admitted workload or evidence. Before compilation, audit the actual target and information in its ticket. Supply the same ticket, public schema, examples and permitted queries to original-source baselines and protected candidates. If simply replaying a modified history, inserting a compensating public event, or writing the fully specified new rule solves it, record that cheap success. Do not remove API features, hide inputs, forbid additional memory, or manufacture an incomplete public contract to save the hypothesis.

I told C that C1/R2 does not currently justify an independent second slot: its residual/quotient operation is a possible implementation technique for the same broader hypothesis, and its cheapest attacks overlap. C2's whole-relation bit-level compilation is genuinely different, but I requested a concrete existing noncryptographic kernel and partial semantic edit before recommending it as the second architecture. A circuit expansion with no affordable operation-lifting falsifier does not earn a slot. My current recommendation is **at most one conditional composite**, with the second slot left empty unless that concrete case survives discussion. This is a recommendation for the upcoming slate, not a completed ballot.

C answered that preserving unspecified but observable unchanged semantics gives the partial ticket reconstruction work absent from the full-spec ticket. C accepted it only as a hypothesis and reiterated that sidecar, black-box, replay/omit-event and synthetic-event attacks must remain admissible. C required the equal-information audit on an existing component before implementation. C could not supply a concrete C2 kernel/edit surviving the cheap netlist and cost challenges, explicitly withdrew the second slot, and declined a separate C1 nomination. C therefore supports one conditional B1+B2 composite. Together with A's earlier response, this establishes actual provisional convergence among the workers, subject to the coordinator's frozen slate and independent ballots; it does not establish effectiveness.

## Cheapest discriminating experiment

Use one pre-existing bounded relational evaluator and one pre-existing residual protocol target. Fix source behaviors, edit tasks, budgets and correctness oracles before compiling. Produce three substantially different realizations for each where feasible. Give the attacker compiler rules, seed, every byte and unrestricted observation.

First attempt a generic clean evaluator extraction that actually eliminates the protective machinery; score functional replacement separately from mechanical recoding. Then attempt domain reconstruction and the predefined edit using heap/delta tracing, symbolic reasoning and model assistance. Validate from reset on hidden histories, including deletion, duplicates, boundary values and all affected outputs. Report compute, tokens, analyst time and setup amortization, alongside runtime, bytes, memory and build search costs.

A clean cheap clone terminates the clone-resistance claim even if the edit is hard. A cheap correct edit or accurate predictive explanation terminates the corresponding claim even if another attack family times out. To advance under the user's expanded objective, require both edit and comprehension improvement on held-out targets, not merely a difficult original-name recovery exercise. Cross-family diversity alone earns no credit.

## Separate implementation pre-review findings

The current compiler's correctness review is independent of this architecture choice. I found and reproduced a P1 directive-prologue bug in both private-call fusion and configuration specialization:

```js
function outer() {
  function helper() { return "use strict"; }
  helper();
  return this === undefined;
}
outer();
```

The source returns `false` in Node; generated output starts the function body with `"use strict";` and returns `true`. Replacing the helper with `const cfg = { strict: "use strict" }; cfg.strict;` has the same defect. Duplicate outer parameters turn the generated code into a SyntaxError. Removing a preceding helper/table can also expose an existing non-directive string statement. I sent concrete reproductions to A and the coordinator without editing A's files. A is fixing the issue.

I also reported that the Node loader's fatal UTF-8 decoder strips the BOM by default, making reported source bytes/hash omit original bytes. The coordinator fixed that using `ignoreBOM: true` and a regression. A fixed directive promotion with an effect-free `(0, string)` expression at newly exposed expression-statement boundaries. My independent Node rerun of the helper, config, duplicate-parameter and existing-string exposure cases now matches the originals. The current compiler/entry-point/worker focused run passes 28 tests with 795 assertions, including the added directive and BOM cases.

A further integration issue was reported to the coordinator: testing `mode` by truthiness in the worker accepts explicitly invalid falsy modes and silently chooses legacy compilation. The coordinator fixed this by defaulting only on `undefined` and added regressions for empty string, null, false and zero.

I subsequently independently reviewed PR 11 at exact head `60091a53aa404558e76d297668692ca0486cb108` and returned **APPROVE for the explicitly experimental NO-GO scope**. Reviewed nonowned changes included A's compiler, root's file/CLI/browser entry points, and C's qualification attacker/scorer/runners/claims. The focused compiler, entry-point, worker, recovery and negative-zero tests passed 37 tests with 866 assertions; typecheck passed. Every recorded regional qualification source hash matched reviewed bytes; the report remains 576 passing calibration builds, zero qualified complete roots, `claimsDemonstratedSecurity:false` and `stopExpansion:true`. This approval is neither promotion nor cross-browser qualification and applies to that exact commit only. I did not post a GitHub review.
