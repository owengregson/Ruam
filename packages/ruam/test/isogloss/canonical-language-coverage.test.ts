import { describe, expect, it } from "bun:test";
import { parse } from "@babel/parser";
import { BABEL_PARSER_PLUGINS } from "../../src/constants.js";
import { Op } from "../../src/compiler/operations.js";
import type { SemanticRootGroup, SemanticUnit } from "../../src/compiler/ir.js";
import { compileProtectedSourceRoots } from "../../src/isogloss/source-roots.js";

function compileRoots(source: string): readonly SemanticRootGroup[] {
	const ast = parse(source, {
		sourceType: "unambiguous",
		plugins: [...BABEL_PARSER_PLUGINS],
	});
	return compileProtectedSourceRoots(ast, {
		targetMode: "root",
		threshold: 1,
		seed: 0x51a7e,
	}).map((root) => root.group);
}

function rootUnit(group: SemanticRootGroup): SemanticUnit {
	const unit = group.units.find((candidate) => candidate.id === group.entryUnitId);
	if (!unit) throw new Error("missing entry unit");
	return unit;
}

function operations(unit: SemanticUnit): Op[] {
	return unit.nodes.map((node) => node.op as Op);
}

function expectContiguous(haystack: readonly Op[], needle: readonly Op[]): void {
	for (let start = 0; start <= haystack.length - needle.length; start++) {
		if (needle.every((operation, offset) => haystack[start + offset] === operation)) {
			return;
		}
	}
	throw new Error(
		`missing operation sequence: ${needle.map((op) => Op[op]).join(" -> ")}\n` +
			haystack.map((op) => Op[op]).join(" -> ")
	);
}

function expectOrdered(haystack: readonly Op[], needle: readonly Op[]): void {
	let position = 0;
	for (const operation of haystack) {
		if (operation === needle[position]) position++;
		if (position === needle.length) return;
	}
	throw new Error(
		`missing ordered operations: ${needle.map((op) => Op[op]).join(" -> ")}\n` +
			haystack.map((op) => Op[op]).join(" -> ")
	);
}

describe("canonical full-language visitor coverage", () => {
	it("owns direct eval, import.meta, and dynamic-import option evaluation", () => {
		const [group] = compileRoots(`
			async function exercise() {
				eval(first(), second());
				const metadata = import.meta;
				return import(specifier(), options());
			}
		`);
		const ops = operations(rootUnit(group!));

		expectOrdered(ops, [Op.CALL, Op.CALL, Op.POP, Op.DIRECT_EVAL]);
		expect(ops).toContain(Op.IMPORT_META);
		expectOrdered(ops.slice(ops.indexOf(Op.IMPORT_META)), [
			Op.CALL,
			Op.CALL,
			Op.DYNAMIC_IMPORT,
		]);
		const dynamicImport = rootUnit(group!).nodes.find(
			(node) => node.op === Op.DYNAMIC_IMPORT
		);
		expect(dynamicImport?.operand).toBe(2);
	});

	it("evaluates a computed member logical-assignment reference exactly once", () => {
		const [group] = compileRoots(`
			function exercise(base, key, rhs) {
				return base()[key()] ||= rhs();
			}
		`);
		const ops = operations(rootUnit(group!));

		expect(ops.filter((operation) => operation === Op.CALL)).toHaveLength(3);
		expectOrdered(ops, [
			Op.CALL,
			Op.STORE_REG,
			Op.CALL,
			Op.STORE_REG,
			Op.LOAD_REG,
			Op.LOAD_REG,
			Op.GET_PROP_DYNAMIC,
			Op.DUP,
			Op.JMP_TRUE,
		]);
		expect(ops).toContain(Op.SET_PROP_DYNAMIC);
	});

	it("models for-await iteration explicitly", () => {
		const [group] = compileRoots(`
			async function consume(values) {
				for await (const value of values) sink(value);
			}
		`);
		const asyncOps = operations(rootUnit(group!));

		expectContiguous(asyncOps, [
			Op.GET_ASYNC_ITERATOR,
			Op.ASYNC_ITER_NEXT,
			Op.ASYNC_ITER_DONE,
			Op.JMP_TRUE,
			Op.ASYNC_ITER_VALUE,
		]);
		expect(asyncOps).not.toContain(Op.GET_ITERATOR);
	});

	it("emits explicit public, private, accessor, and static-block class operations", () => {
		const [group] = compileRoots(`
			function exercise(key, side) {
				class Example {
					field = 1;
					#secret = 2;
					static plain = 3;
					static [key()] = 4;
					static #hidden = 5;
					method() { return this.#secret; }
					static factory() { return new this(); }
					get value() { return this.#secret; }
					static set value(next) { this.plain = next; }
					#privateMethod() { return this.#secret; }
					get #privateValue() { return this.#secret; }
					static { side(); }
				}
				return Example;
			}
		`);
		const allOps = group!.units.flatMap(operations);
		const entryOps = operations(rootUnit(group!));

		for (const operation of [
			Op.SET_PRIVATE_FIELD,
			Op.GET_PRIVATE_FIELD,
			Op.DEFINE_STATIC_FIELD,
			Op.SET_PROP_DYNAMIC,
			Op.DEFINE_STATIC_PRIVATE_FIELD,
			Op.DEFINE_STATIC_METHOD,
			Op.DEFINE_STATIC_SETTER,
			Op.DEFINE_PRIVATE_METHOD,
			Op.DEFINE_PRIVATE_GETTER,
			Op.CLASS_STATIC_BLOCK,
		]) {
			expect(allOps).toContain(operation);
		}
		const computedKeyCall = entryOps.indexOf(Op.CALL);
		const computedFieldWrite = entryOps.indexOf(Op.SET_PROP_DYNAMIC);
		expect(computedKeyCall).toBeGreaterThanOrEqual(0);
		expect(computedFieldWrite).toBeGreaterThan(computedKeyCall);
	});

	it("fails closed with stable diagnostics for class forms lacking a sound IR ABI", () => {
		expect(() =>
			compileRoots(`
				function exercise(key) {
					return class { [key()] = 1; };
				}
			`)
		).toThrow("RUAM_CANONICAL_UNSUPPORTED_COMPUTED_INSTANCE_FIELD");

		expect(() =>
			compileRoots(`
				function exercise() {
					return class { static get #value() { return 1; } };
				}
			`)
		).toThrow("RUAM_CANONICAL_UNSUPPORTED_STATIC_PRIVATE_ACCESSOR");

		expect(() =>
			compileRoots(`
				function exercise(scope) {
					with (scope) { return value; }
				}
			`)
		).toThrow("RUAM_CANONICAL_UNSUPPORTED_WITH_SCOPE_UNWINDING");

		expect(() =>
			compileRoots(`
				function exercise(values) { return eval(...values); }
			`)
		).toThrow("RUAM_CANONICAL_UNSUPPORTED_DIRECT_EVAL_SPREAD");
	});
});
