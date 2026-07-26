/** Public compiler-side surface for the bounded pure BPRF spike. */

export { generateBprfArtifact } from "./generate.js";
export { validateBprfArtifact } from "./validate.js";
export type {
	BprfArtifact,
	BprfCallerContext,
	BprfFactor,
	BprfFragment,
	BprfGenerationOptions,
	BprfPiece,
	BprfPort,
	BprfRealization,
	BprfReferenceResult,
	BprfReferenceTraceEvent,
	BprfTransition,
	BprfValidationReport,
	BprfWireBasis,
	PureRegionContract,
	PureRegionFormula,
	PureRegionInput,
	PureRegionStep,
	PureScalar,
	PureValueRef,
	PureValueType,
} from "./types.js";
