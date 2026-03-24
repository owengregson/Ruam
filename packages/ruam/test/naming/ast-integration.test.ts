import { describe, it, expect } from "bun:test";
import { NameRegistry } from "../../src/naming/index.js";
import { id, varDecl, fn as fnDecl } from "../../src/ruamvm/nodes.js";
import { emit } from "../../src/ruamvm/emit.js";

describe("AST NameToken integration", () => {
	it("emits identifier from NameToken", () => {
		const registry = new NameRegistry(42);
		const scope = registry.createScope("test", { lengthTier: "short" });
		const myVar = scope.claim("myVar");
		registry.resolveAll();
		const node = id(myVar);
		expect(emit(node)).toBe(myVar.name);
	});

	it("emits varDecl with NameToken name", () => {
		const registry = new NameRegistry(42);
		const scope = registry.createScope("test", { lengthTier: "short" });
		const x = scope.claim("x");
		registry.resolveAll();
		const node = varDecl(x, id("Object"));
		expect(emit(node)).toContain(`var ${x.name}=Object`);
	});

	it("emits fnDecl with NameToken params", () => {
		const registry = new NameRegistry(42);
		const scope = registry.createScope("test", { lengthTier: "short" });
		const fname = scope.claim("fn");
		const p1 = scope.claim("p1");
		const p2 = scope.claim("p2");
		registry.resolveAll();
		const node = fnDecl(fname, [p1, p2], []);
		const result = emit(node);
		expect(result).toContain(
			`function ${fname.name}(${p1.name},${p2.name})`
		);
	});
});
