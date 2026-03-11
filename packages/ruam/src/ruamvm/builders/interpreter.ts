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
import type { RuntimeNames } from "../../encoding/names.js";
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
	stackPush,
	fnExpr,
} from "../nodes.js";
import { registry, makeHandlerCtx } from "../handlers/index.js";
import { VM_MAX_RECURSION_DEPTH } from "../../constants.js";
import { obfuscateLocals } from "../transforms.js";

/** Options for interpreter filtering and hardening. */
export interface InterpreterBuildOptions {
	dynamicOpcodes?: boolean;
	decoyOpcodes?: boolean;
	stackEncoding?: boolean;
	usedOpcodes?: Set<number>;
}

/**
 * Build both sync and async interpreter functions as JsNode[].
 *
 * Each function is returned as a FnDecl AST node with tree-based
 * obfuscation applied to local variable names.
 */
export function buildInterpreterFunctions(
	names: RuntimeNames,
	shuffleMap: number[],
	debug: boolean,
	rollingCipher: boolean,
	seed: number,
	interpOpts: InterpreterBuildOptions = {}
): JsNode[] {
	return [
		buildExecFunction(names, shuffleMap, {
			isAsync: false,
			debug,
			rollingCipher,
			seed,
			interpOpts,
		}),
		buildExecFunction(names, shuffleMap, {
			isAsync: true,
			debug,
			rollingCipher,
			seed,
			interpOpts,
		}),
	];
}

/**
 * Build a single interpreter function (sync or async) as a JsNode.
 *
 * Builds switch cases from handler registry, constructs the scaffold
 * as AST, applies tree-based obfuscateLocals(), and returns the
 * FnDecl node directly.
 */
