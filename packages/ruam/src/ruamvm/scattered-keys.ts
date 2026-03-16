/**
 * Scattered key material.
 *
 * Splits key material (alphabet string, handler table data, decoder keys)
 * into multiple fragments scattered across the IIFE scope. Forces attackers
 * to trace the full closure chain to reconstruct any single key.
 *
 * Advancement over KrakVm:
 * - Scatters 3-5 fragments of MULTIPLE key materials (not just 2 alphabet halves)
 * - Fragments spread across statement ordering tiers
 * - Reassembly operations vary per build (concat, spread, push)
 * - Fragment variable names are randomized per build
 *
 * @module ruamvm/scattered-keys
 */

import type { JsNode } from "./nodes.js";
import {
	BOp,
	id,
	lit,
	bin,
	varDecl,
	exprStmt,
	assign,
	call,
	member,
	arr,
} from "./nodes.js";
import { LCG_MULTIPLIER, LCG_INCREMENT } from "../constants.js";

// --- LCG helpers ---

function lcgNext(state: number): number {
	return (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
}

// --- Reassembly strategies ---

/** Strategy for reassembling string fragments. */
const enum StrReassembly {
	/** `a + b + c` */
	Concat = 0,
	/** `[a, b, c].join("")` */
	ArrayJoin = 1,
	/** `"".concat(a, b, c)` */
	StringConcat = 2,
}

/** Strategy for reassembling array fragments. */
const enum ArrReassembly {
	/** `a.concat(b, c)` */
	Concat = 0,
	/** `[...a, ...b, ...c]` */
	Spread = 1,
}

const STR_REASSEMBLY_COUNT = 3;
const ARR_REASSEMBLY_COUNT = 2;

// --- String fragmentation ---

/**
 * Fragment a string literal into 3-5 parts and generate AST.
 *
 * @param value - The string to fragment
 * @param fragNames - Variable names for each fragment
 * @param resultName - Variable name for the reassembled string
 * @param seed - Per-build seed for strategy selection
 * @returns Object with fragment declarations and reassembly declaration
 */
export function fragmentString(
	value: string,
	fragNames: string[],
	resultName: string,
	seed: number
): { fragments: JsNode[]; reassembly: JsNode } {
	let state = (seed ^ 0xbeef1234) >>> 0;

	// Determine number of fragments (3-5)
	state = lcgNext(state);
	const numFrags = 3 + ((state >>> 16) % 3); // 3, 4, or 5

	// Split string into roughly equal parts
	const partLen = Math.ceil(value.length / numFrags);
	const parts: string[] = [];
	for (let i = 0; i < numFrags; i++) {
		const start = i * partLen;
		const end = Math.min(start + partLen, value.length);
		parts.push(value.slice(start, end));
	}

	// Create fragment declarations
	const fragments: JsNode[] = [];
	for (let i = 0; i < parts.length; i++) {
		const name = fragNames[i] ?? fragNames[fragNames.length - 1]!;
		fragments.push(varDecl(name, lit(parts[i]!)));
	}

	// Select reassembly strategy
	state = lcgNext(state);
	const strategy = (state >>> 16) % STR_REASSEMBLY_COUNT;
	const fragIds = parts.map((_, i) => id(fragNames[i] ?? fragNames[fragNames.length - 1]!));

	let reassemblyExpr: JsNode;
	switch (strategy as StrReassembly) {
		case StrReassembly.Concat: {
			// a + b + c
			let expr: JsNode = fragIds[0]!;
			for (let i = 1; i < fragIds.length; i++) {
				expr = bin(BOp.Add, expr, fragIds[i]!);
			}
			reassemblyExpr = expr;
			break;
		}
		case StrReassembly.ArrayJoin: {
			// [a, b, c].join("")
			reassemblyExpr = call(
				member(arr(...fragIds), "join"),
				[lit("")]
			);
			break;
		}
		case StrReassembly.StringConcat: {
			// "".concat(a, b, c)
			reassemblyExpr = call(
				member(lit(""), "concat"),
				fragIds
			);
			break;
		}
		default:
			reassemblyExpr = fragIds[0]!;
	}

	return {
		fragments,
		reassembly: varDecl(resultName, reassemblyExpr),
	};
}

/**
 * Fragment a numeric array literal into 2-4 chunks and generate AST.
 *
 * @param values - The array to fragment
 * @param fragNames - Variable names for each fragment
 * @param resultName - Variable name for the reassembled array
 * @param seed - Per-build seed for strategy selection
 * @returns Object with fragment declarations and reassembly declaration
 */
export function fragmentArray(
	values: number[],
	fragNames: string[],
	resultName: string,
	seed: number
): { fragments: JsNode[]; reassembly: JsNode } {
	let state = (seed ^ 0xdead5678) >>> 0;

	// Determine number of fragments (2-4)
	state = lcgNext(state);
	const numFrags = 2 + ((state >>> 16) % 3); // 2, 3, or 4

	// Split array into roughly equal chunks
	const chunkLen = Math.ceil(values.length / numFrags);
	const chunks: number[][] = [];
	for (let i = 0; i < numFrags; i++) {
		const start = i * chunkLen;
		const end = Math.min(start + chunkLen, values.length);
		chunks.push(values.slice(start, end));
	}

	// Create fragment declarations
	const fragments: JsNode[] = [];
	for (let i = 0; i < chunks.length; i++) {
		const name = fragNames[i] ?? fragNames[fragNames.length - 1]!;
		const elements = chunks[i]!.map((v) => lit(v));
		fragments.push(varDecl(name, arr(...elements)));
	}

	// Select reassembly strategy
	state = lcgNext(state);
	const strategy = (state >>> 16) % ARR_REASSEMBLY_COUNT;
	const fragIds = chunks.map((_, i) => id(fragNames[i] ?? fragNames[fragNames.length - 1]!));

	let reassemblyExpr: JsNode;
	switch (strategy as ArrReassembly) {
		case ArrReassembly.Concat: {
			// a.concat(b, c)
			reassemblyExpr = call(
				member(fragIds[0]!, "concat"),
				fragIds.slice(1)
			);
			break;
		}
		case ArrReassembly.Spread: {
			// [...a, ...b, ...c]
			const spreads = fragIds.map((fid) => ({
				type: "SpreadElement" as const,
				arg: fid,
			}));
			reassemblyExpr = arr(...spreads);
			break;
		}
		default:
			reassemblyExpr = fragIds[0]!;
	}

	return {
		fragments,
		reassembly: varDecl(resultName, reassemblyExpr),
	};
}

/**
 * Result of scattering key material.
 *
 * Contains fragment nodes to be inserted at various tiers
 * and reassembly nodes to be inserted where the original
 * declaration was.
 */
export interface ScatteredResult {
	/** Fragment declarations (to scatter across tiers). */
	tier0Fragments: JsNode[];
	tier1Fragments: JsNode[];
	tier3Fragments: JsNode[];
	tier4Fragments: JsNode[];
	/** Reassembly declarations (insert where original was). */
	reassemblyNodes: JsNode[];
}

/**
 * Scatter multiple key materials across tiers.
 *
 * @param materials - Array of {name, value, type} to scatter
 * @param nameGen - Function to generate unique random names
 * @param seed - Per-build seed
 * @returns Scattered result with fragments assigned to tiers
 */
export function scatterKeyMaterials(
	materials: Array<{
		name: string;
		value: string | number[];
		type: "string" | "array";
	}>,
	nameGen: () => string,
	seed: number
): ScatteredResult {
	const result: ScatteredResult = {
		tier0Fragments: [],
		tier1Fragments: [],
		tier3Fragments: [],
		tier4Fragments: [],
		reassemblyNodes: [],
	};

	let state = (seed ^ 0xcafe9abc) >>> 0;
	const tiers = [
		result.tier0Fragments,
		result.tier1Fragments,
		result.tier3Fragments,
		result.tier4Fragments,
	];

	for (const mat of materials) {
		// Generate fragment names
		const numFrags = mat.type === "string" ? 3 + ((lcgNext(state) >>> 16) % 3) : 2 + ((lcgNext(state) >>> 16) % 3);
		state = lcgNext(state);
		const fragNames: string[] = [];
		for (let i = 0; i < numFrags; i++) {
			fragNames.push(nameGen());
		}

		let scattered: { fragments: JsNode[]; reassembly: JsNode };
		if (mat.type === "string") {
			scattered = fragmentString(
				mat.value as string,
				fragNames,
				mat.name,
				state
			);
		} else {
			scattered = fragmentArray(
				mat.value as number[],
				fragNames,
				mat.name,
				state
			);
		}
		state = lcgNext(state);

		// Distribute fragments across tiers (round-robin with seed variation)
		for (let i = 0; i < scattered.fragments.length; i++) {
			state = lcgNext(state);
			const tierIdx = (state >>> 16) % tiers.length;
			tiers[tierIdx]!.push(scattered.fragments[i]!);
		}

		result.reassemblyNodes.push(scattered.reassembly);
	}

	return result;
}
