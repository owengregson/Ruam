/**
 * Conservative per-function semantic metadata analysis.
 *
 * These classifiers describe whether canonical planning must account for
 * exception completion or receiver/new-target/super context.
 *
 * @module compiler/metadata-analysis
 */

import { Op } from "./operations.js";

/**
 * Structural operations that require exception-completion state.
 */
export const EXC_OPCODES: ReadonlySet<Op> = new Set<Op>([
	Op.TRY_PUSH,
	Op.TRY_POP,
	Op.CATCH_BIND,
	Op.CATCH_BIND_PATTERN,
	Op.FINALLY_MARK,
	Op.END_FINALLY,
	Op.RETHROW,
]);

/**
 * Operations that require receiver, new-target, closure, or super context.
 */
export const THIS_CTX_OPCODES: ReadonlySet<Op> = new Set<Op>([
	Op.PUSH_THIS,
	Op.PUSH_NEW_TARGET,
	Op.NEW_ARROW,
	Op.NEW_CLOSURE,
	Op.GET_SUPER_PROP,
	Op.SET_SUPER_PROP,
	Op.CALL_SUPER_METHOD,
	Op.SUPER_CALL,
]);

/**
 * Whether a temporary source-operation sequence needs exception state.
 */
export function computeUsesExceptions(
	instructions: { opcode: number }[]
): boolean {
	for (const ins of instructions) {
		if (EXC_OPCODES.has(ins.opcode as Op)) return true;
	}
	return false;
}

/**
 * Whether a temporary source-operation sequence needs receiver context.
 */
export function computeUsesThisContext(
	instructions: { opcode: number }[]
): boolean {
	for (const ins of instructions) {
		if (THIS_CTX_OPCODES.has(ins.opcode as Op)) return true;
	}
	return false;
}
