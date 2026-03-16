/**
 * Virtual machine opcode definitions and shuffle-map utilities.
 *
 * The {@link Op} enum assigns a stable *logical* opcode number to every VM
 * instruction.  At build time a per-file shuffle map permutes these into
 * *physical* opcodes embedded in the bytecode, making static analysis harder.
 *
 * Opcodes are organised into 24 categories covering every JavaScript language
 * feature.  Some opcodes are "fast-path" variants that fuse common multi-step
 * patterns into a single instruction for future optimisation passes.
 *
 * @module compiler/opcodes
 */

import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Opcode enum
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Every instruction the Ruam VM can execute.
 *
 * **Categories (24):**
 *
 *  1. Stack Manipulation        2. Register / Argument
 *  3. Arithmetic                4. Bitwise
 *  5. Logical                   6. Comparison
 *  7. Control Flow              8. Property Access
 *  9. Scope & Variables        10. Call / Construct
 * 11. Object / Array           12. Class
 * 13. Function / Closure       14. Generator / Async
 * 15. Exception Handling       16. Iterator (Sync)
 * 17. Iterator (Async)         18. Type Operations
 * 19. Template Literal         20. Compound / Fast Paths
 * 21. Special / Environment    22. Destructuring Helpers
 * 23. Arguments / Rest         24. Reserved
 *
 * The special `__COUNT` sentinel at the end provides the total count.
 */
export enum Op {
	// ═════════════════════════════════════════════════════════════════════════
	//  1. Stack Manipulation
	// ═════════════════════════════════════════════════════════════════════════

	/** Push constant pool entry (operand = pool index). */
	PUSH_CONST,
	/** Push `undefined`. */
	PUSH_UNDEFINED,
	/** Push `null`. */
	PUSH_NULL,
	/** Push `true`. */
	PUSH_TRUE,
	/** Push `false`. */
	PUSH_FALSE,
	/** Push numeric `0`. */
	PUSH_ZERO,
	/** Push numeric `1`. */
	PUSH_ONE,
	/** Push numeric `-1`. */
	PUSH_NEG_ONE,
	/** Push empty string `""`. */
	PUSH_EMPTY_STRING,
	/** Push `NaN`. */
	PUSH_NAN,
	/** Push `Infinity`. */
	PUSH_INFINITY,
	/** Push `-Infinity`. */
	PUSH_NEG_INFINITY,
	/** Discard top of stack. */
	POP,
	/** Discard N items from stack (operand = count). */
	POP_N,
	/** Duplicate top of stack. */
	DUP,
	/** Duplicate the top two stack items: `[a, b]` → `[a, b, a, b]`. */
	DUP2,
	/** Swap top two items: `[a, b]` → `[b, a]`. */
	SWAP,
	/** Rotate top 3: `[a, b, c]` → `[c, a, b]`. */
	ROT3,
	/** Rotate top 4: `[a, b, c, d]` → `[d, a, b, c]`. */
	ROT4,
	/** Copy item at depth N to top of stack (operand = depth). */
	PICK,

	// ═════════════════════════════════════════════════════════════════════════
	//  2. Register / Argument Access
	// ═════════════════════════════════════════════════════════════════════════

	/** Push value from register (operand = register index). */
	LOAD_REG,
	/** Pop value into register (operand = register index). */
	STORE_REG,
	/** Push argument by index (operand = arg index). */
	LOAD_ARG,
	/** Pop value into argument slot (operand = arg index). */
	STORE_ARG,
	/** Push argument or `undefined` if index >= arguments.length. */
	LOAD_ARG_OR_DEFAULT,
	/** Push `arguments.length`. */
	GET_ARG_COUNT,

	// ═════════════════════════════════════════════════════════════════════════
	//  3. Arithmetic
	// ═════════════════════════════════════════════════════════════════════════

	/** `a + b` — addition / string concatenation. */
	ADD,
	/** `a - b`. */
	SUB,
	/** `a * b`. */
	MUL,
	/** `a / b`. */
	DIV,
	/** `a % b` — remainder. */
	MOD,
	/** `a ** b` — exponentiation. */
	POW,
	/** `-a` — unary minus. */
	NEG,
	/** `+a` — unary plus (ToNumber coercion). */
	UNARY_PLUS,
	/** Increment TOS: `a + 1`. */
	INC,
	/** Decrement TOS: `a - 1`. */
	DEC,

	// ═════════════════════════════════════════════════════════════════════════
	//  4. Bitwise
	// ═════════════════════════════════════════════════════════════════════════

	/** `a & b`. */
	BIT_AND,
	/** `a | b`. */
	BIT_OR,
	/** `a ^ b`. */
	BIT_XOR,
	/** `~a` — bitwise NOT. */
	BIT_NOT,
	/** `a << b` — left shift. */
	SHL,
	/** `a >> b` — signed right shift. */
	SHR,
	/** `a >>> b` — unsigned right shift. */
	USHR,

