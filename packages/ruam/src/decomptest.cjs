#!/usr/bin/env node
"use strict";

// ── PASTE _c72lg3 HERE ────────────────────────────────────────────────────────
var _c72lg3 = {};
// ─────────────────────────────────────────────────────────────────────────────

function computeKey() {
	// NOTE: original _pwf uses plain JS * (float64 multiply), NOT Math.imul.
	// This causes intentional integer overflow/precision loss. Must match exactly.
	var h = 1597463007;
	h ^= Array.prototype.reduce.length << 24;
	h ^= String.prototype.charCodeAt.length << 20;
	h ^= Math.floor.length << 16;
	h ^= Object.keys.length << 12;
	h ^= JSON.stringify.length << 8;
	h ^= parseInt.length << 4;
	h = (h ^ (h >>> 16)) * 73244475;
	h = (h ^ (h >>> 13)) * 73244475;
	h = h ^ (h >>> 16);
	return (h >>> 0).toString(16);
}

function rc4(data, key) {
	const S = Array.from({ length: 256 }, (_, i) => i);
	let j = 0;
	for (let i = 0; i < 256; i++) {
		j = (j + S[i] + key.charCodeAt(i % key.length)) & 255;
		[S[i], S[j]] = [S[j], S[i]];
	}
	let i = 0;
	j = 0;
	return data.map((b) => {
		i = (i + 1) & 255;
		j = (j + S[i]) & 255;
		[S[i], S[j]] = [S[j], S[i]];
		return b ^ S[(S[i] + S[j]) & 255];
	});
}

function b64ToBytes(str) {
	return Array.from(Buffer.from(str, "base64"));
}

function parseBytecode(bytes) {
	const buf = Buffer.from(bytes);
	let o = 0;
	const u8 = () => buf.readUInt8(o++);
	const u16 = () => {
		const v = buf.readUInt16LE(o);
		o += 2;
		return v;
	};
	const u32 = () => {
		const v = buf.readUInt32LE(o);
		o += 4;
		return v;
	};
	const i32 = () => {
		const v = buf.readInt32LE(o);
		o += 4;
		return v;
	};
	const f64 = () => {
		const v = buf.readDoubleLE(o);
		o += 8;
		return v;
	};
	const str = () => {
		const len = u32();
		let s = "";
		for (let i = 0; i < len; i++) s += String.fromCharCode(u8());
		return s;
	};

	const version = u8();
	const flags = u16();
	const pCount = u16();
	const rCount = u16();
	const cCount = u32();

	const constants = [];
	for (let i = 0; i < cCount; i++) {
		const tag = u8();
		switch (tag) {
			case 0:
				constants.push(null);
				break;
			case 1:
				constants.push(undefined);
				break;
			case 2:
				constants.push(false);
				break;
			case 3:
				constants.push(true);
				break;
			case 4:
				constants.push(buf.readInt8(o++));
				break;
			case 5: {
				const v = buf.readInt16LE(o);
				o += 2;
				constants.push(v);
				break;
			}
			case 6:
				constants.push(i32());
				break;
			case 7:
				constants.push(f64());
				break;
			case 8:
				constants.push(BigInt(str()));
				break;
			case 9: {
				const p = str();
				const f = str();
				constants.push(`/${p}/${f}`);
				break;
			}
			default:
				constants.push(str());
				break;
		}
	}

	const iCount = u32();
	const rawInstrs = [];
	for (let i = 0; i < iCount; i++) {
		rawInstrs.push(u16(), i32());
	}
	// Every payload has a fixed 12-byte trailer after the instruction stream.
	// [0,0,0,0, 0,0,0,0, 255,255,255,255] - likely an integrity/padding footer added
	// by the obfuscator. Skip it; it is not part of the _cb bytecode format.

	return {
		version,
		flags,
		pCount,
		rCount,
		constants,
		rawInstrs,
		isGen: !!(flags & 1),
		isAsync: !!(flags & 2),
		isStrict: !!(flags & 4),
		isArrow: !!(flags & 8),
	};
}

const LK = 3462986424;

