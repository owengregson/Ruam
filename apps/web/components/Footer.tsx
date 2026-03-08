import Image from "next/image";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGithub, faNpm } from "@fortawesome/free-brands-svg-icons";

export default function Footer() {
	return (
		<footer className="border-t border-edge/30 py-10">
			<div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
				<div className="flex items-center gap-2.5">
					<Image src="/ruam.svg" alt="Ruam" width={20} height={20} />
					<span className="font-mono text-xs text-ash">
						ruam &middot; made with ❤️ by{" "}
						<a
							href="https://owen.lol/"
							target="_blank"
							rel="noopener noreferrer"
							className="text-smoke underline decoration-steel/50 underline-offset-2 transition hover:text-white hover:decoration-smoke/50"
						>
							owen.lol
						</a>
					</span>
				</div>
				<div className="flex items-center gap-3">
					<a
						href="https://github.com/owengregson/ruam#readme"
						target="_blank"
						rel="noopener noreferrer"
						className="font-mono text-[11px] text-ash transition hover:text-smoke"
					>
						docs
					</a>
					<span className="text-steel">/</span>
					<a
						href="https://github.com/owengregson/ruam"
						target="_blank"
						rel="noopener noreferrer"
						className="text-ash transition hover:text-smoke"
					>
						<FontAwesomeIcon
							icon={faGithub}
							className="h-3.5 w-3.5"
						/>
					</a>
					<a
						href="https://www.npmjs.com/package/ruam"
						target="_blank"
						rel="noopener noreferrer"
						className="text-ash transition hover:text-smoke"
					>
						<FontAwesomeIcon icon={faNpm} className="h-3.5 w-3.5" />
					</a>
				</div>
			</div>
		</footer>
	);
}
