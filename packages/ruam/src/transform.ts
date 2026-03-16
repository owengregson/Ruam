/**
 * Main transformation orchestrator.
 *
 * {@link obfuscateCode} is the core function that:
 *   1. Resolves presets and options
 *   2. Optionally preprocesses identifiers
 *   3. Parses the source with Babel
 *   4. Identifies target functions (root-level or comment-annotated)
 *   5. Compiles each target to bytecode
 *   6. Generates the VM runtime with randomized identifiers
 *   7. Assembles the final output (runtime IIFE + bytecode table + modified AST)
 *
 * @module transform
 */

import { parse } from "@babel/parser";
import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { traverse, generate } from "./babel-compat.js";
import { compileFunction, resetUnitCounter } from "./compiler/index.js";
import {
	generateShuffleMap,
	OPCODE_COUNT,
	Op,
	ALL_JUMP_OPS,
	PACKED_JUMP_OPS,
} from "./compiler/opcodes.js";
import { encodeBytecodeUnit } from "./compiler/encode.js";
import {
	generateVmRuntime,
	generateShieldedVmRuntime,
} from "./ruamvm/assembler.js";
import type { ShieldingGroup, VmRuntimeResult } from "./ruamvm/assembler.js";
import type { RuntimeNames, TempNames } from "./encoding/names.js";
import { setupRegistry, setupShieldedRegistry } from "./naming/index.js";
import { resolveOptions } from "./presets.js";
import type { ResolvedOptions } from "./presets.js";
import type { VmObfuscationOptions, BytecodeUnit } from "./types.js";
import { preprocessIdentifiers, resetHexCounter } from "./preprocess.js";
import {
	BABEL_PARSER_PLUGINS,
	FNV_OFFSET_BASIS,
	FNV_PRIME,
	LCG_MULTIPLIER,
	LCG_INCREMENT,
} from "./constants.js";
import { buildInterpreterFunctions } from "./ruamvm/builders/interpreter.js";
import { emit } from "./ruamvm/emit.js";
// generateAlphabet no longer needed — provided by NameRegistry
import { generateStructuralChoices } from "./structural-choices.js";
import type { StructuralChoices } from "./structural-choices.js";
import { permuteBlocks } from "./compiler/block-permutation.js";
import {
	insertMutationOpcodes,
	adjustEncodingForMutations,
} from "./compiler/opcode-mutation.js";

import { randomBytes } from "node:crypto";

/**
 * Generate a cryptographically strong 32-bit seed.
 *
 * Uses Node.js `crypto.randomBytes` for proper entropy instead of
 * `Date.now() ^ Math.random()` which is predictable.
 */
