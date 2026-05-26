import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure helper tests only (no DOM); the URI builders are framework-free.
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
