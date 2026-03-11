/**
 * Debug protection builder — assembles the multi-layered anti-debugger IIFE as AST.
 *
 * Replaces the template-literal approach in runtime/templates/debug-protection.ts
 * with AST-based construction.  All six detection layers, escalating response
 * logic, and scheduler are built from structured AST nodes.
 *
 * Detection layers:
 *   1. Polymorphic debugger invocation with dual-clock timing
 *   2. Statistical jitter analysis (multiple rapid probes, variance check)
 *   3. Environment analysis (--inspect flags, stack trace anomalies)
 *   4. Function integrity self-verification (FNV-1a checksum of own source)
 *   5. Native API integrity (console methods, Function.prototype.toString)
 *   6. Global property trap canary (browser DevTools enumeration)
 *
 * Response escalation:
 *   Level 1-2: Silent bytecode instruction corruption (wrong opcode dispatch)
 *   Level 3-4: Cache wipe + constants array destruction
 *   Level 5+:  Infinite debugger loop (hard lockout)
 *
 * @module ruamvm/builders/debug-protection
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames, TempNames } from "../../encoding/names.js";
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
	debuggerStmt,
	newExpr,
	getter,
	method,
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
	return bin("&", left, right);
}

/** Bitwise unsigned right shift: `left >>> right` */
function ursh(left: JsNode, right: JsNode): JsNode {
	return bin(">>>", left, right);
}

// --- Builder ---

/**
 * Build the multi-layered anti-debugger protection IIFE as JsNode[].
 *
 * @param names - Per-build randomized runtime identifiers.
 * @returns A single-element array containing the IIFE call expression.
 */
