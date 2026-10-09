/** Explicit research CLI, separate from the production VM command.
 * @module regional/cli
 */
import { protectRegionalPath } from "./files.js";

/** Run the regional experiment with no implicit production fallback. */
export async function runRegionalCli(argv: string[]): Promise<void> {
	if (argv.includes("--help") || argv.includes("-h")) {
		console.log(`Usage: ruam --regional-research <file-or-js-directory> -o <new-directory>

Experimental offline compiler. Protection strength is unqualified.
Directory inputs must contain only regular .js/.mjs files. All files are
inventoried; dependencies must be supplied, acyclic, static local imports.
The output directory must not exist. Sources are never overwritten.

  --entry <relative-path>  Module entry (repeatable; default: every input)
  --seed <uint32>          Deterministic recipe seed (default: 0)
  --no-fusion             Disable private-call fusion for an ablation
  --no-joint              Disable joint realization for an ablation
  --no-configuration      Disable configuration specialization
  --help                  Show this help`);
		return;
	}
	let input: string | undefined;
	let output: string | undefined;
	let seed = 0;
	const entries: string[] = [];
	const transformations = { fusion: true, joint: true, configuration: true };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		const value = () => {
			const result = argv[++i];
			if (!result || result.startsWith("-")) throw new Error(`Missing value for ${arg}`);
			return result;
		};
		switch (arg) {
			case "-o": case "--output":
				if (output) throw new Error("Only one regional output is allowed");
				output = value(); break;
			case "--entry": entries.push(value()); break;
			case "--seed": {
				const raw = value();
				if (!/^\d+$/.test(raw)) throw new Error("Seed must be a uint32 decimal integer");
				seed = Number(raw);
				if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Seed must be a uint32 decimal integer");
				break;
			}
			case "--no-fusion": transformations.fusion = false; break;
			case "--no-joint": transformations.joint = false; break;
			case "--no-configuration": transformations.configuration = false; break;
			default:
				if (arg.startsWith("-")) throw new Error(`Unknown regional option: ${arg}`);
				if (input) throw new Error("Only one regional input is allowed");
				input = arg;
		}
	}
	if (!input || !output) throw new Error("Regional research requires an input and -o <new-directory>");
	const build = await protectRegionalPath(input, output, {
		entryPoints: entries.length ? entries : undefined,
		compiler: { seed, ...transformations },
	});
	console.log(JSON.stringify({
		status: "experimental-unqualified",
		output,
		files: Object.keys(build.files),
		measuredResistance: false,
	}, null, 2));
}
