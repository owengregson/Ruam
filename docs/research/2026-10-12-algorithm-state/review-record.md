# Review record

The coordinator implemented the frozen-audit verifier and report runner. Separate agents inventoried roots, built the sidecar attack, and investigated architecture alternatives. Two agents independently reviewed the combined preflight change. These are agent reviews, not external human security audits or GitHub maintainer approvals.

## Findings resolved before publication

- Audit evidence initially accepted malformed source-line ranges and non-descriptive contract fields. Validation now requires ordered positive integer line pairs, verifies line bounds, and accepts only meaningful text descriptions.
- A declared Git hash initially identified source blobs without proving the object was a commit. The verifier now checks the object type and all frozen blobs. Tests reject a matching tree object and recomputed current-file digests that disagree with the baseline.
- The output path could initially alias and overwrite an input after the provenance check. The runner now checks canonical destinations before and after evaluation, refuses source/unrelated-file/symlink overwrites, and publishes through a uniquely owned staging directory. Regression tests cover source paths, ancestor aliases, symlinks and existing reports.
- Resource labels now distinguish heap-used deltas and platform-normalized process peak RSS. VM timeout results disclose that child CPU and memory are unavailable. Esbuild service costs and model/analyst authoring costs are not represented as measured zero.
- Artifact provenance now includes the sidecar harness, production compiler sources, package metadata and lockfiles. The aggregate runner additionally binds the frozen manifest, verifier, runner and tests.

## Validation

The unchanged baseline passed 2,397 tests with zero failures. Focused preflight tests exercise stale/malformed evidence, provenance, output safety and the refusal to turn rejected roots into release approval. The executable sidecar tests compare public histories and require a plausible but incorrect patch to fail. Library build and monorepo typechecking are run before PR publication; GitHub CI must pass on the reviewed PR revision before merge.

No production VM implementation is replaced by this change. The reports explicitly retain NO-GO, full-current-JavaScript scope, unqualified protection, and no actual AI-trial credit. PR #14 passed CI, CodeQL and dependency review on its reviewed revision before merge.

## Native-lowering control review

The follow-up experiment was reviewed separately by two agents and the coordinator. A plain XOR-to-addition rewrite changed numeric coercion semantics for nonstandard character providers. The edit now explicitly preserves Number coercion, and its owner oracle is constructed independently of the attack edit.

A second finding showed that extracting an ESM function into an ordinary script silently removed strict-mode behavior. Both the lowered code and its initial extracted oracle shared the defect. The control now emits strict scripts and checks the actual imported ESM function independently. The review reproducer using a sloppy callback's `arguments.callee.caller` agrees across imported, extracted, lowered and recovered versions.

The reviewers also demonstrated a callback that inspects `deriveSeed.toString()` and distinguishes the continuation realization. This is retained as a known compatibility failure and a regression test, rather than excluded silently or described as full-scope equivalence. These controls justify rejecting simple continuation flattening as the replacement's protection mechanism; they do not certify the broader G1 proposal.

The combined qualification tests pass 14 tests and 125 assertions. Monorepo typechecking passes. The regenerated report validates lowering, recovery and the partial edit on 378 scenarios each, records the separate reflection counterexample, and binds all eight qualification inputs to their current hashes. A default qualification run writes its report and exits 2 for NO-GO; `--report-only` exits 0 without authorizing release.
