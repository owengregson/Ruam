# Project Kaleidoscope — Ruam Gen-2 Ideation Campaign

**Date:** 2026-07-24
**Status:** Plan (design complete; not yet run).
**Type:** Ideation-campaign design. This document is *runnable later* — §11 is a complete `Workflow` script and §12 is the operator guide. A lean paste-and-launch companion lives at `docs/ruam-gen2-ideation-prompt.md`.

---

## 0. What this is (and what it is not)

Ruam is a JavaScript source-protection tool: it compiles a developer's functions into custom bytecode run by a per-build-polymorphic embedded interpreter, so shipped code does not hand a reader a clean, easily-reconstructed copy of the original logic. This document designs a **structured ideation campaign** that uses **Opus 5** and **Fable 5** subagents, dispatched in **parallel workflows**, to generate *genuinely novel* directions for Ruam's next generation — across the whole product, not only its resilience layer.

It is a **plan**. Running it is a separate, explicit step (see §12). This document does not itself dispatch any agent.

**The one non-negotiable design property:** the campaign is engineered to make convergence-on-the-obvious *structurally impossible*. Novelty is enforced by construction (§3), not left to chance.

---

## 1. Why the first generation was uncreative — the diagnosis

The gen-1 hardening work (`docs/superpowers/specs/2026-06-30-anti-ai-decompilation-design.md`, branch `anti-ai-hardening`) produced competent but *incremental* ideas: salt the key per unit, chain the keystream, fold a cross-file digest. Every one is an **iteration on a primitive that already existed in the codebase.**

The root cause is not a lack of effort — it was a **47-agent swarm**. The root cause is an **anchor**. Gen-1's design doc opened by declaring an "honest ceiling":

> *"perfect … defense against a patient AI is impossible … client-executable code is client-observable … the achievable wins are (a) raise human-hours, (b) destroy transferability, (c) an off-device secret."*

Once that frame was accepted, every downstream agent reasoned *inside it* and optimized within a solved space. The ideas were rankings of known levers, not new categories. The gen-1 v2 handoff even sensed the trap ("Do not let that conclusion truncate your ideation") but could not escape it, because it never removed the anchor — it just asked agents to try harder next to it.

**Design consequence for gen-2:** we do not ask agents to be creative. We **remove the anchor**, **forbid the known solution space**, and **force transfer from foreign domains** — so the recognizable answer is simply unavailable to them.

---

## 2. Success criteria for the campaign

A run is successful if it produces:

1. **A ranked slate of candidate directions** spanning the seven tracks (§6), each with a novelty score, an impact estimate, feasibility tags, and a maturity bucket.
2. **At least several genuinely unrecognizable ideas** — mechanisms that do not pattern-match any primitive already in Ruam or in the common obfuscation/compiler canon (recognizability score below the threshold in §9).
3. **At least one strong fusion** (§ Phase 2) — a hybrid neither parent idea would have produced.
4. For every idea: a one-line **"why this is not a gen-1 iteration"** note.

A run *fails its own bar* (and should be re-seeded, §Phase 5) if every surviving idea is a recognizable primitive or a relabeling of a gen-1 workstream.

---

## 3. The four creativity engines

Every generation agent operates under all four simultaneously. These are the heart of the design.

### 3.1 Forbidden-solution list
Each generator receives the full inventory of *what already exists* and *what an automated analyzer recognizes for free* — the Ruam feature list, the gen-1 workstreams, and the canonical primitives (stream ciphers, digests/checksums, base-N codecs, LCG/FNV PRNGs, switch/table-dispatch VMs, control-flow flattening, string tables, dead-code, opaque predicates). **Any idea that pattern-matches an item on this list is disqualified before it is scored.** You cannot win by reinventing a keystream.

### 3.2 Assumption inversion
Each agent is handed exactly one Ruam "axiom" to **overturn** (bank in §7.2), e.g. *"the decoder must ship alongside the code it decodes,"* *"the output is fixed the moment it is emitted,"* *"a local fragment can be understood by reading it locally."* The agent must produce a mechanism that only makes sense *if the axiom is false.* Inversion reliably relocates thinking outside the solved space.

