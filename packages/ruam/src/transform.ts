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
import { serializeUnitToJson, encodeBytecodeUnit } from "./compiler/encode.js";
import type { JsonSerializeOptions } from "./compiler/encode.js";
import {
	generateVmRuntime,
	generateShieldedVmRuntime,
} from "./ruamvm/assembler.js";
import type { ShieldingGroup } from "./ruamvm/assembler.js";
import {
	generateRuntimeNames,
	generateShieldedNames,
} from "./encoding/names.js";
import type { RuntimeNames, TempNames } from "./encoding/names.js";
import { resolveOptions } from "./presets.js";
import type { VmObfuscationOptions, BytecodeUnit } from "./types.js";
import { preprocessIdentifiers, resetHexCounter } from "./preprocess.js";
import {
	BABEL_PARSER_PLUGINS,
	FNV_OFFSET_BASIS,
	FNV_PRIME,
} from "./constants.js";
import { buildInterpreterFunctions } from "./ruamvm/builders/interpreter.js";
import { emit } from "./ruamvm/emit.js";

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
	} = resolved;

	// -- Optional identifier preprocessing -----------------------------------
	let code = source;
	if (preprocess) {
		resetHexCounter();
		code = preprocessIdentifiers(code);
	}

	resetUnitCounter();

	// -- Generate per-file opcode shuffle ------------------------------------
	const shuffleSeed = generateCryptoSeed();
	const shuffleMap = generateShuffleMap(shuffleSeed);

	// -- Generate randomized runtime identifiers -----------------------------
	const { runtime: names, temps } = generateRuntimeNames(shuffleSeed);

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
		});
	}

	// -- Compute integrity hash if needed ------------------------------------
	// Integrity binding hashes the interpreter template source and embeds
	// the hash in the IIFE.  The same hash is used as part of the rolling
	// cipher key derivation.  Modifying the interpreter changes the hash
	// at the source level, but since we embed a precomputed value, the
	// attacker must locate and preserve it — the value is woven into the
	// key derivation so removing or changing it breaks all decryption.
	let integrityHash: number | undefined;
	if (integrityBinding) {
		const interpNodes = buildInterpreterFunctions(
			names,
			temps,
			shuffleMap,
			debugLogging,
			true,
			shuffleSeed
		);
		const interpSource = interpNodes.map((n) => emit(n)).join("\n");
		integrityHash = fnv1a(interpSource);
	}

	// -- Compile each target -------------------------------------------------
	const compiledUnits = compileTargets(
		targetPaths,
		shuffleMap,
		encryptBytecode,
		names,
		shuffleSeed,
		rollingCipher,
		integrityHash,
		deadCodeInjection
	);

	if (compiledUnits.size === 0) return code;

	// -- Collect used opcodes (for dynamicOpcodes / decoyOpcodes) -----------
	let usedOpcodes: Set<number> | undefined;
	if (dynamicOpcodes || decoyOpcodes) {
		usedOpcodes = collectUsedOpcodes(compiledUnits);
	}

	// -- Assemble output -----------------------------------------------------
	return assembleOutput(ast, compiledUnits, shuffleMap, names, temps, {
		encrypt: encryptBytecode,
		debugProtection,
		debugLogging,
		dynamicOpcodes,
		decoyOpcodes,
		deadCodeInjection,
		stackEncoding,
		seed: shuffleSeed,
		stringKey: encryptBytecode ? undefined : shuffleSeed,
		rollingCipher,
		integrityBinding,
		integrityHash,
		usedOpcodes,
	});
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
 * Compile a list of target function paths into bytecode units.
 */
