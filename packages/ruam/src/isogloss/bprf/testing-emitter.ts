/**
 * NON-PRODUCT SPECIALIZED SOURCE-EMISSION SPIKE.
 *
 * This owner-side utility lowers a validated pure BPRF artifact to dedicated
 * JavaScript codelets. Generated code contains no artifact walker, piece
 * dispatcher, or generic regional evaluator. It exists only to measure whether
 * specialization removes the reference evaluator's universal hook surface.
 *
 * @module isogloss/bprf/testing-emitter
 */

import type {
	BprfArtifact,
	BprfFragment,
	BprfPiece,
	BprfRealization,
	BprfTransition,
} from "./types.js";
import { validateBprfArtifact } from "./validate.js";

export interface BprfTestingEmissionOptions {
	/** Add owner-only opaque fabric events. Never enable in ordinary output. */
	ownerTracing?: boolean;
}

export interface BprfTestingEmission {
	source: string;
	entryName: string;
	byteLength: number;
	realizationCount: number;
	transitionCount: number;
	codeletCount: number;
	ownerTracing: boolean;
}

/**
 * Emit a standalone function declaration.
 *
 * Narrow ABI: `entry(inputs, { caller, epoch, lineage }, ownerTrace?)`.
 * Ordinary emission omits all tracing code and ignores a third argument.
 */
export function emitBprfTestingSource(
	artifact: BprfArtifact,
	options: BprfTestingEmissionOptions = {}
): BprfTestingEmission {
	validateBprfArtifact(artifact);
	const ownerTracing = options.ownerTracing === true;
	const entryName = "__ruamBprfSpike";
	const sourceParts: string[] = ['"use strict";'];
	let codeletCount = 0;
	let transitionCount = 0;

	for (let realizationIndex = 0; realizationIndex < artifact.realizations.length; realizationIndex++) {
		const realization = artifact.realizations[realizationIndex]!;
		const emitted = emitRealization(
			realization,
			realizationIndex,
			ownerTracing
		);
		sourceParts.push(emitted.source);
		codeletCount += emitted.codeletCount;
		transitionCount += realization.transitions.length;
	}

	sourceParts.push(emitContextMixers());
	sourceParts.push(
		emitEntry(
			entryName,
			artifact.selectionSalt,
			artifact.realizations.length,
			ownerTracing
		)
	);
	const source = sourceParts.join("\n");
	return Object.freeze({
		source,
		entryName,
		byteLength: Buffer.byteLength(source, "utf8"),
		realizationCount: artifact.realizations.length,
		transitionCount,
		codeletCount,
		ownerTracing,
	});
}

function emitRealization(
	realization: BprfRealization,
	realizationIndex: number,
	ownerTracing: boolean
): { source: string; codeletCount: number } {
	const sourceParts: string[] = [];
	let codeletCount = 0;

	for (const transition of realization.transitions) {
		for (let fragmentIndex = 0; fragmentIndex < realization.fragments.length; fragmentIndex++) {
			const fragment = realization.fragments[fragmentIndex]!;
			sourceParts.push(
				emitCodelet(
					realization,
					realizationIndex,
					transition,
					fragment,
					fragmentIndex,
					ownerTracing
				)
			);
			codeletCount++;
		}
	}

	const traceParameter = ownerTracing ? ",z" : "";
	sourceParts.push(
		`function v${realizationIndex}(a${traceParameter}){`,
		emitInputAbi(realization),
		`const q=new Array(${realization.frameSize});`,
		...realization.inputPorts.map((port, inputIndex) => {
			const coordinate =
				port.typeCode === 0
					? `a[${inputIndex}]`
					: realization.familyCode === 0
						? `(a[${inputIndex}]?1:0)`
						: `(a[${inputIndex}]?1:-1)`;
			return `q[${port.slot}]=(${coordinate})*(${numberSource(port.basis.scale)})+(${numberSource(port.basis.bias)});`;
		}),
		...realization.transitions.flatMap((transition) =>
			emitTransitionCalls(
				realization,
				realizationIndex,
				transition,
				ownerTracing
			)
		),
		`return [${realization.outputPorts
			.map((port) => {
				const decoded = `((q[${port.slot}]-(${numberSource(port.basis.bias)}))/(${numberSource(port.basis.scale)}))`;
				if (port.typeCode === 0) return decoded;
				return realization.familyCode === 0
					? `(${decoded}>0.5)`
					: `(${decoded}>0)`;
			})
			.join(",")}];`,
		"}"
	);

	return { source: sourceParts.join("\n"), codeletCount };
}

function emitCodelet(
	realization: BprfRealization,
	realizationIndex: number,
	transition: BprfTransition,
	fragment: BprfFragment,
	fragmentIndex: number,
	ownerTracing: boolean
): string {
	const pieces = fragment.pieces.filter(
		(piece) => piece.phase === transition.phase
	);
	const byDestination = new Map<number, BprfPiece[]>();
	for (const piece of pieces) {
		const group = byDestination.get(piece.destination) ?? [];
		group.push(piece);
		byDestination.set(piece.destination, group);
	}
	const values = transition.writes.map((destination) => {
		const destinationPieces = byDestination.get(destination);
		if (!destinationPieces || destinationPieces.length === 0) {
			throw new Error("RUAM_BPRF_EMITTER_MISSING_FRAGMENT_DESTINATION");
		}
		return destinationPieces.map(pieceExpression).join("+");
	});
	const name = codeletName(
		realizationIndex,
		transition.phase,
		fragmentIndex
	);
	const traceParameter = ownerTracing ? ",z" : "";
	const traceStatement = ownerTracing
		? `if(z)z({r:${stringSource(realization.id)},t:${stringSource(transition.id)},f:${stringSource(fragment.id)},p:${transition.phase}});`
		: "";
	return `function ${name}(q${traceParameter}){const x=[${values.join(",")}];${traceStatement}return x;}`;
}

