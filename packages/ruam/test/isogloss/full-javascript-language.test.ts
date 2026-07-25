import { describe, expect, it } from "bun:test";
import { parse } from "@babel/parser";
import { Script } from "node:vm";
import { BABEL_PARSER_PLUGINS } from "../../src/constants.js";
import { protectCodeDeterministic } from "../../src/testing.js";

const KERNEL = `
function __ruamKernel(__ruamX) {
	return (__ruamX + 1) * 2;
}
`;

const KERNEL_DOMAIN = {
	__ruamX: { type: "number" as const, min: -100, max: 100 },
};

function buildScript(body: string, options: Record<string, unknown> = {}) {
	return protectCodeDeterministic(
		`${KERNEL}\n${body}`,
		{
			regionDomains: {
				__ruamKernel: KERNEL_DOMAIN,
				exercise: {},
			},
			...options,
		},
		0x8badf00d
	);
}

async function execute(code: string): Promise<string> {
	const value = new Script(code, { filename: "full-language.js" }).runInNewContext();
	const settled = await value;
	return JSON.stringify(settled, (_key, item) =>
		typeof item === "bigint" ? `${item}n` : item
	);
}

const RUNTIME_CASES = [
	{
		name: "operators, literals, templates, regexps, optional access, and destructuring",
		body: String.raw`
function exercise() {
	let logical = 0;
	logical ||= 4;
	logical &&= 6;
	let missing = null;
	missing ??= 9;
	const source = { a: 2, b: 3, nested: { value: 5 } };
	const { a, ...rest } = source;
	const values = [1, 2, 3];
	const [first, ...tail] = values;
	const tagged = (parts, value) => parts[0] + value + parts[1];
	const optional = source?.nested?.value ?? -1;
	const unicodeSet = /[\p{ASCII}&&\p{Letter}]/v.test("A");
	return [
		1_000 + 2 ** 3,
		2n ** 8n,
		__TAGGED_TEMPLATE__,
		logical,
		missing,
		a,
		rest.b,
		first,
		tail.join(":"),
		unicodeSet,
		void 0,
		typeof absentName,
	];
}
[exercise(), __ruamKernel(3)];
	`.replace("__TAGGED_TEMPLATE__", '`v=${optional}!`'),
	},
	{
		name: "all statement families, labels, switch, iteration, and exception completion",
		body: `
function exercise() {
	const out = [];
	outer: for (let i = 0; i < 5; i++) {
		if (i === 1) continue;
		let j = 0;
		do {
			j++;
			if (i === 4) break outer;
		} while (j < 2);
		out.push(i + j);
	}
	for (const key in { a: 1, b: 2 }) out.push(key);
	for (const value of [7, 8]) out.push(value);
	let count = 0;
	while (count < 2) count++;
	switch (count) {
		case 2: out.push("switch"); break;
		default: out.push("bad");
	}
	try {
		throw new Error("boom");
	} catch ({ message }) {
		out.push(message);
	} finally {
		out.push("finally");
	}
	debugger;
	return out;
}
[exercise(), __ruamKernel(4)];
`,
	},
	{
		name: "functions, parameters, recursion, closures, arguments, this, and new.target",
		body: `
function exercise() {
	function factorial(n) { return n < 2 ? 1 : n * factorial(n - 1); }
	function collect({ left = 1 } = {}, ...rest) {
		const arrow = (extra = 0) => left + rest.length + arguments.length + extra;
		return arrow;
	}
	function Construct(value) {
		this.value = value;
		this.constructed = new.target === Construct;
	}
	const closure = collect({ left: 5 }, 1, 2);
	const instance = Reflect.construct(Construct, [9]);
	const method = { base: 4, run(step) { return this.base + step; } };
	return [factorial(6), closure(3), instance.value, instance.constructed, method.run.call(method, 8)];
}
[exercise(), __ruamKernel(5)];
`,
	},
	{
		name: "classes, inheritance, private state, fields, accessors, and static blocks",
		body: `
function exercise() {
	const computed = "double";
	class Base {
		static total = 1;
		static { this.total += 2; }
		constructor(value) { this.value = value; }
		get current() { return this.value; }
		set current(value) { this.value = value; }
	}
	class Derived extends Base {
		#offset = 4;
		#read() { return this.#offset; }
		[computed]() { return super.current * 2 + this.#read(); }
		static hasOffset(instance) { return #offset in instance; }
	}
	const item = new Derived(7);
	item.current = 9;
	return [item.double(), Derived.hasOffset(item), Derived.total];
}
[exercise(), __ruamKernel(6)];
`,
	},
	{
		name: "objects, accessors, proxies, symbols, deletion, and observable coercion",
		body: `
function exercise() {
	const events = [];
	const target = {
		value: 3,
		get doubled() { events.push("get"); return this.value * 2; },
		set doubled(value) { events.push("set"); this.value = value / 2; },
		[Symbol.toPrimitive](hint) { events.push(hint); return this.value; },
	};
	const proxy = new Proxy(target, {
		get(object, key, receiver) { events.push(String(key)); return Reflect.get(object, key, receiver); },
		set(object, key, value, receiver) { events.push("write:" + String(key)); return Reflect.set(object, key, value, receiver); },
	});
	proxy.doubled = 20;
	const beforeDelete = proxy.doubled;
	const coerced = proxy + 5;
	const hadValue = "value" in proxy;
	const deleted = delete proxy.value;
	return [beforeDelete, coerced, hadValue, deleted, events];
}
[exercise(), __ruamKernel(7)];
`,
	},
	{
		name: "generators, delegation, async functions, async generators, and await",
		body: `
function* sequence() { yield 1; yield* [2, 3]; return 4; }
async function* asyncSequence() { yield await Promise.resolve(5); yield 6; }
async function exercise() {
	const sync = [];
	for (const value of sequence()) sync.push(value);
	const asyncValues = [];
	for await (const value of asyncSequence()) asyncValues.push(value);
	const settled = await Promise.all([Promise.resolve(7), 8]);
	return [sync, asyncValues, settled];
}
Promise.all([exercise(), Promise.resolve(__ruamKernel(8))]);
`,
	},
	{
		name: "direct eval, Function construction, dynamic scope, and sloppy with",
		body: `
function exercise() {
	let local = 11;
	const direct = eval("local + 1");
	const constructed = Function("a", "return a * 3")(4);
	let dynamic = 0;
	with ({ dynamicValue: 13 }) {
		dynamic = dynamicValue;
	}
	return [direct, constructed, dynamic];
}
[exercise(), __ruamKernel(9)];
`,
	},
] as const;

