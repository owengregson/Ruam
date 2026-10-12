/**
 * Executable edit negative control on an existing, deliberately NOT admitted root.
 * The attack receives only the loaded public API. It reuses the entire artifact;
 * passing this control is neither standalone recovery nor an A1/AI-resistance result.
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, Script } from "node:vm";
import { isDeepStrictEqual } from "node:util";
import { spawnSync } from "node:child_process";
import { obfuscateCode } from "../../transform.js";

type NamingApi = { NameRegistry: any; NameScope: any; NameToken: any };
type ResourceSample = { wallMs: number; cpuUserMicros: number; cpuSystemMicros: number; heapUsedDeltaBytes: number; processPeakRssBytes: number };
export interface SidecarValidation {
	status: "pass" | "mismatch" | "error";
	cases: number;
	mismatches: number;
	firstFailure: string | null;
}
export interface SidecarControlReport {
	schema: "ruam-a1-sidecar-control-v1";
	status: "pass-control" | "failed";
	ticket: string;
	admittedCompleteRoot: false;
	claimsSecurityAdvantage: false;
	actualAiTrial: false;
	standaloneRecovery: false;
	a1Artifact: false;
	harnessSha256: string;
	sourceHashes: Record<string, string>;
	sourcesUnchangedDuringRun: boolean;
	attacker: {
		codeSha256: string;
		codeBytes: number;
		reusesOriginalArtifact: true;
		removedImplementationMachinery: false;
		input: string;
		authoringVisibility: string;
		oracleQueries: 0;
		evaluationModelTokens: 0;
		authoringModelTokens: null;
		analystWorkSeconds: null;
		reusableSetupSeconds: null;
	};
	corpus: { visibility: string; cases: number; coverage: string[]; limitations: string[] };
	variants: {
		id: "ordinary-bundled" | "optimized-bundled" | "current-vm-max";
		codeSha256: string | null;
		codeBytes: number | null;
		ownerOracleSha256: string;
		buildResources: ResourceSample;
		compilerOptions: Record<string, unknown>;
		optionDifferences: string[];
		compilerWarnings: string[];
		compilerWarningsComplete: boolean;
		resourceMeasurement: string;
		functionalBaseline: boolean;
		protectedCoverageEstablished: false;
		error: string | null;
		correctness: SidecarValidation;
		uneditedTicketValidation: SidecarValidation;
		attackValidation: SidecarValidation;
		naiveAttackValidation: SidecarValidation;
		attackInstallationResources: ResourceSample[];
		evaluationResources: ResourceSample;
	}[];
}

const digest = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
const begin = () => ({ wall: performance.now(), cpu: process.cpuUsage(), heap: process.memoryUsage().heapUsed });
function finish(start: ReturnType<typeof begin>): ResourceSample {
	const cpu = process.cpuUsage(start.cpu);
	return { wallMs: performance.now() - start.wall, cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system,
		heapUsedDeltaBytes: process.memoryUsage().heapUsed - start.heap,
		processPeakRssBytes: process.resourceUsage().maxRSS * (process.versions.bun && process.platform === "darwin" ? 1 : 1024) };
}

/** The real attack: invoke original first, so frozen/error ordering stays original. */
export function installDuplicateClaimSidecar(api: NamingApi): void {
	const original = api.NameScope.prototype.claim;
	api.NameScope.prototype.claim = function claim(key: string) {
		try { return original.call(this, key); }
		catch (error) {
			if (error && typeof error === "object" && "name" in error && "message" in error &&
				error.name === "Error" && error.message === `Duplicate key "${key}" in scope "${this.id}"`) {
				return this.tokens.get(key);
			}
			throw error;
		}
	};
}

/** Deliberately wrong control: suppresses frozen duplicate errors too. */
function installNaivePatch(api: NamingApi): void {
	const original = api.NameScope.prototype.claim;
	api.NameScope.prototype.claim = function claim(key: string) {
		return this.tokens.has(key) ? this.tokens.get(key) : original.call(this, key);
	};
}

