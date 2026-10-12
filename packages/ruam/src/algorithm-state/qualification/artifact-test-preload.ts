/** @module Bun-only test hook for evaluating exact generated artifacts in existing application tests. */
import { plugin } from "bun";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";

const configPath = process.env.RUAM_ARTIFACT_TEST_CONFIG;
const evidencePath = process.env.RUAM_ARTIFACT_TEST_EVIDENCE;
if (!configPath || !evidencePath) throw new Error("Artifact test hook requires an explicit configuration and evidence path");
const config = JSON.parse(readFileSync(configPath, "utf8")) as {
	substitutions: Array<{ source: string; artifact: string; sha256: string }>;
};
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const substitutions = new Map(config.substitutions.map(item => [realpathSync(item.source), item]));
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Bun's runtime requires a result for every matching onLoad callback, so
// register only the requested modules rather than intercepting unrelated tests.
const filter = new RegExp(`^(?:${[...substitutions.keys()].map(escapeRegExp).join("|")})(?:\\?.*)?$`);

plugin({
	name: "ruam-exact-artifact-tests",
	setup(build) {
		build.onLoad({ filter }, args => {
			// Bun includes cache-busting import queries in onLoad's path. Prefer an
			// actual filename first so a literal '?' in a filename is not discarded.
			let source: string;
			try { source = realpathSync(args.path); }
			catch { source = realpathSync(args.path.split("?")[0]!); }
			const replacement = substitutions.get(source);
			if (!replacement) throw new Error("Unexpected artifact substitution path");
			const bytes = readFileSync(replacement.artifact);
			const sha256 = digest(bytes);
			if (sha256 !== replacement.sha256) throw new Error("Artifact changed before test import");
			appendFileSync(evidencePath, JSON.stringify({ source, artifact: replacement.artifact, sha256, bytes: bytes.length, importPath: args.path }) + "\n");
			return { contents: bytes.toString("utf8"), loader: "js" };
		});
	},
});
