# PR 9 — Full JavaScript Protection Without Native Pass-Through

**Date:** 2026-07-25
**Status:** Implementation plan and qualification contract
**Parents:**

- [Traveling Isogloss — Rank 1 Implementation Plan](2026-07-24-traveling-isogloss-implementation-plan.md)
- [Project Kaleidoscope D2 — Dynamic-Instrumentation Ideation Results](2026-07-24-dynamic-instrumentation-ideation-results.md)
- [Project Kaleidoscope D3 — Custodied Semantic Holography](2026-07-24-bprf-custodied-semantic-holography.md)
- [Traveling Isogloss — Test Migration and Legacy-Deletion Matrix](2026-07-24-isogloss-test-migration-matrix.md)
- [BPRF/CSH Spike Report](../baselines/2026-07-24-bprf-csh-spike-report.md)

## 1. Executive decision

PR 9 replaces PR 8's compatibility-through-native-source approach with one
fail-closed product pipeline:

```text
JavaScript source
  -> complete source ownership ledger
  -> canonical semantic IR
  -> effect-delimited regional graph
  -> BPRF/DR regional realizations and distributed effect sinks
  -> optional moving-cover CSH/custody
  -> verified Isogloss artifact and root-group runtime
  -> protected JavaScript artifact plus owner-only certificate/sidecar
```

There is no `native`, `hybrid`, compatibility, unsupported-but-preserved, or
pass-through execution lane. Every selected author semantic is either:

1. represented and executed by the Isogloss architecture;
2. projected through an inventoried host-effect boundary controlled by an
   Isogloss continuation; or
3. rejected before output is emitted.

Parser acceptance is not language support. Reprinting syntax unchanged is not
protection. Protecting one bounded arithmetic return while leaving the rest of
the function native is not full-function protection.

The PR 8 source-region path in
`packages/ruam/src/isogloss/source-transform.ts` and
`packages/ruam/src/isogloss/source-sites.ts` is transitional evidence only. Its
`bprf | hybrid | native` coverage model must not remain in the PR 9 product
path. `packages/ruam/src/isogloss/source-region.ts` and
`packages/ruam/src/isogloss/bprf/*` remain useful as exact bounded-pure region
specializations inside a protected whole-root execution, not as permission to
leave surrounding source in the artifact.

## 2. Security and correctness claims

### 2.1 Targets

PR 9 targets all of the following simultaneously:

- **Non-bypass:** no authored executable JavaScript survives as a native
  implementation beside or around protected regions.
- **Exact semantics:** protected execution preserves JavaScript values,
  identity, effects, exceptions, iteration, scheduling, and reflection for the
  declared language and host surface.
- **No cheap semantic stream:** production never emits or resolves an ordered
  `SemanticOp + operand -> handler` trace.
- **Whole-root custody:** one verified root group owns the root, nested
  functions, class members, closures, continuations, and reentrant entries.
- **Fail-closed qualification:** an unowned AST node, unsupported semantic,
  incomplete effect inventory, or failed verifier prevents output publication.
- **Honest profiles:** local, custodied, private, TEE, and threshold modes make
  different claims and enforce different prerequisites.

### 2.2 Explicit impossibility boundary

Absolute secrecy is impossible for a wholly client-resident, semantics-
preserving JavaScript artifact against a full-access attacker.

The attacker can read and patch the artifact, step every JavaScript operation,
snapshot heaps and closures, monkey-patch host intrinsics, choose inputs, repeat
runs, and observe required outputs and effects. A local artifact must contain
enough information to produce its behavior. Client-visible randomness changes
representation but is not a secret. A finite local realization family can
eventually be covered and normalized, and the program remains a black-box
behavioral oracle.

Therefore `holographic-local` does **not** claim confidentiality,
irreversibility, anti-hooking, or prevention of eventual recovery. Its claim is:

> Every authored semantic is non-bypassably mediated by verified Isogloss
> execution, exact behavior is preserved, and recovery of a reusable semantic
> model has no cheap universal dispatch or complete native-body shortcut.

Only a different trust domain can make the client incomplete. Custodied,
private-function, TEE, or threshold profiles may claim client incompleteness
only when a necessary relation does not ship and the corresponding CSH gates
pass. Native-visible outputs remain learnable oracles even then.

Marketing, README, CLI help, package metadata, and build results must use this
language. A certificate proves build consistency and coverage, not cryptographic
secrecy or remote attestation.

## 3. Scope of “full JavaScript”

The release claim is tied to the repository's pinned parser and runtime matrix,
not to an unbounded promise about future ECMAScript editions.

For PR 9, full JavaScript means:

- every runtime ECMAScript construct accepted by
  `packages/ruam/src/constants.ts::BABEL_PARSER_PLUGINS` and the parser's
  standard syntax for the pinned `@babel/parser` version;
- scripts and modules, including top-level initialization;
- all nested functions and class executable members;
- dynamic source and loader boundaries described in Section 6;
- exact behavior in the supported Node, browser, worker, and extension hosts;
- TypeScript and JSX only after a deterministic frontend removes or lowers
  non-runtime syntax before semantic compilation.

Future parser upgrades may not silently expand the claim. A generated syntax
inventory test must fail when the parser accepts a runtime node for which the
ownership/compiler matrix has no explicit disposition.

## 4. Threat model

### 4.1 Attacker capabilities

Qualification assumes the attacker can:

- read, parse, copy, and rewrite all client code and payloads;
- know the complete artifact schema, runtime design, verifier, and handlers;
- hook generated functions, expressions, intrinsics, continuations, effects,
  promises, iterators, and network calls;
- set breakpoints before and after every client-visible step;
- capture arguments, returns, thrown values, heap graphs, closures, and carrier
  state;
- poison globals and prototypes before artifact load;
- replay, fork, and corrupt local state;
- compare builds, seeds, contexts, histories, and chosen inputs;
- create fresh authorized sessions unless the profile explicitly constrains
  them; and
- run static extraction, taint analysis, graph alignment, symbolic execution,
  and program synthesis.

For custodied profiles, the attacker does not automatically possess an
uncompromised custodian/TEE secret. Network traffic and an actively modified
client are still visible to the attacker.

### 4.2 Protected assets

- source-node and source-function ownership maps;
- a stable ordered operation/operand representation;
- complete protected logical state and stable frame layouts;
- reusable internal function bodies;
- carrier and chart representation state;
- custodied gluing relations, schedules, nonces, and service secrets;
- owner sidecars and source-origin maps; and
- exact program behavior under all supported hosts.

