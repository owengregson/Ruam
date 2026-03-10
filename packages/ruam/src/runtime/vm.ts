/**
 * VM runtime code generator.
 *
 * Produces a self-contained IIFE that contains:
 *   - The reverse shuffle map
 *   - The interpreter cores (sync / async)
 *   - The dispatch functions
 *   - A bytecode loader + cache
 *   - Optional: fingerprint + RC4 decoder, debug protection, debug logging
 *   - The `_ru4m` watermark variable
 *
 * The generated code is meant to be prepended to the obfuscated source file
 * with the bytecode table injected inside the IIFE.
 *
 * All internal identifiers are randomized per build via {@link RuntimeNames}
 * so the output looks like generic minified code.
 *
 * @module runtime/vm
 */

import { OPCODE_COUNT } from "../compiler/opcodes.js";
import type { RuntimeNames } from "./names.js";
import { generateFingerprintSource } from "./fingerprint.js";
import { generateDecoderSource, generateStringDecoderSource } from "./decoder.js";
import { generateDebugProtection } from "./templates/debug-protection.js";
import { generateDebugLogging } from "./templates/debug-logging.js";
import { generateInterpreterCore } from "./templates/interpreter.js";
import { generateLoader } from "./templates/loader.js";
import { generateRunners, generateRouter } from "./templates/runners.js";
import { generateDeserializer } from "./templates/deserializer.js";
import { generateGlobalExposure } from "./templates/globals.js";
import { generateRollingCipherSource } from "./rolling-cipher.js";

/**
 * Generate the complete VM runtime source code.
 *
 * @returns A JS source string containing the runtime IIFE.
 */
