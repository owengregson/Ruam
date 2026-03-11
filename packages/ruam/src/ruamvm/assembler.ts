/**
 * VM runtime code generator.
 *
 * Produces a self-contained IIFE that contains:
 *   - The interpreter cores (sync / async)
 *   - The dispatch functions
 *   - A bytecode loader + cache
 *   - Optional: fingerprint + RC4 decoder, debug protection, debug logging
 *   - The `_ru4m` watermark variable
 *
 * Uses AST-based builders from `ruamvm/builders/` instead of template
 * literals, then emits via `ruamvm/emit.ts`.
 *
 * @module ruamvm/assembler
 */

import { OPCODE_COUNT } from "../compiler/opcodes.js";
import type { RuntimeNames, TempNames } from "../encoding/names.js";
import type { JsNode } from "./nodes.js";
import { exprStmt, lit, varDecl, arr, obj, un } from "./nodes.js";
import { emit } from "./emit.js";
import { buildFingerprintSource } from "./builders/fingerprint.js";
import {
	buildDecoderSource,
	buildStringDecoderSource,
} from "./builders/decoder.js";
import { buildDebugProtection } from "./builders/debug-protection.js";
import { buildDebugLogging } from "./builders/debug-logging.js";
import { buildRollingCipherSource } from "./builders/rolling-cipher.js";
import { buildInterpreterFunctions } from "./builders/interpreter.js";
import { buildRunners, buildRouter } from "./builders/runners.js";
import { buildLoader } from "./builders/loader.js";
import { buildDeserializer } from "./builders/deserializer.js";
import { buildGlobalExposure } from "./builders/globals.js";

/**
 * Generate the complete VM runtime source code.
 *
 * @returns A JS source string containing the runtime IIFE.
 */
