/**
 * Bytecode scattering engine.
 *
 * Splits encoded bytecode strings into heterogeneous fragments (string
 * literals, char code arrays, packed 32-bit integer arrays) and produces
 * JsNode declarations + a reassembly expression. Eliminates the most
 * obvious VM fingerprint: long encoded strings assigned to an object.
 *
 * @module ruamvm/bytecode-scatter
 */

import type { JsNode } from "./nodes.js";
import { id, lit, bin, varDecl, arr, call, member, index, BOp } from "./nodes.js";
import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";

// --- LCG helper ---

function lcgNext(state: number): number {
	return (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
}

// --- Fragment representation types ---

const enum FragType {
	/** Plain string literal. */
	String = 0,
	/** Array of char codes → String.fromCharCode.apply(null, arr). */
	CharCodes = 1,
	/** Array of packed 32-bit ints → unpack(arr). */
	Packed = 2,
}

const FRAG_TYPE_COUNT = 3;

// --- Core API ---

/** Result of scattering a single bytecode unit. */
export interface ScatterResult {
	/** VarDecl nodes for each fragment. */
	fragments: JsNode[];
	/** Expression node that reassembles fragments back to the original string. */
	reassembly: JsNode;
	/** Whether any packed-int fragments were generated (needs unpack fn). */
	needsUnpack: boolean;
}

/**
 * Split an encoded bytecode string into mixed-type fragments.
 *
 * @param encoded   - The encoded bytecode string to scatter
 * @param seed      - Per-build seed for deterministic LCG choices
 * @param nameGen   - Name generator function (from createScatterNameGen)
 * @param excluded  - Set of names to avoid (currently unused — nameGen handles collisions)
 * @param unpackName - Runtime name of the unpack function
 * @param minFragments - Minimum fragment count (default 2)
 * @param maxFragments - Maximum fragment count (default 6)
 * @returns ScatterResult with fragment declarations and reassembly expression
 */
export function scatterBytecodeUnit(
	encoded: string,
	seed: number,
	nameGen: () => string,
	_excluded: Set<string>,
	unpackName: string,
	minFragments = 2,
	maxFragments = 6
): ScatterResult {
	let state = (seed ^ 0xbcbc1234) >>> 0;

	// Short strings: no split
	if (encoded.length < 8) {
		const name = nameGen();
		return {
			fragments: [varDecl(name, lit(encoded))],
			reassembly: id(name),
			needsUnpack: false,
		};
	}

	// Determine fragment count based on string length + LCG
	state = lcgNext(state);
	const range = maxFragments - minFragments + 1;
	const fragCount = minFragments + ((state >>> 16) % range);

	// Split string into roughly equal parts
	const partLen = Math.ceil(encoded.length / fragCount);
	const parts: string[] = [];
	for (let i = 0; i < fragCount; i++) {
		const start = i * partLen;
		const end = Math.min(start + partLen, encoded.length);
		if (start < encoded.length) {
			parts.push(encoded.slice(start, end));
		}
	}

	// For each part, choose a representation type via LCG
	const fragments: JsNode[] = [];
	const reassemblyParts: JsNode[] = [];
	let needsUnpack = false;

	for (const part of parts) {
		state = lcgNext(state);
		const name = nameGen();

		// Choose type — but only allow packed for parts with length divisible by 4
		// (or we'd need padding which complicates reassembly)
		let fragType = (state >>> 16) % FRAG_TYPE_COUNT;
		if (fragType === FragType.Packed && part.length % 4 !== 0) {
			// Fall back to charCodes
			fragType = FragType.CharCodes;
		}

		switch (fragType as FragType) {
			case FragType.String: {
				fragments.push(varDecl(name, lit(part)));
				reassemblyParts.push(id(name));
				break;
			}
			case FragType.CharCodes: {
				const codes = Array.from(part, (ch) => lit(ch.charCodeAt(0)));
				fragments.push(varDecl(name, arr(...codes)));
				// String.fromCharCode.apply(null, name)
				reassemblyParts.push(
					call(
						member(
							member(id("String"), "fromCharCode"),
							"apply"
						),
						[lit(null), id(name)]
					)
				);
				break;
			}
			case FragType.Packed: {
				const ints: JsNode[] = [];
				for (let j = 0; j < part.length; j += 4) {
					const packed =
						((part.charCodeAt(j) & 0xff) << 24) |
						((part.charCodeAt(j + 1) & 0xff) << 16) |
						((part.charCodeAt(j + 2) & 0xff) << 8) |
						(part.charCodeAt(j + 3) & 0xff);
					ints.push(lit(packed >>> 0));
				}
				fragments.push(varDecl(name, arr(...ints)));
				// unpack(name)
				reassemblyParts.push(call(id(unpackName), [id(name)]));
				needsUnpack = true;
				break;
			}
		}
	}

	// Build reassembly expression: chain of Add
	let reassembly: JsNode = reassemblyParts[0]!;
	for (let i = 1; i < reassemblyParts.length; i++) {
		reassembly = bin(BOp.Add, reassembly, reassemblyParts[i]!);
	}

	return { fragments, reassembly, needsUnpack };
}