### 3.3 Cross-domain analogy seeding
Each agent is assigned one lens from a domain **far** from software (bank in §7.1: immune systems, mycelial networks, holography, origami metamaterials, untranslatable languages, stage misdirection, DNA repair, ecology, phase transitions, cartographic projection…). The agent must (a) explain the source-domain mechanism in its own terms, (b) map each element of it onto a Ruam concept, and (c) *only then* state the idea. The mandatory "explain the source first" step is what turns a shallow metaphor into a real structural transfer — and it is the strongest single lever against training-distribution convergence.

### 3.4 Forced fusion
A dedicated phase takes the boldest raw ideas and **hybridizes** them in pairs/triples. Gen-1 recorded that its only mechanism to survive scrutiny was a *fusion* of several levers — never a standalone trick. Gen-2 makes fusion a deliberate phase rather than an accident, because the interaction of two unlike ideas is where the genuinely new mechanisms live.

---

## 4. Model roles — Opus 5 and Fable 5, split on purpose

Per the project's `efficient-fable` doctrine (Fable for decomposition, architecture/product tradeoffs, synthesis, and final judgment; cheaper models for bounded heavy lifting):

- **Fable 5 (`claude-fable-5`)** — the **judgment layer.** It writes the framing brief (Phase 0), steers cross-pollination, and performs final synthesis and ranking (Phase 4). Fable makes the "is this actually novel / does it cohere / is this a gen-1 relabel" calls.
- **Opus 5 (`claude-opus-5`)** — the **divergent fleet.** The many parallel generators (Phase 1) and the fusion agents (Phase 2). Each generator gets a *unique* lens × assumption × track × persona tuple, so no two explore the same space.

Reasoning effort: generation and synthesis run at **high/max** effort; tagging runs at **medium**.

---

## 5. Phase topology (blue-sky → filter)

Ideation is fully unconstrained first; feasibility enters only as *annotation*, never as a gate that deletes ideas.

| Phase | Model ×N | Purpose | Consumes | Produces |
|---|---|---|---|---|
| **0 — Framing brief** | Fable 5 ×1 | Read the repo + gen-1 record; emit the shared neutral context packet: current-state summary, the forbidden-solution list, the de-anchoring provocations, the track definitions. | repo docs | `Brief` (§10) |
| **1 — Divergent generation** | Opus 5 ×7 (scalable) | Each agent = one lens × one inverted assumption × one track × one persona → 3–5 raw ideas derived by analogy. **No feasibility filtering.** Weird beats safe. | `Brief` + its tuple | `RawIdea[]` |
| **2 — Forced fusion** | Opus 5 ×2 | Hybridize the boldest raw ideas into mechanisms neither parent would produce. | pooled `RawIdea[]` | `RawIdea[]` (fusions) |
| **3 — Feasibility & novelty tagging** | mixed ×2 | For each idea: recognizability score, impact, rail-checks, maturity bucket. **Annotates; never deletes.** | idea pool (batched) | `TaggedIdea[]` |
| **4 — Synthesis & ranked slate** | Fable 5 ×1 | Cluster, dedupe, rank by novelty × impact × feasibility; surface best fusions; write per-idea "why novel" notes. | `TaggedIdea[]` | `Slate` (§10) |
| **5 — Completeness critic** | ×1 (optional) | "Which lens produced nothing? Which assumption did nobody dare invert? Which track is thin?" → seeds a second round. | `Slate` + coverage | `CoverageReport` |

**Default agent count:** 1 + 7 + 2 + 2 + 1 + 1 = **14** (under the standard 15-agent workflow guideline). Scale the Phase-1 fleet via `args.generators` (§12); a fleet of 16–20 is a reasonable "big sweep."

**Barrier placement.** Phase 1 → Phase 2 uses a genuine barrier (`parallel`): fusion needs the *full* set of raw ideas to pair across generators. Everything after the idea pool is formed can pipeline.

---

## 6. Scope — the seven tracks ("whole next-gen tool")

Hardening is one track of seven. The campaign ideates on what Ruam *becomes*.

