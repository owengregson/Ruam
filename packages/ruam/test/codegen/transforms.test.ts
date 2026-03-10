import { describe, it, expect } from "vitest";
import { emit } from "../../src/codegen/emit.js";
import {
	inlineStackOps,
	obfuscateLocals,
	KEEP,
} from "../../src/codegen/transforms.js";
import {
	fn,
	varDecl,
	exprStmt,
	raw,
	returnStmt,
	tryCatch,
	id,
	lit,
	call,
	index,
	assign,
	update,
	bin,
	breakStmt,
	forIn,
} from "../../src/codegen/nodes.js";

describe("inlineStackOps", () => {
	const S = "stk",
		P = "sp",
		W = "push",
		X = "pop",
		Y = "peek";

	it("replaces W(expr) → S[++P]=expr", () => {
		const nodes = [exprStmt(call(id(W), [lit(42)]))];
		const result = inlineStackOps(nodes, S, P, W, X, Y);
		expect(emit(result[0]!)).toBe("stk[++sp]=42;");
	});

	it("replaces X() → S[P--]", () => {
		const nodes = [exprStmt(call(id(X), []))];
		const result = inlineStackOps(nodes, S, P, W, X, Y);
		expect(emit(result[0]!)).toBe("stk[sp--];");
	});

	it("replaces Y() → S[P]", () => {
		const nodes = [exprStmt(call(id(Y), []))];
		const result = inlineStackOps(nodes, S, P, W, X, Y);
		expect(emit(result[0]!)).toBe("stk[sp];");
	});

	it("replaces W(expr) with complex argument", () => {
		const nodes = [exprStmt(call(id(W), [index(id("C"), id("O"))]))];
		const result = inlineStackOps(nodes, S, P, W, X, Y);
		expect(emit(result[0]!)).toBe("stk[++sp]=C[O];");
	});

	it("removes W/X/Y function declarations", () => {
		const nodes = [
			fn(
				W,
				["v"],
				[
					exprStmt(
						assign(index(id(S), update("++", true, id(P))), id("v"))
					),
				]
			),
			fn(X, [], []),
			fn(Y, [], []),
			exprStmt(call(id(W), [lit(1)])),
		];
		const result = inlineStackOps(nodes, S, P, W, X, Y);
		expect(result.length).toBe(1);
		expect(emit(result[0]!)).toBe("stk[++sp]=1;");
	});

	it("handles nested W/X/Y in expressions", () => {
		// assign(index(id(S), call(id(X))), W(expr)) equivalent
		// S[X()] = W(lit(5)) — but in practice these don't occur
		// Test: varDecl("b", call(id(X)))
		const nodes = [varDecl("b", call(id(X), []))];
		const result = inlineStackOps(nodes, S, P, W, X, Y);
		expect(emit(result[0]!)).toBe("var b=stk[sp--]");
	});

	it("handles binary op with Y()", () => {
		// S[P] + b pattern
		const nodes = [
			exprStmt(
				assign(call(id(Y), []), bin("+", call(id(Y), []), id("b")))
			),
		];
		const result = inlineStackOps(nodes, S, P, W, X, Y);
		expect(emit(result[0]!)).toBe("stk[sp]=stk[sp]+b;");
	});

	it("preserves non-stack nodes unchanged", () => {
		const nodes = [
			varDecl("x", lit(1)),
			exprStmt(call(id("f"), [id("a")])),
			breakStmt(),
		];
		const result = inlineStackOps(nodes, S, P, W, X, Y);
		expect(result.length).toBe(3);
		expect(emit(result[0]!)).toBe("var x=1");
		expect(emit(result[1]!)).toBe("f(a);");
		expect(emit(result[2]!)).toBe("break;");
	});

	it("does not modify raw nodes", () => {
		const nodes = [raw(`${W}(42)`)];
		const result = inlineStackOps(nodes, S, P, W, X, Y);
		// Raw nodes are opaque — the W call inside is not transformed
		expect(emit(result[0]!)).toBe("push(42)");
	});
});