export function buildExecFunction(
	names: RuntimeNames,
	shuffleMap: number[],
	opts: {
		isAsync: boolean;
		debug: boolean;
		rollingCipher: boolean;
		seed: number;
		interpOpts: InterpreterBuildOptions;
	}
): JsNode {
	const ctx = makeHandlerCtx(names, opts.isAsync, opts.debug);

	// Build switch cases from the handler registry
	const cases: CaseClause[] = [];
	for (const [op, handler] of registry) {
		// Dynamic opcodes: skip handlers for opcodes not used by any compiled unit
		if (
			opts.interpOpts.dynamicOpcodes &&
			opts.interpOpts.usedOpcodes &&
			!opts.interpOpts.usedOpcodes.has(op)
		) {
			continue;
		}
		const physicalOp = shuffleMap[op]!;
		cases.push(caseClause(lit(physicalOp), handler(ctx)));
	}

	// Generate decoy handlers for unused opcodes
	if (opts.interpOpts.decoyOpcodes && opts.interpOpts.usedOpcodes) {
		cases.push(
			...generateDecoyHandlers(
				names,
				shuffleMap,
				opts.interpOpts.usedOpcodes
			)
		);
	}

	// Default case
	cases.push(caseClause(null, [breakStmt()]));

	// Build the scaffold as AST with the switch cases
	const switchNode = switchStmt(id(ctx.PH), cases);
	const fnNode = buildScaffoldAST(
		names,
		opts.isAsync,
		opts.debug,
		opts.rollingCipher,
		opts.interpOpts,
		switchNode
	);

	// Apply tree-based obfuscation of local variable names
	const [obfuscated] = obfuscateLocals([fnNode], opts.seed);
	return obfuscated!;
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
 * @param switchNode - The switch statement AST node (with all cases)
 * @returns FnDecl AST node for the complete interpreter function
 */
function buildScaffoldAST(
	n: RuntimeNames,
	isAsync: boolean,
	debug: boolean,
	rollingCipher: boolean,
	interpOpts: InterpreterBuildOptions,
	switchNode: JsNode
): JsNode {
	const fnName = isAsync ? n.execAsync : n.exec;
	const fnLabel = isAsync ? n.execAsync : n.exec;

	const S = n.stk,
		P = n.stp;
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
	const sPar = n.sPar,
		sV = n.sVars;

	// --- Outer body ---
	const outerBody: JsNode[] = [];

	// depth++
	outerBody.push(exprStmt(update("++", false, id(n.depth))));

	// var _uid_=(U._dbgId||'?')
	outerBody.push(
		varDecl("_uid_", bin("||", member(id(U), "_dbgId"), lit("?")))
	);

	// callStack.push(_uid_)
	outerBody.push(
		exprStmt(call(member(id(n.callStack), "push"), [id("_uid_")]))
	);

	// Recursion guard: if(depth>500){depth--;callStack.pop();throw new RangeError('Maximum call '+'s'+'tack size exceeded');}
	outerBody.push(
		ifStmt(bin(">", id(n.depth), lit(VM_MAX_RECURSION_DEPTH)), [
			exprStmt(update("--", false, id(n.depth))),
			exprStmt(call(member(id(n.callStack), "pop"), [])),
			throwStmt(
				newExpr(id("RangeError"), [
					bin(
						"+",
						bin("+", lit("Maximum call "), lit("s")),
						lit("tack size exceeded")
					),
				])
			),
		])
	);

	// --- Try body (main interpreter logic) ---
	const tryBody: JsNode[] = [];

	// Variable declarations
	tryBody.push(varDecl(S, arr()));
	tryBody.push(varDecl(R, newExpr(id("Array"), [member(id(U), "r")])));
	tryBody.push(varDecl(IP, lit(0)));
	tryBody.push(varDecl(C, member(id(U), "c")));
	tryBody.push(varDecl(I, member(id(U), "i")));
	tryBody.push(varDecl(EX, lit(null)));
	tryBody.push(varDecl(PE, lit(null)));
	tryBody.push(varDecl(HPE, lit(false)));
	tryBody.push(varDecl(CT, lit(0)));
	tryBody.push(varDecl(CV, un("void", lit(0))));
	tryBody.push(varDecl(SC, obj([sPar, id(OS)], [sV, obj()])));
	tryBody.push(varDecl(P, un("-", lit(1))));

	// var _g=typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:typeof global!=='undefined'?global:typeof self!=='undefined'?self:{}
	tryBody.push(
		varDecl(
			"_g",
			ternary(
				bin("!==", un("typeof", id("globalThis")), lit("undefined")),
				id("globalThis"),
				ternary(
					bin("!==", un("typeof", id("window")), lit("undefined")),
					id("window"),
					ternary(
						bin(
							"!==",
							un("typeof", id("global")),
							lit("undefined")
						),
						id("global"),
						ternary(
							bin(
								"!==",
								un("typeof", id("self")),
								lit("undefined")
							),
							id("self"),
							obj()
						)
					)
				)
			)
		)
	);

	// Optional: debug entry logging
	if (debug) {
		tryBody.push(
			varDecl("_uid", bin("||", member(id(U), "_dbgId"), lit("?")))
		);
		tryBody.push(
			exprStmt(
				call(id(n.dbg), [
					lit("ENTER"),
					lit(fnLabel),
					bin("+", lit("unit="), id("_uid")),
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
		tryBody.push(...buildStackEncodingProxyAST(n));
	}

	// var _il=I.length
	tryBody.push(varDecl("_il", member(id(I), "length")));

	// --- Inner dispatch loop: for(;;){ try{...}catch(e){...} } ---

	// While loop body inside the inner try
	const whileBody: JsNode[] = [];

	// var PH=I[IP]; var O=I[IP+1]; IP+=2;
	whileBody.push(varDecl(PH, index(id(I), id(IP))));
	whileBody.push(varDecl(O, index(id(I), bin("+", id(IP), lit(1)))));
	whileBody.push(exprStmt(assign(id(IP), lit(2), "+")));

	// Optional: rolling cipher decrypt
	if (rollingCipher) {
		// var _ri=(IP-2)>>>1
		whileBody.push(
			varDecl("_ri", bin(">>>", bin("-", id(IP), lit(2)), lit(1)))
		);
		// var _ks=rcMix(rcState,_ri,_ri^0x9E3779B9)
		whileBody.push(
			varDecl(
				"_ks",
				call(id(n.rcMix), [
					id(n.rcState),
					id("_ri"),
					bin("^", id("_ri"), lit(0x9e3779b9)),
				])
			)
		);
		// PH=(PH^(_ks&0xFFFF))&0xFFFF
		whileBody.push(
			exprStmt(
				assign(
					id(PH),
					bin(
						"&",
						bin("^", id(PH), bin("&", id("_ks"), lit(0xffff))),
						lit(0xffff)
					)
				)
			)
		);
		// O=(O^_ks)|0
		whileBody.push(
			exprStmt(
				assign(id(O), bin("|", bin("^", id(O), id("_ks")), lit(0)))
			)
		);
	}

	// Optional: debug trace
	if (debug) {
		whileBody.push(
			exprStmt(call(id(n.dbgOp), [id(PH), id(O), id(C), id(P), id(S)]))
		);
	}

	// The switch statement
	whileBody.push(switchNode);

	// Inner try body: while(IP<_il){...}; return void 0;
	const innerTryBody: JsNode[] = [
		whileStmt(bin("<", id(IP), id("_il")), whileBody),
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
	exHandlerBody.push(varDecl("_h", call(member(id(EX), "pop"), [])));

	// if(_h._ci>=0){ ... catch routing ... }
	const catchRouteBody: JsNode[] = [];
	if (debug) {
		catchRouteBody.push(
			exprStmt(
				call(id(n.dbg), [
					lit("CATCH"),
					bin("+", lit("ip="), member(id("_h"), "_ci")),
					bin("+", lit("sp="), member(id("_h"), "_sp")),
				])
			)
		);
	}
	// P=_h._sp
	catchRouteBody.push(exprStmt(assign(id(P), member(id("_h"), "_sp"))));
	// Push error onto stack: S[++P]=e
	catchRouteBody.push(exprStmt(stackPush(S, P, id("e"))));
	// IP=_h._ci*2
	catchRouteBody.push(
		exprStmt(assign(id(IP), bin("*", member(id("_h"), "_ci"), lit(2))))
	);
	// continue
	catchRouteBody.push(continueStmt());

	exHandlerBody.push(
		ifStmt(bin(">=", member(id("_h"), "_ci"), lit(0)), catchRouteBody)
	);

	// if(_h._fi>=0){ ... finally routing ... }
	const finallyRouteBody: JsNode[] = [];
	if (debug) {
		finallyRouteBody.push(
			exprStmt(
				call(id(n.dbg), [
					lit("FINALLY"),
					bin("+", lit("ip="), member(id("_h"), "_fi")),
					bin("+", lit("sp="), member(id("_h"), "_sp")),
				])
			)
		);
	}
	// P=_h._sp
	finallyRouteBody.push(exprStmt(assign(id(P), member(id("_h"), "_sp"))));
	// PE=e; HPE=true
	finallyRouteBody.push(exprStmt(assign(id(PE), id("e"))));
	finallyRouteBody.push(exprStmt(assign(id(HPE), lit(true))));
	// IP=_h._fi*2
	finallyRouteBody.push(
		exprStmt(assign(id(IP), bin("*", member(id("_h"), "_fi"), lit(2))))
	);
	// continue
	finallyRouteBody.push(continueStmt());

	exHandlerBody.push(
		ifStmt(bin(">=", member(id("_h"), "_fi"), lit(0)), finallyRouteBody)
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

	tryBody.push(foreverLoop);

	// --- Outer finally ---
	const finallyBody: JsNode[] = [
		exprStmt(update("--", false, id(n.depth))),
		exprStmt(call(member(id(n.callStack), "pop"), [])),
	];

	// Outer try-finally wrapping the whole body
	outerBody.push(tryCatch(tryBody, undefined, undefined, finallyBody));

	return fn(fnName, [U, A, OS, n.tVal, n.nTgt, n.ho], outerBody, {
		async: isAsync,
	});
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
		P = n.stp,
		C = n.cArr,
		O = n.operand;
	const R = n.regs,
		SC = n.scope,
		sV = n.sVars;

	// AST decoy body factories — look like real arithmetic, stack, register, scope ops
	const decoyBodyFactories: (() => JsNode[])[] = [
		// var b=S[P--]; S[P]=S[P]+b
		() => [
			varDecl("b", index(id(S), update("--", false, id(P)))),
			exprStmt(
				assign(
					index(id(S), id(P)),
					bin("+", index(id(S), id(P)), id("b"))
				)
			),
		],
		// var b=S[P--]; S[P]=S[P]-b
		() => [
			varDecl("b", index(id(S), update("--", false, id(P)))),
			exprStmt(
				assign(
					index(id(S), id(P)),
					bin("-", index(id(S), id(P)), id("b"))
				)
			),
		],
		// var b=S[P--]; S[P]=S[P]*b
		() => [
			varDecl("b", index(id(S), update("--", false, id(P)))),
			exprStmt(
				assign(
					index(id(S), id(P)),
					bin("*", index(id(S), id(P)), id("b"))
				)
			),
		],
		// S[P]=~S[P]
		() => [
			exprStmt(assign(index(id(S), id(P)), un("~", index(id(S), id(P))))),
		],
		// S[++P]=C[O]
		() => [exprStmt(stackPush(S, P, index(id(C), id(O))))],
		// R[O]=S[P--]
		() => [
			exprStmt(
				assign(
					index(id(R), id(O)),
					index(id(S), update("--", false, id(P)))
				)
			),
		],
		// S[++P]=R[O]
		() => [exprStmt(stackPush(S, P, index(id(R), id(O))))],
		// var s=SC; if(s&&s.sV){s.sV[C[O]]=S[P--];}
		() => [
			varDecl("s", id(SC)),
			ifStmt(bin("&&", id("s"), member(id("s"), sV)), [
				exprStmt(
					assign(
						index(member(id("s"), sV), index(id(C), id(O))),
						index(id(S), update("--", false, id(P)))
					)
				),
			]),
		],
		// S[P]=!S[P]
		() => [
			exprStmt(assign(index(id(S), id(P)), un("!", index(id(S), id(P))))),
		],
		// var b=S[P--]; S[P]=S[P]&b
		() => [
			varDecl("b", index(id(S), update("--", false, id(P)))),
			exprStmt(
				assign(
					index(id(S), id(P)),
					bin("&", index(id(S), id(P)), id("b"))
				)
			),
		],
		// var b=S[P--]; S[P]=S[P]|b
		() => [
			varDecl("b", index(id(S), update("--", false, id(P)))),
			exprStmt(
				assign(
					index(id(S), id(P)),
					bin("|", index(id(S), id(P)), id("b"))
				)
			),
		],
		// S[P]=-S[P]
		() => [
			exprStmt(assign(index(id(S), id(P)), un("-", index(id(S), id(P))))),
		],
		// S[P]=+S[P]+1
		() => [
			exprStmt(
				assign(
					index(id(S), id(P)),
					bin("+", un("+", index(id(S), id(P))), lit(1))
				)
			),
		],
		// S[P]=typeof S[P]
		() => [
			exprStmt(
				assign(index(id(S), id(P)), un("typeof", index(id(S), id(P))))
			),
		],
		// P--
		() => [exprStmt(update("--", false, id(P)))],
		// S[P+1]=S[P]; P++
		() => [
			exprStmt(
				assign(
					index(id(S), bin("+", id(P), lit(1))),
					index(id(S), id(P))
				)
			),
			exprStmt(update("++", false, id(P))),
		],
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

// --- Stack encoding proxy (AST) ---

/**
 * Build the Proxy-based stack encoding wrapper as AST nodes.
 *
 * Wraps the raw stack array in a Proxy that XOR-encodes numeric values
 * on set and decodes on get. Transparent to all opcode handlers.
 *
 * @param n - Runtime identifier names
 * @returns Array of JsNode statements to insert into the function body
 */
function buildStackEncodingProxyAST(n: RuntimeNames): JsNode[] {
	const S = n.stk;
	const U = n.unit;

	// var _sek=(U.i.length^U.r^0x5A3C96E1)>>>0
	const sekInit = varDecl(
		"_sek",
		bin(
			">>>",
			bin(
				"^",
				bin(
					"^",
					member(member(id(U), "i"), "length"),
					member(id(U), "r")
				),
				lit(0x5a3c96e1)
			),
			lit(0)
		)
	);

	// var _seRaw=[]
	const seRawInit = varDecl("_seRaw", arr());

	// Helper: (_sek^(i*0x9E3779B9))>>>0
	const xorKey = (iVar: JsNode) =>
		bin(
			">>>",
			bin("^", id("_sek"), bin("*", iVar, lit(0x9e3779b9))),
			lit(0)
		);

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
								index(id("_seRaw"), id("i")),
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
										index(id("_seRaw"), id("i")),
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
												index(id("_seRaw"), id("i")),
												arr(lit(2), id("v"))
											)
										),
									],
									[
										// else{_seRaw[i]=[3,v];}
										exprStmt(
											assign(
												index(id("_seRaw"), id("i")),
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
				exprStmt(assign(index(id("_seRaw"), id("k")), id("v"))),
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
				varDecl("e", index(id("_seRaw"), id("i"))),
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
			returnStmt(member(id("_seRaw"), "length")),
		]),
		// return _seRaw[k]
		returnStmt(index(id("_seRaw"), id("k"))),
	];

	// S=new Proxy(_seRaw,{set:function(_,k,v){...},get:function(_,k){...}})
	const proxyAssign = exprStmt(
		assign(
			id(S),
			newExpr(id("Proxy"), [
				id("_seRaw"),
				obj(
					["set", fnExpr(undefined, ["_", "k", "v"], setBody)],
					["get", fnExpr(undefined, ["_", "k"], getBody)]
				),
			])
		)
	);

	return [sekInit, seRawInit, proxyAssign];
}
