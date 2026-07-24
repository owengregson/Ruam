/**
 * Migration-safe names for Ruam's language-level operations.
 *
 * The current compiler still emits the logical {@link Op} enum consumed by
 * the legacy VM.  Isogloss treats those values as semantic operation
 * identities instead of physical bytecode.  Keeping a runtime alias here lets
 * new compiler stages use Isogloss terminology without changing numeric
 * values or disturbing the existing encoder and interpreter during the
 * migration.
 *
 * This file is intentionally the only compatibility seam new Isogloss
 * compiler code should import.  Once the legacy VM is removed, the enum can be
 * moved here without changing downstream semantic-IR imports.
 *
 * @module compiler/semantic-ops
 */

import { Op } from "./opcodes.js";

/**
 * Runtime semantic-operation catalog.
 *
 * This is the exact same enum object as {@link Op}; it does not allocate,
 * translate, or renumber operations.
 */
export const SemanticOp = Op;

/**
 * A real language-level operation.
 *
 * The legacy enum includes `__COUNT` as a numeric sentinel.  Excluding it from
 * the semantic type prevents the sentinel from entering canonical IR.
 */
export type SemanticOp = Exclude<Op, Op.__COUNT>;

/** Number of real semantic operations (excludes `__COUNT`). */
export const SEMANTIC_OP_COUNT = Op.__COUNT;

/**
 * Stable ordered list of every real semantic operation.
 *
 * It is derived from the enum sentinel so newly appended operations are
 * included automatically.  The semantic-signature tests additionally prove
 * that the corresponding descriptor table remains total.
 */
export const ALL_SEMANTIC_OPS: readonly SemanticOp[] = Object.freeze(
	Array.from(
		{ length: SEMANTIC_OP_COUNT },
		(_, value) => value as SemanticOp
	)
);

/**
 * Migration-era operations that are not legal in canonical semantic IR.
 *
 * The signature catalog remains total for these values so the legacy compiler
 * can be used as a differential oracle during replacement. Isogloss lowering,
 * however, must only receive source-language operations. Compile-time markers,
 * optimizer fusions, and VM handler-table mutation are representation details,
 * not JavaScript semantics.
 */
export const NON_CANONICAL_SEMANTIC_OPS: ReadonlySet<SemanticOp> = new Set([
	// Patched or consumed before canonical IR is finalized.
	Op.BREAK,
	Op.CONTINUE,
	Op.LABEL,

	// Tier-3 optimizer fusions. Canonical optimization may rewrite nodes, but
	// it may not introduce a second hidden instruction vocabulary.
	Op.REG_ADD,
	Op.REG_SUB,
	Op.REG_MUL,
	Op.REG_LT,
	Op.REG_LTE,
	Op.REG_GT,
	Op.REG_SEQ,
	Op.REG_SNEQ,
	Op.REG_LT_CONST_JF,
	Op.REG_GET_PROP,
	Op.REG_ADD_CONST,
	Op.REG_GTE,
	Op.REG_DIV,
	Op.REG_MOD,
	Op.REG_CONST_SUB,
	Op.REG_CONST_MUL,
	Op.REG_CONST_MOD,
	Op.REG_LT_REG_JF,
	Op.REG_LTE_CONST_JF,
	Op.REG_GT_CONST_JF,
	Op.REG_GTE_CONST_JF,
	Op.REG_SEQ_CONST_JF,
	Op.REG_SNEQ_CONST_JF,
	Op.REG_LTE_REG_JF,
	Op.REG_GT_REG_JF,
	Op.REG_GTE_REG_JF,
	Op.REG_SEQ_REG_JF,
	Op.REG_SNEQ_REG_JF,
	Op.REG_ADD_ASSIGN_VOID,
	Op.REG_SUB_ASSIGN_VOID,
	Op.REG_MUL_ASSIGN_VOID,
	Op.REG_DIV_ASSIGN_VOID,
	Op.REG_MOD_ASSIGN_VOID,
	Op.IDX_REG,
	Op.REG_GET_PROP_DYN,
	Op.CONST_LT_JF,
	Op.CONST_LTE_JF,
	Op.CONST_GT_JF,
	Op.CONST_GTE_JF,
	Op.CONST_SEQ_JF,
	Op.CONST_SNEQ_JF,

	// Changes a physical VM dispatch table and has no language-level meaning.
	Op.MUTATE,
]);

/** Stable ordered list of operations accepted by canonical semantic IR. */
export const ALL_CANONICAL_SEMANTIC_OPS: readonly SemanticOp[] = Object.freeze(
	ALL_SEMANTIC_OPS.filter((op) => !NON_CANONICAL_SEMANTIC_OPS.has(op))
);

/** Whether an operation may cross the canonical-IR/Isogloss boundary. */
export function isCanonicalSemanticOp(op: SemanticOp): boolean {
	return !NON_CANONICAL_SEMANTIC_OPS.has(op);
}

/**
 * Fail closed when a migration adapter tries to introduce representation-
 * specific behavior into canonical semantic IR.
 */
export function assertCanonicalSemanticOp(
	op: SemanticOp
): asserts op is SemanticOp {
	if (!isCanonicalSemanticOp(op)) {
		throw new Error(
			`RUAM_NON_CANONICAL_SEMANTIC_OP: ${semanticOpName(op)} (${op})`
		);
	}
}

/** Return the symbolic name of a semantic operation for diagnostics. */
export function semanticOpName(op: SemanticOp): string {
	return Op[op];
}

// Preserve access to the old spelling for migration adapters that need to
// state explicitly that they are crossing back into legacy VM code.
export { Op as LegacyOp };
