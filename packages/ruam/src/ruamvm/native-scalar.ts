/**
 * Experimental straight-line scalar lowering of logical compiler instructions.
 *
 * The operand stack and register map exist only at build time. Every operation
 * that can observe source values is evaluated into a fresh local, in instruction
 * order. Duplicating a value never duplicates its getter or coercion. This is a
 * code-generation optimization, not algorithm/state replacement or protection.
 */
import { Op } from "../compiler/opcodes.js";
import type { RuntimeNames } from "../naming/compat-types.js";
import type { NameRegistry } from "../naming/registry.js";
import type { BytecodeUnit } from "../types.js";
import {
	type JsNode, type BOpKind, type UOpKind,
	BOp, UOp, bin, id, index, lit, member, returnStmt, ternary, un, varDecl,
} from "./nodes.js";

export interface NativeScalarStats {
	instructionCount: number;
	/** Generated locals, including the existing constant-pool reference. */
	scalarLocals: number;
	registerSlotsElided: number;
	maxStackDepth: number;
	/** Both counts describe allocations in this body, not its caller or values. */
	operandStackArrays: 0;
	registerArrays: 0;
}

export type NativeScalarResult =
	| { admitted: true; body: JsNode[]; stats: NativeScalarStats }
	| { admitted: false; reason: string; instructionIndex?: number; opcode?: string };

export type ScalarNames = Pick<RuntimeNames, "unit" | "args" | "tVal" | "nTgt">;

const BINARY = new Map<Op, BOpKind>([
	[Op.ADD, BOp.Add], [Op.SUB, BOp.Sub], [Op.MUL, BOp.Mul],
	[Op.DIV, BOp.Div], [Op.MOD, BOp.Mod], [Op.POW, BOp.Pow],
	[Op.BIT_AND, BOp.BitAnd], [Op.BIT_OR, BOp.BitOr], [Op.BIT_XOR, BOp.BitXor],
	[Op.SHL, BOp.Shl], [Op.SHR, BOp.Shr], [Op.USHR, BOp.Ushr],
	[Op.EQ, BOp.Eq], [Op.NEQ, BOp.Neq], [Op.SEQ, BOp.Seq], [Op.SNEQ, BOp.Sneq],
	[Op.LT, BOp.Lt], [Op.LTE, BOp.Lte], [Op.GT, BOp.Gt], [Op.GTE, BOp.Gte],
	[Op.IN_OP, BOp.In], [Op.INSTANCEOF, BOp.Instanceof],
]);
const UNARY = new Map<Op, UOpKind>([
	[Op.NEG, UOp.Neg], [Op.UNARY_PLUS, UOp.Pos], [Op.BIT_NOT, UOp.BitNot],
	[Op.NOT, UOp.Not], [Op.TYPEOF, UOp.Typeof], [Op.VOID, UOp.Void],
]);
const REGISTER_BINARY = new Map<Op, BOpKind>([
	[Op.REG_ADD, BOp.Add], [Op.REG_SUB, BOp.Sub], [Op.REG_MUL, BOp.Mul],
	[Op.REG_DIV, BOp.Div], [Op.REG_MOD, BOp.Mod], [Op.REG_LT, BOp.Lt],
	[Op.REG_LTE, BOp.Lte], [Op.REG_GT, BOp.Gt], [Op.REG_GTE, BOp.Gte],
	[Op.REG_SEQ, BOp.Seq], [Op.REG_SNEQ, BOp.Sneq],
]);
const REGISTER_CONSTANT = new Map<Op, BOpKind>([
	[Op.REG_CONST_SUB, BOp.Sub], [Op.REG_CONST_MUL, BOp.Mul], [Op.REG_CONST_MOD, BOp.Mod],
]);
const ASSIGN_REGISTER = new Map<Op, BOpKind>([
	[Op.ADD_ASSIGN_REG, BOp.Add], [Op.SUB_ASSIGN_REG, BOp.Sub],
	[Op.MUL_ASSIGN_REG, BOp.Mul], [Op.DIV_ASSIGN_REG, BOp.Div], [Op.MOD_ASSIGN_REG, BOp.Mod],
]);
const ASSIGN_REGISTER_VOID = new Map<Op, BOpKind>([
	[Op.REG_ADD_ASSIGN_VOID, BOp.Add], [Op.REG_SUB_ASSIGN_VOID, BOp.Sub],
	[Op.REG_MUL_ASSIGN_VOID, BOp.Mul], [Op.REG_DIV_ASSIGN_VOID, BOp.Div], [Op.REG_MOD_ASSIGN_VOID, BOp.Mod],
]);
const SIMPLE_PUSHES = new Set<Op>([
	Op.PUSH_UNDEFINED, Op.PUSH_NULL, Op.PUSH_TRUE, Op.PUSH_FALSE,
	Op.PUSH_ZERO, Op.PUSH_ONE, Op.PUSH_NEG_ONE, Op.PUSH_EMPTY_STRING,
	Op.PUSH_NAN, Op.PUSH_INFINITY, Op.PUSH_NEG_INFINITY,
	Op.PUSH_THIS, Op.PUSH_NEW_TARGET, Op.GET_ARG_COUNT,
]);

