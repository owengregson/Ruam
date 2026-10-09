import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import { compileRegionalGraph } from "../../src/regional/graph.js";
import { regionalSha256, inventoryRegionalFile, validateRegionalArtifactFiles, validateRegionalPackage } from "../../src/regional/validation.js";

describe("regional final-byte evidence", () => {
	it("matches Node SHA256 on UTF8, block edges and lone surrogates", () => {
		for (const value of ["","abc","日本語🙂","\ud800",...Array.from({length:130},(_,i)=>"x".repeat(i))]) {
			expect(regionalSha256(value)).toBe("sha256:"+createHash("sha256").update(new TextEncoder().encode(value)).digest("hex"));
		}
	});
	it("independently rejects syntax, undeclared graph edges and owner maps", () => {
		expect(()=>validateRegionalArtifactFiles({"a.js":"function{"},["a.js"])).toThrow("PARSE_FAILED");
		expect(()=>validateRegionalArtifactFiles({"a.mjs":'import "./b.mjs";'},["a.mjs"])).toThrow("IMPORT_MISSING");
		expect(()=>validateRegionalArtifactFiles({"a.js":"1;\n//# sourceMappingURL=owner.map"},["a.js"])).toThrow("OWNER_METADATA");
		const original=[inventoryRegionalFile("a.mjs",'import "./b.mjs";'),inventoryRegionalFile("b.mjs","export const n=1;")];
		expect(()=>validateRegionalArtifactFiles({"a.mjs":"export const n=2;","b.mjs":"export const n=1;"},["a.mjs"],200_000,original)).toThrow("INVENTORY_MISMATCH");
	});
	it("detects changed bytes, while recomputed structural evidence makes no semantic proof", () => {
		const build = compileRegionalGraph({entryPoints:["a.mjs"],files:{"a.mjs":"export const result = 1;"}});
		const changed = {...build,files:{"a.mjs":"export const result = 999;"}};
		expect(()=>validateRegionalPackage(changed)).toThrow("DIGEST_MISMATCH");
		const forged = {...changed,evidence:validateRegionalArtifactFiles(changed.files,changed.entryPoints,200_000,changed.sourceInventory)};
		const evidence = validateRegionalPackage(forged);
		expect(evidence.semanticEquivalence).toBe("not-proven");
		expect(evidence.resistance).toBe("not-measured");
		expect(evidence.packageSha256).not.toBe(build.evidence.packageSha256);
	});
});