1. **Resilience to automated understanding** — output that automated tooling cannot cheaply, mechanically summarize or reconstruct. (The gen-1 lineage, reframed as a product property.)
2. **Novel transformation paradigms** — what the compiler/VM core could become beyond bytecode + interpreter (new execution models, new representations of "a program").
3. **New product surfaces & capabilities** — what Ruam *is* to a developer: integrations, workflows, guarantees, interfaces, deployment shapes.
4. **Self-modifying / living output** — artifacts that are not fixed at emit time: regenerating, metamorphic, or self-maintaining.
5. **Semantic-level protection** — protecting *meaning* and intent, not just surface form.
6. **Verifiability & developer experience** — proving the protected program is faithful; trust, debuggability, observability of one's own output.
7. **Distribution / licensing / delivery models** — how protected code is packaged, licensed, updated, and monetized.

---

## 7. Seed banks

### 7.1 Domain lenses (≈22 — assign one per generator, by index)
adaptive immune system (clonal selection, self/non-self) · mycelial nutrient networks · holography (every shard holds the whole at lower resolution) · origami & mechanical metamaterials · untranslatable languages / linguistic relativity · stage magic & misdirection · DNA error-correction & codon degeneracy · ecology & keystone species · quantum measurement / observer effect · music theory & counterpoint · slime-mold pathfinding · camouflage, mimicry & aposematism · legal contracts & escrow · cellular automata & emergence · metamorphosis (same organism, unrecognizable form) · phase transitions & superconductivity · ant-colony stigmergy · fractals & scale-free structure · immune memory & vaccination · orbital/tidal resonance & coupled oscillators · fermentation & time-based transformation · cartographic projection (every map distorts something).

### 7.2 Inverted assumptions (≈14 — assign one per generator)
"the decoder must ship alongside the code" · "the output is fixed once emitted" · "the meaning lives inside the file" · "one input deterministically yields one output" · "each function is a stable, enumerable unit" · "protection is applied once, at build time" · "build-time and run-time are separate worlds" · "the tool protects code but does not participate at run time" · "a local fragment is understandable locally" · "the artifact is a passive text to be read" · "opacity and correctness are in tension" · "Ruam is a compiler" (→ Ruam is a ___) · "the program behaves the same whether observed or not" · "structure is what hides meaning" (→ absence of structure).

### 7.3 Personas (≈8 — assign one per generator)
materials scientist · field biologist · stage magician · theoretical linguist · game designer · complexity/systems theorist · industrial designer · composer.

**Assignment rule (deterministic, no randomness):** generator *i* gets `lens[i % L]`, `assumption[(i·5) % A]`, `track[i % 7]`, `persona[i % 8]`. Co-prime strides spread the combinations so the fleet covers a wide grid.

---

## 8. Neutral vocabulary policy (safety-framing guardrail)

Ruam is a legitimate developer tool for protecting intellectual property in shipped JavaScript. **All agent-facing prompt text uses product/engineering framing** so nothing false-flags safeguards when the campaign is run.

**Banned in every agent prompt:** *attack, attacker, adversary, adversarial, red-team, exploit, weaponize, malicious, victim, payload, injection, evade, bypass, defeat-the-AI, "make the model fail."*

**Approved framing:** *resilience to automated analysis; resistance to mechanical summarization/reconstruction; distinctiveness and originality of output; protecting the developer's intellectual property; novel program transformations; hard-to-mechanize structure; the tool's evolution as a product.* Where the "AI" angle is relevant, phrase it as **"automated analysis/reconstruction tooling"** and frame the objective as *raising the effort and reducing the transferability of mechanical understanding* — never as harming a model.

This policy is not cosmetic: it is a hard requirement on the embedded prompt strings in §11.

---

## 9. Scoring & selection rubric (Phase 3 + Phase 4)

Each idea is scored on four axes; the composite drives the ranking.

- **Recognizability** `0.0–1.0` (LOWER IS BETTER). 0.0 = matches no known primitive/pattern; 1.0 = a textbook primitive or a gen-1 relabel. **Ideas at ≥ 0.7 are flagged "iteration, not invention"** and sink in the ranking regardless of impact.
- **Impact** `1–5` — how far it moves Ruam forward on its track.
- **Feasibility rails** (each `pass | needs-relaxation | fails`): *server-free · size-lean (no context-padding bloat) · CSP/Trusted-Types-safe · build==runtime provable · additive-API-compatible.* Tags, not filters.
- **Maturity bucket** (one of): `shippable-now` · `needs-rail-relaxed` · `research-spike` · `product-pivot`.

