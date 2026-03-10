/**
 * Runtime identifier name generator.
 *
 * Produces randomized internal variable names for the VM runtime,
 * making the output look like generic minified code rather than
 * an obvious VM interpreter.
 *
 * @module runtime/names
 */

import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";

/**
 * Mapping of logical role to generated identifier name for all
 * runtime-internal variables and functions.
 */
export interface RuntimeNames {
  /** Bytecode table. */
  bt: string;
  /** VM dispatch function (exposed globally). */
  vm: string;
  /** Synchronous interpreter. */
  exec: string;
  /** Asynchronous interpreter. */
  execAsync: string;
  /** Bytecode unit loader. */
  load: string;
  /** Unit cache object. */
  cache: string;
  /** Recursion depth counter. */
  depth: string;
  /** Call stack for error messages. */
  callStack: string;
  /** Environment fingerprint function. */
  fp: string;
  /** RC4 cipher function. */
  rc4: string;
  /** Base64 decoder function. */
  b64: string;
  /** Binary deserializer function. */
  deser: string;
  /** Debug log function. */
  dbg: string;
  /** Debug opcode log function. */
  dbgOp: string;
  /** Debug config object. */
  dbgCfg: string;
  /** Debug protection IIFE name. */
  dbgProt: string;

  // Interpreter local names — disguise the stack-machine pattern
  /** Stack array (was `stack`). */
  stk: string;
  /** Stack pointer (was `sp`). */
  stp: string;
  /** Push function (was `push`). */
  sPush: string;
  /** Pop function (was `pop`). */
  sPop: string;
  /** Peek function (was `peek`). */
  sPeek: string;

  // Interpreter internal locals — disguise the VM pattern
  /** operand variable */
  operand: string;
  /** scope variable */
  scope: string;
  /** regs (register array) variable */
  regs: string;
  /** ip (instruction pointer) variable */
  ip: string;
  /** C (constants array) variable */
  cArr: string;
  /** I (instructions array) variable */
  iArr: string;
  /** exStack (exception handler stack) */
  exStk: string;
  /** pendingEx variable */
  pEx: string;
  /** hasPendingEx variable */
  hPEx: string;
  /** Completion type (0=none, 1=return). */
  cType: string;
  /** Completion value (saved return). */
  cVal: string;
  /** unit parameter */
  unit: string;
  /** args parameter */
  args: string;
  /** outerScope parameter */
  outer: string;
  /** thisVal parameter */
  tVal: string;
  /** newTarget parameter */
  nTgt: string;
  /** homeObject parameter (for [[HomeObject]] / super resolution). */
  ho: string;
  /** phys (physical opcode) variable */
  phys: string;
  /** op (logical opcode) variable */
  opVar: string;
  /** threshold (debug protection) */
  thresh: string;

  // Scope object property names
  /** scope.parent */
  sPar: string;
  /** scope.vars */
  sVars: string;
  /** scope.tdzVars */
  sTdz: string;

  // String constant decoder
  /** String decoder function (XOR-decodes encoded constant pool strings). */
  strDec: string;

  // Indexed scope slots
  /** Function slots array (captured vars stored as indexed array). */
  fSlots: string;

  // Rolling cipher runtime names
  /** Rolling cipher state variable. */
  rcState: string;
  /** Rolling cipher derive-key function. */
  rcDeriveKey: string;
  /** Rolling cipher mix function. */
  rcMix: string;
  /** Integrity hash variable (stores computed hash). */
  ihash: string;
  /** Integrity hash function (FNV-1a). */
  ihashFn: string;

  // Watermark — looks like an essential variable
  /** Watermark variable name (_ru4m). */
  wm: string;

  // VM Shielding router
  /** Router function name (used in vmShielding mode). */
  router: string;
}

/** The watermark variable name — always `_ru4m`. */
export const WATERMARK_NAME = "_ru4m";

const ALPHA = "abcdefghijklmnopqrstuvwxyz";
const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";

// Names used as temporaries in generated interpreter case bodies — avoid collisions.
const BLACKLIST = new Set([
  "_a", "_b", "_rv", "_te", "_cuid", "_cu", "_fuid", "_fu", "_uid_",
  "_dbgId", "_last20", "_ho",
]);

