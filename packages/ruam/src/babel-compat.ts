/**
 * Babel ESM/CJS compatibility layer.
 *
 * Babel packages export differently depending on bundler context.
 * Some resolve as `{ default: fn }` (CJS-in-ESM) while others
 * resolve as the function directly. This module normalizes both
 * shapes into the expected function references.
 *
 * @module babel-compat
 */

import _traverse from "@babel/traverse";
import _generate from "@babel/generator";

export const traverse = (_traverse as unknown as { default: typeof _traverse }).default ?? _traverse;
export const generate = (_generate as unknown as { default: typeof _generate }).default ?? _generate;
