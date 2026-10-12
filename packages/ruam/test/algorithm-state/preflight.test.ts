import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ALGORITHM_FAMILIES, parseFrozenAudit, reportDestination, sourceDigest, stoppedPreflight, verifyFrozenSources, verifyFrozenBaseline } from "../../src/algorithm-state/qualification/preflight.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function temp() { const path = realpathSync(mkdtempSync(join(tmpdir(), "ruam-a1-preflight-"))); directories.push(path); return path; }
// Schema unit-test data only. These are never included in a root-admission report.
function fixture() {
	return {
		schemaVersion: 1,
		experimentId: "unit-test-schema",
		baselineCommit: "f".repeat(40),
		selection: { frozenBeforeRealizations: true, order: ["root-1", "root-2", "root-3"] },
		dependencySources: [1, 2, 3].map(id => ({ path: `src/${id}.js`, sha256: sourceDigest(`// ${id}\n`) })),
		roots: [1, 2, 3].map(id => ({
			id: `root-${id}`, order: id, entry: { path: `src/${id}.js`, symbol: "Root" }, dependencyPaths: [`src/${id}.js`],
			contract: Object.fromEntries(["initialization", "events", "observations", "reset", "deletion", "duplicates", "identity", "effects", "errors", "numericSemantics"].map(key => [key, "Documented in schema fixture"])),
			ticket: { id: `ticket-${id}`, request: "Partial change", unspecifiedBehavior: ["Unchanged future state"] },
			admission: { status: "rejected", reasonCodes: ["UNKNOWN_DOMAIN"], reasons: [{ code: "UNKNOWN_DOMAIN", detail: "No source proof", evidence: [{ path: `src/${id}.js`, lines: [1, 1] }] }] },
			families: ALGORITHM_FAMILIES.map(family => ({ id: family, status: "unproven", reason: "No applicable realization" })),
		})),
	};
}

