# S1 — Compiler semantics and whole-program transformation

Round 1 independent brief, 2026-10-09. This is a proposal for prototype investment, not evidence of stronger protection. No peer proposals were consulted.

## Findings and constraints

The strongest reusable asset is the September snapshot's semantic frontend, not its boundary-witness machinery. At `f7f52c8`, `compiler/ir.ts:43-119` separates canonical operations, typed completion edges, source origins, and function units. `compiler/semantic-signatures.ts:169-199` records coercion, throwing, suspension, allocation, and state access. `compiler/direct-call-targets.ts:126-143,597-617` conservatively derives call identities and forgets mutable facts after user code. `compiler/call-graph.ts:163-182,253-260` makes those facts explicit.

However, `isogloss/effect-graph.ts:119-161` creates one codelet per canonical node. `compiler/regions.ts:476-517` blocks fusion at every call, object/scope access, allocation, throw possibility, and nontrivial control transfer. These are sensible opcode-level defaults, but prohibit transformations that become safe after value and alias analysis. Source ownership (`isogloss/source-ownership.ts:24-61,89-93`) establishes responsibility, not difficulty of recovery. The source-module graph inventories authored and host modules (`isogloss/source-module-graph.ts:70-101`); it does not by itself establish immutable cross-module call targets.

The regional emitter already avoids universal semantic dispatch, but its guarded BPRF path exposes candidate input/output arrays (`runtime/regional-artifact-emitter.ts:1468-1585`). Its general fallback remains another recovery target. The snapshot is not a working baseline until the missing loop-layout implementation is repaired and qualified; this brief did not rerun its broken qualification.

## S1-A — Proof-scoped cross-function semantic fusion

**Mechanism.** Add an owner-only value/effect SSA layer after canonical compilation. Values carry proven types, integer ranges, closure targets, and allocation identities; effect tokens carry alias sets, normal/abrupt completions, and reentry dependencies. Unknown facts remain conservative. Compute bounded context-sensitive summaries, then inline nonescaping, exactly resolved calls across functions and protected modules. Substitute private bindings, propagate constants and guards, and reschedule only independent nonthrowing work. Repartition the resulting graph around actual effects, rather than original function boundaries. Emit specialized direct code from this graph without an operation dispatcher.

Start with acyclic synchronous calls and immutable initialized module bindings. Do not speculate through live mutable exports, cyclic initialization, top-level await, `eval`, or unknown calls. No duplicated getters or coercions; guards inspect already evaluated primitive values. An unsupported optimization remains fully owned by the general protected lowering.

**Why it may help.** Caller and callee no longer provide reusable argument/result cutpoints. Constant and consumer specialization can eliminate original intermediate results entirely. An attacker must recover a larger context-dependent relation instead of transplanting a function hook. This is a hypothesis: ordinary inlining and simplification can also make the resulting program easier to understand.

**Strongest bypass.** Instrument the fused graph and normalize it to SSA; slice from observable results. Reuse the artifact unchanged when that satisfies the attacker's goal.

**Cost and experiment.** Bound cloning, first at two contexts per call target and 2× total IR growth. Compare 20 multi-function workloads across ten builds: unchanged compiler, fusion alone, and fusion plus the selected runtime protection. Attackers get emitted bytes and compiler knowledge. Measure recovery quality, attack CPU, queries, analyst time, and cross-build transfer separately. Kill the protection rationale if normalization recovers equally reusable models within 2× baseline attack CPU without increasing analyst work; retain only demonstrated performance benefits. Semantic mismatch is an immediate implementation veto.

## S1-B — Eliminate private heap and closure structure

**Mechanism.** Use S1-A's alias and escape facts to scalar-replace internal ordinary records and closure environments. A source object such as `{acc, index, phase}` becomes independent SSA values; closed helper closures become direct specialized continuations. Across joins, preserve value relationships with explicit SSA merges. Erase unused fields, eliminate redundant stores, and fuse the remaining values with consumers. Allocation identities remain abstract until observability requires a real object.

