/**
 * Contained, two-phase filesystem protection primitives.
 *
 * Discovery never follows symbolic links or accepts matches outside the
 * declared root. Every source is transformed before any destination changes,
 * and writes are staged beside their targets before atomic replacement.
 *
 * @module file-protection
 */

import fs from "fs-extra";
import { globby } from "globby";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import type { Stats } from "node:fs";
import type { RuamOptions } from "./isogloss/options.js";
import type { IsoglossSourceBuildResult } from "./isogloss/source-transform.js";
import { protectCode } from "./transform.js";

export const FILE_PROTECTION_LIMITS = Object.freeze({
	files: 4_096,
	totalSourceBytes: 256 * 1024 * 1024,
	totalOutputBytes: 512 * 1024 * 1024,
});

export type RuamFileSafetyErrorCode =
	| "RUAM_FILE_ROOT_NOT_DIRECTORY"
	| "RUAM_FILE_SYMLINK_FORBIDDEN"
	| "RUAM_FILE_HARDLINK_FORBIDDEN"
	| "RUAM_FILE_NOT_REGULAR"
	| "RUAM_FILE_PATH_ESCAPE"
	| "RUAM_FILE_SOURCE_CHANGED"
	| "RUAM_FILE_DESTINATION_INVALID";

export class RuamFileSafetyError extends Error {
	override readonly name = "RuamFileSafetyError";

	constructor(
		readonly code: RuamFileSafetyErrorCode,
		readonly filePath: string,
		detail: string
	) {
		super(`${code}: ${filePath}: ${detail}`);
	}
}

export interface FileIdentity {
	readonly device: number;
	readonly inode: number;
	readonly size: number;
	readonly modifiedMilliseconds: number;
	readonly mode: number;
	readonly linkCount: number;
	readonly contentDigest: string;
}

export interface PlannedFileProtection {
	readonly file: string;
	readonly sourcePath: string;
	readonly sourceBytes: number;
	readonly build: IsoglossSourceBuildResult;
	readonly sourceIdentity: FileIdentity;
}

interface StagedWrite {
	readonly temporaryPath: string;
	readonly targetPath: string;
}

interface PublishedWrite extends StagedWrite {
	readonly backupPath?: string;
}

/** Discover regular files whose resolved paths remain under one real root. */
export async function discoverContainedFiles(
	rootDirectory: string,
	include: readonly string[],
	exclude: readonly string[]
): Promise<readonly string[]> {
	const root = path.resolve(rootDirectory);
	const rootStat = await fs.lstat(root);
	if (rootStat.isSymbolicLink()) {
		throw new RuamFileSafetyError(
			"RUAM_FILE_SYMLINK_FORBIDDEN",
			root,
			"the protection root must not be a symbolic link"
		);
	}
	if (!rootStat.isDirectory()) {
		throw new RuamFileSafetyError(
			"RUAM_FILE_ROOT_NOT_DIRECTORY",
			root,
			"the protection root must be a directory"
		);
	}

	const matches = await globby([...include], {
		cwd: root,
		ignore: [...exclude],
		absolute: false,
		onlyFiles: true,
		followSymbolicLinks: false,
		unique: true,
	});
	const files = [...matches].sort(compareStrings);
	if (files.length > FILE_PROTECTION_LIMITS.files) {
		throw new RuamFileSafetyError(
			"RUAM_FILE_DESTINATION_INVALID",
			root,
			`matched file count ${files.length} exceeds ${FILE_PROTECTION_LIMITS.files}`
		);
	}
	for (const file of files) {
		const candidate = containedPath(root, file);
		const stat = await fs.lstat(candidate);
		assertRegularFile(candidate, stat);
	}
	return Object.freeze(files);
}

/**
 * Read and transform every selected file without mutating the filesystem.
 *
 * If one build fails, no file has been changed and the original error escapes.
 */
