/**
 * Interpreter builder — assembles exec functions from the handler registry.
 *
 * Builds the complete interpreter as a pure AST tree. The switch cases come
 * from the handler registry; the surrounding scaffolding (dispatch loop,
 * exception handling, etc.) is constructed directly as JsNode trees.
 *
 * Tree-based `obfuscateLocals()` from transforms.ts renames case-local
 * variables. No string-based post-processing is needed.
 *
 * @module ruamvm/builders/interpreter
 */

import type { CaseClause } from "../nodes.js";
import type { JsNode } from "../nodes.js";
import type { RuntimeNames, TempNames } from "../../encoding/names.js";
import type { SplitFn } from "../constant-splitting.js";
import {
	caseClause,
	lit,
	switchStmt,
	id,
	breakStmt,
	continueStmt,
	fn,
	varDecl,
	exprStmt,
	ifStmt,
	forStmt,
	whileStmt,
	tryCatch,
	returnStmt,
	throwStmt,
	newExpr,
	bin,
	un,
	assign,
	update,
	call,
	member,
	index,
	obj,
	arr,
	ternary,
	fnExpr,
	seq,
	mapChildren,
} from "../nodes.js";
import { registry, makeHandlerCtx } from "../handlers/index.js";
import {
	VM_MAX_RECURSION_DEPTH,
	LCG_MULTIPLIER,
	LCG_INCREMENT,
	WATERMARK_MAGIC,
} from "../../constants.js";
import { obfuscateLocals } from "../transforms.js";
import { applyMBA } from "../mba.js";
import { fragmentCases } from "../handler-fragmentation.js";

/** Options for interpreter filtering and hardening. */
export interface InterpreterBuildOptions {
	dynamicOpcodes?: boolean;
	decoyOpcodes?: boolean;
	stackEncoding?: boolean;
	usedOpcodes?: Set<number>;
	mixedBooleanArithmetic?: boolean;
	handlerFragmentation?: boolean;
}

/** Result from building interpreter functions. */
export interface InterpreterBuildResult {
	/** Sync and async interpreter function AST nodes. */
	interpreters: JsNode[];
	/** Handler table + key anchor initialization AST (for IIFE scope). */
	handlerTableInit: JsNode[];
	/** Build-time key anchor value (for rolling cipher key derivation). */
	keyAnchorValue: number;
}

/**
 * Build both sync and async interpreter functions as JsNode[].
 *
 * Returns interpreter function AST nodes plus the handler table
 * initialization code (to be placed at IIFE scope). The handler table
 * is shared between sync and async interpreters and is packed as an
 * XOR-encoded array to resist regex extraction.
 *
 * Also computes a "key anchor" — a checksum of the packed handler table
 * data — stored as a closure variable so that rcDeriveKey cannot be
 * extracted via `new Function()`.
 */
export function buildInterpreterFunctions(
	names: RuntimeNames,
	temps: TempNames,
	shuffleMap: number[],
	debug: boolean,
	rollingCipher: boolean,
	seed: number,
	interpOpts: InterpreterBuildOptions = {},
	split?: SplitFn,
	hasAsyncUnits = true
): InterpreterBuildResult {
	// Function table dispatch replaces the switch — disable handler
	// fragmentation since handlers are naturally isolated in separate
	// function expressions (each handler is its own closure).
	const effectiveOpts: InterpreterBuildOptions = {
		...interpOpts,
		handlerFragmentation: false,
	};

	// Build handler table metadata (shared between sync and async interpreters).
	// This produces the packed XOR-encoded handler table, key anchor, and the
	// shuffled handler indices — but NOT the case bodies (those depend on
	// isAsync and must be built per-mode).
	const htMeta = buildHandlerTableMeta(
		names,
		temps,
		shuffleMap,
		seed,
		effectiveOpts,
		split
	);

	// Build sync case clauses (always needed).
	const syncCases = buildCasesForMode(
		names,
		temps,
		shuffleMap,
		seed,
		effectiveOpts,
		false,
		debug,
		htMeta.handlerIndices,
		split
	);

	const syncResult = buildExecFunction(names, temps, syncCases.cases, {
		isAsync: false,
		debug,
		rollingCipher,
		seed,
		interpOpts: effectiveOpts,
		split,
		fragmentLabelMap: syncCases.fragmentLabelMap,
	});

	// Hoist sentinel/return-value declarations to IIFE scope
	// (shared across all exec invocations — avoids per-call allocation)
	const iifeDecls = [...syncResult.iifeDecls];

	// IIFE-scope slot variable declarations for sync handler hoisting.
	// These are the 17 variables that handler closures reference —
	// declared once at IIFE scope, set/restored per exec() call.
	const T = (key: string): string => {
		const name = temps[key];
		if (name === undefined) throw new Error(`Unknown temp: ${key}`);
		return name;
	};
	const slotNames = [
		names.stk,
		names.regs,
		names.ip,
		names.cArr,
		names.operand,
		names.scope,
		names.exStk,
		names.pEx,
		names.hPEx,
		names.cType,
		names.cVal,
		names.unit,
		names.args,
		names.tVal,
		names.nTgt,
		names.ho,
		T("_g"),
	];
	for (const name of slotNames) {
		iifeDecls.push(varDecl(name, un("void", lit(0))));
	}

	// When no async units exist, skip the full async interpreter.
	// Emit a simple alias: var execAsync = exec
	// The closure IIFE code references execAsync by name but never
	// reaches that branch (all unit.s flags are falsy), so the alias
	// is safe dead-code plumbing.
	if (!hasAsyncUnits) {
		const alias = varDecl(names.execAsync, id(names.exec));
		return {
			interpreters: [syncResult.fnNode, alias],
			handlerTableInit: [...htMeta.initNodes, ...iifeDecls],
			keyAnchorValue: htMeta.keyAnchorValue,
		};
	}

	// Async units exist — build the async interpreter with structural
	// differentiation: different group count than sync to avoid the
	// "two identical interpreter" signature.
	const asyncCases = buildCasesForMode(
		names,
		temps,
		shuffleMap,
		seed,
		effectiveOpts,
		true,
		debug,
		htMeta.handlerIndices,
		split
	);

	const asyncResult = buildExecFunction(names, temps, asyncCases.cases, {
		isAsync: true,
		debug,
		rollingCipher,
		seed,
		interpOpts: effectiveOpts,
		split,
		fragmentLabelMap: asyncCases.fragmentLabelMap,
		// Structural differentiation: async uses a different group count
		// so it doesn't look like a carbon copy of the sync interpreter
		asyncGroupOffset: 1,
	});

	// Async iifeDecls are the same sentinel/return-value vars — already declared
	// by sync, so we don't re-emit them (they share the same temp names).

	return {
		interpreters: [syncResult.fnNode, asyncResult.fnNode],
		handlerTableInit: [...htMeta.initNodes, ...iifeDecls],
		keyAnchorValue: htMeta.keyAnchorValue,
	};
}

/** Handler table entry: physical opcode → handler index mapping. */
interface HtEntry {
	physicalOp: number;
	handlerIdx: number;
}

/** Handler table metadata (shared between sync/async interpreters). */
interface HandlerTableMeta {
	/** IIFE-scope initialization AST: packed data array, decode loop, key anchor. */
	initNodes: JsNode[];
	/** Shuffled handler indices (one per included opcode, in iteration order). */
	handlerIndices: number[];
	/** Build-time key anchor value (checksum of packed handler table data). */
	keyAnchorValue: number;
}

