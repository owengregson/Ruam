/** Browser-safe entry points for the unqualified regional research compiler.
 * @module regional
 */
import { compileRegionalGraph } from "./graph.js";

export { compileRegionalGraph } from "./graph.js";
export type { RegionalGraphOptions, RegionalPackageBuild } from "./contracts.js";

/**
 * Compile a complete standalone script through the package pipeline.
 * Imports need compileRegionalGraph with all dependency sources supplied.
 * The returned report is owner evidence, not a protection certification.
 * @param source Authored JavaScript.
 * @param options Bounded experimental compiler options.
 * @returns Final code and owner-side package evidence.
 */
export function compileRegionalCode(
	source: string,
	options?: Parameters<typeof compileRegionalGraph>[1]
) {
	const report = compileRegionalGraph({ entryPoints: ["input.js"], files: { "input.js": source } }, options);
	return { code: report.files["input.js"]!, report };
}
