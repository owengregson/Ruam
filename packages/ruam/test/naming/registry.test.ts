import { describe, it, expect } from "bun:test";
import {
	NameToken,
	NameScope,
	NameRegistry,
	RestParam,
} from "../../src/naming/index.js";

describe("NameToken", () => {
	it("throws when accessed before resolution", () => {
		const registry = new NameRegistry(12345);
		const scope = registry.createScope("test", { lengthTier: "short" });
		const token = scope.claim("myVar");
		expect(() => token.name).toThrow("not yet resolved");
		expect(() => token.toString()).toThrow("not yet resolved");
	});

	it("returns resolved name after resolveAll", () => {
		const registry = new NameRegistry(12345);
		const scope = registry.createScope("test", { lengthTier: "short" });
		const token = scope.claim("myVar");
		registry.resolveAll();
		expect(typeof token.name).toBe("string");
		expect(token.name.length).toBeGreaterThanOrEqual(2);
		expect(token.name.length).toBeLessThanOrEqual(3);
		expect(token.toString()).toBe(token.name);
	});
});

describe("NameScope", () => {
	it("rejects duplicate keys", () => {
		const registry = new NameRegistry(99);
		const scope = registry.createScope("test", { lengthTier: "short" });
		scope.claim("foo");
		expect(() => scope.claim("foo")).toThrow("Duplicate key");
	});

	it("supports claimMany", () => {
		const registry = new NameRegistry(99);
		const scope = registry.createScope("test", { lengthTier: "short" });
		const tokens = scope.claimMany(["a", "b", "c"]);
		registry.resolveAll();
		expect(Object.keys(tokens)).toEqual(["a", "b", "c"]);
		const names = new Set(Object.values(tokens).map((t) => t.name));
		expect(names.size).toBe(3); // all unique
	});
});