### 4.3 Expected leakage

The following are unavoidable and must be inventoried rather than denied:

- public inputs and outputs;
- thrown values and required error metadata;
- host calls, property effects, I/O, and their native-visible values;
- scheduling effects required by promises, generators, workers, and modules;
- public export/import contracts;
- declared transcript bucket and latency classes in custodied profiles; and
- source strings supplied by the attacker to dynamic-code APIs.

## 5. Architecture

### 5.1 Complete source ownership

Add a whole-program ownership phase rooted in
`packages/ruam/src/isogloss/source-roots.ts`.

It must discover and assign stable source identities to:

- script/module top-level execution;
- top-level functions, arrows, methods, accessors, and constructors;
- nested functions and escaped closures;
- class fields, private fields, computed keys, static blocks, and decorators if
  the pinned parser enables them;
- parameter defaults and destructuring initializers;
- module initialization and top-level await continuations;
- resource acquisition and disposal continuations; and
- statically known dynamic-source strings and loader entries.

The current function-only `compileProtectedSourceRoots()` result becomes one
part of a `ProtectedSourceProgram` containing a synthetic script/module entry
root and all root groups. `targetMode` and `threshold` may choose which public
contracts receive enhanced hardening, but they may never select a native
execution lane. Unselected author semantics still use the base verified
Isogloss profile.

Every executable author AST node receives exactly one disposition:

```ts
type SourceOwnership =
	| { kind: "regional"; rootGroupId: string; canonicalNodeIds: number[] }
	| { kind: "effect-boundary"; rootGroupId: string; boundaryId: string }
	| { kind: "compile-time-only"; loweringId: string };
```

There is no `native` or `unsupported-preserved` member.

### 5.2 Canonical semantic IR

The complete compiler boundary remains:

- `packages/ruam/src/compiler/index.ts`
- `packages/ruam/src/compiler/ir.ts`
- `packages/ruam/src/compiler/semantic-ops.ts`
- `packages/ruam/src/compiler/semantic-signatures.ts`
- `packages/ruam/src/compiler/cfg.ts`
- `packages/ruam/src/compiler/regions.ts`
- `packages/ruam/src/compiler/call-graph.ts`
- `packages/ruam/src/compiler/direct-call-targets.ts`
- `packages/ruam/src/compiler/visitors/expressions.ts`
- `packages/ruam/src/compiler/visitors/statements.ts`
- `packages/ruam/src/compiler/visitors/classes.ts`

Required changes:

1. Replace the transitional `SemanticOp = Op` alias with a representation-
   independent semantic catalog.
2. Remove obsolete VM operand conventions, fused physical operations, packed
   instruction targets, and safe-looking conservative fallbacks.
3. Give every operation exact stack, reference, coercion, call, allocation,
   throw, suspension, scope, object, global, and completion facts.
4. Treat a conservative or unknown fact as a compilation blocker for product
   execution, never as certifiable semantics.
5. Model ECMAScript Reference values where evaluation order, `this`, `super`,
   private brands, assignment, delete, or optional chaining requires them.
6. Represent normal and abrupt completion explicitly through calls, returns,
   throw, break, continue, `finally`, yield, await, and disposal.
7. Preserve source origins owner-side through canonical validation, then remove
   them from the production artifact.

`packages/ruam/src/compiler/pure-region-planning.ts`,
`pure-region-lowering.ts`, and `pure-region-learnability.ts` remain
specializers over canonical regions. Their rejection means “execute this
region through general Isogloss,” not “retain native source.”

### 5.3 Region graph and BPRF/DR lowering

The D2 redesign supersedes operation-at-a-time Traveling Isogloss.

`packages/ruam/src/isogloss/effect-graph.ts` and
`verify-effect-graph.ts` are transitional whole-node ownership scaffolds. They
must evolve from one codelet per canonical node into an effect-delimited
regional fabric:

```text
canonical CFG
  -> exact effect boundaries
  -> fused pure/local regions
  -> caller/continuation fission
  -> K contextual realizations across >= 2 structural ontologies
  -> braided necessary fragments
  -> distributed site-specific effect sinks
  -> regional carrier contracts
```

The following current modules supply bounded-pure machinery:

- `packages/ruam/src/isogloss/bprf/generate.ts`
- `packages/ruam/src/isogloss/bprf/scalar-source.ts`
- `packages/ruam/src/isogloss/bprf/validate.ts`
- `packages/ruam/src/isogloss/bprf/types.ts`

Production may reuse their exact algebra and validation, but not their generic
test evaluators. A rejected BPRF region remains owned by a general generated
regional realization. It never becomes native source.

General effects—property access, proxy/getter invocation, coercion, calls,
construction, dynamic import, throw, await, yield, resource disposal, and host
I/O—execute at generated site-specific sinks. There is no universal effect
packet, broker, handler table, or `resolve() -> operation` seam.

### 5.4 Root-group runtime

Complete `packages/ruam/src/isogloss/runtime/` with distinct reference and
production builders:

- `reference-runtime.ts`: readable canonical/regional differential oracle;
- `carrier.ts`: one root-group carrier and bounded continuation state;
- `contracts.ts`: entry, call, return, throw, effect, await, and yield routes;
- `continuations.ts`: recursion, reentry, async, generator, and disposal parks;
- `frame.ts`: changing regional frame/chart representations;
- `effects.ts`: generated site-specific sink construction utilities;
- `assembler.ts`: dependency-tiered AST assembly;
- `loader.ts`: artifact integrity and root-group initialization;
- `checks.ts`: optional runtime invariant checks without owner mappings; and
- `trace.ts`: opaque opt-in events only.

The production runtime consumes regional contracts and necessary fragments. It
must not consume canonical IR, `SemanticOp`, handler identities, source origins,
or an instruction array.

Carrier state is fixed-width and root-group-scoped. It tracks regional and
continuation contracts, realization/cover epochs, representation bases,
lineage, bounded active frames, and parked resumptions. It contains no opcode,
handler, source node, canonical operand, or next-instruction pointer.

### 5.5 Product pipeline

Rewrite `packages/ruam/src/transform.ts` as the sole orchestrator:

1. resolve options before parsing;
2. parse and create the complete ownership ledger;
3. compile all source roots and the top-level program root;
4. validate canonical IR and CFG;
5. form regional graphs and specialize eligible BPRF regions;
6. generate distributed effects and continuations;
7. apply the configured CSH/custody profile;
8. verify source ownership, regional equivalence, DR/CSH invariants, and
   artifact consistency;
