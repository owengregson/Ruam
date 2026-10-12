/**
 * Expression compilation visitors.
 *
 * Every JS expression type is compiled into a bytecode sequence that
 * leaves exactly one value on the VM stack.  Binary/unary operators map
 * directly to opcodes; calls, member access, and optional chaining
 * require multi-step sequences.
 *
 * @module compiler/visitors/expressions
 */

import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import { Op } from "../opcodes.js";
import type { Emitter } from "../emitter.js";
import type { ScopeAnalyzer } from "../scope.js";
import type { CompileContext } from "../index.js";

// ---------------------------------------------------------------------------
// Operator → opcode lookup tables (shared across multiple functions)
// ---------------------------------------------------------------------------

const BINARY_OP_MAP: Record<string, Op> = {
	"+": Op.ADD,
	"-": Op.SUB,
	"*": Op.MUL,
	"/": Op.DIV,
	"%": Op.MOD,
	"**": Op.POW,
	"&": Op.BIT_AND,
	"|": Op.BIT_OR,
	"^": Op.BIT_XOR,
	"<<": Op.SHL,
	">>": Op.SHR,
	">>>": Op.USHR,
	"==": Op.EQ,
	"!=": Op.NEQ,
	"===": Op.SEQ,
	"!==": Op.SNEQ,
	"<": Op.LT,
	"<=": Op.LTE,
	">": Op.GT,
	">=": Op.GTE,
};

const UNARY_OP_MAP: Record<string, Op> = {
	"-": Op.NEG,
	"+": Op.UNARY_PLUS,
	"~": Op.BIT_NOT,
	"!": Op.NOT,
};

/** Mapping from compound assignment base operator to register-based fused opcode. */
const COMPOUND_REG_OP_MAP: Record<string, Op> = {
	"+": Op.ADD_ASSIGN_REG,
	"-": Op.SUB_ASSIGN_REG,
	"*": Op.MUL_ASSIGN_REG,
	"/": Op.DIV_ASSIGN_REG,
	"%": Op.MOD_ASSIGN_REG,
};

/** Mapping from compound assignment base operator to indexed-slot fused opcode. */
const COMPOUND_SLOT_OP_MAP: Record<string, Op> = {
	"+": Op.ADD_ASSIGN_SLOT,
	"-": Op.SUB_ASSIGN_SLOT,
	"*": Op.MUL_ASSIGN_SLOT,
};

/** Mapping from compound assignment base operator to its fused SCOPED opcode. */
const COMPOUND_SCOPED_OP_MAP: Record<string, Op> = {
	"+": Op.ADD_ASSIGN_SCOPED,
	"-": Op.SUB_ASSIGN_SCOPED,
	"*": Op.MUL_ASSIGN_SCOPED,
	"/": Op.DIV_ASSIGN_SCOPED,
	"%": Op.MOD_ASSIGN_SCOPED,
	"**": Op.POW_ASSIGN_SCOPED,
	"&": Op.BIT_AND_ASSIGN_SCOPED,
	"|": Op.BIT_OR_ASSIGN_SCOPED,
	"^": Op.BIT_XOR_ASSIGN_SCOPED,
	"<<": Op.SHL_ASSIGN_SCOPED,
	">>": Op.SHR_ASSIGN_SCOPED,
	">>>": Op.USHR_ASSIGN_SCOPED,
};

// ---------------------------------------------------------------------------
// Top-level expression dispatcher
// ---------------------------------------------------------------------------

