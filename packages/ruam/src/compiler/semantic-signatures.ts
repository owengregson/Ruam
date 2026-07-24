/**
 * Exhaustive semantic-operation descriptor catalog.
 *
 * Signatures describe the observable shape of an operation without exposing
 * a physical dispatch identity.  The Isogloss lattice generator uses these
 * dimensions to construct overlapping candidate clauses; the CFG builder uses
 * the control classification to produce typed exits.
 *
 * Every current operation receives a descriptor.  Well-understood operation
 * families have explicit precise overrides.  Operations not yet fully
 * classified receive a deliberately conservative descriptor (`mayThrow`,
 * scope/this reads, dynamic stack arity) rather than an unsafe optimistic one.
 *
 * @module compiler/semantic-signatures
 */

import {
	ALL_SEMANTIC_OPS,
	SemanticOp,
	type SemanticOp as SemanticOpValue,
	semanticOpName,
} from "./semantic-ops.js";

export type OperandKind =
	| "none"
	| "constant"
	| "register"
	| "argument"
	| "slot"
	| "scope-name"
	| "argc"
	| "jump"
	| "table"
	| "count"
	| "packed"
	| "unit-ref";

/** Resolved number of values consumed/produced, or a runtime-dependent shape. */
export type ResolvedStackArity = number | "dynamic";

/** Fixed arity or a pure projection from the encoded semantic operand. */
export type StackArity =
	| ResolvedStackArity
	| ((operand: number) => ResolvedStackArity);

export type SemanticEffect =
	| "pure"
	| "local"
	| "scope"
	| "object"
	| "call"
	| "control"
	| "exception"
	| "async";

export type SemanticControl =
	| "fallthrough"
	| "conditional"
	| "jump"
	| "call"
	| "return"
	| "throw"
	| "yield"
	| "await";

export type SemanticFamily =
	| "stack"
	| "register"
	| "argument"
	| "arithmetic"
	| "bitwise"
	| "logical"
	| "comparison"
	| "control"
	| "property"
	| "scope"
	| "call"
	| "aggregate"
	| "class"
	| "closure"
	| "suspension"
	| "exception"
	| "iterator"
	| "conversion"
	| "template"
	| "destructuring"
	| "environment"
	| "mutation"
	| "unclassified";

export interface SemanticSignature {
	op: SemanticOpValue;
	operandKind: OperandKind;
	stackInput: StackArity;
	stackOutput: StackArity;
	effect: SemanticEffect;
	control: SemanticControl;
	mayThrow: boolean;
	readsThis: boolean;
	readsScope: boolean;
	/**
	 * Minimum number of non-semantic constraint dimensions available to the
	 * lattice generator when hiding this operation among candidates.
	 */
	syntheticDimensions: number;
	/** Broad family used by diagnostics and candidate balancing. */
	family: SemanticFamily;
	/** Whether the descriptor is explicit or a safe migration fallback. */
	precision: "classified" | "conservative";
}

type SignatureOverride = Partial<Omit<SemanticSignature, "op">>;

const dynamicArity: ResolvedStackArity = "dynamic";
const popOperandCount = (operand: number): ResolvedStackArity =>
	operand >= 0 ? operand : dynamicArity;
const callInputs = (operand: number): ResolvedStackArity =>
	operand >= 0 ? operand + 1 : dynamicArity;
const methodCallInputs = (operand: number): ResolvedStackArity =>
	operand >= 0 ? operand + 2 : dynamicArity;

const overrides = new Map<SemanticOpValue, SignatureOverride>();

function classify(
	ops: readonly SemanticOpValue[],
	override: SignatureOverride
): void {
	for (const op of ops) {
		overrides.set(op, {
			...overrides.get(op),
			...override,
			precision: override.precision ?? "classified",
		});
	}
}

