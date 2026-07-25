/**
 * Production-shaped local scalar source emission for validated BPRF artifacts.
 *
 * The emitted client is complete: a local attacker can inspect every emitted
 * realization and scalar expression. This removes a universal artifact-walker
 * seam; it does not create secrecy or a hardness guarantee.
 *
 * @module isogloss/bprf/scalar-source
 */

import { hashText, mix32 } from "./random.js";
import type {
	BprfArtifact,
	BprfCallerContext,
	BprfFragment,
	BprfPiece,
	BprfRealization,
	BprfTransition,
	BprfWireBasis,
	PureScalar,
} from "./types.js";
import { validateBprfArtifact } from "./validate.js";

const MAX_EXACT_DYADIC_NUMERATOR = 1n << 53n;

export type BprfScalarInputDomain =
	| { type: "boolean" }
	| { type: "number"; min: number; max: number };

export interface BprfScalarEmissionStats {
	byteLength: number;
	realizationCount: number;
	transitionCount: number;
	physicalSlotLocalCount: number;
	fragmentFunctionCount: number;
	fragmentContributionLocalCount: number;
	pieceExpressionCount: number;
	arithmeticProofOperationCount: number;
}

export interface BprfScalarEmissionCertificate {
	artifactValidated: true;
	artifactFormat: "ruam-bprf-pure-1";
	abi: "entry(inputs,context)->outputs";
	inputArity: number;
	outputArity: number;
	contextualRealizationCount: number;
	guardedInputDomains: readonly BprfScalarInputDomain[];
	arithmeticStrategy: "static-exact-dyadic-physical-slot-scalarization";
	maxExactDyadicNumeratorMagnitude: bigint;
	maxExactDyadicNumeratorBits: number;
	physicalSlotScalarization: true;
	runtimeArtifactWalker: false;
	ownerTrace: false;
	completeLocalClient: true;
	hardnessClaim: null;
	securityNonClaim: "complete-local-client-no-secrecy-or-hardness-claim";
}

export interface BprfScalarSourceEmission {
	source: string;
	entryName: string;
	stats: BprfScalarEmissionStats;
	certificate: BprfScalarEmissionCertificate;
}

interface DyadicRange {
	/** Every possible value is an integer multiple of 2^exponent. */
	exponent: number;
	/** Inclusive upper bound on the absolute integer multiplier. */
	numeratorMagnitude: bigint;
}

interface RealizationProof {
	slotRanges: ReadonlyMap<number, DyadicRange>;
}

interface EmissionCounters {
	transitionCount: number;
	physicalSlotLocalCount: number;
	fragmentFunctionCount: number;
	fragmentContributionLocalCount: number;
	pieceExpressionCount: number;
}

interface FragmentDestination {
	fragment: BprfFragment;
	pieces: readonly BprfPiece[];
}

/**
 * Prove that every realization remains exactly equivalent over the declared
 * input domains. Product planners call this before publishing an artifact,
 * even when no JavaScript scalar source is emitted at that boundary.
 */
export function assertBprfScalarArtifactExact(
	artifact: BprfArtifact,
	inputDomains: readonly BprfScalarInputDomain[]
): void {
	validateBprfArtifact(artifact);
	const domains = validateAndFreezeDomains(artifact, inputDomains);
	validateCrossRealizationAbi(artifact, domains);
	const exactness = new ExactDyadicProof();
	for (const realization of artifact.realizations) {
		proveRealization(realization, domains, exactness);
	}
}

/**
 * Emit one deterministic standalone declaration.
 *
 * The returned entry accepts guarded inputs and a caller context and returns an
 * output tuple. There is no tracing parameter or runtime artifact object.
 */
