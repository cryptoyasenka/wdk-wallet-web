/**
 * `CryptoWorker` host port — the engine-level lock signal (NOT the seed boundary).
 *
 * Subtle but deliberate (see docs/ARCHITECTURE.md → ADR-004): the real seed
 * isolation in this build lives behind the **WDK adapter**, not behind this
 * port. A Dedicated Web Worker owns `openSeed` + the WDK signer; the plaintext
 * seed and the signer never materialise on the main thread in steady state
 * (unlock → derive → quote → send → lock). The engine's signing path goes
 * through `WdkSigner`, so it never calls `deriveAddress`/`signTransaction` on
 * `deps.crypto` — a Worker placed behind this port would isolate nothing
 * (security theatre, which SECURITY.md forbids).
 *
 * What the engine *does* call is `deps.crypto.lock()` on every `lock()`: a
 * defense-in-depth hook a host can wire to also hard-stop any auxiliary worker
 * it spawned. This app keeps no key material on the main thread, so `lock()`
 * is a genuine no-op resolve — there is nothing here to wipe (the adapter
 * worker zeroises the seed + WDK manager on its own `dispose()`).
 *
 * `deriveAddress`/`signTransaction` exist only because the frozen `CryptoWorker`
 * port declares them; they reject loudly rather than silently returning wrong
 * data, since nothing in the engine drives them. This is intentional
 * architecture, not a pending Phase-2 implementation.
 */
import type { ChainId, CryptoWorker } from "@wdk-web/wallet-core";

const NOT_THE_BOUNDARY =
  "is not driven by the engine: seed isolation lives behind the WDK adapter " +
  "Web Worker (ADR-004), not behind the CryptoWorker port";

export class StubCryptoWorker implements CryptoWorker {
  deriveAddress(_chain: ChainId, _index: number): Promise<string> {
    return Promise.reject(new Error(`CryptoWorker.deriveAddress() ${NOT_THE_BOUNDARY}`));
  }

  signTransaction(_chain: ChainId, _unsignedTx: Uint8Array): Promise<Uint8Array> {
    return Promise.reject(new Error(`CryptoWorker.signTransaction() ${NOT_THE_BOUNDARY}`));
  }

  /** Engine-level lock signal. No key material is held here; nothing to wipe. */
  lock(): Promise<void> {
    return Promise.resolve();
  }
}
