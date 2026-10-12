/** Owner-side verification of a frozen research audit, not an admission prover. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const ALGORITHM_FAMILIES = ["decision-dataflow", "indexed-relational", "incremental-views"] as const;
const MAX_SOURCES = 128;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const HEX_DIGEST = /^[a-f0-9]{64}$/;

export class PreflightError extends Error {
	readonly name = "PreflightError";
}

function fail(detail: string): never { throw new PreflightError(detail); }
function record(value: unknown, where: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${where} must be an object`);
	return value as Record<string, unknown>;
}
function list(value: unknown, where: string, minimum = 1, maximum = MAX_SOURCES): unknown[] {
	if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(`${where} has an invalid length`);
	return value;
}
function nonempty(value: unknown, where: string): string {
	if (typeof value !== "string" || !value.trim()) fail(`${where} must be a nonempty string`);
	return value;
}
function unique(values: readonly string[], where: string): void {
	if (new Set(values).size !== values.length) fail(`${where} must not contain duplicates`);
}
function sourcePath(value: unknown): string {
	const path = nonempty(value, "source path");
	if (isAbsolute(path) || path.includes("\\") || path.includes("\0") || path.split("/").some(part => !part || part === "." || part === "..")) {
		fail(`Invalid repository-relative source path: ${path}`);
	}
	return path;
}

export interface AuditedRoot {
	id: string;
	order: number;
	entry: { path: string; symbol: string };
	dependencyPaths: string[];
	evidence: { path: string; lines: [number, number] }[];
	admission: { status: "rejected"; reasonCodes: string[] };
	families: { id: typeof ALGORITHM_FAMILIES[number]; status: "unproven" | "inapplicable"; reason: string }[];
}
export interface FrozenAudit {
	baselineCommit: string;
	experimentId: string;
	dependencySources: { path: string; sha256: string }[];
	roots: AuditedRoot[];
}

/**
 * This version accepts rejection audits only. Adding an admission claim requires
 * a separate source-derived proof checker; changing a JSON flag cannot promote it.
 */
