# Novel algorithm and representation experiments

This round separates three independent ideation lanes from the resumed native-backend application checks. No candidate has qualified as an AI-resistant VM replacement. Production APIs, presets and the existing JavaScript scope remain unchanged. Private application source, generated artifacts, semantic fixtures and detailed component specifications remain outside this repository.

The earlier selected [algorithm/state design](../2026-10-09-ambitious-swarm/20-selected-design.md) and [full-scope architecture](../2026-10-12-algorithm-state/architecture.md) remain the constraints. A narrow optimization can decline an input while the general backend preserves compatibility; that residual code does not thereby receive protection credit.

## Independent slate and cross-review

Each lane formed its initial proposals before reading the others. Review then distinguished a different algorithm from a different encoding, checked the actual private application's effects and ownership, and identified a conceptual falsifier. These are design assessments, not executed deobfuscation or AI-attack results.

| Direction | Concrete difference | Review gate |
| --- | --- | --- |
| Observation-directed numerical evaluation | Prove the branch decisions required by an iterative calculation with conservative bounds; refine in original order when undecided. | Preserve the exact floating-point probes and results. Skipped reads and intrinsic calls require an ownership/effect proof. An exposed exact reduction gives this no standalone protection claim. |
| Coupled latent-function synthesis | Replace several internal producers and consumers under one relation; individual old intermediate functions need not survive. | Prove all source effects and the whole output relation. Replacing each old predicate independently, or moving unchanged predicates to the region boundary, fails the premise. |
| Monotone heap materialization | Keep a different internal representation only until the first possible observer; materialize stable native identities and keep them authoritative afterward. | Retained aliases, getters and reentry prevent arbitrary read-back and re-virtualization. Frequent publication can eliminate the private region completely. |
| Ordered resource/lifetime algebra | Replace a closure map and its consumers with ordered resource cells, cancellation capabilities, a draining generation and count views. | Preserve cancellation during disposal, reentrant observations, exception order and scheduler effects. Mutable collection hooks can require recreating the original representation. |
| Noncommutative permutation programs | Realize a finite control relation with products of input-selected permutations rather than local arithmetic identities or independent tables. | First check actual sequence length and whole-root cost. A small exposed classifier remains small even when its implementation is longer. |

Effect-ordered whole-component supercompilation was also considered. It overlaps earlier fusion proposals and is a construction technique for the coupled-relation lane, not a separate defense. The reviewers favored a bounded numerical correctness experiment immediately and a separate admission/specification experiment for coupled relations. Neither vote authorizes a general synthesis backend or default replacement.

## Exact numerical experiment

A private owner-side specimen changes how an existing reduction-based search determines its branch outcomes. It keeps the original bracket updates, probe sequence, tolerance rule and final map. A source-order prefix supplies a lower bound; a directed-rounded remainder estimate supplies an upper bound. An undecided query continues the original reduction order. The classifier must distinguish below, within and above the tolerance region; two false endpoint tolerance tests alone cannot classify an interval spanning the target.

The declared experimental domain is owned dense arrays of positive finite primitive numbers, at most 4,096 elements, with bounded magnitudes and ordinary captured intrinsics. These are experiment assumptions, **not source-proved production admission**. Value checks cannot prove ownership or exclude proxies, getters, sparse arrays, reentrant mutation and mutable intrinsic effects. No public pass or application change uses the specimen.

Its initial Node 25.6.1 corpus checked 1,523 cases, 16,715 authored probes and 5,234 interval certificates with 62,994 assertions. The deliberately incorrect bound was rejected; source and harness hashes were unchanged. It omitted 137,070 of 697,143 reference reduction terms while adding 79,268 interval evaluations, 16,715 maximum-term products and a separate summary scan. Those counts do not establish a runtime speedup. The source-order refinement remains a straightforward calculation, so the specimen is not advanced as a standalone protection mechanism.

An independent reviewer additionally checked 464 whole-search cases, 87,902 output elements, 38,439 suffix enclosures and 1,537 certified intervals, with no in-domain mismatch. Getter-index access and a custom iterator produced two expected outside-contract semantic mismatches. These are concrete reasons why numeric value checks cannot be promoted to general JavaScript admission. No prototype is enabled in the compiler.

## Coupled-relation eligibility specimen

A separate owner-side specimen evaluated an actual producer/consumer window before attempting synthesis. It checked 640 source scenarios and 7,562 assertions in Node 25.2.1. This is a finite source-conformance sample, not an exhaustive model of the JavaScript API or candidate equivalence evidence.

