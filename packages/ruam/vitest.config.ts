import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30_000,
    include: ["test/**/*.test.ts"],
    reporters: ["default", "json"],
    outputFile: {
      json: "test-results.json",
    },
  },
});
