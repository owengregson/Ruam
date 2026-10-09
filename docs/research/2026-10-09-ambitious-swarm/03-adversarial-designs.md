# Worker C — reconstruction targets worth trying to falsify

Independent generation, 2026-10-09. I read the charter and the existing Ruam implementation/history, but not the other candidate documents before writing this file. These are architecture hypotheses, not novel cryptographic constructions or measured protection. Every proposal ships ordinary offline JavaScript; the attacker has its compiler, build seed, artifact and unrestricted instrumentation. Copying or executing the artifact always succeeds. A useful research target must therefore be a separately executable simpler explanation or a preassigned behavioral edit, not preventing execution.

The current regional experiment is a useful warning: scalar substitution, literal-table reduction and a small oracle learner recover its calibration computations. Longer expressions and fewer boundaries have not established more expensive reconstruction. The proposals below deliberately name the relation an attacker would have to recover, and the cheaper route that may make that relation irrelevant.

## C1 — Future-behavior residuals instead of a conventional state machine

**Mechanism.** For owned deterministic stateful components, represent an activation by its residual future behavior. A compiler derives continuations over effect-free transitions, partially evaluates them against fixed configuration and known state facts, and merges only residuals it can prove equivalent for every permitted future input. The result is a graph of specialized transition/output fragments with mutually recursive cycles where needed. A residual node denotes a set of source states, not a bytecode instruction. Ordinary JavaScript functions implement the graph directly; there is no opcode executor. Unlike simply storing a conventional state vector in a closure, the transformation must actually eliminate coordinates and predicate distinctions through future-behavior equivalence.

For example, a configured streaming recognizer may have hundreds of intermediate source states that are indistinguishable once configuration fixes which future events matter. Conversely, a single source branch can distribute across residuals because its output depends on prior event classes. A targeted rule edit must identify the same behavioral condition across those residuals. The reconstruction question is a bisimulation or invariant over histories, not the identity of a handler.

**Cheapest defeat.** Label residual edges with chosen inputs, infer a minimal transducer, and retain that smaller graph as the recovered implementation. The residualization may already have done the attacker's minimization work. Visible effects provide excellent alignment anchors. If a conventional state vector or a single selected-continuation table remains, slice it directly. Path count alone is no evidence: public compiler structure may give a reusable linear graph recovery.

**Cost and exactness.** Restrict the first experiment to closed deterministic reducers with explicit finite state or proven finite abstractions. Arbitrary objects, escaped identities, exceptions and reentry cannot silently become finite states. Effect order remains at native boundaries, and continuation identities never escape. State explosion is a compiler rejection, not permission to insert a universal VM fallback. Runtime size and memory can rise sharply; fixed budgets are mandatory.

**Falsifier.** Compile three actual configured stateful components with at least two thousand possible histories. Ask two independent attackers to recover an executable reducer and edit one distributed acceptance rule. Compare ordinary optimized source, the same compiler without state merging, and residual output. Kill if a generic graph extraction/transducer-learning script achieves the task at comparable CPU plus setup effort, or if meaningful merging cannot occur without an unacceptable domain restriction. This is my first candidate for a bounded architecture spike.

## C2 — Cross-boundary relational circuits with no source-operation partition

**Mechanism.** Take a genuinely interdependent, pure integer region spanning multiple functions and loop iterations. Convert the complete relation from live inputs/state to live outputs/state into a bit-level circuit, then jointly resynthesize it under fixed configuration and proven bit widths. Partition by circuit cost and liveness only after optimization. Emit direct JavaScript bitwise operations, using word packing where real independent lanes exist. No source operation maps to a reusable handler; configuration participates in synthesis and need not survive as a lookup table. The intended obstacle is recovering meaningful word-level relations from a globally optimized network whose cuts disagree with source functions and iterations.

This differs from disguising `x + y` in a larger identity: the compiler must combine several necessary producer/consumer relations and eliminate real intermediate boundaries. It also differs from a generic Boolean evaluator: the shipped circuit contains no interpreter and no encoded instruction stream.

