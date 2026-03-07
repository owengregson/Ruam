<div align="center">
    <pre>
:::::::..    ...    :::  :::.     .        :
;;;;``;;;;   ;;     ;;;  ;;`;;    ;;,.    ;;;
 [[[,/[[['  [['     [[[ ,[[ '[[,  [[[[, ,[[[[,
 $$$$$$c    $$      $$$c$$$cc$$$c $$$$$$$$"$$$
 888b "88bo,88    .d888 888   888,888 Y88" 888o
 MMMM   "W"  "YmmMMMM"" YMM   ""` MMM  M'  "MMM</pre>

<strong>Virtualization-Based JavaScript Obfuscation</strong><br>
<sub>Compiles JavaScript functions into custom bytecode executed by an embedded virtual machine.<br>
No deobfuscator exists for RuamVM bytecode.</sub>

<a href="https://nodejs.org/en/"><img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js >= 18"></a>
<img src="https://img.shields.io/badge/license-LGPL--2.1-yellow?style=flat-square&logo=googledocs&logoColor=white" alt="LGPL-2.1">
<img src="https://img.shields.io/badge/typescript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript Strict">

<!-- Dynamic badges — auto-update from packages/ruam/stats.json on main -->
<img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fowengregson%2FRuam%2Fmain%2Fpackages%2Fruam%2Fstats.json&query=%24.badges.testsPassing&label=tests&color=4CAF50&style=flat-square&logo=vitest&logoColor=white" alt="Tests Passing">
<img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fowengregson%2FRuam%2Fmain%2Fpackages%2Fruam%2Fstats.json&query=%24.badges.opcodes&label=opcodes&color=5C6BC0&style=flat-square" alt="Opcodes">
<img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fowengregson%2FRuam%2Fmain%2Fpackages%2Fruam%2Fstats.json&query=%24.badges.loc&label=source&suffix=%20LoC&color=607D8B&style=flat-square" alt="Lines of Code">
<img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fowengregson%2FRuam%2Fmain%2Fpackages%2Fruam%2Fstats.json&query=%24.badges.overhead&label=VM%20overhead&color=FF9800&style=flat-square" alt="VM Overhead">
<br><br>

<a href="#installation">Installation</a>&ensp;&middot;&ensp;
<a href="#quick-start">Quick Start</a>&ensp;&middot;&ensp;
<a href="#how-it-works">How It Works</a>&ensp;&middot;&ensp;
<a href="#protection-layers">Layers</a>&ensp;&middot;&ensp;
<a href="#presets">Presets</a>&ensp;&middot;&ensp;
<a href="#api-reference">API</a>

</div>

<hr>

<h2 id="why-ruam">Why Ruam?</h2>

<p>
  Most JavaScript obfuscators apply surface-level <i>transformations</i> &mdash; renaming variables, encoding strings, inserting dead code. A motivated attacker can undo all of it with off-the-shelf tools or by patching functions at runtime.
</p>

<p>
  <strong>Ruam takes a fundamentally different approach.</strong> It <i>compiles</i> your JavaScript into a custom bytecode instruction set and replaces the original source with a compact virtual machine that executes an unintelligible instruction stream. The original code is gone.
</p>

<table>
  <tr>
    <td width="50%">
      <h4>Traditional Obfuscators</h4>
      <pre>Source JS  →  Transformed JS
               (still JS)</pre>
      <ul>
        <li>Same language, same semantics</li>
        <li>AST-reversible transformations</li>
        <li>Automated deobfuscation tools exist</li>
        <li>One pass to undo</li>
      </ul>
    </td>
    <td width="50%">
      <h4>Ruam</h4>
      <pre>Source JS  →  Custom Bytecode
             + Embedded VM</pre>
      <ul>
        <li>Original source is destroyed</li>
        <li>Per-build unique encoding</li>
        <li>No deobfuscator exists</li>
        <li>Must reverse-engineer the VM itself</li>
      </ul>
    </td>
  </tr>
</table>

<br>

