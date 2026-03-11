/**
 * AST → JS source emitter.
 *
 * Single recursive function that serializes JsNode trees to minified JS.
 * Produces compact output with precedence-aware parenthesization.
 *
 * @module codegen/emit
 */

import type { JsNode, ReturnStmt } from "./nodes.js";
import { assertNever } from "./nodes.js";

// --- Operator precedence table (higher = tighter binding) ---

const PREC: Record<string, number> = {
	",": 1,
	"=": 2,
	"+=": 2,
	"-=": 2,
	"*=": 2,
	"/=": 2,
	"%=": 2,
	"**=": 2,
	"<<=": 2,
	">>=": 2,
	">>>=": 2,
	"&=": 2,
	"|=": 2,
	"^=": 2,
	"&&=": 2,
	"||=": 2,
	"??=": 2,
	"?": 3,
	"||": 4,
	"??": 4,
	"&&": 5,
	"|": 6,
	"^": 7,
	"&": 8,
	"==": 9,
	"!=": 9,
	"===": 9,
	"!==": 9,
	"<": 10,
	">": 10,
	"<=": 10,
	">=": 10,
	in: 10,
	instanceof: 10,
	"<<": 11,
	">>": 11,
	">>>": 11,
	"+": 12,
	"-": 12,
	"*": 13,
	"/": 13,
	"%": 13,
	"**": 14,
};

/** Keyword binary operators that need spaces around them. */
const KEYWORD_BINOP = new Set(["in", "instanceof"]);

/** Keyword unary operators that need a space after them. */
const KEYWORD_UNOP = new Set(["typeof", "void", "delete"]);

/**
 * Whether a unary operator's operand needs parentheses.
 *
 * Unary `!`, `~`, `+`, `-` bind tighter than any binary operator, so
 * `!a<b` parses as `(!a)<b`. When the operand is a binary, ternary,
 * assignment, or sequence expression we must add parens: `!(a<b)`.
 */
function needsUnaryParens(expr: JsNode): boolean {
	return (
		expr.type === "BinOp" ||
		expr.type === "TernaryExpr" ||
		expr.type === "AssignExpr" ||
		expr.type === "SequenceExpr"
	);
}

function needsParens(
	child: JsNode,
	parentOp: string,
	isRight: boolean
): boolean {
	let cp: number;
	if (child.type === "BinOp") cp = PREC[child.op] ?? 0;
	else if (child.type === "AssignExpr")
		cp = PREC[child.op ? child.op + "=" : "="] ?? 2;
	else if (child.type === "TernaryExpr") cp = PREC["?"] ?? 3;
	else if (child.type === "SequenceExpr") cp = PREC[","] ?? 1;
	else return false;
	const pp = PREC[parentOp] ?? 0;
	if (cp < pp) return true;
	if (cp === pp && isRight) return true;
	return false;
}

/**
 * Serialize a JS AST node to minified source code.
 */