	// ═════════════════════════════════════════════════════════════════════════
	//  5. Logical
	// ═════════════════════════════════════════════════════════════════════════

	/** `!a` — logical NOT. */
	NOT,
	/** Short-circuit `&&` (operand = jump target if falsy). */
	LOGICAL_AND,
	/** Short-circuit `||` (operand = jump target if truthy). */
	LOGICAL_OR,
	/** Short-circuit `??` (operand = jump target if non-nullish). */
	NULLISH_COALESCE,

	// ═════════════════════════════════════════════════════════════════════════
	//  6. Comparison
	// ═════════════════════════════════════════════════════════════════════════

	/** `a == b` — abstract equality. */
	EQ,
	/** `a != b` — abstract inequality. */
	NEQ,
	/** `a === b` — strict equality. */
	SEQ,
	/** `a !== b` — strict inequality. */
	SNEQ,
	/** `a < b`. */
	LT,
	/** `a <= b`. */
	LTE,
	/** `a > b`. */
	GT,
	/** `a >= b`. */
	GTE,

	// ═════════════════════════════════════════════════════════════════════════
	//  7. Control Flow
	// ═════════════════════════════════════════════════════════════════════════

	/** Unconditional jump (operand = target IP). */
	JMP,
	/** Pop, jump if truthy. */
	JMP_TRUE,
	/** Pop, jump if falsy. */
	JMP_FALSE,
	/** Pop, jump if `null` or `undefined`. */
	JMP_NULLISH,
	/** Pop, jump if strictly `undefined`. */
	JMP_UNDEFINED,
	/** Jump if truthy — keep value on stack (no pop). */
	JMP_TRUE_KEEP,
	/** Jump if falsy — keep value on stack (no pop). */
	JMP_FALSE_KEEP,
	/** Jump if nullish — keep value on stack (no pop). */
	JMP_NULLISH_KEEP,
	/** Return with value (pop and return). */
	RETURN,
	/** Return `undefined`. */
	RETURN_VOID,
	/** Throw exception (pop and throw). */
	THROW,
	/** Re-throw the current pending exception. */
	RETHROW,
	/** No operation (padding / alignment). */
	NOP,
	/** Compile-time only — patched to JMP before runtime. */
	BREAK,
	/** Compile-time only — patched to JMP before runtime. */
	CONTINUE,
	/** Compile-time label marker. */
	LABEL,
	/** Jump table dispatch for dense switch (operand = table offset). */
	TABLE_SWITCH,
	/** Hash-based jump dispatch for sparse switch (operand = table offset). */
	LOOKUP_SWITCH,

	// ═════════════════════════════════════════════════════════════════════════
	//  8. Property Access
	// ═════════════════════════════════════════════════════════════════════════

	/** `obj.prop` — static property get (operand = name pool index). */
	GET_PROP_STATIC,
	/** `obj.prop = val` — static property set (operand = name pool index). */
	SET_PROP_STATIC,
	/** `obj[key]` — dynamic property get. */
	GET_PROP_DYNAMIC,
	/** `obj[key] = val` — dynamic property set. */
	SET_PROP_DYNAMIC,
	/** `delete obj.prop` (operand = name pool index). */
	DELETE_PROP_STATIC,
	/** `delete obj[key]`. */
	DELETE_PROP_DYNAMIC,
	/** `obj?.prop` — optional chaining static (operand = name pool index). */
	OPT_CHAIN_GET,
	/** `obj?.[key]` — optional chaining dynamic. */
	OPT_CHAIN_DYNAMIC,
	/** `key in obj`. */
	IN_OP,
	/** `obj instanceof Ctor`. */
	INSTANCEOF,
	/** `super.prop` or `super[expr]` — get super property (operand = name pool index, -1 for dynamic). */
	GET_SUPER_PROP,
	/** `super.prop = val` or `super[expr] = val` — set super property. */
	SET_SUPER_PROP,
	/** `this.#field` — read private field (operand = private name pool index). */
	GET_PRIVATE_FIELD,
	/** `this.#field = val` — write private field (operand = private name pool index). */
	SET_PRIVATE_FIELD,
	/** `#field in obj` — check private field existence. */
	HAS_PRIVATE_FIELD,
	/** Shorthand for `Object.defineProperty(obj, key, descriptor)`. */
	DEFINE_OWN_PROPERTY,

	// ═════════════════════════════════════════════════════════════════════════
	//  9. Scope & Variables
	// ═════════════════════════════════════════════════════════════════════════