9. assemble the production runtime and contract stubs; and
10. return code only after every verifier succeeds.

`packages/ruam/src/isogloss/source-transform.ts` must no longer be called by
the public transform. It may temporarily remain as a migration fixture until
its unique BPRF wrapper logic moves into regional lowering, then it and the
native-lane discovery model are deleted.

`packages/ruam/src/file-protection.ts`, `cli.ts`, `browser-worker.ts`, and
`browser-entry.ts` consume only this fail-closed pipeline. Directory protection
remains two-phase: every file must plan and verify before any output is
published.

### 5.6 Certificates and owner data

Extend `packages/ruam/src/isogloss/protection-certificate.ts` so a certificate
is derived only from authoritative build objects. It binds:

- source digest and parser configuration;
- complete executable AST-node inventory;
- source ownership ledger;
- canonical root groups, nodes, origins, and typed edges;
- regional ownership and all effect/ordinary-value boundaries;
- BPRF realization equivalence and fragment necessity;
- DR invariant evidence;
- CSH chart, cover, custody, and leakage evidence when enabled;
- serialized artifact digest;
- emitted runtime digest; and
- exact option/profile/seed labels used by the build.

Required zero fields include:

```text
unownedSourceNodeCount = 0
unprotectedCanonicalNodeCount = 0
unsupportedCanonicalNodeCount = 0
nativeFunctionCount = 0
nativeRegionCount = 0
hybridFunctionCount = 0
cfgMismatchCount = 0
artifactMismatchCount = 0
```

Validation recomputes counts and digests. It never accepts caller-authored
arrays as proof. Owner origins, schedules, relation metadata, and source maps
remain in an optional sidecar and are never embedded in client code.

## 6. Language and host boundary matrix

| Surface | Required representation | Observable boundary | Native author body allowed? | Qualification authority |
|---|---|---|---:|---|
| Script top level | Synthetic protected program root | Host global bindings and final completion | No | Native/reference/emitted differential |
| Module top level | Protected module-initialization root | Module loader, live import/export contracts | No | Real ESM graph differential |
| Literals and operators | Regional realization; BPRF only with exact-domain proof | Final value/coercion effects | No | `Object.is`, error, and event trace |
| Lexical declarations | Protected scope/frame contracts | Global lexical boundary where required | No | TDZ/hoist/Annex B corpus |
| Functions and closures | Child units in originating root group | Public/indirect callback entry | No | Closure identity and reentry tests |
| Objects and arrays | Regional allocation plus site-specific property sinks | Proxy/getter/setter/iterator effects | No | Descriptor, identity, and key-order oracle |
| Classes | Protected constructor/member/field/static-block units | External superclass/host constructor calls | No | Brand/home-object/`super` corpus |
| Branches and loops | Regional CFG and continuation contracts | Only effects caused by the taken path | No | CFG bisimulation and event logs |
| Exceptions and `finally` | Typed abrupt-completion routes | Thrown value and host error observation | No | Completion/event-order oracle |
| Generators | Parked protected frame plus yield contracts | `next/throw/return` protocol values | No | Native scheduling and cleanup oracle |
| Async functions/generators | Protected continuation contracts using host scheduling | Promise/thenable and async-iterator protocols | No | Microtask/event-order oracle |
| `using` / `await using` | Protected disposal stack and abrupt-completion routes | User disposal methods | No | Disposal/suppressed-error oracle |
| Static `import`/`export` | Protected module graph plus loader contracts | External package/module boundary | No | Cycles/live bindings/TLA tests |
| Dynamic `import()` | Protected loader effect and continuation | Module fetch/resolve and external module contract | No | Protected-artifact provenance test |
| Direct `eval` with static string | Precompiled child contract preserving lexical environment | Eval result/effects | No | Direct-eval scope differential |
| Direct `eval` with runtime string | Protected Dynamic Source ingress (Section 6.1) | Attacker-supplied string and its effects | No | Native-eval differential plus DR audit |
| Indirect eval / `Function` | Protected global-scope Dynamic Source ingress | Source string and global effects | No | Realm/global-scope differential |
| `with` | Protected dynamic environment lookup | Proxy/environment object hooks | No | Sloppy-scope differential |
| Proxies/getters/coercion | Site-specific effect sinks with reentry gates | Required user callback invocation | No | Exact event and carrier trace |
| Timers and event callbacks | Protected escaped closure contracts | Host scheduler | No | Browser/Node ordering oracle |
| Workers/service workers | Protected artifact loader and message contracts | Host worker/message boundary | No | Worker/MV3 execution fixture |
| Realm/iframe/vm context | Protected entry adapter per Realm | Cross-Realm identity/prototype boundary | No | Cross-Realm fixture |
| WebAssembly/native addon | Inventoried external component contract | Entire external component behavior | N/A to external component; no for JS wrapper | Boundary certificate and JS wrapper tests |
| Reflection and function metadata | Protected contract stub with compatible metadata | `name`, `length`, prototype, `toString`, stacks | No | Explicit reflection policy tests |
| TypeScript | Deterministic compile-time erasure before ownership | None at runtime | No raw TS runtime path | Frontend output ownership test |
| JSX | Deterministic configured JSX lowering before ownership | Framework calls after lowering | No raw JSX runtime path | Frontend output ownership test |

### 6.1 Protected Dynamic Source ingress

Arbitrary runtime-created JavaScript is the hardest no-pass-through boundary.
Native `eval`, `Function`, or script construction would violate PR 9. Rejecting
valid dynamic source would violate full-language correctness.

Implement a CSP-safe, data-driven Protected Dynamic Source subsystem:

```text
runtime source string
  -> protected parser/frontend
  -> ephemeral canonical graph
  -> ephemeral effect-delimited regional representation
  -> fixed universal regional combinators and site-specific effect contracts
  -> existing root-group carrier
```

Proposed modules:

- `packages/ruam/src/isogloss/dynamic-source/parser.ts`
- `packages/ruam/src/isogloss/dynamic-source/environment.ts`
- `packages/ruam/src/isogloss/dynamic-source/lower.ts`
- `packages/ruam/src/isogloss/dynamic-source/regions.ts`
- `packages/ruam/src/isogloss/dynamic-source/runtime.ts`

The subsystem may not call native `eval`, `Function`, `setTimeout(string)`, or
inject a script element. Direct eval receives a lexical-environment adapter;
indirect eval and `Function` receive a global-environment adapter; strictness,
Realm intrinsics, declarations, completion values, and error timing must match
native JavaScript.