function generateCryptoSeed(): number {
	return randomBytes(4).readUInt32LE(0);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Obfuscate a JavaScript source string by compiling eligible functions
 * into custom bytecode and embedding a VM interpreter.
 *
 * @param source  - The JavaScript source code.
 * @param options - Obfuscation options (see {@link VmObfuscationOptions}).
 * @returns The obfuscated JavaScript source code.
 */
export function obfuscateCode(
	source: string,
	options: VmObfuscationOptions = {}
): string {
	const resolved = resolveOptions(options);
	const {
		targetMode = "root",
		threshold = 1.0,
		preprocessIdentifiers: preprocess = false,
		encryptBytecode = false,
		debugProtection = false,
		debugLogging = false,
		dynamicOpcodes = false,
		decoyOpcodes = false,
		deadCodeInjection = false,
		stackEncoding = false,
		rollingCipher = false,
		integrityBinding = false,
		vmShielding = false,
		mixedBooleanArithmetic = false,
		handlerFragmentation = false,
		blockPermutation = false,
		opcodeMutation = false,
		polymorphicDecoder = false,
		stringAtomization = false,
		scatteredKeys = false,
		wrapOutput = false,
	} = resolved;

	// -- Optional identifier preprocessing -----------------------------------
	let code = source;
	if (preprocess) {
		resetHexCounter();
		code = preprocessIdentifiers(code);
	}

	// -- Generate per-file opcode shuffle ------------------------------------
	const shuffleSeed = generateCryptoSeed();

	resetUnitCounter(shuffleSeed);
	const shuffleMap = generateShuffleMap(shuffleSeed);

	// -- Generate randomized runtime identifiers + alphabet via NameRegistry --
	const { runtime: names, temps, alphabet } = setupRegistry(shuffleSeed);

	// -- Generate per-build structural variation choices --------------------
	const structuralChoices = generateStructuralChoices(shuffleSeed);

	// -- Parse ---------------------------------------------------------------
	const ast = parse(code, {
		sourceType: "unambiguous",
		plugins: [...BABEL_PARSER_PLUGINS],
	});

	// -- Collect target functions --------------------------------------------
	const targetPaths = collectTargetFunctions(ast, targetMode, threshold);

	// -- VM Shielding path ---------------------------------------------------
	if (vmShielding) {
		return assembleShielded(ast, targetPaths, {
			encryptBytecode,
			debugProtection,
			debugLogging,
			decoyOpcodes,
			deadCodeInjection,
			stackEncoding,
			integrityBinding,
			mixedBooleanArithmetic,
			handlerFragmentation,
			blockPermutation,
			opcodeMutation,
			polymorphicDecoder,
			stringAtomization,
			scatteredKeys,
			wrapOutput,
		});
	}

	// -- Generate per-build cipher salt (if rolling cipher is enabled) --------
	const cipherSalt = rollingCipher ? generateCryptoSeed() : undefined;

	// -- Compile each target (no encoding yet — need keyAnchor first) -------
	const compiledUnits = compileTargetsOnly(
		targetPaths,
		names,
		deadCodeInjection,
		shuffleSeed,
		temps["_ps"],
		blockPermutation,
		opcodeMutation
	);

	if (compiledUnits.size === 0) return code;

	// -- Detect async units (for conditional async interpreter emit) --------
	let hasAsyncUnits = false;
	for (const [, { unit }] of compiledUnits) {
		if (unit.isAsync) {
			hasAsyncUnits = true;
			break;
		}
	}

	// -- Collect used opcodes (for dynamicOpcodes / decoyOpcodes) -----------
	let usedOpcodes: Set<number> | undefined;
	if (dynamicOpcodes || decoyOpcodes) {
		usedOpcodes = collectUsedOpcodes(compiledUnits);
	}

	// -- Compute integrity hash + key anchor --------------------------------
	// The key anchor is a checksum of the packed handler table, computed
	// by buildInterpreterFunctions.  We need it before encoding because
	// it's folded into the rolling cipher key derivation.
	//
	// When integrityBinding is on, we also hash the interpreter source
	// and embed it as a literal — changing the interpreter without
	// updating the hash breaks all decryption.
	let integrityHash: number | undefined;
	if (integrityBinding) {
		const interpResult = buildInterpreterFunctions(
			names,
			temps,
			shuffleMap,
			debugLogging,
			true,
			shuffleSeed,
			{
				dynamicOpcodes,
				decoyOpcodes,
				stackEncoding,
				usedOpcodes,
				mixedBooleanArithmetic,
				handlerFragmentation,
			},
			undefined,
			hasAsyncUnits,
			structuralChoices
		);
		const interpSource = interpResult.interpreters
			.map((n) => emit(n))
			.join("\n");
		integrityHash = fnv1a(interpSource);
	}

	// -- Generate runtime (produces key anchor value) -----------------------
	const runtimeResult = generateVmRuntime({
		opcodeShuffleMap: shuffleMap,
		names,
		temps,
		encrypt: encryptBytecode,
		debugProtection,
		debugLogging,
		dynamicOpcodes,
		decoyOpcodes,
		stackEncoding,
		seed: shuffleSeed,
		stringKey: shuffleSeed,
		rollingCipher,
		integrityBinding,
		integrityHash,
		usedOpcodes,
		cipherSalt,
		mixedBooleanArithmetic,
		handlerFragmentation,
		polymorphicDecoder,
		stringAtomization,
		scatteredKeys,
		alphabet,
		hasAsyncUnits,
		structuralChoices,
	});

	// -- Encode all units (now that we have the key anchor) -----------------
	const keyAnchor = rollingCipher ? runtimeResult.keyAnchorValue : undefined;
	const encodedUnits = encodeAllUnits(
		compiledUnits,
		shuffleMap,
		encryptBytecode,
		shuffleSeed,
		rollingCipher,
		integrityHash,
		cipherSalt,
		keyAnchor,
		alphabet,
		opcodeMutation
	);

	// -- Assemble output -----------------------------------------------------
	return assembleOutputFromParts(
		ast,
		encodedUnits,
		names,
		temps,
		runtimeResult.source,
		wrapOutput,
		shuffleSeed
	);
}

// ---------------------------------------------------------------------------
// FNV-1a hash (build-time, matches runtime ihashFn)
// ---------------------------------------------------------------------------

function fnv1a(s: string): number {
	let h = FNV_OFFSET_BASIS;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, FNV_PRIME);
	}
	return h >>> 0;
}

// ---------------------------------------------------------------------------
// Target function collection
// ---------------------------------------------------------------------------

/**
 * Walk the AST and collect functions that should be compiled to bytecode.
 */
