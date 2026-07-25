# Performance and security hardening backlog

This backlog accompanies the PR 6 architecture review. It records concrete
follow-on work rather than implying that local obfuscation provides secrecy.
`P0` items block promotion of the affected surface, `P1` items belong in the
next hardening cycle, `P2` items are measured engineering improvements, and
`R` items are research bets that require prototypes and evidence.

## Compiler, proof, and build performance

| Priority | Modification | Intended result |
|---|---|---|
| P0 | Replace exhaustive pure-region suffix trials with indexed span descriptors and prefix topology summaries | Remove cubic candidate planning |
| P0 | Retain one representative rejection per entry/code plus aggregate counts | Bound diagnostic memory |
| P0 | Publish the nonlocal product planner only through one atomic compile/lower/evidence API whose proof is bound to the exact region contract digest | Prevent unrelated branded call evidence from authorizing a caller-authored region |
| P1 | Convert recursive Tarjan SCC discovery to an explicit frame stack | Eliminate call-depth stack exhaustion |
| P1 | Replace the direct-call sorted array queue with a deterministic binary heap | Change broad-frontier work from quadratic to logarithmic insertion |
| P1 | Build one immutable indexed graph context shared by CFG, region, call-graph, and planner passes | Stop repeated validation and edge indexing |
| P1 | Cache lowerer topology by graph identity and invalidate only on graph replacement | Reuse index and incoming-edge facts |
| P1 | Represent selected regions as `[start,end]` spans until final certificate emission | Avoid repeated region-ID arrays |
| P1 | Add a global compilation work ledger for bytes, nodes, edges, proof operations, and emitted bytes | Fail predictably under adversarial input |
| P1 | Count parser AST nodes and maximum nesting depth before semantic lowering | Bound parser/traversal denial of service |
| P1 | Preflight BPRF weighted complexity before learnability analysis | Reject oversized plans before expensive proof work |
| P1 | Memoize validated contracts by structural digest | Reuse type and exactness facts |
| P1 | Memoize artifact digests and immutable artifact views | Avoid clone/serialize/hash repetition |
| P1 | Stream canonical values directly into hash state | Avoid whole canonical strings |
| P1 | Replace repeated blocker-array filtering with a keyed set | Remove quadratic deduplication |
| P1 | Build a unit-to-SCC map once for every product plan | Make call-risk derivation linear |
| P1 | Consolidate source binding collection, candidate discovery, and identifier inventory into one traversal | Reduce protected-source passes |
| P1 | Emit wrapper Babel AST directly instead of reparsing generated source | Remove parser cost and string-template risk |
| P1 | Parse one immutable wrapper template and clone/substitute nodes | Amortize remaining wrapper construction |
| P1 | Preserve source text byte-for-byte when no site is protected | Avoid useless generation and source-map churn |
| P1 | Skip owner certificate allocation when owner tracing is disabled | Lower default memory |
| P1 | Add file-level output and expansion budgets before concatenation | Prevent pathological generated output |
| P2 | Use persistent/copy-on-write frame facts in direct-call analysis | Reduce edge-times-frame-width cloning |
| P2 | Use sparse bitsets for initialized slots and registers | Shrink dataflow state |
| P2 | Intern binding and region identifiers | Reduce graph memory |
| P2 | Cache source locations by origin ID | Remove repeated object construction |
| P2 | Replace CFG exit JSON serialization with typed tuple keys | Reduce allocation during deduplication |
| P2 | Add incremental content-addressed compilation manifests | Skip unchanged files safely |
| P2 | Add deterministic parallel lowering of independent root groups | Use available cores |
| P2 | Spill generated directory outputs to private staged files | Bound aggregate RSS |
| P2 | Return lightweight metadata by default and expose output streams separately | Avoid retaining all output strings |
| P2 | Add an async-iterable directory API with bounded backpressure | Improve large-tree throughput |
| P2 | Attribute parse, discover, prove, generate, emit, and publish time separately | Make regressions diagnosable |
| P2 | Emit benchmark results as stable JSON | Enable historical comparisons |
| P2 | Maintain small, medium, large, and adversarial seeded benchmark tiers | Cover scaling behavior |
| P2 | Gate raw, gzip, and Brotli sizes independently | Detect deployment-size regressions |
| P2 | Record peak RSS and proof-operation counts in benchmark artifacts | Catch memory regressions |
| R | Explore a verified generic table evaluator for large regions | Trade runtime interpreter risk for major size reduction |
| R | Prototype a WASM parser/lowerer in the browser worker | Test parse throughput versus bundle/startup cost |
| R | Train an adaptive emission policy on region shape and measured cost | Avoid pathological specialization |
| R | Use proof-guided superoptimization for emitted scalar expressions | Minimize exact expressions without changing semantics |
| R | Apply equality saturation only inside proven integer domains | Find safe common subexpressions |
| R | Produce independently checkable transformation certificates | Reduce trusted compiler surface |

