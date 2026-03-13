import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Playground from "@/components/Playground";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
	title: "Playground — Ruam",
	description:
		"Try Ruam in your browser. Paste JavaScript, pick a preset, and see the obfuscated output instantly.",
};

export default function PlaygroundPage() {
	return (
		<>
			<Navbar />
			<main className="pt-14">
				<Playground />
			</main>
			<Footer />
		</>
	);
}
