/**
 * Debug protection builder — assembles the multi-layered anti-debugger IIFE as AST.
 *
 * Replaces the template-literal approach in runtime/templates/debug-protection.ts
 * with AST-based construction.  All six detection layers, escalating response
 * logic, and scheduler are built from structured AST nodes.
 *
 * No `debugger` statements are used — fully CSP/TrustedScript compatible.
 *
 * Detection layers:
 *   1. Built-in prototype integrity (Object/Array/JSON method monkey-patch detection)
 *   2. Environment analysis (--inspect flags, stack trace anomalies)
 *   3. Function integrity self-verification (FNV-1a checksum of own source)
 *
 * Response escalation:
 *   Level 1-2: Silent bytecode instruction corruption (wrong opcode dispatch)
 *   Level 3-4: Cache wipe + constants array destruction
 *   Level 5+:  Total bytecode annihilation + infinite busy loop
 *
 * @module ruamvm/builders/debug-protection
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames, TempNames } from "../../naming/compat-types.js";
import {
	fn,
	varDecl,
	id,
	lit,
	bin,
	un,
	call,
	member,
	index,
	ifStmt,
	exprStmt,
	returnStmt,
	forStmt,
	forIn,
	whileStmt,
	tryCatch,
	ternary,
	arr,
	obj,
	fnExpr,
	assign,
	newExpr,
	getter,
	method,
	BOp,
	UOp,
} from "../nodes.js";

// --- Helpers ---

/** Shorthand: `a.b(args)` */
function mcall(object: JsNode, prop: string, args: JsNode[]): JsNode {
	return call(member(object, prop), args);
}

/** Shorthand: `a.b` */
function m(object: JsNode, prop: string): JsNode {
	return member(object, prop);
}

/** Shorthand: `var name; (with no init)` */
function v(name: string, init?: JsNode): JsNode {
	return varDecl(name, init);
}

/** Shorthand: expression statement */
function es(expr: JsNode): JsNode {
	return exprStmt(expr);
}

/** Bitwise AND: `left & right` */
function band(left: JsNode, right: JsNode): JsNode {
	return bin(BOp.BitAnd, left, right);
}

/** Bitwise unsigned right shift: `left >>> right` */
function ursh(left: JsNode, right: JsNode): JsNode {
	return bin(BOp.Ushr, left, right);
}

// --- Builder ---

/**
 * Build the multi-layered anti-debugger protection IIFE as JsNode[].
 *
 * @param names - Per-build randomized runtime identifiers.
 * @returns A single-element array containing the IIFE call expression.
 */
