import { describe, it, expect } from "vitest";
import { emit } from "../../src/codegen/emit.js";
import {
	fn,
	varDecl,
	constDecl,
	exprStmt,
	block,
	ifStmt,
	whileStmt,
	forStmt,
	forIn,
	switchStmt,
	caseClause,
	breakStmt,
	continueStmt,
	returnStmt,
	throwStmt,
	tryCatch,
	debuggerStmt,
	id,
	lit,
	bin,
	un,
	update,
	assign,
	call,
	member,
	index,
	ternary,
	arr,
	obj,
	fnExpr,
	arrowFn,
	newExpr,
	seq,
	awaitExpr,
	importExpr,
	iife,
	rest,
} from "../../src/codegen/nodes.js";

describe("Emitter", () => {
	describe("declarations", () => {
		it("var without init", () => {
			expect(emit(varDecl("x"))).toBe("var x");
		});
		it("var with init", () => {
			expect(emit(varDecl("x", lit(0)))).toBe("var x=0");
		});
		it("const with init", () => {
			expect(emit(constDecl("PI", lit(3.14)))).toBe("const PI=3.14");
		});
		it("function declaration", () => {
			expect(
				emit(
					fn(
						"foo",
						["a", "b"],
						[returnStmt(bin("+", id("a"), id("b")))]
					)
				)
			).toBe("function foo(a,b){return a+b;}");
		});
		it("async function declaration", () => {
			expect(
				emit(
					fn("bar", [], [returnStmt(awaitExpr(id("x")))], {
						async: true,
					})
				)
			).toBe("async function bar(){return await x;}");
		});
		it("rest param", () => {
			expect(
				emit(fn("f", [rest("args")], [returnStmt(id("args"))]))
			).toBe("function f(...args){return args;}");
		});
	});

	describe("statements", () => {
		it("expression statement", () => {
			expect(emit(exprStmt(call(id("f"), [])))).toBe("f();");
		});
		it("block", () => {
			expect(emit(block(exprStmt(id("a"))))).toBe("{a;}");
		});
		it("if/else", () => {
			expect(
				emit(
					ifStmt(id("x"), [returnStmt(lit(1))], [returnStmt(lit(2))])
				)
			).toBe("if(x){return 1;}else{return 2;}");
		});
		it("if without else", () => {
			expect(emit(ifStmt(id("x"), [breakStmt()]))).toBe("if(x){break;}");
		});
		it("while loop", () => {
			expect(emit(whileStmt(lit(true), [breakStmt()]))).toBe(
				"while(true){break;}"
			);
		});
		it("for loop", () => {
			expect(
				emit(
					forStmt(
						varDecl("i", lit(0)),
						bin("<", id("i"), lit(10)),
						update("++", false, id("i")),
						[exprStmt(call(id("f"), [id("i")]))]
					)
				)
			).toBe("for(var i=0;i<10;i++){f(i);}");
		});
		it("for-in", () => {
			expect(
				emit(
					forIn("k", id("obj"), [exprStmt(call(id("f"), [id("k")]))])
				)
			).toBe("for(var k in obj){f(k);}");
		});
		it("switch", () => {
			expect(
				emit(
					switchStmt(id("x"), [
						caseClause(lit(1), [breakStmt()]),
						caseClause(null, [breakStmt()]),
					])
				)
			).toBe("switch(x){case 1:{break;}default:{break;}}");
		});
		it("return void", () => {
			expect(emit(returnStmt())).toBe("return;");
		});
		it("throw", () => {
			expect(emit(throwStmt(newExpr(id("Error"), [lit("fail")])))).toBe(
				"throw new Error('fail');"
			);
		});
		it("try/catch", () => {
			expect(
				emit(tryCatch([exprStmt(id("a"))], "e", [exprStmt(id("b"))]))
			).toBe("try{a;}catch(e){b;}");
		});
		it("try/catch/finally", () => {
			expect(
				emit(
					tryCatch(
						[exprStmt(id("a"))],
						"e",
						[exprStmt(id("b"))],
						[exprStmt(id("c"))]
					)
				)
			).toBe("try{a;}catch(e){b;}finally{c;}");
		});
		it("try/finally (no catch)", () => {
			expect(
				emit(
					tryCatch([exprStmt(id("a"))], undefined, undefined, [
						exprStmt(id("c")),
					])
				)
			).toBe("try{a;}finally{c;}");
		});
		it("debugger", () => {
			expect(emit(debuggerStmt())).toBe("debugger;");
		});
	});

	describe("expressions", () => {
		it("identifier", () => {
			expect(emit(id("foo"))).toBe("foo");
		});
		it("string literal", () => {
			expect(emit(lit("hello"))).toBe("'hello'");
		});
		it("string with escapes", () => {
			expect(emit(lit('it\'s a "test"\n'))).toBe(
				"'it\\'s a \"test\"\\n'"
			);
		});
		it("number literal", () => {
			expect(emit(lit(42))).toBe("42");
		});
		it("negative number", () => {
			expect(emit(lit(-1))).toBe("-1");
		});
		it("boolean literals", () => {
			expect(emit(lit(true))).toBe("true");
			expect(emit(lit(false))).toBe("false");
		});
		it("null literal", () => {
			expect(emit(lit(null))).toBe("null");
		});
		it("regex literal", () => {
			expect(emit(lit(/abc/gi))).toBe("/abc/gi");
		});
		it("binary operator", () => {
			expect(emit(bin("+", id("a"), id("b")))).toBe("a+b");
		});
		it("keyword binary (in)", () => {
			expect(emit(bin("in", id("a"), id("b")))).toBe("a in b");
		});
		it("keyword binary (instanceof)", () => {
			expect(emit(bin("instanceof", id("a"), id("B")))).toBe(
				"a instanceof B"
			);
		});
		it("precedence: a+b*c", () => {
			expect(emit(bin("+", id("a"), bin("*", id("b"), id("c"))))).toBe(
				"a+b*c"
			);
		});
		it("precedence: (a+b)*c", () => {
			expect(emit(bin("*", bin("+", id("a"), id("b")), id("c")))).toBe(
				"(a+b)*c"
			);
		});
		it("unary !", () => {
			expect(emit(un("!", id("x")))).toBe("!x");
		});
		it("unary typeof", () => {
			expect(emit(un("typeof", id("x")))).toBe("typeof x");
		});
		it("unary delete", () => {
			expect(emit(un("delete", member(id("o"), "k")))).toBe("delete o.k");
		});
		it("prefix ++", () => {
			expect(emit(update("++", true, id("x")))).toBe("++x");
		});
		it("postfix ++", () => {
			expect(emit(update("++", false, id("x")))).toBe("x++");
		});
		it("prefix --", () => {
			expect(emit(update("--", true, id("x")))).toBe("--x");
		});
		it("simple assign", () => {
			expect(emit(assign(id("x"), lit(1)))).toBe("x=1");
		});
		it("compound assign +=", () => {
			expect(emit(assign(id("x"), lit(1), "+"))).toBe("x+=1");
		});
		it("compound assign >>>=", () => {
			expect(emit(assign(id("x"), lit(16), ">>>"))).toBe("x>>>=16");
		});
		it("function call", () => {
			expect(emit(call(id("f"), [id("a"), id("b")]))).toBe("f(a,b)");
		});
		it("method call", () => {
			expect(emit(call(member(id("o"), "m"), []))).toBe("o.m()");
		});
		it("member access", () => {
			expect(emit(member(id("obj"), "prop"))).toBe("obj.prop");
		});
		it("index access", () => {
			expect(emit(index(id("arr"), lit(0)))).toBe("arr[0]");
		});
		it("ternary", () => {
			expect(emit(ternary(id("x"), lit(1), lit(2)))).toBe("x?1:2");
		});
		it("array", () => {
			expect(emit(arr(lit(1), lit(2), lit(3)))).toBe("[1,2,3]");
		});
		it("object", () => {
			expect(emit(obj(["a", lit(1)], ["b", lit(2)]))).toBe("{a:1,b:2}");
		});
		it("object with computed key", () => {
			expect(emit(obj([id("k"), lit(1)]))).toBe("{[k]:1}");
		});
		it("function expression", () => {
			expect(emit(fnExpr(undefined, ["x"], [returnStmt(id("x"))]))).toBe(
				"function(x){return x;}"
			);
		});
		it("named function expression", () => {
			expect(emit(fnExpr("f", [], []))).toBe("function f(){}");
		});
		it("async function expression", () => {
			expect(emit(fnExpr(undefined, [], [], { async: true }))).toBe(
				"async function(){}"
			);
		});
		it("arrow function (single param)", () => {
			expect(emit(arrowFn(["x"], [returnStmt(id("x"))]))).toBe("x=>x");
		});
		it("arrow function (multi param)", () => {
			expect(
				emit(
					arrowFn(
						["a", "b"],
						[returnStmt(bin("+", id("a"), id("b")))]
					)
				)
			).toBe("(a,b)=>a+b");
		});
		it("arrow function (body)", () => {
			expect(
				emit(
					arrowFn(
						["x"],
						[
							exprStmt(call(id("f"), [id("x")])),
							returnStmt(id("x")),
						]
					)
				)
			).toBe("x=>{f(x);return x;}");
		});
		it("arrow function (rest param)", () => {
			expect(emit(arrowFn([rest("a")], [returnStmt(id("a"))]))).toBe(
				"(...a)=>a"
			);
		});
		it("async arrow", () => {
			expect(
				emit(
					arrowFn(["x"], [returnStmt(awaitExpr(id("x")))], {
						async: true,
					})
				)
			).toBe("async (x)=>await x");
		});
		it("new expression", () => {
			expect(emit(newExpr(id("Foo"), [lit(1)]))).toBe("new Foo(1)");
		});
		it("sequence", () => {
			expect(emit(seq(id("a"), id("b"), id("c")))).toBe("(a,b,c)");
		});
		it("await", () => {
			expect(emit(awaitExpr(id("p")))).toBe("await p");
		});
		it("import()", () => {
			expect(emit(importExpr(lit("./mod")))).toBe("import('./mod')");
		});
	});

	describe("convenience", () => {
		it("IIFE", () => {
			expect(emit(iife(block(exprStmt(id("x")))))).toBe(
				"(function(){x;})()"
			);
		});
	});

	describe("nested structures", () => {
		it("nested member + index + call", () => {
			expect(
				emit(call(index(member(id("obj"), "arr"), lit(0)), [id("x")]))
			).toBe("obj.arr[0](x)");
		});
		it("assignment to index", () => {
			expect(
				emit(
					assign(index(id("S"), update("++", true, id("P"))), id("v"))
				)
			).toBe("S[++P]=v");
		});
		it("complex ternary with calls", () => {
			expect(
				emit(
					ternary(
						call(id("test"), []),
						call(id("a"), []),
						call(id("b"), [])
					)
				)
			).toBe("test()?a():b()");
		});
	});
});
