/**
 * The Dedicated Web Worker that OWNS the decrypted seed + WDK manager.
 *
 * This is the real Phase-2 seed-isolation boundary (ADR-004). It hosts a
 * `WdkCoreAdapter`: the sealed vault blob + AES-GCM `CryptoKey` arrive over
 * postMessage, `openSeed` runs *here*, and the plaintext seed never leaves
 * this scope — the main thread only ever receives addresses / fee quotes / tx
 * hashes / balances. It is, with `wdk-core.ts`, a sanctioned `@tetherto/*`
 * import site (under src/wdk/, ESLint-allowed) because it imports WDK only
 * transitively through `WdkCoreAdapter`.
 *
 * Honest limit (docs/SECURITY.md, RN-TO-WEB-MAP): a Web Worker is
 * defense-in-depth, NOT an XSS boundary like RN BareKit's separate runtime.
 */
import { WdkCoreAdapter } from "./wdk-core.js";
import type { WdkBalanceReader, WdkSigner } from "./types.js";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol.js";
import { serializeError } from "./worker-protocol.js";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const adapter = new WdkCoreAdapter();

/** Live signer/reader instances, keyed by the id handed back to the proxy. */
const signers = new Map<number, WdkSigner>();
const readers = new Map<number, WdkBalanceReader>();
let nextHandle = 1;

function signer(handle: number): WdkSigner {
  const s = signers.get(handle);
  if (!s) throw new Error("signer handle is not (or no longer) valid");
  return s;
}
function reader(handle: number): WdkBalanceReader {
  const r = readers.get(handle);
  if (!r) throw new Error("reader handle is not (or no longer) valid");
  return r;
}

async function handle(req: WorkerRequest): Promise<unknown> {
  switch (req.kind) {
    case "generateSeedPhrase":
      return { seedPhrase: await adapter.generateSeedPhrase(req.words) };
    case "isValidSeedPhrase":
      return { valid: await adapter.isValidSeedPhrase(req.seedPhrase) };
    case "createSigner": {
      const s = await adapter.createSigner(req.sealed, req.key, req.chains);
      const id = nextHandle++;
      signers.set(id, s);
      return { handle: id };
    }
    case "signer.deriveAddress":
      return { address: await signer(req.handle).deriveAddress(req.chain, req.index) };
    case "signer.quoteSend":
      return { feeQuote: await signer(req.handle).quoteSend(req.intent, req.accountIndex) };
    case "signer.send":
      return { txResult: await signer(req.handle).send(req.intent, req.accountIndex) };
    case "signer.reencrypt":
      return { sealed: await signer(req.handle).reencrypt(req.key) };
    case "signer.dispose": {
      await signer(req.handle).dispose();
      signers.delete(req.handle);
      return {};
    }
    case "createBalanceReader": {
      const r = await adapter.createBalanceReader(req.chains);
      const id = nextHandle++;
      readers.set(id, r);
      return { handle: id };
    }
    case "reader.getNativeBalance":
      return { amount: await reader(req.handle).getNativeBalance(req.chain, req.address) };
    case "reader.getTokenBalance":
      return {
        amount: await reader(req.handle).getTokenBalance(req.chain, req.token, req.address),
      };
    case "reader.getTransactionStatus":
      return {
        status: await reader(req.handle).getTransactionStatus(req.chain, req.hash, req.address),
      };
    case "reader.dispose": {
      await reader(req.handle).dispose();
      readers.delete(req.handle);
      return {};
    }
  }
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  handle(req)
    .then((result) => {
      const ok: WorkerResponse = { id: req.id, ok: true, result };
      scope.postMessage(ok);
    })
    .catch((err: unknown) => {
      const fail: WorkerResponse = { id: req.id, ok: false, error: serializeError(err) };
      scope.postMessage(fail);
    });
};