export function buildDebugProtection(
	names: RuntimeNames,
	temps: TempNames
): JsNode[] {
	const BT = names.bt;
	const CA = names.cache;

	const dbgName = names.dbgProt;

	/** Shorthand for temp name lookup. */
	const Z = (key: string): string => temps[key]!;

	// Reusable ids
	const sevId = id(Z("_sev"));
	const btId = id(BT);
	const caId = id(CA);
	const pbId = id(Z("_pb"));
	const fhId = id(Z("_fh"));
	const dbgId = id(dbgName);

	// --- Body statements ---
	const body: JsNode[] = [];

	// var _sev=0;
	body.push(v(Z("_sev"), lit(0)));
	// var _dc=0; (detection count — must reach threshold before escalating)
	body.push(v(Z("_d"), lit(0)));

	// --- function _act() ---
	body.push(buildActFunction(sevId, btId, caId, Z));

	// --- function _p1() (built-in prototype integrity) ---
	body.push(buildP1(Z));

	// --- function _p3() (environment analysis) ---
	body.push(buildP3(Z));

	// --- FNV-1a hash computation of own toString ---
	// var _src=<dbgName>.toString();
	body.push(v(Z("_src"), mcall(dbgId, "toString", [])));
	// var _fh=0x811C9DC5;
	body.push(v(Z("_fh"), lit(0x811c9dc5)));
	// for(var _fi=0;_fi<_src.length;_fi++){_fh=((_fh^_src.charCodeAt(_fi))>>>0)*0x01000193>>>0;}
	body.push(
		forStmt(
			v(Z("_fi"), lit(0)),
			bin(BOp.Lt, id(Z("_fi")), m(id(Z("_src")), "length")),
			assign(id(Z("_fi")), bin(BOp.Add, id(Z("_fi")), lit(1))),
			[
				es(
					assign(
						fhId,
						ursh(
							bin(
								BOp.Mul,
								ursh(
									bin(
										BOp.BitXor,
										fhId,
										mcall(id(Z("_src")), "charCodeAt", [
											id(Z("_fi")),
										])
									),
									lit(0)
								),
								lit(0x01000193)
							),
							lit(0)
						)
					)
				),
			]
		)
	);

	// --- function _p4() (integrity self-check) ---
	body.push(buildP4(dbgId, fhId, Z));

	// var _pb=[_p1,_p3,_p4];
	body.push(v(Z("_pb"), arr(id(Z("_p1")), id(Z("_p3")), id(Z("_p4")))));

	// --- function _run() ---
	body.push(buildRun(pbId, sevId, Z));

	// --- Initial setTimeout ---
	// var _it=setTimeout(function(){_run();},500+((Math.random()*1500)|0));
	body.push(
		v(
			Z("_it"),
			call(id("setTimeout"), [
				fnExpr(undefined, [], [es(call(id(Z("_run")), []))]),
				bin(
					BOp.Add,
					lit(500),
					bin(
						BOp.BitOr,
						bin(
							BOp.Mul,
							mcall(id("Math"), "random", []),
							lit(1500)
						),
						lit(0)
					)
				),
			])
		)
	);

	// if(typeof _it==='object'&&_it.unref)_it.unref();
	body.push(
		ifStmt(
			bin(
				BOp.And,
				bin(BOp.Seq, un(UOp.Typeof, id(Z("_it"))), lit("object")),
				m(id(Z("_it")), "unref")
			),
			[es(mcall(id(Z("_it")), "unref", []))]
		)
	);

	// Wrap in IIFE: (function dbgName(){...body...})();
	return [exprStmt(call(fnExpr(dbgName, [], body), []))];
}

// --- Sub-builders ---

/**
 * Build _act() — escalating response function.
 *
 * Level 1-2: Silent bytecode instruction corruption
 * Level 3-4: Cache wipe + constants array destruction
 * Level 5+:  Total bytecode annihilation + infinite busy loop (no debugger statements)
 */
