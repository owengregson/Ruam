import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Playground from "@/components/Playground";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
	title: "Playground — Ruam",
	description:
		"Compile full-language JavaScript with Ruam's complete-local Isogloss profile and define exact domains for relations that should enter the protected BPRF lane.",
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
