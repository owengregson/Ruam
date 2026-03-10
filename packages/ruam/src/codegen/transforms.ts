/**
 * AST tree transforms for runtime code generation.
 *
 * Structural replacements that operate on the JsNode tree before
 * emission. Replaces the regex-based post-processing passes from
 * the old template system.
 *
 * @module codegen/transforms
 */

import type { JsNode } from "./nodes.js";
import { id, index, update, assign, mapChildren } from "./nodes.js";
import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";

// --- Generic tree walker ---

/**
 * Walk a JsNode tree bottom-up, applying a visitor to each node.
 * The visitor returns a replacement node or null to keep the original.
 * Raw nodes are opaque — their contents are not walked.
 */
function walkReplace(
	node: JsNode,
	visitor: (n: JsNode) => JsNode | null
): JsNode {
	const walked = walkChildren(node, visitor);
	return visitor(walked) ?? walked;
}

/**
 * Recursively walk all child nodes, producing a new node with walked children.
 * Delegates to the generic mapChildren() from nodes.ts using the CHILD_FIELDS metadata table.
 */
function walkChildren(
	node: JsNode,
	visitor: (n: JsNode) => JsNode | null
): JsNode {
	return mapChildren(node, (child) => walkReplace(child, visitor));
}

// --- inlineStackOps ---

/** Check if a node is a function call to the named function. */
function isCallTo(
	node: JsNode,
	name: string
): node is JsNode & { type: "CallExpr" } {
	return (
		node.type === "CallExpr" &&
		node.callee.type === "Id" &&
		node.callee.name === name
	);
}

/** Check if a node is the W/X/Y function declaration. */
function isStackFnDecl(node: JsNode, W: string, X: string, Y: string): boolean {
	if (node.type === "FnDecl") {
		return node.name === W || node.name === X || node.name === Y;
	}
	return false;
}

/**
 * Inline stack operations: replace W(expr) → S[++P]=expr, X() → S[P--], Y() → S[P].
 * Also removes the W/X/Y function declarations.
 *
 * @param nodes - The statement list to transform
 * @param S - Stack array variable name
 * @param P - Stack pointer variable name
 * @param W - Push function name
 * @param X - Pop function name
 * @param Y - Peek function name
 * @returns Transformed statement list
 */
export function inlineStackOps(
	nodes: JsNode[],
	S: string,
	P: string,
	W: string,
	X: string,
	Y: string
): JsNode[] {
	const visitor = (node: JsNode): JsNode | null => {
		if (node.type !== "CallExpr") return null;

		// W(expr) → S[++P]=expr
		if (isCallTo(node, W) && node.args.length === 1) {
			return assign(
				index(id(S), update("++", true, id(P))),
				node.args[0]!
			);
		}

		// X() → S[P--]
		if (isCallTo(node, X) && node.args.length === 0) {
			return index(id(S), update("--", false, id(P)));
		}

		// Y() → S[P]
		if (isCallTo(node, Y) && node.args.length === 0) {
			return index(id(S), id(P));
		}

		return null;
	};

	return nodes
		.filter((n) => !isStackFnDecl(n, W, X, Y))
		.map((n) => walkReplace(n, visitor));
}

// --- obfuscateLocals ---

/** Names that must NOT be renamed (JS built-ins, APIs, short names). */
export const KEEP = new Set([
	// JS built-ins
	"undefined",
	"null",
	"true",
	"false",
	"NaN",
	"Infinity",
	"void",
	"typeof",
	"instanceof",
	"delete",
	"new",
	"this",
	"arguments",
	// Globals used in the output
	"Object",
	"Array",
	"Symbol",
	"String",
	"Number",
	"Boolean",
	"BigInt",
	"RegExp",
	"Math",
	"JSON",
	"Date",
	"Error",
	"TypeError",
	"RangeError",
	"ReferenceError",
	"SyntaxError",
	"Uint8Array",
	"DataView",
	"Buffer",
	"globalThis",
	"window",
	"global",
	"self",
	"console",
	"atob",
	"eval",
	"setInterval",
	"setTimeout",
	"clearInterval",
	"clearTimeout",
	// Short generic names (already look minified)
	"a",
	"b",
	"c",
	"d",
	"e",
	"f",
	"g",
	"h",
	"i",
	"j",
	"k",
	"s",
	"v",
	"w",
	"x",
	"a1",
	"a2",
	"a3",
	"ai",
	"ki",
	"si",
	"ri",
	"ti",
	// Object property/method names that are part of the language API
	"length",
	"push",
	"pop",
	"call",
	"apply",
	"bind",
	"keys",
	"value",
	"done",
	"next",
	"return",
	"get",
	"set",
	"create",
	"freeze",
	"seal",
	"from",
	"assign",
	"prototype",
	"constructor",
	"name",
	"writable",
	"configurable",
	"enumerable",
	"slice",
	"concat",
	"indexOf",
	"join",
	"charCodeAt",
	"toString",
	"getPrototypeOf",
	"setPrototypeOf",
	"defineProperty",
	"isArray",
	"getUint8",
	"getUint16",
	"getUint32",
	"getInt32",
	"getFloat64",
	"getInt8",
	"getInt16",
	"buffer",
	"byteOffset",
	"byteLength",
	"fromCharCode",
	"reduce",
	"floor",
	"parse",
	"stringify",
	"iterator",
	"asyncIterator",
	"hasInstance",
	"toPrimitive",
	"toStringTag",
	"species",
	"isConcatSpreadable",
	"match",
	"replace",
	"search",
	"split",
	"unscopables",
	"raw",
	"log",
	"warn",
	"message",
	// Computed identifiers
	"id",
	"uid",
	"cs",
	"ct",
]);

