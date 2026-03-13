"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowDown } from "@fortawesome/free-solid-svg-icons";
import { faGithub } from "@fortawesome/free-brands-svg-icons";
import MatrixRain from "./MatrixRain";

/* ── Constants ── */
const SCRAMBLE_CHARS = "0123456789abcdefABCDEF{}[]();:=!+*/&|<>^~_$x";
const scrambleChar = () =>
	SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];

/* ── Syntax color classes ── */
const K = "text-syn-keyword";
const N = "text-syn-number";
const S = "text-syn-string";
const D = "text-snow";
const CMT = "text-ash";

interface Cell {
	ch: string;
	cls: string;
}

function seg(text: string, cls: string): Cell[] {
	return [...text].map((ch) => ({ ch, cls }));
}
function line(...parts: Cell[][]): Cell[] {
	return parts.flat();
}

/* ── Snippet type from stats.json ── */
export interface HeroSnippet {
	head: string[];
	totalLines: number;
	tail: string[];
}

/* ── JS syntax tokenizer (simple, for visual effect) ── */
const JS_KEYWORDS = new Set([
	"var",
	"let",
	"const",
	"function",
	"return",
	"if",
	"for",
	"while",
	"do",
	"else",
	"new",
	"this",
	"typeof",
	"void",
	"true",
	"false",
	"null",
	"undefined",
	"class",
	"extends",
]);

function tokenizeLine(src: string): Cell[] {
	const cells: Cell[] = [];
	let i = 0;
	while (i < src.length) {
		const ch = src[i]!;
		// String literals
		if (ch === '"' || ch === "'") {
			const quote = ch;
			let j = i + 1;
			while (j < src.length && src[j] !== quote) {
				if (src[j] === "\\") j++;
				j++;
			}
			j++; // closing quote
			cells.push(...seg(src.slice(i, j), S));
			i = j;
		}
		// Comments
		else if (ch === "/" && src[i + 1] === "/") {
			cells.push(...seg(src.slice(i), CMT));
			break;
		}
		// Numbers (not part of identifiers)
		else if (/[0-9]/.test(ch) && (i === 0 || !/[a-zA-Z_$]/.test(src[i - 1]!))) {
			let j = i;
			while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
			cells.push(...seg(src.slice(i, j), N));
			i = j;
		}
		// Identifiers / keywords
		else if (/[a-zA-Z_$]/.test(ch)) {
			let j = i;
			while (j < src.length && /[a-zA-Z0-9_$]/.test(src[j]!)) j++;
			const word = src.slice(i, j);
			cells.push(...seg(word, JS_KEYWORDS.has(word) ? K : D));
			i = j;
		}
		// Everything else
		else {
			cells.push({ ch, cls: D });
			i++;
		}
	}
	return cells;
}

/* ── Build afterMap from snippet data (must match beforeMap line count) ── */
function buildAfterMap(snippet: HeroSnippet): Cell[][] {
	const target = beforeMap.length; // 8 lines
	const tail = snippet.tail.map(tokenizeLine);
	// 1 line reserved for the comment, rest split between head and tail
	const headCount = target - tail.length - 1;
	const head = snippet.head.slice(0, headCount).map(tokenizeLine);

	const count = snippet.totalLines.toLocaleString("en-US");
	return [
		...head,
		line(seg(`  // ... ${count}+ lines of VM runtime`, CMT)),
		...tail,
	];
}

/* ── Source code character map (syntax-colored) ── */
const beforeMap: Cell[][] = [
	line(
		seg("function", K),
		seg(" fibonacci(", D),
		seg("n", D),
		seg(") {", D)
	),
	line(
		seg("  ", D),
		seg("if", K),
		seg(" (n <= ", D),
		seg("1", N),
		seg(") ", D),
		seg("return", K),
		seg(" n;", D)
	),
	line(
		seg("  ", D),
		seg("let", K),
		seg(" a = ", D),
		seg("0", N),
		seg(", b = ", D),
		seg("1", N),
		seg(";", D)
	),
	line(
		seg("  ", D),
		seg("for", K),
		seg(" (", D),
		seg("let", K),
		seg(" i = ", D),
		seg("2", N),
		seg("; i <= n; i++) {", D)
	),
	line(seg("    [a, b] = [b, a + b];", D)),
	line(seg("  }", D)),
	line(seg("  ", D), seg("return", K), seg(" b;", D)),
	line(seg("}", D)),
];
const beforeLens = beforeMap.map((r) => r.length);

