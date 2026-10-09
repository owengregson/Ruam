import { RegionalPackageError, type RegionalGraphOptions, type RegionalResolvedOptions, type RegionalFileInventory, type RegionalCostReport } from "./contracts.js";

export const REGIONAL_EXPANSION_ALLOWANCE_BYTES = 65_536;

export function resolveRegionalGraphOptions(options: RegionalGraphOptions = {}): RegionalResolvedOptions {
	if (!options || typeof options !== "object" || Array.isArray(options)) {
		throw new RegionalPackageError("RUAM_REGIONAL_INVALID_LIMIT", "options must be an object");
	}
	const defaults = { maxNodes: 200_000, maxInputBytes: 1_000_000, maxOutputBytes: 10_000_000, maxFiles: 256 };
	const ceilings = { maxNodes: 1_000_000, maxInputBytes: 8 * 1024 * 1024, maxOutputBytes: 64 * 1024 * 1024, maxFiles: 0x7fffffff };
	const limits = { ...defaults };
	for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
		const value = options[key] === undefined ? defaults[key] : options[key]!;
		if (!Number.isSafeInteger(value) || value <= 0 || value > ceilings[key]) {
			throw new RegionalPackageError("RUAM_REGIONAL_INVALID_LIMIT", `${key} must be a positive integer <= ${ceilings[key]}`);
		}
		limits[key] = value;
	}
	const seed = options.seed === undefined ? 0 : options.seed;
	if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
		throw new RegionalPackageError("RUAM_REGIONAL_INVALID_SEED", "seed must be a uint32");
	}
	const maxExpansionRatio = options.maxExpansionRatio === undefined ? 10 : options.maxExpansionRatio;
	if (!Number.isFinite(maxExpansionRatio) || maxExpansionRatio < 1 || maxExpansionRatio > 1000) {
		throw new RegionalPackageError("RUAM_REGIONAL_INVALID_LIMIT", "maxExpansionRatio must be between 1 and 1000");
	}
	for (const key of ["fusion", "joint", "configuration"] as const) {
		if (options[key] !== undefined && typeof options[key] !== "boolean") {
			throw new RegionalPackageError("RUAM_REGIONAL_INVALID_OPTION", `${key} must be boolean`);
		}
	}
	return Object.freeze({ ...limits, seed, maxExpansionRatio, fusion: options.fusion ?? true, joint: options.joint ?? true, configuration: options.configuration ?? true });
}

export function assertRegionalBudget(value: number, maximum: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
		throw new RegionalPackageError("RUAM_REGIONAL_RESOURCE_LIMIT", `${name}: ${value} exceeds ${maximum}`);
	}
}

export function planRegionalCost(inputs: readonly RegionalFileInventory[], outputs: readonly RegionalFileInventory[], options: RegionalResolvedOptions): RegionalCostReport {
	const sum = (items: readonly RegionalFileInventory[], key: "bytes" | "nodes") => items.reduce((total, item) => total + item[key], 0);
	const inputBytes = sum(inputs, "bytes");
	const outputBytes = sum(outputs, "bytes");
	const inputNodes = sum(inputs, "nodes");
	const outputNodes = sum(outputs, "nodes");
	assertRegionalBudget(inputs.length, options.maxFiles, "files");
	assertRegionalBudget(inputBytes, options.maxInputBytes, "input bytes");
	assertRegionalBudget(outputBytes, options.maxOutputBytes, "output bytes");
	assertRegionalBudget(inputNodes, options.maxNodes, "input nodes");
	assertRegionalBudget(outputNodes, options.maxNodes, "output nodes");
	assertRegionalBudget(outputBytes, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(inputBytes * options.maxExpansionRatio + REGIONAL_EXPANSION_ALLOWANCE_BYTES)), "output expansion");
	return Object.freeze({ files: inputs.length, inputBytes, outputBytes, inputNodes, outputNodes, expansionRatio: inputBytes === 0 ? 0 : outputBytes / inputBytes, runtimePerformance: "not-measured", buildTiming: "not-measured" });
}
