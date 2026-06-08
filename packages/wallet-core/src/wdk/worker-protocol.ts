/**
 * The postMessage contract between the main-thread proxy (`worker-proxy.ts`)
 * and the Dedicated Web Worker (`crypto.worker.ts`). No `@tetherto/*` here —
 * these are plain, structured-clone-safe shapes.
 *
 * What crosses the edge: `Uint8Array` (sealed blob), a non-extractable
 * `CryptoKey` *handle* (raw bytes stay in the browser key store), `bigint`
 * amounts, and plain config/intents. The plaintext seed never appears in any
 * message in either direction — that is the whole point (ADR-004).
 */
import type { ChainId, FeePreference, TxIntent } from "../types.js";
import type { ChainRegistry } from "./types.js";
import {
  InvalidSeedPhraseError,
  UnsupportedAssetError,
  UnsupportedChainError,
  VaultDecryptError,
  VaultFormatError,
  WalletError,
} from "../errors.js";

export type TxStatus = "pending" | "confirmed" | "failed";

/** Main → worker. `id` correlates the reply; `handle` ids scope signer/reader. */
export type WorkerRequest =
  | { id: number; kind: "generateSeedPhrase"; words: 12 | 24 }
  | { id: number; kind: "isValidSeedPhrase"; seedPhrase: string }
  | {
      id: number;
      kind: "createSigner";
      sealed: Uint8Array;
      key: CryptoKey;
      chains: ChainRegistry;
    }
  | { id: number; kind: "signer.deriveAddress"; handle: number; chain: ChainId; index: number }
  | { id: number; kind: "signer.quoteSend"; handle: number; intent: TxIntent; accountIndex: number; feePreference?: FeePreference }
  | { id: number; kind: "signer.send"; handle: number; intent: TxIntent; accountIndex: number; feePreference?: FeePreference }
  | { id: number; kind: "signer.reencrypt"; handle: number; key: CryptoKey }
  | { id: number; kind: "signer.dispose"; handle: number }
  | { id: number; kind: "createBalanceReader"; chains: ChainRegistry }
  | { id: number; kind: "reader.getNativeBalance"; handle: number; chain: ChainId; address: string }
  | {
      id: number;
      kind: "reader.getTokenBalance";
      handle: number;
      chain: ChainId;
      token: string;
      address: string;
    }
  | {
      id: number;
      kind: "reader.getTransactionStatus";
      handle: number;
      chain: ChainId;
      hash: string;
      address: string;
    }
  | { id: number; kind: "reader.dispose"; handle: number };

/** A WalletError flattened for structured clone (class identity does not survive). */
export interface SerializedError {
  readonly name: string;
  readonly message: string;
}

/** Worker → main. `result` is `unknown`; the proxy knows the expected shape. */
export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: SerializedError };

/**
 * Stand-in message for any FOREIGN error — anything that is not one of the
 * engine's own `WalletError` types — crossing the worker edge. Foreign text is
 * uncontrolled: a `@tetherto/wdk-*`, provider, or runtime error can embed a
 * self-hoster's keyed RPC URL, an internal path, or other noise, and the main
 * thread renders the message verbatim (apps/next `errorToMessage`). We forward
 * the error NAME so `instanceof`/debugging survive, but not the free-form text.
 * No key bytes ever reach a message (ADR-004); this closes the lower-value but
 * still-uncontrolled foreign-text channel (re-audit Finding 13).
 */
export const FOREIGN_WORKER_ERROR_MESSAGE = "the wallet worker reported an unexpected error";

/**
 * Flatten an error for the postMessage reply (no class identity over clone).
 * Only the engine's OWN typed errors (`WalletError` subclasses, whose messages
 * are fixed, vetted strings) keep their message verbatim. Every foreign error is
 * reduced to its name plus `FOREIGN_WORKER_ERROR_MESSAGE` so no uncontrolled
 * library text is forwarded to the renderer.
 */
export function serializeError(e: unknown): SerializedError {
  if (e instanceof WalletError) return { name: e.name, message: e.message };
  if (e instanceof Error) return { name: e.name, message: FOREIGN_WORKER_ERROR_MESSAGE };
  return { name: "Error", message: FOREIGN_WORKER_ERROR_MESSAGE };
}

/**
 * Rebuild the typed error on the main side so callers' `instanceof
 * WalletLockedError`-style branches keep working across the worker edge. Only
 * the no-arg / single-string typed errors the adapter can actually throw are
 * mapped; anything else becomes a generic `Error` with the original name kept
 * (honest: we do not invent a typed error we cannot reconstruct).
 */
export function rehydrateError({ name, message }: SerializedError): Error {
  // Reconstruct the class so callers' `instanceof` branches survive the edge,
  // then restore the EXACT serialized text. `UnsupportedChainError` /
  // `UnsupportedAssetError` template their argument into the message, so
  // re-passing the already-formatted `message` would double-wrap it
  // (`chain "chain "x" is not configured…"`). Set `.message` directly instead;
  // for the fixed-message errors this is the same string they already carry.
  let err: Error;
  switch (name) {
    case "VaultDecryptError":
      err = new VaultDecryptError();
      break;
    case "VaultFormatError":
      err = new VaultFormatError();
      break;
    case "InvalidSeedPhraseError":
      err = new InvalidSeedPhraseError();
      break;
    case "UnsupportedChainError":
      err = new UnsupportedChainError("");
      break;
    case "UnsupportedAssetError":
      err = new UnsupportedAssetError("");
      break;
    default:
      err = name.endsWith("Error") && message ? new WalletError(message) : new Error(message);
      err.name = name;
      return err;
  }
  err.message = message;
  return err;
}
