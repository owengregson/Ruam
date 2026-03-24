/**
 * Bytecode scattering engine.
 *
 * Splits encoded bytecode strings into heterogeneous typed fragments:
 * - String literals (blend with other string vars in the runtime)
 * - Packed 32-bit integers (look like handler table data or constants)
 * - Packed integer arrays (look like opcode maps or lookup tables)
 *
 * Fragment declarations are scattered individually among runtime
 * statements. A single compact reassembly expression per unit joins
 * them: `frag1 + D(frag2) + frag3 + D(frag4)` — mixing raw strings
 * with decode calls on numeric fragments.
 *
 * @module ruamvm/bytecode-scatter
 */

import type { JsNode } from "./nodes.js";
import { id, lit, bin, varDecl, arr, call, BOp } from "./nodes.js";
import { deriveSeed, lcgNext } from "../naming/scope.js";

// --- Fragment types ---

/** A typed fragment from the scatter engine. */
export interface ScatterFragment {
	/** Variable name (from NameRegistry dynamic generator). */
	name: string;
	/** AST node for the variable declaration. */
	decl: JsNode;
	/** AST node for the reassembly expression (may involve a decode call). */
	reassemblyExpr: JsNode;
	/** Whether this fragment requires the decode function. */
	needsDecode: boolean;
}

/** Result of scattering a single bytecode unit. */
export interface ScatterResult {
	/** Individual fragment declarations (to be scattered among runtime stmts). */
	fragments: ScatterFragment[];
	/** Single reassembly expression: frag1 + D(frag2) + frag3 + ... */
	reassembly: JsNode;
	/** Whether any fragment requires the decode function. */
	needsDecode: boolean;
}

/**
 * Pack a string chunk into an array of 32-bit unsigned integers.
 * Each int encodes 4 chars (big-endian byte order).
 * Chunk length MUST be divisible by 4.
 */
function packToInts(chunk: string): number[] {
	const ints: number[] = [];
	for (let j = 0; j < chunk.length; j += 4) {
		const packed =
			((chunk.charCodeAt(j) & 0xff) << 24) |
			((chunk.charCodeAt(j + 1) & 0xff) << 16) |
			((chunk.charCodeAt(j + 2) & 0xff) << 8) |
			(chunk.charCodeAt(j + 3) & 0xff);
		ints.push(packed >>> 0);
	}
	return ints;
}

/**
 * Split an encoded bytecode string into heterogeneous typed fragments.
 *
 * @param encoded       - The encoded bytecode string to scatter
 * @param seed          - Per-build seed for deterministic LCG choices
 * @param nameGen       - Name generator (from NameRegistry.createDynamicGenerator)
 * @param decodeName    - Runtime name of the decode function
 * @param minFragments  - Minimum fragment count (default 2)
 * @param maxFragments  - Maximum fragment count (default 6)
 * @returns ScatterResult with typed fragments and reassembly expression
 */
export function scatterBytecodeUnit(
	encoded: string,
	seed: number,
	nameGen: () => string,
	decodeName: string,
	minFragments = 2,
	maxFragments = 6
): ScatterResult {
	let state = deriveSeed(seed, "btScatterFrag");

	// Short strings: no split — single string literal
	if (encoded.length < 8) {
		const name = nameGen();
		return {
			fragments: [
				{
					name,
					decl: varDecl(name, lit(encoded)),
					reassemblyExpr: id(name),
					needsDecode: false,
				},
			],
			reassembly: id(name),
			needsDecode: false,
		};
	}

	// Determine fragment count
	state = lcgNext(state);
	const range = maxFragments - minFragments + 1;
	const fragCount = minFragments + ((state >>> 16) % range);

	// Split into variable-length chunks
	const rawChunks: string[] = [];
	let offset = 0;
	for (let i = 0; i < fragCount && offset < encoded.length; i++) {
		const left = fragCount - i;
		const baseLen = Math.ceil((encoded.length - offset) / left);
		state = lcgNext(state);
		const jitter = ((state >>> 16) % 51) - 25;
		const len = Math.max(
			4,
			Math.min(
				encoded.length - offset,
				baseLen + Math.floor((baseLen * jitter) / 100)
			)
		);
		rawChunks.push(encoded.slice(offset, offset + len));
		offset += len;
	}
	if (offset < encoded.length && rawChunks.length > 0) {
		rawChunks[rawChunks.length - 1] += encoded.slice(offset);
	}

	// Assign types to each chunk
	const fragments: ScatterFragment[] = [];
	let anyNeedsDecode = false;

	for (const chunk of rawChunks) {
		state = lcgNext(state);
		const name = nameGen();

		// Choose fragment type based on LCG and chunk properties
		// Type 0: string literal
		// Type 1: single packed int (exactly 4 chars)
		// Type 2: packed int array (length divisible by 4)
		const typeRoll = (state >>> 16) % 100;
		const canPack = chunk.length % 4 === 0;

		if (canPack && chunk.length === 4 && typeRoll < 30) {
			// Single packed integer — looks like a constant
			const packed = packToInts(chunk)[0]!;
			fragments.push({
				name,
				decl: varDecl(name, lit(packed)),
				reassemblyExpr: call(id(decodeName), [id(name)]),
				needsDecode: true,
			});
			anyNeedsDecode = true;
		} else if (canPack && typeRoll < 55) {
			// Packed integer array — looks like handler/opcode data
			const ints = packToInts(chunk);
			fragments.push({
				name,
				decl: varDecl(name, arr(...ints.map((n) => lit(n)))),
				reassemblyExpr: call(id(decodeName), [id(name)]),
				needsDecode: true,
			});
			anyNeedsDecode = true;
		} else {
			// String literal — looks like any other string var
			fragments.push({
				name,
				decl: varDecl(name, lit(chunk)),
				reassemblyExpr: id(name),
				needsDecode: false,
			});
		}
	}

	// Build reassembly: frag1 + D(frag2) + frag3 + ...
	let reassembly: JsNode = fragments[0]!.reassemblyExpr;
	for (let i = 1; i < fragments.length; i++) {
		reassembly = bin(BOp.Add, reassembly, fragments[i]!.reassemblyExpr);
	}

	return { fragments, reassembly, needsDecode: anyNeedsDecode };
}
