/**
 * JS AST node types and factory functions for runtime code generation.
 *
 * Replaces raw template literal strings with a structured tree representation.
 * Factory function names are intentionally short — they're called thousands of times.
 *
 * @module codegen/nodes
 */

// --- Node type discriminants ---

export type JsNode =
	| VarDecl
	| ConstDecl
	| FnDecl
	| ExprStmt
	| Block
	| IfStmt
	| WhileStmt
	| ForStmt
	| ForInStmt
	| SwitchStmt
	| CaseClause
	| BreakStmt
	| ContinueStmt
	| ReturnStmt
	| ThrowStmt
	| TryCatchStmt
	| DebuggerStmt
	| Id
	| Literal
	| BinOp
	| UnaryOp
	| UpdateExpr
	| AssignExpr
	| CallExpr
	| MemberExpr
	| IndexExpr
	| TernaryExpr
	| ArrayExpr
	| ObjectExpr
	| FnExpr
	| ArrowFn
	| NewExpr
	| SequenceExpr
	| AwaitExpr
	| ImportExpr
	| StackPush
	| StackPop
	| StackPeek;

// --- Declarations ---

export interface VarDecl {
	type: "VarDecl";
	name: string;
	init?: JsNode;
}
export interface ConstDecl {
	type: "ConstDecl";
	name: string;
	init?: JsNode;
}
export interface FnDecl {
	type: "FnDecl";
	name: string;
	params: string[];
	body: JsNode[];
	async: boolean;
}

// --- Statements ---

export interface ExprStmt {
	type: "ExprStmt";
	expr: JsNode;
}
export interface Block {
	type: "Block";
	body: JsNode[];
}
export interface IfStmt {
	type: "IfStmt";
	test: JsNode;
	then: JsNode[];
	else?: JsNode[];
}
export interface WhileStmt {
	type: "WhileStmt";
	test: JsNode;
	body: JsNode[];
}
export interface ForStmt {
	type: "ForStmt";
	init: JsNode | null;
	test: JsNode | null;
	update: JsNode | null;
	body: JsNode[];
}
export interface ForInStmt {
	type: "ForInStmt";
	decl: string;
	obj: JsNode;
	body: JsNode[];
}
export interface SwitchStmt {
	type: "SwitchStmt";
	disc: JsNode;
	cases: CaseClause[];
}
export interface CaseClause {
	type: "CaseClause";
	label: JsNode | null;
	body: JsNode[];
}
export interface BreakStmt {
	type: "BreakStmt";
}
export interface ContinueStmt {
	type: "ContinueStmt";
}
export interface ReturnStmt {
	type: "ReturnStmt";
	value?: JsNode;
}
export interface ThrowStmt {
	type: "ThrowStmt";
	value: JsNode;
}
export interface TryCatchStmt {
	type: "TryCatchStmt";
	body: JsNode[];
	param?: string;
	handler?: JsNode[];
	finalizer?: JsNode[];
}
export interface DebuggerStmt {
	type: "DebuggerStmt";
}

// --- Expressions ---

export interface Id {
	type: "Id";
	name: string;
}
export interface Literal {
	type: "Literal";
	value: string | number | boolean | null | RegExp;
}
export interface BinOp {
	type: "BinOp";
	op: string;
	left: JsNode;
	right: JsNode;
}
export interface UnaryOp {
	type: "UnaryOp";
	op: string;
	expr: JsNode;
}
export interface UpdateExpr {
	type: "UpdateExpr";
	op: "++" | "--";
	prefix: boolean;
	arg: JsNode;
}
export interface AssignExpr {
	type: "AssignExpr";
	target: JsNode;
	value: JsNode;
	op?: string;
}
export interface CallExpr {
	type: "CallExpr";
	callee: JsNode;
	args: JsNode[];
}
export interface MemberExpr {
	type: "MemberExpr";
	obj: JsNode;
	prop: string;
}
export interface IndexExpr {
	type: "IndexExpr";
	obj: JsNode;
	index: JsNode;
}
export interface TernaryExpr {
	type: "TernaryExpr";
	test: JsNode;
	then: JsNode;
	else: JsNode;
}
export interface ArrayExpr {
	type: "ArrayExpr";
	elements: JsNode[];
}
export interface ObjectExpr {
	type: "ObjectExpr";
	entries: [string | JsNode, JsNode][];
}
export interface FnExpr {
	type: "FnExpr";
	name?: string;
	params: string[];
	body: JsNode[];
	async: boolean;
}
export interface ArrowFn {
	type: "ArrowFn";
	params: string[];
	body: JsNode[];
	async: boolean;
}
export interface NewExpr {
	type: "NewExpr";
	callee: JsNode;
	args: JsNode[];
}
export interface SequenceExpr {
	type: "SequenceExpr";
	exprs: JsNode[];
}
export interface AwaitExpr {
	type: "AwaitExpr";
	expr: JsNode;
}
export interface ImportExpr {
	type: "ImportExpr";
	specifier: JsNode;
}
// --- Stack operations (emit directly as S[++P]=expr, S[P--], S[P]) ---

