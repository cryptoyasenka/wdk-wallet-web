/**
 * Real WebCrypto exercise of the seed vault (Node 20+ global `crypto.subtle`,
 * vitest `environment: node`). Nothing here is mocked: a tampered byte must
 * actually fail the AES-GCM auth tag.
 */
import { describe, it, expect } from "vitest";
import {
  deriveAesGcmKey,
  generateSalt,
  openSeed,
  randomBytes,
  sealSeed,
  VAULT_BLOB_VERSION,
} from "../src/secrets/index.js";
import { VaultDecryptError, VaultFormatError } from "../src/errors.js";

const SEED = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

async function key(passphrase = "pw", salt = generateSalt()): Promise<CryptoKey> {
  return deriveAesGcmKey(passphrase, salt, 1000);
}

describe("seed vault", () => {
  it("seals and opens a phrase roundtrip", async () => {
    const k = await key();
    const blob = await sealSeed(SEED, k);
    expect(await openSeed(blob, k)).toBe(SEED);
  });

  it("writes a self-describing header (magic + version)", async () => {
    const blob = await sealSeed(SEED, await key());
    expect([blob[0], blob[1], blob[2]]).toEqual([0x57, 0x44, 0x4b]); // "WDK"
    expect(blob[3]).toBe(VAULT_BLOB_VERSION);
    expect(blob.length).toBeGreaterThan(16);
  });

  it("uses a fresh IV per seal (same input → different blob)", async () => {
    const k = await key();
    const a = await sealSeed(SEED, k);
    const b = await sealSeed(SEED, k);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("rejects the wrong key with VaultDecryptError", async () => {
    const salt = generateSalt();
    const blob = await sealSeed(SEED, await key("right", salt));
    await expect(openSeed(blob, await key("wrong", salt))).rejects.toBeInstanceOf(
      VaultDecryptError,
    );
  });

  it("detects a tampered ciphertext byte (GCM auth tag)", async () => {
    const k = await key();
    const blob = await sealSeed(SEED, k);
    blob[20] = (blob[20] ?? 0) ^ 0xff; // flip a byte in the ciphertext (header is 16 bytes)
    await expect(openSeed(blob, k)).rejects.toBeInstanceOf(VaultDecryptError);
  });

  it("rejects a too-short blob with VaultFormatError", async () => {
    await expect(openSeed(new Uint8Array(10), await key())).rejects.toBeInstanceOf(
      VaultFormatError,
    );
  });

  it("rejects a bad magic with VaultFormatError", async () => {
    const k = await key();
    const blob = await sealSeed(SEED, k);
    blob[0] = 0x00;
    await expect(openSeed(blob, k)).rejects.toBeInstanceOf(VaultFormatError);
  });

  it("rejects an unknown version with VaultFormatError", async () => {
    const k = await key();
    const blob = await sealSeed(SEED, k);
    blob[3] = 0x7f;
    await expect(openSeed(blob, k)).rejects.toBeInstanceOf(VaultFormatError);
  });

  it("randomBytes / generateSalt return the requested length", () => {
    expect(randomBytes(24)).toHaveLength(24);
    expect(generateSalt()).toHaveLength(16);
  });
});