<table>
  <tbody>
    <tr>
      <td><strong>300+ opcode custom ISA</strong></td>
      <td>A full-coverage instruction set across 26 categories &mdash; stack, arithmetic, bitwise, comparison, control flow, property access, scoping, calls, classes, iterators, destructuring, async/await, generators, and more.</td>
    </tr>
    <tr>
      <td><strong>Per-build polymorphism</strong></td>
      <td>Every build is structurally unique. Opcode assignments are shuffled via seeded Fisher-Yates permutation &mdash; the same logical instruction maps to different physical values each time. No two builds share the same encoding.</td>
    </tr>
    <tr>
      <td><strong>Rolling cipher encryption</strong></td>
      <td>Every instruction is XOR-encrypted with a position-dependent rolling state. The master key is implicitly derived from bytecode metadata via FNV-1a &mdash; no key appears in the output.</td>
    </tr>
    <tr>
      <td><strong>Integrity binding</strong></td>
      <td>A hash of the VM interpreter is woven into the decryption key. If an attacker modifies the VM (e.g. to add logging), all bytecode decryption produces garbage.</td>
    </tr>
    <tr>
      <td><strong>Optimizing compiler</strong></td>
      <td>Register promotion, superinstruction fusion, peephole optimization, and inline stack ops minimize the performance cost of virtualization.</td>
    </tr>
    <tr>
      <td><strong>1,657 tests passing</strong></td>
      <td>Comprehensive coverage of core JS semantics, stress/edge cases, security properties, and integration scenarios &mdash; including 822 randomized fuzz tests.</td>
    </tr>
  </tbody>
</table>

<hr>

<h2 id="installation">Installation</h2>

<h4>NPM COMING SOON</h4>
<pre><code>npm install ruam</code></pre>

<hr>

<h2 id="quick-start">Quick Start</h2>

<h3>CLI</h3>

<pre><code># Obfuscate a file in-place
ruam app.js

# Obfuscate to a new file
ruam app.js -o app.obf.js

# Obfuscate a directory with medium preset
ruam dist/ --preset medium

# Maximum protection
ruam dist/ --preset high</code></pre>

<h3>Programmatic API</h3>

<pre><code>import { obfuscateCode, obfuscateFile, runVmObfuscation } from "ruam";

// Synchronous — obfuscate a code string
const result = obfuscateCode('function hello() { return "world"; }');

// Async — obfuscate a file
await obfuscateFile("src/app.js", "dist/app.js");

// Async — obfuscate a directory with options
await runVmObfuscation("dist/", {
  include: ["**/*.js"],
  exclude: ["**/node_modules/**"],
  options: { preset: "high" },
});</code></pre>

<h3>Selective Obfuscation</h3>

<p>Not every function needs virtualization. Use <code>comment</code> mode to protect only what matters:</p>

<pre><code>/* ruam:vm */
function sensitiveLogic() {
  // → compiled to bytecode
}

function publicHelper() {
  // → untouched, no overhead
}</code></pre>

<pre><code>ruam app.js -m comment</code></pre>

<hr>

<h2 id="how-it-works">How It Works</h2>

<p>Ruam's compilation pipeline transforms JavaScript source into VM-executed bytecode in five stages:</p>

<pre>
                        Source JavaScript
                               |
                               v
                       +--------------+
                    1  |    Parse     |   Babel parser → AST
                       +------+-------+
                              |
                              v
                    +-------------------+
                 2  | Identify Targets  |   All root-level functions, or
                    |                   |   only /* ruam:vm */ annotated
                    +---------+---------+
                              |
                              v
          +-------------------------------------------+
          |           3  Compile → BytecodeUnit       |
          |  |-- Emit opcodes for statements & exprs  |
          |  |-- Build constant pool                  |
          |  |-- Scope analysis + register allocation |
          |  |-- Capture analysis → register promotion|
          |  |-- Peephole optimization + fusion       |
          |  +-- Recurse into nested functions        |
          +---------------------+---------------------+
                                |
                                v
            +--------------------------------------+
            |         4  Serialize + Encrypt        |
            |  |-- JSON or binary format            |
            |  |-- String constant XOR encoding     |
            |  |-- Rolling cipher (per-instruction) |
            |  +-- RC4 encryption (optional)        |
            +------------------+-------------------+
                               |
                               v
          +--------------------------------------------+
          |           5  Assemble Output               |
          |  |-- Generate VM runtime IIFE              |
          |  |    |-- Interpreter (shuffled switch)     |
          |  |    |-- Scope chain + exception handling  |
          |  |    |-- Bytecode loader + deserializer    |
          |  |    +-- Rolling cipher decoder            |
          |  |-- Embed bytecode table                   |
          |  |-- Replace original function bodies       |
          |  +-- Randomize all internal identifiers     |
          +--------------------+-----------------------+
                               |
                               v
                     Obfuscated JavaScript
