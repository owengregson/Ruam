# Implementation review record

The implementation was divided among three workers: A owned bounded compiler recipes, B owned graph/cost/final-byte/publication code, C owned baseline and recovery qualification. The coordinator integrated public APIs, the CLI, browser protocol, disk inventory and documentation. Reviews crossed ownership boundaries and used concrete counterexamples.

## Findings fixed before the PR

| Finding | Correction and regression |
| --- | --- |
| Legacy stack XOR erased negative zero | Box `-0`, retaining the allocation-free int32 path for other numbers; nested calls, arrays and reciprocals across both encoded-stack and max configurations. |
| Inlining a call in a default parameter introduced a body-local temporary too late | Decline fusion outside the owning function body and across implicit class activation boundaries. |
| Generic bitwise syntax was mislabeled as Number/int32 despite possible BigInt | Require Number-forcing authored operations before crediting the joint recipe. |
| Sloppy Annex B block functions can mutate bindings marked constant by Babel | Conservatively decline affected bindings; include block, conditional and parameter-binding counterexamples. |
| Transformation or declaration removal could create a new `use strict` directive | Preserve parsed directives and guard newly leading string statements without changing their completion value. |
| Known `require` aliases and CommonJS globals escaped admission checks | Reject known aliases consistently across the core and final graph pipeline; no claim of complete arbitrary capability-flow analysis. |
| Graph resource options could exceed core hard ceilings | Align validation and add cap regression cases. |
| UTF-16 lone surrogates could change when written as UTF-8 | Reject non-roundtrippable source strings; escaped surrogates and astral characters remain accepted. |
| File decoding omitted a UTF-8 BOM from source provenance | Preserve the BOM in the inventoried source and compare hashes against original file bytes. |
| Falsy invalid browser modes silently selected legacy compilation | Only an omitted mode defaults to legacy; explicit invalid values and misplaced regional options return errors. |
| SSA formatting of a wrapper could earn recovery credit while retaining an interpreter | Require substantive reduction and a narrow admitted residual grammar; switch and recursive interpreter counterexamples earn no recovery credit. |
| Missing timer APIs made historical max outputs fail the scorer | Use an explicit public-entry adapter and real timer APIs with synchronous-boundary cleanup; rerun historical baselines. Background guard behavior remains outside that protocol. |

## Recorded local evidence before PR review

- Library and web TypeScript checks passed.
- The full existing and new suite passed 2,395 tests before the last review regressions were added; the updated regional suite then passed 69 tests with 1,126 assertions.
- Library build/declarations and browser-worker bundling passed. Built Node API/publication checks preserved signed zero across four seeds.
- Final qualification produced 576 successful behavioral runs over 30 unique artifacts, 480 static recoveries and 128 oracle recoveries (overlapping). Every dependent/configuration family reached the cheap-recovery stopping condition. The source hashes were stable during that run and matched the reviewed working files.
- Main and PR5 selected baseline behavior each passed 10/10 runs. PR7's ordinary rows had no protected regions; its separate declared-domain probe did. WIP restoration stayed isolated and recorded passes and timeouts without resistance credit.

These checks do not establish real-browser behavior, whole-source protection, unrestricted equivalence or a security multiplier. The research outcome is **NO-GO for expansion**. The production VM remains the default. PR-head review approvals and remote CI results are recorded on the PR separately; this pre-review record is not a fabricated GitHub approval.
