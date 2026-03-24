/**
 * Polymorphic decoder chain generator.
 *
 * Per-build, generates a random chain of 4-8 reversible byte operations
 * for encoding/decoding string constants. The decoder function's AST
 * structure differs every build — different operations, different count,
 * different keys — eliminating universal decoder scripts.
 *
 * Advancement over KrakVm's approach:
 * - Variable-length chains (4-8 ops vs fixed)
 * - Includes bit rotations and nibble swaps (not just byte-level ops)
 * - Decoder is AST-generated (inherits MBA, structural transforms)
 * - Chain key material can be scattered across IIFE scope
 *
 * @module ruamvm/polymorphic-decoder
 */

import type { JsNode } from "./nodes.js";
import {
	BOp,
	UOp,
	id,
	lit,
	bin,
	un,
	call,
	member,
	assign,
	varDecl,
	forStmt,
	exprStmt,
	returnStmt,
	fn,
	arr,
} from "./nodes.js";
import { deriveSeed, lcgNext } from "../naming/scope.js";

// --- Operation types ---

/** A single reversible byte operation in the chain. */
export type DecoderOp =
	| { kind: "xor"; key: number }
	| { kind: "add"; key: number }
	| { kind: "sub"; key: number }
	| { kind: "not" }
	| { kind: "rol"; n: number }
	| { kind: "ror"; n: number }
	| { kind: "swap_nibbles" };

/** A complete decoder chain with all operation parameters. */
export interface DecoderChain {
	/** The ordered sequence of operations (applied forward for encoding). */
	ops: DecoderOp[];
	/** Per-build LCG seed for position-dependent key variation. */
	positionSeed: number;
}

// --- Chain generation ---

/** Number of available operation kinds. */
const OP_KIND_COUNT = 7;
/** Minimum chain length. */
const MIN_CHAIN_LEN = 4;
/** Maximum chain length. */
const MAX_CHAIN_LEN = 8;

/**
 * Generate a random decoder chain from a build seed.
 *
 * @param seed - Per-build CSPRNG seed
 * @returns A decoder chain with 4-8 operations
 */
export function generateDecoderChain(seed: number): DecoderChain {
	let state = deriveSeed(seed, "polyDecChain");

	const nextByte = (): number => {
		state = lcgNext(state);
		return (state >>> 16) & 0xff;
	};
	const nextRange = (min: number, max: number): number => {
		state = lcgNext(state);
		return min + ((state >>> 16) % (max - min + 1));
	};

	const chainLen = nextRange(MIN_CHAIN_LEN, MAX_CHAIN_LEN);
	const ops: DecoderOp[] = [];

	for (let i = 0; i < chainLen; i++) {
		const kind = nextRange(0, OP_KIND_COUNT - 1);
		switch (kind) {
			case 0:
				ops.push({ kind: "xor", key: nextByte() | 1 }); // Ensure non-zero
				break;
			case 1:
				ops.push({ kind: "add", key: nextRange(1, 255) });
				break;
			case 2:
				ops.push({ kind: "sub", key: nextRange(1, 255) });
				break;
			case 3:
				ops.push({ kind: "not" });
				break;
			case 4:
				ops.push({ kind: "rol", n: nextRange(1, 7) });
				break;
			case 5:
				ops.push({ kind: "ror", n: nextRange(1, 7) });
				break;
			case 6:
				ops.push({ kind: "swap_nibbles" });
				break;
		}
	}

	// Position seed for position-dependent key variation
	state = lcgNext(state);
	const positionSeed = state >>> 0;

	return { ops, positionSeed };
}

// --- Build-time encoding ---

/** Apply a single operation forward (encode direction). */
function applyOpForward(byte: number, op: DecoderOp, posKey: number): number {
	switch (op.kind) {
		case "xor":
			return (byte ^ ((op.key + posKey) & 0xff)) & 0xff;
		case "add":
			return (byte + ((op.key + posKey) & 0xff)) & 0xff;
		case "sub":
			return (byte - ((op.key + posKey) & 0xff)) & 0xff;
		case "not":
			return ~byte & 0xff;
		case "rol":
			return ((byte << op.n) | (byte >>> (8 - op.n))) & 0xff;
		case "ror":
			return ((byte >>> op.n) | (byte << (8 - op.n))) & 0xff;
		case "swap_nibbles":
			return ((byte << 4) | (byte >>> 4)) & 0xff;
	}
}

/**
 * Encode a string using the polymorphic chain (build-time).
 *
 * @param str - The string to encode
 * @param chain - The decoder chain
 * @param index - Position index for position-dependent key variation
 * @returns Encoded byte array as number[]
 */
export function polyEncode(
	str: string,
	chain: DecoderChain,
	index: number
): number[] {
	const result: number[] = [];
	for (let i = 0; i < str.length; i++) {
		let byte = str.charCodeAt(i) & 0xff;
		// Position-dependent key: mix index and char position
		const posKey =
			(Math.imul(chain.positionSeed ^ index, 0x45d9f3b) + i) & 0xff;

		// Apply chain forward
		for (const op of chain.ops) {
			byte = applyOpForward(byte, op, posKey);
		}
		result.push(byte);
	}
	return result;
}

