"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	faPlay,
	faCopy,
	faCheck,
	faDownload,
	faSpinner,
	faChevronDown,
	faChevronUp,
} from "@fortawesome/free-solid-svg-icons";

// --- Types ---

type PresetName = "low" | "medium" | "max";
type TargetEnv = "node" | "browser" | "browser-extension";

interface ObfuscationOptions {
	preset?: PresetName;
	target?: TargetEnv;
	preprocessIdentifiers?: boolean;
	encryptBytecode?: boolean;
	rollingCipher?: boolean;
	integrityBinding?: boolean;
	debugProtection?: boolean;
	vmShielding?: boolean;
	mixedBooleanArithmetic?: boolean;
	stackEncoding?: boolean;
	deadCodeInjection?: boolean;
	decoyOpcodes?: boolean;
	dynamicOpcodes?: boolean;
	handlerFragmentation?: boolean;
}

// --- Preset defaults (mirrors src/presets.ts) ---

const PRESET_DEFAULTS: Record<
	PresetName,
	Required<Omit<ObfuscationOptions, "preset" | "target">>
> = {
	low: {
		preprocessIdentifiers: false,
		encryptBytecode: false,
		rollingCipher: false,
		integrityBinding: false,
		debugProtection: false,
		vmShielding: false,
		mixedBooleanArithmetic: false,
		stackEncoding: false,
		deadCodeInjection: false,
		decoyOpcodes: false,
		dynamicOpcodes: false,
		handlerFragmentation: false,
	},
	medium: {
		preprocessIdentifiers: true,
		encryptBytecode: true,
		rollingCipher: true,
		integrityBinding: false,
		debugProtection: false,
		vmShielding: false,
		mixedBooleanArithmetic: false,
		stackEncoding: false,
		deadCodeInjection: false,
		decoyOpcodes: true,
		dynamicOpcodes: true,
		handlerFragmentation: false,
	},
	max: {
		preprocessIdentifiers: true,
		encryptBytecode: true,
		rollingCipher: true,
		integrityBinding: true,
		debugProtection: true,
		vmShielding: true,
		mixedBooleanArithmetic: true,
		stackEncoding: true,
		deadCodeInjection: true,
		decoyOpcodes: true,
		dynamicOpcodes: true,
		handlerFragmentation: true,
	},
};

// --- Option metadata for UI ---

interface OptionMeta {
	key: keyof typeof PRESET_DEFAULTS.low;
	label: string;
	group: "security" | "obfuscation" | "optimization";
}

const OPTIONS: OptionMeta[] = [
	{ key: "rollingCipher", label: "rolling cipher", group: "security" },
	{
		key: "integrityBinding",
		label: "integrity binding",
		group: "security",
	},
	{
		key: "debugProtection",
		label: "debug protection",
		group: "security",
	},
	{ key: "vmShielding", label: "VM shielding", group: "security" },
	{ key: "encryptBytecode", label: "encrypt bytecode", group: "security" },
	{
		key: "mixedBooleanArithmetic",
		label: "MBA",
		group: "obfuscation",
	},
	{ key: "stackEncoding", label: "stack encoding", group: "obfuscation" },
	{
		key: "deadCodeInjection",
		label: "dead code injection",
		group: "obfuscation",
	},
	{
		key: "handlerFragmentation",
		label: "handler fragmentation",
		group: "obfuscation",
	},
	{
		key: "preprocessIdentifiers",
		label: "rename identifiers",
		group: "optimization",
	},
	{ key: "dynamicOpcodes", label: "dynamic opcodes", group: "optimization" },
	{ key: "decoyOpcodes", label: "decoy opcodes", group: "optimization" },
];

// --- Default input code ---

const DEFAULT_CODE = `function fibonacci(n) {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  return b;
}`;

// --- CodeMirror dynamic loader ---