/* ── Hardcoded fallback (must be same line count as beforeMap) ── */
const defaultAfterMap: Cell[][] = [
	line(seg("var", K), seg(" qv = {};", D)),
	line(seg("var", K), seg(" wi = Object.create(", D), seg("null", K), seg(");", D)),
	line(seg("var", K), seg(" od = ", D), seg("'cMGDq0EItS9gFzAosmU7y5akwh...'", S), seg(";", D)),
	line(seg("  // ... 2,200+ lines of VM runtime", CMT)),
	line(seg("function", K), seg(" fibonacci(...__args) {", D)),
	line(seg("  ", D), seg("var", K), seg(" _n = __args.length | ", D), seg("0", N), seg(";", D)),
	line(seg("  ", D), seg("return", K), seg(" tg(", D), seg('"hny2l"', S), seg(", __args, up, ", D), seg("this", K), seg(");", D)),
	line(seg("}", D)),
];

/* ── Per-cell resolve time (organic cascade with noise) ── */
function resolveTime(li: number, ci: number): number {
	const hash = Math.sin(li * 127.1 + ci * 311.7) * 43758.5453;
	const noise = (hash - Math.floor(hash) - 0.5) * 500;
	const diagonal = li * 120 + ci * 20;
	return Math.max(0, Math.min(2000, diagonal + noise));
}

/* ── Timing ── */
const INITIAL_HOLD = 800;
const HOLD_BEFORE = 3000;
const HOLD_AFTER = 5000;
const SCRAMBLE_DURATION = 3000;
const COLOR_TRAIL_DELAY = 300;
const CROSSFADE_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── Animation config ── */
interface AnimConfig {
	beforePadded: Cell[][];
	afterPadded: Cell[][];
	beforeLens: number[];
	afterLens: number[];
	maxCols: number;
	lineCount: number;
	activeCols: number[];
}

function buildAnimConfig(afterMap: Cell[][]): AnimConfig {
	const afterLens = afterMap.map((r) => r.length);
	const maxCols = Math.max(...beforeLens, ...afterLens);
	const lineCount = Math.max(beforeMap.length, afterMap.length);

	const activeCols: number[] = [];
	for (let li = 0; li < lineCount; li++) {
		activeCols.push(Math.max(beforeLens[li] ?? 0, afterLens[li] ?? 0));
	}

	const pad = (cells: Cell[]): Cell[] => {
		const padded = [...cells];
		while (padded.length < maxCols) padded.push({ ch: " ", cls: D });
		return padded;
	};

	return {
		beforePadded: beforeMap.map(pad),
		afterPadded: afterMap.map(pad),
		beforeLens,
		afterLens,
		maxCols,
		lineCount,
		activeCols,
	};
}

