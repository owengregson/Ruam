# Kerckhoffs's Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ruam's obfuscated output resist deobfuscation even when the attacker has full source code access, by applying Kerckhoffs's principle — security depends on per-build secrets, not algorithm secrecy.

**Architecture:** Three complementary hardening layers: (1) Temporal Entanglement moves instruction decryption from load-time into the VM dispatch loop so hooking the loader yields only encrypted bytecode, (2) Semantic Opacity makes handler logic resist automated analysis via opaque predicates, handler aliasing, and encoding diversity, (3) Observation Resistance silently corrupts computation when instrumentation is detected via function identity binding, cross-handler witness values, prototype chain canaries, and stack integrity probes. No timing-based detection. Each layer is a new boolean option, configurable independently, with tuning parameters.

**Tech Stack:** TypeScript, Ruam AST node system (`ruamvm/nodes.ts`), `deriveSeed()` for PRNG isolation, `NameRegistry` for identifiers, `bun:test` for testing.

**Constraint:** No `performance.now()` or timing-based detection — too fragile across environments.

---

## File Structure

### New Files

All paths below are relative to `packages/ruam/`:

| File | Responsibility |
|------|---------------|
| `src/compiler/incremental-cipher.ts` | Build-time: compute per-block cipher keys, encrypt instructions block-by-block with chain feedback |
| `src/compiler/basic-blocks.ts` | Shared basic block identification (extracted from block-permutation.ts, used by both block permutation and incremental cipher) |
| `src/ruamvm/builders/incremental-cipher.ts` | Runtime builder: emit `icBlockKey`, `icMix`, `icBuildLeaders` functions |
| `src/ruamvm/opaque-predicates.ts` | Opaque predicate library: always-true/false conditions from number theory, injected into handler bodies |
| `src/ruamvm/handler-aliasing.ts` | Handler aliasing: structurally different implementations of the same logical opcode |
| `src/ruamvm/encoding-diversity.ts` | Per-handler MBA variant selection for structural diversity across handlers |
| `src/ruamvm/observation-resistance.ts` | Observation resistance AST builders: function identity binding, monotonic witnesses, WeakMap canaries, stack probes |
| `test/security/incremental-cipher.test.ts` | Tests for temporal entanglement / incremental cipher |
| `test/security/semantic-opacity.test.ts` | Tests for opaque predicates, handler aliasing, encoding diversity |
| `test/security/observation-resistance.test.ts` | Tests for observation resistance layer |

### Modified Files

| File | What Changes |
|------|-------------|
| `src/types.ts` | Add 3 new option fields: `incrementalCipher`, `semanticOpacity`, `observationResistance` |
| `src/presets.ts` | Add new options to presets, add auto-enable rules |
| `src/tuning.ts` | Add tuning parameters for all three features |
| `src/option-meta.ts` | Add option metadata entries and auto-enable rules |
| `src/naming/claims.ts` | Add runtime/temp name claims for new features |
| `src/naming/compat-types.ts` | Add new fields to RuntimeNames/TempNames interfaces |
| `src/ruamvm/builders/interpreter.ts` | Wire incremental cipher into dispatch loop, integrate handler aliasing, opaque predicates, encoding diversity, observation resistance witnesses |
| `src/compiler/block-permutation.ts` | Extract shared block identification into `basic-blocks.ts`, import from there |
| `src/ruamvm/assembler.ts` | Wire new builders into assembly pipeline |
| `src/transform.ts` | Wire new options into compilation and encoding pipeline |
| `src/compiler/rolling-cipher.ts` | Export `deriveImplicitKey` for use by incremental cipher |
| `src/ruamvm/handlers/registry.ts` | Add witness slot fields to HandlerCtx |
| `src/ruamvm/handlers/helpers.ts` | Add witness write/verify helpers |

---

## Phase 1: Temporal Entanglement (Incremental Cipher)

### Concept

Currently, the rolling cipher decrypts instructions inline in the dispatch loop (interpreter.ts), not in the loader. The loader only handles custom-alphabet decoding, optional RC4 decryption, deserialization, and string constant decoding. The incremental cipher adds a SECOND encryption layer on top of the rolling cipher, with chain-dependent decryption that creates sequential dependency within basic blocks.

**Key design decisions:**
- Uses **block-epoch keying**: each basic block has a base key derived from `(masterKey, blockId)`. Within a block, the chain state is sequential. At block boundaries, the state resets to the target block's base key.
- This means loops work correctly — the same block always decrypts the same way regardless of which iteration you're on.
- The **chain feedback** within a block uses the decrypted opcode+operand of the previous instruction, creating a chicken-and-egg: you can't decrypt instruction N without having decrypted instruction N-1.
- Coexists with existing rolling cipher (incremental cipher is an additional layer on top).

**Auto-enable rule:** `incrementalCipher` → auto-enables `rollingCipher` (the existing position-based layer is a prerequisite).

### Task 1: Add option plumbing

**Files:**
- Modify: `src/types.ts:165-166` (before `target` field)
- Modify: `src/presets.ts:23-88` (all three presets)
- Modify: `src/presets.ts:146-164` (auto-enable rules)
- Modify: `src/option-meta.ts:43-177` (add entry)
- Modify: `src/option-meta.ts:185-190` (add auto-enable rule)
- Modify: `src/tuning.ts:18-82` (add tuning params)
- Modify: `src/tuning.ts:86-164` (add values to all 3 profiles)

- [ ] **Step 1: Add `incrementalCipher` to VmObfuscationOptions**

In `src/types.ts`, add before the `target` field (line ~165):

```typescript
/**
 * Move instruction decryption from load-time into the VM dispatch loop.
 *
 * Each instruction is decrypted just-in-time using a chain state that
 * evolves based on previously decrypted instructions. Hooking the loader
 * yields only encrypted bytecode. Block-epoch keying ensures loops and
 * jumps work correctly.
 *
 * Requires {@link rollingCipher} (auto-enabled).
 */
incrementalCipher?: boolean;
```

- [ ] **Step 2: Add to presets**

In `src/presets.ts`:
- `low` preset: `incrementalCipher: false,`
- `medium` preset: `incrementalCipher: false,`
- `max` preset: `incrementalCipher: true,`

- [ ] **Step 3: Add auto-enable rule**

In `src/presets.ts` `resolveOptions()`, add after the opcodeMutation rule (~line 164):

```typescript
// incrementalCipher requires rollingCipher
if (resolved.incrementalCipher && !resolved.rollingCipher) {
    resolved.rollingCipher = true;
}
```

In `src/option-meta.ts` `AUTO_ENABLE_RULES`, add:

```typescript
{ when: "incrementalCipher", enables: "rollingCipher" },
```

- [ ] **Step 4: Add option metadata entry**

In `src/option-meta.ts` `OPTION_META`, add to the Security category (after vmShielding):

```typescript
{
    key: "incrementalCipher",
    label: "Incremental Cipher",
    category: "security",
    description: "Move instruction decryption into the VM dispatch loop",
    cliFlag: "--incremental-cipher",
},
```

- [ ] **Step 5: Add tuning parameters**

In `src/tuning.ts` `TuningProfile` interface, add:

No tuning parameters needed for Phase 1 — the incremental cipher's behavior is determined by the block structure (from basic-blocks.ts) and the master key (from rolling cipher). Adding unnecessary tuning knobs would violate YAGNI.

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/owengregson/Documents/Ruam && bun run typecheck`
Expected: PASS (new option is optional, so no existing code breaks)

- [ ] **Step 7: Run tests to verify no regression**

Run: `cd /Users/owengregson/Documents/Ruam && bun run test`
Expected: All 2095 tests PASS

- [ ] **Step 8: Commit**

```bash
cd /Users/owengregson/Documents/Ruam
git add packages/ruam/src/types.ts packages/ruam/src/presets.ts packages/ruam/src/tuning.ts packages/ruam/src/option-meta.ts
git commit -m "feat: add incrementalCipher option plumbing (types, presets, tuning, meta)"
```

### Task 2: Add naming claims for incremental cipher

**Files:**
- Modify: `src/naming/claims.ts:10-65` (RUNTIME_KEYS)
- Modify: `src/naming/claims.ts:80-203` (TEMP_KEYS)
- Modify: `src/naming/compat-types.ts` (RuntimeNames/TempNames interfaces)

- [ ] **Step 1: Add runtime name claims**

In `src/naming/claims.ts` `RUNTIME_KEYS`, add before the closing `] as const`:

```typescript
"icDecrypt",
"icMix",
"icBlockKey",
```

- [ ] **Step 2: Add temp name claims**

In `src/naming/claims.ts` `TEMP_KEYS`, add before the closing `] as const`:

```typescript
"_icState",
"_icBk",
"_icPrev",
```

- [ ] **Step 3: Add to RuntimeNames interface**

In `src/naming/compat-types.ts`, add to the `RuntimeNames` interface:

```typescript
icDecrypt: string;
icMix: string;
icBlockKey: string;
```

- [ ] **Step 4: Add to TempNames type**

In `src/naming/compat-types.ts`, add to the `TempNames` type the new keys: `"_icState"`, `"_icBk"`, `"_icPrev"`.

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/owengregson/Documents/Ruam && bun run typecheck`
Expected: PASS

