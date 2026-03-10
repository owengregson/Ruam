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
 * Uses Babel's `scope.rename()` to correctly handle all edge cases
 * including duplicate `var` declarations and cross-scope name collisions.
 *
 * @param source - JavaScript source code to preprocess.
 * @returns The source with local bindings renamed.
 */
export function preprocessIdentifiers(source: string): string {
  const ast = parse(source, {
    sourceType: "unambiguous",
    plugins: [...BABEL_PARSER_PLUGINS],
  });

  // Collect all (scope, bindingName) pairs first, then rename.
  // This avoids iterator invalidation from renaming during traversal.
  const toRename: { scope: any; name: string }[] = [];

  traverse(ast, {
    Scope(path) {
      for (const name of Object.keys(path.scope.bindings)) {
        if ((GLOBAL_IDENTIFIERS as ReadonlySet<string>).has(name)) continue;
        if (name.startsWith("_0x")) continue;
        toRename.push({ scope: path.scope, name });
      }
    },
  });

  // Use a Set to track which (scope, name) pairs we've already renamed
  // (scope.rename handles the actual AST mutation correctly)
  const renamed = new Set<object>();

  for (const { scope, name } of toRename) {
    const binding = scope.bindings[name];
    if (!binding) continue; // may have been removed by a prior rename
    if (renamed.has(binding)) continue;
    renamed.add(binding);

    const newName = nextHexName();
    scope.rename(name, newName);
  }

  return generate(ast).code;
}