export function compileExpression(
	path: NodePath<t.Expression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	const node = path.node;

	switch (node.type) {
		case "NumericLiteral": {
			const idx = emitter.addNumberConstant(node.value);
			emitter.emit(Op.PUSH_CONST, idx);
			break;
		}

		case "StringLiteral": {
			if (node.value === "") {
				emitter.emit(Op.PUSH_EMPTY_STRING, 0);
				break;
			}
			const idx = emitter.addStringConstant(node.value);
			emitter.emit(Op.PUSH_CONST, idx);
			break;
		}

		case "BooleanLiteral": {
			emitter.emit(node.value ? Op.PUSH_TRUE : Op.PUSH_FALSE, 0);
			break;
		}

		case "NullLiteral": {
			emitter.emit(Op.PUSH_NULL, 0);
			break;
		}

		case "BigIntLiteral": {
			const idx = emitter.addBigIntConstant(node.value);
			emitter.emit(Op.PUSH_CONST, idx);
			break;
		}

		case "RegExpLiteral": {
			const idx = emitter.addRegexConstant(node.pattern, node.flags);
			emitter.emit(Op.PUSH_CONST, idx);
			break;
		}

		case "TemplateLiteral": {
			compileTemplateLiteral(
				path as NodePath<t.TemplateLiteral>,
				emitter,
				scope,
				ctx
			);
			break;
		}

		case "TaggedTemplateExpression": {
			compileTaggedTemplate(
				path as NodePath<t.TaggedTemplateExpression>,
				emitter,
				scope,
				ctx
			);
			break;
		}

		case "Identifier": {
			compileIdentifier(node, emitter, scope, ctx);
			break;
		}

		case "ThisExpression": {
			emitter.emit(Op.PUSH_THIS, 0);
			break;
		}

		case "BinaryExpression": {
			compileBinaryExpression(
				path as NodePath<t.BinaryExpression>,
				emitter,
				scope,
				ctx
			);
			break;
		}

		case "LogicalExpression": {
			compileLogicalExpression(
				path as NodePath<t.LogicalExpression>,
				emitter,
				scope,
				ctx
			);
			break;
		}

		case "UnaryExpression": {
			compileUnaryExpression(
				path as NodePath<t.UnaryExpression>,
				emitter,
				scope,
				ctx
			);
			break;
		}

		case "UpdateExpression": {
			compileUpdateExpression(
				path as NodePath<t.UpdateExpression>,
				emitter,
				scope,
				ctx
			);
			break;
		}

		case "AssignmentExpression": {
			compileAssignmentExpression(
				path as NodePath<t.AssignmentExpression>,
				emitter,
				scope,
				ctx
			);
			break;
		}

		case "CallExpression": {
			compileCallExpression(
				path as NodePath<t.CallExpression>,
				emitter,
				scope,
				ctx
			);
			break;
		}

		case "NewExpression": {
			compileNewExpression(
				path as NodePath<t.NewExpression>,
				emitter,
				scope,
				ctx
			);
			break;
		}

		case "MemberExpression": {
			compileMemberExpression(
				path as NodePath<t.MemberExpression>,
				emitter,
				scope,
				ctx
			);
			break;
		}

		case "OptionalMemberExpression": {
			compileOptionalMemberExpression(
				path as NodePath<t.OptionalMemberExpression>,
				emitter,
				scope,
				ctx
			);
			break;
		}

		case "ConditionalExpression": {
			compileConditionalExpression(
				path as NodePath<t.ConditionalExpression>,
				emitter,
				scope,
				ctx
			);
			break;
		}

		case "SequenceExpression": {
			const exprs = (path as NodePath<t.SequenceExpression>).get(
				"expressions"
			);
			for (let i = 0; i < exprs.length; i++) {
				compileExpression(exprs[i]!, emitter, scope, ctx);
				if (i < exprs.length - 1) emitter.emit(Op.POP, 0);
			}
			break;
		}

		case "ObjectExpression": {
			compileObjectExpression(
				path as NodePath<t.ObjectExpression>,
				emitter,
				scope,
				ctx
			);
			break;
		}

		case "ArrayExpression": {
			compileArrayExpression(
				path as NodePath<t.ArrayExpression>,
				emitter,
				scope,
				ctx
			);
			break;
		}

		case "ArrowFunctionExpression":
		case "FunctionExpression": {
			ctx.compileNestedFunction(
				path as NodePath<t.Function>,
				emitter,
				scope
			);
			break;
		}

		case "ClassExpression": {
			ctx.compileClassExpression(
				path as NodePath<t.ClassExpression>,
				emitter,
				scope
			);
			break;
		}

		case "SpreadElement" as any: {
			compileExpression(
				(path as unknown as NodePath<t.SpreadElement>).get("argument"),
				emitter,
				scope,
				ctx
			);
			emitter.emit(Op.SPREAD_ARRAY, 0);
			break;
		}

		case "YieldExpression": {
			const yieldPath = path as NodePath<t.YieldExpression>;
			if (yieldPath.node.argument) {
				compileExpression(
					yieldPath.get("argument") as NodePath<t.Expression>,
					emitter,
					scope,
					ctx
				);
			} else {
				emitter.emit(Op.PUSH_UNDEFINED, 0);
			}
			emitter.emit(
				yieldPath.node.delegate ? Op.YIELD_DELEGATE : Op.YIELD,
				0
			);
			break;
		}

		case "AwaitExpression": {
			compileExpression(
				(path as NodePath<t.AwaitExpression>).get("argument"),
				emitter,
				scope,
				ctx
			);
			emitter.emit(Op.AWAIT, 0);
			break;
		}

		case "MetaProperty": {
			if (node.meta.name === "new" && node.property.name === "target") {
				emitter.emit(Op.PUSH_NEW_TARGET, 0);
			}
			break;
		}

		case "ParenthesizedExpression": {
			compileExpression(
				(path as NodePath<t.ParenthesizedExpression>).get("expression"),
				emitter,
				scope,
				ctx
			);
			break;
		}

		case "TSAsExpression":
		case "TSNonNullExpression":
		case "TSSatisfiesExpression": {
			compileExpression(
				(path as any).get("expression") as NodePath<t.Expression>,
				emitter,
				scope,
				ctx
			);
			break;
		}

		case "OptionalCallExpression": {
			compileOptionalCallExpression(
				path as NodePath<t.OptionalCallExpression>,
				emitter,
				scope,
				ctx
			);
			break;
		}

		default:
			throw new Error(`Unsupported expression type: ${node.type}`);
	}
}

function compileIdentifier(
	node: t.Identifier,
	emitter: Emitter,
	_scope: ScopeAnalyzer,
	ctx?: CompileContext
): void {
	if (node.name === "undefined") {
		emitter.emit(Op.PUSH_UNDEFINED, 0);
		return;
	}
	if (node.name === "arguments") {
		emitter.emit(Op.PUSH_ARGUMENTS, 0);
		return;
	}

	// Tier 1: Register promotion — use LOAD_REG for non-captured locals
	if (ctx) {
		const reg = ctx.registerMap.get(node.name);
		if (reg !== undefined) {
			emitter.emit(Op.LOAD_REG, reg);
			return;
		}
		// Tier 4: Indexed scope slot for captured locals
		const slot = ctx.slotMap.get(node.name);
		if (slot !== undefined) {
			emitter.emit(Op.LOAD_SLOT, slot);
			return;
		}
	}

	const nameIdx = emitter.addStringConstant(node.name);
	emitter.emit(Op.LOAD_SCOPED, nameIdx);
}

function compileBinaryExpression(
	path: NodePath<t.BinaryExpression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	const node = path.node;

	if (node.operator === "in") {
		compileExpression(
			path.get("left") as NodePath<t.Expression>,
			emitter,
			scope,
			ctx
		);
		compileExpression(path.get("right"), emitter, scope, ctx);
		emitter.emit(Op.IN_OP, 0);
		return;
	}

	if (node.operator === "instanceof") {
		compileExpression(
			path.get("left") as NodePath<t.Expression>,
			emitter,
			scope,
			ctx
		);
		compileExpression(path.get("right"), emitter, scope, ctx);
		emitter.emit(Op.INSTANCEOF, 0);
		return;
	}

	compileExpression(
		path.get("left") as NodePath<t.Expression>,
		emitter,
		scope,
		ctx
	);
	compileExpression(path.get("right"), emitter, scope, ctx);

	const op = BINARY_OP_MAP[node.operator];
	if (op === undefined)
		throw new Error(`Unsupported binary operator: ${node.operator}`);
	emitter.emit(op, 0);
}

