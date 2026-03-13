<div align="center">
    <pre>
:::::::..    ...    :::  :::.     .        :
;;;;``;;;;   ;;     ;;;  ;;`;;    ;;,.    ;;;
 [[[,/[[['  [['     [[[ ,[[ '[[,  [[[[, ,[[[[,
 $$$$$$c    $$      $$$c$$$cc$$$c $$$$$$$$"$$$
 888b "88bo,88    .d888 888   888,888 Y88" 888o
 MMMM   "W"  "YmmMMMM"" YMM   ""` MMM  M'  "MMM</pre>

<strong>Virtualization-Based JavaScript Obfuscation</strong><br>

<p>Compiles JavaScript functions into custom bytecode executed by an embedded virtual machine.<br>
No deobfuscator exists for RuamVM bytecode.</p>

<a href="https://nodejs.org/en/"><img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white&color=1F49AC" alt="Node.js >= 18"></a>
<img src="https://img.shields.io/badge/license-LGPL--2.1-yellow?style=flat-square&logo=googledocs&logoColor=white&color=3659BD" alt="LGPL-2.1">
<img src="https://img.shields.io/badge/typescript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white&color=4D6ACD" alt="TypeScript Strict">

<img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fowengregson.github.io%2FRuam%2Fstats.json&query=%24.badges.testsPassing&label=tests&color=637ADE&style=flat-square&logo=vitest&logoColor=white" alt="Tests Passing">
<img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fowengregson.github.io%2FRuam%2Fstats.json&query=%24.badges.sizeRatioLow&label=Avg.%20Size%20Ratio&color=7A8BEE&style=flat-square&logo=onlyoffice&logoColor=white" alt="Avg Size Ratio">
<img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fowengregson.github.io%2FRuam%2Fstats.json&query=%24.badges.overheadMedian&label=VM%20Overhead&color=919BFF&style=flat-square&logo=speedtest&logoColor=white" alt="VM Overhead">

<hr>
<h3> Quick Links </h3>
<a href="#installation">Installation</a>&ensp;&middot;&ensp;
<a href="#quick-start">Quick Start</a>&ensp;&middot;&ensp;
<a href="#how-it-works">How It Works</a>&ensp;&middot;&ensp;
<a href="#presets">Presets</a>&ensp;&middot;&ensp;
<a href="#api-reference">API</a>

</div>

<hr>

<h2 id="why-ruam">Why Ruam?</h2>

<p>
  Most JavaScript obfuscators apply surface-level <i>transformations</i> &mdash; renaming variables, encoding strings, inserting dead code. A motivated attacker can undo these with off-the-shelf tools, logic analysis, or by patching functions at runtime.
</p>

<p>
  <strong>Ruam takes a fundamentally different approach.</strong> It <i>compiles</i> your JavaScript into a custom bytecode instruction set and replaces the original source with a compact virtual machine that executes an unintelligible instruction stream. The original code is destroyed &mdash; it does not exist anywhere in the output.
</p>

<h4>Traditional Obfuscators</h4>
<p>Source JS  →  Transformed JS
		(still JS)</p>
<ul>
<li>Same language, same semantics</li>
<li>AST-reversible transformations</li>
<li>Automated deobfuscation tools exist</li>
</ul>

<h4>Ruam</h4>
<p>Source JS  →  Custom Bytecode
		+ Embedded VM</p>
<ul>
<li>Original source is destroyed</li>
<li>Must reverse-engineer the VM itself</li>
<li>No deobfuscator exists</li>
</ul>
<br>

<table>
  <tbody>
    <tr>
      <td><strong>300+ opcode open-source ISA</strong></td>
      <td>Full-coverage instruction set spanning 26 categories &mdash; stack, arithmetic, bitwise, comparison, control flow, property access, scoping, calls, classes, iterators, destructuring, async/await, generators, and more.</td>
    </tr>
    <tr>
      <td><strong>Per-build polymorphism</strong></td>
      <td>Every build produces structurally unique output. No two builds share the same encoding, identifier names, or internal structure &mdash; even from the same source.</td>
    </tr>
    <tr>
      <td><strong>Multi-layer encryption</strong></td>
      <td>Bytecode is encrypted with multiple independent layers. Keys are derived implicitly from the output's own structure &mdash; no key material appears in plaintext.</td>
    </tr>
    <tr>
      <td><strong>Anti-tamper binding</strong></td>
      <td>The VM's decryption logic is entangled with its own source. Modifying the interpreter to add logging or breakpoints corrupts all decryption &mdash; the bytecode becomes unrecoverable.</td>
    </tr>
    <tr>
      <td><strong>Optimizing compiler</strong></td>
      <td>Multi-tier optimization pipeline minimizes the performance cost of virtualization. Fused instructions, register promotion, and inline operations keep overhead competitive for a JS-in-JS interpreter.</td>
    </tr>
    <tr>
      <td><strong>Thousands of tests</strong></td>
      <td>Comprehensive test suite covering core JS semantics, stress/edge cases, security properties, and integration scenarios &mdash; including randomized fuzz tests.</td>
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
ruam dist/ --preset max

