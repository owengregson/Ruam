#!/usr/bin/env node

/**
 * CLI entry point for the `ruam` command.
 *
 * Features:
 * - Interactive wizard mode when no arguments provided
 * - Animated color-cycling ASCII art header
 * - Progress bar with per-file status for directory obfuscation
 * - Spinner with phase updates for single-file obfuscation
 * - Colored, sectioned help output
 *
 * @module cli
 */

import { obfuscateFile } from "./index.js";
import type {
	VmObfuscationOptions,
	PresetName,
	TargetEnvironment,
} from "./types.js";
import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import ora from "ora";

// --- Constants ---

/** Raw ASCII art lines for the RUAM logo. */
const LOGO_LINES = [
	`:::::::..    ...    :::  :::.     .        :`,
	`;;;;\`\`;;;;   ;;     ;;;  ;;\`;;    ;;,.    ;;;`,
	` [[[,/[[['  [['     [[[ ,[[ '[[,  [[[[, ,[[[[,`,
	` $$$$$$c    $$      $$$c$$$cc$$$c $$$$$$$$"$$$`,
	` 888b "88bo,88    .d888 888   888,888 Y88" 888o`,
	` MMMM   "W"  "YmmMMMM"" YMM   ""\` MMM  M'  "MMM`,
];

/** Color palette for the cycling logo animation (HSL hue rotation). */
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

/** Human-readable labels for boolean obfuscation options. */
import { OPTION_LABELS } from "./option-meta.js";

// --- CLI Argument Types ---

/** Parsed CLI arguments. */
interface CliArgs {
	input?: string;
	output?: string;
	options: VmObfuscationOptions;
	include: string[];
	exclude: string[];
	help: boolean;
	version: boolean;
	interactive: boolean;
}

// --- Animated Logo ---

/**
 * Renders the logo with a color gradient offset.
 * Each line gets a color from the palette, shifted by `offset`.
 *
 * @param offset - Palette rotation offset for animation frames.
 * @returns ANSI-colored logo string.
 */
function renderLogo(offset: number): string {
	const lines: string[] = [];
	for (let i = 0; i < LOGO_LINES.length; i++) {
		const colorIdx = (i + offset) % PALETTE.length;
		lines.push("  " + chalk.hex(PALETTE[colorIdx]!)(LOGO_LINES[i]!));
	}
	return lines.join("\n");
}

/**
 * Animated logo controller. Runs the color-cycling animation on a
 * setInterval so the main thread stays free for heavy compilation work.
 * Call `stop()` to freeze the logo in place.
 */
class LogoAnimation {
	private offset = 0;
	private timer: ReturnType<typeof setInterval> | null = null;
	private lineCount = LOGO_LINES.length + 2; // logo lines + tagline + blank

	/** Start the cycling animation (80ms per frame). */
	start(version: string): void {
		if (!process.stdout.isTTY) {
			// Non-TTY: print static logo once
			this.printStatic(version);
			return;
		}
		this.printFrame(version);
		this.timer = setInterval(() => {
			this.offset++;
			// Move cursor up and reprint
			process.stdout.write(`\x1b[${this.lineCount}A`);
			this.printFrame(version);
		}, 120);
	}

	/** Stop the animation and leave the last frame visible. */
	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	private printFrame(version: string): void {
		const logo = renderLogo(this.offset);
		const tagline =
			"  " +
			chalk.dim(`v${version}`) +
			chalk.dim(" \u2014 ") +
			chalk.dim.italic("Virtualization-Based JavaScript Obfuscation");
		process.stdout.write(logo + "\n" + tagline + "\n\n");
	}

	private printStatic(version: string): void {
		const logo = renderLogo(0);
		const tagline =
			"  " +
			chalk.dim(`v${version}`) +
			chalk.dim(" \u2014 ") +
			chalk.dim.italic("Virtualization-Based JavaScript Obfuscation");
		console.log(logo);
		console.log(tagline);
		console.log();
	}
}

// --- Utilities ---

/**
 * Render an inline progress bar.
 *
 * @param current - Items completed.
 * @param total - Total items.
 * @param width - Character width of the bar.
 * @returns Colored progress bar string.
 */
