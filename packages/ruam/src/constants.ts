/**
 * Shared constants for parser configuration, well-known identifiers, and magic values.
 * @module constants
 */

// --- Babel Parser Plugins ---

/** Plugins enabled when parsing input source code with `@babel/parser`. */
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

// --- Global Identifiers ---

/**
 * Well-known global identifiers that must never be renamed by the preprocessor.
 * Shared between the preprocessor and any future lint/diagnostic tooling.
 */
export const GLOBAL_IDENTIFIERS = new Set([
	// Language primitives
	"undefined",
	"null",
	"true",
	"false",
	"NaN",
	"Infinity",

	// Built-in constructors & namespaces
	"Object",
	"Array",
	"String",
	"Number",
	"Boolean",
	"Symbol",
	"BigInt",
	"Function",
	"RegExp",
	"Date",
	"Error",
	"TypeError",
	"RangeError",
	"SyntaxError",
	"ReferenceError",
	"URIError",
	"EvalError",
	"Map",
	"Set",
	"WeakMap",
	"WeakSet",
	"Promise",
	"Proxy",
	"Reflect",
	"JSON",
	"Math",

	// Global functions
	"parseInt",
	"parseFloat",
	"isNaN",
	"isFinite",
	"encodeURI",
	"encodeURIComponent",
	"decodeURI",
	"decodeURIComponent",
	"eval",
	"atob",
	"btoa",

	// Timers
	"setTimeout",
	"setInterval",
	"clearTimeout",
	"clearInterval",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"queueMicrotask",

	// Node.js globals
	"require",
	"module",
	"exports",
	"__dirname",
	"__filename",
	"process",
	"Buffer",

	// Browser globals
	"console",
	"window",
	"document",
	"globalThis",
	"global",
	"self",
	"alert",
	"confirm",
	"prompt",
	"fetch",
	"navigator",
	"location",
	"history",
	"localStorage",
	"sessionStorage",
	"indexedDB",
	"structuredClone",
	"crypto",
	"performance",

	// Typed arrays & binary
	"Uint8Array",
	"Uint16Array",
	"Uint32Array",
	"Int8Array",
	"Int16Array",
	"Int32Array",
	"Float32Array",
	"Float64Array",
	"ArrayBuffer",
	"DataView",
	"SharedArrayBuffer",
	"Atomics",

	// Text / URL / Fetch API
	"TextEncoder",
	"TextDecoder",
	"URL",
	"URLSearchParams",
	"Headers",
	"Request",
	"Response",
	"AbortController",
	"AbortSignal",
	"Blob",
	"File",
	"FileReader",
	"FormData",

	// DOM
	"Event",
	"CustomEvent",
	"EventTarget",
	"HTMLElement",
	"Node",
	"NodeList",
	"Element",
	"DocumentFragment",
	"MutationObserver",
	"IntersectionObserver",
	"ResizeObserver",

	// Network
	"XMLHttpRequest",
	"WebSocket",

	// Workers
	"Worker",
	"ServiceWorker",
	"MessageChannel",
	"MessagePort",

	// Extension APIs
	"chrome",
	"browser",

	// Special keywords / pseudo-identifiers
	"arguments",
	"this",
	"super",
	"new",

	// Generators & async
	"Iterator",
	"Generator",
	"GeneratorFunction",
	"AsyncFunction",
	"AsyncGeneratorFunction",
	"AsyncGenerator",

	// WeakRef / FinalizationRegistry
	"WeakRef",
	"FinalizationRegistry",
] as const);

// (Unit ID generation constants removed — IDs are now randomized via LCG)

// --- VM Execution Limits ---

/** Maximum nested VM call depth before throwing a RangeError. */
export const VM_MAX_RECURSION_DEPTH = 500;

// --- Opcode Shuffle Map Constants ---

/** LCG multiplier for opcode shuffle (Numerical Recipes). */
export const LCG_MULTIPLIER = 1664525;
/** LCG increment for opcode shuffle (Numerical Recipes). */
export const LCG_INCREMENT = 1013904223;

// --- Hash and Mixing Constants ---

/** FNV-1a offset basis (32-bit). */
export const FNV_OFFSET_BASIS = 0x811c9dc5;

/** FNV-1a prime (32-bit). */
export const FNV_PRIME = 0x01000193;

/** Golden ratio hash constant (`2^32 / phi`). */
export const GOLDEN_RATIO_PRIME = 0x9e3779b9;

/** Murmur3 mixing prime 1. */
export const MIX_PRIME1 = 0x85ebca6b;

/** Murmur3 mixing prime 2. */
export const MIX_PRIME2 = 0xc2b2ae35;

/** Murmur3 avalanche constant. */
export const AVALANCHE_CONSTANT = 0x45d9f3b;

/**
 * Steganographic watermark magic value — FNV-1a hash of "ruam".
 *
 * XOR-folded into the key anchor during handler table initialization.
 * Invisible in output (no dedicated variable or string), but provably
 * present: removing this step from the key anchor computation breaks
 * all rolling cipher instruction decryption.
 */
export const WATERMARK_MAGIC = 0x2812af9a;

// --- Observation Resistance Corruption Fallbacks ---
// Used when a deriveSeed-based corruption constant happens to be 0.
// Each observation resistance mechanism has its own fallback to avoid
// accidental zero-XOR (which would be a no-op, negating the corruption).

/** Fallback corruption constant for function identity binding. */
export const OR_CORRUPT_IDENTITY = 0xdeadbeef;
/** Fallback corruption constant for monotonic witness counter. */
export const OR_CORRUPT_WITNESS = 0xbaadf00d;
/** Fallback corruption constant for WeakMap canary. */
export const OR_CORRUPT_CANARY = 0xcafebabe;
/** Fallback corruption constant for stack integrity probe. */
export const OR_CORRUPT_PROBE = 0xfeedface;

// --- Binary Format Type Tags ---
// Shared between encode.ts (build-time) and deserializer.ts (runtime).

export const BINARY_TAG_NULL = 0;
export const BINARY_TAG_UNDEFINED = 1;
export const BINARY_TAG_FALSE = 2;
export const BINARY_TAG_TRUE = 3;
export const BINARY_TAG_INT8 = 4;
export const BINARY_TAG_INT16 = 5;
export const BINARY_TAG_INT32 = 6;
export const BINARY_TAG_FLOAT64 = 7;
export const BINARY_TAG_BIGINT = 8;
export const BINARY_TAG_REGEX = 9;
export const BINARY_TAG_STRING = 10;
export const BINARY_TAG_ENCODED_STRING = 11;