function reS(bc) {
	let h = 2166136261;
	h = Math.imul(h ^ ((bc.rawInstrs.length / 2) >>> 0), 16777619);
	h = Math.imul(h ^ bc.rCount, 16777619);
	h = Math.imul(h ^ bc.pCount, 16777619);
	h = Math.imul(h ^ bc.constants.length, 16777619);
	h ^= h >>> 16;
	h = Math.imul(h, 73244475);
	h ^= h >>> 13;
	return ((h >>> 0) ^ LK) >>> 0;
}

function odsj(s, a, b) {
	let h = s;
	h = Math.imul(h ^ a, 2246822507) >>> 0;
	h = Math.imul(h ^ b, 3266489909) >>> 0;
	return (h ^ (h >>> 16)) >>> 0;
}

function descramble(bc) {
	const xip = reS(bc);
	const instrs = [];
	for (let i = 0; i < bc.rawInstrs.length; i += 2) {
		const pos = i / 2;
		const zs = odsj(xip, pos, (pos ^ 2654435769) >>> 0);
		instrs.push({
			pos,
			op: (bc.rawInstrs[i] ^ (zs & 0xffff)) & 0xffff,
			arg: (bc.rawInstrs[i + 1] ^ zs) | 0,
		});
	}
	return instrs;
}

const OP = {
	26: "LOAD_CONST",
	244: "PUSH_UNDEF",
	102: "PUSH_NULL",
	30: "PUSH_TRUE",
	222: "PUSH_FALSE",
	8: "PUSH_EMPTYSTR",
	122: "POP",
	25: "DUP",
	184: "SWAP2",
	22: "ROT3",
	230: "ADD",
	188: "SUB",
	194: "MOD",
	187: "MUL",
	165: "XOR",
	172: "SHL",
	18: "SHR",
	242: "OR",
	195: "BITNOT",
	178: "NEG",
	112: "NEG",
	288: "NOT",
	6: "NOT",
	224: "EQ",
	10: "NEQ",
	148: "LT",
	93: "GT",
	267: "JUMP",
	70: "JMP_TRUE",
	154: "JMP_FALSE",
	269: "JMP_NULLISH",
	110: "RETURN",
	136: "RETURN_UNDEF",
	78: "THROW",
	24: "LOAD_LOCAL",
	160: "STORE_LOCAL",
	162: "LOAD_PARAM",
	173: "STORE_REGA",
	116: "STORE_REGB",
	98: "LOAD_REGA",
	38: "LOAD_REGB",
	281: "POST_INC_LOC",
	225: "ADD_ASSIGN_LOC",
	113: "INC_TOP",
	251: "LOAD_VAR",
	206: "STORE_VAR",
	45: "DECLARE_VAR",
	169: "PUSH_SCOPE",
	213: "POP_SCOPE",
	69: "TYPEOF_VAR",
	168: "TYPEOF",
	91: "INC_VAR",
	80: "GET_PROP",
	270: "SET_PROP",
	120: "GET_ELEM",
	177: "SET_ELEM",
	13: "DELETE_ELEM",
	208: "INSTANCEOF",
	134: "NEW_OBJ",
	95: "NEW_ARR",
	233: "ARR_PUSH",
	159: "SPREAD_INTO",
	156: "MAKE_SPREAD",
	277: "CALL",
	157: "CALL_METHOD",
	118: "NEW",
	79: "MAKE_FUNC",
	231: "MAKE_CLASS",
	192: "SET_METHOD",
	179: "TRY_PUSH",
	246: "TRY_POP",
	291: "DESTRUCTURE",
	75: "FOR_IN_INIT",
	150: "FOR_IN_NEXT",
	175: "FOR_IN_DONE",
	299: "CMP_LT_REGS",
	252: "CMP_EQ_REGS",
	167: "LOAD_REG_PROP",
	46: "POP",
	196: "POP",
	234: "POP",
	265: "POP",
	140: "VOID_TOP",
	241: "PUSH_THIS",
	247: "PUSH_ARGS",
};

function fmtVal(v) {
	if (v === null) return "null";
	if (v === undefined) return "undefined";
	if (typeof v === "string") return JSON.stringify(v).slice(0, 80);
	return String(v);
}