- [ ] **Step 6: Run tests**

Run: `cd /Users/owengregson/Documents/Ruam && bun run test`
Expected: All tests PASS (naming system auto-resolves new claims)

- [ ] **Step 7: Commit**

```bash
cd /Users/owengregson/Documents/Ruam
git add packages/ruam/src/naming/claims.ts packages/ruam/src/naming/compat-types.ts
git commit -m "feat: add naming claims for incremental cipher runtime helpers"
```

### Task 3: Extract shared basic block identification + build-time incremental cipher

**Files:**
- Create: `src/compiler/basic-blocks.ts` (extracted from block-permutation.ts)
- Modify: `src/compiler/block-permutation.ts` (import from basic-blocks.ts instead of inline)
- Create: `src/compiler/incremental-cipher.ts`

- [ ] **Step 1: Extract shared basic block identification from block-permutation.ts**

Create `src/compiler/basic-blocks.ts` by extracting the block identification logic from `src/compiler/block-permutation.ts`. The new module exports `identifyBasicBlocks(unit)` which returns block boundaries. Then modify `block-permutation.ts` to import from `basic-blocks.ts` instead of using inline logic. This satisfies Design Principle 1 (one centralized system per responsibility).

Run tests after this refactor to ensure block permutation still works: `bun test`

- [ ] **Step 2: Write the build-time incremental cipher module**

Create `src/compiler/incremental-cipher.ts` (in `compiler/` alongside other build-time crypto):

```typescript
/**
 * Build-time incremental cipher — block-epoch keyed instruction encryption.
 *
 * Each basic block gets a base key derived from (masterKey, blockId).
 * Within a block, each instruction's decryption key chains from the
 * previous instruction's decrypted opcode+operand, creating sequential
 * dependency. At block boundaries the chain resets to the target block's
 * base key.
 *
 * This makes static decryption require simulating execution from block
 * entry, and makes hooking the loader useless (instructions stay encrypted
 * in the cached unit).
 *
 * @module compiler/incremental-cipher
 */

import {
	FNV_PRIME,
	MIX_PRIME1,
	MIX_PRIME2,
} from "../constants.js";
import type { BytecodeUnit } from "../types.js";
import { identifyBasicBlocks } from "./basic-blocks.js";

// Re-export block identification from shared module
export { identifyBasicBlocks } from "./basic-blocks.js";

/** A basic block with assigned ID for cipher keying. */
export interface CipherBlock {
	startIp: number;
	endIp: number;
	blockId: number;
}

/**
 * Build cipher blocks from the shared block identification.
 * Assigns sequential blockIds for use as cipher key derivation input.
 */
export function buildCipherBlocks(unit: BytecodeUnit): CipherBlock[] {
	const blocks = identifyBasicBlocks(unit);
	return blocks.map((b, i) => ({
		startIp: b.startIp,
		endIp: b.endIp,
		blockId: i,
	}));
}

// --- Block key derivation ---

/**
 * Derive a per-block base key from (masterKey, blockId).
 * Uses FNV-1a mixing — same algorithm as deriveSeed but numeric.
 */
export function deriveBlockKey(masterKey: number, blockId: number): number {
	let h = masterKey;
	h = Math.imul(h ^ blockId, FNV_PRIME) >>> 0;
	h = Math.imul(h ^ (blockId * 0x9e3779b9), MIX_PRIME1) >>> 0;
	h ^= h >>> 16;
	h = Math.imul(h, MIX_PRIME2) >>> 0;
	h ^= h >>> 13;
	return h >>> 0;
}

/**
 * Chain feedback: mix the current chain state with a decrypted instruction.
 * This is the "evolving key" that creates sequential dependency.
 */
export function chainMix(state: number, opcode: number, operand: number): number {
	let h = state;
	h = Math.imul(h ^ opcode, MIX_PRIME1) >>> 0;
	h = Math.imul(h ^ operand, MIX_PRIME2) >>> 0;
	h ^= h >>> 16;
	return h >>> 0;
}

// --- Build-time encryption ---

/**
 * Build a map from instruction IP to blockId for fast lookup.
 */
export function buildIpToBlockMap(blocks: Block[]): Map<number, number> {
	const map = new Map<number, number>();
	for (const block of blocks) {
		for (let ip = block.startIp; ip < block.endIp; ip++) {
			map.set(ip, block.blockId);
		}
	}
	return map;
}

/**
 * Encrypt instructions with incremental cipher (block-epoch keying + chain feedback).
 *
 * Applied AFTER the existing rolling cipher encryption. The incremental cipher
 * adds a second layer that requires sequential processing to undo.
 *
 * @param instrs - Flat instruction array [op0, operand0, op1, operand1, ...]
 *                 (already rolling-cipher encrypted if rollingCipher is on)
 * @param masterKey - Rolling cipher master key
 * @param blocks - Basic block boundaries
 */
export function incrementalEncrypt(
	instrs: number[],
	masterKey: number,
	blocks: Block[]
): void {
	for (const block of blocks) {
		let chainState = deriveBlockKey(masterKey, block.blockId);

		for (let ip = block.startIp; ip < block.endIp; ip++) {
			const i = ip * 2;
			if (i + 1 >= instrs.length) break;

			// XOR with chain state
			const keyLo = chainState & 0xffff;
			const keyHi = chainState;

			instrs[i] = (instrs[i]! ^ keyLo) & 0xffff;
			instrs[i + 1] = (instrs[i + 1]! ^ keyHi) | 0;

			// Chain feedback uses the values BEFORE this encryption
			// (i.e., the values the runtime will see AFTER decrypting)
			// Since we're encrypting: plaintext = ciphertext ^ key
			// The runtime decrypts first, then feeds plaintext into chain.
			// So we feed the PRE-encryption values (the "plaintext" from
			// this layer's perspective, which is rolling-cipher ciphertext).
			const plainOp = instrs[i]! ^ keyLo; // undo to get what runtime will see
			const plainOperand = instrs[i + 1]! ^ keyHi;
			chainState = chainMix(chainState, plainOp & 0xffff, plainOperand);
		}
	}
}

```

**NOTE:** Block identification is imported from `src/compiler/basic-blocks.ts` (the shared module extracted from block-permutation.ts in Step 1). No placeholder functions needed — the shared module handles all opcode classification.

- [ ] **Step 2: Verify the encryption/decryption round-trip is correct**

The critical invariant: for each instruction in a block, the runtime will:
1. Read encrypted values from the instruction array
2. XOR with current chainState to get the rolling-cipher-encrypted values
3. Feed those decrypted values into chainMix to advance the chain
4. The rolling cipher then does its own position-based decryption

The build-time encryption must produce ciphertext such that this sequence works. **Write a unit test first:**