## Generated runtime performance and semantic robustness

| Priority | Modification | Intended result |
|---|---|---|
| P1 | Specialize single-output regions to a scalar-return ABI | Remove output-array allocation |
| P1 | Prehash the fixed caller component of contextual selection | Reduce per-call hashing |
| P1 | Factor repeated coordinate normalization expressions | Cut arithmetic and source size |
| P1 | Remove redundant private-entry array checks after wrapper construction proves shape | Reduce hot-path guards |
| P1 | Capture and validate required primordials in a controlled realm | Stabilize behavior under host mutation |
| P1 | Maintain a depth-indexed wrapper frame pool with `try/finally` | Preserve reentrant correctness without steady-state allocation |
| P1 | Preserve lazy branches using thunked ingress or control-aware artifacts | Support `&&`, `||`, and `?:` without TDZ changes |
| P1 | Require every ingress binding to dominate its protected expression | Prevent eager reads of uninitialized bindings |
| P1 | Add differential tests for block, catch, loop, class, and parameter TDZ cases | Lock lazy/evaluation-order semantics |
| P1 | Add differential tests with mutated global intrinsic properties | Detect ambient-semantic dependence |
| P1 | Add reentrant guard and proxy/getter stress tests | Verify wrapper frame isolation |
| P2 | Cache guarded input-domain predicates per distinct domain tuple | Reduce repeated checks |
| P2 | Generate straight-line caller hashing for bounded ASCII site IDs | Remove the only fixed-string loop |
| P2 | Hoist immutable realization-selection constants | Reduce per-call setup |
| P2 | Share identical realization prologues | Reduce code size |
| P2 | Pool result arrays only at externally array-valued boundaries | Reduce allocations safely |
| P2 | Use typed arrays when exact integer range permits and benchmarks win | Improve locality |
| P2 | Add a maximum protected-call recursion depth with a typed error | Bound hostile reentrancy |
| R | Generate dual fast/safe entry points selected by proven caller ownership | Remove redundant guards at trusted internal sites |
| R | Use partial evaluation across adjacent protected regions | Eliminate intermediate ABI conversions |
| R | Fuse contextual selection with the first transition | Reduce dispatch overhead |
| R | Explore branchless realization selection resistant to timing classification | Reduce both cost and side-channel shape |

## Filesystem safety, atomicity, and large-tree throughput

| Priority | Modification | Intended result |
|---|---|---|
| P0 | Publish complete versioned output trees through one atomic pointer or directory switch | Prevent partially visible builds |
| P0 | Include owner sidecars in the same publication transaction | Keep client and owner artifacts consistent |
| P1 | Use descriptor-relative `openat2` with beneath/no-symlink resolution where supported | Close path-swap and intermediate-symlink races |
| P1 | Keep one file descriptor from validation through hashing and read | Close check/read races |
| P1 | Reject or explicitly inventory hard-linked source files | Prevent unprotected aliases |
| P1 | Hash source bytes into the planned identity | Detect timestamp/inode-preserving changes |
| P1 | Verify destination parent identity immediately before rename | Detect directory swaps |
| P1 | Stage with mode `0600`, then apply an explicit metadata policy | Minimize temporary exposure |
| P1 | Fsync staged files, staging directories, and the publication parent | Provide crash durability |
| P1 | Preserve or explicitly drop ACLs and extended attributes by policy | Make metadata behavior auditable |
| P1 | Reject owner-trace paths that alias any source or client output identity | Prevent trace overwrite of code |
| P1 | Add rollback journals for in-place multi-file publication | Recover from late rename failure |
| P1 | Use a bounded worker pool with staged-file spill | Gain parallelism without total-output RSS |
| P1 | Apply include/exclude filters while copying separate output trees | Avoid copying excluded multi-gigabyte trees |
| P1 | Cap file count, aggregate input, aggregate output, and expansion | Bound directory-service work |
| P2 | Add fault injection at every open/read/hash/stage/fsync/rename boundary | Qualify failure atomicity |
| P2 | Add concurrent symlink, rename, and hard-link race harnesses | Exercise hostile trees |
| P2 | Add platform-specific filesystem qualification on Linux, macOS, and Windows | Validate differing rename semantics |
| P2 | Store staged outputs in a content-addressed private cache | Reuse unchanged secure builds |
| P2 | Emit a signed manifest of every selected, skipped, and rejected path | Make coverage reviewable |
| P2 | Emit a negative-space manifest for files excluded by policy | Prevent accidental omissions |
| R | Use an immutable object store plus atomic manifest pointer | Make publication and rollback constant-time |
| R | Run file transformation in a sandboxed subprocess with no network and a private temp root | Contain compiler compromise |

