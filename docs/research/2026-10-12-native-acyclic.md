# Opt-in acyclic scalar lowering

Status: experimental compiler infrastructure. This extends the [native specialization candidate](2026-10-12-native-specialization.md); it does not replace the production VM or qualify source protection.

`compileNativeCandidateCode(source, { acyclicLowering: true })` enables an additional positive grammar. The default stays unchanged. `scalarLowering: false` disables both the existing straight-line tier and this extension, providing a complete comparison control. The candidate remains absent from the public package index and presets.

## Admitted operations

Only synchronous, non-generator, scopeless units with no local scope slots, child units or exception frames can enter this tier. It accepts the existing scalar operations plus simple and fused branches, plain throws, inherited scope/global reads and fixed-arity calls, method calls and construction. Every instruction and operand is validated, including unreachable instructions. Reachable joins must have equal operand-stack height, and the reachable control-flow graph must be acyclic and contain at most 128 blocks. Unsupported whole units continue through the residual backend with explicit decline reasons.

Loops, local scope creation, closures, async execution, exception routing, spread calls, property writes and object/array allocation opcodes remain residual. Increment/decrement operations also remain residual: the current handlers' numeric coercion is not a sound reason to widen admission across objects and BigInts.

Operand-stack and register maps exist only during compilation. Observable reads, operators and calls produce scalar locals at their original instruction boundaries. A join reuses identical incoming bindings or receives fresh locals with predecessor-edge assignments. Because the graph is acyclic, these destinations cannot occur in their predecessor sources; register swaps cannot clobber an edge copy. No expression is duplicated, reordered or algebraically rewritten.

Topological ordering emits nested labelled blocks and forward labelled breaks. Each block appears once, without an instruction pointer, dispatch switch or runtime operand/register array. Labels use the shared name registry and participate in typed AST traversal, emission and renaming. Callback reentry uses fresh invocation locals. The wrapper, constant-pool lifetime, recursion guard and finalizer remain the existing backend's responsibility.

Inherited scope reads adapt the registered handler AST to scalar values, retaining its ordered get, presence check, TDZ test and global fallback. The outer scope stays a live reference. Calls retain already captured callee and receiver values after all argument values have been computed. Fixed fast calls use native calls; generic calls and method calls preserve the existing mutable `fn.apply` behavior. Fixed-arity construction uses native `new` with the captured constructor and materialized arguments, removing the synthetic argument-array iteration.

## Coverage and validation

A private inventory exercised the actual body builder on the previously frozen five-entry logical-unit cache. It admitted 585 of 2,005 units containing 9,019 of 108,833 instructions (8.287%). The existing straight-line tier accounts for 106 units and 246 instructions; this tier adds 479 units and 8,773 instructions. The added bodies contain 1,992 blocks, 425 join locals, 876 edge copies, 636 call instructions and 844 scope-read instructions. The largest admitted function has 32 blocks, so the 128-block cap removed no otherwise admitted unit in this workload. Compiler/cache hashes were unchanged during the inventory. Private source, constants, artifacts and paths are not published.

These counts describe static emitted-body admission, not execution frequency, full artifact size, application latency or protection. A full source/artifact build and unchanged application gates remain pending for this extension.

Focused checks cover branch/register joins, nullish and short-circuit paths, a DAG with backward numerical instruction targets, all 18 fused comparison forms, primitive/BigInt/error cases, ordered scope reads and TDZ, callback reentry, label renaming, explicit residual decisions and complete opt-out. Actual Node comparisons exercise 24 source/new-tier/residual observations across three seeds, including callee capture before argument mutation, strict/sloppy external callees, native constructor proxies and new.target, coercion order, argument throws and recursion. The inherited mutable-apply discrepancy is asserted separately: a source call does not consult an own `apply` property, while the existing backend and this tier do.

Focused tests passed across separate targeted runs. The first aggregate attempt exceeded an outer test deadline under heavy host contention; the Node batch's outer deadline now includes compilation plus its unchanged 15-second subprocess limit. Its individual VM observations retain a one-second limit. Two local typecheck attempts were stopped after prolonged contention without diagnostics, so no local typecheck pass is claimed. Clean CI must establish build/typecheck and broader regression status. Application deadlines are unchanged.

`RUAM_TEST_BACKEND=native-acyclic` routes the shared core helper through the opt-in tier, and CI runs that corpus explicitly. Tests importing the production API directly still exercise the VM; the corpus is mixed and must not be described as entirely native-only comparisons.

## Limits

This preserves inherited compiler/runtime gaps rather than establishing full ECMAScript conformance. Generic calls still observe mutable `apply`; global lookup and `typeof` retain the registered scope handlers' behavior, including their existing missing-global/TDZ limitations. Compiled constructor wrappers can have separate new.target limitations. Removing synthetic constructor argument iteration changes the old runtime's interaction with mutated array intrinsics; the native fixed-arity operation follows the source constructor call instead. Focused native-constructor tests do not qualify all compiled constructor wrappers.

The emitted functions still express the source algorithm and control structure. This is neither algorithm/state replacement nor evidence that an AI cannot recover or modify the computation. Broader application behavior, artifact cost and independent review are required before adopting the compiler tier, and protection would require separate evidence.