// These cases are PUBLIC and deterministic. They are kept out of the attacker
// callable, but are not a blinded holdout and must never be reported as one.
const SEEDS = [0, -0, 1, -1, 99, 0xffffffff, 0x100000000, NaN, Infinity, -Infinity, 2147483647, -2147483648];
function traceNaming(api: NamingApi, seed: number, caseIndex: number): unknown[] {
	const out: unknown[] = [];
	const observe = (label: string, fn: () => unknown) => {
		try { out.push([label, "return", fn()]); }
		catch (error: any) { out.push([label, "throw", String(error?.name), String(error?.message)]); }
	};
	const r = new api.NameRegistry(seed);
	const tokens: any[] = [];
	const tokenView = (token: any, scope: any) => [token.key, token.scope === scope, token instanceof api.NameToken,
		Object.getPrototypeOf(token) === api.NameToken.prototype];
	observe("cold.resolved", () => r.isResolved);
	observe("cold.alphabet", () => r.getAlphabet());
	observe("cold.generator", () => r.createDynamicGenerator("early"));
	observe("cold.dump", () => [...r.dumpAll()]);
	observe("exclude", () => r.exclude(["aa", "aaa", "AAAA", "customName"]));
	const parent = r.createScope("parent", { lengthTier: "short" });
	const child = r.createScope("child", { parent, lengthTier: "medium" });
	const other = r.createScope("other", { lengthTier: "long" });
	observe("scope.identity", () => [parent.children[0] === child, child.parent === parent, other.parent === null,
		parent instanceof api.NameScope, Object.getPrototypeOf(parent) === api.NameScope.prototype]);
	const initial = parent.claim("initial"); tokens.push(initial);
	observe("unresolved.name", () => initial.name);
	observe("unresolved.toString", () => initial.toString());
	observe("duplicate.identity", () => parent.claim("initial") === initial);
	observe("claimMany.duplicates", () => {
		const batch = child.claimMany(["batch-a", "batch-b", "batch-a"]);
		return [Object.keys(batch), batch["batch-a"] === child.tokens.get("batch-a")];
	});
	let state = (caseIndex + 1) * 7919;
	for (let i = 0; i < 80; i++) {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		const scope = [parent, child, other][state % 3]!;
		const key = `key-${state % 37}`;
		observe(`claim.${i}`, () => { const token = scope.claim(key); tokens.push(token); return tokenView(token, scope); });
		if (i % 11 === 0) observe(`prng.${i}`, () => scope.nextPrng());
		if (i % 13 === 0) observe(`candidate.${i}`, () => scope.generateCandidate());
	}
	// Escaped mutable state is exercised rather than hidden by an adapter.
	observe("tokens.delete", () => other.tokens.delete("missing"));
	const removed = other.claim("removed");
	observe("tokens.delete.existing", () => other.tokens.delete("removed"));
	observe("tokens.reclaim.identity", () => other.claim("removed") === removed);
	const direct = new api.NameScope("direct", seed, "medium", parent);
	const manual = new api.NameToken("manual", direct);
	observe("direct.token", () => tokenView(manual, direct));
	observe("manual.resolve", () => manual.resolve("explicit"));
	observe("manual.name", () => [manual.name, manual.toString()]);
	observe("manual.reresolve", () => manual.resolve("again"));
	const directToken = direct.claim("frozen-existing");
	observe("direct.freeze", () => direct.freeze());
	observe("direct.frozen.duplicate", () => direct.claim("frozen-existing") === directToken);
	observe("direct.frozen.new", () => direct.claim("new"));
	observe("direct.frozen.claimMany", () => direct.claimMany(["frozen-existing"]));
	observe("before.count", () => r.tokenCount);
	observe("before.dump", () => [...r.dumpAll()]);
	observe("resolve", () => r.resolveAll());
	observe("resolved", () => r.isResolved);
	observe("alphabet", () => r.getAlphabet());
	observe("after.count", () => r.tokenCount);
	observe("after.dump", () => [...r.dumpAll()]);
	observe("names", () => tokens.map(token => [token.key, token.name, token.toString()]));
	observe("frozen.duplicate", () => parent.claim("initial") === initial);
	observe("frozen.claimMany", () => parent.claimMany(["initial", "later"]));
	observe("frozen.exclude", () => r.exclude(["later"]));
	observe("frozen.scope", () => r.createScope("later"));
	observe("frozen.resolve", () => r.resolveAll());
	const short = r.createDynamicGenerator("dynamic", "short");
	const long = r.createDynamicGenerator("dynamic", "long");
	observe("dynamic.names", () => Array.from({ length: 96 }, (_, i) => i % 2 ? short() : long()));
	observe("dynamic.count.unchanged", () => r.tokenCount);
	observe("dynamic.dump.unchanged", () => [...r.dumpAll()]);
	observe("postfreeze.prng", () => parent.nextPrng());
	observe("postfreeze.candidate", () => parent.generateCandidate());
	return out;
}

