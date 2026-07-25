# PR 8 Isogloss versus pre-PR-6 VM benchmark

This report compares PR 8's full-language Isogloss architecture with the frozen
legacy VM at `e8cecb56ba89d47512a16e325d81cf46f64b2ecb`, the final implementation
commit before PR 6 production work began. The reproducible harness is
`packages/ruam/scripts/bench-architectures.mjs`; complete measurements are in
the adjacent JSON file.

## Scope and interpretation

Nine workloads exercise finite-pure arithmetic, control flow, recursion and
closures, strings/arrays/objects, classes with private state and `super`,
exceptions/proxies/coercion, generators, async/await, and a hybrid function
containing both a protected pure return and an effectful native return.

The harness measures median build time, one-time bootstrap, steady calls, raw
and gzip output bytes, correctness, Isogloss lane counts, and legacy unsupported
cases. It uses 7 build rounds, 11 timing rounds, and 10 calls per timing round.
Every executable comparison is checked against native JavaScript first.

These are engineering measurements, not a claim of equal protection. A native
Isogloss region preserves general JavaScript directly and is expected to be
near native speed and source size; the legacy VM attempted to virtualize its
supported functions. BPRF and hybrid rows are the closer representation-cost
comparison. The local Isogloss profile remains client-complete and makes no
hardness or secrecy claim.

Environment: Apple M5, 10 logical CPUs, 24 GiB memory, macOS/Darwin 25.3.0,
arm64, Bun 1.3.11. The benchmark process reported Node v24.3.0.

## Aggregate results

All nine Isogloss workloads produced the native result. The old VM supported
seven; it could not compile the private-class and generator workloads.

| Metric | Isogloss | Legacy default | Legacy medium | Legacy max |
| --- | ---: | ---: | ---: | ---: |
| Correct/supported workloads | 9/9 | 7/9 | 7/9 | 7/9 |
| Median build time | 0.227 ms | 2.396 ms | 3.838 ms | 13.973 ms |
| Build-time advantage | — | 10.6x | 16.9x | 61.7x |
| Geometric runtime overhead vs native | 2.57x | 38.84x | 36.93x | 95.32x |
| Geometric Isogloss speedup on common rows | — | 13.16x | 12.51x | 32.30x |
| Output bytes on the seven common rows | 26,377 | 96,834 | 127,661 | 335,889 |
| Isogloss byte reduction on common rows | — | 72.8% | 79.3% | 92.1% |

Across the seven entirely native Isogloss rows, geometric runtime overhead was
1.13x. The aggregate 2.57x figure rises because it also includes the deliberately
protected BPRF and hybrid hot loops.

The verified package build produced 172,080 bytes across JavaScript and
declarations, versus 570,393 bytes in the frozen VM baseline: 69.8% smaller.
Looking only at executable JavaScript, Isogloss emitted 152,335 raw / 36,138
gzip bytes versus 559,243 raw / 106,483 gzip bytes for the old VM, reductions
of 72.8% and 66.1% respectively. Declaration output grew because the current
public result includes explicit Isogloss diagnostics and lane statistics.

## Workload results

Times below are median milliseconds per `work()` call. “Unsupported” means the
legacy transformer or emitted program failed; the exact error is retained in
the JSON.

| Workload | Isogloss lane | Native | Isogloss | VM default | VM max | Isogloss bytes | VM default bytes | VM max bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BPRF arithmetic hot loop | BPRF + native driver | 0.022 | 0.920 | 2.756 | 11.495 | 15,768 | 15,050 | 66,323 |
| Arithmetic/control flow | Native | 0.060 | 0.071 | 15.091 | 50.317 | 307 | 13,809 | 44,587 |
| Recursive closures | Native | 0.296 | 0.269 | 14.748 | 40.895 | 229 | 15,469 | 41,539 |
| Strings/arrays/objects | Native | 0.599 | 0.577 | 10.052 | 27.405 | 306 | 17,108 | 52,215 |
| Classes/private/`super` | Native | 0.663 | 0.670 | Unsupported | Unsupported | 568 | — | — |
| Exceptions/proxy/coercion | Native | 2.061 | 2.052 | 2.024 | 2.039 | 577 | 577 | 592 |
| Generators/iteration | Native | 0.059 | 0.145 | Unsupported | Unsupported | 225 | — | — |
| Async/await | Native | 0.021 | 0.019 | 0.624 | 0.909 | 164 | 19,555 | 61,468 |
| Pure/effectful hybrid | Hybrid | 0.014 | 0.691 | 2.447 | 8.503 | 9,026 | 15,266 | 69,165 |

The proxy/coercion row is intentionally revealing: the old default output is
the same size and speed as source because that function also remained native.
The harness reports this rather than crediting the VM with protection it did
not apply.

## Reproduction

From `packages/ruam`:

```sh
bun run bench:architectures
bun run bench:architectures -- --quick
bun run bench:architectures -- --legacy-preset default
bun run bench:architectures -- --json ../../docs/superpowers/baselines/result.json
```

The script creates a temporary detached worktree for the legacy ref, shares the
current dependency installation read-only through symlinks, loads the old public
API directly, then removes its worktree. It does not restore any VM code to the
current product.
