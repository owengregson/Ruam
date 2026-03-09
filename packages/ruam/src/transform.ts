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
import _traverse from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import _generate from "@babel/generator";
import * as t from "@babel/types";
import { compileFunction, resetUnitCounter } from "./compiler/index.js";
import { generateShuffleMap, OPCODE_COUNT } from "./compiler/opcodes.js";
import { serializeUnitToJson, encodeBytecodeUnit } from "./compiler/encode.js";
import type { JsonSerializeOptions } from "./compiler/encode.js";
import { generateVmRuntime } from "./runtime/vm.js";
import { generateRuntimeNames } from "./runtime/names.js";
import type { RuntimeNames } from "./runtime/names.js";
import { resolveOptions } from "./presets.js";
import type { VmObfuscationOptions, BytecodeUnit } from "./types.js";
import { preprocessIdentifiers, resetHexCounter } from "./preprocess.js";
import { BABEL_PARSER_PLUGINS } from "./constants.js";
import { generateInterpreterCore } from "./runtime/templates/interpreter.js";

// Work around ESM / CJS dual-export weirdness in Babel packages
const traverse = (_traverse as unknown as { default: typeof _traverse }).default ?? _traverse;
const generate = (_generate as unknown as { default: typeof _generate }).default ?? _generate;

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
export function obfuscateCode(source: string, options: VmObfuscationOptions = {}): string {
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
  } = resolved;

  // -- Optional identifier preprocessing -----------------------------------
  let code = source;
  if (preprocess) {
    resetHexCounter();
    code = preprocessIdentifiers(code);
  }

  resetUnitCounter();

  // -- Generate per-file opcode shuffle ------------------------------------
  const shuffleSeed = Date.now() ^ Math.floor(Math.random() * 0xFFFFFFFF);
  const shuffleMap = generateShuffleMap(shuffleSeed);

  // -- Generate randomized runtime identifiers -----------------------------
  const names = generateRuntimeNames(shuffleSeed);

  // -- Parse ---------------------------------------------------------------
  const ast = parse(code, {
    sourceType: "unambiguous",
    plugins: [...BABEL_PARSER_PLUGINS],
  });

  // -- Collect target functions --------------------------------------------
  const targetPaths = collectTargetFunctions(ast, targetMode, threshold);

  // -- Compute integrity hash if needed ------------------------------------
  // Integrity binding hashes the interpreter template source and embeds
  // the hash in the IIFE.  The same hash is used as part of the rolling
  // cipher key derivation.  Modifying the interpreter changes the hash
  // at the source level, but since we embed a precomputed value, the
  // attacker must locate and preserve it — the value is woven into the
  // key derivation so removing or changing it breaks all decryption.
  let integrityHash: number | undefined;
  if (integrityBinding) {
    const interpSource = generateInterpreterCore(debugLogging, names, shuffleSeed, shuffleMap, true, true);
    integrityHash = fnv1a(interpSource);
  }

  // -- Compile each target -------------------------------------------------
  const compiledUnits = compileTargets(targetPaths, shuffleMap, encryptBytecode, names, shuffleSeed, rollingCipher, integrityHash);

  if (compiledUnits.size === 0) return code;

  // -- Collect used opcodes (for dynamicOpcodes / decoyOpcodes) -----------
  let usedOpcodes: Set<number> | undefined;
  if (dynamicOpcodes || decoyOpcodes) {
    usedOpcodes = collectUsedOpcodes(compiledUnits);
  }

  // -- Assemble output -----------------------------------------------------
  return assembleOutput(ast, compiledUnits, shuffleMap, names, {
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
  let h = 0x811C9DC5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
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
  threshold: number,
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
  threshold: number,
): boolean {
  if (mode === "comment") {
    const leadingComments = path.node.leadingComments;
    if (!leadingComments) return false;
    return leadingComments.some(c => c.value.trim() === "ruam:vm");
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
): Map<string, { unit: BytecodeUnit; encoded: string }> {
  const compiledUnits: Map<string, { unit: BytecodeUnit; encoded: string }> = new Map();

  for (const fnPath of targetPaths) {
    try {
      const unit = compileFunction(fnPath);
      const encoded = encodeUnit(unit, shuffleMap, encryptBytecode, stringKey, rollingCipher, integrityHash);
      compiledUnits.set(unit.id, { unit, encoded });

      for (const child of unit.childUnits) {
        const childEncoded = encodeUnit(child, shuffleMap, encryptBytecode, stringKey, rollingCipher, integrityHash);
        compiledUnits.set(child.id, { unit: child, encoded: childEncoded });
      }

      replaceFunctionBody(fnPath, unit.id, names);
    } catch (err) {
      // Skip functions that fail to compile — don't break the whole file
      console.warn(`[ruam] Failed to compile function: ${(err as Error).message}`);
    }
  }

  return compiledUnits;
}

/**
 * Collect all logical opcodes used across all compiled bytecode units.
 */
function collectUsedOpcodes(
  compiledUnits: Map<string, { unit: BytecodeUnit; encoded: string }>,
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
  integrityHash?: number,
): string {
  if (encrypt) {
    return encodeBytecodeUnit(unit, { shuffleMap, encrypt: true });
  }
  return serializeUnitToJson(unit, {
    shuffleMap,
    stringKey,
    rollingCipher,
    integrityHash,
  });
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
  },
): string {
  // Build bytecode table declaration (using randomized name)
  const btEntries: string[] = [];
  for (const [id, { encoded }] of compiledUnits) {
    const value = runtimeOptions.encrypt ? `"${encoded}"` : encoded;
    btEntries.push(`"${id}":${value}`);
  }
  const btDecl = `var ${names.bt}={${btEntries.join(",")}};`;

  // Generate runtime IIFE
  const runtime = generateVmRuntime({
    opcodeShuffleMap: shuffleMap,
    names,
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
  const runtimeNode = parse(runtime, { sourceType: "script" }).program.body[0]!;
  const iifeCall = (runtimeNode as t.ExpressionStatement).expression as t.CallExpression;
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
function replaceFunctionBody(fnPath: NodePath<t.Function>, unitId: string, names: RuntimeNames): void {
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
        ]),
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
            t.memberExpression(t.identifier("Array"), t.identifier("prototype")),
            t.identifier("slice"),
          ),
          t.identifier("call"),
        ),
        [t.identifier("arguments")],
      ),
    ],
  );

  node.body = t.blockStatement([t.returnStatement(vmCall)]);
  node.params = (node as t.FunctionDeclaration).params ?? [];
}