	/** Load global variable (operand = name pool index). */
	LOAD_GLOBAL,
	/** Store global variable (operand = name pool index). */
	STORE_GLOBAL,
	/** Load scoped variable — walks scope chain (operand = name pool index). */
	LOAD_SCOPED,
	/** Store scoped variable — walks scope chain (operand = name pool index). */
	STORE_SCOPED,
	/** Declare `var` (function-scoped, hoisted). */
	DECLARE_VAR,
	/** Declare `let` (block-scoped, TDZ). */
	DECLARE_LET,
	/** Declare `const` (block-scoped, TDZ, immutable). */
	DECLARE_CONST,
	/** Enter new scope. */
	PUSH_SCOPE,
	/** Exit current scope. */
	POP_SCOPE,
	/** Check temporal dead zone — throw ReferenceError if uninitialised. */
	TDZ_CHECK,
	/** Mark variable as initialised (exit TDZ). */
	TDZ_MARK,
	/** Enter `with(obj)` scope — TOS is the object. */
	PUSH_WITH_SCOPE,
	/** Enter explicit block scope (let/const). */
	PUSH_BLOCK_SCOPE,
	/** Enter catch clause scope. */
	PUSH_CATCH_SCOPE,
	/** `delete identifier` — sloppy mode only. */
	DELETE_SCOPED,

	// ═════════════════════════════════════════════════════════════════════════
	// 10. Call / Construct
	// ═════════════════════════════════════════════════════════════════════════

	/** Call function (operand = arg count; negative means has spread). */
	CALL,
	/** Call method preserving `this` (operand = arg count). */
	CALL_METHOD,
	/** `new Constructor()` (operand = arg count). */
	CALL_NEW,
	/** `super()` (operand = arg count). */
	SUPER_CALL,
	/** Mark preceding argument as spread. */
	SPREAD_ARGS,
	/** `fn?.()` — optional call (operand = arg count). */
	CALL_OPTIONAL,
	/** `obj.method?.()` — optional method call (operand = arg count). */
	CALL_METHOD_OPTIONAL,
	/** `eval()` with local scope access. */
	DIRECT_EVAL,
	/** `` tag`template` `` — tagged template call (operand = arg count). */
	CALL_TAGGED_TEMPLATE,
	/** `super.method()` (operand = arg count). */
	CALL_SUPER_METHOD,
	/** Fast path: call with 0 args. */
	CALL_0,
	/** Fast path: call with 1 arg. */
	CALL_1,
	/** Fast path: call with 2 args. */
	CALL_2,
	/** Fast path: call with 3 args. */
	CALL_3,

	// ═════════════════════════════════════════════════════════════════════════
	// 11. Object / Array
	// ═════════════════════════════════════════════════════════════════════════

	/** Create empty object `{}`. */
	NEW_OBJECT,
	/** Create empty array `[]`. */
	NEW_ARRAY,
	/** Create array with pre-allocated capacity (operand = size hint). */
	NEW_ARRAY_WITH_SIZE,
	/** Push element onto array (TOS = value, below = array). */
	ARRAY_PUSH,
	/** Push hole / empty slot into array (sparse array support). */
	ARRAY_HOLE,
	/** Spread iterable into array. */
	SPREAD_ARRAY,
	/** `Object.assign(target, source)` — spread into object. */
	SPREAD_OBJECT,
	/** Copy own enumerable properties (for object rest / spread). */
	COPY_DATA_PROPERTIES,
	/** `Object.setPrototypeOf(obj, proto)`. */
	SET_PROTO,
	/** `Object.freeze(obj)`. */
	FREEZE_OBJECT,
	/** `Object.seal(obj)`. */
	SEAL_OBJECT,
	/** `Object.defineProperty(obj, key, descriptor)`. */
	DEFINE_PROPERTY_DESC,
	/** Create frozen template strings array with `.raw` property. */
	CREATE_TEMPLATE_OBJECT,

	// ═════════════════════════════════════════════════════════════════════════
	// 12. Class
	// ═════════════════════════════════════════════════════════════════════════

