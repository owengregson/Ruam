# Anti-AI-Decompilation Hardening — Design

**Date:** 2026-06-30
**Status:** ALL workstreams shipped on `anti-ai-hardening` (two product decisions locked, see §6).
**Branch:** `anti-ai-hardening`

**Shipped** (each tested across many random seeds + full suite green, 2381 tests):
- W0 — source-map / cleartext-leak gate (default-on; `--keep-source-maps` opt-out).
- W1 — hole-tolerant slow-path dispatch (`_ht[PH] | 0`) killing the undefined-opcode oracle.
- W2 — per-unit key salt (always-on under rolling cipher): distinct key per unit, closing same-metadata key reuse.
- W3 — decode impurity (`decodeImpurity`): chained keystream removing random-access decrypt, behind the MANDATORY build-time self-equality gate; incompatible with cache-disabling features (throws). Opt-in.
- W4-L1 — cross-file cohort tangle + `obfuscateBundle()` API (the mandated cross-file feature; work-factor).
- W4-L2 — `crossFileLinking` opt-in runtime co-residence link (strict, no fallback): a consumer cannot run without its declared provider present in the same realm. Reuses the externalKey fold.
- W5 — `externalKeyBinding` off-device necessary secret (opt-in; the one cryptographic / human-forcing lever).

**Resolution of the earlier "deferred" items** (the user directed building all): W2 shipped as a per-unit *key salt* (the achievable, real form — closes cross-unit keystream reuse for same-metadata units; per-unit *code* variation remains out of scope as it would bloat size / add per-dispatch branches). W3 shipped scoped to the decode cache's linear forward pass (the only build==runtime-symmetric form of trace-coupling; genuine data-dependent global coupling is mathematically incompatible with build-time encryption and the mandatory gate would reject it), with its headline "corrupt-under-observation" goal honestly unachievable for passive reads (no JS read barrier) — it ships as an anti-automation / anti-random-access lever. W4-L2 shipped as an explicit user-declared strict link (the "proof" of co-residence is the caller's declaration); still work-factor vs a whole-bundle attacker, but delivers the literal cross-file dependency.

## 1. Context & goal

A frontier model reconstructed a Ruam `max`-preset artifact end-to-end (see
`scratchpad/ATTACK-REPORT.md`). The goal is **not** to patch the specific steps that
transcript took, but to attack the *root capability* the artifact handed the attacker, so
that **no generalizable agent** can repeat it cheaply — forcing bespoke, non-transferable,
human-driven effort.

This spec supersedes an earlier "patch slate" (rename `.xh`/`.tc`/`.bl`, alias `Math.imul`,
cohort *digest*, etc.). A 47-agent adversarial swarm (4 root-cause validators, 6 ideation
levers × {ideate, red-team, feasibility}, synthesis) confirmed the root cause and refuted
most of that slate as patch-level.

## 2. Root cause (validated) + honest ceiling

**Root cause, in one sentence:** *Ruam ships the decryptor with the ciphertext.* The artifact
is a complete, deterministic, **secret-free** machine that must self-decode to run on the
attacker's hardware. Every key/decoder/alphabet is therefore a pure function of bits the
attacker already holds, and a cleartext intermediate (true opcode+operand) is **guaranteed**
to exist where the attacker can observe it.

The entire attack is built from four primitives:

- **P1 Recognize** — map code to a known primitive (base64, FNV, LCG, DataView parser) → get the inverse for free.
- **P2 Lift-and-run** — *"because the function itself was present, brute force was unnecessary"* — excise any pure function and execute it for ground truth.
- **P3 Observe-at-a-tap** — one post-decrypt/pre-dispatch point + one stack codec + classifiable handler effects carry the whole program in clean form.
- **P4 Oracle** — split into **P4a** internal structural oracles (coherent header, operand-range validity, `R0==KPo==44` redundancy) which are *killable*, and **P4b** the terminal I/O oracle ("run original vs. reconstruction, compare outputs") which is **unkillable** in any locally-runnable artifact.

