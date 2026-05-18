/**
 * Scaffold smoke test. A real (not no-op) assertion that the Svelte app can
 * import the byte-unchanged `@wdk-web/wallet-core` public surface and that the
 * factory + a typed error are actually present. The full headless portability
 * assertion (D-07: createWallet → unlock → getBalances through in-memory
 * ports) lands with the screens in the next commit; this just proves the
 * workspace wiring resolves the core from a second app.
 */
import { describe, expect, it } from "vitest";
import { createWalletEngine, WalletError } from "@wdk-web/wallet-core";

describe("svelte app ↔ wallet-core wiring", () => {
  it("resolves the public factory from a second framework's app", () => {
    expect(typeof createWalletEngine).toBe("function");
  });

  it("resolves the public typed-error base", () => {
    expect(new WalletError("x")).toBeInstanceOf(Error);
  });
});
