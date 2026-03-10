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