function loadApi(code: string): NamingApi {
	const context = createContext({}, { codeGeneration: { strings: false, wasm: false } });
	new Script(code).runInContext(context, { timeout: 2000 });
	return context.__sidecarSubject as NamingApi;
}

type Variant = SidecarControlReport["variants"][number];
function evaluateVariant(code: string, owner: string, ordinaryCode: string, metadata: Pick<Variant, "id" | "buildResources" | "compilerOptions" | "optionDifferences" | "compilerWarnings">): Variant {
	const evaluationStart = begin();
	const actual: unknown[][] = [], unedited: unknown[][] = [], naive: unknown[][] = [], expected: unknown[][] = [], ordinary: unknown[][] = [];
	const attackInstallationResources: ResourceSample[] = [];
	let error: string | null = null;
	try {
		for (const [index, seed] of SEEDS.entries()) {
			expected.push(structuredClone(traceNaming(loadApi(owner), seed, index)));
			ordinary.push(structuredClone(traceNaming(loadApi(ordinaryCode), seed, index)));
			unedited.push(structuredClone(traceNaming(loadApi(code), seed, index)));
			const api = loadApi(code), attackStart = begin();
			installDuplicateClaimSidecar(api);
			attackInstallationResources.push(finish(attackStart));
			actual.push(structuredClone(traceNaming(api, seed, index)));
			const naiveApi = loadApi(code); installNaivePatch(naiveApi);
			naive.push(structuredClone(traceNaming(naiveApi, seed, index)));
		}
	} catch (cause) { error = String(cause); }
	const failed: SidecarValidation = { status: "error", cases: unedited.length, mismatches: 0, firstFailure: error };
	const correctness = error ? failed : validate(unedited, ordinary);
	return { ...metadata, codeSha256: digest(code), codeBytes: Buffer.byteLength(code), ownerOracleSha256: digest(owner),
		compilerWarningsComplete: true, resourceMeasurement: metadata.id === "current-vm-max" ? "Isolated VM worker process; process-level CPU and heap, excluding parent setup." : "Calling process; esbuild service CPU and memory are not included in these process-level deltas.",
		correctness, functionalBaseline: correctness.status === "pass" && metadata.compilerWarnings.length === 0, protectedCoverageEstablished: false, error,
		uneditedTicketValidation: error ? failed : validate(unedited, expected), attackValidation: error ? failed : validate(actual, expected),
		naiveAttackValidation: error ? failed : validate(naive, expected), attackInstallationResources, evaluationResources: finish(evaluationStart) };
}

/** Separate process entry: the entire real VM build and evaluation has a wall timeout. */
export function runCurrentVmSidecarControl(code: string, owner: string): Variant {
	const start = begin(), warnings: string[] = [], originalWarn = console.warn;
	let protectedCode: string | undefined, failure: string | null = null;
	try {
		console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
		protectedCode = obfuscateCode(code, { preset: "max", debugProtection: false });
	} catch (cause) { failure = String(cause);
	} finally { console.warn = originalWarn; }
	if (protectedCode === undefined) return unavailableVm(owner, finish(start), failure ?? "VM compilation returned no artifact", warnings, true, "Isolated VM worker process; compilation failed before final artifact publication.");
	return evaluateVariant(protectedCode, owner, code, { id: "current-vm-max", buildResources: finish(start),
		compilerOptions: { preset: "max", debugProtection: false }, compilerWarnings: warnings,
		optionDifferences: ["debugProtection:false disables periodic anti-debugging; all other max preset options use their current defaults.",
			"Current VM uses random build entropy; this is one actual build, not a fixed-seed repeated sample."] });
}