function compileTargets(
	targetPaths: NodePath<t.Function>[],
	shuffleMap: number[],
	encryptBytecode: boolean,
	names: RuntimeNames,
	stringKey: number,
	rollingCipher: boolean = false,
	integrityHash?: number,
	deadCodeInjection: boolean = false
): Map<string, { unit: BytecodeUnit; encoded: string }> {
	const compiledUnits: Map<string, { unit: BytecodeUnit; encoded: string }> =
		new Map();

	for (const fnPath of targetPaths) {
		try {
			const unit = compileFunction(fnPath);

			if (deadCodeInjection) {
				injectDeadCode(unit, stringKey);
				for (const child of unit.childUnits) {
					injectDeadCode(child, stringKey);
				}
			}

			const encoded = encodeUnit(
				unit,
				shuffleMap,
				encryptBytecode,
				stringKey,
				rollingCipher,
				integrityHash
			);
			compiledUnits.set(unit.id, { unit, encoded });

			for (const child of unit.childUnits) {
				const childEncoded = encodeUnit(
					child,
					shuffleMap,
					encryptBytecode,
					stringKey,
					rollingCipher,
					integrityHash
				);
				compiledUnits.set(child.id, {
					unit: child,
					encoded: childEncoded,
				});
			}

			replaceFunctionBody(fnPath, unit.id, names);
		} catch (err) {
			// Skip functions that fail to compile — don't break the whole file.
			// Extract source location from the Babel path for debugging.
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

/** Build a `var <name>={...}` declaration for the bytecode table. */
function buildBtDecl(
	units: Map<string, { encoded: string }>,
	btName: string,
	encrypt: boolean
): string {
	const entries: string[] = [];
	for (const [id, { encoded }] of units) {
		const value = encrypt ? `"${encoded}"` : encoded;
		entries.push(`"${id}":${value}`);
	}
	return `var ${btName}={${entries.join(",")}};`;
}

/**
 * Collect all logical opcodes used across all compiled bytecode units.
 */
function collectUsedOpcodes(
	compiledUnits: Map<string, { unit: BytecodeUnit; encoded: string }>
): Set<number> {
	const used = new Set<number>();
	for (const [, { unit }] of compiledUnits) {
		for (const instr of unit.instructions) {
			used.add(instr.opcode);
		}
	}
	return used;
}

/** Encode a single bytecode unit in the configured format. */
function encodeUnit(
	unit: BytecodeUnit,
	shuffleMap: number[],
	encrypt: boolean,
	stringKey: number,
	rollingCipher: boolean = false,
	integrityHash?: number
): string {
	if (encrypt) {
		return encodeBytecodeUnit(unit, {
			shuffleMap,
			encrypt: true,
			rollingCipher,
			integrityHash,
		});
	}
	return serializeUnitToJson(unit, {
		shuffleMap,
		stringKey,
		rollingCipher,
		integrityHash,
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
	}
): string {
	// Generate per-group seeds (one per root function)
	const groupSeeds = targetPaths.map(() => generateCryptoSeed());
	const sharedSeed = generateCryptoSeed();

	// Generate names: shared + per-group
	const {
		shared: sharedNames,
		sharedTemps,
		groups: groupNameSets,
		groupTemps: groupTempSets,
	} = generateShieldedNames(sharedSeed, groupSeeds);

	// Compile each target function into a shielding group
	const groups: ShieldingGroup[] = [];
	const allCompiledUnits = new Map<
		string,
		{ unit: BytecodeUnit; encoded: string }
	>();

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

		// Compute per-group integrity hash
		let groupIntegrityHash: number | undefined;
		if (opts.integrityBinding) {
			const interpNodes = buildInterpreterFunctions(
				groupNames,
				groupTemps,
				groupShuffleMap,
				opts.debugLogging ?? false,
				true,
				groupSeed
			);
			const interpSource = interpNodes.map((n) => emit(n)).join("\n");
			groupIntegrityHash = fnv1a(interpSource);
		}

		// Collect unit IDs for this group
		const unitIds = [unit.id, ...unit.childUnits.map((c) => c.id)];

		// Collect used opcodes for this group
		const usedOpcodes = new Set<number>();
		for (const instr of unit.instructions) usedOpcodes.add(instr.opcode);
		for (const child of unit.childUnits) {
			for (const instr of child.instructions)
				usedOpcodes.add(instr.opcode);
		}

		// Encode units with this group's shuffle map
		// Rolling cipher is always on for vmShielding
		const encodeGroupUnit = (u: BytecodeUnit) =>
			encodeUnit(
				u,
				groupShuffleMap,
				opts.encryptBytecode,
				groupSeed,
				true,
				groupIntegrityHash
			);

		const rootEncoded = encodeGroupUnit(unit);
		allCompiledUnits.set(unit.id, { unit, encoded: rootEncoded });
		for (const child of unit.childUnits) {
			const childEncoded = encodeGroupUnit(child);
			allCompiledUnits.set(child.id, {
				unit: child,
				encoded: childEncoded,
			});
		}

		// Replace function body to use router (uses sharedNames.router as the dispatch name)
		replaceFunctionBody(fnPath, unit.id, {
			...sharedNames,
			vm: sharedNames.router,
		} as RuntimeNames);

		groups.push({
			shuffleMap: groupShuffleMap,
			names: groupNames,
			temps: groupTemps,
			seed: groupSeed,
			unitIds,
			usedOpcodes,
			integrityHash: groupIntegrityHash,
		});
	}

	if (allCompiledUnits.size === 0)
		return generate(ast, { comments: false }).code;

	// Build bytecode table
	const btDecl = buildBtDecl(
		allCompiledUnits,
		sharedNames.bt,
		!!opts.encryptBytecode
	);

	// Generate shielded runtime
	const runtime = generateShieldedVmRuntime({
		groups,
		sharedNames,
		sharedTemps,
		encrypt: opts.encryptBytecode,
		debugProtection: opts.debugProtection,
		debugLogging: opts.debugLogging,
		decoyOpcodes: opts.decoyOpcodes,
		stackEncoding: opts.stackEncoding,
		integrityBinding: opts.integrityBinding,
	});

	// Inject bytecode table inside the IIFE
	const btNode = parse(btDecl, { sourceType: "script" }).program.body[0]!;
	const runtimeNode = parse(runtime, { sourceType: "script" }).program
		.body[0]!;
	const iifeCall = (runtimeNode as t.ExpressionStatement)
		.expression as t.CallExpression;
	const iifeFn = iifeCall.callee as t.FunctionExpression;
	iifeFn.body.body.unshift(btNode as t.Statement);

	ast.program.body.unshift(runtimeNode);

	return generate(ast, { comments: false }).code;
}

// ---------------------------------------------------------------------------
// Output assembly
// ---------------------------------------------------------------------------

/**
 * Assemble the final obfuscated source from the modified AST, bytecode
 * table, and VM runtime.
 */
function assembleOutput(
	ast: t.File,
	compiledUnits: Map<string, { unit: BytecodeUnit; encoded: string }>,
	shuffleMap: number[],
	names: RuntimeNames,
	temps: TempNames,
	runtimeOptions: {
		encrypt: boolean;
		debugProtection: boolean;
		debugLogging: boolean;
		dynamicOpcodes?: boolean;
		decoyOpcodes?: boolean;
		deadCodeInjection?: boolean;
		stackEncoding?: boolean;
		seed: number;
		stringKey?: number;
		rollingCipher?: boolean;
		integrityBinding?: boolean;
		integrityHash?: number;
		usedOpcodes?: Set<number>;
	}
): string {
	// Build bytecode table declaration (using randomized name)
	const btDecl = buildBtDecl(compiledUnits, names.bt, runtimeOptions.encrypt);

	// Generate runtime IIFE
	const runtime = generateVmRuntime({
		opcodeShuffleMap: shuffleMap,
		names,
		temps,
		encrypt: runtimeOptions.encrypt,
		debugProtection: runtimeOptions.debugProtection,
		debugLogging: runtimeOptions.debugLogging,
		dynamicOpcodes: runtimeOptions.dynamicOpcodes,
		decoyOpcodes: runtimeOptions.decoyOpcodes,
		stackEncoding: runtimeOptions.stackEncoding,
		seed: runtimeOptions.seed,
		stringKey: runtimeOptions.stringKey,
		rollingCipher: runtimeOptions.rollingCipher,
		integrityBinding: runtimeOptions.integrityBinding,
		integrityHash: runtimeOptions.integrityHash,
		usedOpcodes: runtimeOptions.usedOpcodes,
	});

	// Parse and inject bytecode table inside the runtime IIFE so each file
	// gets its own local table.
	const btNode = parse(btDecl, { sourceType: "script" }).program.body[0]!;
	const runtimeNode = parse(runtime, { sourceType: "script" }).program
		.body[0]!;
	const iifeCall = (runtimeNode as t.ExpressionStatement)
		.expression as t.CallExpression;
	const iifeFn = iifeCall.callee as t.FunctionExpression;
	iifeFn.body.body.unshift(btNode as t.Statement);

	ast.program.body.unshift(runtimeNode);

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
	names: RuntimeNames
): void {
	const node = fnPath.node;
	const vmId = t.identifier(names.vm);

	if (node.type === "ArrowFunctionExpression") {
		const restParam = t.restElement(t.identifier("__args"));
		node.params = [restParam];
		node.body = t.blockStatement([
			t.returnStatement(
				t.callExpression(vmId, [
					t.stringLiteral(unitId),
					t.identifier("__args"),
				])
			),
		]);
		return;
	}

	// Regular functions: preserve `this` via vm.call
	const vmCall = t.callExpression(
		t.memberExpression(vmId, t.identifier("call")),
		[
			t.thisExpression(),
			t.stringLiteral(unitId),
			t.callExpression(
				t.memberExpression(
					t.memberExpression(
						t.memberExpression(
							t.identifier("Array"),
							t.identifier("prototype")
						),
						t.identifier("slice")
					),
					t.identifier("call")
				),
				[t.identifier("arguments")]
			),
		]
	);

	node.body = t.blockStatement([t.returnStatement(vmCall)]);
	node.params = (node as t.FunctionDeclaration).params ?? [];
}
