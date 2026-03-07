"use client";

import { motion } from "framer-motion";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	faPuzzlePiece,
	faCloud,
	faKey,
	faCode,
} from "@fortawesome/free-solid-svg-icons";

const useCases = [
	{
		icon: faPuzzlePiece,
		title: "Browser Extensions",
		description:
			"Extension source is visible to anyone who installs it. Ruam makes your logic unreadable while keeping it fully functional.",
	},
	{
		icon: faCloud,
		title: "SaaS & Web Apps",
		description:
			"Protect proprietary algorithms, pricing logic, and business rules that run in the browser where anyone can inspect them.",
	},
	{
		icon: faKey,
		title: "Licensed Software",
		description:
			"Prevent license validation from being bypassed. VM bytecode makes it impractical to locate and patch checks.",
	},
	{
		icon: faCode,
		title: "APIs & SDKs",
		description:
			"Shield authentication flows, API keys, and protocol implementations in client-side JavaScript.",
	},
];

export default function PipelineFlow() {
	return (
		<section className="mx-auto max-w-6xl px-6 pb-12">
			<motion.div
				initial={{ opacity: 0 }}
				whileInView={{ opacity: 1 }}
				viewport={{ once: true }}
				className="mb-16 text-center"
			>
				<h2 className="font-display text-3xl text-snow sm:text-5xl">
					Built for real projects
				</h2>
				<p className="mx-auto mt-4 max-w-lg text-base text-smoke">
					Wherever JavaScript ships to untrusted environments, Ruam
					can help you keep it safe.
				</p>
			</motion.div>

			<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
				{useCases.map((uc, i) => (
					<motion.div
						key={uc.title}
						initial={{ opacity: 0, y: 16 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true }}
						transition={{ delay: i * 0.06 }}
					>
						<div className="group flex h-full flex-col rounded-xl border border-edge bg-ink p-6 transition-all duration-200 hover:border-accent/15 hover:bg-accent/[0.02]">
							<div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-panel text-ash transition-colors group-hover:bg-accent/10 group-hover:text-accent">
								<FontAwesomeIcon
									icon={uc.icon}
									className="h-4 w-4"
								/>
							</div>
							<h3 className="mb-2 text-sm font-semibold text-snow">
								{uc.title}
							</h3>
							<p className="text-[12px] leading-relaxed text-smoke">
								{uc.description}
							</p>
						</div>
					</motion.div>
				))}
			</div>
		</section>
	);
}