function compileLogicalExpression(
	path: NodePath<t.LogicalExpression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	const node = path.node;

	compileExpression(path.get("left"), emitter, scope, ctx);

	if (node.operator === "&&") {
		emitter.emit(Op.DUP, 0);
		const jumpIdx = emitter.emit(Op.JMP_FALSE, 0);
		emitter.emit(Op.POP, 0);
		compileExpression(path.get("right"), emitter, scope, ctx);
		emitter.patchJump(jumpIdx, emitter.ip);
	} else if (node.operator === "||") {
		emitter.emit(Op.DUP, 0);
		const jumpIdx = emitter.emit(Op.JMP_TRUE, 0);
		emitter.emit(Op.POP, 0);
		compileExpression(path.get("right"), emitter, scope, ctx);
		emitter.patchJump(jumpIdx, emitter.ip);
	} else if (node.operator === "??") {
		emitter.emit(Op.DUP, 0);
		const jumpIdx = emitter.emit(Op.JMP_NULLISH, 0);
		const skipIdx = emitter.emit(Op.JMP, 0);
		emitter.patchJump(jumpIdx, emitter.ip);
		emitter.emit(Op.POP, 0);
		compileExpression(path.get("right"), emitter, scope, ctx);
		emitter.patchJump(skipIdx, emitter.ip);
	}
}

function compileUnaryExpression(
	path: NodePath<t.UnaryExpression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	const node = path.node;

	if (node.operator === "typeof") {
		const arg = path.get("argument");
		if (arg.isIdentifier()) {
			const resolved = scope.resolve(arg.node.name);
			if (!resolved || resolved.isOuter) {
				const nameIdx = emitter.addStringConstant(arg.node.name);
				emitter.emit(Op.TYPEOF_GLOBAL, nameIdx);
				return;
			}
		}
		compileExpression(arg, emitter, scope, ctx);
		emitter.emit(Op.TYPEOF, 0);
		return;
	}

	if (node.operator === "delete") {
		const arg = path.get("argument");
		if (arg.isMemberExpression()) {
			const obj = arg.get("object");
			compileExpression(obj, emitter, scope, ctx);
			if (arg.node.computed) {
				compileExpression(
					arg.get("property") as NodePath<t.Expression>,
					emitter,
					scope,
					ctx
				);
				emitter.emit(Op.DELETE_PROP_DYNAMIC, 0);
			} else {
				const nameIdx = emitter.addStringConstant(
					(arg.node.property as t.Identifier).name
				);
				emitter.emit(Op.DELETE_PROP_STATIC, nameIdx);
			}
		} else {
			emitter.emit(Op.PUSH_CONST, emitter.addBooleanConstant(true));
		}
		return;
	}

	if (node.operator === "void") {
		compileExpression(path.get("argument"), emitter, scope, ctx);
		emitter.emit(Op.VOID, 0);
		return;
	}

	compileExpression(path.get("argument"), emitter, scope, ctx);

	const op = UNARY_OP_MAP[node.operator];
	if (op === undefined)
		throw new Error(`Unsupported unary operator: ${node.operator}`);
	emitter.emit(op, 0);
}

function compileUpdateExpression(
	path: NodePath<t.UpdateExpression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	const node = path.node;
	const arg = path.get("argument");

	if (arg.isIdentifier()) {
		// Tier 1: Register promotion for update expressions
		const reg = ctx.registerMap.get(arg.node.name);
		if (reg !== undefined) {
			if (node.prefix && node.operator === "++") {
				emitter.emit(Op.INC_REG, reg);
				emitter.emit(Op.LOAD_REG, reg);
			} else if (node.prefix && node.operator === "--") {
				emitter.emit(Op.DEC_REG, reg);
				emitter.emit(Op.LOAD_REG, reg);
			} else if (!node.prefix && node.operator === "++") {
				emitter.emit(Op.POST_INC_REG, reg);
			} else {
				emitter.emit(Op.POST_DEC_REG, reg);
			}
		} else {
			// Tier 4: Indexed scope slot
			const slot = ctx.slotMap.get(arg.node.name);
			if (slot !== undefined) {
				if (node.prefix && node.operator === "++") {
					emitter.emit(Op.INC_SLOT, slot);
				} else if (node.prefix && node.operator === "--") {
					emitter.emit(Op.DEC_SLOT, slot);
				} else if (!node.prefix && node.operator === "++") {
					emitter.emit(Op.POST_INC_SLOT, slot);
				} else {
					emitter.emit(Op.POST_DEC_SLOT, slot);
				}
			} else {
				// Fallback: scope chain
				const nameIdx = emitter.addStringConstant(arg.node.name);
				if (node.prefix && node.operator === "++") {
					emitter.emit(Op.INC_SCOPED, nameIdx);
				} else if (node.prefix && node.operator === "--") {
					emitter.emit(Op.DEC_SCOPED, nameIdx);
				} else if (!node.prefix && node.operator === "++") {
					emitter.emit(Op.POST_INC_SCOPED, nameIdx);
				} else {
					emitter.emit(Op.POST_DEC_SCOPED, nameIdx);
				}
			}
		}
	} else if (arg.isMemberExpression()) {
		compileMemberExpressionForUpdate(
			arg,
			emitter,
			scope,
			ctx,
			node.operator,
			node.prefix
		);
	}
}

/** Capture a super reference before RHS effects can replace the home prototype. */
function compileSuperReference(
	path: NodePath<t.MemberExpression>, emitter: Emitter,
	scope: ScopeAnalyzer, ctx: CompileContext
): void {
	if (path.node.computed) {
		compileExpression(path.get("property") as NodePath<t.Expression>, emitter, scope, ctx);
	} else {
		emitter.emit(Op.PUSH_CONST, emitter.addStringConstant((path.node.property as t.Identifier).name));
	}
	emitter.emit(Op.GET_SUPER_PROP, -2);
}

