/** Generic artifact trial runner. Application code, tickets and observations are supplied externally. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Script, createContext } from "node:vm";

export interface ArtifactTrialInput {
	baselineCode: string;
	candidateCode: string;
	observationCode: string;
	patchCode?: string;
	purpose: "compatibility" | "partial-edit" | "standalone-recovery";
	candidateRetainsOriginalArtifact: boolean;
	authoringVisibility: "source-visible" | "artifact-only";
	/** Aggregate deadline for both isolated workers, including startup and async continuations. */
	timeoutMs?: number;
}
type Resources = { wallMs: number; cpuUserMicros: number; cpuSystemMicros: number; heapUsedDeltaBytes: number; processPeakRssBytes: number };
type Observation = { status: "observed"; value: unknown; resources: Resources; patchResources: Resources | null } | { status: "error"; error: string };
export interface ArtifactTrialReport {
	schema: "ruam-artifact-attack-trial-v1";
	status: "match" | "mismatch" | "error" | "timeout";
	purpose: ArtifactTrialInput["purpose"];
	baselineSha256: string;
	candidateSha256: string;
	patchSha256: string | null;
	observationSha256: string;
	baselineBytes: number;
	candidateBytes: number;
	patchBytes: number;
	baseline: Observation | null;
	candidate: Observation | null;
	error: string | null;
	authoringVisibility: ArtifactTrialInput["authoringVisibility"];
	candidateRetainsOriginalArtifact: boolean;
	actualAiTrial: false;
	universalEquivalence: false;
	standaloneRecoveryEstablished: false;
	modelAttackTokens: 0;
	authoringModelTokens: null;
	analystMinutes: null;
	limitations: string[];
}
const hash = (code: string) => createHash("sha256").update(code).digest("hex");
const start = () => ({ wall: performance.now(), cpu: process.cpuUsage(), heap: process.memoryUsage().heapUsed });
function finish(before: ReturnType<typeof start>): Resources {
	const cpu = process.cpuUsage(before.cpu);
	return { wallMs: performance.now() - before.wall, cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system,
		heapUsedDeltaBytes: process.memoryUsage().heapUsed - before.heap,
		processPeakRssBytes: process.resourceUsage().maxRSS * (process.versions.bun && process.platform === "darwin" ? 1 : 1024) };
}

interface ObservationPrototypes { object: object; array: object; }

/** Preserve signed zero, NaN, holes and graph aliases in plain caller-authored observation data. */
export function encodeArtifactObservation(value: unknown, seen = new Map<object, number>(), prototypes: ObservationPrototypes = { object: Object.prototype, array: Array.prototype }): unknown {
	if (value === null) return { type: "null" };
	if (typeof value === "undefined") return { type: "undefined" };
	if (typeof value === "boolean" || typeof value === "string") return { type: typeof value, value };
	if (typeof value === "number") return { type: "number", value: Object.is(value, -0) ? "-0" : Number.isNaN(value) ? "NaN" : value === Infinity ? "+Infinity" : value === -Infinity ? "-Infinity" : value };
	if (typeof value === "bigint") return { type: "bigint", value: String(value) };
	if (typeof value !== "object") throw new Error("Observations must explicitly describe functions and symbols using checkable primitive facts");
	const prior = seen.get(value);
	if (prior !== undefined) return { reference: prior };
	const prototype = Object.getPrototypeOf(value);
	const array = Array.isArray(value);
	if (array ? prototype !== prototypes.array : prototype !== null && prototype !== prototypes.object) throw new Error("Observation custom prototypes and class instances require explicit caller-authored facts");
	const id = seen.size;
	seen.set(value, id);
	const properties = Reflect.ownKeys(value).map(key => {
		if (typeof key !== "string") throw new Error("Observation symbol keys require explicit caller-authored facts");
		const property = Object.getOwnPropertyDescriptor(value, key)!;
		if (!("value" in property)) throw new Error("Observation accessors must be observed explicitly inside the scenario");
		return { key, value: encodeArtifactObservation(property.value, seen, prototypes), writable: !!property.writable, enumerable: !!property.enumerable, configurable: !!property.configurable };
	});
	return { type: array ? "array" : prototype === null ? "null-prototype-object" : "object", id, properties };
}