function renderBar(current: number, total: number, width = 28): string {
	const ratio = total > 0 ? current / total : 0;
	const filled = Math.round(ratio * width);
	const empty = width - filled;
	const pct = Math.round(ratio * 100)
		.toString()
		.padStart(3);
	return (
		chalk.cyan("\u2588".repeat(filled)) +
		chalk.dim("\u2591".repeat(empty)) +
		" " +
		chalk.dim(`${pct}%`) +
		" " +
		chalk.dim(`(${current}/${total})`)
	);
}

/** Format a byte count to a human-readable string. */
function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Format a millisecond duration to a human-readable string. */
function formatTime(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

/** Return the list of active protection layer labels from options. */
function getActiveLabels(options: VmObfuscationOptions): string[] {
	const active: string[] = [];
	for (const [key, label] of Object.entries(OPTION_LABELS)) {
		if (options[key as keyof VmObfuscationOptions]) {
			active.push(label);
		}
	}
	return active;
}

/** Read the package version from package.json. */
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

// --- Argument Parser ---

/**
 * Parse raw CLI arguments into a structured {@link CliArgs} object.
 *
 * @param argv - Arguments from `process.argv.slice(2)`.
 * @returns Parsed CLI arguments.
 */
function parseArgs(argv: string[]): CliArgs {
	const result: CliArgs = {
		input: undefined,
		output: undefined,
		options: {},
		include: ["**/*.js"],
		exclude: ["**/node_modules/**"],
		help: false,
		version: false,
		interactive: false,
	};

	let i = 0;

	/** Consume the next argument or exit with an error. */
	function nextArg(flag: string): string {
		if (++i >= argv.length) {
			console.error(chalk.red(`  Missing value for ${flag}`));
			process.exit(1);
		}
		return argv[i]!;
	}

	while (i < argv.length) {
		const arg = argv[i]!;
		switch (arg) {
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
				result.output = nextArg(arg);
				break;
			case "-m":
			case "--mode":
				result.options.targetMode = nextArg(arg) as "root" | "comment";
				break;
			case "--preset":
				result.options.preset = nextArg(arg) as PresetName;
				break;
			case "-e":
			case "--encrypt":
				result.options.encryptBytecode = true;
				break;
			case "-p":
			case "--preprocess":
				result.options.preprocessIdentifiers = true;
				break;
			case "-d":
			case "--debug-protection":
				result.options.debugProtection = true;
				break;
			case "--no-debug-protection":
				result.options.debugProtection = false;
				break;
			case "--debug-logging":
				result.options.debugLogging = true;
				break;
			case "--dynamic-opcodes":
				result.options.dynamicOpcodes = true;
				break;
			case "--decoy-opcodes":
				result.options.decoyOpcodes = true;
				break;
			case "--dead-code":
				result.options.deadCodeInjection = true;
				break;
			case "--stack-encoding":
				result.options.stackEncoding = true;
				break;
			case "--rolling-cipher":
				result.options.rollingCipher = true;
				break;
			case "--integrity-binding":
				result.options.integrityBinding = true;
				break;
			case "--vm-shielding":
				result.options.vmShielding = true;
				break;
			case "--mba":
				result.options.mixedBooleanArithmetic = true;
				break;
			case "--handler-fragmentation":
				result.options.handlerFragmentation = true;
				break;
			case "--string-atomization":
				result.options.stringAtomization = true;
				break;
			case "--polymorphic-decoder":
				result.options.polymorphicDecoder = true;
				break;
			case "--scattered-keys":
				result.options.scatteredKeys = true;
				break;
			case "--block-permutation":
				result.options.blockPermutation = true;
				break;
			case "--opcode-mutation":
				result.options.opcodeMutation = true;
				break;
			case "--bytecode-scattering":
				result.options.bytecodeScattering = true;
				break;
			case "--target":
				result.options.target = nextArg(arg) as TargetEnvironment;
				break;
			case "--include":
				result.include = [nextArg(arg)];
				break;
			case "--exclude":
				result.exclude = [nextArg(arg)];
				break;
			default:
				if (arg.startsWith("-")) {
					console.error(chalk.red(`  Unknown option: ${arg}`));
					console.error(
						chalk.dim("  Run ruam --help for usage information")
					);
					process.exit(1);
				}
				result.input = arg;
				break;
		}
		i++;
	}

	return result;
}

// --- Help ---

/** Print the colored help text with the animated header frozen after one frame. */
function printHelp(version: string): void {
	console.log();
	console.log(renderLogo(0));
	console.log(
		"  " +
			chalk.dim(`v${version}`) +
			chalk.dim(" \u2014 ") +
			chalk.dim.italic("Virtualization-Based JavaScript Obfuscation")
	);
	console.log();

	const h = chalk.bold.white;
	const f = chalk.cyan;
	const d = chalk.dim;
	const a = chalk.yellow;

	console.log(h("  USAGE"));
	console.log(
		`    ${f("ruam")} ${a(
			"<input>"
		)}              Obfuscate a file or directory`
	);
	console.log(
		`    ${f("ruam")} ${a("<input>")} -o ${a(
			"<output>"
		)}  Obfuscate to a specific output path`
	);
	console.log(
		`    ${f("ruam")}                        Launch interactive wizard`
	);
	console.log();

	console.log(h("  PRESETS"));
	console.log(
		`    ${f("--preset")} ${a("<name>")}           ${d(
			"low, medium, or max"
		)}`
	);
	console.log(`      ${chalk.green("low")}     VM compilation only`);
	console.log(
		`      ${chalk.yellow(
			"medium"
		)}  + renaming, encryption, rolling cipher, decoy/dynamic opcodes`
	);
	console.log(`      ${chalk.red("max")}     All protections enabled`);
	console.log();

	console.log(h("  OUTPUT"));
	console.log(
		`    ${f("-o, --output")} ${a(
			"<path>"
		)}       Output file or directory ${d("(default: overwrite)")}`
	);
	console.log();

	console.log(h("  COMPILATION"));
	console.log(
		`    ${f("-m, --mode")} ${a(
			"<mode>"
		)}         Target mode: "root" or "comment"`
	);
	console.log(
		`    ${f("-e, --encrypt")}             Enable bytecode encryption`
	);
	console.log(
		`    ${f("-p, --preprocess")}           Preprocess/rename identifiers`
	);
	console.log();

	console.log(h("  SECURITY"));
	console.log(
		`    ${f("-d, --debug-protection")}     Anti-debugger timing loop`
	);
	console.log(
		`    ${f(
			"--no-debug-protection"
		)}        Disable anti-debugger (overrides preset)`
	);
	console.log(
		`    ${f(
			"--rolling-cipher"
		)}           Position-dependent instruction encryption`
	);
	console.log(
		`    ${f(
			"--integrity-binding"
		)}        Bind decryption to interpreter integrity`
	);
	console.log();

	console.log(h("  HARDENING"));
	console.log(
		`    ${f("--dynamic-opcodes")}         Filter unused opcode handlers`
	);
	console.log(
		`    ${f("--decoy-opcodes")}           Inject fake opcode handlers`
	);
	console.log(
		`    ${f("--dead-code")}               Inject dead bytecode sequences`
	);
	console.log(
		`    ${f("--stack-encoding")}           Encrypt values on the VM stack`
	);
	console.log(
		`    ${f("--vm-shielding")}            Per-function micro-interpreters`
	);
	console.log(
		`    ${f(
			"--mba"
		)}                      Mixed boolean arithmetic obfuscation`
	);
	console.log(
		`    ${f(
			"--handler-fragmentation"
		)}   Split handlers into interleaved fragments`
	);
	console.log(
		`    ${f(
			"--string-atomization"
		)}    Encode interpreter strings as table lookups`
	);
	console.log(
		`    ${f(
			"--polymorphic-decoder"
		)}   Per-build randomized string decoder`
	);
	console.log(
		`    ${f(
			"--scattered-keys"
		)}        Scatter key material across closure scopes`
	);
	console.log(
		`    ${f(
			"--block-permutation"
		)}     Shuffle bytecode basic block order`
	);
	console.log(
		`    ${f(
			"--opcode-mutation"
		)}       Runtime handler table mutations`
	);
	console.log(
		`    ${f(
			"--bytecode-scattering"
		)}   Scatter bytecode into mixed-type fragments`
	);
	console.log();

	console.log(h("  FILES"));
	console.log(
		`    ${f("--include")} ${a(
			"<glob>"
		)}          File glob for directories ${d('(default: "**/*.js")')}`
	);
	console.log(
		`    ${f("--exclude")} ${a("<glob>")}          Exclude glob ${d(
			'(default: "**/node_modules/**")'
		)}`
	);
	console.log();

	console.log(h("  ENVIRONMENT"));
	console.log(
		`    ${f("--target")} ${a("<env>")}             Target environment`
	);
	console.log(
		`      ${chalk.cyan("node")}               Node.js (CJS / ESM)`
	);
	console.log(
		`      ${chalk.cyan("browser")}            Plain browser scripts ${d(
			"(default)"
		)}`
	);
	console.log(
		`      ${chalk.cyan("browser-extension")}  Chrome extension MAIN world`
	);
	console.log();

	console.log(h("  OTHER"));
	console.log(
		`    ${f("--debug-logging")}           Inject VM trace logging`
	);
	console.log(
		`    ${f("-I, --interactive")}          Force interactive wizard mode`
	);
	console.log(`    ${f("-h, --help")}                Show this help`);
	console.log(`    ${f("-v, --version")}             Show version`);
	console.log();

	console.log(h("  EXAMPLES"));
	console.log(
		`    ${d("$")} ${f("ruam")} app.js                     ${d(
			"# Obfuscate in-place"
		)}`
	);
	console.log(
		`    ${d("$")} ${f("ruam")} app.js -o app.obf.js       ${d(
			"# Obfuscate to new file"
		)}`
	);
	console.log(
		`    ${d("$")} ${f("ruam")} dist/ --preset medium      ${d(
			"# Directory with preset"
		)}`
	);
	console.log(
		`    ${d("$")} ${f("ruam")} src/bg.js -m comment -e    ${d(
			"# Selective + encryption"
		)}`
	);
	console.log(
		`    ${d("$")} ${f("ruam")}                            ${d(
			"# Interactive wizard"
		)}`
	);
	console.log();
}

// --- Config Summary ---

/** Print a summary of the resolved configuration. */
function printConfig(options: VmObfuscationOptions): void {
	const active = getActiveLabels(options);
	if (options.preset) {
		const presetColor =
			options.preset === "max"
				? chalk.red
				: options.preset === "medium"
				? chalk.yellow
				: chalk.green;
		process.stdout.write(
			`  ${chalk.dim("Preset:")} ${presetColor(options.preset)}`
		);
		if (active.length > 0) {
			process.stdout.write(
				chalk.dim(" + ") +
					active.map((l) => chalk.cyan(l)).join(chalk.dim(", "))
			);
		}
		process.stdout.write("\n");
	} else if (active.length > 0) {
		console.log(
			`  ${chalk.dim("Layers:")} ${active
				.map((l) => chalk.cyan(l))
				.join(chalk.dim(", "))}`
		);
	}

	if (options.targetMode === "comment") {
		console.log(
			`  ${chalk.dim("Mode:")}   ${chalk.white("comment")} ${chalk.dim(
				"(only /* ruam:vm */ functions)"
			)}`
		);
	}
}

// --- Interactive Wizard ---

/**
 * Launch the interactive configuration wizard.
 * Prompts the user for input path, output, preset, options, and target mode,
 * then runs the obfuscation with progress.
 *
 * @param version - Package version string.
 */
async function runInteractive(version: string): Promise<void> {
	const logo = new LogoAnimation();
	logo.start(version);

	// Small delay to let the user see the animation before prompts appear
	await new Promise((r) => setTimeout(r, 600));
	logo.stop();

	const {
		input: promptInput,
		select,
		checkbox,
		confirm,
	} = await import("@inquirer/prompts");

	// --- Input path ---
	const inputRaw = await promptInput({
		message: chalk.bold("Input path") + chalk.dim(" (file or directory)"),
		validate: async (val: string) => {
			if (!val.trim()) return "Please enter a path";
			if (!(await fs.pathExists(path.resolve(val.trim()))))
				return `Path does not exist: ${val}`;
			return true;
		},
	});

	const resolvedInput = path.resolve(inputRaw.trim());
	const stat = await fs.stat(resolvedInput);
	const isDir = stat.isDirectory();

	// --- Output path ---
	const outputRaw = await promptInput({
		message:
			chalk.bold("Output path") +
			chalk.dim(` (enter to overwrite${isDir ? " directory" : ""})`),
		default: "",
	});

	// --- Preset ---
	const preset = await select<PresetName | "custom">({
		message: chalk.bold("Protection preset"),
		choices: [
			{
				name: `${chalk.green("low")}     ${chalk.dim(
					"\u2014 VM compilation only"
				)}`,
				value: "low" as const,
			},
			{
				name: `${chalk.yellow("medium")}  ${chalk.dim(
					"\u2014 + encryption, rolling cipher, decoy opcodes"
				)}`,
				value: "medium" as const,
			},
			{
				name: `${chalk.red("max")}     ${chalk.dim(
					"\u2014 All protections enabled"
				)}`,
				value: "max" as const,
			},
			{
				name: `${chalk.cyan("custom")}  ${chalk.dim(
					"\u2014 Choose individual options"
				)}`,
				value: "custom" as const,
			},
		],
	});

	const options: VmObfuscationOptions = {};

	if (preset !== "custom") {
		options.preset = preset;
	} else {
		const selected = await checkbox({
			message: chalk.bold("Select protection layers"),
			choices: [
				{ name: "Identifier Renaming", value: "preprocessIdentifiers" },
				{ name: "Bytecode Encryption", value: "encryptBytecode" },
				{ name: "Rolling Cipher", value: "rollingCipher" },
				{ name: "Integrity Binding", value: "integrityBinding" },
				{ name: "Debug Protection", value: "debugProtection" },
				{ name: "Dynamic Opcodes", value: "dynamicOpcodes" },
				{ name: "Decoy Opcodes", value: "decoyOpcodes" },
				{ name: "Dead Code Injection", value: "deadCodeInjection" },
				{ name: "Stack Encoding", value: "stackEncoding" },
				{ name: "VM Shielding", value: "vmShielding" },
				{ name: "Mixed Boolean Arithmetic", value: "mixedBooleanArithmetic" },
				{ name: "Handler Fragmentation", value: "handlerFragmentation" },
			{ name: "String Atomization", value: "stringAtomization" },
			{ name: "Polymorphic Decoder", value: "polymorphicDecoder" },
			{ name: "Scattered Keys", value: "scatteredKeys" },
			{ name: "Block Permutation", value: "blockPermutation" },
			{ name: "Opcode Mutation", value: "opcodeMutation" },
			{ name: "Bytecode Scattering", value: "bytecodeScattering" },
			],
		});
		for (const opt of selected) {
			(options as Record<string, boolean>)[opt] = true;
		}
	}

	// --- Target mode ---
	const targetMode = await select<"root" | "comment">({
		message: chalk.bold("Target mode"),
		choices: [
			{
				name: `${chalk.cyan("root")}     ${chalk.dim(
					"\u2014 All top-level functions"
				)}`,
				value: "root" as const,
			},
			{
				name: `${chalk.cyan("comment")}  ${chalk.dim(
					"\u2014 Only /* ruam:vm */ annotated functions"
				)}`,
				value: "comment" as const,
			},
		],
	});
	options.targetMode = targetMode;

	// --- Summary ---
	console.log();
	console.log(chalk.bold("  Configuration"));
	console.log(chalk.dim("  " + "\u2500".repeat(40)));
	console.log(
		`  ${chalk.dim("Input:")}    ${chalk.white(
			path.relative(process.cwd(), resolvedInput) || "."
		)}`
	);
	console.log(
		`  ${chalk.dim("Output:")}   ${
			outputRaw.trim()
				? chalk.white(outputRaw.trim())
				: chalk.dim("overwrite input")
		}`
	);

	if (preset !== "custom") {
		const pc =
			preset === "max"
				? chalk.red
				: preset === "medium"
				? chalk.yellow
				: chalk.green;
		console.log(`  ${chalk.dim("Preset:")}   ${pc(preset)}`);
	}

	console.log(`  ${chalk.dim("Mode:")}     ${chalk.white(targetMode)}`);

	const active = getActiveLabels(options);
	if (active.length > 0) {
		console.log(
			`  ${chalk.dim("Layers:")}   ${active
				.map((l) => chalk.cyan(l))
				.join(chalk.dim(", "))}`
		);
	}
	console.log();

	// --- Confirm ---
	const proceed = await confirm({
		message: chalk.bold("Proceed with obfuscation?"),
		default: true,
	});

	if (!proceed) {
		console.log(chalk.dim("  Cancelled."));
		process.exit(0);
	}

	console.log();

	// --- Run ---
	const args: CliArgs = {
		input: resolvedInput,
		output: outputRaw.trim() || undefined,
		options,
		include: ["**/*.js"],
		exclude: ["**/node_modules/**"],
		help: false,
		version: false,
		interactive: false,
	};

	if (isDir) {
		await obfuscateDirectoryWithProgress(resolvedInput, args);
	} else {
		await obfuscateSingleFileWithProgress(resolvedInput, args);
	}
}

// --- Single File Obfuscation ---

/**
 * Obfuscate a single file with a spinner and summary output.
 *
 * @param inputPath - Absolute path to the input file.
 * @param args - Parsed CLI arguments.
 */
async function obfuscateSingleFileWithProgress(
	inputPath: string,
	args: CliArgs
): Promise<void> {
	const outputPath = args.output ? path.resolve(args.output) : inputPath;

	if (args.output) {
		await fs.ensureDir(path.dirname(outputPath));
	}

	const inputSize = (await fs.stat(inputPath)).size;
	const relInput = path.relative(process.cwd(), inputPath);
	const relOutput = path.relative(process.cwd(), outputPath);

	const spinner = ora({
		text: `Obfuscating ${chalk.cyan(relInput)}...`,
		prefixText: " ",
		color: "cyan",
	}).start();

	const startTime = Date.now();

	try {
		await obfuscateFile(inputPath, outputPath, args.options);
	} catch (err) {
		spinner.fail(chalk.red("Obfuscation failed"));
		console.error(
			chalk.red("  " + (err instanceof Error ? err.message : String(err)))
		);
		process.exit(1);
	}

	const elapsed = Date.now() - startTime;
	const outputSize = (await fs.stat(outputPath)).size;
	const ratio = (outputSize / inputSize).toFixed(1);

	spinner.succeed(chalk.green("Obfuscation complete"));

	console.log();
	console.log(
		`  ${chalk.dim("File:")}     ${chalk.white(relInput)}${
			relInput !== relOutput
				? chalk.dim(" \u2192 ") + chalk.white(relOutput)
				: ""
		}`
	);
	console.log(
		`  ${chalk.dim("Input:")}    ${chalk.white(formatBytes(inputSize))}`
	);
	console.log(
		`  ${chalk.dim("Output:")}   ${chalk.white(
			formatBytes(outputSize)
		)} ${chalk.dim(`(${ratio}\u00d7)`)}`
	);
	console.log(
		`  ${chalk.dim("Time:")}     ${chalk.white(formatTime(elapsed))}`
	);
	console.log();
}

// --- Directory Obfuscation ---

/**
 * Obfuscate all matching files in a directory with a progress bar.
 *
 * @param inputPath - Absolute path to the input directory.
 * @param args - Parsed CLI arguments.
 */
async function obfuscateDirectoryWithProgress(
	inputPath: string,
	args: CliArgs
): Promise<void> {
	const outputDir = args.output ? path.resolve(args.output) : inputPath;

	if (outputDir !== inputPath) {
		await fs.copy(inputPath, outputDir);
	}

	const { globby } = await import("globby");
	const files = await globby(args.include, {
		cwd: outputDir,
		ignore: args.exclude,
		absolute: false,
	});

	if (files.length === 0) {
		console.log(chalk.yellow("  No matching files found."));
		return;
	}

	const relDir = path.relative(process.cwd(), outputDir) || ".";
	console.log(
		`  ${chalk.dim("Directory:")} ${chalk.white(relDir)} ${chalk.dim(
			`(${files.length} file${files.length === 1 ? "" : "s"})`
		)}`
	);
	console.log();

	const startTime = Date.now();
	let totalInputSize = 0;
	let totalOutputSize = 0;
	let errorCount = 0;
	const errors: { file: string; message: string }[] = [];

	const spinner = ora({
		text: "",
		prefixText: " ",
		color: "cyan",
	}).start();

	for (let i = 0; i < files.length; i++) {
		const file = files[i]!;
		const filePath = path.join(outputDir, file);

		let inputSize: number;
		try {
			inputSize = (await fs.stat(filePath)).size;
		} catch {
			inputSize = 0;
		}
		totalInputSize += inputSize;

		spinner.text = `${renderBar(i, files.length)} ${chalk.dim(file)}`;

		try {
			await obfuscateFile(filePath, filePath, args.options);
			const outputSize = (await fs.stat(filePath)).size;
			totalOutputSize += outputSize;
		} catch (err) {
			errorCount++;
			errors.push({
				file,
				message: err instanceof Error ? err.message : String(err),
			});
		}
	}

	const elapsed = Date.now() - startTime;
	const successCount = files.length - errorCount;
	const ratio =
		totalInputSize > 0
			? (totalOutputSize / totalInputSize).toFixed(1)
			: "0";

	if (errorCount === 0) {
		spinner.succeed(
			chalk.green(
				`${successCount} file${
					successCount === 1 ? "" : "s"
				} obfuscated`
			)
		);
	} else {
		spinner.warn(
			chalk.yellow(`${successCount} obfuscated, ${errorCount} failed`)
		);
	}

	console.log();
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
		`  ${chalk.dim("Time:")}     ${chalk.white(formatTime(elapsed))}`
	);

	if (errors.length > 0) {
		console.log();
		console.log(chalk.red("  Errors:"));
		for (const e of errors) {
			console.log(
				`    ${chalk.red("\u2717")} ${chalk.dim(e.file)}: ${e.message}`
			);
		}
	}

	console.log();
}

