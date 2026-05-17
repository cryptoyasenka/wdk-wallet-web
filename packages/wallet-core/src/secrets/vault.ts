/**
 * The seed vault — WebCrypto AES-GCM, framework-free, no Node Buffer.
 *
 * This module is deliberately pure: it turns (seed phrase + AES-GCM key) into
 * an opaque blob and back. It does NOT touch storage or unlock — the engine
 * owns persistence (injected `StorageAdapter`) and the wrapping key comes from
 * the injected `UnlockProvider`. That separation is what makes the security
 * model testable and the same vault reusable by a browser extension or an
 * eCommerce checkout unchanged.
 *
 * `deriveAesGcmKey` (PBKDF2) is provided so an app/test can build a
 * passphrase-based `UnlockProvider` in Phase 1. WebAuthn-derived keys (Phase 2)
 * plug into `sealSeed`/`openSeed` identically — the vault never learns how the
 * key was obtained.
 *
 * Honest limit (see docs/SECURITY.md): the decrypted seed transits JS memory
 * as a string, which cannot be zeroised. We zeroise every byte buffer we own
 * and keep the decrypted lifetime as short as the caller allows.
 */
import { VaultDecryptError, VaultFormatError } from "../errors.js";

/** Blob layout: MAGIC(3) | VERSION(1) | IV(12) | ciphertext+GCM tag. */
const MAGIC = Uint8Array.from([0x57, 0x44, 0x4b]); // "WDK"
const VERSION = 1;
const IV_BYTES = 12; // 96-bit nonce — the AES-GCM standard size
const HEADER_BYTES = MAGIC.length + 1 + IV_BYTES;

/**
 * PBKDF2 work factor. OWASP's 2023 floor for PBKDF2-HMAC-SHA256 is 600k
 * iterations; bumping the version constant is the migration path if that
 * floor rises.
 */
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;

/** Cryptographically-strong random bytes (WebCrypto, present in DOM & Worker). */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

/** A fresh 16-byte salt for `deriveAesGcmKey`. Not secret; store beside the blob. */
export function generateSalt(): Uint8Array {
  return randomBytes(SALT_BYTES);
}

/**
 * Derive a non-extractable AES-GCM-256 key from a passphrase via PBKDF2.
 * Non-extractable means the raw key cannot be read back out of the CryptoKey,
 * even by our own code — it can only be used to encrypt/decrypt.
 */
export async function deriveAesGcmKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const passphraseBytes = enc.encode(passphrase);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    passphraseBytes,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  passphraseBytes.fill(0);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false, // non-extractable
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a seed phrase under an AES-GCM key. Returns a self-describing blob
 * (magic + version + random IV + ciphertext) safe to hand to a
 * `StorageAdapter`. The UTF-8 plaintext buffer is zeroised before returning.
 */
export async function sealSeed(seedPhrase: string, key: CryptoKey): Promise<Uint8Array> {
  const iv = randomBytes(IV_BYTES);
  const plaintext = new TextEncoder().encode(seedPhrase);
  let cipher: ArrayBuffer;
  try {
    cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plaintext);
  } finally {
    plaintext.fill(0);
  }
  const cipherBytes = new Uint8Array(cipher);
  const blob = new Uint8Array(HEADER_BYTES + cipherBytes.length);
  blob.set(MAGIC, 0);
  blob[MAGIC.length] = VERSION;
  blob.set(iv, MAGIC.length + 1);
  blob.set(cipherBytes, HEADER_BYTES);
  return blob;
}

/**
 * Decrypt a blob produced by `sealSeed`. Throws `VaultFormatError` for a
 * malformed/old blob and `VaultDecryptError` for a wrong key or tampered data
 * (the GCM auth tag check). Neither error echoes the underlying cause.
 */
export async function openSeed(blob: Uint8Array, key: CryptoKey): Promise<string> {
  if (blob.length <= HEADER_BYTES) throw new VaultFormatError();
  for (let i = 0; i < MAGIC.length; i++) {
    if (blob[i] !== MAGIC[i]) throw new VaultFormatError();
  }
  if (blob[MAGIC.length] !== VERSION) throw new VaultFormatError();

  const iv = blob.subarray(MAGIC.length + 1, HEADER_BYTES);
  const cipher = blob.subarray(HEADER_BYTES);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, cipher);
  } catch {
    throw new VaultDecryptError();
  }
  const bytes = new Uint8Array(plaintext);
  try {
    return new TextDecoder().decode(bytes);
  } finally {
    bytes.fill(0);
  }
}

/** Blob format version, exported so the engine/tests can assert on upgrades. */
export const VAULT_BLOB_VERSION = VERSION;