// Stack primitives and literal sources.
classify(
	[
		SemanticOp.PUSH_UNDEFINED,
		SemanticOp.PUSH_NULL,
		SemanticOp.PUSH_TRUE,
		SemanticOp.PUSH_FALSE,
		SemanticOp.PUSH_ZERO,
		SemanticOp.PUSH_ONE,
		SemanticOp.PUSH_NEG_ONE,
		SemanticOp.PUSH_EMPTY_STRING,
		SemanticOp.PUSH_NAN,
		SemanticOp.PUSH_INFINITY,
		SemanticOp.PUSH_NEG_INFINITY,
	],
	{
		operandKind: "none",
		stackInput: 0,
		stackOutput: 1,
		effect: "pure",
		mayThrow: false,
		readsThis: false,
		readsScope: false,
		syntheticDimensions: 2,
		family: "stack",
	}
);
classify([SemanticOp.PUSH_CONST], {
	operandKind: "constant",
	stackInput: 0,
	stackOutput: 1,
	effect: "pure",
	mayThrow: false,
	readsThis: false,
	readsScope: false,
	syntheticDimensions: 2,
	family: "stack",
});
classify([SemanticOp.POP], {
	operandKind: "none",
	stackInput: 1,
	stackOutput: 0,
	effect: "local",
	mayThrow: false,
	readsThis: false,
	readsScope: false,
	family: "stack",
});
classify([SemanticOp.POP_N], {
	operandKind: "count",
	stackInput: popOperandCount,
	stackOutput: 0,
	effect: "local",
	mayThrow: false,
	readsThis: false,
	readsScope: false,
	family: "stack",
});
classify([SemanticOp.DUP], {
	operandKind: "none",
	stackInput: 1,
	stackOutput: 2,
	effect: "local",
	mayThrow: false,
	readsThis: false,
	readsScope: false,
	family: "stack",
});
classify([SemanticOp.DUP2], {
	operandKind: "none",
	stackInput: 2,
	stackOutput: 4,
	effect: "local",
	mayThrow: false,
	readsThis: false,
	readsScope: false,
	family: "stack",
});
classify([SemanticOp.SWAP], {
	operandKind: "none",
	stackInput: 2,
	stackOutput: 2,
	effect: "local",
	mayThrow: false,
	readsThis: false,
	readsScope: false,
	family: "stack",
});
classify([SemanticOp.ROT3], {
	operandKind: "none",
	stackInput: 3,
	stackOutput: 3,
	effect: "local",
	mayThrow: false,
	readsThis: false,
	readsScope: false,
	family: "stack",
});
classify([SemanticOp.ROT4], {
	operandKind: "none",
	stackInput: 4,
	stackOutput: 4,
	effect: "local",
	mayThrow: false,
	readsThis: false,
	readsScope: false,
	family: "stack",
});
classify([SemanticOp.PICK], {
	operandKind: "count",
	stackInput: "dynamic",
	stackOutput: "dynamic",
	effect: "local",
	mayThrow: false,
	readsThis: false,
	readsScope: false,
	family: "stack",
});

// Registers and arguments.
classify(
	[
		SemanticOp.LOAD_REG,
		SemanticOp.INC_REG,
		SemanticOp.DEC_REG,
		SemanticOp.POST_INC_REG,
		SemanticOp.POST_DEC_REG,
	],
	{
		operandKind: "register",
		stackInput: 0,
		stackOutput: 1,
		effect: "local",
		readsThis: false,
		readsScope: false,
		family: "register",
	}
);
classify([SemanticOp.STORE_REG], {
	operandKind: "register",
	stackInput: 1,
	stackOutput: 0,
	effect: "local",
	mayThrow: false,
	readsThis: false,
	readsScope: false,
	family: "register",
});
classify(
	[
		SemanticOp.ADD_ASSIGN_REG,
		SemanticOp.SUB_ASSIGN_REG,
		SemanticOp.MUL_ASSIGN_REG,
		SemanticOp.DIV_ASSIGN_REG,
		SemanticOp.MOD_ASSIGN_REG,
	],
	{
		operandKind: "register",
		stackInput: 1,
		stackOutput: 1,
		effect: "local",
		readsThis: false,
		readsScope: false,
		family: "register",
	}
);
classify(
	[
		SemanticOp.LOAD_ARG,
		SemanticOp.LOAD_ARG_OR_DEFAULT,
		SemanticOp.GET_ARG_COUNT,
	],
	{
		operandKind: "argument",
		stackInput: 0,
		stackOutput: 1,
		effect: "local",
		mayThrow: false,
		readsThis: false,
		readsScope: false,
		family: "argument",
	}
);
classify([SemanticOp.STORE_ARG], {
	operandKind: "argument",
	stackInput: 1,
	stackOutput: 0,
	effect: "local",
	mayThrow: false,
	readsThis: false,
	readsScope: false,
	family: "argument",
});