/**
 * Encode a string preserving full char codes (for non-ASCII).
 * Uses two-byte encoding: high byte then low byte, each through the chain.
 *
 * @param str - The string to encode (may contain non-ASCII)
 * @param chain - The decoder chain
 * @param index - Position index
 * @returns Encoded byte array as number[]
 */
export function polyEncodeWide(
	str: string,
	chain: DecoderChain,
	index: number
): number[] {
	const result: number[] = [];
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		const hi = (code >>> 8) & 0xff;
		const lo = code & 0xff;
		const posKey =
			(Math.imul(chain.positionSeed ^ index, 0x45d9f3b) + i) & 0xff;

		let bhi = hi;
		let blo = lo;
		for (const op of chain.ops) {
			bhi = applyOpForward(bhi, op, posKey);
			blo = applyOpForward(blo, op, posKey);
		}
		result.push(bhi, blo);
	}
	return result;
}

// --- Runtime AST generation ---

/**
 * Build the AST for the polymorphic decoder function.
 *
 * The generated function decodes a byte array by applying the chain
 * in reverse. Its structure differs every build.
 *
 * @param chain - The decoder chain
 * @param fnName - Runtime name for the function
 * @param posSeedName - Runtime name for the position seed variable
 * @returns AST nodes: [positionSeed var declaration, decoder function declaration]
 */
export function buildDecoderFunctionAST(
	chain: DecoderChain,
	fnName: string,
	posSeedName: string
): JsNode[] {
	const nodes: JsNode[] = [];

	// var _ps = positionSeed
	nodes.push(varDecl(posSeedName, lit(chain.positionSeed)));

	// Build the decoder function body
	// function _sd(data, idx) {
	//   var r = '', i, b, pk;
	//   for (i = 0; i < data.length; i++) {
	//     b = data[i];
	//     pk = (imul(_ps ^ idx, 0x45d9f3b) + i) & 255;
	//     [reverse chain operations on b]
	//     r += String.fromCharCode(b);
	//   }
	//   return r;
	// }
	const d = id("d"); // data param
	const idx = id("x"); // index param
	const r = id("r"); // result string
	const i = id("i"); // loop var
	const b = id("b"); // current byte
	const pk = id("pk"); // position key

	const bodyStmts: JsNode[] = [];
	bodyStmts.push(varDecl("r", lit("")));
	bodyStmts.push(varDecl("i"));
	bodyStmts.push(varDecl("b"));
	bodyStmts.push(varDecl("pk"));

	// Build loop body: reverse the chain
	const loopBody: JsNode[] = [];

	// b = d[i]
	loopBody.push(
		exprStmt(
			assign(
				b,
				call(member(id("Math"), "imul"), [
					bin(BOp.BitXor, id(posSeedName), idx),
					lit(0x45d9f3b),
				])
			)
		)
	);
	// Inline: pk = (imul(_ps ^ idx, 0x45d9f3b) + i) & 255
	loopBody.push(
		exprStmt(
			assign(
				pk,
				bin(
					BOp.BitAnd,
					bin(
						BOp.Add,
						call(member(id("Math"), "imul"), [
							bin(BOp.BitXor, id(posSeedName), idx),
							lit(0x45d9f3b),
						]),
						i
					),
					lit(255)
				)
			)
		)
	);
	// b = d[i]
	// Actually, let me redo this properly
	loopBody.length = 0;

	// b = d[i]
	loopBody.push(
		exprStmt(
			assign(b, {
				type: "IndexExpr",
				obj: d,
				index: i,
			})
		)
	);

	// pk = (imul(_ps ^ idx, 0x45d9f3b) + i) & 255
	loopBody.push(
		exprStmt(
			assign(
				pk,
				bin(
					BOp.BitAnd,
					bin(
						BOp.Add,
						call(member(id("Math"), "imul"), [
							bin(BOp.BitXor, id(posSeedName), idx),
							lit(0x45d9f3b),
						]),
						i
					),
					lit(255)
				)
			)
		)
	);

	// Apply chain in REVERSE (decode direction)
	const reversedOps = [...chain.ops].reverse();
	for (const op of reversedOps) {
		loopBody.push(exprStmt(assign(b, buildReverseOp(op, b, pk))));
	}

	// r += String.fromCharCode(b)
	loopBody.push(
		exprStmt(
			assign(
				r,
				call(member(id("String"), "fromCharCode"), [b]),
				BOp.Add as unknown as undefined // += assignment
			)
		)
	);

	// Wait, assign's third param is AOpKind, not OpKind. Let me fix this.
	// Actually I need to import AOp. Let me fix the last statement.
	loopBody.pop(); // Remove the wrong one
	loopBody.push(
		exprStmt({
			type: "AssignExpr",
			target: r,
			value: call(member(id("String"), "fromCharCode"), [b]),
			op: 0, // AOp.Add = 0
		})
	);

	// for (i = 0; i < d.length; i++)
	const loop = forStmt(
		assign(i, lit(0)),
		bin(BOp.Lt, i, member(d, "length")),
		{
			type: "UpdateExpr",
			op: 0, // UpOp.Inc = 0
			prefix: true,
			arg: i,
		},
		loopBody
	);

	bodyStmts.push(loop);
	bodyStmts.push(returnStmt(r));

	nodes.push(fn(fnName, ["d", "x"], bodyStmts));

	return nodes;
}