function compileMemberExpressionForUpdate(
	path: NodePath<t.MemberExpression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext,
	operator: "++" | "--",
	prefix: boolean
): void {
	// super.prop++ / super[expr]++ — use dedicated super opcodes
	if (path.get("object").isSuper()) {
		compileSuperReference(path, emitter, scope, ctx);
		emitter.emit(Op.DUP, 0);
		emitter.emit(Op.GET_SUPER_PROP, -3);
		const oldValue = prefix ? -1 : scope.registerAllocator.alloc();
		if (!prefix) { emitter.emit(Op.DUP, 0); emitter.emit(Op.STORE_REG, oldValue); }
		emitter.emit(Op.PUSH_CONST, emitter.addNumberConstant(1));
		emitter.emit(operator === "++" ? Op.ADD : Op.SUB, 0);
		emitter.emit(Op.SET_SUPER_PROP, -2);
		if (!prefix) { emitter.emit(Op.POP, 0); emitter.emit(Op.LOAD_REG, oldValue); }
		return;
	}

	// Save obj to register to avoid deep-stack issues with SET_PROP
	const rObj = scope.registerAllocator.alloc();
	compileExpression(path.get("object"), emitter, scope, ctx);
	emitter.emit(Op.STORE_REG, rObj);

	if (path.node.computed) {
		const rKey = scope.registerAllocator.alloc();
		const rNewVal = scope.registerAllocator.alloc();

		compileExpression(
			path.get("property") as NodePath<t.Expression>,
			emitter,
			scope,
			ctx
		);
		emitter.emit(Op.STORE_REG, rKey);

		// Get current value: obj[key]
		emitter.emit(Op.LOAD_REG, rObj);
		emitter.emit(Op.LOAD_REG, rKey);
		emitter.emit(Op.GET_PROP_DYNAMIC, 0);

		// Compute new value, keeping expression result on stack
		if (!prefix) emitter.emit(Op.DUP, 0); // keep oldVal for postfix result
		emitter.emit(Op.PUSH_CONST, emitter.addNumberConstant(1));
		emitter.emit(operator === "++" ? Op.ADD : Op.SUB, 0);
		if (prefix) emitter.emit(Op.DUP, 0); // keep newVal for prefix result

		// Store back: obj[key] = newVal using registers
		emitter.emit(Op.STORE_REG, rNewVal);
		emitter.emit(Op.LOAD_REG, rObj);
		emitter.emit(Op.LOAD_REG, rKey);
		emitter.emit(Op.LOAD_REG, rNewVal);
		emitter.emit(Op.SET_PROP_DYNAMIC, 0);
		emitter.emit(Op.POP, 0); // remove obj pushed by SET_PROP
	} else {
		const nameIdx = emitter.addStringConstant(
			(path.node.property as t.Identifier).name
		);

		// Get current value: obj.prop
		emitter.emit(Op.LOAD_REG, rObj);
		emitter.emit(Op.GET_PROP_STATIC, nameIdx);

		// Compute new value, keeping expression result on stack
		if (!prefix) emitter.emit(Op.DUP, 0);
		emitter.emit(Op.PUSH_CONST, emitter.addNumberConstant(1));
		emitter.emit(operator === "++" ? Op.ADD : Op.SUB, 0);
		if (prefix) emitter.emit(Op.DUP, 0);

		// Store back: obj.prop = newVal
		emitter.emit(Op.LOAD_REG, rObj);
		emitter.emit(Op.SWAP, 0);
		emitter.emit(Op.SET_PROP_STATIC, nameIdx);
		emitter.emit(Op.POP, 0); // remove obj pushed by SET_PROP
	}
}

function compileAssignmentExpression(
	path: NodePath<t.AssignmentExpression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	const node = path.node;
	const left = path.get("left");

	if (
		node.operator !== "=" &&
		node.operator !== "&&=" &&
		node.operator !== "||=" &&
		node.operator !== "??="
	) {
		compileCompoundAssignment(path, emitter, scope, ctx);
		return;
	}

	if (
		node.operator === "&&=" ||
		node.operator === "||=" ||
		node.operator === "??="
	) {
		compileLogicalAssignment(path, emitter, scope, ctx);
		return;
	}

	if (left.isIdentifier()) {
		compileExpression(
			path.get("right") as NodePath<t.Expression>,
			emitter,
			scope,
			ctx
		);
		emitter.emit(Op.DUP, 0);
		const reg = ctx.registerMap.get(left.node.name);
		if (reg !== undefined) {
			emitter.emit(Op.STORE_REG, reg);
		} else {
			const slot = ctx.slotMap.get(left.node.name);
			if (slot !== undefined) {
				emitter.emit(Op.STORE_SLOT, slot);
			} else {
				const nameIdx = emitter.addStringConstant(left.node.name);
				emitter.emit(Op.STORE_SCOPED, nameIdx);
			}
		}
	} else if (left.isMemberExpression() && left.get("object").isSuper()) {
		// super.prop = val / super[expr] = val
		compileSuperReference(left, emitter, scope, ctx);
		compileExpression(
			path.get("right") as NodePath<t.Expression>,
			emitter,
			scope,
			ctx
		);
		emitter.emit(Op.SET_SUPER_PROP, -2);
	} else if (left.isMemberExpression()) {
		if (left.node.computed) {
			// Use registers for computed member to avoid deep-stack ROT3 issues
			const rObj = scope.registerAllocator.alloc();
			const rKey = scope.registerAllocator.alloc();
			const rVal = scope.registerAllocator.alloc();

			compileExpression(left.get("object"), emitter, scope, ctx);
			emitter.emit(Op.STORE_REG, rObj);
			compileExpression(
				left.get("property") as NodePath<t.Expression>,
				emitter,
				scope,
				ctx
			);
			emitter.emit(Op.STORE_REG, rKey);
			compileExpression(
				path.get("right") as NodePath<t.Expression>,
				emitter,
				scope,
				ctx
			);
			emitter.emit(Op.DUP, 0); // expression result stays on stack

			emitter.emit(Op.STORE_REG, rVal);
			emitter.emit(Op.LOAD_REG, rObj);
			emitter.emit(Op.LOAD_REG, rKey);
			emitter.emit(Op.LOAD_REG, rVal);
			emitter.emit(Op.SET_PROP_DYNAMIC, 0);
		} else {
			compileExpression(left.get("object"), emitter, scope, ctx);
			compileExpression(
				path.get("right") as NodePath<t.Expression>,
				emitter,
				scope,
				ctx
			);
			emitter.emit(Op.DUP, 0);
			emitter.emit(Op.ROT3, 0);
			const nameIdx = emitter.addStringConstant(
				(left.node.property as t.Identifier).name
			);
			emitter.emit(Op.SET_PROP_STATIC, nameIdx);
		}
		emitter.emit(Op.POP, 0);
	} else if (left.isArrayPattern() || left.isObjectPattern()) {
		compileExpression(
			path.get("right") as NodePath<t.Expression>,
			emitter,
			scope,
			ctx
		);
		emitter.emit(Op.DUP, 0);
		ctx.compileDestructuring(left as NodePath<t.LVal>, emitter, scope);
	}
}

