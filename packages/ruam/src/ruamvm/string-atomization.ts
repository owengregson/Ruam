/**
 * Interpreter string atomization.
 *
 * AST tree transform that collects all string literal nodes from handler
 * and builder bodies, encodes them via the polymorphic decoder chain,
 * and replaces them with indexed lookups into an encoded string table.
 *
 * Zero hardcoded strings remain in the interpreter output — even property
 * names like "prototype", "length", "call" become `_sa(N)` calls, decoded
 * lazily at first access and cached.
 *
 * @module ruamvm/string-atomization
 */

import type { JsNode, Literal } from "./nodes.js";
import { id, call, lit, mapChildren } from "./nodes.js";
import type { DecoderChain } from "./polymorphic-decoder.js";
import {
	polyEncode,
	buildDecoderFunctionAST,
	buildStringTableAST,
} from "./polymorphic-decoder.js";

// --- Configuration ---

/** Minimum string length to atomize (very short strings not worth it). */
const MIN_ATOMIZE_LEN = 2;

/** Strings to never atomize (JS keywords that must remain as-is in source). */
const SKIP_STRINGS = new Set([
	// These appear as identifiers, not string values
	"use strict",
]);

// --- String collection ---

/**
 * Recursively collect all unique string literals from an AST node tree.
 * Only collects strings from `Literal` nodes (not `Id`, `MemberExpr.prop`, etc.).
 *
 * @param nodes - AST nodes to scan
 * @param collected - Set to accumulate strings into
 */
export function collectStrings(nodes: JsNode[], collected: Set<string>): void {
	for (const node of nodes) {
		collectStringsFromNode(node, collected);
	}
}

function collectStringsFromNode(node: JsNode, collected: Set<string>): void {
	if (
		node.type === "Literal" &&
		typeof node.value === "string" &&
		node.value.length >= MIN_ATOMIZE_LEN &&
		!SKIP_STRINGS.has(node.value)
	) {
		collected.add(node.value);
	}

	// Recurse into children
	mapChildren(node, (child) => {
		collectStringsFromNode(child, collected);
		return child; // Don't modify, just traverse
	});
}

// --- String replacement ---

/**
 * Replace string literals in AST nodes with indexed accessor calls.
 *
 * @param nodes - AST nodes to transform
 * @param stringMap - Map of string value → table index
 * @param accessorName - Runtime name of the accessor function
 * @returns Transformed AST nodes
 */
export function replaceStrings(
	nodes: JsNode[],
	stringMap: Map<string, number>,
	accessorName: string
): JsNode[] {
	return nodes.map((node) =>
		replaceStringsInNode(node, stringMap, accessorName)
	);
}

function replaceStringsInNode(
	node: JsNode,
	stringMap: Map<string, number>,
	accessorName: string
): JsNode {
	// Replace string literals with _sa(index)
	if (
		node.type === "Literal" &&
		typeof node.value === "string" &&
		node.value.length >= MIN_ATOMIZE_LEN &&
		!SKIP_STRINGS.has(node.value)
	) {
		const idx = stringMap.get(node.value);
		if (idx != null) {
			return call(id(accessorName), [lit(idx)]);
		}
	}

	// Recurse into children
	return mapChildren(node, (child) =>
		replaceStringsInNode(child, stringMap, accessorName)
	);
}

// --- Main orchestrator ---

/** Result of atomizing strings in a set of AST nodes. */
export interface AtomizationResult {
	/** The transformed AST nodes with string literals replaced. */
	transformedNodes: JsNode[];
	/** AST nodes for the string table infrastructure (emit at IIFE scope). */
	infrastructure: JsNode[];
}

/**
 * Atomize all string literals in the given AST nodes.
 *
 * 1. Collects all unique string literals
 * 2. Encodes each via the polymorphic decoder chain
 * 3. Builds the encoded table + decoder + accessor infrastructure
 * 4. Replaces string literals with _sa(index) calls
 *
 * @param nodes - AST nodes to transform (handler/builder bodies)
 * @param chain - Polymorphic decoder chain for this build
 * @param names - Runtime names for generated identifiers
 * @returns Transformed nodes and infrastructure nodes
 */
export function atomizeStrings(
	nodes: JsNode[],
	chain: DecoderChain,
	names: {
		decoder: string;
		posSeed: string;
		table: string;
		cache: string;
		accessor: string;
	}
): AtomizationResult {
	// Step 1: Collect unique strings
	const strings = new Set<string>();
	collectStrings(nodes, strings);

	if (strings.size === 0) {
		return { transformedNodes: nodes, infrastructure: [] };
	}

	// Step 2: Build string → index map (sorted for determinism)
	const sortedStrings = [...strings].sort();
	const stringMap = new Map<string, number>();
	for (let i = 0; i < sortedStrings.length; i++) {
		stringMap.set(sortedStrings[i]!, i);
	}

	// Step 3: Encode each string
	const encodedTable: number[][] = sortedStrings.map((str, i) =>
		polyEncode(str, chain, i)
	);

	// Step 4: Build infrastructure AST
	const decoderNodes = buildDecoderFunctionAST(
		chain,
		names.decoder,
		names.posSeed
	);
	const tableNodes = buildStringTableAST(
		encodedTable,
		names.table,
		names.cache,
		names.accessor,
		names.decoder
	);

	// Step 5: Replace strings in source nodes
	const transformedNodes = replaceStrings(nodes, stringMap, names.accessor);

	return {
		transformedNodes,
		infrastructure: [...decoderNodes, ...tableNodes],
	};
}
