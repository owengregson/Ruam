/**
 * Product source-to-source orchestration for local Isogloss regions.
 *
 * Every valid JavaScript construct is accepted. Proven finite pure return
 * regions are replaced completely by scalarized BPRF closures, while calls,
 * effects, dynamic coercions, unbounded values, and other general semantics
 * remain at native Isogloss sites. A BPRF-lowered relation never retains its
 * original expression as a fallback.
 *
 * Nonlocal profiles are intentionally rejected here. They require an
 * explicitly modeled pre-existing remote-await or attested boundary and are
 * built through the owner product planner, not silently grafted onto a
 * synchronous source expression.
 *
 * @module isogloss/source-transform
 */

import { parse } from "@babel/parser";
import * as t from "@babel/types";
import { generate, traverse } from "../babel-compat.js";
import { BABEL_PARSER_PLUGINS } from "../constants.js";
import {
	collectIdentifiersFromAst,
	preprocessIdentifierAst,
} from "../preprocess.js";
import { generateBprfArtifact } from "./bprf/index.js";
import { hashText, mix32 } from "./bprf/random.js";
import {
	emitBprfScalarSource,
	type BprfScalarSourceEmission,
} from "./bprf/scalar-source.js";
import type { ResolvedRuamOptions } from "./options.js";
import {
	discoverSourcePureRegions,
	type SourceFunctionCoverage,
	type SourcePureRegionSite,
	type SourceRegionDiscoveryDiagnostic,
	type SourceRegionOrigin,
} from "./source-sites.js";

const MAX_EMISSION_SEED_ATTEMPTS = 64;
export const ISOGLOSS_SOURCE_LIMITS = Object.freeze({
	sourceBytes: 8 * 1024 * 1024,
	protectedRegions: 128,
	outputBytes: 64 * 1024 * 1024,
});

export type IsoglossBuildDiagnosticCode =
	| SourceRegionDiscoveryDiagnostic["code"]
	| "RUAM_ISOGLOSS_EMITTER_SEED_REJECTED"
	| "RUAM_ISOGLOSS_IDENTIFIER_PREPROCESS_SKIPPED";

export interface IsoglossBuildDiagnostic {
	readonly code: IsoglossBuildDiagnosticCode;
	readonly functionName: string | null;
	readonly origin: SourceRegionOrigin;
	readonly detail: string | null;
}

export interface IsoglossOwnerRegionTrace {
	readonly regionId: string;
	readonly functionName: string;
	readonly origin: SourceRegionOrigin;
	readonly emitterCertificate: BprfScalarSourceEmission["certificate"];
}

export interface IsoglossOwnerSidecar {
	readonly format: "ruam-isogloss-owner-trace-1";
	readonly regions: readonly IsoglossOwnerRegionTrace[];
}

export interface IsoglossSourceBuildStats {
	readonly engine: "isogloss";
	readonly profile: "holographic-local";
	readonly rootGroupCount: number;
	readonly protectedRegionCount: number;
	readonly nativeRegionCount: number;
	readonly targetFunctionCount: number;
	readonly nativeFunctionCount: number;
	readonly hybridFunctionCount: number;
	readonly realizationCount: number;
	readonly fragmentFunctionCount: number;
	readonly originalBytes: number;
	readonly outputBytes: number;
	readonly expansionRatio: number;
	readonly languageCoverage: "full-javascript";
	readonly clientCompleteness: "complete";
	readonly hardnessLowerBound: null;
}

export interface IsoglossSourceBuildResult {
	readonly code: string;
	readonly diagnostics: readonly IsoglossBuildDiagnostic[];
	readonly stats: IsoglossSourceBuildStats;
	readonly ownerTrace?: IsoglossOwnerSidecar;
}

export class IsoglossSourceTransformError extends Error {
	override readonly name = "IsoglossSourceTransformError";

	constructor(
		readonly code:
			| "RUAM_ISOGLOSS_SOURCE_PROFILE_REQUIRES_EXTERNAL_BOUNDARY"
			| "RUAM_ISOGLOSS_CONFIGURED_TARGET_NOT_FOUND"
			| "RUAM_ISOGLOSS_RESOURCE_LIMIT"
			| "RUAM_ISOGLOSS_EMISSION_FAILED",
		detail: string
	) {
		super(`${code}: ${detail}`);
	}
}