	/** Create class constructor (operand: 0 = no super, 1 = has super). */
	NEW_CLASS,
	/** Create derived class with explicit super (TOS = superclass). */
	NEW_DERIVED_CLASS,
	/** Define prototype method (operand = name pool index). */
	DEFINE_METHOD,
	/** Define static method (operand = name pool index). */
	DEFINE_STATIC_METHOD,
	/** Define prototype getter (operand = name pool index). */
	DEFINE_GETTER,
	/** Define static getter (operand = name pool index). */
	DEFINE_STATIC_GETTER,
	/** Define prototype setter (operand = name pool index). */
	DEFINE_SETTER,
	/** Define static setter (operand = name pool index). */
	DEFINE_STATIC_SETTER,
	/** Define instance field initialiser (operand = name pool index). */
	DEFINE_FIELD,
	/** Define static field (operand = name pool index). */
	DEFINE_STATIC_FIELD,
	/** Define private instance method. */
	DEFINE_PRIVATE_METHOD,
	/** Define private getter. */
	DEFINE_PRIVATE_GETTER,
	/** Define private setter. */
	DEFINE_PRIVATE_SETTER,
	/** Define private instance field. */
	DEFINE_PRIVATE_FIELD,
	/** Define static private field. */
	DEFINE_STATIC_PRIVATE_FIELD,
	/** Define static private method. */
	DEFINE_STATIC_PRIVATE_METHOD,
	/** Execute `static { ... }` block. */
	CLASS_STATIC_BLOCK,
	/** Finalise class: seal prototype, set name, freeze if needed. */
	FINALIZE_CLASS,
	/** Initialise private name environment for a class. */
	INIT_PRIVATE_ENV,
	/** Add brand check symbol to instance (for private field access). */
	ADD_PRIVATE_BRAND,
	/** Verify brand before private field access. */
	CHECK_PRIVATE_BRAND,
	/** Set up prototype chain for class inheritance (legacy, kept for compat). */
	EXTEND_CLASS,

	// ═════════════════════════════════════════════════════════════════════════
	// 13. Function / Closure
	// ═════════════════════════════════════════════════════════════════════════

	/** Create closure that captures current scope (operand = unit ID pool index). */
	NEW_CLOSURE,
	/** Create function without scope capture (operand = unit ID pool index). */
	NEW_FUNCTION,
	/** Create arrow function (captures `this` + scope). */
	NEW_ARROW,
	/** Create async function. */
	NEW_ASYNC,
	/** Create generator function. */
	NEW_GENERATOR,
	/** Create async generator function. */
	NEW_ASYNC_GENERATOR,
	/** Set `function.name` (operand = name pool index). */
	SET_FUNC_NAME,
	/** Set `function.length` (operand = parameter count). */
	SET_FUNC_LENGTH,
	/** Bind `this` value for arrow functions. */
	BIND_THIS,
	/** Set `[[HomeObject]]` for `super` access in methods. */
	MAKE_METHOD,
	/** Load a captured (closure) variable. */
	PUSH_CLOSURE_VAR,
	/** Store to a captured (closure) variable. */
	STORE_CLOSURE_VAR,

	// ═════════════════════════════════════════════════════════════════════════
	// 14. Generator / Async
	// ═════════════════════════════════════════════════════════════════════════

	/** `yield expr` — yield a value. */
	YIELD,
	/** `yield* expr` — delegate to sub-generator / iterable. */
	YIELD_DELEGATE,
	/** `await expr` — suspend until promise resolves. */
	AWAIT,
	/** Initialise generator state machine (save IP, stack, scope). */
	CREATE_GENERATOR,
	/** Resume generator from yield point. */
	GENERATOR_RESUME,
	/** `generator.return(value)` — force return. */
	GENERATOR_RETURN,
	/** `generator.throw(error)` — inject exception. */
	GENERATOR_THROW,
	/** Save full execution state for later resumption. */
	SUSPEND,
	/** Restore execution state from suspension. */
	RESUME,
	/** Async generator yield (yields promise). */
	ASYNC_GENERATOR_YIELD,
	/** Async generator `.next()` handler. */
	ASYNC_GENERATOR_NEXT,
	/** Async generator `.return()` handler. */
	ASYNC_GENERATOR_RETURN,
	/** Async generator `.throw()` handler. */
	ASYNC_GENERATOR_THROW,
	/** Wrap a sync iterator for `for await...of`. */
	CREATE_ASYNC_FROM_SYNC_ITER,

	// ═════════════════════════════════════════════════════════════════════════
	// 15. Exception Handling
	// ═════════════════════════════════════════════════════════════════════════

	/** Enter try block (operand encodes catch/finally IPs). */
	TRY_PUSH,
	/** Exit try block. */
	TRY_POP,
	/** Bind caught exception to variable (operand = name pool index, -1 for anonymous). */
	CATCH_BIND,
	/** Bind caught exception via destructuring pattern. */
	CATCH_BIND_PATTERN,
	/** Enter finally block. */
	FINALLY_MARK,
	/** Exit finally block (re-throw pending exception if any). */
	END_FINALLY,
	/** Throw `TypeError` if TOS is not an object (iterator protocol). */
	THROW_IF_NOT_OBJECT,
	/** Throw `ReferenceError` (TDZ violation, undeclared access). */
	THROW_REF_ERROR,
	/** Throw `TypeError` (calling non-function, readonly assignment, etc.). */
	THROW_TYPE_ERROR,
	/** Throw `SyntaxError` (invalid destructuring, duplicate export, etc.). */
	THROW_SYNTAX_ERROR,

	// ═════════════════════════════════════════════════════════════════════════
	// 16. Iterator (Sync)
	// ═════════════════════════════════════════════════════════════════════════