# Interactive wizard (or just run `ruam` with no args)
ruam -I</code></pre>

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
  options: { preset: "max" },
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

<p>Ruam applies multiple independent protection layers that compound the difficulty of reverse engineering. Each layer forces an attacker to solve a distinct problem before they can make progress on the next.</p>

<table>
  <thead>
    <tr>
      <th width="200">Layer</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Virtualization</strong></td>
      <td>Original JS is compiled to a custom bytecode ISA. The source code is destroyed &mdash; an attacker must reverse-engineer the entire VM to recover any logic.</td>
    </tr>
    <tr>
      <td><strong>Polymorphic encoding</strong></td>
      <td>The instruction encoding, identifiers, and internal structure are randomized per build. Reversing one build provides zero reusable knowledge about any other build.</td>
    </tr>
    <tr>
      <td><strong>Instruction encryption</strong></td>
      <td>Every instruction is individually encrypted. The key is derived from properties of the output itself &mdash; no key material is stored in plaintext. Sequential decryption is required; you cannot jump into the middle of a bytecode stream.</td>
    </tr>
    <tr>
      <td><strong>Integrity binding</strong></td>
      <td>The decryption process is entangled with the VM interpreter's own source. Modifying the VM in any way (adding logging, setting breakpoints, patching behavior) silently corrupts all decryption.</td>
    </tr>
    <tr>
      <td><strong>VM shielding</strong></td>
      <td>Each function can receive its own isolated micro-interpreter with unique encoding, encryption keys, and internal structure. Reversing one function's interpreter does not help with any other.</td>
    </tr>
    <tr>
      <td><strong>String encoding</strong></td>
      <td>All string constants in the bytecode are independently encrypted. No plaintext strings survive compilation &mdash; not variable names, property keys, or literal values.</td>
    </tr>
    <tr>
      <td><strong>Anti-debug</strong></td>
      <td>Multi-layered runtime detection with escalating response. No <code>eval()</code>, <code>new Function()</code>, <code>debugger</code> statements, or <code>console</code> calls &mdash; fully compatible with strict CSP environments including Chrome extensions.</td>
    </tr>
    <tr>
      <td><strong>Arithmetic obfuscation</strong></td>
      <td>Arithmetic and bitwise operations within the interpreter are replaced with mathematically equivalent but opaque compound expressions, making the interpreter logic harder to follow.</td>
    </tr>
  </tbody>
</table>

<p><i>Additional hardening options include dead bytecode injection, stack value encryption, decoy opcode handlers, and handler fragmentation &mdash; all configurable independently or via presets.</i></p>

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
      <td>+ identifier renaming, bytecode encryption, instruction encryption, decoy &amp; dynamic opcodes</td>
      <td>Production &mdash; balanced protection and size</td>
    </tr>
    <tr>
      <td><strong><code>max</code></strong></td>
      <td>Everything &mdash; all encryption layers, VM shielding, debug protection, integrity binding, arithmetic obfuscation, dead code, stack encoding, handler fragmentation</td>
      <td>High-value targets &mdash; maximum protection</td>
    </tr>
  </tbody>
</table>

<pre><code>ruam dist/ --preset max</code></pre>

<pre><code>obfuscateCode(source, {
  preset: "medium",
  debugProtection: true,  // override: add debug protection to medium
});</code></pre>

<hr>

<h2 id="performance">Performance</h2>

<p>Virtualization inherently adds overhead &mdash; this is the tradeoff for protection that surface-level transforms cannot provide. Ruam's multi-tier optimization pipeline minimizes the cost.</p>

<p>Typical overhead: <strong>~38&ndash;45x native speed</strong> on compute-heavy benchmarks, competitive for a pure JS-in-JS interpreter.</p>

<p><i>Use <a href="#quick-start">selective obfuscation</a> (<code>-m comment</code>) to protect only sensitive functions and leave hot paths running as native JS.</i></p>

<hr>

<h2 id="cli-reference">CLI Reference</h2>

<pre><code>ruam &lt;input&gt; [options]

Presets:
  --preset &lt;name&gt;           Apply a preset: low, medium, max

Output:
  -o, --output &lt;path&gt;       Output file or directory (default: overwrite input)

Compilation:
  -m, --mode &lt;mode&gt;         Target mode: "root" (default) or "comment"
  -e, --encrypt             Enable bytecode encryption
  -p, --preprocess          Rename all identifiers before compilation

Security:
  -d, --debug-protection    Enable anti-debugger protection
  --no-debug-protection     Disable anti-debugger (overrides preset)
  --rolling-cipher          Enable instruction encryption
  --integrity-binding       Bind decryption to interpreter integrity
  --vm-shielding            Per-function isolated micro-interpreters

