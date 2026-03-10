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
import {
	id, index, update, assign,
} from "./nodes.js";
import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";

// --- Generic tree walker ---

/**
 * Walk a JsNode tree bottom-up, applying a visitor to each node.
 * The visitor returns a replacement node or null to keep the original.
 * Raw nodes are opaque — their contents are not walked.
 */
function walkReplace(node: JsNode, visitor: (n: JsNode) => JsNode | null): JsNode {
	const walked = walkChildren(node, visitor);
	return visitor(walked) ?? walked;
}

/**
 * Recursively walk all child nodes, producing a new node with walked children.
 */
function walkChildren(node: JsNode, visitor: (n: JsNode) => JsNode | null): JsNode {
	switch (node.type) {
		// --- Declarations ---
		case 'VarDecl':
			return node.init
				? { ...node, init: walkReplace(node.init, visitor) }
				: node;
		case 'ConstDecl':
			return node.init
				? { ...node, init: walkReplace(node.init, visitor) }
				: node;
		case 'FnDecl':
			return { ...node, body: node.body.map(n => walkReplace(n, visitor)) };

		// --- Statements ---
		case 'ExprStmt':
			return { ...node, expr: walkReplace(node.expr, visitor) };
		case 'Block':
			return { ...node, body: node.body.map(n => walkReplace(n, visitor)) };
		case 'IfStmt': {
			const result: JsNode = {
				...node,
				test: walkReplace(node.test, visitor),
				then: node.then.map(n => walkReplace(n, visitor)),
			};
			if (node.else) {
				(result as typeof node).else = node.else.map(n => walkReplace(n, visitor));
			}
			return result;
		}
		case 'WhileStmt':
			return {
				...node,
				test: walkReplace(node.test, visitor),
				body: node.body.map(n => walkReplace(n, visitor)),
			};
		case 'ForStmt':
			return {
				...node,
				init: node.init ? walkReplace(node.init, visitor) : null,
				test: node.test ? walkReplace(node.test, visitor) : null,
				update: node.update ? walkReplace(node.update, visitor) : null,
				body: node.body.map(n => walkReplace(n, visitor)),
			};
		case 'ForInStmt':
			return {
				...node,
				obj: walkReplace(node.obj, visitor),
				body: node.body.map(n => walkReplace(n, visitor)),
			};
		case 'SwitchStmt':
			return {
				...node,
				disc: walkReplace(node.disc, visitor),
				cases: node.cases.map(c => walkReplace(c, visitor)) as typeof node.cases,
			};
		case 'CaseClause':
			return {
				...node,
				label: node.label ? walkReplace(node.label, visitor) : null,
				body: node.body.map(n => walkReplace(n, visitor)),
			};
		case 'ReturnStmt':
			return node.value
				? { ...node, value: walkReplace(node.value, visitor) }
				: node;
		case 'ThrowStmt':
			return { ...node, value: walkReplace(node.value, visitor) };
		case 'TryCatchStmt': {
			const result: typeof node = {
				...node,
				body: node.body.map(n => walkReplace(n, visitor)),
			};
			if (node.handler) result.handler = node.handler.map(n => walkReplace(n, visitor));
			if (node.finalizer) result.finalizer = node.finalizer.map(n => walkReplace(n, visitor));
			return result;
		}
		case 'BreakStmt':
		case 'ContinueStmt':
		case 'DebuggerStmt':
			return node;

		// --- Expressions ---
		case 'Id':
		case 'Literal':
		case 'Raw':
			return node;
		case 'BinOp':
			return {
				...node,
				left: walkReplace(node.left, visitor),
				right: walkReplace(node.right, visitor),
			};
		case 'UnaryOp':
			return { ...node, expr: walkReplace(node.expr, visitor) };
		case 'UpdateExpr':
			return { ...node, arg: walkReplace(node.arg, visitor) };
		case 'AssignExpr':
			return {
				...node,
				target: walkReplace(node.target, visitor),
				value: walkReplace(node.value, visitor),
			};
		case 'CallExpr':
			return {
				...node,
				callee: walkReplace(node.callee, visitor),
				args: node.args.map(a => walkReplace(a, visitor)),
			};
		case 'MemberExpr':
			return { ...node, obj: walkReplace(node.obj, visitor) };
		case 'IndexExpr':
			return {
				...node,
				obj: walkReplace(node.obj, visitor),
				index: walkReplace(node.index, visitor),
			};
		case 'TernaryExpr':
			return {
				...node,
				test: walkReplace(node.test, visitor),
				then: walkReplace(node.then, visitor),
				else: walkReplace(node.else, visitor),
			};
		case 'ArrayExpr':
			return { ...node, elements: node.elements.map(e => walkReplace(e, visitor)) };
		case 'ObjectExpr':
			return {
				...node,
				entries: node.entries.map(([k, v]) => [
					typeof k === 'string' ? k : walkReplace(k, visitor),
					walkReplace(v, visitor),
				] as [string | JsNode, JsNode]),
			};
		case 'FnExpr':
			return { ...node, body: node.body.map(n => walkReplace(n, visitor)) };
		case 'ArrowFn':
			return { ...node, body: node.body.map(n => walkReplace(n, visitor)) };
		case 'NewExpr':
			return {
				...node,
				callee: walkReplace(node.callee, visitor),
				args: node.args.map(a => walkReplace(a, visitor)),
			};
		case 'SequenceExpr':
			return { ...node, exprs: node.exprs.map(e => walkReplace(e, visitor)) };
		case 'AwaitExpr':
			return { ...node, expr: walkReplace(node.expr, visitor) };
		case 'ImportExpr':
			return { ...node, specifier: walkReplace(node.specifier, visitor) };
	}
}