For the first implementation, optimize only objects proven never to escape and accessed through known own data properties. Unknown keys, accessors, prototype mutation, proxy exposure, identity-sensitive operations, weak references, and dynamic scope block eligibility. Do not introduce a general object-emulation runtime. Later partial escape support must materialize once with exact descriptors, identity, insertion order, and alias updates; defer it now.

**Why it may help.** Debugger heap snapshots lose the original records and closure-cell schema, and copying a recovered helper no longer includes its source-shaped environment. The computation survives, but its natural decomposition disappears. This is useful only if the larger dataflow is harder to recover, not merely if property names vanish.

**Strongest bypass.** Backward slice from external writes and outputs, reconstruct abstract fields from dependencies, or treat the artifact as the replacement implementation. Objects legitimately crossing the host ABI remain visible.

**Cost and experiment.** Scalar replacement may reduce allocations but increase live ranges, generated locals, and JIT pressure. Cap live-value growth and reject pathological plans. Test stateful parsers, record-processing loops, and closure-heavy iterators, with negative cases for reentry and aliasing. Compare heap-assisted recovery and general taint recovery. Kill this as a protection feature if the same attacker reconstructs state transitions with unchanged tooling effort, or if eligible private state is negligible on representative programs. Preserve profitable optimizations separately.

## S1-C — Validated whole-island resynthesis

**Mechanism.** After S1-A/B, select bounded primitive islands and synthesize a different necessary computation graph: jointly lower producer and consumer Boolean/bitvector expressions, share intermediate predicates differently, and choose between branch and select realizations where both arms are proven effect-free. Validate the whole island against the original relation with exhaustive small-domain checking or a solver-backed bitvector equivalence query. Proofs and source mappings stay owner-side. Unsupported or timed-out candidates are discarded before publication.

This is deliberately broader than per-operation algebraic masking, but narrower than arbitrary-JS synthesis. Number arithmetic is never silently interpreted modulo 2³². Respect overflow, negative zero, NaN, BigInt separation, and coercion order; use existing guarded-domain contracts (`compiler/pure-region-lowering.ts:43-88,140-143`) as the starting boundary. Do not ship an easier, source-shaped numeric fallback beside the resynthesized island: its fallback must traverse the same general protection pipeline and be attacked independently.

**Why it may help and strongest bypass.** Necessary graph variation may frustrate an extractor trained on one compiler form. A public rewrite library, symbolic normalizer, or bitvector synthesizer may erase every variant efficiently. Diversity counts are not evidence. Small-domain functions remain learnable from chosen inputs.

**Cost and experiment.** Limit initial islands to 64 operations and a fixed solver budget; allow at most 1.5× island operation count. Train the attacker on several builds, then evaluate held-out builds and fresh programs. Kill if normalization removes the diversity, transfer remains unchanged, or any gain comes solely from extra operations. Defer production adoption until that comparison succeeds.

## Cohesive integration and exactness boundary

Use one pipeline: ownership → canonical IR → value/effect SSA → S1-A/B → optional S1-C → runtime layout/emission → semantic validation → atomic publication. The shared interface must provide input facts, value liveness, effect dependencies, exceptional exits, observable identities, reentry/suspension points, and many-to-many source ownership witnesses. Existing one-node/one-codelet verification must be replaced by transformation validation, not weakened into count matching. Resource and attack budgets belong to one planner, not independent toggles.

Exactness also needs an explicit decision before qualification. ECMAScript `Function.prototype.toString` returns available source text; preserving original-source reflection exposes the very body being protected. Escaped function reflection therefore cannot silently become a generated wrapper string under an unrestricted exactness claim. Either preserve and disclose that leakage, or reject programs/deployments whose required original-source reflection cannot be preserved under the protection contract. A narrower reflection contract requires an explicit product decision. [ECMA-262, §20.2.3.5, live draft consulted 2026-10-09](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-function.prototype.tostring).

Retain ownership, conservative signatures, exact fallback semantics, and publication checks. Replace source-shaped partitioning and witness-count strength claims. Prototype S1-A first, S1-B next; defer S1-C until a competent normalizer fails the cheaper candidates. All three remain offline analysis-cost proposals with substantial uncertainty, and none prevents unchanged-artifact reuse.
