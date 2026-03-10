/**
 * Core type definitions for the Ruam VM obfuscator.
 * @module types
 */

// --- Public API Options ---

/** Preset names that group multiple options. */
export type PresetName = "low" | "medium" | "max";

/** Options accepted by {@link obfuscateCode} and the CLI. */
export interface VmObfuscationOptions {
  /**
   * Apply a preset configuration.  Explicit options override preset values.
   *
   * - `"low"` — VM compilation only.
   * - `"medium"` — Adds identifier renaming, bytecode encryption, decoy opcodes.
   * - `"max"` — All protections: debug protection, dead code injection, stack encoding, VM shielding.
   */
  preset?: PresetName;

  /**
   * How to select which functions to compile to bytecode.
   *
   * - `"root"` (default) — every function that is **not** nested inside
   *   another function.  Inner functions become child bytecode units.
   * - `"comment"` — only functions preceded by a `/* ruam:vm *​/` comment.
   */
  targetMode?: "root" | "comment";

  /**
   * Probability (0–1) that an eligible function is actually compiled.
   * Defaults to `1.0` (compile everything eligible).
   */
  threshold?: number;

  /** Run the identifier preprocessor before compilation. */
  preprocessIdentifiers?: boolean;

  /** Encrypt bytecode with RC4 using an environment fingerprint key. */
  encryptBytecode?: boolean;

  /** Inject an anti-debugger timing loop into the runtime. */
  debugProtection?: boolean;

  /** Inject verbose trace logging into the VM interpreter. */
  debugLogging?: boolean;

  /**
   * Filter unused opcode handlers from the interpreter and shuffle
   * case order.  Makes output smaller and unique per build.
   */
  dynamicOpcodes?: boolean;

  /**
   * Add fake opcode handlers to the VM dispatcher that are never called.
   * Makes the interpreter appear more complex.
   */
  decoyOpcodes?: boolean;

  /**
   * Inject fake bytecode sequences that are never executed.
   * Confuses static analysis tools.
   */
  deadCodeInjection?: boolean;

  /**
   * Encrypt values on the VM stack during execution.
   * Values are encoded when pushed and decoded when popped.
   * Impacts performance.
   */
  stackEncoding?: boolean;

  /**
   * Enable rolling cipher encryption on bytecode instructions.
   *
   * Each instruction's opcode and operand are XOR-encrypted with a
   * rolling state that evolves as instructions are decrypted.  The
   * master key is derived implicitly from bytecode metadata — no
   * plaintext seed appears in the output.
   *
   * Prevents static extraction of the opcode shuffle map and
   * eliminates the single-seed vulnerability.
   */
  rollingCipher?: boolean;

  /**
   * Bind bytecode decryption to the interpreter's own source integrity.
   *
   * A hash of the interpreter function is woven into the rolling
   * cipher's key derivation.  If the interpreter is modified (e.g.
   * to add logging), the hash changes and all decryption breaks.
   *
   * Requires {@link rollingCipher} to be enabled (auto-enabled).
   */
  integrityBinding?: boolean;

  /**
   * Generate per-function micro-interpreters instead of one shared
   * interpreter.
   *
   * Each root function and its children get a unique opcode shuffle,
   * unique runtime names, and a stripped-down interpreter containing
   * only the opcodes they use.  An attacker who reverses one function's
   * interpreter cannot reuse that knowledge for any other function.
   *
   * Increases output size proportionally to the number of root functions.
   * Automatically enables {@link rollingCipher}.
   */
  vmShielding?: boolean;
}

// --- Bytecode Data Structures ---

/**
 * A single entry in a bytecode unit's constant pool.
 *
 * The `value` field is typed loosely because it carries heterogeneous data
 * (strings, numbers, regex descriptors, etc.) that is only interpreted
 * at runtime by the VM.
 */
export interface ConstantPoolEntry {
  type: "null" | "undefined" | "boolean" | "number" | "string" | "bigint" | "regex";
  value: unknown;
}

/** A single bytecode instruction (opcode + operand pair). */
export interface Instruction {
  opcode: number;
  operand: number;
}

/** A try/catch/finally handler entry in the exception table. */
export interface ExceptionEntry {
  startIp: number;
  endIp: number;
  catchIp: number;
  finallyIp: number;
}

/**
 * A compiled bytecode unit — the output of compiling a single JS function.
 *
 * Each unit is self-contained: it carries its own constant pool, instruction
 * stream, and metadata.  Nested functions are compiled into separate
 * {@link childUnits} and referenced by ID at runtime.
 */
export interface BytecodeUnit {
  /** Unique identifier (e.g. `"u_0000"`). */
  id: string;

  /** Constant pool — literals referenced by `PUSH_CONST`. */
  constants: ConstantPoolEntry[];

  /** Flat instruction stream. */
  instructions: Instruction[];

  /** Label → IP jump table. */
  jumpTable: Record<number, number>;

  /** Exception handler table for try/catch/finally blocks. */
  exceptionTable: ExceptionEntry[];

  /** Number of declared parameters. */
  paramCount: number;

  /** Total registers allocated by the scope analyzer. */
  registerCount: number;

  /** Number of indexed scope slots for captured variables. */
  slotCount: number;

  /** Whether the source function had `"use strict"`. */
  isStrict: boolean;

  /** Whether the source function was a generator (`function*`). */
  isGenerator: boolean;

  /** Whether the source function was `async`. */
  isAsync: boolean;

  /** Whether the source function was an arrow function. */
  isArrow: boolean;

  /** Constant pool index for the function's name (`-1` if anonymous). */
  nameConstIndex: number;

  /** Names captured from outer scopes (informational). */
  outerNames: string[];

  /** Bytecode units for nested functions / closures. */
  childUnits: BytecodeUnit[];
}
