/**
 * Main-thread proxy in front of `crypto.worker.ts`. Implements `WdkAdapter`
 * by correlation-id RPC over a `Worker`; it imports no `@tetherto/*` and
 * never sees a plaintext seed — only the opaque sealed blob + CryptoKey go
 * out, only addresses / quotes / hashes / balances come back (ADR-004).
 *
 * Typed errors are reconstructed by name on this side (`rehydrateError`) so
 * callers' `instanceof`-style branches keep working across the worker edge.
 */
import type { ChainId, FeeQuote, TxIntent, TxResult } from "../types.js";
import type { ChainRegistry, WdkAdapter, WdkBalanceReader, WdkSigner } from "./types.js";
import type { TxStatus, WorkerRequest, WorkerResponse } from "./worker-protocol.js";
import { rehydrateError } from "./worker-protocol.js";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class WorkerWdkAdapter implements WdkAdapter {
  readonly #worker: Worker;
  readonly #pending = new Map<number, Pending>();
  #nextId = 1;

  constructor(worker: Worker) {
    this.#worker = worker;
    this.#worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      const slot = this.#pending.get(msg.id);
      if (!slot) return;
      this.#pending.delete(msg.id);
      if (msg.ok) slot.resolve(msg.result);
      else slot.reject(rehydrateError(msg.error));
    };
  }

  /** Post a request and resolve with its (caller-known-shaped) result. */
  #req<T>(make: (id: number) => WorkerRequest): Promise<T> {
    const id = this.#nextId++;
    const msg = make(id);
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.#worker.postMessage(msg);
    });
  }

  async generateSeedPhrase(words: 12 | 24 = 12): Promise<string> {
    const { seedPhrase } = await this.#req<{ seedPhrase: string }>((id) => ({
      id,
      kind: "generateSeedPhrase",
      words,
    }));
    return seedPhrase;
  }

  async isValidSeedPhrase(seedPhrase: string): Promise<boolean> {
    const { valid } = await this.#req<{ valid: boolean }>((id) => ({
      id,
      kind: "isValidSeedPhrase",
      seedPhrase,
    }));
    return valid;
  }

  async createSigner(
    sealed: Uint8Array,
    key: CryptoKey,
    chains: ChainRegistry,
  ): Promise<WdkSigner> {
    const { handle } = await this.#req<{ handle: number }>((id) => ({
      id,
      kind: "createSigner",
      sealed,
      key,
      chains,
    }));
    return new WorkerSigner(this, handle);
  }

  async createBalanceReader(chains: ChainRegistry): Promise<WdkBalanceReader> {
    const { handle } = await this.#req<{ handle: number }>((id) => ({
      id,
      kind: "createBalanceReader",
      chains,
    }));
    return new WorkerBalanceReader(this, handle);
  }

  /** Internal: a handle-scoped request, used by the proxy signer/reader. */
  rpc<T>(make: (id: number) => WorkerRequest): Promise<T> {
    return this.#req<T>(make);
  }
}

class WorkerSigner implements WdkSigner {
  readonly #a: WorkerWdkAdapter;
  readonly #h: number;
  constructor(adapter: WorkerWdkAdapter, handle: number) {
    this.#a = adapter;
    this.#h = handle;
  }

  async deriveAddress(chain: ChainId, index: number): Promise<string> {
    const { address } = await this.#a.rpc<{ address: string }>((id) => ({
      id,
      kind: "signer.deriveAddress",
      handle: this.#h,
      chain,
      index,
    }));
    return address;
  }

  async quoteSend(intent: TxIntent, accountIndex: number): Promise<FeeQuote> {
    const { feeQuote } = await this.#a.rpc<{ feeQuote: FeeQuote }>((id) => ({
      id,
      kind: "signer.quoteSend",
      handle: this.#h,
      intent,
      accountIndex,
    }));
    return feeQuote;
  }

  async send(intent: TxIntent, accountIndex: number): Promise<TxResult> {
    const { txResult } = await this.#a.rpc<{ txResult: TxResult }>((id) => ({
      id,
      kind: "signer.send",
      handle: this.#h,
      intent,
      accountIndex,
    }));
    return txResult;
  }

  async reencrypt(newKey: CryptoKey): Promise<Uint8Array> {
    const { sealed } = await this.#a.rpc<{ sealed: Uint8Array }>((id) => ({
      id,
      kind: "signer.reencrypt",
      handle: this.#h,
      key: newKey,
    }));
    return sealed;
  }

  async dispose(): Promise<void> {
    await this.#a.rpc((id) => ({ id, kind: "signer.dispose", handle: this.#h }));
  }
}

class WorkerBalanceReader implements WdkBalanceReader {
  readonly #a: WorkerWdkAdapter;
  readonly #h: number;
  constructor(adapter: WorkerWdkAdapter, handle: number) {
    this.#a = adapter;
    this.#h = handle;
  }

  async getNativeBalance(chain: ChainId, address: string): Promise<bigint> {
    const { amount } = await this.#a.rpc<{ amount: bigint }>((id) => ({
      id,
      kind: "reader.getNativeBalance",
      handle: this.#h,
      chain,
      address,
    }));
    return amount;
  }

  async getTokenBalance(chain: ChainId, token: string, address: string): Promise<bigint> {
    const { amount } = await this.#a.rpc<{ amount: bigint }>((id) => ({
      id,
      kind: "reader.getTokenBalance",
      handle: this.#h,
      chain,
      token,
      address,
    }));
    return amount;
  }

  async getTransactionStatus(
    chain: ChainId,
    hash: string,
    address: string,
  ): Promise<TxStatus> {
    const { status } = await this.#a.rpc<{ status: TxStatus }>((id) => ({
      id,
      kind: "reader.getTransactionStatus",
      handle: this.#h,
      chain,
      hash,
      address,
    }));
    return status;
  }

  async dispose(): Promise<void> {
    await this.#a.rpc((id) => ({ id, kind: "reader.dispose", handle: this.#h }));
  }
}
