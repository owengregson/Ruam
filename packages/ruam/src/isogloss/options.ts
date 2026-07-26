/**
 * Strict public option contract for the Isogloss execution architecture.
 *
 * This module deliberately has no compatibility alias for the legacy VM
 * surface. Removed VM keys are tombstoned with actionable diagnostics, while
 * BPRF topology settings remain fixed architecture constants rather than
 * user-tunable security knobs.
 *
 * @module isogloss/options
 */

import type { IsoglossDeploymentProfile } from "./deployment-eligibility.js";

export type { IsoglossDeploymentProfile } from "./deployment-eligibility.js";

export type IsoglossOwnerTrace = "off" | "sidecar";
export type IsoglossTargetMode = "root" | "comment";
export type IsoglossTargetEnvironment =
	| "node"
	| "browser"
	| "browser-extension";

export interface IsoglossNumericRegionDomain {
	readonly type: "number";
	readonly min: number;
	readonly max: number;
}

export interface IsoglossBooleanRegionDomain {
	readonly type: "boolean";
}

export type IsoglossRegionDomain =
	| IsoglossNumericRegionDomain
	| IsoglossBooleanRegionDomain;

/**
 * Runtime-guard proofs, keyed first by target function name and then by the
 * exact local binding name used in that function. Numeric domains are never
 * inferred: every numeric binding requires an explicit inclusive range.
 */
export type IsoglossRegionDomains = Readonly<
	Record<string, Readonly<Record<string, IsoglossRegionDomain>>>
>;

export interface IsoglossCustodianCapability {
	/** Absolute HTTPS endpoint used at an already-observable remote await. */
	readonly endpoint: string;
	readonly boundary: "existing-remote-await";
	/** Must be explicitly false: the client must not contain the held relation. */
	readonly completeLocalFallback: false;
}

export interface IsoglossPrivateFunctionCapability {
	readonly protocol: "actively-secure-pfe";
	readonly topology: "padded-universal-circuit";
	/** Non-secret owner identifier for the concrete audited implementation. */
	readonly implementation: string;
}

export interface IsoglossAttestationCapability {
	/** Attestation provider or hardware trust-domain identifier. */
	readonly provider: string;
	/** Owner-pinned measurement or policy identifier. */
	readonly expectedMeasurement: string;
	readonly boundary: "in-process-attested";
	/** Must be explicitly false: there is no complete non-attested fallback. */
	readonly completeLocalFallback: false;
}

export interface IsoglossCapabilityOptions {
	readonly custodian?: IsoglossCustodianCapability;
	readonly privateFunction?: IsoglossPrivateFunctionCapability;
	readonly attestation?: IsoglossAttestationCapability;
}

export interface IsoglossMaximumCustodyOptions {
	/**
	 * Canonical unsigned decimal string. A string keeps JSON/config input exact
	 * beyond Number.MAX_SAFE_INTEGER; resolution converts it to bigint.
	 */
	readonly minimumExactAttackQueries?: string;
}

export interface IsoglossOptions {
	/**
	 * Local is the honest default: it raises analysis cost but remains fully
	 * reconstructable under unrestricted client instrumentation.
	 */
	readonly profile?: IsoglossDeploymentProfile;
	readonly maximumCustody?: IsoglossMaximumCustodyOptions;
	/** Owner-only sidecar metadata is never embedded as a runtime trace hook. */
	readonly ownerTrace?: IsoglossOwnerTrace;
	/** Required explicitly for every profile that crosses a trust boundary. */
	readonly capabilities?: IsoglossCapabilityOptions;
}

export interface RuamOptions {
	readonly isogloss?: IsoglossOptions;
	/**
	 * `"root"` protects eligible root functions. `"comment"` protects only a
	 * function preceded by the exact marker `/* ruam:isogloss *\/`.
	 */
	readonly targetMode?: IsoglossTargetMode;
	/** Probability in the inclusive range [0, 1] for an eligible target. */
	readonly threshold?: number;
	readonly preprocessIdentifiers?: boolean;
	readonly target?: IsoglossTargetEnvironment;
	readonly regionDomains?: IsoglossRegionDomains;
}

