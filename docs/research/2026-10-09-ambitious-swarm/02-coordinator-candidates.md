# Coordinator divergence: eight ambitious mechanisms

These are proposals for research, not novel-results claims. They were drafted without reading the workers' new candidates. "New" means a materially different experiment for Ruam; no patent or literature priority is asserted.

## R1 — Change the algorithm, not only its representation

Compile eligible domain programs through several genuinely different algorithms: a private rules evaluator can become a discrimination network, decision diagram, indexed partition or specialized relational join; a recognizer can become derivatives, a minimized automaton or generated mutually recursive recognizers. Choose one exact implementation per build and erase intermediate domain descriptions.

The hoped-for obstacle is that one local normalizer no longer finds the original loop/table/operator structure, and learned recovery tools transfer poorly between algorithm families. This is more ambitious than choosing algebraic expressions for the same straight-line region. It deliberately gives up universal JavaScript transformation: exact domain recognition or an owner-authored specification is required, and specification admission cannot rewrite the benchmark to hide failures.

Cheapest defeat: identify the domain, reconstruct the compact rule language from input/output queries or symbolic partitions, and ignore every algorithmic difference. If that wins, diversity alone has no value. Measure marginal cross-build recovery after the attacker learns one family; freeze correctness, useful-edit tasks and size/runtime budgets. First experiment: twelve existing private evaluators with at least three nontrivially different compilations each, attacked by both rule learners and source-assisted normalizers.

## R2 — Fuse a genuine stateful transducer across its observable history

Compile an eligible parser, protocol validator or incremental evaluator as one minimized residual transducer whose state summarizes the exact future behavior of the original program. Fuse private submachines before minimization, then synthesize specialized transitions jointly with their output projections. Avoid explicit component-state tuples, generic dispatch, per-field decoders and local helper APIs. Native host boundaries commit only legitimate observations.

The proposed target is decomposition: recovering original private phases, invariants and state meanings from a machine whose states represent combinations of residual behaviors. This uses necessary history, not artificial state added to a pure function. It does not hide state if instrumentation exposes enough distinguishing continuations.

Cheapest defeat: trace every transition and apply automata learning/minimization or factorization; reachable-state enumeration may recover a cleaner machine than the source. Large symbolic state, exceptions and JS identity can defeat compilation before they defeat the attacker. First experiment: existing finite-state parsers with owner labels removed, a white-box transition extractor plus distinguishing-sequence learner, and tasks that alter one rule without breaking hidden histories. No claim of cryptographic state secrecy.

## R3 — Application-wide relational implementation

Express a selected necessary computation as constraints over values, predicates and bounded state, and specialize a solver into direct executable JS. The hoped-for obstacle is that useful results require reconstructing relations rather than reading imperative steps. Preserve exact bitvector domains and exception/effect boundaries.

Cheapest defeat: the emitted relation is already a specification; SMT or symbolic elimination may recover it more easily than ordinary code. A shared solver is a reusable choke point, and solver runtime can exceed all budgets. Reject unless an independently implemented solver-assisted attacker actually struggles more than on R1/R2. This is a high-risk alternate formulation, not a recommendation to ship SAT puzzles.

## R4 — Diversified bit-level circuit compilation

Convert eligible state-update functions to verified Boolean/bitvector networks, synthesize structurally different networks and map them to JS word operations with domain-specific partial evaluation. The attraction is losing recognizable arithmetic, field and branch structure without a VM opcode layer.

Cheapest defeat: Boolean resynthesis, bit-blasting and e-graph normalization may recover the same network immediately; JS source exposes the netlist, and numerical semantics outside bitvectors are difficult. Circuit size also hurts legitimate execution. Compare against ordinary optimized bitvector code; only semantic recovery/edit cost counts. Any result limited to circuit-isomorphism resistance must be labeled accordingly.

## R5 — Context-specialized higher-order residual programs

Specialize every private higher-order call with the exact reachable closure environment and continuation, then jointly compile consumers across those specializations. Unlike simple function inlining, this may replace a reusable evaluator and its data model with a domain-specific residual algorithm.

Cheapest defeat: partial evaluation can simplify the program for the attacker too; source-assisted defunctionalization recovers the call structure, and specialization explodes. This may be a supporting compiler technique for R1 rather than an independent protection design. One generic closure record or continuation dispatcher would resurrect a prior dead end.

## R6 — Path-dependent state representation with no common projection

Choose exact representation changes depending on necessary state transitions and compose all producers and consumers, rather than call a generic encoder/decoder. The hoped-for obstacle is that different reachable contexts require different reconstruction maps.

Cheapest defeat: instrument transitions and infer each map; compiler-known mappings and seed make the attack easier. If representations are affine or otherwise structured, solve for them. If one transition ever projects complete state, the system collapses there. Reentry, aliasing and async semantics make this expensive. This overlaps the prior campaign's deferred encoding hypothesis and needs new evidence to justify revival; ambition alone does not change that decision.

## R7 — Necessary computation split across heterogeneous domains

Realize interacting pieces as decision diagrams, arithmetic recurrences and automata, then eliminate intermediate adapters. A single domain-specific simplifier should not independently recover every piece if actual dependencies survive.

Cheapest defeat: slice at the remaining adapters and normalize each domain separately. If increasing the number of domains merely creates additional interfaces, it makes the attacker’s job easier. Any successful implementation should probably be a submechanism of R1/R2, not a fourth runtime architecture. Measure decomposition after all local synthesis tools are supplied to the attacker.

## R8 — Attacker-cost-guided verified compilation

Generate exact alternatives under a shared semantic contract and use multiple recovery tools to choose the candidate with best measured resistance per legitimate cost. Hold out attack families, applications and seeds; ship fixed recipes rather than an online service. Test useful edits and source-level explanation tasks in addition to I/O equivalence.

Cheapest defeat: overfit the portfolio or reward timeouts/tool failures. This is a search/evaluation method, not an independent protective mechanism. It becomes meaningful only when R1/R2 or another family supplies alternatives whose semantics actually obstruct reconstruction. It remains deferred from normal builds until the simpler mechanisms earn evidence.

## Initial evaluation before peer argument

R1 and R2 merit architectural design because they target recovering domain structure and decomposing genuine state, respectively. R5/R7 may support them. R3/R4/R6 are challengers with clear cheap defeats; R8 is a later method. This is the coordinator's nomination, not a completed vote.

The attack bar must include recent synthesis improvements. [XSmir's authors](https://doi.org/10.1145/3719027.3765134) show that inference rules recover relations beyond earlier synthesis grammars. [Syntia](https://www.usenix.org/conference/usenixsecurity17/technical-sessions/presentation/blazytko) motivates attacking small observable windows. [Loki](https://www.usenix.org/conference/usenixsecurity22/presentation/schloegel) motivates testing joint semantics but does not establish any JavaScript result here. These sources motivate adversaries, not the security of the proposals above.
