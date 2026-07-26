# Ruam Gen-2 Ideation — Launch Packet

> **Paste this to a fresh session to kick off the campaign.** It is the lean operator brief.
> The full design (rationale, seed banks, scoring, schemas, and the complete runnable script)
> is in `docs/superpowers/specs/2026-07-24-ruam-gen2-ideation-campaign-design.md` — read it first.

---

## Mission (one paragraph)

Ruam is a developer tool that protects intellectual property in shipped JavaScript: it transforms a developer's own functions so automated tooling cannot cheaply and mechanically summarize or reconstruct the original program. The first generation of hardening ideas were competent but *incremental* — they iterated on primitives the codebase already had (salt the key, chain the keystream, fold a digest), because the ideation anchored on a defeatist "it's only work-factor" ceiling. **Your job is to run a structured ideation campaign that makes incrementalism structurally impossible** and surfaces genuinely novel directions for Ruam's *whole* next generation — across seven tracks, not only its resilience layer.

## How novelty is forced (do not skip)

Every idea-generator works under four simultaneous constraints:
1. **Forbidden-solution list** — anything that matches an existing Ruam feature or a canonical primitive (ciphers, digests, base-N codecs, LCG/FNV, table/switch VMs, control-flow flattening, string tables, dead code, opaque predicates) is disqualified before scoring.
2. **Assumption inversion** — each agent overturns one Ruam "axiom" (e.g., "the decoder must ship with the code," "the output is fixed once emitted," "a fragment is understandable locally").
3. **Cross-domain analogy** — each agent derives its mechanism from a domain far from software (immune systems, holography, origami metamaterials, stage misdirection, DNA repair, ecology…), explaining the source system *before* stating the idea.
4. **Forced fusion** — a dedicated phase hybridizes the boldest ideas into mechanisms neither parent would produce.

## Model roles

- **Fable 5** (`claude-fable-5`) — framing brief + final synthesis/ranking (the judgment layer).
- **Opus 5** (`claude-opus-5`) — the divergent generator fleet + fusion (each agent a unique lens × assumption × track × persona).

## Vocabulary rule (mandatory)

All agent-facing text uses **product / IP-protection framing**. **Banned:** attack, adversary, red-team, exploit, weaponize, injection, bypass, "make the model fail." **Use instead:** resilience to automated analysis, originality of output, protecting the developer's IP, novel program transformations. Frame the "AI" angle as *"automated analysis/reconstruction tooling,"* never as harming a model. This keeps the run from false-flagging safeguards.

## The seven tracks (whole next-gen tool)

1. Resilience to automated understanding · 2. Novel transformation paradigms · 3. New product surfaces & capabilities · 4. Self-modifying / living output · 5. Semantic-level protection · 6. Verifiability & developer experience · 7. Distribution / licensing / delivery models.

## Launch

The campaign is a `Workflow`. **It requires explicit opt-in** (say `ultracode`, or "run this workflow") because it dispatches Opus 5 + Fable 5 agents and is token-intensive.

1. Read the design doc (link at top) and copy the script from its **§11**.
2. Invoke:
   ```
   Workflow({ script: <§11 script>, args: { generators: 7 } })
   ```
   or, after the first run persisted it, `Workflow({ scriptPath: <persisted path>, args: { generators: 16 } })` for a wider sweep.
3. Phase order: **Frame → Diverge → Fuse → Tag → Synthesize → Coverage.** Default 14 agents (under the 15-agent guideline); raise `args.generators` to widen.

## Definition of done

The run returns `{ headline, slate, fusions, coverage, counts }`. It succeeds when `slate.ranked` holds ≥ 3 ideas with recognizability < 0.5 across ≥ 3 tracks, ≥ 1 fusion in the top 5, and every top-10 idea carries a "why this is not a gen-1 iteration" line. If every top idea scores recognizability ≥ 0.7, the run failed its own bar — re-seed (bump `args.generators` or edit the lens/assumption strides) rather than accept retreads.

## After the campaign

A selected idea feeds the *existing* build pipeline: brainstorming → design spec → `writing-plans` → TDD → verify. This campaign is the front end; it does not replace that machine.