Because the attacker supplies or observes the source string, this subsystem
does not promise secrecy of that string. It exists to preserve non-bypass and
semantic ownership. Its universal combinators are a reduced-protection boundary
under DR-15 and require a dedicated dynamic attacker gate. If the subsystem
cannot meet exact semantics and the reduced-protection gate, full-JavaScript
release remains blocked; native fallback is forbidden.

### 6.2 Module and loader provenance

Static and dynamic dependencies fall into one of two certificate classes:

- `protected-artifact`: code built and verified by the same PR 9 contract; or
- `external-host-module`: third-party/host code outside Ruam's source secrecy
  claim, reached only through an inventoried effect contract.

Author-owned dependency code may not be mislabeled external to bypass
protection. Workers, service workers, `importScripts`, blob/data module URLs,
and dynamically constructed import specifiers use the same provenance rule.

## 7. No-pass-through invariants

| ID | Invariant |
|---|---|
| NP-01 | Every authored executable AST node has exactly one protected or effect-boundary owner. |
| NP-02 | No product result contains a `native`, `hybrid`, unsupported-preserved, or compatibility execution lane. |
| NP-03 | BPRF ineligibility routes to general Isogloss regional execution, never source retention. |
| NP-04 | The emitted artifact contains no authored function, method, initializer, static block, or top-level body. |
| NP-05 | Nested closures, escaped callbacks, class members, and resumptions remain in their originating root group. |
| NP-06 | An unknown runtime AST kind, semantic operation, effect, or completion fails before emission. |
| NP-07 | Selection thresholds change hardening allocation only; they never reduce semantic ownership. |
| NP-08 | Dynamic code and loaders use protected ingress/provenance contracts and never native code construction. |
| NP-09 | All external code and host behavior is explicitly inventoried; author code cannot be declared external. |
| NP-10 | Certificates bind the verified regional artifact and emitted runtime, not only compiler-side counts. |
| NP-11 | File/directory publication is atomic and occurs only after all files satisfy NP-01 through NP-10. |
| NP-12 | Tests that only parse, round-trip, or natively execute unmodified syntax are not accepted as protection evidence. |

## 8. DR/BPRF invariants

These D2 invariants replace the paused operation-resolver design.

| ID | Invariant |
|---|---|
| DR-01 | Production never materializes `SemanticOp`, handler identity, canonical operand projection, or source-node identity. |
| DR-02 | No production table, function result, metadata record, packet, or payload maps a boundary/fragment to a language operation. |
| DR-03 | One carrier transition advances a regional fragment composition, never one canonical operation. |
| DR-04 | Except for inventoried public/indirect/reflection boundaries, a logical function is split across at least two continuation-owned regions. |
| DR-05 | Eligible direct-call SCCs contain caller-fused or cross-function fragments; no closed generated body owns a complete internal function. |
| DR-06 | Hardened mode has at least three reachable contextual realizations per eligible region and at least two verified structural ontologies. |
| DR-07 | Renaming, ordering, layout-only changes, and encoding-only changes do not count as multiple ontologies. |
| DR-08 | A protected source temporary has no stable generated slot, register, wire, chart, or closure field across regional transitions. |
| DR-09 | Each hardened pure result needs at least two independently located necessary fragments/shares; no single lane computes the ordinary result. |
| DR-10 | Runtime exposes no durable winning-lane, operation selector, expected-codelet, or semantic-dispatch scalar. |
| DR-11 | Getter, proxy, coercion, call, construction, throw, `finally`, disposal, await, yield, and scheduling order is exact. |
| DR-12 | No universal production handler, effect broker, packet decoder, interpreter switch, or message queue covers all static language effects. |
| DR-13 | Ordinary values materialize only at certified contract/effect boundaries and are re-encoded on protected reentry where eligible. |
| DR-14 | One root group owns one live carrier through recursion, reentry, suspension, and disposal. |
| DR-15 | Exports, callbacks, reflection, dynamic source, indirect calls, loaders, and host effects are inventoried as reduced-protection boundaries. |
| DR-16 | Every regional realization is exactly equivalent to the same canonical region for all admitted inputs and exits. |
| DR-17 | Every necessary fragment participates causally; deleting it changes or blocks a certified transition. |
| DR-18 | No serialized regional graph is a linear instruction stream or a one-codelet-per-canonical-node renaming. |

`packages/ruam/src/isogloss/effect-graph.ts` may remain operation-aware only as
an owner/build-side transitional verifier input. Its current `op`, `operand`,
`originId`, `resolvedCodeletId`, and `selectedWitnessClass` fields may not enter
production serialization.

## 9. CSH invariants

The following apply when moving-cover or custody is enabled:

| ID | Invariant |
|---|---|
| CSH-01 | Production never stores a complete canonical logical frame for a protected CSH region. |
| CSH-02 | No chart is a one-variable share set or independently decodes a source variable. |
| CSH-03 | Certified projections require the configured threshold of independently owned chart contributions. |
| CSH-04 | Chart ownership crosses region and, where valid, continuation/function boundaries. |
| CSH-05 | Every protected regional transition changes the chart cover or restriction maps. |
| CSH-06 | No universal global-section solver or decoder exists in production. |
| CSH-07 | Effects and returns use distributed site-specific projections. |
| CSH-08 | Ordinary values materialize only where JavaScript observability requires them. |
| CSH-09 | A custodied relation is necessary for every region claimed as custodied. |
| CSH-10 | No artifact, cache, error path, development flag, or fallback contains the custodied relation. |
| CSH-11 | Custodian responses are encoded chart/projection contributions, never operations, codelets, routes, source, or reusable keys. |
| CSH-12 | Public PFE topology is fixed within padded size/effect buckets and independent of the protected region. |
| CSH-13 | The protocol is actively secure for the declared profile. |
| CSH-14 | Custodied representation state advances monotonically; consumed transitions cannot replay. |
| CSH-15 | A client snapshot cannot fork one custodied representation epoch. |
| CSH-16 | Exact effects, errors, coercion, disposal, suspension, and scheduling are preserved. |
| CSH-17 | Network or attestation failure is explicit and never activates a complete local implementation. |
| CSH-18 | Every effect, ordinary-value projection, transcript class, and remote call is in the certificate. |
| CSH-19 | Local and custodied profiles expose distinct honest security claims. |
| CSH-20 | Owner sidecars, source origins, hidden schedules, and scorer metadata never ship to the client or responses. |

Current CSH reference modules include:

