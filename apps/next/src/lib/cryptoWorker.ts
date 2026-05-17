/**
 * Phase-1 `CryptoWorker` stub.
 *
 * The frozen `CryptoWorker` port models a Web Worker that holds decrypted key
 * material so the seed never crosses to the caller — but the port has no
 * seed-provisioning method, so genuine in-Worker isolation only makes sense
 * paired with transaction signing. That is Phase 2 (see docs/ARCHITECTURE.md →
 * Phasing and docs/SECURITY.md for the honest limit on the web).
 *
 * In Phase 1 the engine decrypts the seed in-process and builds an in-process
 * signer; it never calls `deriveAddress`/`signTransaction` on this port, but it
 * does call `lock()` (forward-compatible: when P2 moves keys into a real
 * Worker, only this file changes). So `lock()` is a real no-op resolve — there
 * is no key material here to wipe — and the two unused methods fail loudly
 * rather than silently returning wrong data.
 */
import type { ChainId, CryptoWorker } from "@wdk-web/wallet-core";

const PHASE_2 =
  "is delivered in Phase 2 (Web Worker key isolation + signing); " +
  "Phase 1 derives addresses via the in-process WDK signer";

export class StubCryptoWorker implements CryptoWorker {
  deriveAddress(_chain: ChainId, _index: number): Promise<string> {
    return Promise.reject(new Error(`CryptoWorker.deriveAddress() ${PHASE_2}`));
  }

  signTransaction(_chain: ChainId, _unsignedTx: Uint8Array): Promise<Uint8Array> {
    return Promise.reject(new Error(`CryptoWorker.signTransaction() ${PHASE_2}`));
  }

  /** No key material is held in Phase 1; nothing to wipe. */
  lock(): Promise<void> {
    return Promise.resolve();
  }
}
