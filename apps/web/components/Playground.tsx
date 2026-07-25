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

// --- Isogloss source model ---

type IsoglossProfile =
	| "holographic-local"
	| "holographic-custodied"
	| "holographic-private"
	| "holographic-tee";
type TargetEnv = "node" | "browser" | "browser-extension";

type RegionDomain =
	| { type: "boolean" }
	| { type: "number"; min: number; max: number };

interface RegionBindingDraft {
	id: number;
	name: string;
	type: RegionDomain["type"];
	min: string;
	max: string;
}

interface IsoglossSourceOptions {
	isogloss: {
		profile: "holographic-local";
		ownerTrace: "off";
	};
	targetMode: "comment";
	threshold: 1;
	preprocessIdentifiers: boolean;
	target: TargetEnv;
	regionDomains: Record<string, Record<string, RegionDomain>>;
}

interface ProfileDescription {
	id: IsoglossProfile;
	label: string;
	availability: string;
	description: string;
	playground: boolean;
}

const PROFILES: readonly ProfileDescription[] = [
	{
		id: "holographic-local",
		label: "Local",
		availability: "available here",
		description:
			"Complete local client with diversified scalar BPRF realizations. Raises analysis cost without claiming secrecy under full instrumentation.",
		playground: true,
	},
	{
		id: "holographic-custodied",
		label: "Custodied",
		availability: "owner integration (unpublished)",
		description:
			"Holds part of the relation behind an existing remote-await boundary. A complete local fallback is forbidden.",
		playground: false,
	},
	{
		id: "holographic-private",
		label: "Private",
		availability: "owner integration (unpublished)",
		description:
			"Combines custody with an actively secure private-function protocol and a padded universal circuit.",
		playground: false,
	},
	{
		id: "holographic-tee",
		label: "Attested",
		availability: "owner integration (unpublished)",
		description:
			"Executes the held relation inside an owner-pinned attested trust domain without a complete local fallback.",
		playground: false,
	},
] as const;

const DEFAULT_BINDINGS: readonly RegionBindingDraft[] = [
	{ id: 1, name: "quantity", type: "number", min: "1", max: "100" },
	{ id: 2, name: "unitPrice", type: "number", min: "1", max: "500" },
];

// --- Default input code ---

const DEFAULT_CODE = `/* ruam:isogloss */
function priceQuote(quantity, unitPrice) {
  return (quantity * unitPrice) + (quantity * 2);
}`;

const IDENTIFIER_PATTERN = /^[A-Za-z_$][0-9A-Za-z_$]*$/;