describe("obfuscateLocals", () => {
	const seed = 12345;

	it("renames var declarations with names >= 3 chars", () => {
		const nodes = [varDecl("handler", lit(1)), exprStmt(id("handler"))];
		const result = obfuscateLocals(nodes, seed);
		// The name should be a 2-char replacement
		const emitted = emit(result[0]!);
		expect(emitted).toMatch(/^var [a-z][a-z0-9]=1$/);
		// The Id reference should use the same replacement
		const declMatch = emitted.match(/^var ([a-z][a-z0-9])/);
		const refEmitted = emit(result[1]!);
		expect(refEmitted).toBe(`${declMatch![1]};`);
	});

	it("does not rename names < 3 chars", () => {
		const nodes = [varDecl("x", lit(1)), varDecl("ab", lit(2))];
		const result = obfuscateLocals(nodes, seed);
		expect(emit(result[0]!)).toBe("var x=1");
		expect(emit(result[1]!)).toBe("var ab=2");
	});

	it("does not rename names in KEEP set", () => {
		const nodes = [varDecl("Object", lit(1)), varDecl("prototype", lit(2))];
		const result = obfuscateLocals(nodes, seed);
		expect(emit(result[0]!)).toBe("var Object=1");
		expect(emit(result[1]!)).toBe("var prototype=2");
	});

	it("does not rename names starting with _", () => {
		const nodes = [varDecl("_handler", lit(1))];
		const result = obfuscateLocals(nodes, seed);
		expect(emit(result[0]!)).toBe("var _handler=1");
	});

	it("renames function parameters", () => {
		const nodes = [
			fn("test", ["handler", "callback"], [returnStmt(id("handler"))]),
		];
		const result = obfuscateLocals(nodes, seed);
		const emitted = emit(result[0]!);
		// Function name "test" is >= 3 chars and not in KEEP, so it gets renamed too
		expect(emitted).not.toContain("handler");
		expect(emitted).not.toContain("callback");
	});

	it("renames rest params correctly", () => {
		const nodes = [fn("foo", ["...args"], [returnStmt(id("args"))])];
		const result = obfuscateLocals(nodes, seed);
		const emitted = emit(result[0]!);
		expect(emitted).not.toContain("args");
		expect(emitted).toContain("...");
	});

	it("renames for-in declarations", () => {
		const nodes = [forIn("key", id("obj"), [exprStmt(id("key"))])];
		const result = obfuscateLocals(nodes, seed);
		const emitted = emit(result[0]!);
		expect(emitted).not.toContain("key");
	});

	it("renames catch parameters", () => {
		const nodes = [
			tryCatch([exprStmt(lit(1))], "error", [exprStmt(id("error"))]),
		];
		const result = obfuscateLocals(nodes, seed);
		const emitted = emit(result[0]!);
		expect(emitted).not.toContain("error");
	});

	it("produces deterministic names for same seed", () => {
		const nodes = [varDecl("handler", lit(1))];
		const r1 = obfuscateLocals(nodes, seed);
		const r2 = obfuscateLocals(nodes, seed);
		expect(emit(r1[0]!)).toBe(emit(r2[0]!));
	});

	it("produces different names for different seeds", () => {
		const nodes = [varDecl("handler", lit(1))];
		const r1 = obfuscateLocals(nodes, 100);
		const r2 = obfuscateLocals(nodes, 200);
		expect(emit(r1[0]!)).not.toBe(emit(r2[0]!));
	});

	it("does not modify raw nodes", () => {
		const nodes = [raw("var handler=1;handler;")];
		const result = obfuscateLocals(nodes, seed);
		// Raw nodes are opaque — no var declarations collected
		expect(emit(result[0]!)).toBe("var handler=1;handler;");
	});

	it("returns nodes unchanged when nothing to rename", () => {
		const nodes = [varDecl("x", lit(1)), exprStmt(id("a"))];
		const result = obfuscateLocals(nodes, seed);
		expect(result).toBe(nodes); // Same reference — no changes
	});

	it("KEEP set contains expected entries", () => {
		expect(KEEP.has("Object")).toBe(true);
		expect(KEEP.has("undefined")).toBe(true);
		expect(KEEP.has("prototype")).toBe(true);
		expect(KEEP.has("length")).toBe(true);
		expect(KEEP.has("a")).toBe(true);
	});
});
