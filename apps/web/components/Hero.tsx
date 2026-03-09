"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
const F = "text-syn-fn";
const P = "text-syn-param";
const N = "text-syn-number";
const S = "text-syn-string";
const D = "text-snow";

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

/* ── Source code character map (syntax-colored) ── */
const beforeMap: Cell[][] = [
	line(
		seg("function", K),
		seg(" ", D),
		seg("fibonacci", F),
		seg("(", D),
		seg("n", P),
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

/* ── Obfuscated code character map (based on real Ruam output) ── */
const afterMap: Cell[][] = [
	line(
		seg("var", K),
		seg(" _ru4m=!", D),
		seg("0", N),
		seg(";", D),
		seg("var", K),
		seg(" _khs={", D)
	),
	line(
		seg("  ", D),
		seg('"u_0000"', S),
		seg(":{", D),
		seg('"c"', S),
		seg(":[", D)
	),
	line(
		seg("    [", D),
		seg("3187", N),
		seg(",", D),
		seg("60953", N),
		seg(",", D),
		seg("44909", N),
		seg(",", D),
		seg("53581", N),
		seg("],", D)
	),
	line(
		seg("    ", D),
		seg('"i"', S),
		seg(":[", D),
		seg("250", N),
		seg(",", D),
		seg("0", N),
		seg(",", D),
		seg("78", N),
		seg(",", D),
		seg("0", N),
		seg(",", D),
		seg("209", N),
		seg(",", D),
		seg("0", N),
		seg("],", D)
	),
	line(
		seg("    ", D),
		seg('"r"', S),
		seg(":", D),
		seg("9", N),
		seg(",", D),
		seg('"p"', S),
		seg(":", D),
		seg("1", N),
		seg(",", D),
		seg('"a"', S),
		seg(":", D),
		seg("false", K),
		seg("}};", D)
	),
	line(seg("  ", D), seg("// ... 4500+ lines of VM runtime", D)),
	line(seg("function", K), seg(" ", D), seg("fibonacci", F), seg("(n){", D)),
	line(
		seg("  ", D),
		seg("return", K),
		seg(" _mds.", D),
		seg("call", F),
		seg("(", D),
		seg("this", K),
		seg(",", D),
		seg('"u_0000"', S),
		seg(",", D),
		seg("[n])}", D)
	),
];

/* ── Normalize line lengths for stable layout ── */
const beforeLens = beforeMap.map((r) => r.length);
const afterLens = afterMap.map((r) => r.length);
const MAX_COLS = Math.max(...beforeLens, ...afterLens);
const LINE_COUNT = Math.max(beforeMap.length, afterMap.length);

/* Per-line active columns — only scramble within actual content bounds */
const activeCols: number[] = [];
for (let li = 0; li < LINE_COUNT; li++) {
	activeCols.push(Math.max(beforeLens[li] ?? 0, afterLens[li] ?? 0));
}

function pad(cells: Cell[]): Cell[] {
	const padded = [...cells];
	while (padded.length < MAX_COLS) padded.push({ ch: " ", cls: D });
	return padded;
}
const beforePadded = beforeMap.map(pad);
const afterPadded = afterMap.map(pad);

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

/* ── Animation hook ── */
function useTerminalAnimation() {
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

					for (let li = 0; li < LINE_COUNT; li++) {
						const srcLine = source[li] ?? [];
						const tgtLine = target[li] ?? [];
						const row: Cell[] = [];
						const maxActive = activeCols[li] ?? 0;

						for (let ci = 0; ci < MAX_COLS; ci++) {
							const src = srcLine[ci] ?? { ch: " ", cls: D };
							const tgt = tgtLine[ci] ?? { ch: " ", cls: D };

							/* Skip padding — positions beyond both source and
							   target content stay as invisible spaces */
							if (ci >= maxActive) {
								row.push({ ch: " ", cls: D });
								continue;
							}

							const rt = resolveTime(li, ci);
							const srcLen = sourceLens[li] ?? 0;

							/* Each char starts scrambling individually,
							   500ms before its resolve time — creates
							   a cascade wave instead of a global snap */
							const scrambleStart = Math.max(0, rt - 500);

							if (elapsed < rt) {
								if (ci >= srcLen) {
									// Beyond source content — invisible until resolved
									row.push({ ch: " ", cls: D });
								} else if (elapsed < scrambleStart) {
									// Source char still visible, colors draining via CSS
									row.push({ ch: src.ch, cls: "text-ash" });
								} else {
									// Within source content — scramble
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
								// Resolved — show target char
								// Colors cascade in behind the resolve wave
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
		[]
	);

	useEffect(() => {
		cancelledRef.current = false;

		const cycle = async () => {
			while (!cancelledRef.current) {
				// Show source code
				setCells(beforePadded.map((row) => row.map((c) => ({ ...c }))));
				setBarState({
					label: "fibonacci.js",
					badge: "exposed",
					badgeClass: "bg-ember/10 text-ember",
				});
				setGlowing(false);
				setContentOpacity(1);

				// Short initial hold, normal hold after
				const hold = firstRun.current ? INITIAL_HOLD : HOLD_BEFORE;
				firstRun.current = false;
				await sleep(hold);
				if (cancelledRef.current) return;

				// Forward scramble
				setBarState({
					label: "compiling...",
					badge: "compiling...",
					badgeClass: "bg-accent/10 text-accent",
				});
				await runScramble(beforePadded, afterPadded, beforeLens);
				if (cancelledRef.current) return;

				// Show obfuscated code
				setBarState({
					label: "fibonacci.protected.js",
					badge: "protected",
					badgeClass: "bg-accent/10 text-accent",
				});
				setGlowing(true);
				await sleep(HOLD_AFTER);
				if (cancelledRef.current) return;

				// Crossfade back to source (no reverse scramble)
				setContentOpacity(0);
				setGlowing(false);
				await sleep(CROSSFADE_MS);
				if (cancelledRef.current) return;

				// Switch content while invisible
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
	}, [runScramble]);

	return { cells, barState, glowing, contentOpacity };
}

/* ── Component ── */
export default function Hero() {
	const { cells, barState, glowing, contentOpacity } = useTerminalAnimation();
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
