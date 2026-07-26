# Handoff Prompt — Ruam Anti-AI Hardening, Second Generation

> **Paste this whole file to a fresh agent.** It is a self-contained handoff packet.
> Your job is to invent and ship a **new, superior anti-AI-decompilation layer** for Ruam,
> going through the full loop — ideation → adversarial critique → spec → plan → TDD →
> verify → PR — but **faster and more inventively** than the first generation did.

---

## 0. One-paragraph mission

Ruam is a JS VM obfuscator: it compiles JavaScript functions to custom bytecode run by a
per-build-polymorphic embedded interpreter, emitting one IIFE per file. A frontier AI model
already reconstructed a `max`-preset artifact end-to-end. The first hardening generation
(W0–W5, shipped on `anti-ai-hardening`) raised the work factor and killed several cheap
oracles. **Your mandate is the next leap:** design one or more *never-before-seen*
techniques whose entire purpose is to make an **AI decompiler agent** — not a human — fail,
stall, or produce confidently-wrong output. The bar is invention, not iteration. The prior
generation's "honest ceiling" is a **floor you are trying to beat**, not a cage. But there is
one hard product boundary: **the solution must not require a server or any off-device
secret.** No network calls, no per-session nonce, no license server. The artifact (or a
co-resident bundle of artifacts) must remain fully self-contained and offline-runnable. Your
frontier is: *how far past "work-factor only" can a purely on-device, server-free artifact be
pushed — specifically against the cognitive and operational weaknesses of an AI agent?*

---

## 1. Prime directive — weaponize the weaknesses that are unique to AI agents

This is the creative core and the single most important instruction. **Do not port human
anti-RE tricks.** Design against the ways an *AI decompiler* differs from a human reverse
engineer. Treat the list below as **seed inspiration to synthesize beyond**, not a menu to
implement. The winning idea should feel like it could only have been conceived by someone who
deeply modeled how an LLM agent actually operates.

Known AI-agent weaknesses to exploit (invent past these):

1. **Bounded context & attention dilution.** An agent cannot hold unbounded interdependent
   state in focus at once. **But raw size-bloat is banned** (see §2). The inventive version is
   *irreducible* interdependence: the meaning of any local fragment is a function of a global
   quantity that cannot be locally summarized or excerpted — so no window slice is
   self-explanatory, yet the artifact stays compact.

2. **Lift-and-run bias (P2).** Agents excise a pure function and execute it in isolation to
   get ground truth. Techniques where a lifted fragment behaves *differently* out of context
   than in context (environmental / co-resident / trace entanglement) turn the agent's
   favorite move into a source of wrong answers — **without needing a server**, purely via
   state that only exists inside the full running realm.

3. **Training-distribution pattern-matching (P1).** Agents recognize known primitives (base64,
   FNV, LCG, RC4, DataView parsers, switch-dispatch VMs) and get the inverse "for free." Novel,
   *non-canonical* constructions that match nothing in the training corpus deny that freebie.
   Bonus if the construction actively *resembles* a known-but-different primitive to mislead
   recognition.

4. **Oracle-seeking self-correction (P4a).** An agent's superpower is cheap internal
   self-checks (coherent headers, operand-range validity, cross-structure redundancy) that stop
   errors from compounding. Every remaining internal oracle you can convert into a
   *plausible-but-wrong* signal makes the agent's errors silently accumulate. This is the
   highest-leverage anti-*automation* axis.

5. **Confident hallucination without verification.** Agents emit convincing wrong output and
   move on. **Honeypot / decoy semantics** — plausible alternative logic an agent will
   "successfully decompile" into a confidently-wrong artifact — waste its budget and poison its
   result. This exploits a failure mode humans mostly don't have.

