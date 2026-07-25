/**
 * Discover source expressions eligible for guarded pure-region replacement.
 *
 * The returned NodePaths are build-only handles. No source relation, origin,
 * or domain map is part of a client artifact.
 *
 * @module isogloss/source-sites
 */

import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { traverse } from "../babel-compat.js";
import {
	lowerSourcePureExpression,
	type LoweredSourcePureRegion,
	type SourceRegionDomain,
	type SourceRegionRejection,
} from "./source-region.js";

export type SourceTargetMode = "root" | "comment";

export interface SourceRegionDiscoveryOptions {
	readonly targetMode: SourceTargetMode;
	readonly threshold: number;
	readonly seed: number;
	readonly regionDomains: Readonly<
		Record<string, Readonly<Record<string, SourceRegionDomain>>>
	>;
}

export interface SourceRegionOrigin {
	readonly line: number | null;
	readonly column: number | null;
	readonly start: number | null;
	readonly end: number | null;
}

export interface SourcePureRegionSite {
	readonly id: string;
	readonly functionName: string;
	readonly ordinal: number;
	readonly expressionPath: NodePath<t.Expression>;
	readonly region: LoweredSourcePureRegion;
	readonly origin: SourceRegionOrigin;
}

/** Coverage classification for every function selected by targetMode. */
export interface SourceFunctionCoverage {
	readonly functionName: string | null;
	readonly origin: SourceRegionOrigin;
	readonly lane: "bprf" | "hybrid" | "native";
	readonly bprfRegionCount: number;
	readonly nativeRegionCount: number;
}

export type SourceRegionDiscoveryDiagnosticCode =
	| "RUAM_SOURCE_TARGET_ANONYMOUS"
	| "RUAM_SOURCE_TARGET_MISSING_DOMAINS"
	| "RUAM_SOURCE_TARGET_THRESHOLD_SKIPPED"
	| "RUAM_SOURCE_REGION_TOO_SMALL"
	| "RUAM_SOURCE_REGION_NATIVE";

export interface SourceRegionDiscoveryDiagnostic {
	readonly code: SourceRegionDiscoveryDiagnosticCode;
	readonly functionName: string | null;
	readonly origin: SourceRegionOrigin;
	readonly rejection: SourceRegionRejection | null;
}

export interface SourceRegionDiscovery {
	readonly sites: readonly SourcePureRegionSite[];
	readonly diagnostics: readonly SourceRegionDiscoveryDiagnostic[];
	readonly functions: readonly SourceFunctionCoverage[];
}

