/**
 * `UnlockProvider` backed by a WebAuthn passkey's PRF extension — the frozen
 * contract's *preferred* credential — with a transparent passphrase fallback.
 *
 * Why PRF, not a signature: a passkey assertion signature is non-deterministic,
 * so it can never *be* a key. The PRF extension (the WebAuthn surfacing of
 * CTAP2 `hmac-secret`) asks the authenticator to HMAC a fixed app salt under a
 * key sealed in the secure element. The result is a stable, 32-byte,
 * full-entropy secret bound to *that* passkey + *this* RP + *this* salt. It is
 * fed through wallet-core's `deriveAesGcmKeyFromEntropy` — HKDF, deliberately
 * NOT the passphrase path's 600k-iteration PBKDF2: the input is already
 * full-entropy, so key stretching would be pure cost with zero added security.
 *
 * Enrol vs derive — the two-ceremony split is deliberate, not redundant:
 *  - enrol = `navigator.credentials.create()` requesting the prf extension.
 *    Some authenticators return a usable PRF result here; many do NOT (PRF is
 *    only *guaranteed* at assertion time). So we never derive a key at create —
 *    we persist only the public credential id + the non-secret app salt, and
 *    refuse to enrol if the authenticator explicitly reports `prf.enabled` is
 *    false (so selection keeps falling back to the passphrase honestly).
 *  - derive = `navigator.credentials.get()` with `allowCredentials` pinned to
 *    the stored id and `prf.eval.first` = the stored salt. The 32-byte
 *    `results.first` is the input key material.
 *
 * Nothing secret is persisted: the credential id is a public handle, and the
 * PRF salt is non-secret by construction (it is HMAC *input*; the HMAC key is
 * sealed in the authenticator). The AES-GCM wrapping key is derived live on
 * every unlock and never stored. The IKM buffer is zeroised after derivation.
 *
 * Capability is never assumed. There is no offline test for "PRF will actually
 * work"; enrolment is the real probe. `chooseUnlockProvider` selects this
 * provider only when WebAuthn is present AND a credential has been enrolled
 * here — otherwise the passphrase provider is used. If the assertion succeeds
 * but yields no PRF result, `unlock()` throws a typed error the UI can surface
 * ("passkey unavailable — use your passphrase"); it does not silently no-op.
 *
 * Test honesty: the `navigator.credentials` ceremony is browser-only and is
 * verified manually, never with a faked assertion. The deterministic core
 * (HKDF: same IKM+salt round-trips a seal/open) is unit-tested in wallet-core
 * (`packages/wallet-core/test/vault.test.ts`). apps/next has no unit harness;
 * the selection/fallback wiring here is covered by typecheck + lint + build.
 */
import { deriveAesGcmKeyFromEntropy } from "@wdk-web/wallet-core";
import type { StorageAdapter, UnlockProvider, WalletEngine } from "@wdk-web/wallet-core";
import { PassphraseUnlock } from "./unlock";

/** Versioned, distinct from the passphrase salt key and the vault blob key. */
const WEBAUTHN_KEY = "wdk:unlock:webauthn:v1";
const ACTIVE_VAULT_CREDENTIAL_KEY = "wdk:unlock:active-vault:v1";

/** HKDF info label — domain-separates the WebAuthn path from any other use. */
const HKDF_INFO = "wdk-web/unlock/webauthn-prf/v1";

const RP_NAME = "WDK Wallet";
const USER_NAME = "wdk-wallet";
const USER_DISPLAY = "WDK Wallet";
const CEREMONY_TIMEOUT_MS = 60_000;

/** WebAuthn unavailable in this environment (no platform / not a browser). */
export class WebAuthnUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebAuthnUnavailableError";
  }
}

/** No passkey has been enrolled in this storage. */
export class WebAuthnNotEnrolledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebAuthnNotEnrolledError";
  }
}