function buildActFunction(
	sevId: JsNode,
	btId: JsNode,
	caId: JsNode,
	Z: (key: string) => string
): JsNode {
	return fn(
		Z("_act"),
		[],
		[
			// _sev++;
			es(assign(sevId, bin(BOp.Add, sevId, lit(1)))),
			// if(_sev<=2){...}
			ifStmt(
				bin(BOp.Lte, sevId, lit(2)),
				[
					// try{var _ks=Object.keys(BT);for(var _ki=0;_ki<_ks.length;_ki++){...}}catch(_){}
					tryCatch(
						[
							v(Z("_ks"), mcall(id("Object"), "keys", [btId])),
							forStmt(
								v(Z("_ki"), lit(0)),
								bin(
									BOp.Lt,
									id(Z("_ki")),
									m(id(Z("_ks")), "length")
								),
								assign(
									id(Z("_ki")),
									bin(BOp.Add, id(Z("_ki")), lit(1))
								),
								[
									v(
										Z("_ue"),
										index(
											btId,
											index(id(Z("_ks")), id(Z("_ki")))
										)
									),
									ifStmt(
										bin(
											BOp.And,
											id(Z("_ue")),
											m(id(Z("_ue")), "i")
										),
										[
											forStmt(
												v(Z("_ji"), lit(0)),
												bin(
													BOp.Lt,
													id(Z("_ji")),
													m(
														m(id(Z("_ue")), "i"),
														"length"
													)
												),
												assign(
													id(Z("_ji")),
													bin(
														BOp.Add,
														id(Z("_ji")),
														lit(2)
													)
												),
												[
													es(
														assign(
															index(
																m(
																	id(
																		Z("_ue")
																	),
																	"i"
																),
																id(Z("_ji"))
															),
															band(
																bin(
																	BOp.Add,
																	index(
																		m(
																			id(
																				Z(
																					"_ue"
																				)
																			),
																			"i"
																		),
																		id(
																			Z(
																				"_ji"
																			)
																		)
																	),
																	bin(
																		BOp.Mul,
																		sevId,
																		lit(7)
																	)
																),
																lit(0xffff)
															)
														)
													),
												]
											),
										]
									),
								]
							),
						],
						"_",
						[]
					),
				],
				// else if(_sev<=4){...}
				[
					ifStmt(
						bin(BOp.Lte, sevId, lit(4)),
						[
							// try{for(var _k in CA)delete CA[_k];}catch(_){}
							tryCatch(
								[
									forIn(Z("_k"), caId, [
										es(
											un(
												UOp.Delete,
												index(caId, id(Z("_k")))
											)
										),
									]),
								],
								"_",
								[]
							),
							// try{var _ks=Object.keys(BT);for(var _ki=0;_ki<_ks.length;_ki++){var _ue=BT[_ks[_ki]];if(_ue)_ue.c=[];}}catch(_){}
							tryCatch(
								[
									v(
										Z("_ks"),
										mcall(id("Object"), "keys", [btId])
									),
									forStmt(
										v(Z("_ki"), lit(0)),
										bin(
											BOp.Lt,
											id(Z("_ki")),
											m(id(Z("_ks")), "length")
										),
										assign(
											id(Z("_ki")),
											bin(BOp.Add, id(Z("_ki")), lit(1))
										),
										[
											v(
												Z("_ue"),
												index(
													btId,
													index(
														id(Z("_ks")),
														id(Z("_ki"))
													)
												)
											),
											ifStmt(id(Z("_ue")), [
												es(
													assign(
														m(id(Z("_ue")), "c"),
														arr()
													)
												),
											]),
										]
									),
								],
								"_",
								[]
							),
						],
						// else { total annihilation — zero out all instruction arrays + constants + infinite busy loop }
						[
							// Wipe all bytecode entries completely
							tryCatch(
								[
									v(
										Z("_ks"),
										mcall(id("Object"), "keys", [btId])
									),
									forStmt(
										v(Z("_ki"), lit(0)),
										bin(
											BOp.Lt,
											id(Z("_ki")),
											m(id(Z("_ks")), "length")
										),
										assign(
											id(Z("_ki")),
											bin(BOp.Add, id(Z("_ki")), lit(1))
										),
										[
											v(
												Z("_ue"),
												index(
													btId,
													index(
														id(Z("_ks")),
														id(Z("_ki"))
													)
												)
											),
											ifStmt(id(Z("_ue")), [
												// Zero out instructions
												es(
													assign(
														m(id(Z("_ue")), "i"),
														arr()
													)
												),
												// Wipe constants
												es(
													assign(
														m(id(Z("_ue")), "c"),
														arr()
													)
												),
											]),
										]
									),
								],
								"_",
								[]
							),
							// Wipe cache
							tryCatch(
								[
									forIn(Z("_k"), caId, [
										es(
											un(
												UOp.Delete,
												index(caId, id(Z("_k")))
											)
										),
									]),
								],
								"_",
								[]
							),
							// Infinite busy loop — freezes the JS thread
							// while(true){_sev++;}
							whileStmt(lit(true), [
								es(assign(sevId, bin(BOp.Add, sevId, lit(1)))),
							]),
						]
					),
				]
			),
		]
	);
}

/**
 * Build _p1() — Built-in prototype integrity check.
 *
 * Detects monkey-patching of core Object/Array/JSON methods, a common
 * technique used by reverse engineers to intercept VM operations.
 * Complementary to _p5() which checks console methods.
 *
 * Fully CSP/TrustedScript safe — no console, eval, or debugger usage.
 */