**Honest ceiling (must be stated plainly):** perfect single-file — *or co-resident
multi-file* — defense against a patient AI is impossible. Not via VBB/iO (the wrong hook;
ideal obfuscation still permits the behavioral cloning the attacker achieved) but via the
elementary fact that **client-executable code is client-observable**. Two further hard floors:

1. **Passive observation is undetectable.** The transcript attack was *dynamic + passive*: it
   ran the loader with built-ins intact and *logged at a tap*. A deterministic, untimed JS VM
   has **no read barrier** — no observation-resistance/tamper scheme can detect a passive
   read. Tamper-coupling only catches *active* hooking/rewriting, which is **not** what broke
   the VM.
2. **The terminal I/O oracle (P4b) is permanent** for as long as the artifact runs correctly.

Therefore the achievable wins, in descending honesty:
- **(a)** raise per-artifact human-hours;
- **(b)** destroy **transferability & automatability** — kill the cheap *internal* oracles so an LLM agent's errors compound and "recover-once-apply-44×" dies;
- **(c)** the one genuine qualitative jump — externalize a **necessary secret that is truly absent** from the device (server/per-session/hardware-bound), which defeats *offline* reconstruction at the cost of online/bound execution.

**Co-resident cross-file is (b), not (c).** Co-resident == co-acquired == co-possessed: an AI
with the whole directory has the sibling's secret. The mandated cross-file feature does
literally what was asked ("a file can't deobfuscate without the others") and is worthwhile,
but it is **work-factor**, not cryptographic. Only an off-device secret is (c).

## 3. Threat-model axes

| Axis | Cheap end (defeat with software) | Hard end |
|---|---|---|
| Acquisition | Static, single file | Dynamic, whole system |
| Observation | **Passive** (undetectable) | Active (hooking/rewriting — detectable) |
| Secret location | On-device (present/co-resident) | **Off-device** (absent) |
| Oracle | P4a internal (killable) | P4b terminal I/O (permanent) |

Design rule that falls out: **never claim a software-only on-device lever "forces a human" or
"kills P3/P4."** Market on-device levers as work-factor + anti-automation; market only the
off-device secret as anti-offline-reconstruction.

## 4. The slate (workstreams)

Risk-ordered. Each item states the primitive it attacks, why it's fundamental (not a patch),
the honest residual, principal files, and correctness risk.

### W0 — Source-map / cleartext-leak gate  *(ship first, zero risk)*
- **What:** in directory/bundle mode, strip emitted `*.map` files and defensively strip any
  surviving `//# sourceMappingURL=` comment from outputs. Default-on; `keepSourceMaps` opt-out.
- **Why fundamental:** `.js.map` carries `sourcesContent` = the **original source verbatim**.
  No obfuscation matters if the plaintext ships next to it. (Babel already strips the comment
  from emitted code; the leak is the copied `.map` files — globby `**/*.js` doesn't match
  `.map`, and `fs.copy` copies the whole tree.)
- **Primitive:** removes a total bypass of the entire system.
- **Files:** `cli.ts` (`obfuscateDirectoryWithProgress` ~939–964), new `obfuscateBundle` path.
- **Risk:** none.

### W1 — Internal-oracle annihilation  *(core anti-agentic; prerequisite for W3)*
- **What:** remove the cheap P4a self-correction signals:
  1. **No "coherent header":** encrypt the deserializer count fields (`paramCount`,
     `registerCount`, `constantCount`, `instrCount`) and reconstruct via `raw mod actualBound`
     so a wrong key yields a *plausible* header, not a parser overrun. (Resolve the
     **count-circularity**: counts that seed key derivation cannot themselves be encrypted
     under that key — see §7.)
  2. **No operand-range regularity:** widen/relocate so out-of-range operands aren't an
     instant "wrong classification" tell (bounded by what handlers can tolerate).
  3. **No total-handler-space tell:** pad the handler table to a power of two with executable
     decoys and resolve `_ht[PH & mask]` so every 16-bit decrypted opcode maps to *some*
     handler (no "undefined opcode" throw that signals a decode error).
  4. **No cross-structural redundancy:** break the `R0 keys == KPo keys == decoded IDs == 44`
     triple-agreement that gave a free completeness oracle.
  5. **Uniform stack value representation** so a wrong decode is plausible-but-wrong, not a
     type error.
