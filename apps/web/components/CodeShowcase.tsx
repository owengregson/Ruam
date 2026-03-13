"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	faShuffle,
	faLock,
	faCopy,
	faCheck,
	faTerminal,
	faPlay,
	faArrowRight,
} from "@fortawesome/free-solid-svg-icons";
import { faGithub } from "@fortawesome/free-brands-svg-icons";

/* ── Compile-again mini-terminal ── */
function generateLines(): string[] {
	const hex = () =>
		Math.floor(Math.random() * 256)
			.toString(16)
			.padStart(2, "0");
	const vars = "QWXvjmpRTHkNceFd".split("");
	const pick = () => vars[Math.floor(Math.random() * vars.length)];
	return [
		`var _ru4m=!0;(function(${pick()},${pick()}){`,
		`const ${pick()}=${pick()}();while(!!1){try{`,
		`const ${pick()}=parseInt('0x${hex()}')/0x1`,
		`+parseInt('0x${hex()}')*0x3;if(${pick()})`,
		`break;else ${pick()}['push'](${pick()}`,
		`['shift']())}})(0x${hex()}${hex()},`,
		`0x${hex()}${hex()}${hex()});`,
	];
}

const PLACEHOLDER_LINES = [
	"var _ru4m=!0;(function(Q,W){",
	"const X=Z();while(!!1){try{",
	"const v=parseInt('0xae')/0x1",
	"+parseInt('0x7b')*0x3;if(v)",
	"break;else Q['push'](Q",
	"['shift']())}})(0xa1b2,",
	"0xc3d4e5);",
];

function CompileCard() {
	const [lines, setLines] = useState<string[]>(PLACEHOLDER_LINES);
	const [buildNum, setBuildNum] = useState(1);
	const [isScrambling, setIsScrambling] = useState(false);
	const rafRef = useRef(0);

	/* hydration-safe: generate first random set on mount */
	useEffect(() => {
		setLines(generateLines());
	}, []);

	const compile = useCallback(() => {
		if (isScrambling) return;
		setIsScrambling(true);
		const target = generateLines();
		const chars =
			"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz0123456789@#$%^&*";
		const start = performance.now();

		const animate = (now: number) => {
			const elapsed = now - start;
			if (elapsed > 400) {
				setLines(target);
				setBuildNum((n) => n + 1);
				setIsScrambling(false);
				return;
			}
			const progress = elapsed / 400;
			setLines(
				target.map((tgt, li) => {
					const resolved = Math.floor(progress * tgt.length * 1.3);
					let result = "";
					for (let ci = 0; ci < tgt.length; ci++) {
						if (ci < resolved) result += tgt[ci];
						else
							result +=
								chars[Math.floor(Math.random() * chars.length)];
					}
					return result;
				})
			);
			rafRef.current = requestAnimationFrame(animate);
		};
		rafRef.current = requestAnimationFrame(animate);
	}, [isScrambling]);

	useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

	return (
		<div className="flex h-full flex-col rounded-xl border border-edge bg-ink p-6">
			<div className="mb-4 flex items-center gap-3 select-none">
				<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
					<FontAwesomeIcon icon={faShuffle} className="h-4 w-4" />
				</div>
				<div>
					<h3 className="text-sm font-semibold text-snow">
						Unique every time
					</h3>
					<p className="text-xs text-ash">Build #{buildNum}</p>
				</div>
			</div>

			<div className="mb-4 flex-1 rounded-lg border border-edge bg-void/60 p-3 font-mono text-[11px] leading-[1.7] text-smoke select-none">
				{lines.map((line, i) => (
					<div key={i}>{line}</div>
				))}
			</div>

			<button
				onClick={compile}
				className="flex w-full items-center justify-center gap-2 rounded-lg border border-accent/15 bg-accent/6 py-2 font-mono text-xs font-medium text-accent transition hover:border-accent/30 hover:bg-accent/12"
			>
				<FontAwesomeIcon icon={faPlay} className="h-2.5 w-2.5" />
				compile again
			</button>

			<p className="mt-4 text-[12px] leading-relaxed text-smoke">
				Same source, different output. Variable names, opcodes, and
				encryption seeds all change between builds.
			</p>
		</div>
	);
}

