import { describe, expect, it } from "bun:test";
import { Op } from "../../src/compiler/operations.js";
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

describe("semantic operation catalog", () => {
	it("shares one exact catalog across visitor and analysis stages", () => {
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
			expect(signature.mayThrow, semanticOpName(op)).toBe(
				signature.throwBehavior !== "never"
			);
			expect(signature.completion, semanticOpName(op)).toBe(
				signature.control === "fallthrough"
					? "normal"
					: signature.control
			);
			if (signature.precision === "conservative") {
				expect(signature.purity, semanticOpName(op)).toBe("observable");
				expect(signature.coercion, semanticOpName(op)).toBe("unknown");
				expect(signature.callKind, semanticOpName(op)).toBe("unknown");
				expect(signature.allocation, semanticOpName(op)).toBe("unknown");
			}
			if (signature.purity === "pure") {
				expect(signature.throwBehavior, semanticOpName(op)).toBe("never");
				expect(signature.callKind, semanticOpName(op)).toBe("none");
				expect(signature.suspension, semanticOpName(op)).toBe("none");
				expect(signature.scopeAccess, semanticOpName(op)).toBe("none");
				expect(signature.objectAccess, semanticOpName(op)).toBe("none");
				expect(signature.globalAccess, semanticOpName(op)).toBe("none");
				expect(signature.allocation, semanticOpName(op)).toBe("none");
				expect(
					["none", "intrinsic"].includes(signature.coercion),
					semanticOpName(op)
				).toBe(true);
			}
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

	it("exposes conservative observability dimensions used by region formation", () => {
		const literal = getSemanticSignature(SemanticOp.PUSH_TRUE);
		expect(literal.purity).toBe("pure");
		expect(literal.throwBehavior).toBe("never");
		expect(literal.coercion).toBe("none");

		const logicalNot = getSemanticSignature(SemanticOp.NOT);
		expect(logicalNot.purity).toBe("pure");
		expect(logicalNot.coercion).toBe("intrinsic");
		expect(logicalNot.throwBehavior).toBe("never");

		const addition = getSemanticSignature(SemanticOp.ADD);
		expect(addition.purity).toBe("observable");
		expect(addition.coercion).toBe("observable");
		expect(addition.callKind).toBe("coercion-hook");
		expect(addition.throwBehavior).toBe("may-throw");

		const strictEquality = getSemanticSignature(SemanticOp.SEQ);
		expect(strictEquality.purity).toBe("pure");
		expect(strictEquality.coercion).toBe("none");
		expect(strictEquality.throwBehavior).toBe("never");

		const propertyRead = getSemanticSignature(
			SemanticOp.GET_PROP_STATIC
		);
		expect(propertyRead.objectAccess).toBe("read");
		expect(propertyRead.callKind).toBe("host-protocol");
		expect(propertyRead.purity).toBe("observable");

		const globalWrite = getSemanticSignature(SemanticOp.STORE_GLOBAL);
		expect(globalWrite.globalAccess).toBe("write");
		expect(globalWrite.scopeAccess).toBe("none");

		const call = getSemanticSignature(SemanticOp.CALL);
		expect(call.callKind).toBe("invoke");
		expect(call.scopeAccess).toBe("unknown");
		expect(call.objectAccess).toBe("unknown");
		expect(call.globalAccess).toBe("unknown");
		expect(call.completion).toBe("call");

		const awaitSignature = getSemanticSignature(SemanticOp.AWAIT);
		expect(awaitSignature.suspension).toBe("await");
		expect(awaitSignature.completion).toBe("await");

		const allocation = getSemanticSignature(SemanticOp.NEW_OBJECT);
		expect(allocation.allocation).toBe("object");
		expect(allocation.purity).toBe("observable");

		expect(getSemanticSignature(SemanticOp.LOAD_SLOT).frameAccess).toBe(
			"read"
		);
		expect(getSemanticSignature(SemanticOp.STORE_SLOT).frameAccess).toBe(
			"write"
		);
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
		expect(mutation.purity).toBe("observable");
		expect(mutation.coercion).toBe("unknown");
		expect(mutation.frameAccess).toBe("unknown");
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
