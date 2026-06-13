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
import type { RuntimeNames, TempNames } from "../../naming/compat-types.js";
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
	BOp,
	UOp,
	UpOp,
	AOp,
} from "../nodes.js";
import { registry, makeHandlerCtx } from "../handlers/index.js";
import {
	VM_MAX_RECURSION_DEPTH,
	LCG_MULTIPLIER,
	LCG_INCREMENT,
	WATERMARK_MAGIC,
} from "../../constants.js";
import { deriveSeed } from "../../naming/scope.js";
import type { NameRegistry } from "../../naming/registry.js";
import { obfuscateLocals } from "../transforms.js";
import { applyMBA } from "../mba.js";
import { fragmentCases } from "../handler-fragmentation.js";
import { aliasHandlerBody } from "../handler-aliasing.js";
import {
	generateOpaquePredicate,
	injectOpaquePredicate,
} from "../opaque-predicates.js";
import type { StructuralChoices } from "../../structural-choices.js";
import {
	buildWitnessCounter,
	buildWeakMapCanary,
	buildStackProbe,
} from "../observation-resistance.js";

/** Options for interpreter filtering and hardening. */
export interface InterpreterBuildOptions {
	dynamicOpcodes?: boolean;
	decoyOpcodes?: boolean;
	stackEncoding?: boolean;
	usedOpcodes?: Set<number>;
	mixedBooleanArithmetic?: boolean;
	handlerFragmentation?: boolean;
	opcodeMutation?: boolean;
	incrementalCipher?: boolean;
	semanticOpacity?: boolean;
	observationResistance?: boolean;
	/** Tuning: probability (0-100) of witness check per handler. */
	witnessCheckProbability?: number;
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
	hasAsyncUnits = true,
	structuralChoices?: StructuralChoices,
	registry?: NameRegistry
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
		structuralChoices,
		registry,
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
	// Stack-encoding key slot — declared at IIFE scope so hoisted sync handlers
	// (which reference `_sek` via stkDec/stkEnc) can see it; set per exec call.
	if (effectiveOpts.stackEncoding) {
		slotNames.push(T("_sek"));
	}
	for (const name of slotNames) {
		iifeDecls.push(varDecl(name, un(UOp.Void, lit(0))));
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
		structuralChoices,
		registry,
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

	// When opcode mutation is active, the MUTATE handler swaps _ht entries
	// at runtime.  Sparse holes (positions with no handler) become undefined,
	// and swapping undefined into a valid position corrupts dispatch — the
	// exec loop's try/catch catches the resulting TypeError but continues
	// the for(;;) loop, hanging forever.  Fix: pad _ht with dummy entries
	// for every physical opcode not already included, mapping them to
	// handler index 0.  The decode loop then produces a fully dense array.
	if (interpOpts.opcodeMutation) {
		const includedSet = new Set(allPhysicalOps);
		for (let p = 0; p < shuffleMap.length; p++) {
			if (!includedSet.has(p)) {
				entries.push({ physicalOp: p, handlerIdx: 0 });
			}
		}
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
			bin(BOp.Lt, id(htiName), member(id(htdName), "length")),
			assign(id(htiName), lit(2), AOp.Add),
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
							BOp.BitXor,
							index(id(htdName), id(htiName)),
							bin(BOp.BitAnd, id(htkName), lit(0xffff))
						)
					),
					// var htw = _htd[_hti+1] ^ ((_htk >>> 16) & 0xFFFF);
					varDecl(
						htwName,
						bin(
							BOp.BitXor,
							index(
								id(htdName),
								bin(BOp.Add, id(htiName), lit(1))
							),
							bin(
								BOp.BitAnd,
								bin(BOp.Ushr, id(htkName), lit(16)),
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
								BOp.Ushr,
								bin(
									BOp.BitXor,
									call(id(names.imul), [
										bin(
											BOp.BitXor,
											id(htkName),
											id(htvName)
										),
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
			bin(BOp.Lt, id(htiName), member(id(htdName), "length")),
			update(UpOp.Inc, false, id(htiName)),
			[
				exprStmt(
					assign(
						id(names.keyAnchor),
						bin(
							BOp.Ushr,
							call(id(names.imul), [
								bin(
									BOp.BitXor,
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

	// --- Observation resistance: witness counter + stack probes ---
	// Prepend witness counter increments to every handler body and
	// append verification checks + stack probes to a random subset.
	// Runs before aliasing/MBA/fragmentation so the injected code
	// gets further transformed by those passes.
	if (interpOpts.observationResistance) {
		const witnessResult = buildWitnessCounter(names, temps, seed, split);
		const probeResult = buildStackProbe(
			names,
			temps,
			seed,
			split,
			interpOpts.stackEncoding
		);

		// PRNG for witness check selection
		let witnessSeed = deriveSeed(seed, "witnessCheck") >>> 0;
		const witnessLcg = (): number => {
			witnessSeed =
				(Math.imul(witnessSeed, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
			return witnessSeed;
		};

		// PRNG for stack probe selection
		let probeSeed = deriveSeed(seed, "stackProbe") >>> 0;
		const probeLcg = (): number => {
			probeSeed =
				(Math.imul(probeSeed, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
			return probeSeed;
		};

		cases = cases.map((c) => {
			if (c.label === null) return c;
			const body = [...c.body];
			// Prepend witness counter increment to every handler
			body.unshift(witnessResult.incrementStmt());
			// Witness verification check (probability from tuning)
			if (
				witnessLcg() % 100 <
				(interpOpts.witnessCheckProbability ?? 25)
			) {
				body.push(...witnessResult.verifyStmts());
			}
			// Stack integrity probe (~5% of handlers)
			if (probeLcg() % 100 < 5) {
				body.push(...probeResult.probeStmts());
			}
			return caseClause(c.label, body);
		});
	}

	// --- Handler aliasing ---
	// Apply structural transforms to a subset of handler bodies so that
	// different builds produce structurally different code for the same opcode.
	// Must run before MBA and fragmentation (those further transform the aliased bodies).
	if (interpOpts.semanticOpacity) {
		let aliasSeed = deriveSeed(seed, "aliasSelect");
		cases = cases.map((c, idx) => {
			if (c.label === null) return c;
			// Each handler gets a deterministic coin flip
			aliasSeed =
				(Math.imul(aliasSeed, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
			// Handler aliasing (~40% of handlers)
			if (aliasSeed % 100 < 40) {
				return caseClause(c.label, aliasHandlerBody(c.body, seed, idx));
			}
			return c;
		});
	}

	// --- Opaque predicate injection ---
	// Wrap eligible handler bodies behind always-true/always-false predicates
	// so the real code is hidden in one branch and dead code in the other.
	// Must run after aliasing (so aliased bodies get wrapped) but before MBA
	// and fragmentation (those further transform the wrapped bodies).
	if (interpOpts.semanticOpacity) {
		let predSeed = deriveSeed(seed, "opaquePredSelect");
		cases = cases.map((c, idx) => {
			if (c.label === null) return c;
			// Only inject into handlers with 3+ statements (small handlers
			// aren't worth obfuscating — the predicate would dominate)
			if (c.body.length < 3) return c;
			// Opaque predicate injection (~50% of eligible handlers)
			predSeed =
				(Math.imul(predSeed, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
			if (predSeed % 100 >= 50) return c;

			// Use the instruction pointer (always an integer) as the
			// predicate input — bitwise OR with 0 ensures int32 semantics
			const inputExpr = bin(BOp.BitOr, id(names.ip), lit(0));
			const predicate = generateOpaquePredicate(
				inputExpr,
				deriveSeed(seed, "opaquePred_" + idx),
				idx
			);

			// Dead code for the never-taken branch: a few harmless
			// statements that look plausible but never execute.
			// Use a deterministic pick of dead code patterns.
			const deadSeed =
				(Math.imul(predSeed, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
			const deadBody = generateDeadBody(deadSeed);

			return caseClause(
				c.label,
				injectOpaquePredicate(c.body, deadBody, predicate)
			);
		});
	}

	// Default case
	cases.push(caseClause(null, [breakStmt()]));

	// --- MBA ---
	if (interpOpts.mixedBooleanArithmetic) {
		cases = cases.map((c, idx) => {
			if (c.label === null) return c;
			// When semanticOpacity is on, derive a distinct seed per handler so
			// that the same logical operation (e.g. XOR) looks structurally
			// different across handlers — per-handler variant selection.
			const mbaSeed = interpOpts.semanticOpacity
				? deriveSeed(seed, "mbaVariant_" + idx)
				: seed;
			return caseClause(c.label, applyMBA(c.body, mbaSeed));
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
	const ctx = makeHandlerCtx(
		names,
		temps,
		isAsync,
		debug,
		interpOpts.stackEncoding
	);

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
		structuralChoices?: StructuralChoices;
		/** NameRegistry for collision-safe obfuscateLocals renaming. */
		registry?: NameRegistry;
	}
): { fnNode: JsNode; iifeDecls: JsNode[] } {
	const ctx = makeHandlerCtx(
		names,
		temps,
		opts.isAsync,
		opts.debug,
		opts.interpOpts.stackEncoding
	);
	const htName = temps["_ht"];
	if (htName === undefined) throw new Error("Missing temp: _ht");

	// Select dispatch style based on structural choices (default: function-table)
	const dispatchStyle =
		opts.structuralChoices?.dispatchStyle ?? "function-table";
	const returnMech = opts.structuralChoices?.returnMechanism ?? "sentinel";
	const returnTag = opts.structuralChoices?.returnTag ?? 1;

	// --- Decode-once execution cache (Phase 1) ---
	// When enabled, the unit's instruction stream is materialized once into a
	// per-unit Int32Array of [resolved handler index, decrypted operand], cached
	// on the unit. The steady-state dispatch loop then reads it directly — no
	// per-instruction `_ht` indirection and (under rolling cipher) no
	// per-iteration re-decryption. Gated OFF for the features whose threat model
	// is runtime-memory instruction secrecy / tamper response (caching would
	// defeat them). At-rest bytecode security is fully preserved (the serialized
	// string and key derivation are untouched); this trades only runtime-memory
	// instruction secrecy, consistent with the already-cached plaintext pool U.c.
	// Gated to rolling-cipher builds: that is where the cache is a decisive win
	// (it amortizes the per-instruction keystream derivation the slow path repeats
	// every loop iteration). Without rolling cipher the operand stream is already
	// plaintext, so caching would only duplicate memory for a marginal saving.
	const io = opts.interpOpts;
	const decodeCache =
		opts.rollingCipher &&
		!io.incrementalCipher &&
		!io.opcodeMutation &&
		!io.observationResistance;

	let ftResult: {
		preLoopDecls: JsNode[];
		iifeDecls: JsNode[];
		dispatchNodes: JsNode[];
	};

	if (dispatchStyle === "direct-array") {
		ftResult = buildDirectArrayDispatch(
			cases,
			temps,
			htName,
			ctx.PH as string,
			opts.isAsync,
			returnMech,
			returnTag,
			decodeCache
		);
	} else if (dispatchStyle === "object-lookup") {
		ftResult = buildObjectLookupDispatch(
			cases,
			temps,
			htName,
			ctx.PH as string,
			opts.isAsync,
			returnMech,
			returnTag,
			decodeCache
		);
	} else {
		// "function-table" — the original grouped dispatch
		ftResult = buildFunctionTableDispatch(
			cases,
			temps,
			htName,
			ctx.PH as string,
			opts.isAsync,
			opts.asyncGroupOffset,
			decodeCache
		);
	}

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
		hoistHandlers,
		opts.seed,
		decodeCache
	);

	// Apply tree-based obfuscation of local variable names.
	// Build reserved set from RuntimeNames + TempNames values so
	// genShort() avoids collisions with identifiers in the same scope.
	const reserved = new Set([
		...Object.values(names),
		...Object.values(temps),
	]);
	const [obfuscated] = obfuscateLocals(
		[fnNode],
		opts.seed,
		reserved,
		opts.registry
	);

	// Also obfuscate handler closures when hoisted to IIFE scope
	// (they contain handler-local variables like `name`, `val`, etc.)
	let iifeDecls = ftResult.iifeDecls;
	if (hoistHandlers && iifeDecls.length > 0) {
		iifeDecls = obfuscateLocals(
			iifeDecls,
			deriveSeed(opts.seed, "iifeLocals"),
			reserved,
			opts.registry
		);
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
	hoistHandlers = false,
	seed = 0,
	decodeCache = false
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
	// The stack-encoding key `_sek` is a slot too (hoisted handlers read it).
	if (hoistHandlers && interpOpts.stackEncoding) {
		slotNames.push(T("_sek"));
	}

	// --- Per-unit minimal save/restore partition ---
	// The per-call slot snapshot/restore is the dominant overhead under deep
	// recursion. Most units touch only a subset of slots, so two groups are
	// saved/restored only when the unit actually uses them (flags packed on U
	// at compile time — see compiler/slot-analysis.ts):
	//   • EXC group {PE,HPE,CT,CV} — gated on `U.xh` (exception machinery).
	//   • TC  group {TV,NT,HO}     — gated on `U.tc` (this/super/new.target/closure).
	// Everything else (incl. EX, which RETURN reads on every return, and A,
	// read by ordinary param loads) is CORE — always saved. The snapshot uses
	// scalar locals (not a per-call array) to avoid an allocation each call.
	const EXC_SET = new Set([PE, HPE, CT, CV]);
	const TC_SET = new Set([n.tVal, n.nTgt, n.ho]);
	const coreSlots = slotNames.filter(
		(s) => !EXC_SET.has(s) && !TC_SET.has(s)
	);
	const excSlots = slotNames.filter((s) => EXC_SET.has(s));
	const tcSlots = slotNames.filter((s) => TC_SET.has(s));
	// Snapshot-local name per slot (renamed to a short name by obfuscateLocals).
	const snapName = new Map<string, string>();
	slotNames.forEach((s, i) => snapName.set(s, "vmSnap" + i));
	const snap = (s: string): JsNode => id(snapName.get(s)!);
	// Runtime flag locals (read once from U). `unitP` is the unit param.
	const fXh = "vmUsesXh";
	const fTc = "vmUsesTc";
	/** Partitioned slot restore (used by the recursion guard + the outer finally). */
	const buildSlotRestore = (): JsNode[] => {
		const out: JsNode[] = coreSlots.map((s) =>
			exprStmt(assign(id(s), snap(s)))
		);
		if (excSlots.length > 0) {
			out.push(
				ifStmt(
					id(fXh),
					excSlots.map((s) => exprStmt(assign(id(s), snap(s))))
				)
			);
		}
		if (tcSlots.length > 0) {
			out.push(
				ifStmt(
					id(fTc),
					tcSlots.map((s) => exprStmt(assign(id(s), snap(s))))
				)
			);
		}
		return out;
	};

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
	outerBody.push(exprStmt(update(UpOp.Inc, false, id(n.depth))));

	// When hoisting, snapshot current IIFE-scope slot values and copy params.
	if (hoistHandlers) {
		// Read the per-unit slot-usage flags once (packed on U at compile time).
		outerBody.push(varDecl(fXh, member(id(paramU), "xh")));
		outerBody.push(varDecl(fTc, member(id(paramU), "tc")));
		// CORE snapshot — scalar locals (no per-call array allocation).
		for (const s of coreSlots) {
			outerBody.push(varDecl(snapName.get(s)!, id(s)));
		}
		// EXC + TC snapshot vars are declared unconditionally (so the finally
		// restore can reference them) but only assigned when the unit uses them.
		for (const s of [...excSlots, ...tcSlots]) {
			outerBody.push(varDecl(snapName.get(s)!));
		}
		if (excSlots.length > 0) {
			outerBody.push(
				ifStmt(
					id(fXh),
					excSlots.map((s) =>
						exprStmt(assign(id(snapName.get(s)!), id(s)))
					)
				)
			);
		}
		if (tcSlots.length > 0) {
			outerBody.push(
				ifStmt(
					id(fTc),
					tcSlots.map((s) =>
						exprStmt(assign(id(snapName.get(s)!), id(s)))
					)
				)
			);
		}
		// Copy params to IIFE-scope slots. U/A are CORE (always). The
		// this-context params are copied only when the unit reads them.
		outerBody.push(exprStmt(assign(id(U), id(paramU))));
		outerBody.push(exprStmt(assign(id(A), id(paramA))));
		if (tcSlots.length > 0) {
			outerBody.push(
				ifStmt(id(fTc), [
					exprStmt(assign(id(n.tVal), id(paramTV))),
					exprStmt(assign(id(n.nTgt), id(paramNT))),
					exprStmt(assign(id(n.ho), id(paramHO))),
				])
			);
		}
	}

	// callStack tracking — only in debug mode (avoids per-call array push/pop)
	if (debug) {
		// var _uid_=(U._dbgId||'?')
		outerBody.push(
			varDecl(
				T("_uid_"),
				bin(BOp.Or, member(id(U), T("_dbgId")), lit("?"))
			)
		);
		// callStack.push(_uid_)
		outerBody.push(
			exprStmt(call(member(id(n.callStack), "push"), [id(T("_uid_"))]))
		);
	}

	// Recursion guard: if(depth>500){depth--;throw new RangeError(...)}
	const guardBody: JsNode[] = [
		exprStmt(update(UpOp.Dec, false, id(n.depth))),
	];
	if (debug) {
		guardBody.push(exprStmt(call(member(id(n.callStack), "pop"), [])));
	}
	if (hoistHandlers) {
		// Restore snapshot values before throwing (snapshot locals still in scope)
		guardBody.push(...buildSlotRestore());
	}
	guardBody.push(
		throwStmt(
			newExpr(id("RangeError"), [
				bin(
					BOp.Add,
					bin(BOp.Add, lit("Maximum call "), lit("s")),
					lit("tack size exceeded")
				),
			])
		)
	);
	outerBody.push(
		ifStmt(bin(BOp.Gt, id(n.depth), lit(VM_MAX_RECURSION_DEPTH)), guardBody)
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
			bin(BOp.Gt, id("_rl"), lit(0)),
			update(UpOp.Dec, false, id("_rl")),
			[exprStmt(call(member(id(R), "push"), [un(UOp.Void, lit(0))]))]
		)
	);
	tryBody.push(declOrAssign(IP, lit(0)));
	tryBody.push(declOrAssign(C, member(id(U), "c")));
	// I is not a slot (dispatch-only). With the decode-once cache, I instead
	// points at the materialized stream (built below, after rcState init).
	if (!decodeCache) {
		tryBody.push(varDecl(I, member(id(U), "i")));
	}
	tryBody.push(declOrAssign(EX, lit(null)));
	if (hoistHandlers) {
		// PE/HPE/CT/CV are touched only by exception units; initialize them
		// (and save/restore them) only when `U.xh` is set. A non-exception unit
		// never reads or writes them, so the caller's values pass through
		// untouched and need no snapshot.
		tryBody.push(
			ifStmt(id(fXh), [
				exprStmt(assign(id(PE), lit(null))),
				exprStmt(assign(id(HPE), lit(false))),
				exprStmt(assign(id(CT), lit(0))),
				exprStmt(assign(id(CV), un(UOp.Void, lit(0)))),
			])
		);
	} else {
		tryBody.push(declOrAssign(PE, lit(null)));
		tryBody.push(declOrAssign(HPE, lit(false)));
		tryBody.push(declOrAssign(CT, lit(0)));
		tryBody.push(declOrAssign(CV, un(UOp.Void, lit(0))));
	}
	// Scope-object elision: units whose compiled body never mutates, reassigns,
	// or captures their scope (`U.el`) can reuse the outer scope directly,
	// avoiding a per-call `Object.create` allocation + a prototype-chain hop.
	// A missing/false flag falls back to the always-correct `Object.create`.
	const osRef = (): JsNode => (hoistHandlers ? id(paramOS) : id(OS));
	tryBody.push(
		declOrAssign(
			SC,
			ternary(
				member(id(U), "el"),
				osRef(),
				call(member(id("Object"), "create"), [osRef()])
			)
		)
	);
	// Stack pointer (P) eliminated — stack uses Array.push/pop/length

	// _g = <cachedGlobalRef> — resolved once at IIFE scope
	tryBody.push(declOrAssign(T("_g"), id(n.globalRef)));

	// Optional: debug entry logging
	if (debug) {
		tryBody.push(
			varDecl(
				T("_uid"),
				bin(BOp.Or, member(id(U), T("_dbgId")), lit("?"))
			)
		);
		tryBody.push(
			exprStmt(
				call(id(n.dbg), [
					lit("ENTER"),
					lit(fnLabel),
					bin(BOp.Add, lit("unit="), id(T("_uid"))),
					bin(BOp.Add, lit("params="), member(id(U), "p")),
					bin(BOp.Add, lit("args="), member(id(A), "length")),
					bin(
						BOp.Add,
						lit("async="),
						un(UOp.Not, un(UOp.Not, member(id(U), "s")))
					),
					bin(BOp.Add, lit("regs="), member(id(U), "r")),
					bin(BOp.Add, lit("depth="), id(n.depth)),
				])
			)
		);
	}

	// Optional: rolling cipher init. rcDeriveKey(U) is a pure function of the
	// unit's constant metadata (folded with the closure key anchor), so it is
	// invariant across every exec() of a given unit — memoize it on U.k to avoid
	// recomputing the FNV derivation per call (a hot cost under recursion). Only
	// the per-exec LOCAL rcState is ever poisoned (observation resistance); the
	// memoized U.k stays the clean master key, so tamper response is unaffected.
	if (rollingCipher) {
		tryBody.push(
			varDecl(
				n.rcState,
				ternary(
					bin(BOp.Sneq, member(id(U), "k"), un(UOp.Void, lit(0))),
					member(id(U), "k"),
					assign(member(id(U), "k"), call(id(n.rcDeriveKey), [id(U)]))
				)
			)
		);
	}

	// Optional: incremental cipher init
	// var _icState = icBlockKey(rcState, 0)  — start in block 0
	if (interpOpts.incrementalCipher && rollingCipher) {
		tryBody.push(
			varDecl(
				T("_icState"),
				call(id(n.icBlockKey), [id(n.rcState), lit(0)])
			)
		);
	}

	// Optional: stack encoding — bind the per-exec key to the `_sek` slot (it is
	// a save/restored IIFE-scope slot so hoisted handler closures can see it; the
	// stkEnc/stkDec helpers are defined once at IIFE scope; the stack stays plain).
	if (interpOpts.stackEncoding) {
		tryBody.push(
			declOrAssign(T("_sek"), buildStackEncodingKeyExpr(n, split))
		);
	}

	// --- Decode-once execution cache (Phase 1) ---
	// Materialize, once per unit, an Int32Array holding [resolved handler index,
	// decrypted operand] for every instruction, cached on U.d. The keystream is a
	// pure function of instruction index (position-keyed), so a single forward
	// pass yields the correct plaintext for EVERY position regardless of how the
	// loop later reaches it (sequential, jump, or exception route). I then points
	// at the cache; the dispatch loop reads handler index + operand directly.
	if (decodeCache) {
		const HT = T("_ht");
		const DI = "d"; // unit-object property holding the decoded stream
		const SRC = "mvSrc",
			LEN = "mvLen",
			ARR = "mvArr",
			POS = "mvPos",
			IDX = "mvIdx",
			KS = "mvKs";

		// Per-instruction body: resolve handler index + decode operand.
		const loopBody: JsNode[] = [];
		if (rollingCipher) {
			// var mvIdx = mvPos >>> 1;  (instruction index = keystream position)
			loopBody.push(varDecl(IDX, bin(BOp.Ushr, id(POS), lit(1))));
			// Inline rcMix(rcState, mvIdx, mvIdx ^ GOLDEN): byte-identical to the
			// per-instruction decrypt the slow path performs.
			loopBody.push(varDecl(KS, id(n.rcState)));
			loopBody.push(
				exprStmt(
					assign(
						id(KS),
						bin(
							BOp.Ushr,
							call(id(n.imul), [
								bin(BOp.BitXor, id(KS), id(IDX)),
								L(0x85ebca6b),
							]),
							lit(0)
						)
					)
				)
			);
			loopBody.push(
				exprStmt(
					assign(
						id(KS),
						bin(
							BOp.Ushr,
							call(id(n.imul), [
								bin(
									BOp.BitXor,
									id(KS),
									bin(BOp.BitXor, id(IDX), L(0x9e3779b9))
								),
								L(0xc2b2ae35),
							]),
							lit(0)
						)
					)
				)
			);
			loopBody.push(
				exprStmt(
					assign(
						id(KS),
						bin(BOp.BitXor, id(KS), bin(BOp.Ushr, id(KS), lit(16)))
					)
				)
			);
			loopBody.push(
				exprStmt(assign(id(KS), bin(BOp.Ushr, id(KS), lit(0))))
			);
			// mvArr[mvPos] = _ht[ (mvSrc[mvPos] ^ (mvKs & 0xFFFF)) & 0xFFFF ];
			loopBody.push(
				exprStmt(
					assign(
						index(id(ARR), id(POS)),
						index(
							id(HT),
							bin(
								BOp.BitAnd,
								bin(
									BOp.BitXor,
									index(id(SRC), id(POS)),
									bin(BOp.BitAnd, id(KS), lit(0xffff))
								),
								lit(0xffff)
							)
						)
					)
				)
			);
			// mvArr[mvPos+1] = (mvSrc[mvPos+1] ^ mvKs) | 0;
			loopBody.push(
				exprStmt(
					assign(
						index(id(ARR), bin(BOp.Add, id(POS), lit(1))),
						bin(
							BOp.BitOr,
							bin(
								BOp.BitXor,
								index(id(SRC), bin(BOp.Add, id(POS), lit(1))),
								id(KS)
							),
							lit(0)
						)
					)
				)
			);
		} else {
			// Light variant (no rolling cipher): pre-resolve handler indices,
			// operand passthrough. mvSrc is already plaintext, so the cache
			// exposes nothing new — purely removes the _ht indirection.
			loopBody.push(
				exprStmt(
					assign(
						index(id(ARR), id(POS)),
						index(id(HT), index(id(SRC), id(POS)))
					)
				)
			);
			loopBody.push(
				exprStmt(
					assign(
						index(id(ARR), bin(BOp.Add, id(POS), lit(1))),
						index(id(SRC), bin(BOp.Add, id(POS), lit(1)))
					)
				)
			);
		}

		// if (!U.d) { var mvSrc=U.i; var mvLen=mvSrc.length; var mvArr=new
		//   Int32Array(mvLen); for(var mvPos=0; mvPos<mvLen; mvPos+=2){ ... }
		//   U.d = mvArr; }
		tryBody.push(
			ifStmt(un(UOp.Not, member(id(U), DI)), [
				varDecl(SRC, member(id(U), "i")),
				varDecl(LEN, member(id(SRC), "length")),
				varDecl(ARR, newExpr(id("Int32Array"), [id(LEN)])),
				forStmt(
					varDecl(POS, lit(0)),
					bin(BOp.Lt, id(POS), id(LEN)),
					assign(id(POS), lit(2), AOp.Add),
					loopBody
				),
				exprStmt(assign(member(id(U), DI), id(ARR))),
			])
		);
		// var I = U.d;
		tryBody.push(varDecl(I, member(id(U), DI)));
	}

	// var _il=I.length
	tryBody.push(varDecl(T("_il"), member(id(I), "length")));

	// --- Inner dispatch loop: for(;;){ try{...}catch(e){...} } ---

	// While loop body inside the inner try
	const whileBody: JsNode[] = [];

	// var PH=I[IP]; O=I[IP+1]; IP+=2;
	whileBody.push(varDecl(PH, index(id(I), id(IP))));
	whileBody.push(declOrAssign(O, index(id(I), bin(BOp.Add, id(IP), lit(1)))));
	whileBody.push(exprStmt(assign(id(IP), lit(2), AOp.Add)));

	// Compute instruction index (shared by incremental cipher + rolling cipher).
	// Skipped under the decode cache — operands are already decrypted in U.d.
	if (rollingCipher && !decodeCache) {
		// var _ri=(IP-2)>>>1
		whileBody.push(
			varDecl(
				T("_ri"),
				bin(BOp.Ushr, bin(BOp.Sub, id(IP), lit(2)), lit(1))
			)
		);
	}

	// Optional: observation resistance — periodic identity binding + canary check.
	// Every ~256 instructions, XOR orVerify() into rcState (identity binding)
	// and also check the WeakMap canary.  When clean (untampered), both return
	// 0 and XOR is a no-op.  When a bound function has been replaced or the
	// canary has been tampered with, a non-zero corruption constant silently
	// poisons all subsequent instruction decryption.
	if (interpOpts.observationResistance && rollingCipher) {
		const checkBody: JsNode[] = [
			// rcState = (rcState ^ orVerify()) >>> 0;
			exprStmt(
				assign(
					id(n.rcState),
					bin(
						BOp.Ushr,
						bin(
							BOp.BitXor,
							id(n.rcState),
							call(id(n.orVerify), [])
						),
						lit(0)
					)
				)
			),
		];

		// WeakMap canary check — XOR a corruption constant if canary is
		// tampered, or 0 if clean.  Uses temps _orRef (canary object) and
		// _orExp (WeakMap instance).
		const canaryRef = temps["_orRef"];
		const canaryWm = temps["_orExp"];
		if (canaryRef !== undefined && canaryWm !== undefined) {
			// Derive per-build canary corruption constant
			const canaryCorruptSeed = deriveSeed(seed, "canaryCorrupt");
			const canaryCorrupt = (canaryCorruptSeed || 0xcafebabe) >>> 0;

			// rcState = (rcState ^ ((!(_orExp instanceof WeakMap) || _orExp.get(_orRef) !== true) ? CORRUPT : 0)) >>> 0;
			checkBody.push(
				exprStmt(
					assign(
						id(n.rcState),
						bin(
							BOp.Ushr,
							bin(
								BOp.BitXor,
								id(n.rcState),
								ternary(
									bin(
										BOp.Or,
										un(
											UOp.Not,
											bin(
												BOp.Instanceof,
												id(canaryWm),
												id("WeakMap")
											)
										),
										bin(
											BOp.Sneq,
											call(member(id(canaryWm), "get"), [
												id(canaryRef),
											]),
											lit(true)
										)
									),
									split
										? split(canaryCorrupt)
										: lit(canaryCorrupt),
									lit(0)
								)
							),
							lit(0)
						)
					)
				)
			);
		}

		// if ((_ri & 0xFF) === 0) { ...checks... }
		whileBody.push(
			ifStmt(
				bin(BOp.Seq, bin(BOp.BitAnd, id(T("_ri")), lit(0xff)), lit(0)),
				checkBody
			)
		);
	}

	// Optional: incremental cipher decrypt (outer layer — must come BEFORE rolling cipher)
	// At block boundaries, reset the chain state to the block's base key.
	// Then XOR-decrypt PH and O using the current chain state.
	// Finally advance the chain using the DECRYPTED (plaintext) values.
	if (interpOpts.incrementalCipher && rollingCipher) {
		const icState = T("_icState");
		const ri = T("_ri");

		// Block boundary check: if(U.bl[_ri]!==void 0){_icState=icBlockKey(rcState,U.bl[_ri])}
		whileBody.push(
			ifStmt(
				bin(
					BOp.Sneq,
					index(member(id(U), "bl"), id(ri)),
					un(UOp.Void, lit(0))
				),
				[
					exprStmt(
						assign(
							id(icState),
							call(id(n.icBlockKey), [
								id(n.rcState),
								index(member(id(U), "bl"), id(ri)),
							])
						)
					),
				]
			)
		);

		// Decrypt: PH = (PH ^ (_icState & 0xFFFF)) & 0xFFFF
		whileBody.push(
			exprStmt(
				assign(
					id(PH),
					bin(
						BOp.BitAnd,
						bin(
							BOp.BitXor,
							id(PH),
							bin(BOp.BitAnd, id(icState), lit(0xffff))
						),
						lit(0xffff)
					)
				)
			)
		);

		// Decrypt: O = (O ^ _icState) | 0
		whileBody.push(
			exprStmt(
				assign(
					id(O),
					bin(BOp.BitOr, bin(BOp.BitXor, id(O), id(icState)), lit(0))
				)
			)
		);

		// Advance chain: _icState = icMix(_icState, PH, O)
		whileBody.push(
			exprStmt(
				assign(
					id(icState),
					call(id(n.icMix), [id(icState), id(PH), id(O)])
				)
			)
		);
	}

	// Optional: rolling cipher decrypt (inlined rcMix for performance).
	// Skipped under the decode cache — the materialized stream is already decrypted.
	if (rollingCipher && !decodeCache) {
		// Inline rcMix(rcState, _ri, _ri ^ 0x9E3779B9):
		// var _ks = rcState;
		whileBody.push(varDecl(T("_ks"), id(n.rcState)));
		// _ks = imul(_ks ^ _ri, 0x85EBCA6B) >>> 0;
		whileBody.push(
			exprStmt(
				assign(
					id(T("_ks")),
					bin(
						BOp.Ushr,
						call(id(n.imul), [
							bin(BOp.BitXor, id(T("_ks")), id(T("_ri"))),
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
						BOp.Ushr,
						call(id(n.imul), [
							bin(
								BOp.BitXor,
								id(T("_ks")),
								bin(BOp.BitXor, id(T("_ri")), L(0x9e3779b9))
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
					bin(
						BOp.BitXor,
						id(T("_ks")),
						bin(BOp.Ushr, id(T("_ks")), lit(16))
					)
				)
			)
		);
		// _ks = _ks >>> 0;
		whileBody.push(
			exprStmt(assign(id(T("_ks")), bin(BOp.Ushr, id(T("_ks")), lit(0))))
		);
		// PH=(PH^(_ks&0xFFFF))&0xFFFF
		whileBody.push(
			exprStmt(
				assign(
					id(PH),
					bin(
						BOp.BitAnd,
						bin(
							BOp.BitXor,
							id(PH),
							bin(BOp.BitAnd, id(T("_ks")), lit(0xffff))
						),
						lit(0xffff)
					)
				)
			)
		);
		// O=(O^_ks)|0
		whileBody.push(
			exprStmt(
				assign(
					id(O),
					bin(BOp.BitOr, bin(BOp.BitXor, id(O), id(T("_ks"))), lit(0))
				)
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
		whileStmt(bin(BOp.Lt, id(IP), id(T("_il"))), whileBody),
		returnStmt(un(UOp.Void, lit(0))),
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
						bin(BOp.And, id("e"), member(id("e"), "message")),
						member(id("e"), "message"),
						id("e")
					),
					bin(
						BOp.Add,
						lit(EX + "="),
						ternary(id(EX), member(id(EX), "length"), lit(0))
					),
				])
			)
		);
	}

	// The exception-completion machinery (PE/HPE/CT/CV resets + EX routing) is
	// collected here so it can be gated on `U.xh` when hoisting: a non-exception
	// unit never touches these slots, so its caught native exceptions must
	// propagate via the bare `throw e` below without disturbing them.
	const excCatch: JsNode[] = [];

	// HPE=false; PE=null; CT=0; CV=void 0;
	excCatch.push(exprStmt(assign(id(HPE), lit(false))));
	excCatch.push(exprStmt(assign(id(PE), lit(null))));
	excCatch.push(exprStmt(assign(id(CT), lit(0))));
	excCatch.push(exprStmt(assign(id(CV), un(UOp.Void, lit(0)))));

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
					bin(BOp.Add, lit("ip="), member(id(T("_h")), T("_ci"))),
					bin(BOp.Add, lit("sp="), member(id(T("_h")), T("_sp"))),
				])
			)
		);
	}
	// S.length=_h._sp (restore stack to saved depth)
	catchRouteBody.push(
		exprStmt(assign(member(id(S), "length"), member(id(T("_h")), T("_sp"))))
	);
	// Push error onto stack: S.push(stkEnc?(e, S.length, _sek))
	// (scaffold-level push — must encode like ctx.push when stackEncoding, or a
	// handler peek would decode a raw Error as e[1] === undefined.)
	catchRouteBody.push(
		exprStmt(
			call(member(id(S), "push"), [
				interpOpts.stackEncoding
					? call(id(n.stkEnc), [
							id("e"),
							member(id(S), "length"),
							id(T("_sek")),
					  ])
					: id("e"),
			])
		)
	);
	// IP=_h._ci*2
	catchRouteBody.push(
		exprStmt(
			assign(id(IP), bin(BOp.Mul, member(id(T("_h")), T("_ci")), lit(2)))
		)
	);
	// continue
	catchRouteBody.push(continueStmt());

	exHandlerBody.push(
		ifStmt(
			bin(BOp.Gte, member(id(T("_h")), T("_ci")), lit(0)),
			catchRouteBody
		)
	);

	// if(_h._fi>=0){ ... finally routing ... }
	const finallyRouteBody: JsNode[] = [];
	if (debug) {
		finallyRouteBody.push(
			exprStmt(
				call(id(n.dbg), [
					lit("FINALLY"),
					bin(BOp.Add, lit("ip="), member(id(T("_h")), T("_fi"))),
					bin(BOp.Add, lit("sp="), member(id(T("_h")), T("_sp"))),
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
			assign(id(IP), bin(BOp.Mul, member(id(T("_h")), T("_fi")), lit(2)))
		)
	);
	// continue
	finallyRouteBody.push(continueStmt());

	exHandlerBody.push(
		ifStmt(
			bin(BOp.Gte, member(id(T("_h")), T("_fi")), lit(0)),
			finallyRouteBody
		)
	);

	excCatch.push(
		ifStmt(
			bin(BOp.And, id(EX), bin(BOp.Gt, member(id(EX), "length"), lit(0))),
			exHandlerBody
		)
	);

	// Emit the exception machinery: gated on `U.xh` when hoisting (so
	// non-exception units leave PE/HPE/CT/CV — which they never save — alone),
	// inline otherwise (async path uses per-call locals, always needed).
	if (hoistHandlers) {
		catchBody.push(ifStmt(id(fXh), excCatch));
	} else {
		catchBody.push(...excCatch);
	}

	// Optional: debug uncaught logging
	if (debug) {
		catchBody.push(
			exprStmt(
				call(id(n.dbg), [
					lit("UNCAUGHT"),
					lit("error="),
					ternary(
						bin(BOp.And, id("e"), member(id("e"), "message")),
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
	const finallyBody: JsNode[] = [
		exprStmt(update(UpOp.Dec, false, id(n.depth))),
	];
	if (debug) {
		finallyBody.push(exprStmt(call(member(id(n.callStack), "pop"), [])));
	}
	// Restore snapshot slot values when hoisting (partitioned: CORE always,
	// EXC/TC only when the unit uses them — matching what was snapshotted).
	if (hoistHandlers) {
		finallyBody.push(...buildSlotRestore());
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
	const tos = () =>
		index(id(S), bin(BOp.Sub, member(id(S), "length"), lit(1)));

	// AST decoy body factories — look like real array push/pop/length ops
	const decoyBodyFactories: (() => JsNode[])[] = [
		// var b=S.pop(); S[S.length-1]=S[S.length-1]+b
		() => [
			varDecl("b", call(member(id(S), "pop"), [])),
			exprStmt(assign(tos(), bin(BOp.Add, tos(), id("b")))),
		],
		// var b=S.pop(); S[S.length-1]=S[S.length-1]-b
		() => [
			varDecl("b", call(member(id(S), "pop"), [])),
			exprStmt(assign(tos(), bin(BOp.Sub, tos(), id("b")))),
		],
		// var b=S.pop(); S[S.length-1]=S[S.length-1]*b
		() => [
			varDecl("b", call(member(id(S), "pop"), [])),
			exprStmt(assign(tos(), bin(BOp.Mul, tos(), id("b")))),
		],
		// S[S.length-1]=~S[S.length-1]
		() => [exprStmt(assign(tos(), un(UOp.BitNot, tos())))],
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
				bin(
					BOp.And,
					id("s"),
					bin(BOp.In, index(id(C), id(O)), id("s"))
				),
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
		() => [exprStmt(assign(tos(), un(UOp.Not, tos())))],
		// var b=S.pop(); S[S.length-1]=S[S.length-1]&b
		() => [
			varDecl("b", call(member(id(S), "pop"), [])),
			exprStmt(assign(tos(), bin(BOp.BitAnd, tos(), id("b")))),
		],
		// var b=S.pop(); S[S.length-1]=S[S.length-1]|b
		() => [
			varDecl("b", call(member(id(S), "pop"), [])),
			exprStmt(assign(tos(), bin(BOp.BitOr, tos(), id("b")))),
		],
		// S[S.length-1]=-S[S.length-1]
		() => [exprStmt(assign(tos(), un(UOp.Neg, tos())))],
		// S[S.length-1]=+S[S.length-1]+1
		() => [
			exprStmt(assign(tos(), bin(BOp.Add, un(UOp.Pos, tos()), lit(1)))),
		],
		// S[S.length-1]=typeof S[S.length-1]
		() => [exprStmt(assign(tos(), un(UOp.Typeof, tos())))],
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

// --- Opaque predicate dead code ---

/**
 * Generate a dead code body for the never-taken branch of an opaque predicate.
 *
 * Produces 2-4 harmless statements that look plausible (variable declarations,
 * void expressions, arithmetic) but never execute. Uses a deterministic seed
 * so the dead code pattern is reproducible.
 *
 * @param seed - Deterministic seed for pattern selection
 * @returns Array of dead code JsNode statements
 */
function generateDeadBody(seed: number): JsNode[] {
	const pattern = seed % 4;
	switch (pattern) {
		case 0:
			// var _d = 0; void 0;
			return [varDecl("_d", lit(0)), exprStmt(un(UOp.Void, lit(0)))];
		case 1:
			// var _d = 0; _d = _d + 1;
			return [
				varDecl("_d", lit(0)),
				exprStmt(assign(id("_d"), bin(BOp.Add, id("_d"), lit(1)))),
			];
		case 2:
			// var _d = 0; var _e = 1; void (_d + _e);
			return [
				varDecl("_d", lit(0)),
				varDecl("_e", lit(1)),
				exprStmt(un(UOp.Void, bin(BOp.Add, id("_d"), id("_e")))),
			];
		case 3:
		default:
			// var _d = 0 | 0; void _d;
			return [
				varDecl("_d", bin(BOp.BitOr, lit(0), lit(0))),
				exprStmt(un(UOp.Void, id("_d"))),
			];
	}
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
					un(UOp.Void, lit(0));
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
	groupCountOffset = 0,
	decodeCache = false
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
		preLoopDecls.push(varDecl(FRV, un(UOp.Void, lit(0))));
	} else {
		iifeDecls.push(varDecl(FRV, un(UOp.Void, lit(0))));
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
	// Under the decode cache, PH already holds the resolved handler index
	// (pre-computed during materialization); otherwise resolve via _ht.
	dispatchNodes.push(
		varDecl(
			FDI,
			decodeCache ? id(phName) : index(id(htName), id(phName))
		)
	);

	// Build if-else routing tree with grouped dispatch calls.
	// Each branch: if (_fgN[_fdi - offset]() === _frs) return _frv;
	// For async: if ((await _fgN[_fdi - offset]()) === _frs) return _frv;
	const awaitNode = (expr: JsNode): JsNode =>
		({ type: "AwaitExpr", expr } as JsNode);

	const buildCallCheck = (groupName: string, offset: number): JsNode[] => {
		const indexExpr =
			offset === 0 ? id(FDI) : bin(BOp.Sub, id(FDI), lit(offset));
		const callExpr = call(index(id(groupName), indexExpr), []);
		const result = isAsync ? awaitNode(callExpr) : callExpr;
		return [ifStmt(bin(BOp.Seq, result, id(FRS)), [returnStmt(id(FRV))])];
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
				ifStmt(bin(BOp.Lt, id(FDI), lit(threshold)), body, current),
			];
		}

		dispatchNodes.push(...current);
	}

	return { preLoopDecls, iifeDecls, dispatchNodes };
}

// --- Return mechanism transforms ---

/**
 * Transform handler body for "tagged" return mechanism.
 * - `BreakStmt` → `ReturnStmt()` (exit handler)
 * - `ReturnStmt(expr)` → `ReturnStmt({ t: TAG, v: expr })`
 */
function transformBodyForTagged(body: JsNode[], tag: number): JsNode[] {
	return body.map((node) =>
		walkSkipFns(node, (n) => {
			if (n.type === "BreakStmt") return returnStmt();
			if (n.type === "ReturnStmt") {
				const value =
					(n as { type: "ReturnStmt"; value?: JsNode }).value ??
					un(UOp.Void, lit(0));
				return returnStmt(obj([lit("t"), lit(tag)], [lit("v"), value]));
			}
			return null;
		})
	);
}

/**
 * Transform handler body for "flag" return mechanism.
 * - `BreakStmt` → `ReturnStmt()` (exit handler)
 * - `ReturnStmt(expr)` → `_done = true; _rv = expr; return;`
 *   (sequence: assign flag, assign value, return void)
 */
function transformBodyForFlag(
	body: JsNode[],
	doneName: string,
	rvName: string
): JsNode[] {
	return body.map((node) =>
		walkSkipFns(node, (n) => {
			if (n.type === "BreakStmt") return returnStmt();
			if (n.type === "ReturnStmt") {
				const value =
					(n as { type: "ReturnStmt"; value?: JsNode }).value ??
					un(UOp.Void, lit(0));
				// Use a sequence expression: (_done = true, _rv = value, void 0)
				// then return. This keeps it as a single return statement.
				return returnStmt(
					seq(
						assign(id(doneName), lit(true)),
						assign(id(rvName), value)
					)
				);
			}
			return null;
		})
	);
}

// --- Direct array dispatch ---

/**
 * Direct array dispatch — flat handler array indexed by handler index.
 * No grouping, no if-else chain. Just `_ha[_fdi]()`.
 *
 * Structurally different from function-table: one array instead of
 * 2-4 groups, no routing tree.
 */
function buildDirectArrayDispatch(
	cases: CaseClause[],
	temps: TempNames,
	htName: string,
	phName: string,
	isAsync: boolean,
	returnMech: string,
	returnTag: number,
	decodeCache = false
): { preLoopDecls: JsNode[]; iifeDecls: JsNode[]; dispatchNodes: JsNode[] } {
	const FRS = temps["_frs"];
	const FRV = temps["_frv"];
	const FDI = temps["_fdi"];
	if (!FRS || !FRV || !FDI) {
		throw new Error("Missing function table temp names");
	}

	const groupName = temps["_fg0"];
	if (!groupName) throw new Error("Missing temp: _fg0");

	const handlerCases = cases
		.filter((c): c is CaseClause & { label: JsNode } => c.label !== null)
		.sort((a, b) => {
			const aVal = (a.label as { type: "Literal"; value: number }).value;
			const bVal = (b.label as { type: "Literal"; value: number }).value;
			return aVal - bVal;
		});

	// Transform and wrap each handler
	const handlerFns: JsNode[] = handlerCases.map((c) => {
		let body: JsNode[];
		if (returnMech === "tagged") {
			body = transformBodyForTagged(c.body, returnTag);
		} else if (returnMech === "flag") {
			body = transformBodyForFlag(c.body, FRS, FRV);
		} else {
			body = transformBodyForFT(c.body, FRS, FRV);
		}
		return fnExpr(
			undefined,
			[],
			body,
			isAsync ? { async: true } : undefined
		);
	});

	const iifeDecls: JsNode[] = [];
	const preLoopDecls: JsNode[] = [];

	// For sentinel/flag: declare sentinel/flag + return value at appropriate scope.
	// For async mode, both go to preLoopDecls to avoid clobbering from
	// concurrent async calls that interleave on the same IIFE scope.
	if (returnMech === "flag") {
		const flagTarget = isAsync ? preLoopDecls : iifeDecls;
		flagTarget.push(varDecl(FRS, lit(false)));
	} else if (returnMech === "tagged") {
		// Tagged: no sentinel needed
	} else {
		// Sentinel (identity-constant, safe at IIFE scope even for async)
		iifeDecls.push(varDecl(FRS, obj()));
	}

	if (isAsync) {
		preLoopDecls.push(varDecl(FRV, un(UOp.Void, lit(0))));
	} else {
		iifeDecls.push(varDecl(FRV, un(UOp.Void, lit(0))));
	}

	// Single flat array — no grouping
	const handlerTarget = isAsync ? preLoopDecls : iifeDecls;
	handlerTarget.push(varDecl(groupName, arr(...handlerFns)));

	// Dispatch nodes
	const dispatchNodes: JsNode[] = [];
	// Under the decode cache, PH already holds the resolved handler index
	// (pre-computed during materialization); otherwise resolve via _ht.
	dispatchNodes.push(
		varDecl(
			FDI,
			decodeCache ? id(phName) : index(id(htName), id(phName))
		)
	);

	const awaitNode = (expr: JsNode): JsNode =>
		({ type: "AwaitExpr", expr } as JsNode);

	const callExpr = call(index(id(groupName), id(FDI)), []);
	const result = isAsync ? awaitNode(callExpr) : callExpr;

	if (returnMech === "tagged") {
		// var _r = fn(); if (_r && _r.t === TAG) return _r.v;
		// Reuse FRV to hold tagged result (declared above)
		dispatchNodes.push(exprStmt(assign(id(FRV), result)));
		dispatchNodes.push(
			ifStmt(
				bin(
					BOp.And,
					id(FRV),
					bin(BOp.Seq, member(id(FRV), "t"), lit(returnTag))
				),
				[returnStmt(member(id(FRV), "v"))]
			)
		);
	} else if (returnMech === "flag") {
		// fn(); if (_frs) return _frv;
		dispatchNodes.push(exprStmt(result));
		dispatchNodes.push(
			ifStmt(id(FRS), [
				exprStmt(assign(id(FRS), lit(false))),
				returnStmt(id(FRV)),
			])
		);
	} else {
		// Sentinel: if (fn() === _frs) return _frv;
		dispatchNodes.push(
			ifStmt(bin(BOp.Seq, result, id(FRS)), [returnStmt(id(FRV))])
		);
	}

	return { preLoopDecls, iifeDecls, dispatchNodes };
}

// --- Object lookup dispatch ---

/**
 * Object lookup dispatch — handlers stored as properties on a plain
 * object, keyed by handler index. Dispatch is a property access + call.
 *
 * Structurally different from function-table: uses an object literal
 * instead of array grouping, property access instead of index access.
 */
function buildObjectLookupDispatch(
	cases: CaseClause[],
	temps: TempNames,
	htName: string,
	phName: string,
	isAsync: boolean,
	returnMech: string,
	returnTag: number,
	decodeCache = false
): { preLoopDecls: JsNode[]; iifeDecls: JsNode[]; dispatchNodes: JsNode[] } {
	const FRS = temps["_frs"];
	const FRV = temps["_frv"];
	const FDI = temps["_fdi"];
	if (!FRS || !FRV || !FDI) {
		throw new Error("Missing function table temp names");
	}

	const groupName = temps["_fg0"];
	if (!groupName) throw new Error("Missing temp: _fg0");

	const handlerCases = cases
		.filter((c): c is CaseClause & { label: JsNode } => c.label !== null)
		.sort((a, b) => {
			const aVal = (a.label as { type: "Literal"; value: number }).value;
			const bVal = (b.label as { type: "Literal"; value: number }).value;
			return aVal - bVal;
		});

	// Build object entries: { 0: function(){...}, 1: function(){...}, ... }
	const entries: [string | JsNode, JsNode][] = handlerCases.map((c, i) => {
		let body: JsNode[];
		if (returnMech === "tagged") {
			body = transformBodyForTagged(c.body, returnTag);
		} else if (returnMech === "flag") {
			body = transformBodyForFlag(c.body, FRS, FRV);
		} else {
			body = transformBodyForFT(c.body, FRS, FRV);
		}
		const handler = fnExpr(
			undefined,
			[],
			body,
			isAsync ? { async: true } : undefined
		);
		return [String(i), handler] as [string, JsNode];
	});

	const handlerObj: JsNode = { type: "ObjectExpr", entries };

	const iifeDecls: JsNode[] = [];
	const preLoopDecls: JsNode[] = [];

	if (returnMech === "flag") {
		const flagTarget = isAsync ? preLoopDecls : iifeDecls;
		flagTarget.push(varDecl(FRS, lit(false)));
	} else if (returnMech === "tagged") {
		// No sentinel needed
	} else {
		iifeDecls.push(varDecl(FRS, obj()));
	}

	if (isAsync) {
		preLoopDecls.push(varDecl(FRV, un(UOp.Void, lit(0))));
	} else {
		iifeDecls.push(varDecl(FRV, un(UOp.Void, lit(0))));
	}

	const handlerTarget = isAsync ? preLoopDecls : iifeDecls;
	handlerTarget.push(varDecl(groupName, handlerObj));

	// Dispatch nodes
	const dispatchNodes: JsNode[] = [];
	// Under the decode cache, PH already holds the resolved handler index
	// (pre-computed during materialization); otherwise resolve via _ht.
	dispatchNodes.push(
		varDecl(
			FDI,
			decodeCache ? id(phName) : index(id(htName), id(phName))
		)
	);

	const awaitNode = (expr: JsNode): JsNode =>
		({ type: "AwaitExpr", expr } as JsNode);

	const callExpr = call(index(id(groupName), id(FDI)), []);
	const result = isAsync ? awaitNode(callExpr) : callExpr;

	if (returnMech === "tagged") {
		// Reuse FRV to hold tagged result (declared above)
		dispatchNodes.push(exprStmt(assign(id(FRV), result)));
		dispatchNodes.push(
			ifStmt(
				bin(
					BOp.And,
					id(FRV),
					bin(BOp.Seq, member(id(FRV), "t"), lit(returnTag))
				),
				[returnStmt(member(id(FRV), "v"))]
			)
		);
	} else if (returnMech === "flag") {
		dispatchNodes.push(exprStmt(result));
		dispatchNodes.push(
			ifStmt(id(FRS), [
				exprStmt(assign(id(FRS), lit(false))),
				returnStmt(id(FRV)),
			])
		);
	} else {
		dispatchNodes.push(
			ifStmt(bin(BOp.Seq, result, id(FRS)), [returnStmt(id(FRV))])
		);
	}

	return { preLoopDecls, iifeDecls, dispatchNodes };
}

// --- Stack encoding (AST) ---

/**
 * Build the per-exec stack-encoding key expression: `(U.i.length ^ U.r ^ const) >>> 0`.
 *
 * This is the per-unit key base folded into the position-dependent XOR mask.
 * The caller binds it to the `_sek` slot via `declOrAssign` (so it is an
 * IIFE-scope slot variable, saved/restored per exec for recursion safety, just
 * like `S`/`C`/`O` — hoisted handler closures reference it directly). The stack
 * array itself stays a plain `Array`; values are encoded/decoded via the
 * IIFE-scope `stkEnc`/`stkDec` helpers ({@link buildStackEncodingHelpers})
 * instead of a `Proxy`. Far faster (no per-access trap, V8 keeps the array's
 * fast element path) while preserving the exact in-memory representation
 * (`[tag,payload]` entries with int32s position-XOR-masked) — so at-rest
 * stack-memory secrecy is identical.
 *
 * @param n - Runtime identifier names
 * @param split - Optional constant splitter for numeric obfuscation
 * @returns The `_sek` key expression node
 */
function buildStackEncodingKeyExpr(n: RuntimeNames, split?: SplitFn): JsNode {
	const L = (v: number): JsNode => (split ? split(v) : lit(v));
	const U = n.unit;
	// (U.i.length^U.r^0x5A3C96E1)>>>0
	return bin(
		BOp.Ushr,
		bin(
			BOp.BitXor,
			bin(
				BOp.BitXor,
				member(member(id(U), "i"), "length"),
				member(id(U), "r")
			),
			L(0x5a3c96e1)
		),
		lit(0)
	);
}

/**
 * Build the IIFE-scope stack-encoding helper functions `stkEnc` / `stkDec`.
 *
 * These replace the legacy `Proxy` get/set traps with plain function calls and
 * use an allocation-free representation on the int32 hot path:
 *
 *   stkEnc(v, i, k) -> the stored entry for value v at slot i (key base k):
 *     int32  -> v ^ ((k ^ (i*GR))>>>0)   (BARE masked number — NO allocation)
 *     else   -> [v]                       (boxed: floats, bool, string, object,
 *                                          null, undefined, function, symbol, …)
 *   stkDec(e, i, k) -> the decoded value from entry e at slot i (inverse):
 *     typeof e === 'number' -> e ^ ((k ^ (i*GR))>>>0)   (masked int, incl. 0)
 *     else                  -> e[0]                      (unbox)
 *
 * The ONLY bare numbers on the stack are masked int32s, so a `typeof` test
 * unambiguously distinguishes them from boxed values. A float is also
 * `typeof === 'number'` but is NOT an int32 ((v|0)===v fails), so it is boxed —
 * never bare — preventing stkDec from wrongly unmasking it. -0 masks-as-int and
 * round-trips to +0 (`-0 ^ k === k`, `k ^ k === 0`), matching JS `-0|0===0` and
 * the old `[tag,payload]` scheme exactly. NaN/Infinity/2^31..2^32 are boxed.
 *
 * The key formula and per-unit `_sek` key are byte-identical to the old Proxy,
 * so int32 stack values remain position-XOR-masked with the same keystream;
 * non-ints remain exposed (boxed, unmasked) exactly as before. The eliminated
 * allocation is the per-push `[tag,payload]` array, which dominated push/pop.
 * Defined once at IIFE scope and shared across all exec calls; the per-unit key
 * is passed in as `k` (a per-exec local) rather than captured, so recursion with
 * differing units stays correct.
 *
 * @param n - Runtime identifier names (provides stkEnc/stkDec)
 * @param split - Optional constant splitter for numeric obfuscation
 * @returns Two `var stkEnc = function(...){}` / `var stkDec = ...` declarations
 */
export function buildStackEncodingHelpers(
	n: RuntimeNames,
	split?: SplitFn
): JsNode[] {
	const L = (v: number): JsNode => (split ? split(v) : lit(v));
	const ENC = n.stkEnc;
	const DEC = n.stkDec;

	// (k^(i*0x9E3779B9))>>>0 — position key, k is the per-unit base param.
	const xorKey = (iVar: JsNode): JsNode =>
		bin(
			BOp.Ushr,
			bin(BOp.BitXor, id("k"), bin(BOp.Mul, iVar, L(0x9e3779b9))),
			lit(0)
		);

	// stkEnc(v,i,k)
	const encBody: JsNode[] = [
		// if(typeof v==='number'&&(v|0)===v)return v^key  — bare masked int, no alloc
		ifStmt(
			bin(
				BOp.And,
				bin(BOp.Seq, un(UOp.Typeof, id("v")), lit("number")),
				bin(BOp.Seq, bin(BOp.BitOr, id("v"), lit(0)), id("v"))
			),
			[returnStmt(bin(BOp.BitXor, id("v"), xorKey(id("i"))))]
		),
		// return[v]  — box everything else (floats/bool/string/object/null/…)
		returnStmt(arr(id("v"))),
	];

	// stkDec(e,i,k)
	const decBody: JsNode[] = [
		// if(typeof e==='number')return e^key  — masked int (incl. 0)
		ifStmt(bin(BOp.Seq, un(UOp.Typeof, id("e")), lit("number")), [
			returnStmt(bin(BOp.BitXor, id("e"), xorKey(id("i")))),
		]),
		// if(!e)return void 0  — empty/undefined slot (e is not a number here)
		ifStmt(un(UOp.Not, id("e")), [returnStmt(un(UOp.Void, lit(0)))]),
		// return e[0]  — unbox
		returnStmt(index(id("e"), lit(0))),
	];

	return [
		varDecl(ENC, fnExpr(undefined, ["v", "i", "k"], encBody)),
		varDecl(DEC, fnExpr(undefined, ["e", "i", "k"], decBody)),
	];
}