// --- inlineStackOps ---

/** Check if a node is a function call to the named function. */
function isCallTo(node: JsNode, name: string): node is JsNode & { type: 'CallExpr' } {
	return node.type === 'CallExpr' && node.callee.type === 'Id' && node.callee.name === name;
}

/** Check if a node is the W/X/Y function declaration. */
function isStackFnDecl(node: JsNode, W: string, X: string, Y: string): boolean {
	if (node.type === 'FnDecl') {
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
		if (node.type !== 'CallExpr') return null;

		// W(expr) → S[++P]=expr
		if (isCallTo(node, W) && node.args.length === 1) {
			return assign(
				index(id(S), update('++', true, id(P))),
				node.args[0]!
			);
		}

		// X() → S[P--]
		if (isCallTo(node, X) && node.args.length === 0) {
			return index(id(S), update('--', false, id(P)));
		}

		// Y() → S[P]
		if (isCallTo(node, Y) && node.args.length === 0) {
			return index(id(S), id(P));
		}

		return null;
	};

	return nodes
		.filter(n => !isStackFnDecl(n, W, X, Y))
		.map(n => walkReplace(n, visitor));
}

// --- obfuscateLocals ---

/** Names that must NOT be renamed (JS built-ins, APIs, short names). */
export const KEEP = new Set([
	// JS built-ins
	"undefined", "null", "true", "false", "NaN", "Infinity",
	"void", "typeof", "instanceof", "delete", "new", "this", "arguments",
	// Globals used in the output
	"Object", "Array", "Symbol", "String", "Number", "Boolean", "BigInt",
	"RegExp", "Math", "JSON", "Date", "Error", "TypeError", "RangeError",
	"ReferenceError", "SyntaxError", "Uint8Array", "DataView", "Buffer",
	"globalThis", "window", "global", "self", "console", "atob", "eval",
	"setInterval", "setTimeout", "clearInterval", "clearTimeout",
	// Short generic names (already look minified)
	"a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "s", "v", "w", "x",
	"a1", "a2", "a3", "ai", "ki", "si", "ri", "ti",
	// Object property/method names that are part of the language API
	"length", "push", "pop", "call", "apply", "bind", "keys", "value", "done",
	"next", "return", "get", "set", "create", "freeze", "seal", "from", "assign",
	"prototype", "constructor", "name", "writable", "configurable", "enumerable",
	"slice", "concat", "indexOf", "join", "charCodeAt", "toString",
	"getPrototypeOf", "setPrototypeOf", "defineProperty", "isArray",
	"getUint8", "getUint16", "getUint32", "getInt32", "getFloat64",
	"getInt8", "getInt16", "buffer", "byteOffset", "byteLength",
	"fromCharCode", "reduce", "floor", "parse", "stringify",
	"iterator", "asyncIterator", "hasInstance", "toPrimitive", "toStringTag",
	"species", "isConcatSpreadable", "match", "replace", "search", "split",
	"unscopables", "raw", "log", "warn", "message",
	// Computed identifiers
	"id", "uid", "cs", "ct",
]);

