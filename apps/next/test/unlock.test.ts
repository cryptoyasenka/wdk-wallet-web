/**
 * Unlock-provider selection contract (re-audit Finding 1).
 *
 * The bug: once a passkey was enrolled, `SelectingUnlockProvider` always routed
 * to WebAuthn, so a typed passphrase — the UI's promised recovery path ("your
 * passphrase still works") — was ignored, and a user with a VALID passphrase
 * could be locked out if PRF failed. The fix makes a non-empty session
 * passphrase authoritative over an enrolled passkey.
 *
 * These tests run in the node env (apps/next/vitest.config.ts), where WebAuthn
 * is unsupported, so they lock the passphrase-side contract that drives the fix:
 * `hasPendingPassphrase()` behaviour, and that the selector actually unlocks via
 * the passphrase when one is set. The browser passphrase-vs-passkey *selection*
 * (when WebAuthn IS supported) is inherently browser-only and is covered by
 * typecheck + build + the e2e smoke run + manual verification.
 */
import { describe, expect, it } from "vitest";
import type { StorageAdapter } from "@wdk-web/wallet-core";
import { PassphraseUnlock } from "../src/lib/unlock";
import { SelectingUnlockProvider } from "../src/lib/webauthnUnlock";

function memStorage(): StorageAdapter {
  const m = new Map<string, Uint8Array>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => {
      m.set(k, v);
    },
    remove: async (k) => {
      m.delete(k);
    },
  };
}

describe("PassphraseUnlock.hasPendingPassphrase", () => {
  it("is false before any passphrase is set", () => {
    expect(new PassphraseUnlock(memStorage()).hasPendingPassphrase()).toBe(false);
  });

  it("is true once a non-empty passphrase is set", () => {
    const p = new PassphraseUnlock(memStorage());
    p.setPassphrase("correct horse battery staple");
    expect(p.hasPendingPassphrase()).toBe(true);
  });

  it("is false after the passphrase is cleared (empty string or null)", () => {
    const p = new PassphraseUnlock(memStorage());
    p.setPassphrase("x");
    p.setPassphrase("");
    expect(p.hasPendingPassphrase()).toBe(false);
    p.setPassphrase("y");
    p.setPassphrase(null);
    expect(p.hasPendingPassphrase()).toBe(false);
  });
});

describe("SelectingUnlockProvider", () => {
  it("unlocks via the passphrase when one is set (the recovery path stays wired)", async () => {
    const provider = new SelectingUnlockProvider(memStorage());
    provider.setPassphrase("a strong test passphrase");
    const key = await provider.unlock();
    expect((key as CryptoKey).type).toBe("secret");
    expect((key as CryptoKey).algorithm.name).toBe("AES-GCM");
  });

  it("reports no passkey enrolled outside a WebAuthn-capable browser", async () => {
    const provider = new SelectingUnlockProvider(memStorage());
    expect(await provider.isPasskeyEnrolled()).toBe(false);
  });
});