function collectTargetFunctions(
	ast: t.File,
	mode: "root" | "comment",
	threshold: number
): NodePath<t.Function>[] {
	const targets: NodePath<t.Function>[] = [];

	traverse(ast, {
		FunctionDeclaration(path) {
			if (shouldTarget(path as NodePath<t.Function>, mode, threshold)) {
				targets.push(path as NodePath<t.Function>);
			}
		},
		FunctionExpression(path) {
			if (shouldTarget(path as NodePath<t.Function>, mode, threshold)) {
				targets.push(path as NodePath<t.Function>);
			}
		},
		ArrowFunctionExpression(path) {
			if (shouldTarget(path as NodePath<t.Function>, mode, threshold)) {
				targets.push(path as NodePath<t.Function>);
			}
		},
	});

	return targets;
}

/**
 * Decide whether a function should be compiled to bytecode.
 *
 * - `"comment"` mode: only if preceded by `/* ruam:vm *​/`
 * - `"root"` mode: any function not nested inside another function
 */
function shouldTarget(
	path: NodePath<t.Function>,
	mode: "root" | "comment",
	threshold: number
): boolean {
	if (mode === "comment") {
		const leadingComments = path.node.leadingComments;
		if (!leadingComments) return false;
		return leadingComments.some((c) => c.value.trim() === "ruam:vm");
	}

	// "root" mode: reject anything nested inside another function
	let current: NodePath | null = path.parentPath;
	while (current) {
		if (current.isFunction()) return false;
		current = current.parentPath;
	}

	if (threshold < 1.0 && Math.random() > threshold) return false;
	return true;
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

/**
 * Compile a list of target function paths into bytecode units (no encoding).
 *
 * Compilation and encoding are split into separate phases because the
 * key anchor value (needed for encoding) comes from the handler table
 * checksum, which requires knowing which opcodes are used — and that
 * depends on compilation.
 */
function compileTargetsOnly(
	targetPaths: NodePath<t.Function>[],
	names: RuntimeNames,
	deadCodeInjection: boolean = false,
	seed: number,
	scopeVarName?: string,
	blockPermutationOpt: boolean = false,
	opcodeMutationOpt: boolean = false
): Map<string, { unit: BytecodeUnit }> {
	const compiledUnits: Map<string, { unit: BytecodeUnit }> = new Map();

	for (const fnPath of targetPaths) {
		try {
			const unit = compileFunction(fnPath);

			// --- Dead code injection (before block permutation) ---
			if (deadCodeInjection) {
				injectDeadCode(unit, seed);
				for (const child of unit.childUnits) {
					injectDeadCode(child, seed);
				}
			}

			// --- Block permutation: shuffle basic block order ---
			if (blockPermutationOpt) {
				permuteBlocks(unit, seed);
			}

			// --- Opcode mutation: insert MUTATE instructions ---
			if (opcodeMutationOpt) {
				insertMutationOpcodes(unit, seed);
			}

			compiledUnits.set(unit.id, { unit });
			for (const child of unit.childUnits) {
				compiledUnits.set(child.id, { unit: child });
			}

			replaceFunctionBody(fnPath, unit.id, names, scopeVarName);
		} catch (err) {
			const loc = fnPath.node.loc?.start;
			const locStr = loc ? ` at ${loc.line}:${loc.column}` : "";
			const fnName =
				("id" in fnPath.node && fnPath.node.id?.name) || "<anonymous>";
			const message = err instanceof Error ? err.message : String(err);
			console.warn(
				`[ruam] Failed to compile ${fnName}${locStr}: ${message}`
			);
		}
	}

	return compiledUnits;
}

/**
 * Encode all compiled units with the given key anchor and cipher parameters.
 *
 * When {@link opcodeMutationOpt} is true, each unit's opcodes are pre-encoded
 * via {@link adjustEncodingForMutations} (which tracks cumulative MUTATE
 * instructions) and an identity shuffle map is used for serialization.
 */
function encodeAllUnits(
	compiledUnits: Map<string, { unit: BytecodeUnit }>,
	shuffleMap: number[],
	encrypt: boolean,
	stringKey: number,
	rollingCipher: boolean,
	integrityHash?: number,
	cipherSalt?: number,
	keyAnchor?: number,
	alphabet?: string,
	opcodeMutationOpt: boolean = false
): Map<string, { unit: BytecodeUnit; encoded: string }> {
	const result = new Map<string, { unit: BytecodeUnit; encoded: string }>();

	// Build identity map for mutation-encoded units (opcodes already physical)
	let identityMap: number[] | undefined;
	if (opcodeMutationOpt) {
		identityMap = new Array(OPCODE_COUNT);
		for (let i = 0; i < OPCODE_COUNT; i++) identityMap[i] = i;
	}

	for (const [unitId, { unit }] of compiledUnits) {
		// For mutation units, pre-encode opcodes and use identity shuffle map
		const effectiveMap = opcodeMutationOpt
			? (adjustEncodingForMutations(unit, shuffleMap, OPCODE_COUNT),
			  identityMap!)
			: shuffleMap;

		const encoded = encodeUnit(
			unit,
			effectiveMap,
			encrypt,
			stringKey,
			rollingCipher,
			integrityHash,
			cipherSalt,
			keyAnchor,
			alphabet!
		);
		result.set(unitId, { unit, encoded });
	}
	return result;
}

// ---------------------------------------------------------------------------
// Dead code injection
// ---------------------------------------------------------------------------

/**
 * Inject unreachable bytecode sequences into a compiled unit.
 *
 * Finds positions after RETURN opcodes where the next instruction is not a
 * jump target, and inserts fake instruction sequences that look like real
 * code but are never executed. This confuses static analysis tools and
 * makes the bytecode harder to reverse-engineer.
 */
function injectDeadCode(unit: BytecodeUnit, seed: number): void {
	const instrs = unit.instructions;
	if (instrs.length < 4) return;

	// Collect all jump targets so we don't inject dead code where something jumps to
	const jumpTargets = new Set<number>();
	for (const instr of instrs) {
		if (ALL_JUMP_OPS.has(instr.opcode)) {
			jumpTargets.add(instr.operand);
		}
		if (PACKED_JUMP_OPS.has(instr.opcode)) {
			if (instr.opcode === Op.TRY_PUSH) {
				// TRY_PUSH packs catchIp in bits 16-31, finallyIp in bits 0-15
				// 0xFFFF is the sentinel for "not present" — skip it
				const catchIp = (instr.operand >> 16) & 0xffff;
				const finallyIp = instr.operand & 0xffff;
				if (catchIp > 0 && catchIp !== 0xffff) jumpTargets.add(catchIp);
				if (finallyIp > 0 && finallyIp !== 0xffff)
					jumpTargets.add(finallyIp);
			} else {
				// REG_LT_CONST_JF / REG_LT_REG_JF: jump target in bits 16-31
				const target = (instr.operand >>> 16) & 0xffff;
				jumpTargets.add(target);
			}
		}
	}
	// Also protect exception table targets from dead code insertion
	for (const entry of unit.exceptionTable) {
		jumpTargets.add(entry.startIp);
		jumpTargets.add(entry.endIp);
		if (entry.catchIp > 0) jumpTargets.add(entry.catchIp);
		if (entry.finallyIp > 0) jumpTargets.add(entry.finallyIp);
	}

	// Use seed for deterministic dead code patterns
	let s = (seed ^ instrs.length) >>> 0;
	function lcg(): number {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s;
	}

	// Build dead code blocks to insert — work backwards to preserve indices
	const insertions: {
		after: number;
		block: { opcode: number; operand: number }[];
	}[] = [];

	for (let i = 0; i < instrs.length; i++) {
		const instr = instrs[i]!;
		if (instr.opcode !== Op.RETURN) continue;
		if (i + 1 >= instrs.length) continue;
		if (jumpTargets.has(i + 1)) continue;

		// ~40% chance to inject at each eligible site
		if (lcg() % 100 >= 40) continue;

		// Generate a fake sequence of 3-6 instructions
		const blockLen = 3 + (lcg() % 4);
		const block: { opcode: number; operand: number }[] = [];

		for (let j = 0; j < blockLen; j++) {
			const pattern = lcg() % 8;
			switch (pattern) {
				case 0:
					block.push({
						opcode: Op.PUSH_CONST,
						operand: lcg() % Math.max(1, unit.constants.length),
					});
					break;
				case 1:
					block.push({ opcode: Op.ADD, operand: 0 });
					break;
				case 2:
					block.push({ opcode: Op.SUB, operand: 0 });
					break;
				case 3:
					block.push({ opcode: Op.POP, operand: 0 });
					break;
				case 4:
					block.push({ opcode: Op.DUP, operand: 0 });
					break;
				case 5:
					block.push({ opcode: Op.NOT, operand: 0 });
					break;
				case 6:
					block.push({ opcode: Op.PUSH_UNDEFINED, operand: 0 });
					break;
				case 7:
					block.push({ opcode: Op.PUSH_NULL, operand: 0 });
					break;
			}
		}

		insertions.push({ after: i, block });
	}

	// Apply insertions in reverse order so indices stay valid
	for (let k = insertions.length - 1; k >= 0; k--) {
		const { after, block } = insertions[k]!;

		// Patch all jump targets that point past the insertion site
		for (const instr of instrs) {
			if (ALL_JUMP_OPS.has(instr.opcode) && instr.operand > after) {
				instr.operand += block.length;
			}
			if (PACKED_JUMP_OPS.has(instr.opcode)) {
				if (instr.opcode === Op.TRY_PUSH) {
					let catchIp = (instr.operand >> 16) & 0xffff;
					let finallyIp = instr.operand & 0xffff;
					// 0xFFFF is the sentinel for "not present" — never patch it
					if (catchIp !== 0xffff && catchIp > after)
						catchIp += block.length;
					if (finallyIp !== 0xffff && finallyIp > after)
						finallyIp += block.length;
					instr.operand =
						((catchIp & 0xffff) << 16) | (finallyIp & 0xffff);
				} else {
					// REG_LT_CONST_JF / REG_LT_REG_JF: jump target in bits 16-31
					const low = instr.operand & 0xffff;
					let target = (instr.operand >>> 16) & 0xffff;
					if (target > after) target += block.length;
					instr.operand = (low & 0xffff) | ((target & 0xffff) << 16);
				}
			}
		}

		// Patch exception table IPs
		for (const entry of unit.exceptionTable) {
			if (entry.startIp > after) entry.startIp += block.length;
			if (entry.endIp > after) entry.endIp += block.length;
			if (entry.catchIp > after) entry.catchIp += block.length;
			if (entry.finallyIp > after) entry.finallyIp += block.length;
		}

		// Patch jump table IPs (label → target mapping)
		for (const [label, target] of Object.entries(unit.jumpTable)) {
			if (target > after) {
				unit.jumpTable[Number(label)] = target + block.length;
			}
		}

		// Insert the dead code block
		instrs.splice(after + 1, 0, ...block);
	}
}

// ---------------------------------------------------------------------------
// Top-level binding collection (for program scope object)
// ---------------------------------------------------------------------------

/**
 * Collect the names of all top-level bindings in the program body.
 *
 * These bindings may be referenced by compiled bytecode via LOAD_SCOPED /
 * STORE_SCOPED.  In module contexts (CJS / ESM) they are NOT on
 * `globalThis`, so we register them in a program scope object that is
 * threaded through the dispatch chain as the outer scope.
 */
function collectTopLevelBindings(body: t.Statement[]): string[] {
	const bindings: string[] = [];
	for (const node of body) {
		if (t.isFunctionDeclaration(node) && node.id) {
			bindings.push(node.id.name);
		} else if (t.isVariableDeclaration(node)) {
			for (const decl of node.declarations) {
				if (t.isIdentifier(decl.id)) {
					bindings.push(decl.id.name);
				}
			}
		} else if (t.isClassDeclaration(node) && node.id) {
			bindings.push(node.id.name);
		}
	}
	return bindings;
}

/**
 * Build the program scope object setup code.
 *
 * Creates a prototypal scope object (Object.create(null)) with
 * getter/setter bindings for every top-level declaration. Getters
 * lazily read from the enclosing JS scope (handling hoisting and
 * late initialisation correctly).
 *
 * @param psName   - Variable name for the scope object.
 * @param bindings - Top-level binding names to register.
 * @returns JS source string for the scope setup statements.
 */
function buildScopeSetupCode(psName: string, bindings: string[]): string {
	const lines: string[] = [];
	lines.push(`var ${psName}=Object.create(null);`);
	for (const name of bindings) {
		lines.push(
			`Object.defineProperty(${psName},"${name}",` +
				`{get:function(){return ${name}},` +
				`set:function(v){${name}=v},` +
				`enumerable:!0,configurable:!0});`
		);
	}
	return lines.join("");
}

/**
 * Build bytecode table declarations: an empty table init + individual
 * assignment statements that can be scattered throughout the output.
 *
 * All units are custom-encoded binary strings, so values are always quoted.
 */
function buildBtParts(
	units: Map<string, { encoded: string }>,
	btName: string
): { init: string; assignments: string[] } {
	const assignments: string[] = [];
	for (const [id, { encoded }] of units) {
		assignments.push(`${btName}["${id}"]="${encoded}";`);
	}
	return { init: `var ${btName}={};`, assignments };
}

/**
 * Collect all logical opcodes used across all compiled bytecode units.
 */
function collectUsedOpcodes(
	compiledUnits: Map<string, { unit: BytecodeUnit }>
): Set<number> {
	const used = new Set<number>();
	for (const [, { unit }] of compiledUnits) {
		for (const instr of unit.instructions) {
			used.add(instr.opcode);
		}
	}
	return used;
}

/** Encode a single bytecode unit to custom binary format. */
function encodeUnit(
	unit: BytecodeUnit,
	shuffleMap: number[],
	encrypt: boolean,
	stringKey: number,
	rollingCipher: boolean = false,
	integrityHash?: number,
	cipherSalt?: number,
	keyAnchor?: number,
	alphabet: string = ""
): string {
	return encodeBytecodeUnit(unit, {
		shuffleMap,
		encrypt,
		rollingCipher,
		integrityHash,
		cipherSalt,
		keyAnchor,
		stringKey,
		alphabet,
	});
}

// ---------------------------------------------------------------------------
// VM Shielding assembly
// ---------------------------------------------------------------------------

/**
 * Compile and assemble the output using VM Shielding: each root function
 * (and its children) gets a unique micro-interpreter with independent
 * opcode shuffle, names, and rolling cipher key.
 */
function assembleShielded(
	ast: t.File,
	targetPaths: NodePath<t.Function>[],
	opts: {
		encryptBytecode: boolean;
		debugProtection: boolean;
		debugLogging: boolean;
		decoyOpcodes: boolean;
		deadCodeInjection: boolean;
		stackEncoding: boolean;
		integrityBinding: boolean;
		mixedBooleanArithmetic: boolean;
		handlerFragmentation: boolean;
		blockPermutation: boolean;
		opcodeMutation: boolean;
		polymorphicDecoder: boolean;
		stringAtomization: boolean;
		scatteredKeys: boolean;
		wrapOutput: boolean;
	}
): string {
	// Generate per-group seeds (one per root function)
	const groupSeeds = targetPaths.map(() => generateCryptoSeed());
	const sharedSeed = generateCryptoSeed();

	// Generate names: shared + per-group via NameRegistry
	const {
		shared: sharedNames,
		sharedTemps,
		groups: groupNameSets,
		groupTemps: groupTempSets,
		alphabet: shieldedAlphabet,
	} = setupShieldedRegistry(sharedSeed, groupSeeds);

	// --- Phase 1: Compile all targets (no encoding) ---
	const groups: ShieldingGroup[] = [];
	const allCompiledUnits = new Map<string, { unit: BytecodeUnit }>();
	const groupMeta: {
		unit: BytecodeUnit;
		shuffleMap: number[];
		names: RuntimeNames;
		temps: TempNames;
		seed: number;
		unitIds: string[];
		usedOpcodes: Set<number>;
		cipherSalt: number;
		hasAsyncUnits: boolean;
	}[] = [];

	for (let gi = 0; gi < targetPaths.length; gi++) {
		const fnPath = targetPaths[gi]!;
		const groupSeed = groupSeeds[gi]!;
		const groupNames = groupNameSets[gi]!;
		const groupTemps = groupTempSets[gi]!;
		const groupShuffleMap = generateShuffleMap(groupSeed);

		let unit: BytecodeUnit;
		try {
			unit = compileFunction(fnPath);
		} catch (err) {
			const loc = fnPath.node.loc?.start;
			const locStr = loc ? ` at ${loc.line}:${loc.column}` : "";
			const fnName =
				("id" in fnPath.node && fnPath.node.id?.name) || "<anonymous>";
			const message = err instanceof Error ? err.message : String(err);
			console.warn(
				`[ruam] Failed to compile ${fnName}${locStr}: ${message}`
			);
			continue;
		}

		// Dead code injection
		if (opts.deadCodeInjection) {
			injectDeadCode(unit, groupSeed);
			for (const child of unit.childUnits) {
				injectDeadCode(child, groupSeed);
			}
		}

		// Block permutation: shuffle basic block order
		if (opts.blockPermutation) {
			permuteBlocks(unit, groupSeed);
		}

		// Opcode mutation: insert MUTATE instructions
		if (opts.opcodeMutation) {
			insertMutationOpcodes(unit, groupSeed);
		}

		// Collect unit IDs
		const unitIds = [unit.id, ...unit.childUnits.map((c) => c.id)];

		// Collect used opcodes
		const usedOpcodes = new Set<number>();
		for (const instr of unit.instructions) usedOpcodes.add(instr.opcode);
		for (const child of unit.childUnits) {
			for (const instr of child.instructions)
				usedOpcodes.add(instr.opcode);
		}

		// Detect async units in this group
		const groupHasAsync =
			unit.isAsync || unit.childUnits.some((c) => c.isAsync);

		// Per-group cipher salt
		const groupCipherSalt = generateCryptoSeed();

		// Store compiled units (no encoding yet)
		allCompiledUnits.set(unit.id, { unit });
		for (const child of unit.childUnits) {
			allCompiledUnits.set(child.id, { unit: child });
		}

		// Replace function body to use router
		replaceFunctionBody(
			fnPath,
			unit.id,
			{
				...sharedNames,
				vm: sharedNames.router,
			} as RuntimeNames,
			sharedTemps["_ps"]
		);

		groupMeta.push({
			unit,
			shuffleMap: groupShuffleMap,
			names: groupNames,
			temps: groupTemps,
			seed: groupSeed,
			unitIds,
			usedOpcodes,
			cipherSalt: groupCipherSalt,
			hasAsyncUnits: groupHasAsync,
		});
	}

	if (allCompiledUnits.size === 0)
		return generate(ast, { comments: false }).code;

	// --- Phase 2: Generate runtime (produces key anchors per group) ---
	// First, build groups with integrity hashes computed from interpreter
	// functions using the same options the runtime generator will use.
	for (const gm of groupMeta) {
		let groupIntegrityHash: number | undefined;
		let groupKeyAnchor: number | undefined;

		if (opts.integrityBinding) {
			const interpResult = buildInterpreterFunctions(
				gm.names,
				gm.temps,
				gm.shuffleMap,
				opts.debugLogging ?? false,
				true,
				gm.seed,
				{
					dynamicOpcodes: true,
					decoyOpcodes: opts.decoyOpcodes,
					stackEncoding: opts.stackEncoding,
					usedOpcodes: gm.usedOpcodes,
					mixedBooleanArithmetic: opts.mixedBooleanArithmetic,
					handlerFragmentation: opts.handlerFragmentation,
				},
				undefined,
				gm.hasAsyncUnits
			);
			const interpSource = interpResult.interpreters
				.map((n) => emit(n))
				.join("\n");
			groupIntegrityHash = fnv1a(interpSource);
			groupKeyAnchor = interpResult.keyAnchorValue;
		}

		groups.push({
			shuffleMap: gm.shuffleMap,
			names: gm.names,
			temps: gm.temps,
			seed: gm.seed,
			unitIds: gm.unitIds,
			usedOpcodes: gm.usedOpcodes,
			integrityHash: groupIntegrityHash,
			cipherSalt: gm.cipherSalt,
			hasAsyncUnits: gm.hasAsyncUnits,
		});
	}

	// Generate shielded runtime → also produces per-group key anchors
	const runtimeResult = generateShieldedVmRuntime({
		groups,
		sharedNames,
		sharedTemps,
		encrypt: opts.encryptBytecode,
		debugProtection: opts.debugProtection,
		debugLogging: opts.debugLogging,
		decoyOpcodes: opts.decoyOpcodes,
		stackEncoding: opts.stackEncoding,
		integrityBinding: opts.integrityBinding,
		mixedBooleanArithmetic: opts.mixedBooleanArithmetic,
		handlerFragmentation: opts.handlerFragmentation,
		polymorphicDecoder: opts.polymorphicDecoder,
		stringAtomization: opts.stringAtomization,
		scatteredKeys: opts.scatteredKeys,
		alphabet: shieldedAlphabet,
	});

	// --- Phase 3: Encode all units (using per-group key anchors) ---
	const allEncodedUnits = new Map<
		string,
		{ unit: BytecodeUnit; encoded: string }
	>();

	// Build identity map for mutation-encoded units if needed
	let shieldedIdentityMap: number[] | undefined;
	if (opts.opcodeMutation) {
		shieldedIdentityMap = new Array(OPCODE_COUNT);
		for (let i = 0; i < OPCODE_COUNT; i++) shieldedIdentityMap[i] = i;
	}

	for (let gi = 0; gi < groupMeta.length; gi++) {
		const gm = groupMeta[gi]!;
		const group = groups[gi]!;
		const groupKeyAnchor = runtimeResult.groupKeyAnchors[gi];

		const encodeGroupUnit = (u: BytecodeUnit) => {
			// When opcode mutation is active, pre-encode opcodes and use identity map
			if (opts.opcodeMutation) {
				adjustEncodingForMutations(u, gm.shuffleMap, OPCODE_COUNT);
			}
			return encodeUnit(
				u,
				opts.opcodeMutation ? shieldedIdentityMap! : gm.shuffleMap,
				opts.encryptBytecode,
				gm.seed,
				true, // rolling cipher always on in shielding mode
				group.integrityHash,
				gm.cipherSalt,
				groupKeyAnchor,
				shieldedAlphabet
			);
		};

		const rootEncoded = encodeGroupUnit(gm.unit);
		allEncodedUnits.set(gm.unit.id, {
			unit: gm.unit,
			encoded: rootEncoded,
		});
		for (const child of gm.unit.childUnits) {
			const childEncoded = encodeGroupUnit(child);
			allEncodedUnits.set(child.id, {
				unit: child,
				encoded: childEncoded,
			});
		}
	}

	// --- Phase 4: Assemble output ---
	return assembleOutputFromParts(
		ast,
		allEncodedUnits,
		sharedNames,
		sharedTemps,
		runtimeResult.source,
		opts.wrapOutput,
		sharedSeed
	);
}

// ---------------------------------------------------------------------------
// Output assembly
// ---------------------------------------------------------------------------

/**
 * Assemble the final obfuscated source from pre-encoded units,
 * pre-generated runtime, and the modified AST.
 */
function assembleOutputFromParts(
	ast: t.File,
	encodedUnits: Map<string, { unit: BytecodeUnit; encoded: string }>,
	names: RuntimeNames,
	temps: TempNames,
	runtimeSource: string,
	wrapOutput: boolean,
	seed: number = 0
): string {
	// Build bytecode table: empty init + individual assignment statements
	const btParts = buildBtParts(encodedUnits, names.bt);

	// Collect top-level bindings BEFORE adding runtime statements.
	const topLevelBindings = collectTopLevelBindings(ast.program.body);

	// Build the program scope object.
	const scopeCode = buildScopeSetupCode(temps["_ps"]!, topLevelBindings);
	const scopeNodes = parse(scopeCode, { sourceType: "script" }).program.body;

	const btInitNode = parse(btParts.init, { sourceType: "script" }).program
		.body[0]!;
	const btAssignNodes = btParts.assignments.map(
		(s) =>
			parse(s, { sourceType: "script" }).program.body[0]! as t.Statement
	);
	const runtimeNode = parse(runtimeSource, { sourceType: "script" }).program
		.body[0]!;
	const iifeCall = (runtimeNode as t.ExpressionStatement)
		.expression as t.CallExpression;
	const iifeFn = iifeCall.callee as t.FunctionExpression;

	// Scatter unit assignments among runtime statements using seeded positions
	const scatterStatements = (base: t.Statement[]): t.Statement[] => {
		if (btAssignNodes.length === 0) return base;

		// Insert assignments at evenly-distributed positions with seeded jitter
		const result = [...base];
		let s = seed >>> 0;
		for (let i = 0; i < btAssignNodes.length; i++) {
			s = (s * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
			// Insert in the second half of the runtime statements
			// (after variable declarations but before user code)
			const minPos = Math.max(1, Math.floor(result.length / 3));
			const maxPos = result.length;
			const pos = minPos + (s % Math.max(1, maxPos - minPos));
			result.splice(pos, 0, btAssignNodes[i]!);
		}
		return result;
	};

	if (wrapOutput) {
		const userStatements = [...ast.program.body];
		iifeFn.body.body.unshift(btInitNode as t.Statement);
		iifeFn.body.body = scatterStatements(iifeFn.body.body);
		iifeFn.body.body.push(
			...(scopeNodes as t.Statement[]),
			...userStatements
		);
		ast.program.body = [runtimeNode as t.Statement];
		ast.program.directives = [];
	} else {
		const runtimeStatements = iifeFn.body.body;
		const scattered = scatterStatements([
			btInitNode as t.Statement,
			...runtimeStatements,
		]);
		ast.program.body.unshift(
			...scattered,
			...(scopeNodes as t.Statement[])
		);
		ast.program.directives = [
			t.directive(t.directiveLiteral("use strict")),
		];
	}

	return generate(ast, { comments: false }).code;
}

// ---------------------------------------------------------------------------
// Function body replacement
// ---------------------------------------------------------------------------

/**
 * Replace a function's body with a VM dispatch call.
 *
 * - Arrow functions: converted to `(...__args) => names.vm(id, __args)`
 * - Regular functions: `return names.vm.call(this, id, Array.prototype.slice.call(arguments))`
 */
function replaceFunctionBody(
	fnPath: NodePath<t.Function>,
	unitId: string,
	names: RuntimeNames,
	scopeVarName?: string
): void {
	const node = fnPath.node;
	const vmId = t.identifier(names.vm);
	const argsId = t.identifier("__args");

	// Both arrows and regular functions use rest params for natural output.
	const restParam = t.restElement(argsId);
	node.params = [restParam];

	if (node.type === "ArrowFunctionExpression") {
		const arrowArgs: t.Expression[] = [t.stringLiteral(unitId), argsId];
		if (scopeVarName) {
			arrowArgs.push(t.identifier(scopeVarName));
		}
		node.body = t.blockStatement([
			t.returnStatement(t.callExpression(vmId, arrowArgs)),
		]);
		return;
	}

	// Regular functions: call vm(id, args, scope, this) directly.
	// The vm dispatcher handles this-boxing internally when TV is
	// provided, so no .call() or Array.prototype.slice needed.
	const vmArgs: t.Expression[] = [t.stringLiteral(unitId), argsId];
	if (scopeVarName) {
		vmArgs.push(t.identifier(scopeVarName));
	} else {
		vmArgs.push(t.nullLiteral());
	}
	// Pass `this` as the thisVal parameter
	vmArgs.push(t.thisExpression());

	const vmCall = t.callExpression(vmId, vmArgs);

	// Decoy body: add a filler statement before the dispatch so the
	// function doesn't look like a bare one-liner VM stub. The arg-length
	// assignment looks like natural argument processing.
	const decoy = t.variableDeclaration("var", [
		t.variableDeclarator(
			t.identifier("_n"),
			t.binaryExpression(
				"|",
				t.memberExpression(argsId, t.identifier("length")),
				t.numericLiteral(0)
			)
		),
	]);

	node.body = t.blockStatement([decoy, t.returnStatement(vmCall)]);
}
