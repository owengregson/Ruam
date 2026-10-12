/**
 * Experimental scalar lowering of acyclic, synchronous leaf units.
 *
 * Operand/register values exist only in the compiler. Forward labelled blocks
 * replace dispatch; fresh join locals receive edge copies. Observable operations
 * stay at their instruction boundary, including reads, coercions and calls.
 * This is a compiler experiment and carries no source-protection claim.
 *
 * @module ruamvm/native-acyclic
 */
import { Op } from "../compiler/opcodes.js";
import type { RuntimeNames, TempNames } from "../naming/compat-types.js";
import type { NameRegistry } from "../naming/registry.js";
import type { BytecodeUnit } from "../types.js";
import { registry as handlers, makeHandlerCtx } from "./handlers/index.js";
import {
	emitNativeScalarInstruction, inspectNativeScalarInstruction,
	type NativeScalarResult, type NativeScalarStats,
} from "./native-scalar.js";
import {
	type JsNode, type BOpKind, BOp, UOp, arr, assign, bin, breakStmt,
	call, exprStmt, id, ifStmt, index, labeledStmt, lit, mapChildren,
	member, newExpr, returnStmt, throwStmt, un, varDecl,
} from "./nodes.js";

type Decline = Extract<NativeScalarResult, { admitted: false }>;
export interface NativeAcyclicStats extends NativeScalarStats {
	basicBlocks: number;
	joinLocals: number;
	edgeCopies: number;
	callInstructions: number;
	scopeReadInstructions: number;
}
export type NativeAcyclicResult = Decline | {
	admitted: true; body: JsNode[]; stats: NativeAcyclicStats;
};
type Effect = { inputs: number; outputs: number; target?: number; conditional?: boolean; terminal?: boolean };
type BasicBlock = { start: number; end: number; successors: number[]; predecessors: number[] };
type Analysis = Decline | { admitted: true; effects: Effect[]; blocks: BasicBlock[]; maxStackDepth: number };
const POP_BRANCHES = new Set([Op.JMP_TRUE, Op.JMP_FALSE, Op.JMP_NULLISH, Op.JMP_UNDEFINED]);
const KEEP_BRANCHES = new Set([Op.JMP_TRUE_KEEP, Op.JMP_FALSE_KEEP, Op.JMP_NULLISH_KEEP]);
const SCOPE_READS = new Set([Op.LOAD_SCOPED, Op.LOAD_GLOBAL, Op.TYPEOF_GLOBAL]);
const FIXED_CALLS = new Map([[Op.CALL_0, 0], [Op.CALL_1, 1], [Op.CALL_2, 2], [Op.CALL_3, 3]]);
const REG_CONST_BRANCHES = new Map<Op, BOpKind>([
	[Op.REG_LT_CONST_JF, BOp.Lt], [Op.REG_LTE_CONST_JF, BOp.Lte],
	[Op.REG_GT_CONST_JF, BOp.Gt], [Op.REG_GTE_CONST_JF, BOp.Gte],
	[Op.REG_SEQ_CONST_JF, BOp.Seq], [Op.REG_SNEQ_CONST_JF, BOp.Sneq],
]);
const REG_REG_BRANCHES = new Map<Op, BOpKind>([
	[Op.REG_LT_REG_JF, BOp.Lt], [Op.REG_LTE_REG_JF, BOp.Lte],
	[Op.REG_GT_REG_JF, BOp.Gt], [Op.REG_GTE_REG_JF, BOp.Gte],
	[Op.REG_SEQ_REG_JF, BOp.Seq], [Op.REG_SNEQ_REG_JF, BOp.Sneq],
]);
const CONST_BRANCHES = new Map<Op, BOpKind>([
	[Op.CONST_LT_JF, BOp.Lt], [Op.CONST_LTE_JF, BOp.Lte],
	[Op.CONST_GT_JF, BOp.Gt], [Op.CONST_GTE_JF, BOp.Gte],
	[Op.CONST_SEQ_JF, BOp.Seq], [Op.CONST_SNEQ_JF, BOp.Sneq],
]);
// Bound nesting in emitted labelled regions, independently of source size.
const MAX_BLOCKS = 128;

/**
 * Attempt the explicitly enabled acyclic tier; decline before allocating names.
 * The caller owns the same six-argument wrapper and constant descriptor as the
 * residual backend. No local scope, operand array or register array is created.
 * CALL/METHOD retain the current handler's mutable `.apply` behavior; this tier
 * does not repair that inherited source-semantics limitation.
 */