Create `test/security/incremental-cipher.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import {
    deriveBlockKey,
    chainMix,
    incrementalEncrypt,
    buildCipherBlocks,
} from "../../src/compiler/incremental-cipher.js";

describe("incremental cipher", () => {
    describe("deriveBlockKey", () => {
        it("produces 32-bit unsigned integer", () => {
            const key = deriveBlockKey(0x12345678, 0);
            expect(key).toBeGreaterThanOrEqual(0);
            expect(key).toBeLessThanOrEqual(0xffffffff);
        });

        it("different blockIds produce different keys", () => {
            const k0 = deriveBlockKey(0xdeadbeef, 0);
            const k1 = deriveBlockKey(0xdeadbeef, 1);
            expect(k0).not.toBe(k1);
        });

        it("is deterministic", () => {
            const a = deriveBlockKey(42, 7);
            const b = deriveBlockKey(42, 7);
            expect(a).toBe(b);
        });
    });

    describe("chainMix", () => {
        it("produces different state for different inputs", () => {
            const s0 = chainMix(0xabcdef00, 10, 20);
            const s1 = chainMix(0xabcdef00, 11, 20);
            expect(s0).not.toBe(s1);
        });
    });

    describe("incrementalEncrypt round-trip", () => {
        it("decrypts correctly with chain replay", () => {
            const masterKey = 0x12345678;
            const blocks = [{ startIp: 0, endIp: 3, blockId: 0 }];

            // Plaintext instructions (6 values: 3 instructions * 2)
            const plain = [100, 200, 300, 400, 500, 600];
            const encrypted = [...plain];

            incrementalEncrypt(encrypted, masterKey, blocks);

            // Verify it actually changed
            expect(encrypted).not.toEqual(plain);

            // Now simulate runtime decryption
            let chainState = deriveBlockKey(masterKey, 0);
            const decrypted: number[] = [];

            for (let ip = 0; ip < 3; ip++) {
                const i = ip * 2;
                const keyLo = chainState & 0xffff;
                const keyHi = chainState;

                const decOp = (encrypted[i]! ^ keyLo) & 0xffff;
                const decOperand = (encrypted[i + 1]! ^ keyHi) | 0;
                decrypted.push(decOp, decOperand);

                chainState = chainMix(chainState, decOp, decOperand);
            }

            expect(decrypted).toEqual(plain.map((v, i) => i % 2 === 0 ? v & 0xffff : v | 0));
        });

        it("different blocks have independent chain states", () => {
            const masterKey = 0xfeedface;
            const blocks = [
                { startIp: 0, endIp: 2, blockId: 0 },
                { startIp: 2, endIp: 4, blockId: 1 },
            ];

            const plain = [10, 20, 30, 40, 50, 60, 70, 80];
            const encrypted = [...plain];

            incrementalEncrypt(encrypted, masterKey, blocks);

            // Block 1's encryption shouldn't depend on block 0's content
            // Verify by encrypting block 1 alone with same master key
            const block1Only = [50, 60, 70, 80];
            const block1Encrypted = [...block1Only];
            incrementalEncrypt(block1Encrypted, masterKey, [{ startIp: 0, endIp: 2, blockId: 1 }]);

            // The encrypted values for block 1 should match
            // (because block keys are independent)
            expect(encrypted.slice(4)).toEqual(block1Encrypted);
        });
    });
});
```

- [ ] **Step 3: Run the test to verify it fails (TDD red)**

