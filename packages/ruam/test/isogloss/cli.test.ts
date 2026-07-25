import { afterEach, describe, expect, it } from "bun:test";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dir, "../..");
const cliPath = path.join(packageRoot, "src/cli.ts");
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => fs.remove(directory))
	);
});

function runCli(...args: string[]): {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
} {
	const result = Bun.spawnSync({
		cmd: [process.execPath, cliPath, ...args],
		cwd: packageRoot,
		env: {
			...process.env,
			FORCE_COLOR: "0",
			NO_COLOR: "1",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
	};
}

describe("Isogloss CLI cutover", () => {
	it("documents only the frozen Isogloss option surface", () => {
		const result = runCli("--help");

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain(
			"Isogloss JavaScript Source Protection"
		);
		expect(result.stdout).toContain("--profile");
		expect(result.stdout).toContain("--region-domains");
		expect(result.stdout).toContain("--owner-trace");
		expect(result.stdout).toContain("/* ruam:isogloss */");
		expect(result.stdout).toContain(
			"Custodied, private-function, and TEE deployment remains an unpublished owner integration"
		);
		expect(result.stdout).not.toContain("--custodian-endpoint");
		expect(result.stdout).not.toContain("--preset");
		expect(result.stdout).not.toContain("ruamvm");
		expect(result.stdout).not.toContain("bytecode");
		expect(result.stdout).not.toMatch(/\bVM\b/);
	});

	it("rejects every former execution flag rather than treating it as an alias", () => {
		const removedFlags = [
			"--preset",
			"-e",
			"--encrypt",
			"-d",
			"--debug-protection",
			"--no-debug-protection",
			"--debug-logging",
			"--dynamic-opcodes",
			"--decoy-opcodes",
			"--dead-code",
			"--stack-encoding",
			"--rolling-cipher",
			"--integrity-binding",
			"--vm-shielding",
			"--mba",
			"--handler-fragmentation",
			"--string-atomization",
			"--polymorphic-decoder",
			"--scattered-keys",
			"--block-permutation",
			"--opcode-mutation",
			"--bytecode-scattering",
			"--incremental-cipher",
			"--semantic-opacity",
			"--observation-resistance",
		];

		for (const flag of removedFlags) {
			const result = runCli(flag);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("RUAM_REMOVED_CLI_OPTION");
			expect(result.stderr).toContain(flag);
		}
	});

	it("rejects nonlocal profiles before source or capability processing", () => {
		for (const profile of [
			"holographic-custodied",
			"holographic-private",
			"holographic-tee",
		]) {
			const result = runCli(
				"does-not-exist.js",
				"--profile",
				profile
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(
				"RUAM_CLI_PROFILE_REQUIRES_PRODUCT_PLANNER"
			);
			expect(result.stderr).toContain(
				"unpublished owner deployment pipeline"
			);
			expect(result.stderr).not.toContain("does not exist");
		}
	});

	it("protects a configured local region and writes the owner sidecar", async () => {
		const directory = await fs.mkdtemp(
			path.join(os.tmpdir(), "ruam-isogloss-cli-")
		);
		temporaryDirectories.push(directory);
		const inputPath = path.join(directory, "input.js");
		const outputPath = path.join(directory, "output.js");
		const domainsPath = path.join(directory, "domains.json");
		const ownerTracePath = path.join(directory, "owner-trace.json");
		await fs.writeFile(
			inputPath,
			"function crown(x,y){return (x*y)+(x-3);}",
			"utf8"
		);
		await fs.writeJson(domainsPath, {
			crown: {
				x: { type: "number", min: 1, max: 20 },
				y: { type: "number", min: 2, max: 30 },
			},
		});

		const result = runCli(
			inputPath,
			"--output",
			outputPath,
			"--region-domains",
			domainsPath,
			"--owner-trace",
			ownerTracePath
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).not.toContain("Protection failed");
		expect(result.stdout + result.stderr).toContain("Protection complete");
		const output = await fs.readFile(outputPath, "utf8");
		expect(output).not.toContain("(x * y) + (x - 3)");
		expect(
			Function(`"use strict";${output};return crown(7,11);`)()
		).toBe(81);
		const ownerTrace = await fs.readJson(ownerTracePath);
		expect(ownerTrace.format).toBe("ruam-isogloss-owner-trace-1");
		expect(ownerTrace.regions).toHaveLength(1);
		expect(
			ownerTrace.regions[0].emitterCertificate
				.maxExactDyadicNumeratorMagnitude
		).toMatch(/^[0-9]+$/);
	});

	it("rejects an owner-trace symlink that aliases the source tree", async () => {
		const directory = await fs.mkdtemp(
			path.join(os.tmpdir(), "ruam-isogloss-cli-trace-alias-")
		);
		temporaryDirectories.push(directory);
		const sourceDirectory = path.join(directory, "source");
		const outputDirectory = path.join(directory, "client");
		const traceAlias = path.join(directory, "owner-trace");
		const domainsPath = path.join(directory, "domains.json");
		await fs.ensureDir(sourceDirectory);
		await fs.writeFile(
			path.join(sourceDirectory, "guarded.js"),
			"function crown(x,y){return (x*y)+(x-3);}",
			"utf8"
		);
		await fs.writeJson(domainsPath, {
			crown: {
				x: { type: "number", min: 1, max: 20 },
				y: { type: "number", min: 2, max: 30 },
			},
		});
		await fs.symlink(sourceDirectory, traceAlias, "dir");

		const result = runCli(
			sourceDirectory,
			"--output",
			outputDirectory,
			"--region-domains",
			domainsPath,
			"--owner-trace",
			traceAlias
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("RUAM_CLI_OUTPUT_OVERLAP");
		expect(
			await fs.pathExists(
				path.join(
					sourceDirectory,
					"guarded.js.owner-trace.json"
				)
			)
		).toBe(false);
	});

	it("rejects a single-file owner trace beneath a symlinked parent", async () => {
		const directory = await fs.mkdtemp(
			path.join(os.tmpdir(), "ruam-isogloss-cli-file-trace-alias-")
		);
		temporaryDirectories.push(directory);
		const inputPath = path.join(directory, "guarded.js");
		const outputPath = path.join(directory, "client.js");
		const domainsPath = path.join(directory, "domains.json");
		const traceParent = path.join(directory, "trace-parent");
		const leakedTrace = path.join(directory, "leak.json");
		await fs.writeFile(
			inputPath,
			"function crown(x,y){return (x*y)+(x-3);}",
			"utf8"
		);
		await fs.writeJson(domainsPath, {
			crown: {
				x: { type: "number", min: 1, max: 20 },
				y: { type: "number", min: 2, max: 30 },
			},
		});
		await fs.symlink(directory, traceParent, "dir");

		const result = runCli(
			inputPath,
			"--output",
			outputPath,
			"--region-domains",
			domainsPath,
			"--owner-trace",
			path.join(traceParent, "leak.json")
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("RUAM_CLI_OUTPUT_OVERLAP");
		expect(await fs.pathExists(leakedTrace)).toBe(false);
	});

	it("publishes only the ruam executable and Isogloss package identity", async () => {
		const manifest = await fs.readJson(
			path.join(packageRoot, "package.json")
		);

		expect(manifest.name).toBe("ruam");
		expect(manifest.bin).toEqual({ ruam: "dist/cli.js" });
		expect(manifest.description).toContain("Isogloss");
		expect(JSON.stringify(manifest)).not.toContain("ruamvm");
		expect(manifest.keywords).not.toContain("vm");
		expect(manifest.keywords).not.toContain("bytecode");
	});
});
