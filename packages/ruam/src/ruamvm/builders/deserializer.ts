/**
 * Deserializer builder — assembles the binary bytecode deserializer as AST nodes.
 *
 * Produces a single function declaration that reads a compact binary
 * `Uint8Array` format back into a bytecode unit object at runtime.
 *
 * The reader is structured as an object with shorthand methods, making it
 * look like a utility class rather than a binary parser. All internal names
 * (properties, methods, locals) are randomized via TempNames.
 *
 * @module ruamvm/builders/deserializer
 */

import type { JsNode, ObjectEntry } from "../nodes.js";
import type { RuntimeNames, TempNames } from "../../encoding/names.js";
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
	method,
	exprStmt,
	returnStmt,
	forStmt,
	switchStmt,
	caseClause,
	breakStmt,
	block,
	update,
} from "../nodes.js";

// --- Builder ---

/**
 * Build the binary bytecode deserializer function as JsNode[].
 *
 * Produces a single function declaration that reads a compact binary
 * `Uint8Array` format back into a bytecode unit object at runtime.
 * Internal structure uses an object with shorthand methods (class-like
 * pattern) and all names are randomized via TempNames.
 *
 * @param names - Per-build randomized runtime identifiers.
 * @param temps - Per-build randomized temp name mapping.
 * @returns A single-element array containing the deserializer function.
 */
