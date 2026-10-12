# Frozen existing-root inventory

The first A1 admission pass rejects all three frozen roots. No algorithm/state realization has been implemented or qualified, and this inventory supplies no evidence that replacing the current VM improves protection.

The required finished product must preserve the full JavaScript scope and protected selection supported by current Ruam. This is a component preflight for one candidate architecture, not a narrowed product specification. Rejected components mean this candidate cannot replace the product on its own; they do not authorize dropping syntax, leaving declined code unprotected, or calling a subset compiler complete. Any combined approach must retain that full-scope requirement and independently qualify the protection it claims.

The baseline is `f47f2783c5cbbc792910de85ba9c48a66cb1eb2c`. [roots.json](roots.json) fixes the root order, full component contracts, candidate tickets, source-byte SHA256 hashes, rejection reasons and algorithm-family findings before any alternative realization or attack result is selected. The source hashes cover full files, even when the root is one class. This prevents a neighboring export or import change from silently changing the experiment. `dependencyPaths` records runtime module closure; type-only dependencies and call-site evidence have separate lists. The global source table also freezes evidence used to exclude synthetic and effectful candidates.

## Selection and scope

| Order | Existing root | Why selected | Admission |
| --- | --- | --- | --- |
| 1 | `compiler/opcode-mutation.ts::MutationState` | Smallest named synchronous event/observation interface among these substantive maintained-state components; first pilot candidate | Rejected: unproved domains and ownership; no distinct family set |
| 2 | `naming/registry.ts::NameRegistry` and its returned scope/token/generator graph | Real shared allocation state and multiple observations expose identity, order and error obligations | Rejected: escaping mutable state, arbitrary effects, unbounded domains |
| 3 | `compiler/emitter.ts::Emitter` | Real collection/index maintenance with updates and exported records | Rejected: escaping mutable arrays/entries and coercion effects |

These are production compiler components, not independent application policy evaluators. That provenance is a limitation. The order is chosen from their existing state roles and contracts, without selecting favorable alternative implementations. A rejected root stays in the inventory and cannot be replaced by a new synthetic workload. The exact three-root requirement is frozen, but the requirement for three applicable algorithm families is **unmet**.

The qualification specimens at `packages/ruam/src/regional/qualification/specimens.ts:1-12` explicitly identify themselves as synthetic calibration. The older repository admission list at lines 49-57 is not evidence of A1 eligibility. `packages/ruam/scripts/bench.mjs:49-83` supplies authored one-shot kernels, not persistent component contracts. The worker (`packages/ruam/src/browser-worker.ts:26-56`) observes time and emits host messages. `apps/web/components/Playground.tsx` depends on React, asynchronous imports, CodeMirror, DOM and Worker effects. None is promoted to a convenient pure evaluator by discarding its external API.

## First root: MutationState

The whole class is at `packages/ruam/src/compiler/opcode-mutation.ts:59-101`. Its constructor accepts a shuffle-map array; `applyMutation(seed, tableSize)` is its only named update; `getPhysical(logical)` is its only named observation. There is no reset or delete method. A new construction is a new instance, not an invented reset event. The rest of `opcode-mutation.ts` remains hashed runtime context but is not being represented as methods of this class.

The constructor copies the input iterable to its forward map, zero-fills a reverse map using the input length, then overwrites reverse slots in ascending source-index order. Four swap attempts consume exactly eight LCG steps. Equal physical indices and nullish reverse entries skip updates; accepted swaps update the reverse map and then both forward entries. This is already incremental maintenance of two mutually dependent views.

Only the seed is explicitly coerced to uint32. The `tableSize` remainder operand, shuffle-map entries, input length, query argument and event count have no class-level domain validation. Ordinary array length obeys native JavaScript limits; no smaller usable resource bound is established. The production caller constructs a permutation with `generateShuffleMap` (`compiler/opcodes.ts:1068-1082`) and supplies `OPCODE_COUNT` (`transform.ts:520,1148`). Those facts can inform a future proved whole-graph admission, but they do not allow trimming this frozen class contract to a new permutation-only interface. Duplicate maps, holes, non-integer entries, nonpositive/fractional/nonfinite table sizes and fallback queries are not declared invalid by the class.

For example, an actual invocation on this baseline gives:

```text
new MutationState([0, 0]): observations for 0 and 1 => [0, 0]
after applyMutation(1, 2): observations for 0 and 1 => [0, 1]
new MutationState([]).getPhysical(-0): Object.is(result, -0) => true
new MutationState([]).getPhysical(NaN): Number.isNaN(result) => true
```

A reverse map with missing entries instead of zero-filled slots, or a generic bijection invariant, would change existing behavior. No authored precondition throws exclude these inputs. Iterator/property/coercion errors and their timing remain part of the JavaScript boundary unless a larger owning graph proves them impossible. TypeScript `private` is not runtime `#private`; the arrays also remain named own properties. No complete boundary proof rules out reflection or mutation.