/**
 * Generate randomized runtime identifiers from a seed.
 *
 * Each seed produces a unique set of short, minifier-looking names
 * (e.g. `_qx7`, `_a3f`, `_m9`) so that no two builds share the
 * same internal naming.
 */
export function generateRuntimeNames(seed: number): RuntimeNames {
  const used = new Set<string>();
  let s = seed >>> 0;

  function lcg(): number {
    s = (s * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
    return s;
  }

  function genName(): string {
    for (;;) {
      const len = 2 + (lcg() % 2); // 2-3 chars after '_'
      let name = "_" + ALPHA[lcg() % ALPHA.length]!;
      for (let i = 1; i < len; i++) {
        name += ALNUM[lcg() % ALNUM.length]!;
      }
      if (!used.has(name) && !BLACKLIST.has(name)) {
        used.add(name);
        return name;
      }
    }
  }

  return {
    bt: genName(),
    vm: genName(),
    exec: genName(),
    execAsync: genName(),
    load: genName(),
    cache: genName(),
    depth: genName(),
    callStack: genName(),
    fp: genName(),
    rc4: genName(),
    b64: genName(),
    deser: genName(),
    dbg: genName(),
    dbgOp: genName(),
    dbgCfg: genName(),
    dbgProt: genName(),
    stk: genName(),
    stp: genName(),
    sPush: genName(),
    sPop: genName(),
    sPeek: genName(),
    operand: genName(),
    scope: genName(),
    regs: genName(),
    ip: genName(),
    cArr: genName(),
    iArr: genName(),
    exStk: genName(),
    pEx: genName(),
    hPEx: genName(),
    cType: genName(),
    cVal: genName(),
    unit: genName(),
    args: genName(),
    outer: genName(),
    tVal: genName(),
    nTgt: genName(),
    ho: genName(),
    phys: genName(),
    opVar: genName(),
    thresh: genName(),
    sPar: genName(),
    sVars: genName(),
    sTdz: genName(),
    strDec: genName(),
    fSlots: genName(),
    rcState: genName(),
    rcDeriveKey: genName(),
    rcMix: genName(),
    ihash: genName(),
    ihashFn: genName(),
    wm: WATERMARK_NAME,
    router: genName(),
  };
}

/** Fields of {@link RuntimeNames} that are shared across all shielding groups. */
const SHARED_NAME_KEYS = [
  "bt", "cache", "depth", "callStack", "fp", "rc4", "b64", "deser",
  "dbg", "dbgOp", "dbgCfg", "dbgProt", "wm", "router",
] as const;

/**
 * Generate a set of shared names plus unique per-group name sets for
 * VM Shielding mode.
 *
 * Shared names (bytecode table, cache, depth, debug, etc.) are
 * consistent across all groups. Per-group names (interpreter locals,
 * rolling cipher, etc.) are unique per group and collision-free.
 *
 * @param sharedSeed - Seed for shared infrastructure names.
 * @param groupSeeds - One seed per shielding group.
 * @returns An object with the shared names and an array of per-group names.
 */
export function generateShieldedNames(
  sharedSeed: number,
  groupSeeds: number[],
): { shared: RuntimeNames; groups: RuntimeNames[] } {
  // Generate shared names from the shared seed
  const shared = generateRuntimeNames(sharedSeed);

  // Generate per-group names, overriding shared fields for consistency
  const groups: RuntimeNames[] = [];
  // Collect all names already used by shared to prevent collisions
  const globalUsed = new Set<string>();
  for (const key of SHARED_NAME_KEYS) {
    globalUsed.add(shared[key]);
  }

  for (const groupSeed of groupSeeds) {
    let names: RuntimeNames;
    // Retry if a group name collides with shared or another group
    let attempt = 0;
    for (;;) {
      names = generateRuntimeNames((groupSeed ^ groups.length) + attempt);
      attempt++;
      // Override shared fields
      for (const key of SHARED_NAME_KEYS) {
        (names as Record<string, string>)[key] = shared[key];
      }
      // Check for collisions among non-shared names
      const groupNonShared = Object.entries(names)
        .filter(([k]) => !(SHARED_NAME_KEYS as readonly string[]).includes(k))
        .map(([, v]) => v);
      const hasCollision = groupNonShared.some(n => globalUsed.has(n));
      if (!hasCollision) {
        for (const n of groupNonShared) globalUsed.add(n);
        break;
      }
    }
    groups.push(names);
  }

  return { shared, groups };
}