function materializeRegionDomains(
	regionName: string,
	bindings: readonly RegionBindingDraft[]
):
	| { regionDomains: IsoglossSourceOptions["regionDomains"]; error: null }
	| { regionDomains: null; error: string } {
	const name = regionName.trim();
	if (!IDENTIFIER_PATTERN.test(name)) {
		return {
			regionDomains: null,
			error: "Source region must be a named JavaScript function.",
		};
	}
	if (bindings.length === 0) {
		return {
			regionDomains: null,
			error: "Declare at least one guarded input binding.",
		};
	}

	const domains: Record<string, RegionDomain> = {};
	for (const binding of bindings) {
		const bindingName = binding.name.trim();
		if (!IDENTIFIER_PATTERN.test(bindingName)) {
			return {
				regionDomains: null,
				error: `Invalid input binding: ${binding.name || "(empty)"}.`,
			};
		}
		if (Object.hasOwn(domains, bindingName)) {
			return {
				regionDomains: null,
				error: `Input binding ${bindingName} is declared more than once.`,
			};
		}
		if (binding.type === "boolean") {
			domains[bindingName] = { type: "boolean" };
			continue;
		}
		const min = Number(binding.min);
		const max = Number(binding.max);
		if (
			!Number.isSafeInteger(min) ||
			!Number.isSafeInteger(max) ||
			Object.is(min, -0) ||
			Object.is(max, -0) ||
			min > max
		) {
			return {
				regionDomains: null,
				error: `${bindingName} requires safe-integer bounds with min ≤ max.`,
			};
		}
		domains[bindingName] = { type: "number", min, max };
	}

	return {
		regionDomains: { [name]: domains },
		error: null,
	};
}

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
	const activeIdRef = useRef<number | null>(null);
	const activeCancelRef = useRef<(() => void) | null>(null);
	const disposedRef = useRef(false);
	const [ready, setReady] = useState(false);
	const [initError, setInitError] = useState<string | null>(null);

	const startWorker = useCallback(() => {
		if (disposedRef.current) return;
		workerRef.current?.terminate();
		setReady(false);
		setInitError(null);
		const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
		const w = new Worker(`${basePath}/ruam-worker.mjs`, {
			type: "module",
		});
		workerRef.current = w;

		// Wait for the worker module to signal readiness
		const onReady = (e: MessageEvent) => {
			if (e.data.ready) {
				w.removeEventListener("message", onReady);
				w.removeEventListener("error", onInitErr);
				if (disposedRef.current || workerRef.current !== w) {
					w.terminate();
					return;
				}
				setReady(true);
			}
		};
		const onInitErr = (e: ErrorEvent) => {
			w.removeEventListener("message", onReady);
			w.removeEventListener("error", onInitErr);
			if (disposedRef.current || workerRef.current !== w) return;
			setInitError(e.message || "Worker failed to load");
		};
		w.addEventListener("message", onReady);
		w.addEventListener("error", onInitErr);
	}, []);

	useEffect(() => {
		disposedRef.current = false;
		startWorker();
		return () => {
			disposedRef.current = true;
			activeCancelRef.current?.();
			activeCancelRef.current = null;
			workerRef.current?.terminate();
			workerRef.current = null;
		};
	}, [startWorker]);

	const transformRegion = useCallback(
		(code: string, options: IsoglossSourceOptions) =>
			new Promise<{
				result: string;
				elapsed: number;
				outputBytes: number;
			}>(
				(resolve, reject) => {
					const worker = workerRef.current;
					if (!worker || disposedRef.current) {
						reject(new Error("Worker not ready"));
						return;
					}
					if (activeIdRef.current !== null) {
						reject(new Error("A transform is already running"));
						return;
					}
					const id = ++idRef.current;
					activeIdRef.current = id;
					let timeout: number | null = null;
					let settled = false;
					const cleanup = () => {
						if (timeout !== null) window.clearTimeout(timeout);
						worker.removeEventListener("message", handler);
						worker.removeEventListener("error", errHandler);
						if (activeIdRef.current === id) {
							activeIdRef.current = null;
						}
						if (activeCancelRef.current === cancel) {
							activeCancelRef.current = null;
						}
					};
					const cancel = () => {
						if (settled) return;
						settled = true;
						cleanup();
						reject(new Error("Worker was disposed"));
					};
					const handler = (e: MessageEvent) => {
						if (e.data.id !== id) return;
						settled = true;
						cleanup();
						if (e.data.error) {
							reject(new Error(e.data.error));
						} else {
							resolve({
								result: e.data.result,
								elapsed: e.data.elapsed,
								outputBytes: e.data.stats.outputBytes,
							});
						}
					};
					const errHandler = (e: ErrorEvent) => {
						settled = true;
						cleanup();
						reject(new Error(e.message || "Worker error"));
					};
					timeout = window.setTimeout(() => {
						if (settled) return;
						settled = true;
						cleanup();
						startWorker();
						reject(
							new Error(
								"Transform exceeded the 15-second browser budget"
							)
						);
					}, 15_000);
					activeCancelRef.current = cancel;
					worker.addEventListener("message", handler);
					worker.addEventListener("error", errHandler);
					worker.postMessage({ id, code, options });
				}
			),
		[startWorker]
	);

	return { ready, transformRegion, initError };
}

// --- Playground component ---