export function generateVmRuntime(options: {
  opcodeShuffleMap: number[];
  names: RuntimeNames;
  encrypt: boolean;
  debugProtection: boolean;
  debugLogging?: boolean;
  dynamicOpcodes?: boolean;
  decoyOpcodes?: boolean;
  stackEncoding?: boolean;
  seed: number;
  stringKey?: number;
  rollingCipher?: boolean;
  integrityBinding?: boolean;
  integrityHash?: number;
  usedOpcodes?: Set<number>;
}): string {
  const {
    opcodeShuffleMap,
    names,
    encrypt,
    debugProtection: dbgProt,
    debugLogging = false,
    dynamicOpcodes = false,
    decoyOpcodes = false,
    stackEncoding = false,
    seed,
    stringKey,
    rollingCipher = false,
    integrityBinding = false,
    integrityHash,
    usedOpcodes,
  } = options;

  // Build reverse map: physical -> logical opcode
  const reverseMap = new Array<number>(OPCODE_COUNT);
  for (let i = 0; i < opcodeShuffleMap.length; i++) {
    reverseMap[opcodeShuffleMap[i]!] = i;
  }

  const parts: string[] = [];

  // IIFE open
  parts.push(`(function(){`);
  parts.push(`"use strict";`);

  // Optional encryption support
  if (encrypt) {
    parts.push(generateFingerprintSource(names));
    parts.push(generateDecoderSource(names));
  }

  // Optional debug protection
  if (dbgProt) {
    parts.push(generateDebugProtection(names));
  }

  // Optional debug logging
  if (debugLogging) {
    parts.push(generateDebugLogging(reverseMap, names));
  }

  // Rolling cipher helpers (must come before interpreter)
  if (rollingCipher) {
    if (integrityBinding && integrityHash !== undefined) {
      // Embed the precomputed integrity hash as a literal.
      // This value is folded into the rolling cipher key derivation.
      parts.push(`var ${names.ihash}=${integrityHash};`);
    }
    parts.push(generateRollingCipherSource(names, integrityBinding));
  }

  // Interpreter core (sync + async) — uses direct physical dispatch
  // (no reverse opcode map emitted; case labels use physical opcodes directly)
  parts.push(generateInterpreterCore(debugLogging, names, seed, opcodeShuffleMap, rollingCipher, integrityBinding, {
    dynamicOpcodes,
    decoyOpcodes,
    stackEncoding,
    usedOpcodes,
  }));

  // Runner dispatch functions
  parts.push(generateRunners(debugLogging, names));

  // String constant decoder (XOR key stream)
  if (stringKey !== undefined) {
    parts.push(generateStringDecoderSource(names, stringKey, rollingCipher));
  }

  // Loader, cache, depth tracking, watermark
  parts.push(generateLoader(encrypt, names, stringKey !== undefined, rollingCipher));

  // Binary deserializer
  parts.push(generateDeserializer(names));

  // Global exposure
  parts.push(generateGlobalExposure(names));

  // IIFE close
  parts.push(`})();`);

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// VM Shielding: per-group micro-interpreters
// ---------------------------------------------------------------------------

/** Per-group configuration for shielded runtime generation. */
export interface ShieldingGroup {
  /** Group-specific opcode shuffle map. */
  shuffleMap: number[];
  /** Group-specific randomized identifier names. */
  names: RuntimeNames;
  /** Group-specific seed (for obfuscateLocals). */
  seed: number;
  /** Unit IDs belonging to this group (root + children). */
  unitIds: string[];
  /** Opcodes used by this group's units. */
  usedOpcodes: Set<number>;
  /** Per-group integrity hash (if integrityBinding is on). */
  integrityHash?: number;
}

/**
 * Generate a shielded VM runtime with per-group micro-interpreters.
 *
 * Shared infrastructure (bytecode table, cache, fingerprint, debug, deserializer)
 * is emitted once. Each group gets its own interpreter, runners, loader, and
 * rolling cipher with unique opcode shuffle and identifier names.
 *
 * @returns A JS source string containing the shielded runtime IIFE.
 */
export function generateShieldedVmRuntime(options: {
  groups: ShieldingGroup[];
  sharedNames: RuntimeNames;
  encrypt: boolean;
  debugProtection: boolean;
  debugLogging?: boolean;
  decoyOpcodes?: boolean;
  stackEncoding?: boolean;
  integrityBinding?: boolean;
}): string {
  const {
    groups,
    sharedNames,
    encrypt,
    debugProtection: dbgProt,
    debugLogging = false,
    decoyOpcodes = false,
    stackEncoding = false,
    integrityBinding = false,
  } = options;

  const parts: string[] = [];

  // IIFE open
  parts.push(`(function(){`);
  parts.push(`"use strict";`);

  // Shared: encryption support
  if (encrypt) {
    parts.push(generateFingerprintSource(sharedNames));
    parts.push(generateDecoderSource(sharedNames));
  }

  // Shared: debug protection
  if (dbgProt) {
    parts.push(generateDebugProtection(sharedNames));
  }

  // Shared: deserializer
  parts.push(generateDeserializer(sharedNames));

  // Per-group micro-interpreters
  const groupRegistrations: { unitIds: string[]; dispatchName: string }[] = [];

  for (const group of groups) {
    const gn = group.names;

    // Debug logging (per-group — uses shared debug function names but group's reverse map)
    if (debugLogging) {
      const reverseMap = new Array<number>(OPCODE_COUNT);
      for (let i = 0; i < group.shuffleMap.length; i++) {
        reverseMap[group.shuffleMap[i]!] = i;
      }
      parts.push(generateDebugLogging(reverseMap, gn));
    }

    // Rolling cipher (always on with vmShielding)
    if (integrityBinding && group.integrityHash !== undefined) {
      parts.push(`var ${gn.ihash}=${group.integrityHash};`);
    }
    parts.push(generateRollingCipherSource(gn, integrityBinding));

    // Interpreter core (per-group shuffle, per-group names, per-group opcodes)
    parts.push(generateInterpreterCore(debugLogging, gn, group.seed, group.shuffleMap, true, integrityBinding, {
      dynamicOpcodes: true, // always strip unused opcodes in shielding mode
      decoyOpcodes,
      stackEncoding,
      usedOpcodes: group.usedOpcodes,
    }));

    // Runners (per-group dispatch function)
    parts.push(generateRunners(debugLogging, gn));

    // String decoder (per-group, rolling cipher implicit key)
    parts.push(generateStringDecoderSource(gn, 0, true));

    // Loader (per-group, skips shared var declarations)
    parts.push(generateLoader(encrypt, gn, true, true, { skipSharedDecls: true }));

    groupRegistrations.push({
      unitIds: group.unitIds,
      dispatchName: gn.vm,
    });
  }

  // Shared: watermark, depth, callStack, cache (emitted once)
  parts.push(`var _ru4m=!0;`);
  parts.push(`var ${sharedNames.depth}=0;`);
  parts.push(`var ${sharedNames.callStack}=[];`);
  parts.push(`var ${sharedNames.cache}={};`);

  // Router: maps unit IDs to group dispatch functions
  parts.push(generateRouter(sharedNames.router, groupRegistrations, sharedNames));

  // Global exposure: expose the router
  parts.push(generateGlobalExposure(sharedNames, sharedNames.router));

  // IIFE close
  parts.push(`})();`);

  return parts.join("\n");
}
