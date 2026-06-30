# Anti-AI-Decompilation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Ruam against generalized AI decompilation by attacking the four attacker primitives (recognize / lift-and-run / observe-at-a-tap / oracle) rather than patching transcript-specific steps.

**Architecture:** Six workstreams (W0–W5) layered onto existing seams — directory pipeline (`cli.ts`), 2-pass compilation (`transform.ts`), implicit-key fold (`compiler/rolling-cipher.ts` + runtime mirror), handler-table/dispatch (`ruamvm/builders/interpreter.ts`), wire format (`compiler/encode.ts` + `ruamvm/builders/deserializer.ts`), and key burial (`ruamvm/scattered-keys.ts`). New cross-file cohort plumbing + `obfuscateBundle` API is the spine for W4/W5.

**Tech Stack:** TypeScript (strict, ESM, `.js` import paths), bun + bun:test, Babel parse, purpose-built JS AST emitter (`ruamvm/`).

## Global Constraints

- All-seeds + any-file-ordering correctness; **no flaky tests** (a failure = a real bug).
- `deriveSeed(seed, "id")` for every PRNG stream; never ad-hoc `seed ^ const`.
- `NameRegistry` for every emitted identifier (incl. new shared-global / accumulator / fragment names).
- No `eval` / `new Function` / `debugger`; CSP / Trusted-Types safe; never break `target:"browser-extension"` IIFE output.
- **No size-bloat-to-fill-context** — compact arithmetic/closure forms only; no bulk code injection.
- Build==runtime fold symmetry for every new fold; exhaustive all-seeds equality test required.
- Watermark integrity: compose around `WM_OFFSET`; do not change the FNV offset basis.
- Additive API only — `obfuscateCode`/`obfuscateFile` signatures unchanged.
- Run `cd packages/ruam && bun test` (full suite, ~2328 tests) green before each commit that touches runtime; `bun run typecheck` before PR.

---

## Phase W0 — Source-map / cleartext-leak gate

### Task 0.1: Strip source maps in directory/bundle output

**Files:**
- Modify: `packages/ruam/src/cli.ts` (`obfuscateDirectoryWithProgress` ~897–1013)
- Modify: `packages/ruam/src/types.ts` (add `keepSourceMaps?: boolean` to CLI/dir options, not core)
- Test: `packages/ruam/test/security/source-map-gate.test.ts`

**Interfaces:**
- Produces: directory output contains no `*.map` files and no `//# sourceMappingURL=` lines unless `keepSourceMaps`.