export function discoverSourcePureRegions(
	ast: t.File,
	options: SourceRegionDiscoveryOptions
): SourceRegionDiscovery {
	validateOptions(options);
	const targetPaths: NodePath<t.Function>[] = [];
	traverse(ast, {
		Function(path) {
			if (shouldTarget(path, options.targetMode)) {
				targetPaths.push(path);
			}
		},
	});

	const sites: SourcePureRegionSite[] = [];
	const diagnostics: SourceRegionDiscoveryDiagnostic[] = [];
	const functions: SourceFunctionCoverage[] = [];
	const orderedTargets = targetPaths.sort(compareFunctionPaths);
	for (let targetOrdinal = 0; targetOrdinal < orderedTargets.length; targetOrdinal++) {
		const functionPath = orderedTargets[targetOrdinal]!;
		const functionName = inferFunctionName(functionPath);
		const functionOrigin = originFor(functionPath.node);
		let bprfRegionCount = 0;
		let nativeRegionCount = 0;
		if (!functionName) {
			diagnostics.push(
				diagnostic(
					"RUAM_SOURCE_TARGET_ANONYMOUS",
					null,
					functionOrigin
				)
			);
			functions.push(coverage(null, functionOrigin, 0, 1));
			continue;
		}
		const domains = options.regionDomains[functionName];
		if (!domains) {
			diagnostics.push(
				diagnostic(
					"RUAM_SOURCE_TARGET_MISSING_DOMAINS",
					functionName,
					functionOrigin
				)
			);
			functions.push(coverage(functionName, functionOrigin, 0, 1));
			continue;
		}
		if (
			options.threshold < 1 &&
			selectionUnitInterval(
				options.seed,
				functionName,
				targetOrdinal
			) >= options.threshold
		) {
			diagnostics.push(
				diagnostic(
					"RUAM_SOURCE_TARGET_THRESHOLD_SKIPPED",
					functionName,
					functionOrigin
				)
			);
			functions.push(coverage(functionName, functionOrigin, 0, 1));
			continue;
		}

		const expressionPaths: NodePath<t.Expression>[] = [];
		if (
			functionPath.isArrowFunctionExpression() &&
			!t.isBlockStatement(functionPath.node.body)
		) {
			expressionPaths.push(
				functionPath.get("body") as NodePath<t.Expression>
			);
		}
		const returnPaths: NodePath<t.ReturnStatement>[] = [];
		functionPath.traverse({
			Function(inner) {
				inner.skip();
			},
			ReturnStatement(path) {
				returnPaths.push(path);
			},
		});
		returnPaths.sort(compareNodePaths);
		for (const returnPath of returnPaths) {
			const argumentPath = returnPath.get("argument");
			if (argumentPath.node && argumentPath.isExpression()) {
				expressionPaths.push(argumentPath);
			}
		}
		expressionPaths.sort(compareNodePaths);
		for (let ordinal = 0; ordinal < expressionPaths.length; ordinal++) {
			const argumentPath = expressionPaths[ordinal]!;
			const localBindings = collectLocalBindings(
				argumentPath,
				functionPath
			);
			const lowering = lowerSourcePureExpression(argumentPath.node, {
				domains,
				localBindings,
			});
			if (!lowering.accepted) {
				nativeRegionCount++;
				diagnostics.push(
					diagnostic(
						"RUAM_SOURCE_REGION_NATIVE",
						functionName,
						originFor(argumentPath.node),
						lowering.rejection
					)
				);
				continue;
			}
			if (
				lowering.region.contract.inputs.length === 0 ||
				lowering.region.contract.steps.length < 2
			) {
				nativeRegionCount++;
				diagnostics.push(
					diagnostic(
						"RUAM_SOURCE_REGION_TOO_SMALL",
						functionName,
						originFor(argumentPath.node)
					)
				);
				continue;
			}
			sites.push(
				Object.freeze({
					id: `source-region-${targetOrdinal}-${ordinal}`,
					functionName,
					ordinal,
					expressionPath: argumentPath,
					region: lowering.region,
					origin: originFor(argumentPath.node),
				})
			);
			bprfRegionCount++;
		}
		if (expressionPaths.length === 0) nativeRegionCount = 1;
		functions.push(
			coverage(
				functionName,
				functionOrigin,
				bprfRegionCount,
				nativeRegionCount
			)
		);
	}

	return Object.freeze({
		sites: Object.freeze(sites),
		diagnostics: Object.freeze(diagnostics),
		functions: Object.freeze(functions),
	});
}

function shouldTarget(
	path: NodePath<t.Function>,
	mode: SourceTargetMode
): boolean {
	if (mode === "comment") {
		return hasIsoglossMarker(path);
	}
	let current: NodePath | null = path.parentPath;
	while (current) {
		if (current.isFunction()) return false;
		current = current.parentPath;
	}
	return true;
}

function hasIsoglossMarker(path: NodePath<t.Function>): boolean {
	const comments = [
		...(path.node.leadingComments ?? []),
		...(path.parentPath?.node.leadingComments ?? []),
	];
	return comments.some(
		(comment) => comment.value.trim() === "ruam:isogloss"
	);
}

