#!/usr/bin/env node

/**
 * CLI entry point for Ruam's Isogloss source-protection compiler.
 *
 * @module cli
 */

import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import ora from "ora";
import { protectCode } from "./index.js";
import {
	commitDirectoryProtection,
	planDirectoryProtection,
	protectFileAtomically,
	type PlannedFileProtection,
} from "./file-protection.js";
import {
	resolveRuamOptions,
	type IsoglossDeploymentProfile,
	type IsoglossRegionDomains,
	type IsoglossTargetEnvironment,
	type IsoglossTargetMode,
	type ResolvedRuamOptions,
	type RuamOptions,
} from "./isogloss/options.js";

type ProtectionResult = ReturnType<typeof protectCode>;
type OwnerSidecar = NonNullable<ProtectionResult["ownerTrace"]>;

const LOGO_LINES = [
	`:::::::..    ...    :::  :::.     .        :`,
	`;;;;\`\`;;;;   ;;     ;;;  ;;\`;;    ;;,.    ;;;`,
	` [[[,/[[['  [['     [[[ ,[[ '[[,  [[[[, ,[[[[,`,
	` $$$$$$c    $$      $$$c$$$cc$$$c $$$$$$$$"$$$`,
	` 888b "88bo,88    .d888 888   888,888 Y88" 888o`,
	` MMMM   "W"  "YmmMMMM"" YMM   ""\` MMM  M'  "MMM`,
];

const PALETTE = [
	"#ff6b6b",
	"#ff8e53",
	"#feca57",
	"#48dbfb",
	"#0abde3",
	"#a29bfe",
	"#fd79a8",
	"#e17055",
	"#00cec9",
	"#6c5ce7",
	"#e84393",
	"#fdcb6e",
];

const TAGLINE = "Isogloss JavaScript Source Protection";

/**
 * Former execution-engine flags remain recognizable only so the CLI can fail
 * with a migration diagnostic. None of them maps to an active option.
 */
const REMOVED_EXECUTION_FLAGS = new Set([
	"--preset",
	"-e",
	"--encrypt",
	"-d",
	"--debug-protection",
	"--no-debug-protection",
	"--debug-logging",
	"--dynamic-opcodes",
	"--decoy-opcodes",
	"--dead-code",
	"--stack-encoding",
	"--rolling-cipher",
	"--integrity-binding",
	"--vm-shielding",
	"--mba",
	"--handler-fragmentation",
	"--string-atomization",
	"--polymorphic-decoder",
	"--scattered-keys",
	"--block-permutation",
	"--opcode-mutation",
	"--bytecode-scattering",
	"--incremental-cipher",
	"--semantic-opacity",
	"--observation-resistance",
]);

interface CliArgs {
	input?: string;
	output?: string;
	include: string[];
	exclude: string[];
	help: boolean;
	version: boolean;
	interactive: boolean;
	profile?: IsoglossDeploymentProfile;
	minimumExactAttackQueries?: string;
	ownerTracePath?: string;
	custodianEndpoint?: string;
	privateImplementation?: string;
	attestationProvider?: string;
	attestationMeasurement?: string;
	targetMode?: IsoglossTargetMode;
	threshold?: number;
	preprocessIdentifiers?: boolean;
	target?: IsoglossTargetEnvironment;
	regionDomainsPath?: string;
}

interface MaterializedCliOptions {
	readonly input: RuamOptions;
	readonly resolved: ResolvedRuamOptions;
}

class CliUsageError extends Error {
	override readonly name = "CliUsageError";

	constructor(
		readonly code:
			| "RUAM_CLI_MISSING_VALUE"
			| "RUAM_CLI_UNKNOWN_OPTION"
			| "RUAM_REMOVED_CLI_OPTION"
			| "RUAM_CLI_INVALID_REGION_DOMAINS_FILE"
			| "RUAM_CLI_PROFILE_REQUIRES_PRODUCT_PLANNER"
			| "RUAM_CLI_OUTPUT_OVERLAP",
		detail: string
	) {
		super(`${code}: ${detail}`);
	}
}

function defaultCliArgs(): CliArgs {
	return {
		include: ["**/*.js"],
		exclude: ["**/node_modules/**"],
		help: false,
		version: false,
		interactive: false,
	};
}

function renderLogo(offset: number): string {
	return LOGO_LINES.map((line, index) =>
		chalk.hex(PALETTE[(index + offset) % PALETTE.length]!)("  " + line)
	).join("\n");
}

class LogoAnimation {
	private offset = 0;
	private timer: ReturnType<typeof setInterval> | null = null;
	private readonly lineCount = LOGO_LINES.length + 2;

