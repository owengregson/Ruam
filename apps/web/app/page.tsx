import { readFileSync } from "fs";
import { join } from "path";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import CodeShowcase from "@/components/CodeShowcase";
import PipelineFlow from "@/components/PipelineFlow";
import GetStarted from "@/components/GetStarted";
import Footer from "@/components/Footer";

function loadHeroSnippet() {
	try {
		const statsPath = join(
			process.cwd(),
			"..",
			"..",
			"packages",
			"ruam",
			"stats.json"
		);
		const stats = JSON.parse(readFileSync(statsPath, "utf-8"));
		return stats.heroSnippet ?? null;
	} catch {
		return null;
	}
}

export default function Home() {
	const heroSnippet = loadHeroSnippet();

	return (
		<>
			<Navbar />
			<main>
				<Hero snippet={heroSnippet} />
				<CodeShowcase />
				<PipelineFlow />
				<GetStarted />
			</main>
			<Footer />
		</>
	);
}