function useCodeMirror(
	containerRef: React.RefObject<HTMLDivElement | null>,
	initialValue: string,
	readOnly: boolean,
	onChangeRef: React.MutableRefObject<((val: string) => void) | null>
) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const viewRef = useRef<any>(null);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		if (!containerRef.current) return;

		let destroyed = false;

		(async () => {
			const { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } =
				await import("@codemirror/view");
			const { EditorState } = await import("@codemirror/state");
			const { javascript } = await import(
				"@codemirror/lang-javascript"
			);
			const {
				syntaxHighlighting,
				defaultHighlightStyle,
				bracketMatching,
			} = await import("@codemirror/language");
			const { defaultKeymap, history, historyKeymap } = await import(
				"@codemirror/commands"
			);

			if (destroyed || !containerRef.current) return;

			// Custom dark theme matching Ruam's design
			const ruamTheme = EditorView.theme(
				{
					"&": {
						backgroundColor: "#0d1117",
						color: "#e8ecf5",
						fontSize: "13px",
						fontFamily:
							'"Fira Code", "JetBrains Mono", ui-monospace, monospace',
					},
					".cm-content": {
						caretColor: "#7fadfe",
						padding: "16px 0",
					},
					".cm-cursor": {
						borderLeftColor: "#7fadfe",
					},
					"&.cm-focused .cm-cursor": {
						borderLeftColor: "#7fadfe",
					},
					"&.cm-focused .cm-selectionBackground, ::selection": {
						backgroundColor: "rgba(127, 173, 254, 0.2) !important",
					},
					".cm-selectionBackground": {
						backgroundColor: "rgba(127, 173, 254, 0.15) !important",
					},
					".cm-gutters": {
						backgroundColor: "#0d1117",
						color: "#4a5580",
						border: "none",
						paddingLeft: "8px",
					},
					".cm-activeLineGutter": {
						backgroundColor: "transparent",
						color: "#7a85a8",
					},
					".cm-activeLine": {
						backgroundColor: "rgba(127, 173, 254, 0.04)",
					},
					".cm-line": {
						padding: "0 16px",
					},
				},
				{ dark: true }
			);

			// Syntax highlighting colors matching Ruam's palette
			const { HighlightStyle } = await import("@codemirror/language");
			const { tags } = await import("@lezer/highlight");

			const ruamHighlight = HighlightStyle.define([
				{ tag: tags.keyword, color: "#ff79c6" },
				{ tag: tags.definitionKeyword, color: "#ff79c6" },
				{ tag: tags.controlKeyword, color: "#ff79c6" },
				{ tag: tags.operatorKeyword, color: "#ff79c6" },
				{ tag: tags.moduleKeyword, color: "#ff79c6" },
				{ tag: tags.function(tags.variableName), color: "#7fadfe" },
				{
					tag: tags.function(tags.definition(tags.variableName)),
					color: "#7fadfe",
				},
				{ tag: tags.variableName, color: "#e8ecf5" },
				{
					tag: tags.definition(tags.variableName),
					color: "#e8ecf5",
				},
				{ tag: tags.propertyName, color: "#e8ecf5" },
				{ tag: tags.number, color: "#bd93f9" },
				{ tag: tags.string, color: "#50fa7b" },
				{ tag: tags.regexp, color: "#ff5555" },
				{ tag: tags.comment, color: "#4a5580" },
				{ tag: tags.bool, color: "#bd93f9" },
				{ tag: tags.null, color: "#bd93f9" },
				{ tag: tags.operator, color: "#ff79c6" },
				{ tag: tags.punctuation, color: "#b0b8d5" },
				{ tag: tags.bracket, color: "#b0b8d5" },
				{ tag: tags.paren, color: "#b0b8d5" },
				{ tag: tags.brace, color: "#b0b8d5" },
				{ tag: tags.typeName, color: "#7fadfe" },
				{ tag: tags.className, color: "#7fadfe" },
			]);

			const extensions = [
				ruamTheme,
				syntaxHighlighting(ruamHighlight),
				javascript(),
				lineNumbers(),
				bracketMatching(),
				EditorView.lineWrapping,
			];

			if (readOnly) {
				extensions.push(EditorState.readOnly.of(true));
				extensions.push(EditorView.editable.of(false));
			} else {
				extensions.push(history());
				extensions.push(
					keymap.of([...defaultKeymap, ...historyKeymap])
				);
				extensions.push(highlightActiveLine());
				extensions.push(highlightActiveLineGutter());
				extensions.push(
					EditorView.updateListener.of((update) => {
						if (update.docChanged && onChangeRef.current) {
							onChangeRef.current(
								update.state.doc.toString()
							);
						}
					})
				);
			}

			const state = EditorState.create({
				doc: initialValue,
				extensions,
			});

			const view = new EditorView({
				state,
				parent: containerRef.current!,
			});

			viewRef.current = view;
			setLoaded(true);
		})();

		return () => {
			destroyed = true;
			viewRef.current?.destroy();
			viewRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return { viewRef, loaded };
}

