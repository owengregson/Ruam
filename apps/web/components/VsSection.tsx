"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	faLock,
	faShuffle,
	faShieldHalved,
} from "@fortawesome/free-solid-svg-icons";

const layers = [
	{
		icon: faLock,
		title: "Source-region proof",
		tag: "Contract 1",
		description:
			"Ruam selects a named pure return expression and requires an exact boolean or bounded-number domain for every scalar input. Configured regions fail closed when that proof is incomplete.",
		visual: [
			{
				label: "Selected source",
				value: "/* ruam:isogloss */ function quote(q,p) { return q*p+q*2 }",
				style: "ember" as const,
			},
			{
				label: "Guard domains",
				value: "quote.q ∈ [1,100] · quote.p ∈ [1,500]",
				style: "accent" as const,
			},
		],
	},
	{
		icon: faShuffle,
		title: "Scalar BPRF emission",
		tag: "Contract 2",
		description:
			"Physical slots and fragment contributions become dedicated opaque locals and scalar functions. Context selects among diversified realizations without a runtime artifact walker or generic evaluator.",
		visual: [
			{
				label: "Contextual realizations",
				value: "caller × epoch × lineage → realization k",
				style: "ember" as const,
			},
			{
				label: "Emitted shape",
				value: "physical slots → fragment functions → scalar output",
				style: "accent" as const,
			},
		],
	},
	{
		icon: faShieldHalved,
		title: "Deployment profile",
		tag: "Contract 3",
		description:
			"The profile states where the relation lives and what the client contains. Local mode is honestly complete; custody, private-function, and attested modes forbid a complete local fallback.",
		visual: [
			{
				label: "Complete client",
				value: "holographic-local → analysis amplification only",
				style: "ember" as const,
			},
			{
				label: "Incomplete client",
				value: "custodied · private · attested → no local fallback",
				style: "accent" as const,
			},
		],
	},
];

export default function VsSection() {
	const [active, setActive] = useState(0);
	const current = layers[active]!;

	return (
		<section className="mx-auto max-w-5xl px-6 pb-32">
			<motion.div
				initial={{ opacity: 0 }}
				whileInView={{ opacity: 1 }}
				viewport={{ once: true }}
			>
				<p className="mb-3 font-mono text-xs text-accent uppercase tracking-widest">
					Explicit by design
				</p>
				<h2 className="font-display text-3xl text-snow sm:text-5xl">
					Three verifiable contracts
				</h2>
				<p className="mt-4 max-w-lg text-base text-smoke">
					The source region, emitted representation, and deployment
					boundary each carry a separate fail-closed contract.
				</p>
			</motion.div>

			<div className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-12">
				{/* Layer selector — left column */}
				<div className="flex flex-col gap-3 lg:col-span-4">
					{layers.map((layer, i) => (
						<motion.button
							key={layer.title}
							initial={{ opacity: 0, x: -12 }}
							whileInView={{ opacity: 1, x: 0 }}
							viewport={{ once: true }}
							transition={{ delay: i * 0.08 }}
							onClick={() => setActive(i)}
							className={`group flex items-start gap-4 rounded-xl border p-4 text-left transition-all duration-200 ${
								active === i
									? "border-accent/20 bg-accent/[0.04]"
									: "border-transparent hover:border-edge hover:bg-ink/50"
							}`}
						>
							<div
								className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
									active === i
										? "bg-accent/15 text-accent"
										: "bg-panel text-ash group-hover:text-smoke"
								}`}
							>
								<FontAwesomeIcon
									icon={layer.icon}
									className="h-4 w-4"
								/>
							</div>
							<div>
								<div className="flex items-center gap-2">
									<span className="font-mono text-[10px] font-semibold text-accent uppercase tracking-wider">
										{layer.tag}
									</span>
								</div>
								<p
									className={`mt-0.5 text-sm font-semibold transition-colors ${
										active === i
											? "text-snow"
											: "text-cloud"
									}`}
								>
									{layer.title}
								</p>
							</div>
						</motion.button>
					))}
				</div>

				{/* Detail panel — right column */}
				<motion.div
					key={active}
					initial={{ opacity: 0, y: 8 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.3 }}
					className="lg:col-span-8"
				>
					<div className="terminal h-full">
						<div className="terminal-bar">
							<div className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
							<div className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
							<div className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
							<span className="ml-3 font-mono text-[11px] text-ash">
								{current.title.toLowerCase()}
							</span>
							<span className="ml-auto rounded bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-medium text-accent">
								{current.tag.toLowerCase()}
							</span>
						</div>

						<div className="p-6">
							<div className="mb-6 flex items-center gap-3">
								<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
									<FontAwesomeIcon
										icon={current.icon}
										className="h-5 w-5"
									/>
								</div>
								<div>
									<h3 className="text-lg font-semibold text-snow">
										{current.title}
									</h3>
								</div>
							</div>

							<p className="mb-6 text-[13px] leading-relaxed text-smoke">
								{current.description}
							</p>

							<div className="space-y-3">
								{current.visual.map((v) => (
									<div
										key={v.label}
										className="rounded-lg border border-edge bg-void/60 p-3"
									>
										<span className="mb-1.5 block font-mono text-[10px] font-semibold text-ash uppercase tracking-wider">
											{v.label}
										</span>
										<code
											className={`font-mono text-[12px] ${
												v.style === "accent"
													? "text-accent"
													: "text-ember"
											}`}
										>
											{v.value}
										</code>
									</div>
								))}
							</div>

							{/* Progress indicator */}
							<div className="mt-6 flex items-center gap-2">
								{layers.map((_, i) => (
									<div
										key={i}
										className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
											i <= active
												? "bg-accent/40"
												: "bg-edge"
										}`}
									/>
								))}
								<span className="ml-2 font-mono text-[10px] text-ash">
									{active + 1}/{layers.length}
								</span>
							</div>
						</div>
					</div>
				</motion.div>
			</div>
		</section>
	);
}