/**
 * Return an admitted body or an explicit residual-backend decision.
 *
 * Call only on logical, unmutated units. The caller owns the existing six-arg
 * wrapper, recursion depth guard/finally, this boxing and lazy constant pool.
 * This body neither constructs constants nor changes their sharing/lifetime.
 * Async, scope frames, closures, calls, branches, writes and exception routing
 * remain in the existing backend. Ordinary getters/proxies and coercions are
 * allowed: preserving their exact positions does not require assuming purity.
 * Source text, stack traces and resource consumption are not preserved by code
 * generation; the current compiler's accepted-language limitations still apply.
 */
export function tryBuildNativeScalarBody(
	unit: BytecodeUnit,
	names: ScalarNames,
	nameRegistry: NameRegistry,
): NativeScalarResult {
	const analysis = inspect(unit);
	if (!analysis.admitted) return analysis;
	const nextName = nameRegistry.createDynamicGenerator(`nativeScalar:${unit.id}`);
	const pool = nextName();
	const body: JsNode[] = [varDecl(pool, member(id(names.unit), "c"))];
	const stack: JsNode[] = [];
	const registers = new Map<number, JsNode>();
	let scalarLocals = 1;
	const constant = (number: number): JsNode => index(id(pool), lit(number));
	const save = (value: JsNode): JsNode => {
		const name = nextName();
		body.push(varDecl(name, value));
		scalarLocals++;
		return id(name);
	};
	for (const instruction of unit.instructions) {
		emitNativeScalarInstruction(instruction, names, { body, stack, registers, save, constant });
	}
	return { admitted: true, body, stats: {
		instructionCount: unit.instructions.length, scalarLocals,
		registerSlotsElided: unit.registerCount, maxStackDepth: analysis.maxStackDepth,
		operandStackArrays: 0, registerArrays: 0,
	} };
}

/** Build-time values shared by straight-line and acyclic scalar lowerings. */
export interface NativeScalarFrame {
	body: JsNode[];
	stack: JsNode[];
	registers: Map<number, JsNode>;
	save: (value: JsNode) => JsNode;
	constant: (index: number) => JsNode;
}

