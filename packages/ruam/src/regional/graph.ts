import { compileRegionalGraphModule } from "./compiler/index.js";
import { RegionalPackageError, type RegionalGraphInput, type RegionalGraphOptions, type RegionalPackageBuild, type RegionalFileInventory } from "./contracts.js";
import { assertRegionalBudget, planRegionalCost, resolveRegionalGraphOptions } from "./cost.js";
import { inventoryRegionalFile, qualifyRegionalModuleContexts, regionalDependencyOrder, regionalUtf8Bytes, snapshotRegionalFiles, validateRegionalArtifactFiles } from "./validation.js";

const producedPackages = new WeakSet<object>();
/** Owner-process provenance only; this is not runtime artifact authentication. */
export function isCompilerProducedRegionalPackage(value: unknown): value is RegionalPackageBuild {
	return typeof value === "object" && value !== null && producedPackages.has(value);
}

export function compileRegionalGraph(input: RegionalGraphInput, suppliedOptions: RegionalGraphOptions = {}): RegionalPackageBuild {
	const options = resolveRegionalGraphOptions(suppliedOptions);
	if (!input || typeof input !== "object") throw new RegionalPackageError("RUAM_REGIONAL_INVALID_FILES", "graph input is required");
	const sources = snapshotRegionalFiles(input.files);
	assertRegionalBudget(Object.keys(sources).length,options.maxFiles,"files");
	if (!Array.isArray(input.entryPoints) || !input.entryPoints.length) throw new RegionalPackageError("RUAM_REGIONAL_ENTRY_MISSING", "at least one entry is required");
	const entryPoints = Object.freeze([...input.entryPoints]);
	let sourceInventory: RegionalFileInventory[] = [];
	let inputBytes = 0; let inputNodes = 0;
	for (const path of Object.keys(sources)) {
		inputBytes += regionalUtf8Bytes(sources[path]!);
		assertRegionalBudget(inputBytes,options.maxInputBytes,"input bytes");
		const inventory = inventoryRegionalFile(path,sources[path]!,options.maxNodes);
		inputNodes += inventory.nodes;
		assertRegionalBudget(inputNodes,options.maxNodes,"input nodes");
		sourceInventory.push(inventory);
	}
	const moduleOrder = regionalDependencyOrder(sourceInventory,entryPoints);
	sourceInventory = qualifyRegionalModuleContexts(sources,sourceInventory,options.maxNodes);
	const contexts = new Map(sourceInventory.map(file => [file.path,file.sourceType]));
	const files: Record<string,string> = Object.create(null);
	const reports: Record<string,unknown> = Object.create(null);
	let outputBytes = 0;
	for (const path of Object.keys(sources)) {
		const result = compileRegionalGraphModule(sources[path]!, {seed: options.seed, fusion:options.fusion, joint:options.joint, configuration:options.configuration, maxNodes:options.maxNodes, maxOutputBytes:options.maxOutputBytes - outputBytes}, contexts.get(path)!);
		outputBytes += regionalUtf8Bytes(result.code);
		assertRegionalBudget(outputBytes,options.maxOutputBytes,"output bytes");
		files[path] = result.code; reports[path] = result.report;
	}
	const frozenFiles = Object.freeze(files);
	const evidence = validateRegionalArtifactFiles(frozenFiles,entryPoints,options.maxNodes,sourceInventory);
	const cost = planRegionalCost(sourceInventory,evidence.files,options);
	const build: RegionalPackageBuild = Object.freeze({format:"ruam-regional-package-v1",status:"experimental-unqualified",files:frozenFiles,entryPoints,moduleOrder,options,sourceInventory:Object.freeze(sourceInventory),reports:Object.freeze(reports),cost,evidence,wholeSourceProtection:false,crossModuleOptimization:false,releaseApproved:false});
	producedPackages.add(build);
	return build;
}

export type { RegionalGraphInput, RegionalGraphOptions, RegionalPackageBuild } from "./contracts.js";