function lift(id, bc, instrs) {
	const C = bc.constants;
	const out = [];
	const meta = [
		bc.isAsync && "async",
		bc.isGen && "generator",
		bc.isArrow && "arrow",
		bc.isStrict && "strict",
	].filter(Boolean);

	out.push("=".repeat(72));
	out.push(`FUNCTION  ${id}   [${meta.join(", ") || "normal"}]`);
	out.push(
		`  params=${bc.pCount}  locals=${bc.rCount}  constants=${C.length}  instrs=${instrs.length}`
	);
	out.push("");
	out.push("  -- Constant Pool --");
	C.forEach((v, i) =>
		out.push(`    C[${String(i).padStart(3)}] = ${fmtVal(v)}`)
	);
	out.push("");
	out.push("  -- Instructions --");

	for (const { pos, op, arg } of instrs) {
		const name = (OP[op] || `UNKNOWN_${op}`).padEnd(20);
		let detail = "";
		switch (op) {
			case 26:
				detail = `C[${arg}] = ${fmtVal(C[arg])}`;
				break;
			case 80:
				detail = `.${C[arg]}`;
				break;
			case 270:
				detail = `.${C[arg]} = <tos>`;
				break;
			case 251:
				detail = `"${C[arg]}"`;
				break;
			case 206:
				detail = `"${C[arg]}" = <tos>`;
				break;
			case 45:
				detail = `declare "${C[arg]}"`;
				break;
			case 69:
				detail = `typeof "${C[arg]}"`;
				break;
			case 91:
				detail = `"${C[arg]}"++`;
				break;
			case 79:
				detail = `-> func ${C[arg]}`;
				break;
			case 192: {
				const nm = C[arg & 0xffff],
					st = (arg >> 16) & 1;
				detail = `"${nm}" static=${st}`;
				break;
			}
			case 167: {
				const r = arg & 0xffff,
					ni = (arg >>> 16) & 0xffff;
				detail = `reg[${r}].${C[ni]}`;
				break;
			}
			case 299: {
				const ra = arg & 0xffff,
					rb = (arg >>> 16) & 0xffff;
				detail = `reg[${ra}] < reg[${rb}]`;
				break;
			}
			case 252: {
				const ra = arg & 0xffff,
					rb = (arg >>> 16) & 0xffff;
				detail = `reg[${ra}] === reg[${rb}]`;
				break;
			}
			case 179: {
				const ct = (arg >> 16) & 0xffff,
					fn = arg & 0xffff;
				detail = `catch->[${ct === 0xffff ? "none" : ct}] finally->[${
					fn === 0xffff ? "none" : fn
				}]`;
				break;
			}
			case 267:
			case 70:
			case 154:
			case 269:
				detail = `-> [${arg}]`;
				break;
			case 277:
			case 157:
				detail = `argc=${Math.abs(arg)} spread=${arg < 0}`;
				break;
			case 118:
				detail = `argc=${arg}`;
				break;
			case 24:
			case 160:
			case 281:
			case 225:
				detail = `local[${arg}]`;
				break;
			case 162:
				detail = `param[${arg}]`;
				break;
			case 173:
			case 116:
			case 98:
			case 38:
				detail = `reg[${arg}]`;
				break;
			default:
				if (arg !== 0) detail = `arg=${arg}`;
		}
		out.push(`    [${String(pos).padStart(4, "0")}] ${name} ${detail}`);
	}

	out.push("");
	return out.join("\n");
}

function main() {
	if (Object.keys(_c72lg3).length === 0) {
		console.error(
			"Paste your _c72lg3 payload into the slot at the top of this file, then re-run."
		);
		process.exit(1);
	}

	const key = computeKey();
	console.log(`RC4 key (_pwf): ${key}\n`);

	const sections = [];
	for (const [id, raw] of Object.entries(_c72lg3)) {
		try {
			const bc = parseBytecode(rc4(b64ToBytes(raw), key));
			const instrs = descramble(bc);
			sections.push(lift(id, bc, instrs));
		} catch (e) {
			sections.push(`ERROR decoding ${id}: ${e.message}\n`);
		}
	}

	const output = sections.join("\n");
	require("fs").writeFileSync("deobfuscated.txt", output, "utf8");
	console.log(output);
	console.log("\nAlso written to deobfuscated.txt");
}

main();
