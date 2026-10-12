/**
 * Experimental ahead-of-time specialization of logical compiler instructions.
 *
 * The output contains ordinary per-unit JavaScript functions and a basic-block
 * dispatcher. It contains no serialized instructions, opcode table, or decoder.
 * Stack, register, scope and completion representations are intentionally kept
 * for compatibility. Their presence means this is compiler infrastructure, not
 * an established protection improvement or a fully structured native backend.
 *
 * @module ruamvm/native-specialization
 */

import type { BytecodeUnit, ConstantPoolEntry } from "../types.js";
import type { RuntimeNames, TempNames } from "../naming/compat-types.js";
import type { NameRegistry } from "../naming/registry.js";
import { deriveSeed } from "../naming/scope.js";
import { GLOBAL_IDENTIFIERS, VM_MAX_RECURSION_DEPTH } from "../constants.js";
import { isName, resolveName, RestParam } from "../naming/token.js";
import { ALL_JUMP_OPS, PACKED_JUMP_OPS, Op } from "../compiler/opcodes.js";
import { registry as handlers, makeHandlerCtx, type HandlerCtx } from "./handlers/index.js";
import { obfuscateLocals } from "./transforms.js";
import { tryBuildNativeScalarBody } from "./native-scalar.js";
import { emit } from "./emit.js";
import {
	type JsNode, type CaseClause, type Name,
	arr, assign, bin, block, breakStmt, call, caseClause, continueStmt, exprStmt,
	fn, fnExpr, forStmt, id, ifStmt, index, lit, mapChildren, member, newExpr, obj,
	returnStmt, switchStmt, throwStmt, tryCatch, un, update, varDecl,
	BOp, UOp, UpOp,
} from "./nodes.js";

export interface NativeSpecializationResult {
	/** Emit after shared hop, defineProperty, globalRef, spreadSym and tdzSentinel declarations. */
	declarations: JsNode[];
	stats: {
		unitCount: number; instructionCount: number; basicBlockCount: number;
		structuredUnits: number; dispatchedUnits: number;
		scalarUnits: number; scalarInstructions: number; scalarRegisterSlotsElided: number;
		/** Declined units grouped by positive-grammar reason (and opcode when applicable). */
		scalarDeclines: Record<string, number>;
		sharedFactories: number; factoredFactoryCalls: number;
		sharedSemanticHelpers: number; semanticHelperCalls: number;
		semanticHelperOpcodes: string[];
		/** Minified residual per-unit instruction bodies; scalar bodies and shared helpers excluded. */
		handlerFootprint: Record<string, { instructions: number; bytes: number }>;
	};
	unitCount: number;
	instructionCount: number;
	basicBlockCount: number;
	/** Intentionally false: compatibility and specialization do not prove secrecy. */
	protectionQualified: false;
}

const UNSUPPORTED = new Set<Op>([
	Op.MUTATE,
	Op.YIELD, Op.YIELD_DELEGATE, Op.CREATE_GENERATOR,
	Op.GENERATOR_RESUME, Op.GENERATOR_RETURN, Op.GENERATOR_THROW,
	Op.SUSPEND, Op.RESUME, Op.ASYNC_GENERATOR_YIELD,
	Op.ASYNC_GENERATOR_NEXT, Op.ASYNC_GENERATOR_RETURN, Op.ASYNC_GENERATOR_THROW,
	Op.NEW_GENERATOR, Op.NEW_ASYNC_GENERATOR,
]);

/**
 * Lower logical units, recursively including their children, to typed AST.
 *
 * Input must precede opcode mutation/encryption. Unsupported generator stubs
 * are rejected explicitly. The existing runtime helper ABI is preserved:
 * `(unit, args, outerScope, thisValue, newTarget, homeObject)`.
 *
 * Shared declarations required from the caller are `names.hop`,
 * `names.defineProperty`, `names.globalRef`, `names.spreadSym`, and
 * `names.tdzSentinel`. The caller may
 * add existing runners and global exposure. This builder owns `names.cache`,
 * `names.depth`, `names.load`, `names.exec`, and `names.execAsync`.
 *
 * @returns Generated declarations and structural counts, with no strength claim.
 */
