/**
 * VM runtime code generator.
 *
 * Produces a self-contained IIFE that contains:
 *   - The interpreter cores (sync / async)
 *   - The dispatch functions
 *   - A bytecode loader + cache
 *   - Optional: fingerprint + RC4 decoder, debug protection, debug logging
 *   - Steganographic watermark (folded into key anchor)
 *
 * Uses AST-based builders from `ruamvm/builders/` instead of template
 * literals, then emits via `ruamvm/emit.ts`.
 *
 * @module ruamvm/assembler
 */

import { OPCODE_COUNT } from "../compiler/opcodes.js";
import type { RuntimeNames, TempNames } from "../encoding/names.js";
import type { JsNode } from "./nodes.js";
import {
	exprStmt,
	lit,
	varDecl,
	arr,
	obj,
	assign,
	bin,
	un,
	call,
	member,
	id,
	ternary,
	BOp,
	UOp,
} from "./nodes.js";
import { emit } from "./emit.js";
import { buildFingerprintSource } from "./builders/fingerprint.js";
import {
	buildBinaryDecoderSource,
	buildRc4Source,
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
import { makeConstantSplitter } from "./constant-splitting.js";
import type { SplitFn } from "./constant-splitting.js";
import type { StructuralChoices } from "../structural-choices.js";
import { applyStructuralTransforms } from "./structural-transforms.js";

/** Result from generating the VM runtime. */
export interface VmRuntimeResult {
	/** The generated JS source string. */
	source: string;
	/** Build-time key anchor value (for rolling cipher key derivation). */
	keyAnchorValue: number;
}

/**
 * Generate the complete VM runtime source code.
 *
 * @returns A VmRuntimeResult containing the JS source string and key anchor value.
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
	cipherSalt?: number;
	mixedBooleanArithmetic?: boolean;
	handlerFragmentation?: boolean;
	/** Shuffled 64-char alphabet for custom binary encoding. */
	alphabet: string;
	/** Whether any compiled units are async (controls async interpreter emit). */
	hasAsyncUnits?: boolean;
	/** Per-build structural variation choices. */
	structuralChoices?: StructuralChoices;
}): VmRuntimeResult {
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
		cipherSalt,
		mixedBooleanArithmetic = false,
		handlerFragmentation = false,
		alphabet,
		hasAsyncUnits = true,
		structuralChoices,
	} = options;

	// Create constant splitter — replaces well-known numeric literals with
	// computed expressions so attackers can't grep for FNV primes, etc.
	const split: SplitFn = makeConstantSplitter(seed);

	// Build reverse map: physical -> logical opcode
	const reverseMap = new Array<number>(OPCODE_COUNT);
	for (let i = 0; i < opcodeShuffleMap.length; i++) {
		reverseMap[opcodeShuffleMap[i]!] = i;
	}

	// -- Tier 0: foundational declarations (shuffleable) --------------------
	const tier0Components: JsNode[][] = [
		// 0: imul alias
		[varDecl(names.imul, member(id("Math"), "imul"))],
		// 1: spread marker symbol
		[varDecl(names.spreadSym, call(id("Symbol"), []))],
		// 2: hop alias
		[
			varDecl(
				names.hop,
				member(member(id("Object"), "prototype"), "hasOwnProperty")
			),
		],
		// 3: globalRef (detection order shuffled per build)
		[
			varDecl(
				names.globalRef,
				buildGlobalRefDetection(structuralChoices)
			),
		],
		// 4: TDZ sentinel
		[
			varDecl(
				names.tdzSentinel,
				call(member(id("Object"), "create"), [lit(null)])
			),
		],
	];

	// -- Tier 1: crypto/encoding primitives (shuffleable) ------------------
	const tier1Components: JsNode[][] = [];
	// Binary decoder (always emitted)
	tier1Components.push(buildBinaryDecoderSource(names, alphabet));
	// Optional encryption support
	if (encrypt) {
		tier1Components.push(buildFingerprintSource(names, split));
		tier1Components.push(buildRc4Source(names, split));
	}
	// Optional debug protection
	if (dbgProt) {
		tier1Components.push(buildDebugProtection(names, temps));
	}
	// Optional debug logging
	if (debugLogging) {
		tier1Components.push(buildDebugLogging(reverseMap, names, temps));
	}

	// -- Tier 2: interpreter machinery (NOT shuffleable — dependency chain) -
	// Build interpreter core — also produces handler table init.
	const interpResult = buildInterpreterFunctions(
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
			mixedBooleanArithmetic,
			handlerFragmentation,
		},
		split,
		hasAsyncUnits,
		structuralChoices
	);

	const tier2Nodes: JsNode[] = [];
	// Handler table + key anchor init (must come before rolling cipher)
	tier2Nodes.push(...interpResult.handlerTableInit);
	// If integrity binding, fold integrity hash into the key anchor
	if (rollingCipher && integrityBinding && integrityHash !== undefined) {
		tier2Nodes.push(
			exprStmt(
				assign(
					id(names.keyAnchor),
					bin(
						BOp.Ushr,
						bin(BOp.BitXor, id(names.keyAnchor), split(integrityHash)),
						lit(0)
					)
				)
			)
		);
	}
	// Rolling cipher helpers (must come after handler table + key anchor)
	if (rollingCipher) {
		tier2Nodes.push(
			...buildRollingCipherSource(
				names,
				true, // hasKeyAnchor — rcDeriveKey references names.keyAnchor
				split,
				cipherSalt
			)
		);
	}
	// Interpreter function bodies
	tier2Nodes.push(...interpResult.interpreters);

	// -- Tier 3: dispatch layer (shuffleable) --------------------------------
	const tier3Components: JsNode[][] = [
		// 0: Runner dispatch functions
		buildRunners(debugLogging, names, temps),
		// 1: String constant decoder + Loader
		[
			...(stringKey !== undefined
				? buildStringDecoderSource(
						names,
						stringKey,
						rollingCipher,
						split
				  )
				: []),
			...buildLoader(
				encrypt,
				names,
				stringKey !== undefined,
				rollingCipher
			),
		],
		// 2: Deserializer
		buildDeserializer(names, temps),
	];

	// -- Tier 4: wiring (shuffleable) ----------------------------------------
	const tier4Components: JsNode[][] = [
		// 0: Global exposure
		buildGlobalExposure(names.vm),
	];

	// -- Assemble with shuffled ordering ------------------------------------
	const nodes: JsNode[] = [];

	// "use strict" always first
	nodes.push(exprStmt(lit("use strict")));

	// Apply shuffled tier ordering
	const order = structuralChoices?.statementOrder;
	function pushShuffled(components: JsNode[][], tierOrder?: number[]) {
		if (!tierOrder || !structuralChoices) {
			for (const c of components) nodes.push(...c);
			return;
		}
		for (const idx of tierOrder) {
			if (idx < components.length) nodes.push(...components[idx]!);
		}
		// Push any components not covered by the order array
		for (let i = 0; i < components.length; i++) {
			if (!tierOrder.includes(i)) nodes.push(...components[i]!);
		}
	}

	pushShuffled(tier0Components, order?.tier0);
	pushShuffled(tier1Components, order?.tier1);
	nodes.push(...tier2Nodes); // tier 2 is never shuffled
	pushShuffled(tier3Components, order?.tier3);
	pushShuffled(tier4Components, order?.tier4);

	// Apply structural AST transforms (control flow, declarations, expressions)
	const finalNodes = structuralChoices
		? applyStructuralTransforms(nodes, structuralChoices)
		: nodes;

	// Wrap in IIFE and emit
	return {
		source: emitIIFE(finalNodes),
		keyAnchorValue: interpResult.keyAnchorValue,
	};
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
	/** Per-group cipher salt for rolling cipher key derivation. */
	cipherSalt?: number;
	/** Whether this group contains async units. */
	hasAsyncUnits?: boolean;
}

