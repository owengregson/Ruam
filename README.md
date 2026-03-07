<div align="center">
    <pre>
:::::::..    ...    :::  :::.     .        :
;;;;``;;;;   ;;     ;;;  ;;`;;    ;;,.    ;;;
 [[[,/[[['  [['     [[[ ,[[ '[[,  [[[[, ,[[[[,
 $$$$$$c    $$      $$$c$$$cc$$$c $$$$$$$$"$$$
 888b "88bo,88    .d888 888   888,888 Y88" 888o
 MMMM   "W"  "YmmMMMM"" YMM   ""` MMM  M'  "MMM</pre>
</div>

<p align="center">
  <strong>A Novel Virtualization-based JavaScript Obfuscator</strong><br>
  Ruam <i>/roo-am/</i> compiles JavaScript functions into custom bytecode executed by the RuamVM,
  <br>making reverse engineering as close to infeasible as it gets in a pure JS environment.
  <h4 align="center">No deobfuscator exists for RuamVM bytecode.</h4>
</p>

<p align="center">
  <a href="#installation">Installation</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#how-it-works">How It Works</a> &middot;
  <a href="#layers">Layers</a> &middot;
  <a href="#api-reference">API</a>
</p>

<hr>

<h2 id="why-ruam">Why Ruam?</h2>

<p>
  Most JavaScript obfuscators apply JS <i>transformations</i>, e.g. renaming variables, encoding strings, and inserting dead code. A determined attacker can, given some time, undo these with off-the-shelf tools or patch functions to re-assemble behavior at runtime.
</p>

<p>
  <strong>Ruam fixes this vulnerability</strong> by compiling your JavaScript functions into a custom bytecode instruction set designed for the RuamVM. The original source code is gone, and the built output is a compact VM that executes an unintelligible instruction stream at runtime.
</p>

<h3>Ruam is cutting-edge.</h3>

<table>
  <tbody>
    <tr>
      <td>:microchip:</td>
      <td><strong>300+ opcode custom ISA</strong></td>
      <td>A full-coverage instruction set spanning 26 categories — stack, arithmetic, bitwise, comparison, control flow, property access, scoping, calls, classes, iterators, destructuring, async/await, generators, and more.</td>
    </tr>
    <tr>
      <td>:shuffle_tracks_button:</td>
      <td><strong>Per-build polymorphism</strong></td>
      <td>Every build produces a structurally unique output. Opcode assignments are shuffled via seeded Fisher-Yates permutation, so the same logical instruction maps to different physical values each time. No two builds share the same encoding.</td>
    </tr>
    <tr>
      <td>:locked:</td>
      <td><strong>Rolling cipher encryption</strong></td>
      <td>Every instruction is XOR-encrypted with a position-dependent rolling state. The master key is derived implicitly from bytecode metadata (instruction count, register count, param count, constant count) via FNV-1a. This makes static function analysis unfeasible.</td>
    </tr>
    <tr>
      <td>:shield:</td>
      <td><strong>Integrity binding</strong></td>
      <td>A hash of the RuamVM is woven into the decryption key. If an attacker modifies the VM (e.g. to add logging), the hash changes and all bytecode decryption produces garbage.</td>
    </tr>
    <tr>
      <td>:zap:</td>
      <td><strong>Optimized Compiler</strong></td>
      <td>The RuamVM includes various compile-time optimizations to improve bytecode efficiency, like instruction fusion (superinstructions) that reduce dispatch overhead.</td>
    </tr>
    <tr>
      <td>:white_check_mark:</td>
      <td><strong>Approaching 100% JS Coverage</strong></td>
      <td>Currently, Ruam has a comprehensive test suite covering core JS semantics, stress/edge cases, security properties, and integration scenarios. As Ruam is developed, the goal is to reach 100% coverage of all JS execution features.</td>
    </tr>
  </tbody>
</table>

<hr>

<h2 id="installation">Installation</h2>

<h4>**NPM COMING SOON**</h4>
<pre><code>npm install ruam</code></pre>

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

// Obfuscate a code string (synchronous)
const result = obfuscateCode('function hello() { return "world"; }');

// Obfuscate a file (async)
await obfuscateFile("src/app.js", "dist/app.js");

// Obfuscate a directory with options
await runVmObfuscation("dist/", {
  include: ["**/*.js"],
  exclude: ["**/node_modules/**"],
  options: { preset: "high" },
});</code></pre>

<hr>

<h2 id="how-it-works">How It Works</h2>

<p>Ruam's compilation pipeline transforms JavaScript source into VM-executed bytecode in five stages:</p>