function unavailableVm(owner: string, resources: ResourceSample, error: string, warnings: string[], warningsComplete: boolean, resourceMeasurement: string): Variant {
	const failed: SidecarValidation = { status: "error", cases: 0, mismatches: 0, firstFailure: error };
	return { id: "current-vm-max", codeSha256: null, codeBytes: null, ownerOracleSha256: digest(owner), buildResources: resources,
		compilerOptions: { preset: "max", debugProtection: false }, optionDifferences: ["debugProtection:false; entire worker limited to 15 seconds."], compilerWarnings: warnings,
		compilerWarningsComplete: warningsComplete, resourceMeasurement, functionalBaseline: false, protectedCoverageEstablished: false, error,
		correctness: failed, uneditedTicketValidation: failed, attackValidation: failed, naiveAttackValidation: failed, attackInstallationResources: [], evaluationResources: resources };
}
function validate(actual: unknown[][], expected: unknown[][]): SidecarValidation {
	let mismatches = 0, firstFailure: string | null = null;
	for (let i = 0; i < expected.length; i++) {
		if (isDeepStrictEqual(actual[i], expected[i])) continue;
		mismatches++;
		const operation = expected[i]!.findIndex((value, j) => !isDeepStrictEqual(value, actual[i]?.[j]));
		firstFailure ??= `Public case ${i}, observation ${operation}: ${String((expected[i]![operation] as unknown[])?.[0])}`;
	}
	return { status: mismatches ? "mismatch" : "pass", cases: expected.length, mismatches, firstFailure };
}