- `packages/ruam/src/isogloss/csh/reference.ts`
- `chart-custody-protocol.ts`
- `masked-custody-protocol.ts`
- `padded-masked-plan.ts`
- `transcript-buckets.ts`
- `custody-protocol.ts`

`testing-emitter.ts`, testing references, and reference custodians stay outside
package entries. `packages/ruam/src/isogloss/deployment-eligibility.ts`,
`options.ts`, and `plan.ts` remain the capability and no-fallback authorities.

## 10. Implementation work packages

### WP0 — Freeze the no-pass-through contract

**Modules**

- New tests under `packages/ruam/test/isogloss/`
- `docs/superpowers/specs/2026-07-25-pr9-full-javascript-protection-plan.md`

**Work**

1. Add red gates for native/hybrid stats, unchanged authored bodies, unowned
   nodes, operand/edge/variant tampering, and incomplete certificates.
2. Preserve the PR 8 benchmark only as a compatibility/performance baseline,
   never as protection evidence.
3. Create a generated syntax and semantic-support manifest.
4. Record fixed build/data seeds for all failures.

**Exit gate**

- Tests demonstrate that the PR 8 native lane fails NP-01 through NP-04.
- No skipped, todo, or always-pass qualification assertions exist.

### WP1 — Whole-program ownership and canonical frontend

**Modules**

- `src/isogloss/source-roots.ts`
- `src/compiler/index.ts`
- `src/compiler/visitors/{expressions,statements,classes}.ts`
- `src/compiler/ir.ts`
- `src/compiler/semantic-{ops,signatures}.ts`
- `src/constants.ts`

**Work**

1. Add synthetic script/module roots and ownership for all executable AST
   nodes.
2. Complete visitor coverage for the language matrix.
3. Separate TypeScript/JSX frontend lowering from runtime semantic compilation.
4. Make unknown/conservative semantics fatal.
5. Preserve exact source Reference and completion behavior.

**Exit gate**

- Generated parser-node inventory has no unclassified runtime node.
- Every semantic descriptor is precise and executable by the reference oracle.
- Every curated source has zero unowned nodes.

### WP2 — Canonical reference semantics and CFG

**Modules**

- `src/compiler/cfg.ts`
- `src/compiler/regions.ts`
- `src/compiler/call-graph.ts`
- `src/compiler/direct-call-targets.ts`
- `src/isogloss/runtime/reference-runtime.ts`

**Work**

1. Implement a representation-independent canonical evaluator.
2. Complete typed normal/abrupt/call/suspension/disposal edges.
3. Verify exception regions and `finally` completion replacement.
4. Model direct, indirect, reflection, and external call boundaries.

**Exit gate**

- Native and canonical reference values, identities, errors, and event logs
  agree across the complete static-language corpus.
- CFG bisimulation covers every reachable node and edge.

### WP3 — Regional graph and BPRF/DR fabric

**Modules**

- `src/isogloss/effect-graph.ts`
- `src/isogloss/verify-effect-graph.ts`
- `src/compiler/pure-region-{planning,lowering,learnability}.ts`
- `src/isogloss/bprf/*`
- New `src/isogloss/regions/*`

**Work**

1. Replace one-node codelets with fused effect-delimited regional contracts.
2. Generate at least two real ontologies and contextual variants.
3. Add caller/continuation fission and cross-function braiding.
4. Introduce changing frame/wire bases and necessary fragments.
5. Generate site-specific effects without a universal broker.
6. Prove operand, exits, fragments, and variants against canonical inputs.

**Exit gate**

- DR-01 through DR-18 pass mechanically.
- 10,000 generated regional graphs verify.
- Mutation of op, operand, exit, fragment, context, or variant is rejected.
- Static extraction finds no instruction stream or node-codelet bijection.

### WP4 — Emitted synchronous runtime

**Modules**

- `src/isogloss/runtime/*`
- `src/transform.ts`
- `src/random/entropy.ts`
- runtime AST/naming utilities retained by the branch

**Work**

1. Implement root-group loader, carrier, contracts, changing frames, and
   generated region/effect codelets.
2. Assemble with typed AST nodes; do not concatenate executable source text.
3. Bind the encoded artifact to verifier output.
4. Add optional runtime checks without source mappings.

**Exit gate**

- Static synchronous language families pass the four-way oracle.
- Production contains no canonical IR, handler catalog, source origin, native
  author body, or dynamic code construction.
- Node/browser CSP smoke tests execute, not merely scan.

### WP5 — Scope, closures, classes, and reentry

**Modules**

- compiler visitors and scope/capture analysis
- runtime `frame.ts`, `contracts.ts`, `continuations.ts`, and generated effects

**Work**

1. Complete lexical environments, TDZ, arguments, `this`, `super`, private
   brands, class initialization, and home objects.
2. Attach escaped closures to the originating carrier.
3. Route proxy, getter, setter, coercion, constructor, and callback reentry.

**Exit gate**

- Closure/class/reflection suites pass native/reference/emitted comparison.
- One active carrier exists at every instrumented reentrant semantic step.

### WP6 — Exceptions, iterators, and resource disposal

**Modules**

- `src/compiler/cfg.ts`
- statement/expression visitors
- runtime contracts/continuations/effects

**Work**

1. Preserve nested catch/finally and abrupt completion.
2. Implement IteratorClose/AsyncIteratorClose on every required exit.
3. Implement `using`, `await using`, disposal stacks, and suppressed errors.
4. Evolve carrier state before rethrowing uncaught values.

**Exit gate**

- Exact values, thrown identity, error metadata, disposal order, and event order
  match native JavaScript.
- A call after an uncaught error resumes from a valid evolved carrier.

### WP7 — Async functions and generators

**Modules**

- runtime continuations/carrier/contracts
- generator/async compiler semantics

**Work**

1. Park frames without cloning the root carrier.
2. Reacquire continuations in host scheduling order.
3. Support interleaved awaits, generators, async generators, `yield*`,
   `next(value)`, `throw`, `return`, rejection, and abandonment cleanup.

**Exit gate**

- Final values and explicit event logs match native JavaScript.
- No Ruam-owned queue serializes calls or changes microtask order.
- Parked state is bounded and cleaned up.

### WP8 — Modules, dynamic source, workers, and Realms

**Modules**

- New `src/isogloss/dynamic-source/*`
- `src/browser-worker.ts`
- `src/browser-entry.ts`
- product loader/provenance modules

**Work**

1. Execute real protected ESM graphs with live bindings, cycles, TLA, import
   attributes, `import.meta`, and dynamic import.