/** Result from generating the shielded VM runtime. */
export interface ShieldedVmRuntimeResult {
	/** The generated JS source string. */
	source: string;
	/** Per-group key anchor values (in group order). */
	groupKeyAnchors: number[];
}

/**
 * Generate a shielded VM runtime with per-group micro-interpreters.
 *
 * Shared infrastructure (bytecode table, cache, fingerprint, debug, deserializer)
 * is emitted once. Each group gets its own interpreter, runners, loader, and
 * rolling cipher with unique opcode shuffle and identifier names.
 *
 * @returns A ShieldedVmRuntimeResult containing the JS source string and
 *          per-group key anchor values.
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
	mixedBooleanArithmetic?: boolean;
	handlerFragmentation?: boolean;
	/** Shuffled 64-char alphabet for custom binary encoding. */
	alphabet: string;
}): ShieldedVmRuntimeResult {
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
		mixedBooleanArithmetic = false,
		handlerFragmentation = false,
		alphabet,
	} = options;

	// Shared constant splitter for shared builders (fingerprint, decoder)
	const sharedSplit: SplitFn = makeConstantSplitter(
		groups[0]?.seed ?? 0x12345678
	);

	const nodes: JsNode[] = [];

	// "use strict" directive
	nodes.push(exprStmt(lit("use strict")));

	// Built-in alias — eliminate repeated member chain lookups
	nodes.push(varDecl(sharedNames.imul, member(id("Math"), "imul")));

	// Spread marker symbol — tags spread arrays without object allocation
	nodes.push(varDecl(sharedNames.spreadSym, call(id("Symbol"), [])));

	// Cached built-in references — avoid repeated property chain lookups
	nodes.push(
		varDecl(
			sharedNames.hop,
			member(member(id("Object"), "prototype"), "hasOwnProperty")
		)
	);
	nodes.push(
		varDecl(sharedNames.globalRef, buildGlobalRefDetection())
	);

	// TDZ sentinel — shared across all groups
	nodes.push(
		varDecl(
			sharedNames.tdzSentinel,
			call(member(id("Object"), "create"), [lit(null)])
		)
	);

	// Shared: custom binary decoder (always emitted)
	nodes.push(...buildBinaryDecoderSource(sharedNames, alphabet));

	// Shared: encryption support (RC4 + fingerprint)
	if (encrypt) {
		nodes.push(...buildFingerprintSource(sharedNames, sharedSplit));
		nodes.push(...buildRc4Source(sharedNames, sharedSplit));
	}

	// Shared: debug protection
	if (dbgProt) {
		nodes.push(...buildDebugProtection(sharedNames, sharedTemps));
	}

	// Shared: deserializer
	nodes.push(...buildDeserializer(sharedNames, sharedTemps));

	// Per-group micro-interpreters
	const groupRegistrations: { unitIds: string[]; dispatchName: string }[] =
		[];
	const groupKeyAnchors: number[] = [];

	for (const group of groups) {
		const gn = group.names;
		const gt = group.temps;

		// Per-group constant splitter — each group gets unique split patterns
		const groupSplit: SplitFn = makeConstantSplitter(group.seed);

		// Debug logging (per-group)
		if (debugLogging) {
			const reverseMap = new Array<number>(OPCODE_COUNT);
			for (let i = 0; i < group.shuffleMap.length; i++) {
				reverseMap[group.shuffleMap[i]!] = i;
			}
			nodes.push(...buildDebugLogging(reverseMap, gn, gt));
		}

		// Build interpreter core (per-group) — produces handler table init
		// + key anchor + interpreter function bodies.
		// When group has no async units, only the sync interpreter is emitted.
		const interpResult = buildInterpreterFunctions(
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
				mixedBooleanArithmetic,
				handlerFragmentation,
			},
			groupSplit,
			group.hasAsyncUnits ?? true
		);

		// Handler table + key anchor init (must come before rolling cipher
		// so rcDeriveKey can reference the key anchor closure variable)
		nodes.push(...interpResult.handlerTableInit);

		// Fold integrity hash into the key anchor (if integrityBinding is on)
		if (integrityBinding && group.integrityHash !== undefined) {
			// _ka = (_ka ^ integrityHash) >>> 0;
			nodes.push(
				exprStmt(
					assign(
						id(gn.keyAnchor),
						bin(
							BOp.Ushr,
							bin(
								BOp.BitXor,
								id(gn.keyAnchor),
								groupSplit(group.integrityHash)
							),
							lit(0)
						)
					)
				)
			);
		}

		// Rolling cipher helpers (must come after handler table + key anchor)
		nodes.push(
			...buildRollingCipherSource(
				gn,
				true, // hasKeyAnchor — always true in shielding mode
				groupSplit,
				group.cipherSalt
			)
		);

		// Interpreter function bodies
		nodes.push(...interpResult.interpreters);

		// Save key anchor value for caller
		groupKeyAnchors.push(interpResult.keyAnchorValue);

		// Runners (per-group dispatch function)
		nodes.push(...buildRunners(debugLogging, gn, gt));

		// String decoder (per-group, rolling cipher implicit key)
		nodes.push(...buildStringDecoderSource(gn, 0, true, groupSplit));

		// Loader (per-group, skips shared var declarations)
		nodes.push(
			...buildLoader(encrypt, gn, true, true, { skipSharedDecls: true })
		);

		groupRegistrations.push({
			unitIds: group.unitIds,
			dispatchName: gn.vm,
		});
	}

	// Shared: depth, callStack, cache (emitted once)
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
	return {
		source: emitIIFE(nodes),
		groupKeyAnchors,
	};
}