export function buildNativeSpecialization(
	roots: readonly BytecodeUnit[],
	names: RuntimeNames,
	temps: TempNames,
	nameRegistry: NameRegistry,
	seed: number,
	options: { scalarLowering?: boolean } = {},
): NativeSpecializationResult {
	const units = flattenUnits(roots);
	const reserved = new Set([
		...Object.values(names), ...Object.values(temps),
	]);
	const allocate = nameRegistry.createDynamicGenerator("nativeSpecialization");
	const nextName = (): string => {
		const name = allocate();
		reserved.add(name);
		return name;
	};
	const functionNames = new Map(units.map((unit) => [unit.id, nextName()]));
	const factories = makeFactoryFactorer(names, nextName, reserved);
	const semantics = makeSemanticFactorer(names, nextName, reserved);
	const handlerFootprint: Record<string, { instructions: number; bytes: number }> = {};
	const declarations: JsNode[] = [
		varDecl(names.depth, lit(0)),
		varDecl(names.cache, call(member(id("Object"), "create"), [lit(null)])),
	];
	let basicBlockCount = 0;
	let instructionCount = 0;
	let structuredUnits = 0;
	let scalarUnits = 0;
	let scalarInstructions = 0;
	let scalarRegisterSlotsElided = 0;
	const scalarDeclines: Record<string, number> = {};
	for (const unit of units) {
		validateUnit(unit);
		const scalar = options.scalarLowering !== false
			? tryBuildNativeScalarBody(unit, names, nameRegistry)
			: { admitted: false as const, reason: "disabled", opcode: undefined };
		if (scalar.admitted) {
			// These names were allocated by the same registry but belong to the
			// scalar builder's stream. Preserve every binding during module-wide
			// handler renaming, just as for the native backend's own allocations.
			const reserveBindings = (node: JsNode): JsNode => {
				if (node.type === "VarDecl" || node.type === "FnDecl") reserved.add(resolveName(node.name));
				return mapChildren(node, reserveBindings);
			};
			scalar.body.forEach(reserveBindings);
			declarations.push(wrapUnit(unit, functionNames.get(unit.id)!, names, scalar.body));
			scalarUnits++;
			scalarInstructions += scalar.stats.instructionCount;
			scalarRegisterSlotsElided += scalar.stats.registerSlotsElided;
			instructionCount += unit.instructions.length;
			structuredUnits++;
			basicBlockCount++;
			continue;
		}
		const declineKey = scalar.opcode ? `${scalar.reason}:${scalar.opcode}` : scalar.reason;
		scalarDeclines[declineKey] = (scalarDeclines[declineKey] ?? 0) + 1;
		const built = buildUnit(unit, functionNames.get(unit.id)!, names, temps, nextName, handlerFootprint, semantics);
		basicBlockCount += built.blockCount;
		if (built.structured) structuredUnits++;
		instructionCount += unit.instructions.length;
		declarations.push(factories.factor(built.node));
	}
	declarations.push(...semantics.declarations.map(factories.factor));
	declarations.push(...factories.declarations);

	// Construct constants lazily, at the same first-load boundary as the VM.
	// This preserves per-unit sharing of RegExp values and avoids eagerly
	// invoking mutable RegExp/BigInt constructors for never-loaded units.
	const unitId = nextName();
	const loadCases = units.map((unit) => caseClause(lit(unit.id), [
		returnStmt(assign(index(id(names.cache), id(unitId)), descriptor(
			unit, functionNames.get(unit.id)!,
		))),
	]));
	loadCases.push(caseClause(null, [throwStmt(newExpr(id("Error"), [
		lit("Unknown native unit"),
	]))]));
	declarations.push(fn(names.load, [unitId], [
		ifStmt(index(id(names.cache), id(unitId)), [
			returnStmt(index(id(names.cache), id(unitId))),
		]),
		switchStmt(id(unitId), loadCases),
	]));
	const params = [names.unit, names.args, names.outer, names.tVal, names.nTgt, names.ho];
	// A synchronous forwarding function preserves the returned Promise identity
	// without adding a further async adoption boundary.
	declarations.push(fn(names.exec, params, [returnStmt(call(
		member(id(names.unit), "f"), params.map((name) => id(name)),
	))]));
	declarations.push(varDecl(names.execAsync, id(names.exec)));
	// Rename the complete module once. Restarting the same registry generator
	// per unit repeatedly collides with names allocated by earlier units and
	// escalates identifiers into dozens of characters on real applications.
	// Handler-local canonical names may share a spelling across function scopes;
	// all infrastructure and dynamically allocated identifiers remain reserved.
	const renamed = obfuscateLocals(
		declarations, deriveSeed(seed, "nativeLocals"), reserved, nameRegistry,
	);
	return {
		declarations: renamed, unitCount: units.length, instructionCount, basicBlockCount,
		stats: {
			unitCount: units.length, instructionCount, basicBlockCount,
			structuredUnits, dispatchedUnits: units.length - structuredUnits,
			scalarUnits, scalarInstructions, scalarRegisterSlotsElided, scalarDeclines,
			sharedFactories: factories.declarations.length,
			factoredFactoryCalls: factories.calls(), handlerFootprint,
			sharedSemanticHelpers: semantics.declarations.length,
			semanticHelperCalls: semantics.calls(),
			semanticHelperOpcodes: semantics.opcodes(),
		},
		protectionQualified: false,
	};
}

