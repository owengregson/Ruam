/** Owner-only scoring. Candidates get no source, witnesses, or held-out input inventory. */
import { Script, createContext } from "node:vm";
import { createHash } from "node:crypto";
import type { AttackResult, BehavioralValidation, RecoveryCandidate } from "./types.js";

export const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
function scorable(value: unknown, seen = new Set<unknown>()): boolean {
	if (value === null || ["number", "string", "boolean", "undefined"].includes(typeof value)) return true;
	if (!Array.isArray(value) || seen.has(value)) return false;
	seen.add(value);
	return Array.from({ length: value.length }, (_, i) => i).every(i => Object.hasOwn(value, i) && scorable(value[i], seen));
}
export function sameValue(actual: unknown, expected: unknown): boolean {
	if (Object.is(actual, expected)) return true;
	if (Array.isArray(actual) && Array.isArray(expected)) return actual.length === expected.length && actual.every((v, i) => sameValue(v, expected[i]));
	return false;
}
/** Fresh realm per call; arrays encode ordered stateful histories inside a run. This is not a hostile-code sandbox. */
export function oracleFor(code: string, entry = "run"): (input: unknown) => unknown {
	if (!/^[A-Za-z_$][\w$]*$/.test(entry)) throw new Error("Invalid scoring entry");
	const script = new Script(`${code}\n;globalThis.__scoreOutput = ${entry}(globalThis.__scoreInput);`);
	return input => {
		const timers: ReturnType<typeof setTimeout>[] = [];
		const intervals: ReturnType<typeof setInterval>[] = [];
		const context = createContext({ __scoreInput: structuredClone(input), performance, Buffer,
			setTimeout: (fn: (...args: unknown[]) => void, delay: number, ...args: unknown[]) => { const id = setTimeout(fn, delay, ...args); timers.push(id); return id; }, clearTimeout,
			setInterval: (fn: (...args: unknown[]) => void, delay: number, ...args: unknown[]) => { const id = setInterval(fn, delay, ...args); intervals.push(id); return id; }, clearInterval });
		try { script.runInContext(context, { timeout: 250 }); return context.__scoreOutput; }
		finally { timers.forEach(clearTimeout); intervals.forEach(clearInterval); }
	};
}
export function validateCandidate(code: string, entry: string, inputs: readonly unknown[], expected: readonly unknown[]): BehavioralValidation {
	let cases = 0, mismatches = 0, firstFailure: string | undefined;
	if (!inputs.length || expected.length !== inputs.length) return { status: "error", cases, mismatches, firstFailure: "Nonempty inputs and exactly one expected value per input are required." };
	if (!expected.every(value => scorable(value))) return { status: "error", cases, mismatches, firstFailure: "Scorer supports only primitives and dense nonaliased arrays; object identity/effects require a different protocol." };
	try {
		const oracle = oracleFor(code, entry);
		for (let index = 0; index < inputs.length; index++) {
			cases++;
			const actual = oracle(inputs[index]);
			if (!scorable(actual) || !sameValue(actual, expected[index])) { mismatches++; firstFailure ??= `Held-out case ${index} differed (including signed zero/NaN) or returned an unsupported value.`; }
		}
		return { status: mismatches ? "mismatch" : "pass", cases, mismatches, firstFailure };
	} catch (error) { return { status: String(error).includes("timed out") ? "timeout" : "error", cases, mismatches, firstFailure: String(error) }; }
}
export function scoreRecovery(candidate: RecoveryCandidate, inputs: readonly unknown[], expected: readonly unknown[]): AttackResult {
	if (candidate.status !== "candidate" || !candidate.code || !candidate.entry) return { ...candidate, verifiedStandaloneRecovery: false };
	const validation = validateCandidate(candidate.code, candidate.entry, inputs, expected);
	return { ...candidate, validation, verifiedStandaloneRecovery: validation.status === "pass" && validation.cases >= 64 };
}
export function median(values: readonly number[]): number | null {
	if (!values.length) return null;
	const ordered = [...values].sort((a, b) => a - b), middle = Math.floor(ordered.length / 2);
	return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}
