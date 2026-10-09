/** Node-only complete-package publication. Import no part of this file in browsers. */
import { lstat, realpath, mkdtemp, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { RegionalPackageError, type RegionalPackageBuild } from "./contracts.js";
import { isCompilerProducedRegionalPackage } from "./graph.js";
import { validateRegionalPackage } from "./validation.js";

export interface RegionalPublicationOptions { readonly sourcePaths?: readonly string[]; }
export interface RegionalPublicationResult {
	readonly status: "experimental-unqualified";
	readonly outputDirectory: string;
	readonly files: readonly string[];
	readonly packageSha256: string;
	readonly publication: "new-directory-rename";
	readonly crashDurability: "not-guaranteed";
	readonly releaseApproved: false;
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";
async function assertAbsent(path: string): Promise<void> {
	try { await lstat(path); }
	catch (error) { if (missing(error)) return; throw error; }
	throw new RegionalPackageError("RUAM_REGIONAL_OUTPUT_EXISTS", path);
}

async function checkParent(path: string): Promise<{dev:number;ino:number}> {
	let current = parse(path).root;
	for (const segment of path.slice(current.length).split(sep).filter(Boolean)) {
		current = join(current,segment);
		const stat = await lstat(current);
		if (stat.isSymbolicLink() || !stat.isDirectory()) throw new RegionalPackageError("RUAM_REGIONAL_UNSAFE_DESTINATION", current);
	}
	const stat = await lstat(path);
	return {dev:stat.dev,ino:stat.ino};
}

function contains(parent: string, child: string): boolean {
	const rel = relative(parent.toLowerCase(),child.toLowerCase());
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * Publishes to an absent destination only. Existing packages are never replaced.
 * Rename provides complete visibility on the local filesystem. This is not a
 * sandbox against a hostile process swapping parent directories concurrently,
 * nor a claim of crash durability or artifact resistance.
 */
export async function publishRegionalPackage(build: RegionalPackageBuild, outputDir: string, options: RegionalPublicationOptions = {}): Promise<RegionalPublicationResult> {
	if (!isCompilerProducedRegionalPackage(build)) throw new RegionalPackageError("RUAM_REGIONAL_UNTRUSTED_BUILD", "publish requires a compiler-produced package");
	const evidence = validateRegionalPackage(build);
	if (typeof outputDir !== "string" || !outputDir || outputDir.includes("\0")) throw new RegionalPackageError("RUAM_REGIONAL_UNSAFE_DESTINATION", "invalid output path");
	const target = resolve(outputDir);
	const parent = dirname(target);
	if (target === parent) throw new RegionalPackageError("RUAM_REGIONAL_UNSAFE_DESTINATION", target);
	const identity = await checkParent(parent);
	await assertAbsent(target);
	for (const source of options.sourcePaths ?? []) {
		const actual = await realpath(resolve(source));
		if (contains(target,actual) || contains(actual,target)) throw new RegionalPackageError("RUAM_REGIONAL_SOURCE_OVERWRITE", actual);
	}
	const stage = await mkdtemp(join(parent,".ruam-regional-"));
	let published = false;
	try {
		for (const path of Object.keys(build.files).sort()) {
			const destination = join(stage,path);
			await mkdir(dirname(destination),{recursive:true,mode:0o700});
			const handle = await open(destination,"wx",0o600);
			try { await handle.writeFile(build.files[path]!,"utf8"); await handle.sync(); }
			finally { await handle.close(); }
		}
		const now = await checkParent(parent);
		if (now.dev !== identity.dev || now.ino !== identity.ino) throw new RegionalPackageError("RUAM_REGIONAL_DESTINATION_CHANGED", parent);
		await assertAbsent(target);
		await rename(stage,target);
		published = true;
		return Object.freeze({status:"experimental-unqualified",outputDirectory:target,files:Object.freeze(Object.keys(build.files).sort()),packageSha256:evidence.packageSha256,publication:"new-directory-rename",crashDurability:"not-guaranteed",releaseApproved:false});
	} finally {
		if (!published) await rm(stage,{recursive:true,force:true});
	}
}