function flattenUnits(roots: readonly BytecodeUnit[]): BytecodeUnit[] {
	const found = new Map<string, BytecodeUnit>();
	const visit = (unit: BytecodeUnit): void => {
		const previous = found.get(unit.id);
		if (previous) {
			if (previous !== unit) throw new Error(`Duplicate native unit ID: ${unit.id}`);
			return;
		}
		found.set(unit.id, unit);
		unit.childUnits.forEach(visit);
	};
	roots.forEach(visit);
	return [...found.values()];
}

function validateUnit(unit: BytecodeUnit): void {
	if (unit.isGenerator) throw new Error(`Native specialization rejects generator unit ${unit.id}`);
	for (const instruction of unit.instructions) {
		const opcode = instruction.opcode as Op;
		if (!handlers.has(opcode) || UNSUPPORTED.has(opcode)) {
			throw new Error(`Unsupported native opcode ${Op[opcode] ?? opcode} in ${unit.id}`);
		}
		if (!Number.isInteger(instruction.operand)) {
			throw new Error(`Invalid native operand in ${unit.id}`);
		}
		if (opcode === Op.AWAIT && !unit.isAsync) {
			throw new Error(`AWAIT in synchronous native unit ${unit.id}`);
		}
	}
}

function descriptor(unit: BytecodeUnit, functionName: string): JsNode {
	return obj(
		["c", arr(...unit.constants.map(constant))],
		["r", lit(unit.registerCount)], ["sl", lit(unit.slotCount)],
		["p", lit(unit.paramCount)], ["g", lit(unit.isGenerator)],
		["s", lit(unit.isAsync)], ["st", lit(unit.isStrict)],
		["a", lit(unit.isArrow)], ["el", lit(unit.scopeless)],
		["xh", lit(unit.usesExceptions)], ["tc", lit(unit.usesThisContext)],
		["f", id(functionName)],
	);
}

function constant(entry: ConstantPoolEntry): JsNode {
	switch (entry.type) {
		case "undefined": return un(UOp.Void, lit(0));
		case "null": return lit(null);
		case "boolean":
		case "string": return lit(entry.value);
		case "number":
			// Infinity and NaN are identifier expressions in the emitter. Source
			// lexical bindings can shadow them; numeric constants cannot change.
			if (Number.isNaN(entry.value)) return bin(BOp.Div, lit(0), lit(0));
			if (entry.value === Infinity) return bin(BOp.Div, lit(1), lit(0));
			if (entry.value === -Infinity) return bin(BOp.Div, lit(-1), lit(0));
			return lit(entry.value);
		case "bigint": return call(id("BigInt"), [lit(entry.value)]);
		case "regex": return newExpr(id("RegExp"), [lit(entry.value.pattern), lit(entry.value.flags)]);
	}
}

