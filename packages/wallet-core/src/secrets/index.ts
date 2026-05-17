/** Seed vault: pure WebCrypto AES-GCM seal/open + a PBKDF2 key-derivation helper. */
export {
  sealSeed,
  openSeed,
  deriveAesGcmKey,
  generateSalt,
  randomBytes,
  VAULT_BLOB_VERSION,
} from "./vault.js";