- **Why fundamental:** attacks **P4a** directly — the AI's specific advantage is *cheap
  intermediate self-correction* that keeps errors from compounding. Remove the oracles and a
  generalized automated pipeline can no longer know it's right; errors compound; transfer dies.
- **Primitive:** P4a.
- **Residual:** anti-automation/anti-transfer. Does **not** stop a patient dynamic+passive
  attacker (P4b remains).
- **Files:** `compiler/encode.ts`, `ruamvm/builders/deserializer.ts`,
  `ruamvm/builders/interpreter.ts` (handler-table padding/masking), `compiler/index.ts`
  (count-circularity), stack codec sites.
- **Risk:** medium — touches the wire format and dispatch. Heavy round-trip tests.

### W2 — Intra-build per-unit heterogeneity  *(kills "recover-once-apply-44×")*
- **What:** make each compiled unit demand *independent* analysis instead of sharing one
  pipeline across all units. Per-**unit** (not per-build) variation in decode parameters /
  constant-pool layout / handler-resolution so the attacker cannot lift one unit's pipeline and
  replay it across all N.
- **Why fundamental:** the transcript's single biggest cost-amortization was "recover the
  pipeline ONCE, apply 44×." Per-unit heterogeneity converts one analysis into N. Distinct from
  cross-*build* polymorphism (useless within one shipped build). Flagged by 3/4 validators as a
  lever the original framing *missed*.
- **Primitive:** P3 (no stable enumerable unit of analysis).
- **Residual:** anti-amortization/work-factor.
- **Files:** `compiler/` (per-unit sub-seeds via `deriveSeed`), `ruamvm/builders/`.
- **Risk:** medium — must NOT re-introduce per-dispatch branching overhead (the
  handler-effect-diffusion variant was cut for exactly that) and must stay within no-size-bloat.
  **Own spike** before commit.

### W3 — Decode-path impurity fused with oracle-annihilation  *(strongest on-device; gated)*
- **What:** the decode keystream chains off a **running accumulator that is a function of the
  actual execution trace** (operands/order the live run produces), not present static material.
  A lifted decoder run on chosen inputs then yields in-context-**wrong** output, and (with W1)
  no internal oracle reveals the error. Build-time mirror must reproduce the accumulator
  bit-identically.
- **Why fundamental:** neutralizes **P2** for the decode functions (lifting ≠ running
  in-context) and compounds W1's P4a kill. The only configuration the red-team didn't trivially
  bypass is the *fusion* (impurity + oracle-annihilation + tap removal) — standalone impurity is
  replayed because the entangled quantity was a pure function of present bytes/index.
- **Primitive:** P2 (in-isolation) + P4a.
- **Residual (honest):** against dynamic+passive it does **not** force a human and does not kill
  P4b — the attacker can still run the live machine and tap, and replay reconstructs ambient
  state. It removes cheap transferable automation. **Anti-agentic, not human-forcing.**
- **Decision (locked):** ships **only** behind a **mandatory exhaustive all-seeds + all-engines
  build-time self-equality gate** that *fails the build* rather than ever emitting a file whose
  runtime accumulator could diverge from build-time. Default into `max` only; opt-in elsewhere.
- **Files:** `compiler/rolling-cipher.ts`, `ruamvm/builders/rolling-cipher.ts`,
  `ruamvm/builders/interpreter.ts` (per-exec save/restore slot, `_sek` precedent), decode cache
  gating.
- **Risk:** **high** — failure mode is silent wrong-but-valid output (forbidden by the
  "all-seeds, never silent garbage" principle). **Spike first**; graduate to ship only if the
  spike proves bit-identical symmetry across all seeds and target engines. Mandatory gate is
  non-negotiable.