/** JS reserved words and keywords that can't be used as identifiers. */
export const RESERVED = new Set([
	"do",
	"if",
	"in",
	"of",
	"as",
	"is",
	"for",
	"let",
	"new",
	"try",
	"var",
	"int",
	"case",
	"else",
	"enum",
	"null",
	"this",
	"true",
	"void",
	"with",
	"await",
	"break",
	"catch",
	"class",
	"const",
	"false",
	"super",
	"throw",
	"while",
	"yield",
	"delete",
	"export",
	"import",
	"public",
	"return",
	"static",
	"switch",
	"typeof",
	"default",
	"extends",
	"finally",
	"package",
	"private",
	"continue",
	"debugger",
	"function",
	"abstract",
	"volatile",
	"protected",
	"interface",
	"instanceof",
	"implements",
]);

/**
 * Rename case-local variables with names >= 3 chars to short 2-char names.
 *
 * Collects VarDecl.name, FnDecl.params, FnExpr.params, ArrowFn.params,
 * ForInStmt.decl, and TryCatchStmt.param entries with names >= 3 chars
 * that aren't in the KEEP set and don't start with `_`. Generates
 * short replacements via LCG and renames all matching Id references.
 *
 * Raw nodes are opaque — identifiers inside them are not renamed.
 *
 * @param nodes - The statement list to transform
 * @param seed - LCG seed for deterministic name generation
 * @returns Transformed statement list
 */
export function obfuscateLocals(nodes: JsNode[], seed: number): JsNode[] {
	// Collect names to rename
	const toRename = new Set<string>();
	collectNames(nodes, toRename);
	if (toRename.size === 0) return nodes;

	// Generate short replacement names via LCG
	let s = seed >>> 0;
	function lcg(): number {
		s = (s * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
		return s;
	}
	const alpha = "abcdefghijklmnopqrstuvwxyz";
	const alnum = "abcdefghijklmnopqrstuvwxyz0123456789";
	const used = new Set<string>();

	function genShort(): string {
		for (;;) {
			const c1 = alpha[lcg() % alpha.length]!;
			const c2 = alnum[lcg() % alnum.length]!;
			const name = c1 + c2;
			if (!used.has(name) && !KEEP.has(name) && !RESERVED.has(name)) {
				used.add(name);
				return name;
			}
		}
	}

	const renameMap = new Map<string, string>();
	for (const name of toRename) {
		renameMap.set(name, genShort());
	}

	// Apply renames
	return nodes.map((n) => renameNode(n, renameMap));
}

/** Check if a name should be renamed. */
function shouldRename(name: string): boolean {
	return name.length >= 3 && !KEEP.has(name) && !name.startsWith("_");
}

/** Collect variable and parameter names to rename from the tree. */
function collectNames(nodes: JsNode[], out: Set<string>): void {
	for (const node of nodes) {
		collectNamesFromNode(node, out);
	}
}

function collectNamesFromNode(node: JsNode, out: Set<string>): void {
	// Handle the 7 node types that declare names
	switch (node.type) {
		case "VarDecl":
		case "ConstDecl":
			if (shouldRename(node.name)) out.add(node.name);
			break;
		case "FnDecl":
		case "FnExpr":
		case "ArrowFn":
			for (const p of node.params) {
				const clean = p.replace(/^\.\.\./, "");
				if (shouldRename(clean)) out.add(clean);
			}
			break;
		case "ForInStmt":
			if (shouldRename(node.decl)) out.add(node.decl);
			break;
		case "TryCatchStmt":
			if (node.param && shouldRename(node.param)) out.add(node.param);
			break;
	}
	// Traverse all children generically — no 36-case switch needed
	mapChildren(node, (child) => {
		collectNamesFromNode(child, out);
		return child;
	});
}

/** Rename identifiers in a node tree using the rename map. */
function renameNode(node: JsNode, map: Map<string, string>): JsNode {
	return walkReplace(node, (n) => {
		switch (n.type) {
			case "Id": {
				const renamed = map.get(n.name);
				return renamed ? id(renamed) : null;
			}
			case "VarDecl": {
				const renamed = map.get(n.name);
				return renamed ? { ...n, name: renamed } : null;
			}
			case "ConstDecl": {
				const renamed = map.get(n.name);
				return renamed ? { ...n, name: renamed } : null;
			}
			case "FnDecl": {
				const newParams = renameParams(n.params, map);
				return newParams ? { ...n, params: newParams } : null;
			}
			case "FnExpr": {
				const newParams = renameParams(n.params, map);
				return newParams ? { ...n, params: newParams } : null;
			}
			case "ArrowFn": {
				const newParams = renameParams(n.params, map);
				return newParams ? { ...n, params: newParams } : null;
			}
			case "ForInStmt": {
				const renamed = map.get(n.decl);
				return renamed ? { ...n, decl: renamed } : null;
			}
			case "TryCatchStmt": {
				if (n.param) {
					const renamed = map.get(n.param);
					return renamed ? { ...n, param: renamed } : null;
				}
				return null;
			}
			default:
				return null;
		}
	});
}

/** Rename function params, returning null if no changes. */
function renameParams(
	params: string[],
	map: Map<string, string>
): string[] | null {
	let changed = false;
	const newParams = params.map((p) => {
		const isRest = p.startsWith("...");
		const clean = isRest ? p.slice(3) : p;
		const renamed = map.get(clean);
		if (renamed) {
			changed = true;
			return isRest ? `...${renamed}` : renamed;
		}
		return p;
	});
	return changed ? newParams : null;
}