- [ ] **Step 1:** Write failing test: obfuscate a temp dir containing `a.js` + `a.js.map` (with `sourcesContent`); assert output dir has `a.js` but no `a.js.map`, and `a.js` has no `sourceMappingURL`.
- [ ] **Step 2:** Run it; expect FAIL (map copied verbatim).
- [ ] **Step 3:** Implement: after globby discovery, delete matched-file sibling `.map` and any `.map` in the copied tree (unless `keepSourceMaps`); defensively strip trailing `//# sourceMappingURL=` from each emitted file.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(cli): strip source maps in directory mode (cleartext-leak gate)`.

---

## Phase W4-L1 — Cohort plumbing + `obfuscateBundle` API

### Task 4.1: `CohortContext` + `obfuscateBundle` skeleton (no security fold yet)

**Files:**
- Create: `packages/ruam/src/compiler/cohort.ts`
- Modify: `packages/ruam/src/index.ts` (add `obfuscateBundle`)
- Modify: `packages/ruam/src/transform.ts` (accept optional `cohort?: CohortContext`)
- Modify: `packages/ruam/src/cli.ts` (directory mode → `obfuscateBundle`)
- Test: `packages/ruam/test/security/cohort.test.ts`

**Interfaces:**
- Produces:
  - `interface CohortContext { cohortSeed: number; fileDigests: Map<string,number>; digestAll(): number; }`
  - `createCohort(files: {path:string; code:string}[], seed?: number): CohortContext`
  - `obfuscateBundle(files: {path:string; code:string}[], options): {path:string; code:string}[]` (sync)
  - `transform(...)` gains optional trailing `cohort?: CohortContext` param (back-compat default `undefined`).

- [ ] **Step 1:** Write failing test: `obfuscateBundle([{path,code}], opts)` returns one entry whose `code` round-trips via eval (reuse `test/helpers.ts` style).
- [ ] **Step 2:** Run; FAIL (no export).
- [ ] **Step 3:** Implement `cohort.ts` (seed via `deriveSeed(rootSeed,"cohort")`; per-file FNV digest of source bytes; `digestAll` = order-independent XOR/FNV fold) + `obfuscateBundle` looping `obfuscateCode`-equivalent with shared cohort; thread `cohort` through `transform`.
- [ ] **Step 4:** Run; PASS. Then run full suite.
- [ ] **Step 5:** Commit `feat: obfuscateBundle + CohortContext plumbing (no fold yet)`.

### Task 4.2: Fold cohort digest into key anchor (build + runtime mirror)

**Files:**
- Modify: `packages/ruam/src/compiler/rolling-cipher.ts` (`deriveImplicitKey` — add optional `cohortTerm`)
- Modify: `packages/ruam/src/ruamvm/builders/rolling-cipher.ts` (`buildDeriveKeyFunction` — mirror fold)
- Modify: `packages/ruam/src/transform.ts` (pass cohort digest term; bury via `scattered-keys`)
- Test: `packages/ruam/test/security/cohort.test.ts` (add symmetry + cross-bundle divergence cases)

**Interfaces:**
- Consumes: `CohortContext.digestAll()`.
- Produces: each file's runtime `rcDeriveKey` folds the cohort term post-avalanche, identically to build-time.

- [ ] **Step 1:** Failing test: same source in two different cohorts produces different encoded bytecode; and a file built in a cohort still round-trips (build==runtime symmetry holds).
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement post-avalanche `k = (k ^ cohortTerm) >>> 0` in both build + runtime AST (mirror exactly, like `keyAnchor`); bury the literal via `scatterKeyMaterials`.
- [ ] **Step 4:** Run; PASS across a seed loop (≥50 seeds). Full suite.
- [ ] **Step 5:** Commit `feat(cohort): fold bundle digest into key anchor (work-factor cross-file tangle)`.

---

## Phase W1 — Internal-oracle annihilation

### Task 1.1: Handler-table power-of-two padding + masked dispatch (kill "undefined opcode" tell)

**Files:**
- Modify: `packages/ruam/src/ruamvm/builders/interpreter.ts` (`buildHandlerTableMeta`, dispatch builders)
- Test: `packages/ruam/test/security/oracle-annihilation.test.ts`

**Interfaces:**
- Produces: dispatch resolves `_ht[PH & mask]` with table length a power of two, every slot executable (decoys fill holes); no decode-error path that signals a wrong key.

- [ ] **Step 1:** Failing test: introspect emitted interpreter; assert handler table length is a power of two and dispatch uses a mask (no equality-to-length guard that throws on out-of-range opcode). Reuse the AST-introspection pattern from `test/security/slot-save-restore.test.ts`.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement padding to next power of two with executable decoy handlers (reuse decoy injection) + `& mask` resolution; ensure opcode-mutation `_ht` density invariant preserved.
- [ ] **Step 4:** Run; PASS. Full suite (esp. opcodeMutation/blockPermutation max-seed tests).
- [ ] **Step 5:** Commit `feat(oracle): power-of-two masked handler dispatch (kill undefined-opcode tell)`.

### Task 1.2: Break cross-structural redundancy in the function table

**Files:**
- Modify: `packages/ruam/src/transform.ts` (function-record id ↔ routing mapping)
- Test: `packages/ruam/test/security/oracle-annihilation.test.ts`

**Interfaces:**
- Produces: the set of bytecode-record keys is no longer identically the set of routing keys and decoded-id strings (no triple-agreement completeness oracle), while dispatch still resolves correctly.

- [ ] **Step 1:** Failing test: assert record-key set ≠ routing-key set verbatim (e.g. via indirection / decoy records / id remap) yet all calls resolve.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement an id-indirection layer (decoy records and/or a permuted id→record map) so completeness can't be read off agreement; keep all real calls correct.
- [ ] **Step 4:** Run; PASS. Full suite.
- [ ] **Step 5:** Commit `feat(oracle): break record/routing/id triple-agreement completeness oracle`.

### Task 1.3 (SPIKE → gated): Encrypt deserializer count fields (resolve count-circularity)

**Files:**
- Modify: `packages/ruam/src/compiler/encode.ts`, `packages/ruam/src/ruamvm/builders/deserializer.ts`, `packages/ruam/src/compiler/index.ts`
- Test: `packages/ruam/test/security/oracle-annihilation.test.ts`

**Interfaces:**
- Produces: counts that do NOT seed key derivation are encrypted under the unit key and reconstructed as `raw mod actualBound`; a wrong key yields a plausible (not overrun) header.

- [ ] **Step 1:** SPIKE: identify which count fields feed `deriveImplicitKey` (those stay cleartext-but-folded) vs which can be encrypted. Document resolution in-code.
- [ ] **Step 2:** Failing test: a wrong unit key parses to a plausible header (no throw), and correct key round-trips, across a seed loop.
- [ ] **Step 3:** Implement; ensure decode cache path unaffected.
- [ ] **Step 4:** Run; PASS. Full suite.
- [ ] **Step 5:** Commit `feat(oracle): encrypt non-key-seeding count fields (kill coherent-header oracle)`.

---

## Phase W2 — Intra-build per-unit heterogeneity (SPIKE)

### Task 2.1: Per-unit decode-parameter divergence

**Files:**
- Modify: `packages/ruam/src/compiler/` + `packages/ruam/src/ruamvm/builders/` (per-unit sub-seed)
- Test: `packages/ruam/test/security/per-unit-heterogeneity.test.ts`

**Interfaces:**
- Produces: two units in one build do not share identical decode parameters (so a lifted per-unit pipeline does not replay across units), with zero per-dispatch branch overhead regression.

- [ ] **Step 1:** SPIKE: choose a per-unit-varying parameter that costs no hot-path branch (e.g. per-unit key salt already exists via metadata; extend with a `deriveSeed(seed, "unit:"+id)` term folded into that unit's key only).
- [ ] **Step 2:** Failing test: assert per-unit key terms differ across ≥2 units; all units round-trip.
- [ ] **Step 3:** Implement; benchmark fib at default/medium to confirm no regression beyond noise.
- [ ] **Step 4:** Run; PASS. Full suite.
- [ ] **Step 5:** Commit `feat: per-unit decode heterogeneity (defeat recover-once-apply-Nx)`.

---

## Phase W3 — Decode-path impurity (SPIKE → mandatory gate)

### Task 3.1: SPIKE — trace-dependent accumulator symmetry proof

**Files:**
- Create: `packages/ruam/test/security/impurity-symmetry.spike.test.ts` (proof harness)

- [ ] **Step 1:** Prototype a running accumulator folded from execution-trace quantities; build a build-time mirror.
- [ ] **Step 2:** Prove bit-identical build==runtime across ≥200 seeds AND across bun + node (+ a JSC/Hermes-shaped check if available). If ANY divergence → STOP; W3 does not ship.
- [ ] **Step 3:** Document the result in the spec's §7. Commit the spike test (passing or documented-blocked).

### Task 3.2 (only if 3.1 clean): Wire impurity behind `decodeImpurity` + mandatory build gate

**Files:**
- Modify: `packages/ruam/src/compiler/rolling-cipher.ts`, `packages/ruam/src/ruamvm/builders/rolling-cipher.ts`, `packages/ruam/src/ruamvm/builders/interpreter.ts`, options wiring.
- Test: `packages/ruam/test/security/impurity.test.ts`

- [ ] **Step 1:** Add `decodeImpurity` option (default-OFF; into `max` only). Implement a **build-time self-equality gate** that simulates the runtime accumulator and `throw`s at build time on any divergence.
- [ ] **Step 2:** Failing test: enabled build round-trips across a seed loop; disabled build unchanged.
- [ ] **Step 3:** Implement; gate decode-once cache OFF when enabled (per CLAUDE.md gating rules).
- [ ] **Step 4:** Run; PASS. Full suite.
- [ ] **Step 5:** Commit `feat(impurity): trace-coupled decode behind mandatory all-seeds build gate (experimental, max only)`.

---

## Phase W4-L2 — Opt-in runtime co-residence link

### Task 4.3: Link Planner (prove-or-don't-link) + provider/consumer fold

**Files:**
- Create: `packages/ruam/src/compiler/link-planner.ts`
- Modify: `packages/ruam/src/transform.ts`, `packages/ruam/src/ruamvm/builders/globals.ts`, options wiring.
- Test: `packages/ruam/test/security/cross-file-linking.test.ts`, `packages/ruam/test/integration/` (multi-realm + partial-deploy)

**Interfaces:**
- Consumes: cohort context + (optional) manifest.json / HTML inputs.
- Produces: `crossFileLinking` (default-OFF, no preset). Emits a runtime edge ONLY for proven co-resident same-realm provider→consumer pairs (provider present-and-earlier in EVERY realm the consumer enters); else falls back to Layer-1. Provider writes a buried fragment to a shared global at load; consumer folds it into key derivation with a build-time fallback that still decodes (graceful) UNLESS strict mode.

- [ ] **Step 1:** Failing test: a proven pair links (consumer needs provider's global to decode); an unproven pair falls back (consumer decodes standalone). Partial-deploy: provider absent → consumer still runs.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement planner (manifest worlds/run_at/order + HTML `<script>` order rules from CONTEXT-BRIEF §"Chrome co-residence"); provider write at `buildGlobalExposure` seam; consumer fold mirrored build/runtime.
- [ ] **Step 4:** Run; PASS multi-realm + partial-deploy. Full suite.
- [ ] **Step 5:** Commit `feat: opt-in cross-file runtime linking with prove-or-don't-link planner`.