	start(version: string): void {
		if (!process.stdout.isTTY) {
			this.printStatic(version);
			return;
		}
		this.printFrame(version);
		this.timer = setInterval(() => {
			this.offset++;
			process.stdout.write(`\x1b[${this.lineCount}A`);
			this.printFrame(version);
		}, 120);
	}

	stop(): void {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	private printFrame(version: string): void {
		process.stdout.write(
			`${renderLogo(this.offset)}\n  ${chalk.dim(
				`v${version} \u2014 ${TAGLINE}`
			)}\n\n`
		);
	}

	private printStatic(version: string): void {
		console.log(renderLogo(0));
		console.log(`  ${chalk.dim(`v${version} \u2014 ${TAGLINE}`)}`);
		console.log();
	}
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

async function getVersion(): Promise<string> {
	try {
		const raw = await fs.readFile(
			new URL("../package.json", import.meta.url),
			"utf-8"
		);
		return JSON.parse(raw).version;
	} catch {
		return "unknown";
	}
}

function parseArgs(argv: string[]): CliArgs {
	const result = defaultCliArgs();

	let index = 0;
	const nextArg = (flag: string): string => {
		index++;
		if (index >= argv.length) {
			throw new CliUsageError(
				"RUAM_CLI_MISSING_VALUE",
				`missing value for ${flag}`
			);
		}
		return argv[index]!;
	};

	while (index < argv.length) {
		const argument = argv[index]!;
		if (REMOVED_EXECUTION_FLAGS.has(argument)) {
			throw new CliUsageError(
				"RUAM_REMOVED_CLI_OPTION",
				`${argument} was removed with the former execution architecture; use --profile and the explicit Isogloss capability flags`
			);
		}

		switch (argument) {
			case "-h":
			case "--help":
				result.help = true;
				break;
			case "-v":
			case "--version":
				result.version = true;
				break;
			case "-I":
			case "--interactive":
				result.interactive = true;
				break;
			case "-o":
			case "--output":
				result.output = nextArg(argument);
				break;
			case "--profile":
				result.profile = nextArg(
					argument
				) as IsoglossDeploymentProfile;
				break;
			case "--minimum-exact-attack-queries":
				result.minimumExactAttackQueries = nextArg(argument);
				break;
			case "--owner-trace":
				result.ownerTracePath = nextArg(argument);
				break;
			case "--custodian-endpoint":
				result.custodianEndpoint = nextArg(argument);
				break;
			case "--private-implementation":
				result.privateImplementation = nextArg(argument);
				break;
			case "--attestation-provider":
				result.attestationProvider = nextArg(argument);
				break;
			case "--attestation-measurement":
				result.attestationMeasurement = nextArg(argument);
				break;
			case "-m":
			case "--mode":
				result.targetMode = nextArg(argument) as IsoglossTargetMode;
				break;
			case "--threshold":
				result.threshold = Number(nextArg(argument));
				break;
			case "-p":
			case "--preprocess":
				result.preprocessIdentifiers = true;
				break;
			case "--target":
				result.target = nextArg(
					argument
				) as IsoglossTargetEnvironment;
				break;
			case "--region-domains":
				result.regionDomainsPath = nextArg(argument);
				break;
			case "--include":
				result.include = [nextArg(argument)];
				break;
			case "--exclude":
				result.exclude = [nextArg(argument)];
				break;
			default:
				if (argument.startsWith("-")) {
					throw new CliUsageError(
						"RUAM_CLI_UNKNOWN_OPTION",
						`unknown option ${argument}; run ruam --help`
					);
				}
				if (result.input !== undefined) {
					throw new CliUsageError(
						"RUAM_CLI_UNKNOWN_OPTION",
						`unexpected positional argument ${argument}`
					);
				}
				result.input = argument;
		}
		index++;
	}

	return result;
}

async function materializeOptions(
	args: CliArgs
): Promise<MaterializedCliOptions> {
	const requestedProfile = args.profile ?? "holographic-local";
	if (
		args.profile !== undefined &&
		![
			"holographic-local",
			"holographic-custodied",
			"holographic-private",
			"holographic-tee",
		].includes(args.profile)
	) {
		resolveRuamOptions({ isogloss: { profile: args.profile } });
	}
	if (
		requestedProfile !== "holographic-local" ||
		args.minimumExactAttackQueries !== undefined ||
		args.custodianEndpoint !== undefined ||
		args.privateImplementation !== undefined ||
		args.attestationProvider !== undefined ||
		args.attestationMeasurement !== undefined
	) {
		throw new CliUsageError(
			"RUAM_CLI_PROFILE_REQUIRES_PRODUCT_PLANNER",
			`${requestedProfile} custody and attestation require the unpublished owner deployment pipeline with an owner-proven execution boundary; the source CLI supports holographic-local only`
		);
	}

	let regionDomains: IsoglossRegionDomains | undefined;
	if (args.regionDomainsPath !== undefined) {
		const filePath = path.resolve(args.regionDomainsPath);
		try {
			regionDomains = JSON.parse(
				await fs.readFile(filePath, "utf-8")
			) as IsoglossRegionDomains;
		} catch (error) {
			throw new CliUsageError(
				"RUAM_CLI_INVALID_REGION_DOMAINS_FILE",
				`${args.regionDomainsPath}: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
	}

	const isogloss = {
		...(args.profile === undefined ? {} : { profile: args.profile }),
		...(args.ownerTracePath === undefined
			? {}
			: { ownerTrace: "sidecar" as const }),
	};
	const input: RuamOptions = {
		...(Object.keys(isogloss).length === 0 ? {} : { isogloss }),
		...(args.targetMode === undefined
			? {}
			: { targetMode: args.targetMode }),
		...(args.threshold === undefined
			? {}
			: { threshold: args.threshold }),
		...(args.preprocessIdentifiers === undefined
			? {}
			: { preprocessIdentifiers: args.preprocessIdentifiers }),
		...(args.target === undefined ? {} : { target: args.target }),
		...(regionDomains === undefined ? {} : { regionDomains }),
	};

	return Object.freeze({
		input,
		resolved: resolveRuamOptions(input),
	});
}

function printHelp(version: string): void {
	console.log();
	console.log(renderLogo(0));
	console.log(`  ${chalk.dim(`v${version} \u2014 ${TAGLINE}`)}`);
	console.log();

	const heading = chalk.bold.white;
	const flag = chalk.cyan;
	const argument = chalk.yellow;
	const detail = chalk.dim;

	console.log(heading("  USAGE"));
	console.log(
		`    ${flag("ruam")} ${argument(
			"<input>"
		)}                    Protect a file or directory`
	);
	console.log(
		`    ${flag("ruam")} ${argument("<input>")} -o ${argument(
			"<output>"
		)}        Write protected source elsewhere`
	);
	console.log(
		`    ${flag("ruam")}                            Launch the interactive wizard`
	);
	console.log();

	console.log(heading("  ISOGLOSS"));
	console.log(
		`    ${flag("--profile")} ${argument(
			"<name>"
		)}               Source profile ${detail(
			"(holographic-local only; default)"
		)}`
	);
	console.log(
		`    ${flag("--region-domains")} ${argument(
			"<json>"
		)}          Exact BPRF input domains; other JavaScript stays native`
	);
	console.log(
		`    ${flag("--owner-trace")} ${argument(
			"<path>"
		)}             Write the owner-only sidecar`
	);
	console.log();

	console.log(
		`    ${detail(
			"Custodied, private-function, and TEE deployment remains an unpublished owner integration"
		)}`
	);
	console.log();

	console.log(heading("  SELECTION"));
	console.log(
		`    ${flag("-m, --mode")} ${argument(
			"<root|comment>"
		)}       Select roots or /* ruam:isogloss */ markers`
	);
	console.log(
		`    ${flag("--threshold")} ${argument(
			"<0..1>"
		)}             Eligible-target selection probability`
	);
	console.log(
		`    ${flag("-p, --preprocess")}                 Rename identifiers after protection`
	);
	console.log();

	console.log(heading("  FILES AND TARGET"));
	console.log(
		`    ${flag("-o, --output")} ${argument("<path>")}            Output file or directory`
	);
	console.log(
		`    ${flag("--include")} ${argument(
			"<glob>"
		)}              Directory include ${detail('(default: "**/*.js")')}`
	);
	console.log(
		`    ${flag("--exclude")} ${argument(
			"<glob>"
		)}              Directory exclude ${detail(
			'(default: "**/node_modules/**")'
		)}`
	);
	console.log(
		`    ${flag("--target")} ${argument(
			"<environment>"
		)}         node, browser, or browser-extension`
	);
	console.log();

	console.log(heading("  OTHER"));
	console.log(
		`    ${flag("-I, --interactive")}              Force interactive wizard mode`
	);
	console.log(`    ${flag("-h, --help")}                     Show help`);
	console.log(`    ${flag("-v, --version")}                  Show version`);
	console.log();

	console.log(heading("  EXAMPLES"));
	console.log(
		`    ${detail("$")} ${flag(
			"ruam"
		)} app.js --region-domains domains.json`
	);
	console.log(
		`    ${detail("$")} ${flag(
			"ruam"
		)} app.js -m comment --owner-trace owner.json`
	);
	console.log();
}

function printConfig(options: ResolvedRuamOptions): void {
	console.log(
		`  ${chalk.dim("Profile:")} ${chalk.cyan(options.isogloss.profile)}`
	);
	console.log(
		`  ${chalk.dim("Mode:")}    ${chalk.white(options.targetMode)}${
			options.targetMode === "comment"
				? chalk.dim(" (/* ruam:isogloss */)")
				: ""
		}`
	);
	console.log(
		`  ${chalk.dim("Domains:")} ${chalk.white(
			Object.keys(options.regionDomains).length
		)} configured function${
			Object.keys(options.regionDomains).length === 1 ? "" : "s"
		}`
	);
	if (options.isogloss.ownerTrace === "sidecar") {
		console.log(`  ${chalk.dim("Trace:")}   ${chalk.cyan("owner sidecar")}`);
	}
	if (options.preprocessIdentifiers) {
		console.log(
			`  ${chalk.dim("Preprocess:")} ${chalk.cyan(
				"identifier renaming"
			)}`
		);
	}
}

async function runInteractive(version: string): Promise<void> {
	const logo = new LogoAnimation();
	logo.start(version);
	await new Promise((resolve) => setTimeout(resolve, 600));
	logo.stop();

	const {
		input: promptInput,
		select,
		confirm,
	} = await import("@inquirer/prompts");

	const inputRaw = await promptInput({
		message: chalk.bold("Input path") + chalk.dim(" (file or directory)"),
		validate: async (value: string) => {
			if (!value.trim()) return "Please enter a path";
			if (!(await fs.pathExists(path.resolve(value.trim())))) {
				return `Path does not exist: ${value}`;
			}
			return true;
		},
	});
	const resolvedInput = path.resolve(inputRaw.trim());
	const isDirectory = (await fs.stat(resolvedInput)).isDirectory();
	const outputRaw = await promptInput({
		message:
			chalk.bold("Output path") +
			chalk.dim(
				` (enter to overwrite${isDirectory ? " directory" : ""})`
			),
		default: "",
	});
	const targetMode = await select<IsoglossTargetMode>({
		message: chalk.bold("Target mode"),
		choices: [
			{
				name: "root \u2014 eligible top-level functions",
				value: "root",
			},
			{
				name: "comment \u2014 /* ruam:isogloss */ markers",
				value: "comment",
			},
		],
	});
	const regionDomainsPath = await promptInput({
		message:
			chalk.bold("Region domains JSON") +
			chalk.dim(" (enter for no configured domains)"),
		default: "",
		validate: async (value: string) =>
			!value.trim() ||
			(await fs.pathExists(path.resolve(value.trim()))) ||
			`Path does not exist: ${value}`,
	});
	const preprocessIdentifiers = await confirm({
		message: chalk.bold("Rename identifiers after protection?"),
		default: false,
	});
	const ownerTracePath = await promptInput({
		message:
			chalk.bold("Owner sidecar path") +
			chalk.dim(" (enter to keep owner tracing off)"),
		default: "",
	});

	const args: CliArgs = {
		...defaultCliArgs(),
		input: resolvedInput,
		output: outputRaw.trim() || undefined,
		profile: "holographic-local",
		targetMode,
		regionDomainsPath: regionDomainsPath.trim() || undefined,
		preprocessIdentifiers,
		ownerTracePath: ownerTracePath.trim() || undefined,
	};

	const materialized = await materializeOptions(args);
	console.log();
	console.log(chalk.bold("  Configuration"));
	console.log(chalk.dim("  " + "\u2500".repeat(40)));
	console.log(
		`  ${chalk.dim("Input:")}   ${chalk.white(
			path.relative(process.cwd(), resolvedInput) || "."
		)}`
	);
	console.log(
		`  ${chalk.dim("Output:")}  ${
			args.output ? chalk.white(args.output) : chalk.dim("overwrite input")
		}`
	);
	printConfig(materialized.resolved);
	console.log();

	if (
		!(await confirm({
			message: chalk.bold("Proceed with protection?"),
			default: true,
		}))
	) {
		console.log(chalk.dim("  Cancelled."));
		return;
	}
	console.log();
	await executeProtection(args, materialized);
}

async function protectFile(
	inputPath: string,
	outputPath: string,
	options: RuamOptions,
	ownerTracePath?: string
): Promise<ProtectionResult> {
	return protectFileAtomically(
		inputPath,
		outputPath,
		options,
		ownerTracePath
	);
}

async function writeOwnerTrace(
	outputPath: string,
	trace: OwnerSidecar,
	containmentRoot?: string
): Promise<void> {
	const directory = path.dirname(outputPath);
	if (containmentRoot !== undefined) {
		await assertOwnerTraceTargetContained(
			containmentRoot,
			outputPath
		);
	}
	await fs.ensureDir(directory);
	if (containmentRoot !== undefined) {
		await assertOwnerTraceTargetContained(
			containmentRoot,
			outputPath
		);
	}
	const stageDirectory = await fs.mkdtemp(
		path.join(directory, ".ruam-owner-trace-")
	);
	const stagedPath = path.join(stageDirectory, "trace.json");
	try {
		await fs.writeFile(
			stagedPath,
			JSON.stringify(
				trace,
				(_key, value) =>
					typeof value === "bigint"
						? value.toString(10)
						: value,
				2
			) + "\n",
			{ encoding: "utf8", mode: 0o600, flag: "wx" }
		);
		if (await fs.pathExists(outputPath)) {
			const stat = await fs.lstat(outputPath);
			if (stat.isSymbolicLink() || !stat.isFile()) {
				throw new CliUsageError(
					"RUAM_CLI_OUTPUT_OVERLAP",
					"an existing owner trace must be a non-symlink regular file"
				);
			}
		}
		await fs.rename(stagedPath, outputPath);
	} finally {
		await fs.remove(stageDirectory);
	}
}

async function protectSingleFileWithProgress(
	inputPath: string,
	args: CliArgs,
	materialized: MaterializedCliOptions
): Promise<void> {
	const outputPath = args.output ? path.resolve(args.output) : inputPath;
	const inputSize = (await fs.stat(inputPath)).size;
	const relativeInput = path.relative(process.cwd(), inputPath);
	const relativeOutput = path.relative(process.cwd(), outputPath);
	const spinner = ora({
		text: `Protecting ${chalk.cyan(relativeInput)}...`,
		prefixText: " ",
		color: "cyan",
	}).start();
	const startTime = Date.now();

	try {
		const ownerTracePath =
			args.ownerTracePath === undefined
				? undefined
				: path.resolve(args.ownerTracePath);
		if (ownerTracePath !== undefined) {
			await assertOwnerTraceFileDisjoint(ownerTracePath, [
				inputPath,
				outputPath,
			]);
		}
		const result = await protectFile(
			inputPath,
			outputPath,
			materialized.input,
			ownerTracePath
		);
		const elapsed = Date.now() - startTime;
		const outputSize = (await fs.stat(outputPath)).size;
		const ratio =
			inputSize === 0 ? "1.0" : (outputSize / inputSize).toFixed(1);

		spinner.succeed(chalk.green("Protection complete"));
		console.log();
		console.log(
			`  ${chalk.dim("File:")}       ${chalk.white(relativeInput)}${
				relativeInput !== relativeOutput
					? chalk.dim(" \u2192 ") + chalk.white(relativeOutput)
					: ""
			}`
		);
		console.log(
			`  ${chalk.dim("BPRF:")}      ${chalk.white(
				result.stats.protectedRegionCount
			)}`
		);
		console.log(
			`  ${chalk.dim("Native:")}     ${chalk.white(
				result.stats.nativeRegionCount
			)} ${chalk.dim(`(${result.stats.hybridFunctionCount} hybrid function${result.stats.hybridFunctionCount === 1 ? "" : "s"})`)}`
		);
		console.log(
			`  ${chalk.dim("Input:")}      ${chalk.white(
				formatBytes(inputSize)
			)}`
		);
		console.log(
			`  ${chalk.dim("Output:")}     ${chalk.white(
				formatBytes(outputSize)
			)} ${chalk.dim(`(${ratio}\u00d7)`)}`
		);
		console.log(
			`  ${chalk.dim("Time:")}       ${chalk.white(formatTime(elapsed))}`
		);
		console.log();
	} catch (error) {
		spinner.fail(chalk.red("Protection failed"));
		throw error;
	}
}

async function protectDirectoryWithProgress(
	inputPath: string,
	args: CliArgs,
	materialized: MaterializedCliOptions
): Promise<void> {
	const startTime = Date.now();
	const outputDirectory = args.output ? path.resolve(args.output) : inputPath;
	const ownerTraceRoot =
		args.ownerTracePath === undefined
			? undefined
			: path.resolve(args.ownerTracePath);
	if (
		outputDirectory !== inputPath &&
		pathsOverlap(inputPath, outputDirectory)
	) {
		throw new CliUsageError(
			"RUAM_CLI_OUTPUT_OVERLAP",
			"directory output must not contain the input directory or be contained by it"
		);
	}
	if (ownerTraceRoot !== undefined) {
		await assertOwnerTraceRootDisjoint(ownerTraceRoot, [
			inputPath,
			outputDirectory,
		]);
	}

	const spinner = ora({
		text: "Planning contained file transformations...",
		prefixText: " ",
		color: "cyan",
	}).start();
	let plans: readonly PlannedFileProtection[];
	try {
		// Transform every file before the first output mutation. A configured
		// rejection therefore leaves both in-place and copied builds untouched.
		plans = await planDirectoryProtection(
			inputPath,
			args.include,
			args.exclude,
			materialized.input
		);
	} catch (error) {
		spinner.fail(chalk.red("Protection planning failed; no files changed"));
		throw error;
	}
	if (plans.length === 0) {
		spinner.stop();
		console.log(chalk.yellow("  No matching files found."));
		return;
	}
	for (const plan of plans) {
		if (
			ownerTraceRoot !== undefined &&
			plan.build.ownerTrace === undefined
		) {
			spinner.fail(chalk.red("Owner trace planning failed"));
			throw new Error(
				"RUAM_CLI_OWNER_TRACE_MISSING: protection did not return the requested owner sidecar"
			);
		}
	}

	// Publish disjoint owner material before client code. A sidecar failure
	// therefore cannot leave newly protected code without its requested trace.
	for (const plan of plans) {
		if (
			ownerTraceRoot !== undefined &&
			plan.build.ownerTrace !== undefined
		) {
			await writeOwnerTrace(
				path.join(
					ownerTraceRoot,
					`${plan.file}.owner-trace.json`
				),
				plan.build.ownerTrace,
				ownerTraceRoot
			);
		}
	}

	try {
		if (outputDirectory !== inputPath) {
			spinner.text = "Staging the validated output tree...";
			await publishSeparateDirectory(
				inputPath,
				outputDirectory,
				plans
			);
		} else {
			spinner.text = "Publishing staged protected files...";
			await commitDirectoryProtection(outputDirectory, plans);
		}
	} catch (error) {
		spinner.fail(chalk.red("Protection publish failed"));
		throw error;
	}

	console.log(
		`  ${chalk.dim("Directory:")} ${chalk.white(
			path.relative(process.cwd(), outputDirectory) || "."
		)} ${chalk.dim(`(${plans.length} file${plans.length === 1 ? "" : "s"})`)}`
	);
	console.log();

	const totalInputSize = plans.reduce(
		(total, plan) => total + plan.sourceBytes,
		0
	);
	const totalOutputSize = plans.reduce(
		(total, plan) => total + plan.build.stats.outputBytes,
		0
	);
	const protectedRegionCount = plans.reduce(
		(total, plan) => total + plan.build.stats.protectedRegionCount,
		0
	);
	const nativeRegionCount = plans.reduce(
		(total, plan) => total + plan.build.stats.nativeRegionCount,
		0
	);
	const hybridFunctionCount = plans.reduce(
		(total, plan) => total + plan.build.stats.hybridFunctionCount,
		0
	);
	spinner.succeed(
		chalk.green(
			`${plans.length} file${plans.length === 1 ? "" : "s"} protected with staged atomic replacement`
		)
	);

	const ratio =
		totalInputSize === 0
			? "1.0"
			: (totalOutputSize / totalInputSize).toFixed(1);
	console.log();
	console.log(
		`  ${chalk.dim("BPRF:")}     ${chalk.white(protectedRegionCount)}`
	);
	console.log(
		`  ${chalk.dim("Native:")}   ${chalk.white(nativeRegionCount)} ${chalk.dim(`(${hybridFunctionCount} hybrid function${hybridFunctionCount === 1 ? "" : "s"})`)}`
	);
	console.log(
		`  ${chalk.dim("Input:")}    ${chalk.white(
			formatBytes(totalInputSize)
		)}`
	);
	console.log(
		`  ${chalk.dim("Output:")}   ${chalk.white(
			formatBytes(totalOutputSize)
		)} ${chalk.dim(`(${ratio}\u00d7)`)}`
	);
	console.log(
		`  ${chalk.dim("Time:")}     ${chalk.white(
			formatTime(Date.now() - startTime)
		)}`
	);

	console.log();
}

/**
 * Build a separate output in a private sibling directory, then switch the
 * complete tree into place. Existing outputs are retained as a rollback target
 * until the new tree is visible.
 */
async function publishSeparateDirectory(
	inputDirectory: string,
	outputDirectory: string,
	plans: readonly PlannedFileProtection[]
): Promise<void> {
	const parent = path.dirname(outputDirectory);
	await fs.ensureDir(parent);
	const stage = await fs.mkdtemp(
		path.join(parent, `.${path.basename(outputDirectory)}.ruam-stage-`)
	);
	let backup: string | undefined;
	try {
		await fs.copy(inputDirectory, stage, { dereference: false });
		await commitDirectoryProtection(stage, plans);
		if (await fs.pathExists(outputDirectory)) {
			const outputStat = await fs.lstat(outputDirectory);
			if (outputStat.isSymbolicLink() || !outputStat.isDirectory()) {
				throw new CliUsageError(
					"RUAM_CLI_OUTPUT_OVERLAP",
					"an existing directory output must be a non-symlink directory"
				);
			}
			backup = await fs.mkdtemp(
				path.join(
					parent,
					`.${path.basename(outputDirectory)}.ruam-backup-`
				)
			);
			await fs.remove(backup);
			await fs.rename(outputDirectory, backup);
		}
		try {
			await fs.rename(stage, outputDirectory);
		} catch (error) {
			if (backup !== undefined) {
				await fs.rename(backup, outputDirectory);
				backup = undefined;
			}
			throw error;
		}
		if (backup !== undefined) {
			await fs.remove(backup);
			backup = undefined;
		}
	} catch (error) {
		await fs.remove(stage);
		if (
			backup !== undefined &&
			!(await fs.pathExists(outputDirectory))
		) {
			await fs.rename(backup, outputDirectory);
		}
		throw error;
	}
}

async function assertOwnerTraceRootDisjoint(
	traceRoot: string,
	guardedRoots: readonly string[]
): Promise<void> {
	await assertNoSymlinkDirectoryComponents(
		traceRoot,
		commonPathAncestor([traceRoot, ...guardedRoots])
	);
	const canonicalTraceRoot = await canonicalizeProspectivePath(traceRoot);
	for (const guardedRoot of guardedRoots) {
		const canonicalGuardedRoot =
			await canonicalizeProspectivePath(guardedRoot);
		if (pathsOverlap(canonicalGuardedRoot, canonicalTraceRoot)) {
			throw new CliUsageError(
				"RUAM_CLI_OUTPUT_OVERLAP",
				"owner trace directory must be physically disjoint from source and client output trees"
			);
		}
	}
}

async function assertOwnerTraceFileDisjoint(
	tracePath: string,
	guardedFiles: readonly string[]
): Promise<void> {
	const traceDirectory = path.dirname(tracePath);
	await assertNoSymlinkDirectoryComponents(
		traceDirectory,
		commonPathAncestor([
			traceDirectory,
			...guardedFiles.map((file) => path.dirname(file)),
		])
	);
	const canonicalTracePath = await canonicalizeProspectivePath(tracePath);
	for (const guardedFile of guardedFiles) {
		if (
			canonicalTracePath ===
			(await canonicalizeProspectivePath(guardedFile))
		) {
			throw new CliUsageError(
				"RUAM_CLI_OUTPUT_OVERLAP",
				"owner trace file must be physically disjoint from source and client output"
			);
		}
	}
}

async function assertOwnerTraceTargetContained(
	traceRoot: string,
	outputPath: string
): Promise<void> {
	const root = path.resolve(traceRoot);
	const target = path.resolve(outputPath);
	const relative = path.relative(root, target);
	if (
		relative === "" ||
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	) {
		throw new CliUsageError(
			"RUAM_CLI_OUTPUT_OVERLAP",
			"owner trace target escaped its declared root"
		);
	}
	await assertNoSymlinkDirectoryComponents(root, root);
	await assertNoSymlinkDirectoryComponents(path.dirname(target), root);
	const canonicalRoot = await canonicalizeProspectivePath(root);
	const canonicalTarget = await canonicalizeProspectivePath(target);
	if (!pathsOverlap(canonicalRoot, canonicalTarget)) {
		throw new CliUsageError(
			"RUAM_CLI_OUTPUT_OVERLAP",
			"owner trace target escaped its physical root"
		);
	}
}

async function assertNoSymlinkDirectoryComponents(
	targetDirectory: string,
	stopDirectory?: string
): Promise<void> {
	const stop =
		stopDirectory === undefined
			? path.parse(path.resolve(targetDirectory)).root
			: path.resolve(stopDirectory);
	let current = path.resolve(targetDirectory);
	const relativeToStop = path.relative(stop, current);
	if (
		relativeToStop === ".." ||
		relativeToStop.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relativeToStop)
	) {
		throw new CliUsageError(
			"RUAM_CLI_OUTPUT_OVERLAP",
			"owner trace target escaped its declared root"
		);
	}
	for (;;) {
		try {
			const stat = await fs.lstat(current);
			if (stat.isSymbolicLink() || !stat.isDirectory()) {
				throw new CliUsageError(
					"RUAM_CLI_OUTPUT_OVERLAP",
					"owner trace directories and ancestors must be non-symlink directories"
				);
			}
		} catch (error) {
			if (
				!(
					error &&
					typeof error === "object" &&
					"code" in error &&
					(error as NodeJS.ErrnoException).code === "ENOENT"
				)
			) {
				throw error;
			}
		}
		if (current === stop) break;
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
}

function commonPathAncestor(paths: readonly string[]): string {
	if (paths.length === 0) return path.parse(process.cwd()).root;
	const resolved = paths.map((candidate) => path.resolve(candidate));
	let common = resolved[0]!;
	while (
		resolved.some((candidate) => {
			const relative = path.relative(common, candidate);
			return (
				relative === ".." ||
				relative.startsWith(`..${path.sep}`) ||
				path.isAbsolute(relative)
			);
		})
	) {
		const parent = path.dirname(common);
		if (parent === common) return common;
		common = parent;
	}
	return common;
}

async function canonicalizeProspectivePath(filePath: string): Promise<string> {
	const resolved = path.resolve(filePath);
	let existing = resolved;
	for (;;) {
		try {
			await fs.lstat(existing);
			break;
		} catch (error) {
			if (
				!(
					error &&
					typeof error === "object" &&
					"code" in error &&
					(error as NodeJS.ErrnoException).code === "ENOENT"
				)
			) {
				throw error;
			}
			const parent = path.dirname(existing);
			if (parent === existing) throw error;
			existing = parent;
		}
	}
	const canonicalExisting = await fs.realpath(existing);
	return path.resolve(
		canonicalExisting,
		path.relative(existing, resolved)
	);
}

function pathsOverlap(left: string, right: string): boolean {
	const leftToRight = path.relative(left, right);
	const rightToLeft = path.relative(right, left);
	return (
		leftToRight === "" ||
		(!path.isAbsolute(leftToRight) &&
			leftToRight !== ".." &&
			!leftToRight.startsWith(`..${path.sep}`)) ||
		(!path.isAbsolute(rightToLeft) &&
			rightToLeft !== ".." &&
			!rightToLeft.startsWith(`..${path.sep}`))
	);
}

async function executeProtection(
	args: CliArgs,
	materialized: MaterializedCliOptions
): Promise<void> {
	if (args.input === undefined) {
		throw new CliUsageError(
			"RUAM_CLI_MISSING_VALUE",
			"an input path is required"
		);
	}
	const inputPath = path.resolve(args.input);
	if (!(await fs.pathExists(inputPath))) {
		throw new CliUsageError(
			"RUAM_CLI_MISSING_VALUE",
			`${args.input} does not exist`
		);
	}

	const stat = await fs.stat(inputPath);
	if (stat.isDirectory()) {
		await protectDirectoryWithProgress(inputPath, args, materialized);
	} else {
		await protectSingleFileWithProgress(inputPath, args, materialized);
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const version = await getVersion();

	if (args.help) {
		printHelp(version);
		return;
	}
	if (args.version) {
		console.log(version);
		return;
	}
	if (args.input === undefined || args.interactive) {
		if (!process.stdin.isTTY) {
			printHelp(version);
			process.exitCode = 1;
			return;
		}
		await runInteractive(version);
		return;
	}

	const materialized = await materializeOptions(args);
	const logo = new LogoAnimation();
	logo.start(version);
	if (process.stdout.isTTY) {
		await new Promise((resolve) => setTimeout(resolve, 800));
	}
	logo.stop();
	printConfig(materialized.resolved);
	console.log();
	await executeProtection(args, materialized);
}

main().catch((error) => {
	if (
		error &&
		typeof error === "object" &&
		"name" in error &&
		error.name === "ExitPromptError"
	) {
		console.log(chalk.dim("\n  Cancelled."));
		return;
	}
	console.error(
		chalk.red(error instanceof Error ? error.message : String(error))
	);
	process.exitCode = 1;
});