// --- Helpers ---

/**
 * Build the globalThis detection chain with shuffled check order.
 * The standard order (globalThis → window → global → self) is
 * recognizable across builds. Shuffling it breaks that pattern.
 */
function buildGlobalRefDetection(choices?: StructuralChoices): JsNode {
	const globals = ["globalThis", "window", "global", "self"];

	// Shuffle the detection order using the structural choices PRNG
	if (choices) {
		for (let i = globals.length - 1; i > 0; i--) {
			const j = Math.floor(choices.prng() * (i + 1));
			[globals[i], globals[j]] = [globals[j]!, globals[i]!];
		}
	}

	// Build nested ternary chain: check each global, fallback to {}
	let result: JsNode = obj();
	for (let i = globals.length - 1; i >= 0; i--) {
		const name = globals[i]!;
		result = ternary(
			bin(BOp.Sneq, un(UOp.Typeof, id(name)), lit("undefined")),
			id(name),
			result
		);
	}
	return result;
}

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
		// Function declarations don't need semicolons; everything else does.
		// We check the node type rather than string endings to avoid
		// misclassifying object-literal-ending expressions (e.g. `var x={}`).
		if (node.type !== "FnDecl") {
			if (!s.endsWith(";")) parts.push(";");
		}
	}
	parts.push("})();");
	return parts.join("\n");
}
