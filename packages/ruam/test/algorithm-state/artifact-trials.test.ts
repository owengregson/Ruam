import { describe, expect, it } from "bun:test";
import { encodeArtifactObservation, runArtifactAttackTrial } from "../../src/algorithm-state/qualification/artifact-trials.js";

describe("generic artifact attack trials", () => {
	it("keeps numeric distinctions, sparse entries and graph identity", () => {
		expect(encodeArtifactObservation(-0)).not.toEqual(encodeArtifactObservation(0));
		expect(encodeArtifactObservation(NaN)).not.toEqual(encodeArtifactObservation(null));
		expect(encodeArtifactObservation([undefined])).not.toEqual(encodeArtifactObservation(new Array(1)));
		const same = {};
		expect(encodeArtifactObservation([same, same])).not.toEqual(encodeArtifactObservation([{}, {}]));
		expect(() => encodeArtifactObservation({ get x() { return 1; } })).toThrow("accessors");
		expect(() => encodeArtifactObservation(Object.create(Object.assign(Object.create(null), { value: 1 })))).toThrow("custom prototypes");
		expect(() => encodeArtifactObservation(new (class extends Array {})())).toThrow("custom prototypes");
		expect(() => encodeArtifactObservation(Object.setPrototypeOf([], null))).toThrow("custom prototypes");
		expect(encodeArtifactObservation(Object.assign(Object.create(null), { value: 1 }))).not.toEqual(encodeArtifactObservation({ value: 1 }));
	});
	it("cannot accept a candidate that depends on baseline mutations to shared host objects", () => {
		const report = runArtifactAttackTrial({ baselineCode: "performance.__ruamShared = 41; globalThis.answer = () => 42;", candidateCode: "globalThis.answer = () => performance.__ruamShared + 1;", observationCode: "answer()", purpose: "compatibility", authoringVisibility: "source-visible", candidateRetainsOriginalArtifact: false });
		expect(report.status).toBe("mismatch");
		expect(report.candidate?.status === "observed" && report.candidate.value).toEqual({ type: "number", value: "NaN" });
	});
	it("uses each worker realm's original prototypes and rejects unsupported observation chains", () => {
		const common = { baselineCode: "globalThis.value = 1;", candidateCode: "globalThis.value = 1;", purpose: "compatibility" as const, authoringVisibility: "source-visible" as const, candidateRetainsOriginalArtifact: false };
		expect(runArtifactAttackTrial({ ...common, observationCode: "({ array:[value], record:{value}, bare:Object.assign(Object.create(null),{value}) })" }).status).toBe("match");
		for (const observationCode of ["Object.create(Object.assign(Object.create(null),{value}))", "new (class extends Array {})()", "Object.setPrototypeOf([],null)"]) {
			const report = runArtifactAttackTrial({ ...common, observationCode });
			expect(report.status).toBe("error");
			expect(report.baseline?.status === "error" && report.baseline.error).toContain("custom prototypes");
		}
	});
	it("compares independent async observations and catches a wrong candidate", () => {
		const common = { baselineCode: "globalThis.counter = {n:0, add(){return ++this.n;}};", observationCode: "(async()=>{const first=counter.add(); await Promise.resolve(); return [first,counter.add()];})()",
			purpose: "compatibility" as const, authoringVisibility: "source-visible" as const, candidateRetainsOriginalArtifact: false };
		const matching = runArtifactAttackTrial({ ...common, candidateCode: "globalThis.counter = {n:0, add(){this.n+=1;return this.n;}};" });
		expect(matching.status).toBe("match");
		expect(matching.standaloneRecoveryEstablished).toBe(false);
		expect(matching.actualAiTrial).toBe(false);
		const wrong = runArtifactAttackTrial({ ...common, candidateCode: "globalThis.counter = {n:0, add(){return this.n++;}};" });
		expect(wrong.status).toBe("mismatch");
	});
	it("scores an artifact-preserving patch without granting recovery credit", () => {
		const report = runArtifactAttackTrial({ baselineCode: "globalThis.answer=()=>7;", candidateCode: "globalThis.answer=()=>6;", patchCode: "const old=answer; globalThis.answer=()=>old()+1;", observationCode: "[answer(),answer()]", purpose: "partial-edit", authoringVisibility: "source-visible", candidateRetainsOriginalArtifact: true });
		expect(report.status).toBe("match");
		expect(report.patchBytes).toBeGreaterThan(0);
		expect(report.candidateRetainsOriginalArtifact).toBe(true);
		expect(report.standaloneRecoveryEstablished).toBe(false);
	});
	it("bounds asynchronous noncompletion with the worker deadline", () => {
		const report = runArtifactAttackTrial({ baselineCode: "globalThis.value=1;", candidateCode: "globalThis.value=1;", observationCode: "new Promise(()=>setInterval(()=>{},100))", purpose: "compatibility", authoringVisibility: "source-visible", candidateRetainsOriginalArtifact: false, timeoutMs: 250 });
		expect(report.status).toBe("timeout");
	});
	it("applies one aggregate deadline to both separately isolated workers", () => {
		const report = runArtifactAttackTrial({ baselineCode: "globalThis.value=1;", candidateCode: "globalThis.value=1;", observationCode: "new Promise(resolve=>setTimeout(()=>resolve(value),200))", purpose: "compatibility", authoringVisibility: "source-visible", candidateRetainsOriginalArtifact: false, timeoutMs: 350 });
		expect(report.status).toBe("timeout");
	});
});