export async function planDirectoryProtection(
	rootDirectory: string,
	include: readonly string[],
	exclude: readonly string[],
	options: RuamOptions = {}
): Promise<readonly PlannedFileProtection[]> {
	const root = path.resolve(rootDirectory);
	const files = await discoverContainedFiles(root, include, exclude);
	const plans: PlannedFileProtection[] = [];
	let totalSourceBytes = 0;
	let totalOutputBytes = 0;
	for (const file of files) {
		const sourcePath = containedPath(root, file);
		const snapshot = await readRegularSnapshot(sourcePath);
		const source = snapshot.contents.toString("utf8");
		totalSourceBytes += snapshot.contents.byteLength;
		if (totalSourceBytes > FILE_PROTECTION_LIMITS.totalSourceBytes) {
			throw new RuamFileSafetyError(
				"RUAM_FILE_DESTINATION_INVALID",
				root,
				`aggregate source bytes exceed ${FILE_PROTECTION_LIMITS.totalSourceBytes}`
			);
		}
		const build = protectCode(source, options);
		totalOutputBytes += build.stats.outputBytes;
		if (totalOutputBytes > FILE_PROTECTION_LIMITS.totalOutputBytes) {
			throw new RuamFileSafetyError(
				"RUAM_FILE_DESTINATION_INVALID",
				root,
				`aggregate output bytes exceed ${FILE_PROTECTION_LIMITS.totalOutputBytes}`
			);
		}
		plans.push(
			Object.freeze({
				file,
				sourcePath,
				sourceBytes: Buffer.byteLength(source, "utf8"),
				build,
				sourceIdentity: identity(
					snapshot.stat,
					hashBytes(snapshot.contents)
				),
			})
		);
	}
	return Object.freeze(plans);
}

/**
 * Stage every planned output, validate that sources did not change, then
 * atomically replace each destination. Transform and staging failures therefore
 * occur before the first visible write.
 */
