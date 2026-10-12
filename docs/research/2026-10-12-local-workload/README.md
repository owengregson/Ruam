# Local application qualification and successor experiments

The application corpus and generated artifacts used for this phase are private. This public record contains generic infrastructure and aggregate observations only. Private source, recovered code, precise application tickets, vectors and logs must not be added to this repository.

The current VM remains the production backend. No experiment here has qualified an AI-resistant replacement. The frozen A1 audit under `../2026-10-12-algorithm-state` is a historical baseline, not an audit of subsequent compiler changes.

## Compile coverage before behavioral credit

`obfuscateCodeWithReport(source, options)` fails closed when no function was selected, compilation fell back, or a selected unit uses the known generator-resumption stubs or unsupported `for await` lowering. Its report counts selected roots and emitted bytecode units. Successful compilation is not complete JavaScript semantic coverage: native stubs, unselected code and observational differences still require separate assessment.

A real webpack application exposed a numeric-object-method fallback which retained its whole root as ordinary JavaScript. Passing tests on that artifact could not count as VM compatibility. After repairing compilation, exact-bundle tests exposed a continuous optional-chain bug that the fallback had hidden. Separately, component comparisons found duplicate numeric coercions in the MBA guard. Expanded panel tests exposed a per-opcode async suspension bug: concurrent invocations could pass a single-flight guard before its store. Inline async dispatch fixes body suspension boundaries; existing wrapper Promise adoption can still delay final settlement. These are compatibility repairs, not extraction-resistance evidence.

## Run existing tests against exact emitted bytes

From the `packages/ruam` directory:

```sh
bun scripts/qualify-artifact-tests.ts /absolute/path/to/private-config.json
```

The configuration has this shape:

```json
{
  "projectRoot": "/absolute/path/to/application",
  "outputDirectory": "/absolute/path/to/new-local-report-directory",
  "substitutions": [
    {
      "source": "src/entry.ts",
      "artifact": "/absolute/path/to/emitted/entry.js",
      "sha256": "THE_ACTUAL_64_CHARACTER_LOWERCASE_SHA256"
    }
  ],
  "tests": ["test/behavioral/entry.test.ts"],
  "timeoutMs": 60000
}
```

The output directory must be new and outside the application. Each test file runs in a separate Bun process. A narrow preload substitutes only the requested entry, including cache-busting import queries, verifies its bytes, and records the substitution. The runner requires a nonzero executed-test count, a successful test process and artifact-load evidence; every requested substitution must be observed at least once. Failed, skipped-only, unloaded and stale-artifact runs receive no pass.

This is a repository-owned test facility. Its processes and `node:vm` uses are not hostile-code sandboxes. Loading an artifact does not show that every export was exercised. Source entries, selected tests, runner, preload and artifacts are hash-bound; all transitive test dependencies and host state are not frozen. Bun mocks are not a real Chrome release check. Reports keep these limitations explicit and never grant protection or release approval.

## Attack trials

`runArtifactAttackTrial` in `src/algorithm-state/qualification/artifact-trials.ts` compares separately executed artifacts under an externally supplied observation program. It preserves signed zero, NaN, sparse entries and aliases in observation records. Each artifact runs in its own OS process under one aggregate deadline, including asynchronous execution. Custom observation prototypes are rejected rather than silently reduced to own properties; inherited behavior requires explicit primitive observations. Review caught and fixed a shared-host-object false match before publication. Recovery, compatibility and an edit that retains the original artifact are different trial purposes. The runner does not infer standalone recovery, blindness, analyst effort or an actual AI campaign from a matching scripted observation.

Keep application observations and patches outside this repository. Negative controls must fail the intended ticket before a positive result receives behavioral credit. Component APIs deliberately exposed by a research wrapper are not evidence that the same interface is reachable from a final application bundle.

## Linear transition control

`compileWordFusionCode` is an opt-in, source-admitted prepass for adjacent local XOR/constant-shift recurrences. It replaces the recurrence with a composed GF(2) map decomposed into nibble tables. Its proof covers the admitted word grammar, not arbitrary JavaScript; residual code still needs the current VM. No production preset enables it.

The independent `recoverWordTableTransitions` attack reads emitted bytes and reconstructs table columns and a small recurrence. In the private control it recovered the exact three-step recurrence; a separate owner scorer passed all 780 comparisons, including coercive and mutable-intrinsic cases. The candidate is rejected as a protection improvement. This is scripted artifact recovery, not a blinded AI benchmark or a defeat of the whole application.

The next experiments must change a substantive maintained-state algorithm, close the actual producer/consumer boundary, preserve the authored effect schedule and face recovery/edit attempts on the application artifact. Literal-helper inlining is only an effect-inventory control.