/** Emit one previously validated scalar instruction, preserving its value boundary. */
export function emitNativeScalarInstruction(
	{ opcode, operand }: BytecodeUnit["instructions"][number],
	names: ScalarNames,
	{ body, stack, registers, save, constant }: NativeScalarFrame,
): void {
	const undefinedValue = (): JsNode => un(UOp.Void, lit(0));
	const reg = (number: number): JsNode => registers.get(number) ?? undefinedValue();
	const push = (value: JsNode): void => { stack.push(save(value)); };
	const pop = (): JsNode => stack.pop()!;
	// Build-time bindings can still be literal/unary expressions (void 0, -1).
	// Materialize them in operand/reference positions: member access otherwise
	// changes void's grouping, exponentiation rejects an ungrouped unary left
	// operand, and adjacent minus tokens can become a decrement token. Captured
	// identifiers need no extra local. These copies perform no source operation.
	const valueRef = (value: JsNode): JsNode => value.type === "Id" ? value : save(value);
	const op = opcode as Op;
	const binary = BINARY.get(op);
	const unary = UNARY.get(op);
	const registerBinary = REGISTER_BINARY.get(op);
	const registerConstant = REGISTER_CONSTANT.get(op);
	const registerAssign = ASSIGN_REGISTER.get(op) ?? ASSIGN_REGISTER_VOID.get(op);
	const lo = operand & 0xffff;
	const hi = operand >>> 16;
	if (binary !== undefined) {
		const right = pop(); const left = pop();
		push(bin(binary, valueRef(left), valueRef(right)));
	} else if (unary !== undefined) push(un(unary, valueRef(pop())));
	else if (registerBinary !== undefined) push(bin(registerBinary, valueRef(reg(lo)), valueRef(reg(hi))));
	else if (registerConstant !== undefined) push(bin(registerConstant, valueRef(reg(lo)), valueRef(constant(hi))));
	else if (registerAssign !== undefined) {
		const value = save(bin(registerAssign, valueRef(reg(operand)), valueRef(pop())));
		registers.set(operand, value);
		if (ASSIGN_REGISTER.has(op)) stack.push(value);
	} else switch (op) {
		case Op.NOP: break;
		case Op.PUSH_CONST: push(constant(operand)); break;
		case Op.PUSH_UNDEFINED: stack.push(undefinedValue()); break;
		case Op.PUSH_NULL: stack.push(lit(null)); break;
		case Op.PUSH_TRUE: stack.push(lit(true)); break;
		case Op.PUSH_FALSE: stack.push(lit(false)); break;
		case Op.PUSH_ZERO: stack.push(lit(0)); break;
		case Op.PUSH_ONE: stack.push(lit(1)); break;
		case Op.PUSH_NEG_ONE: stack.push(lit(-1)); break;
		case Op.PUSH_EMPTY_STRING: stack.push(lit("")); break;
		case Op.PUSH_NAN: stack.push(bin(BOp.Div, lit(0), lit(0))); break;
		case Op.PUSH_INFINITY: stack.push(bin(BOp.Div, lit(1), lit(0))); break;
		case Op.PUSH_NEG_INFINITY: stack.push(bin(BOp.Div, lit(-1), lit(0))); break;
		case Op.PUSH_THIS: stack.push(id(names.tVal)); break;
		case Op.PUSH_NEW_TARGET: stack.push(id(names.nTgt)); break;
		case Op.GET_ARG_COUNT: push(member(id(names.args), "length")); break;
		case Op.LOAD_ARG:
			push(ternary(bin(BOp.Lt, lit(operand), member(id(names.args), "length")),
				index(id(names.args), lit(operand)), undefinedValue())); break;
		case Op.LOAD_REG: stack.push(reg(operand)); break;
		case Op.STORE_REG: registers.set(operand, pop()); break;
		case Op.POP: pop(); break;
		case Op.POP_N: stack.length -= operand; break;
		case Op.DUP: stack.push(stack.at(-1)!); break;
		case Op.DUP2: stack.push(...stack.slice(-2)); break;
		case Op.SWAP: { const b = pop(); const a = pop(); stack.push(b, a); break; }
		case Op.ROT3: { const c = pop(); const b = pop(); const a = pop(); stack.push(c, a, b); break; }
		case Op.ROT4: { const d = pop(); const c = pop(); const b = pop(); const a = pop(); stack.push(d, a, b, c); break; }
		case Op.PICK: stack.push(stack[stack.length - 1 - operand]!); break;
		case Op.REG_ADD_CONST: registers.set(lo, save(bin(BOp.Add, valueRef(reg(lo)), valueRef(constant(hi))))); break;
		case Op.GET_PROP_STATIC: push(index(valueRef(pop()), constant(operand))); break;
		case Op.GET_PROP_DYNAMIC: { const key = pop(); push(index(valueRef(pop()), key)); break; }
		case Op.REG_GET_PROP: push(index(valueRef(reg(lo)), constant(hi))); break;
		case Op.REG_GET_PROP_DYN: push(index(valueRef(reg(lo)), reg(hi))); break;
		case Op.IDX_REG: push(index(valueRef(pop()), reg(operand))); break;
		case Op.RETURN: body.push(returnStmt(pop())); break;
		case Op.RETURN_VOID: body.push(returnStmt(undefinedValue())); break;
		default: throw new Error(`Scalar admission/lowering disagreement: ${op}`);
	}
}

type Inspection = { admitted: true; maxStackDepth: number } | Extract<NativeScalarResult, { admitted: false }>;

/** Positive grammar plus operand/stack validation; never evaluate source values. */
function inspect(unit: BytecodeUnit): Inspection {
	const decline = (reason: string, ip?: number): Inspection => ({
		admitted: false, reason, ...(ip === undefined ? {} : {
			instructionIndex: ip, opcode: Op[unit.instructions[ip]!.opcode] ?? String(unit.instructions[ip]!.opcode),
		}),
	});
	if (unit.isAsync || unit.isGenerator) return decline("suspending-unit");
	if (!unit.scopeless || unit.slotCount !== 0 || unit.childUnits.length !== 0) return decline("scope-or-closure-frame");
	if (unit.usesExceptions || unit.exceptionTable.length !== 0 || Object.keys(unit.jumpTable).length !== 0) return decline("control-flow-metadata");
	if (!Number.isSafeInteger(unit.registerCount) || unit.registerCount < 0) return decline("invalid-register-count");
	let depth = 0, maxStackDepth = 0;
	for (let ip = 0; ip < unit.instructions.length; ip++) {
		const effect = inspectNativeScalarInstruction(unit, ip);
		if (!effect.admitted) return effect;
		const { inputs, outputs } = effect;
		const opcode = unit.instructions[ip]!.opcode;
		if ((opcode === Op.RETURN || opcode === Op.RETURN_VOID) && ip !== unit.instructions.length - 1) return decline("instructions-after-return", ip);
		if (depth < inputs) return decline("stack-underflow", ip);
		depth += outputs - inputs;
		maxStackDepth = Math.max(maxStackDepth, depth);
	}
	const last = unit.instructions.at(-1)?.opcode;
	if (last !== Op.RETURN && last !== Op.RETURN_VOID) return decline("missing-terminal-return");
	return { admitted: true, maxStackDepth };
}