// Ordinary value operations.
classify(
	[
		SemanticOp.ADD,
		SemanticOp.SUB,
		SemanticOp.MUL,
		SemanticOp.DIV,
		SemanticOp.MOD,
		SemanticOp.POW,
	],
	{
		operandKind: "none",
		stackInput: 2,
		stackOutput: 1,
		effect: "pure",
		readsThis: false,
		readsScope: false,
		syntheticDimensions: 3,
		family: "arithmetic",
	}
);
classify(
	[
		SemanticOp.NEG,
		SemanticOp.UNARY_PLUS,
		SemanticOp.INC,
		SemanticOp.DEC,
	],
	{
		operandKind: "none",
		stackInput: 1,
		stackOutput: 1,
		effect: "pure",
		readsThis: false,
		readsScope: false,
		family: "arithmetic",
	}
);
classify(
	[
		SemanticOp.BIT_AND,
		SemanticOp.BIT_OR,
		SemanticOp.BIT_XOR,
		SemanticOp.SHL,
		SemanticOp.SHR,
		SemanticOp.USHR,
	],
	{
		operandKind: "none",
		stackInput: 2,
		stackOutput: 1,
		effect: "pure",
		readsThis: false,
		readsScope: false,
		family: "bitwise",
	}
);
classify([SemanticOp.BIT_NOT, SemanticOp.NOT], {
	operandKind: "none",
	stackInput: 1,
	stackOutput: 1,
	effect: "pure",
	mayThrow: false,
	readsThis: false,
	readsScope: false,
	family: "logical",
});
classify(
	[
		SemanticOp.EQ,
		SemanticOp.NEQ,
		SemanticOp.SEQ,
		SemanticOp.SNEQ,
		SemanticOp.LT,
		SemanticOp.LTE,
		SemanticOp.GT,
		SemanticOp.GTE,
		SemanticOp.IN_OP,
		SemanticOp.INSTANCEOF,
	],
	{
		operandKind: "none",
		stackInput: 2,
		stackOutput: 1,
		effect: "pure",
		readsThis: false,
		readsScope: false,
		syntheticDimensions: 3,
		family: "comparison",
	}
);

// Typed control exits.
classify([SemanticOp.JMP, SemanticOp.BREAK, SemanticOp.CONTINUE], {
	operandKind: "jump",
	stackInput: 0,
	stackOutput: 0,
	effect: "control",
	control: "jump",
	mayThrow: false,
	readsThis: false,
	readsScope: false,
	syntheticDimensions: 3,
	family: "control",
});
classify(
	[
		SemanticOp.JMP_TRUE,
		SemanticOp.JMP_FALSE,
		SemanticOp.JMP_NULLISH,
		SemanticOp.JMP_UNDEFINED,
	],
	{
		operandKind: "jump",
		stackInput: 1,
		stackOutput: 0,
		effect: "control",
		control: "conditional",
		mayThrow: false,
		readsThis: false,
		readsScope: false,
		syntheticDimensions: 3,
		family: "control",
	}
);
classify(
	[
		SemanticOp.JMP_TRUE_KEEP,
		SemanticOp.JMP_FALSE_KEEP,
		SemanticOp.JMP_NULLISH_KEEP,
		SemanticOp.LOGICAL_AND,
		SemanticOp.LOGICAL_OR,
		SemanticOp.NULLISH_COALESCE,
	],
	{
		operandKind: "jump",
		stackInput: 1,
		stackOutput: 1,
		effect: "control",
		control: "conditional",
		mayThrow: false,
		readsThis: false,
		readsScope: false,
		syntheticDimensions: 3,
		family: "control",
	}
);
classify([SemanticOp.TABLE_SWITCH, SemanticOp.LOOKUP_SWITCH], {
	operandKind: "table",
	stackInput: 1,
	stackOutput: 0,
	effect: "control",
	control: "conditional",
	mayThrow: false,
	readsThis: false,
	readsScope: false,
	syntheticDimensions: 4,
	family: "control",
});
classify([SemanticOp.RETURN], {
	operandKind: "none",
	stackInput: 1,
	stackOutput: 0,
	effect: "control",
	control: "return",
	mayThrow: false,
	readsThis: false,
	readsScope: false,
	syntheticDimensions: 3,
	family: "control",
});
classify([SemanticOp.RETURN_VOID], {
	operandKind: "none",
	stackInput: 0,
	stackOutput: 0,
	effect: "control",
	control: "return",
	mayThrow: false,
	readsThis: false,
	readsScope: false,
	syntheticDimensions: 3,
	family: "control",
});
classify(
	[
		SemanticOp.THROW,
		SemanticOp.RETHROW,
		SemanticOp.THROW_IF_NOT_OBJECT,
		SemanticOp.THROW_REF_ERROR,
		SemanticOp.THROW_TYPE_ERROR,
		SemanticOp.THROW_SYNTAX_ERROR,
	],
	{
		operandKind: "none",
		stackInput: "dynamic",
		stackOutput: 0,
		effect: "exception",
		control: "throw",
		mayThrow: true,
		readsThis: false,
		readsScope: false,
		syntheticDimensions: 3,
		family: "exception",
	}
);
classify([SemanticOp.NOP, SemanticOp.LABEL, SemanticOp.SOURCE_MAP], {
	operandKind: "none",
	stackInput: 0,
	stackOutput: 0,
	effect: "pure",
	mayThrow: false,
	readsThis: false,
	readsScope: false,
	family: "control",
});