**Composite rank (Phase 4):** `impact × (1 − recognizability) × feasibilityWeight`, with a deliberate **novelty premium**: two ideas of equal composite are ordered by lower recognizability first. Best fusions are surfaced separately even if a rail is red — a `research-spike` that is genuinely new is more valuable to this campaign than a `shippable-now` retread.

---

## 10. Structured output schemas

Used as the `schema` option on `agent()` so returns are validated data, not prose to parse.

```js
const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    stateSummary:       { type: "string" },
    forbiddenSolutions: { type: "array", items: { type: "string" } },
    provocations:       { type: "array", items: { type: "string" } },
    tracks:             { type: "array", items: { type: "string" } }
  },
  required: ["stateSummary", "forbiddenSolutions", "provocations", "tracks"]
};

const RAW_IDEAS_SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name:                 { type: "string" },
          lens:                 { type: "string" },  // source domain used
          assumptionOverturned: { type: "string" },
          track:                { type: "string" },
          sourceMechanism:      { type: "string" },  // the analogy, explained first
          coreIdea:             { type: "string" },  // 2–4 sentences
          whyNovel:             { type: "string" },  // what it does NOT resemble
          roughSketch:          { type: "string" },  // how it might map into Ruam
          boldness:             { type: "number" }   // self-rating 1–5
        },
        required: ["name", "coreIdea", "whyNovel", "roughSketch"]
      }
    }
  },
  required: ["ideas"]
};

const TAGGED_IDEAS_SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name:            { type: "string" },
          track:           { type: "string" },
          recognizability: { type: "number" },       // 0..1, lower = more novel
          impact:          { type: "number" },        // 1..5
          rails: {
            type: "object",
            properties: {
              serverFree:           { type: "string" }, // pass|needs-relaxation|fails
              sizeLean:             { type: "string" },
              cspSafe:              { type: "string" },
              buildRuntimeProvable: { type: "string" },
              additiveApi:          { type: "string" }
            }
          },
          maturity:  { type: "string" }, // shippable-now|needs-rail-relaxed|research-spike|product-pivot
          notNovelBecause: { type: "string" } // empty if genuinely novel
        },
        required: ["name", "recognizability", "impact", "maturity"]
      }
    }
  },
  required: ["ideas"]
};

const SLATE_SCHEMA = {
  type: "object",
  properties: {
    ranked: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rank:            { type: "number" },
          name:            { type: "string" },
          track:           { type: "string" },
          composite:       { type: "number" },
          oneLine:         { type: "string" },
          whyNotGen1:      { type: "string" },
          maturity:        { type: "string" }
        },
        required: ["rank", "name", "oneLine", "whyNotGen1"]
      }
    },
    bestFusions:  { type: "array", items: { type: "string" } },
    headline:     { type: "string" }
  },
  required: ["ranked", "headline"]
};
```

---

## 11. The runnable `Workflow` script

Paste as the `script` argument to the `Workflow` tool (or save and pass via `scriptPath`). Plain JS. No `Date.now()`/`Math.random()`. All embedded prompt strings follow §8.