export interface StackPush {
	type: "StackPush";
	value: JsNode;
	S: string;
	P: string;
}
export interface StackPop {
	type: "StackPop";
	S: string;
	P: string;
}
export interface StackPeek {
	type: "StackPeek";
	S: string;
	P: string;
}

// --- Factory functions ---

export function fn(
	name: string,
	params: string[],
	body: JsNode[],
	opts?: { async?: boolean }
): FnDecl {
	return { type: "FnDecl", name, params, body, async: opts?.async ?? false };
}

export function varDecl(name: string, init?: JsNode): VarDecl {
	return { type: "VarDecl", name, init };
}

export function constDecl(name: string, init?: JsNode): ConstDecl {
	return { type: "ConstDecl", name, init };
}

export function exprStmt(expr: JsNode): ExprStmt {
	return { type: "ExprStmt", expr };
}

export function block(...body: JsNode[]): Block {
	return { type: "Block", body };
}

export function ifStmt(test: JsNode, then: JsNode[], els?: JsNode[]): IfStmt {
	return { type: "IfStmt", test, then, else: els };
}

export function whileStmt(test: JsNode, body: JsNode[]): WhileStmt {
	return { type: "WhileStmt", test, body };
}

export function forStmt(
	init: JsNode | null,
	test: JsNode | null,
	update: JsNode | null,
	body: JsNode[]
): ForStmt {
	return { type: "ForStmt", init, test, update, body };
}

export function forIn(decl: string, obj: JsNode, body: JsNode[]): ForInStmt {
	return { type: "ForInStmt", decl, obj, body };
}

export function switchStmt(disc: JsNode, cases: CaseClause[]): SwitchStmt {
	return { type: "SwitchStmt", disc, cases };
}

export function caseClause(label: JsNode | null, body: JsNode[]): CaseClause {
	return { type: "CaseClause", label, body };
}

export function breakStmt(): BreakStmt {
	return { type: "BreakStmt" };
}
export function continueStmt(): ContinueStmt {
	return { type: "ContinueStmt" };
}

export function returnStmt(value?: JsNode): ReturnStmt {
	return { type: "ReturnStmt", value };
}

export function throwStmt(value: JsNode): ThrowStmt {
	return { type: "ThrowStmt", value };
}

export function tryCatch(
	body: JsNode[],
	param?: string,
	handler?: JsNode[],
	finalizer?: JsNode[]
): TryCatchStmt {
	return { type: "TryCatchStmt", body, param, handler, finalizer };
}

export function debuggerStmt(): DebuggerStmt {
	return { type: "DebuggerStmt" };
}

export function id(name: string): Id {
	return { type: "Id", name };
}

export function lit(value: string | number | boolean | null | RegExp): Literal {
	return { type: "Literal", value };
}

export function bin(op: string, left: JsNode, right: JsNode): BinOp {
	return { type: "BinOp", op, left, right };
}

export function un(op: string, expr: JsNode): UnaryOp {
	return { type: "UnaryOp", op, expr };
}

export function update(
	op: "++" | "--",
	prefix: boolean,
	arg: JsNode
): UpdateExpr {
	return { type: "UpdateExpr", op, prefix, arg };
}