Hardening:
  --dynamic-opcodes         Filter unused opcodes from the interpreter
  --decoy-opcodes           Add fake opcode handlers
  --dead-code               Inject dead bytecode sequences
  --stack-encoding          Encrypt values on the VM stack
  --mba                     Arithmetic obfuscation (mixed boolean arithmetic)
  --handler-fragmentation   Split handler logic into interleaved fragments

Environment:
  --target &lt;env&gt;            Target environment: node, browser (default), browser-extension

File Selection:
  --include &lt;glob&gt;          File glob for directory mode (default: "**/*.js")
  --exclude &lt;glob&gt;          Exclude glob (default: "**/node_modules/**")

Other:
  --debug-logging           Inject verbose VM trace logging
  -I, --interactive         Launch interactive configuration wizard
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

await obfuscateFile("src/app.js", "dist/app.js", { preset: "max" });</code></pre>

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
      <td><code>"low" | "medium" | "max"</code></td>
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
      <td><code>target</code></td>
      <td><code>"node" | "browser" | "browser-extension"</code></td>
      <td><code>"browser"</code></td>
      <td>Target execution environment</td>
    </tr>
    <tr>
      <td><code>preprocessIdentifiers</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Rename all local identifiers before compilation</td>
    </tr>
    <tr>
      <td><code>encryptBytecode</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Encrypt bytecode using an environment fingerprint key</td>
    </tr>
    <tr>
      <td><code>rollingCipher</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Per-instruction encryption with implicit key derivation</td>
    </tr>
    <tr>
      <td><code>integrityBinding</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Bind decryption to interpreter source integrity (auto-enables <code>rollingCipher</code>)</td>
    </tr>
    <tr>
      <td><code>vmShielding</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Per-function micro-interpreters with unique encoding (auto-enables <code>rollingCipher</code>)</td>
    </tr>
    <tr>
      <td><code>debugProtection</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Multi-layered anti-debugger with escalating response</td>
    </tr>
    <tr>
      <td><code>dynamicOpcodes</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Filter unused opcodes from the interpreter</td>
    </tr>
    <tr>
      <td><code>decoyOpcodes</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Add fake opcode handlers to the interpreter</td>
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
    <tr>
      <td><code>mixedBooleanArithmetic</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Replace arithmetic/bitwise ops with opaque MBA expressions</td>
    </tr>
    <tr>
      <td><code>handlerFragmentation</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Split opcode handlers into interleaved fragments</td>
    </tr>
    <tr>
      <td><code>debugLogging</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Inject verbose trace logging into the interpreter</td>
    </tr>
  </tbody>
</table>

<hr>

<h2 id="supported-syntax">Supported Syntax</h2>

<p>Ruam compiles the full range of modern JavaScript:</p>

<ul>
  <li>Functions (declarations, expressions, arrows, generators, async, async generators)</li>
  <li>Classes (inheritance, constructors, methods, getters/setters, computed properties, static members, <code>super</code>)</li>
  <li>Control flow (<code>if</code>, <code>for</code>, <code>for-in</code>, <code>for-of</code>, <code>while</code>, <code>do-while</code>, <code>switch</code>, labeled statements)</li>
  <li>Exception handling (<code>try</code>/<code>catch</code>/<code>finally</code>, <code>throw</code>)</li>
  <li>Destructuring (array and object patterns, defaults, rest elements, nested)</li>
  <li>Spread/rest (<code>...args</code> in calls, arrays, and object literals)</li>
  <li>Closures and lexical scoping (<code>let</code>/<code>const</code> with proper TDZ, per-iteration bindings)</li>
  <li>Async/await, generators (<code>yield</code>, <code>yield*</code>), async generators</li>
  <li>Template literals, tagged templates, optional chaining, nullish coalescing</li>
  <li>Computed property names, shorthand properties/methods, symbol keys</li>
</ul>

<hr>

<h2 id="target-environments">Target Environments</h2>

<p>Use <code>--target</code> to optimize output for your deployment environment:</p>

<table>
  <thead>
    <tr>
      <th>Target</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>browser</code></td>
      <td>Plain <code>&lt;script&gt;</code> tags. <strong>Default.</strong></td>
    </tr>
    <tr>
      <td><code>node</code></td>
      <td>Node.js (CJS or ESM modules).</td>
    </tr>
    <tr>
      <td><code>browser-extension</code></td>
      <td>Chrome extension MAIN world content scripts. Wraps output to avoid TrustedScript CSP errors.</td>
    </tr>
  </tbody>
</table>

<pre><code>ruam content-script.js --target browser-extension --preset max</code></pre>

<hr>

<h2 id="requirements">Requirements</h2>

<ul>
  <li><strong>Node.js</strong> &gt;= 18</li>
  <li><strong>ESM</strong> (<code>"type": "module"</code>)</li>
</ul>

<h2 id="license">License</h2>

<p><a href="LICENSE">LGPL-2.1</a></p>
