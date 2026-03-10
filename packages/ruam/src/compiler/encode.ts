/**
 * Bytecode serialization — JSON and compact binary formats.
 *
 * Two serialization strategies are provided:
 *
 * - **JSON** ({@link serializeUnitToJson}) — human-debuggable, larger output.
 *   Used by default.
 * - **Binary** ({@link encodeBytecodeUnit}) — compact `Uint8Array` format
 *   that can optionally be RC4-encrypted and base64-encoded.
 *
 * @module compiler/encode
 */

import type { BytecodeUnit, ConstantPoolEntry } from "../types.js";
import { computeFingerprint } from "../runtime/fingerprint.js";
import { rc4, b64encode } from "../runtime/decoder.js";
import {
	LCG_MULTIPLIER,
	LCG_INCREMENT,
	GOLDEN_RATIO_PRIME,
	BINARY_TAG_NULL,
	BINARY_TAG_UNDEFINED,
	BINARY_TAG_FALSE,
	BINARY_TAG_TRUE,
	BINARY_TAG_INT8,
	BINARY_TAG_INT16,
	BINARY_TAG_INT32,
	BINARY_TAG_FLOAT64,
	BINARY_TAG_BIGINT,
	BINARY_TAG_REGEX,
	BINARY_TAG_STRING,
} from "../constants.js";
import {
	deriveImplicitKey,
	rollingEncrypt,
} from "../runtime/rolling-cipher.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Options for {@link encodeBytecodeUnit}. */
export interface EncodeOptions {
	/** Logical → physical opcode shuffle map. */
	shuffleMap: number[];
	/** When `true`, RC4-encrypt the binary output. */
	encrypt: boolean;
	/** Apply rolling cipher encryption to the instruction stream. */
	rollingCipher?: boolean;
	/** Integrity hash to fold into the rolling cipher key. */
	integrityHash?: number;
}

/**
 * Serialize a bytecode unit to a compact binary format, optionally encrypted.
 *
 * @returns A base64-encoded string (suitable for embedding in JS source).
 */
export function encodeBytecodeUnit(
	unit: BytecodeUnit,
	options: EncodeOptions
): string {
	const bytes = serializeUnit(
		unit,
		options.shuffleMap,
		options.rollingCipher,
		options.integrityHash
	);
	if (options.encrypt) {
		const key = computeFingerprint().toString(16);
		const encrypted = rc4(bytes, key);
		return b64encode(encrypted);
	}
	return b64encode(bytes);
}

/**
 * XOR-encode a string's char codes using an LCG key stream.
 *
 * Each string gets a unique key stream derived from the master key and
 * the constant pool index, so identical strings at different positions
 * produce different encodings.
 */