export function assign(target: JsNode, value: JsNode, op?: string): AssignExpr {
	return { type: "AssignExpr", target, value, op };
}

export function call(callee: JsNode, args: JsNode[]): CallExpr {
	return { type: "CallExpr", callee, args };
}

export function member(obj: JsNode, prop: string): MemberExpr {
	return { type: "MemberExpr", obj, prop };
}

export function index(obj: JsNode, idx: JsNode): IndexExpr {
	return { type: "IndexExpr", obj, index: idx };
}

export function ternary(test: JsNode, then: JsNode, els: JsNode): TernaryExpr {
	return { type: "TernaryExpr", test, then, else: els };
}

export function arr(...elements: JsNode[]): ArrayExpr {
	return { type: "ArrayExpr", elements };
}

export function obj(...entries: [string | JsNode, JsNode][]): ObjectExpr {
	return { type: "ObjectExpr", entries };
}

export function fnExpr(
	name: string | undefined,
	params: string[],
	body: JsNode[],
	opts?: { async?: boolean }
): FnExpr {
	return { type: "FnExpr", name, params, body, async: opts?.async ?? false };
}

export function arrowFn(
	params: string[],
	body: JsNode[],
	opts?: { async?: boolean }
): ArrowFn {
	return { type: "ArrowFn", params, body, async: opts?.async ?? false };
}

export function newExpr(callee: JsNode, args: JsNode[]): NewExpr {
	return { type: "NewExpr", callee, args };
}

export function seq(...exprs: JsNode[]): SequenceExpr {
	return { type: "SequenceExpr", exprs };
}

export function awaitExpr(expr: JsNode): AwaitExpr {
	return { type: "AwaitExpr", expr };
}

export function importExpr(specifier: JsNode): ImportExpr {
	return { type: "ImportExpr", specifier };
}

export function stackPush(S: string, P: string, value: JsNode): StackPush {
	return { type: "StackPush", value, S, P };
}
export function stackPop(S: string, P: string): StackPop {
	return { type: "StackPop", S, P };
}
export function stackPeek(S: string, P: string): StackPeek {
	return { type: "StackPeek", S, P };
}

// --- Convenience ---

export function iife(body: Block): CallExpr {
	return call(fnExpr(undefined, [], body.body), []);
}

export function rest(name: string): string {
	return `...${name}`;
}

// --- Reflective child metadata ---

/**
 * Field kind for child metadata.
 * 'node' = single JsNode, 'nodes' = JsNode[],
 * '?' suffix = nullable/optional (may be null or undefined).
 */
type FieldKind = "node" | "node?" | "nodes" | "nodes?";

/**
 * Metadata map declaring which fields of each node type contain child JsNode(s).
 * Fields not listed here are data (strings, booleans, etc.) and are NOT traversed.
 *
 * This is the single source of truth for structural traversal — `mapChildren()`
 * uses this table instead of a hand-written 36-case switch.
 */
export const CHILD_FIELDS: Record<JsNode["type"], Record<string, FieldKind>> = {
	// Declarations
	VarDecl: { init: "node?" },
	ConstDecl: { init: "node?" },
	FnDecl: { body: "nodes" },
	// Statements
	ExprStmt: { expr: "node" },
	Block: { body: "nodes" },
	IfStmt: { test: "node", then: "nodes", else: "nodes?" },
	WhileStmt: { test: "node", body: "nodes" },
	ForStmt: { init: "node?", test: "node?", update: "node?", body: "nodes" },
	ForInStmt: { obj: "node", body: "nodes" },
	SwitchStmt: { disc: "node", cases: "nodes" },
	CaseClause: { label: "node?", body: "nodes" },
	BreakStmt: {},
	ContinueStmt: {},
	ReturnStmt: { value: "node?" },
	ThrowStmt: { value: "node" },
	TryCatchStmt: { body: "nodes", handler: "nodes?", finalizer: "nodes?" },
	DebuggerStmt: {},
	// Expressions
	Id: {},
	Literal: {},
	BinOp: { left: "node", right: "node" },
	UnaryOp: { expr: "node" },
	UpdateExpr: { arg: "node" },
	AssignExpr: { target: "node", value: "node" },
	CallExpr: { callee: "node", args: "nodes" },
	MemberExpr: { obj: "node" },
	IndexExpr: { obj: "node", index: "node" },
	TernaryExpr: { test: "node", then: "node", else: "node" },
	ArrayExpr: { elements: "nodes" },
	ObjectExpr: {}, // special: entries are [string|JsNode, JsNode] tuples — handled in mapChildren
	FnExpr: { body: "nodes" },
	ArrowFn: { body: "nodes" },
	NewExpr: { callee: "node", args: "nodes" },
	SequenceExpr: { exprs: "nodes" },
	AwaitExpr: { expr: "node" },
	ImportExpr: { specifier: "node" },
	StackPush: { value: "node" },
	StackPop: {},
	StackPeek: {},
};