export function emitBprfScalarSource(
	artifact: BprfArtifact,
	inputDomains: readonly BprfScalarInputDomain[]
): BprfScalarSourceEmission {
	validateBprfArtifact(artifact);
	const domains = validateAndFreezeDomains(artifact, inputDomains);
	const outputArity = validateCrossRealizationAbi(artifact, domains);
	const exactness = new ExactDyadicProof();
	const proofs = artifact.realizations.map((realization) =>
		proveRealization(realization, domains, exactness)
	);
	const names = new OpaqueIdentifierAllocator(
		artifact.id,
		artifact.selectionSalt
	);
	const entryName = names.name("entry");
	const mixName = names.name("context-mix");
	const hashName = names.name("context-hash");
	const realizationNames = artifact.realizations.map((realization) =>
		names.name(`realization:${realization.id}`)
	);
	const counters: EmissionCounters = {
		transitionCount: 0,
		physicalSlotLocalCount: 0,
		fragmentFunctionCount: 0,
		fragmentContributionLocalCount: 0,
		pieceExpressionCount: 0,
	};
	const sourceParts = ['"use strict";'];

	for (
		let realizationIndex = 0;
		realizationIndex < artifact.realizations.length;
		realizationIndex++
	) {
		sourceParts.push(
			emitRealization(
				artifact.realizations[realizationIndex]!,
				proofs[realizationIndex]!,
				realizationNames[realizationIndex]!,
				names,
				counters
			)
		);
	}
	sourceParts.push(emitContextMixers(mixName, hashName));
	sourceParts.push(
		emitEntry(
			entryName,
			mixName,
			hashName,
			artifact.selectionSalt,
			realizationNames,
			domains
		)
	);

	const source = sourceParts.join("\n");
	const stats = Object.freeze({
		byteLength: utf8ByteLength(source),
		realizationCount: artifact.realizations.length,
		transitionCount: counters.transitionCount,
		physicalSlotLocalCount: counters.physicalSlotLocalCount,
		fragmentFunctionCount: counters.fragmentFunctionCount,
		fragmentContributionLocalCount:
			counters.fragmentContributionLocalCount,
		pieceExpressionCount: counters.pieceExpressionCount,
		arithmeticProofOperationCount: exactness.operationCount,
	});
	const certificate = Object.freeze({
		artifactValidated: true,
		artifactFormat: "ruam-bprf-pure-1",
		abi: "entry(inputs,context)->outputs",
		inputArity: domains.length,
		outputArity,
		contextualRealizationCount: artifact.realizations.length,
		guardedInputDomains: domains,
		arithmeticStrategy:
			"static-exact-dyadic-physical-slot-scalarization",
		maxExactDyadicNumeratorMagnitude:
			exactness.maxNumeratorMagnitude,
		maxExactDyadicNumeratorBits: bitLength(
			exactness.maxNumeratorMagnitude
		),
		physicalSlotScalarization: true,
		runtimeArtifactWalker: false,
		ownerTrace: false,
		completeLocalClient: true,
		hardnessClaim: null,
		securityNonClaim:
			"complete-local-client-no-secrecy-or-hardness-claim",
	}) satisfies BprfScalarEmissionCertificate;
	return Object.freeze({ source, entryName, stats, certificate });
}

function proveRealization(
	realization: BprfRealization,
	domains: readonly BprfScalarInputDomain[],
	exactness: ExactDyadicProof
): RealizationProof {
	const slots = new Map<number, DyadicRange>();
	for (let inputIndex = 0; inputIndex < domains.length; inputIndex++) {
		const domain = domains[inputIndex]!;
		const port = realization.inputPorts[inputIndex]!;
		const coordinate =
			domain.type === "boolean"
				? exactness.integerRange(
						realization.familyCode === 0 ? 1n : 1n,
						`input:${inputIndex}`
					)
				: exactness.integerRange(
						maxAbsInteger(domain.min, domain.max),
						`input:${inputIndex}`
					);
		exactness.proveAffineRoundTrip(
			coordinate,
			port.basis,
			`input:${inputIndex}`
		);
		slots.set(port.slot, coordinate);
	}

	for (const transition of realization.transitions) {
		const referenceTotals = new Map<number, DyadicRange>();
		const fragmentTotals = new Map<string, DyadicRange>();
		for (const fragment of realization.fragments) {
			for (const destination of transition.writes) {
				const pieces = fragment.pieces.filter(
					(piece) =>
						piece.phase === transition.phase &&
						piece.destination === destination
				);
				if (pieces.length === 0) {
					throw new Error(
						"RUAM_BPRF_SCALAR_MISSING_FRAGMENT_DESTINATION"
					);
				}
				let fragmentTotal = exactness.zero();
				for (const piece of pieces) {
					const contribution = provePiece(piece, slots, exactness);
					fragmentTotal = exactness.add(
						fragmentTotal,
						contribution,
						`fragment:${fragment.id}:${destination}`
					);
					const priorReference =
						referenceTotals.get(destination) ?? exactness.zero();
					referenceTotals.set(
						destination,
						exactness.add(
							priorReference,
							contribution,
							`reference:${transition.id}:${destination}`
						)
					);
				}
				fragmentTotals.set(
					fragmentDestinationKey(fragment.id, destination),
					fragmentTotal
				);
			}
		}

		for (const destination of transition.writes) {
			let emittedTotal = exactness.zero();
			for (const fragment of realization.fragments) {
				emittedTotal = exactness.add(
					emittedTotal,
					fragmentTotals.get(
						fragmentDestinationKey(fragment.id, destination)
					)!,
					`emitted:${transition.id}:${destination}`
				);
			}
			const referenceTotal = referenceTotals.get(destination);
			if (!referenceTotal) {
				throw new Error(
					"RUAM_BPRF_SCALAR_MISSING_DESTINATION_TOTAL"
				);
			}
			const basis = destinationBasis(
				realization,
				transition,
				destination
			);
			exactness.proveAffineRoundTrip(
				referenceTotal,
				basis,
				`destination:${transition.id}:${destination}`
			);
			// Both groupings are exact dyadic arithmetic and therefore equal.
			slots.set(destination, emittedTotal);
		}
	}

	for (let outputIndex = 0; outputIndex < realization.outputPorts.length; outputIndex++) {
		const port = realization.outputPorts[outputIndex]!;
		const coordinate = slots.get(port.slot);
		if (!coordinate) {
			throw new Error("RUAM_BPRF_SCALAR_MISSING_OUTPUT_SLOT");
		}
		exactness.proveAffineRoundTrip(
			coordinate,
			port.basis,
			`output:${outputIndex}`
		);
	}
	return Object.freeze({ slotRanges: slots });
}