export function tryBuildNativeAcyclicBody(
	unit: BytecodeUnit, names: RuntimeNames, temps: TempNames, registry: NameRegistry,
): NativeAcyclicResult {
	const analysis = inspect(unit);
	if (!analysis.admitted) return analysis;
	const nextName = registry.createDynamicGenerator(`nativeAcyclic:${unit.id}`);
	const pool = nextName();
	const prelude: JsNode[] = [varDecl(pool, member(id(names.unit), "c"))];
	const undefinedValue = un(UOp.Void, lit(0));
	const constant = (n: number): JsNode => index(id(pool), lit(n));
	let scalarLocals = 1, joinLocals = 0, edgeCopies = 0, callInstructions = 0, scopeReadInstructions = 0;
	type Values = { stack: JsNode[]; registers: Map<number, JsNode> };
	type Lowered = { block: BasicBlock; body: JsNode[]; values: Values; test?: JsNode; copies: Map<number, JsNode[]> };
	const lowered = new Map<number, Lowered>();
	const labels = new Map(analysis.blocks.slice(1).map(b => [b.start, nextName()]));
	const sameValue = (a: JsNode, b: JsNode): boolean => a === b
		|| (a.type === "Id" && b.type === "Id" && a.name === b.name)
		|| (a.type === "Literal" && b.type === "Literal" && Object.is(a.value, b.value));
	for (const block of analysis.blocks) {
		const incoming = block.predecessors.map(p => lowered.get(p)!);
		const body: JsNode[] = [];
		const merge = (values: JsNode[]): JsNode => {
			const first = values[0]!;
			if (values.every(v => sameValue(v, first))) return first;
			const name = nextName();
			prelude.push(varDecl(name)); scalarLocals++; joinLocals++;
			// Acyclic order gives each join a fresh destination. It cannot occur
			// in any predecessor value, so these edge copies cannot clobber one
			// another, even when source register bindings have been swapped.
			incoming.forEach((p, i) => {
				const copies = p.copies.get(block.start) ?? [];
				copies.push(exprStmt(assign(id(name), values[i]!)));
				p.copies.set(block.start, copies); edgeCopies++;
			});
			return id(name);
		};
		const stack = incoming.length ? incoming[0]!.values.stack.map((_, i) => merge(incoming.map(p => p.values.stack[i]!))) : [];
		const registers = new Map<number, JsNode>();
		if (incoming.length) {
			const used = new Set(incoming.flatMap(p => [...p.values.registers.keys()]));
			for (const r of used) registers.set(r, merge(incoming.map(p => p.values.registers.get(r) ?? undefinedValue)));
		}
		const reg = (r: number): JsNode => registers.get(r) ?? undefinedValue;
		const save = (value: JsNode): JsNode => {
			const name = nextName(); body.push(varDecl(name, value)); scalarLocals++; return id(name);
		};
		const pop = (): JsNode => stack.pop()!;
		let test: JsNode | undefined;
		for (let ip = block.start; ip < block.end; ip++) {
			const instruction = unit.instructions[ip]!;
			const op = instruction.opcode as Op, operand = instruction.operand;
			if (op === Op.JMP) continue;
			if (POP_BRANCHES.has(op) || KEEP_BRANCHES.has(op)) {
				const value = KEEP_BRANCHES.has(op) ? stack.at(-1)! : pop();
				if (op === Op.JMP_TRUE || op === Op.JMP_TRUE_KEEP) test = value;
				else if (op === Op.JMP_FALSE || op === Op.JMP_FALSE_KEEP) test = un(UOp.Not, value);
				else if (op === Op.JMP_UNDEFINED) test = bin(BOp.Seq, value, undefinedValue);
				else test = bin(BOp.Or, bin(BOp.Seq, value, lit(null)), bin(BOp.Seq, value, undefinedValue));
			} else if (REG_CONST_BRANCHES.has(op)) {
				test = un(UOp.Not, bin(REG_CONST_BRANCHES.get(op)!, reg(operand & 255), constant((operand >>> 8) & 255)));
			} else if (REG_REG_BRANCHES.has(op)) {
				test = un(UOp.Not, bin(REG_REG_BRANCHES.get(op)!, reg(operand & 255), reg((operand >>> 8) & 255)));
			} else if (CONST_BRANCHES.has(op)) {
				test = un(UOp.Not, bin(CONST_BRANCHES.get(op)!, pop(), constant(operand & 65535)));
			} else if (op === Op.THROW) body.push(throwStmt(pop()));
			else if (SCOPE_READS.has(op)) {
				// Adapt the registered value read, preserving its exact ordered
				// get/has/sentinel/global operations and early exits.
				const result = nextName(), exit = nextName(); scalarLocals++;
				body.push(varDecl(result));
				const ctx = makeHandlerCtx(names, temps, false, false, false);
				const locals = new Map<string, string>();
				ctx.C = pool; ctx.SC = names.outer;
				ctx.local = key => { if (!locals.has(key)) locals.set(key, nextName()); return locals.get(key)!; };
				ctx.curSv = key => index(id(names.outer), key ?? id(ctx.local("varName")));
				ctx.push = value => assign(id(result), value);
				const t = ctx.t; ctx.t = key => key === "_g" ? names.globalRef : t(key);
				const adapt = (node: JsNode): JsNode => {
					if (node.type === "Id" && node.name === ctx.O) return lit(operand);
					if (node.type === "BreakStmt") return breakStmt(exit);
					return mapChildren(node, adapt);
				};
				body.push(labeledStmt(exit, handlers.get(op)!(ctx).map(adapt)));
				scalarLocals += locals.size;
				stack.push(id(result)); scopeReadInstructions++;
			} else if (FIXED_CALLS.has(op) || op === Op.CALL || op === Op.CALL_METHOD || op === Op.CALL_NEW) {
				const count = FIXED_CALLS.get(op) ?? operand;
				const args = stack.splice(stack.length - count, count);
				const receiver = op === Op.CALL_METHOD ? pop() : undefinedValue;
				const callee = pop();
				// All value-producing reads have already been materialized. The
				// callee/receiver are never re-read after argument evaluation.
				const value = op === Op.CALL_NEW ? newExpr(callee, args)
					: FIXED_CALLS.has(op) ? call(callee, args)
					: call(member(callee, "apply"), [receiver, arr(...args)]);
				stack.push(save(value)); callInstructions++;
			} else emitNativeScalarInstruction(instruction, names, { body, stack, registers, save, constant });
		}
		lowered.set(block.start, { block, body, values: { stack, registers }, test, copies: new Map() });
	}
	const exit = (from: Lowered, target: number): JsNode[] => target >= unit.instructions.length
		? [returnStmt(undefinedValue)]
		: [...(from.copies.get(target) ?? []), breakStmt(labels.get(target)!)];
	const blockBodies = analysis.blocks.map(block => {
		const current = lowered.get(block.start)!;
		const effect = analysis.effects[block.end - 1]!;
		if (effect.terminal) return current.body;
		if (effect.conditional) return [...current.body, ifStmt(current.test!,
			exit(current, Math.min(effect.target!, unit.instructions.length)), exit(current, block.end))];
		return [...current.body, ...exit(current, Math.min(effect.target ?? block.end, unit.instructions.length))];
	});
	// For B0,B1,B2: L2:{ L1:{ B0 } B1 } B2. Topological order
	// guarantees every break targets an enclosing forward region, never B0.
	let structured = blockBodies[0] ?? [returnStmt(undefinedValue)];
	for (let i = 1; i < analysis.blocks.length; i++) structured = [
		labeledStmt(labels.get(analysis.blocks[i]!.start)!, structured), ...blockBodies[i]!,
	];
	return { admitted: true, body: [...prelude, ...structured], stats: {
		instructionCount: unit.instructions.length, scalarLocals, registerSlotsElided: unit.registerCount,
		maxStackDepth: analysis.maxStackDepth, operandStackArrays: 0, registerArrays: 0,
		basicBlocks: analysis.blocks.length, joinLocals, edgeCopies, callInstructions, scopeReadInstructions,
	} };
}