6. **Adversarial-input susceptibility (uniquely AI).** The artifact's own bytes (identifier
   names, string tables, structural comments-in-data) are *tokens the agent ingests*. Content
   engineered to act as an adversarial / injection-like input to the analyzing model — steering
   its reasoning toward a wrong lift — is effective against an LLM and inert to a human. This is
   the most distinctly-AI lever on the list; it is defensible because it is **your own
   artifact**. Explore it carefully and document the threat framing honestly.

7. **Fan-out / parallelization advantage.** Agents spin up sub-agents and analyze units in
   parallel. Techniques that force **strictly sequential** dependency (each step's decode needs
   the fully-resolved prior step) collapse the fan-out to a single serial chain — multiplying
   wall-clock and denying the "recover-once-apply-N×" amortization.

8. **Summarization lossiness.** Agents compress context to fit. If meaning is carried precisely
   in the details a summarizer discards (low-apparent-entropy but semantically load-bearing
   structure), the agent's own compression step destroys the information it needs.

9. **Consistency-across-observations assumption.** Agents accumulate evidence across repeated
   reads/runs. A **metamorphic** artifact — semantically identical but structurally divergent on
   each observation/execution — denies evidence accumulation without any server.

10. **Step/token-budget bounds.** Agents run under an operator-set budget. Any technique that
    makes the *number of observation steps* to recover one unit superlinear (fresh sub-derivation
    per instruction, per unit, per run) can push recovery past the budget the operator will pay.

**Synthesis expectation:** the strongest submissions will *compose* several of these into one
mechanism where breaking it requires defeating all of them at once (the first generation's W3
only survived red-teaming as a *fusion*, never standalone). Aim for a mechanism whose failure
mode, from the agent's side, is "I got a clean-looking answer that is wrong and I have no signal
that it's wrong."

---

## 2. Non-negotiable constraints (violating any of these fails the work)

These come straight from the project's design principles and prior locked decisions. They bound
*how* you build, not *how ambitious* the idea is.

- **Server-free / offline.** No network, no off-device secret, no per-session server nonce. The
  artifact and any co-resident bundle must run fully offline. (This is the whole point of this
  generation — the one true cryptographic lever from gen-1 is explicitly off the table.)
- **No size-bloat-to-fill-context.** Padding output to exhaust an agent's context window is an
  explicitly rejected anti-pattern. Inventiveness must come from *structure*, not volume. Prefer
  compact arithmetic/closure forms.
- **CSP / Trusted-Types safe.** No `eval`, no `new Function`, no `debugger`. Output must run in a
  Chrome-extension MAIN world and under SES/Lockdown-style hardening.
- **Build==runtime symmetry, all seeds.** Every build-time fold must be reproduced
  bit-identically at runtime for **every** seed (exhaustive equality test). Anything trace- or
  execution-coupled must be proven bit-identical across seeds *and* target engines, or it does
  not ship. **Never emit a file that can silently miscompile** — a divergence must be a loud
  build failure, exactly like gen-1's `assertChainedDecryptInverts` gate.
- **All-seeds determinism, no flaky tests.** Every test passes with any randomized seed and any
  file ordering. A sometimes-failing test means a real bug, never "flaky."
- **`deriveSeed()` for all PRNG isolation.** Never ad-hoc `seed ^ 0xCONST`.
- **`NameRegistry` for every emitted identifier.** No hard-coded names, no parallel naming
  system. Dynamic names via `createDynamicGenerator()`.
- **Watermark integrity preserved.** Compose *around* the watermarked FNV offset basis; do not
  change it.
- **Additive API + performance budget.** `obfuscateCode`/`obfuscateFile`/`obfuscateBundle`
  signatures stay compatible. No re-introduction of per-dispatch branching overhead (the reason a
  gen-1 variant was cut). Benchmark the hot path.
- **Full suite green before PR.** `bun run typecheck` clean; `bun run test` (2300+ tests) all
  pass; `bun run build:lib` succeeds.

---

## 3. Reframing "intellectual honesty" — unbounded in ideation, strict in claims