function provePiece(
	piece: BprfPiece,
	slots: ReadonlyMap<number, DyadicRange>,
	exactness: ExactDyadicProof
): DyadicRange {
	let value = exactness.constant(
		piece.coefficient,
		`coefficient:${piece.phase}:${piece.destination}`
	);
	for (let factorIndex = 0; factorIndex < piece.factors.length; factorIndex++) {
		const factor = piece.factors[factorIndex]!;
		const coordinate = slots.get(factor.slot);
		if (!coordinate) {
			throw new Error("RUAM_BPRF_SCALAR_READ_BEFORE_WRITE");
		}
		const offset = exactness.constant(
			factor.offset,
			`offset:${piece.phase}:${piece.destination}:${factorIndex}`
		);
		const shifted = exactness.add(
			coordinate,
			offset,
			`factor-add:${piece.phase}:${piece.destination}:${factorIndex}`
		);
		value = exactness.multiply(
			value,
			shifted,
			`factor-multiply:${piece.phase}:${piece.destination}:${factorIndex}`
		);
	}
	return value;
}

function emitRealization(
	realization: BprfRealization,
	proof: RealizationProof,
	realizationName: string,
	names: OpaqueIdentifierAllocator,
	counters: EmissionCounters
): string {
	const slotNames = Array.from(
		{ length: realization.frameSize },
		(_, slot) =>
			names.name(`slot:${realization.id}:${slot}`)
	);
	const lines = [`function ${realizationName}(a){`];
	lines.push(`let ${slotNames.join(",")};`);
	counters.physicalSlotLocalCount += slotNames.length;

	for (let inputIndex = 0; inputIndex < realization.inputPorts.length; inputIndex++) {
		const port = realization.inputPorts[inputIndex]!;
		const coordinate =
			port.typeCode === 0
				? `a[${inputIndex}]`
				: realization.familyCode === 0
					? `(a[${inputIndex}]?1:0)`
					: `(a[${inputIndex}]?1:-1)`;
		lines.push(
			`${slotNames[port.slot]}=(${coordinate})*(${numberSource(
				port.basis.scale
			)})+(${numberSource(port.basis.bias)});`
		);
	}

	for (const transition of realization.transitions) {
		counters.transitionCount++;
		const contributions = new Map<number, string[]>();
		for (const destination of transition.writes) {
			contributions.set(destination, []);
		}
			for (const fragment of realization.fragments) {
				for (const destination of transition.writes) {
					const grouped = groupFragmentDestination(
						fragment,
						transition,
						destination
					);
					const contributionName = names.name(
						`fragment-contribution:${realization.id}:${transition.id}:${fragment.id}:${destination}`
					);
					const expression = grouped.pieces
						.map((piece) => {
						counters.pieceExpressionCount++;
							return emitPieceExpression(piece, slotNames);
						})
						.join("+");
					lines.push(`const ${contributionName}=0+${expression};`);
					contributions.get(destination)!.push(contributionName);
					counters.fragmentContributionLocalCount++;
				}
			}
		for (const destination of transition.writes) {
			const basis = destinationBasis(
				realization,
				transition,
				destination
			);
			lines.push(
				`${slotNames[destination]}=(0+${contributions
					.get(destination)!
					.join("+")})*(${numberSource(basis.scale)})+(${numberSource(
					basis.bias
				)});`
			);
		}
	}

	const outputs = realization.outputPorts.map((port) => {
		const coordinate = `((${slotNames[port.slot]}-(${numberSource(
			port.basis.bias
		)}))/(${numberSource(port.basis.scale)}))`;
		if (!proof.slotRanges.has(port.slot)) {
			throw new Error("RUAM_BPRF_SCALAR_MISSING_EMITTED_OUTPUT");
		}
		if (port.typeCode === 0) return coordinate;
		return realization.familyCode === 0
			? `(${coordinate}>0.5)`
			: `(${coordinate}>0)`;
	});
	lines.push(`return [${outputs.join(",")}];`, "}");
	return lines.join("\n");
}

