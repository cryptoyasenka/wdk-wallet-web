/**
 * The worker-edge error round-trip. `wdk-core.ts` throws typed errors
 * worker-side; `serializeError` flattens them for structured clone and
 * `rehydrateError` rebuilds them on the main thread. Callers branch on both
 * `instanceof` AND `.message`, so the round-trip must preserve both exactly —
 * in particular it must NOT re-template the already-formatted message of the
 * argument-taking errors.
 */
import { describe, it, expect } from "vitest";
import { rehydrateError, serializeError } from "../src/wdk/worker-protocol.js";
import {
  InvalidSeedPhraseError,
  UnsupportedAssetError,
  UnsupportedChainError,
  VaultDecryptError,
  VaultFormatError,
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

  it("keeps the original name for an unmapped error without inventing a typed class", () => {
    const back = roundTrip(new TypeError("provider returned non-bigint"));
    expect(back).not.toBeInstanceOf(UnsupportedChainError);
    expect(back.name).toBe("TypeError");
    expect(back.message).toBe("provider returned non-bigint");
  });

  it("serializes a non-Error throw without losing its text", () => {
    const back = rehydrateError(serializeError("raw string failure"));
    expect(back.message).toBe("raw string failure");
  });
});