Gen-1's design doc concluded that on-device levers are "work-factor only" and that the sole
cryptographic lever is an off-device secret. **Do not let that conclusion truncate your
ideation.** It describes what gen-1 *chose to build*, not the limit of what is inventable. Aim
for the sky.

The honesty discipline you **must** keep is narrower and only about **claims and tests**:

- Do not write a code comment, doc line, or test name that *asserts* a property you have not
  demonstrated (e.g. "forces a human," "cryptographically unbreakable"). If a mechanism is
  work-factor, say work-factor.
- Do not ship a mechanism whose correctness you cannot prove across all seeds/engines.
- Do not fake a result. If a red-team breaks an idea, record that it was broken.

Inside those rails, chase the most ambitious server-free mechanism you can conceive — including
ones the gen-1 doc would have dismissed. If you find a genuinely new *category* of on-device
hardness (not just a bigger work-factor), that is the win condition. Prove it, don't assert it.

---

## 4. What already exists — do NOT reinvent these (go beyond them)

Read `docs/superpowers/specs/2026-06-30-anti-ai-decompilation-design.md` in full first. Shipped
on `anti-ai-hardening` (all tested across many seeds, full suite green):

- **W0** — source-map / cleartext-leak gate (`source-map-gate.ts`): strips `*.map` +
  `sourceMappingURL` so original source can't ship alongside output.
- **W1** — hole-tolerant slow-path dispatch (`_ht[PH] | 0`): a wrong decrypt maps to a
  plausible handler instead of throwing — kills the "undefined-opcode" oracle.
- **W2** — per-unit key salt (always-on under rolling cipher): distinct key per unit, closes
  same-metadata cross-unit keystream reuse.
- **W3** — decode impurity (`decodeImpurity`): chained keystream removing random-access decrypt,
  behind a MANDATORY build-time self-equality gate; incompatible with cache-disabling features.