// Calls and construction. Negative argument counts denote spread and remain
// dynamic until the canonical operand model is normalized.
classify(
	[
		SemanticOp.CALL,
		SemanticOp.CALL_NEW,
		SemanticOp.CALL_OPTIONAL,
		SemanticOp.DIRECT_EVAL,
		SemanticOp.CALL_TAGGED_TEMPLATE,
	],
	{
		operandKind: "argc",
		stackInput: callInputs,
		stackOutput: 1,
		effect: "call",
		control: "call",
		mayThrow: true,
		readsThis: false,
		readsScope: false,
		syntheticDimensions: 4,
		family: "call",
	}
);
classify(
	[
		SemanticOp.CALL_METHOD,
		SemanticOp.CALL_METHOD_OPTIONAL,
		SemanticOp.CALL_SUPER_METHOD,
		SemanticOp.SUPER_CALL,
	],
	{
		operandKind: "argc",
		stackInput: methodCallInputs,
		stackOutput: 1,
		effect: "call",
		control: "call",
		mayThrow: true,
		readsThis: true,
		readsScope: false,
		syntheticDimensions: 4,
		family: "call",
	}
);
classify([SemanticOp.CALL_0], {
	operandKind: "none",
	stackInput: 1,
	stackOutput: 1,
	effect: "call",
	control: "call",
	mayThrow: true,
	readsThis: false,
	readsScope: false,
	family: "call",
});
classify([SemanticOp.CALL_1], {
	operandKind: "none",
	stackInput: 2,
	stackOutput: 1,
	effect: "call",
	control: "call",
	mayThrow: true,
	readsThis: false,
	readsScope: false,
	family: "call",
});
classify([SemanticOp.CALL_2], {
	operandKind: "none",
	stackInput: 3,
	stackOutput: 1,
	effect: "call",
	control: "call",
	mayThrow: true,
	readsThis: false,
	readsScope: false,
	family: "call",
});
classify([SemanticOp.CALL_3], {
	operandKind: "none",
	stackInput: 4,
	stackOutput: 1,
	effect: "call",
	control: "call",
	mayThrow: true,
	readsThis: false,
	readsScope: false,
	family: "call",
});