function emitPieceExpression(
	piece: BprfPiece,
	slotNames: readonly string[]
): string {
	let expression = `(${numberSource(piece.coefficient)})`;
	for (const factor of piece.factors) {
		const coordinate = `((${slotNames[factor.slot]}-(${numberSource(
			factor.basis.bias
		)}))/(${numberSource(factor.basis.scale)}))`;
		expression = `(${expression}*(${coordinate}+(${numberSource(
			factor.offset
		)})))`;
	}
	return expression;
}

function emitContextMixers(mixName: string, hashName: string): string {
	return [
		`function ${mixName}(x){x>>>=0;x=Math.imul(x^(x>>>16),2146121005);x=Math.imul(x^(x>>>15),2221713035);return(x^(x>>>16))>>>0;}`,
		`function ${hashName}(s,x){for(let j=0;j<s.length;j++){x^=s.charCodeAt(j);x=Math.imul(x,16777619)>>>0;}return ${mixName}(x);}`,
	].join("\n");
}

function emitEntry(
	entryName: string,
	mixName: string,
	hashName: string,
	selectionSalt: number,
	realizationNames: readonly string[],
	domains: readonly BprfScalarInputDomain[]
): string {
	const lines = [
		`function ${entryName}(a,c){`,
		`if(!Array.isArray(a)||a.length!==${domains.length})throw new Error("RUAM_BPRF_SCALAR_INPUT_ABI");`,
	];
	for (let inputIndex = 0; inputIndex < domains.length; inputIndex++) {
		const domain = domains[inputIndex]!;
		if (domain.type === "boolean") {
			lines.push(
				`if(typeof a[${inputIndex}]!=="boolean")throw new Error("RUAM_BPRF_SCALAR_INPUT_GUARD");`
			);
		} else {
			lines.push(
				`if(!Number.isSafeInteger(a[${inputIndex}])||Object.is(a[${inputIndex}],-0)||a[${inputIndex}]<${numberSource(domain.min)}||a[${inputIndex}]>${numberSource(domain.max)})throw new Error("RUAM_BPRF_SCALAR_INPUT_GUARD");`
			);
		}
	}
	lines.push(
		'if(!c||typeof c.caller!=="string"||!Number.isSafeInteger(c.epoch)||c.epoch<0||!Number.isSafeInteger(c.lineage)||c.lineage<0)throw new Error("RUAM_BPRF_SCALAR_CONTEXT_ABI");',
		`const n=${mixName}(${hashName}(c.caller,${selectionSalt >>> 0})^Math.imul(c.epoch+1,2654435769)^Math.imul(c.lineage+1,2246822507))%${realizationNames.length};`
	);
	for (let index = 0; index < realizationNames.length - 1; index++) {
		lines.push(`if(n===${index})return ${realizationNames[index]}(a);`);
	}
	lines.push(
		`return ${realizationNames[realizationNames.length - 1]}(a);`,
		"}"
	);
	return lines.join("\n");
}

function groupFragmentDestination(
	fragment: BprfFragment,
	transition: BprfTransition,
	destination: number
): FragmentDestination {
	const pieces = fragment.pieces.filter(
		(piece) =>
			piece.phase === transition.phase &&
			piece.destination === destination
	);
	if (pieces.length === 0) {
		throw new Error("RUAM_BPRF_SCALAR_MISSING_FRAGMENT_DESTINATION");
	}
	return { fragment, pieces };
}

