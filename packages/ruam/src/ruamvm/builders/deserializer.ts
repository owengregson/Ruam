/**
 * Deserializer builder — assembles the binary bytecode deserializer as AST nodes.
 *
 * Produces a single function declaration that reads a compact binary
 * `Uint8Array` format back into a bytecode unit object at runtime.
 * The function parses the version byte, flags, parameter/register counts,
 * the tagged constant pool, and the interleaved instruction array
 * (opcode u16 + operand i32 pairs).
 *
 * @module ruamvm/builders/deserializer
 */

import type { JsNode } from "../nodes.js";
import type { RuntimeNames } from "../../encoding/names.js";
import {
	fn,
	varDecl,
	id,
	lit,
	bin,
	un,
	assign,
	call,
	member,
	index,
	newExpr,
	obj,
	exprStmt,
	returnStmt,
	forStmt,
	switchStmt,
	caseClause,
	breakStmt,
	block,
	update,
} from "../nodes.js";

// --- Helpers ---

/** Shorthand for `call(member(obj, prop), args)`. */
const mcall = (o: JsNode, prop: string, args: JsNode[]): JsNode =>
	call(member(o, prop), args);

/** `a & b` */
const band = (a: JsNode, b: JsNode): JsNode => bin("&", a, b);

// --- Builder ---

/**
 * Build the binary bytecode deserializer function as JsNode[].
 *
 * Produces a single function declaration that reads a compact binary
 * `Uint8Array` format back into a bytecode unit object at runtime.
 * The function parses the version byte, flags, parameter/register counts,
 * the tagged constant pool, and the interleaved instruction array
 * (opcode u16 + operand i32 pairs).
 *
 * @param names - Per-build randomized runtime identifiers.
 * @returns A single-element array containing the deserializer function.
 */