function inferFunctionName(path: NodePath<t.Function>): string | null {
	if (
		(t.isObjectMethod(path.node) || t.isClassMethod(path.node)) &&
		!path.node.computed &&
		t.isIdentifier(path.node.key)
	) {
		return path.node.key.name;
	}
	if (
		(t.isObjectMethod(path.node) || t.isClassMethod(path.node)) &&
		(t.isStringLiteral(path.node.key) || t.isNumericLiteral(path.node.key))
	) {
		return String(path.node.key.value);
	}
	if (
		t.isClassPrivateMethod(path.node) &&
		t.isPrivateName(path.node.key)
	) {
		return `#${path.node.key.id.name}`;
	}
	if (
		("id" in path.node && t.isIdentifier(path.node.id)) ||
		t.isFunctionDeclaration(path.node)
	) {
		const id = "id" in path.node ? path.node.id : null;
		if (t.isIdentifier(id)) return id.name;
	}
	const parent = path.parentPath?.node;
	if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
		return parent.id.name;
	}
	if (
		(t.isObjectProperty(parent) ||
			t.isObjectMethod(parent) ||
			t.isClassMethod(parent) ||
			t.isClassProperty(parent)) &&
		!parent.computed &&
		t.isIdentifier(parent.key)
	) {
		return parent.key.name;
	}
	if (
		(t.isClassPrivateMethod(parent) || t.isClassPrivateProperty(parent)) &&
		t.isPrivateName(parent.key)
	) {
		return `#${parent.key.id.name}`;
	}
	if (
		(t.isObjectProperty(parent) ||
			t.isObjectMethod(parent) ||
			t.isClassMethod(parent) ||
			t.isClassProperty(parent)) &&
		!parent.computed &&
		(t.isStringLiteral(parent.key) || t.isNumericLiteral(parent.key))
	) {
		return String(parent.key.value);
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

function collectLocalBindings(
	expressionPath: NodePath<t.Expression>,
	functionPath: NodePath<t.Function>
): ReadonlySet<string> {
	const names = new Set<string>();
	t.traverseFast(expressionPath.node, (node) => {
		if (t.isIdentifier(node)) names.add(node.name);
	});
	const local = new Set<string>();
	for (const name of names) {
		const binding = expressionPath.scope.getBinding(name);
		if (binding && pathIsInside(binding.path, functionPath)) {
			local.add(name);
		}
	}
	return local;
}

function pathIsInside(
	path: NodePath,
	ancestor: NodePath
): boolean {
	let current: NodePath | null = path;
	while (current) {
		if (current === ancestor) return true;
		current = current.parentPath;
	}
	return false;
}

function validateOptions(options: SourceRegionDiscoveryOptions): void {
	if (
		!Number.isFinite(options.threshold) ||
		options.threshold < 0 ||
		options.threshold > 1
	) {
		throw new Error("RUAM_SOURCE_DISCOVERY_INVALID_THRESHOLD");
	}
	if (!Number.isSafeInteger(options.seed)) {
		throw new Error("RUAM_SOURCE_DISCOVERY_INVALID_SEED");
	}
}

function diagnostic(
	code: SourceRegionDiscoveryDiagnosticCode,
	functionName: string | null,
	origin: SourceRegionOrigin,
	rejection: SourceRegionRejection | null = null
): SourceRegionDiscoveryDiagnostic {
	return Object.freeze({
		code,
		functionName,
		origin,
		rejection,
	});
}

function coverage(
	functionName: string | null,
	origin: SourceRegionOrigin,
	bprfRegionCount: number,
	nativeRegionCount: number
): SourceFunctionCoverage {
	return Object.freeze({
		functionName,
		origin,
		lane:
			bprfRegionCount === 0
				? "native"
				: nativeRegionCount === 0
					? "bprf"
					: "hybrid",
		bprfRegionCount,
		nativeRegionCount,
	});
}

function originFor(node: t.Node): SourceRegionOrigin {
	return Object.freeze({
		line: node.loc?.start.line ?? null,
		column: node.loc?.start.column ?? null,
		start: node.start ?? null,
		end: node.end ?? null,
	});
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

function compareFunctionPaths(
	left: NodePath<t.Function>,
	right: NodePath<t.Function>
): number {
	return compareNodePaths(left, right);
}

function compareNodePaths(
	left: NodePath,
	right: NodePath
): number {
	return (
		(left.node.start ?? Number.MAX_SAFE_INTEGER) -
		(right.node.start ?? Number.MAX_SAFE_INTEGER)
	);
}
