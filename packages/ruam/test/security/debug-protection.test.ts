import { obfuscateCode } from "../../src/transform.js";
import type { VmObfuscationOptions } from "../../src/types.js";

const dbgOpts: VmObfuscationOptions = { debugProtection: true };

describe("Debug Protection", () => {
  describe("compilation", () => {
    it("compiles with debugProtection enabled", () => {
      const output = obfuscateCode(
        `function add(a, b) { return a + b; } add(2, 3);`,
        dbgOpts,
      );
      expect(output).toBeTruthy();
      expect(output.length).toBeGreaterThan(200);
    });

    it("compiles with all options combined", () => {
      const output = obfuscateCode(
        `function calc(a, b) { return a * b + a - b; } calc(7, 3);`,
        {
          debugProtection: true,
          rollingCipher: true,
          integrityBinding: true,
          vmShielding: true,
          stackEncoding: true,
          deadCodeInjection: true,
          decoyOpcodes: true,
        },
      );
      expect(output).toBeTruthy();
      expect(output.length).toBeGreaterThan(500);
    });

    it("max preset compiles with debug protection", () => {
      const output = obfuscateCode(
        `function f() { return 42; } f();`,
        { preset: "max" },
      );
      expect(output).toBeTruthy();
      expect(output).toContain("_ru4m");
    });
  });

  describe("detection layers present in output", () => {
    const output = obfuscateCode(
      `function f() { return 1; } f();`,
      dbgOpts,
    );

    it("contains polymorphic debugger invocations", () => {
      // Should have multiple debugger invocation methods
      expect(output).toContain("debugger");
      // Dynamic construction via Function constructor or eval
      expect(output).toMatch(/Function|eval/);
    });

    it("contains timing measurement code", () => {
      // Should reference performance.now or Date.now
      expect(output).toMatch(/performance|Date\.now/);
    });

    it("contains function integrity self-check", () => {
      // FNV-1a hash constants used for self-verification
      expect(output).toContain("0x811C9DC5");
      expect(output).toContain("0x01000193");
    });

    it("contains console API integrity check", () => {
      // Checks for native code in toString
      expect(output).toContain("[native code]");
    });

    it("contains setTimeout-based scheduling (not setInterval)", () => {
      // Uses recursive setTimeout with jitter, not predictable setInterval
      expect(output).toContain("setTimeout");
    });

    it("contains escalating response mechanism", () => {
      // Should reference bytecode table for silent corruption
      // The bytecode table variable name is randomized, but the response
      // should access Object.keys on something
      expect(output).toContain("Object.keys");
    });

    it("contains timer unref for Node.js compatibility", () => {
      // .unref() prevents timers from keeping the process alive
      expect(output).toContain(".unref");
    });
  });

  describe("error message obfuscation", () => {
    const output = obfuscateCode(
      `function f() { return 1; } f();`,
      dbgOpts,
    );

    it("does not contain revealing VM keywords", () => {
      // These words would reveal the presence of a VM interpreter
      expect(output).not.toContain("opcode");
      expect(output).not.toContain("instruction");
      expect(output).not.toContain("bytecode");
      expect(output).not.toContain("interpreter");
      expect(output).not.toContain("dispatch");
      expect(output).not.toContain("register");
    });

    it("recursion error mimics native V8 message", () => {
      // The error message should look like V8's native stack overflow
      // but without the literal word "stack" appearing in the source
      // (it's constructed via string concatenation at runtime)
      expect(output).toContain("Maximum call ");
      expect(output).toContain("tack size exceeded");
    });
  });

  describe("structural properties", () => {
    it("generates different protection code per build (randomized names)", () => {
      const out1 = obfuscateCode(
        `function f() { return 1; } f();`,
        dbgOpts,
      );
      const out2 = obfuscateCode(
        `function f() { return 1; } f();`,
        dbgOpts,
      );
      // Different builds should have different variable names (CSPRNG seed)
      // The overall structure is the same but names differ
      expect(out1).not.toEqual(out2);
    });

    it("debug protection is emitted once in shielded mode", () => {
      const output = obfuscateCode(
        `function a() { return 1; } function b() { return 2; } a() + b();`,
        { vmShielding: true, debugProtection: true },
      );
      // The IIFE should appear only once (shared infrastructure)
      const matches = output.match(/0x811C9DC5/g);
      // 4 occurrences: initial + verify, each using the FNV constant twice
      expect(matches).toBeTruthy();
      expect(matches!.length).toBe(4);
    });
  });
});
