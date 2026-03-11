/**
 * Opcode handler registry barrel module.
 *
 * Re-exports the registry, types, and builder from registry.ts,
 * and triggers side-effect imports to populate the registry.
 *
 * @module ruamvm/handlers
 */

// Re-export types and registry from the dependency-free registry module
export { registry, makeHandlerCtx } from "./registry.js";
export type { HandlerCtx, HandlerFn } from "./registry.js";

// Side-effect imports — each file registers its handlers in the registry on import.
// These must come after the re-export so that the registry is initialized
// (handler files import from ./registry.js, not ./index.js).
import "./stack.js";
import "./arithmetic.js";
import "./comparison.js";
import "./logical.js";
import "./control-flow.js";
import "./registers.js";
import "./type-ops.js";
import "./special.js";
import "./destructuring.js";
import "./scope.js";
import "./compound-scoped.js";
import "./objects.js";
import "./calls.js";
import "./classes.js";
import "./exceptions.js";
import "./iterators.js";
import "./generators.js";
import "./functions.js";
import "./superinstructions.js";