describe("full JavaScript Isogloss language coverage", () => {
	for (const fixture of RUNTIME_CASES) {
		it(`preserves ${fixture.name}`, async () => {
			const build = buildScript(fixture.body);
			const original = `${KERNEL}\n${fixture.body}`;

			expect(await execute(build.code)).toBe(await execute(original));
			expect(build.stats.languageCoverage).toBe("full-javascript");
			expect(build.stats.protectedRegionCount).toBe(1);
			expect(build.stats.nativeFunctionCount).toBeGreaterThan(0);
		});
	}

	it("mixes protected and native returns inside one configured function", async () => {
		const source = `
function exercise(x, object) {
	if (object.native) return object.value;
	return (x + 1) * 2;
}
[exercise(3, { native: false }), exercise(-2, { native: true, value: 19 })];
`;
		const build = protectCodeDeterministic(
			source,
			{
				regionDomains: {
					exercise: {
						x: { type: "number", min: -10, max: 10 },
					},
				},
			},
			123
		);

		expect(await execute(build.code)).toBe(await execute(source));
		expect(build.stats).toMatchObject({
			protectedRegionCount: 1,
			nativeRegionCount: 1,
			targetFunctionCount: 1,
			nativeFunctionCount: 1,
			hybridFunctionCount: 1,
			languageCoverage: "full-javascript",
		});
	});

	it("keeps direct eval bindings stable when identifier preprocessing is requested", async () => {
		const source = `
function exercise(x) {
	let secret = 17;
	if (x < 0) return eval("secret + 1");
	return (x + 1) * 2;
}
[exercise(-1), exercise(4)];
`;
		const build = protectCodeDeterministic(
			source,
			{
				preprocessIdentifiers: true,
				regionDomains: {
					exercise: {
						x: { type: "number", min: -10, max: 10 },
					},
				},
			},
			456
		);

		expect(await execute(build.code)).toBe(await execute(source));
		expect(build.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "RUAM_ISOGLOSS_IDENTIFIER_PREPROCESS_SKIPPED",
				detail: "eval call",
			})
		);
	});

	it("keeps indirect eval access to global lexical bindings stable", async () => {
		const source = `
let globalSecret = 23;
function exercise(x) {
	if (x < 0) return (0, eval)("globalSecret + 1");
	return (x + 1) * 2;
}
[exercise(-1), exercise(4)];
`;
		const build = protectCodeDeterministic(
			source,
			{
				preprocessIdentifiers: true,
				regionDomains: {
					exercise: {
						x: { type: "number", min: -10, max: 10 },
					},
				},
			},
			457
		);

		expect(await execute(build.code)).toBe(await execute(source));
		expect(build.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "RUAM_ISOGLOSS_IDENTIFIER_PREPROCESS_SKIPPED",
				detail: "eval reference",
			})
		);
	});

	it("emits BPRF helpers even when author code shadows every former intrinsic dependency", async () => {
		const source = `
const Array = "array", Error = "error", Math = "math", Number = "number", Object = "object";
${KERNEL}
[Array, Error, Math, Number, Object, __ruamKernel(10)];
`;
		const build = protectCodeDeterministic(
			source,
			{ regionDomains: { __ruamKernel: KERNEL_DOMAIN } },
			789
		);

		expect(await execute(build.code)).toBe(await execute(source));
		expect(build.stats.protectedRegionCount).toBe(1);
	});

	it("round-trips module syntax, top-level await, import attributes, and resource management", () => {
		const moduleSource = `#!/usr/bin/env node
"use client";
import data from "./fixture.json" with { type: "json" };
import * as tools from "./tools.js";
export { data as renamed };
export * as namespace from "./namespace.js";
export default async function load(value = data) {
	await using resource = tools.open(value);
	return await resource.read();
}
${KERNEL}
await Promise.resolve(import.meta.url);
`;
		const build = protectCodeDeterministic(
			moduleSource,
			{ regionDomains: { __ruamKernel: KERNEL_DOMAIN } },
			321
		);
		const reparsed = parse(build.code, {
			sourceType: "module",
			plugins: [...BABEL_PARSER_PLUGINS],
		});
		const nodeTypes = new Set(reparsed.program.body.map((node) => node.type));

		expect(build.stats.protectedRegionCount).toBe(1);
		expect(build.stats.languageCoverage).toBe("full-javascript");
		expect(nodeTypes).toContain("ImportDeclaration");
		expect(nodeTypes).toContain("ExportDefaultDeclaration");
		expect(nodeTypes).toContain("ExportNamedDeclaration");
		expect(build.code.startsWith("#!/usr/bin/env node")).toBe(true);
	});

	it("retains the existing TypeScript and JSX source extensions", () => {
		const extensionSource = `
interface Props { readonly value?: number }
type Result<T> = { value: T };
const View = ({ value = 1 }: Props): JSX.Element => <section data-value={value}>{value}</section>;
const boxed = <T,>(value: T): Result<T> => ({ value });
${KERNEL}
export { View, boxed };
`;
		const build = protectCodeDeterministic(
			extensionSource,
			{ regionDomains: { __ruamKernel: KERNEL_DOMAIN } },
			654
		);

		expect(() =>
			parse(build.code, {
				sourceType: "module",
				plugins: [...BABEL_PARSER_PLUGINS],
			})
		).not.toThrow();
		expect(build.code).toContain("interface Props");
		expect(build.code).toContain("<section");
	});
});
