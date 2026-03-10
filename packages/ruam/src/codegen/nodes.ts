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
	| VarDecl | ConstDecl | FnDecl | ExprStmt
	| Block | IfStmt | WhileStmt | ForStmt | ForInStmt
	| SwitchStmt | CaseClause | BreakStmt | ContinueStmt
	| ReturnStmt | ThrowStmt | TryCatchStmt | DebuggerStmt
	| Id | Literal | BinOp | UnaryOp | UpdateExpr
	| AssignExpr | CallExpr | MemberExpr | IndexExpr
	| TernaryExpr | ArrayExpr | ObjectExpr
	| FnExpr | ArrowFn | NewExpr | SequenceExpr
	| AwaitExpr | ImportExpr | RawNode;

// --- Declarations ---

export interface VarDecl { type: 'VarDecl'; name: string; init?: JsNode }
export interface ConstDecl { type: 'ConstDecl'; name: string; init?: JsNode }
export interface FnDecl { type: 'FnDecl'; name: string; params: string[]; body: JsNode[]; async: boolean }

// --- Statements ---

export interface ExprStmt { type: 'ExprStmt'; expr: JsNode }
export interface Block { type: 'Block'; body: JsNode[] }
export interface IfStmt { type: 'IfStmt'; test: JsNode; then: JsNode[]; else?: JsNode[] }
export interface WhileStmt { type: 'WhileStmt'; test: JsNode; body: JsNode[] }
export interface ForStmt { type: 'ForStmt'; init: JsNode | null; test: JsNode | null; update: JsNode | null; body: JsNode[] }
export interface ForInStmt { type: 'ForInStmt'; decl: string; obj: JsNode; body: JsNode[] }
export interface SwitchStmt { type: 'SwitchStmt'; disc: JsNode; cases: CaseClause[] }
export interface CaseClause { type: 'CaseClause'; label: JsNode | null; body: JsNode[] }
export interface BreakStmt { type: 'BreakStmt' }
export interface ContinueStmt { type: 'ContinueStmt' }
export interface ReturnStmt { type: 'ReturnStmt'; value?: JsNode }
export interface ThrowStmt { type: 'ThrowStmt'; value: JsNode }
export interface TryCatchStmt { type: 'TryCatchStmt'; body: JsNode[]; param?: string; handler?: JsNode[]; finalizer?: JsNode[] }
export interface DebuggerStmt { type: 'DebuggerStmt' }

// --- Expressions ---

export interface Id { type: 'Id'; name: string }
export interface Literal { type: 'Literal'; value: string | number | boolean | null | RegExp }
export interface BinOp { type: 'BinOp'; op: string; left: JsNode; right: JsNode }
export interface UnaryOp { type: 'UnaryOp'; op: string; expr: JsNode }
export interface UpdateExpr { type: 'UpdateExpr'; op: '++' | '--'; prefix: boolean; arg: JsNode }
export interface AssignExpr { type: 'AssignExpr'; target: JsNode; value: JsNode; op?: string }
export interface CallExpr { type: 'CallExpr'; callee: JsNode; args: JsNode[] }
export interface MemberExpr { type: 'MemberExpr'; obj: JsNode; prop: string }
export interface IndexExpr { type: 'IndexExpr'; obj: JsNode; index: JsNode }
export interface TernaryExpr { type: 'TernaryExpr'; test: JsNode; then: JsNode; else: JsNode }
export interface ArrayExpr { type: 'ArrayExpr'; elements: JsNode[] }
export interface ObjectExpr { type: 'ObjectExpr'; entries: [string | JsNode, JsNode][] }
export interface FnExpr { type: 'FnExpr'; name?: string; params: string[]; body: JsNode[]; async: boolean }
export interface ArrowFn { type: 'ArrowFn'; params: string[]; body: JsNode[]; async: boolean }
export interface NewExpr { type: 'NewExpr'; callee: JsNode; args: JsNode[] }
export interface SequenceExpr { type: 'SequenceExpr'; exprs: JsNode[] }
export interface AwaitExpr { type: 'AwaitExpr'; expr: JsNode }
export interface ImportExpr { type: 'ImportExpr'; specifier: JsNode }
export interface RawNode { type: 'Raw'; code: string }

// --- Factory functions ---

export function fn(name: string, params: string[], body: JsNode[], opts?: { async?: boolean }): FnDecl {
	return { type: 'FnDecl', name, params, body, async: opts?.async ?? false };
}

export function varDecl(name: string, init?: JsNode): VarDecl {
	return { type: 'VarDecl', name, init };
}