// --- Worker hook ---

function useWorker() {
	const workerRef = useRef<Worker | null>(null);
	const idRef = useRef(0);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
		const w = new Worker(`${basePath}/ruam-worker.mjs`, {
			type: "module",
		});
		workerRef.current = w;
		setReady(true);
		return () => {
			w.terminate();
			workerRef.current = null;
		};
	}, []);

	const obfuscate = useCallback(
		(code: string, options: ObfuscationOptions) =>
			new Promise<{ result: string; elapsed: number }>(
				(resolve, reject) => {
					if (!workerRef.current) {
						reject(new Error("Worker not ready"));
						return;
					}
					const id = ++idRef.current;
					const handler = (e: MessageEvent) => {
						if (e.data.id !== id) return;
						workerRef.current?.removeEventListener(
							"message",
							handler
						);
						workerRef.current?.removeEventListener(
							"error",
							errHandler
						);
						if (e.data.error) {
							reject(new Error(e.data.error));
						} else {
							resolve({
								result: e.data.result,
								elapsed: e.data.elapsed,
							});
						}
					};
					const errHandler = (e: ErrorEvent) => {
						workerRef.current?.removeEventListener(
							"message",
							handler
						);
						workerRef.current?.removeEventListener(
							"error",
							errHandler
						);
						reject(new Error(e.message || "Worker error"));
					};
					workerRef.current.addEventListener("message", handler);
					workerRef.current.addEventListener("error", errHandler);
					workerRef.current.postMessage({ id, code, options });
				}
			),
		[]
	);

	return { ready, obfuscate };
}

// --- Playground component ---