/** The passkey exists but the authenticator did not deliver a PRF secret. */
export class WebAuthnPrfUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebAuthnPrfUnsupportedError";
  }
}

/*
 * WebAuthn PRF extension I/O. The PRF (CTAP2 hmac-secret) types are not yet in
 * this TypeScript release's lib.dom, so we declare the slice of the spec we use
 * as *subtypes* of the DOM extension types — keeping full type-checking on the
 * `prf` shape with no `unknown`/`any` escape hatch.
 */
interface PrfClientInputs extends AuthenticationExtensionsClientInputs {
  prf?: { eval?: { first: BufferSource; second?: BufferSource } };
}
interface PrfClientOutputs extends AuthenticationExtensionsClientOutputs {
  prf?: {
    enabled?: boolean;
    results?: { first?: BufferSource; second?: BufferSource };
  };
}

/** Persisted enrolment handle. Neither field is secret. */
interface EnrollmentRecord {
  /** base64url of the credential's rawId — a public handle. */
  credentialId: string;
  /** base64 of the 32-byte app salt fed to `prf.eval.first` (non-secret). */
  prfSalt: string;
}

function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return base64ToBytes(b64 + pad);
}

/** The RP id is the effective domain (host, no port). */
function rpId(): string {
  return typeof window !== "undefined" ? window.location.hostname : "localhost";
}

/** True when the platform exposes the WebAuthn credential APIs. */
export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.credentials?.create === "function" &&
    typeof navigator.credentials?.get === "function" &&
    typeof window.PublicKeyCredential !== "undefined"
  );
}

/** Pull a PRF assertion result out as raw bytes, tolerant of view vs buffer. */
function prfResultToBytes(first: BufferSource): Uint8Array {
  return first instanceof ArrayBuffer
    ? new Uint8Array(first)
    : new Uint8Array(first.buffer, first.byteOffset, first.byteLength);
}

