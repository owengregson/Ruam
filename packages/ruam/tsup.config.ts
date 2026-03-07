import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  target: "es2022",
  external: [
    "@babel/generator",
    "@babel/parser",
    "@babel/traverse",
    "@babel/types",
    "fs-extra",
    "globby",
  ],
});