function buildUnit(
	unit: BytecodeUnit,
	functionName: string,
	n: RuntimeNames,
	temps: TempNames,
	nextName: () => string,
	handlerFootprint: Record<string, { instructions: number; bytes: number }>,
	semantics: ReturnType<typeof makeSemanticFactorer>,
): { node: JsNode; blockCount: number; structured: boolean } {
	const ctx = makeHandlerCtx(n, temps, unit.isAsync, false, false);
	const bodies = unit.instructions.map((instruction) => {
		// Without exception frames, RETURN's completion-unwind loop is dead.
		// Do not emit the frame protocol for a plain native return.
		if (!unit.usesExceptions && instruction.opcode === Op.RETURN) return [returnStmt(ctx.pop())];
		if (!unit.usesExceptions && instruction.opcode === Op.RETURN_VOID) return [returnStmt(un(UOp.Void, lit(0)))];
		const shared = semantics.factor(instruction.opcode as Op, instruction.operand, ctx);
		return shared ?? handlers.get(instruction.opcode as Op)!(ctx)
			.map((node) => specialize(node, ctx.O, instruction.operand));
	});
	unit.instructions.forEach((instruction, ip) => {
		const key = Op[instruction.opcode]!;
		const record = handlerFootprint[key] ??= { instructions: 0, bytes: 0 };
		record.instructions++;
		record.bytes += bodies[ip]!.reduce((size, node) => size + emit(node).length, 0);
	});
	const leaders = new Set([0, unit.instructions.length]);
	const addTarget = (target: number): void => {
		if (!Number.isInteger(target) || target < 0) {
			throw new Error(`Invalid native branch target ${target} in ${unit.id}`);
		}
		// The optimizer can retain unreachable jumps to a removed trailing
		// instruction. The current interpreter also treats any IP beyond the
		// stream as a normal undefined completion; do not invent a new error.
		if (target < unit.instructions.length) leaders.add(target);
	};
	unit.instructions.forEach((instruction, ip) => {
		const op = instruction.opcode as Op;
		if (ALL_JUMP_OPS.has(op)) addTarget(instruction.operand);
		if (PACKED_JUMP_OPS.has(op)) {
			const upper = instruction.operand >>> 16;
			if (op !== Op.TRY_PUSH || upper !== 0xffff) addTarget(upper);
			if (op === Op.TRY_PUSH && (instruction.operand & 0xffff) !== 0xffff) {
				addTarget(instruction.operand & 0xffff);
			}
		}
		// Only transfers through the emulated IP need a new dispatch boundary.
		// Native return/throw already leave the emitted function or catch scope;
		// conditional error guards must not split every straight-line region.
		if (bodies[ip]!.some((node) => transfersControl(node, ctx.IP))) leaders.add(ip + 1);
	});
	for (const target of Object.values(unit.jumpTable)) addTarget(target);
	for (const entry of unit.exceptionTable) {
		if (entry.catchIp >= 0) addTarget(entry.catchIp);
		if (entry.finallyIp >= 0) addTarget(entry.finallyIp);
	}
	const ordered = [...leaders].sort((a, b) => a - b);
	const cases: CaseClause[] = [];
	for (let bi = 0; bi < ordered.length - 1; bi++) {
		const start = ordered[bi]!;
		const end = ordered[bi + 1]!;
		const body: JsNode[] = [exprStmt(assign(id(n.ip), lit(end * 2)))];
		for (let ip = start; ip < end; ip++) body.push(...instructionBody(bodies[ip]!));
		body.push(breakStmt());
		cases.push(caseClause(lit(start * 2), body));
	}
	cases.push(caseClause(lit(unit.instructions.length * 2), [returnStmt(un(UOp.Void, lit(0)))]));
	cases.push(caseClause(null, [
		ifStmt(bin(BOp.Gte, id(n.ip), lit(unit.instructions.length * 2)), [returnStmt(un(UOp.Void, lit(0)))]),
		throwStmt(newExpr(id("Error"), [lit("Invalid native control-flow state")])),
	]));

	const registerCounter = nextName();
	const caught = nextName();
	const handler = nextName();
	const temp = (key: string): string => {
		const name = temps[key];
		if (name === undefined) throw new Error(`Missing native temp: ${key}`);
		return name;
	};
	const route = (field: string, isCatch: boolean): JsNode => ifStmt(
		bin(BOp.Gte, member(id(handler), field), lit(0)),
		[
			exprStmt(assign(member(id(n.stk), "length"), member(id(handler), temp("_sp")))),
			...(isCatch ? [exprStmt(ctx.push(id(caught)))] : [
				exprStmt(assign(id(n.pEx), id(caught))), exprStmt(assign(id(n.hPEx), lit(true))),
			]),
			exprStmt(assign(id(n.ip), bin(BOp.Mul, member(id(handler), field), lit(2)))),
			continueStmt(),
		],
	);
	const dispatch = switchStmt(id(n.ip), cases);
	const structured = ordered.length <= 2 && !unit.usesExceptions
		&& !bodies.some((body) => body.some((node) => transfersControl(node, ctx.IP)));
	const catchBody: JsNode[] = [
		exprStmt(assign(id(n.hPEx), lit(false))), exprStmt(assign(id(n.pEx), lit(null))),
		exprStmt(assign(id(n.cType), lit(0))), exprStmt(assign(id(n.cVal), un(UOp.Void, lit(0)))),
		ifStmt(bin(BOp.And, id(n.exStk), bin(BOp.Gt, member(id(n.exStk), "length"), lit(0))), [
			varDecl(handler, call(member(id(n.exStk), "pop"), [])),
			route(temp("_ci"), true), route(temp("_fi"), false),
		]),
		throwStmt(id(caught)),
	];
	const frame: JsNode[] = [
		varDecl(n.stk, arr()), varDecl(n.regs, arr()),
		forStmt(varDecl(registerCounter, lit(unit.registerCount)),
			bin(BOp.Gt, id(registerCounter), lit(0)), update(UpOp.Dec, false, id(registerCounter)),
			[exprStmt(call(member(id(n.regs), "push"), [un(UOp.Void, lit(0))]))]),
		varDecl(n.ip, lit(0)), varDecl(n.cArr, member(id(n.unit), "c")),
		varDecl(n.exStk, lit(null)), varDecl(n.pEx, lit(null)), varDecl(n.hPEx, lit(false)),
		varDecl(n.cType, lit(0)), varDecl(n.cVal, un(UOp.Void, lit(0))),
		varDecl(n.scope, unit.scopeless ? id(n.outer) : call(member(id("Object"), "create"), [id(n.outer)])),
		varDecl(temp("_g"), id(n.globalRef)),
		...(structured
			? bodies.flatMap(instructionBody)
			: [forStmt(null, null, null, unit.usesExceptions ? [tryCatch([dispatch], caught, catchBody)] : [dispatch])]),
	];
	return { blockCount: ordered.length - 1, structured, node: wrapUnit(unit, functionName, n, frame) };
}