function destinationBasis(
	realization: BprfRealization,
	transition: BprfTransition,
	destination: number
): BprfWireBasis {
	for (const fragment of realization.fragments) {
		for (const piece of fragment.pieces) {
			if (
				piece.phase === transition.phase &&
				piece.destination === destination
			) {
				return piece.destinationBasis;
			}
		}
	}
	throw new Error("RUAM_BPRF_SCALAR_MISSING_DESTINATION_BASIS");
}

function validateAndFreezeDomains(
	artifact: BprfArtifact,
	inputDomains: readonly BprfScalarInputDomain[]
): readonly BprfScalarInputDomain[] {
	const expectedArity = artifact.realizations[0]!.inputPorts.length;
	if (inputDomains.length !== expectedArity) {
		throw new Error("RUAM_BPRF_SCALAR_INPUT_DOMAIN_ARITY_MISMATCH");
	}
	return Object.freeze(
		inputDomains.map((domain, inputIndex) => {
			if (domain.type === "boolean") {
				return Object.freeze({ type: "boolean" });
			}
			if (
				domain.type !== "number" ||
				!Number.isSafeInteger(domain.min) ||
				!Number.isSafeInteger(domain.max) ||
				Object.is(domain.min, -0) ||
				Object.is(domain.max, -0) ||
				domain.min > domain.max
			) {
				throw new Error(
					`RUAM_BPRF_SCALAR_INVALID_INPUT_DOMAIN: ${inputIndex}`
				);
			}
			return Object.freeze({
				type: "number",
				min: domain.min,
				max: domain.max,
			});
		})
	);
}

function validateCrossRealizationAbi(
	artifact: BprfArtifact,
	domains: readonly BprfScalarInputDomain[]
): number {
	const outputArity = artifact.realizations[0]!.outputPorts.length;
	const outputTypes = artifact.realizations[0]!.outputPorts.map(
		(port) => port.typeCode
	);
	for (const realization of artifact.realizations) {
		if (
			realization.inputPorts.length !== domains.length ||
			realization.outputPorts.length !== outputArity
		) {
			throw new Error("RUAM_BPRF_SCALAR_REALIZATION_ABI_MISMATCH");
		}
		for (let inputIndex = 0; inputIndex < domains.length; inputIndex++) {
			const expectedType =
				domains[inputIndex]!.type === "number" ? 0 : 1;
			if (realization.inputPorts[inputIndex]!.typeCode !== expectedType) {
				throw new Error(
					`RUAM_BPRF_SCALAR_INPUT_DOMAIN_TYPE_MISMATCH: ${inputIndex}`
				);
			}
		}
		for (let outputIndex = 0; outputIndex < outputArity; outputIndex++) {
			if (
				realization.outputPorts[outputIndex]!.typeCode !==
				outputTypes[outputIndex]
			) {
				throw new Error(
					"RUAM_BPRF_SCALAR_REALIZATION_ABI_MISMATCH"
				);
			}
		}
	}
	return outputArity;
}

class ExactDyadicProof {
	operationCount = 0;
	maxNumeratorMagnitude = 0n;

	zero(): DyadicRange {
		return { exponent: 0, numeratorMagnitude: 0n };
	}

	integerRange(magnitude: bigint, label: string): DyadicRange {
		return this.assertExact(
			{ exponent: 0, numeratorMagnitude: magnitude },
			label
		);
	}

	constant(value: number, label: string): DyadicRange {
		if (!Number.isFinite(value)) {
			throw new Error(
				`RUAM_BPRF_SCALAR_ARITHMETIC_NOT_EXACT: ${label}:non-finite`
			);
		}
		return this.assertExact(exactDyadic(value), label);
	}

	add(left: DyadicRange, right: DyadicRange, label: string): DyadicRange {
		this.operationCount++;
		const exponent = Math.min(left.exponent, right.exponent);
		const leftShift = BigInt(left.exponent - exponent);
		const rightShift = BigInt(right.exponent - exponent);
		return this.assertExact(
			{
				exponent,
				numeratorMagnitude:
					(left.numeratorMagnitude << leftShift) +
					(right.numeratorMagnitude << rightShift),
			},
			label
		);
	}

	multiply(
		left: DyadicRange,
		right: DyadicRange,
		label: string
	): DyadicRange {
		this.operationCount++;
		return this.assertExact(
			{
				exponent: left.exponent + right.exponent,
				numeratorMagnitude:
					left.numeratorMagnitude * right.numeratorMagnitude,
			},
			label
		);
	}