export function generateVmRuntime(options: {
	opcodeShuffleMap: number[];
	names: RuntimeNames;
	temps: TempNames;
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
		temps,
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

	const nodes: JsNode[] = [];

	// "use strict" directive
	nodes.push(exprStmt(lit("use strict")));

	// Optional encryption support
	if (encrypt) {
		nodes.push(...buildFingerprintSource(names));
		nodes.push(...buildDecoderSource(names));
	}

	// Optional debug protection
	if (dbgProt) {
		nodes.push(...buildDebugProtection(names, temps));
	}

	// Optional debug logging
	if (debugLogging) {
		nodes.push(...buildDebugLogging(reverseMap, names, temps));
	}

	// Rolling cipher helpers (must come before interpreter)
	if (rollingCipher) {
		if (integrityBinding && integrityHash !== undefined) {
			nodes.push(varDecl(names.ihash, lit(integrityHash)));
		}
		nodes.push(
			...buildRollingCipherSource(
				names,
				integrityBinding ? integrityHash : undefined
			)
		);
	}

	// Interpreter core (sync + async) — uses direct physical dispatch
	nodes.push(
		...buildInterpreterFunctions(
			names,
			temps,
			opcodeShuffleMap,
			debugLogging,
			rollingCipher,
			seed,
			{
				dynamicOpcodes,
				decoyOpcodes,
				stackEncoding,
				usedOpcodes,
			}
		)
	);

	// Runner dispatch functions
	nodes.push(...buildRunners(debugLogging, names, temps));

	// String constant decoder (XOR key stream)
	if (stringKey !== undefined) {
		nodes.push(
			...buildStringDecoderSource(names, stringKey, rollingCipher)
		);
	}

	// Loader, cache, depth tracking, watermark
	nodes.push(
		...buildLoader(encrypt, names, stringKey !== undefined, rollingCipher)
	);

	// Binary deserializer
	nodes.push(...buildDeserializer(names));

	// Global exposure
	nodes.push(...buildGlobalExposure(names.vm));

	// Wrap in IIFE and emit
	return emitIIFE(nodes);
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
	/** Group-specific randomized temp names. */
	temps: TempNames;
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
	sharedTemps: TempNames;
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
		sharedTemps,
		encrypt,
		debugProtection: dbgProt,
		debugLogging = false,
		decoyOpcodes = false,
		stackEncoding = false,
		integrityBinding = false,
	} = options;

	const nodes: JsNode[] = [];

	// "use strict" directive
	nodes.push(exprStmt(lit("use strict")));

	// Shared: encryption support
	if (encrypt) {
		nodes.push(...buildFingerprintSource(sharedNames));
		nodes.push(...buildDecoderSource(sharedNames));
	}

	// Shared: debug protection
	if (dbgProt) {
		nodes.push(...buildDebugProtection(sharedNames, sharedTemps));
	}

	// Shared: deserializer
	nodes.push(...buildDeserializer(sharedNames));

	// Per-group micro-interpreters
	const groupRegistrations: { unitIds: string[]; dispatchName: string }[] =
		[];

	for (const group of groups) {
		const gn = group.names;
		const gt = group.temps;

		// Debug logging (per-group)
		if (debugLogging) {
			const reverseMap = new Array<number>(OPCODE_COUNT);
			for (let i = 0; i < group.shuffleMap.length; i++) {
				reverseMap[group.shuffleMap[i]!] = i;
			}
			nodes.push(...buildDebugLogging(reverseMap, gn, gt));
		}

		// Rolling cipher (always on with vmShielding)
		if (integrityBinding && group.integrityHash !== undefined) {
			nodes.push(varDecl(gn.ihash, lit(group.integrityHash)));
		}
		nodes.push(
			...buildRollingCipherSource(
				gn,
				integrityBinding ? group.integrityHash : undefined
			)
		);

		// Interpreter core (per-group shuffle, per-group names, per-group opcodes)
		nodes.push(
			...buildInterpreterFunctions(
				gn,
				gt,
				group.shuffleMap,
				debugLogging,
				true, // rollingCipher always on in shielding mode
				group.seed,
				{
					dynamicOpcodes: true, // always strip unused opcodes in shielding mode
					decoyOpcodes,
					stackEncoding,
					usedOpcodes: group.usedOpcodes,
				}
			)
		);

		// Runners (per-group dispatch function)
		nodes.push(...buildRunners(debugLogging, gn, gt));

		// String decoder (per-group, rolling cipher implicit key)
		nodes.push(...buildStringDecoderSource(gn, 0, true));

		// Loader (per-group, skips shared var declarations)
		nodes.push(
			...buildLoader(encrypt, gn, true, true, { skipSharedDecls: true })
		);

		groupRegistrations.push({
			unitIds: group.unitIds,
			dispatchName: gn.vm,
		});
	}

	// Shared: watermark, depth, callStack, cache (emitted once)
	nodes.push(varDecl("_ru4m", un("!", lit(0))));
	nodes.push(varDecl(sharedNames.depth, lit(0)));
	nodes.push(varDecl(sharedNames.callStack, arr()));
	nodes.push(varDecl(sharedNames.cache, obj()));

	// Router: maps unit IDs to group dispatch functions
	nodes.push(
		...buildRouter(sharedNames.router, groupRegistrations, sharedNames)
	);

	// Global exposure: expose the router
	nodes.push(...buildGlobalExposure(sharedNames.router));

	// Wrap in IIFE and emit
	return emitIIFE(nodes);
}

// --- Helpers ---

/**
 * Wrap an array of JsNode[] in a self-executing IIFE and emit to string.
 *
 * Produces: `(function(){...nodes...})();`
 */
function emitIIFE(nodes: JsNode[]): string {
	// Emit each node as a top-level statement inside the IIFE.
	// We build the IIFE manually to ensure correct formatting.
	const parts: string[] = [];
	parts.push("(function(){");
	for (const node of nodes) {
		const s = emit(node);
		if (s.length === 0) continue;
		parts.push(s);
		// Add semicolon if the emitted string doesn't already end with one
		// and isn't a function/block that doesn't need one
		if (!s.endsWith(";") && !s.endsWith("}")) {
			parts.push(";");
		}
	}
	parts.push("})();");
	return parts.join("\n");
}
