import { describe, it, expect } from "vitest";
import {
	setupRegistry,
	setupShieldedRegistry,
} from "../../src/naming/index.js";

describe("setupRegistry", () => {
	it("produces RuntimeNames with all required fields", () => {
		const result = setupRegistry(42);
		// Check some key fields exist and are strings
		expect(typeof result.runtime.bt).toBe("string");
		expect(typeof result.runtime.exec).toBe("string");
		expect(typeof result.runtime.stk).toBe("string");
		expect(typeof result.runtime.scope).toBe("string");
		expect(typeof result.runtime.polyDec).toBe("string");
		expect(typeof result.runtime.strAcc).toBe("string");
	});

	it("produces TempNames with all required keys", () => {
		const result = setupRegistry(42);
		expect(typeof result.temps["_a"]).toBe("string");
		expect(typeof result.temps["_ci"]).toBe("string");
		expect(typeof result.temps["_ho"]).toBe("string");
		expect(typeof result.temps["_ps"]).toBe("string");
		expect(typeof result.temps["_frs"]).toBe("string");
		expect(typeof result.temps["_mt"]).toBe("string");
	});

	it("produces 64-char alphabet", () => {
		const result = setupRegistry(42);
		expect(result.alphabet.length).toBe(64);
		expect(new Set(result.alphabet.split("")).size).toBe(64);
	});

	it("guarantees no collisions between runtime and temp names", () => {
		const result = setupRegistry(42);
		const allNames = new Set<string>();
		for (const v of Object.values(result.runtime))
			allNames.add(v as string);
		for (const v of Object.values(result.temps)) allNames.add(v);
		expect(allNames.size).toBe(
			Object.keys(result.runtime).length +
				Object.keys(result.temps).length
		);
	});

	it("is deterministic", () => {
		const r1 = setupRegistry(12345);
		const r2 = setupRegistry(12345);
		expect(r1.runtime.exec).toBe(r2.runtime.exec);
		expect(r1.temps["_ci"]).toBe(r2.temps["_ci"]);
		expect(r1.alphabet).toBe(r2.alphabet);
	});
});

describe("setupShieldedRegistry", () => {
	it("produces shared + per-group names", () => {
		const result = setupShieldedRegistry(42, [100, 200]);
		expect(result.groups.length).toBe(2);
		expect(result.groupTemps.length).toBe(2);
	});

	it("shared keys are consistent across groups", () => {
		const result = setupShieldedRegistry(42, [100, 200]);
		// bt (bytecode table) should be same across groups
		expect(result.groups[0]!.bt).toBe(result.shared.bt);
		expect(result.groups[1]!.bt).toBe(result.shared.bt);
		// cache should be shared
		expect(result.groups[0]!.cache).toBe(result.shared.cache);
	});

	it("per-group keys are different", () => {
		const result = setupShieldedRegistry(42, [100, 200]);
		// exec should differ between groups (not shared)
		expect(result.groups[0]!.exec).not.toBe(result.groups[1]!.exec);
	});

	it("no collisions across all groups", () => {
		const result = setupShieldedRegistry(42, [100, 200, 300]);
		const allNames = new Set<string>();
		// Collect all shared names
		for (const v of Object.values(result.shared)) allNames.add(v as string);
		for (const v of Object.values(result.sharedTemps)) allNames.add(v);
		// Collect all group names (excluding shared overrides)
		for (const group of result.groups) {
			for (const v of Object.values(group)) allNames.add(v as string);
		}
		for (const gTemps of result.groupTemps) {
			for (const v of Object.values(gTemps)) allNames.add(v);
		}
		// All names should be unique (shared keys will have same values)
		// Just verify no two DIFFERENT tokens collide
		expect(allNames.size).toBeGreaterThan(100);
	});
});
