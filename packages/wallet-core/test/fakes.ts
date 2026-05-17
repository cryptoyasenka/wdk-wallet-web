/**
 * Hand-written test doubles for the injected ports and the WDK containment
 * layer. The engine is exercised through `createWalletEngineWithAdapter` with
 * `FakeWdkAdapter`, so no real `@tetherto/*` is ever loaded in unit tests.
 *
 * `PassphraseUnlock` is NOT a mock: it derives a real AES-GCM `CryptoKey` via
 * the package's own `deriveAesGcmKey`, so the seed vault is roundtripped for
 * real and a wrong passphrase produces a genuine GCM auth-tag failure.
 */
import type {
  ChainId,
  CryptoWorker,
  FeeQuote,
  StorageAdapter,
  TxIntent,
  TxResult,
  UnlockProvider,
} from "../src/types.js";
import type {
  ChainRegistry,
  WdkAdapter,
  WdkBalanceReader,
  WdkSigner,
} from "../src/wdk/types.js";
import { deriveAesGcmKey } from "../src/secrets/index.js";
import { BTC_NATIVE, ETH_NATIVE } from "../src/chains/index.js";

type TxStatus = "pending" | "confirmed" | "failed";

/** Deterministic 32-bit FNV-1a → hex, so a fake address is seed-bound. */
function fnv1aHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/* ---- Injected host ports ---------------------------------------------- */

/** In-memory `StorageAdapter`. */
export class MemoryStorage implements StorageAdapter {
  readonly map = new Map<string, Uint8Array>();
  async get(key: string): Promise<Uint8Array | null> {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: Uint8Array): Promise<void> {
    this.map.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/**
 * Real passphrase-based `UnlockProvider`. Fixed salt + low PBKDF2 iterations
 * (test speed only) — the engine never sees either; key derivation is wholly
 * the provider's concern, matching the production contract.
 */
export class PassphraseUnlock implements UnlockProvider {
  static readonly SALT = new Uint8Array(16).fill(7);
  constructor(private readonly passphrase: string) {}
  async unlock(): Promise<CryptoKey> {
    return deriveAesGcmKey(this.passphrase, PassphraseUnlock.SALT, 1000);
  }
  async isEnrolled(): Promise<boolean> {
    return true;
  }
}

/** Spy `CryptoWorker`. P1 only ever calls `lock()`; the rest are unused. */
export class SpyCryptoWorker implements CryptoWorker {
  lockCalls = 0;
  async deriveAddress(): Promise<string> {
    throw new Error("CryptoWorker.deriveAddress is a Phase-2 path");
  }
  async signTransaction(): Promise<Uint8Array> {
    throw new Error("CryptoWorker.signTransaction is a Phase-2 path");
  }
  async lock(): Promise<void> {
    this.lockCalls++;
  }
}

/* ---- WDK containment fake --------------------------------------------- */

class FakeSigner implements WdkSigner {
  disposed = false;
  /** Every send() recorded, so tests can assert what was broadcast. */
  readonly sent: TxIntent[] = [];
  constructor(readonly seedPhrase: string) {}
  async deriveAddress(chain: ChainId, index: number): Promise<string> {
    if (this.disposed) throw new Error("signer disposed");
    return `0x${fnv1aHex(`${this.seedPhrase}|${chain}|${index}`)}`;
  }
  async quoteSend(intent: TxIntent): Promise<FeeQuote> {
    if (this.disposed) throw new Error("signer disposed");
    // Deterministic, plausible: a fixed gas units count, asset-labelled in
    // the chain's native coin (ETH for ethereum, BTC for bitcoin).
    return { fee: 21_000n, feeAsset: intent.asset.chain === "bitcoin" ? BTC_NATIVE : ETH_NATIVE };
  }
  async send(intent: TxIntent): Promise<TxResult> {
    if (this.disposed) throw new Error("signer disposed");
    this.sent.push(intent);
    const hash = `0x${fnv1aHex(
      `${this.seedPhrase}|${intent.asset.chain}|${intent.to}|${intent.amount}`,
    )}`;
    return { hash, chain: intent.asset.chain };
  }
  dispose(): void {
    this.disposed = true;
  }
}

class FakeBalanceReader implements WdkBalanceReader {
  disposed = false;
  constructor(
    private readonly native: Record<string, bigint>,
    private readonly token: Record<string, bigint>,
    /** Mutable hash→status map; a test flips an entry to simulate mining. */
    readonly txStatus: Map<string, TxStatus>,
  ) {}
  async getNativeBalance(chain: ChainId): Promise<bigint> {
    if (this.disposed) throw new Error("reader disposed");
    return this.native[chain] ?? 0n;
  }
  async getTokenBalance(chain: ChainId, token: string): Promise<bigint> {
    if (this.disposed) throw new Error("reader disposed");
    return this.token[`${chain}:${token}`] ?? 0n;
  }
  async getTransactionStatus(_chain: ChainId, hash: string): Promise<TxStatus> {
    if (this.disposed) throw new Error("reader disposed");
    // Unknown hash defaults to "pending" (just-broadcast, not yet mined).
    return this.txStatus.get(hash) ?? "pending";
  }
  dispose(): void {
    this.disposed = true;
  }
}

export interface FakeBalances {
  native?: Record<string, bigint>;
  token?: Record<string, bigint>;
  /** Seed transaction statuses; the engine reads these via getActivity. */
  txStatus?: Map<string, TxStatus>;
}

/** Fake `WdkAdapter`: deterministic, seed-bound, never loads real WDK. */
export class FakeWdkAdapter implements WdkAdapter {
  readonly signers: FakeSigner[] = [];
  readonly readers: FakeBalanceReader[] = [];
  constructor(private readonly balances: FakeBalances = {}) {}

  generateSeedPhrase(words: 12 | 24 = 12): string {
    const tail = words === 24 ? "art" : "about";
    return `${Array<string>(words - 1).fill("abandon").join(" ")} ${tail}`;
  }

  isValidSeedPhrase(seedPhrase: string): boolean {
    const words = seedPhrase.trim().split(/\s+/);
    return (
      (words.length === 12 || words.length === 24) &&
      words.every((w) => /^[a-z]+$/.test(w))
    );
  }

  createSigner(seedPhrase: string, _chains: ChainRegistry): WdkSigner {
    const s = new FakeSigner(seedPhrase);
    this.signers.push(s);
    return s;
  }

  createBalanceReader(_chains: ChainRegistry): WdkBalanceReader {
    const r = new FakeBalanceReader(
      this.balances.native ?? {},
      this.balances.token ?? {},
      this.balances.txStatus ?? new Map(),
    );
    this.readers.push(r);
    return r;
  }
}