export function buildLocalIsoglossSource(
	source: string,
	options: ResolvedRuamOptions,
	fileSeed: number,
	preprocessSeed?: number
): IsoglossSourceBuildResult {
	const originalBytes = utf8ByteLength(source);
	if (originalBytes > ISOGLOSS_SOURCE_LIMITS.sourceBytes) {
		throw new IsoglossSourceTransformError(
			"RUAM_ISOGLOSS_RESOURCE_LIMIT",
			`source bytes ${originalBytes} exceed ${ISOGLOSS_SOURCE_LIMITS.sourceBytes}`
		);
	}
	if (options.isogloss.profile !== "holographic-local") {
		throw new IsoglossSourceTransformError(
			"RUAM_ISOGLOSS_SOURCE_PROFILE_REQUIRES_EXTERNAL_BOUNDARY",
			`${options.isogloss.profile} must compose at an owner-proven custody or attestation boundary`
		);
	}
	if (!Number.isSafeInteger(fileSeed)) {
		throw new IsoglossSourceTransformError(
			"RUAM_ISOGLOSS_EMISSION_FAILED",
			"file seed must be a safe integer"
		);
	}
	if (
		preprocessSeed !== undefined &&
		!Number.isSafeInteger(preprocessSeed)
	) {
		throw new IsoglossSourceTransformError(
			"RUAM_ISOGLOSS_EMISSION_FAILED",
			"identifier preprocess seed must be a safe integer"
		);
	}

	const ast = parse(source, {
		sourceType: "unambiguous",
		plugins: [...BABEL_PARSER_PLUGINS],
	});
	const discovery = discoverSourcePureRegions(ast, {
		targetMode: options.targetMode,
		threshold: options.threshold,
		seed: fileSeed,
		regionDomains: options.regionDomains,
	});
	validateConfiguredTargets(discovery.functions, options);
	if (
		discovery.sites.length >
		ISOGLOSS_SOURCE_LIMITS.protectedRegions
	) {
		throw new IsoglossSourceTransformError(
			"RUAM_ISOGLOSS_RESOURCE_LIMIT",
			`protected regions ${discovery.sites.length} exceed ${ISOGLOSS_SOURCE_LIMITS.protectedRegions}`
		);
	}
	const occupiedNames = collectIdentifiersFromAst(ast);
	const helperStatements: t.Statement[] = [];
	const ownerRegions: IsoglossOwnerRegionTrace[] = [];
	const diagnostics: IsoglossBuildDiagnostic[] =
		discovery.diagnostics.map(buildDiagnostic);
	let realizationCount = 0;
	let fragmentFunctionCount = 0;

	for (const site of discovery.sites) {
		const built = buildSiteEmission(site, fileSeed, occupiedNames);
		occupiedNames.add(built.wrapperName);
		helperStatements.push(built.wrapperStatement);
		site.expressionPath.replaceWith(
			t.callExpression(
				t.identifier(built.wrapperName),
				site.region.ingress.map((input) =>
					t.identifier(input.name)
				)
			)
		);
		realizationCount += built.emission.stats.realizationCount;
		fragmentFunctionCount +=
			built.emission.stats.fragmentFunctionCount;
		ownerRegions.push(
			Object.freeze({
				regionId: site.id,
				functionName: site.functionName,
				origin: site.origin,
				emitterCertificate: built.emission.certificate,
			})
		);
	}

	if (preprocessSeed !== undefined && helperStatements.length > 0) {
		const dynamicResolution = findDynamicNameResolution(ast);
		if (dynamicResolution) {
			diagnostics.push(
				Object.freeze({
					code: "RUAM_ISOGLOSS_IDENTIFIER_PREPROCESS_SKIPPED",
					functionName: null,
					origin: dynamicResolution.origin,
					detail: dynamicResolution.detail,
				})
			);
		} else {
			preprocessIdentifierAst(
				ast,
				preprocessSeed,
				helperStatements.flatMap((statement) =>
					t.isVariableDeclaration(statement)
						? statement.declarations.flatMap((declaration) =>
								t.isIdentifier(declaration.id)
									? [declaration.id.name]
									: []
							)
						: []
				)
			);
		}
	}
	if (helperStatements.length > 0) {
		const insertionIndex = firstNonImportIndex(ast.program.body);
		ast.program.body.splice(
			insertionIndex,
			0,
			...helperStatements
		);
	}
	const generated =
		helperStatements.length === 0
			? source
			: generate(ast, {
					comments: true,
					compact: false,
				}).code;
	const outputBytes = utf8ByteLength(generated);
	if (outputBytes > ISOGLOSS_SOURCE_LIMITS.outputBytes) {
		throw new IsoglossSourceTransformError(
			"RUAM_ISOGLOSS_RESOURCE_LIMIT",
			`output bytes ${outputBytes} exceed ${ISOGLOSS_SOURCE_LIMITS.outputBytes}`
		);
	}
	const rootGroupCount = new Set(
		discovery.sites.map((site) => site.functionName)
	).size;
	const nativeRegionCount = discovery.functions.reduce(
		(total, item) => total + item.nativeRegionCount,
		0
	);
	const stats = Object.freeze({
		engine: "isogloss" as const,
		profile: "holographic-local" as const,
		rootGroupCount,
		protectedRegionCount: discovery.sites.length,
		nativeRegionCount,
		targetFunctionCount: discovery.functions.length,
		nativeFunctionCount: discovery.functions.filter(
			(item) => item.lane !== "bprf"
		).length,
		hybridFunctionCount: discovery.functions.filter(
			(item) => item.lane === "hybrid"
		).length,
		realizationCount,
		fragmentFunctionCount,
		originalBytes,
		outputBytes,
		expansionRatio:
			originalBytes === 0 ? 1 : outputBytes / originalBytes,
		languageCoverage: "full-javascript" as const,
		clientCompleteness: "complete" as const,
		hardnessLowerBound: null,
	});
	const base = {
		code: generated,
		diagnostics: Object.freeze(diagnostics),
		stats,
	};
	if (options.isogloss.ownerTrace !== "sidecar") {
		return Object.freeze(base);
	}
	return Object.freeze({
		...base,
		ownerTrace: Object.freeze({
			format: "ruam-isogloss-owner-trace-1",
			regions: Object.freeze(ownerRegions),
		}),
	});
}

