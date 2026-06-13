/**
 * Per-unit interpreter-slot usage analysis.
 *
 * The hoisted (sync) interpreter shares ~17 "slot" variables at IIFE scope
 * (S, R, IP, C, O, SC, EX, PE, HPE, CT, CV, U, A, TV, NT, HO, _g). To stay
 * recursion-safe, every `exec()` call snapshots these on entry and restores
 * them on exit. Most units only touch a subset, so two groups of slots can be
 * conditionally skipped — shrinking the per-call save/restore cost (the
 * dominant overhead under deep recursion):
 *
 *   - **Exception completion slots** `PE, HPE, CT, CV` — written only by the
 *     exception machinery (the scaffold `catch` routing and the handlers for
 *     {@link EXC_OPCODES}) and read only by `END_FINALLY`/`RETHROW`. (`RETURN`
 *     /`RETURN_VOID` write `CT`/`CV` only when unwinding to an `EX` *finally*
 *     frame, which can exist only if the unit emitted a `TRY_PUSH` — i.e. an
 *     EXC opcode.) A unit with none of {@link EXC_OPCODES} therefore never
 *     reads or writes any of these four slots (`EX` itself is NOT in this group
 *     — `RETURN`/`RETURN_VOID` read it on every return, so it is always saved).
 *
 *   - **This-context slots** `TV, NT, HO` — read only by the handlers for
 *     {@link THIS_CTX_OPCODES} (`this`, `new.target`, lexical-`this` closures,
 *     and `super`). The scaffold's only other use is the entry param-copy and
 *     the save/restore, both gated on the same flag. A unit with none of these
 *     opcodes never reads them, so they need not be copied in or saved.
 *
 * Both sets are validated against the live handler registry by
 * `test/security/slot-save-restore.test.ts`, which introspects every handler's
 * emitted AST and fails if any opcode outside these sets references a gated
 * slot — guaranteeing the sets remain a safe superset as handlers evolve.
 *
 * `A` (arguments) is deliberately NOT gated: it is read by ordinary parameter
 * loads (`LOAD_ARG`) present in almost every function, so it is always saved.
 *
 * @module compiler/slot-analysis
 */

import { Op } from "./opcodes.js";

/**
 * Opcodes that imply the unit needs the exception-completion machinery
 * (`PE`/`HPE`/`CT`/`CV` + the scaffold `catch` routing). Any unit containing
 * one of these has `usesExceptions = true`.
 *
 * These are the structural exception opcodes: a `TRY_PUSH` is required for any
 * `EX` handler frame to exist (so the `catch` routing and `RETURN`-through-
 * `finally` `CT`/`CV` writes are reachable), and `END_FINALLY`/`RETHROW` are
 * the only handlers that directly read/write `PE`/`HPE`/`CT`/`CV`. Plain
 * `THROW`/`THROW_*` opcodes are excluded: with no `EX` frame they propagate via
 * the (gated) `catch`'s bare `throw`, touching none of the gated slots.
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
 * Opcodes whose handlers read the this-context slots `TV`/`NT`/`HO`. Any unit
 * containing one of these has `usesThisContext = true`.
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
 * Whether a unit's (logical) instructions use the exception-completion
 * machinery — i.e. contain any {@link EXC_OPCODES}.
 *
 * @param instructions - The unit's logical instructions (pre opcode-shuffle).
 * @returns `true` when `PE`/`HPE`/`CT`/`CV` may be touched at runtime.
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
 * Whether a unit's (logical) instructions reference `this`/`new.target`/
 * `super`/lexical-`this` closures — i.e. contain any {@link THIS_CTX_OPCODES}.
 *
 * @param instructions - The unit's logical instructions (pre opcode-shuffle).
 * @returns `true` when `TV`/`NT`/`HO` may be read at runtime.
 */
export function computeUsesThisContext(
	instructions: { opcode: number }[]
): boolean {
	for (const ins of instructions) {
		if (THIS_CTX_OPCODES.has(ins.opcode as Op)) return true;
	}
	return false;
}