export class WebAuthnUnlock implements UnlockProvider {
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
    return `${WEBAUTHN_KEY}${suffix}`;
  }

  async #activeVaultCredentialKey(): Promise<string> {
    const key = await this.#key();
    return key.replace(WEBAUTHN_KEY, ACTIVE_VAULT_CREDENTIAL_KEY);
  }

  async #readRecord(): Promise<EnrollmentRecord | null> {
    const key = await this.#key();
    const raw = await this.storage.get(key);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as EnrollmentRecord).credentialId === "string" &&
        typeof (parsed as EnrollmentRecord).prfSalt === "string"
      ) {
        const rec = parsed as EnrollmentRecord;
        // Both handles are base64; verify they actually DECODE here, at the one
        // read chokepoint. Otherwise a corrupt value would throw a raw
        // DOMException later, deep inside unlock()/enroll() (`atob`), instead of
        // falling into the corrupt-entry path below.
        base64UrlToBytes(rec.credentialId);
        base64ToBytes(rec.prfSalt);
        return rec;
      }
    } catch {
      // Corrupt entry (bad JSON, wrong shape, or undecodable base64): treat as
      // not-enrolled so selection falls back rather than hard-failing the whole
      // unlock surface.
    }
    return null;
  }

  /** Whether a passkey credential has been established in this storage. */
  async isEnrolled(): Promise<boolean> {
    return (await this.#readRecord()) !== null;
  }

  /**
   * Create a passkey requesting the PRF extension, derive the new wrapping key,
   * add a passkey-encrypted vault slot, and persist its public handle + app salt.
   * Throws (and persists nothing) if the authenticator reports PRF is
   * unavailable, so the passphrase path stays the honest selection.
   */
  async enroll(engine?: WalletEngine): Promise<void> {
    if (!isWebAuthnSupported()) {
      throw new WebAuthnUnavailableError("WebAuthn is not available in this browser");
    }
    const prfSalt = randomBytes(32);
    const publicKey: PublicKeyCredentialCreationOptions = {
      challenge: randomBytes(32),
      rp: { name: RP_NAME, id: rpId() },
      user: { id: randomBytes(16), name: USER_NAME, displayName: USER_DISPLAY },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      attestation: "none",
      timeout: CEREMONY_TIMEOUT_MS,
      extensions: { prf: {} } as PrfClientInputs,
    };
    const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
    if (!cred) {
      throw new WebAuthnUnavailableError("passkey creation returned no credential");
    }
    if ((cred.getClientExtensionResults() as PrfClientOutputs).prf?.enabled === false) {
      throw new WebAuthnPrfUnsupportedError(
        "the created passkey does not support the PRF extension; use the passphrase",
      );
    }

    // Retrieve PRF outputs (might be present directly on creation, or we run a quick assertion)
    let prfResult = (cred.getClientExtensionResults() as PrfClientOutputs).prf?.results?.first;
    if (!prfResult) {
      const publicKeyReq: PublicKeyCredentialRequestOptions = {
        challenge: randomBytes(32),
        rpId: rpId(),
        allowCredentials: [
          { type: "public-key", id: cred.rawId },
        ],
        userVerification: "required",
        timeout: CEREMONY_TIMEOUT_MS,
        extensions: { prf: { eval: { first: prfSalt } } } as PrfClientInputs,
      };
      const assertion = (await navigator.credentials.get({ publicKey: publicKeyReq })) as PublicKeyCredential | null;
      if (!assertion) {
        throw new WebAuthnUnavailableError("passkey assertion returned no credential");
      }
      prfResult = (assertion.getClientExtensionResults() as PrfClientOutputs).prf?.results?.first;
    }

    if (!prfResult) {
      throw new WebAuthnPrfUnsupportedError("authenticator did not deliver a PRF secret during enrollment");
    }

    const ikm = prfResultToBytes(prfResult);
    if (ikm.length < 32) {
      ikm.fill(0);
      throw new WebAuthnPrfUnsupportedError("PRF result too short to be a key");
    }

    try {
      const newKey = await deriveAesGcmKeyFromEntropy(ikm, prfSalt, HKDF_INFO);
      if (engine) {
        await engine.reencrypt(newKey);
      }
    } finally {
      ikm.fill(0);
    }

    const record: EnrollmentRecord = {
      credentialId: bytesToBase64Url(new Uint8Array(cred.rawId)),
      prfSalt: bytesToBase64(prfSalt),
    };
    const key = await this.#key();
    await this.storage.set(key, new TextEncoder().encode(JSON.stringify(record)));
  }

  /** Derive the vault-wrapping key via a PRF assertion on the enrolled passkey. */
  async unlock(): Promise<CryptoKey> {
    if (!isWebAuthnSupported()) {
      throw new WebAuthnUnavailableError("WebAuthn is not available in this browser");
    }
    const record = await this.#readRecord();
    if (!record) {
      throw new WebAuthnNotEnrolledError("no passkey enrolled in this wallet");
    }
    const prfSalt = base64ToBytes(record.prfSalt);
    const publicKey: PublicKeyCredentialRequestOptions = {
      challenge: randomBytes(32),
      rpId: rpId(),
      allowCredentials: [
        { type: "public-key", id: base64UrlToBytes(record.credentialId) },
      ],
      userVerification: "required",
      timeout: CEREMONY_TIMEOUT_MS,
      extensions: { prf: { eval: { first: prfSalt } } } as PrfClientInputs,
    };
    const assertion = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
    if (!assertion) {
      throw new WebAuthnUnavailableError("passkey assertion returned no credential");
    }
    const first = (assertion.getClientExtensionResults() as PrfClientOutputs).prf?.results
      ?.first;
    if (!first) {
      throw new WebAuthnPrfUnsupportedError(
        "authenticator returned no PRF result; use the passphrase",
      );
    }
    const ikm = prfResultToBytes(first);
    if (ikm.length < 32) {
      ikm.fill(0);
      throw new WebAuthnPrfUnsupportedError("PRF result too short to be a key");
    }
    try {
      // HKDF salt reuses the per-enrolment PRF salt: it is random, unique, and
      // independent of the IKM, which is all HKDF asks of its salt.
      const key = await deriveAesGcmKeyFromEntropy(ikm, prfSalt, HKDF_INFO);
      await this.storage.set(
        await this.#activeVaultCredentialKey(),
        new TextEncoder().encode("webauthn"),
      );
      return key;
    } finally {
      ikm.fill(0); // best-effort wipe of the high-entropy secret
    }
  }
}

