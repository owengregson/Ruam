"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCopy, faCheck } from "@fortawesome/free-solid-svg-icons";
import { faGithub, faNpm } from "@fortawesome/free-brands-svg-icons";

function Globe() {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		let animId: number;
		let angle = 0;

		/* fibonacci sphere — evenly distributed points */
		const N = 1000;
		const phi = (1 + Math.sqrt(5)) / 2;
		const points: [number, number, number][] = [];

		for (let i = 0; i < N; i++) {
			const y = 1 - (2 * i) / (N - 1);
			const r = Math.sqrt(1 - y * y);
			const theta = (2 * Math.PI * i) / phi;
			points.push([Math.cos(theta) * r, y, Math.sin(theta) * r]);
		}

		const resize = () => {
			const parent = canvas.parentElement;
			if (!parent) return;
			const w = parent.clientWidth;
			const h = parent.clientHeight;
			const dpr = window.devicePixelRatio || 1;
			canvas.width = w * dpr;
			canvas.height = h * dpr;
			canvas.style.width = `${w}px`;
			canvas.style.height = `${h}px`;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		};
		resize();

		const draw = () => {
			const w = canvas.clientWidth;
			const h = canvas.clientHeight;
			ctx.clearRect(0, 0, w, h);
			angle += 0.0015;

			const R = Math.min(w, h) * 0.44;
			const cx = w / 2;
			const cy = h * 0.92;

			/* sort by z for proper layering */
			const projected: { x: number; y: number; depth: number }[] = [];

			for (const [px, py, pz] of points) {
				/* only upper hemisphere */
				if (py < -0.08) continue;

				const rx = px * Math.cos(angle) - pz * Math.sin(angle);
				const rz = px * Math.sin(angle) + pz * Math.cos(angle);
				const ry = py;

				const screenX = cx + rx * R;
				const screenY = cy - ry * R;
				const depth = (rz + 1) / 2;
				projected.push({ x: screenX, y: screenY, depth });
			}

			projected.sort((a, b) => a.depth - b.depth);

			for (const { x, y, depth } of projected) {
				const alpha = 0.06 + depth * 0.45;
				const size = 0.6 + depth * 1.1;
				ctx.beginPath();
				ctx.arc(x, y, size, 0, Math.PI * 2);
				ctx.fillStyle = `rgba(127, 173, 254, ${alpha})`;
				ctx.fill();
			}

			/* horizon glow */
			const grad = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
			grad.addColorStop(0, "rgba(127,173,254,0)");
			grad.addColorStop(0.3, "rgba(127,173,254,0.04)");
			grad.addColorStop(0.5, "rgba(127,173,254,0.07)");
			grad.addColorStop(0.7, "rgba(127,173,254,0.04)");
			grad.addColorStop(1, "rgba(127,173,254,0)");
			ctx.fillStyle = grad;
			ctx.fillRect(cx - R * 1.1, cy - 1, R * 2.2, 3);

			animId = requestAnimationFrame(draw);
		};

		draw();

		const onVisChange = () => {
			if (document.hidden) cancelAnimationFrame(animId);
			else animId = requestAnimationFrame(draw);
		};
		window.addEventListener("resize", resize);
		document.addEventListener("visibilitychange", onVisChange);

		return () => {
			cancelAnimationFrame(animId);
			window.removeEventListener("resize", resize);
			document.removeEventListener("visibilitychange", onVisChange);
		};
	}, []);

	return (
		<canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
	);
}

export default function GetStarted() {
	const [copied, setCopied] = useState(false);
	const cmd = "npm install ruam";

	const copy = () => {
		navigator.clipboard.writeText(cmd);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<section id="get-started" className="relative overflow-hidden pb-24">
			{/* Globe container */}
			<div className="relative mx-auto -mt-44 h-[425px] max-w-4xl sm:-mt-54 sm:h-[493px]">
				<Globe />
				<div className="pointer-events-none absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-void to-transparent" />
			</div>

			{/* Content overlapping globe bottom */}
			<motion.div
				initial={{ opacity: 0, y: 16 }}
				whileInView={{ opacity: 1, y: 0 }}
				viewport={{ once: true }}
				className="relative z-10 -mt-12 text-center"
			>
				<h2 className="font-display text-4xl text-snow sm:text-6xl">
					Your code,
					<br />
					<span className="text-accent italic">
						World Class Protection.
					</span>
				</h2>
				<p className="mx-auto mt-4 max-w-md text-base text-smoke">
					What are you waiting for?
				</p>

				{/* Install command */}
				<div className="mx-auto mt-8 max-w-sm">
					<div className="relative rounded-lg border border-edge bg-[#0d1117] p-3">
						<code className="block font-mono text-sm text-cloud">
							<span className="text-ash">$</span> {cmd}
						</code>
						<button
							onClick={copy}
							className="absolute top-1/2 right-2.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded border border-edge bg-panel/60 text-ash transition hover:text-cloud"
						>
							<FontAwesomeIcon
								icon={copied ? faCheck : faCopy}
								className={`h-3 w-3 ${
									copied ? "text-accent" : ""
								}`}
							/>
						</button>
					</div>
				</div>

				{/* Links */}
				<div className="mt-6 flex items-center justify-center gap-4">
					<a
						href="https://github.com/owengregson/ruam"
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-2 rounded-lg border border-steel px-4 py-2 font-mono text-xs text-smoke transition hover:border-ash hover:text-cloud"
					>
						<FontAwesomeIcon
							icon={faGithub}
							className="h-3.5 w-3.5"
						/>
						GitHub
					</a>
					<a
						href="https://www.npmjs.com/package/ruam"
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-2 rounded-lg border border-steel px-4 py-2 font-mono text-xs text-smoke transition hover:border-ash hover:text-cloud"
					>
						<FontAwesomeIcon icon={faNpm} className="h-3.5 w-3.5" />
						npm
					</a>
					<a
						href="https://github.com/owengregson/ruam#readme"
						target="_blank"
						rel="noopener noreferrer"
						className="rounded-lg border border-steel px-4 py-2 font-mono text-xs text-smoke transition hover:border-ash hover:text-cloud"
					>
						Docs
					</a>
				</div>
			</motion.div>
		</section>
	);
}