function buildP1(Z: (key: string) => string): JsNode {
	return fn(
		Z("_p1"),
		[],
		[
			tryCatch(
				[
					// var _nc='[native code]';
					v(Z("_nc"), lit("[native code]")),
					// var _fn=[Object.keys,Object.defineProperty,Array.prototype.push,Array.prototype.slice,JSON.stringify];
					v(
						Z("_fn"),
						arr(
							m(id("Object"), "keys"),
							m(id("Object"), "defineProperty"),
							m(m(id("Array"), "prototype"), "push"),
							m(m(id("Array"), "prototype"), "slice"),
							m(id("JSON"), "stringify")
						)
					),
					// for(var _i=0;_i<_fn.length;_i++){
					forStmt(
						v(Z("_i"), lit(0)),
						bin(BOp.Lt, id(Z("_i")), m(id(Z("_fn")), "length")),
						assign(id(Z("_i")), bin(BOp.Add, id(Z("_i")), lit(1))),
						[
							// var _ts=Function.prototype.toString.call(_fn[_i]);
							v(
								Z("_ts"),
								call(
									m(
										m(
											m(id("Function"), "prototype"),
											"toString"
										),
										"call"
									),
									[index(id(Z("_fn")), id(Z("_i")))]
								)
							),
							// if(_ts.indexOf(_nc)===-1)return true;
							ifStmt(
								bin(
									BOp.Seq,
									mcall(id(Z("_ts")), "indexOf", [
										id(Z("_nc")),
									]),
									lit(-1)
								),
								[returnStmt(lit(true))]
							),
						]
					),
				],
				"_",
				[]
			),
			// return false;
			returnStmt(lit(false)),
		]
	);
}

/**
 * Build _p3() — environment analysis (--inspect flags, stack traces).
 */
function buildP3(Z: (key: string) => string): JsNode {
	return fn(
		Z("_p3"),
		[],
		[
			// try{var _st=(new Error()).stack||'';if(/--inspect|--debug/i.test(_st))return true;}catch(_){}
			tryCatch(
				[
					v(
						Z("_st"),
						bin(
							BOp.Or,
							m(newExpr(id("Error"), []), "stack"),
							lit("")
						)
					),
					ifStmt(
						mcall(lit(/--inspect|--debug/i), "test", [
							id(Z("_st")),
						]),
						[returnStmt(lit(true))]
					),
				],
				"_",
				[]
			),
			// if(typeof process!=='undefined'){try{if(process.execArgv){for(...)}}catch(_){}}
			ifStmt(
				bin(BOp.Sneq, un(UOp.Typeof, id("process")), lit("undefined")),
				[
					tryCatch(
						[
							ifStmt(m(id("process"), "execArgv"), [
								forStmt(
									v(Z("_i"), lit(0)),
									bin(
										BOp.Lt,
										id(Z("_i")),
										m(
											m(id("process"), "execArgv"),
											"length"
										)
									),
									assign(
										id(Z("_i")),
										bin(BOp.Add, id(Z("_i")), lit(1))
									),
									[
										ifStmt(
											mcall(
												lit(/--inspect|--debug/),
												"test",
												[
													index(
														m(
															id("process"),
															"execArgv"
														),
														id(Z("_i"))
													),
												]
											),
											[returnStmt(lit(true))]
										),
									]
								),
							]),
						],
						"_",
						[]
					),
				]
			),
			// return false;
			returnStmt(lit(false)),
		]
	);
}

/**
 * Build _p4() — function integrity self-verification (FNV-1a).
 */
