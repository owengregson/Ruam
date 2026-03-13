"use client";

import { useEffect } from "react";

export default function SiteProtection() {
	useEffect(() => {
		const blockContextMenu = (e: Event) => e.preventDefault();

		const blockDevTools = (e: KeyboardEvent) => {
			// F12
			if (e.key === "F12") {
				e.preventDefault();
				return;
			}
			// Ctrl+Shift+I/J/C (Windows/Linux) or Cmd+Option+I/J/C (macOS)
			if (
				((e.ctrlKey && e.shiftKey) || (e.metaKey && e.altKey)) &&
				/^[ijc]$/i.test(e.key)
			) {
				e.preventDefault();
				return;
			}
			// Ctrl+U / Cmd+U (view source)
			if ((e.ctrlKey || e.metaKey) && e.key === "u") {
				e.preventDefault();
			}
		};

		document.addEventListener("contextmenu", blockContextMenu);
		document.addEventListener("keydown", blockDevTools);

		return () => {
			document.removeEventListener("contextmenu", blockContextMenu);
			document.removeEventListener("keydown", blockDevTools);
		};
	}, []);

	return null;
}