## Protocol, cryptography, evidence, and trust boundaries

| Priority | Modification | Intended result |
|---|---|---|
| P0 | Replace delimiter and ad-hoc JSON signing with deterministic CBOR or length-prefixed binary schemas | Make authenticated encodings injective |
| P0 | Bind protocol ID, version, message type, algorithms, and key ID into every signature | Prevent cross-protocol substitution |
| P0 | Bind session, contract, cover transition, current lineage, nonce, epoch, and exact request digest | Prevent fork and cross-request substitution |
| P0 | Validate Ed25519 key type and exact signature encoding before verification | Reject malformed crypto inputs |
| P1 | Derive independent per-message keys with HKDF | Isolate signing/HMAC domains |
| P1 | Generate 128–192 bit nonces internally | Remove caller entropy mistakes |
| P1 | Persist replay state with compare-and-swap semantics | Make monotonic lineage cluster-safe |
| P1 | Add idempotent authenticated response caching | Permit safe retry after transport loss |
| P1 | Bound all protocol strings, arrays, charts, cells, and signatures | Prevent parser and verifier DoS |
| P1 | Use a vetted constant-time finite-field backend | Reduce timing and arithmetic risk |
| P1 | Authenticate endpoint, implementation version, protocol version, and deployment key ID in manifests | Bind plans to real services |
| P1 | Bind TEE provider, measurement, freshness, and revocation state | Make attestation claims verifiable |
| P1 | Replace capability booleans with unforgeable adapter handles | Stop self-asserted deployment claims |
| P1 | Accept only compiler-issued, source-digest-bound call evidence | Stop forged proof completeness |
| P1 | Sign deployment manifests with DSSE and an auditable trust root | Add authenticity, not just equality digests |
| P1 | Rename unsigned certificates to assessment digests until signatures exist | Avoid misleading security language |
| P1 | Remove relation-derived public digests where not essential | Reduce offline relation dictionaries |
| P1 | Use randomized hiding commitments where client verification is required | Prevent low-entropy equality oracles |
| P1 | Encrypt owner traces with envelope encryption and explicit recipients | Protect sidecars at rest |
| P1 | Add secret-canary scanning of every client artifact | Detect trust-boundary leaks |
| P1 | Add client/owner/custodian branded and tainted types | Make boundary crossings explicit |
| P1 | Separate experimental custody code into a non-default package export | Prevent accidental production promotion |
| P2 | Add property tests for canonical encoding injectivity | Catch scalar/object and sparse/accessor collisions |
| P2 | Fuzz protocol parsers and signature payload builders | Find malformed-message edge cases |
| P2 | Add cross-session, cross-contract, cross-cover, fork, replay, and delimiter corpora | Lock context binding |
| P2 | Add durable key IDs, rotation epochs, and revocation lists | Support safe key lifecycle |
| P2 | Publish keys through a transparency log | Detect silent substitution |
| P2 | Add authorization and per-principal query budgets | Limit oracle abuse |
| P2 | Batch and pad remote responses into fixed transcript classes | Reduce structural leakage |
| P2 | Add timing padding with measured service-level ceilings | Reduce timing classification |
| P2 | Add privacy-preserving telemetry with no relation or source material | Observe abuse safely |
| R | Prototype proof-carrying custody responses | Let clients verify relation-class compliance without learning the relation |
| R | Explore oblivious batching across tenants | Amortize custody cost and blur query linkage |
| R | Explore threshold signing across independent custodians | Remove one custodian compromise point |
| R | Use forward-secure lineage keys that erase prior epochs | Limit post-compromise replay |
| R | Add verifiable delay or proof-of-work only at abusive query rates | Price automated extraction adaptively |
| R | Explore PIR/ORAM-backed artifact retrieval | Hide selected realization/material access |