	/** Get `Symbol.iterator` from TOS, call `.next()`, push iterator state. */
	GET_ITERATOR,
	/** Call `.next()` on iterator, push value. */
	ITER_NEXT,
	/** Check `.done` on iterator state, push boolean. */
	ITER_DONE,
	/** Get `.value` from iterator result. */
	ITER_VALUE,
	/** Call `.return()` on iterator (for early exit / break). */
	ITER_CLOSE,
	/** Extract both `.value` and `.done` from iterator result. */
	ITER_RESULT_UNWRAP,
	/** Initialise `for-in` enumeration (TOS = object → key list). */
	FORIN_INIT,
	/** Get next `for-in` key. */
	FORIN_NEXT,
	/** Check if `for-in` enumeration is exhausted. */
	FORIN_DONE,

	// ═════════════════════════════════════════════════════════════════════════
	// 17. Iterator (Async)
	// ═════════════════════════════════════════════════════════════════════════

	/** Get `Symbol.asyncIterator` from TOS. */
	GET_ASYNC_ITERATOR,
	/** `await iterator.next()` — async iterator next. */
	ASYNC_ITER_NEXT,
	/** Check `.done` on async iterator result. */
	ASYNC_ITER_DONE,
	/** Get `.value` from async iterator result. */
	ASYNC_ITER_VALUE,
	/** `await iterator.return()` — async iterator cleanup. */
	ASYNC_ITER_CLOSE,
	/** Combined next + await for `for await...of`. */
	FOR_AWAIT_NEXT,

	// ═════════════════════════════════════════════════════════════════════════
	// 18. Type Operations
	// ═════════════════════════════════════════════════════════════════════════

	/** `typeof value`. */
	TYPEOF,
	/** `typeof identifier` — safe on potentially undeclared names. */
	TYPEOF_GLOBAL,
	/** `void expr` — evaluate and discard, push `undefined`. */
	VOID,
	/** `Number(value)` — explicit numeric coercion. */
	TO_NUMBER,
	/** `String(value)` — explicit string coercion. */
	TO_STRING,
	/** `Boolean(value)` — explicit boolean coercion. */
	TO_BOOLEAN,
	/** `Object(value)` — box primitive to object wrapper. */
	TO_OBJECT,
	/** Convert to property key (string or symbol via `Symbol.toPrimitive`). */
	TO_PROPERTY_KEY,
	/** `ToNumeric` abstract operation (BigInt-aware coercion). */
	TO_NUMERIC,

	// ═════════════════════════════════════════════════════════════════════════
	// 19. Template Literal
	// ═════════════════════════════════════════════════════════════════════════

	/** Build template string from quasis + expressions (operand = expression count). */
	TEMPLATE_LITERAL,
	/** Tagged template call (operand = expression count). */
	TAGGED_TEMPLATE,
	/** Create frozen `.raw` strings array for tagged templates. */
	CREATE_RAW_STRINGS,

	// ═════════════════════════════════════════════════════════════════════════
	// 20. Compound / Fast Paths
	//
	//     These fuse common multi-instruction patterns into single opcodes.
	//     The compiler may optionally emit these for performance, or use
	//     the equivalent multi-opcode sequences.
	// ═════════════════════════════════════════════════════════════════════════

	/** `++variable` — pre-increment scoped variable (operand = name pool index). */
	INC_SCOPED,
	/** `--variable` — pre-decrement scoped variable (operand = name pool index). */
	DEC_SCOPED,
	/** `variable++` — post-increment (pushes old value). */
	POST_INC_SCOPED,
	/** `variable--` — post-decrement (pushes old value). */
	POST_DEC_SCOPED,
	/** `variable += TOS` (operand = name pool index). */
	ADD_ASSIGN_SCOPED,
	/** `variable -= TOS` (operand = name pool index). */
	SUB_ASSIGN_SCOPED,
	/** `variable *= TOS` (operand = name pool index). */
	MUL_ASSIGN_SCOPED,
	/** `variable /= TOS` (operand = name pool index). */
	DIV_ASSIGN_SCOPED,
	/** `variable %= TOS` (operand = name pool index). */
	MOD_ASSIGN_SCOPED,
	/** `variable **= TOS` (operand = name pool index). */
	POW_ASSIGN_SCOPED,
	/** `variable &= TOS`. */
	BIT_AND_ASSIGN_SCOPED,
	/** `variable |= TOS`. */
	BIT_OR_ASSIGN_SCOPED,
	/** `variable ^= TOS`. */
	BIT_XOR_ASSIGN_SCOPED,
	/** `variable <<= TOS`. */
	SHL_ASSIGN_SCOPED,
	/** `variable >>= TOS`. */
	SHR_ASSIGN_SCOPED,
	/** `variable >>>= TOS`. */
	USHR_ASSIGN_SCOPED,
	/** `variable &&= TOS` — logical AND assignment. */
	AND_ASSIGN_SCOPED,
	/** `variable ||= TOS` — logical OR assignment. */
	OR_ASSIGN_SCOPED,
	/** `variable ??= TOS` — nullish coalescing assignment. */
	NULLISH_ASSIGN_SCOPED,
	/** Generic compound assignment (operand encodes operation + target). */
	ASSIGN_OP,
	/** `++register` (operand = register index). */
	INC_REG,
	/** `--register` (operand = register index). */
	DEC_REG,
	/** Add immediate numeric constant to TOS (operand = constant). */
	FAST_ADD_CONST,
	/** Subtract immediate numeric constant from TOS (operand = constant). */
	FAST_SUB_CONST,
	/** Load scoped variable + get property in one op (operand encodes both). */
	FAST_GET_PROP,
	/** Cached global variable lookup (operand = name pool index). */
	LOAD_GLOBAL_FAST,

