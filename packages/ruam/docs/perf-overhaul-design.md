# Ruam VM Performance Overhaul — Design

**Goal:** Drastically reduce VM execution overhead across all presets while preserving the at-rest bytecode security and resistance to decompilation. No security-relevant property of any preset may be silently weakened.

## Measured baseline (exec-isolated overhead, `scripts/bench.mjs --quick`)

| preset | aggregate | worst | notes |
|--------|-----------|-------|-------|
| default | 64.9x | 92x (fib-28) | pure dispatch/scope/stack floor |
| low | 60.8x | 82x | same, +dynamicOpcodes filtering |
| medium | 75.3x | 96x | + rolling cipher + string atomization |
| max | **1532x** | **1997x** | + Proxy stack, MBA, opcode mutation, incremental cipher, observation resistance, semantic opacity |

Bootstrap (one-time runtime build) is isolated and small (0.04–0.21ms); the figures above are steady-state per-instruction cost.

## Root-cause cost model (per executed instruction)

The sync dispatch loop, per instruction, performs:

1. **Fetch**: `PH = I[IP]; O = I[IP+1]; IP += 2` (2 typed-array reads).
2. **Rolling cipher** (medium+): re-derive a keystream (`2×Math.imul` + ~6 bit ops) and XOR-decrypt `PH`/`O` — **every execution, even the millionth loop iteration of the same instruction**. Purely redundant across repeats.
3. **Incremental cipher** (max): block-boundary check + second XOR layer + chain advance.
4. **Observation resistance** (max): witness increment per handler + periodic identity/canary checks that XOR into `rcState`.
5. **Dispatch indirection**: `_fdi = _ht[PH]` (physical→handler-index map), then `_fg0[_fdi]()` closure call + sentinel compare.
6. **Handler body**: stack ops are real `S.push()/S.pop()` calls; under `stackEncoding` they hit a **Proxy** whose set-trap allocates a 2-element `[tag, value]` array per numeric push; under MBA the body's arithmetic/bitwise ops are expanded into nested mixed-boolean expressions.

The 20x max blow-up is dominated by (a) the **Proxy stack** (per-op trap + per-push allocation) and (b) **MBA-expanded handler bodies**, both on the hot path. The medium delta over default is the **redundant per-instruction rolling-cipher decryption**.

## Optimization plan (phased, each validated by full test suite across seeds + benchmark)

### Phase 1 — Decode-once execution cache (centerpiece)
Lazily materialize, **once per unit on first execution**, a parallel `Int32Array` holding `[handlerIndex, decryptedOperand]` per instruction, cached on the unit object (which already lives in the closure-scope cache alongside the plaintext constant pool `U.c`). The steady-state loop then reads a ready handler index and plaintext operand — **no per-instruction `_ht` lookup and no per-instruction crypto**.

- **Eliminates** rolling-cipher re-decryption from every loop iteration (amortized to O(unit length), not O(executions)).
- **Eliminates** the `_ht[PH]` indirection from the hot loop.
- **Security:** the serialized bytecode strings stay fully encoded/encrypted at rest; the key derivation (key-anchor entangled) is unchanged; the materialized stream lives only in the same closure-scope cache that already holds decoded string constants, and is wiped by debug-protection alongside the rest of the cache. The handler indices remain per-build shuffled and the handler bodies remain obfuscated, so the cache reveals no more than the already-cached constant pool does.
- **Gating:** enabled when `rollingCipher && !incrementalCipher && !opcodeMutation && !observationResistance` (these three features’ threat model *is* runtime-memory instruction secrecy / tamper-response, which caching would defeat — so they keep the per-instruction path). When rolling cipher is off (default/low), a lighter variant still pre-resolves handler indices (security-neutral). Result: **medium** gets the full win; **default/low** get the indirection win; **max** keeps full security and is sped up by the other phases.

### Phase 2 — Non-Proxy stack encoding
Replace the `Proxy`-wrapped encoded stack with encode/decode folded into the `push`/`pop`/`peek` emission plus a parallel tag byte array — same "numeric stack values are XOR-encoded in memory" property, no per-operation trap and no per-push array allocation. Targets the largest single max cost; security-neutral (same values encoded the same way).

### Phase 3 — Superinstruction expansion (build-time, security-neutral)
Extend the fusion table with more hot-loop patterns (comparison+jump variants beyond `LT`, increment-store, method-call fusion, store-prop). Fewer dispatches per loop body. Bytecode stays encrypted; pure instruction-count reduction.

### Phase 4 — Function-call fast path
Reduce per-`exec` fixed overhead (register-array construction, slot save/restore) that dominates recursion (fib). Security-neutral.

## Non-goals / guardrails
- All 2204 tests pass deterministically across any seed after every phase.
- No preset's documented security property is removed; where a speed/secrecy trade exists (Phase 1 vs incremental/mutation/observation), the secure path is retained and the fast path is gated off.
- Build-time and runtime changes both go through the existing centralized systems (NameRegistry, deriveSeed, tuning) — no parallel mechanisms.