/** Validate all instructions, then prove stack joins and acyclic reachability. */
function inspect(unit: BytecodeUnit): Analysis {
	const decline = (reason: string, ip?: number): Decline => ({ admitted: false, reason,
		...(ip === undefined ? {} : { instructionIndex: ip, opcode: Op[unit.instructions[ip]!.opcode] }),
	});
	if (unit.isAsync || unit.isGenerator) return decline("suspending-unit");
	if (!unit.scopeless || unit.slotCount !== 0 || unit.childUnits.length !== 0) return decline("scope-or-closure-frame");
	if (unit.usesExceptions || unit.exceptionTable.length !== 0) return decline("exception-frame");
	if (!Number.isSafeInteger(unit.registerCount) || unit.registerCount < 0) return decline("invalid-register-count");
	const effects: Effect[] = [];
	for (let ip = 0; ip < unit.instructions.length; ip++) {
		const { opcode, operand } = unit.instructions[ip]!, op = opcode as Op;
		if (!Number.isSafeInteger(operand)) return decline("invalid-operand", ip);
		const validConstant = (v: number): boolean => v >= 0 && v < unit.constants.length;
		const validReg = (v: number): boolean => v >= 0 && v < unit.registerCount;
		let effect: Effect;
		if (op === Op.JMP || POP_BRANCHES.has(op) || KEEP_BRANCHES.has(op)) {
			if (operand < 0) return decline("invalid-target", ip);
			effect = { inputs: op === Op.JMP ? 0 : 1, outputs: KEEP_BRANCHES.has(op) ? 1 : 0, target: operand, conditional: op !== Op.JMP };
		} else if (REG_CONST_BRANCHES.has(op) || REG_REG_BRANCHES.has(op) || CONST_BRANCHES.has(op)) {
			if (operand < -0x80000000 || operand > 0xffffffff) return decline("invalid-packed-branch", ip);
			if (CONST_BRANCHES.has(op) ? !validConstant(operand & 65535)
				: !validReg(operand & 255) || (REG_CONST_BRANCHES.has(op) ? !validConstant((operand >>> 8) & 255) : !validReg((operand >>> 8) & 255))) return decline("invalid-packed-branch", ip);
			effect = { inputs: CONST_BRANCHES.has(op) ? 1 : 0, outputs: 0, target: operand >>> 16, conditional: true };
		} else if (SCOPE_READS.has(op)) {
			if (!validConstant(operand)) return decline("invalid-scope-constant", ip);
			effect = { inputs: 0, outputs: 1 };
		} else if (FIXED_CALLS.has(op) || op === Op.CALL || op === Op.CALL_METHOD || op === Op.CALL_NEW) {
			if (operand < 0) return decline("spread-call", ip);
			effect = { inputs: (FIXED_CALLS.get(op) ?? operand) + (op === Op.CALL_METHOD ? 2 : 1), outputs: 1 };
		} else if (op === Op.THROW) effect = { inputs: 1, outputs: 0, terminal: true };
		else {
			const scalar = inspectNativeScalarInstruction(unit, ip);
			if (!scalar.admitted) return scalar;
			effect = { inputs: scalar.inputs, outputs: scalar.outputs, terminal: op === Op.RETURN || op === Op.RETURN_VOID };
		}
		effects.push(effect);
	}
	const end = effects.length;
	const successors = effects.map((e, ip) => e.terminal ? [] : e.target === undefined ? [ip + 1]
		: [...new Set([Math.min(e.target, end), ...(e.conditional ? [ip + 1] : [])])]);
	const heights = new Map([[0, 0]]), work = [0];
	let maxStackDepth = 0;
	for (let i = 0; i < work.length; i++) {
		const ip = work[i]!; if (ip === end) continue;
		const effect = effects[ip]!, height = heights.get(ip)!;
		if (height < effect.inputs) return decline("stack-underflow", ip);
		const nextHeight = height - effect.inputs + effect.outputs;
		maxStackDepth = Math.max(maxStackDepth, nextHeight);
		for (const target of successors[ip]!) {
			if (target === end) continue;
			if (heights.has(target)) {
				if (heights.get(target) !== nextHeight) return decline("unequal-stack-merge", target);
			} else { heights.set(target, nextHeight); work.push(target); }
		}
	}
	const leaders = new Set([0, end]);
	effects.forEach((e, ip) => {
		if (e.target !== undefined) { leaders.add(Math.min(e.target, end)); leaders.add(ip + 1); }
		if (e.terminal) leaders.add(ip + 1);
	});
	const ordered = [...leaders].sort((a, b) => a - b);
	const blocks = new Map<number, BasicBlock>();
	for (let i = 0; i < ordered.length - 1; i++) {
		const start = ordered[i]!, stop = ordered[i + 1]!;
		if (heights.has(start)) blocks.set(start, { start, end: stop, successors: successors[stop - 1]!.filter(n => n < end), predecessors: [] });
	}
	if (blocks.size > MAX_BLOCKS) return decline("acyclic-block-limit");
	for (const block of blocks.values()) for (const next of block.successors) blocks.get(next)!.predecessors.push(block.start);
	const degree = new Map([...blocks].map(([start, b]) => [start, b.predecessors.length]));
	const queue = [...blocks.values()].filter(b => !b.predecessors.length);
	for (let i = 0; i < queue.length; i++) for (const next of queue[i]!.successors) {
		degree.set(next, degree.get(next)! - 1);
		if (!degree.get(next)) queue.push(blocks.get(next)!);
	}
	if (queue.length !== blocks.size) return decline("cyclic-control-flow");
	return { admitted: true, effects, blocks: queue, maxStackDepth };
}
