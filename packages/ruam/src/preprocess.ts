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
import { BABEL_PARSER_PLUGINS, GLOBAL_IDENTIFIERS } from "./constants.js";
import { traverse, generate } from "./babel-compat.js";

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
        if ((GLOBAL_IDENTIFIERS as ReadonlySet<string>).has(name)) continue;
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
          if (!Array.isArray(left) && left.isIdentifier() && left.node.name === name) {
            left.node.name = newName;
          }
        }
      }
    },
  });

  return generate(ast).code;
}