describe("NameRegistry", () => {
	it("prevents collisions across scopes", () => {
		const registry = new NameRegistry(42);
		const s1 = registry.createScope("scope1", { lengthTier: "short" });
		const s2 = registry.createScope("scope2", { lengthTier: "short" });
		// Claim 100 names in each scope
		const tokens: NameToken[] = [];
		for (let i = 0; i < 100; i++) {
			tokens.push(s1.claim(`a${i}`));
			tokens.push(s2.claim(`b${i}`));
		}
		registry.resolveAll();
		const names = new Set(tokens.map((t) => t.name));
		expect(names.size).toBe(200); // all unique
	});

	it("produces deterministic names from same seed", () => {
		const r1 = new NameRegistry(12345);
		const r2 = new NameRegistry(12345);
		const s1 = r1.createScope("test", { lengthTier: "medium" });
		const s2 = r2.createScope("test", { lengthTier: "medium" });
		const t1 = s1.claim("myVar");
		const t2 = s2.claim("myVar");
		r1.resolveAll();
		r2.resolveAll();
		expect(t1.name).toBe(t2.name);
	});

	it("produces different names from different seeds", () => {
		const r1 = new NameRegistry(11111);
		const r2 = new NameRegistry(22222);
		const s1 = r1.createScope("test", { lengthTier: "medium" });
		const s2 = r2.createScope("test", { lengthTier: "medium" });
		const t1 = s1.claim("myVar");
		const t2 = s2.claim("myVar");
		r1.resolveAll();
		r2.resolveAll();
		expect(t1.name).not.toBe(t2.name);
	});

	it("respects length tiers", () => {
		const registry = new NameRegistry(42);
		const short = registry.createScope("short", { lengthTier: "short" });
		const long = registry.createScope("long", { lengthTier: "long" });
		const tokens: NameToken[] = [];
		for (let i = 0; i < 50; i++) {
			tokens.push(short.claim(`s${i}`));
			tokens.push(long.claim(`l${i}`));
		}
		registry.resolveAll();
		const shortNames = tokens
			.filter((_, i) => i % 2 === 0)
			.map((t) => t.name);
		const longNames = tokens
			.filter((_, i) => i % 2 === 1)
			.map((t) => t.name);
		// Short: 2-3 chars, Long: 4-5 chars
		for (const n of shortNames) {
			expect(n.length).toBeGreaterThanOrEqual(2);
			expect(n.length).toBeLessThanOrEqual(3);
		}
		for (const n of longNames) {
			expect(n.length).toBeGreaterThanOrEqual(4);
			expect(n.length).toBeLessThanOrEqual(5);
		}
	});

	it("never generates reserved words", () => {
		const registry = new NameRegistry(42);
		const scope = registry.createScope("test", { lengthTier: "short" });
		// Claim enough names to force many PRNG draws
		for (let i = 0; i < 500; i++) {
			scope.claim(`v${i}`);
		}
		registry.resolveAll();
		const reserved = new Set([
			"do",
			"if",
			"in",
			"of",
			"for",
			"let",
			"new",
			"try",
			"var",
		]);
		for (const [, token] of scope.tokens) {
			expect(reserved.has(token.name)).toBe(false);
		}
	});

	it("generates valid JS identifiers", () => {
		const registry = new NameRegistry(42);
		const scope = registry.createScope("test", { lengthTier: "medium" });
		for (let i = 0; i < 200; i++) scope.claim(`v${i}`);
		registry.resolveAll();
		const validId = /^[a-zA-Z][a-zA-Z0-9]*$/;
		for (const [, token] of scope.tokens) {
			expect(token.name).toMatch(validId);
		}
	});

	it("generates alphabet", () => {
		const registry = new NameRegistry(42);
		registry.createScope("test", { lengthTier: "short" });
		registry.resolveAll();
		const alphabet = registry.getAlphabet();
		expect(alphabet.length).toBe(64);
		expect(new Set(alphabet.split("")).size).toBe(64); // all unique
	});

	it("freezes after resolveAll", () => {
		const registry = new NameRegistry(42);
		registry.createScope("test", { lengthTier: "short" });
		registry.resolveAll();
		expect(() => registry.createScope("new")).toThrow("frozen");
	});

	it("shielded mode hierarchy produces unique per-group names with shared consistency", () => {
		const registry = new NameRegistry(42);
		const shared = registry.createScope("shared", { lengthTier: "medium" });
		const sharedToken = shared.claim("cache");

		const g0 = registry.createScope("group0");
		const g0interp = registry.createScope("interpreter", {
			parent: g0,
			lengthTier: "short",
		});
		const g1 = registry.createScope("group1");
		const g1interp = registry.createScope("interpreter", {
			parent: g1,
			lengthTier: "short",
		});

		const g0exec = g0interp.claim("exec");
		const g1exec = g1interp.claim("exec");

		registry.resolveAll();

		// Shared token is accessible to both groups
		expect(typeof sharedToken.name).toBe("string");
		// Per-group tokens are different
		expect(g0exec.name).not.toBe(g1exec.name);
		// No collisions with shared
		expect(g0exec.name).not.toBe(sharedToken.name);
		expect(g1exec.name).not.toBe(sharedToken.name);
	});

	it("handles 2000+ tokens without exhaustion", () => {
		const registry = new NameRegistry(42);
		const scope = registry.createScope("stress", { lengthTier: "short" });
		for (let i = 0; i < 2000; i++) scope.claim(`v${i}`);
		expect(() => registry.resolveAll()).not.toThrow();
	});

	it("scope isolation — adding names in one scope doesn't affect another", () => {
		// Two registries with same seed, but different scope populations
		const r1 = new NameRegistry(42);
		const r2 = new NameRegistry(42);
		const s1a = r1.createScope("scopeA", { lengthTier: "short" });
		const s1b = r1.createScope("scopeB", { lengthTier: "short" });
		const s2a = r2.createScope("scopeA", { lengthTier: "short" });
		const s2b = r2.createScope("scopeB", { lengthTier: "short" });
		// Same claims in scopeA
		const t1 = s1a.claim("x");
		const t2 = s2a.claim("x");
		// Different claims in scopeB — only r1 has extra names
		for (let i = 0; i < 50; i++) s1b.claim(`extra${i}`);
		s2b.claim("only_one");
		r1.resolveAll();
		r2.resolveAll();
		// scopeA tokens should resolve identically despite scopeB differences
		expect(t1.name).toBe(t2.name);
	});
});

describe("RestParam", () => {
	it("formats with ... prefix after resolution", () => {
		const registry = new NameRegistry(42);
		const scope = registry.createScope("test", { lengthTier: "short" });
		const token = scope.claim("args");
		const rest = new RestParam(token);
		registry.resolveAll();
		expect(rest.toString()).toBe(`...${token.name}`);
	});

	it("works with string names", () => {
		const rest = new RestParam("args");
		expect(rest.toString()).toBe("...args");
	});
});
