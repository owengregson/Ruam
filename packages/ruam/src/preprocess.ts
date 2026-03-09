/**
 * Optional pre-compilation pass that renames local bindings to `_0x` hex names.
 * @module preprocess
 */

import { parse } from "@babel/parser";
import { BABEL_PARSER_PLUGINS, GLOBAL_IDENTIFIERS } from "./constants.js";
import { traverse, generate } from "./babel-compat.js";

// --- Hex Counter ---

let hexCounter = 0;

/**
 * Generate the next sequential hex identifier (e.g. `_0x0000`, `_0x0001`).
 * @returns A unique `_0x`-prefixed identifier string.
 */
function nextHexName(): string {
  return "_0x" + (hexCounter++).toString(16).padStart(4, "0");
}

/**
 * Reset the hex counter. Must be called before processing each file
 * to ensure deterministic output.
 */
export function resetHexCounter(): void {
  hexCounter = 0;
}

// --- Public API ---

/**
 * Rename all local bindings to sequential `_0x0000` hex names.
 * Global identifiers and already-hex-named identifiers are skipped.
 *
 * @param source - JavaScript source code to preprocess.
 * @returns The source with local bindings renamed.
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
