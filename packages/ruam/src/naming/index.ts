/**
 * @module naming
 * Unified naming system — NameRegistry + NameScope + NameToken.
 */

export { NameToken, RestParam, type Name } from "./token.js";
export { NameScope, type LengthTier, deriveSeed } from "./scope.js";
export { NameRegistry } from "./registry.js";
export { RESERVED_WORDS, EXCLUDED_NAMES } from "./reserved.js";
