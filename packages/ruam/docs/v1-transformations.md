# Ruam V1 -- Complete Transformation Reference

> **Archival Documentation** -- Ruam V1 has been superseded by V2 (the VM-based obfuscator). This document serves as a comprehensive reference for every transformation that V1 performed, preserved for posterity and to inform future development.

---

## Table of Contents

- [1. Architecture Overview](#1-architecture-overview)
- [2. Pipeline Stages](#2-pipeline-stages)
  - [2.1 Stage 1: Script Injection](#21-stage-1-script-injection)
  - [2.2 Stage 2: CSS Obfuscation](#22-stage-2-css-obfuscation)
  - [2.3 Stage 3: Flatten](#23-stage-3-flatten)
  - [2.4 Stage 4: Rename](#24-stage-4-rename)
  - [2.5 Stage 5: JS Obfuscation](#25-stage-5-js-obfuscation)
  - [2.6 Stage 6: Transforms](#26-stage-6-transforms)
  - [2.7 Stage 7: Minify](#27-stage-7-minify)
  - [2.8 Stage 8: Package](#28-stage-8-package)
- [3. AST Transform Plugins](#3-ast-transform-plugins)
  - [3.1 Scrubber](#31-scrubber)
  - [3.2 Literal Virtualization (VFS)](#32-literal-virtualization-vfs)
  - [3.3 Safe Rename](#33-safe-rename)
  - [3.4 Control Flow Normalization](#34-control-flow-normalization)
  - [3.5 Grammar Camouflage](#35-grammar-camouflage)
  - [3.6 Code Transposition](#36-code-transposition)
  - [3.7 Mixed Boolean Arithmetic (MBA)](#37-mixed-boolean-arithmetic-mba)
  - [3.8 Opaque Predicates](#38-opaque-predicates)
  - [3.9 Dispatch Tables](#39-dispatch-tables)
- [4. Shared Transform Utilities](#4-shared-transform-utilities)
- [5. Runtime](#5-runtime)
- [6. Configuration Presets](#6-configuration-presets)
- [7. Dependencies](#7-dependencies)
- [8. Key Architecture Decisions](#8-key-architecture-decisions)
- [9. Summary](#9-summary)

---

## 1. Architecture Overview

Ruam V1 was a configurable post-build JavaScript obfuscation and hardening pipeline designed for Chrome extensions, web applications, Node.js apps, and JavaScript libraries. It processed built files through up to **8 sequential pipeline stages** plus **9 Babel AST transform plugins**.

**Source layout:**

| Path | Purpose |
|------|---------|
| `src/index.ts` | Library entry point |
| `src/cli.ts` | CLI entry point |
| `src/pipeline.ts` | Pipeline orchestrator |
| `src/presets.ts` | Preset definitions |
| `src/types.ts` | TypeScript type definitions |
| `src/stages/` | Pipeline stage implementations |
| `src/transforms/plugins/` | Babel AST transform plugins |
| `src/transforms/runtime/ruam.runtime.js` | Environment-agnostic runtime |

---

## 2. Pipeline Stages

The pipeline executed up to 8 stages sequentially. Each stage only ran when explicitly set to `true` in the configuration (not merely when `!== false`).

### 2.1 Stage 1: Script Injection

**Source:** `src/stages/html-processing.ts`

Injected JavaScript guard scripts into HTML pages and performed HTML sanitization.

**Guard script features:**

- **Extension Context Check** -- Verified that `chrome.runtime.id` exists. If missing, the page was blanked entirely, preventing the extension from running outside its expected context.
- **Anti-DevTools** -- Blocked keyboard shortcuts for opening developer tools:
  - `F12`
  - `Ctrl+Shift+I`, `Ctrl+Shift+J`, `Ctrl+Shift+C` (Windows/Linux)
  - `Cmd+Alt+I`, `Cmd+Alt+J`, `Cmd+Alt+C` (macOS)
  - `Ctrl+U` (View Source)
- **Anti-Right-Click** -- Disabled the browser context menu.

**Configuration:**

- Guard script output path was configurable (default: `js/guard/page-guard.js`)
- Supported injection of custom scripts alongside the guard
- Used glob patterns to target HTML files (default: `pages/*.html`)

**CSS Inlining:**

External CSS files referenced in HTML were inlined into `<style>` tags, removing the external dependency.

**HTML Sanitization:**

- Stripped HTML comments
- Removed `aria-*`, `alt`, and `role` attributes
- Cleared `<title>` element content
- Stripped `lang`, `autocomplete`, and `label[for]` attributes

### 2.2 Stage 2: CSS Obfuscation

**Source:** `src/stages/css-obfuscation.ts`

Replaced CSS class names and IDs with random hex hashes across all file types.

**Process:**

1. Scanned HTML, CSS, and JS files for class names and IDs
2. Generated random hex hashes for each identifier
3. Applied replacements longest-first to avoid partial matches

**Filtering rules:**

- Excluded external framework prefixes (Font Awesome: `fa`, `fab`, `fas`, `far`, etc.)
- Excluded unsafe patterns (single words without `-`, `__`, or `js-` prefix)

**Replacement targets:**

| File Type | What Was Replaced |
|-----------|-------------------|
| CSS | `.classname` and `#id` selectors |
| HTML | `class` and `id` attributes, `for` labels |
| JS | String literals containing class/ID references |

### 2.3 Stage 3: Flatten

**Source:** `src/stages/flatten.ts`

Collapsed nested directory structures into a single flat directory.

**Behavior:**

- Moved all nested JS files into a single directory (default: `js/`)
- Appended `_N` suffix to filenames on basename collision (e.g., `utils.js` -> `utils_1.js`)
- Updated all relative path references across HTML, JSON, JS, and CSS files
- Removed empty subdirectories after flattening

**Example:**

```
Before:                     After:
js/                         js/
  modules/                    main.js
    auth/                     auth.js
      auth.js                 helpers.js
    helpers.js
  main.js
```

### 2.4 Stage 4: Rename

**Source:** `src/stages/rename.ts`

Replaced meaningful file and directory names with random hex strings.

**Renaming scheme:**

| Target | New Name Format |
|--------|-----------------|
| Directories | Random 12-character hex string (renamed deepest-first) |
| JS files | Random 8-character hex string |
| HTML files | Random 8-character hex string |

**Path updating:**

All relative path references in HTML, JSON, and JS files were updated to reflect the new names.

**Exclusions:**

- Specified directories were excluded (default: `css`)
- Specified files were excluded (default: `manifest.json`)

**Example:**

```
Before:                     After:
js/                         js/
  auth.js                    a3f7c921.js
  main.js                    e1b04d8f.js
pages/                      7c2a91f3b4e8/
  popup.html                  4f8e2a1b.html
```

### 2.5 Stage 5: JS Obfuscation

**Source:** `src/stages/obfuscation.ts`

The heaviest transformation stage, applying three sequential obfuscation passes to JavaScript files.

**Step 1: Terser Minification** (optional, enabled by default)

- Full compression and dead code elimination
- Variable name mangling
- Comment removal

**Step 2: AST Packer** (optional, enabled by default)

- Used vendored `packer.cjs` for additional code packing
- Included safety checking to validate packer output

**Step 3: javascript-obfuscator**

Applied aggressive obfuscation with the following settings:

| Setting | Value |
|---------|-------|
| Control flow flattening | Enabled, 65% threshold |
| String array | RC4 encoding, 16 wrappers, 31-char chunks |
| String array access | Hexadecimal indexed |
| String array rotation | Enabled |
| String array shuffling | Enabled |
| String array index shifting | Enabled |
| Object key transformation | Enabled |
| Numbers to expressions | Enabled |
| Identifier prefix | `ruam_` |
| Target | Configurable: `browser`, `browser-no-eval`, or `node` |

### 2.6 Stage 6: Transforms

**Source:** `src/transforms/index.ts`

The AST transform orchestrator. Applied up to 9 Babel visitor plugins (detailed in [Section 3](#3-ast-transform-plugins)) and injected the `ruam.runtime.js` file.

**Runtime injection modes:**

| Mode | Behavior |
|------|----------|
| `auto` | ES module files get an `import` statement; scripts get the runtime inlined |
| `import` | Always inject as an ES `import` statement |
| `inline` | Always inline the full runtime source |

The runtime was configured with a salt-based seed for deterministic encryption/decryption.

### 2.7 Stage 7: Minify

**Source:** `src/stages/minify.ts`

Final minification pass across all file types.

**CSS Minification:**

- Used CleanCSS with level-2 optimizations
- Inline rule processing
- Path rewriting for referenced assets

**HTML Sanitization (second pass):**

- Stripped comments
- Removed `aria-*`, `alt`, `role` attributes
- Cleared `<title>` content
- Stripped `lang`, `autocomplete` attributes

**HTML Minification:**

Used `html-minifier-terser` with aggressive settings:

- Collapsed whitespace
- Collapsed boolean attributes
- Sorted attributes and classes
- Removed redundant and optional tags
- Minified inline CSS and JS

**JSON Minification:**

- Parsed and re-stringified to remove all whitespace and formatting

### 2.8 Stage 8: Package

**Source:** `src/stages/package.ts`

Packaged the final output into a distributable archive.

**ZIP creation:**

- Compression level 9 (maximum)
- Archive name format: `{productName} v{version}.zip`
- Version read from `manifest.json`

**macOS icon support:**

- Converted PNG to ICNS format via `png2icons`
- Applied icon to ZIP file via `fileicon`
- Hid `.zip` extension via `SetFile`

**Cleanup:**

- Removed all non-archive files from the output directory
- Preserved files matching specified patterns (default: `.crx`)

---

## 3. AST Transform Plugins

All 9 plugins used Babel's visitor protocol. Each plugin was independently configurable and could be enabled or disabled per-project.

### 3.1 Scrubber

**Source:** `src/transforms/plugins/scrubber.ts`
**Default:** Enabled

Reversed patterns left behind by `javascript-obfuscator`'s hex-array encoding.

**What it did:**

- Detected `_0x[hex]+` variable names and associated array indexing patterns
- Reconstructed original string values from the obfuscated hex arrays
- Cleaned up the code to remove the indirection layer

This plugin acted as a normalization step, making the code more amenable to subsequent Ruam transforms by undoing some of `javascript-obfuscator`'s own internal patterns.

### 3.2 Literal Virtualization (VFS)

**Source:** `src/transforms/plugins/c-vfs.ts`
**Default:** Disabled

Encoded literal values into a virtual file system (VFS) that was decrypted at runtime.

**Supported literal types:**

| Literal Type | Condition |
|-------------|-----------|
| String literals | Always eligible |
| Template literals | Only if they contain no expressions |
| Regex literals | Always eligible |
| Numeric literals | Only if above `minNumeric` threshold (default: 1024) |

**Encoding scheme:**

- Created bytecode VFS with varint-encoded entries
- Applied XOR masking for encryption
- Decryption occurred at runtime via the injected `ruam.runtime.js`

**Seed derivation (SHA-256 based):**

| Environment | Seed Source |
|-------------|-------------|
| Chrome Extension | `chrome.runtime.id` |
| Web App | `location.hostname` |
| Node.js | `process.pid` |

**Example:**

```javascript
// Before
const msg = "Hello, world!";
const threshold = 2048;

// After (conceptual)
const msg = ruam_S(0);       // Decrypted from VFS at runtime
const threshold = ruam_RN(1); // Decrypted from VFS at runtime
```

### 3.3 Safe Rename

**Source:** `src/transforms/plugins/safe-rename.ts`
**Default:** Disabled

Renamed local variable bindings to short base62 identifiers.

**Rules:**

- Only renamed locally-scoped variable bindings
- Skipped global variables
- Skipped exported bindings
- Skipped variables with mutations (reassignments)
- Avoided collisions with Ruam runtime reserved names (`ruam_global`, `ruam_S`, `ruam_RN`, etc.)

**Example:**

```javascript
// Before
function processData(inputArray, filterCallback) {
  const results = inputArray.filter(filterCallback);
  return results;
}

// After
function processData(a, b) {
  const c = a.filter(b);
  return c;
}
```

### 3.4 Control Flow Normalization

**Source:** `src/transforms/plugins/cf-normalize.ts`
**Default:** Enabled

Detected and restructured `javascript-obfuscator`'s control flow flattening patterns into a different (but equally obfuscated) form.

**What it did:**

1. Detected `while(!![[...]])` loops -- the signature pattern of `javascript-obfuscator`'s control flow flattening
2. Converted them to labeled `do-while` loops with `if-else` chains
3. Added a state variable (`ruam_state`) for flow masking
4. Generated `continue` statements for case-to-case transitions

This transformation made the code harder to deobfuscate with tools that specifically target `javascript-obfuscator`'s known patterns.

### 3.5 Grammar Camouflage

**Source:** `src/transforms/plugins/grammar-camouflage.ts`
**Default:** Enabled

Applied subtle syntactic variations to make automated pattern recognition harder.

**Transformations:**

| Transformation | Rate | Example |
|---------------|------|---------|
| Static-to-computed member access | 25% | `obj.foo` -> `obj["foo"]` |
| Computed-to-static member access | 25% | `obj["foo"]` -> `obj.foo` |
| Numeric decomposition | Varies | `1024` -> `(1 << 10) + 0` |
| Conditional extraction | Varies | Condition pulled into a guard variable |

**Determinism:**

Used a deterministic PRNG seeded from `filename + salt`, ensuring identical output across runs with the same configuration.

**Example (numeric decomposition):**

```javascript
// Before
const size = 4096;

// After
const size = (1 << 12) + 0;
```

### 3.6 Code Transposition

**Source:** `src/transforms/plugins/code-transposition.ts`
**Default:** Disabled

Randomized statement execution order using a goto-like dispatch mechanism.

**Process:**

1. Hoisted all variable declarations to the top of the function
2. Assigned each statement block a random label in the range `[100, 100 + N*10)`
3. Wrapped the function body in a `switch`-based dispatcher that executed blocks in the original order at runtime

**Constraints:**

- Required a minimum statement count (default: 4) before applying
- Only applied to function bodies

**Example:**

```javascript
// Before
function init() {
  const x = getConfig();
  validate(x);
  apply(x);
  log("done");
}

// After (conceptual)
function init() {
  var x;
  var _ruam_pc = 110;
  while (_ruam_pc !== 0) {
    switch (_ruam_pc) {
      case 110: x = getConfig(); _ruam_pc = 130; break;
      case 130: validate(x); _ruam_pc = 100; break;
      case 100: apply(x); _ruam_pc = 120; break;
      case 120: log("done"); _ruam_pc = 0; break;
    }
  }
}
```

### 3.7 Mixed Boolean Arithmetic (MBA)

**Source:** `src/transforms/plugins/mba.ts`
**Default:** Disabled

Replaced arithmetic operations with algebraically equivalent but harder-to-read expressions using bitwise operations.

**Identity transformations:**

| Original | MBA Equivalent |
|----------|---------------|
| `a + b` | `(a ^ b) + 2 * (a & b)` |
| `a - b` | `(a ^ b) - 2 * (~a & b)` |

**Numeric literal encoding:**

Numeric literals could also be encoded via MBA identities:

```javascript
// Before
const answer = 42;

// After
const answer = (42 ^ 0) + 2 * (42 & 0);
```

Applied with configurable probability to avoid making every expression uniformly obfuscated.

### 3.8 Opaque Predicates

**Source:** `src/transforms/plugins/opaque-predicates.ts`
**Default:** Disabled

Inserted always-true conditional guards and dead code to confuse static analysis.

**Techniques:**

| Technique | Probability | Description |
|-----------|-------------|-------------|
| Dead code insertion | 8% | Injected unreachable code before statements |
| Guard wrapping | 6% | Wrapped statements in always-true conditionals |

**Predicate forms (all always evaluate to `true`):**

- `(x * x) >= 0` -- squares are non-negative
- `(x * (x + 1)) % 2 === 0` -- product of consecutive integers is even
- Modular arithmetic identities

**Example:**

```javascript
// Before
doWork();

// After
if (((_ruam_x * _ruam_x) >= 0)) {
  doWork();
}
```

The dead branches introduced by these predicates made static analysis tools report false execution paths, complicating reverse engineering.

### 3.9 Dispatch Tables

**Source:** `src/transforms/plugins/dispatch-tables.ts`
**Default:** Disabled

Replaced direct function calls with indexed lookups through dynamically constructed dispatch tables.

**Rules:**

- Only applied to locally-bound functions (not globals or imports)
- Required a minimum number of call sites (default: 3) to the same function before creating a table entry

**Example:**

```javascript
// Before
function validate(x) { /* ... */ }
validate(a);
validate(b);
validate(c);

// After
const _dt = [validate];
_dt[0](a);
_dt[0](b);
_dt[0](c);
```

This hid the relationship between call sites and their targets, making call-graph analysis significantly harder.

---

## 4. Shared Transform Utilities

### Deterministic PRNG

**Source:** `src/transforms/shared/random.ts`

- **Algorithm:** xorshift32
- **Seed:** Derived from `filename + configurable salt`
- **Purpose:** Ensured reproducible transforms across runs with the same configuration, while producing different output per file

### Hash Function

**Source:** `src/transforms/shared/hash.ts`

- **Algorithm:** FNV-1a 64-bit
- **Uses:** CSS class/ID hash generation, unique identifier generation

### XOR Masking

**Source:** `src/transforms/shared/mask.ts`

- XOR masking with SHA-256 seed derivation
- Used by the VFS virtualization plugin for literal encryption and decryption

---

## 5. Runtime

**Source:** `src/transforms/runtime/ruam.runtime.js`

An environment-agnostic runtime (browser, Node.js, and Chrome extension) injected into obfuscated output.

**Exported symbols:**

| Symbol | Purpose |
|--------|---------|
| `ruam_sha256()` | SHA-256 hash implementation |
| `ruam_seed_source` | Seed derivation from environment |
| `ruam_xorshift128p()` | PRNG for runtime decryption |
| `ruam_unmask()` | XOR-unmask virtualized data with seed |
| `ruam_runtime_ready` | Flag preventing duplicate initialization |

**Seed derivation sources by environment:**

| Environment | Primary Source | Additional Entropy |
|-------------|---------------|-------------------|
| Chrome Extension | `chrome.runtime.id` | Hardware concurrency + dynamic salt |
| Web App | `location.hostname` | Hardware concurrency + dynamic salt |
| Node.js | `process.pid` | Hardware concurrency + dynamic salt |

The runtime also included a virtualization decoder that reconstructed literal values from VFS bytecode at execution time.

---

## 6. Configuration Presets

Five built-in presets controlled which stages and transforms were active:

| Preset | Stage 1 (Inject) | Stage 2 (CSS) | Stage 3 (Flatten) | Stage 4 (Rename) | Stage 5 (Obfuscate) | Stage 6 (Transform) | Stage 7 (Minify) | Stage 8 (Package) | JS Target |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|-----------|
| `chrome-extension` | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | `browser` |
| `web-app` | -- | Yes | -- | -- | Yes | Yes | Yes | Yes | `browser` |
| `node-app` | -- | -- | -- | -- | Yes | Yes | Yes | Yes | `node` |
| `library` | -- | -- | -- | -- | Yes | Yes | Yes | Yes | `browser-no-eval` |
| `custom` | -- | -- | -- | -- | -- | -- | -- | -- | -- |

**Config merge order:** preset defaults < config file < CLI flags

The `custom` preset started with nothing enabled, giving full manual control.

---

## 7. Dependencies

| Category | Packages |
|----------|----------|
| AST manipulation | `@babel/parser`, `@babel/traverse`, `@babel/generator`, `@babel/types`, `@babel/template` |
| JS obfuscation | `javascript-obfuscator` |
| JS minification | `terser` |
| JS parsing | `acorn` |
| CSS minification | `clean-css` |
| HTML minification | `html-minifier-terser` |
| Filesystem | `fs-extra`, `globby` |
| Packaging | `archiver`, `png2icons` |

---

## 8. Key Architecture Decisions

1. **Opt-in stages** -- Stages only ran when explicitly set to `true`, not when `!== false`. This prevented accidental activation.
2. **Three-tier config merge** -- Preset defaults were overridden by config file values, which were in turn overridden by CLI flags.
3. **Environment-agnostic runtime** -- A single `ruam.runtime.js` worked across browser, Node.js, and Chrome extension environments.
4. **VFS with XOR masking** -- Literal virtualization used a virtual file system format with XOR masking and a deterministic PRNG for encryption.
5. **Babel visitor protocol** -- All 9 AST transforms were implemented as Babel visitors, enabling composability and independent toggling.
6. **Deterministic transforms** -- Filename + salt seeding ensured reproducible output across runs.
7. **Diagnostics** -- The pipeline produced a JSON report and console output for observability.

---

## 9. Summary

Ruam V1 implemented a deep, multi-layered obfuscation pipeline consisting of:

- **8 pipeline stages** covering script injection, CSS obfuscation, directory flattening, file renaming, JS obfuscation (Terser + packer + javascript-obfuscator), AST transforms, minification, and packaging.
- **9 Babel AST plugins** providing scrubbing, literal virtualization, safe renaming, control flow normalization, grammar camouflage, code transposition, mixed boolean arithmetic, opaque predicates, and dispatch tables.
- **A shared runtime** for environment-agnostic decryption and literal reconstruction.
- **5 presets** for common deployment targets, with full manual override capability.

V2 replaces this entire pipeline with a VM-based approach that compiles JavaScript function bodies to custom bytecode executed by an embedded virtual machine, offering a fundamentally different (and stronger) obfuscation model.