/* ── Animation hook ── */
function useTerminalAnimation(config: AnimConfig) {
	const { beforePadded, afterPadded, beforeLens: bLens, maxCols, lineCount, activeCols } = config;

	const [cells, setCells] = useState<Cell[][]>(() =>
		beforePadded.map((row) => row.map((c) => ({ ...c })))
	);
	const [barState, setBarState] = useState({
		label: "fibonacci.js",
		badge: "exposed",
		badgeClass: "bg-ember/10 text-ember",
	});
	const [glowing, setGlowing] = useState(false);
	const [contentOpacity, setContentOpacity] = useState(1);
	const rafRef = useRef(0);
	const cancelledRef = useRef(false);
	const firstRun = useRef(true);

	const runScramble = useCallback(
		(source: Cell[][], target: Cell[][], sourceLens: number[]) =>
			new Promise<void>((resolve) => {
				const start = performance.now();

				const animate = (now: number) => {
					if (cancelledRef.current) return;
					const elapsed = now - start;
					const colorsInThreshold = SCRAMBLE_DURATION - 800;
					const newCells: Cell[][] = [];

					for (let li = 0; li < lineCount; li++) {
						const srcLine = source[li] ?? [];
						const tgtLine = target[li] ?? [];
						const row: Cell[] = [];
						const maxActive = activeCols[li] ?? 0;

						for (let ci = 0; ci < maxCols; ci++) {
							const src = srcLine[ci] ?? { ch: " ", cls: D };
							const tgt = tgtLine[ci] ?? { ch: " ", cls: D };

							if (ci >= maxActive) {
								row.push({ ch: " ", cls: D });
								continue;
							}

							const rt = resolveTime(li, ci);
							const srcLen = sourceLens[li] ?? 0;
							const scrambleStart = Math.max(0, rt - 500);

							if (elapsed < rt) {
								if (ci >= srcLen) {
									row.push({ ch: " ", cls: D });
								} else if (elapsed < scrambleStart) {
									row.push({ ch: src.ch, cls: "text-ash" });
								} else {
									const timeToResolve = rt - elapsed;
									const isBright =
										timeToResolve < 200 &&
										timeToResolve > 0;
									row.push({
										ch: scrambleChar(),
										cls: isBright
											? "text-smoke"
											: "text-ash",
									});
								}
							} else {
								const showColor =
									elapsed > rt + COLOR_TRAIL_DELAY &&
									elapsed > colorsInThreshold;
								row.push({
									ch: tgt.ch,
									cls: showColor ? tgt.cls : "text-ash",
								});
							}
						}
						newCells.push(row);
					}

					setCells(newCells);

					if (elapsed < SCRAMBLE_DURATION) {
						rafRef.current = requestAnimationFrame(animate);
					} else {
						setCells(
							target.map((row) => row.map((c) => ({ ...c })))
						);
						resolve();
					}
				};
				rafRef.current = requestAnimationFrame(animate);
			}),
		[lineCount, maxCols, activeCols]
	);

	useEffect(() => {
		cancelledRef.current = false;

		const cycle = async () => {
			while (!cancelledRef.current) {
				setCells(beforePadded.map((row) => row.map((c) => ({ ...c }))));
				setBarState({
					label: "fibonacci.js",
					badge: "exposed",
					badgeClass: "bg-ember/10 text-ember",
				});
				setGlowing(false);
				setContentOpacity(1);

				const hold = firstRun.current ? INITIAL_HOLD : HOLD_BEFORE;
				firstRun.current = false;
				await sleep(hold);
				if (cancelledRef.current) return;

				setBarState({
					label: "compiling...",
					badge: "compiling...",
					badgeClass: "bg-accent/10 text-accent",
				});
				await runScramble(beforePadded, afterPadded, bLens);
				if (cancelledRef.current) return;

				setBarState({
					label: "fibonacci.protected.js",
					badge: "protected",
					badgeClass: "bg-accent/10 text-accent",
				});
				setGlowing(true);
				await sleep(HOLD_AFTER);
				if (cancelledRef.current) return;

				setContentOpacity(0);
				setGlowing(false);
				await sleep(CROSSFADE_MS);
				if (cancelledRef.current) return;

				setCells(beforePadded.map((row) => row.map((c) => ({ ...c }))));
				setBarState({
					label: "fibonacci.js",
					badge: "exposed",
					badgeClass: "bg-ember/10 text-ember",
				});
				setContentOpacity(1);
				await sleep(CROSSFADE_MS);
				if (cancelledRef.current) return;
			}
		};

		cycle();
		return () => {
			cancelledRef.current = true;
			cancelAnimationFrame(rafRef.current);
		};
	}, [runScramble, beforePadded, afterPadded, bLens]);

	return { cells, barState, glowing, contentOpacity };
}