/** Result from building case clauses for a specific mode (sync/async). */
interface CaseBuildResult {
	/** Switch case clauses (using handler indices as labels). */
	cases: CaseClause[];
	/** Fragment label map (handler fragmentation) or undefined. */
	fragmentLabelMap?: Map<number, number>;
}

/**
 * Build handler table metadata: shuffle handler indices, pack as XOR-encoded
 * array, compute key anchor, and generate IIFE-scope initialization AST.
 *
 * This is shared between sync and async interpreters — only the handler
 * index mapping and table encoding is needed, not the case bodies.
 */
function buildHandlerTableMeta(
	names: RuntimeNames,
	temps: TempNames,
	shuffleMap: number[],
	seed: number,
	interpOpts: InterpreterBuildOptions,
	split?: SplitFn
): HandlerTableMeta {
	const L = (v: number): JsNode => (split ? split(v) : lit(v));

	// Count how many handlers will be included (real + decoy)
	let includedCount = 0;
	const includedPhysicalOps: number[] = [];
	for (const [op] of registry) {
		if (
			interpOpts.dynamicOpcodes &&
			interpOpts.usedOpcodes &&
			!interpOpts.usedOpcodes.has(op)
		) {
			continue;
		}
		includedPhysicalOps.push(shuffleMap[op]!);
		includedCount++;
	}

	// Count decoy handlers
	let decoyPhysicalOps: number[] = [];
	if (interpOpts.decoyOpcodes && interpOpts.usedOpcodes) {
		decoyPhysicalOps = getDecoyPhysicalOps(
			shuffleMap,
			interpOpts.usedOpcodes
		);
		includedCount += decoyPhysicalOps.length;
	}

	// --- Handler index shuffling ---
	const handlerIndices = Array.from({ length: includedCount }, (_, i) => i);
	let hs = seed >>> 0;
	for (let i = handlerIndices.length - 1; i > 0; i--) {
		hs = (hs * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
		const j = hs % (i + 1);
		[handlerIndices[i]!, handlerIndices[j]!] = [
			handlerIndices[j]!,
			handlerIndices[i]!,
		];
	}

	// --- Collect handler table entries ---
	const allPhysicalOps = [...includedPhysicalOps, ...decoyPhysicalOps];
	const entries: HtEntry[] = [];
	for (let i = 0; i < allPhysicalOps.length; i++) {
		entries.push({
			physicalOp: allPhysicalOps[i]!,
			handlerIdx: handlerIndices[i]!,
		});
	}

	// If handler fragmentation will be applied, we need to compute the
	// fragment label map from a dummy set of cases with the same handler
	// indices and statement counts. Since sync and async handlers produce
	// the same number of statements (await wraps expressions, doesn't add
	// statements), we use sync mode for the fragmentation preview.
	if (interpOpts.handlerFragmentation) {
		const nfName = temps["_nf"];
		if (nfName === undefined) throw new Error("Missing temp: _nf");

		// Build a throwaway set of cases just for fragmentation mapping
		const previewCases = buildCasesForModeInternal(
			names,
			temps,
			shuffleMap,
			seed,
			interpOpts,
			false, // sync mode for preview
			false, // no debug for preview
			handlerIndices
		);

		const fragResult = fragmentCases(previewCases, nfName, seed);

		// Remap handler table entries: handlerIdx → first-fragment ID
		for (const entry of entries) {
			const newIdx = fragResult.labelMap.get(entry.handlerIdx);
			if (newIdx !== undefined) {
				entry.handlerIdx = newIdx;
			}
		}
	}

	// --- Pack handler table as XOR-encoded array ---
	const htName = temps["_ht"];
	if (htName === undefined) throw new Error("Missing temp: _ht");
	const htdName = temps["_htd"];
	if (htdName === undefined) throw new Error("Missing temp: _htd");
	const htkName = temps["_htk"];
	if (htkName === undefined) throw new Error("Missing temp: _htk");
	const htiName = temps["_hti"];
	if (htiName === undefined) throw new Error("Missing temp: _hti");

	// Derive encode key from seed
	const htEncodeKey = Math.imul(seed, 0x45d9f3b) >>> 0;

	// Build encoded data array
	const encodedData: number[] = [];
	let rk = htEncodeKey;
	for (const { physicalOp, handlerIdx } of entries) {
		encodedData.push((physicalOp ^ (rk & 0xffff)) & 0xffff);
		encodedData.push((handlerIdx ^ ((rk >>> 16) & 0xffff)) & 0xffff);
		rk = (Math.imul(rk ^ physicalOp, 0x45d9f3b) ^ handlerIdx) >>> 0;
	}

	// Compute key anchor: FNV-1a checksum of encoded data.
	// Offset basis is FNV_OFFSET_BASIS ^ WATERMARK_MAGIC (steganographic
	// watermark — alters the FNV seed so the watermark is provably present
	// but invisible in the output; no dedicated variable or string).
	const WM_OFFSET = (0x811c9dc5 ^ WATERMARK_MAGIC) >>> 0;
	let anchor = WM_OFFSET;
	for (const v of encodedData) {
		anchor = Math.imul(anchor ^ v, 0x01000193) >>> 0;
	}

	// --- Build IIFE-scope initialization AST ---
	const initNodes: JsNode[] = [];

	// var _htd = [encoded values...];
	initNodes.push(varDecl(htdName, arr(...encodedData.map((v) => lit(v)))));

	// var _ht = [];
	initNodes.push(varDecl(htName, arr()));

	// Decode loop:
	// var _htk = HT_ENCODE_KEY;
	// for(var _hti=0; _hti<_htd.length; _hti+=2) {
	//   var _v = _htd[_hti] ^ (_htk & 0xFFFF);
	//   var _w = _htd[_hti+1] ^ ((_htk >>> 16) & 0xFFFF);
	//   _ht[_v] = _w;
	//   _htk = (Math.imul(_htk ^ _v, 0x45D9F3B) ^ _w) >>> 0;
	// }
	initNodes.push(varDecl(htkName, L(htEncodeKey)));
	initNodes.push(
		forStmt(
			varDecl(htiName, lit(0)),
			bin("<", id(htiName), member(id(htdName), "length")),
			assign(id(htiName), lit(2), "+"),
			(() => {
				const htvName = temps["_htv"];
				const htwName = temps["_htw"];
				if (htvName === undefined || htwName === undefined)
					throw new Error("Missing temps: _htv/_htw");
				return [
					// var htv = _htd[_hti] ^ (_htk & 0xFFFF);
					varDecl(
						htvName,
						bin(
							"^",
							index(id(htdName), id(htiName)),
							bin("&", id(htkName), lit(0xffff))
						)
					),
					// var htw = _htd[_hti+1] ^ ((_htk >>> 16) & 0xFFFF);
					varDecl(
						htwName,
						bin(
							"^",
							index(id(htdName), bin("+", id(htiName), lit(1))),
							bin(
								"&",
								bin(">>>", id(htkName), lit(16)),
								lit(0xffff)
							)
						)
					),
					// _ht[htv] = htw;
					exprStmt(
						assign(index(id(htName), id(htvName)), id(htwName))
					),
					// _htk = (Math.imul(_htk ^ htv, 0x45D9F3B) ^ htw) >>> 0;
					exprStmt(
						assign(
							id(htkName),
							bin(
								">>>",
								bin(
									"^",
									call(id(names.imul), [
										bin("^", id(htkName), id(htvName)),
										L(0x45d9f3b),
									]),
									id(htwName)
								),
								lit(0)
							)
						)
					),
				];
			})()
		)
	);

	// Key anchor: FNV-1a checksum with watermarked offset basis.
	// Uses WM_OFFSET (= FNV_OFFSET_BASIS ^ WATERMARK_MAGIC) instead of
	// the standard FNV offset basis. The watermark is invisible — just
	// a non-standard starting value. Provably present: computing with
	// the standard basis would break all rolling cipher decryption.
	initNodes.push(varDecl(names.keyAnchor, L(WM_OFFSET)));
	initNodes.push(
		forStmt(
			assign(id(htiName), lit(0)),
			bin("<", id(htiName), member(id(htdName), "length")),
			update("++", false, id(htiName)),
			[
				exprStmt(
					assign(
						id(names.keyAnchor),
						bin(
							">>>",
							call(id(names.imul), [
								bin(
									"^",
									id(names.keyAnchor),
									index(id(htdName), id(htiName))
								),
								L(0x01000193),
							]),
							lit(0)
						)
					)
				),
			]
		)
	);

	return { initNodes, handlerIndices, keyAnchorValue: anchor };
}

/**
 * Build case clauses for a specific interpreter mode (sync or async).
 *
 * Uses the pre-computed handler indices from buildHandlerTableMeta so
 * that both modes share the same physical-opcode → handler-index mapping.
 * Some handlers (AWAIT, iterators, closures) produce different AST nodes
 * depending on ctx.isAsync.
 */
function buildCasesForMode(
	names: RuntimeNames,
	temps: TempNames,
	shuffleMap: number[],
	seed: number,
	interpOpts: InterpreterBuildOptions,
	isAsync: boolean,
	debug: boolean,
	handlerIndices: number[],
	split?: SplitFn
): CaseBuildResult {
	let cases = buildCasesForModeInternal(
		names,
		temps,
		shuffleMap,
		seed,
		interpOpts,
		isAsync,
		debug,
		handlerIndices
	);

	// Default case
	cases.push(caseClause(null, [breakStmt()]));

	// --- MBA ---
	if (interpOpts.mixedBooleanArithmetic) {
		cases = cases.map((c) => {
			if (c.label === null) return c;
			return caseClause(c.label, applyMBA(c.body, seed));
		});
	}

	// --- Handler fragmentation ---
	let fragmentLabelMap: Map<number, number> | undefined;
	if (interpOpts.handlerFragmentation) {
		const nfName = temps["_nf"];
		if (nfName === undefined) throw new Error("Missing temp: _nf");

		const fragResult = fragmentCases(cases, nfName, seed);
		cases = fragResult.cases;
		fragmentLabelMap = fragResult.labelMap;
	}

	return { cases, fragmentLabelMap };
}

/**
 * Internal helper: build raw case clauses (without default, MBA, or
 * fragmentation) for a specific isAsync mode.
 */
function buildCasesForModeInternal(
	names: RuntimeNames,
	temps: TempNames,
	shuffleMap: number[],
	seed: number,
	interpOpts: InterpreterBuildOptions,
	isAsync: boolean,
	debug: boolean,
	handlerIndices: number[]
): CaseClause[] {
	const ctx = makeHandlerCtx(names, temps, isAsync, debug);

	// Build raw cases from the handler registry
	const rawCases: CaseClause[] = [];
	for (const [op, handler] of registry) {
		if (
			interpOpts.dynamicOpcodes &&
			interpOpts.usedOpcodes &&
			!interpOpts.usedOpcodes.has(op)
		) {
			continue;
		}
		rawCases.push(caseClause(lit(shuffleMap[op]!), handler(ctx)));
	}

	// Decoy handlers (isAsync-independent — use default ctx)
	if (interpOpts.decoyOpcodes && interpOpts.usedOpcodes) {
		rawCases.push(
			...generateDecoyHandlers(names, shuffleMap, interpOpts.usedOpcodes)
		);
	}

	// Remap to handler indices
	const cases: CaseClause[] = [];
	for (let i = 0; i < rawCases.length; i++) {
		const handlerIdx = handlerIndices[i]!;
		cases.push(caseClause(lit(handlerIdx), rawCases[i]!.body));
	}

	return cases;
}

/**
 * Get physical opcodes for decoy handlers (without building case bodies).
 * Must return the same set in the same order as generateDecoyHandlers.
 */
function getDecoyPhysicalOps(
	shuffleMap: number[],
	usedOpcodes: Set<number>
): number[] {
	// Collect unused logical opcodes
	const unused: number[] = [];
	for (let i = 0; i < shuffleMap.length; i++) {
		if (!usedOpcodes.has(i)) unused.push(i);
	}
	if (unused.length === 0) return [];

	// Select 8-16 decoys (same logic as generateDecoyHandlers)
	const count = Math.min(unused.length, 8 + (shuffleMap[0]! % 9));
	const selected: number[] = [];
	for (let i = 0; i < count; i++) {
		const idx =
			(shuffleMap[i % shuffleMap.length]! + i * 7) % unused.length;
		const op = unused[idx]!;
		if (!selected.includes(op)) selected.push(op);
	}

	return selected.map((logicalOp) => shuffleMap[logicalOp]!);
}

/**
 * Build a single interpreter function (sync or async) as a JsNode.
 *
 * Takes pre-built case clauses (from buildHandlerTableData) and
 * constructs the scaffold as AST with tree-based obfuscateLocals().
 */
function buildExecFunction(
	names: RuntimeNames,
	temps: TempNames,
	cases: CaseClause[],
	opts: {
		isAsync: boolean;
		debug: boolean;
		rollingCipher: boolean;
		seed: number;
		interpOpts: InterpreterBuildOptions;
		split?: SplitFn;
		fragmentLabelMap?: Map<number, number>;
		/** Offset to apply to group count for structural differentiation. */
		asyncGroupOffset?: number;
	}
): { fnNode: JsNode; iifeDecls: JsNode[] } {
	const ctx = makeHandlerCtx(names, temps, opts.isAsync, opts.debug);
	const htName = temps["_ht"];
	if (htName === undefined) throw new Error("Missing temp: _ht");

	// Build function table dispatch — grouped handler function arrays
	// with if-else routing. Replaces the giant switch statement.
	const ftResult = buildFunctionTableDispatch(
		cases,
		temps,
		htName,
		ctx.PH,
		opts.isAsync,
		opts.asyncGroupOffset
	);

	// For sync mode, hoist handler closures to IIFE scope. Async keeps
	// closures per-call because concurrent async calls interleave state.
	const hoistHandlers = !opts.isAsync;

	const fnNode = buildScaffoldAST(
		names,
		temps,
		opts.isAsync,
		opts.debug,
		opts.rollingCipher,
		opts.interpOpts,
		ftResult.dispatchNodes,
		ftResult.preLoopDecls,
		opts.split,
		hoistHandlers
	);

	// Apply tree-based obfuscation of local variable names.
	// Build reserved set from RuntimeNames + TempNames values so
	// genShort() avoids collisions with identifiers in the same scope.
	const reserved = new Set([
		...Object.values(names),
		...Object.values(temps),
	]);
	const [obfuscated] = obfuscateLocals([fnNode], opts.seed, reserved);

	// Also obfuscate handler closures when hoisted to IIFE scope
	// (they contain handler-local variables like `name`, `val`, etc.)
	let iifeDecls = ftResult.iifeDecls;
	if (hoistHandlers && iifeDecls.length > 0) {
		iifeDecls = obfuscateLocals(iifeDecls, opts.seed ^ 0x1234, reserved);
	}

	return { fnNode: obfuscated!, iifeDecls };
}

// --- Scaffolding (AST) ---

/**
 * Build the interpreter function as a complete FnDecl AST node.
 *
 * Constructs the full exec/execAsync function body: function signature,
 * depth tracking, variable declarations, dispatch loop, exception
 * handling, rolling cipher, stack encoding, and debug trace.
 *
 * @param n - Runtime identifier names
 * @param isAsync - Whether to build the async variant
 * @param debug - Whether debug logging is enabled
 * @param rollingCipher - Whether rolling cipher decryption is enabled
 * @param interpOpts - Interpreter build options
 * @param dispatchNodes - The dispatch AST nodes (switch or fragmented for-loop)
 * @param htInit - Handler table initialization statements (dispatch indirection)
 * @param split - Optional constant splitter for numeric obfuscation
 * @returns FnDecl AST node for the complete interpreter function
 */
function buildScaffoldAST(
	n: RuntimeNames,
	temps: TempNames,
	isAsync: boolean,
	debug: boolean,
	rollingCipher: boolean,
	interpOpts: InterpreterBuildOptions,
	dispatchNodes: JsNode[],
	htInit?: JsNode[],
	split?: SplitFn,
	hoistHandlers = false
): JsNode {
	const L = (v: number): JsNode => (split ? split(v) : lit(v));
	const fnName = isAsync ? n.execAsync : n.exec;
	const fnLabel = isAsync ? n.execAsync : n.exec;

	const S = n.stk;
	const O = n.operand,
		SC = n.scope,
		R = n.regs,
		IP = n.ip;
	const C = n.cArr,
		I = n.iArr,
		EX = n.exStk;
	const PE = n.pEx,
		HPE = n.hPEx,
		CT = n.cType,
		CV = n.cVal;
	const U = n.unit,
		A = n.args,
		OS = n.outer;
	const PH = n.phys;
	// Scope property names removed — prototypal scope uses Object.create chain

	/** Temp name lookup shorthand. */
	const T = (key: string): string => {
		const name = temps[key];
		if (name === undefined) throw new Error(`Unknown temp: ${key}`);
		return name;
	};

	// --- Hoisted handler slot variables ---
	// When hoistHandlers is true (sync mode), handler closures live at IIFE
	// scope and reference these variables directly. On each exec call we save
	// the current values to a local array, set new values, and restore in
	// finally. This eliminates ~290 closure allocations per call.
	//
	// The 17 slot variables: S, R, IP, C, O, SC, EX, PE, HPE, CT, CV,
	// U, A, TV, NT, HO, _g. All are referenced by handler code.
	const slotNames = hoistHandlers
		? [
				S,
				R,
				IP,
				C,
				O,
				SC,
				EX,
				PE,
				HPE,
				CT,
				CV,
				U,
				A,
				n.tVal,
				n.nTgt,
				n.ho,
				T("_g"),
		  ]
		: [];

	// When hoisting, use distinct parameter names so they don't shadow
	// the IIFE-scope slot variables. These names (length >= 3, no _ prefix)
	// will be renamed by obfuscateLocals to short 2-char names.
	const paramU = hoistHandlers ? "unitP" : U;
	const paramA = hoistHandlers ? "argsP" : A;
	const paramOS = hoistHandlers ? "osP" : OS;
	const paramTV = hoistHandlers ? "tvP" : n.tVal;
	const paramNT = hoistHandlers ? "ntP" : n.nTgt;
	const paramHO = hoistHandlers ? "hoP" : n.ho;

	// --- Outer body ---
	const outerBody: JsNode[] = [];

	// depth++
	outerBody.push(exprStmt(update("++", false, id(n.depth))));

	// When hoisting, save current IIFE-scope slot values and copy params
	if (hoistHandlers) {
		// var saved = [S, R, IP, C, O, SC, EX, PE, HPE, CT, CV, U, A, TV, NT, HO, _g]
		outerBody.push(
			varDecl("saved", arr(...slotNames.map((name) => id(name))))
		);
		// Copy params to IIFE-scope slots
		outerBody.push(exprStmt(assign(id(U), id(paramU))));
		outerBody.push(exprStmt(assign(id(A), id(paramA))));
		outerBody.push(exprStmt(assign(id(n.tVal), id(paramTV))));
		outerBody.push(exprStmt(assign(id(n.nTgt), id(paramNT))));
		outerBody.push(exprStmt(assign(id(n.ho), id(paramHO))));
	}

	// callStack tracking — only in debug mode (avoids per-call array push/pop)
	if (debug) {
		// var _uid_=(U._dbgId||'?')
		outerBody.push(
			varDecl(T("_uid_"), bin("||", member(id(U), T("_dbgId")), lit("?")))
		);
		// callStack.push(_uid_)
		outerBody.push(
			exprStmt(call(member(id(n.callStack), "push"), [id(T("_uid_"))]))
		);
	}

	// Recursion guard: if(depth>500){depth--;throw new RangeError(...)}
	const guardBody: JsNode[] = [exprStmt(update("--", false, id(n.depth)))];
	if (debug) {
		guardBody.push(exprStmt(call(member(id(n.callStack), "pop"), [])));
	}
	if (hoistHandlers) {
		// Restore slot values before throwing (save array is still in scope)
		for (let i = 0; i < slotNames.length; i++) {
			guardBody.push(
				exprStmt(assign(id(slotNames[i]!), index(id("saved"), lit(i))))
			);
		}
	}
	guardBody.push(
		throwStmt(
			newExpr(id("RangeError"), [
				bin(
					"+",
					bin("+", lit("Maximum call "), lit("s")),
					lit("tack size exceeded")
				),
			])
		)
	);
	outerBody.push(
		ifStmt(bin(">", id(n.depth), lit(VM_MAX_RECURSION_DEPTH)), guardBody)
	);

	// --- Try body (main interpreter logic) ---
	const tryBody: JsNode[] = [];

	// Helper: declare or assign depending on hoisting mode.
	// Slot variables are IIFE-scope when hoisting (assigned, not declared).
	const slotSet = new Set(slotNames);
	const declOrAssign = (name: string, init: JsNode): JsNode =>
		slotSet.has(name)
			? exprStmt(assign(id(name), init))
			: varDecl(name, init);

	// Variable declarations (or assignments for hoisted slots)
	tryBody.push(declOrAssign(S, arr()));
	// Build packed register array (no holes) for V8 fast element access
	tryBody.push(declOrAssign(R, arr()));
	tryBody.push(
		forStmt(
			varDecl("_rl", member(id(U), "r")),
			bin(">", id("_rl"), lit(0)),
			update("--", false, id("_rl")),
			[exprStmt(call(member(id(R), "push"), [un("void", lit(0))]))]
		)
	);
	tryBody.push(declOrAssign(IP, lit(0)));
	tryBody.push(declOrAssign(C, member(id(U), "c")));
	tryBody.push(varDecl(I, member(id(U), "i"))); // I is not a slot (dispatch-only)
	tryBody.push(declOrAssign(EX, lit(null)));
	tryBody.push(declOrAssign(PE, lit(null)));
	tryBody.push(declOrAssign(HPE, lit(false)));
	tryBody.push(declOrAssign(CT, lit(0)));
	tryBody.push(declOrAssign(CV, un("void", lit(0))));
	tryBody.push(
		declOrAssign(
			SC,
			call(member(id("Object"), "create"), [
				hoistHandlers ? id(paramOS) : id(OS),
			])
		)
	);
	// Stack pointer (P) eliminated — stack uses Array.push/pop/length

	// _g = <cachedGlobalRef> — resolved once at IIFE scope
	tryBody.push(declOrAssign(T("_g"), id(n.globalRef)));

	// Optional: debug entry logging
	if (debug) {
		tryBody.push(
			varDecl(T("_uid"), bin("||", member(id(U), T("_dbgId")), lit("?")))
		);
		tryBody.push(
			exprStmt(
				call(id(n.dbg), [
					lit("ENTER"),
					lit(fnLabel),
					bin("+", lit("unit="), id(T("_uid"))),
					bin("+", lit("params="), member(id(U), "p")),
					bin("+", lit("args="), member(id(A), "length")),
					bin(
						"+",
						lit("async="),
						un("!", un("!", member(id(U), "s")))
					),
					bin("+", lit("regs="), member(id(U), "r")),
					bin("+", lit("depth="), id(n.depth)),
				])
			)
		);
	}

	// Optional: rolling cipher init — var rcState=rcDeriveKey(U)
	if (rollingCipher) {
		tryBody.push(varDecl(n.rcState, call(id(n.rcDeriveKey), [id(U)])));
	}

	// Optional: stack encoding proxy
	if (interpOpts.stackEncoding) {
		tryBody.push(...buildStackEncodingProxyAST(n, temps, split));
	}

	// var _il=I.length
	tryBody.push(varDecl(T("_il"), member(id(I), "length")));

	// --- Inner dispatch loop: for(;;){ try{...}catch(e){...} } ---

	// While loop body inside the inner try
	const whileBody: JsNode[] = [];

	// var PH=I[IP]; O=I[IP+1]; IP+=2;
	whileBody.push(varDecl(PH, index(id(I), id(IP))));
	whileBody.push(declOrAssign(O, index(id(I), bin("+", id(IP), lit(1)))));
	whileBody.push(exprStmt(assign(id(IP), lit(2), "+")));

	// Optional: rolling cipher decrypt (inlined rcMix for performance)
	if (rollingCipher) {
		// var _ri=(IP-2)>>>1
		whileBody.push(
			varDecl(T("_ri"), bin(">>>", bin("-", id(IP), lit(2)), lit(1)))
		);
		// Inline rcMix(rcState, _ri, _ri ^ 0x9E3779B9):
		// var _ks = rcState;
		whileBody.push(varDecl(T("_ks"), id(n.rcState)));
		// _ks = imul(_ks ^ _ri, 0x85EBCA6B) >>> 0;
		whileBody.push(
			exprStmt(
				assign(
					id(T("_ks")),
					bin(
						">>>",
						call(id(n.imul), [
							bin("^", id(T("_ks")), id(T("_ri"))),
							L(0x85ebca6b),
						]),
						lit(0)
					)
				)
			)
		);
		// _ks = imul(_ks ^ (_ri ^ 0x9E3779B9), 0xC2B2AE35) >>> 0;
		whileBody.push(
			exprStmt(
				assign(
					id(T("_ks")),
					bin(
						">>>",
						call(id(n.imul), [
							bin(
								"^",
								id(T("_ks")),
								bin("^", id(T("_ri")), L(0x9e3779b9))
							),
							L(0xc2b2ae35),
						]),
						lit(0)
					)
				)
			)
		);
		// _ks ^= _ks >>> 16;
		whileBody.push(
			exprStmt(
				assign(
					id(T("_ks")),
					bin("^", id(T("_ks")), bin(">>>", id(T("_ks")), lit(16)))
				)
			)
		);
		// _ks = _ks >>> 0;
		whileBody.push(
			exprStmt(assign(id(T("_ks")), bin(">>>", id(T("_ks")), lit(0))))
		);
		// PH=(PH^(_ks&0xFFFF))&0xFFFF
		whileBody.push(
			exprStmt(
				assign(
					id(PH),
					bin(
						"&",
						bin("^", id(PH), bin("&", id(T("_ks")), lit(0xffff))),
						lit(0xffff)
					)
				)
			)
		);
		// O=(O^_ks)|0
		whileBody.push(
			exprStmt(
				assign(id(O), bin("|", bin("^", id(O), id(T("_ks"))), lit(0)))
			)
		);
	}

	// Optional: debug trace
	if (debug) {
		whileBody.push(
			exprStmt(call(id(n.dbgOp), [id(PH), id(O), id(C), id(S)]))
		);
	}

	// Dispatch: either a plain switch or fragmented for-loop + switch
	whileBody.push(...dispatchNodes);

	// Inner try body: while(IP<_il){...}; return void 0;
	const innerTryBody: JsNode[] = [
		whileStmt(bin("<", id(IP), id(T("_il"))), whileBody),
		returnStmt(un("void", lit(0))),
	];

	// --- Inner catch handler ---
	const catchBody: JsNode[] = [];

	// Optional: debug exception logging
	if (debug) {
		catchBody.push(
			exprStmt(
				call(id(n.dbg), [
					lit("EXCEPTION"),
					lit("error="),
					ternary(
						bin("&&", id("e"), member(id("e"), "message")),
						member(id("e"), "message"),
						id("e")
					),
					bin(
						"+",
						lit(EX + "="),
						ternary(id(EX), member(id(EX), "length"), lit(0))
					),
				])
			)
		);
	}

	// HPE=false; PE=null; CT=0; CV=void 0;
	catchBody.push(exprStmt(assign(id(HPE), lit(false))));
	catchBody.push(exprStmt(assign(id(PE), lit(null))));
	catchBody.push(exprStmt(assign(id(CT), lit(0))));
	catchBody.push(exprStmt(assign(id(CV), un("void", lit(0)))));

	// if(EX&&EX.length>0){...}
	const exHandlerBody: JsNode[] = [];

	// var _h=EX.pop()
	exHandlerBody.push(varDecl(T("_h"), call(member(id(EX), "pop"), [])));

	// if(_h._ci>=0){ ... catch routing ... }
	const catchRouteBody: JsNode[] = [];
	if (debug) {
		catchRouteBody.push(
			exprStmt(
				call(id(n.dbg), [
					lit("CATCH"),
					bin("+", lit("ip="), member(id(T("_h")), T("_ci"))),
					bin("+", lit("sp="), member(id(T("_h")), T("_sp"))),
				])
			)
		);
	}
	// S.length=_h._sp (restore stack to saved depth)
	catchRouteBody.push(
		exprStmt(assign(member(id(S), "length"), member(id(T("_h")), T("_sp"))))
	);
	// Push error onto stack: S.push(e)
	catchRouteBody.push(exprStmt(call(member(id(S), "push"), [id("e")])));
	// IP=_h._ci*2
	catchRouteBody.push(
		exprStmt(
			assign(id(IP), bin("*", member(id(T("_h")), T("_ci")), lit(2)))
		)
	);
	// continue
	catchRouteBody.push(continueStmt());

	exHandlerBody.push(
		ifStmt(bin(">=", member(id(T("_h")), T("_ci")), lit(0)), catchRouteBody)
	);

	// if(_h._fi>=0){ ... finally routing ... }
	const finallyRouteBody: JsNode[] = [];
	if (debug) {
		finallyRouteBody.push(
			exprStmt(
				call(id(n.dbg), [
					lit("FINALLY"),
					bin("+", lit("ip="), member(id(T("_h")), T("_fi"))),
					bin("+", lit("sp="), member(id(T("_h")), T("_sp"))),
				])
			)
		);
	}
	// S.length=_h._sp (restore stack to saved depth)
	finallyRouteBody.push(
		exprStmt(assign(member(id(S), "length"), member(id(T("_h")), T("_sp"))))
	);
	// PE=e; HPE=true
	finallyRouteBody.push(exprStmt(assign(id(PE), id("e"))));
	finallyRouteBody.push(exprStmt(assign(id(HPE), lit(true))));
	// IP=_h._fi*2
	finallyRouteBody.push(
		exprStmt(
			assign(id(IP), bin("*", member(id(T("_h")), T("_fi")), lit(2)))
		)
	);
	// continue
	finallyRouteBody.push(continueStmt());

	exHandlerBody.push(
		ifStmt(
			bin(">=", member(id(T("_h")), T("_fi")), lit(0)),
			finallyRouteBody
		)
	);

	catchBody.push(
		ifStmt(
			bin("&&", id(EX), bin(">", member(id(EX), "length"), lit(0))),
			exHandlerBody
		)
	);

	// Optional: debug uncaught logging
	if (debug) {
		catchBody.push(
			exprStmt(
				call(id(n.dbg), [
					lit("UNCAUGHT"),
					lit("error="),
					ternary(
						bin("&&", id("e"), member(id("e"), "message")),
						member(id("e"), "message"),
						id("e")
					),
				])
			)
		);
	}

	// throw e
	catchBody.push(throwStmt(id("e")));

	// Inner try-catch wrapped in for(;;)
	const innerTryCatch = tryCatch(innerTryBody, "e", catchBody);
	const foreverLoop = forStmt(null, null, null, [innerTryCatch]);

	// Handler table initialization (dispatch indirection)
	if (htInit) {
		tryBody.push(...htInit);
	}

	tryBody.push(foreverLoop);

	// --- Outer finally ---
	const finallyBody: JsNode[] = [exprStmt(update("--", false, id(n.depth)))];
	if (debug) {
		finallyBody.push(exprStmt(call(member(id(n.callStack), "pop"), [])));
	}
	// Restore saved slot values when hoisting
	if (hoistHandlers) {
		for (let i = 0; i < slotNames.length; i++) {
			finallyBody.push(
				exprStmt(assign(id(slotNames[i]!), index(id("saved"), lit(i))))
			);
		}
	}

	// Outer try-finally wrapping the whole body
	outerBody.push(tryCatch(tryBody, undefined, undefined, finallyBody));

	return fn(
		fnName,
		[paramU, paramA, paramOS, paramTV, paramNT, paramHO],
		outerBody,
		{
			async: isAsync,
		}
	);
}

// --- Decoy handlers ---

/**
 * Generate fake case handlers for unused opcode slots.
 *
 * These are never called but make the interpreter appear more complex,
 * hardening against static analysis. All bodies are pure AST nodes.
 */
function generateDecoyHandlers(
	n: RuntimeNames,
	shuffleMap: number[],
	usedOpcodes: Set<number>
): CaseClause[] {
	const S = n.stk,
		C = n.cArr,
		O = n.operand;
	const R = n.regs,
		SC = n.scope;

	/** S[S.length-1] — peek at top of stack */
	const tos = () => index(id(S), bin("-", member(id(S), "length"), lit(1)));

	// AST decoy body factories — look like real array push/pop/length ops
	const decoyBodyFactories: (() => JsNode[])[] = [
		// var b=S.pop(); S[S.length-1]=S[S.length-1]+b
		() => [
			varDecl("b", call(member(id(S), "pop"), [])),
			exprStmt(assign(tos(), bin("+", tos(), id("b")))),
		],
		// var b=S.pop(); S[S.length-1]=S[S.length-1]-b
		() => [
			varDecl("b", call(member(id(S), "pop"), [])),
			exprStmt(assign(tos(), bin("-", tos(), id("b")))),
		],
		// var b=S.pop(); S[S.length-1]=S[S.length-1]*b
		() => [
			varDecl("b", call(member(id(S), "pop"), [])),
			exprStmt(assign(tos(), bin("*", tos(), id("b")))),
		],
		// S[S.length-1]=~S[S.length-1]
		() => [exprStmt(assign(tos(), un("~", tos())))],
		// S.push(C[O])
		() => [exprStmt(call(member(id(S), "push"), [index(id(C), id(O))]))],
		// R[O]=S.pop()
		() => [
			exprStmt(
				assign(index(id(R), id(O)), call(member(id(S), "pop"), []))
			),
		],
		// S.push(R[O])
		() => [exprStmt(call(member(id(S), "push"), [index(id(R), id(O))]))],
		// var s=SC; if(s&&C[O]in s){s[C[O]]=S.pop();}
		() => [
			varDecl("s", id(SC)),
			ifStmt(
				bin("&&", id("s"), bin("in", index(id(C), id(O)), id("s"))),
				[
					exprStmt(
						assign(
							index(id("s"), index(id(C), id(O))),
							call(member(id(S), "pop"), [])
						)
					),
				]
			),
		],
		// S[S.length-1]=!S[S.length-1]
		() => [exprStmt(assign(tos(), un("!", tos())))],
		// var b=S.pop(); S[S.length-1]=S[S.length-1]&b
		() => [
			varDecl("b", call(member(id(S), "pop"), [])),
			exprStmt(assign(tos(), bin("&", tos(), id("b")))),
		],
		// var b=S.pop(); S[S.length-1]=S[S.length-1]|b
		() => [
			varDecl("b", call(member(id(S), "pop"), [])),
			exprStmt(assign(tos(), bin("|", tos(), id("b")))),
		],
		// S[S.length-1]=-S[S.length-1]
		() => [exprStmt(assign(tos(), un("-", tos())))],
		// S[S.length-1]=+S[S.length-1]+1
		() => [exprStmt(assign(tos(), bin("+", un("+", tos()), lit(1))))],
		// S[S.length-1]=typeof S[S.length-1]
		() => [exprStmt(assign(tos(), un("typeof", tos())))],
		// S.pop()
		() => [exprStmt(call(member(id(S), "pop"), []))],
		// S.push(S[S.length-1])
		() => [exprStmt(call(member(id(S), "push"), [tos()]))],
	];

	// Collect unused logical opcodes
	const unused: number[] = [];
	for (let i = 0; i < shuffleMap.length; i++) {
		if (!usedOpcodes.has(i)) unused.push(i);
	}
	if (unused.length === 0) return [];

	// Select 8-16 decoys (deterministic based on shuffleMap)
	const count = Math.min(unused.length, 8 + (shuffleMap[0]! % 9));
	const selected: number[] = [];
	for (let i = 0; i < count; i++) {
		const idx =
			(shuffleMap[i % shuffleMap.length]! + i * 7) % unused.length;
		const op = unused[idx]!;
		if (!selected.includes(op)) selected.push(op);
	}

	return selected.map((logicalOp, i) => {
		const factory =
			decoyBodyFactories[(logicalOp + i) % decoyBodyFactories.length]!;
		const physicalOp = shuffleMap[logicalOp]!;
		return caseClause(lit(physicalOp), [...factory(), breakStmt()]);
	});
}

// --- Function table dispatch (Sig 3: eliminates switch pattern) ---

/** Maximum number of handler groups for function table dispatch. */
const FT_MAX_GROUPS = 4;

/**
 * Walk a JsNode tree bottom-up, applying a visitor to each node.
 * Skips nested function bodies (FnDecl, FnExpr, ArrowFn) so that
 * break/return transforms only affect the handler scope.
 */
function walkSkipFns(
	node: JsNode,
	visitor: (n: JsNode) => JsNode | null
): JsNode {
	if (
		node.type === "FnDecl" ||
		node.type === "FnExpr" ||
		node.type === "ArrowFn"
	) {
		return node;
	}
	const walked = mapChildren(node, (child) => walkSkipFns(child, visitor));
	return visitor(walked) ?? walked;
}

/**
 * Transform a handler case body for use inside a function table closure.
 *
 * - `BreakStmt` → `ReturnStmt()` (exit handler, continue dispatch loop)
 * - `ReturnStmt(expr)` → `ReturnStmt(seq(assign(_frv, expr), _frs))`
 *   (signal exec to return _frv via the sentinel)
 * - Nested function bodies (FnDecl/FnExpr/ArrowFn) are NOT walked
 *   (their break/return are for their own scope)
 */
function transformBodyForFT(
	body: JsNode[],
	frsName: string,
	frvName: string
): JsNode[] {
	return body.map((node) =>
		walkSkipFns(node, (n) => {
			if (n.type === "BreakStmt") {
				return returnStmt();
			}
			if (n.type === "ReturnStmt") {
				const value =
					(n as { type: "ReturnStmt"; value?: JsNode }).value ??
					un("void", lit(0));
				return returnStmt(seq(assign(id(frvName), value), id(frsName)));
			}
			return null;
		})
	);
}

/**
 * Build function table dispatch — grouped handler function arrays
 * with if-else routing. Replaces the giant switch statement.
 *
 * Each handler body becomes a closure (function expression) that
 * captures interpreter locals (S, R, C, I, IP, etc.). Handlers
 * are split into groups stored as separate arrays, with a balanced
 * if-else tree routing to the correct group by handler index.
 *
 * Return control flow uses a sentinel pattern:
 * - Normal handlers return `undefined` → dispatch loop continues
 * - Return-type handlers do `return (_frv = value, _frs)` → dispatch
 *   loop detects the sentinel and returns `_frv` from exec
 *
 * @param cases - Switch case clauses (handler index labels + bodies)
 * @param temps - Per-build randomized temp name mapping
 * @param htName - Handler table variable name
 * @param phName - Physical opcode variable name
 * @param isAsync - Whether this is the async interpreter (handler functions
 *                  must be async and calls must be awaited)
 * @returns preLoopDecls (goes before while loop) and dispatchNodes
 *          (goes inside while loop body)
 */
function buildFunctionTableDispatch(
	cases: CaseClause[],
	temps: TempNames,
	htName: string,
	phName: string,
	isAsync: boolean,
	groupCountOffset = 0
): { preLoopDecls: JsNode[]; iifeDecls: JsNode[]; dispatchNodes: JsNode[] } {
	const FRS = temps["_frs"];
	const FRV = temps["_frv"];
	const FDI = temps["_fdi"];
	if (!FRS || !FRV || !FDI) {
		throw new Error("Missing function table temp names");
	}

	const groupTempNames = [
		temps["_fg0"],
		temps["_fg1"],
		temps["_fg2"],
		temps["_fg3"],
	];

	// Filter default case, sort by handler index (label value)
	const handlerCases = cases
		.filter((c): c is CaseClause & { label: JsNode } => c.label !== null)
		.sort((a, b) => {
			const aVal = (a.label as { type: "Literal"; value: number }).value;
			const bVal = (b.label as { type: "Literal"; value: number }).value;
			return aVal - bVal;
		});

	// Transform each handler body and wrap in a function expression.
	// Async interpreter handlers must be async functions so that
	// `await` expressions inside handler bodies remain valid.
	const handlerFns: JsNode[] = handlerCases.map((c) => {
		const body = transformBodyForFT(c.body, FRS, FRV);
		return fnExpr(
			undefined,
			[],
			body,
			isAsync ? { async: true } : undefined
		);
	});

	// Determine group count based on total handler count.
	// Sync interpreter uses a single flat array — all call sites are
	// megamorphic regardless, so grouped routing adds overhead without
	// benefiting V8 inline caching. Async interpreter keeps 2-4 groups
	// for structural differentiation (so it doesn't look like the sync).
	const totalHandlers = handlerFns.length;
	let numGroups: number;
	if (isAsync) {
		// Async: grouped for structural differentiation
		const baseGroups = totalHandlers < 80 ? 2 : totalHandlers < 160 ? 3 : 4;
		if (groupCountOffset !== 0) {
			const shifted =
				baseGroups + groupCountOffset <= FT_MAX_GROUPS
					? baseGroups + groupCountOffset
					: baseGroups - groupCountOffset;
			numGroups = Math.max(2, Math.min(FT_MAX_GROUPS, shifted));
		} else {
			numGroups = Math.min(FT_MAX_GROUPS, baseGroups);
		}
	} else {
		// Sync: single flat array — eliminates if-else routing overhead
		numGroups = 1;
	}
	const groupSize = Math.ceil(totalHandlers / numGroups);

	// IIFE-scope declarations: sentinel object (identity-checked via ===)
	// Shared across all exec calls — safe because it's a constant identity marker.
	const iifeDecls: JsNode[] = [varDecl(FRS, obj())];

	// For sync: FRV goes to IIFE scope (handlers reference it and they're hoisted).
	// For async: FRV stays exec-local (interleaving can clobber shared state).
	const preLoopDecls: JsNode[] = [];
	if (isAsync) {
		preLoopDecls.push(varDecl(FRV, un("void", lit(0))));
	} else {
		iifeDecls.push(varDecl(FRV, un("void", lit(0))));
	}

	const activeGroupNames: string[] = [];
	// For sync: handler group arrays go to IIFE scope (closures created once).
	// For async: handler group arrays stay in exec (closures recreated per call
	// because they capture exec-local async state that can interleave).
	const handlerTarget = isAsync ? preLoopDecls : iifeDecls;
	for (let i = 0; i < numGroups; i++) {
		const name = groupTempNames[i];
		if (!name)
			throw new Error(`Missing function table group temp: _fg${i}`);
		activeGroupNames.push(name);
		const start = i * groupSize;
		const end = Math.min(start + groupSize, totalHandlers);
		const group = handlerFns.slice(start, end);
		handlerTarget.push(varDecl(name, arr(...group)));
	}

	// Dispatch nodes (inside while loop body)
	const dispatchNodes: JsNode[] = [];

	// var _fdi = _ht[PH]
	dispatchNodes.push(varDecl(FDI, index(id(htName), id(phName))));

	// Build if-else routing tree with grouped dispatch calls.
	// Each branch: if (_fgN[_fdi - offset]() === _frs) return _frv;
	// For async: if ((await _fgN[_fdi - offset]()) === _frs) return _frv;
	const awaitNode = (expr: JsNode): JsNode =>
		({ type: "AwaitExpr", expr } as JsNode);

	const buildCallCheck = (groupName: string, offset: number): JsNode[] => {
		const indexExpr =
			offset === 0 ? id(FDI) : bin("-", id(FDI), lit(offset));
		const callExpr = call(index(id(groupName), indexExpr), []);
		const result = isAsync ? awaitNode(callExpr) : callExpr;
		return [ifStmt(bin("===", result, id(FRS)), [returnStmt(id(FRV))])];
	};

	if (numGroups === 1) {
		dispatchNodes.push(...buildCallCheck(activeGroupNames[0]!, 0));
	} else {
		// Build if-else chain: route to correct group by handler index
		let current: JsNode[] = buildCallCheck(
			activeGroupNames[numGroups - 1]!,
			(numGroups - 1) * groupSize
		);

		for (let i = numGroups - 2; i >= 0; i--) {
			const threshold = (i + 1) * groupSize;
			const body = buildCallCheck(activeGroupNames[i]!, i * groupSize);
			current = [
				ifStmt(bin("<", id(FDI), lit(threshold)), body, current),
			];
		}

		dispatchNodes.push(...current);
	}

	return { preLoopDecls, iifeDecls, dispatchNodes };
}

// --- Stack encoding proxy (AST) ---

/**
 * Build the Proxy-based stack encoding wrapper as AST nodes.
 *
 * Wraps the raw stack array in a Proxy that XOR-encodes numeric values
 * on set and decodes on get. Transparent to all opcode handlers.
 *
 * @param n - Runtime identifier names
 * @param temps - Temp name mapping
 * @param split - Optional constant splitter for numeric obfuscation
 * @returns Array of JsNode statements to insert into the function body
 */
function buildStackEncodingProxyAST(
	n: RuntimeNames,
	temps: TempNames,
	split?: SplitFn
): JsNode[] {
	const L = (v: number): JsNode => (split ? split(v) : lit(v));
	const S = n.stk;
	const U = n.unit;
	const SEK = temps["_sek"]!;
	const SERAW = temps["_seRaw"]!;

	// var _sek=(U.i.length^U.r^0x5A3C96E1)>>>0
	const sekInit = varDecl(
		SEK,
		bin(
			">>>",
			bin(
				"^",
				bin(
					"^",
					member(member(id(U), "i"), "length"),
					member(id(U), "r")
				),
				L(0x5a3c96e1)
			),
			lit(0)
		)
	);

	// var _seRaw=[]
	const seRawInit = varDecl(SERAW, arr());

	// Helper: (_sek^(i*0x9E3779B9))>>>0
	const xorKey = (iVar: JsNode) =>
		bin(">>>", bin("^", id(SEK), bin("*", iVar, L(0x9e3779b9))), lit(0));

	// set handler function body
	const setBody: JsNode[] = [
		// var i=+k
		varDecl("i", un("+", id("k"))),
		// if(i===i&&i>=0){...}else{_seRaw[k]=v;}
		ifStmt(
			bin("&&", bin("===", id("i"), id("i")), bin(">=", id("i"), lit(0))),
			[
				// var t=typeof v
				varDecl("t", un("typeof", id("v"))),
				// if(t==='number'&&(v|0)===v){_seRaw[i]=[0,v^((_sek^(i*0x9E3779B9))>>>0)];}
				ifStmt(
					bin(
						"&&",
						bin("===", id("t"), lit("number")),
						bin("===", bin("|", id("v"), lit(0)), id("v"))
					),
					[
						exprStmt(
							assign(
								index(id(SERAW), id("i")),
								arr(lit(0), bin("^", id("v"), xorKey(id("i"))))
							)
						),
					],
					[
						// else if(t==='boolean'){_seRaw[i]=[1,v?1:0];}
						ifStmt(
							bin("===", id("t"), lit("boolean")),
							[
								exprStmt(
									assign(
										index(id(SERAW), id("i")),
										arr(
											lit(1),
											ternary(id("v"), lit(1), lit(0))
										)
									)
								),
							],
							[
								// else if(t==='string'){_seRaw[i]=[2,v];}
								ifStmt(
									bin("===", id("t"), lit("string")),
									[
										exprStmt(
											assign(
												index(id(SERAW), id("i")),
												arr(lit(2), id("v"))
											)
										),
									],
									[
										// else{_seRaw[i]=[3,v];}
										exprStmt(
											assign(
												index(id(SERAW), id("i")),
												arr(lit(3), id("v"))
											)
										),
									]
								),
							]
						),
					]
				),
			],
			[
				// else{_seRaw[k]=v;}
				exprStmt(assign(index(id(SERAW), id("k")), id("v"))),
			]
		),
		// return true
		returnStmt(lit(true)),
	];

	// get handler function body
	const getBody: JsNode[] = [
		// var i=+k
		varDecl("i", un("+", id("k"))),
		// if(i===i&&i>=0){...}
		ifStmt(
			bin("&&", bin("===", id("i"), id("i")), bin(">=", id("i"), lit(0))),
			[
				// var e=_seRaw[i]
				varDecl("e", index(id(SERAW), id("i"))),
				// if(!e)return void 0
				ifStmt(un("!", id("e")), [returnStmt(un("void", lit(0)))]),
				// if(e[0]===0)return e[1]^((_sek^(i*0x9E3779B9))>>>0)
				ifStmt(bin("===", index(id("e"), lit(0)), lit(0)), [
					returnStmt(
						bin("^", index(id("e"), lit(1)), xorKey(id("i")))
					),
				]),
				// if(e[0]===1)return !!e[1]
				ifStmt(bin("===", index(id("e"), lit(0)), lit(1)), [
					returnStmt(un("!", un("!", index(id("e"), lit(1))))),
				]),
				// return e[1]
				returnStmt(index(id("e"), lit(1))),
			]
		),
		// if(k==='length')return _seRaw.length
		ifStmt(bin("===", id("k"), lit("length")), [
			returnStmt(member(id(SERAW), "length")),
		]),
		// return _seRaw[k]
		returnStmt(index(id(SERAW), id("k"))),
	];

	// S=new Proxy(_seRaw,{set:function(_,k,v){...},get:function(_,k){...}})
	const proxyAssign = exprStmt(
		assign(
			id(S),
			newExpr(id("Proxy"), [
				id(SERAW),
				obj(
					["set", fnExpr(undefined, ["_", "k", "v"], setBody)],
					["get", fnExpr(undefined, ["_", "k"], getBody)]
				),
			])
		)
	);

	return [sekInit, seRawInit, proxyAssign];
}
