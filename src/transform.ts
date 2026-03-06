/**
 * Main transformation orchestrator.
 *
 * {@link obfuscateCode} is the core function that:
 *   1. Optionally preprocesses identifiers
 *   2. Parses the source with Babel
 *   3. Identifies target functions (root-level or comment-annotated)
 *   4. Compiles each target to bytecode
 *   5. Generates the VM runtime
 *   6. Assembles the final output (runtime IIFE + bytecode table + modified AST)
 *
 * @module transform
 */

import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import _generate from "@babel/generator";
import * as t from "@babel/types";
import { compileFunction, resetUnitCounter } from "./compiler/index.js";
import { generateShuffleMap } from "./compiler/opcodes.js";
import { serializeUnitToJson, encodeBytecodeUnit } from "./compiler/encode.js";
import { generateVmRuntime } from "./runtime/vm.js";
import type { VmObfuscationOptions, BytecodeUnit } from "./types.js";
import { preprocessIdentifiers, resetHexCounter } from "./preprocess.js";
import { BABEL_PARSER_PLUGINS } from "./constants.js";

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
  const {
    targetMode = "root",
    threshold = 1.0,
    preprocessIdentifiers: preprocess = false,
    encryptBytecode = false,
    debugProtection = false,
    debugLogging = false,
  } = options;

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

  // -- Parse ---------------------------------------------------------------
  const ast = parse(code, {
    sourceType: "unambiguous",
    plugins: [...BABEL_PARSER_PLUGINS],
  });

  // -- Collect target functions --------------------------------------------
  const targetPaths = collectTargetFunctions(ast, targetMode, threshold);

  // -- Compile each target -------------------------------------------------
  const compiledUnits = compileTargets(targetPaths, shuffleMap, encryptBytecode);

  if (compiledUnits.size === 0) return code;

  // -- Assemble output -----------------------------------------------------
  return assembleOutput(ast, compiledUnits, shuffleMap, {
    encrypt: encryptBytecode,
    debugProtection,
    debugLogging,
  });
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
): Map<string, { unit: BytecodeUnit; encoded: string }> {
  const compiledUnits: Map<string, { unit: BytecodeUnit; encoded: string }> = new Map();

  for (const fnPath of targetPaths) {
    try {
      const unit = compileFunction(fnPath);
      const encoded = encodeUnit(unit, shuffleMap, encryptBytecode);
      compiledUnits.set(unit.id, { unit, encoded });

      for (const child of unit.childUnits) {
        const childEncoded = encodeUnit(child, shuffleMap, encryptBytecode);
        compiledUnits.set(child.id, { unit: child, encoded: childEncoded });
      }

      replaceFunctionBody(fnPath, unit.id);
    } catch (err) {
      // Skip functions that fail to compile — don't break the whole file
      console.warn(`[ruam] Failed to compile function: ${(err as Error).message}`);
    }
  }

  return compiledUnits;
}

/** Encode a single bytecode unit in the configured format. */
function encodeUnit(unit: BytecodeUnit, shuffleMap: number[], encrypt: boolean): string {
  return encrypt
    ? encodeBytecodeUnit(unit, { shuffleMap, encrypt: true })
    : serializeUnitToJson(unit, shuffleMap);
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
  runtimeOptions: { encrypt: boolean; debugProtection: boolean; debugLogging: boolean },
): string {
  // Build bytecode table declaration
  const btEntries: string[] = [];
  for (const [id, { encoded }] of compiledUnits) {
    const value = runtimeOptions.encrypt ? `"${encoded}"` : encoded;
    btEntries.push(`"${id}":${value}`);
  }
  const btDecl = `var _BT={${btEntries.join(",")}};`;

  // Generate runtime IIFE
  const runtime = generateVmRuntime({
    opcodeShuffleMap: shuffleMap,
    encrypt: runtimeOptions.encrypt,
    debugProtection: runtimeOptions.debugProtection,
    debugLogging: runtimeOptions.debugLogging,
  });

  // Parse and inject _BT inside the runtime IIFE so each file gets its own
  // local _BT.  Without this, multiple obfuscated scripts on the same page
  // overwrite each other's global _BT.
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
 * - Arrow functions: converted to `(...__args) => _vm(id, __args)`
 * - Regular functions: `return _vm.call(this, id, Array.prototype.slice.call(arguments))`
 */
function replaceFunctionBody(fnPath: NodePath<t.Function>, unitId: string): void {
  const node = fnPath.node;

  if (node.type === "ArrowFunctionExpression") {
    const restParam = t.restElement(t.identifier("__args"));
    node.params = [restParam];
    node.body = t.blockStatement([
      t.returnStatement(
        t.callExpression(t.identifier("_vm"), [
          t.stringLiteral(unitId),
          t.identifier("__args"),
        ]),
      ),
    ]);
    return;
  }

  // Regular functions: preserve `this` via _vm.call
  const vmCall = t.callExpression(
    t.memberExpression(t.identifier("_vm"), t.identifier("call")),
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