Run: `cd /Users/owengregson/Documents/Ruam && bun test test/security/incremental-cipher.test.ts`
Expected: FAIL (module doesn't exist yet or has placeholder functions)

- [ ] **Step 4: Implement the build-time module fully**

Complete the implementation of `src/ruamvm/incremental-cipher.ts` based on the skeleton above. Key tasks:
- Import the actual JUMP_OPS / PACKED_JUMP_OPS from `src/compiler/opcodes.ts` (check what `block-permutation.ts` imports and mirror it)
- Fix the `incrementalEncrypt` function to handle the encryption/decryption round-trip correctly
- Verify the chain feedback direction: at build time we encrypt, at runtime we decrypt. The chain must produce the same state in both directions.

**Critical correctness invariant:** The build-time encryption loop must produce the SAME chain state progression that the runtime decryption loop will. Both must:
1. Start with `deriveBlockKey(masterKey, blockId)` at each block entry
2. After decrypting instruction N, feed the decrypted values into `chainMix`
3. Use the resulting state to decrypt instruction N+1

- [ ] **Step 5: Run the test to verify it passes (TDD green)**

Run: `cd /Users/owengregson/Documents/Ruam && bun test test/security/incremental-cipher.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/owengregson/Documents/Ruam
git add packages/ruam/src/ruamvm/incremental-cipher.ts test/security/incremental-cipher.test.ts
git commit -m "feat: build-time incremental cipher with block-epoch keying"
```

### Task 4: Runtime incremental cipher builder

**Files:**
- Create: `src/ruamvm/builders/incremental-cipher.ts`

- [ ] **Step 1: Create the runtime builder**

Create `src/ruamvm/builders/incremental-cipher.ts`:

This module emits AST nodes for three runtime functions:
- `icBlockKey(masterKey, blockId)` — derive per-block base key
- `icMix(state, opcode, operand)` — chain feedback
- `icDecrypt(chainState, encOp, encOperand)` — decrypt one instruction, return `{op, operand, nextState}`

The AST should mirror the exact math from `src/ruamvm/incremental-cipher.ts` (build-time module).

```typescript
/**
 * Runtime builder for incremental cipher helpers.
 *
 * Emits three IIFE-scope functions: icBlockKey, icMix, icDecrypt.
 * These are called from the dispatch loop when incrementalCipher is enabled.
 *
 * @module ruamvm/builders/incremental-cipher
 */

import type { RuntimeNames } from "../../naming/compat-types.js";
import type { JsNode } from "../nodes.js";
import type { SplitFn } from "../constant-splitting.js";
import {
    fn,
    varDecl,
    exprStmt,
    returnStmt,
    bin,
    assign,
    call,
    id,
    lit,
    member,
    BOp,
} from "../nodes.js";
import {
    FNV_PRIME,
    MIX_PRIME1,
    MIX_PRIME2,
} from "../../constants.js";

/**
 * Build runtime incremental cipher helper functions.
 *
 * @param names - RuntimeNames for identifier resolution
 * @param split - Optional constant splitting function
 * @returns JsNode[] — function declarations for icBlockKey, icMix, icDecrypt
 */
export function buildIncrementalCipherSource(
    names: RuntimeNames,
    split?: SplitFn
): JsNode[] {
    const L = (n: number): JsNode => (split ? split(n) : lit(n));
    const ushr = (a: JsNode, b: JsNode): JsNode => bin(BOp.Ushr, a, b);
    const xor = (a: JsNode, b: JsNode): JsNode => bin(BOp.BitXor, a, b);
    const and = (a: JsNode, b: JsNode): JsNode => bin(BOp.BitAnd, a, b);

    const imul = id(names.imul);
    const nodes: JsNode[] = [];

    // icBlockKey(mk, bid) — derive per-block base key
    {
        const mk = "mk";
        const bid = "bid";
        const h = "h";
        nodes.push(
            fn(names.icBlockKey, [mk, bid], [
                varDecl(h, id(mk)),
                exprStmt(assign(id(h), ushr(call(imul, [xor(id(h), id(bid)), L(FNV_PRIME)]), lit(0)))),
                exprStmt(assign(id(h), ushr(
                    call(imul, [
                        xor(id(h), ushr(call(imul, [id(bid), L(0x9e3779b9)]), lit(0))),
                        L(MIX_PRIME1),
                    ]),
                    lit(0)
                ))),
                exprStmt(assign(id(h), xor(id(h), ushr(id(h), lit(16))))),
                exprStmt(assign(id(h), ushr(call(imul, [id(h), L(MIX_PRIME2)]), lit(0)))),
                exprStmt(assign(id(h), xor(id(h), ushr(id(h), lit(13))))),
                returnStmt(ushr(id(h), lit(0))),
            ])
        );
    }

    // icMix(s, op, operand) — chain feedback
    {
        const s = "s";
        const op = "op";
        const operand = "od";
        const h = "h";
        nodes.push(
            fn(names.icMix, [s, op, operand], [
                varDecl(h, id(s)),
                exprStmt(assign(id(h), ushr(call(imul, [xor(id(h), id(op)), L(MIX_PRIME1)]), lit(0)))),
                exprStmt(assign(id(h), ushr(call(imul, [xor(id(h), id(operand)), L(MIX_PRIME2)]), lit(0)))),
                exprStmt(assign(id(h), xor(id(h), ushr(id(h), lit(16))))),
                returnStmt(ushr(id(h), lit(0))),
            ])
        );
    }

    return nodes;
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/owengregson/Documents/Ruam && bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/owengregson/Documents/Ruam
git add packages/ruam/src/ruamvm/builders/incremental-cipher.ts
git commit -m "feat: runtime AST builder for incremental cipher helpers"
```

### Task 5: Wire incremental cipher into the dispatch loop

**Files:**
- Modify: `src/ruamvm/builders/interpreter.ts` (dispatch loop)
- Modify: `src/ruamvm/assembler.ts` (emit new helpers)
- Modify: `src/transform.ts` (apply incremental encryption at encode time)

This is the most complex task — it connects build-time encryption to runtime decryption through the dispatch loop.

**IMPORTANT:** The loader does NOT need modification. Rolling cipher decryption already happens inline in the dispatch loop (interpreter.ts lines 1045-1135), not in the loader. The loader only handles custom-alphabet decoding, optional RC4 decryption, deserialization, and string constant decoding. The incremental cipher is an additional layer in the dispatch loop.

**Pipeline ordering (build-time):**
1. Block permutation modifies `unit.instructions` in place (reorders blocks)
2. Opcode mutation inserts MUTATE instructions (if enabled)
3. `adjustEncodingForMutations` maps logical→physical opcodes (if mutation enabled)
4. Otherwise, standard shuffle map maps logical→physical opcodes
5. Instruction array is flattened to `number[]` in `serializeUnit`
6. Rolling cipher encrypts the flat array (position-dependent XOR)
7. **Incremental cipher encrypts the flat array (chain-feedback XOR) — NEW**
8. Binary serialization + custom alphabet encoding

**Pipeline ordering (runtime, dispatch loop, per instruction):**
1. Read encrypted values from instruction array: `PH = I[IP]; O = I[IP+1]; IP += 2;`
2. **Incremental cipher decrypt: XOR with chain state, advance chain — NEW**
3. Rolling cipher decrypt: XOR with position-dependent key stream (existing, lines 1045-1135)
4. Handler table lookup: `_fdi = _ht[PH]`
5. Dispatch to handler

**Block identification for the incremental cipher must run on the PERMUTED unit** (after step 1 above), so block boundaries match what the runtime will see.

- [ ] **Step 1: Modify the dispatch loop in `buildExecFunction`**

In `src/ruamvm/builders/interpreter.ts`, the dispatch loop currently has (lines 1040-1135):

The current dispatch loop (interpreter.ts lines 1040-1135):

```
PH = I[IP]        // read physical opcode
O = I[IP+1]       // read operand
IP += 2

// Rolling cipher decrypt (position-dependent)
_ri = (IP-2) >>> 1
_ks = rcState
_ks = imul(_ks ^ _ri, 0x85EBCA6B) >>> 0
_ks = imul(_ks ^ (_ri ^ 0x9E3779B9), 0xC2B2AE35) >>> 0
_ks ^= _ks >>> 16
_ks = _ks >>> 0
PH = (PH ^ (_ks & 0xFFFF)) & 0xFFFF
O = (O ^ _ks) | 0

_fdi = _ht[PH]
dispatch(_fdi)
```

When `incrementalCipher` is enabled, add BEFORE the rolling cipher decrypt:

```
// Incremental cipher decrypt (chain-dependent, outer layer)
PH = (PH ^ (_icState & 0xFFFF)) & 0xFFFF
O = (O ^ _icState) | 0
_icState = icMix(_icState, PH, O)

// Then rolling cipher decrypt (position-dependent, inner layer — existing code unchanged)
...
```

And at the TOP of the dispatch loop, before reading I[IP], check for block boundary reset:

```
// Block boundary check — reset chain state at block leaders
if (_icBl[IP] !== void 0) {
    _icState = icBlockKey(_icMk, _icBl[IP])
}
```

**Block leader lookup:** Instead of modifying the binary serialization format (which would require version bumping and backward compatibility), compute the block leader map at runtime from the deserialized unit's jump table and exception table. This is a one-time cost per unit load.

In the exec function init (after `rcState = rcDeriveKey(U)`):
```
var _icMk = rcState             // master key for incremental cipher = rolling cipher master key
var _icBl = icBuildLeaders(U)   // { ip: blockId } from jump/exception tables
var _icState = icBlockKey(_icMk, 0)  // start in block 0
```

The `icBuildLeaders(U)` function scans the unit's instruction array for jump opcodes and builds the block-leader map. This runs once per unit load and is cached alongside the unit. It reuses the same block identification logic from `basic-blocks.ts`.

- [ ] **Step 2: Wire into transform.ts**

In `src/transform.ts` `encodeAllUnits`, after rolling cipher encryption, apply incremental cipher encryption:

```typescript
if (resolved.incrementalCipher) {
    // IMPORTANT: use the PERMUTED unit for block identification
    // (block permutation has already reordered instructions at this point)
    const blocks = buildCipherBlocks(unit);
    incrementalEncrypt(instrArray, masterKey, blocks);
}
```

The incremental encryption is applied AFTER the rolling cipher encryption. At runtime, the incremental cipher is decrypted FIRST (peeling the outer layer), then the rolling cipher.

- [ ] **Step 3: Wire into assembler.ts**

In `src/ruamvm/assembler.ts` `generateVmRuntime`, emit the incremental cipher helpers (`icBlockKey`, `icMix`) alongside rolling cipher helpers.

- [ ] **Step 4: Build runtime `icBuildLeaders` function**

Add to `src/ruamvm/builders/incremental-cipher.ts` a function that emits AST for `icBuildLeaders(U)`. This runtime function scans the deserialized unit's instruction array and builds a `{ ip: blockId }` sparse object. It identifies block leaders from jump opcodes, exception table entries, and jump table entries — mirroring the build-time `identifyBasicBlocks` logic but operating on the deserialized runtime unit.

- [ ] **Step 5: End-to-end test**

Add to `test/security/incremental-cipher.test.ts`:

```typescript
import { assertEquivalent } from "../helpers.js";

const icOpts = { incrementalCipher: true };

describe("incremental cipher e2e", () => {
    it("simple return", () => {
        assertEquivalent(`function f() { return 42; } f();`, icOpts);
    });

    it("arithmetic", () => {
        assertEquivalent(`function f(a, b) { return a + b; } f(3, 7);`, icOpts);
    });

    it("conditionals", () => {
        assertEquivalent(`
            function f(x) { return x > 0 ? x : -x; }
            [f(5), f(-3), f(0)];
        `, icOpts);
    });

    it("loops", () => {
        assertEquivalent(`
            function sum(n) {
                var s = 0;
                for (var i = 0; i < n; i++) s += i;
                return s;
            }
            sum(100);
        `, icOpts);
    });

    it("closures", () => {
        assertEquivalent(`
            function outer(x) {
                return function inner(y) { return x + y; };
            }
            outer(10)(20);
        `, icOpts);
    });

    it("recursion", () => {
        assertEquivalent(`
            function fib(n) {
                if (n <= 1) return n;
                return fib(n - 1) + fib(n - 2);
            }
            fib(10);
        `, icOpts);
    });

    it("try-catch", () => {
        assertEquivalent(`
            function f() {
                try { throw new Error("test"); }
                catch (e) { return e.message; }
            }
            f();
        `, icOpts);
    });

    it("empty function", () => {
        assertEquivalent(`function f() {} f();`, icOpts);
    });

    it("switch with fallthrough", () => {
        assertEquivalent(`
            function f(x) {
                switch(x) {
                    case 1: x += 10;
                    case 2: x += 20; break;
                    default: x = 0;
                }
                return x;
            }
            [f(1), f(2), f(3)];
        `, icOpts);
    });

    it("generator function", () => {
        assertEquivalent(`
            function test() {
                function* gen() { yield 1; yield 2; yield 3; }
                var arr = [];
                for (var v of gen()) arr.push(v);
                return arr;
            }
            test();
        `, icOpts);
    });

    it("async/await", () => {
        assertEquivalent(`
            async function f() {
                var x = await Promise.resolve(10);
                var y = await Promise.resolve(20);
                return x + y;
            }
            f();
        `, icOpts);
    });

    it("deeply nested closures", () => {
        assertEquivalent(`
            function a(x) {
                return function b(y) {
                    return function c(z) {
                        return x + y + z;
                    };
                };
            }
            a(1)(2)(3);
        `, icOpts);
    });

    it("with blockPermutation + opcodeMutation", () => {
        assertEquivalent(`
            function f(n) {
                var s = 0;
                for (var i = 0; i < n; i++) s += i;
                return s;
            }
            f(50);
        `, { incrementalCipher: true, blockPermutation: true, opcodeMutation: true });
    });

    it("with all max features", () => {
        assertEquivalent(`
            function f(a, b) { return a * b + 1; }
            f(6, 7);
        `, { preset: "max" });
    });
});
```

- [ ] **Step 6: Debug with traces if tests fail**

If any tests fail, add `debugLogging: true` to the options and run once. Examine the trace output to identify where decryption produces wrong values. Check:
1. Build-time block identification matches runtime block leaders
2. Chain state progression matches between encrypt and decrypt
3. The layering order is correct (incremental on top, rolling underneath)

- [ ] **Step 7: Run full test suite**

Run: `cd /Users/owengregson/Documents/Ruam && bun run test`
Expected: All tests PASS (including existing 2095 + new incremental cipher tests)

- [ ] **Step 8: Commit**

```bash
cd /Users/owengregson/Documents/Ruam
git add packages/ruam/src/compiler/basic-blocks.ts packages/ruam/src/compiler/block-permutation.ts packages/ruam/src/ruamvm/builders/interpreter.ts packages/ruam/src/ruamvm/assembler.ts packages/ruam/src/transform.ts packages/ruam/src/ruamvm/builders/incremental-cipher.ts test/security/incremental-cipher.test.ts
git commit -m "feat: wire incremental cipher into dispatch loop, assembler, and transform pipeline"
```

---

## Phase 2: Semantic Opacity

### Concept

Make the emitted handler logic resist automated semantic analysis. Even if an attacker decrypts the bytecode, they need to understand what each handler does — and semantic opacity makes that understanding expensive.

Three techniques:
1. **Opaque predicates** — Insert always-true/false branches using mathematical properties (quadratic residues, number theory) that are hard to prove statically
2. **Handler aliasing** — High-value opcodes (CALL, RETURN, LOAD_SCOPED, STORE_SCOPED) get 2-3 physical aliases, each with structurally different but functionally equivalent implementations
3. **Encoding diversity** — Different handlers use different value encodings for stack/register values. Cross-handler transitions require re-encoding.

### Task 6: Add semanticOpacity option plumbing

**Files:**
- Modify: `src/types.ts`
- Modify: `src/presets.ts`
- Modify: `src/tuning.ts`
- Modify: `src/option-meta.ts`

- [ ] **Step 1: Add `semanticOpacity` to VmObfuscationOptions**

In `src/types.ts`, add after `incrementalCipher`:

```typescript
/**
 * Make handler logic resist automated semantic analysis.
 *
 * Injects opaque predicates (always-true/false branches using number
 * theory), creates handler aliases (structurally different implementations
 * of the same opcode), and diversifies value encoding across handlers.
 */
semanticOpacity?: boolean;
```

- [ ] **Step 2: Add to presets**

- `low`: `semanticOpacity: false,`
- `medium`: `semanticOpacity: false,`
- `max`: `semanticOpacity: true,`

- [ ] **Step 3: Add tuning parameters**

In `TuningProfile`:

```typescript
// -- Semantic opacity --
/** Number of opaque predicate injections per handler body. */
opaquePredicateCount: number;
/** Number of high-value opcodes to alias. */
handlerAliasCount: number;
/** Number of distinct value encoding domains. */
encodingDomainCount: number;
```

Values:
- Intensity 0: `opaquePredicateCount: 1, handlerAliasCount: 2, encodingDomainCount: 2,`
- Intensity 1: `opaquePredicateCount: 2, handlerAliasCount: 4, encodingDomainCount: 3,`
- Intensity 2: `opaquePredicateCount: 3, handlerAliasCount: 6, encodingDomainCount: 4,`

- [ ] **Step 4: Add option metadata**

In OPTION_META (Security category):

```typescript
{
    key: "semanticOpacity",
    label: "Semantic Opacity",
    category: "security",
    description: "Opaque predicates, handler aliasing, and encoding diversity",
    cliFlag: "--semantic-opacity",
},
```

- [ ] **Step 5: Run typecheck + tests**

Run: `cd /Users/owengregson/Documents/Ruam && bun run typecheck && bun run test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/owengregson/Documents/Ruam
git add packages/ruam/src/types.ts packages/ruam/src/presets.ts packages/ruam/src/tuning.ts packages/ruam/src/option-meta.ts
git commit -m "feat: add semanticOpacity option plumbing"
```

### Task 7: Opaque predicate library

**Files:**
- Create: `src/ruamvm/opaque-predicates.ts`
- Create: `test/security/semantic-opacity.test.ts`

- [ ] **Step 1: Write the opaque predicate generator**

Create `src/ruamvm/opaque-predicates.ts`:

This module provides a library of always-true and always-false conditions expressed as AST nodes. Each predicate takes a numeric expression (typically a register or stack value) and produces a boolean expression.

**Predicate families:**
1. **Quadratic residue:** `((x * x + 1) % 4) !== 2` — always true (no integer squared plus 1 is 2 mod 4)
2. **Parity product:** `((x | 1) * (x | 1)) % 2 !== 0` — always true (odd * odd is always odd)
3. **Bitwise identity:** `((x ^ x) === 0)` — always true, but obfuscated via MBA
4. **Non-negative square:** `(x * x >= 0)` — always true for int32 (but expressed via MBA)
5. **Sum parity:** `((x + x) % 2 === 0)` — always true (2x is always even)

Each predicate is wrapped in MBA-transformed expressions when MBA is enabled, making them even harder to simplify.

```typescript
/**
 * Opaque predicate library for handler body injection.
 *
 * Generates always-true or always-false conditions from mathematical
 * properties that are hard to prove statically. Used by semantic opacity
 * to split handler bodies into "real" and "dead" paths.
 *
 * @module ruamvm/opaque-predicates
 */

import type { JsNode } from "./nodes.js";
import { bin, un, lit, ifStmt, BOp, UOp } from "./nodes.js";
import { deriveSeed } from "../naming/scope.js";
import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";

/** An opaque predicate: expression + whether it's always true or always false. */
export interface OpaquePredicate {
    /** The boolean expression. */
    expr: JsNode;
    /** True if the expression always evaluates to true. */
    alwaysTrue: boolean;
}

/**
 * Generate an opaque predicate using a numeric input expression.
 *
 * **Precision note:** All predicates are valid for int32 inputs. The
 * `inputExpr` should be bitwise-coerced (e.g., `x | 0`) to ensure
 * integer semantics. For very large float64 values, modular arithmetic
 * may not match number-theoretic expectations.
 *
 * @param inputExpr - A numeric expression coerced to int32 (e.g., `(x | 0)`)
 * @param seed - PRNG seed for selecting which predicate family to use
 * @param index - Predicate index within this handler (for seed isolation)
 * @returns An opaque predicate
 */
export function generateOpaquePredicate(
    inputExpr: JsNode,
    seed: number,
    index: number
): OpaquePredicate {
    const derived = deriveSeed(seed, `opaque_${index}`);
    const family = ((derived * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0) % 5;

    switch (family) {
        case 0:
            // ((x * x + 1) % 4) !== 2 — always true
            return {
                expr: bin(BOp.Sneq,
                    bin(BOp.Mod,
                        bin(BOp.Add, bin(BOp.Mul, inputExpr, inputExpr), lit(1)),
                        lit(4)),
                    lit(2)),
                alwaysTrue: true,
            };
        case 1:
            // ((x | 1) * (x | 1)) % 2 !== 0 — always true
            return {
                expr: bin(BOp.Sneq,
                    bin(BOp.Mod,
                        bin(BOp.Mul,
                            bin(BOp.BitOr, inputExpr, lit(1)),
                            bin(BOp.BitOr, inputExpr, lit(1))),
                        lit(2)),
                    lit(0)),
                alwaysTrue: true,
            };
        case 2:
            // (x ^ x) === 0 — always true
            return {
                expr: bin(BOp.Seq, bin(BOp.BitXor, inputExpr, inputExpr), lit(0)),
                alwaysTrue: true,
            };
        case 3:
            // ((x * x) % 4) === 3 — always false (squares mod 4 are 0 or 1)
            return {
                expr: bin(BOp.Seq,
                    bin(BOp.Mod, bin(BOp.Mul, inputExpr, inputExpr), lit(4)),
                    lit(3)),
                alwaysTrue: false,
            };
        case 4:
        default:
            // ((x & 1) + (x & 1)) % 2 !== 0 — always false (0+0=0, 1+1=2, both even)
            return {
                expr: bin(BOp.Sneq,
                    bin(BOp.Mod,
                        bin(BOp.Add,
                            bin(BOp.BitAnd, inputExpr, lit(1)),
                            bin(BOp.BitAnd, inputExpr, lit(1))),
                        lit(2)),
                    lit(0)),
                alwaysTrue: false,
            };
    }
}

/**
 * Inject an opaque predicate into a handler body.
 *
 * Wraps `realBody` in a branch: if the predicate is always-true, the real
 * body goes in the `then` branch and dead code in `else`. Vice versa for
 * always-false predicates.
 *
 * @param body - The real handler body statements
 * @param deadBody - Plausible-looking dead code statements
 * @param predicate - The opaque predicate
 * @returns New body with the predicate branch injected
 */
export function injectOpaquePredicate(
    body: JsNode[],
    deadBody: JsNode[],
    predicate: OpaquePredicate
): JsNode[] {
    if (predicate.alwaysTrue) {
        return [ifStmt(predicate.expr, body, deadBody)];
    } else {
        return [ifStmt(predicate.expr, deadBody, body)];
    }
}
```

- [ ] **Step 2: Write tests**

Add to `test/security/semantic-opacity.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { generateOpaquePredicate } from "../../src/ruamvm/opaque-predicates.js";
import { emit } from "../../src/ruamvm/emit.js";
import { lit } from "../../src/ruamvm/nodes.js";

describe("opaque predicates", () => {
    it("generates always-true predicates that evaluate to true", () => {
        for (let seed = 0; seed < 100; seed++) {
            const pred = generateOpaquePredicate(lit(seed), seed, 0);
            const js = emit(pred.expr);
            // Evaluate the expression for various x values
            for (const x of [-100, -1, 0, 1, 42, 1000, -999]) {
                const result = new Function("x", `return ${js.replace(/x/g, String(x))};`)();
                if (pred.alwaysTrue) {
                    expect(result).toBe(true);
                } else {
                    expect(result).toBe(false);
                }
            }
        }
    });

    it("produces different predicate families across seeds", () => {
        const families = new Set<string>();
        for (let seed = 0; seed < 50; seed++) {
            const pred = generateOpaquePredicate(lit(0), seed, 0);
            families.add(emit(pred.expr));
        }
        expect(families.size).toBeGreaterThan(2);
    });
});
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/owengregson/Documents/Ruam && bun test test/security/semantic-opacity.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/owengregson/Documents/Ruam
git add packages/ruam/src/ruamvm/opaque-predicates.ts test/security/semantic-opacity.test.ts
git commit -m "feat: opaque predicate library with 5 mathematical families"
```

### Task 8: Handler aliasing

**Files:**
- Create: `src/ruamvm/handler-aliasing.ts`

- [ ] **Step 1: Design the aliasing system**

Handler aliasing works at the interpreter builder level. For selected high-value opcodes, instead of one handler in the function table, we register 2-3 structurally different implementations that produce the same result.

The aliasing module:
1. Takes the handler registry and a list of opcodes to alias
2. For each aliased opcode, generates N alternative handler bodies by:
   - Reordering independent statements within the handler
   - Replacing `if/else` with ternary (or vice versa)
   - Using different variable names for locals
   - Adding opaque predicates
3. Assigns each alias a unique handler index in the handler table (NOT a new Op enum value)
4. During compilation, randomly selects which alias to use for each occurrence of the logical opcode

**Key design: Aliases are NOT new Op enum values.** Instead, aliases share the same physical opcode in the bytecode. The aliasing happens at the HANDLER level: multiple handler closures in the function table can handle the same physical opcode. The selection of which handler to use is done by the handler table mapping (`_ht[phys]`), which already supports many-to-one.

**Actually, a simpler approach:** Since the function table dispatch already assigns handler indices via Fisher-Yates shuffle, aliases can be implemented by registering multiple handlers for the same opcode and letting the handler table route to different implementations on different builds. The compiler doesn't need to change at all — the aliasing is purely in the runtime interpreter builder.

Concretely:
1. For each aliased opcode, register the original handler AND 1-2 clones with structural transforms
2. The handler table's shuffle deterministically picks ONE of the aliases per build
3. Different builds pick different aliases → structurally different interpreter code
4. No changes to the compiler, bytecode format, or opcode enum

- [ ] **Step 2: Implement handler aliasing**

Create `src/ruamvm/handler-aliasing.ts`:

```typescript
/**
 * Handler aliasing — create structurally different implementations
 * of the same logical opcode.
 *
 * For high-value opcodes (CALL, RETURN, LOAD_SCOPED, STORE_SCOPED),
 * generates 2-3 alternative handler bodies. Each alias gets a unique
 * physical opcode. The compiler randomly selects which alias to emit
 * for each instruction.
 *
 * @module ruamvm/handler-aliasing
 */

// Implementation details:
// 1. Select target opcodes based on tuning.handlerAliasCount
// 2. For each target, clone the handler body AST
// 3. Apply structural transforms to the clone (reorder, rename, add opaque predicates)
// 4. Register the clone under a new "alias opcode" in the handler registry
// 5. Build an alias map: logicalOp → [physicalOp1, physicalOp2, ...aliasOps]
// 6. The compiler uses the alias map to randomly select which physical opcode to emit
```

**Integration point:** The alias map must be passed to the compiler so it can randomly choose between the original and alias opcodes when emitting each instruction. Add an `aliasMap?: Map<number, number[]>` parameter to the emitter.

- [ ] **Step 3: Wire into interpreter builder**

In `src/ruamvm/builders/interpreter.ts`:
- Before `buildHandlerTableMeta`, generate aliases
- Include alias opcodes in the `usedOpcodes` set
- Register alias handlers in the handler registry

- [ ] **Step 4: Wire into compiler**

In `src/compiler/emitter.ts`:
- When emitting an opcode that has aliases, randomly select from the alias set using the build seed PRNG

- [ ] **Step 5: Write e2e tests**

```typescript
it("handler aliasing produces correct results", () => {
    assertEquivalent(`
        function f() {
            var obj = { a: 1, b: 2 };
            return obj.a + obj.b;
        }
        f();
    `, { semanticOpacity: true });
});
```

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/owengregson/Documents/Ruam && bun run test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/owengregson/Documents/Ruam
git add packages/ruam/src/ruamvm/handler-aliasing.ts packages/ruam/src/ruamvm/builders/interpreter.ts packages/ruam/src/compiler/emitter.ts test/security/semantic-opacity.test.ts
git commit -m "feat: handler aliasing with structurally different opcode implementations"
```

### Task 9: Opaque predicate injection into handler bodies

**Files:**
- Modify: `src/ruamvm/builders/interpreter.ts` (inject predicates into handler case bodies)

- [ ] **Step 1: Add predicate injection to `buildCasesForModeInternal`**

After building each handler's case body, optionally inject opaque predicates:
1. Select handler bodies with 3+ statements (small handlers aren't worth obfuscating)
2. For each selected handler, generate an opaque predicate using `generateOpaquePredicate`
3. Split the handler body at a random point
4. Wrap the split in the predicate branch
5. Generate plausible dead code for the other branch (reuse logic from `injectDecoyHandlers`)

This integrates into the existing handler body processing pipeline (after the handler function returns its AST nodes, before MBA/fragmentation).

- [ ] **Step 2: Add e2e tests**

```typescript
it("opaque predicates don't break execution", () => {
    assertEquivalent(`
        function factorial(n) {
            if (n <= 1) return 1;
            return n * factorial(n - 1);
        }
        factorial(10);
    `, { semanticOpacity: true });
});
```

- [ ] **Step 3: Run full test suite**

Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: inject opaque predicates into handler bodies"
```

### Task 10: Per-handler MBA variant selection (encoding diversity)

**Files:**
- Create: `src/ruamvm/encoding-diversity.ts`
- Modify: `src/ruamvm/builders/interpreter.ts`

Encoding diversity is the most complex semantic opacity technique. It assigns different value encoding domains to different handler groups. When a value passes from a handler in domain A to a handler in domain B, it must be re-encoded.

**Design:**
- N encoding domains (2-4, from tuning)
- Each domain has a per-build random key: `domainKey[i] = deriveSeed(seed, "encDomain_" + i)`
- Encode: `encoded = value ^ domainKey[i]` (for numeric values)
- Decode: `value = encoded ^ domainKey[i]`
- At domain boundaries (cross-domain push/pop), insert re-encoding: `value = (value ^ domainKey[old]) ^ domainKey[new]`

**Implementation sketch:**
1. Assign each handler to a domain based on its handler index mod domainCount
2. For stack push: encode with handler's domain key
3. For stack pop: decode with handler's domain key
4. When IP changes (jump), the next handler may be in a different domain — but since the handler itself does the push/pop, the encoding is always consistent within that handler.
5. The challenge is CROSS-HANDLER communication via the stack. If handler A pushes and handler B pops, B's decode must match A's encode.

**Resolution:** Use a SINGLE encoding for the stack, but make the encode/decode expressions structurally different per handler via MBA transforms. The appearance is diverse even though the underlying encoding is uniform. This avoids correctness issues while still resisting pattern matching.

- [ ] **Step 1: Implement structural diversity via per-handler MBA variants**

Instead of true encoding diversity (which has correctness risks), use the existing MBA infrastructure with per-handler variant selection. Each handler's arithmetic operations are transformed using a DIFFERENT MBA variant (selected by handler index), so the same logical operation looks different in each handler.

This is simpler, safer, and achieves the same anti-analysis goal.

- [ ] **Step 2: Run full test suite**

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: per-handler MBA variant selection for encoding diversity"
```

---

## Phase 3: Observation Resistance

### Concept

Make the act of observing/instrumenting the VM silently produce wrong results. Not timing-based — instead uses structural checks that detect if the execution environment has been tampered with.

Four techniques:
1. **Function identity binding** — Save references to critical internal functions at IIFE creation. Periodically verify `saved === current`. If someone replaced a function (hook/proxy), silently poison the cipher state.
2. **Cross-handler witness values** — Handler A writes a "witness" to a hidden register slot. Handler B verifies it. Wrong witness → silent cipher state corruption.
3. **Prototype chain canaries** — Plant specific properties on scope objects. If missing later, silently corrupt.
4. **Stack integrity probes** — Push known value, verify after no-op sequence, silent corruption if tampered.

**No timing-based detection.** All checks are structural/identity-based.

### Task 11: Add observationResistance option plumbing

**Files:**
- Modify: `src/types.ts`
- Modify: `src/presets.ts`
- Modify: `src/tuning.ts`
- Modify: `src/option-meta.ts`

- [ ] **Step 1: Add `observationResistance` to VmObfuscationOptions**

```typescript
/**
 * Silently corrupt computation when instrumentation is detected.
 *
 * Uses function identity binding, cross-handler witness values,
 * prototype chain canaries, and stack integrity probes to detect
 * observation. No timing-based detection. When triggered, silently
 * poisons cipher state so the attacker gets plausible but wrong results.
 *
 * Requires {@link rollingCipher} (auto-enabled).
 */
observationResistance?: boolean;
```

- [ ] **Step 2: Add to presets and auto-enable rules**

- `low`: `observationResistance: false,`
- `medium`: `observationResistance: false,`
- `max`: `observationResistance: true,`

Auto-enable: `observationResistance` → `rollingCipher`

- [ ] **Step 3: Add tuning parameters**

```typescript
// -- Observation resistance --
/** Probability (0-100) of witness check per handler invocation. */
witnessCheckProbability: number;
/** Number of function identity bindings. */
identityBindingCount: number;
/** Number of hidden witness register slots. */
witnessSlotCount: number;
```

Values:
- Intensity 0: `witnessCheckProbability: 10, identityBindingCount: 3, witnessSlotCount: 2,`
- Intensity 1: `witnessCheckProbability: 25, identityBindingCount: 5, witnessSlotCount: 3,`
- Intensity 2: `witnessCheckProbability: 40, identityBindingCount: 8, witnessSlotCount: 4,`

- [ ] **Step 4: Add option metadata and auto-enable rule**

- [ ] **Step 5: Add naming claims**

Add to RUNTIME_KEYS: `"orBindings"`, `"orVerify"`, `"orWitness"`
Add to TEMP_KEYS: `"_orRef"`, `"_orExp"`, `"_orW"`, `"_orWv"`

- [ ] **Step 6: Run typecheck + tests**

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: add observationResistance option plumbing"
```

### Task 12: Function identity binding

**Files:**
- Create: `src/ruamvm/observation-resistance.ts`
- Modify: `src/ruamvm/assembler.ts`

- [ ] **Step 1: Build the identity binding system**

At IIFE scope, save references to critical internal functions:

```javascript
var _orRef0 = exec;
var _orRef1 = load;
var _orRef2 = rcDeriveKey;
// ... N bindings
```

The verification function checks `_orRefN === currentFn`. If any check fails, it returns a corruption constant that gets XOR'd into the rolling cipher state:

```javascript
function orVerify() {
    var c = 0;
    if (_orRef0 !== exec) c ^= 0xDEADBEEF;
    if (_orRef1 !== load) c ^= 0xCAFEBABE;
    // ...
    return c;
}
```

This function is called from inside the dispatch loop at pseudo-random intervals (controlled by witness check probability). The return value is XOR'd into `rcState`:

```javascript
rcState = (rcState ^ orVerify()) >>> 0;
```

If nothing was tampered with, `orVerify()` returns 0, and `rcState` is unchanged. If a function was hooked, a non-zero corruption constant silently poisons all subsequent instruction decryption.

**Key property:** The corruption is SILENT. No exception, no early exit, no visible indicator. The attacker gets plausible-looking but wrong decrypted instructions.

- [ ] **Step 2: Write e2e tests**

```typescript
describe("observation resistance", () => {
    it("correct execution when not tampered", () => {
        assertEquivalent(`
            function f(a, b) { return a + b; }
            f(3, 7);
        `, { observationResistance: true });
    });

    it("works with all max features", () => {
        assertEquivalent(`
            function fibonacci(n) {
                if (n <= 1) return n;
                return fibonacci(n - 1) + fibonacci(n - 2);
            }
            fibonacci(10);
        `, { preset: "max" });
    });
});
```

- [ ] **Step 3: Run tests**

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: function identity binding for observation resistance"
```

### Task 13: Cross-handler witness values

**Files:**
- Modify: `src/ruamvm/observation-resistance.ts`
- Modify: `src/ruamvm/handlers/registry.ts` (add witness slots to HandlerCtx)
- Modify: `src/ruamvm/handlers/helpers.ts` (add witness write/verify helpers)
- Modify: selected handler files (inject witness writes/checks)

- [ ] **Step 1: Add witness slots to HandlerCtx**

In `src/ruamvm/handlers/registry.ts`, add to `HandlerCtx`:

```typescript
/** Hidden witness register slots for observation resistance. */
witnessSlots: Name[];
/** Witness write helper: writes a value derived from opcode to a slot. */
writeWitness: (slotIdx: number, opcodeHash: number) => JsNode;
/** Witness verify helper: checks a slot value, returns corruption constant or 0. */
verifyWitness: (slotIdx: number, expectedHash: number) => JsNode;
```

- [ ] **Step 2: Add witness write/verify helpers**

In `src/ruamvm/handlers/helpers.ts`, add functions that generate AST for:
- `writeWitness(slot, hash)` → `witnessSlots[slot] = hash`
- `verifyWitness(slot, expectedHash)` → `witnessSlots[slot] === expectedHash ? 0 : CORRUPTION_CONSTANT`

The CORRUPTION_CONSTANT is a per-build random value derived from the build seed.

- [ ] **Step 3: Inject monotonic witness counter (not paired handlers)**

**IMPORTANT:** Do NOT use paired handler assumptions (e.g., "PUSH_CONST always precedes ADD"). Execution order is unpredictable. Instead, use a monotonic witness counter:

- Every handler that executes increments a hidden counter: `_orW = (_orW + 1) | 0`
- At pseudo-random intervals (controlled by `witnessCheckProbability`), a handler verifies the counter is monotonically increasing and reasonable: `if (_orW < _orWv) rcState ^= CORRUPTION; _orWv = _orW;`
- This always works regardless of execution order because the counter only increments

The verification checks that the counter is at least as large as the last verified value. If someone skips handlers, replays them, or modifies the counter, the check fails.

**Implementation:** Add witness counter operations as a post-processing step in `buildCasesForModeInternal`. After generating handler bodies, prepend the counter increment to all handlers, and append the verification check to a random subset (based on `witnessCheckProbability`).

- [ ] **Step 4: Write e2e tests verifying witnesses don't break execution**

```typescript
it("cross-handler witnesses preserve correct execution", () => {
    assertEquivalent(`
        function test() {
            var x = 10;
            var y = x + 20;
            return y * 2;
        }
        test();
    `, { observationResistance: true });
});
```

- [ ] **Step 5: Run full test suite**

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: cross-handler witness values for observation resistance"
```

### Task 14: Prototype chain canaries

**Files:**
- Modify: `src/ruamvm/observation-resistance.ts`
- Modify: `src/ruamvm/assembler.ts`

- [ ] **Step 1: Plant canaries using IIFE-scope variables (not scope objects)**

**IMPORTANT:** Do NOT plant canaries on the program scope object — this would interfere with the prototypal scope chain variable lookup (`in` operator, `hasOwnProperty.call` walks). Instead, use a WeakMap canary:

```javascript
var _orCanary = {};
var _orWm = new WeakMap();
_orWm.set(_orCanary, true);
```

The canary checks verify that:
1. `_orWm` is still a genuine WeakMap: `_orWm instanceof WeakMap`
2. The canary value is intact: `_orWm.get(_orCanary) === true`
3. Critical IIFE-scope objects haven't been replaced: `typeof _orCanary === "object"`

This detects if someone has:
- Monkey-patched WeakMap
- Replaced IIFE-scope variables via Proxy or scope manipulation
- Tampered with the canary reference

- [ ] **Step 2: Add verification to dispatch loop**

In the dispatch loop, periodically verify the canary:

```javascript
if (!(_orWm instanceof WeakMap) || _orWm.get(_orCanary) !== true) {
    rcState = (rcState ^ CANARY_CORRUPTION) >>> 0;
}
```

- [ ] **Step 3: Test**

```typescript
it("prototype canaries preserve correct execution", () => {
    assertEquivalent(`
        function f() { return 42; }
        f();
    `, { observationResistance: true });
});
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: prototype chain canaries for observation resistance"
```

### Task 15: Stack integrity probes

**Files:**
- Modify: `src/ruamvm/observation-resistance.ts`
- Modify: `src/ruamvm/builders/interpreter.ts`

- [ ] **Step 1: Add stack probe injection**

At pseudo-random points in the dispatch loop (or in selected handler bodies), inject a stack integrity probe:

```javascript
// Probe: push known value, immediately pop, verify
S.push(PROBE_VALUE);
if (S.pop() !== PROBE_VALUE) {
    rcState = (rcState ^ STACK_CORRUPTION) >>> 0;
}
```

Where `PROBE_VALUE` is a per-build unique object (identity comparison, like the TDZ sentinel).

This detects if:
- The stack has been replaced with a logging proxy that modifies values
- The stack array has been swapped out
- The Proxy encoding (if stackEncoding is on) has been tampered with

- [ ] **Step 2: Test**

```typescript
it("stack probes preserve correct execution", () => {
    assertEquivalent(`
        function f() {
            var arr = [1, 2, 3];
            return arr.reduce(function(a, b) { return a + b; }, 0);
        }
        f();
    `, { observationResistance: true });
});
```

- [ ] **Step 3: Run full test suite**

Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: stack integrity probes for observation resistance"
```

---

## Phase 4: Integration and Final Testing

### Task 16: Feature combination testing

**Files:**
- Modify: `test/security/incremental-cipher.test.ts`
- Modify: `test/security/semantic-opacity.test.ts`
- Modify: `test/security/observation-resistance.test.ts`

- [ ] **Step 1: Test all three features together**

```typescript
describe("kerckhoffs hardening (all three layers)", () => {
    const fullOpts = {
        incrementalCipher: true,
        semanticOpacity: true,
        observationResistance: true,
    };

    it("simple arithmetic", () => {
        assertEquivalent(`function f(a, b) { return a + b; } f(3, 7);`, fullOpts);
    });

    it("closures", () => {
        assertEquivalent(`
            function outer(x) {
                return function(y) { return x + y; };
            }
            outer(10)(20);
        `, fullOpts);
    });

    it("classes with inheritance", () => {
        assertEquivalent(`
            function test() {
                class Animal {
                    constructor(name) { this.name = name; }
                    speak() { return this.name + " speaks"; }
                }
                class Dog extends Animal {
                    speak() { return super.speak() + " (bark)"; }
                }
                return new Dog("Rex").speak();
            }
            test();
        `, fullOpts);
    });

    it("async functions", () => {
        assertEquivalent(`
            async function f() {
                var result = await Promise.resolve(42);
                return result;
            }
            f();
        `, fullOpts);
    });

    it("full max preset (includes all new features)", () => {
        assertEquivalent(`
            function fibonacci(n) {
                if (n <= 1) return n;
                return fibonacci(n - 1) + fibonacci(n - 2);
            }
            fibonacci(10);
        `, { preset: "max" });
    });
});
```

- [ ] **Step 2: Test with VM shielding**

```typescript
it("with VM shielding", () => {
    assertEquivalent(`
        function f() { return 1; }
        function g() { return 2; }
        f() + g();
    `, { preset: "max" });
});
```

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/owengregson/Documents/Ruam && bun run test`
Expected: ALL tests PASS (2095 existing + ~50 new)

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/owengregson/Documents/Ruam && bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "test: comprehensive feature combination tests for kerckhoffs hardening"
```

### Task 17: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add documentation for new features**

Add to the Architecture Notes section:
- **Incremental cipher** description
- **Semantic opacity** description
- **Observation resistance** description

Add to the Presets section:
- Update `max` preset description to include new features

Add auto-enable rules:
- `incrementalCipher` → `rollingCipher`
- `observationResistance` → `rollingCipher`

Add to the Project Structure section:
- New files

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: update CLAUDE.md with kerckhoffs hardening features"
```

### Task 18: Build and verify

- [ ] **Step 1: Full clean build**

Run: `cd /Users/owengregson/Documents/Ruam && bun run build:fresh`
Expected: PASS

- [ ] **Step 2: Full test suite**

Run: `cd /Users/owengregson/Documents/Ruam && bun run test`
Expected: ALL tests PASS

- [ ] **Step 3: Typecheck**

Run: `cd /Users/owengregson/Documents/Ruam && bun run typecheck`
Expected: PASS

- [ ] **Step 4: Final commit**

```bash
git commit -m "chore: verify clean build and full test suite pass"
```

---

## Implementation Notes

### Encryption Layer Ordering

At **build time**, layers are applied inside-out:
1. Block permutation reorders instructions in place (if enabled)
2. Opcode mutation inserts MUTATE instructions (if enabled)
3. Opcode shuffle (logical → physical) via shuffle map or adjustEncodingForMutations
4. Instructions flattened to `number[]` in serializeUnit
5. Rolling cipher (position-dependent XOR) — second encryption layer
6. Incremental cipher (chain-feedback XOR) — outermost encryption layer

At **runtime** (dispatch loop, per instruction):
1. Block boundary check — reset chain state if IP is a block leader
2. Incremental cipher (chain-feedback XOR) — first to decrypt (outer layer)
3. Rolling cipher (position-dependent XOR) — second to decrypt (inner layer, existing code at interpreter.ts:1045-1135)
4. Opcode lookup via handler table: `_fdi = _ht[PH]`
5. Dispatch to handler

### Block Table Serialization

The incremental cipher needs a block table in the serialized unit so the runtime can identify block boundaries for chain state reset. Options:
1. **Embed in binary format** — add after instruction stream, flag in header
2. **Compute at runtime** — scan instruction stream for jump targets (expensive, but no format change)

Recommendation: Option 1 (embed). The block table is small (2 bytes per block × ~10-50 blocks = 20-100 bytes) and avoids runtime computation.

### Cross-Feature Interactions

| Feature | Interaction |
|---------|------------|
| incrementalCipher + rollingCipher | Both apply; incremental is outer layer, rolling is inner. Both decrypted inline in the dispatch loop. |
| incrementalCipher + blockPermutation | Block permutation modifies unit.instructions FIRST. Incremental cipher's `buildCipherBlocks` must run on the PERMUTED unit so block boundaries match. |
| incrementalCipher + opcodeMutation | MUTATE instructions are encrypted like any other instruction; chain state evolves through them. MUTATEs only appear outside loops (guaranteed by opcode-mutation.ts) so they don't break chain state. |
| incrementalCipher + vmShielding | Each shielded group gets its own incremental cipher with independent block keys |
| semanticOpacity + MBA | Opaque predicates inherit MBA transforms for extra opacity |
| semanticOpacity + dynamicOpcodes | Alias opcodes are included in the used-opcode set |
| observationResistance + rollingCipher | Corruption XORs into rcState, breaking all subsequent decryption |
| observationResistance + stackEncoding | Stack probes detect proxy tampering |
| observationResistance + integrityBinding | Complementary: integrity binding prevents source modification, observation resistance prevents runtime instrumentation |

### Debugging Strategy

When tests fail:
1. Add `debugLogging: true` to options
2. Run ONCE to collect trace output
3. Check trace for: correct block key derivation, correct chain state progression, correct witness values
4. Never re-run hoping for different results
5. Never guess — use the trace data

### PRNG Isolation

All new PRNG streams MUST use `deriveSeed()`:
- `deriveSeed(seed, "incrementalCipher")` — for block key derivation seeds
- `deriveSeed(seed, "opaquePredicate")` — for predicate family selection
- `deriveSeed(seed, "handlerAlias")` — for alias variant selection
- `deriveSeed(seed, "observationResistance")` — for witness slot selection, canary IDs, probe placement
- `deriveSeed(seed, "encodingDiversity")` — for domain key generation

### Naming Conventions

All new identifiers go through the NameRegistry:
- Fixed-count: `createScope()` + `claim()` + `resolveAll()`
- Dynamic-count: `createDynamicGenerator(scopeId)`
- Never use ad-hoc naming or `seed ^ constant`