// --- Main ---

/** CLI entry point. Routes to interactive wizard, help, or direct obfuscation. */
async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const version = await getVersion();

	if (args.help) {
		printHelp(version);
		process.exit(0);
	}

	if (args.version) {
		console.log(version);
		process.exit(0);
	}

	// Interactive mode: no input provided or explicit --interactive
	if (!args.input || args.interactive) {
		if (!process.stdin.isTTY) {
			printHelp(version);
			process.exit(1);
		}
		await runInteractive(version);
		return;
	}

	// --- Direct mode ---
	const inputPath = path.resolve(args.input);

	if (!(await fs.pathExists(inputPath))) {
		console.error(chalk.red(`  Error: ${args.input} does not exist`));
		process.exit(1);
	}

	// Show animated logo briefly, then proceed
	const logo = new LogoAnimation();
	logo.start(version);
	await new Promise((r) => setTimeout(r, 800));
	logo.stop();

	printConfig(args.options);
	console.log();

	const stat = await fs.stat(inputPath);

	if (stat.isDirectory()) {
		await obfuscateDirectoryWithProgress(inputPath, args);
	} else {
		await obfuscateSingleFileWithProgress(inputPath, args);
	}
}

main().catch((err) => {
	// Handle Ctrl+C from @inquirer/prompts
	if (
		err &&
		typeof err === "object" &&
		"name" in err &&
		err.name === "ExitPromptError"
	) {
		console.log(chalk.dim("\n  Cancelled."));
		process.exit(0);
	}
	console.error(chalk.red(err instanceof Error ? err.message : String(err)));
	process.exit(1);
});