## Measured application gates

After the compatibility repair, all five emitted max-preset bundles compiled without fallback: 2,005 bytecode units. The final exact-entry service-worker gate passed 29 tests across 28 files and the panel gate passed 62 tests across 10 files, matching the ordinary-bundle gates. Before the async repair, the max panel gate failed three tests. Some tests in these qualifying files exercise source helpers; artifact loading is established per file, not per assertion.

These are entry-substitution runs, not an all-bundles Chrome release run. Other entries and transitive test dependencies still use the application's source simulator. All three content entries were observed loading, but an ordinary-bundle portal timing case also failed in the full selected file; isolated ordinary/source controls passed without changing its deadline. That result is unresolved, and the main behavior of two content entries has not been exercised by the selected suite. A service-worker restart case was excluded because the source test resets a singleton outside the bundle's module cache. None of these omissions receives compatibility credit.

A context-aware AI-assisted pilot reached a private method from the untouched whole max service-worker bundle and implemented a behavior change while an existing typing scenario still passed. The pilot had prior application context, retained the original compiled method, and did not establish standalone recovery or hidden-ticket completion. A separate observation pilot captured serialized runtime units while three simulator scenarios passed; these buffers were not reconstructed logical opcodes. Both results expose observation boundaries, not a measured end-to-end deobfuscation rate. Private hooks and target details are not published.

## Segmented state control

`compileSegmentedStringCode` replaces one positively recognized whole function with linked string segments, jointly changing accumulated state and its output materialization. It preserves authored iterator, coercion and dynamic slice calls; opaque results from mutable intrinsics continue through the original operation semantics. Other JavaScript remains with the existing VM, so this is not a whole-application replacement.

One existing application function qualified. Its private comparison corpus passed 214 cases; two module test files passed 17 tests, and three ordinary transformed-bundle scenarios passed. Those three scenarios do not establish that the transformed branch was exercised. Resource/engine string-limit failure timing and source reflection remain excluded. An exploratory native-only benchmark measured approximately 2.4–2.9 times the original execution time under concurrent work, not controlled whole-application or protected-VM cost.

The retained slice boundary admits a simple edit, and no comprehension/edit advantage has been demonstrated. This candidate is rejected for deployment. `compileClosedExpressionFusion` is a separate effect-inventory control: only two literal-constructor helpers and 44 call sites qualified in the application bundle. It does not replace a meaningful private algorithm.

## Next implementation decision

Preserve current JavaScript coverage through a hybrid compiler: only positively admitted regions may use alternative algorithms; every residual region keeps the existing backend. An admission failure must appear in the report, and protection qualification must remain separate from compilation success.

Native class and async shells are a possible correctness foundation for that compiler. They may restore authored property-definition and suspension behavior, but do not by themselves improve protection. Replacing a registration operation while leaving a shared decoder and interpreter does not remove the other observable boundaries. A class-shell change must first pass descriptor, receiver, inheritance, computed-key, initialization-order and whole-application parity gates. It must then face separate recovery and partial-edit qualification before receiving a protection claim.

A successor still needs a substantive whole-component algorithm/state transformation that survives the existing history-sidecar control, works on held-out application roots, and improves both comprehension and partial-edit cost without merely making execution larger or slower. None of the controls in this PR meets that bar. These modules are opt-in research entry points; no public default, preset or production backend enables them.

## Research basis and claim limits

[Loki](https://www.usenix.org/conference/usenixsecurity22/presentation/schloegel) motivates evaluating synthesis and multiple attack families rather than assuming that complex arithmetic suffices. [Syntia](https://www.usenix.org/conference/usenixsecurity17/technical-sessions/presentation/blazytko) motivates semantics recovery from observations. Neither is a general JavaScript or AI-resistance certificate. The [general virtual-black-box impossibility result](https://www.boazbarak.org/papers/obfuscate) rules out that strongest universal guarantee; it does not prove every particular program easy to reverse engineer. Acceptance must use explicit scope, measured attacker cost and legitimate execution cost.

Recent JavaScript-specific work strengthens the requirement to assess combined tooling. [CASCADE](https://arxiv.org/html/2507.17691v1) combines model-assisted prelude recognition with execution and compiler transformations, specifically for Obfuscator.IO string/API obfuscation; its results are not a Ruam VM attack result. [JsDeObsBench](https://arxiv.org/abs/2506.20170) evaluates deobfuscation with syntax and execution concerns, while [JSIMPLIFIER](https://arxiv.org/abs/2512.14070) combines static and dynamic analysis with model-assisted renaming. The design implication is ours: qualify model-plus-tool workflows and functional behavior, rather than relying on a model failing to directly rewrite a large file.
