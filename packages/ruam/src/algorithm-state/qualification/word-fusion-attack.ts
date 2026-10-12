/** Scripted artifact-only table recognizer; authoring effort/blindness are not measured. */
import { createHash } from "node:crypto";
import { parse } from "@babel/parser";
import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { generate, traverse } from "../../babel-compat.js";

type Shift = { operator: "<<" | ">>>" | ">>"; amount: number };
export interface WordTableRecovery {
	schema: "ruam-word-table-recovery-v1";
	status: "recovered" | "unsupported";
	artifactSha256: string;
	code: string;
	codeSha256: string;
	artifactBytes: number;
	codeBytes: number;
	regions: { state: string; columns: number[]; shifts: Shift[]; verifiedTableEntries: 128; searchedCandidates: number }[];
	outputXorMask: number;
	wallMs: number;
	cpuUserMicros: number;
	cpuSystemMicros: number;
	actualAiTrial: false;
	wholeProgramRecoveryEstablished: false;
	algebraInputDomain: "primitive-uint32";
	limitations: string[];
}
const hash = (code: string) => createHash("sha256").update(code).digest("hex");
const shift = (word: number, step: Shift) => step.operator === "<<" ? word << step.amount : step.operator === ">>>" ? word >>> step.amount : word >> step.amount;
const apply = (word: number, steps: Shift[]) => { for (const step of steps) word ^= shift(word, step); return word >>> 0; };
function compact(columns: number[]): { shifts: Shift[] | null; searchedCandidates: number } {
	let searchedCandidates = 0;
	const choices: Shift[] = [];
	for (const operator of ["<<", ">>>", ">>"] as const) for (let amount = 1; amount < 32; amount++) choices.push({ operator, amount });
	for (const a of choices) for (const b of choices) for (const c of choices) {
		searchedCandidates++;
		const steps = [a, b, c];
		if (columns.every((column, bit) => apply((2 ** bit) >>> 0, steps) === column)) return { shifts: steps, searchedCandidates };
	}
	return { shifts: null, searchedCandidates };
}
function flattenXor(node: t.Node): t.Node[] {
	return t.isBinaryExpression(node, { operator: "^" }) ? [...flattenXor(node.left), ...flattenXor(node.right)] : [node];
}

/**
 * Recognize eight literal nibble tables, prove their complete linear mapping,
 * then search a fixed three-step xorshift grammar using only artifact bytes.
 * Rewrites recovered regions and removes their now-unused literal tables.
 * An optional uint32 mask is a concrete partial edit at the recovered boundary.
 */
export function recoverWordTableTransitions(code: string, outputXorMask = 0): WordTableRecovery {
	if (Buffer.byteLength(code) > 2 * 1024 * 1024) throw new Error("Artifact exceeds 2 MiB research limit");
	if (!Number.isInteger(outputXorMask) || outputXorMask < 0 || outputXorMask > 0xffffffff) throw new Error("outputXorMask must be uint32");
	const started = performance.now(), cpuBefore = process.cpuUsage();
	const ast = parse(code, { sourceType: "unambiguous" });
	const regions: WordTableRecovery["regions"] = [];
	traverse(ast, {
		AssignmentExpression(path) {
			if (regions.length >= 8 || !path.parentPath.isExpressionStatement() || path.node.operator !== "=" || !t.isIdentifier(path.node.left)) return;
			const state = path.node.left.name, rhs = path.node.right;
			if (!t.isBinaryExpression(rhs, { operator: ">>>" }) || !t.isNumericLiteral(rhs.right, { value: 0 })) return;
			const terms = flattenXor(rhs.left);
			if (terms.length !== 8) return;
			const columns: number[] = new Array(32), declarations: NodePath<t.VariableDeclarator>[] = [], seen = new Set<number>();
			for (const term of terms) {
				if (!t.isMemberExpression(term) || !term.computed || !t.isIdentifier(term.object) || !t.isBinaryExpression(term.property, { operator: "&" }) || !t.isNumericLiteral(term.property.right, { value: 15 })) return;
				const input = term.property.left;
				if (!t.isBinaryExpression(input, { operator: ">>>" }) || !t.isIdentifier(input.left, { name: state }) || !t.isNumericLiteral(input.right)) return;
				const offset = input.right.value;
				if (!Number.isInteger(offset) || offset < 0 || offset > 28 || offset % 4 || seen.has(offset)) return;
				seen.add(offset);
				const binding = path.scope.getBinding(term.object.name);
				if (!binding || !binding.constant || binding.kind !== "const" || !binding.path.isVariableDeclarator() || binding.referencePaths.length !== 1) return;
				const array = binding.path.node.init;
				if (!t.isArrayExpression(array) || array.elements.length !== 16 || !array.elements.every(item => t.isNumericLiteral(item) && Number.isInteger(item.value) && item.value >= 0 && item.value <= 0xffffffff)) return;
				const values = array.elements.map(item => (item as t.NumericLiteral).value);
				for (let index = 0; index < 16; index++) {
					let result = 0;
					for (let bit = 0; bit < 4; bit++) if (index & (1 << bit)) result ^= values[1 << bit]!;
					if ((result >>> 0) !== values[index]) return;
				}
				for (let bit = 0; bit < 4; bit++) columns[offset + bit] = values[1 << bit]!;
				declarations.push(binding.path);
			}
			const found = compact(columns);
			if (!found.shifts) return;
			const statements: t.Statement[] = found.shifts.map(step => t.expressionStatement(t.assignmentExpression("^=", t.identifier(state), t.binaryExpression(step.operator, t.identifier(state), t.numericLiteral(step.amount)))));
			let finalWord: t.Expression = t.identifier(state);
			if (outputXorMask) finalWord = t.binaryExpression("^", finalWord, t.numericLiteral(outputXorMask));
			statements.push(t.expressionStatement(t.assignmentExpression("=", t.identifier(state), t.binaryExpression(">>>", finalWord, t.numericLiteral(0)))));
			path.parentPath.replaceWithMultiple(statements);
			for (const declaration of declarations) declaration.remove();
			regions.push({ state, columns, shifts: found.shifts, searchedCandidates: found.searchedCandidates, verifiedTableEntries: 128 });
		},
	});
	const recovered = regions.length ? generate(ast, { comments: false }).code : code, cpu = process.cpuUsage(cpuBefore);
	return { schema: "ruam-word-table-recovery-v1", status: regions.length ? "recovered" : "unsupported", artifactSha256: hash(code), code: recovered, codeSha256: hash(recovered), artifactBytes: Buffer.byteLength(code), codeBytes: Buffer.byteLength(recovered), regions, outputXorMask,
		wallMs: performance.now() - started, cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system, actualAiTrial: false, wholeProgramRecoveryEstablished: false, algebraInputDomain: "primitive-uint32",
		limitations: ["Recognizes a frozen literal-nibble-table and three-step xorshift grammar; other representations may be unsupported.",
			"The algebra proof assumes a primitive uint32 input; this recognizer does not prove application-wide coercion or binding ownership invariants.",
			"Only recovered transition algebra is proved. Residual application code is retained; this is not whole-program standalone recovery.",
			"Source reflection, resource use, dynamic eval and externally mutated runtime intrinsics are not proven equivalent by this attack.",
			"Caller must separately score whole-artifact behavior and any partial-edit ticket. No AI or blinded-author claim is made."] };
}
