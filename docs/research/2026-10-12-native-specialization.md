# Native specialization candidate

Status: experimental compiler, not a qualified protection replacement. Production presets continue to use the current VM. The application source, artifacts, exact tasks, vectors and logs are private and must not be published here.

`compileNativeCandidateCode` in `src/transform.ts` uses the existing function selection and logical compiler, then generates ordinary per-unit JavaScript from the typed handler AST. It is intentionally absent from the package's public index and presets. The experimental options accept a reproducible uint32 seed and target selection; VM cipher/protection options do not apply. Selection fails closed by default, including the current generator-resumption and async-iteration limitations.

The emitted artifact has no serialized instruction stream, binary decoder or opcode lookup table. Straight-line functions use native sequential control flow. Remaining units have per-function basic-block dispatch. Direct semantic helpers share repeated operations using explicit stack, scope and register arguments; positive admission rejects frame rebinding, nonlocal control transfer and suspension. Closed factory factoring checks free references before moving a factory, and still allocates returned closures per invocation.

An additional positive grammar lowers synchronous, scopeless straight-line units into scalar locals. Stack and register maps exist only at build time in that slice; effectful reads and operators are materialized in their original order, including getters, proxies, coercions and abrupt completion. Unsupported instructions retain the residual backend. `scalarLowering: false` provides an explicit comparison control, and the report counts admitted units/instructions and residual reasons. The initial service-worker inventory admits only 70 of 1,103 units and 171 of 58,934 instructions (0.29%); the feature does not establish substantial application performance gains.

This retains the compiler's stack/register/scope representations and much of its computational decomposition. Factored helpers can retain operand-dependent branches. It is not full SSA lowering, not the selected A1 algorithm/state compiler and not evidence that an AI cannot recover the computation. Removing a decoder can also make direct semantics easier to inspect.

## Implementation evidence

The first whole service-worker candidate compiled all 1,103 units (58,934 instructions) without fallback, producing 41,584,301 bytes. Repeated native semantic helpers reduced that to 8,107,903 bytes; 500 units used sequential control flow and 603 retained native block dispatch. A subsequent fix performs local renaming once across the generated module, avoiding repeated identifier-stream collisions. That candidate is 6,090,402 bytes and compiled in approximately 9.6 seconds, compared with 31.8 seconds for the previous candidate. The current max VM baseline is 1,935,420 bytes. These are uncompressed artifacts, not equivalent optimized size or a protection metric.

The initial exact-entry gate failed three of 29 tests. Both smaller candidates failed two of 29: fixed-time interruption scenarios observed no output before the interruption. An isolated diagnostic observed the third candidate's first output at approximately 111 ms after its start acknowledgement, versus 74 ms for the ordinary webpack bundle. These are diagnostic observations, not a latency distribution; the unchanged tests interrupt at 80 ms. Those failures remain open pending diagnosis; successful compilation and the other passing scenarios do not erase them. The second candidate's panel artifact passed 62 tests in ten files. No release, complete application parity or attack-resistance claim follows.

The fourth candidate incorporates scalar lowering and the reviewed admission fix for direct `eval`. All five emitted entries compile completely: 2,005 units and 108,833 instructions. Scalar lowering admits 106 units containing 246 instructions. Per-artifact records bind source bytes, compiler-file hashes, runtime versions, options and output bytes; private artifacts are not committed.

| Entry | Units | Uncompressed bytes | Exact artifact behavior |
| --- | ---: | ---: | --- |
| Service worker | 1,103 | 6,067,603 | 27 of 29 tests pass; same two interruption failures |
| Panel | 671 | 3,485,555 | 62 of 62 tests pass |
| Content A | 79 | 468,518 | Joint content scenarios pass |
| Content B | 98 | 536,150 | Joint content scenarios pass |
| Content C | 54 | 694,465 | 11 of 11 portal tests pass |

The two joint content scenarios contain 56 assertions. They use the existing simulator and additional private tests with hash-verified entry substitution. These results do not establish complete browser behavior, full application parity, or protection. Independent scalar/naming review and focused tests cover 36 tests and 8,545 assertions, with typechecking passing. The direct-eval regression failed before the admission repair and passes afterward.

A formatting-only derivative reduced the service worker to 3,049,551 bytes, but both interruption tests still failed. A serial cold/warm diagnostic observed first-output times of 98.8/66.3 ms for the fourth candidate, 119.1/66.0 ms for its compact derivative, 72.0/64.1 ms for the ordinary bundle, and 80.7/66.1 ms for the max VM. There is one sample per arm. Warm convergence points toward additional cold startup work; it does not prove a particular parse or compilation bottleneck. The failures remain release blockers, and minification is not credited as a protection improvement.