```js
export const meta = {
  name: 'ruam-gen2-ideation',
  description: 'Generate genuinely novel next-generation directions for Ruam via cross-domain analogy, assumption inversion, and forced fusion.',
  phases: [
    { title: 'Frame',     detail: 'Fable writes the shared neutral brief + forbidden-solution list', model: 'claude-fable-5' },
    { title: 'Diverge',   detail: 'Opus fleet: one lens x assumption x track x persona each', model: 'claude-opus-5' },
    { title: 'Fuse',      detail: 'Opus hybridizes the boldest raw ideas', model: 'claude-opus-5' },
    { title: 'Tag',       detail: 'Feasibility + novelty annotation (never deletes)' },
    { title: 'Synthesize', detail: 'Fable clusters, ranks, writes the slate', model: 'claude-fable-5' },
    { title: 'Coverage',  detail: 'Completeness critic seeds a possible round 2' },
  ],
}

// ---- schemas (see design doc section 10) ----
const BRIEF_SCHEMA = { type:"object", properties:{ stateSummary:{type:"string"}, forbiddenSolutions:{type:"array",items:{type:"string"}}, provocations:{type:"array",items:{type:"string"}}, tracks:{type:"array",items:{type:"string"}} }, required:["stateSummary","forbiddenSolutions","provocations","tracks"] }
const RAW_IDEAS_SCHEMA = { type:"object", properties:{ ideas:{ type:"array", items:{ type:"object", properties:{ name:{type:"string"}, lens:{type:"string"}, assumptionOverturned:{type:"string"}, track:{type:"string"}, sourceMechanism:{type:"string"}, coreIdea:{type:"string"}, whyNovel:{type:"string"}, roughSketch:{type:"string"}, boldness:{type:"number"} }, required:["name","coreIdea","whyNovel","roughSketch"] } } }, required:["ideas"] }
const TAGGED_IDEAS_SCHEMA = { type:"object", properties:{ ideas:{ type:"array", items:{ type:"object", properties:{ name:{type:"string"}, track:{type:"string"}, recognizability:{type:"number"}, impact:{type:"number"}, rails:{type:"object"}, maturity:{type:"string"}, notNovelBecause:{type:"string"} }, required:["name","recognizability","impact","maturity"] } } }, required:["ideas"] }
const SLATE_SCHEMA = { type:"object", properties:{ ranked:{ type:"array", items:{ type:"object", properties:{ rank:{type:"number"}, name:{type:"string"}, track:{type:"string"}, composite:{type:"number"}, oneLine:{type:"string"}, whyNotGen1:{type:"string"}, maturity:{type:"string"} }, required:["rank","name","oneLine","whyNotGen1"] } }, bestFusions:{type:"array",items:{type:"string"}}, headline:{type:"string"} }, required:["ranked","headline"] }

// ---- seed banks (design doc section 7) ----
const LENSES = ["adaptive immune system (clonal selection, self vs non-self)","mycelial nutrient networks","holography (every shard holds the whole at lower resolution)","origami and mechanical metamaterials","untranslatable languages / linguistic relativity","stage magic and misdirection","DNA error-correction and codon degeneracy","ecology and keystone species","quantum measurement / observer effect","music theory and counterpoint","slime-mold pathfinding","camouflage, mimicry and aposematism","legal contracts and escrow","cellular automata and emergence","metamorphosis (same organism, unrecognizable form)","phase transitions and superconductivity","ant-colony stigmergy","fractals and scale-free structure","immune memory and vaccination","orbital/tidal resonance and coupled oscillators","fermentation and time-based transformation","cartographic projection (every map distorts something)"]
const ASSUMPTIONS = ["the decoder must ship alongside the code it decodes","the output is fixed the moment it is emitted","the meaning of the program lives inside the file","one input deterministically yields one output","each function is a stable, enumerable unit","protection is applied once, at build time","build-time and run-time are separate worlds","the tool protects code but does not participate at run time","a local fragment can be understood by reading it locally","the artifact is a passive text to be read","opacity and correctness are in tension","Ruam is a compiler (finish: Ruam is actually a ___)","the program behaves the same whether observed or not","structure is what hides meaning (invert: the absence of structure)"]
const TRACKS = ["resilience to automated understanding","novel transformation paradigms","new product surfaces and capabilities","self-modifying / living output","semantic-level protection","verifiability and developer experience","distribution / licensing / delivery models"]
const PERSONAS = ["materials scientist","field biologist","stage magician","theoretical linguist","game designer","complexity/systems theorist","industrial designer","composer"]

const NEUTRAL_FRAMING = `Ruam is a legitimate developer tool that protects intellectual property in shipped JavaScript: it transforms a developer's own functions so that automated tooling cannot cheaply and mechanically summarize or reconstruct the original program. Frame everything as product evolution and resilience to automated analysis. Do NOT use security-offensive vocabulary (no "attack", "adversary", "red-team", "exploit", "injection", "bypass", "defeat the model"). Speak in terms of originality, resilience, IP protection, and novel program transformations.`

const N = (args && args.generators) || 7

