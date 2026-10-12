import { describe, expect, it } from "bun:test";
import { runInNewContext } from "node:vm";
import { obfuscateCode } from "../../src/index.js";
import { applyMBA } from "../../src/ruamvm/mba.js";
import { emit } from "../../src/ruamvm/emit.js";
import { BOp, UOp, bin, call, id, index, lit, un } from "../../src/ruamvm/nodes.js";

const operators = [["+", BOp.Add], ["-", BOp.Sub], ["^", BOp.BitXor], ["&", BOp.BitAnd], ["|", BOp.BitOr]] as const;
const observe = (fn: (a: unknown, b: unknown) => unknown, a: unknown, b: unknown) => {
	try { return { value: fn(a, b) }; } catch (error) { return { error: (error as Error).name }; }
};

describe("MBA observable effects", () => {
	it("preserves primitive arithmetic, signed zero, BigInt and mixed-type failures", () => {
		const pairs: [unknown, unknown][] = [[-0, -0], [-0, 0], [0, -0], [0, 0], [1, 2], [-1, 2],
			[-2147483648, 2147483647], [2147483647, 2147483647], [-2147483648, -2147483648],
			[3.5, 2], [Infinity, -Infinity], [NaN, 2], ["7", 2], [4n, 2n], [4n, 2], [Symbol(), 1], [null, 2], [undefined, 2]];
		for (const [operator, opcode] of operators) for (let seed = 0; seed < 16; seed++) {
			const original = new Function("a", "b", `return a ${operator} b;`) as (a: unknown, b: unknown) => unknown;
			const transformed = new Function("a", "b", `return ${emit(applyMBA([bin(opcode, id("a"), id("b"))], seed)[0]!)};`) as typeof original;
			for (const [a, b] of pairs) expect(observe(transformed, a, b)).toEqual(observe(original, a, b));
		}
	});

	it("does not repeat operand calls, reads, numeric conversion or coercion hints", () => {
		for (const [operator, opcode] of operators) for (const left of [call(id("read"), []), index(id("box"), lit("value")), un(UOp.Pos, id("object")), id("object")]) {
			const before = emit(bin(opcode, left, id("right")));
			const after = emit(applyMBA([bin(opcode, left, id("right"))], 42)[0]!);
			function run(expression: string) {
				const log: string[] = [];
				const object = { [Symbol.toPrimitive](hint: string) { log.push(`left:${hint}`); return log.length + 5; } };
				const right = { [Symbol.toPrimitive](hint: string) { log.push(`right:${hint}`); return 3; } };
				const read = () => { log.push("call"); return object; };
				const box = { get value() { log.push("get"); return object; } };
				const fn = new Function("read", "box", "object", "right", `return ${expression};`);
				return { result: fn(read, box, object, right), log };
			}
			expect(run(after)).toEqual(run(before));
		}
	});

	it("preserves caller coercion traces across low and max with MBA toggles", () => {
		const source = `globalThis.operations = [function(a,b){return a+b},function(a,b){return a-b},function(a,b){return a^b},function(a,b){return a&b},function(a,b){return a|b}];`;
		for (const preset of ["low", "max"] as const) for (const mixedBooleanArithmetic of [false, true]) {
			const original = runInNewContext(`${source};operations;`) as ((a: unknown, b: unknown) => unknown)[];
			const context: { operations?: typeof original } = {};
			runInNewContext(obfuscateCode(source, { preset, target: "browser-extension", targetMode: "root", debugProtection: false, mixedBooleanArithmetic }), context, { timeout: 4000 });
			for (let i = 0; i < original.length; i++) {
				function trial(fn: (a: unknown, b: unknown) => unknown) {
					const log: string[] = [];
					const a = { [Symbol.toPrimitive](hint: string) { log.push(`left:${hint}`); return 8 + log.length; } };
					const b = { [Symbol.toPrimitive](hint: string) { log.push(`right:${hint}`); return 3 + log.length; } };
					return { result: observe(fn, a, b), log };
				}
				expect(trial(context.operations![i]!)).toEqual(trial(original[i]!));
				expect(observe(context.operations![i]!, -0, -0)).toEqual(observe(original[i]!, -0, -0));
				expect(observe(context.operations![i]!, 4n, 2n)).toEqual(observe(original[i]!, 4n, 2n));
			}
		}
	});
});