describe("A1 frozen audit preflight", () => {
	test("report destinations cannot overwrite inputs, unrelated files or symlinks", () => {
		const repository = temp(), source = join(repository, "source.ts"), output = join(repository, "report.json");
		writeFileSync(source, "// original");
		expect(() => reportDestination(source, [source])).toThrow("qualification input");
		expect(reportDestination(output, [source])).toBe(output);
		writeFileSync(output, JSON.stringify({ schema: "ruam-algorithm-state-preflight-v1" }));
		expect(reportDestination(output, [source])).toBe(output);
		writeFileSync(output, "important unrelated data");
		expect(() => reportDestination(output, [source])).toThrow("unrelated file");
		const link = join(repository, "link.json"); symlinkSync(source, link);
		expect(() => reportDestination(link, [source])).toThrow();
		const broken = join(repository, "broken.json"); symlinkSync(join(repository, "absent"), broken);
		expect(() => reportDestination(broken, [source])).toThrow();
		const alias = join(repository, "directory-alias"); symlinkSync(repository, alias);
		expect(() => reportDestination(join(alias, "source.ts"), [source])).toThrow("qualification input");
	});
	test("keeps full JavaScript scope and never converts rejected roots into compiler authorization", () => {
		const report = stoppedPreflight(parseFrozenAudit(fixture()));
		expect(report.status).toBe("NO-GO");
		expect(report.eligibleRoots).toBe(0);
		expect(report.replaceProductionVm).toBe(false);
		expect(report.compilerConstructionAuthorizedByEvidence).toBe(false);
		expect(report.claimsAiResistance).toBe(false);
		expect(report.requiredJavascriptScope).toBe("current-ruam");
		expect(report.subsetCompilerCanReplaceVm).toBe(false);
	});
	test("a changed flag cannot establish admission or a new algorithm family", () => {
		const audit = fixture(); audit.roots[0]!.admission.status = "admitted";
		expect(() => parseFrozenAudit(audit)).toThrow("cannot establish admission");
		const alternate = fixture(); alternate.roots[0]!.families[0]!.status = "applicable";
		expect(() => parseFrozenAudit(alternate)).toThrow("unverified algorithm-family");
	});
	test("refuses missing, duplicate and reordered roots", () => {
		const missing = fixture(); missing.roots.pop();
		expect(() => parseFrozenAudit(missing)).toThrow();
		const duplicate = fixture(); duplicate.roots[1]!.id = duplicate.roots[0]!.id;
		expect(() => parseFrozenAudit(duplicate)).toThrow();
		const reordered = fixture(); reordered.roots.reverse();
		expect(() => parseFrozenAudit(reordered)).toThrow();
		const wrongOrder = fixture(); wrongOrder.selection.order.reverse();
		expect(() => parseFrozenAudit(wrongOrder)).toThrow();
	});
	test("rejects meaningless contract descriptions and invalid evidence ranges", () => {
		for (const description of [false, 0, {}, [], [""], "  "]) {
			const audit: any = fixture(); audit.roots[0].contract.errors = description;
			expect(() => parseFrozenAudit(audit)).toThrow("invalid description");
		}
		for (const lines of [null, [], "1-2", [0, 1], [-1, 2], [2, 1], [1.2, 2], [1, Infinity]]) {
			const audit: any = fixture(); audit.roots[0].admission.reasons[0].evidence[0].lines = lines;
			expect(() => parseFrozenAudit(audit)).toThrow("source line pair");
		}
		const audit: any = fixture(); audit.roots[0].callSiteEvidencePaths = ["src/not-frozen.js"];
		expect(() => parseFrozenAudit(audit)).toThrow("inventoried");
	});
	test("requires complete contract, ticket, source inventory and rejection evidence", () => {
		const incomplete = fixture(); delete incomplete.roots[0]!.contract.errors;
		expect(() => parseFrozenAudit(incomplete)).toThrow("missing contract");
		const fullReplacement = fixture(); fullReplacement.roots[0]!.ticket.unspecifiedBehavior = [];
		expect(() => parseFrozenAudit(fullReplacement)).toThrow();
		const missingSource = fixture(); missingSource.dependencySources.pop();
		expect(() => parseFrozenAudit(missingSource)).toThrow("inventoried");
		const missingReason = fixture(); missingReason.roots[0]!.admission.reasonCodes.push("UNEXPLAINED");
		expect(() => parseFrozenAudit(missingReason)).toThrow("undocumented");
		const duplicateFamily = fixture(); duplicateFamily.roots[0]!.families[1]!.id = "decision-dataflow";
		expect(() => parseFrozenAudit(duplicateFamily)).toThrow("duplicates");
	});
	test("verifies baseline blobs, not just a plausible Git hash", () => {
		const repository = temp(); mkdirSync(join(repository, "src"));
		for (const id of [1, 2, 3]) writeFileSync(join(repository, `src/${id}.js`), `// ${id}\n`);
		const git = (args: string[]) => execFileSync("git", args, { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
		git(["init", "-q"]); git(["add", "src"]);
		git(["-c", "user.name=Ruam Test", "-c", "user.email=ruam-test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"]);
		const raw = fixture(); raw.baselineCommit = git(["rev-parse", "HEAD"]);
		const audit = parseFrozenAudit(raw);
		expect(() => verifyFrozenBaseline(audit, repository)).not.toThrow();
		const treeAudit = { ...audit, baselineCommit: git(["rev-parse", "HEAD^{tree}"]) };
		expect(() => verifyFrozenBaseline(treeAudit, repository)).toThrow("must be a Git commit");
		// A current-file digest can be recomputed, but the original Git blob still disagrees.
		writeFileSync(join(repository, "src/1.js"), "// changed\n");
		audit.dependencySources[0]!.sha256 = sourceDigest("// changed\n");
		expect(() => verifyFrozenSources(audit, repository)).not.toThrow();
		expect(() => verifyFrozenBaseline(audit, repository)).toThrow("baseline commit");
	});
	test("refuses malformed JSON shapes, versions and unsafe paths", () => {
		for (const input of [null, [], true, {}, { ...fixture(), schemaVersion: 2 }]) expect(() => parseFrozenAudit(input)).toThrow();
		for (const path of ["../outside.js", "/tmp/outside.js", "src//1.js", "src/./1.js", "src\\1.js", "src/1.js\0"]) {
			const audit = fixture(); audit.dependencySources[0]!.path = path;
			expect(() => parseFrozenAudit(audit)).toThrow("source path");
		}
	});
	test("binds exact source bytes and rejects stale audits", () => {
		const repository = temp(); mkdirSync(join(repository, "src"));
		for (const id of [1, 2, 3]) writeFileSync(join(repository, `src/${id}.js`), `// ${id}\n`);
		const audit = parseFrozenAudit(fixture());
		expect(verifyFrozenSources(audit, repository)).toHaveLength(3);
		writeFileSync(join(repository, "src/2.js"), "// 2\r\n");
		expect(() => verifyFrozenSources(audit, repository)).toThrow("Frozen source changed");
	});
	test("refuses symlink sources and ancestor symlinks even when their bytes match", () => {
		const repository = temp(), external = temp(); mkdirSync(join(repository, "src"));
		writeFileSync(join(external, "1.js"), "// 1\n");
		symlinkSync(join(external, "1.js"), join(repository, "src/1.js"));
		expect(() => verifyFrozenSources(parseFrozenAudit(fixture()), repository)).toThrow("Symlink");
		const another = temp(); symlinkSync(external, join(another, "src"));
		expect(() => verifyFrozenSources(parseFrozenAudit(fixture()), another)).toThrow("Symlink");
	});
});