<pre>
Source JavaScript
       │
       ▼
  ┌──────────┐
  │  Parse   │  Babel parser → AST
  └────┬─────┘
       │
       ▼
  ┌──────────────────┐
  │ Identify Targets │  Select functions (all root-level, or /* ruam:vm */ annotated)
  └────┬─────────────┘
       │
       ▼
  ┌─────────────────────────────────────────────────┐
  │ Compile Each Function → BytecodeUnit            │
  │  ├── Emit opcodes for all statements/exprs      │
  │  ├── Build constant pool                        │
  │  ├── Scope analysis + register allocation       │
  │  ├── Capture analysis → register promotion      │
  │  ├── Peephole optimization + superinstructions  │
  │  └── Recurse into nested functions              │
  └────┬────────────────────────────────────────────┘
       │
       ▼
  ┌────────────────────────────────────────┐
  │ Serialize + Encrypt                    │
  │  ├── JSON or binary format             │
  │  ├── String constant XOR encoding      │
  │  ├── Rolling cipher (per-instruction)  │
  │  └── RC4 encryption (optional)         │
  └────┬───────────────────────────────────┘
       │
       ▼
  ┌────────────────────────────────────────────────┐
  │ Assemble Output                                │
  │  ├── Generate VM runtime IIFE                  │
  │  │    ├── Interpreter (shuffled opcode switch) │
  │  │    ├── Scope chain + exception handling     │
  │  │    ├── Bytecode loader + deserializer       │
  │  │    └── Rolling cipher decoder               │
  │  ├── Embed bytecode table                      │
  │  ├── Replace original function bodies          │
  │  └── Randomize all internal identifiers        │
  └────┬───────────────────────────────────────────┘
       │
       ▼
Obfuscated JavaScript
</pre>

<hr>

<h2 id="layers">Layers</h2>

<p>Ruam's protection is has with multiple independent layers that compound the difficulty of reverse engineering.</p>

<h3>:microchip: Layer 1 — Virtualization</h3>

<p>The original JavaScript is compiled to RuamVM bytecode. An attacker must reverse-engineer the VM to even begin retrieval of the original logic.</p>

<h3>:shuffle_tracks_button: Layer 2 — Polymorphic Encoding</h3>

<p>Ruam shuffles the opcode-to-instruction mapping via a seeded Fisher-Yates permutation. This means that each RuamVM build must be individually deobfuscated: an attacker who reverse-engineers one build's opcodes does not know the opcode mapping of any other build.</p>

<h3>:locked: Layer 3 — Rolling Cipher</h3>

<p>Every instruction is encrypted with a position-dependent XOR cipher. The state evolves with each instruction, and The master key is derived via FNV-1a from bytecode metadata (instruction count, register count, param count, constant count, etc.) Decryption requires executing the cipher sequentially from the beginning, defeating random-access analysis.</p>

<h3>:shield: Layer 4 — Integrity Binding</h3>

<p>The rolling cipher's base key incorporates a hash of the RuamVM's own source code. This creates a cryptographic binding between the interpreter and its bytecode: any modification to the interpreter (adding <code>console.log</code>, patching opcode handlers, inserting breakpoints) changes the hash, which changes the key, which turns all bytecode into garbage. This makes it difficult for an attacker to patch the VM in order to dump information at runtime.</p>

<h3>:see_no_evil: Layer 5 — String Obfuscation</h3>

<p>Strings are given special treatment during obfuscation. All string constants in the bytecode (variable names, property keys, literals) are XOR-encoded with an LCG key stream.</p>

<h3>:performing_arts: Layer 6 — Classic Transformations</h3>

<p>Lastly, internal identifiers in the VM runtime are replaced with a randomized names generated from the build seed. Combined with per-build opcode shuffling, the structure of the RuamVM interpreter looks different for each built output.</p>

<hr>

<h2 id="presets">Presets</h2>

<p>Three built-in presets provide escalating levels of protection:</p>

<table>
  <thead>
    <tr>
      <th></th>
      <th>Preset</th>
      <th>What's enabled</th>
      <th>Use case</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>:green_circle:</td>
      <td><strong><code>low</code></strong></td>
      <td>VM compilation only</td>
      <td>Development, debugging, basic IP protection</td>
    </tr>
    <tr>
      <td>:yellow_circle:</td>
      <td><strong><code>medium</code></strong></td>
      <td>+ identifier renaming, bytecode encryption, rolling cipher, decoy opcodes, dynamic opcodes</td>
      <td>Production — good balance of protection and output size</td>
    </tr>
    <tr>
      <td>:red_circle:</td>
      <td><strong><code>high</code></strong></td>
      <td>+ debug protection, integrity binding, dead code injection, stack encoding</td>
      <td>High-value targets — maximum protection</td>
    </tr>
  </tbody>
</table>

<pre><code>ruam dist/ --preset high</code></pre>

<p>Explicit options always override preset values:</p>

<pre><code>obfuscateCode(source, {
  preset: "medium",
  debugProtection: true, // override: add debug protection to medium preset
});</code></pre>