2. Implement Protected Dynamic Source without native code construction.
3. Enforce protected/external provenance for modules and workers.
4. Preserve direct-eval lexical scope and indirect/global evaluation.
5. Add worker, service-worker/MV3, Realm, and cross-Realm adapters.

**Exit gate**

- No `eval`, `Function`, string timer, script injection, or unverified author
  module appears in production.
- Dynamic-source and real ESM differential suites have zero mismatches.
- Reduced-protection DR-15 attacker gates pass for universal dynamic ingress.

### WP9 — Moving-cover CSH and custody profiles

**Modules**

- `src/isogloss/csh/*`
- `src/isogloss/deployment-eligibility.ts`
- `src/isogloss/options.ts`
- `src/isogloss/plan.ts`

**Work**

1. Integrate chart-local regional transitions without global frames.
2. Apply moving covers and distributed site-specific projections.
3. Integrate statefully masked custody and fixed transcript buckets.
4. Keep reference custodians, schedules, scorers, and generic evaluators out of
   package entries.
5. Re-run exact black-box learnability analysis for custodied candidates.

**Exit gate**

- CSH-01 through CSH-20 pass.
- Client completeness is false for every region claimed as custodied.
- Missing custody fails explicitly; no local relation exists.
- Active-client, replay, fork, topology, transcript, and learnability reports
  meet declared gates.

### WP10 — Product/API cutover and deletion

**Modules**

- `src/transform.ts`
- `src/index.ts`
- `src/cli.ts`
- `src/file-protection.ts`
- `src/browser-worker.ts`
- `src/isogloss/source-{transform,sites}.ts`
- package manifests, README, and web playground

**Work**

1. Route every API and CLI build through the verified whole-program pipeline.
2. Replace native/hybrid statistics with ownership and boundary statistics.
3. Remove PR 8 pass-through code and its compatibility claims.
4. Preserve bounded BPRF as an internal regional specialization.
5. Delete stale VM/bytecode/backend and native-lane identifiers from product
   sources and package output.

**Exit gate**

- `rg` and AST inventory find no product pass-through or fallback path.
- File and directory APIs cannot publish partially verified output.
- CLI, worker, web playground, README, and package metadata describe the same
  single engine and honest profile claims.

### WP11 — Adversarial and release qualification

**Modules**

- New attacker support under `packages/ruam/test/isogloss/support/`
- New qualification suites under `packages/ruam/test/isogloss/`
- benchmark scripts and versioned reports under `docs/superpowers/baselines/`

**Work**

1. Run full-format static extraction with design knowledge.
2. Hook regional combinators, effects, carrier, continuations, projections,
   dynamic ingress, and custody independently.
3. Run full-step taint, graph alignment, slicing, and synthesis.
4. Compare cross-input, cross-context, cross-history, and cross-build transfer.
5. Enforce runtime, size, memory, latency, and attacker-amplification budgets.
6. Obtain external design/security review.

**Exit gate**

- Every gate in Section 11 passes with a versioned report.
- No unresolved correctness, ownership, native-lane, or certificate issue
  remains.

## 11. Qualification gates

### 11.1 Build and inventory gates

From `packages/ruam`:

```sh
bun run typecheck
bun test
bun run build
```

Required inventory results:

- zero missing runtime modules and zero TypeScript errors;
- zero skipped/todo/always-pass release assertions;
- zero product imports of reference/test custodians or generic evaluators;
- zero legacy VM/backend/bytecode execution paths;
- zero native/hybrid/pass-through fields or branches;
- zero authored bodies in emitted production output;
- zero owner/source-origin data in production output; and
- one deterministic option/manifest/CLI source of truth.

### 11.2 Source ownership gates

For every test source:

1. enumerate all executable AST nodes;
2. assign exactly one source owner;
3. map every owner to canonical nodes or an inventoried effect boundary;
4. map every canonical node to exactly one regional owner;
5. bind every regional owner to the emitted artifact; and
6. assert all unowned, unsupported, native, and hybrid counts are zero.

Use structural AST/CFG fingerprints, not source substrings alone, to detect
surviving author bodies. String literals required by semantics are not by
themselves evidence of a native body.

### 11.3 Four-way differential oracle

Every semantic fixture runs through:

1. native JavaScript;
2. canonical reference execution;
3. regional/BPRF/CSH reference execution; and
4. emitted production execution.

Compare:

- primitives with `Object.is`, including `NaN`, infinities, and signed zero;
- BigInt and mixed-numeric errors;
- object identity and alias graphs;
- property descriptors, prototypes, private brands, holes, and key order;
- explicit side-effect logs;
- thrown value identity and specified error constructor/name/message;
- iterator/disposal events;
- microtask, generator, async, and host scheduling order; and
- post-completion carrier validity.

Generated stack text is compared only if explicitly included in the public
reflection policy.

### 11.4 Language corpus gates

Permanent corpus categories:

- literals, operators, templates, regexps, Unicode, optional chaining;
- IEEE-754 and BigInt edge cases with observable coercion;
- declarations, scopes, TDZ, hoisting, strict/sloppy, Annex B, arguments;
- destructuring, defaults, rest/spread, sparse arrays, property ordering;
- functions, arrows, recursion, closures, `this`, `new.target`;
- classes, fields, private state, accessors, static blocks, computed keys,
  inheritance, `super`, and built-in subclassing;
- all control statements and labeled abrupt completion;
- nested exceptions and `finally` completion replacement;
- proxies, accessors, Symbols, reflection, and coercion reentry;
- sync/async iteration and mandatory iterator closing;
- generators and async generators including sent values, `yield*`, `throw`,
  `return`, and abandonment;
- promises, thenables, species, rejection, and interleaving;
- explicit resource management and suppressed errors;
- scripts, real modules, cycles, live bindings, TLA, import attributes,
  `import.meta`, and dynamic import;
- direct/indirect eval, `Function`, `with`, and dynamic global bindings;
- workers, service workers, Realms, cross-Realm values, and callbacks; and
- TypeScript erasure and configured JSX lowering before protection.

### 11.5 Seed and fuzz gates

Use separate deterministic build and program/data seeds. Every failure prints
both and a minimized source/IR/regional-artifact reproducer.

| Tier | Seeds | Gate |
|---|---:|---|
| Local fast | 8 | Every focused implementation loop |
| Pull request | 32 | Every curated high-risk fixture |
| Extended CI | 256 | All semantic and architecture fixtures |
| Nightly/release | 1,024 | High-risk fixtures plus grammar/property fuzzing |

