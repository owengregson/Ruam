/** Browser-safe bounded regional compiler experiment.
 * @module regional/compiler
 */
import { parse } from "@babel/parser";
import * as t from "@babel/types";
import { generate } from "../../babel-compat.js";
import { NameRegistry } from "../../naming/registry.js";
import { admit, inventory } from "./analysis.js";
import { fusePrivateCalls, preserveDirectiveBoundaries, realizeDependentRegions, specializeConfiguration } from "./transforms.js";
import { RegionalCompileError, type RegionalCompileOptions, type RegionalCompileReport } from "./types.js";

export { RegionalCompileError } from "./types.js";
export type { RegionalCompileOptions, RegionalCompileReport, RegionalCompileErrorCode, RegionalWitness } from "./types.js";

export interface RegionalCompileResult { code: string; report: RegionalCompileReport }

/**
 * Compile a script or standalone module without static dependency edges.
 * @param source Authored JavaScript; original-source reflection is not preserved.
 * @param options Bounded deterministic recipes; all results remain unqualified.
 * @returns Generated JavaScript and owner-side evidence, never a security certificate.
 */
export function compileRegionalSource(source: string, options: RegionalCompileOptions = {}): RegionalCompileResult {
	return compile(source, options, false);
}

/** Internal graph adapter. Not a public entry point: the caller must first own and
 * validate every static dependency edge and reject cycles. No option can enable it.
 * @internal
 */
export function compileRegionalGraphModule(source: string, options: RegionalCompileOptions = {}, sourceType: "script" | "module" = "module"): RegionalCompileResult {
	return compile(source, options, true, sourceType);
}

function compile(source: string, options: RegionalCompileOptions, graphModule: boolean, sourceType?: "script" | "module"): RegionalCompileResult {
	if (typeof source !== "string" || !options || typeof options !== "object" || Array.isArray(options)) {
		throw new RegionalCompileError("REGIONAL_INVALID_OPTIONS", "source must be a string and options an object");
	}
	const seed = options.seed ?? 0;
	const maxNodes = options.maxNodes ?? 100_000;
	const maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024;
	if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff ||
		!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 1_000_000 ||
		!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 64 * 1024 * 1024 ||
		[options.fusion, options.joint, options.configuration].some(value => value !== undefined && typeof value !== "boolean")) {
		throw new RegionalCompileError("REGIONAL_INVALID_OPTIONS", "seed, flags or resource limits are outside the admitted range");
	}
	const sourceBytes = new TextEncoder().encode(source).byteLength;
	if (sourceBytes > Math.min(8 * 1024 * 1024, maxNodes * 256)) {
		throw new RegionalCompileError("REGIONAL_RESOURCE_LIMIT", "input byte budget exceeded before parsing");
	}
	let ast: t.File;
	try {
		ast = parse(source, { sourceType: sourceType ?? "unambiguous", createImportExpressions: true });
	} catch (error) {
		throw new RegionalCompileError("REGIONAL_PARSE_ERROR", error instanceof Error ? error.message : "source parse failed");
	}
	const nodes = inventory(ast, maxNodes);
	admit(nodes, graphModule);
	const originals = new Set(nodes);
	const registry = new NameRegistry(seed);
	registry.exclude(nodes.filter(t.isIdentifier).map(node => node.name));
	registry.resolveAll();
	const report: RegionalCompileReport = {
		status: "experimental-unqualified",
		sourceType: ast.program.sourceType === "module" ? "module" : "script",
		seed, inputNodes: nodes.length, outputNodes: 0, sourceBytes, outputBytes: 0,
		transformations: { privateCallFusions: 0, configurationReads: 0, jointRegions: 0 },
		analysis: {
			kind: "bounded-ast-dataflow",
			functions: nodes.filter(t.isFunction).length,
			calls: nodes.filter(node => t.isCallExpression(node) || t.isNewExpression(node) || t.isOptionalCallExpression(node)).length,
			propertyAccesses: nodes.filter(node => t.isMemberExpression(node) || t.isOptionalMemberExpression(node)).length,
			potentialCoercions: nodes.filter(node => t.isBinaryExpression(node) || t.isUnaryExpression(node) || t.isUpdateExpression(node)).length,
			exceptionRegions: nodes.filter(t.isTryStatement).length,
			domainFacts: [],
			aliasPolicy: "native-binding-identity-no-state-snapshots",
			effectPolicy: "preserve-native-order-outside-proven-recipes",
			limitations: [
				"No general SSA, contextual-equivalence proof, complete capability-flow proof, or measured protection claim.",
				"Untransformed general authored syntax remains ordinary generated JavaScript; whole-source protection is not established.",
				"Unknown host callbacks must not supply runtime source capabilities or depend on original function text/caller stacks.",
				"Recipe checks are syntactic/domain proofs, not an independent final-artifact equivalence checker.",
			],
		},
		coverage: { inspectedNodes: nodes.length, transformedSourceNodes: 0, wholeSourceProtection: false },
		compatibility: { sourceReflection: "generated-source", hostContract: "no-runtime-source-or-original-source-dependent-callbacks", diagnostics: "engine-source-dependent-stack-and-error-text-excluded" },
		witnesses: [],
	};
	const context = { report, name: registry.createDynamicGenerator("regional/compiler/temporaries"), transformed: new Set<t.Node>() };
	if (options.configuration !== false) specializeConfiguration(ast, context);
	if (options.joint !== false) realizeDependentRegions(ast, context);
	if (options.fusion !== false) fusePrivateCalls(ast, context);
	preserveDirectiveBoundaries(ast);
	report.outputNodes = inventory(ast, maxNodes).length;
	report.coverage.transformedSourceNodes = [...context.transformed].filter(node => originals.has(node)).length;
	const code = generate(ast, { comments: false, compact: false, sourceMaps: false }).code;
	report.outputBytes = new TextEncoder().encode(code).byteLength;
	if (report.outputBytes > maxOutputBytes) throw new RegionalCompileError("REGIONAL_RESOURCE_LIMIT", "emitted byte budget exceeded");
	return { code, report };
}
