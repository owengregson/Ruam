import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { obfuscateCodeWithReport } from "../../src/transform.js";
import { IncompleteCompilationError } from "../../src/compilation-report.js";

function quiet<T>(operation: () => T): T {
	const warn = console.warn;
	console.warn = () => {};
	try { return operation(); } finally { console.warn = warn; }
}

describe("selected-root compilation report", () => {
	for (const vmShielding of [false, true]) {
		test(`records selected roots and nested units with shielding=${vmShielding}`, () => {
			const { code, report } = obfuscateCodeWithReport("function make(x) { return function(y) { return x + y; }; } make(20)(22);", { vmShielding });
			expect(runInNewContext(code)).toBe(42);
			expect(report.selectedRoots).toBe(1);
			expect(report.outcomes).toHaveLength(1);
			expect(report.outcomes[0]).toMatchObject({ name: "make", status: "compiled", bytecodeUnits: 2 });
			expect(report.completeSelection).toBe(true);
			expect(report.wholeSourceProtection).toBe(false);
			expect(report.protectionQualified).toBe(false);
		});

		test(`fails closed when a selected root falls back with shielding=${vmShielding}`, () => quiet(() => {
			const source = "function good() { return 42; } function unsupported(o) { return o.x ||= 1; } good();";
			const { code, report } = obfuscateCodeWithReport(source, { vmShielding }, { requireCompleteSelection: false });
			expect(runInNewContext(code)).toBe(42);
			expect(report.selectedRoots).toBe(2);
			expect(report.outcomes.filter(item => item.status === "compiled")).toHaveLength(1);
			expect(report.outcomes.filter(item => item.status === "native-fallback")).toHaveLength(1);
			expect(report.outcomes.find(item => item.status === "native-fallback")!.message).toContain("Logical assignment");
			expect(report.completeSelection).toBe(false);
			try {
				obfuscateCodeWithReport(source, { vmShielding });
				throw new Error("Expected incomplete compilation");
			} catch (error) {
				expect(error).toBeInstanceOf(IncompleteCompilationError);
				expect((error as IncompleteCompilationError).report.completeSelection).toBe(false);
			}
		}));
	}

	test("known generator runtime stubs cannot qualify an emitted root or its descendants", () => {
		for (const source of [
			"function* selected() { yield 1; yield 2; }",
			"function outer() { return function* child() { yield 1; }; }",
		]) {
			const { report } = obfuscateCodeWithReport(source, {}, { requireCompleteSelection: false });
			expect(report.outcomes[0]!.status).toBe("unsupported-runtime");
			expect(report.outcomes[0]!.runtimeLimitations).toEqual(["generator-resumption"]);
			expect(report.completeSelection).toBe(false);
			expect(() => obfuscateCodeWithReport(source)).toThrow(IncompleteCompilationError);
		}
	});

	test("a build with no selected functions is not complete selection", () => {
		expect(() => obfuscateCodeWithReport("globalThis.value = 42;")).toThrow(IncompleteCompilationError);
		const { report } = obfuscateCodeWithReport("function plain() { return 1; }", { targetMode: "comment" }, { requireCompleteSelection: false });
		expect(report.selectedRoots).toBe(0);
		expect(report.completeSelection).toBe(false);
	});
});
