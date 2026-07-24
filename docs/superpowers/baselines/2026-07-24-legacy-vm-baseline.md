# Ruam legacy baseline for Traveling Isogloss

Baseline commit: `e8cecb56ba89d47512a16e325d81cf46f64b2ecb` (`docs: plan full traveling isogloss replacement`). This is the last commit before production implementation began. Measurements were repeated from a detached worktree after a parallel implementation commit landed during the initial pass.

## Status

| Check | Result | Wall time |
|---|---:|---:|
| `bun run typecheck` | pass, 0 diagnostics | 2.20 s |
| `bun test` | 2,328 pass, 0 fail, 4,819 assertions, 44 files | 11.38 s |
| `bun run build` | pass | 3.09 s |
| `bun scripts/bench.mjs --quick` | 32/32 workload/preset correctness checks pass | 48.39 s |
| `bun scripts/bench-attribution.mjs` | 18/18 configuration correctness checks pass | 19.49 s |
| `node scripts/collect-stats.mjs --all` | pass in isolated copy | 14.98 s |

Environment: Apple M5 (10 logical CPUs, 24 GiB), arm64 macOS/Darwin 25.3.0, Bun 1.3.11, Node v25.6.1, TypeScript 5.9.3, tsup 8.5.1.

## Runtime baseline

The dedicated quick harness reports aggregate execution-only overhead of **48.2x default**, **50.5x low**, **52.6x medium**, and **171.6x max**. Bootstrap medians were 0.038 ms, 0.045 ms, 0.129 ms, and 0.246 ms respectively. Worst execution-only overhead was 69.2x default, 74.5x low, 76.8x medium, and 206.4x max.

The test-suite performance group independently reported 41.1x weighted average and 40.8x median overhead (21.6x fastest, 102.5x slowest). The stats collector reported 25.5x weighted average and 40.9x median across its own smaller ten-workload suite. These harnesses use different workloads and timing methods, so their values should not be combined.

## Output-size baseline

The dedicated harness emitted 11.1–18.3 KiB per default workload, 11.5–19.0 KiB at low, 16.0–26.0 KiB at medium, and 35.3–58.3 KiB at max.

The built package totals 570,393 bytes: main shared chunk 535,347 bytes (100,251 gzip), CLI 23,611 bytes (6,076 gzip), entry 285 bytes (156 gzip), and declarations 11,150 bytes.

For the stats collector's 110-byte Fibonacci sample: low is 12,842 bytes (116.7x), medium is 18,848 bytes (171.3x), and its field named `high` is 12,450 bytes (113.2x)—but that final metric is invalid for max because the script passes unsupported preset `high`.

## Script findings

- `collect-stats.mjs` silently mislabels a default-like build as “high”; valid presets are `low`, `medium`, and `max`. Its high/max size badge is not authoritative.
- Benchmark outputs are entropy- and timing-sensitive. The attribution harness uses one fresh randomized build per configuration and only 12 measured iterations, producing implausible negative feature costs for several flags. It is a smoke/attribution signal, not a stable causal estimate.
- `collect-stats.mjs` benchmarks whenever `dist/index.js` exists, even without `--bench`, contrary to its usage text.
- No command crashed or produced a correctness mismatch in the authoritative run.

Machine-readable details, every workload/configuration, exact timings, output hashes, and raw-log hashes are in `/tmp/ruam-isogloss-baseline.json`. The main tracked worktree was clean after collection.