**Cheapest defeat.** Bit-vector simplification, equivalence checking, word-level lifting, cut enumeration and known-operation matching reconstruct arithmetic blocks. The same circuit optimizations may make that recovery easier. An attacker can also retain the circuit as an executable model; deciding whether that is a useful independent recovery requires a preassigned simplification or edit task, not an arbitrary readability threshold. Generic loops should not be fully unrolled merely to inflate code.

**Cost and exactness.** Initially admit only proved Number/int32 computations and explicitly bounded loop epochs. Respect JavaScript truncation, shift-width, signedness and exceptional coercions at boundaries; do not convert arbitrary Number arithmetic into bit vectors. Shared objects and effects terminate a circuit region. JS offers no free SIMD: packing unrelated lane bits may help suitable data-parallel code, while scalar gate expansion can be prohibitively slow. If cost exceeds the agreed limit, decline the region.

**Falsifier.** Start with real integer kernels whose source operations are easy to recognize, not cryptographic primitives already hard to explain. Compare against a conventional optimizing compiler and an unresynthesized circuit with identical semantics. Give attackers the full synthesis recipes and a solver. Kill if operation-level recovery or a targeted edit is similarly cheap, or if runtime/size amplification explains all attacker cost. This is my second candidate for a bounded spike, with a high chance of being rejected on overhead.

## C3 — History-dependent transport of a joint live-state representation

**Mechanism.** Keep a group of mutually dependent internal numeric values in a joint representation. Transitions compute new represented state directly, and choose subsequent representation maps from actual prior input/state relations. Different histories reaching the same externally visible state can retain different internal representations. Consumers operate on the represented tuple; there is no routine that reconstructs all original coordinates before ordinary execution. The state, continuation and output relation must be transformed together.

**Cheapest defeat.** Track the map alongside the execution, recover its inverse, then normalize each transition. If maps are affine, chosen-input linear algebra is an obvious reusable attack. Nonlinearity alone does not help when emitted transition formulas reveal a cheap inverse. A dynamic attacker can attach a second representation tracker at essentially legitimate cost. Public randomness or a runtime “key” never becomes a secret here.

**Cost and exactness.** Limit maps to integer tuples with proved domains and unobservable storage. Object references, closure identity and numeric exceptional values must remain native until a proven representation exists. Reentrant calls require activation-local maps. More expensive maps charge legitimate runtime too, so multiplying work on both sides cannot meet the objective.

**Falsifier.** Build a generic transport tracker given compiler code and arbitrary histories, then recover both transition semantics and a chosen predicate edit. Reject as soon as one tracker normalizes different seeds/histories with roughly linear overhead. I expect this to collapse to the old masking problem unless C1 or C2 removes the very coordinates the attacker would track; it is not an independent selection.

## C4 — Implicit output relations compiled into specialized search

**Mechanism.** Express a bounded pure region as constraints whose unique solution is the next output/state. Partially evaluate the solver with those constraints and emit the residual search circuit, rather than shipping a generic solver plus a conspicuous program description. Necessary source branches become relations among several unknowns. The reconstruction target is a simpler functional form or a targeted modification of the relation.

**Cheapest defeat.** Extract constraints and invoke a standard solver, or observe elimination order to recover the original dataflow. If the emitted search has a shared “assignment/update” loop, this is another interpreter under a new name. If partial evaluation eliminates all search, the proposal reduces to C2. A constraint encoding can make one edit easier because its logical condition is explicit.

**Cost and exactness.** Unique, total solutions must be checked for the exact admitted domain; no nondeterministic or approximate results. Resource exhaustion cannot change observable behavior. General JavaScript effects and identity are outside the constraint core. Worst-case search and proof costs are likely incompatible with ordinary apps.

**Falsifier.** Before implementing an emitter, encode three real relations and give their emitted constraint representation to an extraction/solver attack. Kill if a compact executable model or rule edit emerges directly, or if solver cost dominates legitimate execution. I would reject this as a separate architecture unless a sharply bounded use case survives; no solver-hardness assumption is being claimed.

## C5 — Whole-component semantic quotient under fixed configuration

