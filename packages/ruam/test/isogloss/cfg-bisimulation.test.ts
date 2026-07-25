import { describe, expect, it } from "bun:test";
import { parse } from "@babel/parser";
import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import { traverse } from "../../src/babel-compat.js";
import { buildCanonicalCfg } from "../../src/compiler/cfg.js";
import {
	compileSemanticFunction,
	resetUnitCounter,
} from "../../src/compiler/index.js";
import { Op } from "../../src/compiler/operations.js";
import {
	NON_CANONICAL_SEMANTIC_OPS,
	SemanticOp,
} from "../../src/compiler/semantic-ops.js";

function getFunctionPath(
	source: string,
	name: string
): NodePath<t.Function> {
	const ast = parse(source, {
		sourceType: "script",
		sourceFilename: "fixture.js",
	});
	let result: NodePath<t.Function> | undefined;
	traverse(ast, {
		Function(path) {
			const id = "id" in path.node ? path.node.id : null;
			if (id?.type === "Identifier" && id.name === name) {
				result = path as NodePath<t.Function>;
				path.stop();
			}
		},
	});
	if (!result) throw new Error(`Missing function ${name}`);
	return result;
}

describe("canonical compiler CFG", () => {
	it("preserves the source semantic stream without a physical backend", () => {
		const source = `function sum(a, b) { return a + b; }`;

		resetUnitCounter(123);
		const semantic = compileSemanticFunction(
			getFunctionPath(source, "sum"),
			"root-test"
		);
		const root = semantic.units[0]!;

		expect(semantic.id).toBe("root-test");
		expect(semantic.entryUnitId).toBe(root.id);
		expect(root.nodes.every((node) =>
			!NON_CANONICAL_SEMANTIC_OPS.has(node.op)
		)).toBe(true);
		expect(root.nodes.some((node) => node.op === SemanticOp.ADD)).toBe(true);
		expect(root.nodes.map((node) => node.id)).toEqual(
			root.nodes.map((_, index) => index)
		);
	});

	it("assigns nested units to one root group and records owner origins", () => {
		const source = `
			function outer(value) {
				return function inner(delta) { return value + delta; };
			}
		`;

		resetUnitCounter(456);
		const group = compileSemanticFunction(
			getFunctionPath(source, "outer"),
			"nested-root"
		);
		const root = group.units.find((unit) => unit.id === group.entryUnitId)!;
		const child = group.units.find((unit) => unit.id !== group.entryUnitId)!;

		expect(group.units).toHaveLength(2);
		expect(group.units.every((unit) => unit.rootGroupId === "nested-root")).toBe(
			true
		);
		expect(root.childUnitIds).toEqual([child.id]);
		expect(child.childUnitIds).toEqual([]);
		expect(root.origins.some((origin) => origin.file === "fixture.js")).toBe(
			true
		);
		expect(root.nodes.every((node) => root.origins[node.originId] != null)).toBe(
			true
		);
	});

	it("models branches, resumptions, and structured abrupt completion", () => {
		const packedTryTargets = (4 << 16) | 6;
		const cfg = buildCanonicalCfg({
			instructions: [
				{ opcode: Op.TRY_PUSH, operand: packedTryTargets },
				{ opcode: Op.CALL, operand: 0 },
				{ opcode: Op.RETURN, operand: 0 },
				{ opcode: Op.TRY_POP, operand: 0 },
				{ opcode: Op.CATCH_BIND, operand: -1 },
				{ opcode: Op.THROW, operand: 0 },
				{ opcode: Op.FINALLY_MARK, operand: 0 },
				{ opcode: Op.END_FINALLY, operand: 0 },
				{ opcode: Op.JMP_FALSE, operand: 10 },
				{ opcode: Op.AWAIT, operand: 0 },
				{ opcode: Op.RETURN_VOID, operand: 0 },
			],
			originIds: Array.from({ length: 11 }, () => 0),
		});

		expect(cfg.exits.get(1)).toEqual([
			{ kind: "call", resume: 2 },
			{ kind: "exception", target: 4 },
		]);
		expect(cfg.exits.get(2)).toEqual([{ kind: "finally", target: 6 }]);
		expect(cfg.exits.get(5)).toEqual([{ kind: "throw" }]);
		expect(cfg.exits.get(8)).toEqual([
			{ kind: "branch-false", target: 10 },
			{ kind: "branch-true", target: 9 },
		]);
		expect(cfg.exits.get(9)).toEqual([
			{ kind: "await", resume: 10 },
			{ kind: "throw" },
		]);
	});

	it("canonicalizes representative nested control flow without backend data", () => {
		const source = `
			async function complex(input, callback = (x) => x) {
				let total = 0;
				for (let i = 0; i < input.length; i++) {
					try {
						if (input[i] == null) continue;
						total += await callback?.(input[i]);
					} catch (error) {
						total -= 1;
					} finally {
						total += 2;
					}
				}
				class Result { value() { return total; } }
				return new Result().value();
			}
		`;

		resetUnitCounter(789);
		const group = compileSemanticFunction(
			getFunctionPath(source, "complex"),
			"complex-root"
		);

		expect(group.hasAsync).toBe(true);
		expect(group.units.length).toBeGreaterThan(1);
		for (const unit of group.units) {
			expect(unit.nodes.length).toBeGreaterThan(0);
			expect(unit.exits.size).toBe(unit.nodes.length);
			expect(unit.nodes.every((node) =>
				!NON_CANONICAL_SEMANTIC_OPS.has(node.op)
			)).toBe(true);
		}
	});

	it("rejects malformed targets and representation-specific operations", () => {
		expect(() =>
			buildCanonicalCfg({
				instructions: [{ opcode: Op.JMP, operand: 2 }],
				originIds: [0],
			})
		).toThrow("RUAM_INVALID_SEMANTIC_TARGET");

		expect(() =>
			buildCanonicalCfg({
				instructions: [
					{ opcode: Op.MUTATE, operand: 0 },
					{ opcode: Op.RETURN_VOID, operand: 0 },
				],
				originIds: [0, 0],
			})
		).toThrow("RUAM_NON_CANONICAL_SEMANTIC_OP");
	});
});
