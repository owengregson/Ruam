import type { NextConfig } from "next";
import { join } from "path";

const isProd = process.env.NODE_ENV === "production";

const basePath = isProd ? "/Ruam" : "";

const nextConfig: NextConfig = {
	output: "export",
	basePath,
	images: {
		unoptimized: true,
	},
	env: {
		NEXT_PUBLIC_BASE_PATH: basePath,
	},
	outputFileTracingRoot: join(import.meta.dirname, "../../"),
};

export default nextConfig;
