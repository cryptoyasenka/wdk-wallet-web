import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node 20+ exposes a global `crypto.subtle`, so the WebCrypto seed vault
    // is exercised for real (not mocked) in vault.test.ts.
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