function compileCompoundAssignment(
	path: NodePath<t.AssignmentExpression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	const node = path.node;
	const left = path.get("left");
	const baseOp = node.operator.slice(0, -1);
	const arithmeticOp = BINARY_OP_MAP[baseOp];
	if (arithmeticOp === undefined)
		throw new Error(`Unsupported compound assignment: ${node.operator}`);

	if (left.isIdentifier()) {
		const reg = ctx.registerMap.get(left.node.name);
		if (reg !== undefined) {
			// Register-promoted compound assignment
			const regCompoundOp = COMPOUND_REG_OP_MAP[baseOp];
			if (regCompoundOp !== undefined) {
				compileExpression(
					path.get("right") as NodePath<t.Expression>,
					emitter,
					scope,
					ctx
				);
				emitter.emit(regCompoundOp, reg);
			} else {
				emitter.emit(Op.LOAD_REG, reg);
				compileExpression(
					path.get("right") as NodePath<t.Expression>,
					emitter,
					scope,
					ctx
				);
				emitter.emit(arithmeticOp, 0);
				emitter.emit(Op.DUP, 0);
				emitter.emit(Op.STORE_REG, reg);
			}
		} else {
			const slot = ctx.slotMap.get(left.node.name);
			if (slot !== undefined) {
				// Indexed scope slot compound assignment
				const slotCompoundOp = COMPOUND_SLOT_OP_MAP[baseOp];
				if (slotCompoundOp !== undefined) {
					compileExpression(
						path.get("right") as NodePath<t.Expression>,
						emitter,
						scope,
						ctx
					);
					emitter.emit(slotCompoundOp, slot);
				} else {
					emitter.emit(Op.LOAD_SLOT, slot);
					compileExpression(
						path.get("right") as NodePath<t.Expression>,
						emitter,
						scope,
						ctx
					);
					emitter.emit(arithmeticOp, 0);
					emitter.emit(Op.DUP, 0);
					emitter.emit(Op.STORE_SLOT, slot);
				}
			} else {
				const nameIdx = emitter.addStringConstant(left.node.name);
				const compoundOp = COMPOUND_SCOPED_OP_MAP[baseOp];
				if (compoundOp !== undefined) {
					compileExpression(
						path.get("right") as NodePath<t.Expression>,
						emitter,
						scope,
						ctx
					);
					emitter.emit(compoundOp, nameIdx);
				} else {
					emitter.emit(Op.LOAD_SCOPED, nameIdx);
					compileExpression(
						path.get("right") as NodePath<t.Expression>,
						emitter,
						scope,
						ctx
					);
					emitter.emit(arithmeticOp, 0);
					emitter.emit(Op.DUP, 0);
					emitter.emit(Op.STORE_SCOPED, nameIdx);
				}
			}
		}
	} else if (left.isMemberExpression() && left.get("object").isSuper()) {
		// super.prop += val / super[expr] += val
		compileSuperReference(left, emitter, scope, ctx);
		emitter.emit(Op.DUP, 0);
		emitter.emit(Op.GET_SUPER_PROP, -3);
		compileExpression(path.get("right") as NodePath<t.Expression>, emitter, scope, ctx);
		emitter.emit(arithmeticOp, 0);
		emitter.emit(Op.SET_SUPER_PROP, -2);
	} else if (left.isMemberExpression()) {
		if (left.node.computed) {
			// Use registers for computed member to avoid deep-stack ROT3 issues
			const rObj = scope.registerAllocator.alloc();
			const rKey = scope.registerAllocator.alloc();
			const rNewVal = scope.registerAllocator.alloc();

			compileExpression(left.get("object"), emitter, scope, ctx);
			emitter.emit(Op.STORE_REG, rObj);
			compileExpression(
				left.get("property") as NodePath<t.Expression>,
				emitter,
				scope,
				ctx
			);
			emitter.emit(Op.STORE_REG, rKey);

			emitter.emit(Op.LOAD_REG, rObj);
			emitter.emit(Op.LOAD_REG, rKey);
			emitter.emit(Op.GET_PROP_DYNAMIC, 0);

			compileExpression(
				path.get("right") as NodePath<t.Expression>,
				emitter,
				scope,
				ctx
			);
			emitter.emit(arithmeticOp, 0);
			emitter.emit(Op.DUP, 0); // expression result

			emitter.emit(Op.STORE_REG, rNewVal);
			emitter.emit(Op.LOAD_REG, rObj);
			emitter.emit(Op.LOAD_REG, rKey);
			emitter.emit(Op.LOAD_REG, rNewVal);
			emitter.emit(Op.SET_PROP_DYNAMIC, 0);
			emitter.emit(Op.POP, 0);
		} else {
			// Static member: ROT3 works fine (only 3 items deep)
			compileExpression(left.get("object"), emitter, scope, ctx);
			emitter.emit(Op.DUP, 0);
			const nameIdx = emitter.addStringConstant(
				(left.node.property as t.Identifier).name
			);
			emitter.emit(Op.GET_PROP_STATIC, nameIdx);

			compileExpression(
				path.get("right") as NodePath<t.Expression>,
				emitter,
				scope,
				ctx
			);
			emitter.emit(arithmeticOp, 0);
			emitter.emit(Op.DUP, 0);
			emitter.emit(Op.ROT3, 0);
			emitter.emit(Op.SET_PROP_STATIC, nameIdx);
			emitter.emit(Op.POP, 0);
		}
	}
}