Property generators cover:

- parser-valid source ASTs with shrinkers;
- canonical CFGs, loops, exception regions, and suspension graphs;
- regional partitions and call/continuation fission;
- BPRF domains, realizations, fragment necessity, and ontology diversity;
- CSH charts, covers, thresholds, and custody transcripts;
- carrier interleavings and parked continuations; and
- corrupted artifacts, certificates, operations, operands, edges, fragments,
  variants, counts, and digests.

Correctness may not depend on a favorable seed. Constraint exhaustion includes
the complete reproducible seed/root/region/context record and never weakens an
invariant silently.

### 11.6 Static extractor gates

The hostile extractor knows the complete runtime and format. It fails the
release if it finds:

- an authored native body;
- a linear instruction/canonical-node array;
- a direct semantic operation, operand, source origin, or handler identity;
- a field mapping a region/fragment to a semantic action;
- a direct next-operation pointer;
- a one-codelet-per-node or one-function-per-source-function bijection;
- a stable frame/slot mapping across regional transitions;
- a single fragment/lane that computes a hardened ordinary result;
- a complete CSH frame, decoder, or client-held custodied relation; or
- an owner map, hidden schedule, or source scorer in production.

### 11.7 Dynamic attacker gates

Run both an O(1)-hook choke-point search and a full-step/full-heap attacker.

Measurements include:

- H90, O90, T90;
- operation F1 and canonical CFG recall;
- def-use F1;
- cross-input, cross-context, cross-history, and unseen-realization transfer;
- smallest correctness-preserving patch-collapse set;
- unavoidable effect leakage;
- trace/reconstruction/storage amplification; and
- attacker amplification divided by legitimate overhead.

Minimum local BPRF/DR gates:

- no hook emits a semantic operation or source identity directly;
- O(1)-hook operation F1 below 0.50 on held-out inputs;
- at least 30 percentage points of cross-input/context/history transfer loss;
- at least 10x full-step observation growth and 5x offline reconstruction CPU
  over the one-hook semantic-dispatch control;
- no patch at three or fewer localized sites yields a stable canonical stream;
- attacker amplification exceeds legitimate overhead; and
- zero semantic/effect/scheduling mismatches.

These are experimental architecture gates, not secrecy guarantees.

### 11.8 Reentry, suspension, and memory gates

- one active carrier per root group at every instrumented semantic step;
- recursion and callback/proxy/coercion reentry never clone carrier state;
- escaped closures remain correct after unrelated lineage evolution;
- two or more interleaved async calls preserve native order;
- generator `next/throw/return` and abandonment clean up correctly;
- uncaught throw/rejection followed by success uses valid evolved state;
- no Ruam-owned queue changes host scheduling; and
- carrier, frame, parked continuation, and chart history have fixed or proven
  workload-bounded memory.

### 11.9 Host and CSP gates

Execute—not merely scan—production artifacts in:

- Node;
- Bun;
- a browser page under restrictive CSP;
- a dedicated worker;
- a service-worker/MV3-style fixture;
- a poisoned-primordials environment; and
- a second Realm/iframe where available.

Generated runtime uses no native `eval`, `Function`, dynamic script insertion,
string timers, unverified network code, storage dependency, or debugger
statement. Author dynamic-source semantics execute through Section 6.1.

### 11.10 Custody gates

In addition to CSH-01 through CSH-20:

- client completeness is false by construction and extraction test;
- deleting the custodian relation prevents correct offline evaluation;
- missing responses and protocol failures never activate local completeness;
- nonce/session/epoch substitution, replay, snapshot fork, response rebinding,
  and representation substitution fail;
- topology and padded transcripts reveal no more than the declared bucket;
- responses cannot be converted into operations, routes, or reusable offline
  evaluators;
- exact black-box attack upper bounds meet policy; and
- reports distinguish hidden intermediate state from learnable final behavior.

### 11.11 Performance and resource gates

Versioned benchmarks report:

- parse, ownership, canonical compile, region formation, BPRF generation, CSH
  planning, verification, encoding, and emission time;
- original, runtime, payload, and sidecar bytes;
- bootstrap, first call, repeated call, recursion, property, exception,
  generator, async interleave, module, and dynamic-source time;
- peak and retained memory;
- custodied latency and bandwidth; and
- attacker work/storage/CPU amplification.

Initial release budgets retain the original plan's ceilings unless a new
versioned decision approves stricter ones:

- median output size at most 3x the frozen legacy measurement;
- median steady-state execution at most 3x legacy and P95 at most 5x;
- bootstrap at most 2x legacy;
- memory reaches a stable bound; and
- security efficiency is greater than one: measured attacker amplification
  exceeds legitimate overhead.

Failing performance does not authorize native fallback or weakened semantic
coverage.

### 11.12 Final Isogloss-versus-VM architecture comparison

After every language, host, no-pass-through, and artifact-binding gate passes,
run a final reproducible comparison against native JavaScript and the frozen
pre-PR-6 VM at `e8cecb56ba89d47512a16e325d81cf46f64b2ecb`. The release benchmark uses
`packages/ruam/scripts/bench-architectures.mjs --strict-protection`; a row is
eligible for an Isogloss-versus-VM aggregate only when its emitted-artifact
certificate proves full protection and all native/hybrid counts are zero.

Legacy compile failures, unsupported syntax, and native or partial pass-through
are reported as separate capability outcomes. They are never credited as VM
performance and never silently removed from the workload denominator.

The versioned JSON and Markdown report must include absolute measurements and
Isogloss/native, VM/native, and Isogloss/VM ratios for:

- end-to-end build latency plus parse, ownership, canonical compile, regional
  lowering, BPRF/CSH generation, verification, encoding, and emission phases;
- cold bootstrap/parse/compile latency, first-call latency, warm steady-state
  latency and throughput, and P50/P95/P99 distributions;
- raw, gzip, and Brotli bytes for source, per-program artifact, shared runtime,
  owner sidecar, certificate, package JavaScript, declarations, and browser
  worker bundle;
- peak RSS, peak heap, retained heap after forced collection where supported,
  carrier/continuation growth, and bytes per protected root/region;
- sync recursion, hot arithmetic/control, property/proxy/coercion, classes and
  private state, exceptions/finally/disposal, generators, async interleaving,
  modules/TLA/dynamic import, dynamic source, reentry, workers, and Realms;
- small, medium, large, and adversarial source/CFG scaling tiers;
- custodied profile request count, bandwidth, P50/P95/P99 added latency,
  concurrency, failure behavior, and custodian CPU/memory when applicable; and