export interface ResolvedIsoglossOptions {
	readonly profile: IsoglossDeploymentProfile;
	readonly bprf: typeof ISOGLOSS_FIXED_LOCAL_BPRF;
	readonly maximumCustody: {
		readonly minimumExactAttackQueries: bigint;
	};
	readonly ownerTrace: IsoglossOwnerTrace;
	readonly capabilities: Readonly<IsoglossCapabilityOptions>;
}

export interface ResolvedRuamOptions {
	readonly isogloss: ResolvedIsoglossOptions;
	readonly targetMode: IsoglossTargetMode;
	readonly threshold: number;
	readonly preprocessIdentifiers: boolean;
	readonly target: IsoglossTargetEnvironment;
	readonly regionDomains: IsoglossRegionDomains;
}

export type RuamOptionErrorCode =
	| "RUAM_INVALID_ISOGLOSS_OPTIONS"
	| "RUAM_INVALID_ISOGLOSS_OPTION"
	| "RUAM_UNKNOWN_ISOGLOSS_OPTION"
	| "RUAM_REMOVED_VM_OPTION"
	| "RUAM_ISOGLOSS_CAPABILITY_REQUIRED"
	| "RUAM_ISOGLOSS_PROFILE_CAPABILITY_MISMATCH"
	| "RUAM_ISOGLOSS_LOCAL_FALLBACK_FORBIDDEN";

export class RuamOptionError extends Error {
	override readonly name = "RuamOptionError";

	constructor(
		readonly code: RuamOptionErrorCode,
		readonly path: string,
		detail: string
	) {
		super(`${code}: ${path}: ${detail}`);
	}
}

/** Fixed local BPRF topology. These are intentionally not public inputs. */
export const ISOGLOSS_FIXED_LOCAL_BPRF = Object.freeze({
	realizationCount: 3 as const,
	fragmentCount: 3 as const,
});

export const DEFAULT_MINIMUM_EXACT_ATTACK_QUERIES_TEXT = "1000" as const;
export const DEFAULT_MINIMUM_EXACT_ATTACK_QUERIES = 1000n;

/** One migration instruction for every key removed with the VM architecture. */
export const REMOVED_LEGACY_VM_OPTION_HINTS = Object.freeze({
	preset:
		"Select isogloss.profile explicitly; legacy low/medium/max bundles no longer exist.",
	encryptBytecode:
		"No Isogloss alias exists; artifact encryption is outside this execution-architecture contract.",
	debugProtection:
		"No Isogloss alias exists; timing-based anti-debugging is not part of the threat claim.",
	debugLogging:
		"Use isogloss.ownerTrace='sidecar' for owner-only build metadata; runtime tracing is forbidden.",
	dynamicOpcodes:
		"Removed with opcode dispatch; Isogloss emits only the semantic structures it needs.",
	decoyOpcodes:
		"Removed with opcode dispatch; there is no decoy-opcode compatibility behavior.",
	deadCodeInjection:
		"No Isogloss alias exists; inert semantic corridors require a separately verified transform.",
	stackEncoding:
		"Removed with the VM stack; Isogloss chart representation is architecture-controlled.",
	rollingCipher:
		"Removed with the linear instruction stream; there is no rolling-cipher compatibility behavior.",
	integrityBinding:
		"Use the holographic-tee profile with an attestation capability when hardware integrity is required.",
	vmShielding:
		"Removed with VM interpreters; protected root groups are isolated by the Isogloss compiler.",
	mixedBooleanArithmetic:
		"No Isogloss alias exists; use a separately verified engine-independent transform if introduced.",
	handlerFragmentation:
		"Removed with VM handlers; BPRF fragmentation is fixed and is not a user option.",
	stringAtomization:
		"No Isogloss alias exists; string protection is outside this execution-architecture contract.",
	polymorphicDecoder:
		"No Isogloss alias exists; Isogloss does not expose a shared artifact decoder option.",
	scatteredKeys:
		"Removed with VM key material; custody capabilities describe external trust boundaries instead.",
	blockPermutation:
		"Removed with bytecode block order; Isogloss topology is not an instruction permutation.",
	opcodeMutation:
		"Removed with opcode tables; there is no mutation compatibility behavior.",
	bytecodeScattering:
		"Removed with bytecode artifacts; BPRF fragmentation is fixed and semantically verified.",
	incrementalCipher:
		"Removed with instruction epochs; Isogloss cover evolution is not a cipher alias.",
	semanticOpacity:
		"Select an honest Isogloss deployment profile; semantic opacity is not a boolean claim.",
	observationResistance:
		"Select a custody or attestation profile; local execution cannot promise resistance to full instrumentation.",
} as const);

