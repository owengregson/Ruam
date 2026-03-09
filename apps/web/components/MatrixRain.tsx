"use client";

import { useEffect, useRef, useCallback } from "react";

/* Bytecode-themed character set — fits the obfuscation aesthetic */
const CHARS = "0123456789abcdefABCDEF{}[]();:=!+*/&|<>^~_$x";
const randChar = () => CHARS[Math.floor(Math.random() * CHARS.length)]!;

/* Column state for the rain effect */
interface Column {
	y: number; // current head position (in cells)
	speed: number; // cells per frame
	length: number; // trail length
	chars: string[]; // character buffer
	phase: number; // randomize reset timing
}

export default function MatrixRain() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const mouseRef = useRef({ x: -1, y: -1 });
	const columnsRef = useRef<Column[]>([]);
	const rafRef = useRef(0);
	const lastTimeRef = useRef(0);

	const initColumns = useCallback((width: number, height: number) => {
		const cellSize = 14;
		const colCount = Math.ceil(width / cellSize);
		const rowCount = Math.ceil(height / cellSize);
		const cols: Column[] = [];

		for (let i = 0; i < colCount; i++) {
			const length = 8 + Math.floor(Math.random() * 16);
			cols.push({
				y: -Math.floor(Math.random() * rowCount * 2), // stagger start
				speed: 0.3 + Math.random() * 0.7,
				length,
				chars: Array.from({ length: rowCount + length }, randChar),
				phase: Math.random() * Math.PI * 2,
			});
		}

		columnsRef.current = cols;
	}, []);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d", { alpha: true });
		if (!ctx) return;

		const cellSize = 12;
		const baseOpacity = 0.05; // very subtle
		const mouseRadius = 200; // interaction radius in px
		const mouseBoost = 0.45; // max additional opacity near cursor

		const resize = () => {
			const parent = canvas.parentElement;
			if (!parent) return;
			const w = parent.clientWidth;
			const h = parent.clientHeight;
			const dpr = Math.min(window.devicePixelRatio, 2);
			canvas.width = w * dpr;
			canvas.height = h * dpr;
			canvas.style.width = `${w}px`;
			canvas.style.height = `${h}px`;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			initColumns(w, h);
		};

		resize();
		const ro = new ResizeObserver(resize);
		ro.observe(canvas.parentElement!);

		const draw = (now: number) => {
			const dt = lastTimeRef.current
				? (now - lastTimeRef.current) / 16.67
				: 1;
			lastTimeRef.current = now;

			const w = canvas.width / Math.min(window.devicePixelRatio, 2);
			const h = canvas.height / Math.min(window.devicePixelRatio, 2);
			const rowCount = Math.ceil(h / cellSize);
			const mx = mouseRef.current.x;
			const my = mouseRef.current.y;

			ctx.clearRect(0, 0, w, h);
			ctx.font = `${cellSize - 2}px "Fira Code", monospace`;
			ctx.textBaseline = "top";

			const cols = columnsRef.current;
			for (let i = 0; i < cols.length; i++) {
				const col = cols[i]!;
				const px = i * cellSize;

				// Mouse proximity boost
				let proximity = 0;
				if (mx >= 0) {
					const dx = px - mx;
					// Use center of visible trail for distance
					const headY = col.y * cellSize;
					const dy = headY - my;
					const dist = Math.sqrt(dx * dx + dy * dy);
					proximity = Math.max(0, 1 - dist / mouseRadius);
				}

				// Speed boost near mouse
				const speedMul = 1 + proximity * 0.5;
				col.y += col.speed * dt /* * speedMul*/;

				// Draw trail
				const headRow = Math.floor(col.y);
				for (let j = 0; j < col.length; j++) {
					const row = headRow - j;
					if (row < 0 || row >= rowCount) continue;

					const py = row * cellSize;
					const trailFade = 1 - j / col.length; // 1 at head, 0 at tail
					const opacity =
						(baseOpacity + mouseBoost * proximity) *
						trailFade *
						trailFade; // quadratic falloff

					if (opacity < 0.005) continue;

					// Head char is brighter accent, trail fades toward dim
					const isHead = j === 0;
					if (isHead) {
						ctx.fillStyle = `rgba(127, 173, 254, ${Math.min(
							opacity * 2.5,
							0.15
						)})`;
					} else {
						ctx.fillStyle = `rgba(127, 173, 254, ${opacity})`;
					}

					// Slowly cycle characters
					const charIdx = (row + headRow) % col.chars.length;
					if (Math.random() < 0.02) {
						col.chars[charIdx] = randChar();
					}
					ctx.fillText(col.chars[charIdx] ?? "0", px + 1, py);
				}

				// Reset when fully off screen
				if (headRow - col.length > rowCount) {
					col.y = -col.length - Math.floor(Math.random() * rowCount);
					col.speed = 0.3 + Math.random() * 0.7;
					col.length = 8 + Math.floor(Math.random() * 16);
				}
			}

			rafRef.current = requestAnimationFrame(draw);
		};

		rafRef.current = requestAnimationFrame(draw);

		/* Track mouse relative to canvas for glow effect — uses
		   document-level listener so we don't block pointer events
		   on hero content above */
		const onMouseMove = (e: MouseEvent) => {
			const rect = canvas.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const y = e.clientY - rect.top;
			if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
				mouseRef.current = { x, y };
			} else {
				mouseRef.current = { x: -1, y: -1 };
			}
		};
		document.addEventListener("mousemove", onMouseMove);

		return () => {
			cancelAnimationFrame(rafRef.current);
			ro.disconnect();
			document.removeEventListener("mousemove", onMouseMove);
		};
	}, [initColumns]);

	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden">
			<canvas
				ref={canvasRef}
				className="absolute inset-0 h-full w-full"
			/>
		</div>
	);
}
