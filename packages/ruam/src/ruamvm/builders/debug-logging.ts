/**
 * Debug logging builder — assembles the debug config, logging function,
 * and opcode trace function as AST nodes.
 *
 * Produces three declarations:
 * - Debug config object (enabled flag, log level, opcode name table)
 * - General-purpose debug log function (rate-limited console.log wrapper)
 * - Opcode trace function (detailed per-instruction trace output)
 *
 * @module ruamvm/builders/debug-logging
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames, TempNames } from "../../encoding/names.js";
import {
	fn,
	varDecl,
	id,
	lit,
	bin,
	obj,
	arr,
	spread,
	member,
	index,
	call,
	ifStmt,
	exprStmt,
	returnStmt,
	assign,
	ternary,
	un,
} from "../nodes.js";
import { Op, OPCODE_COUNT } from "../../compiler/opcodes.js";

// --- Builder ---

/**
 * Build the debug logging infrastructure as JsNode[].
 *
 * Produces three declarations:
 * - Debug config object (enabled flag, log level, opcode name table)
 * - General-purpose debug log function (rate-limited console.log wrapper)
 * - Opcode trace function (detailed per-instruction trace output)
 *
 * @param reverseMap - Physical-to-logical opcode mapping (index = physical, value = logical).
 * @param names - Randomized runtime identifier names.
 * @returns An array of JsNode containing the config var and two function declarations.
 */