function buildSiteEmission(
	site: SourcePureRegionSite,
	fileSeed: number,
	occupiedNames: ReadonlySet<string>
): {
	readonly emission: BprfScalarSourceEmission;
	readonly wrapperName: string;
	readonly wrapperStatement: t.Statement;
} {
	const domains = site.region.ingress.map((input) => input.domain);
	let lastError: unknown;
	for (let attempt = 0; attempt < MAX_EMISSION_SEED_ATTEMPTS; attempt++) {
		const seed = mix32(
			fileSeed ^
				hashText(site.id) ^
				Math.imul(attempt + 1, 0x9e3779b9)
		);
		try {
			const artifact = generateBprfArtifact(site.region.contract, {
				seed,
				realizationCount: 3,
				fragmentCount: 3,
			});
			const emission = emitBprfScalarSource(artifact, domains);
			const wrapperName = `${emission.entryName}_${mix32(
				seed ^ 0xa5a5a5a5
			).toString(36)}`;
			if (occupiedNames.has(wrapperName)) continue;
			const wrapperStatement = parseWrapper(
				wrapperName,
				emission,
				site,
				seed
			);
			return Object.freeze({
				emission,
				wrapperName,
				wrapperStatement,
			});
		} catch (error) {
			lastError = error;
		}
	}
	throw new IsoglossSourceTransformError(
		"RUAM_ISOGLOSS_EMISSION_FAILED",
		`${site.functionName}:${site.ordinal}: ${
			lastError instanceof Error ? lastError.message : String(lastError)
		}`
	);
}

function parseWrapper(
	wrapperName: string,
	emission: BprfScalarSourceEmission,
	site: SourcePureRegionSite,
	seed: number
): t.Statement {
	const intrinsics = {
		array: "__ruamArrayIntrinsic",
		arrayIsArray: "__ruamArrayIsArrayIntrinsic",
		error: "__ruamErrorIntrinsic",
		imul: "__ruamImulIntrinsic",
		numberIsSafeInteger: "__ruamNumberIsSafeIntegerIntrinsic",
		objectIs: "__ruamObjectIsIntrinsic",
	};
	if (
		Object.values(intrinsics).some((name) =>
			emission.source.includes(name)
		)
	) {
		throw new IsoglossSourceTransformError(
			"RUAM_ISOGLOSS_EMISSION_FAILED",
			"scalar emission collided with reserved intrinsic aliases"
		);
	}
	const intrinsicSafeEmission = emission.source
		.replaceAll("Array.isArray", intrinsics.arrayIsArray)
		.replaceAll("Number.isSafeInteger", intrinsics.numberIsSafeInteger)
		.replaceAll("Object.is", intrinsics.objectIs)
		.replaceAll("Math.imul", intrinsics.imul)
		.replaceAll("new Error", `new ${intrinsics.error}`);
	const caller = JSON.stringify(`${site.functionName}:${site.ordinal}`);
	const initialLineage = mix32(seed ^ hashText(site.functionName));
	const lineageStep = mix32(seed ^ 0x6d2b79f5) | 1;
	const parameters = site.region.ingress.map(
		(_input, index) => `x${index}`
	);
	const inputAssignments = parameters
		.map((parameter, index) => `a[${index}]=${parameter};`)
		.join("");
	const projection =
		site.region.outputType === "number"
			? `const r=${emission.entryName}(a,c)[0];return ${intrinsics.objectIs}(r,-0)?0:r;`
			: `return ${emission.entryName}(a,c)[0];`;
	const wrapperSource = [
		`const ${wrapperName}=(()=>{`,
		`const ${intrinsics.array}=[].constructor,${intrinsics.arrayIsArray}=[].constructor.isArray,${intrinsics.error}=(()=>{try{null.__ruam}catch(e){return e.constructor.__proto__}})(),${intrinsics.imul}=(a,b)=>{const ah=(a>>>16)&65535,al=a&65535,bh=(b>>>16)&65535,bl=b&65535;return(al*bl+((ah*bl+al*bh)<<16))|0},${intrinsics.numberIsSafeInteger}=(0).constructor.isSafeInteger,${intrinsics.objectIs}=({}).constructor.is;`,
		intrinsicSafeEmission,
		`const ap=[],cp=[];let epoch=0,lineage=${initialLineage >>> 0};`,
		`return function(${parameters.join(",")}){`,
		`const a=ap.pop()||${intrinsics.array}(${parameters.length}),c=cp.pop()||{caller:${caller},epoch:0,lineage:0};`,
		inputAssignments,
		`epoch=(epoch+1)>>>0;lineage=(lineage+epoch+${lineageStep >>> 0})>>>0;c.epoch=epoch;c.lineage=lineage;`,
		`try{${projection}}finally{ap.push(a);cp.push(c);}`,
		"};",
		"})();",
	].join("\n");
	const wrapperAst = parse(wrapperSource, {
		sourceType: "script",
	});
	const statement = wrapperAst.program.body[0];
	if (
		wrapperAst.program.body.length !== 1 ||
		!statement ||
		!t.isVariableDeclaration(statement)
	) {
		throw new IsoglossSourceTransformError(
			"RUAM_ISOGLOSS_EMISSION_FAILED",
			"scalar wrapper did not parse to one declaration"
		);
	}
	return statement;
}

