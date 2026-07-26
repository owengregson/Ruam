import { describe, expect, it } from "bun:test";
import { parse } from "@babel/parser";
import { BABEL_PARSER_PLUGINS } from "../../src/constants.js";
import {
	compileProtectedSourceRoots,
	IsoglossSemanticCompileError,
} from "../../src/isogloss/source-roots.js";

function parseSource(source: string) {
	return parse(source, {
		sourceType: "unambiguous",
		plugins: [...BABEL_PARSER_PLUGINS],
	});
}

describe("protected source-root compilation", () => {
	it("compiles complete top-level roots and owns their nested functions", () => {
		const roots = compileProtectedSourceRoots(
			parseSource(`
function outer(x) {
	function inner(y) { return y + 1; }
	return inner(x);
}
const arrow = (value) => value * 2;
`),
			{ targetMode: "root", threshold: 1, seed: 123 }
		);

		expect(roots.map((root) => root.name)).toEqual(["outer", "arrow"]);
		expect(roots[0]!.group.units).toHaveLength(2);
		expect(roots[1]!.group.units).toHaveLength(1);
		expect(roots.every((root) => root.group.id === root.id)).toBe(true);
		expect(
			roots.every((root) => root.group.units.every((unit) => unit.nodes.length > 0))
		).toBe(true);
	});

	it("uses stable source identities for methods and duplicate names", () => {
		const source = `
const left = { run(value) { return value + 1; } };
const right = { run(value) { return value + 2; } };
class Example { method(value) { return value + 3; } }
`;
		const first = compileProtectedSourceRoots(parseSource(source), {
			targetMode: "root",
			threshold: 1,
			seed: 456,
		});
		const second = compileProtectedSourceRoots(parseSource(source), {
			targetMode: "root",
			threshold: 1,
			seed: 456,
		});

		expect(first.map((root) => root.name)).toEqual(["run", "run", "method"]);
		expect(new Set(first.map((root) => root.id)).size).toBe(3);
		expect(first.map((root) => root.id)).toEqual(second.map((root) => root.id));
	});

	it("honors explicit comment selection without compiling unmarked roots", () => {
		const roots = compileProtectedSourceRoots(
			parseSource(`
/* ruam:isogloss */
function selected(value) { return value + 1; }
function ordinary(value) { return value + 2; }
`),
			{ targetMode: "comment", threshold: 1, seed: 789 }
		);

		expect(roots).toHaveLength(1);
		expect(roots[0]!.name).toBe("selected");
	});

	it("rejects invalid selection inputs before compilation", () => {
		expect(() =>
			compileProtectedSourceRoots(parseSource("function f() {}"), {
				targetMode: "root",
				threshold: 2,
				seed: 1,
			})
		).toThrow(IsoglossSemanticCompileError);
	});
});
