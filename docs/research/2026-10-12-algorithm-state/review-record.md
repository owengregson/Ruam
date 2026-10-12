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

No production VM implementation is replaced by this change. The reports explicitly retain NO-GO, full-current-JavaScript scope, unqualified protection, and no actual AI-trial credit. The separate native-lowering experiment is reviewed and published independently.