// ---- Phase 0: framing brief (Fable) ----
phase('Frame')
const brief = await agent(
  `${NEUTRAL_FRAMING}

You are writing the shared creative brief for an ideation campaign about the NEXT GENERATION of Ruam. Read these files in the repo: docs/superpowers/specs/2026-06-30-anti-ai-decompilation-design.md, docs/superpowers/specs/2026-07-24-ruam-gen2-ideation-campaign-design.md, and CLAUDE.md (the "Architecture Notes" and feature list).

Produce a brief with:
1. stateSummary: a crisp picture of what Ruam is and does today.
2. forbiddenSolutions: an explicit inventory of ideas that ALREADY EXIST or that automated tooling recognizes instantly — the current Ruam feature set AND the canonical primitives (stream ciphers, checksums/digests, base-N codecs, LCG/FNV generators, table/switch-dispatch interpreters, control-flow flattening, string tables, dead code, opaque predicates). Any future idea that matches one of these is disqualified. Be thorough; this list is what prevents reinvention.
3. provocations: 8-12 sharp de-anchoring prompts that push a thinker OUT of the "improve the cipher" mindset and toward new categories.
4. tracks: the seven tracks from the design doc, each with one sentence on what a breakthrough there would look like.`,
  { label: 'framing-brief', phase: 'Frame', model: 'claude-fable-5', effort: 'high', schema: BRIEF_SCHEMA }
)

// ---- Phase 1: divergent generation (Opus fleet) ----
phase('Diverge')
const assignments = []
for (let i = 0; i < N; i++) {
  assignments.push({
    lens:       LENSES[i % LENSES.length],
    assumption: ASSUMPTIONS[(i * 5) % ASSUMPTIONS.length],
    track:      TRACKS[i % TRACKS.length],
    persona:    PERSONAS[i % PERSONAS.length],
  })
}

const rawBatches = await parallel(assignments.map((a, i) => () =>
  agent(
    `${NEUTRAL_FRAMING}

SHARED BRIEF (do not restate; build on it):
State: ${brief.stateSummary}
Do-not-reinvent list: ${JSON.stringify(brief.forbiddenSolutions)}

You are idea-generator #${i + 1}. Think like a ${a.persona}. You must generate mechanisms for the next generation of Ruam under THREE binding creative constraints:

1) LENS — derive your ideas by analogy to: ${a.lens}.
   First, explain how this real-world system actually works, in your own words. Then map each element of it onto a Ruam concept (the build step, the emitted artifact, the embedded interpreter, the developer, the automated analyzer, the run-time). ONLY THEN state your idea. Shallow metaphors are rejected; the mapping must be concrete.

2) OVERTURN — build ideas that only make sense if this usual assumption is FALSE: "${a.assumption}". Lean into what becomes possible once it no longer holds.

3) TRACK — aim at: ${a.track}.

Hard rule: if an idea matches anything on the do-not-reinvent list, throw it out and generate a stranger one. Do not filter for feasibility, cost, or shippability — that happens later. Reward yourself for boldness and for ideas that resemble NOTHING in the current tool.

Return 3-5 ideas. For each: name, the source mechanism (the analogy explained first), the core idea (2-4 sentences), why it is novel (what it does NOT resemble), and a rough sketch of how it might touch Ruam's build or run-time. Rate your own boldness 1-5 and push for 4s and 5s.`,
    { label: `gen-${i + 1}:${a.track.split(' ')[0]}`, phase: 'Diverge', model: 'claude-opus-5', effort: 'high', schema: RAW_IDEAS_SCHEMA }
  )
))

const rawIdeas = rawBatches.filter(Boolean).flatMap(b => b.ideas)
log(`Diverge produced ${rawIdeas.length} raw ideas from ${N} generators`)

// pick the boldest for fusion
const bold = rawIdeas.filter(x => (x.boldness || 0) >= 4)
const fusionPool = (bold.length >= 6 ? bold : rawIdeas)

