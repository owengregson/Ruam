/**
 * @module naming/setup
 * Bridge between NameRegistry and the existing RuntimeNames/TempNames interface.
 *
 * Creates a NameRegistry, claims all required tokens, resolves them,
 * and produces RuntimeNames + TempNames objects compatible with the
 * existing codebase. This lets us centralize name generation without
 * changing every consumer.
 */

import { NameRegistry } from "./registry.js";
import { NameScope } from "./scope.js";
import { NameToken } from "./token.js";
import type { RuntimeNames, TempNames } from "./compat-types.js";
import {
	RUNTIME_KEYS,
	RUNTIME_POST_TEMP_KEYS,
	TEMP_KEYS,
	SHARED_RUNTIME_KEYS,
} from "./claims.js";

// --- Types ---

export interface RegistryResult {
	registry: NameRegistry;
	runtime: RuntimeNames;
	temps: TempNames;
	alphabet: string;
}

export interface ShieldedRegistryResult {
	registry: NameRegistry;
	shared: RuntimeNames;
	sharedTemps: TempNames;
	groups: RuntimeNames[];
	groupTemps: TempNames[];
	alphabet: string;
}

// --- Helpers ---

/** Claim RUNTIME_KEYS in a scope and return token map. */
function claimRuntimeKeys(scope: NameScope): Map<string, NameToken> {
	const map = new Map<string, NameToken>();
	for (const key of RUNTIME_KEYS) {
		map.set(key, scope.claim(key));
	}
	return map;
}

/** Claim RUNTIME_POST_TEMP_KEYS in a scope and add to existing map. */
function claimPostTempKeys(
	scope: NameScope,
	map: Map<string, NameToken>
): void {
	for (const key of RUNTIME_POST_TEMP_KEYS) {
		map.set(key, scope.claim(key));
	}
}

/** Claim TEMP_KEYS in a scope and return token map. */
function claimTempKeys(scope: NameScope): Map<string, NameToken> {
	const map = new Map<string, NameToken>();
	for (const key of TEMP_KEYS) {
		map.set(key, scope.claim(key));
	}
	return map;
}

/** Build a RuntimeNames object from resolved tokens. */
function buildRuntimeNames(tokens: Map<string, NameToken>): RuntimeNames {
	const get = (key: string): string => {
		const t = tokens.get(key);
		if (!t) throw new Error(`Missing runtime token: ${key}`);
		return t.name;
	};
	return {
		bt: get("bt"),
		vm: get("vm"),
		exec: get("exec"),
		execAsync: get("execAsync"),
		load: get("load"),
		cache: get("cache"),
		depth: get("depth"),
		callStack: get("callStack"),
		fp: get("fp"),
		rc4: get("rc4"),
		b64: get("b64"),
		deser: get("deser"),
		dbg: get("dbg"),
		dbgOp: get("dbgOp"),
		dbgCfg: get("dbgCfg"),
		dbgProt: get("dbgProt"),
		stk: get("stk"),
		stp: get("stp"),
		operand: get("operand"),
		scope: get("scope"),
		regs: get("regs"),
		ip: get("ip"),
		cArr: get("cArr"),
		iArr: get("iArr"),
		exStk: get("exStk"),
		pEx: get("pEx"),
		hPEx: get("hPEx"),
		cType: get("cType"),
		cVal: get("cVal"),
		unit: get("unit"),
		args: get("args"),
		outer: get("outer"),
		tVal: get("tVal"),
		nTgt: get("nTgt"),
		ho: get("ho"),
		phys: get("phys"),
		opVar: get("opVar"),
		thresh: get("thresh"),
		tdzSentinel: get("tdzSentinel"),
		strDec: get("strDec"),
		fSlots: get("fSlots"),
		rcState: get("rcState"),
		rcDeriveKey: get("rcDeriveKey"),
		rcMix: get("rcMix"),
		icDecrypt: get("icDecrypt"),
		icMix: get("icMix"),
		icBlockKey: get("icBlockKey"),
		ihash: get("ihash"),
		ihashFn: get("ihashFn"),
		keyAnchor: get("keyAnchor"),
		router: get("router"),
		routeMap: get("routeMap"),
		alpha: get("alpha"),
		imul: get("imul"),
		spreadSym: get("spreadSym"),
		hop: get("hop"),
		globalRef: get("globalRef"),
		polyDec: get("polyDec"),
		polyPosSeed: get("polyPosSeed"),
		strTbl: get("strTbl"),
		strCache: get("strCache"),
		strAcc: get("strAcc"),
		btDecode: get("btDecode"),
	};
}

