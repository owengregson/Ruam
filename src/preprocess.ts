/**
 * Identifier preprocessing — renames all local bindings to `_0x` hex names.
 *
 * This is an optional pre-compilation pass that makes the source look
 * uniformly obfuscated before bytecode compilation.  Global / well-known
 * identifiers are preserved.
 *
 * @module preprocess
 */

import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
import { BABEL_PARSER_PLUGINS, GLOBAL_IDENTIFIERS } from "./constants.js";

const traverse = (_traverse as unknown as { default: typeof _traverse }).default ?? _traverse;
const generate = (_generate as unknown as { default: typeof _generate }).default ?? _generate;

// ---------------------------------------------------------------------------
// Hex counter
// ---------------------------------------------------------------------------

let hexCounter = 0;

function nextHexName(): string {
  return "_0x" + (hexCounter++).toString(16).padStart(4, "0");
}

/** Reset the hex counter (call before each file). */
export function resetHexCounter(): void {
  hexCounter = 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rename all local bindings to sequential `_0x0000` hex names.
 *
 * Globals and already-hex-named identifiers are skipped.
 */
export function preprocessIdentifiers(source: string): string {
  const ast = parse(source, {
    sourceType: "unambiguous",
    plugins: [...BABEL_PARSER_PLUGINS],
  });

  const renameMap = new Map<string, string>();

  traverse(ast, {
    Scope(path) {
      for (const [name, binding] of Object.entries(path.scope.bindings)) {
        if (GLOBAL_IDENTIFIERS.has(name as any)) continue;
        if (renameMap.has(name)) continue;
        if (name.startsWith("_0x")) continue;

        const newName = nextHexName();
        renameMap.set(name, newName);
        binding.identifier.name = newName;

        for (const ref of binding.referencePaths) {
          if (ref.isIdentifier()) {
            ref.node.name = newName;
          }
        }

        for (const ref of binding.constantViolations) {
          const left = ref.get("left");
          if (left && "isIdentifier" in left && (left as any).isIdentifier() && (left as any).node.name === name) {
            (left as any).node.name = newName;
          }
        }
      }
    },
  });

  return generate(ast).code;
}