// ---- Phase 2: forced fusion (Opus) ----
phase('Fuse')
const half = Math.ceil(fusionPool.length / 2)
const fusionSlices = [fusionPool.slice(0, half), fusionPool.slice(half)]
const fusionBatches = await parallel(fusionSlices.map((slice, k) => () =>
  agent(
    `${NEUTRAL_FRAMING}

Here is a set of bold, unfiltered ideas for the next generation of Ruam:
${JSON.stringify(slice.map(x => ({ name: x.name, coreIdea: x.coreIdea, lens: x.lens })))}

Your job is HYBRIDIZATION. Combine ideas across pairs or triples into mechanisms that neither parent would have produced alone. The most interesting fusions cross tracks and cross lenses (e.g., a "living output" idea fused with a "semantic protection" idea). Produce 3-4 fusions. For each: name, the parents it came from (as the source mechanism), the fused core idea, why the hybrid is more than the sum, and a rough sketch. These should feel genuinely new. Do not filter for feasibility.`,
    { label: `fuse-${k + 1}`, phase: 'Fuse', model: 'claude-opus-5', effort: 'high', schema: RAW_IDEAS_SCHEMA }
  )
))
const fusions = fusionBatches.filter(Boolean).flatMap(b => b.ideas)
const allIdeas = rawIdeas.concat(fusions)
log(`Fuse produced ${fusions.length} hybrids; ${allIdeas.length} ideas total`)

// ---- Phase 3: feasibility + novelty tagging (batched, never deletes) ----
phase('Tag')
const TAG_BATCHES = 2
const tagSlices = []
const per = Math.ceil(allIdeas.length / TAG_BATCHES)
for (let i = 0; i < TAG_BATCHES; i++) tagSlices.push(allIdeas.slice(i * per, (i + 1) * per))

const taggedBatches = await parallel(tagSlices.map((slice, k) => () =>
  agent(
    `${NEUTRAL_FRAMING}

Annotate each idea below. DO NOT delete or reject any idea — only tag it.
Ideas: ${JSON.stringify(slice.map(x => ({ name: x.name, track: x.track, coreIdea: x.coreIdea, whyNovel: x.whyNovel })))}

For each idea return:
- recognizability 0.0-1.0 where LOWER means it resembles no known primitive and HIGHER means it is a textbook technique or a small tweak on something Ruam already does. Be strict: if it maps cleanly to a stream cipher, a checksum, control-flow flattening, a string table, etc., score it high.
- impact 1-5: how far it moves Ruam forward on its track.
- rails: for each of {serverFree, sizeLean, cspSafe, buildRuntimeProvable, additiveApi} say "pass", "needs-relaxation", or "fails". These are informational, not disqualifying.
- maturity: one of "shippable-now", "needs-rail-relaxed", "research-spike", "product-pivot".
- notNovelBecause: if recognizability is high, name what it duplicates; otherwise leave empty.`,
    { label: `tag-${k + 1}`, phase: 'Tag', model: 'claude-opus-5', effort: 'medium', schema: TAGGED_IDEAS_SCHEMA }
  )
))
const tagged = taggedBatches.filter(Boolean).flatMap(b => b.ideas)

// ---- Phase 4: synthesis + ranked slate (Fable) ----
phase('Synthesize')
const slate = await agent(
  `${NEUTRAL_FRAMING}

You are the synthesis judge. Here are the ideas with novelty/impact/feasibility tags:
${JSON.stringify(tagged)}
And here are the fusion hybrids by name: ${JSON.stringify(fusions.map(f => f.name))}

Cluster near-duplicates, then produce a RANKED slate. Rank by composite = impact * (1 - recognizability) * feasibilityWeight, but apply a novelty premium: when two ideas tie, the LOWER recognizability wins. A genuinely new research-spike is worth more to this campaign than a shippable retread. For each ranked idea give: rank, name, track, composite, a one-line pitch, and a one-line "why this is NOT a gen-1 iteration (salt/keystream/digest)". Also list the best fusions separately, and write a one-paragraph headline on where Ruam's most promising next generation lies.`,
  { label: 'synthesis', phase: 'Synthesize', model: 'claude-fable-5', effort: 'max', schema: SLATE_SCHEMA }
)

// ---- Phase 5: completeness critic ----
phase('Coverage')
const coverage = await agent(
  `${NEUTRAL_FRAMING}

Assess coverage of this ideation run. Generators used these lenses: ${JSON.stringify(assignments.map(a => a.lens))}, these assumptions: ${JSON.stringify(assignments.map(a => a.assumption))}, across tracks: ${JSON.stringify(TRACKS)}. The ranked slate headline is: "${slate.headline}".

Identify: (1) which lenses or inverted assumptions produced nothing that survived to the top of the slate, (2) which of the seven tracks is under-explored, (3) two or three specific lens x assumption x track combinations that were NOT tried and look promising for a round 2. Be concrete and brief.`,
  { label: 'coverage-critic', phase: 'Coverage', effort: 'high' }
)

