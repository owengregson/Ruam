/** Independent syntax/inventory checks. Hashes bind bytes; they prove no semantics. */
import { parse } from "@babel/parser";
import { VISITOR_KEYS } from "@babel/types";
import { RegionalPackageError, type RegionalFileInventory, type RegionalValidationEvidence, type RegionalPackageBuild } from "./contracts.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", {ignoreBOM:true});
const sourceCapabilities = new Set(["eval","Function","AsyncFunction","GeneratorFunction","AsyncGeneratorFunction","require","module","exports"]);
export const regionalUtf8Bytes = (text: string): number => encoder.encode(text).byteLength;

const SHA256_K = new Uint32Array([
	0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
	0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
	0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
	0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
	0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
	0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
	0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
	0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const rotate = (n: number, bits: number) => (n >>> bits) | (n << (32 - bits));

/** SHA-256 over TextEncoder UTF-8, usable in browsers without Node polyfills. */
export function regionalSha256(text: string): string {
	const input = encoder.encode(text);
	const padded = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
	padded.set(input); padded[input.length] = 0x80;
	const view = new DataView(padded.buffer);
	view.setUint32(padded.length - 8, Math.floor(input.length / 0x20000000));
	view.setUint32(padded.length - 4, (input.length * 8) >>> 0);
	const state = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
	const words = new Uint32Array(64);
	for (let offset = 0; offset < padded.length; offset += 64) {
		for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
		for (let i = 16; i < 64; i++) {
			const a = words[i - 15]!; const b = words[i - 2]!;
			words[i] = (words[i - 16]! + (rotate(a,7) ^ rotate(a,18) ^ (a >>> 3)) + words[i - 7]! + (rotate(b,17) ^ rotate(b,19) ^ (b >>> 10))) >>> 0;
		}
		let [a,b,c,d,e,f,g,h] = Array.from(state) as [number,number,number,number,number,number,number,number];
		for (let i = 0; i < 64; i++) {
			const t1 = (h + (rotate(e,6) ^ rotate(e,11) ^ rotate(e,25)) + ((e & f) ^ (~e & g)) + SHA256_K[i]! + words[i]!) >>> 0;
			const t2 = ((rotate(a,2) ^ rotate(a,13) ^ rotate(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
			h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
		}
		[a,b,c,d,e,f,g,h].forEach((value,i) => { state[i] = (state[i]! + value) >>> 0; });
	}
	return "sha256:" + Array.from(state, value => value.toString(16).padStart(8,"0")).join("");
}

/** Intentionally narrow portable paths: no URL decoding or filesystem guessing. */
export function assertRegionalPath(path: string): void {
	if (typeof path !== "string" || path.length > 240 || !/^[A-Za-z0-9_-][A-Za-z0-9._/-]*\.(?:js|mjs)$/.test(path)) {
		throw new RegionalPackageError("RUAM_REGIONAL_INVALID_PATH", String(path));
	}
	for (const part of path.split("/")) {
		if (!part || part === "." || part === ".." || part.endsWith(".") || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) {
			throw new RegionalPackageError("RUAM_REGIONAL_INVALID_PATH", path);
		}
	}
}

export function resolveRegionalSpecifier(from: string, specifier: string): string {
	if (typeof specifier !== "string" || !/^(?:\.\/|(?:\.\.\/)+)[A-Za-z0-9_-][A-Za-z0-9._/-]*\.(?:js|mjs)$/.test(specifier)) {
		throw new RegionalPackageError("RUAM_REGIONAL_IMPORT_REJECTED", `${from}: ${specifier}`);
	}
	const parts = from.split("/"); parts.pop();
	const request = specifier.split("/");
	if (request[0] === ".") request.shift();
	while (request[0] === "..") {
		if (!parts.length) throw new RegionalPackageError("RUAM_REGIONAL_IMPORT_ESCAPE", `${from}: ${specifier}`);
		parts.pop(); request.shift();
	}
	const target = [...parts, ...request].join("/");
	assertRegionalPath(target);
	return target;
}

export function snapshotRegionalFiles(files: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
	if (!files || typeof files !== "object" || Array.isArray(files) || ![null,Object.prototype].includes(Object.getPrototypeOf(files))) {
		throw new RegionalPackageError("RUAM_REGIONAL_INVALID_FILES", "expected a plain file record");
	}
	if (Object.getOwnPropertySymbols(files).length) throw new RegionalPackageError("RUAM_REGIONAL_INVALID_FILES", "symbol keys are not file paths");
	const result: Record<string,string> = Object.create(null);
	const folded = new Set<string>();
	for (const path of Object.getOwnPropertyNames(files).sort()) {
		assertRegionalPath(path);
		const descriptor = Object.getOwnPropertyDescriptor(files,path)!;
		if (!("value" in descriptor) || typeof descriptor.value !== "string") throw new RegionalPackageError("RUAM_REGIONAL_INVALID_FILES", `${path}: source must be a data string`);
		if (decoder.decode(encoder.encode(descriptor.value)) !== descriptor.value) throw new RegionalPackageError("RUAM_REGIONAL_INVALID_UTF8", `${path}: source contains an unpaired UTF-16 surrogate`);
		const key = path.toLowerCase();
		if (folded.has(key)) throw new RegionalPackageError("RUAM_REGIONAL_PATH_COLLISION", path);
		folded.add(key); result[path] = descriptor.value;
	}
	for (const path of folded) {
		const parts = path.split("/");
		for (let i = 1; i < parts.length; i++) if (folded.has(parts.slice(0,i).join("/"))) throw new RegionalPackageError("RUAM_REGIONAL_PATH_COLLISION", path);
	}
	if (!Object.keys(result).length) throw new RegionalPackageError("RUAM_REGIONAL_INVALID_FILES", "empty package");
	return Object.freeze(result);
}

export function inventoryRegionalFile(path: string, code: string, maxNodes = 200_000, sourceType?: "script" | "module"): RegionalFileInventory {
	assertRegionalPath(path);
	let ast: ReturnType<typeof parse>;
	try { ast = parse(code, { sourceType: sourceType ?? (path.endsWith(".mjs") ? "module" : "unambiguous"), createImportExpressions: true }); }
	catch { throw new RegionalPackageError("RUAM_REGIONAL_PARSE_FAILED", path); }
	if (ast.program.interpreter) throw new RegionalPackageError("RUAM_REGIONAL_ADMISSION_FAILED", `${path}: shebang is not admitted`);
	for (const comment of ast.comments ?? []) {
		if (/[@#]\s*source(?:Mapping)?URL\s*=/.test(comment.value)) throw new RegionalPackageError("RUAM_REGIONAL_OWNER_METADATA", `${path}: source location directive`);
	}
	const imports: string[] = [];
	const pending: any[] = [ast.program];
	let nodes = 0;
	while (pending.length) {
		const node = pending.pop()!;
		if (++nodes > maxNodes) throw new RegionalPackageError("RUAM_REGIONAL_RESOURCE_LIMIT", `${path}: AST nodes`);
		if (node.type === "ImportDeclaration" || ((node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && node.source)) {
			if (node.attributes?.length || node.assertions?.length || node.phase) throw new RegionalPackageError("RUAM_REGIONAL_IMPORT_REJECTED", `${path}: import attributes or phases`);
			imports.push(node.source.value);
		}
		if (node.type === "ImportExpression" || (node.type === "CallExpression" && node.callee?.type === "Import") || node.type === "AwaitExpression" || node.type === "YieldExpression" || node.type === "WithStatement" || node.async || node.generator) {
			throw new RegionalPackageError("RUAM_REGIONAL_ADMISSION_FAILED", `${path}: ${node.type}`);
		}
		if ((node.type === "CallExpression" || node.type === "NewExpression") && node.callee?.type === "Identifier" && ["eval","Function","AsyncFunction","GeneratorFunction","AsyncGeneratorFunction","require"].includes(node.callee.name)) {
			throw new RegionalPackageError("RUAM_REGIONAL_ADMISSION_FAILED", `${path}: ${node.callee.name}`);
		}
		if (node.type === "Identifier" && sourceCapabilities.has(node.name)) throw new RegionalPackageError("RUAM_REGIONAL_ADMISSION_FAILED", `${path}: source capability or CommonJS alias`);
		if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
			const property = node.property;
			const key = !node.computed && property.type === "Identifier" ? property.name : property.type === "StringLiteral" ? property.value :
				property.type === "BinaryExpression" && property.operator === "+" && property.left.type === "StringLiteral" && property.right.type === "StringLiteral" ? property.left.value + property.right.value : null;
			if (key !== null && (sourceCapabilities.has(key) || ["constructor","caller","callee"].includes(key))) throw new RegionalPackageError("RUAM_REGIONAL_ADMISSION_FAILED", `${path}: reflective source capability or CommonJS member`);
		}
		if (node.type === "VariableDeclaration" && ["using","await using"].includes(node.kind)) throw new RegionalPackageError("RUAM_REGIONAL_ADMISSION_FAILED", `${path}: resource management`);
		for (const key of [...(VISITOR_KEYS[node.type] ?? [])].reverse()) {
			const child = node[key];
			if (Array.isArray(child)) { for (let i = child.length - 1; i >= 0; i--) if (child[i]) pending.push(child[i]); }
			else if (child) pending.push(child);
		}
	}
	return Object.freeze({ path, sha256: regionalSha256(code), bytes: regionalUtf8Bytes(code), nodes, sourceType: ast.program.sourceType as "script" | "module", imports: Object.freeze(imports) });
}

/** Static import targets use the ESM grammar even without import/export syntax. */
export function qualifyRegionalModuleContexts(files: Readonly<Record<string,string>>, inventories: readonly RegionalFileInventory[], maxNodes: number): RegionalFileInventory[] {
	const targets = new Set(inventories.flatMap(file => file.imports.map(specifier => resolveRegionalSpecifier(file.path,specifier))));
	return inventories.map(file => targets.has(file.path) && file.sourceType !== "module" ? inventoryRegionalFile(file.path,files[file.path]!,maxNodes,"module") : file);
}

export function regionalDependencyOrder(inventories: readonly RegionalFileInventory[], entryPoints: readonly string[]): readonly string[] {
	const byPath = new Map(inventories.map(file => [file.path,file]));
	if (!Array.isArray(entryPoints) || !entryPoints.length) throw new RegionalPackageError("RUAM_REGIONAL_ENTRY_MISSING", "at least one entry is required");
	const entries = new Set<string>();
	for (const path of entryPoints) {
		assertRegionalPath(path);
		if (!byPath.has(path)) throw new RegionalPackageError("RUAM_REGIONAL_ENTRY_MISSING", path);
		if (entries.has(path)) throw new RegionalPackageError("RUAM_REGIONAL_DUPLICATE_ENTRY", path);
		entries.add(path);
	}
	const edges = new Map<string,string[]>();
	for (const file of inventories) {
		const targets = file.imports.map(specifier => resolveRegionalSpecifier(file.path,specifier));
		for (const target of targets) if (!byPath.has(target)) throw new RegionalPackageError("RUAM_REGIONAL_IMPORT_MISSING", `${file.path}: ${target}`);
		edges.set(file.path,targets);
	}
	const state = new Map<string,number>();
	const order: string[] = [];
	for (const root of [...entries,...byPath.keys()].sort()) {
		if (state.get(root) === 2) continue;
		const stack = [{ path: root, index: 0 }]; state.set(root,1);
		while (stack.length) {
			const top = stack[stack.length - 1]!;
			const target = edges.get(top.path)![top.index++];
			if (target === undefined) { state.set(top.path,2); order.push(top.path); stack.pop(); continue; }
			if (state.get(target) === 1) throw new RegionalPackageError("RUAM_REGIONAL_MODULE_CYCLE", `${top.path} -> ${target}`);
			if (state.get(target) !== 2) { state.set(target,1); stack.push({path:target,index:0}); }
		}
	}
	return Object.freeze(order);
}

export function validateRegionalArtifactFiles(files: Readonly<Record<string,string>>, entryPoints: readonly string[], maxNodes = 200_000, sourceInventory?: readonly RegionalFileInventory[]): RegionalValidationEvidence {
	const snapshot = snapshotRegionalFiles(files);
	const inventories = qualifyRegionalModuleContexts(snapshot,Object.keys(snapshot).map(path => inventoryRegionalFile(path,snapshot[path]!,maxNodes)),maxNodes);
	regionalDependencyOrder(inventories,entryPoints);
	if (sourceInventory) {
		const expected = new Map(sourceInventory.map(file=>[file.path,file]));
		if (expected.size !== inventories.length) throw new RegionalPackageError("RUAM_REGIONAL_INVENTORY_MISMATCH", "file set changed");
		for (const file of inventories) {
			const original = expected.get(file.path);
			if (!original || original.sourceType !== file.sourceType || JSON.stringify(original.imports) !== JSON.stringify(file.imports)) throw new RegionalPackageError("RUAM_REGIONAL_INVENTORY_MISMATCH", `${file.path}: module context, import order or source ownership changed`);
		}
	}
	const manifest = JSON.stringify({format:"ruam-regional-package-v1",entryPoints:[...entryPoints],files:inventories.map(file=>[file.path,file.sha256])});
	return Object.freeze({kind:"final-byte-parse-and-inventory",packageSha256:regionalSha256(manifest),files:Object.freeze(inventories),semanticEquivalence:"not-proven",resistance:"not-measured"});
}

export function validateRegionalPackage(build: RegionalPackageBuild): RegionalValidationEvidence {
	const evidence = validateRegionalArtifactFiles(build.files,build.entryPoints,build.options.maxNodes,build.sourceInventory);
	if (evidence.packageSha256 !== build.evidence.packageSha256) throw new RegionalPackageError("RUAM_REGIONAL_DIGEST_MISMATCH", "final bytes changed");
	return evidence;
}