/**
 * Apply a mapping function to every child JsNode of the given node.
 * Uses the CHILD_FIELDS metadata table instead of a hand-written switch.
 * Returns a structurally-equal new node if any child changed, or the original if not.
 *
 * ObjectExpr entries are handled specially (tuple array with string|JsNode keys).
 *
 * @param node - The node whose children to map
 * @param fn - The mapping function applied to each child
 * @returns The original node (if unchanged) or a new node with mapped children
 */
export function mapChildren(
	node: JsNode,
	fn: (child: JsNode) => JsNode
): JsNode {
	// Special case: ObjectExpr has [string|JsNode, JsNode] tuple entries
	if (node.type === "ObjectExpr") {
		let changed = false;
		const mapped = node.entries.map(([k, v]) => {
			const nk = typeof k === "string" ? k : fn(k);
			const nv = fn(v);
			if (nk !== k || nv !== v) changed = true;
			return [nk, nv] as [string | JsNode, JsNode];
		});
		return changed ? { ...node, entries: mapped } : node;
	}

	const schema = CHILD_FIELDS[node.type];
	const entries = Object.entries(schema);
	if (entries.length === 0) return node;

	const result = { ...node } as unknown as Record<string, unknown>;
	let changed = false;
	for (const [field, kind] of entries) {
		const val = (node as unknown as Record<string, unknown>)[field];
		if (val == null) continue;
		if (kind === "node" || kind === "node?") {
			const mapped = fn(val as JsNode);
			if (mapped !== val) {
				result[field] = mapped;
				changed = true;
			}
		} else {
			// 'nodes' or 'nodes?'
			const arr = val as JsNode[];
			const mapped = arr.map(fn);
			if (mapped.some((v, i) => v !== arr[i])) {
				result[field] = mapped;
				changed = true;
			}
		}
	}
	return changed ? (result as unknown as JsNode) : node;
}

// --- Exhaustive visitor types ---

/** All discriminant type strings in the JsNode union. */
export type NodeType = JsNode["type"];

/** Extract a specific node type from the union by its discriminant. */
export type NodeOfType<T extends NodeType> = Extract<JsNode, { type: T }>;

/**
 * A visitor object that must have a handler for every node type.
 * TypeScript enforces exhaustiveness at compile time — adding a new node type
 * to the JsNode union immediately causes errors in all ExhaustiveVisitor objects.
 */
export type ExhaustiveVisitor<R> = {
	[K in NodeType]: (node: NodeOfType<K>) => R;
};

/**
 * Dispatch a node to the appropriate handler in an exhaustive visitor.
 *
 * @param node - The node to visit
 * @param v - The visitor object with a handler for every node type
 * @returns The result of the matching handler
 */
export function visit<R>(node: JsNode, v: ExhaustiveVisitor<R>): R {
	return (v[node.type] as (node: JsNode) => R)(node);
}

/**
 * Compile-time exhaustiveness assertion for switch default cases.
 * Passing a value here that isn't `never` produces a TypeScript error,
 * catching unhandled node types at compile time.
 */
export function assertNever(x: never): never {
	throw new Error(`Unhandled node type: ${(x as { type: string }).type}`);
}