export function buildDeserializer(names: RuntimeNames): JsNode[] {
	const bytes = id("bytes");
	const view = id("view");
	const offset = id("offset");
	const TRUE = lit(true);

	// --- Function body ---

	const body: JsNode[] = [];

	// var view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
	body.push(
		varDecl(
			"view",
			newExpr(id("DataView"), [
				member(bytes, "buffer"),
				member(bytes, "byteOffset"),
				member(bytes, "byteLength"),
			])
		)
	);

	// var offset=0;
	body.push(varDecl("offset", lit(0)));

	// --- Inner helper functions ---

	// function readU8(){return view.getUint8(offset++);}
	body.push(
		fn(
			"readU8",
			[],
			[returnStmt(mcall(view, "getUint8", [update("++", false, offset)]))]
		)
	);

	// function readU16(){var v=view.getUint16(offset,true);offset+=2;return v;}
	body.push(
		fn(
			"readU16",
			[],
			[
				varDecl("v", mcall(view, "getUint16", [offset, TRUE])),
				exprStmt(assign(offset, lit(2), "+")),
				returnStmt(id("v")),
			]
		)
	);

	// function readU32(){var v=view.getUint32(offset,true);offset+=4;return v;}
	body.push(
		fn(
			"readU32",
			[],
			[
				varDecl("v", mcall(view, "getUint32", [offset, TRUE])),
				exprStmt(assign(offset, lit(4), "+")),
				returnStmt(id("v")),
			]
		)
	);

	// function readI32(){var v=view.getInt32(offset,true);offset+=4;return v;}
	body.push(
		fn(
			"readI32",
			[],
			[
				varDecl("v", mcall(view, "getInt32", [offset, TRUE])),
				exprStmt(assign(offset, lit(4), "+")),
				returnStmt(id("v")),
			]
		)
	);

	// function readF64(){var v=view.getFloat64(offset,true);offset+=8;return v;}
	body.push(
		fn(
			"readF64",
			[],
			[
				varDecl("v", mcall(view, "getFloat64", [offset, TRUE])),
				exprStmt(assign(offset, lit(8), "+")),
				returnStmt(id("v")),
			]
		)
	);

	// function readStr(){var len=readU32();var s='';for(var i=0;i<len;i++){s+=String.fromCharCode(readU8());}return s;}
	body.push(
		fn(
			"readStr",
			[],
			[
				varDecl("len", call(id("readU32"), [])),
				varDecl("s", lit("")),
				forStmt(
					varDecl("i", lit(0)),
					bin("<", id("i"), id("len")),
					update("++", false, id("i")),
					[
						exprStmt(
							assign(
								id("s"),
								call(member(id("String"), "fromCharCode"), [
									call(id("readU8"), []),
								]),
								"+"
							)
						),
					]
				),
				returnStmt(id("s")),
			]
		)
	);

	// --- Header reads ---

	// var version=readU8();
	body.push(varDecl("version", call(id("readU8"), [])));
	// var flags=readU16();
	body.push(varDecl("flags", call(id("readU16"), [])));
	// var pCount=readU16();
	body.push(varDecl("pCount", call(id("readU16"), [])));
	// var rCount=readU16();
	body.push(varDecl("rCount", call(id("readU16"), [])));
	// var cCount=readU32();
	body.push(varDecl("cCount", call(id("readU32"), [])));

	// var constants=[];
	body.push(varDecl("constants", { type: "ArrayExpr", elements: [] }));

	// --- Constant pool loop ---

	const constants = id("constants");
	const push = (arg: JsNode): JsNode => mcall(constants, "push", [arg]);
	const flags = id("flags");

	// Build switch cases for constant pool tags
	const cases: JsNode[] = [];

	// case 0: constants.push(null); break;
	cases.push(caseClause(lit(0), [exprStmt(push(lit(null))), breakStmt()]));
	// case 1: constants.push(void 0); break;
	cases.push(
		caseClause(lit(1), [exprStmt(push(un("void", lit(0)))), breakStmt()])
	);
	// case 2: constants.push(false); break;
	cases.push(caseClause(lit(2), [exprStmt(push(lit(false))), breakStmt()]));
	// case 3: constants.push(true); break;
	cases.push(caseClause(lit(3), [exprStmt(push(lit(true))), breakStmt()]));
	// case 4: constants.push(view.getInt8(offset)); offset+=1; break;
	cases.push(
		caseClause(lit(4), [
			exprStmt(push(mcall(view, "getInt8", [offset]))),
			exprStmt(assign(offset, lit(1), "+")),
			breakStmt(),
		])
	);
	// case 5: constants.push(view.getInt16(offset,true)); offset+=2; break;
	cases.push(
		caseClause(lit(5), [
			exprStmt(push(mcall(view, "getInt16", [offset, TRUE]))),
			exprStmt(assign(offset, lit(2), "+")),
			breakStmt(),
		])
	);
	// case 6: constants.push(readI32()); break;
	cases.push(
		caseClause(lit(6), [
			exprStmt(push(call(id("readI32"), []))),
			breakStmt(),
		])
	);
	// case 7: constants.push(readF64()); break;
	cases.push(
		caseClause(lit(7), [
			exprStmt(push(call(id("readF64"), []))),
			breakStmt(),
		])
	);
	// case 8: constants.push(BigInt(readStr())); break;
	cases.push(
		caseClause(lit(8), [
			exprStmt(push(call(id("BigInt"), [call(id("readStr"), [])]))),
			breakStmt(),
		])
	);
	// case 9: { var p=readStr(); var f=readStr(); constants.push(new RegExp(p,f)); break; }
	cases.push(
		caseClause(lit(9), [
			block(
				varDecl("p", call(id("readStr"), [])),
				varDecl("f", call(id("readStr"), [])),
				exprStmt(push(newExpr(id("RegExp"), [id("p"), id("f")]))),
				breakStmt()
			),
		])
	);
	// case 11: { var elen=readU16(); var earr=[]; for(var ei=0;ei<elen;ei++){earr.push(readU16());} constants.push(earr); break; }
	cases.push(
		caseClause(lit(11), [
			block(
				varDecl("elen", call(id("readU16"), [])),
				varDecl("earr", { type: "ArrayExpr", elements: [] }),
				forStmt(
					varDecl("ei", lit(0)),
					bin("<", id("ei"), id("elen")),
					update("++", false, id("ei")),
					[
						exprStmt(
							mcall(id("earr"), "push", [
								call(id("readU16"), []),
							])
						),
					]
				),
				exprStmt(push(id("earr"))),
				breakStmt()
			),
		])
	);
	// default: constants.push(readStr()); break;
	cases.push(
		caseClause(null, [exprStmt(push(call(id("readStr"), []))), breakStmt()])
	);

	// for(var i=0;i<cCount;i++){var tag=readU8();switch(tag){...}}
	body.push(
		forStmt(
			varDecl("i", lit(0)),
			bin("<", id("i"), id("cCount")),
			update("++", false, id("i")),
			[
				varDecl("tag", call(id("readU8"), [])),
				switchStmt(id("tag"), cases as ReturnType<typeof caseClause>[]),
			]
		)
	);

	// --- Instruction array ---

	// var iCount=readU32();
	body.push(varDecl("iCount", call(id("readU32"), [])));

	// var instrs=new Array(iCount*2);
	body.push(
		varDecl(
			"instrs",
			newExpr(id("Array"), [bin("*", id("iCount"), lit(2))])
		)
	);

	// for(var i=0;i<iCount;i++){instrs[i*2]=readU16();instrs[i*2+1]=readI32();}
	const iMul2 = bin("*", id("i"), lit(2));
	const iMul2Plus1 = bin("+", bin("*", id("i"), lit(2)), lit(1));
	body.push(
		forStmt(
			varDecl("i", lit(0)),
			bin("<", id("i"), id("iCount")),
			update("++", false, id("i")),
			[
				exprStmt(
					assign(index(id("instrs"), iMul2), call(id("readU16"), []))
				),
				exprStmt(
					assign(
						index(id("instrs"), iMul2Plus1),
						call(id("readI32"), [])
					)
				),
			]
		)
	);

	// --- Flag extraction ---

	// var isGen=!!(flags&1);
	body.push(varDecl("isGen", un("!", un("!", band(flags, lit(1))))));
	// var isAsync=!!(flags&2);
	body.push(varDecl("isAsync", un("!", un("!", band(flags, lit(2))))));
	// var isStrict=!!(flags&4);
	body.push(varDecl("isStrict", un("!", un("!", band(flags, lit(4))))));
	// var isArrow=!!(flags&8);
	body.push(varDecl("isArrow", un("!", un("!", band(flags, lit(8))))));

	// --- Return object ---

	// return {c:constants,i:instrs,r:rCount,sl:0,p:pCount,g:isGen,s:isAsync,st:isStrict,a:isArrow};
	body.push(
		returnStmt(
			obj(
				["c", constants],
				["i", id("instrs")],
				["r", id("rCount")],
				["sl", lit(0)],
				["p", id("pCount")],
				["g", id("isGen")],
				["s", id("isAsync")],
				["st", id("isStrict")],
				["a", id("isArrow")]
			)
		)
	);

	return [fn(names.deser, ["bytes"], body)];
}