	// ═════════════════════════════════════════════════════════════════════════
	// 21. Special / Environment
	// ═════════════════════════════════════════════════════════════════════════

	/** Push current `this` value. */
	PUSH_THIS,
	/** Push `arguments` object. */
	PUSH_ARGUMENTS,
	/** Push `new.target` meta-property. */
	PUSH_NEW_TARGET,
	/** Push `globalThis`. */
	PUSH_GLOBAL_THIS,
	/** Push well-known symbol (operand: 0=iterator, 1=asyncIterator, 2=hasInstance, etc.). */
	PUSH_WELL_KNOWN_SYMBOL,
	/** Push `import.meta` object. */
	IMPORT_META,
	/** `import(specifier)` — dynamic import expression. */
	DYNAMIC_IMPORT,
	/** `debugger` statement. */
	DEBUGGER_STMT,
	/** No-op separator (comma operator artifact). */
	COMMA,
	/** Source location marker for stack traces (operand encodes line/col). */
	SOURCE_MAP,
	/** Throw `TypeError` if TOS is `undefined` (guard for member access). */
	ASSERT_DEFINED,
	/** Throw `TypeError` if TOS is not callable (guard before call). */
	ASSERT_FUNCTION,

	// ═════════════════════════════════════════════════════════════════════════
	// 22. Destructuring Helpers
	// ═════════════════════════════════════════════════════════════════════════

	/** General-purpose destructuring bind target. */
	DESTRUCTURE_BIND,
	/** Apply default value if TOS is `undefined`. */
	DESTRUCTURE_DEFAULT,
	/** Collect remaining array items into rest element. */
	DESTRUCTURE_REST_ARRAY,
	/** Collect remaining object properties into rest element. */
	DESTRUCTURE_REST_OBJECT,
	/** Initialise array pattern iterator from TOS. */
	ARRAY_PATTERN_INIT,
	/** Get object property for destructuring (operand = name pool index). */
	OBJECT_PATTERN_GET,

	// ═════════════════════════════════════════════════════════════════════════
	// 23. Arguments / Rest
	// ═════════════════════════════════════════════════════════════════════════

	/** Create strict-mode (unmapped) arguments object. */
	CREATE_UNMAPPED_ARGS,
	/** Create sloppy-mode (mapped) arguments object. */
	CREATE_MAPPED_ARGS,
	/** Create rest parameter array from arguments (operand = start index). */
	CREATE_REST_ARGS,

	// ═════════════════════════════════════════════════════════════════════════
	// 24. Reserved for future use
	// ═════════════════════════════════════════════════════════════════════════

	// ═════════════════════════════════════════════════════════════════════════
	// 24. Register-based Fast Paths (Tier 1 & 3 optimizations)
	//
	//     These use registers instead of scope chain for non-captured locals.
	//     Superinstructions fuse common multi-op patterns into single dispatch.
	// ═════════════════════════════════════════════════════════════════════════

	/** `register++` — post-increment register (pushes old value). */
	POST_INC_REG,
	/** `register--` — post-decrement register (pushes old value). */
	POST_DEC_REG,
	/** `register += TOS` (operand = register index). */
	ADD_ASSIGN_REG,
	/** `register -= TOS`. */
	SUB_ASSIGN_REG,
	/** `register *= TOS`. */
	MUL_ASSIGN_REG,
	/** `register /= TOS`. */
	DIV_ASSIGN_REG,
	/** `register %= TOS`. */
	MOD_ASSIGN_REG,

	// --- Superinstructions (Tier 3) ---

