/**
 * AST tree transforms for runtime code generation.
 *
 * Structural replacements that operate on the JsNode tree before
 * emission. Replaces the regex-based post-processing passes from
 * the old template system.
 *
 * @module ruamvm/transforms
 */

import type { JsNode } from "./nodes.js";
import { id, mapChildren } from "./nodes.js";
import { resolveName } from "../naming/index.js";
import type { NameRegistry } from "../naming/registry.js";
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
 * @param reserved - Optional set of names that must not be used as
 *   replacement targets (e.g. RuntimeNames/TempNames values already
 *   allocated for the same scope).
 * @param registry - Optional NameRegistry for collision-safe name generation.
 *   When provided, replacement names are allocated via the registry's
 *   dynamic generator, ensuring handler-local names never collide with
 *   IIFE-scope identifiers.
 * @returns Transformed statement list
 */
export function obfuscateLocals(
	nodes: JsNode[],
	seed: number,
	reserved?: ReadonlySet<string>,
	registry?: NameRegistry
): JsNode[] {
	// Collect names to rename
	const toRename = new Set<string>();
	collectNames(nodes, toRename);

	// Never rename names that are in the reserved set — these are
	// runtime/temp identifiers shared with other AST trees (e.g. the
	// exec function references handler group arrays declared in
	// iifeDecls).  Renaming them here without also renaming the
	// free-variable references in the other tree breaks the binding.
	if (reserved) {
		for (const name of reserved) {
			toRename.delete(name);
		}
	}

	if (toRename.size === 0) return nodes;

	// Generate replacement names — prefer registry dynamic generator
	// for collision-safe allocation against the global used set.
	// Falls back to internal LCG when no registry is available.
	let genShort: () => string;

	if (registry) {
		const dynGen = registry.createDynamicGenerator("handlerLocals", "short");
		const localUsed = new Set<string>(reserved);
		genShort = () => {
			for (;;) {
				const name = dynGen();
				if (!KEEP.has(name) && !RESERVED.has(name) && !localUsed.has(name)) {
					localUsed.add(name);
					return name;
				}
			}
		};
	} else {
		let s = seed >>> 0;
		function lcg(): number {
			s = (s * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
			return s;
		}
		const alpha = "abcdefghijklmnopqrstuvwxyz";
		const alnum = "abcdefghijklmnopqrstuvwxyz0123456789";
		const used = new Set<string>(reserved);

		// Per-seed name length preference: some builds get 2-char handler
		// locals, others get 2-3 char mix, breaking the "all handler
		// locals are exactly N chars" fingerprint.
		const threeCharBias = ((lcg() >>> 0) / 0x100000000) * 0.6; // 0-60%

		genShort = (): string => {
			for (let attempt = 0; ; attempt++) {
				const useThree = (lcg() >>> 0) / 0x100000000 < threeCharBias;
				let name: string;
				if (useThree) {
					const c1 = alpha[lcg() % alpha.length]!;
					const c2 = alnum[lcg() % alnum.length]!;
					const c3 = alnum[lcg() % alnum.length]!;
					name = c1 + c2 + c3;
				} else {
					const c1 = alpha[lcg() % alpha.length]!;
					const c2 = alnum[lcg() % alnum.length]!;
					name = c1 + c2;
				}
				if (
					!used.has(name) &&
					!KEEP.has(name) &&
					!RESERVED.has(name)
				) {
					used.add(name);
					return name;
				}
				if (attempt > 500) {
					const c1 = alpha[lcg() % alpha.length]!;
					const c2 = alnum[lcg() % alnum.length]!;
					const fallback = c1 + c2;
					if (
						!used.has(fallback) &&
						!KEEP.has(fallback) &&
						!RESERVED.has(fallback)
					) {
						used.add(fallback);
						return fallback;
					}
				}
			}
		};
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
		case "ConstDecl": {
			const name = resolveName(node.name);
			if (shouldRename(name)) out.add(name);
			break;
		}
		case "FnDecl":
		case "FnExpr":
		case "ArrowFn":
			for (const p of node.params) {
				const pStr = String(p);
				const clean = pStr.replace(/^\.\.\./, "");
				if (shouldRename(clean)) out.add(clean);
			}
			break;
		case "ForInStmt": {
			const decl = resolveName(node.decl);
			if (shouldRename(decl)) out.add(decl);
			break;
		}
		case "TryCatchStmt": {
			if (node.param) {
				const param = resolveName(node.param);
				if (shouldRename(param)) out.add(param);
			}
			break;
		}
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
				const renamed = map.get(resolveName(n.name));
				return renamed ? id(renamed) : null;
			}
			case "VarDecl": {
				const renamed = map.get(resolveName(n.name));
				return renamed ? { ...n, name: renamed } : null;
			}
			case "ConstDecl": {
				const renamed = map.get(resolveName(n.name));
				return renamed ? { ...n, name: renamed } : null;
			}
			case "FnDecl": {
				const newParams = renameParams(n.params as string[], map);
				return newParams ? { ...n, params: newParams } : null;
			}
			case "FnExpr": {
				const newParams = renameParams(n.params as string[], map);
				return newParams ? { ...n, params: newParams } : null;
			}
			case "ArrowFn": {
				const newParams = renameParams(n.params as string[], map);
				return newParams ? { ...n, params: newParams } : null;
			}
			case "ForInStmt": {
				const renamed = map.get(resolveName(n.decl));
				return renamed ? { ...n, decl: renamed } : null;
			}
			case "TryCatchStmt": {
				if (n.param) {
					const renamed = map.get(resolveName(n.param));
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
