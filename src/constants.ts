/**
 * Shared constants used across the Ruam VM obfuscator.
 *
 * Centralizes magic values, parser configuration, and well-known identifier
 * lists so they can be maintained in a single place.
 */

// ---------------------------------------------------------------------------
// Babel parser plugins applied when parsing input source code.
// ---------------------------------------------------------------------------

export const BABEL_PARSER_PLUGINS = [
  "typescript",
  "jsx",
  "classProperties",
  "optionalChaining",
  "nullishCoalescingOperator",
  "dynamicImport",
  "asyncGenerators",
  "objectRestSpread",
] as const;

// ---------------------------------------------------------------------------
// Well-known global identifiers that should never be renamed by the
// identifier preprocessor.  Kept here so both the preprocessor and any
// future lint/diagnostic tooling can share a single source of truth.
// ---------------------------------------------------------------------------

export const GLOBAL_IDENTIFIERS = new Set([
  // Language primitives
  "undefined", "null", "true", "false", "NaN", "Infinity",

  // Built-in constructors & namespaces
  "Object", "Array", "String", "Number", "Boolean", "Symbol", "BigInt",
  "Function", "RegExp", "Date", "Error", "TypeError", "RangeError",
  "SyntaxError", "ReferenceError", "URIError", "EvalError",
  "Map", "Set", "WeakMap", "WeakSet", "Promise", "Proxy", "Reflect",
  "JSON", "Math",

  // Global functions
  "parseInt", "parseFloat", "isNaN", "isFinite",
  "encodeURI", "encodeURIComponent", "decodeURI", "decodeURIComponent",
  "eval", "atob", "btoa",

  // Timers
  "setTimeout", "setInterval", "clearTimeout", "clearInterval",
  "requestAnimationFrame", "cancelAnimationFrame", "queueMicrotask",

  // Node.js globals
  "require", "module", "exports", "__dirname", "__filename",
  "process", "Buffer",

  // Browser globals
  "console", "window", "document", "globalThis", "global", "self",
  "alert", "confirm", "prompt", "fetch",
  "navigator", "location", "history",
  "localStorage", "sessionStorage", "indexedDB",
  "structuredClone", "crypto", "performance",

  // Typed arrays & binary
  "Uint8Array", "Uint16Array", "Uint32Array",
  "Int8Array", "Int16Array", "Int32Array",
  "Float32Array", "Float64Array",
  "ArrayBuffer", "DataView", "SharedArrayBuffer", "Atomics",

  // Text / URL / Fetch API
  "TextEncoder", "TextDecoder", "URL", "URLSearchParams",
  "Headers", "Request", "Response", "AbortController", "AbortSignal",
  "Blob", "File", "FileReader", "FormData",

  // DOM
  "Event", "CustomEvent", "EventTarget", "HTMLElement",
  "Node", "NodeList", "Element", "DocumentFragment",
  "MutationObserver", "IntersectionObserver", "ResizeObserver",

  // Network
  "XMLHttpRequest", "WebSocket",

  // Workers
  "Worker", "ServiceWorker", "MessageChannel", "MessagePort",

  // Extension APIs
  "chrome", "browser",

  // Special keywords / pseudo-identifiers
  "arguments", "this", "super", "new",

  // Generators & async
  "Iterator", "Generator", "GeneratorFunction",
  "AsyncFunction", "AsyncGeneratorFunction", "AsyncGenerator",

  // WeakRef / FinalizationRegistry
  "WeakRef", "FinalizationRegistry",
] as const);

// ---------------------------------------------------------------------------
// VM runtime internal names.
//
// Runtime identifiers are randomized per build via
// `generateRuntimeNames()` in `runtime/names.ts`.
// ---------------------------------------------------------------------------

export const VM_WATERMARK_NAME = "_ru4m";

// ---------------------------------------------------------------------------
// Bytecode unit ID generation.
// ---------------------------------------------------------------------------

/** Prefix used for all bytecode unit IDs. */
export const UNIT_ID_PREFIX = "u_";

/** Number of hex digits used to pad the unit counter. */
export const UNIT_ID_PAD_LENGTH = 4;

// ---------------------------------------------------------------------------
// VM execution limits.
// ---------------------------------------------------------------------------

/** Maximum nested VM call depth before throwing a RangeError. */
export const VM_MAX_RECURSION_DEPTH = 500;

// ---------------------------------------------------------------------------
// Opcode shuffle map constants.
// ---------------------------------------------------------------------------

/**
 * Linear Congruential Generator (LCG) constants used for opcode shuffle.
 * These are the classic Numerical Recipes values.
 */
export const LCG_MULTIPLIER = 1664525;
export const LCG_INCREMENT = 1013904223;