</pre>

<hr>

<h2 id="protection-layers">Protection Layers</h2>

<p>Ruam applies six independent layers that compound the difficulty of reverse engineering. Each layer forces an attacker to solve a distinct problem.</p>

<table>
  <thead>
    <tr>
      <th width="30">Layer</th>
      <th width="200">Name</th>
      <th>What it does</th>
      <th width="160">Defeats</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><strong>1</strong></td>
      <td><strong>Virtualization</strong></td>
      <td>Original JS is compiled to custom bytecode. An attacker must reverse-engineer the entire VM to even begin recovering logic.</td>
      <td>Source recovery, AST analysis</td>
    </tr>
    <tr>
      <td align="center"><strong>2</strong></td>
      <td><strong>Polymorphic Encoding</strong></td>
      <td>Opcode-to-instruction mapping is shuffled per build via seeded Fisher-Yates. Reversing one build gives zero knowledge about any other.</td>
      <td>Pattern reuse, universal decompilers</td>
    </tr>
    <tr>
      <td align="center"><strong>3</strong></td>
      <td><strong>Rolling Cipher</strong></td>
      <td>Every instruction is encrypted with a position-dependent XOR. The key is derived from bytecode metadata via FNV-1a &mdash; no seed appears in output. Decryption requires sequential execution from instruction 0.</td>
      <td>Static analysis, random-access disassembly</td>
    </tr>
    <tr>
      <td align="center"><strong>4</strong></td>
      <td><strong>Integrity Binding</strong></td>
      <td>The rolling cipher's base key incorporates a hash of the VM source. Any modification to the interpreter (logging, patching, breakpoints) changes the hash, corrupting all decryption.</td>
      <td>VM instrumentation, dynamic analysis</td>
    </tr>
    <tr>
      <td align="center"><strong>5</strong></td>
      <td><strong>String Obfuscation</strong></td>
      <td>All string constants in the bytecode (variable names, property keys, literals) are XOR-encoded with an LCG key stream. No plaintext survives compilation.</td>
      <td>String scanning, grep-based analysis</td>
    </tr>
    <tr>
      <td align="center"><strong>6</strong></td>
      <td><strong>Identifier Randomization</strong></td>
      <td>All internal VM identifiers are replaced with random names from the build seed. Combined with opcode shuffling, the VM structure looks different every time.</td>
      <td>Structural fingerprinting, signature matching</td>
    </tr>
  </tbody>
</table>

<hr>

<h2 id="presets">Presets</h2>

<p>Three built-in presets provide escalating protection. Explicit options always override preset values.</p>

<table>
  <thead>
    <tr>
      <th>Preset</th>
      <th>What's enabled</th>
      <th>Use case</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong><code>low</code></strong></td>
      <td>VM compilation only</td>
      <td>Development, debugging, basic IP protection</td>
    </tr>
    <tr>
      <td><strong><code>medium</code></strong></td>
      <td>+ identifier renaming, bytecode encryption, rolling cipher, decoy &amp; dynamic opcodes</td>
      <td>Production &mdash; balanced protection and size</td>
    </tr>
    <tr>
      <td><strong><code>high</code></strong></td>
      <td>+ debug protection, integrity binding, dead code injection, stack encoding</td>
      <td>High-value targets &mdash; maximum protection</td>
    </tr>
  </tbody>
</table>

<pre><code>ruam dist/ --preset high</code></pre>

<pre><code>obfuscateCode(source, {
  preset: "medium",
  debugProtection: true,  // override: add debug protection to medium
});</code></pre>

<hr>

<h2 id="performance">Performance</h2>

<p>Virtualization inherently adds overhead &mdash; this is the tradeoff for protection that surface-level transforms cannot provide. Ruam's compiler includes several optimizations to minimize the cost:</p>

