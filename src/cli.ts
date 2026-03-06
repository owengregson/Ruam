#!/usr/bin/env node

/**
 * Ruam CLI entry point.
 *
 * Usage:
 *   ruam <input>              Obfuscate a file or directory
 *   ruam <input> -o <output>  Obfuscate to a specific output path
 *
 * @module cli
 */

import { obfuscateFile } from "./index.js";
import type { VmObfuscationOptions } from "./types.js";
import fs from "fs-extra";
import path from "path";

// ---------------------------------------------------------------------------
// CLI argument types
// ---------------------------------------------------------------------------

interface CliArgs {
  input?: string;
  output?: string;
  options: VmObfuscationOptions;
  include: string[];
  exclude: string[];
  help: boolean;
  version: boolean;
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log(`
ruam - JS VM obfuscator

Usage:
  ruam <input>              Obfuscate a file or directory
  ruam <input> -o <output>  Obfuscate to a specific output path

Options:
  -o, --output <path>       Output file or directory (default: overwrite input)
  -m, --mode <mode>         Target mode: "root" (default) or "comment"
  -e, --encrypt             Enable bytecode encryption
  -p, --preprocess          Preprocess/rename identifiers
  -d, --debug-protection    Enable anti-debugger protection
  --debug-logging           Inject debug trace logging into VM runtime
  --include <glob>          File glob for directory mode (default: "**/*.js")
  --exclude <glob>          Exclude glob for directory mode (default: "**/node_modules/**")
  -h, --help                Show this help
  -v, --version             Show version

Examples:
  ruam app.js                       Obfuscate app.js in-place
  ruam app.js -o app.obf.js         Obfuscate to a new file
  ruam dist/                        Obfuscate all JS in dist/
  ruam dist/ -o build/              Obfuscate dist/ into build/
  ruam src/bg.js -m comment -e      Only obfuscate /* ruam:vm */ functions, with encryption
`.trim());
}

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): CliArgs {
  const result: CliArgs = {
    input: undefined,
    output: undefined,
    options: {},
    include: ["**/*.js"],
    exclude: ["**/node_modules/**"],
    help: false,
    version: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    switch (arg) {
      case "-h": case "--help":
        result.help = true; break;
      case "-v": case "--version":
        result.version = true; break;
      case "-o": case "--output":
        result.output = argv[++i]; break;
      case "-m": case "--mode":
        result.options.targetMode = argv[++i] as "root" | "comment"; break;
      case "-e": case "--encrypt":
        result.options.encryptBytecode = true; break;
      case "-p": case "--preprocess":
        result.options.preprocessIdentifiers = true; break;
      case "-d": case "--debug-protection":
        result.options.debugProtection = true; break;
      case "--debug-logging":
        result.options.debugLogging = true; break;
      case "--include":
        result.include = [argv[++i]!]; break;
      case "--exclude":
        result.exclude = [argv[++i]!]; break;
      default:
        if (arg.startsWith("-")) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
        result.input = arg;
        break;
    }
    i++;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  if (args.version) {
    const pkg = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf-8"));
    console.log(pkg.version);
    process.exit(0);
  }

  if (!args.input) {
    printUsage();
    process.exit(1);
  }

  const inputPath = path.resolve(args.input);

  if (!await fs.pathExists(inputPath)) {
    console.error(`Error: ${args.input} does not exist`);
    process.exit(1);
  }

  const stat = await fs.stat(inputPath);

  if (stat.isDirectory()) {
    await obfuscateDirectory(inputPath, args);
  } else {
    await obfuscateSingleFile(inputPath, args);
  }
}

async function obfuscateDirectory(inputPath: string, args: CliArgs): Promise<void> {
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

  console.log(`Obfuscating ${files.length} file(s) in ${path.relative(process.cwd(), outputDir) || "."}/`);

  for (const file of files) {
    const filePath = path.join(outputDir, file);
    await obfuscateFile(filePath, filePath, args.options);
    console.log(`  ${file}`);
  }

  console.log("Done.");
}

async function obfuscateSingleFile(inputPath: string, args: CliArgs): Promise<void> {
  const outputPath = args.output ? path.resolve(args.output) : inputPath;

  if (args.output) {
    await fs.ensureDir(path.dirname(outputPath));
  }

  await obfuscateFile(inputPath, outputPath, args.options);
  console.log(`Obfuscated ${path.relative(process.cwd(), inputPath)} -> ${path.relative(process.cwd(), outputPath)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