/** Build a TempNames object from resolved tokens. */
function buildTempNames(tokens: Map<string, NameToken>): TempNames {
	const result: Record<string, string> = {};
	for (const key of TEMP_KEYS) {
		const t = tokens.get(key);
		if (!t) throw new Error(`Missing temp token: ${key}`);
		result[key] = t.name;
	}
	return result as TempNames;
}

/** Override shared fields on a group's RuntimeNames with shared values. */
function applySharedOverrides(
	groupNames: RuntimeNames,
	sharedNames: RuntimeNames
): void {
	for (const key of SHARED_RUNTIME_KEYS) {
		(groupNames as unknown as Record<string, string>)[key] =
			sharedNames[key];
	}
}

// --- Public API ---

/**
 * Create a NameRegistry and produce RuntimeNames + TempNames.
 * Drop-in replacement for generateRuntimeNames + generateAlphabet.
 */
export function setupRegistry(
	seed: number,
	additionalExclusions?: Set<string>
): RegistryResult {
	const registry = new NameRegistry(seed);
	if (additionalExclusions) {
		registry.exclude(additionalExclusions);
	}

	// Runtime names scope
	const runtimeScope = registry.createScope("runtime", {
		lengthTier: "short",
	});
	const runtimeTokens = claimRuntimeKeys(runtimeScope);

	// Temp names scope (claimed after runtime, before post-temp)
	const tempScope = registry.createScope("temps", { lengthTier: "short" });
	const tempTokens = claimTempKeys(tempScope);

	// Post-temp runtime keys (must be after temps for LCG sequence compat)
	claimPostTempKeys(runtimeScope, runtimeTokens);

	// Resolve all names
	registry.resolveAll();

	return {
		registry,
		runtime: buildRuntimeNames(runtimeTokens),
		temps: buildTempNames(tempTokens),
		alphabet: registry.getAlphabet(),
	};
}

/**
 * Create a NameRegistry for VM Shielding mode.
 * Drop-in replacement for generateShieldedNames + generateAlphabet.
 */
export function setupShieldedRegistry(
	sharedSeed: number,
	groupSeeds: number[],
	additionalExclusions?: Set<string>
): ShieldedRegistryResult {
	const registry = new NameRegistry(sharedSeed);
	if (additionalExclusions) {
		registry.exclude(additionalExclusions);
	}

	// Shared runtime names
	const sharedRtScope = registry.createScope("shared_runtime", {
		lengthTier: "short",
	});
	const sharedRtTokens = claimRuntimeKeys(sharedRtScope);

	// Shared temp names
	const sharedTempScope = registry.createScope("shared_temps", {
		lengthTier: "short",
	});
	const sharedTempTokens = claimTempKeys(sharedTempScope);

	// Shared post-temp keys
	claimPostTempKeys(sharedRtScope, sharedRtTokens);

	// Per-group scopes
	const groupRtTokens: Map<string, NameToken>[] = [];
	const groupTempTokens: Map<string, NameToken>[] = [];

	for (let i = 0; i < groupSeeds.length; i++) {
		const gRtScope = registry.createScope(`group${i}_runtime`, {
			lengthTier: "short",
		});
		const gRtToks = claimRuntimeKeys(gRtScope);

		const gTempScope = registry.createScope(`group${i}_temps`, {
			lengthTier: "short",
		});
		const gTempToks = claimTempKeys(gTempScope);

		claimPostTempKeys(gRtScope, gRtToks);

		groupRtTokens.push(gRtToks);
		groupTempTokens.push(gTempToks);
	}

	// Resolve all names
	registry.resolveAll();

	// Build results
	const sharedNames = buildRuntimeNames(sharedRtTokens);
	const sharedTemps = buildTempNames(sharedTempTokens);

	const groups: RuntimeNames[] = [];
	const groupTemps: TempNames[] = [];

	for (let i = 0; i < groupSeeds.length; i++) {
		const gNames = buildRuntimeNames(groupRtTokens[i]!);
		applySharedOverrides(gNames, sharedNames);
		groups.push(gNames);
		groupTemps.push(buildTempNames(groupTempTokens[i]!));
	}

	return {
		registry,
		shared: sharedNames,
		sharedTemps,
		groups,
		groupTemps,
		alphabet: registry.getAlphabet(),
	};
}