	/** LOAD_REG(a) + LOAD_REG(b) + ADD → push R[a]+R[b]. Operand: a | (b << 16). */
	REG_ADD,
	/** LOAD_REG(a) + LOAD_REG(b) + SUB → push R[a]-R[b]. */
	REG_SUB,
	/** LOAD_REG(a) + LOAD_REG(b) + MUL → push R[a]*R[b]. */
	REG_MUL,
	/** LOAD_REG(a) + LOAD_REG(b) + LT → push R[a]<R[b]. */
	REG_LT,
	/** LOAD_REG(a) + LOAD_REG(b) + LTE → push R[a]<=R[b]. */
	REG_LTE,
	/** LOAD_REG(a) + LOAD_REG(b) + GT → push R[a]>R[b]. */
	REG_GT,
	/** LOAD_REG(a) + LOAD_REG(b) + SEQ → push R[a]===R[b]. */
	REG_SEQ,
	/** LOAD_REG(a) + LOAD_REG(b) + SNEQ → push R[a]!==R[b]. */
	REG_SNEQ,
	/** LOAD_REG(r) + PUSH_CONST(c) + LT + JMP_FALSE(t). Operand: r | (c << 8). Target in next instruction slot. */
	REG_LT_CONST_JF,
	/** LOAD_REG(r) + GET_PROP_STATIC(name) → push R[r][C[name]]. Operand: r | (name << 16). */
	REG_GET_PROP,
	/** LOAD_REG(r) + PUSH_CONST(c) + ADD + STORE_REG(r) — fused add-const-to-reg. Operand: r | (c << 16). */
	REG_ADD_CONST,

	/** LOAD_REG(a) + LOAD_REG(b) + GTE → push R[a]>=R[b]. */
	REG_GTE,
	/** LOAD_REG(a) + LOAD_REG(b) + DIV → push R[a]/R[b]. */
	REG_DIV,
	/** LOAD_REG(a) + LOAD_REG(b) + MOD → push R[a]%R[b]. */
	REG_MOD,
	/** LOAD_REG(r) + PUSH_CONST(c) + SUB → push R[r]-C[c]. Operand: r | (c << 16). */
	REG_CONST_SUB,
	/** LOAD_REG(r) + PUSH_CONST(c) + MUL → push R[r]*C[c]. Operand: r | (c << 16). */
	REG_CONST_MUL,
	/** LOAD_REG(r) + PUSH_CONST(c) + MOD → push R[r]%C[c]. Operand: r | (c << 16). */
	REG_CONST_MOD,
	/** LOAD_REG(a) + LOAD_REG(b) + LT + JMP_FALSE(t) → 4-instruction loop guard. Operand: a | (b << 8) | (t << 16). */
	REG_LT_REG_JF,

	// --- Indexed Scope Opcodes (Tier 4) ---

	/** Load from indexed scope slot. Operand: slot index. */
	LOAD_SLOT,
	/** Store TOS to indexed scope slot. Operand: slot index. */
	STORE_SLOT,
	/** Declare indexed scope slot. Operand: slot index. */
	DECLARE_SLOT,
	/** `++slot` — pre-increment indexed scope slot. */
	INC_SLOT,
	/** `--slot` — pre-decrement indexed scope slot. */
	DEC_SLOT,
	/** `slot++` — post-increment indexed scope slot (pushes old value). */
	POST_INC_SLOT,
	/** `slot--` — post-decrement indexed scope slot (pushes old value). */
	POST_DEC_SLOT,
	/** `slot += TOS`. */
	ADD_ASSIGN_SLOT,
	/** `slot -= TOS`. */
	SUB_ASSIGN_SLOT,
	/** `slot *= TOS`. */
	MUL_ASSIGN_SLOT,
	/** Push new indexed scope frame. Operand: number of slots. */
	PUSH_INDEXED_SCOPE,
	/** Pop indexed scope frame. */
	POP_INDEXED_SCOPE,

	// ═════════════════════════════════════════════════════════════════════════
	// 25. Runtime Mutation
	// ═════════════════════════════════════════════════════════════════════════

	/**
	 * Mutate the handler table at runtime. Operand = mutation seed.
	 * Performs deterministic swaps on `_ht`, changing which handler
	 * each physical opcode maps to. Entangled with rolling cipher.
	 */
	MUTATE,

	// ─────────────────────────────────────────────────────────────────────────

	/** Sentinel — not a real opcode; its numeric value equals the total count. */
	__COUNT,
}

/** Total number of real opcodes (excludes `__COUNT`). */
export const OPCODE_COUNT = Op.__COUNT;

// ═══════════════════════════════════════════════════════════════════════════════
// Centralized opcode sets
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Simple jump opcodes whose operand is a direct IP target.
 * Used by the peephole optimizer for jump threading.
 */
export const JUMP_OPS = new Set<Op>([
	Op.JMP,
	Op.JMP_TRUE,
	Op.JMP_FALSE,
	Op.JMP_NULLISH,
	Op.JMP_UNDEFINED,
	Op.JMP_TRUE_KEEP,
	Op.JMP_FALSE_KEEP,
	Op.JMP_NULLISH_KEEP,
]);