function compileLogicalAssignment(
	path: NodePath<t.AssignmentExpression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	const node = path.node;
	const left = path.get("left");

	if (!left.isIdentifier())
		throw new Error("Logical assignment only supported for identifiers");

	const varName = left.node.name;
	const reg = ctx.registerMap.get(varName);
	const slot = ctx.slotMap.get(varName);

	// Load current value
	if (reg !== undefined) {
		emitter.emit(Op.LOAD_REG, reg);
	} else if (slot !== undefined) {
		emitter.emit(Op.LOAD_SLOT, slot);
	} else {
		const nameIdx = emitter.addStringConstant(varName);
		emitter.emit(Op.LOAD_SCOPED, nameIdx);
	}
	emitter.emit(Op.DUP, 0);

	let jumpIdx: number;
	if (node.operator === "&&=") {
		jumpIdx = emitter.emit(Op.JMP_FALSE, 0);
	} else if (node.operator === "||=") {
		jumpIdx = emitter.emit(Op.JMP_TRUE, 0);
	} else {
		const nullJump = emitter.emit(Op.JMP_NULLISH, 0);
		jumpIdx = emitter.emit(Op.JMP, 0);
		emitter.patchJump(nullJump, emitter.ip);
	}

	emitter.emit(Op.POP, 0);
	compileExpression(
		path.get("right") as NodePath<t.Expression>,
		emitter,
		scope,
		ctx
	);
	emitter.emit(Op.DUP, 0);

	// Store new value
	if (reg !== undefined) {
		emitter.emit(Op.STORE_REG, reg);
	} else if (slot !== undefined) {
		emitter.emit(Op.STORE_SLOT, slot);
	} else {
		const nameIdx = emitter.addStringConstant(varName);
		emitter.emit(Op.STORE_SCOPED, nameIdx);
	}

	emitter.patchJump(jumpIdx!, emitter.ip);
}

function compileCallExpression(
	path: NodePath<t.CallExpression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	const callee = path.get("callee");
	const args = path.get("arguments");

	if (callee.isMemberExpression() && callee.get("object").isSuper()) {
		// Resolve the method before evaluating arguments: a getter may observe
		// the receiver or throw, and even a static super key can be an accessor.
		// CALL_METHOD also preserves the normal error for a missing callee.
		const hasSpread = args.some((arg) => arg.isSpreadElement());
		{
			emitter.emit(Op.PUSH_THIS, 0);
			if (callee.node.computed) {
				compileExpression(
					callee.get("property") as NodePath<t.Expression>,
					emitter,
					scope,
					ctx
				);
				emitter.emit(Op.GET_SUPER_PROP, -1);
			} else {
				const nameIdx = emitter.addStringConstant(
					(callee.node.property as t.Identifier).name
				);
				emitter.emit(Op.GET_SUPER_PROP, nameIdx);
			}
			emitter.emit(Op.SWAP, 0);

			for (const arg of args) {
				if (arg.isSpreadElement()) {
					compileExpression(arg.get("argument"), emitter, scope, ctx);
					emitter.emit(Op.SPREAD_ARGS, 0);
				} else {
					compileExpression(
						arg as NodePath<t.Expression>,
						emitter,
						scope,
						ctx
					);
				}
			}
			emitter.emit(
				Op.CALL_METHOD,
				hasSpread ? -args.length : args.length
			);
		}
	} else if (callee.isMemberExpression() || callee.isOptionalMemberExpression()) {
		if (callee.isOptionalMemberExpression()) {
			// A parenthesized chain ends its null short circuit, but the
			// resulting member reference still supplies this to a normal call.
			const receiver = scope.registerAllocator.alloc();
			compileOptionalChain(callee, emitter, scope, ctx, receiver);
			emitter.emit(Op.LOAD_REG, receiver);
		} else {
			compileExpression(callee.get("object"), emitter, scope, ctx);
			emitter.emit(Op.DUP, 0);

			if (callee.node.computed) {
				compileExpression(
					callee.get("property") as NodePath<t.Expression>,
					emitter,
					scope,
					ctx
				);
				emitter.emit(Op.GET_PROP_DYNAMIC, 0);
			} else {
				const nameIdx = emitter.addStringConstant(
					(callee.node.property as t.Identifier).name
				);
				emitter.emit(Op.GET_PROP_STATIC, nameIdx);
			}

			emitter.emit(Op.SWAP, 0);

		}

		let hasSpread = false;
		for (const arg of args) {
			if (arg.isSpreadElement()) {
				hasSpread = true;
				compileExpression(arg.get("argument"), emitter, scope, ctx);
				emitter.emit(Op.SPREAD_ARGS, 0);
			} else {
				compileExpression(
					arg as NodePath<t.Expression>,
					emitter,
					scope,
					ctx
				);
			}
		}

		emitter.emit(Op.CALL_METHOD, hasSpread ? -args.length : args.length);
	} else if (callee.isSuper()) {
		for (const arg of args) {
			if (arg.isSpreadElement()) {
				compileExpression(arg.get("argument"), emitter, scope, ctx);
				emitter.emit(Op.SPREAD_ARGS, 0);
			} else {
				compileExpression(
					arg as NodePath<t.Expression>,
					emitter,
					scope,
					ctx
				);
			}
		}
		emitter.emit(Op.SUPER_CALL, args.length);
	} else if (callee.node.type === "Import") {
		// Dynamic import(): import(specifier)
		if (args.length > 0) {
			compileExpression(
				args[0] as NodePath<t.Expression>,
				emitter,
				scope,
				ctx
			);
		} else {
			emitter.emit(Op.PUSH_UNDEFINED, 0);
		}
		emitter.emit(Op.DYNAMIC_IMPORT, 0);
	} else {
		compileExpression(
			callee as NodePath<t.Expression>,
			emitter,
			scope,
			ctx
		);

		let hasSpread = false;
		for (const arg of args) {
			if (arg.isSpreadElement()) {
				hasSpread = true;
				compileExpression(arg.get("argument"), emitter, scope, ctx);
				emitter.emit(Op.SPREAD_ARGS, 0);
			} else {
				compileExpression(
					arg as NodePath<t.Expression>,
					emitter,
					scope,
					ctx
				);
			}
		}

		emitter.emit(Op.CALL, hasSpread ? -args.length : args.length);
	}
}

function compileOptionalCallExpression(
	path: NodePath<t.OptionalCallExpression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	compileOptionalChain(path, emitter, scope, ctx);
}

/**
 * Every ?. in one continuous chain exits the entire chain. Keep method
 * receivers in compiler-owned registers so all exits have one stack value;
 * arguments and computed keys remain after their corresponding null checks.
 * Parentheses end the short-circuit scope but retain a member's receiver.
 */