- **W4-L1** — cross-file cohort tangle + `obfuscateBundle()` (order-independent digest folded
  into each file's key anchor; work-factor).
- **W4-L2** — `crossFileLinking` strict runtime co-residence link (a consumer can't decrypt
  without its declared provider present-and-earlier in the same realm; no fallback).
- **W5** — `externalKeyBinding` off-device secret. **This is the lever you are explicitly NOT
  extending** — it needs an out-of-band/server secret, which this generation forbids.

Key reusable seams (use them; don't rebuild infrastructure): the **key-anchor fold** (`_ka`,
build side `keyAnchor ^= term` / runtime `_ka ^= term`) is the universal entanglement seam —
integrity hash, cohort term, external key, and cross-file link all fold through it. The
**decode cache** materialization is the build==runtime-symmetric linear-forward-pass hook. The
`deriveSeed(seed, "id")` PRNG isolation and `NameRegistry` naming are mandatory shared systems.

**Explicit anti-goals** (gen-1 dropped these as patch-level; don't resurrect them as the
headline): renaming `.xh`/`.tc`/`.bl` peer fields, aliasing `Math.imul`, entangling *present*
static material (replayed trivially), or treating a digest that's present in a sibling file as a
security claim. And do not introduce a **new** cross-build-invariant fingerprint field.

---

## 5. Required process (this is the "go through ideation, critiques, etc." part)

Follow the project's skills. Be **leaner and more targeted** than gen-1's 47-agent swarm — use
parallel subagents where they genuinely add independent perspective, not for theater.

1. **Load context (parallel).** Read the gen-1 spec, `CLAUDE.md`'s anti-AI section,
   `compiler/cohort.ts`, `ruamvm/builders/external-key.ts`, and skim the attack framing. Fan out
   read-only Explore agents if useful; keep only conclusions.

2. **Ideate (brainstorming skill).** Generate **6–10 candidate mechanisms**, each explicitly
   tied to one or more AI-agent weaknesses from §1. For each: the primitive it attacks, the
   AI-specific failure it induces, the compact runtime shape, and the build==runtime symmetry
   story. Do the brainstorming skill's design gate before any code.

3. **Adversarial critique (the crucial loop).** For **each** candidate, spawn a red-team agent
   that role-plays the AI decompiler and *tries to break it* — lift-and-run it, recognize it,
   find an internal oracle, replay it, parallelize around it. A candidate survives only if the
   red-team's best attack still yields wrong-without-signal or a genuine superlinear cost. Record
   every break. This mirrors gen-1's find→red-team→feasibility structure but tighter.

4. **Score & select.** Rank survivors by (a) AI-specific denial strength, (b) server-free
   feasibility, (c) build==runtime provability, (d) performance/size cost, (e) novelty. Pick 1–2
   to spec. Prefer a **fusion** that composes multiple weaknesses over a single trick.

5. **Spec (write it down).** Produce a design doc at
   `docs/superpowers/specs/YYYY-MM-DD-anti-ai-v2-<topic>-design.md` in the same shape as gen-1's:
   root-cause framing, honest residual, the mandatory-gate story if anything is trace-coupled,
   cross-cutting invariants, files touched, correctness risks, test strategy. Get sign-off before
   planning.

6. **Plan (writing-plans skill).** Bite-sized TDD tasks: failing test → run-it-fails → minimal
   impl → run-it-passes → commit. Include the exhaustive all-seeds fold-symmetry test and, if
   applicable, the build-time self-equality gate as first-class tasks.

7. **Implement TDD.** Reuse the `_ka` fold seam / decode-cache hook / `deriveSeed` / NameRegistry
   rather than new infrastructure. Keep output compact.

8. **Verify (verification-before-completion skill).** `bun run typecheck`, full `bun run test`,
   `bun run build:lib`, plus your new all-seeds symmetry loop and a hot-path benchmark. Evidence
   before any "done" claim.

9. **PR.** Open a PR with an honest threat-model writeup: what each new mechanism denies an AI
   agent, the residual, and the proof of correctness. Reply to and resolve review threads.

---

## 6. Deliverables & evidence (definition of done)

- A committed **design doc** (§5.5) and **implementation plan** (§5.6).
- The **implemented mechanism(s)**, wired as opt-in options and/or into `max`, following all §2
  constraints.
- **Tests:** round-trip correctness across many seeds; exhaustive build==runtime fold-symmetry;
  a loud build-time self-equality gate for any trace/execution-coupled path; a hot-path
  benchmark showing no per-dispatch regression.
- **Green evidence:** typecheck clean, full suite pass (paste counts), lib builds.
- An **honest threat-model section** in the PR: per-mechanism, what AI-agent weakness it exploits,
  what it denies, and the residual — no overclaiming.
- A short **"why this is novel"** note: which AI-specific weakness each idea targets and why it is
  not a ported human anti-RE trick.

## 7. Stop conditions

- If a candidate's build==runtime symmetry cannot be proven across all seeds/engines, it does
  **not** ship — hold it as a spike, don't force it.
- If the only way to make an idea "cryptographic" is a server/off-device secret, it is out of
  scope — reframe it as a server-free work-factor/anti-automation lever or drop it.
- If nothing survives red-teaming with a genuinely new AI-specific denial, ship the strongest
  anti-automation improvement you *can* prove and say so plainly — do not dress up a patch as a
  breakthrough.

---

## 8. Kickoff checklist (first five actions)

1. `bun run test` once to confirm a green baseline on the branch you start from.
2. Read the gen-1 design doc + `CLAUDE.md` anti-AI section end-to-end.
3. Announce the brainstorming skill and produce the 6–10 candidate mechanisms (§5.2), each tied
   to an AI-agent weakness from §1.
4. Red-team every candidate (§5.3); keep only survivors.
5. Write the spec (§5.5) and get sign-off before touching code.

**Remember the shape of the win:** a compact, server-free, all-seeds-correct mechanism that makes
an AI decompiler agent confidently wrong — exploiting how *it* thinks, not how a human reverses.
