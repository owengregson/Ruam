/** Conservative syntax admission and small expression/domain proofs.
 * @module regional/compiler/analysis
 */
import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { RegionalCompileError } from "./types.js";

/** Iterate without recursion so the node/depth budget precedes Babel traversal. */
export function inventory(root: t.Node, maxNodes: number): t.Node[] {
	const nodes: t.Node[] = [];
	const pending: { node: t.Node; depth: number }[] = [{ node: root, depth: 0 }];
	while (pending.length) {
		const { node, depth } = pending.pop()!;
		if (nodes.length >= maxNodes || depth > 256) {
			throw new RegionalCompileError("REGIONAL_RESOURCE_LIMIT", "AST node/depth budget exceeded", node.start ?? null);
		}
		nodes.push(node);
		for (const key of t.VISITOR_KEYS[node.type] ?? []) {
			const child = (node as unknown as Record<string, unknown>)[key];
			for (const value of Array.isArray(child) ? child : [child]) {
				if (value && typeof value === "object" && "type" in value) {
					pending.push({ node: value as t.Node, depth: depth + 1 });
				}
			}
		}
	}
	return nodes;
}

const INGRESS_NAMES = new Set(["eval", "Function", "AsyncFunction", "GeneratorFunction", "AsyncGeneratorFunction", "require", "module", "exports"]);
const INTROSPECTION = new Set(["constructor", "caller", "callee"]);
const TIMERS = new Set(["setTimeout", "setInterval"]);

export function staticKey(node: t.MemberExpression | t.OptionalMemberExpression): string | null {
	if (!node.computed && t.isIdentifier(node.property)) return node.property.name;
	if (t.isStringLiteral(node.property) || t.isNumericLiteral(node.property)) return String(node.property.value);
	if (t.isBinaryExpression(node.property, { operator: "+" }) &&
		t.isStringLiteral(node.property.left) && t.isStringLiteral(node.property.right)) {
		return node.property.left.value + node.property.right.value;
	}
	return null;
}

/** Syntax admission is not a proof about capabilities supplied by unknown hosts. */
export function admit(nodes: readonly t.Node[], graphModule: boolean): void {
	const admittedTimerCallees = new Set<t.Node>();
	for (const node of nodes) {
		if (!t.isCallExpression(node) && !t.isOptionalCallExpression(node)) continue;
		if (!t.isFunctionExpression(node.arguments[0]) && !t.isArrowFunctionExpression(node.arguments[0])) continue;
		const callee = node.callee;
		if (t.isIdentifier(callee) && TIMERS.has(callee.name)) admittedTimerCallees.add(callee);
		if ((t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) && TIMERS.has(staticKey(callee) ?? "")) {
			admittedTimerCallees.add(callee);
			if (!callee.computed) admittedTimerCallees.add(callee.property);
		}
	}
	for (const node of nodes) {
		const reject = (message: string, code: "REGIONAL_UNSUPPORTED_SYNTAX" | "REGIONAL_SOURCE_INGRESS" = "REGIONAL_UNSUPPORTED_SYNTAX"): never => {
			throw new RegionalCompileError(code, message, node.start ?? null);
		};
		if (t.isFunction(node) && (node.async || node.generator)) reject("async and generator functions are not admitted");
		if (t.isAwaitExpression(node) || t.isYieldExpression(node) || t.isWithStatement(node)) reject(`${node.type} is not admitted`);
		if (t.isImport(node) || node.type === "ImportExpression") reject("dynamic import requires a later qualified profile", "REGIONAL_SOURCE_INGRESS");
		if (t.isVariableDeclaration(node) && (node.kind === "using" || node.kind === "await using")) reject("explicit resource management is not admitted");
		if ((t.isImportDeclaration(node) || t.isExportAllDeclaration(node) ||
			(t.isExportNamedDeclaration(node) && node.source)) && !graphModule) {
			throw new RegionalCompileError("REGIONAL_MODULE_GRAPH_REQUIRED", "static imports/reexports require the graph compiler", node.start ?? null);
		}
		// Reject aliases as well as direct calls; shadowed names are conservatively rejected.
		if (t.isIdentifier(node) && INGRESS_NAMES.has(node.name)) reject(`source capability ${node.name} is not admitted`, "REGIONAL_SOURCE_INGRESS");
		if (t.isIdentifier(node) && TIMERS.has(node.name) && !admittedTimerCallees.has(node)) {
			reject("timer capabilities may only be used as direct calls with explicit function callbacks", "REGIONAL_SOURCE_INGRESS");
		}
		if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
			const key = staticKey(node);
			if (key !== null && (INGRESS_NAMES.has(key) || INTROSPECTION.has(key))) reject(`reflective/source capability ${key} is not admitted`, "REGIONAL_SOURCE_INGRESS");
			if (key !== null && TIMERS.has(key) && !admittedTimerCallees.has(node)) reject("aliased timer capabilities are not admitted", "REGIONAL_SOURCE_INGRESS");
		}
		if (t.isCallExpression(node) || t.isOptionalCallExpression(node)) {
			const name = t.isIdentifier(node.callee) ? node.callee.name :
				(t.isMemberExpression(node.callee) || t.isOptionalMemberExpression(node.callee)) ? staticKey(node.callee) : null;
			if (name !== null && TIMERS.has(name)) {
				const callback = node.arguments[0];
				if (!t.isFunctionExpression(callback) && !t.isArrowFunctionExpression(callback)) {
					reject("timer callbacks must be explicit functions; string/aliased timer ingress is not admitted", "REGIONAL_SOURCE_INGRESS");
				}
			}
		}
	}
}