export function constDecl(name: string, init?: JsNode): ConstDecl {
	return { type: 'ConstDecl', name, init };
}

export function exprStmt(expr: JsNode): ExprStmt {
	return { type: 'ExprStmt', expr };
}

export function block(...body: JsNode[]): Block {
	return { type: 'Block', body };
}

export function ifStmt(test: JsNode, then: JsNode[], els?: JsNode[]): IfStmt {
	return { type: 'IfStmt', test, then, else: els };
}

export function whileStmt(test: JsNode, body: JsNode[]): WhileStmt {
	return { type: 'WhileStmt', test, body };
}

export function forStmt(init: JsNode | null, test: JsNode | null, update: JsNode | null, body: JsNode[]): ForStmt {
	return { type: 'ForStmt', init, test, update, body };
}

export function forIn(decl: string, obj: JsNode, body: JsNode[]): ForInStmt {
	return { type: 'ForInStmt', decl, obj, body };
}

export function switchStmt(disc: JsNode, cases: CaseClause[]): SwitchStmt {
	return { type: 'SwitchStmt', disc, cases };
}

export function caseClause(label: JsNode | null, body: JsNode[]): CaseClause {
	return { type: 'CaseClause', label, body };
}

export function breakStmt(): BreakStmt { return { type: 'BreakStmt' }; }
export function continueStmt(): ContinueStmt { return { type: 'ContinueStmt' }; }

export function returnStmt(value?: JsNode): ReturnStmt {
	return { type: 'ReturnStmt', value };
}

export function throwStmt(value: JsNode): ThrowStmt {
	return { type: 'ThrowStmt', value };
}

export function tryCatch(body: JsNode[], param?: string, handler?: JsNode[], finalizer?: JsNode[]): TryCatchStmt {
	return { type: 'TryCatchStmt', body, param, handler, finalizer };
}

export function debuggerStmt(): DebuggerStmt { return { type: 'DebuggerStmt' }; }

export function id(name: string): Id { return { type: 'Id', name }; }

export function lit(value: string | number | boolean | null | RegExp): Literal {
	return { type: 'Literal', value };
}

export function bin(op: string, left: JsNode, right: JsNode): BinOp {
	return { type: 'BinOp', op, left, right };
}

export function un(op: string, expr: JsNode): UnaryOp {
	return { type: 'UnaryOp', op, expr };
}

export function update(op: '++' | '--', prefix: boolean, arg: JsNode): UpdateExpr {
	return { type: 'UpdateExpr', op, prefix, arg };
}

export function assign(target: JsNode, value: JsNode, op?: string): AssignExpr {
	return { type: 'AssignExpr', target, value, op };
}

export function call(callee: JsNode, args: JsNode[]): CallExpr {
	return { type: 'CallExpr', callee, args };
}

export function member(obj: JsNode, prop: string): MemberExpr {
	return { type: 'MemberExpr', obj, prop };
}

export function index(obj: JsNode, idx: JsNode): IndexExpr {
	return { type: 'IndexExpr', obj, index: idx };
}

export function ternary(test: JsNode, then: JsNode, els: JsNode): TernaryExpr {
	return { type: 'TernaryExpr', test, then, else: els };
}

export function arr(...elements: JsNode[]): ArrayExpr {
	return { type: 'ArrayExpr', elements };
}

export function obj(...entries: [string | JsNode, JsNode][]): ObjectExpr {
	return { type: 'ObjectExpr', entries };
}

export function fnExpr(name: string | undefined, params: string[], body: JsNode[], opts?: { async?: boolean }): FnExpr {
	return { type: 'FnExpr', name, params, body, async: opts?.async ?? false };
}

export function arrowFn(params: string[], body: JsNode[], opts?: { async?: boolean }): ArrowFn {
	return { type: 'ArrowFn', params, body, async: opts?.async ?? false };
}

export function newExpr(callee: JsNode, args: JsNode[]): NewExpr {
	return { type: 'NewExpr', callee, args };
}

export function seq(...exprs: JsNode[]): SequenceExpr {
	return { type: 'SequenceExpr', exprs };
}

export function awaitExpr(expr: JsNode): AwaitExpr {
	return { type: 'AwaitExpr', expr };
}

export function importExpr(specifier: JsNode): ImportExpr {
	return { type: 'ImportExpr', specifier };
}

export function raw(code: string): RawNode {
	return { type: 'Raw', code };
}

// --- Convenience ---

export function iife(body: Block): CallExpr {
	return call(fnExpr(undefined, [], body.body), []);
}

export function rest(name: string): string {
	return `...${name}`;
}