export type RemovedLegacyVmOption =
	keyof typeof REMOVED_LEGACY_VM_OPTION_HINTS;

export const REMOVED_LEGACY_VM_OPTIONS: readonly RemovedLegacyVmOption[] =
	Object.freeze(
		Object.keys(REMOVED_LEGACY_VM_OPTION_HINTS) as RemovedLegacyVmOption[]
	);

const TOP_LEVEL_KEYS = new Set([
	"isogloss",
	"targetMode",
	"threshold",
	"preprocessIdentifiers",
	"target",
	"regionDomains",
]);
const ISOGLOSS_KEYS = new Set([
	"profile",
	"maximumCustody",
	"ownerTrace",
	"capabilities",
]);
const MAXIMUM_CUSTODY_KEYS = new Set(["minimumExactAttackQueries"]);
const CAPABILITY_KEYS = new Set([
	"custodian",
	"privateFunction",
	"attestation",
]);
const CUSTODIAN_KEYS = new Set([
	"endpoint",
	"boundary",
	"completeLocalFallback",
]);
const PRIVATE_FUNCTION_KEYS = new Set([
	"protocol",
	"topology",
	"implementation",
]);
const ATTESTATION_KEYS = new Set([
	"provider",
	"expectedMeasurement",
	"boundary",
	"completeLocalFallback",
]);
const NUMBER_DOMAIN_KEYS = new Set(["type", "min", "max"]);
const BOOLEAN_DOMAIN_KEYS = new Set(["type"]);

const EMPTY_CAPABILITIES: Readonly<IsoglossCapabilityOptions> = Object.freeze({});
const EMPTY_REGION_DOMAINS: IsoglossRegionDomains = Object.freeze(
	Object.create(null) as Record<
		string,
		Readonly<Record<string, IsoglossRegionDomain>>
	>
);

/** Validate untrusted user input and apply deterministic Isogloss defaults. */
export function resolveRuamOptions(options: unknown = {}): ResolvedRuamOptions {
	const root = requireRecord(options, "options");
	validateTopLevelKeys(root);

	const isogloss = optionalRecord(root.isogloss, "isogloss");
	validateKnownKeys(isogloss, ISOGLOSS_KEYS, "isogloss");

	const profile = optionalEnum(
		isogloss.profile,
		"isogloss.profile",
		[
			"holographic-local",
			"holographic-custodied",
			"holographic-private",
			"holographic-tee",
		] as const,
		"holographic-local"
	);
	const ownerTrace = optionalEnum(
		isogloss.ownerTrace,
		"isogloss.ownerTrace",
		["off", "sidecar"] as const,
		"off"
	);
	const maximumCustody = resolveMaximumCustody(isogloss.maximumCustody);
	const capabilities = resolveCapabilities(isogloss.capabilities);
	validateProfileCapabilities(profile, capabilities);

	const targetMode = optionalEnum(
		root.targetMode,
		"targetMode",
		["root", "comment"] as const,
		"root"
	);
	const threshold = root.threshold === undefined ? 1 : root.threshold;
	if (
		typeof threshold !== "number" ||
		!Number.isFinite(threshold) ||
		threshold < 0 ||
		threshold > 1
	) {
		invalid("threshold", "must be a finite number in the inclusive range [0, 1]");
	}
	const preprocessIdentifiers =
		root.preprocessIdentifiers === undefined
			? false
			: root.preprocessIdentifiers;
	if (typeof preprocessIdentifiers !== "boolean") {
		invalid("preprocessIdentifiers", "must be a boolean");
	}
	const target = optionalEnum(
		root.target,
		"target",
		["node", "browser", "browser-extension"] as const,
		"browser"
	);
	const regionDomains = resolveRegionDomains(root.regionDomains);

	return Object.freeze({
		isogloss: Object.freeze({
			profile,
			bprf: ISOGLOSS_FIXED_LOCAL_BPRF,
			maximumCustody,
			ownerTrace,
			capabilities,
		}),
		targetMode,
		threshold,
		preprocessIdentifiers,
		target,
		regionDomains,
	});
}