The shared core-test helper can select this backend with `RUAM_TEST_BACKEND=native-candidate`. Only helper-based tests participate; tests importing the production API directly still exercise the VM. The factored-core run executed 664 tests with no failures across 23 files, a mixed corpus that must not be reported as 664 independent native-only comparisons. Dedicated candidate tests also compare source semantics under Bun and Node across explicit seeds.

Independent review checked 36 source/native observations across three seeds. The observed class constructor-identity, accessor spread/rest and super-assignment differences were also present in the current VM in the corresponding baseline comparisons. Other inherited gaps include sloppy root `this`, mapped arguments, final async Promise adoption and mutable/shadowed global intrinsic behavior. Sharing a frontend preserves its limitations; it does not establish full ECMAScript conformance.

The class-property check exposed assignment-based method definitions that invoked inherited setters and created enumerable properties. A separately reviewed production repair defines own non-enumerable properties and caches the class-definition intrinsic. Existing constructor-proxy behavior remains outside that repair.

## Algorithm alternatives assessed in parallel

A closure-owned persistence component was rewritten into tagged internal state. Eighteen adversarial scenarios matched in Bun and actual Node, including reentrant effects. It remained the same algorithm in a different representation, and simple public API edits still applied. It does not satisfy A1.

A real construction pass replaced repeated containment scans with a monotone merge join. The private prototype passed 669 assertions plus nine additional Node comparisons; controlled synthetic constructor workloads measured speedups of approximately 3.2–26 times. It retained the final observable object graph and identities, and changed calls to mutable array/parsing intrinsics. It therefore has an explicit pristine-intrinsic domain, is not a whole-scope compiler replacement and does not yet change maintained state and consumers together. Neither benchmark speed nor an algorithm change establishes protection strength.

The next independent design review proposes jointly replacing sequence production, storage and observers with measured runs. This would change both the algorithm and maintained state. Admission is unresolved: returned mutable records and callback publication require stable identities and can force materialization before summaries help. Floating-point delay folds must retain their original operation order. Both reviewers require an actual ownership/publication audit before a prototype; neither identified a partial-change task that is demonstrably resistant to ordinary API delegation. Expansion into the public record schema remains a likely simplification route. No new protection result follows from this proposal.

Further development must preserve current product scope, remove more residual execution machinery where correctness permits, and qualify exact application behavior and costs before protection claims. Protection still requires independent recovery, comprehension and partial-edit evidence on held-out substantive components, with public schemas and retained-runtime/sidecar alternatives allowed. A failed or incomplete assessment receives no pass.

## Research basis

[weval (PLDI 2025)](https://cfallin.org/pubs/pldi2025_weval.pdf) motivates deriving ahead-of-time code from an interpreter as a single source of semantics. Its implementation targets WebAssembly; it is not a JavaScript-emission or obfuscation result. This candidate is a narrower engineering experiment and does not meet weval's full bytecode-erasure definition wherever shared helper branches still depend on operand parameters.

[Loki](https://www.usenix.org/conference/usenixsecurity22/presentation/schloegel) motivates assessing synthesis and other analysis methods together. Recent [stage-supervised JavaScript deobfuscation work](https://arxiv.org/abs/2609.27058) reports preliminary model training on deterministic deobfuscation stages. Neither paper establishes a practical universal offline JavaScript protection guarantee. Our inference is to test combined semantic analysis and model-assisted comprehension, rather than treating unfamiliar syntax or a larger file as a defense.

A further search found [JSProtect](https://arxiv.org/html/2509.24498v1), which describes scope-based parallel compilation and identifier reuse, and reports reduced LLM output-prediction accuracy. Its reported AI task predicts snippet outputs; that is different from tool-assisted recovery or a partial edit preserving hidden behavior. We cannot use those numbers as a Ruam qualification threshold. Scope-aware name reuse is relevant to compiler cost, but is not evidence of resistance to semantic recovery.

[Quasi-linear indistinguishability obfuscation](https://eprint.iacr.org/2025/307) improves a cryptographic construction's asymptotic cost under assumptions and succinct propositional proofs of equivalence. The theorem concerns equivalent circuits and their proofs; it does not supply the required JavaScript compiler, effect/identity proof, or extension cost measurements. It remains a research direction rather than an implementation-ready substitute for this application.