The specimen confirms that conditional property reads, provider calls and state/output observations constrain the proposed relation. An eager extraction of branch inputs was rejected even when its output values matched, because its observable read trace differed. A zero-output path still performs a required provider call. Omitting that call is not a valid optimization.

For this nominated window, a nontrivial jointly replaceable latent function has not been established after retaining the required effects. The remaining obvious pure selector is too small to support the intended protection hypothesis. No candidate was emitted, and no circuit solver or attack was run. This fails this window's admission gate; it does not prove all coupled-relation synthesis impossible. A new root must first show both a source-proved private computation region and useful joint freedom across multiple consumers before implementation expands.

## Resumed native application validation

The opt-in acyclic native emitter from [PR20](https://github.com/owengregson/Ruam/pull/20) was compiled from main commit `bb588c7daa58636cd8e6093891c66410e291639e` against the same five frozen ordinary webpack entry bundles used in the prior private workload. The archive digest was checked before restoration. Each new compilation binds the input, compiler source files, lockfile, package manifest, harness, runtime and output hashes; compiler and input snapshots matched before and after compilation.

Options were `target: "browser-extension"`, `targetMode: "root"`, `seed: 71`, and `acyclicLowering: true`. All five entries compiled: 2,005 units and 108,833 logical instructions. Scalar emission covers 585 units / 9,019 instructions, including 479 acyclic units / 8,773 instructions. The remainder still uses the candidate's general native semantic machinery; these counts do not measure protected scope.

| Emitted-entry gate | Result |
| --- | --- |
| Service worker, 28 repository test files | 29 passed, zero failed or skipped |
| Panel, 10 repository test files | 62 passed, zero failed or skipped |
| Portal, one repository test file | 11 passed, zero failed or skipped |
| Two private content scenarios | Two passed, 56 assertions |

The service-worker artifact is 6,030,465 bytes, SHA-256 `6bbd57b6cb425898b1af7326ea4e1e83c5b27f4092308ac64e89d55867bb1064`. Its previously failing fixed-deadline interruption tests pass in this run. The host was rebooted and its load changed substantially between runs, so this does **not** isolate a compiler performance improvement or erase prior timing failures. No deadline was relaxed.

The same frozen ordinary bundles passed the same gates again in this round, with identical test counts. This is a comparison to ordinary webpack inputs, not a new current-head max-preset VM comparison. The private application repository tests run in separate Bun processes using hash-checked entry substitution. Some assertions still exercise source helpers; substitution loading is established per file. The additional content scenarios use Happy DOM and the private application's simulator. Complete transitive dependencies and host state are not frozen. This round does not establish native Chrome behavior, complete application coverage, release readiness or extraction resistance. The application source subtree was unchanged.

## Research basis and limits

- [eSLIM, SAT 2024](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.SAT.2024.23) provides a Boolean-relation approach to multi-output circuit resynthesis. Its circuit correctness mechanism does not establish JavaScript effect preservation or a protection advantage.
- [Sequential observability don't-care synthesis, TCAD 2025](https://people.eecs.berkeley.edu/~alanmi/publications/2025/tcad25_seq.pdf) motivates proving reachability and internal freedom rather than treating untested states as don't cares. The application to JavaScript is a proposed adaptation.
- [Partial Escape Analysis and Scalar Replacement for Java](https://ssw.jku.at/Research/Papers/Stadler14/Stadler2014-CGO-PEA.pdf) supports selective virtual objects and materialization as a compiler technique. JavaScript's exposed aliases and mutable operations still require a separate admission proof.
- [Ownership Confinement Ensures Representation Independence](https://arxiv.org/abs/cs/0212003) explains the role of confinement in representation independence for its specified language; it does not establish confinement in this application.
- [Barrington's bounded-width branching programs](https://publications.csail.mit.edu/lcs/pubs/pdf/MIT-LCS-TR-361.pdf) provides an alternative exact basis for bounded-depth Boolean computation. Expressiveness is not one-wayness or an AI-resistance guarantee.
- [Hierarchical Boundary Recovery, DAC 2026](https://people.eecs.berkeley.edu/~alanmi/publications/2026/dac26_hie.pdf) reconstructs boundaries with both specification and synthesized implementation available. This is not an artifact-only Ruam defeat; it cautions against treating removed helper signals as evidence of security.

The next protection decision depends on a substantive coupled relation surviving its admission and resource gates, followed by separate protection qualification. A correctness pass, different data structure, erased helper name or larger artifact cannot substitute for that evidence. The previous blocked extended attack evaluation was not retried in this round.