export async function commitDirectoryProtection(
	targetDirectory: string,
	plans: readonly PlannedFileProtection[]
): Promise<void> {
	const targetRoot = path.resolve(targetDirectory);
	const staged: StagedWrite[] = [];
	const published: PublishedWrite[] = [];
	try {
		for (const plan of plans) {
			await assertSourceUnchanged(plan);
			const targetPath = containedPath(targetRoot, plan.file);
			await assertWritableTarget(targetPath);
			await fs.ensureDir(path.dirname(targetPath));
			const temporaryPath = await stageWrite(
				targetPath,
				plan.build.code,
				plan.sourceIdentity.mode
			);
			staged.push(Object.freeze({ temporaryPath, targetPath }));
		}
		// Close the planning-to-publication window for every source before the
		// first target changes.
		for (const plan of plans) {
			await assertSourceUnchanged(plan);
		}
		for (const write of staged) {
			const backupPath = (await fs.pathExists(write.targetPath))
				? await unusedSiblingPath(write.targetPath, "backup")
				: undefined;
			if (backupPath !== undefined) {
				await fs.rename(write.targetPath, backupPath);
			}
			try {
				await fs.rename(write.temporaryPath, write.targetPath);
			} catch (error) {
				if (backupPath !== undefined) {
					await fs.rename(backupPath, write.targetPath);
				}
				throw error;
			}
			published.push(
				Object.freeze({ ...write, ...(backupPath ? { backupPath } : {}) })
			);
		}
		await Promise.allSettled(
			published.flatMap((write) =>
				write.backupPath === undefined
					? []
					: [fs.remove(write.backupPath)]
			)
		);
	} catch (error) {
		const rollbackErrors: unknown[] = [];
		for (const write of published.reverse()) {
			try {
				await fs.remove(write.targetPath);
				if (write.backupPath !== undefined) {
					await fs.rename(write.backupPath, write.targetPath);
				}
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		await Promise.allSettled(
			staged.map((write) => fs.remove(write.temporaryPath))
		);
		if (rollbackErrors.length > 0) {
			throw new AggregateError(
				[error, ...rollbackErrors],
				"RUAM_FILE_ROLLBACK_FAILED"
			);
		}
		throw error;
	}
}

/** Protect one regular file and publish it with an atomic file replacement. */
export async function protectFileAtomically(
	inputPath: string,
	outputPath: string,
	options: RuamOptions = {},
	ownerTracePath?: string
): Promise<IsoglossSourceBuildResult> {
	const sourcePath = path.resolve(inputPath);
	const targetPath = path.resolve(outputPath);
	const snapshot = await readRegularSnapshot(sourcePath);
	const source = snapshot.contents.toString("utf8");
	const build = protectCode(source, options);
	const resolvedTracePath =
		ownerTracePath === undefined
			? undefined
			: path.resolve(ownerTracePath);
	if (
		resolvedTracePath === sourcePath ||
		resolvedTracePath === targetPath
	) {
		throw new RuamFileSafetyError(
			"RUAM_FILE_DESTINATION_INVALID",
			resolvedTracePath,
			"owner trace must not alias the source or protected output"
		);
	}
	if (resolvedTracePath !== undefined && build.ownerTrace === undefined) {
		throw new RuamFileSafetyError(
			"RUAM_FILE_DESTINATION_INVALID",
			resolvedTracePath,
			"the requested build did not produce an owner trace"
		);
	}
	const plan: PlannedFileProtection = Object.freeze({
		file: path.basename(sourcePath),
		sourcePath,
		sourceBytes: Buffer.byteLength(source, "utf8"),
		build,
		sourceIdentity: identity(
			snapshot.stat,
			hashBytes(snapshot.contents)
		),
	});
	await assertSourceUnchanged(plan);
	await assertWritableTarget(targetPath);
	await fs.ensureDir(path.dirname(targetPath));
	const temporaryPath = await stageWrite(
		targetPath,
		build.code,
		snapshot.stat.mode
	);
	let traceTemporaryPath: string | undefined;
	try {
		if (resolvedTracePath !== undefined) {
			await assertWritableTarget(resolvedTracePath);
			await fs.ensureDir(path.dirname(resolvedTracePath));
			traceTemporaryPath = await stageWrite(
				resolvedTracePath,
				serializeOwnerTrace(build.ownerTrace!),
				0o600
			);
		}
		await assertSourceUnchanged(plan);
		if (
			resolvedTracePath !== undefined &&
			traceTemporaryPath !== undefined
		) {
			await fs.rename(traceTemporaryPath, resolvedTracePath);
			traceTemporaryPath = undefined;
		}
		await fs.rename(temporaryPath, targetPath);
	} catch (error) {
		await Promise.allSettled([
			fs.remove(temporaryPath),
			...(traceTemporaryPath === undefined
				? []
				: [fs.remove(traceTemporaryPath)]),
		]);
		throw error;
	}
	return build;
}

function serializeOwnerTrace(
	trace: NonNullable<IsoglossSourceBuildResult["ownerTrace"]>
): string {
	return (
		JSON.stringify(
			trace,
			(_key, value) =>
				typeof value === "bigint" ? value.toString(10) : value,
			2
		) + "\n"
	);
}

function containedPath(root: string, file: string): string {
	if (file.length === 0 || path.isAbsolute(file)) {
		throw new RuamFileSafetyError(
			"RUAM_FILE_PATH_ESCAPE",
			file,
			"matched paths must be nonempty and relative"
		);
	}
	const candidate = path.resolve(root, file);
	const relative = path.relative(root, candidate);
	if (
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	) {
		throw new RuamFileSafetyError(
			"RUAM_FILE_PATH_ESCAPE",
			file,
			"matched path resolves outside the protection root"
		);
	}
	return candidate;
}

function assertRegularFile(filePath: string, stat: Stats): void {
	if (stat.isSymbolicLink()) {
		throw new RuamFileSafetyError(
			"RUAM_FILE_SYMLINK_FORBIDDEN",
			filePath,
			"symbolic-link inputs are not followed"
		);
	}
	if (!stat.isFile()) {
		throw new RuamFileSafetyError(
			"RUAM_FILE_NOT_REGULAR",
			filePath,
			"input must be a regular file"
		);
	}
	if (stat.nlink !== 1) {
		throw new RuamFileSafetyError(
			"RUAM_FILE_HARDLINK_FORBIDDEN",
			filePath,
			"hard-linked inputs have aliases that cannot be protected atomically"
		);
	}
}

async function assertWritableTarget(targetPath: string): Promise<void> {
	try {
		const stat = await fs.lstat(targetPath);
		if (stat.isSymbolicLink() || !stat.isFile()) {
			throw new RuamFileSafetyError(
				"RUAM_FILE_DESTINATION_INVALID",
				targetPath,
				"an existing destination must be a regular non-symlink file"
			);
		}
	} catch (error) {
		if (isMissingFileError(error)) return;
		throw error;
	}
}

async function assertSourceUnchanged(
	plan: PlannedFileProtection
): Promise<void> {
	const snapshot = await readRegularSnapshot(plan.sourcePath);
	const current = identity(snapshot.stat, hashBytes(snapshot.contents));
	if (
		current.device !== plan.sourceIdentity.device ||
		current.inode !== plan.sourceIdentity.inode ||
		current.size !== plan.sourceIdentity.size ||
		current.modifiedMilliseconds !==
			plan.sourceIdentity.modifiedMilliseconds ||
		current.linkCount !== plan.sourceIdentity.linkCount ||
		current.contentDigest !== plan.sourceIdentity.contentDigest
	) {
		throw new RuamFileSafetyError(
			"RUAM_FILE_SOURCE_CHANGED",
			plan.sourcePath,
			"source changed after it was transformed"
		);
	}
}

async function stageWrite(
	targetPath: string,
	contents: string,
	mode: number
): Promise<string> {
	const directory = path.dirname(targetPath);
	for (let attempt = 0; attempt < 16; attempt++) {
		const nonce = randomBytes(12).toString("hex");
		const temporaryPath = path.join(
			directory,
			`.${path.basename(targetPath)}.ruam-${process.pid}-${nonce}.tmp`
		);
		try {
			await fs.writeFile(temporaryPath, contents, {
				encoding: "utf8",
				flag: "wx",
				mode,
			});
			return temporaryPath;
		} catch (error) {
			if (isAlreadyExistsError(error)) continue;
			throw error;
		}
	}
	throw new RuamFileSafetyError(
		"RUAM_FILE_DESTINATION_INVALID",
		targetPath,
		"could not allocate a unique staging file"
	);
}

async function unusedSiblingPath(
	targetPath: string,
	purpose: string
): Promise<string> {
	const directory = path.dirname(targetPath);
	for (let attempt = 0; attempt < 16; attempt++) {
		const nonce = randomBytes(12).toString("hex");
		const candidate = path.join(
			directory,
			`.${path.basename(targetPath)}.ruam-${purpose}-${process.pid}-${nonce}`
		);
		if (!(await fs.pathExists(candidate))) return candidate;
	}
	throw new RuamFileSafetyError(
		"RUAM_FILE_DESTINATION_INVALID",
		targetPath,
		`could not allocate a unique ${purpose} path`
	);
}

async function readRegularSnapshot(
	filePath: string
): Promise<{ readonly stat: Stats; readonly contents: Buffer }> {
	const initialStat = await fs.lstat(filePath);
	assertRegularFile(filePath, initialStat);
	let handle;
	try {
		handle = await open(
			filePath,
			fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
		);
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			(error as NodeJS.ErrnoException).code === "ELOOP"
		) {
			throw new RuamFileSafetyError(
				"RUAM_FILE_SYMLINK_FORBIDDEN",
				filePath,
				"symbolic-link inputs are not followed"
			);
		}
		throw error;
	}
	try {
		const stat = await handle.stat();
		assertRegularFile(filePath, stat);
		const contents = await handle.readFile();
		const pathStat = await fs.lstat(filePath);
		assertRegularFile(filePath, pathStat);
		if (stat.dev !== pathStat.dev || stat.ino !== pathStat.ino) {
			throw new RuamFileSafetyError(
				"RUAM_FILE_SOURCE_CHANGED",
				filePath,
				"source path changed while it was being read"
			);
		}
		return { stat, contents };
	} finally {
		await handle.close();
	}
}

function hashBytes(contents: Uint8Array): string {
	return createHash("sha256").update(contents).digest("hex");
}

function identity(stat: Stats, contentDigest: string): FileIdentity {
	return Object.freeze({
		device: stat.dev,
		inode: stat.ino,
		size: stat.size,
		modifiedMilliseconds: stat.mtimeMs,
		mode: stat.mode,
		linkCount: stat.nlink,
		contentDigest,
	});
}

function isMissingFileError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}

function isAlreadyExistsError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "EEXIST"
	);
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