function buildP4(
	dbgId: JsNode,
	fhId: JsNode,
	Z: (key: string) => string
): JsNode {
	return fn(
		Z("_p4"),
		[],
		[
			// var _cs=<dbgName>.toString();
			v(Z("_cs"), mcall(dbgId, "toString", [])),
			// var _ch=0x811C9DC5;
			v(Z("_ch"), lit(0x811c9dc5)),
			// for(var _ci=0;_ci<_cs.length;_ci++){_ch=((_ch^_cs.charCodeAt(_ci))>>>0)*0x01000193>>>0;}
			forStmt(
				v(Z("_ci"), lit(0)),
				bin(BOp.Lt, id(Z("_ci")), m(id(Z("_cs")), "length")),
				assign(id(Z("_ci")), bin(BOp.Add, id(Z("_ci")), lit(1))),
				[
					es(
						assign(
							id(Z("_ch")),
							bin(
								BOp.Ushr,
								bin(
									BOp.Mul,
									bin(
										BOp.Ushr,
										bin(
											BOp.BitXor,
											id(Z("_ch")),
											mcall(id(Z("_cs")), "charCodeAt", [
												id(Z("_ci")),
											])
										),
										lit(0)
									),
									lit(0x01000193)
								),
								lit(0)
							)
						)
					),
				]
			),
			// return _ch!==_fh;
			returnStmt(bin(BOp.Sneq, id(Z("_ch")), fhId)),
		]
	);
}

/**
 * Build _run() — main detection loop with random probe selection and setTimeout recursion.
 */
function buildRun(
	pbId: JsNode,
	sevId: JsNode,
	Z: (key: string) => string
): JsNode {
	return fn(
		Z("_run"),
		[],
		[
			// var _n=2+((Math.random()*2)|0);
			v(
				Z("_n"),
				bin(
					BOp.Add,
					lit(2),
					bin(
						BOp.BitOr,
						bin(BOp.Mul, mcall(id("Math"), "random", []), lit(2)),
						lit(0)
					)
				)
			),
			// var _det=false;
			v(Z("_det"), lit(false)),
			// for(var _i=0;_i<_n;_i++){var _idx=(Math.random()*_pb.length)|0;try{if(_pb[_idx]()){_det=true;break;}}catch(_){}}
			forStmt(
				v(Z("_i"), lit(0)),
				bin(BOp.Lt, id(Z("_i")), id(Z("_n"))),
				assign(id(Z("_i")), bin(BOp.Add, id(Z("_i")), lit(1))),
				[
					v(
						Z("_idx"),
						bin(
							BOp.BitOr,
							bin(
								BOp.Mul,
								mcall(id("Math"), "random", []),
								m(pbId, "length")
							),
							lit(0)
						)
					),
					tryCatch(
						[
							ifStmt(call(index(pbId, id(Z("_idx"))), []), [
								es(assign(id(Z("_det")), lit(true))),
								{ type: "BreakStmt" } as JsNode,
							]),
						],
						"_",
						[]
					),
				]
			),
			// if(_det){_d++;if(_d>=3)_act();}else{_d=0;}
			// Require 3 consecutive detection rounds before escalating.
			// A single false positive (e.g. DevTools open, sidebar) resets on next clean round.
			ifStmt(
				id(Z("_det")),
				[
					es(assign(id(Z("_d")), bin(BOp.Add, id(Z("_d")), lit(1)))),
					ifStmt(bin(BOp.Gte, id(Z("_d")), lit(3)), [
						es(call(id(Z("_act")), [])),
					]),
				],
				// else: reset detection counter (transient false positive)
				[es(assign(id(Z("_d")), lit(0)))]
			),
			// if(_sev<5){var _nx=2000+((Math.random()*5000)|0);var _tid=setTimeout(_run,_nx);if(typeof _tid==='object'&&_tid.unref)_tid.unref();}
			ifStmt(bin(BOp.Lt, sevId, lit(5)), [
				v(
					Z("_nx"),
					bin(
						BOp.Add,
						lit(2000),
						bin(
							BOp.BitOr,
							bin(
								BOp.Mul,
								mcall(id("Math"), "random", []),
								lit(5000)
							),
							lit(0)
						)
					)
				),
				v(
					Z("_tid"),
					call(id("setTimeout"), [id(Z("_run")), id(Z("_nx"))])
				),
				ifStmt(
					bin(
						BOp.And,
						bin(
							BOp.Seq,
							un(UOp.Typeof, id(Z("_tid"))),
							lit("object")
						),
						m(id(Z("_tid")), "unref")
					),
					[es(mcall(id(Z("_tid")), "unref", []))]
				),
			]),
		]
	);
}