function compileOptionalChain(
	path: NodePath<t.OptionalMemberExpression | t.OptionalCallExpression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext,
	receiver?: number
): void {
	const nullExits: number[] = [];
	const checkNull = () => {
		emitter.emit(Op.DUP, 0);
		nullExits.push(emitter.emit(Op.JMP_NULLISH, 0));
	};
	const segment = (part: NodePath<t.Expression>, captureReceiver?: number, root = false): void => {
		const optional = part.isOptionalMemberExpression() || part.isOptionalCallExpression();
		if (optional && !root && part.node.extra?.parenthesized) {
			compileOptionalChain(part as NodePath<t.OptionalMemberExpression | t.OptionalCallExpression>, emitter, scope, ctx, captureReceiver);
			return;
		}
		if (part.isOptionalMemberExpression() || (part.isMemberExpression() && captureReceiver !== undefined)) {
			const object = part.get("object") as NodePath<t.Expression>;
			if (object.isSuper()) {
				if (captureReceiver !== undefined) {
					emitter.emit(Op.PUSH_THIS, 0);
					emitter.emit(Op.STORE_REG, captureReceiver);
				}
				compileMemberExpression(part as NodePath<t.MemberExpression>, emitter, scope, ctx);
				return;
			}
			segment(object);
			if (part.isOptionalMemberExpression() && part.node.optional) checkNull();
			if (captureReceiver !== undefined) {
				emitter.emit(Op.DUP, 0);
				emitter.emit(Op.STORE_REG, captureReceiver);
			}
			if (part.node.computed) {
				compileExpression(part.get("property") as NodePath<t.Expression>, emitter, scope, ctx);
				emitter.emit(Op.GET_PROP_DYNAMIC, 0);
			} else {
				emitter.emit(Op.GET_PROP_STATIC, emitter.addStringConstant((part.node.property as t.Identifier).name));
			}
			return;
		}
		if (part.isOptionalCallExpression()) {
			const callee = part.get("callee") as NodePath<t.Expression>;
			const memberCall = callee.isMemberExpression() || callee.isOptionalMemberExpression();
			const callReceiver = memberCall ? scope.registerAllocator.alloc() : undefined;
			segment(callee, callReceiver);
			if (part.node.optional) checkNull();
			if (callReceiver !== undefined) emitter.emit(Op.LOAD_REG, callReceiver);
			let spread = false;
			for (const argument of part.get("arguments")) {
				if (argument.isSpreadElement()) {
					spread = true;
					compileExpression(argument.get("argument"), emitter, scope, ctx);
					emitter.emit(Op.SPREAD_ARGS, 0);
				} else {
					compileExpression(argument as NodePath<t.Expression>, emitter, scope, ctx);
				}
			}
			const count = part.node.arguments.length;
			emitter.emit(memberCall ? Op.CALL_METHOD : Op.CALL, spread ? -count : count);
			return;
		}
		compileExpression(part, emitter, scope, ctx);
	};
	segment(path as NodePath<t.Expression>, receiver, true);
	if (nullExits.length) {
		const end = emitter.emit(Op.JMP, 0);
		for (const jump of nullExits) emitter.patchJump(jump, emitter.ip);
		emitter.emit(Op.POP, 0);
		emitter.emit(Op.PUSH_UNDEFINED, 0);
		emitter.patchJump(end, emitter.ip);
	}
}

function compileNewExpression(
	path: NodePath<t.NewExpression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	compileExpression(
		path.get("callee") as NodePath<t.Expression>,
		emitter,
		scope,
		ctx
	);

	const args = path.get("arguments");
	for (const arg of args) {
		if (arg.isSpreadElement()) {
			compileExpression(arg.get("argument"), emitter, scope, ctx);
			emitter.emit(Op.SPREAD_ARGS, 0);
		} else {
			compileExpression(
				arg as NodePath<t.Expression>,
				emitter,
				scope,
				ctx
			);
		}
	}

	emitter.emit(Op.CALL_NEW, args.length);
}

export function compileMemberExpression(
	path: NodePath<t.MemberExpression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	// super.prop / super[expr] — use dedicated GET_SUPER_PROP opcode
	if (path.get("object").isSuper()) {
		if (path.node.computed) {
			compileExpression(
				path.get("property") as NodePath<t.Expression>,
				emitter,
				scope,
				ctx
			);
			emitter.emit(Op.GET_SUPER_PROP, -1);
		} else {
			const nameIdx = emitter.addStringConstant(
				(path.node.property as t.Identifier).name
			);
			emitter.emit(Op.GET_SUPER_PROP, nameIdx);
		}
		return;
	}

	compileExpression(path.get("object"), emitter, scope, ctx);

	if (path.node.computed) {
		compileExpression(
			path.get("property") as NodePath<t.Expression>,
			emitter,
			scope,
			ctx
		);
		emitter.emit(Op.GET_PROP_DYNAMIC, 0);
	} else {
		const nameIdx = emitter.addStringConstant(
			(path.node.property as t.Identifier).name
		);
		emitter.emit(Op.GET_PROP_STATIC, nameIdx);
	}
}

function compileOptionalMemberExpression(
	path: NodePath<t.OptionalMemberExpression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	compileOptionalChain(path, emitter, scope, ctx);
}

function compileConditionalExpression(
	path: NodePath<t.ConditionalExpression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	compileExpression(path.get("test"), emitter, scope, ctx);
	const falseJump = emitter.emit(Op.JMP_FALSE, 0);
	compileExpression(path.get("consequent"), emitter, scope, ctx);
	const endJump = emitter.emit(Op.JMP, 0);
	emitter.patchJump(falseJump, emitter.ip);
	compileExpression(path.get("alternate"), emitter, scope, ctx);
	emitter.patchJump(endJump, emitter.ip);
}

