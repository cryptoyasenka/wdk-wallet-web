/**
 * The worker-edge error round-trip. `wdk-core.ts` throws typed errors
 * worker-side; `serializeError` flattens them for structured clone and
 * `rehydrateError` rebuilds them on the main thread. Callers branch on both
 * `instanceof` AND `.message`, so the round-trip must preserve both exactly —
 * in particular it must NOT re-template the already-formatted message of the
 * argument-taking errors.
 */
import { describe, it, expect } from "vitest";
import {
  FOREIGN_WORKER_ERROR_MESSAGE,
  rehydrateError,
  serializeError,
} from "../src/wdk/worker-protocol.js";
import {
  InvalidSeedPhraseError,
  UnsupportedAssetError,
  UnsupportedChainError,
  VaultDecryptError,
  VaultFormatError,
  WalletError,
} from "../src/errors.js";

/** What actually happens across the edge: throw → serialize → clone → rehydrate. */
function roundTrip(thrown: Error): Error {
  return rehydrateError(serializeError(thrown));
}

describe("worker-protocol error round-trip", () => {
  it("preserves class identity for the fixed-message errors", () => {
    expect(roundTrip(new VaultDecryptError())).toBeInstanceOf(VaultDecryptError);
    expect(roundTrip(new VaultFormatError())).toBeInstanceOf(VaultFormatError);
    expect(roundTrip(new InvalidSeedPhraseError())).toBeInstanceOf(InvalidSeedPhraseError);
  });

  it("preserves identity AND the exact message for UnsupportedChainError (no double-wrap)", () => {
    const original = new UnsupportedChainError("ethereum");
    const back = roundTrip(original);
    expect(back).toBeInstanceOf(UnsupportedChainError);
    // The bug being guarded: re-templating produced
    // `chain "chain "ethereum" is not configured…"`.
    expect(back.message).toBe(original.message);
    expect(back.message).toBe('chain "ethereum" is not configured in this build');
  });

  it("preserves identity AND the exact message for UnsupportedAssetError (no double prefix)", () => {
    const original = new UnsupportedAssetError("Bitcoin has no token balances");
    const back = roundTrip(original);
    expect(back).toBeInstanceOf(UnsupportedAssetError);
    expect(back.message).toBe(original.message);
    expect(back.message).toBe("unsupported asset operation: Bitcoin has no token balances");
  });

  it("preserves the verbatim message of the engine's OWN WalletError types", () => {
    // The load-bearing distinction (Finding 13): our typed errors carry fixed,
    // vetted strings and must survive intact; only FOREIGN text is sanitized.
    const back = roundTrip(new WalletError("a vetted engine message"));
    expect(back).toBeInstanceOf(WalletError);
    expect(back.message).toBe("a vetted engine message");
  });

  it("sanitizes an unmapped (foreign) error's message but keeps its name (Finding 13)", () => {
    // A provider/WDK/runtime error is foreign: its free-form text is uncontrolled
    // (it can embed a keyed RPC URL) and the main thread renders it, so the edge
    // drops the message to a generic string while keeping the name for instanceof.
    const back = roundTrip(new TypeError("provider failed at https://eth.example/v2/SECRET"));
    expect(back).not.toBeInstanceOf(UnsupportedChainError);
    expect(back.name).toBe("TypeError");
    expect(back.message).toBe(FOREIGN_WORKER_ERROR_MESSAGE);
    expect(back.message).not.toContain("SECRET");
  });

  it("sanitizes a non-Error throw to the generic worker message", () => {
    const back = rehydrateError(serializeError("raw string failure"));
    expect(back.message).toBe(FOREIGN_WORKER_ERROR_MESSAGE);
    expect(back.message).not.toContain("raw string failure");
  });
});