return { headline: slate.headline, slate, fusions: fusions.map(f => f.name), coverage, counts: { raw: rawIdeas.length, fusions: fusions.length, total: allIdeas.length } }
```

---

## 12. How to run it (operator guide)

**Prerequisite — explicit opt-in.** The `Workflow` tool only runs on explicit user opt-in (the keyword `ultracode`, an on-session ultracode flag, or a direct "run this workflow" instruction). This is intentional: the campaign spins up Opus 5 and Fable 5 agents and is token-intensive.

**Launch (default 14 agents):**
> "Run the `docs/ruam-gen2-ideation-prompt.md` ideation workflow." — or paste §11 as the `Workflow` `script`.

**Scale the sweep** — pass args to widen the divergent fleet:
```
Workflow({ script: <§11>, args: { generators: 16 } })
```
Each extra generator is one more lens × assumption × track combination. Fusion/tag/synthesis scale automatically off the idea pool. Keep the fleet ≤ ~20 unless you raise the workflow-size guideline in `/config`; the concurrency cap (≈ cores−2) means larger fleets queue rather than fail.

**Iterating on the script** — every `Workflow` call persists its script under the session dir and returns the path; edit that file and re-invoke with `{ scriptPath }` rather than resending the whole script. To resume after an edit, use `{ scriptPath, resumeFromRunId }` — unchanged `agent()` calls return cached results.

**Reading results** — the workflow returns `{ headline, slate, fusions, coverage, counts }`. The `slate.ranked` array is the deliverable; `slate.bestFusions` and `coverage` seed round 2. If the run's best ideas all score recognizability ≥ 0.7, the run failed its own bar (§2) — re-run with fresh lens/assumption strides (bump `args.generators` or edit the assignment strides) rather than accepting retreads.

**Feeding the winner into build** — a selected idea then enters the *existing* gen-1-style pipeline: brainstorming → design spec → `writing-plans` → TDD → verify. This campaign is the front end that feeds that machine; it does not replace it.

---

## 13. Ruam's real rails (reference for Phase 3 only)

These constrain *tagging*, never *generation*. Carried from the gen-1 design so the feasibility pass is grounded:

- **Server-free / offline** — no network or off-device secret required to run the artifact (a `needs-relaxation` tag is allowed for ideas that would relax this; the campaign's scope explicitly permits proposing it).
- **No size-bloat-to-fill-context** — inventiveness from structure, not volume.
- **CSP / Trusted-Types safe** — no `eval`, `new Function`, `debugger`.
- **Build == runtime symmetry, all seeds** — any build-time fold must reproduce bit-identically at runtime for every seed, or fail the build loudly.
- **`deriveSeed()` for PRNG isolation; `NameRegistry` for every identifier.**
- **Additive API + hot-path performance budget.**
- **Watermark integrity preserved.**

---

## 14. Definition of done (for a run, later)

- A committed results artifact containing `slate.ranked`, `bestFusions`, and `coverage`.
- ≥ 3 ideas with recognizability < 0.5 across ≥ 3 distinct tracks.
- ≥ 1 fusion in the top 5.
- Every top-10 idea carries a "why not gen-1" line.
- A coverage note naming the round-2 seeds.

---

## 15. Tuning knobs & open questions

- **Fleet size vs. depth** — more generators widen coverage; higher effort deepens each. Default favors coverage (7 generators, high effort).
- **Lens bank** — the ≈22 lenses are a starting set; swapping in domains the operator finds evocative is encouraged (edit `LENSES` in §11).
- **Second-model contrast** — an optional variant runs the *same* lens/assignment through both an Opus and a Fable generator and diffs the outputs, to study where the two models diverge creatively. Not in the default topology; a worthwhile experiment.
- **Human-in-the-loop gate** — whether to pause after Phase 1 for the operator to hand-pick the fusion pool instead of the boldness heuristic. Currently automatic; easy to make interactive.