export function buildDebugProtection(names: RuntimeNames, temps: TempNames): JsNode[] {
	const T = names.thresh;
	const BT = names.bt;
	const CA = names.cache;

	const dbgName = names.dbgProt;

	/** Shorthand for temp name lookup. */
	const Z = (key: string): string => temps[key]!;

	// Reusable ids
	const sevId = id(Z("_sev"));
	const btId = id(BT);
	const caId = id(CA);
	const dmId = id(Z("_dm"));
	const nowId = id(Z("_now"));
	const thId = id(Z("_th"));
	const tlId = id(Z("_tl"));
	const pbId = id(Z("_pb"));
	const fhId = id(Z("_fh"));
	const dbgId = id(dbgName);

	// --- Body statements ---
	const body: JsNode[] = [];

	// var T=100;
	body.push(v(T, lit(100)));

	// --- _dm: debugger methods array ---
	// Four CSP-safe polymorphic debugger triggers (no eval/Function).
	// Each hides `debugger` behind a different invocation path so automated
	// stripping tools can't pattern-match all four at once.
	body.push(
		v(
			Z("_dm"),
			arr(
				// Method 0: plain debugger statement
				fnExpr(undefined, [], [debuggerStmt()]),
				// Method 1: toString coercion trap
				// var _o={toString(){debugger;return "";}}; ""+_o;
				fnExpr(
					undefined,
					[],
					[
						v(
							Z("_o"),
							obj(
								method(
									"toString",
									[],
									[debuggerStmt(), returnStmt(lit(""))]
								)
							)
						),
						es(bin("+", lit(""), id(Z("_o")))),
					]
				),
				// Method 2: valueOf coercion trap
				// var _o={valueOf(){debugger;return 0;}}; +_o;
				fnExpr(
					undefined,
					[],
					[
						v(
							Z("_o"),
							obj(
								method(
									"valueOf",
									[],
									[debuggerStmt(), returnStmt(lit(0))]
								)
							)
						),
						es(un("+", id(Z("_o")))),
					]
				),
				// Method 3: getter trap
				// var _o={get v(){debugger;return 0;}}; _o.v;
				fnExpr(
					undefined,
					[],
					[
						v(
							Z("_o"),
							obj(
								getter("v", [
									debuggerStmt(),
									returnStmt(lit(0)),
								])
							)
						),
						es(m(id(Z("_o")), "v")),
					]
				)
			)
		)
	);

	// var _hr=(typeof performance!=='undefined'&&typeof performance.now==='function')?performance:null;
	body.push(
		v(
			Z("_hr"),
			ternary(
				bin(
					"&&",
					bin(
						"!==",
						un("typeof", id("performance")),
						lit("undefined")
					),
					bin(
						"===",
						un("typeof", m(id("performance"), "now")),
						lit("function")
					)
				),
				id("performance"),
				lit(null)
			)
		)
	);

	// var _now=_hr?function(){return _hr.now();}:Date.now;
	body.push(
		v(
			Z("_now"),
			ternary(
				id(Z("_hr")),
				fnExpr(
					undefined,
					[],
					[returnStmt(mcall(id(Z("_hr")), "now", []))]
				),
				m(id("Date"), "now")
			)
		)
	);

	// var _sev=0;
	body.push(v(Z("_sev"), lit(0)));

	// --- function _act() ---
	body.push(buildActFunction(sevId, btId, caId, Z));

	// --- function _p1() (dual-clock timing) ---
	body.push(buildP1(nowId, dmId, id(T), Z));

	// --- function _p2() (jitter analysis) ---
	body.push(buildP2(nowId, dmId, Z));

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
			bin("<", id(Z("_fi")), m(id(Z("_src")), "length")),
			assign(id(Z("_fi")), bin("+", id(Z("_fi")), lit(1))),
			[
				es(
					assign(
						fhId,
						ursh(
							bin(
								"*",
								ursh(
									bin(
										"^",
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

	// --- function _p5() (native API integrity) ---
	body.push(buildP5(Z));

	// --- Trap canary setup ---
	// var _th=0; var _tl=0;
	body.push(v(Z("_th"), lit(0)));
	body.push(v(Z("_tl"), lit(0)));

	// if(typeof window!=='undefined'){try{...}catch(_){}}
	body.push(
		ifStmt(bin("!==", un("typeof", id("window")), lit("undefined")), [
			tryCatch(
				[
					// var _gk='__'+Math.random().toString(36).slice(2,6);
					v(
						Z("_gk"),
						bin(
							"+",
							lit("__"),
							mcall(
								mcall(
									call(m(id("Math"), "random"), []),
									"toString",
									[lit(36)]
								),
								"slice",
								[lit(2), lit(6)]
							)
						)
					),
					// Object.defineProperty(window,_gk,{get:function(){_th++;return void 0;},configurable:true,enumerable:true});
					es(
						mcall(id("Object"), "defineProperty", [
							id("window"),
							id(Z("_gk")),
							obj(
								[
									"get",
									fnExpr(
										undefined,
										[],
										[
											es(
												assign(
													thId,
													bin("+", thId, lit(1))
												)
											),
											returnStmt(un("void", lit(0))),
										]
									),
								],
								["configurable", lit(true)],
								["enumerable", lit(true)]
							),
						])
					),
				],
				"_",
				[]
			),
		])
	);

	// --- function _p6() (trap canary check) ---
	body.push(buildP6(thId, tlId, Z));

	// var _pb=[_p1,_p2,_p3,_p4,_p5,_p6];
	body.push(
		v(
			Z("_pb"),
			arr(
				id(Z("_p1")),
				id(Z("_p2")),
				id(Z("_p3")),
				id(Z("_p4")),
				id(Z("_p5")),
				id(Z("_p6"))
			)
		)
	);

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
					"+",
					lit(500),
					bin(
						"|",
						bin("*", mcall(id("Math"), "random", []), lit(1500)),
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
				"&&",
				bin("===", un("typeof", id(Z("_it"))), lit("object")),
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
 */
function buildActFunction(sevId: JsNode, btId: JsNode, caId: JsNode, Z: (key: string) => string): JsNode {
	return fn(
		Z("_act"),
		[],
		[
			// _sev++;
			es(assign(sevId, bin("+", sevId, lit(1)))),
			// if(_sev<=2){...}
			ifStmt(
				bin("<=", sevId, lit(2)),
				[
					// try{var _ks=Object.keys(BT);for(var _ki=0;_ki<_ks.length;_ki++){...}}catch(_){}
					tryCatch(
						[
							v(Z("_ks"), mcall(id("Object"), "keys", [btId])),
							forStmt(
								v(Z("_ki"), lit(0)),
								bin("<", id(Z("_ki")), m(id(Z("_ks")), "length")),
								assign(id(Z("_ki")), bin("+", id(Z("_ki")), lit(1))),
								[
									v(
										Z("_ue"),
										index(btId, index(id(Z("_ks")), id(Z("_ki"))))
									),
									ifStmt(
										bin("&&", id(Z("_ue")), m(id(Z("_ue")), "i")),
										[
											forStmt(
												v(Z("_ji"), lit(0)),
												bin(
													"<",
													id(Z("_ji")),
													m(
														m(id(Z("_ue")), "i"),
														"length"
													)
												),
												assign(
													id(Z("_ji")),
													bin("+", id(Z("_ji")), lit(2))
												),
												[
													es(
														assign(
															index(
																m(
																	id(Z("_ue")),
																	"i"
																),
																id(Z("_ji"))
															),
															band(
																bin(
																	"+",
																	index(
																		m(
																			id(
																				Z("_ue")
																			),
																			"i"
																		),
																		id(
																			Z("_ji")
																		)
																	),
																	bin(
																		"*",
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
						bin("<=", sevId, lit(4)),
						[
							// try{for(var _k in CA)delete CA[_k];}catch(_){}
							tryCatch(
								[
									forIn(Z("_k"), caId, [
										es(un("delete", index(caId, id(Z("_k"))))),
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
											"<",
											id(Z("_ki")),
											m(id(Z("_ks")), "length")
										),
										assign(
											id(Z("_ki")),
											bin("+", id(Z("_ki")), lit(1))
										),
										[
											v(
												Z("_ue"),
												index(
													btId,
													index(id(Z("_ks")), id(Z("_ki")))
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
						// else{while(true){debugger;}}
						[whileStmt(lit(true), [debuggerStmt()])]
					),
				]
			),
		]
	);
}

/**
 * Build _p1() — polymorphic debugger invocation with dual-clock timing.
 */
function buildP1(nowId: JsNode, dmId: JsNode, threshId: JsNode, Z: (key: string) => string): JsNode {
	return fn(
		Z("_p1"),
		[],
		[
			// var _s1=_now();
			v(Z("_s1"), call(nowId, [])),
			// var _s2=Date.now();
			v(Z("_s2"), mcall(id("Date"), "now", [])),
			// _dm[(_s2&3)]();
			es(call(index(dmId, band(id(Z("_s2")), lit(3))), [])),
			// var _e1=_now()-_s1;
			v(Z("_e1"), bin("-", call(nowId, []), id(Z("_s1")))),
			// var _e2=Date.now()-_s2;
			v(Z("_e2"), bin("-", mcall(id("Date"), "now", []), id(Z("_s2")))),
			// return _e1>T||_e2>T;
			returnStmt(
				bin(
					"||",
					bin(">", id(Z("_e1")), threshId),
					bin(">", id(Z("_e2")), threshId)
				)
			),
		]
	);
}

/**
 * Build _p2() — statistical jitter analysis.
 */
function buildP2(nowId: JsNode, dmId: JsNode, Z: (key: string) => string): JsNode {
	const tsId = id(Z("_ts"));
	return fn(
		Z("_p2"),
		[],
		[
			// var _ts=[];
			v(Z("_ts"), arr()),
			// for(var _i=0;_i<3;_i++){var _s=_now();_dm[_i%_dm.length]();_ts.push(_now()-_s);}
			forStmt(
				v(Z("_i"), lit(0)),
				bin("<", id(Z("_i")), lit(3)),
				assign(id(Z("_i")), bin("+", id(Z("_i")), lit(1))),
				[
					v(Z("_s"), call(nowId, [])),
					es(
						call(
							index(dmId, bin("%", id(Z("_i")), m(dmId, "length"))),
							[]
						)
					),
					es(
						mcall(tsId, "push", [
							bin("-", call(nowId, []), id(Z("_s"))),
						])
					),
				]
			),
			// var _sm=0;
			v(Z("_sm"), lit(0)),
			// for(var _i=0;_i<_ts.length;_i++)_sm+=_ts[_i];
			forStmt(
				v(Z("_i"), lit(0)),
				bin("<", id(Z("_i")), m(tsId, "length")),
				assign(id(Z("_i")), bin("+", id(Z("_i")), lit(1))),
				[
					es(
						assign(
							id(Z("_sm")),
							bin("+", id(Z("_sm")), index(tsId, id(Z("_i"))))
						)
					),
				]
			),
			// var _av=_sm/_ts.length;
			v(Z("_av"), bin("/", id(Z("_sm")), m(tsId, "length"))),
			// var _vr=0;
			v(Z("_vr"), lit(0)),
			// for(var _i=0;_i<_ts.length;_i++){var _d=_ts[_i]-_av;_vr+=_d*_d;}
			forStmt(
				v(Z("_i"), lit(0)),
				bin("<", id(Z("_i")), m(tsId, "length")),
				assign(id(Z("_i")), bin("+", id(Z("_i")), lit(1))),
				[
					v(Z("_d"), bin("-", index(tsId, id(Z("_i"))), id(Z("_av")))),
					es(
						assign(
							id(Z("_vr")),
							bin("+", id(Z("_vr")), bin("*", id(Z("_d")), id(Z("_d"))))
						)
					),
				]
			),
			// return(_vr/_ts.length)>500||_av>50;
			returnStmt(
				bin(
					"||",
					bin(">", bin("/", id(Z("_vr")), m(tsId, "length")), lit(500)),
					bin(">", id(Z("_av")), lit(50))
				)
			),
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
						bin("||", m(newExpr(id("Error"), []), "stack"), lit(""))
					),
					ifStmt(
						mcall(lit(/--inspect|--debug/i), "test", [id(Z("_st"))]),
						[returnStmt(lit(true))]
					),
				],
				"_",
				[]
			),
			// if(typeof process!=='undefined'){try{if(process.execArgv){for(...)}}catch(_){}}
			ifStmt(bin("!==", un("typeof", id("process")), lit("undefined")), [
				tryCatch(
					[
						ifStmt(m(id("process"), "execArgv"), [
							forStmt(
								v(Z("_i"), lit(0)),
								bin(
									"<",
									id(Z("_i")),
									m(m(id("process"), "execArgv"), "length")
								),
								assign(id(Z("_i")), bin("+", id(Z("_i")), lit(1))),
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
			]),
			// return false;
			returnStmt(lit(false)),
		]
	);
}

/**
 * Build _p4() — function integrity self-verification (FNV-1a).
 */
function buildP4(dbgId: JsNode, fhId: JsNode, Z: (key: string) => string): JsNode {
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
				bin("<", id(Z("_ci")), m(id(Z("_cs")), "length")),
				assign(id(Z("_ci")), bin("+", id(Z("_ci")), lit(1))),
				[
					es(
						assign(
							id(Z("_ch")),
							bin(
								">>>",
								bin(
									"*",
									bin(
										">>>",
										bin(
											"^",
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
			returnStmt(bin("!==", id(Z("_ch")), fhId)),
		]
	);
}

/**
 * Build _p5() — native API integrity (console methods + Function.prototype.toString).
 */
function buildP5(Z: (key: string) => string): JsNode {
	return fn(
		Z("_p5"),
		[],
		[
			tryCatch(
				[
					// if(typeof console==='undefined')return false;
					ifStmt(
						bin(
							"===",
							un("typeof", id("console")),
							lit("undefined")
						),
						[returnStmt(lit(false))]
					),
					// var _nc='[native code]';
					v(Z("_nc"), lit("[native code]")),
					// var _fn=['log','warn','error','table','dir','trace','clear'];
					v(
						Z("_fn"),
						arr(
							lit("log"),
							lit("warn"),
							lit("error"),
							lit("table"),
							lit("dir"),
							lit("trace"),
							lit("clear")
						)
					),
					// for(var _i=0;_i<_fn.length;_i++){...}
					forStmt(
						v(Z("_i"), lit(0)),
						bin("<", id(Z("_i")), m(id(Z("_fn")), "length")),
						assign(id(Z("_i")), bin("+", id(Z("_i")), lit(1))),
						[
							// if(typeof console[_fn[_i]]==='function'){...}
							ifStmt(
								bin(
									"===",
									un(
										"typeof",
										index(
											id("console"),
											index(id(Z("_fn")), id(Z("_i")))
										)
									),
									lit("function")
								),
								[
									// var _ts=Function.prototype.toString.call(console[_fn[_i]]);
									v(
										Z("_ts"),
										call(
											m(
												m(
													m(
														id("Function"),
														"prototype"
													),
													"toString"
												),
												"call"
											),
											[
												index(
													id("console"),
													index(id(Z("_fn")), id(Z("_i")))
												),
											]
										)
									),
									// if(_ts.indexOf(_nc)===-1)return true;
									ifStmt(
										bin(
											"===",
											mcall(id(Z("_ts")), "indexOf", [
												id(Z("_nc")),
											]),
											lit(-1)
										),
										[returnStmt(lit(true))]
									),
								]
							),
						]
					),
					// var _ft=Function.prototype.toString.toString();
					v(
						Z("_ft"),
						mcall(
							m(m(id("Function"), "prototype"), "toString"),
							"toString",
							[]
						)
					),
					// if(_ft.indexOf(_nc)===-1)return true;
					ifStmt(
						bin(
							"===",
							mcall(id(Z("_ft")), "indexOf", [id(Z("_nc"))]),
							lit(-1)
						),
						[returnStmt(lit(true))]
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
 * Build _p6() — global property trap canary.
 */
function buildP6(thId: JsNode, tlId: JsNode, Z: (key: string) => string): JsNode {
	return fn(
		Z("_p6"),
		[],
		[
			// var _d=_th-_tl;
			v(Z("_d"), bin("-", thId, tlId)),
			// _tl=_th;
			es(assign(tlId, thId)),
			// return _d>3;
			returnStmt(bin(">", id(Z("_d")), lit(3))),
		]
	);
}

/**
 * Build _run() — main detection loop with random probe selection and setTimeout recursion.
 */
function buildRun(pbId: JsNode, sevId: JsNode, Z: (key: string) => string): JsNode {
	return fn(
		Z("_run"),
		[],
		[
			// var _n=2+((Math.random()*2)|0);
			v(
				Z("_n"),
				bin(
					"+",
					lit(2),
					bin(
						"|",
						bin("*", mcall(id("Math"), "random", []), lit(2)),
						lit(0)
					)
				)
			),
			// var _det=false;
			v(Z("_det"), lit(false)),
			// for(var _i=0;_i<_n;_i++){var _idx=(Math.random()*_pb.length)|0;try{if(_pb[_idx]()){_det=true;break;}}catch(_){}}
			forStmt(
				v(Z("_i"), lit(0)),
				bin("<", id(Z("_i")), id(Z("_n"))),
				assign(id(Z("_i")), bin("+", id(Z("_i")), lit(1))),
				[
					v(
						Z("_idx"),
						bin(
							"|",
							bin(
								"*",
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
			// if(_det)_act();
			ifStmt(id(Z("_det")), [es(call(id(Z("_act")), []))]),
			// if(_sev<5){var _nx=2000+((Math.random()*5000)|0);var _tid=setTimeout(_run,_nx);if(typeof _tid==='object'&&_tid.unref)_tid.unref();}
			ifStmt(bin("<", sevId, lit(5)), [
				v(
					Z("_nx"),
					bin(
						"+",
						lit(2000),
						bin(
							"|",
							bin(
								"*",
								mcall(id("Math"), "random", []),
								lit(5000)
							),
							lit(0)
						)
					)
				),
				v(Z("_tid"), call(id("setTimeout"), [id(Z("_run")), id(Z("_nx"))])),
				ifStmt(
					bin(
						"&&",
						bin("===", un("typeof", id(Z("_tid"))), lit("object")),
						m(id(Z("_tid")), "unref")
					),
					[es(mcall(id(Z("_tid")), "unref", []))]
				),
			]),
		]
	);
}