export default function Playground() {
	// --- State ---
	const [preset, setPreset] = useState<PresetName>("medium");
	const [target, setTarget] = useState<TargetEnv>("browser");
	const [toggles, setToggles] = useState(PRESET_DEFAULTS.medium);
	const [isCustom, setIsCustom] = useState(false);
	const [optionsOpen, setOptionsOpen] = useState(false);

	const [output, setOutput] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [running, setRunning] = useState(false);
	const [elapsed, setElapsed] = useState<number | null>(null);
	const [copied, setCopied] = useState(false);

	const inputRef = useRef<HTMLDivElement>(null);
	const outputRef = useRef<HTMLDivElement>(null);
	const codeRef = useRef(DEFAULT_CODE);
	const onChangeRef = useRef<((val: string) => void) | null>(null);

	onChangeRef.current = (val: string) => {
		codeRef.current = val;
	};

	const { viewRef: inputViewRef, loaded: inputLoaded } = useCodeMirror(
		inputRef,
		DEFAULT_CODE,
		false,
		onChangeRef
	);
	const { viewRef: outputViewRef, loaded: outputLoaded } = useCodeMirror(
		outputRef,
		"// Output will appear here after obfuscation",
		true,
		{ current: null }
	);

	const { ready: workerReady, obfuscate } = useWorker();

	const allLoaded = inputLoaded && outputLoaded && workerReady;

	// --- Preset selection ---
	const selectPreset = useCallback((name: PresetName) => {
		setPreset(name);
		setToggles(PRESET_DEFAULTS[name]);
		setIsCustom(false);
	}, []);

	// --- Toggle individual option ---
	const toggleOption = useCallback(
		(key: keyof typeof PRESET_DEFAULTS.low) => {
			setToggles((prev) => {
				const next = { ...prev, [key]: !prev[key] };
				// Check if it still matches a preset
				const matchesPreset = (["low", "medium", "max"] as const).find(
					(p) => {
						const pd = PRESET_DEFAULTS[p];
						return (Object.keys(pd) as (keyof typeof pd)[]).every(
							(k) => pd[k] === next[k]
						);
					}
				);
				if (matchesPreset) {
					setPreset(matchesPreset);
					setIsCustom(false);
				} else {
					setIsCustom(true);
				}
				return next;
			});
		},
		[]
	);

	// --- Run obfuscation ---
	const run = useCallback(async () => {
		if (running || !allLoaded) return;
		setRunning(true);
		setError(null);
		setElapsed(null);

		const options: ObfuscationOptions = {
			...(isCustom ? toggles : { preset }),
			target,
		};

		try {
			const { result, elapsed: ms } = await obfuscate(
				codeRef.current,
				options
			);
			setOutput(result);
			setElapsed(ms);

			// Update output editor
			if (outputViewRef.current) {
				const { EditorState } = await import("@codemirror/state");
				outputViewRef.current.dispatch({
					changes: {
						from: 0,
						to: outputViewRef.current.state.doc.length,
						insert: result,
					},
				});
			}
		} catch (err: unknown) {
			const msg =
				err instanceof Error ? err.message : String(err);
			setError(msg);
			setOutput("");
			if (outputViewRef.current) {
				outputViewRef.current.dispatch({
					changes: {
						from: 0,
						to: outputViewRef.current.state.doc.length,
						insert: `// Error: ${msg}`,
					},
				});
			}
		} finally {
			setRunning(false);
		}
	}, [running, allLoaded, isCustom, toggles, preset, target, obfuscate, outputViewRef]);

	// --- Copy output ---
	const copyOutput = useCallback(() => {
		if (!output) return;
		navigator.clipboard.writeText(output);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [output]);

	// --- Download output ---
	const download = useCallback(() => {
		if (!output) return;
		const blob = new Blob([output], { type: "text/javascript" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "obfuscated.js";
		a.click();
		URL.revokeObjectURL(url);
	}, [output]);

	// --- Format bytes ---
	const formatSize = (s: string) => {
		const bytes = new TextEncoder().encode(s).length;
		if (bytes < 1024) return `${bytes} B`;
		return `${(bytes / 1024).toFixed(1)} KB`;
	};

	return (
		<section className="grid-bg relative min-h-[calc(100vh-56px)]">
			{/* Background glow */}
			<div className="pointer-events-none absolute top-1/4 left-1/2 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/[0.02] blur-[120px]" />

			<div className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6">
				{/* Header */}
				<motion.div
					initial={{ opacity: 0, y: -10 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.4 }}
					className="mb-5"
				>
					<h1 className="font-display text-2xl text-snow sm:text-3xl">
						<span className="text-accent italic">Playground</span>
					</h1>
					<p className="mt-1 text-sm text-smoke">
						Paste JavaScript, pick options, and obfuscate — all in
						your browser. Nothing leaves your machine.
					</p>
				</motion.div>

				{/* Top bar: presets + obfuscate + stats */}
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.4, delay: 0.1 }}
					className="mb-3 flex flex-wrap items-center gap-3"
				>
					{/* Preset selector */}
					<div className="flex items-center gap-1.5 rounded-lg border border-edge bg-ink/80 p-1">
						{(["low", "medium", "max"] as const).map((p) => (
							<button
								key={p}
								onClick={() => selectPreset(p)}
								className={`rounded-md px-3 py-1.5 font-mono text-xs font-medium transition-all ${
									preset === p && !isCustom
										? "bg-accent text-void shadow-sm"
										: "text-smoke hover:bg-panel hover:text-cloud"
								}`}
							>
								{p}
							</button>
						))}
						{isCustom && (
							<span className="rounded-md border border-accent/30 bg-accent/10 px-3 py-1.5 font-mono text-xs font-medium text-accent">
								custom
							</span>
						)}
					</div>

					{/* Target selector */}
					<div className="flex items-center gap-1.5 rounded-lg border border-edge bg-ink/80 p-1">
						{(
							[
								["browser", "browser"],
								["node", "node"],
								["browser-extension", "extension"],
							] as const
						).map(([value, label]) => (
							<button
								key={value}
								onClick={() =>
									setTarget(value as TargetEnv)
								}
								className={`rounded-md px-3 py-1.5 font-mono text-xs font-medium transition-all ${
									target === value
										? "bg-accent/15 text-accent"
										: "text-smoke hover:bg-panel hover:text-cloud"
								}`}
							>
								{label}
							</button>
						))}
					</div>

					{/* Obfuscate button */}
					<button
						onClick={run}
						disabled={!allLoaded || running}
						className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2 font-mono text-xs font-semibold text-void transition hover:shadow-[0_0_20px_rgba(127,173,254,0.25)] disabled:opacity-40 disabled:cursor-not-allowed"
					>
						<FontAwesomeIcon
							icon={running ? faSpinner : faPlay}
							className={`h-3 w-3 ${
								running ? "animate-spin" : ""
							}`}
						/>
						{running ? "obfuscating..." : "obfuscate"}
					</button>

					{/* Stats */}
					<div className="ml-auto flex items-center gap-4 font-mono text-xs text-ash">
						{elapsed !== null && (
							<span>
								<span className="text-smoke">{elapsed}ms</span>
							</span>
						)}
						{output && (
							<span>
								<span className="text-smoke">
									{formatSize(output)}
								</span>
							</span>
						)}
						{output && (
							<div className="flex items-center gap-1">
								<button
									onClick={copyOutput}
									className="rounded p-1.5 text-ash transition hover:bg-panel hover:text-cloud"
									title="Copy output"
								>
									<FontAwesomeIcon
										icon={
											copied ? faCheck : faCopy
										}
										className={`h-3 w-3 ${
											copied ? "text-accent" : ""
										}`}
									/>
								</button>
								<button
									onClick={download}
									className="rounded p-1.5 text-ash transition hover:bg-panel hover:text-cloud"
									title="Download output"
								>
									<FontAwesomeIcon
										icon={faDownload}
										className="h-3 w-3"
									/>
								</button>
							</div>
						)}
					</div>
				</motion.div>

				{/* Editors */}
				<motion.div
					initial={{ opacity: 0, y: 10 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.5, delay: 0.15 }}
					className="grid grid-cols-1 gap-3 lg:grid-cols-2"
				>
					{/* Input editor */}
					<div className="flex flex-col rounded-xl border border-edge overflow-hidden">
						<div className="flex items-center gap-2 border-b border-edge bg-ink/60 px-4 py-2">
							<div className="h-2 w-2 rounded-full bg-[#ff5f57]/70" />
							<div className="h-2 w-2 rounded-full bg-[#febc2e]/70" />
							<div className="h-2 w-2 rounded-full bg-[#28c840]/70" />
							<span className="ml-2 font-mono text-[11px] text-ash">
								input.js
							</span>
						</div>
						<div
							ref={inputRef}
							className="min-h-[320px] flex-1 bg-[#0d1117] sm:min-h-[480px]"
						>
							{!inputLoaded && (
								<div className="flex h-full items-center justify-center p-8">
									<FontAwesomeIcon
										icon={faSpinner}
										className="h-5 w-5 animate-spin text-ash"
									/>
								</div>
							)}
						</div>
					</div>

					{/* Output editor */}
					<div className="flex flex-col rounded-xl border border-edge overflow-hidden">
						<div className="flex items-center gap-2 border-b border-edge bg-ink/60 px-4 py-2">
							<div className="h-2 w-2 rounded-full bg-[#ff5f57]/70" />
							<div className="h-2 w-2 rounded-full bg-[#febc2e]/70" />
							<div className="h-2 w-2 rounded-full bg-[#28c840]/70" />
							<span className="ml-2 font-mono text-[11px] text-ash">
								output.js
							</span>
							{output && (
								<span className="ml-auto rounded bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-medium text-accent">
									protected
								</span>
							)}
							{error && (
								<span className="ml-auto rounded bg-alert/10 px-2 py-0.5 font-mono text-[10px] font-medium text-alert">
									error
								</span>
							)}
						</div>
						<div
							ref={outputRef}
							className="min-h-[320px] flex-1 bg-[#0d1117] sm:min-h-[480px]"
						>
							{!outputLoaded && (
								<div className="flex h-full items-center justify-center p-8">
									<FontAwesomeIcon
										icon={faSpinner}
										className="h-5 w-5 animate-spin text-ash"
									/>
								</div>
							)}
						</div>
					</div>
				</motion.div>

				{/* Options panel */}
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.4, delay: 0.25 }}
					className="mt-3"
				>
					<button
						onClick={() => setOptionsOpen((o) => !o)}
						className="flex w-full items-center gap-2 rounded-lg border border-edge bg-ink/60 px-4 py-2.5 font-mono text-xs text-smoke transition hover:bg-panel"
					>
						<span className="font-medium">options</span>
						<span className="text-ash">
							{isCustom
								? "custom configuration"
								: `${preset} preset`}
						</span>
						<FontAwesomeIcon
							icon={optionsOpen ? faChevronUp : faChevronDown}
							className="ml-auto h-3 w-3 text-ash"
						/>
					</button>

					{optionsOpen && (
						<motion.div
							initial={{ opacity: 0, height: 0 }}
							animate={{ opacity: 1, height: "auto" }}
							exit={{ opacity: 0, height: 0 }}
							className="mt-1 rounded-lg border border-edge bg-ink/60 p-4"
						>
							{(
								[
									["security", "Security"],
									["obfuscation", "Obfuscation"],
									["optimization", "Optimization"],
								] as const
							).map(([group, label]) => (
								<div key={group} className="mb-3 last:mb-0">
									<span className="mb-2 block font-mono text-[10px] font-semibold uppercase tracking-wider text-ash">
										{label}
									</span>
									<div className="flex flex-wrap gap-2">
										{OPTIONS.filter(
											(o) => o.group === group
										).map((opt) => {
											const active = toggles[opt.key];
											return (
												<button
													key={opt.key}
													onClick={() =>
														toggleOption(opt.key)
													}
													className={`rounded-md border px-3 py-1.5 font-mono text-[11px] transition-all ${
														active
															? "border-accent/30 bg-accent/15 text-accent"
															: "border-edge bg-void/40 text-ash hover:border-steel hover:text-smoke"
													}`}
												>
													{opt.label}
												</button>
											);
										})}
									</div>
								</div>
							))}
						</motion.div>
					)}
				</motion.div>

				{/* Loading overlay */}
				{!allLoaded && (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-void/80 backdrop-blur-sm">
						<div className="flex flex-col items-center gap-4">
							<FontAwesomeIcon
								icon={faSpinner}
								className="h-8 w-8 animate-spin text-accent"
							/>
							<p className="font-mono text-sm text-smoke">
								Loading Ruam engine...
							</p>
						</div>
					</div>
				)}
			</div>
		</section>
	);
}