export function parseFrozenAudit(input: unknown): FrozenAudit {
	const data = record(input, "audit");
	if (data.schemaVersion !== 1) fail("Unsupported audit schema");
	const experimentId = nonempty(data.experimentId, "experimentId");
	const baselineCommit = nonempty(data.baselineCommit, "baselineCommit");
	if (!/^[a-f0-9]{40}$/.test(baselineCommit)) fail("baselineCommit must be a full Git object ID");
	const dependencySources = list(data.dependencySources, "dependencySources").map(value => {
		const item = record(value, "dependency source");
		const path = sourcePath(item.path), sha256 = nonempty(item.sha256, "source digest");
		if (!HEX_DIGEST.test(sha256)) fail(`Invalid source digest: ${path}`);
		return { path, sha256 };
	});
	unique(dependencySources.map(source => source.path), "dependency sources");
	const sources = new Set(dependencySources.map(source => source.path));
	const roots = list(data.roots, "roots", 3, 3).map((value, index): AuditedRoot => {
		const root = record(value, "root"), id = nonempty(root.id, "root id");
		if (root.order !== index + 1) fail(`${id}: roots must retain their frozen order`);
		const entry = record(root.entry, `${id}.entry`);
		const path = sourcePath(entry.path), symbol = nonempty(entry.symbol, `${id}.symbol`);
		const dependencyPaths = list(root.dependencyPaths, `${id}.dependencyPaths`).map(sourcePath);
		unique(dependencyPaths, `${id} dependencies`);
		if (!dependencyPaths.includes(path) || dependencyPaths.some(item => !sources.has(item))) fail(`${id}: every source must be inventoried`);
		for (const key of ["typeOnlyDependencyPaths", "callSiteEvidencePaths"]) {
			if (root[key] === undefined) continue;
			const paths = list(root[key], `${id}.${key}`, 0).map(sourcePath);
			unique(paths, `${id}.${key}`);
			if (paths.some(item => !sources.has(item))) fail(`${id}: ${key} must be inventoried`);
		}
		const contract = record(root.contract, `${id}.contract`);
		for (const key of ["initialization", "events", "observations", "reset", "deletion", "duplicates", "identity", "effects", "errors", "numericSemantics"]) {
			const field = contract[key];
			if (typeof field === "string" && field.trim()) continue;
			if (Array.isArray(field) && field.length > 0 && field.every(item => typeof item === "string" && item.trim())) continue;
			fail(`${id}: missing contract field ${key} or invalid description`);
		}
		const ticket = record(root.ticket, `${id}.ticket`);
		nonempty(ticket.id, `${id}.ticket.id`);
		nonempty(ticket.request, `${id}.ticket.request`);
		list(ticket.unspecifiedBehavior, `${id}.ticket.unspecifiedBehavior`).forEach(value => nonempty(value, "unspecified behavior"));
		const admission = record(root.admission, `${id}.admission`);
		if (admission.status !== "rejected") fail(`${id}: this audit cannot establish admission or promote a compiler`);
		const reasonCodes = list(admission.reasonCodes, `${id}.reasonCodes`).map(value => nonempty(value, "reason code"));
		unique(reasonCodes, `${id} rejection reasons`);
		const reasons = list(admission.reasons, `${id}.reasons`);
		const sourceEvidence: AuditedRoot["evidence"] = [];
		const recordedCodes = reasons.map(value => {
			const reason = record(value, "reason"), code = nonempty(reason.code, "reason code");
			nonempty(reason.detail, "reason detail");
			for (const evidence of list(reason.evidence, "reason evidence")) {
				const item = record(evidence, "evidence");
				if (!dependencyPaths.includes(sourcePath(item.path))) fail(`${id}: evidence must refer to this root's frozen sources`);
				if (!Array.isArray(item.lines) || item.lines.length !== 2 || !item.lines.every(line => Number.isSafeInteger(line) && line > 0) || item.lines[0] > item.lines[1]) fail(`${id}: evidence needs a positive ordered source line pair`);
				sourceEvidence.push({ path: item.path as string, lines: [item.lines[0], item.lines[1]] });
			}
			return code;
		});
		unique(recordedCodes, `${id} documented reasons`);
		if (recordedCodes.length !== reasonCodes.length || reasonCodes.some(code => !recordedCodes.includes(code))) fail(`${id}: undocumented rejection reason`);
		const families = list(root.families, `${id}.families`, 3, 3).map((value): AuditedRoot["families"][number] => {
			const family = record(value, "family");
			if (!ALGORITHM_FAMILIES.includes(family.id as typeof ALGORITHM_FAMILIES[number])) fail(`${id}: unknown algorithm family`);
			if (family.status !== "unproven" && family.status !== "inapplicable") fail(`${id}: unverified algorithm-family claim`);
			return { id: family.id as typeof ALGORITHM_FAMILIES[number], status: family.status, reason: nonempty(family.reason, "family reason") };
		});
		unique(families.map(family => family.id), `${id} algorithm families`);
		return { id, order: index + 1, entry: { path, symbol }, dependencyPaths, evidence: sourceEvidence, admission: { status: "rejected", reasonCodes }, families };
	});
	unique(roots.map(root => root.id), "root IDs");
	unique(roots.map(root => `${root.entry.path}::${root.entry.symbol}`), "root entries");
	const selection = record(data.selection, "selection");
	if (selection.frozenBeforeRealizations !== true) fail("Selection was not frozen before realizations");
	const order = list(selection.order, "selection order", 3, 3);
	if (order.some((id, index) => id !== roots[index]!.id)) fail("Selection order differs from root order");
	return { experimentId, baselineCommit, dependencySources, roots };
}

export const sourceDigest = (source: Uint8Array | string): string => createHash("sha256").update(source).digest("hex");

