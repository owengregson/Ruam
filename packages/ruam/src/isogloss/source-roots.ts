/**
 * Fail-closed discovery and canonical compilation of protected source roots.
 *
 * Unlike return-site discovery, this module treats the complete selected
 * function as the protection unit. A selected root either produces canonical
 * semantic IR or the build fails; there is no native compatibility result.
 *
 * @module isogloss/source-roots
 */

import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { traverse } from "../babel-compat.js";
import {
	compileSemanticFunction,
	resetUnitCounter,
} from "../compiler/index.js";
import type { SemanticRootGroup, SourceOrigin } from "../compiler/ir.js";
import type { SourceTargetMode } from "./source-sites.js";

export interface ProtectedSourceRoot {
	readonly id: string;
	readonly name: string | null;
	readonly ordinal: number;
	readonly origin: SourceOrigin;
	readonly path: NodePath<t.Function>;
	readonly group: SemanticRootGroup;
}

export interface CompileProtectedSourceRootsOptions {
	readonly targetMode: SourceTargetMode;
	readonly threshold: number;
	readonly seed: number;
}

export class IsoglossSemanticCompileError extends Error {
	readonly name = "IsoglossSemanticCompileError";

	constructor(
		readonly code:
			| "RUAM_ISOGLOSS_INVALID_SELECTION"
			| "RUAM_ISOGLOSS_SELECTED_ROOT_UNSUPPORTED",
		readonly rootId: string | null,
		readonly origin: SourceOrigin | null,
		detail: string
	) {
		super(`${code}: ${detail}`);
	}
}

/**
 * Compile every selected root to canonical semantic IR.
 *
 * The returned paths are build-only handles used by the emitted runtime
 * integrator. They must never be serialized into a client artifact.
 */
export function compileProtectedSourceRoots(
	ast: t.File,
	options: CompileProtectedSourceRootsOptions
): readonly ProtectedSourceRoot[] {
	validateOptions(options);
	const candidates: NodePath<t.Function>[] = [];
	traverse(ast, {
		Function(path) {
			if (shouldTarget(path, options.targetMode)) candidates.push(path);
		},
	});
	candidates.sort(compareFunctionPaths);
	resetUnitCounter(options.seed);

	const roots: ProtectedSourceRoot[] = [];
	for (let ordinal = 0; ordinal < candidates.length; ordinal++) {
		const path = candidates[ordinal]!;
		const origin = sourceOrigin(path.node);
		const name = inferFunctionName(path);
		const selectionName = name ?? `${path.node.type}@${origin.start}:${origin.end}`;
		if (
			options.threshold < 1 &&
			selectionUnitInterval(options.seed, selectionName, ordinal) >=
				options.threshold
		) {
			continue;
		}
		const id = rootId(options.seed, ordinal, origin);
		try {
			const group = compileSemanticFunction(path, id);
			roots.push(
				Object.freeze({ id, name, ordinal, origin, path, group })
			);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			throw new IsoglossSemanticCompileError(
				"RUAM_ISOGLOSS_SELECTED_ROOT_UNSUPPORTED",
				id,
				origin,
				`${name ?? "<anonymous>"}: ${detail}`
			);
		}
	}
	return Object.freeze(roots);
}

function shouldTarget(
	path: NodePath<t.Function>,
	mode: SourceTargetMode
): boolean {
	if (mode === "comment") return hasIsoglossMarker(path);
	let current: NodePath | null = path.parentPath;
	while (current) {
		if (current.isFunction()) return false;
		current = current.parentPath;
	}
	return true;
}

function hasIsoglossMarker(path: NodePath<t.Function>): boolean {
	return [
		...(path.node.leadingComments ?? []),
		...(path.parentPath?.node.leadingComments ?? []),
	].some((comment) => comment.value.trim() === "ruam:isogloss");
}

function inferFunctionName(path: NodePath<t.Function>): string | null {
	const node = path.node;
	if ("id" in node && t.isIdentifier(node.id)) return node.id.name;
	if (
		(t.isObjectMethod(node) || t.isClassMethod(node)) &&
		!node.computed &&
		t.isIdentifier(node.key)
	) {
		return node.key.name;
	}
	if (t.isClassPrivateMethod(node) && t.isPrivateName(node.key)) {
		return `#${node.key.id.name}`;
	}
	if (
		(t.isObjectMethod(node) || t.isClassMethod(node)) &&
		(t.isStringLiteral(node.key) || t.isNumericLiteral(node.key))
	) {
		return String(node.key.value);
	}
	const parent = path.parentPath?.node;
	if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
		return parent.id.name;
	}
	if (
		(t.isObjectProperty(parent) || t.isClassProperty(parent)) &&
		!parent.computed &&
		t.isIdentifier(parent.key)
	) {
		return parent.key.name;
	}
	if (t.isAssignmentExpression(parent)) {
		if (t.isIdentifier(parent.left)) return parent.left.name;
		if (
			t.isMemberExpression(parent.left) &&
			!parent.left.computed &&
			t.isIdentifier(parent.left.property)
		) {
			return parent.left.property.name;
		}
	}
	return null;
}

function sourceOrigin(node: t.Node): SourceOrigin {
	return Object.freeze({
		start: node.start ?? 0,
		end: node.end ?? node.start ?? 0,
		line: node.loc?.start.line ?? 1,
		column: node.loc?.start.column ?? 0,
	});
}

function rootId(
	seed: number,
	ordinal: number,
	origin: SourceOrigin
): string {
	let value = (
		seed ^
		Math.imul(ordinal + 1, 0x9e3779b9) ^
		origin.start ^
		Math.imul(origin.end + 1, 0x85ebca6b)
	) >>> 0;
	value ^= value >>> 16;
	value = Math.imul(value, 0x7feb352d) >>> 0;
	value ^= value >>> 15;
	return `rg_${value.toString(36)}`;
}

function compareFunctionPaths(
	left: NodePath<t.Function>,
	right: NodePath<t.Function>
): number {
	return (
		(left.node.start ?? Number.MAX_SAFE_INTEGER) -
		(right.node.start ?? Number.MAX_SAFE_INTEGER)
	);
}

function selectionUnitInterval(
	seed: number,
	name: string,
	ordinal: number
): number {
	let hash = (seed ^ Math.imul(ordinal + 1, 0x9e3779b9)) >>> 0;
	for (let index = 0; index < name.length; index++) {
		hash ^= name.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	hash ^= hash >>> 16;
	hash = Math.imul(hash, 0x7feb352d) >>> 0;
	hash ^= hash >>> 15;
	hash = Math.imul(hash, 0x846ca68b) >>> 0;
	hash ^= hash >>> 16;
	return (hash >>> 0) / 0x1_0000_0000;
}

function validateOptions(options: CompileProtectedSourceRootsOptions): void {
	if (
		!Number.isFinite(options.threshold) ||
		options.threshold < 0 ||
		options.threshold > 1 ||
		!Number.isSafeInteger(options.seed)
	) {
		throw new IsoglossSemanticCompileError(
			"RUAM_ISOGLOSS_INVALID_SELECTION",
			null,
			null,
			"threshold must be in [0,1] and seed must be a safe integer"
		);
	}
}