<table>
  <thead>
    <tr>
      <th>Optimization</th>
      <th>Technique</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Register promotion</strong></td>
      <td>Non-captured locals bypass the scope chain via O(1) register access</td>
    </tr>
    <tr>
      <td><strong>Superinstructions</strong></td>
      <td>~22 fused opcodes (e.g. <code>REG_ADD</code>, <code>REG_LT_CONST_JF</code>) reduce dispatch count</td>
    </tr>
    <tr>
      <td><strong>Inline stack ops</strong></td>
      <td>Push/pop/peek inlined directly (<code>S[++P]=val</code>) &mdash; zero function call overhead</td>
    </tr>
    <tr>
      <td><strong>Direct closure dispatch</strong></td>
      <td>Closures call <code>exec()</code> directly with pre-loaded units, bypassing the load chain</td>
    </tr>
    <tr>
      <td><strong>Int32Array storage</strong></td>
      <td>Bytecode loaded into typed arrays for fast indexed access</td>
    </tr>
    <tr>
      <td><strong>Compound opcodes</strong></td>
      <td><code>i++</code> compiles to 1 op instead of 6 (e.g. <code>POST_INC_SCOPED</code>, <code>ADD_ASSIGN_REG</code>)</td>
    </tr>
  </tbody>
</table>

<p>Typical overhead: <strong>~38&ndash;45x native speed</strong> on compute-heavy benchmarks, competitive for a pure JS-in-JS interpreter. The theoretical floor for this approach is ~25x native.</p>

<p><i>Use <a href="#quick-start">selective obfuscation</a> (<code>-m comment</code>) to protect only sensitive functions and leave hot paths running as native JS.</i></p>

<hr>

<h2 id="cli-reference">CLI Reference</h2>

<pre><code>ruam &lt;input&gt; [options]

Presets:
  --preset &lt;name&gt;           Apply a preset: low, medium, high

Output:
  -o, --output &lt;path&gt;       Output file or directory (default: overwrite input)

Compilation:
  -m, --mode &lt;mode&gt;         Target mode: "root" (default) or "comment"
  -e, --encrypt             Enable bytecode encryption (RC4 + environment fingerprint)
  -p, --preprocess          Rename all identifiers before compilation

Security:
  -d, --debug-protection    Inject anti-debugger timing loop
  --rolling-cipher          Rolling cipher on bytecode instructions
  --integrity-binding       Bind decryption to interpreter integrity

Hardening:
  --dynamic-opcodes         Filter unused opcodes and shuffle case order
  --decoy-opcodes           Add fake opcode handlers to the interpreter
  --dead-code               Inject dead bytecode sequences
  --stack-encoding          Encrypt values on the VM stack

File Selection:
  --include &lt;glob&gt;          File glob for directory mode (default: "**/*.js")
  --exclude &lt;glob&gt;          Exclude glob (default: "**/node_modules/**")

Debug:
  --debug-logging           Inject verbose VM trace logging

Info:
  -h, --help                Show help
  -v, --version             Show version</code></pre>

<hr>

<h2 id="api-reference">API Reference</h2>

<h3><code>obfuscateCode(source, options?)</code></h3>

<p>Synchronously obfuscates a JavaScript source string. Returns the obfuscated code as a string.</p>

<pre><code>import { obfuscateCode } from "ruam";

const output = obfuscateCode(source, {
  preset: "medium",
  targetMode: "root",
});</code></pre>

<h3><code>obfuscateFile(inputPath, outputPath, options?)</code></h3>

<p>Reads a file, obfuscates it, and writes the result. Returns a <code>Promise&lt;void&gt;</code>.</p>

<pre><code>import { obfuscateFile } from "ruam";

await obfuscateFile("src/app.js", "dist/app.js", { preset: "high" });</code></pre>

<h3><code>runVmObfuscation(directory, config?)</code></h3>

<p>Obfuscates all matching files in a directory. Returns a <code>Promise&lt;void&gt;</code>.</p>

<pre><code>import { runVmObfuscation } from "ruam";

await runVmObfuscation("dist/", {
  include: ["**/*.js"],
  exclude: ["**/node_modules/**"],
  options: { preset: "medium" },
});</code></pre>

<h3>Options</h3>

