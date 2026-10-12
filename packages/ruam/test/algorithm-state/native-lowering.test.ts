import { describe, expect, test } from "bun:test";
import { lowerNativeSeedControl, recoverNativeSeedControl, runNativeLoweringControl } from "../../src/algorithm-state/qualification/native-lowering.js";

describe("native lowering negative control", () => {
  test("recovers executable semantics and a partial edit from the authored function's lowered artifact", async () => {
    const report = await runNativeLoweringControl();
    expect(report.correctness.status).toBe("pass");
    expect(report.importedModuleOracle.original.status).toBe("pass");
    expect(report.importedModuleOracle.lowered.status).toBe("pass");
    expect(report.artifact.code).toMatch(/^"use strict"/);
    expect(report.recovery.code).toMatch(/^"use strict"/);
    expect(report.recovery.validation.status).toBe("pass");
    expect(report.partialEdit.validation.status).toBe("pass");
    expect(report.correctness.cases).toBeGreaterThan(350);
    expect(report.artifact.sha256).not.toBe(report.recovery.sha256);
    expect(report.recovery.code).not.toContain(report.naming.selectorName);
    expect(report.recovery.code).not.toContain("switch");
    expect(report.recovery.visitedBlocks).toBe(4);
    expect(report.controlScope.runtimeInputsFiltered).toBe(false);
    expect(report.controlScope.sourceReflection).toBe("not-preserved");
    expect(report.controlScope.fullSemanticCompatibility).toBe(false);
    expect(report.knownCompatibilityFailures).toHaveLength(1);
    expect(report.knownCompatibilityFailures[0]!.validation.status).toBe("mismatch");
    expect(report.knownCompatibilityFailures[0]!.recoveryAgainstLowered.status).toBe("mismatch");
    expect(report.knownCompatibilityFailures[0]!.observations.importedOriginal.value).toBe(3305896031);
    expect(report.knownCompatibilityFailures[0]!.observations.lowered.value).toBe(3322673650);
    expect(report.naming.system).toBe("NameRegistry");
    expect(report.naming.publicSeed).toBe(0);
    expect(report.naming.dependencies).toHaveLength(3);
    expect(report.naming.dependenciesUnchangedAtEnd).toBe(true);
    expect(report.controlScope.controlShapeRecognized).toBe(true);
    expect(report.negativeControls.uneditedAgainstEditOracle.status).toBe("mismatch");
    expect(report.negativeControls.wrongRecovery.validation.status).toBe("mismatch");
    expect(report.harness.sourceAndHarnessUnchangedAtEnd).toBe(true);
    expect(report.releaseApproved).toBe(false);
    expect(report.decision).toBe("reject-continuation-flattening-alone-for-this-control");
  // This checks hundreds of observations across several implementations. Keep
  // the individual VM execution deadlines; allow time for the complete batch.
  }, 30_000);

  test("refuses source drift instead of applying the control to a new algorithm", () => {
    expect(() => lowerNativeSeedControl("export function deriveSeed(a: number,b: string): number { return a; }", "")).toThrow("authored function changed");
  });

  test("refuses dynamic or malformed continuation graphs", async () => {
    const report = await runNativeLoweringControl();
    expect(() => recoverNativeSeedControl(report.artifact.code.replace(`${report.naming.selectorName} = 41`, `${report.naming.selectorName} = Math.random()`))).toThrow("dynamic edge");
  }, 30_000);
});