### W4 — Cross-file cohort tangle + opt-in runtime co-residence link  *(the mandated feature)*
- **What:**
  - **Layer 1 (default-on for ≥2-file bundles):** a directory run becomes a *cohort* with one
    `deriveSeed`-derived cohort seed; a digest over every file's bytecode is folded
    (post-avalanche, build↔runtime symmetric, buried via `scattered-keys`) into each file's key
    anchor. Raises the analysis unit to the whole bundle; kills cross-sample transfer.
  - **Layer 2 (`crossFileLinking`, default-OFF, no preset):** a provider file writes a per-cohort
    key fragment to a shared global at load; a consumer folds it into key derivation. Emitted
    **only** when a build-time Link Planner *proves* (manifest worlds/run_at/order + HTML
    `<script>` order) the provider is always present-and-earlier in the same realm; else falls
    back to Layer 1. Strict **prove-or-don't-link**.
- **Why it's in scope:** explicitly mandated. Honest framing: it delivers "a file can't
  deobfuscate without the others" (work-factor, raises the unit), **not** cryptographic against a
  whole-bundle AI. The cohort plumbing is also the **delivery vehicle for W5**.
- **Primitive:** raises analysis unit (P2/P4a at bundle scope) — work-factor.
- **API:** new additive `obfuscateBundle(files, options)`; `obfuscateCode`/`obfuscateFile`
  signatures unchanged. CLI directory mode uses it.
- **Files:** new `compiler/cohort.ts`, new `compiler/link-planner.ts`, `index.ts`, `transform.ts`,
  `cli.ts`, `ruamvm/builders/globals.ts` (provider write seam).
- **Risk:** medium — Layer 2 must never brick a deployment (Chrome realm/heap isolation). Layer 1
  is low risk. Extensive multi-realm + partial-deploy tests.

### W5 — Off-device necessary-secret binding (`externalKeyBinding`)  *(opt-in; the one (c) lever)*
- **What:** fold a **genuinely absent** term — server-issued per-session nonce / license /
  hardware-bound key, delivered out-of-band — into the cipher key. The excised decryptor returns
  garbage without it, and there is no local oracle that the key was ever right. Must be a *moving
  target* (challenge/epoch) so an observed value doesn't generalize across runs.
- **Why fundamental:** the ONLY lever that removes a **necessary input from the attacker's
  possession entirely** — crosses from work-factor to cryptographic hardness. Defeats offline AI
  reconstruction.
- **Decision (locked):** **opt-in**, default-OFF, no preset. Fallback-free with a **loud-fail dev
  gate** (missing/wrong term fails loudly in dev, never silently miscompiles in prod). Reuses the
  W4 cohort/`BuildContext` plumbing as the delivery vehicle.
- **Residual (honest):** defeats *offline* reconstruction; does **not** defeat a live-session
  capture (recovers only that one run, not the algorithm) or a secret-source proxy.
- **Files:** `compiler/rolling-cipher.ts` + runtime mirror (new AST that folds a **string** term,
  not the numeric-only helper), `types.ts`/`option-meta.ts`/`presets.ts`/`cli.ts`, cohort plumbing.
- **Risk:** medium — product-changing (breaks offline use of the gated asset) but purely additive.

### Dropped from the old slate (patch-level — swarm-confirmed)
`randomizeUnitFields`, `Math.imul` alias, cold-member atomization, `crossUnitEntanglement`,
`instructionEntangledConstants`, cohort *digest* as a security claim. (Recognition "was rarely
even necessary — they ran it"; entanglement of *present* material is replayed; the digest is
present in a sibling.) **Caveat:** W1/W2 must not introduce *new* cross-build-invariant
fingerprints (e.g. a new `.db`/`.xh`-peer field) — that would re-create the cleartext tell the
old slate aimed at.

## 5. Cross-cutting invariants (non-negotiable)