function resolveMaximumCustody(value: unknown): {
	readonly minimumExactAttackQueries: bigint;
} {
	const input = optionalRecord(value, "isogloss.maximumCustody");
	validateKnownKeys(
		input,
		MAXIMUM_CUSTODY_KEYS,
		"isogloss.maximumCustody"
	);
	const raw = input.minimumExactAttackQueries;
	if (raw === undefined) {
		return Object.freeze({
			minimumExactAttackQueries: DEFAULT_MINIMUM_EXACT_ATTACK_QUERIES,
		});
	}
	if (typeof raw !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(raw)) {
		invalid(
			"isogloss.maximumCustody.minimumExactAttackQueries",
			"must be a canonical unsigned decimal string"
		);
	}
	return Object.freeze({ minimumExactAttackQueries: BigInt(raw) });
}

function resolveCapabilities(
	value: unknown
): Readonly<IsoglossCapabilityOptions> {
	if (value === undefined) return EMPTY_CAPABILITIES;
	const input = requireRecord(value, "isogloss.capabilities");
	validateKnownKeys(input, CAPABILITY_KEYS, "isogloss.capabilities");

	const custodian =
		input.custodian === undefined
			? undefined
			: resolveCustodian(input.custodian);
	const privateFunction =
		input.privateFunction === undefined
			? undefined
			: resolvePrivateFunction(input.privateFunction);
	const attestation =
		input.attestation === undefined
			? undefined
			: resolveAttestation(input.attestation);
	if (
		custodian === undefined &&
		privateFunction === undefined &&
		attestation === undefined
	) {
		return EMPTY_CAPABILITIES;
	}
	const resolved: {
		custodian?: IsoglossCustodianCapability;
		privateFunction?: IsoglossPrivateFunctionCapability;
		attestation?: IsoglossAttestationCapability;
	} = {};
	if (custodian !== undefined) resolved.custodian = custodian;
	if (privateFunction !== undefined) resolved.privateFunction = privateFunction;
	if (attestation !== undefined) resolved.attestation = attestation;
	return Object.freeze(resolved);
}

function resolveCustodian(value: unknown): IsoglossCustodianCapability {
	const input = requireRecord(value, "isogloss.capabilities.custodian");
	validateKnownKeys(
		input,
		CUSTODIAN_KEYS,
		"isogloss.capabilities.custodian"
	);
	const endpoint = requireNonemptyString(
		input.endpoint,
		"isogloss.capabilities.custodian.endpoint"
	);
	let parsed: URL;
	try {
		parsed = new URL(endpoint);
	} catch {
		invalid(
			"isogloss.capabilities.custodian.endpoint",
			"must be an absolute HTTPS URL"
		);
	}
	if (
		parsed!.protocol !== "https:" ||
		parsed!.username !== "" ||
		parsed!.password !== ""
	) {
		invalid(
			"isogloss.capabilities.custodian.endpoint",
			"must be an absolute HTTPS URL without embedded credentials"
		);
	}
	requireLiteral(
		input.boundary,
		"existing-remote-await",
		"isogloss.capabilities.custodian.boundary"
	);
	requireNoLocalFallback(
		input.completeLocalFallback,
		"isogloss.capabilities.custodian.completeLocalFallback"
	);
	return Object.freeze({
		endpoint,
		boundary: "existing-remote-await",
		completeLocalFallback: false,
	});
}

function resolvePrivateFunction(
	value: unknown
): IsoglossPrivateFunctionCapability {
	const input = requireRecord(
		value,
		"isogloss.capabilities.privateFunction"
	);
	validateKnownKeys(
		input,
		PRIVATE_FUNCTION_KEYS,
		"isogloss.capabilities.privateFunction"
	);
	requireLiteral(
		input.protocol,
		"actively-secure-pfe",
		"isogloss.capabilities.privateFunction.protocol"
	);
	requireLiteral(
		input.topology,
		"padded-universal-circuit",
		"isogloss.capabilities.privateFunction.topology"
	);
	const implementation = requireNonemptyString(
		input.implementation,
		"isogloss.capabilities.privateFunction.implementation"
	);
	return Object.freeze({
		protocol: "actively-secure-pfe",
		topology: "padded-universal-circuit",
		implementation,
	});
}

