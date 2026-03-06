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
import { generateDecoderSource } from "./decoder.js";
import { generateDebugProtection } from "./templates/debug-protection.js";
import { generateDebugLogging } from "./templates/debug-logging.js";
import { generateInterpreterCore } from "./templates/interpreter.js";
import { generateLoader } from "./templates/loader.js";
import { generateRunners } from "./templates/runners.js";
import { generateDeserializer } from "./templates/deserializer.js";
import { generateGlobalExposure } from "./templates/globals.js";

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
  seed: number;
}): string {
  const {
    opcodeShuffleMap,
    names,
    encrypt,
    debugProtection: dbgProt,
    debugLogging = false,
    seed,
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

  // Reverse opcode map
  parts.push(`var ${names.rm}=[${reverseMap.join(",")}];`);

  // Interpreter core (sync + async)
  parts.push(generateInterpreterCore(debugLogging, names, seed));

  // Runner dispatch functions
  parts.push(generateRunners(debugLogging, names));

  // Loader, cache, depth tracking, watermark
  parts.push(generateLoader(encrypt, names));

  // Binary deserializer
  parts.push(generateDeserializer(names));

  // Global exposure
  parts.push(generateGlobalExposure(names));

  // IIFE close
  parts.push(`})();`);

  return parts.join("\n");
}