/**
 * All opcodes whose operand encodes an IP target — includes simple jumps,
 * switch dispatch, and logical short-circuit operators.
 * Used by dead-code injection and jump target patching.
 */
export const ALL_JUMP_OPS = new Set<Op>([
	...JUMP_OPS,
	Op.TABLE_SWITCH,
	Op.LOOKUP_SWITCH,
	Op.LOGICAL_AND,
	Op.LOGICAL_OR,
	Op.NULLISH_COALESCE,
]);

/**
 * Opcodes that pack a jump target into upper bits of the operand.
 * Used by jump target patching to extract/repack IP targets.
 */
export const PACKED_JUMP_OPS = new Set<Op>([
	Op.TRY_PUSH,
	Op.REG_LT_CONST_JF,
	Op.REG_LT_REG_JF,
]);

/**
 * Numeric binary opcodes eligible for constant folding.
 * Maps each foldable opcode to its JS evaluation function.
 */
export const FOLDABLE_BINOPS = new Map<
	Op,
	(a: number, b: number) => number | null
>([
	[Op.ADD, (a, b) => a + b],
	[Op.SUB, (a, b) => a - b],
	[Op.MUL, (a, b) => a * b],
	[Op.DIV, (a, b) => (b !== 0 ? a / b : null)],
	[Op.MOD, (a, b) => (b !== 0 ? a % b : null)],
	[Op.BIT_AND, (a, b) => a & b],
	[Op.BIT_OR, (a, b) => a | b],
	[Op.BIT_XOR, (a, b) => a ^ b],
	[Op.SHL, (a, b) => a << b],
	[Op.SHR, (a, b) => a >> b],
	[Op.USHR, (a, b) => a >>> b],
]);

/**
 * Pure push opcodes — side-effect-free instructions that only push a value.
 * Used by dead pair elimination (DUP+POP, PUSH+POP).
 */
export const PURE_PUSH_OPS = new Set<Op>([
	Op.PUSH_CONST,
	Op.PUSH_UNDEFINED,
	Op.PUSH_NULL,
	Op.PUSH_TRUE,
	Op.PUSH_FALSE,
	Op.PUSH_ZERO,
	Op.PUSH_ONE,
	Op.PUSH_NEG_ONE,
	Op.PUSH_EMPTY_STRING,
	Op.PUSH_NAN,
	Op.PUSH_INFINITY,
	Op.PUSH_NEG_INFINITY,
	Op.LOAD_REG,
]);

/**
 * Mapping from standard binary opcode to its register-register superinstruction.
 * Used by the superinstruction fusion pass.
 */
export const REG_BINOP_MAP = new Map<Op, Op>([
	[Op.ADD, Op.REG_ADD],
	[Op.SUB, Op.REG_SUB],
	[Op.MUL, Op.REG_MUL],
	[Op.DIV, Op.REG_DIV],
	[Op.MOD, Op.REG_MOD],
	[Op.LT, Op.REG_LT],
	[Op.LTE, Op.REG_LTE],
	[Op.GT, Op.REG_GT],
	[Op.GTE, Op.REG_GTE],
	[Op.SEQ, Op.REG_SEQ],
	[Op.SNEQ, Op.REG_SNEQ],
]);

/**
 * Mapping from standard binary opcode to its register-constant superinstruction.
 * Used by the superinstruction fusion pass.
 */
export const REG_CONST_BINOP_MAP = new Map<Op, Op>([
	[Op.SUB, Op.REG_CONST_SUB],
	[Op.MUL, Op.REG_CONST_MUL],
	[Op.MOD, Op.REG_CONST_MOD],
]);

// ═══════════════════════════════════════════════════════════════════════════════
// Shuffle map utilities
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a deterministic permutation of opcode indices via Fisher-Yates
 * shuffle driven by an LCG PRNG.
 *
 * @param seed - 32-bit unsigned integer seed.
 * @returns Array where `map[logicalOp]` gives the physical opcode.
 */
export function generateShuffleMap(seed: number): number[] {
	const map: number[] = [];
	for (let i = 0; i < OPCODE_COUNT; i++) map[i] = i;

	let s = seed >>> 0;
	for (let i = OPCODE_COUNT - 1; i > 0; i--) {
		s = (s * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
		const j = s % (i + 1);
		const tmp = map[i]!;
		map[i] = map[j]!;
		map[j] = tmp;
	}

	return map;
}

/**
 * Invert a shuffle map so `inv[physicalOp]` yields the logical opcode.
 */
export function invertShuffleMap(map: number[]): number[] {
	const inv: number[] = new Array(map.length);
	for (let i = 0; i < map.length; i++) {
		inv[map[i]!] = i;
	}
	return inv;
}
