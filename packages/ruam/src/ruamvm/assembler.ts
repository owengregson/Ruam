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
import type { RuntimeNames, TempNames } from "../naming/compat-types.js";
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
import { buildUnpackFunction } from "./builders/unpack.js";
import { makeConstantSplitter } from "./constant-splitting.js";
import type { SplitFn } from "./constant-splitting.js";
import type { StructuralChoices } from "../structural-choices.js";
import { applyStructuralTransforms } from "./structural-transforms.js";
import {
	generateDecoderChain,
	buildDecoderFunctionAST,
} from "./polymorphic-decoder.js";
import { atomizeStrings } from "./string-atomization.js";
import { scatterKeyMaterials } from "./scattered-keys.js";
import type { NameRegistry } from "../naming/registry.js";
import { deriveSeed } from "../naming/scope.js";
import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";

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
	/** Generate per-build polymorphic decoder chain for string constants. */
	polymorphicDecoder?: boolean;
	/** Atomize interpreter string literals into encoded table lookups. */
	stringAtomization?: boolean;
	/** Scatter key material fragments across the output. */
	scatteredKeys?: boolean;
	/** Enable runtime opcode mutation (dense handler table required). */
	opcodeMutation?: boolean;
	/** Split encoded bytecode into mixed-type fragments. */
	bytecodeScattering?: boolean;
	/** Shuffled 64-char alphabet for custom binary encoding. */
	alphabet: string;
	/** Whether any compiled units are async (controls async interpreter emit). */
	hasAsyncUnits?: boolean;
	/** Per-build structural variation choices. */
	structuralChoices?: StructuralChoices;
	/** NameRegistry for dynamic name generation (scatter/btScatter). */
	registry: NameRegistry;
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
		polymorphicDecoder = false,
		stringAtomization = false,
		scatteredKeys = false,
		opcodeMutation = false,
		bytecodeScattering = false,
		alphabet,
		hasAsyncUnits = true,
		structuralChoices,
		registry,
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
		[varDecl(names.globalRef, buildGlobalRefDetection(structuralChoices))],
		// 4: TDZ sentinel
		[
			varDecl(
				names.tdzSentinel,
				call(member(id("Object"), "create"), [lit(null)])
			),
		],
	];

	// Optional: unpack function for bytecode scattering
	if (bytecodeScattering) {
		tier0Components.push(buildUnpackFunction(names.unpack));
	}

	// -- Tier 1: crypto/encoding primitives (shuffleable) ------------------
	const tier1Components: JsNode[][] = [];

	// Binary decoder (always emitted)
	const binaryDecoderNodes = buildBinaryDecoderSource(names, alphabet);
	// Deferred nodes: scattered key reassembly + binary decoder rest
	// (inserted between tier 1 and tier 2 so the alphabet is available
	// before the loader/deserializer in tier 3 reference it)
	let scatteredReassemblyNodes: JsNode[] = [];

	if (scatteredKeys) {
		// --- Scattered keys: fragment the alphabet literal ---
		// All fragments go to tiers 0 and 1 (before the reassembly).
		// The reassembly + binary decoder rest go after tier 1 but before
		// tier 2 so the decode function is available for the loader.
		const scatterNameGen = registry.createDynamicGenerator("scatter");
		const scattered = scatterKeyMaterials(
			[{ name: names.alpha, value: alphabet, type: "string" }],
			scatterNameGen,
			seed
		);
		// All fragments go to tier 0 and tier 1 (before reassembly point)
		const allFragments = [
			...scattered.tier0Fragments,
			...scattered.tier1Fragments,
			...scattered.tier3Fragments,
			...scattered.tier4Fragments,
		];
		// Split fragments between tier 0 and tier 1
		const half = Math.ceil(allFragments.length / 2);
		tier0Components.push(allFragments.slice(0, half));
		tier1Components.push(allFragments.slice(half));
		// Reassembly + binary decoder rest deferred to between tier 1 and tier 2
		scatteredReassemblyNodes = [
			...scattered.reassemblyNodes,
			...binaryDecoderNodes.slice(1),
		];
	} else {
		tier1Components.push(binaryDecoderNodes);
	}
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
	// Optional polymorphic decoder chain (string constant encoding).
	// When stringAtomization is also on, the decoder is emitted as part of
	// atomization infrastructure (after all tiers) to avoid duplicates.
	if (polymorphicDecoder && !stringAtomization) {
		const chain = generateDecoderChain(seed);
		const decoderNodes = buildDecoderFunctionAST(
			chain,
			names.polyDec,
			names.polyPosSeed
		);
		tier1Components.push(decoderNodes);
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
			opcodeMutation,
		},
		split,
		hasAsyncUnits,
		structuralChoices,
		registry
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
						bin(
							BOp.BitXor,
							id(names.keyAnchor),
							split(integrityHash)
						),
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
	let nodes: JsNode[] = [];

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

	// Merge tier 0 and tier 1 into a single preamble pool and shuffle
	// together — makes the output beginning vary significantly per build
	if (structuralChoices?.preambleOrder) {
		const combined = [...tier0Components, ...tier1Components];
		pushShuffled(combined, structuralChoices.preambleOrder);
	} else {
		pushShuffled(tier0Components, order?.tier0);
		pushShuffled(tier1Components, order?.tier1);
	}
	// Scattered key reassembly: all fragment vars in tier 0 and tier 1 are
	// now declared. Reassemble the alphabet + build reverse table + decode
	// function before tier 2 (which may depend on them indirectly).
	if (scatteredReassemblyNodes.length > 0) {
		nodes.push(...scatteredReassemblyNodes);
	}
	nodes.push(...tier2Nodes); // tier 2 is never shuffled
	pushShuffled(tier3Components, order?.tier3);
	pushShuffled(tier4Components, order?.tier4);

	// --- String atomization: replace string literals with table lookups ---
	if (stringAtomization) {
		const atomChain = generateDecoderChain(deriveSeed(seed, "atomization"));
		const atomResult = atomizeStrings(nodes, atomChain, {
			decoder: names.polyDec,
			posSeed: names.polyPosSeed,
			table: names.strTbl,
			cache: names.strCache,
			accessor: names.strAcc,
		});
		// Prepend infrastructure (decoder fn + table + cache + accessor)
		// after "use strict" but before everything else
		const useStrict = atomResult.transformedNodes[0]; // "use strict"
		nodes = [
			useStrict!,
			...atomResult.infrastructure,
			...atomResult.transformedNodes.slice(1),
		];
	}

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
	/** Generate per-build polymorphic decoder chain for string constants. */
	polymorphicDecoder?: boolean;
	/** Atomize interpreter string literals into encoded table lookups. */
	stringAtomization?: boolean;
	/** Scatter key material fragments across the output. */
	scatteredKeys?: boolean;
	/** Enable runtime opcode mutation (dense handler table required). */
	opcodeMutation?: boolean;
	/** Split encoded bytecode into mixed-type fragments. */
	bytecodeScattering?: boolean;
	/** Shuffled 64-char alphabet for custom binary encoding. */
	alphabet: string;
	/** NameRegistry for dynamic name generation. */
	registry: NameRegistry;
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
		polymorphicDecoder = false,
		stringAtomization = false,
		scatteredKeys = false,
		opcodeMutation = false,
		bytecodeScattering = false,
		alphabet,
		registry,
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
	nodes.push(varDecl(sharedNames.globalRef, buildGlobalRefDetection()));

	// TDZ sentinel — shared across all groups
	nodes.push(
		varDecl(
			sharedNames.tdzSentinel,
			call(member(id("Object"), "create"), [lit(null)])
		)
	);

	// Shared: unpack function for bytecode scattering
	if (bytecodeScattering) {
		nodes.push(...buildUnpackFunction(sharedNames.unpack));
	}

	// Shared: custom binary decoder (always emitted)
	const shieldedBinDecNodes = buildBinaryDecoderSource(sharedNames, alphabet);
	if (scatteredKeys) {
		// Scatter the alphabet string: all fragments first, then reassembly
		const shieldedScatterGen = registry.createDynamicGenerator("shieldedScatter");
		const shieldedScattered = scatterKeyMaterials(
			[{ name: sharedNames.alpha, value: alphabet, type: "string" }],
			shieldedScatterGen,
			groups[0]?.seed ?? 0x12345678
		);
		// All fragments emitted first so the reassembly can reference them
		nodes.push(
			...shieldedScattered.tier0Fragments,
			...shieldedScattered.tier1Fragments,
			...shieldedScattered.tier3Fragments,
			...shieldedScattered.tier4Fragments,
			...shieldedScattered.reassemblyNodes,
			...shieldedBinDecNodes.slice(1)
		);
	} else {
		nodes.push(...shieldedBinDecNodes);
	}

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

		// Polymorphic decoder (per-group) — only if stringAtomization is off
		// (when on, the decoder is emitted via atomization infrastructure)
		if (polymorphicDecoder && !stringAtomization) {
			const groupChain = generateDecoderChain(group.seed);
			const groupDecoderNodes = buildDecoderFunctionAST(
				groupChain,
				gn.polyDec,
				gn.polyPosSeed
			);
			nodes.push(...groupDecoderNodes);
		}

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
				opcodeMutation,
			},
			groupSplit,
			group.hasAsyncUnits ?? true,
			undefined, // structuralChoices not used in shielded mode
			registry
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

	// --- String atomization (shielded): replace string literals with table lookups ---
	let finalShieldedNodes = nodes;
	if (stringAtomization) {
		const atomChain = generateDecoderChain(
			deriveSeed(groups[0]?.seed ?? 0x12345678, "shieldedAtomization")
		);
		const atomResult = atomizeStrings(finalShieldedNodes, atomChain, {
			decoder: sharedNames.polyDec,
			posSeed: sharedNames.polyPosSeed,
			table: sharedNames.strTbl,
			cache: sharedNames.strCache,
			accessor: sharedNames.strAcc,
		});
		// Prepend infrastructure after "use strict"
		const useStrict = atomResult.transformedNodes[0];
		finalShieldedNodes = [
			useStrict!,
			...atomResult.infrastructure,
			...atomResult.transformedNodes.slice(1),
		];
	}

	// Wrap in IIFE and emit
	return {
		source: emitIIFE(finalShieldedNodes),
		groupKeyAnchors,
	};
}

// --- Helpers ---


/**
 * Build the globalThis detection chain with shuffled check order.
 *
 * `globalThis` is always checked first — it is the standard way to
 * access the global object in all environments (ES2020+) and is the
 * only reference guaranteed to resolve correctly in Chrome extension
 * content scripts (where `window` is the page's Window, but extension
 * globals like `chrome` live on `globalThis`). The remaining globals
 * (`window`, `global`, `self`) are shuffled per build for structural
 * variation.
 */
function buildGlobalRefDetection(choices?: StructuralChoices): JsNode {
	// globalThis is always first — remaining order shuffled
	const rest = ["window", "global", "self"];

	if (choices) {
		for (let i = rest.length - 1; i > 0; i--) {
			const j = Math.floor(choices.prng() * (i + 1));
			[rest[i], rest[j]] = [rest[j]!, rest[i]!];
		}
	}

	const globals = ["globalThis", ...rest];

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
