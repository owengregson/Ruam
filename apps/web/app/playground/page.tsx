import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Playground from "@/components/Playground";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
	title: "Playground — Ruam",
	description:
		"Define guarded input domains for a pure JavaScript source region and compile it with Ruam's complete-local Isogloss profile.",
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
