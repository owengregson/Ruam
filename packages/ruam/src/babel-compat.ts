/**
 * Babel ESM/CJS compatibility layer. Normalizes `{ default: fn }` vs
 * direct-function export shapes into consistent references.
 * @module babel-compat
 */

import _traverse from "@babel/traverse";
import _generate from "@babel/generator";

/** Normalized `@babel/traverse` default export. */
export const traverse =
	(_traverse as unknown as { default: typeof _traverse }).default ??
	_traverse;

/** Normalized `@babel/generator` default export. */
export const generate =
	(_generate as unknown as { default: typeof _generate }).default ??
	_generate;