/** Run only on repository-owned code; node:vm is not a hostile-code sandbox. */
export async function runSidecarControl(repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..")): Promise<SidecarControlReport> {
	const sourcePaths: string[] = [];
	const collectSources = (directory: string) => {
		for (const entry of readdirSync(resolve(repoRoot, directory), { withFileTypes: true })) {
			const path = `${directory}/${entry.name}`;
			if (path === "packages/ruam/src/algorithm-state") continue;
			if (entry.isDirectory()) collectSources(path);
			else if (entry.isFile() && entry.name.endsWith(".ts")) sourcePaths.push(path);
		}
	};
	// Include the compiler implementation too now that a real VM build is evaluated.
	collectSources("packages/ruam/src");
	sourcePaths.push("packages/ruam/package.json");
	for (const path of ["bun.lock", "bun.lockb", "package-lock.json", "packages/ruam/package-lock.json"]) {
		if (existsSync(resolve(repoRoot, path))) sourcePaths.push(path);
	}
	sourcePaths.sort();
	const hashes = () => Object.fromEntries(sourcePaths.map(path => [path, digest(readFileSync(resolve(repoRoot, path)))]));
	const sourceHashes = hashes();
	const namingDirectory = resolve(repoRoot, "packages/ruam/src/naming");
	const originalScope = readFileSync(resolve(namingDirectory, "scope.ts"), "utf8");
	const oldRule = '\t\tif (this.tokens.has(key)) {\n\t\t\tthrow new Error(`Duplicate key "${key}" in scope "${this.id}"`);\n\t\t}';
	if (originalScope.split(oldRule).length !== 2) throw new Error("Sidecar owner-oracle rule no longer uniquely matches the frozen source");
	// Owner-only oracle changes precisely the requested branch; the attack never
	// receives this source or an oracle. All other owner behavior stays in place.
	const editedScope = originalScope.replace(oldRule, "\t\tif (this.tokens.has(key)) return this.tokens.get(key)!;");
	const bundle = async (minify: boolean, edited: boolean) => {
		const result = await build({ stdin: { contents: 'export { NameRegistry } from "./registry.ts"; export { NameScope } from "./scope.ts"; export { NameToken } from "./token.ts";',
			resolveDir: namingDirectory, sourcefile: "control-entry.ts", loader: "ts" },
			bundle: true, write: false, platform: "neutral", target: "es2022", format: "iife", globalName: "Subject", minify, keepNames: true,
			plugins: edited ? [{ name: "owner-ticket-oracle", setup(builder) { builder.onLoad({ filter: /[/\\]naming[/\\]scope\.ts$/ }, () => ({ contents: editedScope, loader: "ts" })); } }] : [] });
		// A stable public publication boundary is shared by every baseline, including
		// the VM preprocessor, which may rename a top-level lexical identifier.
		return result.outputFiles[0]!.text + "\nglobalThis.__sidecarSubject = Subject;\n";
	};
	const variants: SidecarControlReport["variants"] = [];
	let ordinaryCode = "", ordinaryOwner = "";
	for (const minify of [false, true]) {
		const buildStart = begin();
		const code = await bundle(minify, false), owner = await bundle(minify, true);
		const buildResources = finish(buildStart);
		if (!minify) { ordinaryCode = code; ordinaryOwner = owner; }
		variants.push(evaluateVariant(code, owner, ordinaryCode, { id: minify ? "optimized-bundled" : "ordinary-bundled", buildResources,
			compilerOptions: { bundle: true, minify, keepNames: true, target: "es2022" }, optionDifferences: [], compilerWarnings: [] }));
	}
	const vmStart = begin();
	const worker = `import { readFileSync } from "node:fs"; import { runCurrentVmSidecarControl } from ${JSON.stringify(fileURLToPath(import.meta.url))}; const input = JSON.parse(readFileSync(0, "utf8")); process.stdout.write(JSON.stringify(runCurrentVmSidecarControl(input.code, input.owner)));`;
	const result = spawnSync(process.execPath, ["-e", worker], { input: JSON.stringify({ code: ordinaryCode, owner: ordinaryOwner }), encoding: "utf8", timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
	if (result.status === 0 && !result.error) variants.push(JSON.parse(result.stdout) as Variant);
	else {
		const error = String(result.error ?? result.stderr ?? `VM worker exited ${result.status}`);
		variants.push(unavailableVm(ordinaryOwner, finish(vmStart), error, [], false, "Parent process only: child CPU, memory, intermediate artifact and warning inventory unavailable after worker failure/timeout."));
	}
	const sourcesUnchangedDuringRun = isDeepStrictEqual(sourceHashes, hashes());
	return {
		schema: "ruam-a1-sidecar-control-v1",
		status: sourcesUnchangedDuringRun && variants.filter(v => v.id !== "current-vm-max" || v.functionalBaseline).every(v => v.correctness.status === "pass" && v.attackValidation.status === "pass" &&
			v.uneditedTicketValidation.status === "mismatch" && v.naiveAttackValidation.status === "mismatch") ? "pass-control" : "failed",
		ticket: "For an unfrozen NameScope, claim(key) on an existing string key returns the identical existing token. Preserve frozen errors, claimMany ordering, every other return/error/identity and future generated names.",
		admittedCompleteRoot: false, claimsSecurityAdvantage: false, actualAiTrial: false, standaloneRecovery: false, a1Artifact: false,
		harnessSha256: digest(readFileSync(fileURLToPath(import.meta.url))),
		sourceHashes, sourcesUnchangedDuringRun,
		attacker: { codeSha256: digest(installDuplicateClaimSidecar.toString()), codeBytes: Buffer.byteLength(installDuplicateClaimSidecar.toString()),
			reusesOriginalArtifact: true, removedImplementationMachinery: false, input: "Only loaded public NameScope constructor/prototype; no owner source, oracle, source map, cases or private fields.",
			authoringVisibility: "The human-directed model author inspected repository source and public tests while writing this fixed script. No source-blind AI trial or measured model recovery effort took place.",
			oracleQueries: 0, evaluationModelTokens: 0, authoringModelTokens: null, analystWorkSeconds: null, reusableSetupSeconds: null },
		corpus: { visibility: "Public deterministic authored controls; not hidden, held out, blinded or an actual AI attack trial.", cases: SEEDS.length,
			coverage: ["cold constructors and reset by fresh instances", "all public methods of NameRegistry, NameScope and NameToken", "duplicate and batch claims",
				"freeze error precedence", "token identity, parent links and prototypes", "public token-map deletion and reinsertion", "PRNG observations and future dynamic names", "seed Number boundaries including signed zero, NaN and infinities"],
			limitations: ["The root exposes mutable collections and has no source-enforced global size bound; it is not admitted for A1.",
				"Finite traces are partial correctness evidence, not equivalence over arbitrary JavaScript values, hostile accessors or monkeypatched builtins.",
				"The sidecar intentionally retains the original implementation: edit bypass only, no standalone recovery credit.",
				"No A1 transformed artifact exists in this control; a functional current-VM baseline is not proof of equal protected coverage or a protection multiplier.",
				"CPU and heap-used measurements are noisy process-level deltas, not retained-memory measurements. Esbuild service CPU and memory are omitted; build timing includes owner-oracle compilation. Analyst/model authoring effort is unknown.",
				"Source hashes bind files present when the run starts; newly added files during the run are not inventoried."] },
		variants,
	};
}
