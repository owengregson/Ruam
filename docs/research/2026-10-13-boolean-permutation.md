# Experimental Boolean permutation construction

`packages/ruam/src/algorithm-state/native/boolean-permutation.ts` implements a bounded width-five permutation construction and emits a native function through typed `JsNode` builders and `NameRegistry`. It is internal experimental infrastructure, absent from production exports and presets. It does not replace the general JavaScript backend and has no protection qualification.

## Admitted contract

The input is a finite owner-side formula IR with Boolean constants, positional input references, negation, conjunction and disjunction. The generated anonymous function accepts already captured **primitive Boolean** parameters and returns a Boolean. It checks each declared parameter with `typeof`; missing or non-Boolean arguments throw without invoking their conversion methods. Extra arguments are ignored like ordinary unused JavaScript arguments.

This interface does not admit arbitrary JavaScript expressions. It does not move property accesses, calls, comparisons, conversions or conditional effects across the capture boundary. A separate source adapter must prove that preparing those Boolean inputs and replacing the original return expression preserves JavaScript semantics. Merely knowing a function returns a Boolean does not prove its expression is pure. The unchanged general backend continues to determine product scope; declined source must not be credited as protected by this experiment.

`compileBooleanPermutationCode` in `boolean-permutation-source.ts` supplies that separate, opt-in source adapter for a positive grammar. It admits simple ordinary function declarations, expressions and arrows with a single Boolean-valued return. Its expression grammar contains local formal references, inert literal values, negation, logical conjunction/disjunction and conditional expressions. Strict equality and inequality may compare formals, literals and `typeof` applied to formals. The returned value must be provably Boolean; an operand-valued return such as `a && b` is declined. Property reads, calls, coercive comparisons, global references, writes, default/rest/destructured parameters, methods and suspending functions are declined.

The adapter captures only referenced formals and admitted strict predicates, applying `!!` to each capture. ToBoolean, strict equality and `typeof` on these local values do not invoke conversion hooks, including for objects, symbols and revoked proxies. Eager evaluation of those pure captures therefore introduces no user effects. Thus admitted source functions continue accepting arbitrary JavaScript argument values; the primitive-Boolean guard belongs only to the inner IR function. Directives, original parameters, function naming and constructibility remain in the outer AST. Source reflection and resource equivalence are not preserved or claimed.

Source output retains all declined functions. The caller separately selects the residual backend; this pass does not run either the existing VM or the experimental native backend. The adapter has separate aggregate limits of 32 admitted functions and 1,048,576 generated call-expression bytes by default, with hard maxima of 1,024 functions and 16,777,216 bytes. Each expression also has an admission traversal cap. Budget exhaustion declines the particular transform instead of truncating source computation; invalid options and compiler errors propagate. No production export or preset enables either entry point.

Formula admission accepts only the documented own data fields and ordinary or null-prototype records. It rejects unsupported node kinds, extra fields, invalid indices, ordinary accessors and cycles. This is an internal compiler IR contract, not a hostile-object sandbox: a Proxy can execute metaprogramming traps during inspection. Compiler counters bound admitted data structures and construction, not arbitrary code in those traps.

## Construction and invariant

Represent a permutation as its five images. Execution of a step is `state = permutation[state]`; the emitted implementation expresses that selection with scalar conditional expressions, without runtime arrays, program tables, dispatch loops, evaluators or source strings.

Each compiled formula has the stronger invariant that its complete permutation product is identity when false and the fixed cycle `T = [1,2,3,4,0]` when true. The emitted function starts in state zero and accepts state one.

- A variable selects identity or `T`. False uses no steps; true uses one constant step.
- Negation reverses the child instruction order, inverts each arm, then appends `T`. Its products are therefore `T` for false and identity for true.
- For conjunction, relabel the right child's true cycle to `B = [1,3,0,4,2]`. Execute `P, Q, inverse(P), inverse(Q)`. If either child is false, the product cancels. If both are true, the product is the five-cycle `[4,3,1,0,2]`. Relabel every instruction so this result becomes `T`.
- Disjunction uses De Morgan's law over the same exact operations.

The construction follows the expressiveness principle of [Barrington's bounded-width branching programs](https://publications.csail.mit.edu/lcs/pubs/pdf/MIT-LCS-TR-361.pdf). That result is not a claim of one-wayness, practical efficiency, or AI resistance. The seed changes generated identifiers through the repository naming system; it is neither secret nor an independent protection mechanism.

## Explicit compiler limits

| Limit | Default | Configurable hard range |
| --- | ---: | ---: |
| Captured inputs | Required | 0–32 |
| Permutation steps | 256 | 0–4096 |
| Formula nodes, counting repeated occurrences | 1024 | 1–16384 |
| Formula depth, leaf depth one | 64 | 1–128 |
| Entire emitted function UTF-8 bytes | 65536 | 1–1048576 |

Step count is computed before construction: input/true cost one, false costs zero, NOT adds one, AND costs twice the sum of its children, and OR costs twice that sum plus five. Node/depth limits apply while taking a validated snapshot. Step overflow refuses before allocating the expanded program. Output size includes all parameter guards and is checked after bounded construction/emission. `PermutationBudgetError` distinguishes an experiment budget refusal from invalid IR/options and compiler defects. These are transformation limits; they do not change accepted source-language semantics by silently truncating computation.

A balanced four-level conjunction with variable leaves reaches the default 256-step limit. The next level requires 1024 steps and is refused under the default. This growth is a real drawback even when the original formula is simple. A larger or slower representation is not evidence of stronger protection.

## Validation

Focused tests enumerate all 44 formulas of up to three nodes over two variables and Boolean constants, all four assignments, and five naming seeds. They check both the emitted native result and the entire action on all five starting states. Another 36 nested formulas run on all 16 assignments in Bun and a separate native Node process. The recursive Boolean source oracle does not use permutations.

A wrong-order mutant `P, inverse(P), Q, inverse(Q)` must fail the independent oracle because it cancels even when both operands are true. Simply reversing all four instructions is an inadequate negative control for this specific acceptance state: it can change the full product while leaving state zero's Boolean acceptance unchanged. The stronger full-permutation invariant catches such differences.

Additional checks cover strict grammar, absence of input coercion, naming determinism, frozen build-time program data, repeated DAG occurrences, cyclic input refusal, boundary budgets and absence of a runtime dispatch/program table. Native Node fixture transport uses stdin with a bounded child timeout. No attack or deobfuscation evaluation is part of these checks.

Source-adapter tests additionally compare arbitrary argument values and hostile conversion hooks, preserve getter effects and operand identities in declined functions, exercise arrows/directives/constructor metadata, and compose the admitted helper with effectful residual code through both low and max VM presets. Native Node executes the final emitted source with primitives and revoked proxies. These tests establish the admitted grammar's behavior, not whole-application or protection coverage.

Any application-derived formula, inputs, output artifact or performance evidence must remain in private owner artifacts. Application compatibility, overhead and protection must be qualified separately on exact final bytes. This experiment alone establishes none of those release gates.