/** Qualification may replace its own report, never source or unrelated files. */
export function reportDestination(output: string, protectedFiles: readonly string[]): string {
	const canonical = resolve(realpathSync(dirname(output)), basename(output));
	if (protectedFiles.some(path => realpathSync(path) === canonical)) fail("Report output would overwrite a qualification input");
	const stat = lstatSync(canonical, { throwIfNoEntry: false });
	if (!stat) return canonical;
	if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) fail("Report output must be a regular existing report or a new file");
	let previous: unknown;
	try { previous = JSON.parse(readFileSync(canonical, "utf8")); } catch { fail("Report output would overwrite an unrelated file"); }
	if (record(previous, "existing report").schema !== "ruam-algorithm-state-preflight-v1") fail("Report output would overwrite an unrelated file");
	return canonical;
}

/** Hash exact bytes, refusing symlinks and repository escapes rather than following them. */
export function verifyFrozenSources(audit: FrozenAudit, repository: string): { path: string; sha256: string; bytes: number }[] {
	const base = realpathSync(repository);
	let totalBytes = 0;
	return audit.dependencySources.map(source => {
		const path = sourcePath(source.path), absolute = resolve(base, path);
		const rel = relative(base, absolute);
		if (rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail(`Source escapes repository: ${path}`);
		let current = base;
		for (const part of path.split("/")) {
			current = resolve(current, part);
			if (lstatSync(current).isSymbolicLink()) fail(`Symlink in frozen source path: ${path}`);
		}
		const stat = lstatSync(absolute);
		if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES || totalBytes + stat.size > MAX_SOURCE_BYTES) fail(`Frozen source budget exceeded: ${path}`);
		const bytes = readFileSync(absolute);
		totalBytes += bytes.length;
		if (totalBytes > MAX_SOURCE_BYTES) fail("Frozen source byte budget exceeded");
		const sha256 = sourceDigest(bytes);
		if (sha256 !== source.sha256) fail(`Frozen source changed; preregistration must be revisited: ${path}`);
		const lines = bytes.toString("utf8").split("\n").length;
		if (audit.roots.some(root => root.evidence.some(item => item.path === path && item.lines[1] > lines))) fail(`Evidence exceeds source line count: ${path}`);
		return { path, sha256, bytes: bytes.length };
	});
}

/** A declared revision is not provenance until every frozen blob matches it. */
export function verifyFrozenBaseline(audit: FrozenAudit, repository: string): void {
	const type = execFileSync("git", ["cat-file", "-t", audit.baselineCommit], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	if (type !== "commit") fail("The frozen baseline must be a Git commit, not a tree or blob");
	let totalBytes = 0;
	for (const source of audit.dependencySources) {
		const bytes = execFileSync("git", ["cat-file", "blob", `${audit.baselineCommit}:${sourcePath(source.path)}`], { cwd: repository, maxBuffer: MAX_SOURCE_BYTES, stdio: ["ignore", "pipe", "pipe"] });
		totalBytes += bytes.length;
		if (totalBytes > MAX_SOURCE_BYTES) fail("Baseline source byte budget exceeded");
		if (sourceDigest(bytes) !== source.sha256) fail(`Frozen source does not match baseline commit: ${source.path}`);
	}
}

export function stoppedPreflight(audit: FrozenAudit) {
	return {
		status: "NO-GO" as const,
		stage: "admission" as const,
		eligibleRoots: 0,
		requiredRoots: 3,
		compilerConstructionAuthorizedByEvidence: false,
		replaceProductionVm: false,
		claimsAiResistance: false,
		claimsCloneResistance: false,
		requiredJavascriptScope: "current-ruam" as const,
		subsetCompilerCanReplaceVm: false,
		reasons: audit.roots.map(root => ({ root: root.id, reasonCodes: root.admission.reasonCodes })),
		unmetGates: ["same JavaScript scope and protected selection as current Ruam", "source-derived whole-component admission", "surviving partial-edit and explanation pilot", "three applicable algorithm families", "exact final-byte history correctness", "functional historical baseline intersection", "resource budgets", "held-out AI-assisted recovery and edit trials"],
	};
}