function validateConfiguredTargets(
	functions: readonly SourceFunctionCoverage[],
	options: ResolvedRuamOptions
): void {
	const configured = new Set(Object.keys(options.regionDomains));
	const seen = new Set(
		functions.flatMap((item) =>
			item.functionName === null ? [] : [item.functionName]
		)
	);
	for (const functionName of configured) {
		if (!seen.has(functionName)) {
			throw new IsoglossSourceTransformError(
				"RUAM_ISOGLOSS_CONFIGURED_TARGET_NOT_FOUND",
				functionName
			);
		}
	}
}

function findDynamicNameResolution(
	ast: t.File
): { readonly detail: string; readonly origin: SourceRegionOrigin } | null {
	let found: { detail: string; node: t.Node } | null = null;
	traverse(ast, {
		WithStatement(path) {
			found = { detail: "with statement", node: path.node };
			path.stop();
		},
		Identifier(path) {
			if (path.node.name === "eval" || path.node.name === "Function") {
				found = {
					detail: `${path.node.name} reference`,
					node: path.node,
				};
				path.stop();
			}
		},
		CallExpression(path) {
			if (
				t.isIdentifier(path.node.callee) &&
				(path.node.callee.name === "eval" ||
					path.node.callee.name === "Function")
			) {
				found = {
					detail: `${path.node.callee.name} call`,
					node: path.node,
				};
				path.stop();
			}
		},
		NewExpression(path) {
			if (
				t.isIdentifier(path.node.callee, { name: "Function" })
			) {
				found = { detail: "Function constructor", node: path.node };
				path.stop();
			}
		},
	});
	const result = found as { detail: string; node: t.Node } | null;
	return result === null
		? null
		: Object.freeze({
				detail: result.detail,
				origin: originFor(result.node),
			});
}

function buildDiagnostic(
	diagnostic: SourceRegionDiscoveryDiagnostic
): IsoglossBuildDiagnostic {
	return Object.freeze({
		code: diagnostic.code,
		functionName: diagnostic.functionName,
		origin: diagnostic.origin,
		detail: diagnostic.rejection
			? `${diagnostic.rejection.code}:${diagnostic.rejection.detail}`
			: null,
	});
}

function originFor(node: t.Node): SourceRegionOrigin {
	return Object.freeze({
		line: node.loc?.start.line ?? null,
		column: node.loc?.start.column ?? null,
		start: node.start ?? null,
		end: node.end ?? null,
	});
}

function firstNonImportIndex(body: readonly t.Statement[]): number {
	let index = 0;
	while (index < body.length && t.isImportDeclaration(body[index]!)) {
		index++;
	}
	return index;
}

/** Browser-safe UTF-8 byte count. */
function utf8ByteLength(value: string): number {
	let bytes = 0;
	for (let index = 0; index < value.length; index++) {
		const unit = value.charCodeAt(index);
		if (unit <= 0x7f) {
			bytes++;
		} else if (unit <= 0x7ff) {
			bytes += 2;
		} else if (
			unit >= 0xd800 &&
			unit <= 0xdbff &&
			index + 1 < value.length
		) {
			const next = value.charCodeAt(index + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				bytes += 4;
				index++;
			} else {
				bytes += 3;
			}
		} else {
			bytes += 3;
		}
	}
	return bytes;
}