function resolveAttestation(value: unknown): IsoglossAttestationCapability {
	const input = requireRecord(value, "isogloss.capabilities.attestation");
	validateKnownKeys(
		input,
		ATTESTATION_KEYS,
		"isogloss.capabilities.attestation"
	);
	const provider = requireNonemptyString(
		input.provider,
		"isogloss.capabilities.attestation.provider"
	);
	const expectedMeasurement = requireNonemptyString(
		input.expectedMeasurement,
		"isogloss.capabilities.attestation.expectedMeasurement"
	);
	requireLiteral(
		input.boundary,
		"in-process-attested",
		"isogloss.capabilities.attestation.boundary"
	);
	requireNoLocalFallback(
		input.completeLocalFallback,
		"isogloss.capabilities.attestation.completeLocalFallback"
	);
	return Object.freeze({
		provider,
		expectedMeasurement,
		boundary: "in-process-attested",
		completeLocalFallback: false,
	});
}

function validateProfileCapabilities(
	profile: IsoglossDeploymentProfile,
	capabilities: Readonly<IsoglossCapabilityOptions>
): void {
	const hasCustodian = capabilities.custodian !== undefined;
	const hasPrivate = capabilities.privateFunction !== undefined;
	const hasAttestation = capabilities.attestation !== undefined;

	switch (profile) {
		case "holographic-local":
			if (hasCustodian || hasPrivate || hasAttestation) {
				mismatch(profile, "does not accept remote capability descriptors");
			}
			return;
		case "holographic-custodied":
			if (!hasCustodian) required(profile, "custodian");
			if (hasPrivate || hasAttestation) {
				mismatch(profile, "accepts only the custodian capability");
			}
			return;
		case "holographic-private":
			if (!hasCustodian) required(profile, "custodian");
			if (!hasPrivate) required(profile, "privateFunction");
			if (hasAttestation) {
				mismatch(
					profile,
					"accepts custodian and privateFunction capabilities only"
				);
			}
			return;
		case "holographic-tee":
			if (!hasAttestation) required(profile, "attestation");
			if (hasCustodian || hasPrivate) {
				mismatch(profile, "accepts only the attestation capability");
			}
	}
}

function resolveRegionDomains(value: unknown): IsoglossRegionDomains {
	if (value === undefined) return EMPTY_REGION_DOMAINS;
	const functions = requireRecord(value, "regionDomains");
	const resolved = Object.create(null) as Record<
		string,
		Readonly<Record<string, IsoglossRegionDomain>>
	>;
	for (const functionName of ownStringKeys(functions, "regionDomains")) {
		requireNonemptyKey(functionName, `regionDomains.${functionName}`);
		const bindings = requireRecord(
			functions[functionName],
			`regionDomains.${functionName}`
		);
		const resolvedBindings = Object.create(null) as Record<
			string,
			IsoglossRegionDomain
		>;
		for (const bindingName of ownStringKeys(
			bindings,
			`regionDomains.${functionName}`
		)) {
			requireNonemptyKey(
				bindingName,
				`regionDomains.${functionName}.${bindingName}`
			);
			resolvedBindings[bindingName] = resolveRegionDomain(
				bindings[bindingName],
				`regionDomains.${functionName}.${bindingName}`
			);
		}
		resolved[functionName] = Object.freeze(resolvedBindings);
	}
	return Object.freeze(resolved);
}

function resolveRegionDomain(
	value: unknown,
	path: string
): IsoglossRegionDomain {
	const input = requireRecord(value, path);
	if (input.type === "boolean") {
		validateKnownKeys(input, BOOLEAN_DOMAIN_KEYS, path);
		return Object.freeze({ type: "boolean" });
	}
	if (input.type !== "number") {
		invalid(`${path}.type`, "must be either 'number' or 'boolean'");
	}
	validateKnownKeys(input, NUMBER_DOMAIN_KEYS, path);
	const min = input.min;
	const max = input.max;
	if (
		typeof min !== "number" ||
		typeof max !== "number" ||
		!Number.isSafeInteger(min) ||
		!Number.isSafeInteger(max) ||
		Object.is(min, -0) ||
		Object.is(max, -0) ||
		min > max
	) {
		invalid(
			path,
			"number domains require safe-integer min/max, without negative zero, and min <= max"
		);
	}
	return Object.freeze({ type: "number", min, max });
}