/* ── Component ── */
export default function Hero({ snippet }: { snippet?: HeroSnippet | null }) {
	const config = useMemo(() => {
		const afterMap = snippet ? buildAfterMap(snippet) : defaultAfterMap;
		return buildAnimConfig(afterMap);
	}, [snippet]);

	const { cells, barState, glowing, contentOpacity } =
		useTerminalAnimation(config);
	const [tilt, setTilt] = useState({ x: 0, y: 0 });
	const wrapperRef = useRef<HTMLDivElement>(null);

	const handleMouseMove = useCallback((e: React.MouseEvent) => {
		if (!wrapperRef.current) return;
		const rect = wrapperRef.current.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + rect.height / 2;
		const x = (e.clientX - cx) / (rect.width / 2);
		const y = (e.clientY - cy) / (rect.height / 2);
		setTilt({ x: -y * 8, y: x * 8 });
	}, []);

	const handleMouseLeave = useCallback(() => {
		setTilt({ x: 0, y: 0 });
	}, []);

	return (
		<section className="grid-bg relative min-h-screen pb-48 pt-14">
			<MatrixRain />
			<div className="pointer-events-none absolute top-1/3 left-1/2 h-[600px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/[0.03] blur-[150px]" />

			{/* Bottom fade — grid-bg into void */}
			<div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-void" />

			<div className="relative mx-auto flex min-h-[calc(100vh-56px)] max-w-6xl items-center px-6 py-20">
				<div className="grid w-full grid-cols-1 gap-12 lg:grid-cols-12">
					{/* Left — 5 cols */}
					<motion.div
						initial={{ opacity: 0, x: -20 }}
						animate={{ opacity: 1, x: 0 }}
						transition={{ duration: 0.7 }}
						className="flex flex-col justify-center lg:col-span-5"
					>
						<h1 className="font-display text-5xl leading-[1.05] tracking-tight sm:text-7xl">
							<span className="text-snow">
								Don&apos;t just
								<br />
								obfuscate code.
							</span>
							<br />
							<span className="glow-text text-accent italic">
								Destroy it.
							</span>
						</h1>
						<p className="mt-8 max-w-md text-lg leading-relaxed text-smoke">
							Ruam compiles your JavaScript into encrypted
							bytecode designed for a per-build unique RuamVM.
							There is no deobfuscator.
						</p>
						<div className="mt-10 flex flex-wrap items-center gap-4">
							<a
								href="#features"
								className="group inline-flex items-center gap-2.5 rounded-lg bg-accent px-6 py-3 font-mono text-sm font-semibold text-void transition hover:shadow-[0_0_30px_rgba(127,173,254,0.25)]"
							>
								see how it works
								<FontAwesomeIcon
									icon={faArrowDown}
									className="h-3 w-3 transition-transform group-hover:translate-y-0.5"
								/>
							</a>
							<a
								href="https://github.com/owengregson/ruam"
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-2 rounded-lg border border-steel px-5 py-3 font-mono text-sm text-smoke transition hover:border-ash hover:text-cloud"
							>
								<FontAwesomeIcon
									icon={faGithub}
									className="h-4 w-4"
								/>
								view source
							</a>
						</div>
					</motion.div>

					{/* Right — 7 cols, 3D terminal */}
					<motion.div
						initial={{ opacity: 0, x: 20 }}
						animate={{ opacity: 1, x: 0 }}
						transition={{ duration: 0.7, delay: 0.15 }}
						className="flex items-center lg:col-span-7"
					>
						<div
							ref={wrapperRef}
							onMouseMove={handleMouseMove}
							onMouseLeave={handleMouseLeave}
							className="w-full"
							style={{ perspective: "1000px" }}
						>
							<div
								className={`terminal w-full ${
									glowing ? "glow-blue" : ""
								}`}
								style={{
									transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
									transition:
										"transform 0.15s ease-out, box-shadow 0.7s, border-color 0.7s",
									transformStyle: "preserve-3d",
									boxShadow:
										tilt.x !== 0 || tilt.y !== 0
											? `${-tilt.y * 2}px ${
													tilt.x * 2
											  }px 40px rgba(127,173,254,0.05)`
											: undefined,
								}}
							>
								<div className="terminal-bar">
									<div className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
									<div className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
									<div className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
									<span className="ml-3 font-mono text-[11px] text-ash transition-colors duration-300">
										{barState.label}
									</span>
									<span
										className={`ml-auto rounded px-2 py-0.5 font-mono text-[10px] font-medium transition-colors duration-300 ${barState.badgeClass}`}
									>
										{barState.badge}
									</span>
								</div>
								<pre
									className="p-6 font-mono text-[13px] leading-[1.85] text-snow"
									style={{
										opacity: contentOpacity,
										transition: `opacity ${CROSSFADE_MS}ms ease`,
									}}
								>
									{cells.map((row, li) => (
										<div key={li}>
											{row.map((cell, ci) => (
												<span
													key={ci}
													className={`transition-colors duration-500 ${cell.cls}`}
												>
													{cell.ch}
												</span>
											))}
										</div>
									))}
								</pre>
							</div>
						</div>
					</motion.div>
				</div>
			</div>
		</section>
	);
}