// Suspension and async boundaries.
classify([SemanticOp.YIELD, SemanticOp.YIELD_DELEGATE], {
	operandKind: "none",
	stackInput: 1,
	stackOutput: 1,
	effect: "async",
	control: "yield",
	mayThrow: true,
	readsThis: false,
	readsScope: false,
	syntheticDimensions: 4,
	family: "suspension",
});
classify([SemanticOp.AWAIT, SemanticOp.FOR_AWAIT_NEXT], {
	operandKind: "none",
	stackInput: 1,
	stackOutput: 1,
	effect: "async",
	control: "await",
	mayThrow: true,
	readsThis: false,
	readsScope: false,
	syntheticDimensions: 4,
	family: "suspension",
});
classify(
	[
		SemanticOp.SUSPEND,
		SemanticOp.RESUME,
		SemanticOp.GENERATOR_RESUME,
		SemanticOp.GENERATOR_RETURN,
		SemanticOp.GENERATOR_THROW,
		SemanticOp.ASYNC_GENERATOR_YIELD,
		SemanticOp.ASYNC_GENERATOR_NEXT,
		SemanticOp.ASYNC_GENERATOR_RETURN,
		SemanticOp.ASYNC_GENERATOR_THROW,
	],
	{
		operandKind: "none",
		stackInput: "dynamic",
		stackOutput: "dynamic",
		effect: "async",
		mayThrow: true,
		readsThis: false,
		readsScope: false,
		syntheticDimensions: 4,
		family: "suspension",
	}
);

// Structured exception state is explicit even where exact stack shape still
// depends on handler metadata.
classify(
	[
		SemanticOp.TRY_PUSH,
		SemanticOp.TRY_POP,
		SemanticOp.CATCH_BIND,
		SemanticOp.CATCH_BIND_PATTERN,
		SemanticOp.FINALLY_MARK,
		SemanticOp.END_FINALLY,
	],
	{
		operandKind: "packed",
		stackInput: "dynamic",
		stackOutput: "dynamic",
		effect: "exception",
		mayThrow: true,
		readsThis: false,
		readsScope: true,
		syntheticDimensions: 4,
		family: "exception",
	}
);

// Scope access and closure creation.
classify(
	[
		SemanticOp.LOAD_GLOBAL,
		SemanticOp.STORE_GLOBAL,
		SemanticOp.LOAD_SCOPED,
		SemanticOp.STORE_SCOPED,
		SemanticOp.DECLARE_VAR,
		SemanticOp.DECLARE_LET,
		SemanticOp.DECLARE_CONST,
		SemanticOp.TDZ_CHECK,
		SemanticOp.TDZ_MARK,
		SemanticOp.DELETE_SCOPED,
		SemanticOp.TYPEOF_GLOBAL,
		SemanticOp.INC_SCOPED,
		SemanticOp.DEC_SCOPED,
		SemanticOp.POST_INC_SCOPED,
		SemanticOp.POST_DEC_SCOPED,
		SemanticOp.ADD_ASSIGN_SCOPED,
		SemanticOp.SUB_ASSIGN_SCOPED,
		SemanticOp.MUL_ASSIGN_SCOPED,
		SemanticOp.DIV_ASSIGN_SCOPED,
		SemanticOp.MOD_ASSIGN_SCOPED,
		SemanticOp.POW_ASSIGN_SCOPED,
		SemanticOp.BIT_AND_ASSIGN_SCOPED,
		SemanticOp.BIT_OR_ASSIGN_SCOPED,
		SemanticOp.BIT_XOR_ASSIGN_SCOPED,
		SemanticOp.SHL_ASSIGN_SCOPED,
		SemanticOp.SHR_ASSIGN_SCOPED,
		SemanticOp.USHR_ASSIGN_SCOPED,
		SemanticOp.AND_ASSIGN_SCOPED,
		SemanticOp.OR_ASSIGN_SCOPED,
		SemanticOp.NULLISH_ASSIGN_SCOPED,
		SemanticOp.PUSH_CLOSURE_VAR,
		SemanticOp.STORE_CLOSURE_VAR,
	],
	{
		operandKind: "scope-name",
		stackInput: "dynamic",
		stackOutput: "dynamic",
		effect: "scope",
		readsThis: false,
		readsScope: true,
		syntheticDimensions: 3,
		family: "scope",
	}
);
classify(
	[
		SemanticOp.PUSH_SCOPE,
		SemanticOp.POP_SCOPE,
		SemanticOp.PUSH_WITH_SCOPE,
		SemanticOp.PUSH_BLOCK_SCOPE,
		SemanticOp.PUSH_CATCH_SCOPE,
		SemanticOp.PUSH_INDEXED_SCOPE,
		SemanticOp.POP_INDEXED_SCOPE,
	],
	{
		operandKind: "count",
		stackInput: "dynamic",
		stackOutput: "dynamic",
		effect: "scope",
		readsThis: false,
		readsScope: true,
		family: "scope",
	}
);
classify(
	[
		SemanticOp.NEW_CLOSURE,
		SemanticOp.NEW_FUNCTION,
		SemanticOp.NEW_ARROW,
		SemanticOp.NEW_ASYNC,
		SemanticOp.NEW_GENERATOR,
		SemanticOp.NEW_ASYNC_GENERATOR,
	],
	{
		operandKind: "unit-ref",
		stackInput: 0,
		stackOutput: 1,
		effect: "local",
		mayThrow: true,
		readsScope: true,
		syntheticDimensions: 4,
		family: "closure",
	}
);
classify([SemanticOp.NEW_ARROW, SemanticOp.NEW_CLOSURE], {
	readsThis: true,
});