/** Positive scalar opcode/operand grammar, independent of control-flow shape. */
export function inspectNativeScalarInstruction(unit: BytecodeUnit, ip: number):
	| { admitted: true; inputs: number; outputs: number }
	| Extract<NativeScalarResult, { admitted: false }> {
	const decline = (reason: string, instructionIndex: number): Extract<NativeScalarResult, { admitted: false }> => ({
		admitted: false, reason, instructionIndex,
		opcode: Op[unit.instructions[instructionIndex]!.opcode] ?? String(unit.instructions[instructionIndex]!.opcode),
	});
	const validReg = (n: number): boolean => n >= 0 && n < unit.registerCount;
	const validConstant = (n: number): boolean => n >= 0 && n < unit.constants.length;
	const { opcode, operand } = unit.instructions[ip]!;
	const op = opcode as Op;
	if (!Number.isSafeInteger(operand)) return decline("invalid-operand", ip);
	let inputs = 0, outputs = 0;
	if (BINARY.has(op)) { inputs = 2; outputs = 1; }
	else if (UNARY.has(op)) { inputs = 1; outputs = 1; }
	else if (SIMPLE_PUSHES.has(op)) outputs = 1;
	else if (REGISTER_BINARY.has(op) || op === Op.REG_GET_PROP_DYN) {
		if (operand < -0x80000000 || operand > 0xffffffff || !validReg(operand & 0xffff) || !validReg(operand >>> 16)) return decline("invalid-packed-register", ip);
		outputs = 1;
	} else if (REGISTER_CONSTANT.has(op) || op === Op.REG_GET_PROP || op === Op.REG_ADD_CONST) {
		if (operand < -0x80000000 || operand > 0xffffffff || !validReg(operand & 0xffff) || !validConstant(operand >>> 16)) return decline("invalid-packed-constant", ip);
		outputs = op === Op.REG_ADD_CONST ? 0 : 1;
	} else if (ASSIGN_REGISTER.has(op) || ASSIGN_REGISTER_VOID.has(op)) {
		if (!validReg(operand)) return decline("invalid-register", ip);
		inputs = 1; outputs = ASSIGN_REGISTER.has(op) ? 1 : 0;
	} else switch (op) {
		case Op.NOP: break;
		case Op.PUSH_CONST:
		case Op.GET_PROP_STATIC:
			if (!validConstant(operand)) return decline("invalid-constant", ip);
			inputs = op === Op.GET_PROP_STATIC ? 1 : 0; outputs = 1; break;
		case Op.LOAD_ARG:
			if (operand < 0) return decline("invalid-argument", ip);
			outputs = 1; break;
		case Op.LOAD_REG:
		case Op.STORE_REG:
		case Op.IDX_REG:
			if (!validReg(operand)) return decline("invalid-register", ip);
			inputs = op === Op.LOAD_REG ? 0 : 1; outputs = op === Op.STORE_REG ? 0 : 1; break;
		case Op.POP: inputs = 1; break;
		case Op.POP_N:
			if (operand < 0) return decline("invalid-stack-count", ip);
			inputs = operand; break;
		case Op.DUP: inputs = 1; outputs = 2; break;
		case Op.DUP2: inputs = 2; outputs = 4; break;
		case Op.SWAP: inputs = 2; outputs = 2; break;
		case Op.ROT3: inputs = 3; outputs = 3; break;
		case Op.ROT4: inputs = 4; outputs = 4; break;
		case Op.PICK:
			if (operand < 0) return decline("invalid-stack-count", ip);
			inputs = operand + 1; outputs = inputs + 1; break;
		case Op.GET_PROP_DYNAMIC: inputs = 2; outputs = 1; break;
		case Op.RETURN:
		case Op.RETURN_VOID:
			inputs = op === Op.RETURN ? 1 : 0; break;
		default: return decline("unsupported-opcode", ip);
	}
	return { admitted: true, inputs, outputs };
}