const BINARY = new Set(["+", "-", "*", "/", "%", "**", "|", "&", "^", "<<", ">>", ">>>", "===", "!==", "==", "!=", "<", "<=", ">", ">="]);

/** Only expressions over supplied primitive leaves, without calls or property access. */
export function closedExpression(node: t.Node, names: ReadonlySet<string>, numericOnly = false): boolean {
	if (t.isIdentifier(node)) return names.has(node.name);
	if (t.isNumericLiteral(node) || t.isBooleanLiteral(node)) return true;
	if (!numericOnly && (t.isStringLiteral(node) || t.isBigIntLiteral(node) || t.isNullLiteral(node))) return true;
	if (t.isUnaryExpression(node) && ["+", "-", "~", "!", "void", "typeof"].includes(node.operator)) return closedExpression(node.argument, names, numericOnly);
	if (t.isBinaryExpression(node) && BINARY.has(node.operator)) return closedExpression(node.left, names, numericOnly) && closedExpression(node.right, names, numericOnly);
	if (t.isLogicalExpression(node)) return closedExpression(node.left, names, numericOnly) && closedExpression(node.right, names, numericOnly);
	if (t.isConditionalExpression(node)) return closedExpression(node.test, names, numericOnly) && closedExpression(node.consequent, names, numericOnly) && closedExpression(node.alternate, names, numericOnly);
	return false;
}

/** Proves the result is primitive if the argument expression completes normally. */
export function primitiveResult(path: NodePath<t.Node>, seen = new Set<t.Node>()): boolean {
	const node = path.node;
	if (seen.has(node)) return false;
	seen.add(node);
	if (t.isLiteral(node) && !t.isRegExpLiteral(node) && !t.isTemplateLiteral(node)) return true;
	if (t.isUnaryExpression(node) && node.operator !== "delete") return true;
	if (t.isBinaryExpression(node)) return true;
	if (t.isTemplateLiteral(node)) return true;
	if (t.isIdentifier(node)) {
		const binding = path.scope.getBinding(node.name);
		if (!binding?.constant || !binding.path.isVariableDeclarator()) return false;
		// Script vars can change through the global object. Sloppy local vars
		// can change via Annex B block-function assignments that Babel's lexical
		// binding does not record. Neither proves a stable primitive value.
		if (binding.kind === "var") return false;
		const init = binding.path.get("init");
		return Boolean(init.node) && primitiveResult(init as NodePath<t.Node>, seen);
	}
	if (path.isConditionalExpression()) return primitiveResult(path.get("consequent"), new Set(seen)) && primitiveResult(path.get("alternate"), new Set(seen));
	if (path.isLogicalExpression()) return primitiveResult(path.get("left"), new Set(seen)) && primitiveResult(path.get("right"), new Set(seen));
	return false;
}

/** Substitute only an already-checked expression; no binders or property keys occur. */
export function substitute(node: t.Expression, replacements: ReadonlyMap<string, t.Expression>): t.Expression {
	const clone = t.cloneNode(node, true);
	const visit = (value: t.Node): t.Node => {
		if (t.isIdentifier(value) && replacements.has(value.name)) return t.cloneNode(replacements.get(value.name)!, true);
		for (const key of t.VISITOR_KEYS[value.type] ?? []) {
			const record = value as unknown as Record<string, unknown>;
			const child = record[key];
			if (Array.isArray(child)) record[key] = child.map(item => item && typeof item === "object" && "type" in item ? visit(item) : item);
			else if (child && typeof child === "object" && "type" in child) record[key] = visit(child as t.Node);
		}
		return value;
	};
	return visit(clone) as t.Expression;
}