/** The scalar and residual bodies share the exact entry/exit ABI and depth guard. */
function wrapUnit(unit: BytecodeUnit, functionName: string, n: RuntimeNames, body: JsNode[]): JsNode {
	return fn(
		functionName, [n.unit, n.args, n.outer, n.tVal, n.nTgt, n.ho], [
			exprStmt(update(UpOp.Inc, false, id(n.depth))),
			ifStmt(bin(BOp.Gt, id(n.depth), lit(VM_MAX_RECURSION_DEPTH)), [
				exprStmt(update(UpOp.Dec, false, id(n.depth))),
				throwStmt(newExpr(id("RangeError"), [lit("Maximum call stack size exceeded")])),
			]),
			tryCatch(body, undefined, undefined, [exprStmt(update(UpOp.Dec, false, id(n.depth)))]),
		], { async: unit.isAsync },
	);
}

function transfersControl(node: JsNode, ip: Name): boolean {
	if (node.type === "FnDecl" || node.type === "FnExpr" || node.type === "ArrowFn") return false;
	if (node.type === "AssignExpr" && node.target.type === "Id" && node.target.name === ip) return true;
	let found = false;
	mapChildren(node, (child) => { found ||= transfersControl(child, ip); return child; });
	return found;
}

/** Preserve early handler breaks without an opcode lookup or callable handler. */
function instructionBody(body: JsNode[]): JsNode[] {
	const withoutLast = body.at(-1)?.type === "BreakStmt" ? body.slice(0, -1) : body;
	const hasOuterBreak = (node: JsNode): boolean => {
		if (node.type === "BreakStmt") return true;
		if (["FnDecl", "FnExpr", "ArrowFn", "ForStmt", "ForInStmt", "WhileStmt", "SwitchStmt"].includes(node.type)) return false;
		let found = false;
		mapChildren(node, (child) => { found ||= hasOuterBreak(child); return child; });
		return found;
	};
	return withoutLast.some(hasOuterBreak)
		? [switchStmt(lit(0), [caseClause(null, body)])]
		: withoutLast;
}