**Mechanism.** Treat a closed configured component as a relation over permitted inputs/effects, and compile away source distinctions that cannot affect that relation. Inline across the complete owned module graph, specialize configuration, merge equivalent branches and continuations, and remove unused object shape/identity only where nonescape is proved. The aim is destructive loss of source structure: several different original algorithms should genuinely map to the same artifact, rather than recoverable encrypted copies of their source.

**Cheapest defeat.** The attacker needs any useful equivalent algorithm, not the author's original choices. Successful optimization often makes the artifact simpler and a policy edit more local. Missing original names or dead code provides no advantage against behavioral reconstruction. Effect/API boundaries can retain enough structure for a straightforward explanation.

**Cost and exactness.** This requires whole-component ownership and a precise reflection/host contract. It cannot assume third-party authored modules are trusted host code or erase externally observed identity. Compile time may rise; runtime should normally improve. Its value is also ordinary optimization and removal of accidental disclosure.

**Falsifier.** Blindly ask attackers both original-source attribution and behavioral reconstruction/edit questions. Reject a protection claim if only exact original-source recovery becomes ambiguous while practical tasks get easier. Keep proven specialization as infrastructure for C1/C2, not as a third independent security idea.

## C6 — Necessary multi-algorithm state with adaptive consumer demand

**Mechanism.** Maintain different, legitimately useful summaries of a stateful computation, such as incremental summaries for multiple consumer operations. Fuse their maintenance and select future transitions according to actual consumer demand and previous effects. The compiler erases convenient boundaries between summaries only where all representations contribute to real future behavior. This tries to make a local edit require reconstructing several coupled invariants rather than disabling a guard or exposing a dead canonical copy.

**Cheapest defeat.** Separate the summaries by dependency slicing, infer each invariant, and use the public consumer calls to label them. If any maintained summary exists only to increase attack work, ordinary dead-code or output-directed slicing removes it. An attacker can specialize to the consumer/API they actually need, avoiding the whole-program task.

**Cost and exactness.** Only dependencies already required by the authored workload count. Adding redundant shadow computations makes a poor overhead trade. Updates must preserve transactional effects, callbacks and identity; failures halfway through cannot reorder observable writes. Shared state creates complex alias proofs.

**Falsifier.** Give the attacker both full-component and single-consumer goals. Kill if the latter cleanly slices away the coupling or if maintenance overhead explains the increased recovery time. This is a workload-selection hypothesis supporting C1, not an authorization to fabricate dependency.

## C7 — Distributed semantic edit constraints

**Mechanism.** Jointly derive several real output/state relations from the same intermediate facts, then represent those facts differently at separate consumer cuts. A chosen policy edit should require consistently changing multiple necessary consequences, not finding one comparison. Unlike checksum anti-tamper, there is no distinguished integrity check to bypass; inconsistency changes actual outputs or future behavior.

**Cheapest defeat.** Recover the common dependency once and rewrite all uses, exactly as a compiler would. With arbitrary artifact editing, patching a shared predecessor can be cheaper than editing each consumer. If the architecture deliberately duplicates one policy condition many times, a global semantic rewrite may still be one automated operation. A user who only needs one output can ignore the other consequences.

**Cost and exactness.** Consumer relations must be present in the original semantics. Do not introduce new failures on patched executions and then call that preservation of the original program. Duplication costs bytes and runtime; shared helpers can recreate an obvious cut point.

**Falsifier.** Assign a concrete policy edit and score all affected histories, including effects on later calls. Allow arbitrary global rewriting and independent behavioral replacement. Kill if a reusable dependency rewrite performs it cheaply. This is an evaluation task for C1/C2, not a third architecture.

## Provisional position before discussion

Spend the next architecture effort on C1 and C2 only if their first falsifiers are affordable. They target different missing structure: future-behavior state correspondence versus word-level computational relations. Combining them immediately would obscure which failed and multiply correctness work. C3–C7 supply attacks, workload constraints or compiler infrastructure, but have obvious routes back to masking, generic interpreters, ordinary optimization, or redundant work. No candidate claims to keep an offline program's behavior secret, and a failed early experiment should stop that candidate even if it sounds more ambitious than the regional prototype.
