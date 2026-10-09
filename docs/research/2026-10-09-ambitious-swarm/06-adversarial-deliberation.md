# Adversarial deliberation after the independent briefs

Worker C, 2026-10-09. I wrote `03-adversarial-designs.md` before reading B's `01-architectures.md`, the coordinator's `02-coordinator-candidates.md`, the actual discussion in `04-discussion.md`, and A's `05-compiler-critique.md`. This records exchanges that subsequently occurred. It is not a security result or a substitute for the frozen ballot.

## Revised nomination: one conditional experiment

I withdraw my independent C1 and C2 proposals as nominations for a second research slot. C1 overlaps B3/R2's future-observation quotient; C2 overlaps R4/B4's circuit realization. Neither supplied a concrete existing target and edit task that survives its cheapest extraction attack sufficiently to justify a second architecture now. Distinct representations are not enough to fill a second slot.

I provisionally support **one composite B1+B2/R1 experiment**: replace an existing stateful evaluator with genuinely different algorithms and necessary maintained state, then measure the difficulty of reconstructing its logic and performing a partial semantic edit across future histories. Source/context specialization and cross-domain composition are supporting compiler techniques. No clone-resistance result follows from this nomination, and no public strength claim follows from spending time on its falsifier.

## A challenged C1 and C2 directly

A observed that my proposed “two thousand possible histories” can exist even for a one-state machine. That is correct. History count is input coverage; it is neither distinguishable-state count nor reconstruction complexity. Even a large set of distinguishable states is not hardness when the artifact exposes compact transitions. Quotient/minimization can hand the attacker a cleaner machine than the original implementation.

A also challenged C2: generated equations, gate/cut extraction and public synthesis rules can produce an independently usable circuit without recovering the original word-level operations. I accepted that such recovery counts when it actually removes realization machinery and yields the necessary computation; original word names and algorithm correspondence are not prerequisites. Mechanical recoding alone remains distinct. I could not name a concrete noncryptographic kernel plus partial edit that defeats the cheap lifter while meeting legitimate cost limits. I explicitly told A and the coordinator that both proposals should lose the second-slot nomination.

This does not prove that residual transducers or circuit resynthesis can never help. It establishes that this round produced no adequate reason to fund those as separate protection architectures. Their correctness and optimization properties can still support a future experiment, with their extraction attacks retained.

## My challenge to B1+B2: ignore the represented state

I sent B a concrete bypass of the maintained-view premise. The attacker observes every public insert, delete, reset and query event. It can attach a sidecar, retain original tuples or the full history, and implement the edited behavior in an ordinary evaluator. If the edit ticket and public schema already specify that evaluator, recovering the candidate's view meanings or invariants is unnecessary. The attack must be allowed to add state, reset, replay and use a less efficient but admissible algorithm. B1+B2 cannot forbid those abilities merely to force an interesting reverse-engineering problem.

A independently agreed that this is decisive against a fully specified ticket. B accepted the challenge: a ticket containing the complete edited evaluator lets shadow reimplementation bypass the proposed obstacle. B explicitly rejected requiring an attacker to decode residual state, and rejected new no-reset/no-observation assumptions.

B proposed a narrower remaining task: a ticket changes one part of a pre-existing component's behavior while preserving its other private but observable semantics. The example was a failed amend operation that should no longer consume credit, while other retry, ordering and valuation consequences still have to behave correctly across future calls. The ticket would not describe the entire original evaluator. A sidecar remains permitted, but now it may need to recover unchanged coupled semantics from the artifact and observations.

I accepted this as a coherent, unproved hypothesis. The distinction is useful: the desired rule alone is insufficient to rebuild the whole component when unchanged behaviors remain part of the scoring contract. It does not make those behaviors hard to recover. A simple omit/replay transformation, synthetic event insertion, black-box learner or replacement evaluator may still solve the task cheaply. Any one of those successes defeats the relevant claim.

## Conditions that the final design must preserve

1. **Freeze an existing interface and source first.** Do not invent a workload or remove valid events, record identities, deletion modes or observations to manufacture coupling. If the original semantics need a key-to-record map, retain it honestly. If a complete component cannot be admitted, show the rejection.
2. **Audit the information in the ticket.** Baseline and candidate attackers receive identical API, domain and desired-change information. The ticket should identify an actual partial change without silently supplying a complete replacement algorithm. It must also be precise enough to score correctness. Record the unchanged semantic obligations without exposing hidden expected outputs to the attacker.
3. **Allow the cheapest solution.** Add-state sidecars, full history retention, reset/replay, synthetic events, cold initialization, domain learners, source-assisted analysis and full reimplementation all remain legal. Neither reconstruction nor edit success requires the author's preferred representation or original variable names.
4. **Separate objectives.** Independently executable clean machine extraction defeats a clone-resistance hypothesis. A correct partial edit defeats the corresponding edit-resistance hypothesis. Predicting unseen histories and giving a falsifiable invariant explanation measures comprehension. Expensive source attribution cannot erase a cheap functional replacement.
5. **Separate complexity from protection.** Charge compiler search, artifact size, cold start, per-event tail latency, memory and semantic-support restrictions. Do not credit attack overhead that merely tracks legitimate runtime growth. Report reusable setup and transfer across target programs separately from per-artifact time.
6. **Run the cheap falsifier before a new compiler.** On one existing pilot component, compare its ordinary source against hand-constructed alternative algorithms only if those alternatives preserve the original API exactly. Attempt the ticket-driven shadow evaluator and direct transition extractor first. If these are cheap, stop that claim. A wider preregistered study is necessary before reporting a positive multiplier.

## What changed through discussion

My independent brief initially preferred C1 and C2 as affordable architecture spikes. Direct challenges removed both from my nomination because I had no surviving concrete task, and clarified that a history count is not an obstacle. My sidecar challenge changed B1+B2's plausible target from generic rule edits to partial edits that preserve unspecified-but-observable coupled behavior. B accepted the bypass and the mandatory ticket-information audit; I accepted the narrower remaining hypothesis. Those are actual agreements about an experiment, not fictional consensus that an architecture works.

The resulting position is deliberately one candidate, not two renamed variants. It is ambitious compiler research into algorithm and state synthesis, with an immediate attack that can still reject it. It must remain separate from the current regional PR's measured no-go result and must not rehabilitate masking, encrypted interpreters, inaccessible keys, or a remote service under the strict offline JavaScript constraint.