export function emit(node: JsNode): string {
	switch (node.type) {
		// --- Declarations ---
		case "VarDecl":
			return `var ${node.name}${node.init ? "=" + emit(node.init) : ""}`;
		case "ConstDecl":
			return `const ${node.name}${
				node.init ? "=" + emit(node.init) : ""
			}`;
		case "FnDecl":
			return `${node.async ? "async " : ""}function ${
				node.name
			}(${node.params.join(",")}){${emitBody(node.body)}}`;

		// --- Statements ---
		case "ExprStmt":
			return emit(node.expr) + ";";
		case "Block":
			return `{${emitBody(node.body)}}`;
		case "IfStmt":
			return `if(${emit(node.test)}){${emitBody(node.then)}}${
				node.else ? `else{${emitBody(node.else)}}` : ""
			}`;
		case "WhileStmt":
			return `while(${emit(node.test)}){${emitBody(node.body)}}`;
		case "ForStmt":
			return `for(${node.init ? emit(node.init) : ""};${
				node.test ? emit(node.test) : ""
			};${node.update ? emit(node.update) : ""}){${emitBody(node.body)}}`;
		case "ForInStmt":
			return `for(var ${node.decl} in ${emit(node.obj)}){${emitBody(
				node.body
			)}}`;
		case "SwitchStmt":
			return `switch(${emit(node.disc)}){${node.cases
				.map((c) => emit(c))
				.join("")}}`;
		case "CaseClause":
			return node.label === null
				? `default:{${emitBody(node.body)}}`
				: `case ${emit(node.label)}:{${emitBody(node.body)}}`;
		case "BreakStmt":
			return "break;";
		case "ContinueStmt":
			return "continue;";
		case "ReturnStmt":
			return node.value ? `return ${emit(node.value)};` : "return;";
		case "ThrowStmt":
			return `throw ${emit(node.value)};`;
		case "TryCatchStmt": {
			let s = `try{${emitBody(node.body)}}`;
			if (node.handler) {
				s += node.param
					? `catch(${node.param}){${emitBody(node.handler)}}`
					: `catch{${emitBody(node.handler)}}`;
			}
			if (node.finalizer) s += `finally{${emitBody(node.finalizer)}}`;
			return s;
		}
		case "DebuggerStmt":
			return "debugger;";

		// --- Expressions ---
		case "Id":
			return node.name;
		case "Literal":
			return emitLiteral(node.value);
		case "BinOp": {
			const left = needsParens(node.left, node.op, false)
				? `(${emit(node.left)})`
				: emit(node.left);
			const right = needsParens(node.right, node.op, true)
				? `(${emit(node.right)})`
				: emit(node.right);
			if (KEYWORD_BINOP.has(node.op))
				return `${left} ${node.op} ${right}`;
			return `${left}${node.op}${right}`;
		}
		case "UnaryOp": {
			if (KEYWORD_UNOP.has(node.op)) {
				const inner = emit(node.expr);
				return `${node.op} ${needsUnaryParens(node.expr) ? `(${inner})` : inner}`;
			}
			// Prevent --x from becoming ---x (double minus + negate)
			if (
				node.op === "-" &&
				node.expr.type === "UnaryOp" &&
				node.expr.op === "-"
			)
				return `-(${emit(node.expr)})`;
			const inner = emit(node.expr);
			return `${node.op}${needsUnaryParens(node.expr) ? `(${inner})` : inner}`;
		}
		case "UpdateExpr":
			return node.prefix
				? `${node.op}${emit(node.arg)}`
				: `${emit(node.arg)}${node.op}`;
		case "AssignExpr":
			return `${emit(node.target)}${node.op ?? ""}=${emit(node.value)}`;
		case "CallExpr": {
			let callee = emit(node.callee);
			// Wrap function/arrow expressions in parens when used as callee (IIFE)
			if (node.callee.type === "FnExpr" || node.callee.type === "ArrowFn")
				callee = `(${callee})`;
			return `${callee}(${node.args.map((a) => emit(a)).join(",")})`;
		}
		case "MemberExpr":
			return `${emitObj(node.obj)}.${node.prop}`;
		case "IndexExpr":
			return `${emitObj(node.obj)}[${emit(node.index)}]`;
		case "TernaryExpr":
			return `${emit(node.test)}?${emit(node.then)}:${emit(node.else)}`;
		case "ArrayExpr":
			return `[${node.elements.map((e) => emit(e)).join(",")}]`;
		case "ObjectExpr":
			return `{${node.entries
				.map(
					([k, v]) =>
						`${typeof k === "string" ? k : `[${emit(k)}]`}:${emit(
							v
						)}`
				)
				.join(",")}}`;
		case "FnExpr":
			return `${node.async ? "async " : ""}function${
				node.name ? " " + node.name : ""
			}(${node.params.join(",")}){${emitBody(node.body)}}`;
		case "ArrowFn": {
			const params =
				node.params.length === 1 &&
				!node.params[0]!.startsWith("...") &&
				!node.async
					? node.params[0]!
					: `(${node.params.join(",")})`;
			let body: string;
			if (
				node.body.length === 1 &&
				node.body[0]!.type === "ReturnStmt" &&
				(node.body[0] as ReturnStmt).value
			) {
				const val = (node.body[0] as ReturnStmt).value!;
				const expr = emit(val);
				body = val.type === "ObjectExpr" ? `(${expr})` : expr;
			} else {
				body = `{${emitBody(node.body)}}`;
			}
			return `${node.async ? "async " : ""}${params}=>${body}`;
		}
		case "NewExpr":
			return `new ${emit(node.callee)}(${node.args
				.map((a) => emit(a))
				.join(",")})`;
		case "SequenceExpr":
			return `(${node.exprs.map((e) => emit(e)).join(",")})`;
		case "AwaitExpr":
			return `await ${emit(node.expr)}`;
		case "ImportExpr":
			return `import(${emit(node.specifier)})`;
		case "StackPush":
			return `${node.S}[++${node.P}]=${emit(node.value)}`;
		case "StackPop":
			return `${node.S}[${node.P}--]`;
		case "StackPeek":
			return `${node.S}[${node.P}]`;
		default:
			return assertNever(node);
	}
}

/** Emit a statement list (body of function, block, etc). */
function emitBody(stmts: JsNode[]): string {
	return stmts.map((s) => emitStmt(s)).join("");
}

/** Emit a single statement — adds semicolons where needed. */
function emitStmt(node: JsNode): string {
	switch (node.type) {
		case "VarDecl":
		case "ConstDecl":
			return emit(node) + ";";
		case "FnDecl":
		case "Block":
		case "IfStmt":
		case "WhileStmt":
		case "ForStmt":
		case "ForInStmt":
		case "SwitchStmt":
		case "TryCatchStmt":
			// These already include their own structure (no trailing semicolon needed)
			return emit(node);
		case "ExprStmt":
		case "BreakStmt":
		case "ContinueStmt":
		case "ReturnStmt":
		case "ThrowStmt":
		case "DebuggerStmt":
			// These already emit with trailing semicolons
			return emit(node);
		case "CaseClause":
			return emit(node);
		default:
			// Expression used as statement — wrap in ExprStmt logic
			return emit(node) + ";";
	}
}

/** Emit an object expression part, wrapping in parens if needed. */
function emitObj(obj: JsNode): string {
	const s = emit(obj);
	// Numeric literals need parens before .prop: (0).toString
	if (obj.type === "Literal" && typeof obj.value === "number")
		return `(${s})`;
	// Call expressions and other low-precedence expressions are fine as-is
	return s;
}

/** Serialize a literal value. */
function emitLiteral(value: string | number | boolean | null | RegExp): string {
	if (value === null) return "null";
	if (value === true) return "true";
	if (value === false) return "false";
	if (typeof value === "number") {
		if (Object.is(value, -0)) return "-0";
		if (value === Infinity) return "Infinity";
		if (value === -Infinity) return "-Infinity";
		if (Number.isNaN(value)) return "NaN";
		return String(value);
	}
	if (typeof value === "string") {
		// Escape and single-quote
		return (
			"'" +
			value
				.replace(/\\/g, "\\\\")
				.replace(/'/g, "\\'")
				.replace(/\n/g, "\\n")
				.replace(/\r/g, "\\r")
				.replace(/\t/g, "\\t")
				.replace(/\0/g, "\\0")
				.replace(/\u2028/g, "\\u2028")
				.replace(/\u2029/g, "\\u2029") +
			"'"
		);
	}
	if (value instanceof RegExp) return value.toString();
	return String(value);
}