function validateTopLevelKeys(root: Readonly<Record<string, unknown>>): void {
	for (const key of ownStringKeys(root, "options")) {
		if (
			Object.prototype.hasOwnProperty.call(
				REMOVED_LEGACY_VM_OPTION_HINTS,
				key
			)
		) {
			const legacy = key as RemovedLegacyVmOption;
			throw new RuamOptionError(
				"RUAM_REMOVED_VM_OPTION",
				key,
				REMOVED_LEGACY_VM_OPTION_HINTS[legacy]
			);
		}
		if (!TOP_LEVEL_KEYS.has(key)) {
			unknown(key);
		}
	}
}

function validateKnownKeys(
	input: Readonly<Record<string, unknown>>,
	allowed: ReadonlySet<string>,
	path: string
): void {
	for (const key of ownStringKeys(input, path)) {
		if (!allowed.has(key)) unknown(`${path}.${key}`);
	}
}

function ownStringKeys(
	input: Readonly<Record<string, unknown>>,
	path: string
): string[] {
	const keys = Reflect.ownKeys(input);
	for (const key of keys) {
		if (typeof key === "symbol") unknown(`${path}.[${String(key)}]`);
	}
	return keys as string[];
}

function requireRecord(
	value: unknown,
	path: string
): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new RuamOptionError(
			"RUAM_INVALID_ISOGLOSS_OPTIONS",
			path,
			"must be a plain object"
		);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new RuamOptionError(
			"RUAM_INVALID_ISOGLOSS_OPTIONS",
			path,
			"must be a plain object"
		);
	}
	return value as Readonly<Record<string, unknown>>;
}

function optionalRecord(
	value: unknown,
	path: string
): Readonly<Record<string, unknown>> {
	return value === undefined ? Object.freeze({}) : requireRecord(value, path);
}

function optionalEnum<const T extends readonly string[]>(
	value: unknown,
	path: string,
	allowed: T,
	fallback: T[number]
): T[number] {
	if (value === undefined) return fallback;
	if (typeof value !== "string" || !allowed.includes(value)) {
		invalid(path, `must be one of: ${allowed.join(", ")}`);
	}
	return value as T[number];
}

function requireLiteral<T extends string | boolean>(
	value: unknown,
	expected: T,
	path: string
): asserts value is T {
	if (value !== expected) invalid(path, `must be ${JSON.stringify(expected)}`);
}

function requireNonemptyString(value: unknown, path: string): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value !== value.trim()
	) {
		invalid(path, "must be a nonempty string without surrounding whitespace");
	}
	return value;
}

function requireNonemptyKey(value: string, path: string): void {
	if (value.length === 0 || value.trim().length === 0) {
		invalid(path, "mapping keys must not be empty or whitespace-only");
	}
}

function requireNoLocalFallback(value: unknown, path: string): void {
	if (value !== false) {
		throw new RuamOptionError(
			"RUAM_ISOGLOSS_LOCAL_FALLBACK_FORBIDDEN",
			path,
			"must be explicitly false for a nonlocal profile"
		);
	}
}

function required(profile: IsoglossDeploymentProfile, capability: string): never {
	throw new RuamOptionError(
		"RUAM_ISOGLOSS_CAPABILITY_REQUIRED",
		`isogloss.capabilities.${capability}`,
		`${profile} requires an explicit ${capability} capability descriptor`
	);
}

function mismatch(profile: IsoglossDeploymentProfile, detail: string): never {
	throw new RuamOptionError(
		"RUAM_ISOGLOSS_PROFILE_CAPABILITY_MISMATCH",
		"isogloss.capabilities",
		`${profile} ${detail}`
	);
}

function invalid(path: string, detail: string): never {
	throw new RuamOptionError("RUAM_INVALID_ISOGLOSS_OPTION", path, detail);
}

function unknown(path: string): never {
	throw new RuamOptionError(
		"RUAM_UNKNOWN_ISOGLOSS_OPTION",
		path,
		"unknown option"
	);
}