- attacker work, observation, reconstruction, and storage amplification so
  performance costs are interpreted beside measured protection rather than in
  isolation.

Each architecture/workload pair runs in a fresh process. Cold and warm samples
remain separate; setup, garbage collection, and correctness-oracle time are
excluded from execution timing. The harness records the exact source/data and
build seeds, commit IDs, options, runtime versions, OS, CPU, memory, sample
counts, warm-up policy, and raw samples. At least 30 measured samples are used
for latency distributions, with confidence intervals or an equivalent robust
uncertainty report. Node, Bun, and the supported browser/worker environments
are reported separately rather than pooled.

The final release report replaces the misleading PR 8 comparison, whose fast
rows were primarily native pass-through. No final benchmark may be published
until `--strict-protection` succeeds for every Isogloss workload.

## 12. CI organization

Required focused suites:

```text
test/isogloss/source-ownership.test.ts
test/isogloss/whole-root-security-conformance.test.ts
test/isogloss/reference-runtime.test.ts
test/isogloss/regional-bisimulation.test.ts
test/isogloss/dr-invariants.test.ts
test/isogloss/static-extractor.test.ts
test/isogloss/dynamic-attacker.test.ts
test/isogloss/runtime-core.test.ts
test/isogloss/runtime-scope.test.ts
test/isogloss/runtime-classes.test.ts
test/isogloss/runtime-reentrancy.test.ts
test/isogloss/runtime-exceptions.test.ts
test/isogloss/runtime-iterators.test.ts
test/isogloss/runtime-resource-management.test.ts
test/isogloss/runtime-async.test.ts
test/isogloss/runtime-generators.test.ts
test/isogloss/runtime-modules.test.ts
test/isogloss/runtime-dynamic-source.test.ts
test/isogloss/runtime-workers-realms.test.ts
test/isogloss/certificate-artifact-binding.test.ts
test/isogloss/no-native-lane.test.ts
test/isogloss/seed-stress.test.ts
test/isogloss/csp-environments.test.ts
test/isogloss/csh-security-gates.test.ts
```

Fast CI runs typecheck, build, the complete deterministic semantic suite, and
32-seed high-risk fixtures. Extended and release jobs add browser environments,
256/1,024 seed tiers, attacker experiments, memory, and performance.

No workflow may convert a failed security/correctness gate into an allowed
failure on a release branch.

## 13. Kill and redesign criteria

Stop and redesign rather than ship if any remains true:

- any authored semantic executes from retained native source;
- full support depends on a native fallback for an unsupported node;
- dynamic source uses native code construction;
- production materializes a stable semantic operation/operand/handler seam;
- the regional artifact is bytecode or one-codelet-per-node under new names;
- one fixed frame transform normalizes histories cheaply;
- a small universal hook/patch recovers a reusable semantic trace;
- multiple ontologies reduce to naming, ordering, or encoding differences;
- a hardened result has a removable or non-necessary fragment;
- async equivalence requires serializing native-visible work;
- complete carrier/chart history grows without bound;
- exact semantics depend on favorable seeds;
- CSH reconstructs a complete frame or local decoder;
- a custodied artifact, cache, error, or debug path contains the missing
  relation;
- PFE topology identifies the protected region beyond declared leakage;
- correctness requires suppressing real JavaScript effects;
- performance can improve only by bypassing protection; or
- claims exceed the honest local/custodied impossibility boundaries.

## 14. Definition of done

PR 9 is complete only when:

- [ ] Every executable AST node in every supported script/module has one
      protected owner or inventoried host-effect boundary.
- [ ] No native/hybrid/pass-through product lane, statistic, diagnostic, or
      implementation remains.
- [ ] Every canonical semantic has a precise descriptor and reference rule.
- [ ] Native, canonical, regional reference, and emitted execution agree over
      the complete language/host corpus.
- [ ] BPRF rejection routes to general Isogloss, never retained source.
- [ ] DR-01 through DR-18 pass mechanically.
- [ ] Static and dynamic attacker gates pass with a versioned report.
- [ ] One carrier persists per root group through closures, recursion, reentry,
      exceptions, async, generators, modules, and disposal.
- [ ] Dynamic source and loaders use protected ingress/provenance contracts.
- [ ] TypeScript/JSX runtime syntax is lowered before ownership and never
      round-tripped as executable output.
- [ ] CSH-01 through CSH-20 pass for every profile that enables CSH.
- [ ] Custodied profiles are client-incomplete and contain no local fallback.
- [ ] Certificates bind source ownership, canonical IR, regional graphs,
      artifact bytes, runtime bytes, boundaries, and profile evidence.
- [ ] Production contains no source origins, owner maps, hidden schedules,
      reference evaluators, test emitters, custodians, or legacy VM code.
- [ ] Node, Bun, browser, worker, MV3/service-worker, poisoned-intrinsics, and
      cross-Realm execution gates pass.
- [ ] Typecheck, all tests, build, seed stress, fuzzing, performance, memory,
      and external security review pass.
- [ ] The strict final Isogloss-versus-VM comparison publishes versioned raw
      JSON and a reviewed Markdown report covering every Section 11.12 metric.
- [ ] README, API, CLI, web UI, and package metadata make only the honest
      non-bypass/exactness/local-amplification or explicit custody claims.

Until every item is complete, the build may be described as an implementation
in progress. It may not be released or documented as complete full-JavaScript
protection.

## 15. Immediate PR 9 execution order

1. Land the no-native-lane and whole-root tamper/ownership red gates.
2. Fix verifier operand and artifact binding before issuing certificates.
3. Introduce the complete program/source ownership ledger.
4. Route the public transform through whole-root canonical compilation.
5. Complete the canonical reference runtime and precise semantic catalog.
6. Replace per-node effect codelets with regional BPRF/DR fabric.
7. Emit synchronous general Isogloss with distributed effects.
8. Add scope/classes/reentry, exceptions/disposal, then async/generators.
9. Add modules, Protected Dynamic Source, workers, and Realms.
10. Integrate CSH/custody only after local exactness and DR gates pass.
11. Delete PR 8 native/hybrid source transformation and compatibility tests.
12. Run full attacker, environment, seed, fuzz, resource, and external review
    qualification.
13. Run the strict final Isogloss-versus-VM benchmark and publish its versioned
    JSON and Markdown report before opening the release pull request.

This ordering preserves the core rule throughout development: missing
capability blocks emission; it never widens a native pass-through lane.