- All-seeds + any-file-ordering correctness; **no flaky tests** (a failure = a real bug).
- `deriveSeed()` for every PRNG stream; **never** ad-hoc `seed ^ const`.
- `NameRegistry` for every emitted identifier (incl. new shared-global / accumulator names).
- No `eval` / `new Function` / `debugger`; CSP / Trusted-Types safe (browser-extension IIFE).
- **No size-bloat-to-fill-context** — compact arithmetic/closure forms only.
- Build==runtime fold symmetry for every new fold, across all seeds (exhaustive equality test).
- Watermark integrity: compose *around* `WM_OFFSET`; do not change the FNV offset basis.
- Additive API only.

## 6. Locked product decisions

1. **External-secret lever (W5):** build as **opt-in** (`externalKeyBinding`, default-OFF, no
   preset), fallback-free with loud-fail dev gate.
2. **Decode-path impurity (W3):** ship **only behind a mandatory exhaustive all-seeds +
   all-engines build-time self-equality gate** (build fails rather than ship a divergent file);
   default into `max` only, opt-in elsewhere. Spike first.

## 7. Hard sub-problems to resolve during implementation

- **Count-circularity (W1):** the count fields feed `deriveImplicitKey`, so they cannot be
  encrypted under that key. Resolution options: derive the key from a *separate* salt and encrypt
  counts under the unit key; or carry counts in a small cleartext-but-non-canonical preamble whose
  values are folded (not range-checked). Pick during W1 spike.
- **Accumulator symmetry (W3):** prove the trace-dependent accumulator is bit-identical on every
  legitimate run across seeds AND engines, mirrored across rolling + incremental cipher + MUTATE
  LCG. If unprovable, W3 does not ship.
- **Decode-once cache interaction (W1/W3):** impurity + handler-table padding both touch
  cache/dispatch resolution; mis-masking resolved-handler-index vs physical-opcode silently
  miscompiles. Gate cache off under W3 or fold into materialization.
- **`findUnsafeMutationIPs` blast radius (W3):** coupling the keystream to mutation/trace state
  turns a latent placement bug from one bad dispatch into whole-unit garbage. Re-audit.
- **Engine fidelity:** no `toString`-based integrity / host-intrinsic witness that breaks on
  Hermes/RN, SES/Lockdown, page-level prototype wrappers (the MAIN-world target), or post-Ruam
  minification.

## 8. Build order

1. **W0** source-map gate — ship immediately (zero risk).
2. **W4 Layer 1** cohort plumbing + `obfuscateBundle` API (also the W5 vehicle).
3. **W1** internal-oracle annihilation (resolve count-circularity).
4. **W2** per-unit heterogeneity (own spike).
5. **W3** decode-path impurity — **spike**, prove symmetry, ship behind mandatory gate or hold.
6. **W4 Layer 2** opt-in runtime co-residence link (Link Planner, prove-or-don't-link).
7. **W5** off-device `externalKeyBinding` (opt-in, loud-fail).

## 9. Test strategy

- Round-trip correctness (existing `test/helpers.ts`) for every workstream, across many seeds.
- New: exhaustive build==runtime fold-symmetry assertions for W1/W3/W4/W5 folds (all-seeds loop).
- New: multi-realm Chrome correctness + partial-deploy safety for W4 Layer 2 (provider absent →
  consumer still runs via fallback).
- New: source-map gate test (no `.map` in output; no `sourceMappingURL`).
- New: per-unit heterogeneity test (units do not share decode parameters).
- W3 gate: a build-time self-equality assertion that fails the build on any divergence.
- Re-run full suite (~2328 tests) green before PR.

## 10. Open risks

Tracked verbatim from the swarm (`scratchpad/wittdkcmr.output` → `openRisks`): passive-read
undetectability; permanent P4b oracle; unsolved accumulator symmetry (W3 = spike until proven);
decode-cache resolution confusion; engine fidelity; mutation blast-radius; co-resident L-INFO is
a perpetual trap (W5 absence must be real/off-device); no new invariant fingerprints; W5
offline-break economic cost.