export function buildDeserializer(
	names: RuntimeNames,
	temps: TempNames
): JsNode[] {
	const bytes = id("bytes");
	const TRUE = lit(true);

	// --- Temp name lookups ---
	const T = (key: string): string => {
		const name = temps[key];
		if (name === undefined) throw new Error(`Unknown temp: ${key}`);
		return name;
	};

	// Reader object variable and property/method names
	const DR = T("_dr"); // reader object
	const DV = T("_dv"); // DataView property
	const DOF = T("_dof"); // offset property
	const DU8 = T("_du8"); // readU8 method
	const DU16 = T("_du16"); // readU16 method
	const DU32 = T("_du32"); // readU32 method
	const DI32 = T("_di32"); // readI32 method
	const DF64 = T("_df64"); // readF64 method
	const DRS = T("_drs"); // readStr method

	// Parser local variable names
	const FL = T("_dfl"); // flags
	const PC = T("_dpc"); // param count
	const RC = T("_drc"); // register count
	const CC = T("_dcc"); // constant count
	const CS = T("_dcs"); // constants array
	const IC = T("_dic"); // instruction count
	const IN = T("_din"); // instructions array

	// Switch-case locals (must use temp names to avoid collisions
	// with obfuscateLocals which can rename 3+ char vars to 2-char
	// names that clash with hardcoded locals in the same function scope)
	const DTAG = T("_dtag"); // constant tag
	const DEL = T("_del"); // encoded string length
	const DEA = T("_dea"); // encoded string array
	const DEI = T("_dei"); // encoded string index

	// Shorthand: reader.method() call
	const rdr = id(DR);
	const rcall = (m: string, args: JsNode[] = []): JsNode =>
		call(member(rdr, m), args);
	// Shorthand: this.prop
	const tprop = (p: string): JsNode => member(id("this"), p);
	// Shorthand: this.method() from within a method body
	const tcall = (m: string, args: JsNode[] = []): JsNode =>
		call(member(id("this"), m), args);

	// --- Function body ---
	const body: JsNode[] = [];

	// --- Build reader object with shorthand methods ---

	const readerEntries: ObjectEntry[] = [
		// v: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
		[
			DV,
			newExpr(id("DataView"), [
				member(bytes, "buffer"),
				member(bytes, "byteOffset"),
				member(bytes, "byteLength"),
			]),
		],
		// o: 0
		[DOF, lit(0)],

		// u8() { return this.v.getUint8(this.o++); }
		method(DU8, [], [
			returnStmt(
				call(member(tprop(DV), "getUint8"), [
					update("++", false, tprop(DOF)),
				])
			),
		]),

		// u16() { var x=this.v.getUint16(this.o,true); this.o+=2; return x; }
		method(DU16, [], [
			varDecl("x", call(member(tprop(DV), "getUint16"), [tprop(DOF), TRUE])),
			exprStmt(assign(tprop(DOF), lit(2), "+")),
			returnStmt(id("x")),
		]),

		// u32() { var x=this.v.getUint32(this.o,true); this.o+=4; return x; }
		method(DU32, [], [
			varDecl("x", call(member(tprop(DV), "getUint32"), [tprop(DOF), TRUE])),
			exprStmt(assign(tprop(DOF), lit(4), "+")),
			returnStmt(id("x")),
		]),

		// i32() { var x=this.v.getInt32(this.o,true); this.o+=4; return x; }
		method(DI32, [], [
			varDecl("x", call(member(tprop(DV), "getInt32"), [tprop(DOF), TRUE])),
			exprStmt(assign(tprop(DOF), lit(4), "+")),
			returnStmt(id("x")),
		]),

		// f64() { var x=this.v.getFloat64(this.o,true); this.o+=8; return x; }
		method(DF64, [], [
			varDecl(
				"x",
				call(member(tprop(DV), "getFloat64"), [tprop(DOF), TRUE])
			),
			exprStmt(assign(tprop(DOF), lit(8), "+")),
			returnStmt(id("x")),
		]),

		// str() { var n=this.u32(); var a=[]; for(var i=0;i<n;i++){a.push(this.u8());} return String.fromCharCode.apply(null,a); }
		method(DRS, [], [
			varDecl("n", tcall(DU32)),
			varDecl("a", { type: "ArrayExpr", elements: [] }),
			forStmt(
				varDecl("i", lit(0)),
				bin("<", id("i"), id("n")),
				update("++", false, id("i")),
				[
					exprStmt(
						call(member(id("a"), "push"), [tcall(DU8)])
					),
				]
			),
			returnStmt(
				call(
					member(member(id("String"), "fromCharCode"), "apply"),
					[lit(null), id("a")]
				)
			),
		]),
	];

	// var r = { v: ..., o: 0, u8() {...}, ... };
	body.push(varDecl(DR, obj(...readerEntries)));

	// --- Header reads ---

	// readU8() — skip version byte
	body.push(exprStmt(rcall(DU8)));
	// var fl=r.u16();
	body.push(varDecl(FL, rcall(DU16)));
	// var pc=r.u16();
	body.push(varDecl(PC, rcall(DU16)));
	// var rc=r.u16();
	body.push(varDecl(RC, rcall(DU16)));
	// var cc=r.u32();
	body.push(varDecl(CC, rcall(DU32)));

	// var cs=[];
	body.push(varDecl(CS, { type: "ArrayExpr", elements: [] }));

	// --- Constant pool loop ---

	const constants = id(CS);
	const push = (arg: JsNode): JsNode =>
		call(member(constants, "push"), [arg]);
	const flags = id(FL);

	// Build switch cases for constant pool tags
	const cases: JsNode[] = [];

	// case 0: cs.push(null); break;
	cases.push(caseClause(lit(0), [exprStmt(push(lit(null))), breakStmt()]));
	// case 1: cs.push(void 0); break;
	cases.push(
		caseClause(lit(1), [exprStmt(push(un("void", lit(0)))), breakStmt()])
	);
	// case 2: cs.push(false); break;
	cases.push(caseClause(lit(2), [exprStmt(push(lit(false))), breakStmt()]));
	// case 3: cs.push(true); break;
	cases.push(caseClause(lit(3), [exprStmt(push(lit(true))), breakStmt()]));
	// case 4: cs.push(r.v.getInt8(r.o)); r.o+=1; break;
	cases.push(
		caseClause(lit(4), [
			exprStmt(
				push(
					call(member(member(rdr, DV), "getInt8"), [member(rdr, DOF)])
				)
			),
			exprStmt(assign(member(rdr, DOF), lit(1), "+")),
			breakStmt(),
		])
	);
	// case 5: cs.push(r.v.getInt16(r.o,true)); r.o+=2; break;
	cases.push(
		caseClause(lit(5), [
			exprStmt(
				push(
					call(member(member(rdr, DV), "getInt16"), [
						member(rdr, DOF),
						TRUE,
					])
				)
			),
			exprStmt(assign(member(rdr, DOF), lit(2), "+")),
			breakStmt(),
		])
	);
	// case 6: cs.push(r.i32()); break;
	cases.push(
		caseClause(lit(6), [exprStmt(push(rcall(DI32))), breakStmt()])
	);
	// case 7: cs.push(r.f64()); break;
	cases.push(
		caseClause(lit(7), [exprStmt(push(rcall(DF64))), breakStmt()])
	);
	// case 8: cs.push(BigInt(r.str())); break;
	cases.push(
		caseClause(lit(8), [
			exprStmt(push(call(id("BigInt"), [rcall(DRS)]))),
			breakStmt(),
		])
	);
	// case 9: { var p=r.str(); var f=r.str(); cs.push(new RegExp(p,f)); break; }
	cases.push(
		caseClause(lit(9), [
			block(
				varDecl("p", rcall(DRS)),
				varDecl("f", rcall(DRS)),
				exprStmt(push(newExpr(id("RegExp"), [id("p"), id("f")]))),
				breakStmt()
			),
		])
	);
	// case 11: { var _del=r.u16(); var _dea=[]; for(var _dei=0;_dei<_del;_dei++){_dea.push(r.u16());} cs.push(_dea); break; }
	cases.push(
		caseClause(lit(11), [
			block(
				varDecl(DEL, rcall(DU16)),
				varDecl(DEA, { type: "ArrayExpr", elements: [] }),
				forStmt(
					varDecl(DEI, lit(0)),
					bin("<", id(DEI), id(DEL)),
					update("++", false, id(DEI)),
					[
						exprStmt(
							call(member(id(DEA), "push"), [rcall(DU16)])
						),
					]
				),
				exprStmt(push(id(DEA))),
				breakStmt()
			),
		])
	);
	// default: cs.push(r.str()); break;
	cases.push(
		caseClause(null, [exprStmt(push(rcall(DRS))), breakStmt()])
	);

	// for(var i=0;i<cc;i++){var _dtag=r.u8();switch(_dtag){...}}
	body.push(
		forStmt(
			varDecl("i", lit(0)),
			bin("<", id("i"), id(CC)),
			update("++", false, id("i")),
			[
				varDecl(DTAG, rcall(DU8)),
				switchStmt(
					id(DTAG),
					cases as ReturnType<typeof caseClause>[]
				),
			]
		)
	);

	// --- Instruction array ---

	// var ic=r.u32();
	body.push(varDecl(IC, rcall(DU32)));

	// var ins=new Array(ic*2);
	body.push(
		varDecl(IN, newExpr(id("Array"), [bin("*", id(IC), lit(2))]))
	);

	// for(var i=0;i<ic;i++){ins[i*2]=r.u16();ins[i*2+1]=r.i32();}
	const iMul2 = bin("*", id("i"), lit(2));
	const iMul2Plus1 = bin("+", bin("*", id("i"), lit(2)), lit(1));
	body.push(
		forStmt(
			varDecl("i", lit(0)),
			bin("<", id("i"), id(IC)),
			update("++", false, id("i")),
			[
				exprStmt(assign(index(id(IN), iMul2), rcall(DU16))),
				exprStmt(assign(index(id(IN), iMul2Plus1), rcall(DI32))),
			]
		)
	);

	// --- Return object ---

	// return {c:cs,i:ins,r:rc,sl:0,p:pc,g:!!(fl&1),s:!!(fl&2),st:!!(fl&4),a:!!(fl&8)};
	const band = (v: JsNode, mask: number): JsNode =>
		un("!", un("!", bin("&", v, lit(mask))));
	body.push(
		returnStmt(
			obj(
				["c", constants],
				["i", id(IN)],
				["r", id(RC)],
				["sl", lit(0)],
				["p", id(PC)],
				["g", band(flags, 1)],
				["s", band(flags, 2)],
				["st", band(flags, 4)],
				["a", band(flags, 8)]
			)
		)
	);

	return [fn(names.deser, ["bytes"], body)];
}
