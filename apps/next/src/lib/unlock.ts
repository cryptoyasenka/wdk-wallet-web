/**
 * `UnlockProvider` backed by a user passphrase — the passphrase leg of the
 * app's `SelectingUnlockProvider`. The frozen contract's preferred credential
 * is a WebAuthn passkey (PRF); `SelectingUnlockProvider` routes to the passkey
 * when one is enrolled in this wallet and falls back to this passphrase path
 * otherwise (see `webauthnUnlock.ts` and docs/ARCHITECTURE.md → ADR-005). PRF
 * support is narrower than passkey support, so the passphrase is a first-class
 * path, not a degraded one.
 *
 * Key derivation: the vault-wrapping key comes from the passphrase via PBKDF2,
 * using wallet-core's own `deriveAesGcmKey`/`generateSalt` so the app never
 * reimplements crypto and the salt format stays owned by the core.
 *
 * Salt handling: PBKDF2 needs a per-vault random salt. It is NOT secret, so we
 * persist it (via the same injected `StorageAdapter` the vault blob lives in)
 * under its own versioned key, beside the blob. First `unlock()` mints and
 * stores it; every later `unlock()` reads it back, so the same passphrase
 * always derives the same key. `isEnrolled()` reports whether that salt exists,
 * i.e. whether a passphrase credential has ever been established here.
 *
 * The passphrase is injected per session via `setPassphrase` (the UI collects
 * it, then triggers the engine call that consumes it) and is never persisted.
 * The UI drops it again via `setPassphrase("")` once a flow completes (its
 * `resetSecrets()`), so it is not retained for the whole singleton lifetime.
 * JS strings are immutable, so clearing drops the reference, not the bytes.
 */
import { deriveAesGcmKey, generateSalt } from "@wdk-web/wallet-core";
import type { StorageAdapter, UnlockProvider } from "@wdk-web/wallet-core";

/** Versioned, distinct from wallet-core's `wdk:vault:v1` seed-blob key. */
const UNLOCK_SALT_KEY = "wdk:unlock:salt:v1";
const ACTIVE_VAULT_CREDENTIAL_KEY = "wdk:unlock:active-vault:v1";

export class PassphraseUnlock implements UnlockProvider {
  #passphrase: string | null = null;

  constructor(private readonly storage: StorageAdapter) {}

  async #key(): Promise<string> {
    let walletIndex = 0;
    try {
      const bytes = await this.storage.get("wdk:active-wallet:v1");
      if (bytes !== null) {
        const n = Number.parseInt(new TextDecoder().decode(bytes), 10);
        if (Number.isSafeInteger(n) && n >= 0) walletIndex = n;
      }
    } catch {
      // fallback to wallet 0
    }
    const suffix = walletIndex === 0 ? "" : `:w${walletIndex}`;
    return `${UNLOCK_SALT_KEY}${suffix}`;
  }

  async #activeVaultCredentialKey(): Promise<string> {
    const key = await this.#key();
    return key.replace(UNLOCK_SALT_KEY, ACTIVE_VAULT_CREDENTIAL_KEY);
  }

  /** Set (or clear) the session passphrase. Call before an unlock-triggering op. */
  setPassphrase(passphrase: string | null): void {
    this.#passphrase = passphrase;
  }

  /**
   * Whether a non-empty session passphrase is currently set. `SelectingUnlockProvider`
   * uses this to make an explicitly-typed passphrase authoritative over an enrolled
   * passkey, so the promised passphrase fallback can never be locked out.
   */
  hasPendingPassphrase(): boolean {
    return this.#passphrase !== null && this.#passphrase !== "";
  }

  async isEnrolled(): Promise<boolean> {
    const key = await this.#key();
    return (await this.storage.get(key)) !== null;
  }

  async unlock(): Promise<CryptoKey> {
    if (!this.#passphrase) {
      throw new Error("no passphrase set; call setPassphrase() before unlocking");
    }
    const key = await this.#key();
    let salt = await this.storage.get(key);
    if (salt === null) {
      salt = generateSalt();
      await this.storage.set(key, salt);
    }
    await this.storage.set(
      await this.#activeVaultCredentialKey(),
      new TextEncoder().encode("passphrase"),
    );
    return deriveAesGcmKey(this.#passphrase, salt);
  }
}
