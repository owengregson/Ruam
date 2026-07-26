import { describe, it, expect } from "bun:test";
import fs from "fs-extra";
import path from "path";
import os from "os";
import {
	stripSourceMappingComment,
	gateSourceMaps,
} from "../../src/source-map-gate.js";

describe("source-map gate", () => {
	it("strips trailing //# sourceMappingURL comment", () => {
		const code = "var a=1;\n//# sourceMappingURL=a.js.map";
		expect(stripSourceMappingComment(code)).toBe("var a=1;");
	});

	it("strips //@ sourceMappingURL comment", () => {
		const code = "var a=1;\n//@ sourceMappingURL=a.js.map\n";
		expect(stripSourceMappingComment(code).trim()).toBe("var a=1;");
	});

	it("strips inline data-URI source maps", () => {
		const code =
			"var a=1;\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==";
		expect(stripSourceMappingComment(code)).toBe("var a=1;");
	});

	it("leaves code without a sourceMappingURL untouched", () => {
		const code = "var a=1;\nvar b=2;";
		expect(stripSourceMappingComment(code)).toBe(code);
	});

	it("deletes .map files and strips comments across a directory tree", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ruam-smap-"));
		try {
			const sub = path.join(dir, "nested");
			await fs.ensureDir(sub);
			await fs.writeFile(
				path.join(dir, "a.js"),
				"var a=1;\n//# sourceMappingURL=a.js.map"
			);
			await fs.writeFile(
				path.join(dir, "a.js.map"),
				JSON.stringify({
					version: 3,
					sources: ["a.ts"],
					sourcesContent: ["const secret = 42;"],
				})
			);
			await fs.writeFile(
				path.join(sub, "b.js"),
				"var b=2;\n//@ sourceMappingURL=b.js.map"
			);
			await fs.writeFile(path.join(sub, "b.js.map"), "{}");

			const removed = await gateSourceMaps(dir, {});

			expect(removed).toBe(2);
			expect(await fs.pathExists(path.join(dir, "a.js.map"))).toBe(false);
			expect(await fs.pathExists(path.join(sub, "b.js.map"))).toBe(false);
			expect(await fs.pathExists(path.join(dir, "a.js"))).toBe(true);
			const a = await fs.readFile(path.join(dir, "a.js"), "utf8");
			const b = await fs.readFile(path.join(sub, "b.js"), "utf8");
			expect(a).not.toContain("sourceMappingURL");
			expect(b).not.toContain("sourceMappingURL");
		} finally {
			await fs.remove(dir);
		}
	});

	it("respects keepSourceMaps", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ruam-smap-"));
		try {
			await fs.writeFile(path.join(dir, "a.js"), "var a=1;");
			await fs.writeFile(path.join(dir, "a.js.map"), "{}");
			const removed = await gateSourceMaps(dir, { keepSourceMaps: true });
			expect(removed).toBe(0);
			expect(await fs.pathExists(path.join(dir, "a.js.map"))).toBe(true);
		} finally {
			await fs.remove(dir);
		}
	});
});
