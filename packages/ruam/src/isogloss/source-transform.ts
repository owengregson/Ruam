/**
 * Product source-to-source orchestration for local Isogloss regions.
 *
 * Unsupported JavaScript remains ordinary source at distributed native effect
 * sites. A configured pure return region is replaced completely by a
 * scalarized BPRF closure; the original relation is never embedded as a
 * fallback.
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
import { collectIdentifiers } from "../preprocess.js";
import { generateBprfArtifact } from "./bprf/index.js";
import { hashText, mix32 } from "./bprf/random.js";
import {
	emitBprfScalarSource,
	type BprfScalarSourceEmission,
} from "./bprf/scalar-source.js";
import type { ResolvedRuamOptions } from "./options.js";
import {
	discoverSourcePureRegions,
	type SourcePureRegionSite,
	type SourceRegionDiscoveryDiagnostic,
	type SourceRegionOrigin,
} from "./source-sites.js";

const REQUIRED_EMITTER_INTRINSICS = Object.freeze([
	"Array",
	"Error",
	"Math",
	"Number",
	"Object",
]);
const MAX_EMISSION_SEED_ATTEMPTS = 64;

export type IsoglossBuildDiagnosticCode =
	| SourceRegionDiscoveryDiagnostic["code"]
	| "RUAM_ISOGLOSS_EMITTER_SEED_REJECTED";

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
	readonly realizationCount: number;
	readonly fragmentFunctionCount: number;
	readonly originalBytes: number;
	readonly outputBytes: number;
	readonly expansionRatio: number;
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
			| "RUAM_ISOGLOSS_INTRINSIC_SHADOW"
			| "RUAM_ISOGLOSS_CONFIGURED_REGION_REJECTED"
			| "RUAM_ISOGLOSS_CONFIGURED_TARGET_NOT_FOUND"
			| "RUAM_ISOGLOSS_EMISSION_FAILED",
		detail: string
	) {
		super(`${code}: ${detail}`);
	}
}

export function buildLocalIsoglossSource(
	source: string,
	options: ResolvedRuamOptions,
	fileSeed: number
): IsoglossSourceBuildResult {
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

	const ast = parse(source, {
		sourceType: "unambiguous",
		plugins: [...BABEL_PARSER_PLUGINS],
	});
	const topLevelBindings = collectTopLevelBindings(ast);
	const shadowedIntrinsic = REQUIRED_EMITTER_INTRINSICS.find((name) =>
		topLevelBindings.has(name)
	);
	if (shadowedIntrinsic) {
		throw new IsoglossSourceTransformError(
			"RUAM_ISOGLOSS_INTRINSIC_SHADOW",
			`top-level binding ${shadowedIntrinsic} shadows a required scalar-emitter intrinsic`
		);
	}

	const discovery = discoverSourcePureRegions(ast, {
		targetMode: options.targetMode,
		threshold: options.threshold,
		seed: fileSeed,
		regionDomains: options.regionDomains,
	});
	validateConfiguredTargets(discovery.diagnostics, discovery.sites, options);

	const occupiedNames = collectIdentifiers(source);
	const helperStatements: t.Statement[] = [];
	const ownerRegions: IsoglossOwnerRegionTrace[] = [];
	const diagnostics = discovery.diagnostics.map(buildDiagnostic);
	let realizationCount = 0;
	let fragmentFunctionCount = 0;

	for (const site of discovery.sites) {
		const built = buildSiteEmission(site, fileSeed, occupiedNames);
		occupiedNames.add(built.wrapperName);
		helperStatements.push(built.wrapperStatement);
		site.expressionPath.replaceWith(
			t.callExpression(t.identifier(built.wrapperName), [
				t.arrayExpression(
					site.region.ingress.map((input) =>
						t.identifier(input.name)
					)
				),
			])
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

	if (helperStatements.length > 0) {
		const insertionIndex = firstNonImportIndex(ast.program.body);
		ast.program.body.splice(
			insertionIndex,
			0,
			...helperStatements
		);
	}
	const generated = generate(ast, {
		comments: true,
		compact: false,
	}).code;
	const originalBytes = utf8ByteLength(source);
	const outputBytes = utf8ByteLength(generated);
	const rootGroupCount = new Set(
		discovery.sites.map((site) => site.functionName)
	).size;
	const stats = Object.freeze({
		engine: "isogloss" as const,
		profile: "holographic-local" as const,
		rootGroupCount,
		protectedRegionCount: discovery.sites.length,
		realizationCount,
		fragmentFunctionCount,
		originalBytes,
		outputBytes,
		expansionRatio:
			originalBytes === 0 ? 1 : outputBytes / originalBytes,
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
	const caller = JSON.stringify(`${site.functionName}:${site.ordinal}`);
	const initialLineage = mix32(seed ^ hashText(site.functionName));
	const lineageStep = mix32(seed ^ 0x6d2b79f5) | 1;
	const projection =
		site.region.outputType === "number"
			? `const r=${emission.entryName}(a,{caller:${caller},epoch:e,lineage:l})[0];return Object.is(r,-0)?0:r;`
			: `return ${emission.entryName}(a,{caller:${caller},epoch:e,lineage:l})[0];`;
	const wrapperSource = [
		`const ${wrapperName}=(()=>{`,
		emission.source,
		`let e=0,l=${initialLineage >>> 0};`,
		"return function(a){",
		`e=(e+1)>>>0;l=(l+e+${lineageStep >>> 0})>>>0;`,
		projection,
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
	diagnostics: readonly SourceRegionDiscoveryDiagnostic[],
	sites: readonly SourcePureRegionSite[],
	options: ResolvedRuamOptions
): void {
	const configured = new Set(Object.keys(options.regionDomains));
	const seen = new Set<string>();
	for (const site of sites) seen.add(site.functionName);
	for (const diagnostic of diagnostics) {
		if (diagnostic.functionName) seen.add(diagnostic.functionName);
		if (
			diagnostic.functionName &&
			configured.has(diagnostic.functionName) &&
			(diagnostic.code === "RUAM_SOURCE_REGION_REJECTED" ||
				diagnostic.code === "RUAM_SOURCE_REGION_TOO_SMALL")
		) {
			throw new IsoglossSourceTransformError(
				"RUAM_ISOGLOSS_CONFIGURED_REGION_REJECTED",
				`${diagnostic.functionName}: ${
					diagnostic.rejection?.code ?? diagnostic.code
				}`
			);
		}
	}
	for (const functionName of configured) {
		if (!seen.has(functionName)) {
			throw new IsoglossSourceTransformError(
				"RUAM_ISOGLOSS_CONFIGURED_TARGET_NOT_FOUND",
				functionName
			);
		}
	}
}

function collectTopLevelBindings(ast: t.File): ReadonlySet<string> {
	const names = new Set<string>();
	traverse(ast, {
		Program(path) {
			for (const name of Object.keys(path.scope.bindings)) names.add(name);
			path.stop();
		},
	});
	return names;
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
