"use client";

/**
 * The whole wallet UI as one client-side state machine.
 *
 * Scope (see docs/ARCHITECTURE.md → Phasing): create / import / unlock /
 * portfolio / receive (Phase 1) and send / itemised tx-confirm / activity
 * (Phase 2). Activity is the local outgoing send-log (ADR-003) — outgoing,
 * this-wallet-via-this-app only; statuses come from the on-chain receipt and
 * are never fabricated. The send confirm screen renders decoded transaction
 * fields (amount, asset, chain, recipient, fee), never opaque hex, per
 * docs/SECURITY.md. Every wallet-core call goes through `act()` which maps the
 * package's typed error surface to a human message instead of string-matching.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  InvalidSeedPhraseError,
  UnsupportedChainError,
  VaultDecryptError,
  WalletError,
  WalletExistsError,
  type ActivityItem,
  type Asset,
  type Balance,
  type ChainId,
  type FeeQuote,
  type TxIntent,
} from "@wdk-web/wallet-core";
import { getWalletApp } from "@/lib/engine";

type Phase = "loading" | "onboarding" | "backup" | "locked" | "unlocked";
type OnboardMode = "create" | "import";

const RECEIVE_CHAINS: readonly ChainId[] = ["bitcoin", "ethereum"];

/** bigint minor units → decimal string, trailing zeros trimmed. */
function formatUnits(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString();
  const neg = amount < 0n;
  const digits = (neg ? -amount : amount).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/**
 * Decimal string → bigint minor units (inverse of `formatUnits`). Rejects
 * anything that is not a positive amount and refuses to silently truncate
 * money: more fraction digits than the asset has decimals is an error, not a
 * round. `decimals === 0` (no fractional unit) only accepts a whole number.
 */
function parseUnits(input: string, decimals: number): bigint {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Enter a positive amount, e.g. 12.5");
  const dot = s.indexOf(".");
  const whole = dot === -1 ? s : s.slice(0, dot);
  const frac = dot === -1 ? "" : s.slice(dot + 1);
  if (frac.length > decimals) {
    throw new Error(`Too many decimal places — this asset has ${decimals}.`);
  }
  const value = BigInt(whole + frac.padEnd(decimals, "0"));
  if (value <= 0n) throw new Error("Amount must be greater than zero.");
  return value;
}

/** Stable option/lookup key for an asset (symbol is not unique across chains). */
function assetKey(a: Asset): string {
  return `${a.symbol}-${a.chain}`;
}

/** Status → badge classes. Pending is the honest default (never fabricated). */
function statusClass(status: ActivityItem["status"]): string {
  if (status === "confirmed") return "bg-green-500/15 text-green-300";
  if (status === "failed") return "bg-red-500/15 text-red-300";
  return "bg-yellow-500/15 text-yellow-300";
}

/** Friendly copy for the typed errors the core throws (and a safe fallback). */
function messageFor(err: unknown): string {
  if (err instanceof VaultDecryptError) return "Wrong passphrase, or the vault is corrupt.";
  if (err instanceof InvalidSeedPhraseError) return "That is not a valid BIP-39 seed phrase.";
  if (err instanceof WalletExistsError) return "A wallet already exists on this device.";
  if (err instanceof WalletError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [mode, setMode] = useState<OnboardMode>("create");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [passphrase, setPassphrase] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [seedInput, setSeedInput] = useState("");
  const [revealedSeed, setRevealedSeed] = useState("");
  const [backedUp, setBackedUp] = useState(false);

  const [balances, setBalances] = useState<readonly Balance[] | null>(null);
  const [balancesError, setBalancesError] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<ReadonlyArray<readonly [ChainId, string]>>([]);

  const [sendAssetKey, setSendAssetKey] = useState("");
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [quote, setQuote] = useState<{ readonly intent: TxIntent; readonly fee: FeeQuote } | null>(
    null,
  );
  const [sentHash, setSentHash] = useState<string | null>(null);
  const [activity, setActivity] = useState<readonly ActivityItem[] | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);

  /** Run a wallet-core call with shared busy/error handling. */
  const act = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const has = await getWalletApp().engine.hasWallet();
        if (alive) setPhase(has ? "locked" : "onboarding");
      } catch (e) {
        if (alive) {
          setError(messageFor(e));
          setPhase("onboarding");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loadActivity = useCallback(async () => {
    setActivityError(null);
    try {
      // getActivity refreshes pending entries from the on-chain receipt when
      // unlocked and never fabricates a status (see activity-log.ts / ADR-003).
      setActivity(await getWalletApp().engine.getActivity());
    } catch (e) {
      setActivity(null);
      setActivityError(messageFor(e));
    }
  }, []);

  const loadUnlockedView = useCallback(async () => {
    const { engine } = getWalletApp();

    const found: Array<readonly [ChainId, string]> = [];
    for (const chain of RECEIVE_CHAINS) {
      try {
        found.push([chain, await engine.getAddress(chain)]);
      } catch (e) {
        if (!(e instanceof UnsupportedChainError)) throw e; // chain just not configured
      }
    }
    setAddresses(found);

    setBalancesError(null);
    try {
      setBalances(await engine.getBalances());
    } catch (e) {
      setBalances(null);
      setBalancesError(messageFor(e));
    }

    await loadActivity();
  }, [loadActivity]);

  const enter = useCallback(
    (next: Phase) => {
      setError(null);
      setPhase(next);
      if (next === "unlocked") void loadUnlockedView();
    },
    [loadUnlockedView],
  );

  function resetSecrets() {
    setPassphrase("");
    setConfirmPass("");
    setSeedInput("");
    setRevealedSeed("");
    setBackedUp(false);
  }

  const onCreate = () =>
    act(async () => {
      if (passphrase.length < 8) throw new Error("Use a passphrase of at least 8 characters.");
      if (passphrase !== confirmPass) throw new Error("Passphrases do not match.");
      const app = getWalletApp();
      app.setPassphrase(passphrase);
      const { seedPhrase } = await app.engine.createWallet();
      setRevealedSeed(seedPhrase);
      enter("backup");
    });

  const onImport = () =>
    act(async () => {
      if (passphrase.length < 8) throw new Error("Use a passphrase of at least 8 characters.");
      const phrase = seedInput.trim().replace(/\s+/g, " ");
      if (!phrase) throw new Error("Enter your seed phrase.");
      const app = getWalletApp();
      app.setPassphrase(passphrase);
      await app.engine.importWallet(phrase);
      await app.engine.unlock();
      resetSecrets();
      enter("unlocked");
    });

  const onConfirmBackup = () =>
    act(async () => {
      await getWalletApp().engine.unlock();
      resetSecrets();
      enter("unlocked");
    });

  const onUnlock = () =>
    act(async () => {
      if (!passphrase) throw new Error("Enter your passphrase.");
      const app = getWalletApp();
      app.setPassphrase(passphrase);
      await app.engine.unlock();
      resetSecrets();
      enter("unlocked");
    });

  const onLock = () =>
    act(async () => {
      await getWalletApp().engine.lock();
      setBalances(null);
      setAddresses([]);
      setQuote(null);
      setSentHash(null);
      setSendTo("");
      setSendAmount("");
      setActivity(null);
      setActivityError(null);
      enter("locked");
    });

  /** Build the intent, get a fee quote, and move to the itemised confirm. */
  const onReview = () =>
    act(async () => {
      const list = balances ?? [];
      const asset =
        list.find((b) => assetKey(b.asset) === sendAssetKey)?.asset ?? list[0]?.asset;
      if (!asset) throw new Error("No sendable assets on configured chains.");
      const to = sendTo.trim();
      if (!to) throw new Error("Enter a recipient address.");
      const amount = parseUnits(sendAmount, asset.decimals);
      const intent: TxIntent = { asset, to, amount };
      const fee = await getWalletApp().engine.quoteSend(intent);
      setQuote({ intent, fee });
    });

  const onConfirmSend = () =>
    act(async () => {
      if (!quote) return;
      const res = await getWalletApp().engine.send(quote.intent);
      setQuote(null);
      setSendTo("");
      setSendAmount("");
      setSentHash(res.hash);
      await loadUnlockedView(); // balance now reflects the pending spend; log gained an entry
    });

  const onCancelQuote = () => {
    setError(null);
    setQuote(null);
  };

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col gap-6 px-5 py-10">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">WDK Web Wallet</h1>
        <p className="text-sm text-[--color-muted]">
          Reference self-custodial wallet on the Tether Wallet Development Kit.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      {phase === "loading" && <Card>Loading wallet…</Card>}

      {phase === "onboarding" && (
        <Card>
          <div className="mb-4 flex gap-2 text-sm">
            <Tab active={mode === "create"} onClick={() => setMode("create")}>
              Create
            </Tab>
            <Tab active={mode === "import"} onClick={() => setMode("import")}>
              Import
            </Tab>
          </div>

          {mode === "import" && (
            <Field label="Seed phrase">
              <textarea
                className="h-24 w-full resize-none rounded-md border border-[--color-border] bg-[--color-bg] p-3 text-sm break-anywhere outline-none focus:border-[--color-accent]"
                placeholder="twelve or twenty-four words separated by spaces"
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          )}

          <Field label="Passphrase (encrypts the vault on this device)">
            <Input
              type="password"
              value={passphrase}
              onChange={setPassphrase}
              placeholder="at least 8 characters"
              autoComplete="new-password"
            />
          </Field>

          {mode === "create" && (
            <Field label="Confirm passphrase">
              <Input
                type="password"
                value={confirmPass}
                onChange={setConfirmPass}
                placeholder="repeat it"
                autoComplete="new-password"
              />
            </Field>
          )}

          <Button onClick={mode === "create" ? onCreate : onImport} busy={busy}>
            {mode === "create" ? "Create wallet" : "Import wallet"}
          </Button>
        </Card>
      )}

      {phase === "backup" && (
        <Card>
          <h2 className="mb-1 font-medium">Back up your seed phrase</h2>
          <p className="mb-3 text-sm text-[--color-muted]">
            This is the only way to recover the wallet. Write it down offline. It
            is shown once.
          </p>
          <pre className="mb-4 rounded-md border border-[--color-border] bg-[--color-bg] p-3 text-sm leading-relaxed break-anywhere whitespace-pre-wrap">
            {revealedSeed}
          </pre>
          <label className="mb-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={backedUp}
              onChange={(e) => setBackedUp(e.target.checked)}
            />
            I have written it down somewhere safe.
          </label>
          <Button onClick={onConfirmBackup} busy={busy} disabled={!backedUp}>
            Continue
          </Button>
        </Card>
      )}

      {phase === "locked" && (
        <Card>
          <h2 className="mb-3 font-medium">Unlock</h2>
          <Field label="Passphrase">
            <Input
              type="password"
              value={passphrase}
              onChange={setPassphrase}
              placeholder="your passphrase"
              autoComplete="current-password"
              onEnter={onUnlock}
            />
          </Field>
          <Button onClick={onUnlock} busy={busy}>
            Unlock
          </Button>
        </Card>
      )}

      {phase === "unlocked" && (
        <>
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium">Portfolio</h2>
              <button
                className="text-sm text-[--color-muted] underline-offset-2 hover:underline"
                onClick={onLock}
                disabled={busy}
              >
                Lock
              </button>
            </div>
            {balances === null && !balancesError && (
              <p className="text-sm text-[--color-muted]">Loading balances…</p>
            )}
            {balancesError && (
              <div className="text-sm">
                <p className="mb-2 text-red-300">{balancesError}</p>
                <button
                  className="text-[--color-accent] underline-offset-2 hover:underline"
                  onClick={() => void loadUnlockedView()}
                >
                  Retry
                </button>
              </div>
            )}
            {balances && balances.length === 0 && (
              <p className="text-sm text-[--color-muted]">No configured assets.</p>
            )}
            {balances && balances.length > 0 && (
              <ul className="divide-y divide-[--color-border]">
                {balances.map((b) => (
                  <li
                    key={`${b.asset.symbol}-${b.asset.chain}`}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span>
                      <span className="font-medium">{b.asset.symbol}</span>{" "}
                      <span className="text-[--color-muted]">on {b.asset.chain}</span>
                    </span>
                    <span className="font-mono">
                      {formatUnits(b.amount, b.asset.decimals)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 font-medium">Send</h2>

            {(!balances || balances.length === 0) && (
              <p className="text-sm text-[--color-muted]">
                No sendable assets on configured chains.
              </p>
            )}

            {balances && balances.length > 0 && !quote && sentHash === null && (
              <>
                <Field label="Asset">
                  <select
                    className="w-full rounded-md border border-[--color-border] bg-[--color-bg] px-3 py-2 text-sm outline-none focus:border-[--color-accent]"
                    value={sendAssetKey || assetKey(balances[0]!.asset)}
                    onChange={(e) => setSendAssetKey(e.target.value)}
                  >
                    {balances.map((b) => (
                      <option key={assetKey(b.asset)} value={assetKey(b.asset)}>
                        {b.asset.symbol} on {b.asset.chain}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Recipient address">
                  <Input
                    type="text"
                    value={sendTo}
                    onChange={setSendTo}
                    placeholder="destination address"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Amount">
                  <Input
                    type="text"
                    value={sendAmount}
                    onChange={setSendAmount}
                    placeholder="0.0"
                    autoComplete="off"
                  />
                </Field>
                <Button onClick={onReview} busy={busy}>
                  Review transaction
                </Button>
              </>
            )}

            {quote && (
              <div className="text-sm">
                <p className="mb-3 text-[--color-muted]">
                  Decoded from the transaction — not raw hex. Check every line.
                </p>
                <dl className="mb-4 divide-y divide-[--color-border] rounded-md border border-[--color-border]">
                  <Row
                    k="Amount"
                    v={`${formatUnits(quote.intent.amount, quote.intent.asset.decimals)} ${quote.intent.asset.symbol}`}
                  />
                  <Row
                    k="Asset"
                    v={
                      quote.intent.asset.token
                        ? `${quote.intent.asset.symbol} (${quote.intent.asset.token})`
                        : quote.intent.asset.symbol
                    }
                  />
                  <Row k="Chain" v={quote.intent.asset.chain} />
                  <Row k="Recipient" v={quote.intent.to} mono />
                  <Row
                    k="Network fee"
                    v={`${formatUnits(quote.fee.fee, quote.fee.feeAsset.decimals)} ${quote.fee.feeAsset.symbol}`}
                  />
                </dl>
                <div className="flex gap-2">
                  <Button onClick={onConfirmSend} busy={busy}>
                    Confirm &amp; send
                  </Button>
                  <button
                    className="rounded-md border border-[--color-border] px-4 py-2.5 text-sm text-[--color-muted] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={onCancelQuote}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {sentHash !== null && (
              <div className="text-sm">
                <p className="mb-2 text-green-300">
                  Broadcast. It appears below as pending until the network confirms it.
                </p>
                <code className="block break-anywhere rounded-md border border-[--color-border] bg-[--color-bg] p-2 text-xs">
                  {sentHash}
                </code>
                <button
                  className="mt-3 text-[--color-accent] underline-offset-2 hover:underline"
                  onClick={() => setSentHash(null)}
                >
                  Send another
                </button>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 font-medium">Receive</h2>
            {addresses.length === 0 && (
              <p className="text-sm text-[--color-muted]">No addresses.</p>
            )}
            <ul className="flex flex-col gap-3">
              {addresses.map(([chain, addr]) => (
                <li key={chain}>
                  <div className="mb-1 text-xs uppercase tracking-wide text-[--color-muted]">
                    {chain}
                  </div>
                  <div className="flex items-start gap-2">
                    <code className="flex-1 rounded-md border border-[--color-border] bg-[--color-bg] p-2 text-xs break-anywhere">
                      {addr}
                    </code>
                    <CopyButton value={addr} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium">Activity</h2>
              <button
                className="text-sm text-[--color-muted] underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void loadActivity()}
                disabled={busy}
              >
                Refresh
              </button>
            </div>

            {activity === null && !activityError && (
              <p className="text-sm text-[--color-muted]">Loading activity…</p>
            )}
            {activityError && <p className="text-sm text-red-300">{activityError}</p>}
            {activity && activity.length === 0 && (
              <p className="text-sm text-[--color-muted]">No sends yet.</p>
            )}
            {activity && activity.length > 0 && (
              <ul className="divide-y divide-[--color-border]">
                {activity.map((it) => (
                  <li
                    key={it.hash}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <span>
                      <span className="font-medium">
                        {it.direction === "out" ? "−" : "+"}
                        {formatUnits(it.amount, it.asset.decimals)} {it.asset.symbol}
                      </span>{" "}
                      <span className="text-[--color-muted]">on {it.asset.chain}</span>
                      <span className="block text-xs text-[--color-muted]">
                        {new Date(it.timestamp).toLocaleString()}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${statusClass(it.status)}`}
                    >
                      {it.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-3 text-xs text-[--color-muted]">
              Outgoing sends made in this wallet via this app. Inbound and
              external transfers need a WDK indexer — see docs/ARCHITECTURE.md
              (ADR-003). Statuses come from the on-chain receipt, never guessed.
            </p>
          </Card>
        </>
      )}
    </main>
  );
}

/* ---- Presentational primitives (kept local; no UI-kit dependency) ------- */

function Card({ children }: { readonly children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[--color-border] bg-[--color-surface] p-5">
      {children}
    </section>
  );
}

/** One labelled line of the itemised tx-confirm. */
function Row({
  k,
  v,
  mono,
}: {
  readonly k: string;
  readonly v: string;
  readonly mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2">
      <dt className="shrink-0 text-[--color-muted]">{k}</dt>
      <dd className={`text-right ${mono ? "break-anywhere font-mono text-xs" : ""}`}>{v}</dd>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-sm text-[--color-muted]">{label}</span>
      {children}
    </label>
  );
}

function Input({
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  onEnter,
}: {
  readonly type: "text" | "password";
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly placeholder?: string;
  readonly autoComplete?: string;
  readonly onEnter?: () => void;
}) {
  return (
    <input
      className="w-full rounded-md border border-[--color-border] bg-[--color-bg] px-3 py-2 text-sm outline-none focus:border-[--color-accent]"
      type={type}
      value={value}
      placeholder={placeholder}
      autoComplete={autoComplete}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && onEnter) onEnter();
      }}
    />
  );
}

function Button({
  children,
  onClick,
  busy,
  disabled,
}: {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
}) {
  return (
    <button
      className="w-full rounded-md bg-[--color-accent] px-4 py-2.5 text-sm font-medium text-[--color-accent-fg] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      onClick={onClick}
      disabled={busy || disabled}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

function Tab({
  children,
  active,
  onClick,
}: {
  readonly children: ReactNode;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      className={`rounded-md px-3 py-1.5 transition-colors ${
        active
          ? "bg-[--color-accent] text-[--color-accent-fg]"
          : "border border-[--color-border] text-[--color-muted] hover:text-white"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CopyButton({ value }: { readonly value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="shrink-0 rounded-md border border-[--color-border] px-2 py-2 text-xs text-[--color-muted] hover:text-white"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}