/* ── Irreversible card ── */
function IrreversibleCard() {
	return (
		<div className="flex h-full flex-col rounded-xl border border-edge bg-ink p-6">
			<div className="mb-4 flex items-center gap-3 select-none">
				<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
					<FontAwesomeIcon icon={faLock} className="h-4 w-4" />
				</div>
				<h3 className="text-sm font-semibold text-snow">
					Irreversible
				</h3>
			</div>

			<div className="mb-4 flex-1 space-y-3">
				<div className="rounded-lg border border-edge bg-void/60 p-3 select-none">
					<span className="mb-1 block font-mono text-[10px] font-semibold text-ember uppercase tracking-wider">
						Classic Obfuscation
					</span>
					<code className="font-mono text-[11px] text-smoke">
						{"function _0x1a(a,b){ return a*b }"}
					</code>
					<p className="mt-1 font-mono text-[10px] text-ash">
						Flow, variables, and strings can be heavily hidden, but
						the logic is inevitably traceable.
					</p>
				</div>
				<div className="rounded-lg border border-accent/15 bg-accent/[0.03] p-3 select-none">
					<span className="mb-1 block font-mono text-[10px] font-semibold text-accent uppercase tracking-wider">
						Ruam
					</span>
					<code className="font-mono text-[11px] text-smoke">
						{"_vm.call('a7f3',this,[a,b])"}
					</code>
					<p className="mt-1 font-mono text-[10px] text-accent/70">
						The logic is gone, and operations are called to a custom
						VM instead of the JS Interpreter.
					</p>
				</div>
			</div>

			<p className="text-[12px] leading-relaxed text-smoke">
				Your code is compiled away, and the produced RuamVM bytecode
				executes the same result as your JS, but in an entirely
				different way.
			</p>
		</div>
	);
}

/* ── Instant card ── */
function InstantCard() {
	const [copied, setCopied] = useState(false);
	const cmd = "npx ruam input.js -o output.js --preset max --target node";

	const copy = () => {
		navigator.clipboard.writeText(cmd);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="flex h-full flex-col rounded-xl border border-edge bg-ink p-6">
			<div className="mb-4 flex items-center gap-3 select-none">
				<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
					<FontAwesomeIcon icon={faTerminal} className="h-4 w-4" />
				</div>
				<h3 className="text-sm font-semibold text-snow">Seamless</h3>
			</div>

			<div className="mb-4 flex-1">
				<div className="relative rounded-lg border border-edge bg-void/60 p-3">
					<code className="block font-mono text-[11px] leading-[1.7] text-cloud">
						<span className="text-smoke">$</span> {cmd}
					</code>
					<button
						onClick={copy}
						className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded border border-edge bg-panel/60 text-ash transition hover:text-cloud"
					>
						<FontAwesomeIcon
							icon={copied ? faCheck : faCopy}
							className={`h-2.5 w-2.5 ${
								copied ? "text-accent" : ""
							}`}
						/>
					</button>
				</div>

				<div className="mt-3 space-y-2">
					{[
						"Works with Node.js, Deno, Bun, etc.",
						"Supports MV2 & MV3 Browser Extensions",
						"Compatible with any framework",
						"Customizable obfuscation layers",
						"Full project scope",
					].map((item) => (
						<div key={item} className="flex items-center gap-2">
							<FontAwesomeIcon
								icon={faCheck}
								className="h-2.5 w-2.5 text-accent/60"
							/>
							<span className="font-mono text-[11px] text-smoke">
								{item}
							</span>
						</div>
					))}
				</div>
			</div>

			<p className="text-[12px] leading-relaxed text-smoke">
				One command protects your entire project. No code changes are
				necessary to build with Ruam.
			</p>
		</div>
	);
}

/* ── Main section ── */
export default function CodeShowcase() {
	return (
		<section id="features" className="mx-auto max-w-6xl px-6 pb-32">
			<motion.div
				initial={{ opacity: 0 }}
				whileInView={{ opacity: 1 }}
				viewport={{ once: true }}
				className="mb-16 text-center"
			>
				<h2 className="font-display text-3xl text-snow sm:text-5xl">
					Not another name mangler.
				</h2>
				<p className="mx-auto mt-4 max-w-lg text-base text-smoke">
					RuamVM's encrypted bytecode is indistinguishable even to
					experienced attackers. To piece together the original logic,
					an intruder must first reverse-engineer the RuamVM.
				</p>
			</motion.div>

			<div className="grid grid-cols-1 gap-6 md:grid-cols-3">
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true }}
					transition={{ delay: 0 }}
				>
					<CompileCard />
				</motion.div>
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true }}
					transition={{ delay: 0.08 }}
				>
					<IrreversibleCard />
				</motion.div>
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true }}
					transition={{ delay: 0.16 }}
				>
					<InstantCard />
				</motion.div>
			</div>

			{/* GitHub deep-dive prompt */}
			<motion.div
				initial={{ opacity: 0 }}
				whileInView={{ opacity: 1 }}
				viewport={{ once: true }}
				transition={{ delay: 0.24 }}
				className="mt-12 flex items-center justify-center"
			>
				<a
					href="https://github.com/owengregson/ruam"
					target="_blank"
					rel="noopener noreferrer"
					className="group flex items-center gap-3 rounded-full border border-edge/50 bg-ink/50 px-5 py-2.5 transition hover:border-accent/20 hover:bg-accent/[0.04]"
				>
					<FontAwesomeIcon
						icon={faGithub}
						className="h-4 w-4 text-ash transition group-hover:text-accent/70"
					/>
					<span className="font-mono text-[12px] text-smoke transition group-hover:text-cloud">
						view full explanation
					</span>
					<FontAwesomeIcon
						icon={faArrowRight}
						className="h-2.5 w-2.5 text-ash transition group-hover:translate-x-0.5 group-hover:text-accent"
					/>
				</a>
			</motion.div>
		</section>
	);
}