## Browser, UI, and service availability

| Priority | Modification | Intended result |
|---|---|---|
| P1 | Version and strictly validate the worker message schema | Reject malformed messages |
| P1 | Cap source bytes before parsing in the worker | Bound browser memory |
| P1 | Allow one active request and reject or cancel stale work | Prevent unbounded queues |
| P1 | Terminate and recreate workers that exceed a deadline | Recover UI availability |
| P1 | Redact unexpected errors while retaining structured Ruam codes | Avoid source/config leakage |
| P1 | Add a per-worker capability nonce | Prevent accidental cross-channel messages |
| P1 | Instantiate the worker lazily on first build or idle preload | Improve initial page load |
| P1 | Retain output bytes from build stats instead of re-encoding on render | Avoid duplicate full-buffer work |
| P1 | Set a CSP including `worker-src 'self'`, Trusted Types, and restrictive connect policy | Reduce web compromise surface |
| P1 | Use content-hashed immutable worker filenames and a deployment manifest | Prevent stale worker ambiguity |
| P2 | Share one CodeMirror module/config loader | Reduce duplicate initialization |
| P2 | Keep large output in one external store rather than duplicate React/editor state | Lower memory |
| P2 | Virtualize or truncate diagnostic rendering | Bound DOM work |
| P2 | Add browser heap, startup, worker-load, and transform telemetry in CI | Catch regressions |
| P2 | Test malformed messages, timeouts, reloads, and rapid repeated builds | Qualify watchdog behavior |
| R | Stream generated output chunks to the editor | Reduce peak structured-clone memory |
| R | Compile in a cross-origin-isolated disposable worker pool | Improve containment and parallelism |

## CI, supply chain, release, and observability

| Priority | Modification | Intended result |
|---|---|---|
| P0 | Run library, worker, and website builds on every relevant PR | Prevent untested integration changes |
| P0 | Use one deployment workflow with deployment permissions only in the deploy job | Reduce privilege and policy drift |
| P1 | Pin actions by reviewed commit SHA | Prevent mutable-tag substitution |
| P1 | Pin Bun and Node versions and use a frozen lockfile | Make builds reproducible |
| P1 | Fail CI on production dependency advisories | Stop known vulnerable releases |
| P1 | Remove stale secondary lockfiles | Avoid false dependency state |
| P1 | Add benchmark, output-size, compressed-size, and memory budgets | Make performance regressions blocking |
| P1 | Separate fast PR, extended PR, nightly, and release qualification tiers | Balance latency and coverage |
| P1 | Generate SBOM, SLSA provenance, and signed release attestations | Improve release auditability |
| P1 | Restrict lifecycle scripts and network access during dependency installation | Reduce install-time compromise |
| P1 | Add license-policy and duplicate-package gates | Reduce legal and supply-chain drift |
| P1 | Add CODEOWNERS for crypto, protocol, workflows, and public API | Focus high-risk review |
| P1 | Run seed-stress differential and metamorphic corpora nightly | Find rare miscompiles |
| P1 | Minimize and archive every failing randomized seed | Make failures reproducible |
| P1 | Run sanitizers/fuzzers for native or WASM dependencies | Catch memory safety issues |
| P2 | Compare generated API declarations against an approved snapshot | Catch accidental public exports |
| P2 | Publish benchmark history and alert on trend slopes, not one noisy run | Detect gradual regression |
| P2 | Add build metafiles with bundle-component attribution | Explain bundle growth |
| P2 | Test the package tarball in clean Node and Bun environments | Qualify actual publication |
| P2 | Verify reproducible artifacts from two independent builders | Detect nondeterminism or compromise |
| P2 | Escape terminal control and bidi characters in filenames and errors | Prevent log spoofing |
| P2 | Update the threat model whenever an execution profile changes | Prevent stale claims |
| R | Maintain a tiny independent certificate verifier in another language | Diversify the trusted base |
| R | Use transparency-log inclusion for every release and deployment manifest | Make rollback/substitution visible |

## Suggested sequence

1. Finish proof/evidence authenticity and whole-tree publication semantics.
2. Replace exhaustive region planning and recursive SCC traversal.
3. Promote protocol code only after canonical binary schemas, strict validation,
   durable replay state, and signed deployment evidence exist.
4. Introduce shared resource budgets across parser, compiler, filesystem, and
   browser worker.
5. Use measured benchmark history to select the research bets worth keeping.