---

## Phase W5 — Off-device necessary-secret binding (opt-in)

### Task 5.1: `externalKeyBinding` — fold an absent string term, loud-fail dev gate

**Files:**
- Modify: `packages/ruam/src/compiler/rolling-cipher.ts` (+ new runtime AST that folds a STRING term), `packages/ruam/src/ruamvm/builders/rolling-cipher.ts`, options wiring, cohort plumbing as delivery vehicle.
- Test: `packages/ruam/test/security/external-key-binding.test.ts`

**Interfaces:**
- Produces: `externalKeyBinding?: { accessorSource: string } ` (default-OFF, no preset). Runtime recomputes a FNV over the externally-supplied string term and folds it into the master key with NO fallback; missing/wrong term → cannot decode. A build-time self-check ensures the configured accessor + a test term round-trips (loud fail in dev).

- [ ] **Step 1:** Failing test: with a supplied term, build round-trips when the runtime provides the matching term; without the term, decode fails (garbage, no crash) — proving the secret is necessary and absent.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement string-folding runtime AST (net-new; not the numeric helper) + build mirror; loud-fail dev gate.
- [ ] **Step 4:** Run; PASS. Full suite.
- [ ] **Step 5:** Commit `feat: externalKeyBinding (opt-in off-device necessary secret)`.

