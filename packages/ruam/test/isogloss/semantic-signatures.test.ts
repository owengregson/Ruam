import { describe, expect, it } from "bun:test";
import { Op } from "../../src/compiler/opcodes.js";
import {
	ALL_CANONICAL_SEMANTIC_OPS,
	ALL_SEMANTIC_OPS,
	NON_CANONICAL_SEMANTIC_OPS,
	SEMANTIC_OP_COUNT,
	SemanticOp,
	assertCanonicalSemanticOp,
	isCanonicalSemanticOp,
	semanticOpName,
} from "../../src/compiler/semantic-ops.js";
import {
	SEMANTIC_SIGNATURES,
	getSemanticSignature,
	resolveStackArity,
} from "../../src/compiler/semantic-signatures.js";
import {
	createSemanticInstruction,
	isTerminalSemanticExit,
	type SemanticExit,
	type SemanticInstruction,
} from "../../src/compiler/ir.js";

describe("semantic operation migration alias", () => {
	it("is the existing logical enum without translation or renumbering", () => {
		expect(SemanticOp).toBe(Op);
		expect(SemanticOp.ADD).toBe(Op.ADD);
		expect(SemanticOp.MUTATE).toBe(Op.MUTATE);
		expect(SEMANTIC_OP_COUNT).toBe(Op.__COUNT);
	});

	it("enumerates every real operation once and excludes the sentinel", () => {
		expect(ALL_SEMANTIC_OPS).toHaveLength(Op.__COUNT);
		expect(new Set(ALL_SEMANTIC_OPS).size).toBe(Op.__COUNT);
		expect(ALL_SEMANTIC_OPS[0]).toBe(0);
		expect(ALL_SEMANTIC_OPS.at(-1)).toBe(Op.__COUNT - 1);
		expect(ALL_SEMANTIC_OPS).not.toContain(Op.__COUNT);
	});

	it("keeps representation artifacts outside canonical semantic IR", () => {
		for (const op of [
			SemanticOp.BREAK,
			SemanticOp.CONTINUE,
			SemanticOp.LABEL,
			SemanticOp.REG_ADD,
			SemanticOp.REG_LT_CONST_JF,
			SemanticOp.CONST_SEQ_JF,
			SemanticOp.MUTATE,
		]) {
			expect(NON_CANONICAL_SEMANTIC_OPS.has(op), semanticOpName(op)).toBe(
				true
			);
			expect(isCanonicalSemanticOp(op), semanticOpName(op)).toBe(false);
		}

		expect(ALL_CANONICAL_SEMANTIC_OPS).toContain(SemanticOp.ADD);
		expect(ALL_CANONICAL_SEMANTIC_OPS).toContain(SemanticOp.TRY_PUSH);
		expect(ALL_CANONICAL_SEMANTIC_OPS).not.toContain(SemanticOp.MUTATE);
		expect(
			ALL_CANONICAL_SEMANTIC_OPS.length + NON_CANONICAL_SEMANTIC_OPS.size
		).toBe(ALL_SEMANTIC_OPS.length);
		expect(() => assertCanonicalSemanticOp(SemanticOp.REG_ADD)).toThrow(
			"RUAM_NON_CANONICAL_SEMANTIC_OP"
		);
	});
});

describe("semantic signature catalog", () => {
	it("has a frozen, self-identifying descriptor for every operation", () => {
		expect(Object.isFrozen(SEMANTIC_SIGNATURES)).toBe(true);
		expect(Object.keys(SEMANTIC_SIGNATURES)).toHaveLength(Op.__COUNT);

		for (const op of ALL_SEMANTIC_OPS) {
			const signature = SEMANTIC_SIGNATURES[op];
			expect(signature, semanticOpName(op)).toBeDefined();
			expect(signature.op, semanticOpName(op)).toBe(op);
			expect(Object.isFrozen(signature), semanticOpName(op)).toBe(true);
			expect(signature.syntheticDimensions, semanticOpName(op)).toBeGreaterThan(
				0
			);
		}
	});

	it("classifies control, call, exception, and suspension exits explicitly", () => {
		expect(getSemanticSignature(SemanticOp.JMP).control).toBe("jump");
		expect(getSemanticSignature(SemanticOp.JMP_FALSE).control).toBe(
			"conditional"
		);
		expect(getSemanticSignature(SemanticOp.RETURN).control).toBe("return");
		expect(getSemanticSignature(SemanticOp.THROW).control).toBe("throw");
		expect(getSemanticSignature(SemanticOp.CALL).control).toBe("call");
		expect(getSemanticSignature(SemanticOp.YIELD).control).toBe("yield");
		expect(getSemanticSignature(SemanticOp.AWAIT).control).toBe("await");

		expect(getSemanticSignature(SemanticOp.THROW).effect).toBe("exception");
		expect(getSemanticSignature(SemanticOp.CALL).effect).toBe("call");
		expect(getSemanticSignature(SemanticOp.AWAIT).effect).toBe("async");
	});

	it("resolves operand-dependent stack arity without executing semantics", () => {
		const call = getSemanticSignature(SemanticOp.CALL);
		const methodCall = getSemanticSignature(SemanticOp.CALL_METHOD);
		const popN = getSemanticSignature(SemanticOp.POP_N);

		expect(resolveStackArity(call.stackInput, 3)).toBe(4);
		expect(resolveStackArity(methodCall.stackInput, 3)).toBe(5);
		expect(resolveStackArity(popN.stackInput, 3)).toBe(3);
		expect(resolveStackArity(call.stackInput, -1)).toBe("dynamic");
	});

	it("uses conservative facts rather than optimistic claims for migration-only ops", () => {
		const mutation = getSemanticSignature(SemanticOp.MUTATE);
		expect(mutation.precision).toBe("conservative");
		expect(mutation.mayThrow).toBe(true);
		expect(mutation.readsScope).toBe(true);
		expect(mutation.readsThis).toBe(true);
	});
});

describe("canonical semantic IR contracts", () => {
	it("accepts semantic operations and identifies only terminal exits", () => {
		const instruction: SemanticInstruction = createSemanticInstruction({
			id: 0,
			op: SemanticOp.ADD,
			operand: 0,
			originId: 0,
		});
		const exits: SemanticExit[] = [
			{ kind: "fallthrough", target: 1 },
			{ kind: "call", resume: 2 },
			{ kind: "return" },
			{ kind: "throw" },
		];

		expect(instruction.op).toBe(Op.ADD);
		expect(exits.map(isTerminalSemanticExit)).toEqual([
			false,
			false,
			true,
			true,
		]);
	});

	it("rejects VM and optimizer operations at construction", () => {
		expect(() =>
			createSemanticInstruction({
				id: 0,
				op: SemanticOp.MUTATE,
				operand: 0,
				originId: 0,
			})
		).toThrow("RUAM_NON_CANONICAL_SEMANTIC_OP");
		expect(() =>
			createSemanticInstruction({
				id: 0,
				op: SemanticOp.REG_ADD,
				operand: 0,
				originId: 0,
			})
		).toThrow("RUAM_NON_CANONICAL_SEMANTIC_OP");
	});
});