export default function Playground() {
	// --- State ---
	const profile: IsoglossProfile = "holographic-local";
	const [target, setTarget] = useState<TargetEnv>("browser");
	const [regionName, setRegionName] = useState("priceQuote");
	const [bindings, setBindings] =
		useState<RegionBindingDraft[]>(() => [...DEFAULT_BINDINGS]);
	const [preprocessIdentifiers, setPreprocessIdentifiers] = useState(false);
	const [optionsOpen, setOptionsOpen] = useState(true);
	const bindingIdRef = useRef(3);

	const [output, setOutput] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [running, setRunning] = useState(false);
	const [elapsed, setElapsed] = useState<number | null>(null);
	const [outputBytes, setOutputBytes] = useState<number | null>(null);
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
		"// Scalarized Isogloss output will appear here",
		true,
		{ current: null }
	);

	const {
		ready: workerReady,
		transformRegion,
		initError: workerError,
	} = useWorker();

	const allLoaded = inputLoaded && outputLoaded && workerReady;

	const updateBinding = useCallback(
		(id: number, patch: Partial<Omit<RegionBindingDraft, "id">>) => {
			setBindings((current) =>
				current.map((binding) =>
					binding.id === id ? { ...binding, ...patch } : binding
				)
			);
		},
		[]
	);

	const addBinding = useCallback(() => {
		const id = bindingIdRef.current++;
		setBindings((current) => [
			...current,
			{
				id,
				name: `input${id}`,
				type: "number",
				min: "0",
				max: "100",
			},
		]);
	}, []);

	const removeBinding = useCallback((id: number) => {
		setBindings((current) =>
			current.filter((binding) => binding.id !== id)
		);
	}, []);

	// --- Build the configured source region ---
	const run = useCallback(async () => {
		if (running || !allLoaded) return;
		setError(null);
		setElapsed(null);
		setOutputBytes(null);

		const materialized = materializeRegionDomains(regionName, bindings);
		if (materialized.regionDomains === null) {
			setError(materialized.error);
			return;
		}

		const options: IsoglossSourceOptions = {
			isogloss: {
				profile: "holographic-local",
				ownerTrace: "off",
			},
			targetMode: "comment",
			threshold: 1,
			preprocessIdentifiers,
			target,
			regionDomains: materialized.regionDomains,
		};

		setRunning(true);
		const code = codeRef.current;

		try {
			const {
				result,
				elapsed: ms,
				outputBytes: builtBytes,
			} = await transformRegion(code, options);
			setOutput(result);
			setElapsed(ms);
			setOutputBytes(builtBytes);

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
	}, [
		running,
		allLoaded,
		regionName,
		bindings,
		preprocessIdentifiers,
		target,
		transformRegion,
		outputViewRef,
	]);

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
		a.download = "isogloss.js";
		a.click();
		URL.revokeObjectURL(url);
	}, [output]);

	// --- Format bytes ---
	const formatSize = (bytes: number) => {
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
						Declare a guarded pure source region and compile it with
						the complete-local Isogloss profile. Nothing leaves your
						machine.
					</p>
				</motion.div>

				{/* Top bar: profile + target + build + stats */}
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.4, delay: 0.1 }}
					className="mb-3 flex flex-wrap items-center gap-3"
				>
					{/* Frozen local profile */}
					<div className="flex items-center gap-1.5 rounded-lg border border-edge bg-ink/80 p-1">
						<span className="rounded-md bg-accent px-3 py-1.5 font-mono text-xs font-medium text-void shadow-sm">
							{profile}
						</span>
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

					{/* Compile button */}
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
						{running ? "compiling region..." : "compile region"}
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
									{formatSize(outputBytes ?? 0)}
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
									isogloss
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

				{/* Profile and source-region panel */}
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
						<span className="font-medium">isogloss configuration</span>
						<span className="text-ash">
							{regionName || "unnamed region"} · {bindings.length}{" "}
							guarded {bindings.length === 1 ? "input" : "inputs"}
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
							<div>
								<span className="mb-2 block font-mono text-[10px] font-semibold uppercase tracking-wider text-ash">
									Frozen deployment profiles
								</span>
								<div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
									{PROFILES.map((item) => (
										<button
											key={item.id}
											type="button"
											disabled={!item.playground}
											title={
												item.playground
													? item.description
													: `${item.description} This synchronous playground cannot satisfy its boundary.`
											}
											className={`rounded-lg border p-3 text-left ${
												item.id === profile
													? "border-accent/30 bg-accent/[0.08]"
													: "cursor-not-allowed border-edge bg-void/30 opacity-55"
											}`}
										>
											<span
												className={`block font-mono text-xs font-semibold ${
													item.id === profile
														? "text-accent"
														: "text-smoke"
												}`}
											>
												{item.label}
											</span>
											<span className="mt-1 block font-mono text-[9px] uppercase tracking-wider text-ash">
												{item.availability}
											</span>
											<span className="mt-2 block text-[11px] leading-relaxed text-smoke">
												{item.description}
											</span>
										</button>
									))}
								</div>
							</div>

							<div className="mt-5 border-t border-edge pt-4">
								<div className="flex flex-wrap items-end gap-3">
									<label className="min-w-52 flex-1">
										<span className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-wider text-ash">
											Source-region function
										</span>
										<input
											value={regionName}
											onChange={(event) =>
												setRegionName(event.target.value)
											}
											spellCheck={false}
											className="w-full rounded-md border border-edge bg-void/50 px-3 py-2 font-mono text-xs text-cloud outline-none transition focus:border-accent/40"
										/>
									</label>
									<label className="flex items-center gap-2 rounded-md border border-edge bg-void/30 px-3 py-2 font-mono text-[11px] text-smoke">
										<input
											type="checkbox"
											checked={preprocessIdentifiers}
											onChange={(event) =>
												setPreprocessIdentifiers(
													event.target.checked
												)
											}
											className="accent-[#7fadfe]"
										/>
										preprocess identifiers
									</label>
								</div>
								<p className="mt-2 text-[11px] leading-relaxed text-ash">
									The exact marker{" "}
									<code className="text-smoke">
										{"/* ruam:isogloss */"}
									</code>{" "}
									selects this named function. Exact guard domains
									are required only for inputs that should enter
									the BPRF lane; all other JavaScript stays native.
								</p>

								<div className="mt-4 space-y-2">
									{bindings.map((binding) => (
										<div
											key={binding.id}
											className="grid items-center gap-2 rounded-lg border border-edge bg-void/30 p-2 sm:grid-cols-[minmax(130px,1fr)_110px_minmax(90px,0.7fr)_minmax(90px,0.7fr)_auto]"
										>
											<input
												aria-label="Input binding name"
												value={binding.name}
												onChange={(event) =>
													updateBinding(binding.id, {
														name: event.target.value,
													})
												}
												spellCheck={false}
												className="rounded-md border border-edge bg-ink px-2.5 py-2 font-mono text-[11px] text-cloud outline-none focus:border-accent/40"
											/>
											<select
												aria-label={`${binding.name} domain type`}
												value={binding.type}
												onChange={(event) =>
													updateBinding(binding.id, {
														type: event.target
															.value as RegionDomain["type"],
													})
												}
												className="rounded-md border border-edge bg-ink px-2.5 py-2 font-mono text-[11px] text-cloud outline-none focus:border-accent/40"
											>
												<option value="number">number</option>
												<option value="boolean">boolean</option>
											</select>
											<input
												aria-label={`${binding.name} minimum`}
												value={binding.min}
												onChange={(event) =>
													updateBinding(binding.id, {
														min: event.target.value,
													})
												}
												disabled={binding.type === "boolean"}
												placeholder="min"
												inputMode="numeric"
												className="rounded-md border border-edge bg-ink px-2.5 py-2 font-mono text-[11px] text-cloud outline-none focus:border-accent/40 disabled:opacity-30"
											/>
											<input
												aria-label={`${binding.name} maximum`}
												value={binding.max}
												onChange={(event) =>
													updateBinding(binding.id, {
														max: event.target.value,
													})
												}
												disabled={binding.type === "boolean"}
												placeholder="max"
												inputMode="numeric"
												className="rounded-md border border-edge bg-ink px-2.5 py-2 font-mono text-[11px] text-cloud outline-none focus:border-accent/40 disabled:opacity-30"
											/>
											<button
												type="button"
												onClick={() =>
													removeBinding(binding.id)
												}
												className="rounded-md border border-edge px-2.5 py-2 font-mono text-[10px] text-ash transition hover:border-alert/30 hover:text-alert"
											>
												remove
											</button>
										</div>
									))}
								</div>
								<button
									type="button"
									onClick={addBinding}
									className="mt-2 rounded-md border border-accent/20 bg-accent/[0.05] px-3 py-1.5 font-mono text-[10px] text-accent transition hover:bg-accent/10"
								>
									add guarded input
								</button>
								<p className="mt-3 text-[11px] leading-relaxed text-ash">
									Local mode ships a complete client. It
									increases analysis work, but does not claim a
									secret relation or resistance to unrestricted
									dynamic instrumentation.
								</p>
							</div>
						</motion.div>
					)}
				</motion.div>

				{/* Loading overlay */}
				{!allLoaded && (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-void/80 backdrop-blur-sm">
						<div className="flex flex-col items-center gap-4">
							{workerError ? (
								<>
									<p className="font-mono text-sm text-alert">
										Failed to load Ruam engine
									</p>
									<p className="max-w-md text-center font-mono text-xs text-ash">
										{workerError}
									</p>
								</>
							) : (
								<>
									<FontAwesomeIcon
										icon={faSpinner}
										className="h-8 w-8 animate-spin text-accent"
									/>
									<p className="font-mono text-sm text-smoke">
										Loading Ruam engine...
									</p>
								</>
							)}
						</div>
					</div>
				)}
			</div>
		</section>
	);
}