/** Replace only the compiler-owned operand slot; never evaluate source values. */
function specialize(node: JsNode, operand: Name, value: number): JsNode {
	if (node.type === "Id" && node.name === operand) return lit(value);
	const mapped = mapChildren(node, (child) => specialize(child, operand, value));
	if (mapped.type === "IfStmt" && mapped.test.type === "Literal") {
		return block(...(mapped.test.value ? mapped.then : mapped.else ?? []));
	}
	if (mapped.type === "TernaryExpr" && mapped.test.type === "Literal") {
		return mapped.test.value ? mapped.then : mapped.else;
	}
	if (mapped.type === "UnaryOp" && mapped.expr.type === "Literal") {
		if (mapped.op === UOp.Not) return lit(!mapped.expr.value);
		if (typeof mapped.expr.value === "number") {
			if (mapped.op === UOp.Neg) return lit(-mapped.expr.value);
			if (mapped.op === UOp.Pos) return lit(+mapped.expr.value);
			if (mapped.op === UOp.BitNot) return lit(~mapped.expr.value);
		}
	}
	if (mapped.type !== "BinOp" || mapped.left.type !== "Literal" || mapped.right.type !== "Literal"
		|| typeof mapped.left.value !== "number" || typeof mapped.right.value !== "number") return mapped;
	const left = mapped.left.value;
	const right = mapped.right.value;
	switch (mapped.op) {
		case BOp.Add: return lit(left + right);
		case BOp.Sub: return lit(left - right);
		case BOp.Mul: return lit(left * right);
		case BOp.Shl: return lit(left << right);
		case BOp.Shr: return lit(left >> right);
		case BOp.Ushr: return lit(left >>> right);
		case BOp.BitAnd: return lit(left & right);
		case BOp.BitOr: return lit(left | right);
		case BOp.BitXor: return lit(left ^ right);
		case BOp.Eq:
		case BOp.Seq: return lit(left === right);
		case BOp.Neq:
		case BOp.Sneq: return lit(left !== right);
		case BOp.Gt: return lit(left > right);
		case BOp.Gte: return lit(left >= right);
		case BOp.Lt: return lit(left < right);
		case BOp.Lte: return lit(left <= right);
		default: return mapped;
	}
}

/**
 * Lift only closed, immediately invoked factories. Returned closures continue
 * to be allocated per call and capture that factory call's explicit arguments.
 * No frame slots are passed implicitly and no opcode dispatcher is introduced.
 */
function makeFactoryFactorer(n: RuntimeNames, nextName: () => string, reserved: Set<string>) {
	const declarations: JsNode[] = [];
	const byBody = new Map<string, string>();
	const allowed = new Set([
		...GLOBAL_IDENTIFIERS, "undefined", "this", "arguments", "new.target",
		n.exec, n.execAsync, n.load, n.spreadSym, n.hop, n.tdzSentinel, n.globalRef, n.defineProperty,
	]);
	let factoredCalls = 0;
	const factor = (node: JsNode): JsNode => {
		const mapped = mapChildren(node, factor);
		if (mapped.type !== "CallExpr" || mapped.callee.type !== "FnExpr"
			|| mapped.callee.name !== undefined || !isClosedFactory(mapped.callee, allowed)) return mapped;
		const key = emit(mapped.callee);
		let name = byBody.get(key);
		if (name === undefined) {
			name = nextName();
			byBody.set(key, name);
			reserved.add(name);
			allowed.add(name);
			declarations.push(fn(name, mapped.callee.params, mapped.callee.body, { async: mapped.callee.async }));
		}
		factoredCalls++;
		return { ...mapped, callee: id(name) };
	};
	return { declarations, factor, calls: () => factoredCalls };
}

