/**
 * Canonical names for Ruam's language-level source operations.
 *
 * The visitor catalog is private compiler vocabulary. Isogloss consumers use
 * these names only after canonical validation has excluded temporary markers
 * and obsolete fused forms.
 *
 * @module compiler/semantic-ops
 */

import { Op } from "./operations.js";

/**
 * Semantic-operation catalog shared by the visitor and analysis stages.
 */
export const SemanticOp = Op;

/**
 * A real language-level operation.
 *
 * The enum includes `__COUNT` as a numeric sentinel. Excluding it from the
 * semantic type prevents the sentinel from entering canonical IR.
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
 * Temporary or obsolete operations that are not legal in canonical IR.
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

	// Retired physical-dispatch marker; never emitted or executed.
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