---

## Phase F — Finalize

### Task F.1: Options wiring audit + docs + manifest + CLAUDE.md + PR
- [ ] Ensure every new option flows the 8-step wiring (types → option-meta + AUTO_ENABLE_RULES → presets + TARGET_DEFAULTS → tuning if tunable → cli flag → destructure in transform → builder).
- [ ] `bun run typecheck` green; full `bun test` green.
- [ ] Update `CLAUDE.md` Architecture Notes + Known Bug Fixes for shipped workstreams.
- [ ] Regenerate option manifest (`scripts/generate-manifest.mjs` path / `bun run build:lib`).
- [ ] Update memory `project_perf_overhaul.md` peer or add a new project memory for this initiative.
- [ ] Open PR with honest framing (work-factor + anti-automation on-device; cryptographic only for opt-in `externalKeyBinding`).

## Self-review notes
- Spec coverage: W0→0.1, W1→1.1–1.3, W2→2.1, W3→3.1–3.2, W4→4.1–4.3, W5→5.1. ✓
- W3 and parts of W1/W2 are explicit SPIKES because their internal code is determined by reading real files + proving symmetry; this is honest, not a placeholder — each spike has a concrete stop condition.
- Type consistency: `CohortContext`, `obfuscateBundle`, `digestAll`, `cohortTerm`, `decodeImpurity`, `crossFileLinking`, `externalKeyBinding` used consistently across tasks.