/**
 * Share costly native semantic operations through direct calls. The positive
 * admission excludes all frame rebinding, control transfer and suspension.
 * Mutable stack/register/scope objects are explicit arguments; no handler can
 * observe another call's frame through a shared ambient slot.
 */
function makeSemanticFactorer(n: RuntimeNames, nextName: () => string, reserved: Set<string>) {
	const declarations: JsNode[] = [];
	const cache = new Map<string, { name: string; params: Name[] } | null>();
	const admittedOpcodes = new Set<Op>();
	const allowed = new Set([
		...GLOBAL_IDENTIFIERS, "undefined", "this", "arguments", "new.target",
		n.exec, n.execAsync, n.load, n.spreadSym, n.hop, n.tdzSentinel, n.globalRef, n.defineProperty,
	]);
	let calls = 0;
	const factor = (opcode: Op, operand: number, ctx: HandlerCtx): JsNode[] | null => {
		const key = `${opcode}:${ctx.isAsync}`;
		if (!cache.has(key)) {
			const body = handlers.get(opcode)!(ctx);
			const frameNames: Name[] = [ctx.S, ctx.R, ctx.C, ctx.O, ctx.SC, ctx.U, ctx.A, ctx.OS, ctx.TV, ctx.NT, ctx.HO, ctx.t("_g")];
			const frames = new Set(frameNames);
			const used = new Set<Name>();
			let admitted = body.reduce((size, node) => size + emit(node).length, 0) >= 200
				&& !body.some(referencesEnclosingFunctionContext);
			const inspect = (node: JsNode, nestedFunction = false): void => {
				if (node.type === "Id" && frames.has(node.name)) used.add(node.name);
				if (node.type === "StackPush" || node.type === "StackPop" || node.type === "StackPeek") used.add(node.S);
				if (node.type === "AssignExpr" && node.target.type === "Id" && frames.has(node.target.name)) admitted = false;
				if (node.type === "UpdateExpr" && node.arg.type === "Id" && frames.has(node.arg.name)) admitted = false;
				if ((node.type === "VarDecl" || node.type === "ConstDecl") && frames.has(node.name)) admitted = false;
				if (!nestedFunction && (node.type === "ReturnStmt" || node.type === "AwaitExpr" || node.type === "ContinueStmt")) admitted = false;
				const inner = nestedFunction || node.type === "FnExpr" || node.type === "ArrowFn" || node.type === "FnDecl";
				mapChildren(node, (child) => { inspect(child, inner); return child; });
			};
			body.forEach((node) => inspect(node));
			// Completion/IP/exception slots are absent from the parameter list;
			// the free-variable proof rejects any handler touching those slots.
			const params = frameNames.filter((name) => used.has(name));
			const localBody = body.map((node) => localizeBreaks(node));
			if (admitted && isClosedFactory(fnExpr(undefined, params, localBody), allowed)) {
				const name = nextName();
				reserved.add(name);
				cache.set(key, { name, params });
				admittedOpcodes.add(opcode);
				declarations.push(fn(name, params, localBody));
			} else cache.set(key, null);
		}
		const helper = cache.get(key);
		if (!helper) return null;
		calls++;
		return [exprStmt(call(id(helper.name), helper.params.map((name) => name === ctx.O ? lit(operand) : id(name))))];
	};
	return { declarations, factor, calls: () => calls, opcodes: () => [...admittedOpcodes].sort((a, b) => a - b).map((opcode) => Op[opcode]) };
}

/** A new semantic helper must not replace the handler's implicit function frame. */
function referencesEnclosingFunctionContext(node: JsNode): boolean {
	if (node.type === "Id") return ["this", "arguments", "new.target"].includes(resolveName(node.name));
	// Regular functions own these bindings, including for arrows nested inside
	// them. Arrows alone inherit the enclosing frame and must be traversed.
	if (node.type === "FnExpr" || node.type === "FnDecl") return false;
	if (node.type === "ObjectExpr") {
		return node.entries.some(entry => {
			if (Array.isArray(entry)) return (!isName(entry[0]) && referencesEnclosingFunctionContext(entry[0]))
				|| referencesEnclosingFunctionContext(entry[1]);
			if (entry.kind === "spread") return referencesEnclosingFunctionContext(entry.arg);
			// Method/accessor bodies own their frame, but a computed method key
			// is evaluated outside that body in the enclosing handler's frame.
			return entry.kind === "method" && !isName(entry.name) && referencesEnclosingFunctionContext(entry.name);
		});
	}
	let found = false;
	mapChildren(node, child => { found ||= referencesEnclosingFunctionContext(child); return child; });
	return found;
}

