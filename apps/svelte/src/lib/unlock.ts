/**
 * `UnlockProvider` backed by a user passphrase.
 *
 * This is the ONLY unlock provider in the portability proof, by design — not
 * a phase-staging artifact, and the single deliberate delta vs apps/next. The
 * passkey/PRF leg is already proven there and the engine's unlock contract is
 * identical either way, so a second passkey UI proves nothing new about the
 * engine — a host-port choice, not a scope cut (ADR-005). The seam being
 * proven is the engine, exercised at full parity (onboarding + unlock +
 * portfolio + send + itemised tx-confirm + activity) against passphrase unlock.
 *
 * The vault-wrapping key is derived from the passphrase via wallet-core's own
 * `deriveAesGcmKey`/`generateSalt` (PBKDF2) so the app never reimplements
 * crypto and the salt format stays owned by the core.
 *
 * Salt handling: PBKDF2 needs a per-vault random salt. It is NOT secret, so we
 * persist it (via the same injected `StorageAdapter` the vault blob lives in)
 * under its own versioned key, beside the blob. First `unlock()` mints and
 * stores it; every later `unlock()` reads it back, so the same passphrase
 * always derives the same key. `isEnrolled()` reports whether that salt exists,
 * i.e. whether a passphrase credential has ever been established here.
 *
 * The passphrase is injected per session via `setPassphrase` (the UI collects
 * it, then triggers the engine call that consumes it). It is held only as long
 * as this instance lives and never persisted.
 */
import { deriveAesGcmKey, generateSalt } from "@wdk-web/wallet-core";
import type { StorageAdapter, UnlockProvider } from "@wdk-web/wallet-core";

/** Versioned, distinct from wallet-core's `wdk:vault:v1` seed-blob key. */
const UNLOCK_SALT_KEY = "wdk:unlock:salt:v1";

export class PassphraseUnlock implements UnlockProvider {
  #passphrase: string | null = null;

  constructor(private readonly storage: StorageAdapter) {}

  /** Set (or clear) the session passphrase. Call before an unlock-triggering op. */
  setPassphrase(passphrase: string | null): void {
    this.#passphrase = passphrase;
  }

  async isEnrolled(): Promise<boolean> {
    return (await this.storage.get(UNLOCK_SALT_KEY)) !== null;
  }

  async unlock(): Promise<CryptoKey> {
    if (!this.#passphrase) {
      throw new Error("no passphrase set; call setPassphrase() before unlocking");
    }
    let salt = await this.storage.get(UNLOCK_SALT_KEY);
    if (salt === null) {
      salt = generateSalt();
      await this.storage.set(UNLOCK_SALT_KEY, salt);
    }
    return deriveAesGcmKey(this.#passphrase, salt);
  }
}
