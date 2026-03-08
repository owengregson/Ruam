import type { Metadata } from "next";
import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
import "./globals.css";

config.autoAddCss = false;

export const metadata: Metadata = {
	title: "Ruam: JavaScript VM Obfuscation",
	description:
		"Compile JavaScript functions into encrypted custom bytecode executed by an embedded virtual machine. Open-source. Per-build unique. No deobfuscator exists.",
	icons: {
		icon: "/ruam.svg",
	},
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" className="dark">
			<head>
				<link rel="preconnect" href="https://fonts.googleapis.com" />
				<link
					rel="preconnect"
					href="https://fonts.gstatic.com"
					crossOrigin="anonymous"
				/>
				<link
					href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Fira+Code:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap"
					rel="stylesheet"
				/>
			</head>
			<body className="noise font-body antialiased">{children}</body>
		</html>
	);
}