function localizeBreaks(node: JsNode): JsNode {
	if (node.type === "BreakStmt") return returnStmt();
	if (["FnDecl", "FnExpr", "ArrowFn", "ForStmt", "ForInStmt", "WhileStmt", "SwitchStmt"].includes(node.type)) return node;
	return mapChildren(node, localizeBreaks);
}

/** Scope-aware positive admission: every free reference must be infrastructure. */
function isClosedFactory(factory: Extract<JsNode, { type: "FnExpr" }>, allowed: ReadonlySet<string>): boolean {
	const checkFunction = (
		body: JsNode[],
		params: (Name | RestParam)[],
		parent: ReadonlySet<string>,
		name?: Name,
	): boolean => {
		const bound = new Set(parent);
		for (const param of params) {
			bound.add(param instanceof RestParam ? resolveName(param.paramName) : resolveName(param).replace(/^\.\.\./, ""));
		}
		if (name !== undefined) bound.add(resolveName(name));
		let admitted = true;
		const collect = (node: JsNode): void => {
			// Block-scoped declarations need a more extensive lexical analysis;
			// decline them rather than assuming function-wide visibility.
			if (node.type === "ConstDecl" || node.type === "FnDecl") { admitted = false; return; }
			if (node.type === "FnExpr" || node.type === "ArrowFn" || node.type === "ObjectExpr") return;
			if (node.type === "VarDecl") bound.add(resolveName(node.name));
			if (node.type === "ForInStmt") bound.add(resolveName(node.decl));
			mapChildren(node, (child) => { collect(child); return child; });
		};
		body.forEach(collect);
		return admitted && body.every((node) => check(node, bound));
	};
	const check = (node: JsNode, bound: ReadonlySet<string>): boolean => {
		// Direct eval can resolve names absent from the AST, including an outer
		// frame captured by a nested factory. A lexical free-reference proof
		// cannot justify moving it, even when `eval` is an allowed global.
		if (node.type === "CallExpr" && node.callee.type === "Id" && resolveName(node.callee.name) === "eval") return false;
		if (node.type === "Id") return bound.has(resolveName(node.name)) || allowed.has(resolveName(node.name));
		if (node.type === "StackPush" || node.type === "StackPop" || node.type === "StackPeek") {
			if (!bound.has(resolveName(node.S)) && !allowed.has(resolveName(node.S))) return false;
		}
		if (node.type === "FnDecl" || node.type === "ConstDecl") return false;
		if (node.type === "FnExpr" || node.type === "ArrowFn") {
			return checkFunction(node.body, node.params, bound, node.type === "FnExpr" ? node.name : undefined);
		}
		if (node.type === "TryCatchStmt") {
			const caught = new Set(bound);
			if (node.param !== undefined) caught.add(resolveName(node.param));
			return node.body.every((child) => check(child, bound))
				&& (node.handler ?? []).every((child) => check(child, caught))
				&& (node.finalizer ?? []).every((child) => check(child, bound));
		}
		if (node.type === "ObjectExpr") {
			return node.entries.every((entry) => {
				if (Array.isArray(entry)) return (isName(entry[0]) || check(entry[0], bound)) && check(entry[1], bound);
				if (entry.kind === "spread") return check(entry.arg, bound);
				if (entry.kind === "method") {
					return (isName(entry.name) || check(entry.name, bound)) && checkFunction(entry.body, entry.params, bound);
				}
				return checkFunction(entry.body, entry.kind === "set" ? [entry.param] : [], bound);
			});
		}
		let accepted = true;
		mapChildren(node, (child) => { accepted &&= check(child, bound); return child; });
		return accepted;
	};
	return checkFunction(factory.body, factory.params, new Set(), factory.name);
}