/** JS reserved words and keywords that can't be used as identifiers. */
export const RESERVED = new Set([
	"do", "if", "in", "of", "as", "is", "for", "let", "new", "try", "var", "int",
	"case", "else", "enum", "null", "this", "true", "void", "with",
	"await", "break", "catch", "class", "const", "false", "super", "throw", "while", "yield",
	"delete", "export", "import", "public", "return", "static", "switch", "typeof",
	"default", "extends", "finally", "package", "private",
	"continue", "debugger", "function", "abstract", "volatile",
	"protected", "interface", "instanceof", "implements",
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
	return nodes.map(n => renameNode(n, renameMap));
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
	switch (node.type) {
		case 'VarDecl':
			if (shouldRename(node.name)) out.add(node.name);
			if (node.init) collectNamesFromNode(node.init, out);
			break;
		case 'ConstDecl':
			if (shouldRename(node.name)) out.add(node.name);
			if (node.init) collectNamesFromNode(node.init, out);
			break;
		case 'FnDecl':
			for (const p of node.params) {
				const clean = p.replace(/^\.\.\./, "");
				if (shouldRename(clean)) out.add(clean);
			}
			collectNames(node.body, out);
			break;
		case 'FnExpr':
			for (const p of node.params) {
				const clean = p.replace(/^\.\.\./, "");
				if (shouldRename(clean)) out.add(clean);
			}
			collectNames(node.body, out);
			break;
		case 'ArrowFn':
			for (const p of node.params) {
				const clean = p.replace(/^\.\.\./, "");
				if (shouldRename(clean)) out.add(clean);
			}
			collectNames(node.body, out);
			break;
		case 'ForInStmt':
			if (shouldRename(node.decl)) out.add(node.decl);
			collectNamesFromNode(node.obj, out);
			collectNames(node.body, out);
			break;
		case 'TryCatchStmt':
			collectNames(node.body, out);
			if (node.param && shouldRename(node.param)) out.add(node.param);
			if (node.handler) collectNames(node.handler, out);
			if (node.finalizer) collectNames(node.finalizer, out);
			break;
		case 'ExprStmt':
			collectNamesFromNode(node.expr, out);
			break;
		case 'Block':
			collectNames(node.body, out);
			break;
		case 'IfStmt':
			collectNamesFromNode(node.test, out);
			collectNames(node.then, out);
			if (node.else) collectNames(node.else, out);
			break;
		case 'WhileStmt':
			collectNamesFromNode(node.test, out);
			collectNames(node.body, out);
			break;
		case 'ForStmt':
			if (node.init) collectNamesFromNode(node.init, out);
			if (node.test) collectNamesFromNode(node.test, out);
			if (node.update) collectNamesFromNode(node.update, out);
			collectNames(node.body, out);
			break;
		case 'SwitchStmt':
			collectNamesFromNode(node.disc, out);
			for (const c of node.cases) collectNamesFromNode(c, out);
			break;
		case 'CaseClause':
			if (node.label) collectNamesFromNode(node.label, out);
			collectNames(node.body, out);
			break;
		case 'ReturnStmt':
			if (node.value) collectNamesFromNode(node.value, out);
			break;
		case 'ThrowStmt':
			collectNamesFromNode(node.value, out);
			break;
		case 'BinOp':
			collectNamesFromNode(node.left, out);
			collectNamesFromNode(node.right, out);
			break;
		case 'UnaryOp':
			collectNamesFromNode(node.expr, out);
			break;
		case 'UpdateExpr':
			collectNamesFromNode(node.arg, out);
			break;
		case 'AssignExpr':
			collectNamesFromNode(node.target, out);
			collectNamesFromNode(node.value, out);
			break;
		case 'CallExpr':
			collectNamesFromNode(node.callee, out);
			for (const a of node.args) collectNamesFromNode(a, out);
			break;
		case 'MemberExpr':
			collectNamesFromNode(node.obj, out);
			break;
		case 'IndexExpr':
			collectNamesFromNode(node.obj, out);
			collectNamesFromNode(node.index, out);
			break;
		case 'TernaryExpr':
			collectNamesFromNode(node.test, out);
			collectNamesFromNode(node.then, out);
			collectNamesFromNode(node.else, out);
			break;
		case 'ArrayExpr':
			for (const e of node.elements) collectNamesFromNode(e, out);
			break;
		case 'ObjectExpr':
			for (const [k, v] of node.entries) {
				if (typeof k !== 'string') collectNamesFromNode(k, out);
				collectNamesFromNode(v, out);
			}
			break;
		case 'NewExpr':
			collectNamesFromNode(node.callee, out);
			for (const a of node.args) collectNamesFromNode(a, out);
			break;
		case 'SequenceExpr':
			for (const e of node.exprs) collectNamesFromNode(e, out);
			break;
		case 'AwaitExpr':
			collectNamesFromNode(node.expr, out);
			break;
		case 'ImportExpr':
			collectNamesFromNode(node.specifier, out);
			break;
		// Leaf nodes and Raw — no names to collect
		case 'Id':
		case 'Literal':
		case 'Raw':
		case 'BreakStmt':
		case 'ContinueStmt':
		case 'DebuggerStmt':
			break;
	}
}

/** Rename identifiers in a node tree using the rename map. */
function renameNode(node: JsNode, map: Map<string, string>): JsNode {
	return walkReplace(node, (n) => {
		switch (n.type) {
			case 'Id': {
				const renamed = map.get(n.name);
				return renamed ? id(renamed) : null;
			}
			case 'VarDecl': {
				const renamed = map.get(n.name);
				return renamed ? { ...n, name: renamed } : null;
			}
			case 'ConstDecl': {
				const renamed = map.get(n.name);
				return renamed ? { ...n, name: renamed } : null;
			}
			case 'FnDecl': {
				const newParams = renameParams(n.params, map);
				return newParams ? { ...n, params: newParams } : null;
			}
			case 'FnExpr': {
				const newParams = renameParams(n.params, map);
				return newParams ? { ...n, params: newParams } : null;
			}
			case 'ArrowFn': {
				const newParams = renameParams(n.params, map);
				return newParams ? { ...n, params: newParams } : null;
			}
			case 'ForInStmt': {
				const renamed = map.get(n.decl);
				return renamed ? { ...n, decl: renamed } : null;
			}
			case 'TryCatchStmt': {
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
function renameParams(params: string[], map: Map<string, string>): string[] | null {
	let changed = false;
	const newParams = params.map(p => {
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