function compileObjectExpression(
	path: NodePath<t.ObjectExpression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	emitter.emit(Op.NEW_OBJECT, 0);

	for (const prop of path.get("properties")) {
		if (prop.isObjectProperty()) {
			// SET_PROP_STATIC / SET_PROP_DYNAMIC peek (not pop) the target
			// object, leaving it on the stack for the next property. The object
			// already sits beneath the property value, so the previous
			// DUP/.../POP bracketing was redundant — emit `<val> SET_PROP` (and
			// `<key> <val> SET_PROP` for computed) directly. Net stack effect
			// per property is 0, identical to before, but saves two dispatches.
			if (prop.node.computed) {
				compileExpression(
					prop.get("key") as NodePath<t.Expression>,
					emitter,
					scope,
					ctx
				);
				compileExpression(
					prop.get("value") as NodePath<t.Expression>,
					emitter,
					scope,
					ctx
				);
				emitter.emit(Op.SET_PROP_DYNAMIC, 0);
			} else {
				const key = prop.node.key;
				let keyName: string;
				if (key.type === "Identifier") keyName = key.name;
				else if (key.type === "StringLiteral") keyName = key.value;
				else if (key.type === "NumericLiteral")
					keyName = String(key.value);
				else
					throw new Error(`Unsupported object key type: ${key.type}`);

				compileExpression(
					prop.get("value") as NodePath<t.Expression>,
					emitter,
					scope,
					ctx
				);
				const nameIdx = emitter.addStringConstant(keyName);
				emitter.emit(Op.SET_PROP_STATIC, nameIdx);
			}
		} else if (prop.isObjectMethod()) {
			const method = prop as NodePath<t.ObjectMethod>;
			const key = method.node.key;
			if (method.node.computed && key.type !== "StringLiteral" && key.type !== "NumericLiteral") {
				throw new Error(`Unsupported computed object method key: ${key.type}`);
			}
			let keyName: string;
			if (key.type === "Identifier") keyName = key.name;
			else if (key.type === "StringLiteral") keyName = key.value;
			else if (key.type === "NumericLiteral" && method.node.kind === "method" && !method.node.generator)
				keyName = String(key.value);
			else throw new Error(`Unsupported method key type: ${key.type}`);
			const nameIdx = emitter.addStringConstant(keyName);

			if (method.node.kind === "method" && !method.node.generator) {
				// A native concise-method wrapper has no [[Construct]] or own
				// prototype. Capture this object as its home for super access.
				ctx.compileNestedFunction(method, emitter, scope, true);
				emitter.emit(Op.SET_FUNC_NAME, nameIdx);
				const firstOptional = method.node.params.findIndex(
					param => param.type === "AssignmentPattern" || param.type === "RestElement"
				);
				emitter.emit(Op.SET_FUNC_LENGTH, firstOptional < 0 ? method.node.params.length : firstOptional);

				// Literal definitions create own data properties, even when an
				// inherited setter or an earlier accessor uses the same key.
				emitter.emit(Op.NEW_OBJECT, 1); // Null-prototype descriptor, no inherited setters.
				emitter.emit(Op.SWAP, 0);
				emitter.emit(Op.SET_PROP_STATIC, emitter.addStringConstant("value"));
				for (const flag of ["writable", "enumerable", "configurable"]) {
					emitter.emit(Op.PUSH_TRUE, 0);
					emitter.emit(Op.SET_PROP_STATIC, emitter.addStringConstant(flag));
				}
				emitter.emit(Op.PUSH_CONST, nameIdx);
				emitter.emit(Op.SWAP, 0);
				emitter.emit(Op.DEFINE_OWN_PROPERTY, 0);
				continue;
			}

			// Preserve the existing accessor/generator path. Numeric accessors
			// remain unsupported until object-specific descriptors are handled.
			emitter.emit(Op.DUP, 0);
			ctx.compileNestedFunction(method, emitter, scope);
			if (method.node.kind === "get") {
				emitter.emit(Op.DEFINE_GETTER, nameIdx);
			} else if (method.node.kind === "set") {
				emitter.emit(Op.DEFINE_SETTER, nameIdx);
			} else {
				emitter.emit(Op.SET_PROP_STATIC, nameIdx);
			}
			emitter.emit(Op.POP, 0);
		} else if (prop.isSpreadElement()) {
			compileExpression(prop.get("argument"), emitter, scope, ctx);
			emitter.emit(Op.SPREAD_ARRAY, 0);
		}
	}
}

function compileArrayExpression(
	path: NodePath<t.ArrayExpression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	emitter.emit(Op.NEW_ARRAY, 0);

	for (const elem of path.get("elements")) {
		if (elem.node === null) {
			emitter.emit(Op.ARRAY_HOLE, 0);
		} else if (elem.isSpreadElement()) {
			compileExpression(elem.get("argument"), emitter, scope, ctx);
			emitter.emit(Op.SPREAD_ARRAY, 0);
		} else {
			compileExpression(
				elem as NodePath<t.Expression>,
				emitter,
				scope,
				ctx
			);
			emitter.emit(Op.ARRAY_PUSH, 0);
		}
	}
}

function compileTemplateLiteral(
	path: NodePath<t.TemplateLiteral>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	const quasis = path.get("quasis");
	const expressions = path.get("expressions");

	if (expressions.length === 0) {
		const idx = emitter.addStringConstant(
			quasis[0]!.node.value.cooked ?? quasis[0]!.node.value.raw
		);
		emitter.emit(Op.PUSH_CONST, idx);
		return;
	}

	const firstQuasi =
		quasis[0]!.node.value.cooked ?? quasis[0]!.node.value.raw;
	const idx = emitter.addStringConstant(firstQuasi);
	emitter.emit(Op.PUSH_CONST, idx);

	for (let i = 0; i < expressions.length; i++) {
		compileExpression(
			expressions[i] as NodePath<t.Expression>,
			emitter,
			scope,
			ctx
		);
		emitter.emit(Op.ADD, 0);
		const quasi =
			quasis[i + 1]!.node.value.cooked ?? quasis[i + 1]!.node.value.raw;
		const qIdx = emitter.addStringConstant(quasi);
		emitter.emit(Op.PUSH_CONST, qIdx);
		emitter.emit(Op.ADD, 0);
	}
}

function compileTaggedTemplate(
	path: NodePath<t.TaggedTemplateExpression>,
	emitter: Emitter,
	scope: ScopeAnalyzer,
	ctx: CompileContext
): void {
	compileExpression(path.get("tag"), emitter, scope, ctx);

	const quasis = path.get("quasi").get("quasis");
	const expressions = path.get("quasi").get("expressions");

	emitter.emit(Op.NEW_ARRAY, 0);
	for (const q of quasis) {
		const val = q.node.value.cooked ?? q.node.value.raw;
		const idx = emitter.addStringConstant(val);
		emitter.emit(Op.PUSH_CONST, idx);
		emitter.emit(Op.ARRAY_PUSH, 0);
	}

	for (const expr of expressions) {
		compileExpression(expr as NodePath<t.Expression>, emitter, scope, ctx);
	}

	emitter.emit(Op.CALL, 1 + expressions.length);
}