<hr>

<h2 id="cli-reference">CLI Reference</h2>

<pre><code>ruam &lt;input&gt; [options]

Presets:
  --preset &lt;name&gt;           Apply a preset: low, medium, high

Options:
  -o, --output &lt;path&gt;       Output file or directory (default: overwrite input)
  -m, --mode &lt;mode&gt;         Target mode: "root" (default) or "comment"
  -e, --encrypt             Enable bytecode encryption (RC4 + environment fingerprint)
  -p, --preprocess          Rename all identifiers before compilation
  -d, --debug-protection    Inject anti-debugger timing loop
  --debug-logging           Inject verbose VM trace logging
  --dynamic-opcodes         Filter unused opcodes and shuffle case order
  --decoy-opcodes           Add fake opcode handlers to the interpreter
  --dead-code               Inject dead bytecode sequences
  --stack-encoding          Encrypt values on the VM stack
  --rolling-cipher          Rolling cipher on bytecode instructions
  --integrity-binding       Bind decryption to interpreter integrity
  --include &lt;glob&gt;          File glob for directory mode (default: "**/*.js")
  --exclude &lt;glob&gt;          Exclude glob (default: "**/node_modules/**")
  -h, --help                Show help
  -v, --version             Show version</code></pre>

<h2 id="api-reference">API Reference</h2>

<h3><code>obfuscateCode(source, options?)</code></h3>

<p>Synchronously obfuscates a JavaScript source string.</p>

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
      <td>—</td>
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
      <td>Probability (0-1) that an eligible function is compiled</td>
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
    optimizer.ts            Peephole optimizer (constant folding, jump threading, superinstructions)
    encode.ts               Bytecode serialization (JSON + binary + RC4) + string encoding
    visitors/
      statements.ts         Statement compilation (if, for, while, switch, try, etc.)
      expressions.ts        Expression compilation (calls, members, operators, etc.)
      classes.ts            Class compilation (methods, properties, super, inheritance)
      patterns.ts           Destructuring pattern compilation

  runtime/
    vm.ts                   VM runtime code generator (~100 lines, assembles IIFE)
    names.ts                RuntimeNames interface + per-build randomized identifiers (LCG PRNG)
    fingerprint.ts          Environment fingerprinting for encryption
    decoder.ts              RC4 + base64 codec + string constant XOR decoder
    rolling-cipher.ts       Rolling cipher: position-dependent encryption + implicit key derivation
    templates/
      interpreter.ts        Core interpreter (sync + async exec, 300-opcode switch)
      loader.ts             Bytecode loader, cache, depth tracking
      runners.ts            VM dispatch functions (run/runAsync)
      deserializer.ts       Binary bytecode deserializer
      debug-protection.ts   Anti-debugger timing side-channel
      debug-logging.ts      Debug trace infrastructure
      globals.ts            Global exposure (globalThis binding)
</pre>

<h2 id="performance">Performance</h2>

<p>The VM interpreter adds overhead compared to native execution — this is inherent to any virtualization-based obfuscator. Ruam includes several optimizations to minimize the cost:</p>

<ul>
  <li><strong>Register promotion</strong>: Non-captured locals bypass the scope chain entirely via O(1) register access</li>
  <li><strong>Superinstructions</strong>: ~22 fused opcodes (e.g., <code>REG_ADD</code>, <code>REG_LT_CONST_JF</code>) reduce interpreter dispatch count</li>
  <li><strong>Inline stack operations</strong>: Push/pop/peek are inlined directly (<code>S[++P]=val</code>, <code>S[P--]</code>) so there is no function call overhead</li>
  <li><strong>Direct closure dispatch</strong>: Closures call <code>exec()</code> directly with pre-loaded bytecode units and bypass the load chain</li>
  <li><strong>Int32Array instruction storage</strong>: Bytecode is loaded into typed arrays for fast indexed access</li>
</ul>

<p>Typical overhead is <strong>~38-45x</strong> native speed on compute-heavy benchmarks, which is competitive for a pure JS-in-JS interpreter. The theoretical floor for this approach is ~25x vanilla JS runtimes.</p>

<h2 id="selective-obfuscation">Selective Obfuscation</h2>

<p>Not every function needs to be virtualized. Use <code>comment</code> mode to selectively protect only the functions that matter:</p>

<pre><code>/* ruam:vm */
function sensitiveLogic() {
  // This function will be compiled to bytecode
}

function publicHelper() {
  // This function runs as normal JavaScript — no overhead
}</code></pre>

<pre><code>ruam app.js -m comment</code></pre>

<h2 id="requirements">Requirements</h2>

<ul>
  <li>Node.js &gt;= 18</li>
  <li>ESM (<code>"type": "module"</code>)</li>
</ul>

<h2 id="license">License</h2>

<p>LGPL-2.1</p>