// Property, aggregate, and iterator operations are conservatively marked as
// potentially throwing while still exposing their candidate-balancing family.
classify(
	[
		SemanticOp.GET_PROP_STATIC,
		SemanticOp.SET_PROP_STATIC,
		SemanticOp.GET_PROP_DYNAMIC,
		SemanticOp.SET_PROP_DYNAMIC,
		SemanticOp.DELETE_PROP_STATIC,
		SemanticOp.DELETE_PROP_DYNAMIC,
		SemanticOp.OPT_CHAIN_GET,
		SemanticOp.OPT_CHAIN_DYNAMIC,
		SemanticOp.GET_SUPER_PROP,
		SemanticOp.SET_SUPER_PROP,
		SemanticOp.GET_PRIVATE_FIELD,
		SemanticOp.SET_PRIVATE_FIELD,
		SemanticOp.HAS_PRIVATE_FIELD,
		SemanticOp.DEFINE_OWN_PROPERTY,
		SemanticOp.FAST_GET_PROP,
		SemanticOp.REG_GET_PROP,
		SemanticOp.IDX_REG,
		SemanticOp.REG_GET_PROP_DYN,
	],
	{
		operandKind: "packed",
		stackInput: "dynamic",
		stackOutput: "dynamic",
		effect: "object",
		mayThrow: true,
		readsThis: false,
		readsScope: false,
		syntheticDimensions: 3,
		family: "property",
	}
);
classify([SemanticOp.GET_SUPER_PROP, SemanticOp.SET_SUPER_PROP], {
	readsThis: true,
});
classify(
	[
		SemanticOp.NEW_OBJECT,
		SemanticOp.NEW_ARRAY,
		SemanticOp.NEW_ARRAY_WITH_SIZE,
		SemanticOp.ARRAY_PUSH,
		SemanticOp.ARRAY_HOLE,
		SemanticOp.SPREAD_ARRAY,
		SemanticOp.SPREAD_OBJECT,
		SemanticOp.COPY_DATA_PROPERTIES,
		SemanticOp.SET_PROTO,
		SemanticOp.FREEZE_OBJECT,
		SemanticOp.SEAL_OBJECT,
		SemanticOp.DEFINE_PROPERTY_DESC,
		SemanticOp.CREATE_TEMPLATE_OBJECT,
	],
	{
		operandKind: "packed",
		stackInput: "dynamic",
		stackOutput: "dynamic",
		effect: "object",
		mayThrow: true,
		readsThis: false,
		readsScope: false,
		family: "aggregate",
	}
);
classify(
	[
		SemanticOp.GET_ITERATOR,
		SemanticOp.ITER_NEXT,
		SemanticOp.ITER_DONE,
		SemanticOp.ITER_VALUE,
		SemanticOp.ITER_CLOSE,
		SemanticOp.ITER_RESULT_UNWRAP,
		SemanticOp.FORIN_INIT,
		SemanticOp.FORIN_NEXT,
		SemanticOp.FORIN_DONE,
		SemanticOp.GET_ASYNC_ITERATOR,
		SemanticOp.ASYNC_ITER_NEXT,
		SemanticOp.ASYNC_ITER_DONE,
		SemanticOp.ASYNC_ITER_VALUE,
		SemanticOp.ASYNC_ITER_CLOSE,
	],
	{
		operandKind: "none",
		stackInput: "dynamic",
		stackOutput: "dynamic",
		effect: "object",
		mayThrow: true,
		readsThis: false,
		readsScope: false,
		family: "iterator",
	}
);