export function encodeStringChars(
	str: string,
	key: number,
	index: number
): number[] {
	const encoded: number[] = [];
	let k = (key ^ (index * GOLDEN_RATIO_PRIME)) >>> 0;
	for (let i = 0; i < str.length; i++) {
		k = (k * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
		encoded.push(str.charCodeAt(i) ^ (k & 0xffff));
	}
	return encoded;
}

/** Options controlling JSON serialization behavior. */
export interface JsonSerializeOptions {
	/** Logical → physical opcode shuffle map. */
	shuffleMap: number[];
	/** XOR string encoding key (omit to leave strings as plaintext). */
	stringKey?: number;
	/** Apply rolling cipher encryption to the instruction stream. */
	rollingCipher?: boolean;
	/** Integrity hash to fold into the rolling cipher key. */
	integrityHash?: number;
}

/**
 * Serialize a bytecode unit to a JSON string.
 *
 * The output uses short property names (`c`, `i`, `r`, `p`, …) to reduce
 * size.  Special constant types (regex, bigint) are encoded as tagged objects
 * that the runtime decoder can recognise.
 *
 * When `stringKey` is provided, string constants are XOR-encoded and
 * stored as number arrays instead of plaintext strings.
 */
export function serializeUnitToJson(
	unit: BytecodeUnit,
	opts: JsonSerializeOptions
): string;
export function serializeUnitToJson(
	unit: BytecodeUnit,
	shuffleMap: number[],
	stringKey?: number
): string;
export function serializeUnitToJson(
	unit: BytecodeUnit,
	optsOrMap: JsonSerializeOptions | number[],
	stringKeyLegacy?: number
): string {
	// Normalise overloaded arguments
	let shuffleMap: number[];
	let stringKey: number | undefined;
	let rollingCipher = false;
	let integrityHash: number | undefined;

	if (Array.isArray(optsOrMap)) {
		shuffleMap = optsOrMap;
		stringKey = stringKeyLegacy;
	} else {
		shuffleMap = optsOrMap.shuffleMap;
		stringKey = optsOrMap.stringKey;
		rollingCipher = optsOrMap.rollingCipher ?? false;
		integrityHash = optsOrMap.integrityHash;
	}

	// When rolling cipher is on, use the implicit key for string encoding
	// so no plaintext seed appears in the output.
	// Must match what rcDeriveKey() produces at runtime.
	let effectiveStringKey = stringKey;
	if (rollingCipher && stringKey !== undefined) {
		let k = deriveImplicitKey(
			unit.instructions.length,
			unit.registerCount,
			unit.paramCount,
			unit.constants.length
		);
		if (integrityHash !== undefined) {
			k = (k ^ integrityHash) >>> 0;
		}
		effectiveStringKey = k;
	}

	const constants: unknown[] = unit.constants.map((c, idx) => {
		if (c.type === "regex") {
			const v = c.value as { pattern: string; flags: string };
			return { __regex__: true, p: v.pattern, f: v.flags };
		}
		if (c.type === "bigint")
			return { __bigint__: true, v: String(c.value) };
		if (c.type === "string" && effectiveStringKey !== undefined) {
			return encodeStringChars(
				c.value as string,
				effectiveStringKey,
				idx
			);
		}
		return c.value;
	});

	const instrs: number[] = [];
	for (const instr of unit.instructions) {
		instrs.push(shuffleMap[instr.opcode]!);
		instrs.push(instr.operand);
	}

	// Apply rolling cipher if enabled (must happen after shuffle but before serialization)
	if (rollingCipher) {
		const masterKey = deriveImplicitKey(
			unit.instructions.length,
			unit.registerCount,
			unit.paramCount,
			unit.constants.length
		);
		rollingEncrypt(instrs, masterKey, integrityHash);
	}

	return JSON.stringify({
		c: constants,
		i: instrs,
		r: unit.registerCount,
		sl: unit.slotCount || 0,
		p: unit.paramCount,
		g: unit.isGenerator,
		s: unit.isAsync,
		st: unit.isStrict,
		a: unit.isArrow || false,
	});
}

// ---------------------------------------------------------------------------
// Binary serialization internals
// ---------------------------------------------------------------------------

/** Serialize a bytecode unit into a compact `Uint8Array`. */
function serializeUnit(
	unit: BytecodeUnit,
	shuffleMap: number[],
	applyRollingCipher: boolean = false,
	integrityHash?: number
): Uint8Array {
	const buf = new ArrayBuffer(estimateSize(unit));
	const view = new DataView(buf);
	let offset = 0;

	function writeU8(v: number) {
		view.setUint8(offset, v);
		offset += 1;
	}
	function writeU16(v: number) {
		view.setUint16(offset, v, true);
		offset += 2;
	}
	function writeU32(v: number) {
		view.setUint32(offset, v, true);
		offset += 4;
	}
	function writeI32(v: number) {
		view.setInt32(offset, v, true);
		offset += 4;
	}
	function writeF64(v: number) {
		view.setFloat64(offset, v, true);
		offset += 8;
	}
	function writeStr(s: string) {
		const bytes = new TextEncoder().encode(s);
		writeU32(bytes.length);
		for (let i = 0; i < bytes.length; i++) writeU8(bytes[i]!);
	}

	// Header
	const flags =
		(unit.isGenerator ? 1 : 0) |
		(unit.isAsync ? 2 : 0) |
		(unit.isStrict ? 4 : 0) |
		(unit.isArrow ? 8 : 0);

	writeU8(1); // format version
	writeU16(flags);
	writeU16(unit.paramCount);
	writeU16(unit.registerCount);

	// Constants
	writeU32(unit.constants.length);
	for (const c of unit.constants) {
		writeConstant(c, writeU8, writeI32, writeF64, writeStr);
	}

	// Build flat instruction array with shuffled opcodes
	const flatInstrs: number[] = [];
	for (const instr of unit.instructions) {
		flatInstrs.push(shuffleMap[instr.opcode]!);
		flatInstrs.push(instr.operand);
	}

	// Apply rolling cipher encryption if enabled (must happen after shuffle)
	if (applyRollingCipher) {
		const masterKey = deriveImplicitKey(
			unit.instructions.length,
			unit.registerCount,
			unit.paramCount,
			unit.constants.length
		);
		rollingEncrypt(flatInstrs, masterKey, integrityHash);
	}

	// Write instructions to binary buffer
	writeU32(unit.instructions.length);
	for (let i = 0; i < flatInstrs.length; i += 2) {
		writeU16(flatInstrs[i]!);
		writeI32(flatInstrs[i + 1]!);
	}

	// Jump table
	writeU32(Object.keys(unit.jumpTable).length);
	for (const [ip, target] of Object.entries(unit.jumpTable)) {
		writeU32(Number(ip));
		writeU32(target);
	}

	// Exception table
	writeU32(unit.exceptionTable.length);
	for (const entry of unit.exceptionTable) {
		writeU32(entry.startIp);
		writeU32(entry.endIp);
		writeI32(entry.catchIp);
		writeI32(entry.finallyIp);
	}

	// Function name constant index
	writeI32(unit.nameConstIndex);

	return new Uint8Array(buf, 0, offset);
}

/** Write a single constant pool entry to the binary buffer. */
function writeConstant(
	c: ConstantPoolEntry,
	writeU8: (v: number) => void,
	writeI32: (v: number) => void,
	writeF64: (v: number) => void,
	writeStr: (s: string) => void
): void {
	switch (c.type) {
		case "null":
			writeU8(BINARY_TAG_NULL);
			break;
		case "undefined":
			writeU8(BINARY_TAG_UNDEFINED);
			break;
		case "boolean":
			writeU8(c.value ? BINARY_TAG_TRUE : BINARY_TAG_FALSE);
			break;
		case "number": {
			const n = c.value as number;
			if (Number.isInteger(n)) {
				if (n >= -128 && n <= 127) {
					writeU8(BINARY_TAG_INT8);
					writeU8(n & 0xff);
				} else if (n >= -32768 && n <= 32767) {
					writeU8(BINARY_TAG_INT16);
					writeU8(n & 0xff);
					writeU8((n >> 8) & 0xff);
				} else if (n >= -2147483648 && n <= 2147483647) {
					writeU8(BINARY_TAG_INT32);
					writeI32(n);
				} else {
					writeU8(BINARY_TAG_FLOAT64);
					writeF64(n);
				}
			} else {
				writeU8(BINARY_TAG_FLOAT64);
				writeF64(n);
			}
			break;
		}
		case "string":
			writeU8(BINARY_TAG_STRING);
			writeStr(c.value as string);
			break;
		case "bigint":
			writeU8(BINARY_TAG_BIGINT);
			writeStr(String(c.value));
			break;
		case "regex": {
			const v = c.value as { pattern: string; flags: string };
			writeU8(BINARY_TAG_REGEX);
			writeStr(v.pattern);
			writeStr(v.flags);
			break;
		}
	}
}

/**
 * Conservatively estimate the byte size of a serialized unit.
 * Over-allocates to avoid reallocation.
 */
function estimateSize(unit: BytecodeUnit): number {
	let size = 1 + 2 + 2 + 2; // header
	size += 4; // constant count
	for (const c of unit.constants) {
		size += 1; // type tag
		if (c.type === "string") size += 4 + (c.value as string).length * 3;
		else if (c.type === "number") size += 8;
		else if (c.type === "bigint") size += 4 + String(c.value).length * 3;
		else if (c.type === "regex") {
			const v = c.value as { pattern: string; flags: string };
			size += 8 + v.pattern.length * 3 + v.flags.length * 3;
		} else {
			size += 8;
		}
	}
	size += 4 + unit.instructions.length * 6; // instructions
	size += 4 + Object.keys(unit.jumpTable).length * 8; // jump table
	size += 4 + unit.exceptionTable.length * 16; // exception table
	size += 4; // name const index
	return size + 1024; // safety margin
}