/**
 * The documented selector: WebAuthn when the platform supports it AND a
 * passkey is enrolled here, otherwise a fresh passphrase provider. Stateless —
 * each call probes storage; useful for tests and one-shot selection.
 */
export async function chooseUnlockProvider(
  storage: StorageAdapter,
): Promise<UnlockProvider> {
  if (isWebAuthnSupported()) {
    const webauthn = new WebAuthnUnlock(storage);
    if (await webauthn.isEnrolled()) return webauthn;
  }
  return new PassphraseUnlock(storage);
}

/**
 * The engine-injected provider. Holds *persistent* passphrase + WebAuthn
 * instances (so the session passphrase set via the UI survives) and routes
 * each `unlock()` at call time: a typed passphrase wins (the always-available
 * recovery path), otherwise an enrolled passkey is used. The locked screen's
 * explicit passkey button clears the passphrase so the passkey path is taken.
 * This keeps `getWalletApp()` synchronous and leaves the Phase-1 passphrase flow
 * (`setPassphrase` → `engine.unlock()`) byte-for-byte unchanged.
 */
export class SelectingUnlockProvider implements UnlockProvider {
  readonly #passphrase: PassphraseUnlock;
  readonly #webauthn: WebAuthnUnlock;

  constructor(storage: StorageAdapter) {
    this.#passphrase = new PassphraseUnlock(storage);
    this.#webauthn = new WebAuthnUnlock(storage);
  }

  /** Phase-1 passphrase path — delegated unchanged. */
  setPassphrase(passphrase: string | null): void {
    this.#passphrase.setPassphrase(passphrase);
  }

  /** Opt into a passkey. UI-triggered; not part of `UnlockProvider`. */
  async enrollPasskey(engine?: WalletEngine): Promise<void> {
    await this.#webauthn.enroll(engine);
  }

  async #active(): Promise<UnlockProvider> {
    // An explicitly-typed passphrase is authoritative: it is the always-available
    // recovery path the UI promises ("your passphrase still works"). Routing to
    // it whenever one is set means an enrolled passkey can never lock the user
    // out of their passphrase — the two-blob vault keeps both keys valid, so the
    // bug was purely this selection. The passkey is used when the caller supplies
    // NO passphrase (the locked screen's explicit "Unlock with passkey" button
    // clears the session passphrase first).
    if (this.#passphrase.hasPendingPassphrase()) return this.#passphrase;
    if (isWebAuthnSupported() && (await this.#webauthn.isEnrolled())) {
      return this.#webauthn;
    }
    return this.#passphrase;
  }

  async unlock(): Promise<CryptoKey> {
    return (await this.#active()).unlock();
  }

  /** Whether a WebAuthn passkey is usable here (supported AND enrolled). The
   *  locked screen shows the passkey option only when this is true; that button
   *  clears the session passphrase (so `#active()` routes here) and unlocks via
   *  the engine, which opens the passkey vault blob. */
  async isPasskeyEnrolled(): Promise<boolean> {
    return isWebAuthnSupported() && (await this.#webauthn.isEnrolled());
  }

  async isEnrolled(): Promise<boolean> {
    return (
      (await this.#webauthn.isEnrolled()) || (await this.#passphrase.isEnrolled())
    );
  }
}
