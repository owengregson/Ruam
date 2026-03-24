import { describe, it, expect } from "bun:test";
import { obfuscateCode } from "../../src/transform.js";
import type { VmObfuscationOptions } from "../../src/types.js";

const dbgOpts: VmObfuscationOptions = { debugProtection: true };

describe("Debug Protection", () => {
	describe("compilation", () => {
		it("compiles with debugProtection enabled", () => {
			const output = obfuscateCode(
				`function add(a, b) { return a + b; } add(2, 3);`,
				dbgOpts
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
				}
			);
			expect(output).toBeTruthy();
			expect(output.length).toBeGreaterThan(500);
		});

		it("max preset compiles with debug protection", () => {
			const output = obfuscateCode(`function f() { return 42; } f();`, {
				preset: "max",
			});
			expect(output).toBeTruthy();
			// Watermark is steganographic — no visible _ru4m variable
			expect(output).not.toContain("_ru4m");
		});
	});

	describe("detection layers present in output", () => {
		const output = obfuscateCode(
			`function f() { return 1; } f();`,
			dbgOpts
		);

		it("contains no debugger statements (TrustedScript/CSP safe)", () => {
			// No debugger statements — fully TrustedScript/CSP compatible
			expect(output).not.toContain("debugger");
			// Prototype integrity checks use Function.prototype.toString
			expect(output).toContain("[native code]");
			expect(output).toContain("defineProperty");
		});

		it("does not use eval or Function constructor for debugger invocation", () => {
			// Debug protection must be CSP-safe (Chrome extensions block eval)
			// Extract the debug protection IIFE (contains FNV constant 2166136261)
			const fnvIdx = output.indexOf("2166136261");
			// Scan backward to find start of the IIFE
			let start = fnvIdx;
			while (
				start > 0 &&
				output.slice(start - 10, start) !== "(function "
			)
				start--;
			start = Math.max(0, start - 10);
			// Scan forward to find the closing })()
			let depth = 0;
			let end = start;
			for (let i = start; i < output.length; i++) {
				if (output[i] === "{") depth++;
				if (output[i] === "}") depth--;
				if (depth === 0 && i > start + 100) {
					end = i + 10;
					break;
				}
			}
			const dbgRegion = output.slice(start, end);
			expect(dbgRegion).not.toMatch(/\bnew Function\b/);
			expect(dbgRegion).not.toMatch(/\beval\s*\(/);
		});

		it("contains function integrity self-check", () => {
			// FNV-1a hash constants used for self-verification (decimal form)
			expect(output).toContain("2166136261"); // 0x811C9DC5
			expect(output).toContain("16777619"); // 0x01000193
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
			dbgOpts
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
				dbgOpts
			);
			const out2 = obfuscateCode(
				`function f() { return 1; } f();`,
				dbgOpts
			);
			// Different builds should have different variable names (CSPRNG seed)
			// The overall structure is the same but names differ
			expect(out1).not.toEqual(out2);
		});

		it("debug protection is emitted once in shielded mode", () => {
			const output = obfuscateCode(
				`function a() { return 1; } function b() { return 2; } a() + b();`,
				{ vmShielding: true, debugProtection: true }
			);
			// The FNV offset basis 2166136261 (0x811C9DC5) appears only in
			// debug protection (shared) — rolling cipher builders use constant
			// splitting so their FNV constants are hidden behind computed expressions.
			// Debug protection emits FNV in its self-verification checksums.
			const matches = output.match(/2166136261/g);
			expect(matches).toBeTruthy();
			expect(matches!.length).toBe(2);
		});
	});
});