The frozen partial ticket skips a selected transposition when either selected logical value is zero, while preserving PRNG advancement and all other behavior. It withholds the existing algorithm details equally from every baseline; it does not supply a complete replacement. A table-size guard and a fully specified replacement are explicit negative controls. **None of these tickets has been scored**, because the admission stop occurs first.

Specializing four swaps by unrolling is still the same algorithm. A relation indexed in both directions resembles the existing representation and assumes an unproved bijection unless it models malformed histories. Incremental shared views are already the source algorithm. A replay log could be a useful cheap recovery attack, but naming it a third qualifying compiler family would not establish one. The selected pilot stops here.

## Second root: NameRegistry graph

The registry's full named surface is constructor, `isResolved`, `exclude`, `createScope`, `resolveAll`, `getAlphabet`, `dumpAll`, `tokenCount` and `createDynamicGenerator` (`naming/registry.ts:21-213`). Its returned objects extend the boundary: `NameScope` exposes `id`, `parent`, mutable `tokens`, mutable `children`, `lengthTier`, `claim`, `claimMany`, `freeze`, `nextPrng` and `generateCandidate` (`naming/scope.ts:56-122`). Tokens expose `key`, `scope`, `name`, `toString` and callable `resolve` (`naming/token.ts:10-44`); the last is marked internal in a comment but is not runtime inaccessible. Generator closures have independent PRNG state and a shared used-name set.

The objects cannot be replaced with primitive handles while claiming the same API. `createScope` returns the actual object in the registry and parent graph; `claim` returns the actual stored token. Array/Map mutations can delete or reorder live state, despite the absence of named delete/reset methods. Duplicate scope identifiers are accepted; duplicate token keys throw; `claimMany` retains earlier successful claims when a later key fails. External mutation can create cycles or invoke substituted methods during traversal.

`resolveAll` generates its alphabet before traversing roots in registration order, then descendants depth-first in child-array order. Each scope is frozen after its tokens resolve and before child traversal. The final resolved flag is set only after success. An exception can leave an alphabet, earlier resolved tokens and frozen scopes observable while the registry still reports unresolved. An arbitrary `exclude` iterable can execute caller code. A pure transaction/event adapter that rolls these effects back would not preserve the existing contract.

The nominal PRNG state is uint32 and alphabet length is 64. The source does not bound scope/token counts, iterator length, graph depth, string lengths, candidate retries or collision-driven name growth. Simple Set-to-trie conversion would not constitute a new algorithm family and would not solve the ownership/effect obligations.

The frozen partial ticket preserves pre-resolved token values while consuming and reserving their ordinary candidate so other outputs keep their sequence. Traversal, collision behavior and errors remain unspecified by that ticket. It is only a candidate; admission fails before implementation or attack spending.

## Third root: Emitter

The class at `compiler/emitter.ts:23-101` includes both public arrays, `ip`, `emit`, `patchJump`, `patchOperand`, `addConstant`, and every convenience adder (string, number, boolean, null, undefined, regex, bigint). It has no explicit reset or delete method. Both arrays and their contents remain directly mutable; clearing an array does not clear the private historic key map.

The de-duplication key snapshots string conversions at insertion time (`emitter.ts:108-112`). It retains the original entry object by reference and the first numeric index for that key. Later entry mutation or array truncation does not rebuild the map. The arrays also become fields of the compiled unit (`compiler/index.ts:386-387`). Numeric keys conflate negative and positive zero; all NaNs share their string key. Regex keys concatenate pattern and flags with colons. The bigint and regex convenience methods do not validate their content.

An actual baseline invocation demonstrates the retained alias and historical mapping:

```text
entry = { type: "number", value: 1 }
emitter.addConstant(entry) => 0
entry.value = 2
emitter.addNumberConstant(1) => 0
emitter.constants[0] === entry => true
emitter.constants[0].value => 2
```

Thus scanning the current `constants` array for equal values is not an exact replacement for its indexed history. Preserving semantics requires retaining original entry identities and a historic key mapping. Coercion and property reads can also execute caller code or throw before any append; a key map rebuilt from visible records erases this behavior. Index, opcode and operand parameters are not checked against a narrower numeric domain.

The frozen partial ticket distinguishes negative zero in both direct and convenience numeric additions while preserving all other historic and alias behavior. This deliberately small edit is a negative/control-scale task and cannot establish robust edit protection by itself. No transformed candidate or scoring result is claimed.

## Boundary probes and stopping decision

The inspected baseline was executed with Bun. In addition to the MutationState and Emitter examples above, creating a scope, claiming one token and then calling `scope.tokens.clear()` changed the registry's `tokenCount` from 1 to 0. These probes demonstrate concrete admission blockers; they are not comprehensive correctness tests and are not measurements of attack difficulty. Source inspection supplies the broader effects and numeric obligations.

All three roots remain rejected. The selected design requires admission and the cheapest permitted sidecar/reset/replay audit before expensive realizations. An admission rejection is already a stopping condition; inventing a sanitized facade, suppressing unknown effects, restricting numbers to convenient bounds, or substituting a synthetic root would bypass that condition. There is no claim that future external application roots cannot qualify. This frozen experiment simply does not authorize implementation, protection qualification, or replacement of the VM.
