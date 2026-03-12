"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBars, faXmark, faTerminal } from "@fortawesome/free-solid-svg-icons";
import { faGithub, faNpm } from "@fortawesome/free-brands-svg-icons";
import { faBook } from "@fortawesome/free-solid-svg-icons";
import Image from "next/image";

const links = [
	{
		label: "features",
		href: "#features",
		target: "",
		icon: faBook,
	},
	{
		label: "github",
		href: "https://github.com/owengregson/ruam",
		target: "_blank",
		icon: faGithub,
	},
	{
		label: "npm",
		href: "https://www.npmjs.com/package/ruam",
		target: "_blank",
		icon: faNpm,
	},
];

export default function Navbar() {
	const [open, setOpen] = useState(false);

	return (
		<header className="fixed top-0 z-40 w-full border-b border-edge/60 bg-void/80 backdrop-blur-xl">
			<div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
				{/* Logo */}
				<a href="#" className="flex items-center gap-2.5">
					<Image src={`${process.env.NEXT_PUBLIC_BASE_PATH}/ruam.svg`} alt="Ruam" width={26} height={26} />
					<span className="font-display text-lg italic text-snow">
						ruam
					</span>
					<span className="rounded bg-accent/8 px-1.5 py-0.5 font-mono text-[10px] font-medium text-accent">
						v2.0
					</span>
				</a>

				{/* Desktop nav */}
				<nav className="hidden items-center gap-1 md:flex">
					{links.map((l, i) => (
						<span key={l.label} className="flex items-center">
							{i > 0 && (
								<span className="mx-2 font-mono text-xs text-steel">
									/
								</span>
							)}
							<a
								href={l.href}
								target={l.target}
								rel="noopener noreferrer"
								className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-mono text-xs text-smoke transition-colors hover:bg-panel hover:text-cloud"
							>
								<FontAwesomeIcon
									icon={l.icon}
									className="h-3 w-3"
								/>
								{l.label}
							</a>
						</span>
					))}
				</nav>

				{/* CTA */}
				<div className="hidden md:block">
					<a
						href="#get-started"
						className="inline-flex items-center gap-2 rounded-md border border-accent/15 bg-accent/6 px-4 py-1.5 font-mono text-xs font-medium text-accent transition-all hover:border-accent/30 hover:bg-accent/12"
					>
						<FontAwesomeIcon
							icon={faTerminal}
							className="h-3 w-3"
						/>
						get started
					</a>
				</div>

				{/* Mobile toggle */}
				<button
					className="text-smoke md:hidden"
					onClick={() => setOpen(!open)}
				>
					<FontAwesomeIcon
						icon={open ? faXmark : faBars}
						className="h-4 w-4"
					/>
				</button>
			</div>

			{/* Mobile menu */}
			<AnimatePresence>
				{open && (
					<motion.div
						initial={{ opacity: 0, height: 0 }}
						animate={{ opacity: 1, height: "auto" }}
						exit={{ opacity: 0, height: 0 }}
						className="overflow-hidden border-t border-edge/40 bg-void/95 md:hidden"
					>
						<nav className="flex flex-col gap-1 px-6 py-4">
							{links.map((l) => (
								<a
									key={l.label}
									href={l.href}
									target="_blank"
									rel="noopener noreferrer"
									className="flex items-center gap-2 rounded-md px-3 py-2 font-mono text-xs text-smoke transition hover:bg-panel"
								>
									<FontAwesomeIcon
										icon={l.icon}
										className="h-3 w-3"
									/>
									{l.label}
								</a>
							))}
							<a
								href="#get-started"
								className="mt-2 flex items-center justify-center gap-2 rounded-md border border-accent/15 bg-accent/6 px-4 py-2 font-mono text-xs text-accent"
							>
								<FontAwesomeIcon
									icon={faTerminal}
									className="h-3 w-3"
								/>
								get started
							</a>
						</nav>
					</motion.div>
				)}
			</AnimatePresence>
		</header>
	);
}
