/**
 * Public contracts for the executable canonical semantic-IR reference runtime.
 *
 * The reference runtime is intentionally representation independent. It
 * consumes compiler-owned canonical nodes directly and records their semantic
 * identities; it never accepts encoded instructions or physical opcodes.
 */

import type { SemanticEffect } from "../../compiler/semantic-signatures.js";

/** Stable identity of one canonical action executed by the runtime. */
export interface ExecutedCanonicalNode {
	sequence: number;
	unitId: string;
	nodeId: number;
	originId: number;
	op: string;
}

/** Outcome of an effect-bearing canonical action. */
export interface CanonicalEffectEvent extends ExecutedCanonicalNode {
	effect: SemanticEffect;
	outcome: "completed" | "threw";
}

/** Complete deterministic trace shared by nested canonical invocations. */
export interface CanonicalRuntimeTrace {
	executedNodes: ExecutedCanonicalNode[];
	effects: CanonicalEffectEvent[];
}

/** Completion produced by executing an entry semantic unit. */
export type CanonicalRuntimeCompletion =
	| { type: "return"; value: unknown }
	| { type: "throw"; value: unknown };

/** Result of one protected-root reference execution. */
export interface CanonicalRuntimeResult {
	completion: CanonicalRuntimeCompletion;
	trace: CanonicalRuntimeTrace;
}

/** Host capabilities made explicit at the canonical runtime boundary. */
export interface CanonicalRuntimeOptions {
	/** Global object used for unresolved lexical and explicit global access. */
	globalObject?: Record<PropertyKey, unknown>;
	/** Receiver supplied to the entry function. */
	thisValue?: unknown;
	/** `new.target` supplied to the entry function. */
	newTarget?: Function;
	/** Parent lexical environment captured by the entry function. */
	outerScope?: Record<PropertyKey, unknown> | null;
	/** Upper bound guarding malformed or non-terminating canonical graphs. */
	maxSteps?: number;
}

/** Error raised when a canonical operation has no synchronous reference rule. */
export class UnsupportedCanonicalRuntimeOperationError extends Error {
	readonly unitId: string;
	readonly nodeId: number;
	readonly op: string;

	constructor(unitId: string, nodeId: number, op: string) {
		super(
			`RUAM_REFERENCE_RUNTIME_UNSUPPORTED: ${unitId}:${nodeId}:${op}`
		);
		this.name = "UnsupportedCanonicalRuntimeOperationError";
		this.unitId = unitId;
		this.nodeId = nodeId;
		this.op = op;
	}
}