classify(
	[
		SemanticOp.TYPEOF,
		SemanticOp.VOID,
		SemanticOp.TO_NUMBER,
		SemanticOp.TO_STRING,
		SemanticOp.TO_BOOLEAN,
		SemanticOp.TO_OBJECT,
		SemanticOp.TO_PROPERTY_KEY,
		SemanticOp.TO_NUMERIC,
	],
	{
		operandKind: "none",
		stackInput: 1,
		stackOutput: 1,
		effect: "pure",
		readsThis: false,
		readsScope: false,
		family: "conversion",
	}
);

classify(
	[
		SemanticOp.PUSH_THIS,
		SemanticOp.PUSH_NEW_TARGET,
		SemanticOp.PUSH_ARGUMENTS,
		SemanticOp.PUSH_GLOBAL_THIS,
		SemanticOp.PUSH_WELL_KNOWN_SYMBOL,
		SemanticOp.IMPORT_META,
	],
	{
		operandKind: "none",
		stackInput: 0,
		stackOutput: 1,
		effect: "local",
		mayThrow: false,
		readsThis: false,
		readsScope: false,
		family: "environment",
	}
);
classify([SemanticOp.PUSH_THIS, SemanticOp.PUSH_NEW_TARGET], {
	readsThis: true,
});
classify([SemanticOp.DYNAMIC_IMPORT], {
	operandKind: "none",
	stackInput: 1,
	stackOutput: 1,
	effect: "async",
	control: "call",
	mayThrow: true,
	readsThis: false,
	readsScope: false,
	family: "environment",
});

// Legacy-only runtime mutation remains total but intentionally conservative:
// it has no place in canonical Isogloss output and will be removed at cutover.
classify([SemanticOp.MUTATE], {
	operandKind: "packed",
	stackInput: 0,
	stackOutput: 0,
	effect: "control",
	control: "fallthrough",
	mayThrow: true,
	readsThis: true,
	readsScope: true,
	syntheticDimensions: 1,
	family: "mutation",
	precision: "conservative",
});

function conservativeSignature(op: SemanticOpValue): SemanticSignature {
	return {
		op,
		operandKind: "packed",
		stackInput: "dynamic",
		stackOutput: "dynamic",
		effect: "object",
		control: "fallthrough",
		mayThrow: true,
		readsThis: true,
		readsScope: true,
		syntheticDimensions: 1,
		family: "unclassified",
		precision: "conservative",
	};
}

function buildSignatureTable(): Readonly<
	Record<SemanticOpValue, SemanticSignature>
> {
	const table = Object.create(null) as Record<
		SemanticOpValue,
		SemanticSignature
	>;

	for (const op of ALL_SEMANTIC_OPS) {
		const signature = {
			...conservativeSignature(op),
			...overrides.get(op),
			op,
		};
		table[op] = Object.freeze(signature);
	}

	return Object.freeze(table);
}

/**
 * Total descriptor table for all real semantic operations.
 *
 * Its `Record<SemanticOp, ...>` type makes downstream lookup total at compile
 * time; construction from `ALL_SEMANTIC_OPS` and the coverage test make enum
 * growth total at runtime as well.
 */
export const SEMANTIC_SIGNATURES: Readonly<
	Record<SemanticOpValue, SemanticSignature>
> = buildSignatureTable();

/** Look up the descriptor for a canonical semantic operation. */
export function getSemanticSignature(
	op: SemanticOpValue
): SemanticSignature {
	const signature = SEMANTIC_SIGNATURES[op];
	if (signature === undefined) {
		throw new RangeError(`Missing semantic signature for ${semanticOpName(op)}`);
	}
	return signature;
}

/** Resolve a fixed or operand-dependent stack arity. */
export function resolveStackArity(
	arity: StackArity,
	operand: number
): ResolvedStackArity {
	return typeof arity === "function" ? arity(operand) : arity;
}