	proveAffineRoundTrip(
		coordinate: DyadicRange,
		basis: BprfWireBasis,
		label: string
	): void {
		const scale = this.constant(basis.scale, `${label}:scale`);
		const bias = this.constant(basis.bias, `${label}:bias`);
		const scaled = this.multiply(coordinate, scale, `${label}:encode-scale`);
		this.add(scaled, bias, `${label}:encode-bias`);
		// The exact encoded value, exact subtraction result, and original exact
		// coordinate make the subsequent correctly-rounded division exact.
	}

	private assertExact(range: DyadicRange, label: string): DyadicRange {
		if (
			range.numeratorMagnitude < 0n ||
			range.numeratorMagnitude > MAX_EXACT_DYADIC_NUMERATOR ||
			range.exponent < -1074 ||
			(range.numeratorMagnitude !== 0n &&
				bitLength(range.numeratorMagnitude) - 1 + range.exponent >
					1023)
		) {
			throw new Error(
				`RUAM_BPRF_SCALAR_ARITHMETIC_NOT_EXACT: ${label}`
			);
		}
		if (range.numeratorMagnitude > this.maxNumeratorMagnitude) {
			this.maxNumeratorMagnitude = range.numeratorMagnitude;
		}
		return range;
	}
}

class OpaqueIdentifierAllocator {
	private readonly byKey = new Map<string, string>();
	private readonly used = new Set<string>();

	constructor(
		private readonly artifactId: string,
		private readonly selectionSalt: number
	) {}

	name(key: string): string {
		const existing = this.byKey.get(key);
		if (existing) return existing;
		const first = hashText(
			`${this.artifactId}\u0000${key}`,
			this.selectionSalt
		);
		const second = mix32(
			first ^ hashText(key, this.selectionSalt ^ 0x9e3779b9)
		);
		const base = `_${first.toString(36)}${second.toString(36)}`;
		let candidate = base;
		let collision = 0;
		while (this.used.has(candidate)) {
			collision++;
			candidate = `${base}_${collision.toString(36)}`;
		}
		this.byKey.set(key, candidate);
		this.used.add(candidate);
		return candidate;
	}
}

function exactDyadic(value: number): DyadicRange {
	if (value === 0) return { exponent: 0, numeratorMagnitude: 0n };
	const buffer = new ArrayBuffer(8);
	const view = new DataView(buffer);
	view.setFloat64(0, Math.abs(value), false);
	const high = view.getUint32(0, false);
	const low = view.getUint32(4, false);
	const exponentBits = (high >>> 20) & 0x7ff;
	const fraction =
		(BigInt(high & 0x000fffff) << 32n) | BigInt(low);
	let numerator =
		exponentBits === 0 ? fraction : (1n << 52n) | fraction;
	let exponent =
		exponentBits === 0 ? -1074 : exponentBits - 1023 - 52;
	while ((numerator & 1n) === 0n) {
		numerator >>= 1n;
		exponent++;
	}
	return { exponent, numeratorMagnitude: numerator };
}

function maxAbsInteger(min: number, max: number): bigint {
	const minMagnitude =
		min < 0 ? -BigInt(min) : BigInt(min);
	const maxMagnitude =
		max < 0 ? -BigInt(max) : BigInt(max);
	return minMagnitude > maxMagnitude ? minMagnitude : maxMagnitude;
}

function bitLength(value: bigint): number {
	return value === 0n ? 0 : value.toString(2).length;
}

function fragmentDestinationKey(
	fragmentId: string,
	destination: number
): string {
	return `${fragmentId}\u0000${destination}`;
}

function numberSource(value: number): string {
	if (!Number.isFinite(value)) {
		throw new Error("RUAM_BPRF_SCALAR_NON_FINITE_NUMBER");
	}
	return Object.is(value, -0) ? "-0" : String(value);
}

/** Browser-safe UTF-8 byte count with TextEncoder-compatible surrogate repair. */
function utf8ByteLength(value: string): number {
	let bytes = 0;
	for (let index = 0; index < value.length; index++) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit <= 0x7f) {
			bytes++;
		} else if (codeUnit <= 0x7ff) {
			bytes += 2;
		} else if (
			codeUnit >= 0xd800 &&
			codeUnit <= 0xdbff &&
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

/** Type-only documentation of the emitted narrow ABI. */
export type BprfScalarEntry = (
	inputs: readonly PureScalar[],
	context: BprfCallerContext
) => PureScalar[];