<table>
  <thead>
    <tr>
      <th>Option</th>
      <th>Type</th>
      <th>Default</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>preset</code></td>
      <td><code>"low" | "medium" | "high"</code></td>
      <td>&mdash;</td>
      <td>Apply a preset configuration</td>
    </tr>
    <tr>
      <td><code>targetMode</code></td>
      <td><code>"root" | "comment"</code></td>
      <td><code>"root"</code></td>
      <td><code>"root"</code>: all top-level functions. <code>"comment"</code>: only <code>/* ruam:vm */</code> annotated</td>
    </tr>
    <tr>
      <td><code>threshold</code></td>
      <td><code>number</code></td>
      <td><code>1.0</code></td>
      <td>Probability (0&ndash;1) that an eligible function is compiled</td>
    </tr>
    <tr>
      <td><code>preprocessIdentifiers</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Rename all local identifiers to hex names before compilation</td>
    </tr>
    <tr>
      <td><code>encryptBytecode</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>RC4-encrypt bytecode using an environment fingerprint key</td>
    </tr>
    <tr>
      <td><code>debugProtection</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Inject anti-debugger timing side-channel</td>
    </tr>
    <tr>
      <td><code>debugLogging</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Inject verbose trace logging into the interpreter</td>
    </tr>
    <tr>
      <td><code>rollingCipher</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Position-dependent instruction encryption with implicit key</td>
    </tr>
    <tr>
      <td><code>integrityBinding</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Bind decryption to interpreter source integrity</td>
    </tr>
    <tr>
      <td><code>dynamicOpcodes</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Filter unused opcodes, shuffle case order</td>
    </tr>
    <tr>
      <td><code>decoyOpcodes</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Add fake opcode handlers</td>
    </tr>
    <tr>
      <td><code>deadCodeInjection</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Inject unreachable bytecode sequences</td>
    </tr>
    <tr>
      <td><code>stackEncoding</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Encrypt values on the VM stack at runtime</td>
    </tr>
  </tbody>
</table>

<hr>

<h2 id="architecture">Architecture</h2>

<details>
<summary><strong>Project structure</strong> &mdash; 31 source files, ~8,300 lines of TypeScript</summary>

<br>

<pre>
src/
  index.ts                  Public API (obfuscateCode, obfuscateFile, runVmObfuscation)
  cli.ts                    CLI entry point (bin: ruam)
  transform.ts              Orchestrator: parse → compile → assemble
  types.ts                  TypeScript interfaces
  constants.ts              Shared constants (parser plugins, globals, limits)
  presets.ts                Preset definitions + resolveOptions()
  preprocess.ts             Identifier renaming preprocessor

  compiler/
    index.ts                Function compilation entry point
    opcodes.ts              300-opcode ISA + per-file shuffle map
    emitter.ts              Bytecode emitter + constant pool
    scope.ts                Scope analysis + register allocation
    capture-analysis.ts     Captured vs non-captured local detection
    optimizer.ts            Peephole optimizer (constant folding, jump threading, fusion)
    encode.ts               Bytecode serialization (JSON + binary + RC4) + string encoding
    visitors/
      statements.ts         Statement compilation (if, for, while, switch, try, etc.)
      expressions.ts        Expression compilation (calls, members, operators, etc.)
      classes.ts            Class compilation (methods, properties, super, inheritance)
      patterns.ts           Destructuring pattern compilation

  runtime/
    vm.ts                   VM runtime code generator (~100 lines, assembles IIFE)
    names.ts                RuntimeNames interface + per-build randomized identifiers
    fingerprint.ts          Environment fingerprinting for encryption
    decoder.ts              RC4 + base64 codec + string constant XOR decoder
    rolling-cipher.ts       Rolling cipher: position-dependent encryption + implicit key
    templates/
      interpreter.ts        Core interpreter (sync + async exec, 300-opcode switch)
      loader.ts             Bytecode loader, cache, depth tracking
      runners.ts            VM dispatch functions (run/runAsync)
      deserializer.ts       Binary bytecode deserializer
      debug-protection.ts   Anti-debugger timing side-channel
      debug-logging.ts      Debug trace infrastructure
      globals.ts            Global exposure (globalThis binding)
</pre>

</details>

<details>
<summary><strong>Test suite</strong> &mdash; 1,657 tests across 25 files</summary>

<br>

<pre>
test/
  helpers.ts                Shared utility (wraps obfuscateCode + eval for round-trip verification)

  core/                     Core JS language feature tests
                            (arithmetic, strings, arrays, objects, functions, closures,
                             control flow, classes, destructuring, async/await, generators, etc.)

  stress/                   Stress tests, VM-breaker patterns, performance benchmarks,
                            randomized fuzz tests (822 randomized iterations)

  security/                 Anti-reversing, string encoding, rolling cipher, integrity binding

  integration/              Real-world patterns (Chrome extension, RuamTester)
</pre>

</details>

<hr>

<h2 id="requirements">Requirements</h2>

<ul>
  <li><strong>Node.js</strong> &gt;= 18</li>
  <li><strong>ESM</strong> (<code>"type": "module"</code>)</li>
</ul>

<h2 id="license">License</h2>

<p><a href="LICENSE">LGPL-2.1</a></p>