function emitTransitionCalls(
	realization: BprfRealization,
	realizationIndex: number,
	transition: BprfTransition,
	ownerTracing: boolean
): string[] {
	const traceArgument = ownerTracing ? ",z" : "";
	const callNames = realization.fragments.map(
		(_, fragmentIndex) => `p${transition.phase}_${fragmentIndex}`
	);
	const lines = realization.fragments.map((_, fragmentIndex) => {
		const codelet = codeletName(
			realizationIndex,
			transition.phase,
			fragmentIndex
		);
		return `const ${callNames[fragmentIndex]}=${codelet}(q${traceArgument});`;
	});
	for (let outputIndex = 0; outputIndex < transition.writes.length; outputIndex++) {
		const destination = transition.writes[outputIndex]!;
		const pieces = realization.fragments.flatMap((fragment) =>
			fragment.pieces.filter(
				(piece) =>
					piece.phase === transition.phase &&
					piece.destination === destination
			)
		);
		const basis = pieces[0]?.destinationBasis;
		if (!basis) {
			throw new Error("RUAM_BPRF_EMITTER_MISSING_DESTINATION_BASIS");
		}
		const total = callNames
			.map((callName) => `${callName}[${outputIndex}]`)
			.join("+");
		lines.push(
			`q[${destination}]=(${total})*(${numberSource(basis.scale)})+(${numberSource(basis.bias)});`
		);
	}
	return lines;
}

function pieceExpression(piece: BprfPiece): string {
	const factors = piece.factors.map(
		(factor) =>
			`(((q[${factor.slot}]-(${numberSource(factor.basis.bias)}))/(${numberSource(factor.basis.scale)}))+(${numberSource(factor.offset)}))`
	);
	if (factors.length === 0) return `(${numberSource(piece.coefficient)})`;
	return `(${numberSource(piece.coefficient)}*${factors.join("*")})`;
}

function emitInputAbi(realization: BprfRealization): string {
	const checks = [
		`if(!Array.isArray(a)||a.length!==${realization.inputPorts.length})throw new Error("RUAM_BPRF_INPUT_ABI");`,
	];
	for (let index = 0; index < realization.inputPorts.length; index++) {
		const port = realization.inputPorts[index]!;
		checks.push(
			port.typeCode === 0
				? `if(typeof a[${index}]!=="number"||!Number.isFinite(a[${index}]))throw new Error("RUAM_BPRF_INPUT_ABI");`
				: `if(typeof a[${index}]!=="boolean")throw new Error("RUAM_BPRF_INPUT_ABI");`
		);
	}
	return checks.join("");
}

function emitContextMixers(): string {
	return [
		"function mx(x){x>>>=0;x=Math.imul(x^(x>>>16),2146121005);x=Math.imul(x^(x>>>15),2221713035);return(x^(x>>>16))>>>0;}",
		"function hx(s,x){for(let j=0;j<s.length;j++){x^=s.charCodeAt(j);x=Math.imul(x,16777619)>>>0;}return mx(x);}",
	].join("\n");
}

function emitEntry(
	entryName: string,
	selectionSalt: number,
	realizationCount: number,
	ownerTracing: boolean
): string {
	const traceArgument = ownerTracing ? ",z" : "";
	const lines = [
		`function ${entryName}(a,c${ownerTracing ? ",z" : ""}){`,
		'if(!c||typeof c.caller!=="string"||!Number.isSafeInteger(c.epoch)||c.epoch<0||!Number.isSafeInteger(c.lineage)||c.lineage<0)throw new Error("RUAM_BPRF_CONTEXT_ABI");',
		`const n=mx(hx(c.caller,${selectionSalt >>> 0})^Math.imul(c.epoch+1,2654435769)^Math.imul(c.lineage+1,2246822507))%${realizationCount};`,
	];
	for (let index = 0; index < realizationCount - 1; index++) {
		lines.push(`if(n===${index})return v${index}(a${traceArgument});`);
	}
	lines.push(
		`return v${realizationCount - 1}(a${traceArgument});`,
		"}"
	);
	return lines.join("\n");
}

function codeletName(
	realizationIndex: number,
	phase: number,
	fragmentIndex: number
): string {
	return `x${realizationIndex}_${phase}_${fragmentIndex}`;
}

function numberSource(value: number): string {
	if (!Number.isFinite(value)) {
		throw new Error("RUAM_BPRF_EMITTER_NON_FINITE_NUMBER");
	}
	return Object.is(value, -0) ? "-0" : String(value);
}

function stringSource(value: string): string {
	return JSON.stringify(value);
}
