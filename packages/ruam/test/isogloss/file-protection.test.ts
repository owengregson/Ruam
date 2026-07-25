import { afterEach, describe, expect, it } from "bun:test";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import {
	protectFile,
	RuamFileSafetyError,
	runProtection,
} from "../../src/index.js";

const temporaryRoots: string[] = [];
const guardedOptions = {
	targetMode: "root" as const,
	regionDomains: {
		guarded: {
			x: { type: "number" as const, min: 0, max: 9 },
		},
	},
};

afterEach(async () => {
	await Promise.all(
		temporaryRoots.splice(0).map((directory) => fs.remove(directory))
	);
});

async function temporaryDirectory(): Promise<string> {
	const directory = await fs.mkdtemp(
		path.join(os.tmpdir(), "ruam-file-protection-")
	);
	temporaryRoots.push(directory);
	return directory;
}

describe("contained two-phase file protection", () => {
	it("rejects traversal matches before reading or changing an outside file", async () => {
		const parent = await temporaryDirectory();
		const root = path.join(parent, "root");
		const outside = path.join(parent, "outside.js");
		await fs.ensureDir(root);
		await fs.writeFile(outside, "const outside = 1;\n", "utf8");

		await expect(
			runProtection(root, { include: ["../outside.js"] })
		).rejects.toMatchObject({
			name: "RuamFileSafetyError",
			code: "RUAM_FILE_PATH_ESCAPE",
		});
		expect(await fs.readFile(outside, "utf8")).toBe("const outside = 1;\n");
	});

	it("plans every transform before publishing any file", async () => {
		const root = await temporaryDirectory();
		const goodPath = path.join(root, "good.js");
		const rejectedPath = path.join(root, "mistyped-target.js");
		const good = "function guarded(x) { return x + 1; }\n";
		const rejected =
			"function differentlyNamed(x) { return externallyObservable(x); }\n";
		await fs.writeFile(goodPath, good, "utf8");
		await fs.writeFile(rejectedPath, rejected, "utf8");

		await expect(
			runProtection(root, { options: guardedOptions })
		).rejects.toThrow("RUAM_ISOGLOSS_CONFIGURED_TARGET_NOT_FOUND");
		expect(await fs.readFile(goodPath, "utf8")).toBe(good);
		expect(await fs.readFile(rejectedPath, "utf8")).toBe(rejected);
	});

	it("refuses direct input and destination symlinks", async () => {
		const root = await temporaryDirectory();
		const source = path.join(root, "source.js");
		const inputLink = path.join(root, "input-link.js");
		const destinationLink = path.join(root, "destination-link.js");
		const destinationTarget = path.join(root, "destination-target.js");
		await fs.writeFile(source, "const value = 1;\n", "utf8");
		await fs.writeFile(destinationTarget, "const original = true;\n", "utf8");
		await fs.symlink(source, inputLink);
		await fs.symlink(destinationTarget, destinationLink);

		await expect(protectFile(inputLink)).rejects.toBeInstanceOf(
			RuamFileSafetyError
		);
		await expect(
			protectFile(source, destinationLink)
		).rejects.toMatchObject({
			code: "RUAM_FILE_DESTINATION_INVALID",
		});
		expect(await fs.readFile(destinationTarget, "utf8")).toBe(
			"const original = true;\n"
		);
	});

	it("refuses hard-linked inputs whose aliases would retain source bytes", async () => {
		const root = await temporaryDirectory();
		const source = path.join(root, "source.js");
		const alias = path.join(root, "alias.js");
		await fs.writeFile(source, "const value = 1;\n", "utf8");
		await fs.link(source, alias);

		await expect(protectFile(source)).rejects.toMatchObject({
			code: "RUAM_FILE_HARDLINK_FORBIDDEN",
		});
		expect(await fs.readFile(alias, "utf8")).toBe("const value = 1;\n");
	});

	it("publishes successful in-place transforms and preserves file mode", async () => {
		const root = await temporaryDirectory();
		const sourcePath = path.join(root, "guarded.js");
		await fs.writeFile(
			sourcePath,
			"function guarded(x) { return x + 1; }\n",
			{ encoding: "utf8", mode: 0o640 }
		);

		const [result] = await runProtection(root, {
			options: guardedOptions,
		});
		expect(result?.build.stats.protectedRegionCount).toBe(1);
		expect(await fs.readFile(sourcePath, "utf8")).not.toContain(
			"return x + 1"
		);
		expect((await fs.stat(sourcePath)).mode & 0o777).toBe(0o640);
	});
});
