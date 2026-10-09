# Ruam integrated protection ideation swarm

Date: 2026-10-09
Status: Campaign complete. Nine briefs, three peer reviews, frozen slate and three actual ballots; see `README.md`, `41-decision-ledger.md` and `50-integrated-design.md`.

## Mandate

Develop one implementable, cohesive Ruam architecture that aims to make reusable program recovery materially more expensive than prior attempts. This campaign is research and design, not authorization to claim a security improvement without experiments. Produce component proposals, adversarial review, integration decisions, actual agent ballots, a minority report, and a staged implementation/qualification plan. Do not implement product changes during the campaign.

The session's agent tool refused another worker with `agent thread limit reached`. Actual participants are the coordinator and three persistent workers (`swarm_compiler`, `swarm_runtime`, `legacy_review`). The three workers rotate through nine specialist briefs. These briefs are not nine independent agents or votes. Final peer voting has exactly three independent worker ballots; the coordinator's decision is reported separately.

## Historical evidence to preserve

- `main` at `1fb1a61` is the legacy VM, including Kerckhoffs hardening and merged PR 3 performance work. Structural variation and correct execution do not establish attack resistance. Current review injected probes into every generated function of three small randomized `max` artifacts while preserving the expected result. Build-time `integrityBinding` embeds a literal hash, not an executed-source authenticator.
- `anti-ai-hardening` at `30f4563` (open PR 5, replacing closed PR 4) adds source-map stripping, salts, decode chaining, cohort digests, runtime links, external keys. Review reproduced `max` bypassing missing/wrong external secrets and missing link providers because shielding returns before binding folds. External secret hashing contributes only a 32-bit FNV term. Retain useful hygiene, reject inflated guarantees.
- `gen2-ideation-plan` at `5bf056c` ranked 40 concepts mostly by novelty/estimated impact, not measured resistance. Original Traveling Isogloss recreated a semantic-op/operand/handler observation point and was paused.
- `codex/traveling-isogloss-replacement` at `02c481d` (PR 6) documents BPRF/CSH experiments. Artifact-aware local BPRF recovery reached 100% output/topology recovery without dynamic observations; local CSH recovered at three contributions with 3x work/5x storage and no metadata-aware transfer loss. Initial custody functions learned in four queries; masked custody hid internal state but final degree-nine three-input function learned in 220 queries. Padding fixed narrow transcript leakage. These are bounded experiments and not universal impossibility proofs.
- `codex/pr6-performance-security-hardening` at `b464a82` (PR 7) has useful scalar code generation, resource/graph improvements, publication safety, protocol and worker hardening. It does not resolve prior research no-go results.
- Remote PR 8 at `579b3bc` regained full-JS compatibility using native/hybrid execution: seven of nine benchmark rows are fully native. Comparing its aggregate speed with protected VM speed is invalid. Local PR 8 adds certificate commit `149c216`, also in PR 9.
- `codex/pr9-full-javascript-protection` at `4e79865` (draft PR 9) has an honest no-pass-through contract but its public path is still native/hybrid and CI is red.
- Local `wip/isogloss-pr9-uncommitted-2026-09-02` at `f7f52c8` contains ~53k added lines in 165 files: whole-source ownership, regional emitters, classes/modules/dynamic source, artifact certificates and qualification. It is substantial but broken: `StructuredLoopLayout` and `buildStructuredLoopLayouts` are missing in `runtime/regional-artifact-emitter.ts`; typecheck fails and attacker qualification crashes. Nonlocal profiles still reject because execution boundaries are unimplemented.
- Some prior attack tests pass by confirming a no-go verdict. Legacy one-hook 100% recovery used debug logging and low protection; it is a control, not evidence against production max. Broad old semantic tests were deleted during cutover. Coverage certificates do not prove resistance or secrecy.

Useful branches can be read with `git show REF:path` without checkout. The September snapshot is also extracted read-only for this review at `/tmp/ruam-history-review.zpcgrY` (dependencies symlinked); inspect existence before using it.

## Design constraints

1. Full-access attacker: shipped bytes, compiler/design knowledge, pre-load edits, debugger/heap observation, intrinsic hooks, chosen inputs, replay, many builds, syntax/taint/synthesis tooling, and unrestricted local execution. Owner-only source/sidecars stay out of attacker inputs. A separate trusted domain is available only for an explicitly declared deployment mode.
2. Offline exact JS can aim for measured analysis-cost amplification. Do not promise secrecy, unhookability, or unconditional hardness. The same artifact can be reused unchanged by an attacker; explicitly account for this if relevant.
3. User confirmed: **strictly offline, server-free JavaScript only**. No custody, remote secrets, server activation, trusted hardware, native/WASM backend requirement, online licensing or remote oracle budget can be part of the proposed system. Historical custody work is evidence only. Local build-time tools may be used, but emitted execution remains self-contained JavaScript under the declared host/CSP contract.
4. Preserve full authored semantic ownership and exact behavior, or reject before publication. Do not gain speed/support by retaining unprotected authored bodies. Define host ABI leakage explicitly.
5. Avoid universal semantic dispatch, complete cleartext bytecode/frame caches, and machine-readable reconstruction aids in shipped output where feasible. Their absence alone is not proof of strength.
6. Necessary semantic transformations are preferable to dead noise. Every proposed defense must name its strongest counterattack, legitimate cost, and falsifiable kill criterion.
7. A cohesive plan needs explicit interfaces, compatible ordering, shared policy decisions, effect/exception/reentrancy rules, resource accounting, atomic publication and one public protection contract. Avoid a new pile of independently toggled flags.
8. Compare equivalent protection coverage. Include main max, repaired historical variants where appropriate, unprotected native cost, and deliberately weak controls. Count attack CPU, analyst/tool work, wall time, query count and recovered-model quality separately. Distinguish output recovery from source reconstruction.
9. Source-backed research claims use primary papers/docs and dates. A paper's native-code result is a hypothesis for JS until tested. Do not reuse speculative novelty scores as security evidence.
10. No product file edits, branch checkouts, commits, pushes or PR changes. Write only assigned research documents. Use built-in git/rg, not Morph tools.

## Round 1 response format

Each specialist writes its assigned Markdown file (roughly 800-1400 words) independently before reading peer proposals. Include:

- domain findings and precise current/historical code anchors;
- two or three concrete candidates with stable IDs prefixed by specialist number;
- mechanism and data/control flow, why it could change attacker work, and strongest bypass;
- integration interface and dependencies on other domains;
- exact JS/performance/size/tooling consequences;
- minimal experiment, expected differentiating evidence and kill criterion;
- what to retain, replace and defer;
- recommendation and uncertainty. Use external primary research only where helpful.

## Planned rounds

1. Nine specialist briefs researched by three persistent workers in three concurrent waves. Workers do not read peers during this phase; each later brief necessarily shares its worker's previous context.
2. Three cross-domain panels: attack/cryptanalysis, semantics/performance, architecture/deployment. They must name rejected ideas and incompatible combinations.
3. Coordinator publishes a concrete integrated candidate slate, dependencies, unresolved risks and evidence requirements; panels can request revisions.
4. All three workers independently submit structured ballots on the same frozen slate. Report vote counts and actual objections; distinguish votes for prototype investment from claims of demonstrated security. Any feasibility veto must cite a concrete defect or contradictory assumption. Multiple briefs by one worker never multiply its voting weight.
5. Coordinator publishes the integrated design, decision ledger, minority report and ordered experiment/implementation plan. No empirical protection victory may be declared by vote.