export function buildDebugLogging(
	reverseMap: number[],
	names: RuntimeNames,
	temps: TempNames
): JsNode[] {
	// --- Build opcode name table: physical opcode -> name string ---

	const opNames = Object.entries(Op)
		.filter(
			([, v]) => typeof v === "number" && (v as number) < OPCODE_COUNT
		)
		.reduce((m, [name, num]) => {
			m[num as number] = name;
			return m;
		}, {} as Record<number, string>);

	const nameEntries: [string, JsNode][] = [];
	for (let phys = 0; phys < reverseMap.length; phys++) {
		const logical = reverseMap[phys]!;
		const name = opNames[logical] ?? `OP_${logical}`;
		nameEntries.push([String(phys), lit(name)]);
	}

	// --- Shorthand aliases for readability ---

	const O = names.operand;
	const S = names.stk;
	const P = names.stp;
	const OP = names.opVar;
	const cfg = names.dbgCfg;

	// Helper accessors
	const cfgId = id(cfg);
	const cfgEnabled = member(cfgId, "enabled");
	const cfgCount = member(cfgId, temps["_count"]!);
	const cfgMaxLogs = member(cfgId, "maxLogs");
	const cfgOpNames = member(cfgId, temps["_opNames"]!);
	const cfgLevel = member(cfgId, "level");
	const cfgLevels = member(cfgId, "levels");
	const console_ = id("console");

	// --- Config object ---
	// var cfg={enabled:true,level:'trace',filter:null,maxLogs:10000,_count:0,_opNames:{...},levels:{trace:0,info:1,warn:2,error:3}}

	const configNode = varDecl(
		cfg,
		obj(
			["enabled", lit(true)],
			["level", lit("trace")],
			["filter", lit(null)],
			["maxLogs", lit(10000)],
			[temps["_count"]!, lit(0)],
			[temps["_opNames"]!, obj(...nameEntries)],
			[
				"levels",
				obj(
					["trace", lit(0)],
					["info", lit(1)],
					["warn", lit(2)],
					["error", lit(3)]
				),
			]
		)
	);

	// --- General debug log function ---
	// function dbg(){
	//   if(!cfg.enabled)return;
	//   if(cfg._count>=cfg.maxLogs){
	//     if(cfg._count===cfg.maxLogs){console.warn('[VM_DBG] max logs reached ('+cfg.maxLogs+'), silencing');cfg._count++;}
	//     return;
	//   }
	//   cfg._count++;
	//   var args=Array.prototype.slice.call(arguments);
	//   console.log.apply(console,['[VM_DBG]'].concat(args));
	// }

	const dbgFn = fn(
		names.dbg,
		[],
		[
			// if(!cfg.enabled)return;
			ifStmt(un("!", cfgEnabled), [returnStmt()]),
			// if(cfg._count>=cfg.maxLogs){...return;}
			ifStmt(bin(">=", cfgCount, cfgMaxLogs), [
				// if(cfg._count===cfg.maxLogs){console.warn(...);cfg._count++;}
				ifStmt(bin("===", cfgCount, cfgMaxLogs), [
					exprStmt(
						call(member(console_, "warn"), [
							bin(
								"+",
								bin(
									"+",
									lit("[VM_DBG] max logs reached ("),
									cfgMaxLogs
								),
								lit("), silencing")
							),
						])
					),
					exprStmt(assign(cfgCount, bin("+", cfgCount, lit(1)))),
				]),
				returnStmt(),
			]),
			// cfg._count++;
			exprStmt(assign(cfgCount, bin("+", cfgCount, lit(1)))),
			// var args=[...arguments];
			varDecl("args", arr(spread(id("arguments")))),
			// console.log('[VM_DBG]',...args);
			exprStmt(
				call(member(console_, "log"), [
					lit("[VM_DBG]"),
					spread(id("args")),
				])
			),
		]
	);

	// --- Opcode trace function ---
	// function dbgOp(OP,O,C,P,S){
	//   if(!cfg.enabled||cfg.levels[cfg.level]>0)return;
	//   if(cfg._count>=cfg.maxLogs)return;
	//   cfg._count++;
	//   var name=cfg._opNames[OP]||('OP_'+OP);
	//   var topStr='(empty)';
	//   if(P>=0){
	//     var top=S[P];
	//     topStr=typeof top==='function'?'[fn'+(top.name?':'+top.name:'')+']':typeof top==='object'&&top!==null?'[obj:'+Object.keys(top).slice(0,3).join(',')+']':String(top);
	//     if(topStr.length>60)topStr=topStr.slice(0,60)+'...';
	//   }
	//   var constStr='';
	//   if(typeof C[O]==='string')constStr=' c="'+C[O].slice(0,30)+'"';
	//   else if(typeof C[O]==='number')constStr=' c='+C[O];
	//   console.log('[VM_TRACE] '+name+' op='+O+constStr+' sp='+P+' top='+topStr);
	// }

	const opId = id(OP);
	const oId = id(O);
	const cId = id("C");
	const pId = id(P);
	const sId = id(S);
	const nameVar = id("name");
	const topStrVar = id("topStr");
	const topVar = id("top");
	const constStrVar = id("constStr");
	const cAtO = index(cId, oId);

	const dbgOpFn = fn(
		names.dbgOp,
		[OP, O, "C", P, S],
		[
			// if(!cfg.enabled||cfg.levels[cfg.level]>0)return;
			ifStmt(
				bin(
					"||",
					un("!", cfgEnabled),
					bin(">", index(cfgLevels, cfgLevel), lit(0))
				),
				[returnStmt()]
			),
			// if(cfg._count>=cfg.maxLogs)return;
			ifStmt(bin(">=", cfgCount, cfgMaxLogs), [returnStmt()]),
			// cfg._count++;
			exprStmt(assign(cfgCount, bin("+", cfgCount, lit(1)))),
			// var name=cfg._opNames[OP]||('OP_'+OP);
			varDecl(
				"name",
				bin("||", index(cfgOpNames, opId), bin("+", lit("OP_"), opId))
			),
			// var topStr='(empty)';
			varDecl("topStr", lit("(empty)")),
			// if(P>=0){...}
			ifStmt(bin(">=", pId, lit(0)), [
				// var top=S[P];
				varDecl("top", index(sId, pId)),
				// topStr = typeof top==='function' ? '[fn'+(top.name?':'+top.name:'')+']'
				//        : typeof top==='object'&&top!==null ? '[obj:'+Object.keys(top).slice(0,3).join(',')+']'
				//        : String(top);
				exprStmt(
					assign(
						topStrVar,
						ternary(
							bin("===", un("typeof", topVar), lit("function")),
							// '[fn'+(top.name?':'+top.name:'')+']'
							bin(
								"+",
								bin(
									"+",
									lit("[fn"),
									ternary(
										member(topVar, "name"),
										bin(
											"+",
											lit(":"),
											member(topVar, "name")
										),
										lit("")
									)
								),
								lit("]")
							),
							// typeof top==='object'&&top!==null ? '[obj:'+...+']' : String(top)
							ternary(
								bin(
									"&&",
									bin(
										"===",
										un("typeof", topVar),
										lit("object")
									),
									bin("!==", topVar, lit(null))
								),
								// '[obj:'+Object.keys(top).slice(0,3).join(',')+']'
								bin(
									"+",
									bin(
										"+",
										lit("[obj:"),
										call(
											member(
												call(
													member(
														call(
															member(
																id("Object"),
																"keys"
															),
															[topVar]
														),
														"slice"
													),
													[lit(0), lit(3)]
												),
												"join"
											),
											[lit(",")]
										)
									),
									lit("]")
								),
								// String(top)
								call(id("String"), [topVar])
							)
						)
					)
				),
				// if(topStr.length>60)topStr=topStr.slice(0,60)+'...';
				ifStmt(bin(">", member(topStrVar, "length"), lit(60)), [
					exprStmt(
						assign(
							topStrVar,
							bin(
								"+",
								call(member(topStrVar, "slice"), [
									lit(0),
									lit(60),
								]),
								lit("...")
							)
						)
					),
				]),
			]),
			// var constStr='';
			varDecl("constStr", lit("")),
			// if(typeof C[O]==='string')constStr=' c="'+C[O].slice(0,30)+'"';
			ifStmt(
				bin("===", un("typeof", cAtO), lit("string")),
				[
					exprStmt(
						assign(
							constStrVar,
							bin(
								"+",
								bin(
									"+",
									lit(' c="'),
									call(member(cAtO, "slice"), [
										lit(0),
										lit(30),
									])
								),
								lit('"')
							)
						)
					),
				],
				[
					// else if(typeof C[O]==='number')constStr=' c='+C[O];
					ifStmt(bin("===", un("typeof", cAtO), lit("number")), [
						exprStmt(
							assign(constStrVar, bin("+", lit(" c="), cAtO))
						),
					]),
				]
			),
			// console.log('[VM_TRACE] '+name+' op='+O+constStr+' sp='+P+' top='+topStr);
			exprStmt(
				call(member(console_, "log"), [
					bin(
						"+",
						bin(
							"+",
							bin(
								"+",
								bin(
									"+",
									bin(
										"+",
										bin(
											"+",
											bin(
												"+",
												bin(
													"+",
													lit("[VM_TRACE] "),
													nameVar
												),
												lit(" op=")
											),
											oId
										),
										constStrVar
									),
									lit(" sp=")
								),
								pId
							),
							lit(" top=")
						),
						topStrVar
					),
				])
			),
		]
	);

	return [configNode, dbgFn, dbgOpFn];
}