async function observe(code: string, scenario: string, patch?: string): Promise<Observation> {
	const timers = new Set<ReturnType<typeof setTimeout>>(), intervals = new Set<ReturnType<typeof setInterval>>();
	const before = start();
	try {
		const context = createContext({
			setTimeout: (fn: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => { const id = setTimeout(fn, delay, ...args); timers.add(id); return id; },
			setInterval: (fn: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => { const id = setInterval(fn, delay, ...args); intervals.add(id); return id; },
				clearTimeout, clearInterval, performance,
			}, { codeGeneration: { strings: false, wasm: false } });
		// Capture the actual realm identities before either artifact or scenario
		// can replace global constructors. Custom observation prototypes fail closed.
		const prototypes = new Script("({ object: Object.prototype, array: Array.prototype })").runInContext(context, { timeout: 2000 }) as ObservationPrototypes;
		new Script(code).runInContext(context, { timeout: 2000 });
		let patchResources: Resources | null = null;
		if (patch) { const patchStart = start(); new Script(patch).runInContext(context, { timeout: 2000 }); patchResources = finish(patchStart); }
		// Keeping caller code in a separate script preserves its own strictness.
		const result = await new Script(scenario).runInContext(context, { timeout: 2000 });
		return { status: "observed", value: encodeArtifactObservation(result, new Map(), prototypes), resources: finish(before), patchResources };
	} catch (error) { return { status: "error", error: String(error) }; }
	finally { timers.forEach(clearTimeout); intervals.forEach(clearInterval); }
}

/** Observe one artifact per operating-system process; node:vm is not a hostile-code sandbox. */
export async function executeArtifactObservation(input: { code: string; observationCode: string; patchCode?: string }): Promise<Observation> {
	return observe(input.code, input.observationCode, input.patchCode);
}

/** Repository-owned qualification only. Never supply untrusted operating-system code. */
export function runArtifactAttackTrial(input: ArtifactTrialInput): ArtifactTrialReport {
	for (const field of ["baselineCode", "candidateCode", "observationCode"] as const) {
		if (typeof input[field] !== "string" || !input[field].trim() || Buffer.byteLength(input[field]) > 8 * 1024 * 1024) throw new Error(`Invalid or oversized ${field}`);
	}
	if (input.patchCode !== undefined && (typeof input.patchCode !== "string" || Buffer.byteLength(input.patchCode) > 1024 * 1024)) throw new Error("Invalid or oversized patchCode");
	if (!["compatibility", "partial-edit", "standalone-recovery"].includes(input.purpose) || !["source-visible", "artifact-only"].includes(input.authoringVisibility) || typeof input.candidateRetainsOriginalArtifact !== "boolean") throw new Error("Invalid trial classification");
	const timeout = input.timeoutMs ?? 15_000;
	if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 60_000) throw new Error("timeoutMs must be an integer in [100,60000]");
	const workerCode = `import { readFileSync } from "node:fs"; import { executeArtifactObservation } from ${JSON.stringify(fileURLToPath(import.meta.url))}; const input=JSON.parse(readFileSync(0,"utf8")); process.stdout.write(JSON.stringify(await executeArtifactObservation(input)));`;
	let baseline: Observation | null = null, candidate: Observation | null = null, error: string | null = null;
	let status: ArtifactTrialReport["status"] = "error";
	const deadline = performance.now() + timeout;
	const run = (code: string, patchCode?: string): Observation | null => {
		const workerInput = JSON.stringify({ code, observationCode: input.observationCode, patchCode });
		const remaining = Math.floor(deadline - performance.now());
		if (remaining <= 0) { status = "timeout"; error = "Aggregate worker deadline exceeded"; return null; }
		const result = spawnSync(process.execPath, ["-e", workerCode], {
			input: workerInput,
			encoding: "utf8", timeout: remaining, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024,
		});
		if (result.error || result.status !== 0) {
			error = String(result.error ?? result.stderr ?? `Worker exited ${result.status}`);
			status = result.error && "code" in result.error && result.error.code === "ETIMEDOUT" ? "timeout" : "error";
			return null;
		}
		try {
			const parsed = JSON.parse(result.stdout) as Observation;
			if (parsed.status !== "observed" && parsed.status !== "error") throw new Error("Unknown observation status");
			if (performance.now() > deadline) { status = "timeout"; error = "Aggregate worker deadline exceeded"; return null; }
			return parsed;
		} catch (cause) { error = `Invalid worker report: ${String(cause)}`; status = "error"; return null; }
	};
	baseline = run(input.baselineCode);
	if (baseline?.status === "observed") candidate = run(input.candidateCode, input.patchCode);
	if (baseline?.status === "observed" && candidate) {
		status = candidate.status !== "observed" ? "error" : JSON.stringify(baseline.value) === JSON.stringify(candidate.value) ? "match" : "mismatch";
	}
	return { schema: "ruam-artifact-attack-trial-v1", status, purpose: input.purpose,
		baselineSha256: hash(input.baselineCode), candidateSha256: hash(input.candidateCode), observationSha256: hash(input.observationCode), patchSha256: input.patchCode ? hash(input.patchCode) : null,
		baselineBytes: Buffer.byteLength(input.baselineCode), candidateBytes: Buffer.byteLength(input.candidateCode), patchBytes: Buffer.byteLength(input.patchCode ?? ""),
		baseline, candidate, error, authoringVisibility: input.authoringVisibility, candidateRetainsOriginalArtifact: input.candidateRetainsOriginalArtifact,
		actualAiTrial: false, universalEquivalence: false, standaloneRecoveryEstablished: false, modelAttackTokens: 0, authoringModelTokens: null, analystMinutes: null,
		limitations: ["Caller-supplied scripted observations only; passing does not establish universal equivalence or standalone reconstruction.",
			"Authoring visibility is declared by the caller; this tool does not verify blindness or measure authoring effort.",
			"Baseline and candidate run in separate processes under one deadline. External host state and nondeterministic clocks are not replayed or frozen.",
			"Observations encode own data properties of realm plain objects, null-prototype records and ordinary arrays. Inherited behavior and prototype mutations require explicit primitive facts; custom prototypes are rejected.",
			"Resources are noisy worker-process deltas; heap deltas are not retained memory. Parent startup and compiler costs are separate.",
			"All source, patches and observations stay with the caller; the runner contains no application corpus or private tickets.",
			"Trusted local research code only; process isolation and node:vm are resource controls, not an operating-system security sandbox."] };
}
