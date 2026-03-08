import type { NextConfig } from "next";
import { join } from "path";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
	output: "export",
	basePath: isProd ? "/Ruam" : "",
	images: {
		unoptimized: true,
	},
	outputFileTracingRoot: join(import.meta.dirname, "../../"),
};

export default nextConfig;
