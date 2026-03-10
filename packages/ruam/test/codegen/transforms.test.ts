import { describe, it, expect } from "vitest";
import { emit } from "../../src/codegen/emit.js";
import { inlineStackOps } from "../../src/codegen/transforms.js";
import {
	fn, varDecl, exprStmt, raw,
	id, lit, call, index, assign, update, bin, breakStmt,
} from "../../src/codegen/nodes.js";

describe("inlineStackOps", () => {
	const S = "stk", P = "sp", W = "push", X = "pop", Y = "peek";

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
			fn(W, ["v"], [exprStmt(assign(index(id(S), update('++', true, id(P))), id("v")))]),
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
			exprStmt(assign(
				call(id(Y), []),
				bin("+", call(id(Y), []), id("b"))
			)),
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