/** Build the reverse (decode) AST expression for a single operation. */
function buildReverseOp(op: DecoderOp, b: JsNode, pk: JsNode): JsNode {
	switch (op.kind) {
		case "xor":
			// Reverse of XOR is XOR: b ^ ((key + pk) & 255)
			return bin(
				BOp.BitXor,
				b,
				bin(BOp.BitAnd, bin(BOp.Add, lit(op.key), pk), lit(255))
			);
		case "add":
			// Reverse of ADD is SUB: (b - ((key + pk) & 255)) & 255
			return bin(
				BOp.BitAnd,
				bin(
					BOp.Sub,
					b,
					bin(BOp.BitAnd, bin(BOp.Add, lit(op.key), pk), lit(255))
				),
				lit(255)
			);
		case "sub":
			// Reverse of SUB is ADD: (b + ((key + pk) & 255)) & 255
			return bin(
				BOp.BitAnd,
				bin(
					BOp.Add,
					b,
					bin(BOp.BitAnd, bin(BOp.Add, lit(op.key), pk), lit(255))
				),
				lit(255)
			);
		case "not":
			// Reverse of NOT is NOT: (~b) & 255
			return bin(BOp.BitAnd, un(UOp.BitNot, b), lit(255));
		case "rol":
			// Reverse of ROL(n) is ROR(n): (b >>> n) | (b << (8 - n)) & 255
			return bin(
				BOp.BitAnd,
				bin(
					BOp.BitOr,
					bin(BOp.Ushr, b, lit(op.n)),
					bin(BOp.Shl, b, lit(8 - op.n))
				),
				lit(255)
			);
		case "ror":
			// Reverse of ROR(n) is ROL(n): (b << n) | (b >>> (8 - n)) & 255
			return bin(
				BOp.BitAnd,
				bin(
					BOp.BitOr,
					bin(BOp.Shl, b, lit(op.n)),
					bin(BOp.Ushr, b, lit(8 - op.n))
				),
				lit(255)
			);
		case "swap_nibbles":
			// Reverse of swap nibbles is swap nibbles: ((b << 4) | (b >>> 4)) & 255
			return bin(
				BOp.BitAnd,
				bin(
					BOp.BitOr,
					bin(BOp.Shl, b, lit(4)),
					bin(BOp.Ushr, b, lit(4))
				),
				lit(255)
			);
	}
}

/**
 * Build the AST for the string table and lazy accessor function.
 *
 * Emits:
 * - var _ste = [[encoded bytes], ...]  // encoded table
 * - var _stc = []                       // cache
 * - function _sa(i) { return _stc[i] || (_stc[i] = _sd(_ste[i], i)) }
 *
 * @param encodedTable - Array of encoded byte arrays (one per string)
 * @param tableName - Runtime name for encoded table variable
 * @param cacheName - Runtime name for cache variable
 * @param accessorName - Runtime name for accessor function
 * @param decoderName - Runtime name for decoder function
 * @returns AST nodes for the string table infrastructure
 */
export function buildStringTableAST(
	encodedTable: number[][],
	tableName: string,
	cacheName: string,
	accessorName: string,
	decoderName: string
): JsNode[] {
	const nodes: JsNode[] = [];

	// var _ste = [[bytes], [bytes], ...]
	const tableEntries = encodedTable.map((bytes) =>
		arr(...bytes.map((b) => lit(b)))
	);
	nodes.push(varDecl(tableName, arr(...tableEntries)));

	// var _stc = []
	nodes.push(varDecl(cacheName, arr()));

	// function _sa(i) { return _stc[i] || (_stc[i] = _sd(_ste[i], i)) }
	const i = id("i");
	const cacheAccess = {
		type: "IndexExpr" as const,
		obj: id(cacheName),
		index: i,
	};
	const tableAccess = {
		type: "IndexExpr" as const,
		obj: id(tableName),
		index: i,
	};
	const decodeCall = call(id(decoderName), [tableAccess, i]);
	const cacheStore = assign(cacheAccess, decodeCall);

	nodes.push(
		fn(
			accessorName,
			["i"],
			[returnStmt(bin(BOp.Or, cacheAccess, cacheStore))]
		)
	);

	return nodes;
}
