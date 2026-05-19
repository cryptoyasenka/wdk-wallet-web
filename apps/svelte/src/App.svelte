<script lang="ts">
  /**
   * The whole wallet UI as one client-side state machine — the Svelte 5 twin
   * of apps/next/app/page.tsx, driven entirely by the byte-unchanged
   * @wdk-web/wallet-core public surface.
   *
   * Scope: create / import / unlock / portfolio / receive and send / itemised
   * tx-confirm / activity — full parity with the Next.js reference, on the same
   * engine, so "one core, two real apps" is literally true. The one deliberate
   * delta is unlock: passphrase only (no WebAuthn/PRF). That is a host-port
   * choice, not an engine gap — WebAuthn is already proven by apps/next, the
   * engine's unlock contract is identical either way, and a second passkey UI
   * on the second host would prove nothing new about the engine.
   *
   * Activity is the local outgoing send-log (ADR-003) — outgoing,
   * this-wallet-via-this-app only; statuses come from the on-chain receipt and
   * are never fabricated. The send confirm screen renders decoded transaction
   * fields (amount, asset, chain, recipient, fee), never opaque hex, per
   * docs/SECURITY.md. Every wallet-core call goes through `act()` which maps the
   * package's typed errors to a human message instead of string-matching.
   */
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
  import qrcode from "qrcode-generator";
  import jsQR from "jsqr";
  import { onDestroy, tick } from "svelte";
  import { getWalletApp } from "./lib/engine";
  import { extractAddress } from "./lib/extract-address";

  type Phase = "loading" | "onboarding" | "backup" | "locked" | "unlocked";
  type OnboardMode = "create" | "import";

  // Identical to apps/next: ask both chains; the build keeps whichever it
  // configured. BTC ships on web when VITE_BTC_ELECTRUM_WS_URL is set; with no
  // endpoint it surfaces a typed UnsupportedChainError (swallowed below — a
  // documented operational input, never a silent gap).
  const RECEIVE_CHAINS: readonly ChainId[] = ["bitcoin", "ethereum"];

  let phase = $state<Phase>("loading");
  let mode = $state<OnboardMode>("create");
  let busy = $state(false);
  let error = $state<string | null>(null);

  let passphrase = $state("");
  let confirmPass = $state("");
  let seedInput = $state("");
  let revealedSeed = $state("");
  let backedUp = $state(false);

  let balances = $state<readonly Balance[] | null>(null);
  let balancesError = $state<string | null>(null);
  let addresses = $state<ReadonlyArray<readonly [ChainId, string]>>([]);

  let sendAssetKey = $state("");
  let sendTo = $state("");
  let sendAmount = $state("");
  let quote = $state<{ readonly intent: TxIntent; readonly fee: FeeQuote } | null>(null);
  let sentHash = $state<string | null>(null);
  let activity = $state<readonly ActivityItem[] | null>(null);
  let activityError = $state<string | null>(null);

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

  /**
   * Address QR as an SVG path. Offline, synchronous, zero runtime deps —
   * byte-identical logic to apps/next/app/page.tsx so "one core, two real
   * apps" stays honest down to the QR. typeNumber 0 = auto-size, EC "M",
   * default Byte mode (correct for any hex / base58 / bech32 address).
   */
  function qrPath(value: string): { d: string; size: number } {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
      }
    }
    return { d, size: n + 8 }; // 4-module quiet zone each side (QR spec)
  }

  /**
   * QR-scan-to-fill-recipient — the Svelte twin of apps/next/app/page.tsx's
   * <QrScanner>, same shape on the same logic. Purely additive: the recipient
   * input stays the default, manual entry is never gated on this. Decode is
   * getUserMedia → off-screen canvas → jsQR in a requestAnimationFrame loop;
   * on a hit the value is unwrapped by the byte-identical `extractAddress`
   * (so the existing wallet-core Send validation runs on it unchanged) and
   * the camera is released.
   *
   * The MediaStream is stopped on EVERY exit path — hit, cancel, error and
   * unmount (onDestroy) — through the single `stopScan()` teardown, so the
   * camera is never left running. Failures surface as honest inline text.
   *
   * Honest limit: the camera path is browser-only and cannot run under the
   * headless unit env; only the pure `extractAddress` unwrap is unit-tested
   * (apps/svelte/test/extract-address.test.ts).
   */
  let scanOpen = $state(false);
  let scanError = $state<string | null>(null);
  let videoEl = $state<HTMLVideoElement | null>(null);
  let scanStream: MediaStream | null = null;
  let scanRaf: number | null = null;

  function stopScan(): void {
    if (scanRaf !== null) {
      cancelAnimationFrame(scanRaf);
      scanRaf = null;
    }
    if (scanStream) {
      for (const t of scanStream.getTracks()) t.stop();
      scanStream = null;
    }
    if (videoEl) videoEl.srcObject = null;
  }

  function closeScan(): void {
    stopScan();
    scanOpen = false;
  }

  function startScan(): void {
    scanError = null;
    // getUserMedia needs a secure context (https or localhost). Say so
    // plainly instead of surfacing an opaque DOMException.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      scanError =
        "Camera scanning needs a secure context (https or localhost). Type or paste the address instead.";
      scanOpen = true;
      return;
    }
    scanOpen = true;
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(async (stream) => {
        scanStream = stream;
        await tick(); // let the {:else} <video> mount before wiring it
        const v = videoEl;
        if (!v) {
          // Closed before the permission prompt resolved — release at once.
          stopScan();
          return;
        }
        v.srcObject = stream;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const loop = (): void => {
          scanRaf = null;
          if (!scanStream) return; // stopped between frames
          if (ctx && v.readyState >= v.HAVE_ENOUGH_DATA && v.videoWidth > 0) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, {
              inversionAttempts: "dontInvert",
            });
            if (code) {
              sendTo = extractAddress(code.data);
              stopScan();
              scanOpen = false;
              return;
            }
          }
          scanRaf = requestAnimationFrame(loop);
        };
        scanRaf = requestAnimationFrame(loop);
      })
      .catch((e: unknown) => {
        const name = e instanceof Error ? e.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          scanError = "Camera permission denied. Type or paste the address instead.";
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          scanError = "No camera found. Type or paste the address instead.";
        } else {
          scanError = "Could not start the camera. Type or paste the address instead.";
        }
      });
  }

  onDestroy(stopScan);

  /** Status → pill modifier. Pending is the honest default (never fabricated). */
  function statusClass(status: ActivityItem["status"]): "ok" | "bad" | "wait" {
    if (status === "confirmed") return "ok";
    if (status === "failed") return "bad";
    return "wait";
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

  /** Run a wallet-core call with shared busy/error handling. */
  async function act(fn: () => Promise<void>): Promise<void> {
    busy = true;
    error = null;
    try {
      await fn();
    } catch (e) {
      error = messageFor(e);
    } finally {
      busy = false;
    }
  }

  function resetSecrets(): void {
    passphrase = "";
    confirmPass = "";
    seedInput = "";
    revealedSeed = "";
    backedUp = false;
  }

  async function loadActivity(): Promise<void> {
    activityError = null;
    try {
      // getActivity refreshes pending entries from the on-chain receipt when
      // unlocked and never fabricates a status (see activity-log.ts / ADR-003).
      activity = await getWalletApp().engine.getActivity();
    } catch (e) {
      activity = null;
      activityError = messageFor(e);
    }
  }

  async function loadUnlockedView(): Promise<void> {
    const { engine } = getWalletApp();

    const found: Array<readonly [ChainId, string]> = [];
    for (const chain of RECEIVE_CHAINS) {
      try {
        found.push([chain, await engine.getAddress(chain)]);
      } catch (e) {
        if (!(e instanceof UnsupportedChainError)) throw e; // chain just not configured
      }
    }
    addresses = found;

    balancesError = null;
    try {
      balances = await engine.getBalances();
    } catch (e) {
      balances = null;
      balancesError = messageFor(e);
    }

    await loadActivity();
  }

  function enter(next: Phase): void {
    error = null;
    phase = next;
    if (next === "unlocked") void loadUnlockedView();
  }

  // Mount: decide the opening screen from persisted state. No reactive deps are
  // read, so this runs exactly once (the Svelte 5 analogue of Next's mount
  // effect). `alive` guards a teardown during the async resolve.
  $effect(() => {
    let alive = true;
    void (async () => {
      try {
        const has = await getWalletApp().engine.hasWallet();
        if (alive) phase = has ? "locked" : "onboarding";
      } catch (e) {
        if (alive) {
          error = messageFor(e);
          phase = "onboarding";
        }
      }
    })();
    return () => {
      alive = false;
    };
  });

  const onCreate = (): Promise<void> =>
    act(async () => {
      if (passphrase.length < 8) throw new Error("Use a passphrase of at least 8 characters.");
      if (passphrase !== confirmPass) throw new Error("Passphrases do not match.");
      const app = getWalletApp();
      app.setPassphrase(passphrase);
      const { seedPhrase } = await app.engine.createWallet();
      revealedSeed = seedPhrase;
      enter("backup");
    });

  const onImport = (): Promise<void> =>
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

  const onConfirmBackup = (): Promise<void> =>
    act(async () => {
      await getWalletApp().engine.unlock();
      resetSecrets();
      enter("unlocked");
    });

  const onUnlock = (): Promise<void> =>
    act(async () => {
      if (!passphrase) throw new Error("Enter your passphrase.");
      const app = getWalletApp();
      app.setPassphrase(passphrase);
      await app.engine.unlock();
      resetSecrets();
      enter("unlocked");
    });

  const onLock = (): Promise<void> =>
    act(async () => {
      await getWalletApp().engine.lock();
      balances = null;
      addresses = [];
      quote = null;
      sentHash = null;
      sendTo = "";
      sendAmount = "";
      activity = null;
      activityError = null;
      enter("locked");
    });

  /** Build the intent, get a fee quote, and move to the itemised confirm. */
  const onReview = (): Promise<void> =>
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
      quote = { intent, fee };
    });

  const onConfirmSend = (): Promise<void> =>
    act(async () => {
      if (!quote) return;
      const res = await getWalletApp().engine.send(quote.intent);
      quote = null;
      sendTo = "";
      sendAmount = "";
      sentHash = res.hash;
      await loadUnlockedView(); // balance reflects the pending spend; log gained an entry
    });

  function onCancelQuote(): void {
    error = null;
    quote = null;
  }
</script>

<main>
  <header>
    <h1>WDK Web Wallet — Svelte</h1>
    <p class="muted">
      The same headless <code>@wdk-web/wallet-core</code> engine the Next.js
      reference app ships, consumed unchanged by a second framework.
    </p>
  </header>

  {#if error}
    <p class="alert" role="alert">{error}</p>
  {/if}

  {#if phase === "loading"}
    <section class="card">Loading wallet…</section>
  {/if}

  {#if phase === "onboarding"}
    <section class="card">
      <div class="tabs">
        <button class:active={mode === "create"} onclick={() => (mode = "create")}>
          Create
        </button>
        <button class:active={mode === "import"} onclick={() => (mode = "import")}>
          Import
        </button>
      </div>

      {#if mode === "import"}
        <label>
          <span>Seed phrase</span>
          <textarea
            rows="3"
            placeholder="twelve or twenty-four words separated by spaces"
            autocomplete="off"
            spellcheck="false"
            bind:value={seedInput}
          ></textarea>
        </label>
      {/if}

      <label>
        <span>Passphrase (encrypts the vault on this device)</span>
        <input
          type="password"
          placeholder="at least 8 characters"
          autocomplete="new-password"
          bind:value={passphrase}
        />
      </label>

      {#if mode === "create"}
        <label>
          <span>Confirm passphrase</span>
          <input
            type="password"
            placeholder="repeat it"
            autocomplete="new-password"
            bind:value={confirmPass}
          />
        </label>
      {/if}

      <button
        class="primary"
        disabled={busy}
        onclick={mode === "create" ? onCreate : onImport}
      >
        {busy ? "Working…" : mode === "create" ? "Create wallet" : "Import wallet"}
      </button>
    </section>
  {/if}

  {#if phase === "backup"}
    <section class="card">
      <h2>Back up your seed phrase</h2>
      <p class="muted">
        This is the only way to recover the wallet. Write it down offline. It is
        shown once.
      </p>
      <pre>{revealedSeed}</pre>
      <label class="checkbox">
        <input type="checkbox" bind:checked={backedUp} />
        I have written it down somewhere safe.
      </label>
      <button class="primary" disabled={busy || !backedUp} onclick={onConfirmBackup}>
        {busy ? "Working…" : "Continue"}
      </button>
    </section>
  {/if}

  {#if phase === "locked"}
    <section class="card">
      <h2>Unlock</h2>
      <label>
        <span>Passphrase</span>
        <input
          type="password"
          placeholder="your passphrase"
          autocomplete="current-password"
          bind:value={passphrase}
          onkeydown={(e) => {
            if (e.key === "Enter") void onUnlock();
          }}
        />
      </label>
      <button class="primary" disabled={busy} onclick={onUnlock}>
        {busy ? "Working…" : "Unlock"}
      </button>
    </section>
  {/if}

  {#if phase === "unlocked"}
    <section class="card">
      <div class="row">
        <h2>Portfolio</h2>
        <button class="link" disabled={busy} onclick={onLock}>Lock</button>
      </div>
      {#if balances === null && !balancesError}
        <p class="muted">Loading balances…</p>
      {/if}
      {#if balancesError}
        <p class="error">{balancesError}</p>
        <button class="link" onclick={() => void loadUnlockedView()}>Retry</button>
      {/if}
      {#if balances && balances.length === 0}
        <p class="muted">No configured assets.</p>
      {/if}
      {#if balances && balances.length > 0}
        <ul>
          {#each balances as b (`${b.asset.symbol}-${b.asset.chain}`)}
            <li>
              <span><strong>{b.asset.symbol}</strong> on {b.asset.chain}</span>
              <span class="mono">{formatUnits(b.amount, b.asset.decimals)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="card">
      <h2>Send</h2>

      {#if !balances || balances.length === 0}
        <p class="muted">No sendable assets on configured chains.</p>
      {/if}

      {#if balances && balances.length > 0 && !quote && sentHash === null}
        <label>
          <span>Asset</span>
          <select bind:value={sendAssetKey}>
            {#each balances as b (assetKey(b.asset))}
              <option value={assetKey(b.asset)}>
                {b.asset.symbol} on {b.asset.chain}
              </option>
            {/each}
          </select>
        </label>
        <label>
          <span>Recipient address</span>
          <input
            type="text"
            placeholder="destination address"
            autocomplete="off"
            bind:value={sendTo}
          />
        </label>
        {#if !scanOpen}
          <button type="button" class="scan" onclick={startScan}>Scan QR</button>
        {:else}
          <div class="scanbox">
            {#if scanError}
              <p class="error">{scanError}</p>
            {:else}
              <video
                bind:this={videoEl}
                autoplay
                playsinline
                muted
                class="scanvid"
                aria-label="QR scanner camera preview"
              ></video>
            {/if}
            <button type="button" class="scan" onclick={closeScan}>
              {scanError ? "Close" : "Cancel"}
            </button>
          </div>
        {/if}
        <label>
          <span>Amount</span>
          <input
            type="text"
            placeholder="0.0"
            autocomplete="off"
            bind:value={sendAmount}
          />
        </label>
        <button class="primary" disabled={busy} onclick={onReview}>
          {busy ? "Working…" : "Review transaction"}
        </button>
      {/if}

      {#if quote}
        {@const q = quote}
        <p class="muted">
          Decoded from the transaction — not raw hex. Check every line.
        </p>
        <dl>
          <div>
            <dt>Amount</dt>
            <dd>
              {formatUnits(q.intent.amount, q.intent.asset.decimals)}
              {q.intent.asset.symbol}
            </dd>
          </div>
          <div>
            <dt>Asset</dt>
            <dd>
              {q.intent.asset.token
                ? `${q.intent.asset.symbol} (${q.intent.asset.token})`
                : q.intent.asset.symbol}
            </dd>
          </div>
          <div>
            <dt>Chain</dt>
            <dd>{q.intent.asset.chain}</dd>
          </div>
          <div>
            <dt>Recipient</dt>
            <dd class="mono">{q.intent.to}</dd>
          </div>
          <div>
            <dt>Network fee</dt>
            <dd>
              {formatUnits(q.fee.fee, q.fee.feeAsset.decimals)}
              {q.fee.feeAsset.symbol}
            </dd>
          </div>
        </dl>
        <div class="actions">
          <button class="primary" disabled={busy} onclick={onConfirmSend}>
            {busy ? "Working…" : "Confirm & send"}
          </button>
          <button class="secondary" disabled={busy} onclick={onCancelQuote}>
            Cancel
          </button>
        </div>
      {/if}

      {#if sentHash !== null}
        <p class="success">
          Broadcast. It appears below as pending until the network confirms it.
        </p>
        <code>{sentHash}</code>
        <button class="link mt" onclick={() => (sentHash = null)}>Send another</button>
      {/if}
    </section>

    <section class="card">
      <h2>Receive</h2>
      {#if addresses.length === 0}
        <p class="muted">No addresses.</p>
      {/if}
      <ul>
        {#each addresses as [chain, addr] (chain)}
          {@const qr = qrPath(addr)}
          <li class="receive">
            <div class="muted upper">{chain}</div>
            <code>{addr}</code>
            <svg
              class="qr"
              viewBox="0 0 {qr.size} {qr.size}"
              shape-rendering="crispEdges"
              role="img"
              aria-label="{chain} address QR"
            >
              <rect width={qr.size} height={qr.size} fill="#fff" />
              <path d={qr.d} fill="#000" />
            </svg>
          </li>
        {/each}
      </ul>
    </section>

    <section class="card">
      <div class="row">
        <h2>Activity</h2>
        <button class="link" disabled={busy} onclick={() => void loadActivity()}>
          Refresh
        </button>
      </div>

      {#if activity === null && !activityError}
        <p class="muted">Loading activity…</p>
      {/if}
      {#if activityError}
        <p class="error">{activityError}</p>
      {/if}
      {#if activity && activity.length === 0}
        <p class="muted">No sends yet.</p>
      {/if}
      {#if activity && activity.length > 0}
        <ul>
          {#each activity as it (it.hash)}
            <li>
              <span>
                <strong>
                  {it.direction === "out" ? "−" : "+"}{formatUnits(
                    it.amount,
                    it.asset.decimals,
                  )}
                  {it.asset.symbol}
                </strong>
                <span class="muted">on {it.asset.chain}</span>
                <span class="muted block">{new Date(it.timestamp).toLocaleString()}</span>
              </span>
              <span
                class="pill"
                class:ok={statusClass(it.status) === "ok"}
                class:bad={statusClass(it.status) === "bad"}
                class:wait={statusClass(it.status) === "wait"}
              >
                {it.status}
              </span>
            </li>
          {/each}
        </ul>
      {/if}

      <p class="muted note">
        Outgoing sends made in this wallet via this app. Inbound and external
        transfers need a WDK indexer — see docs/ARCHITECTURE.md (ADR-003).
        Statuses come from the on-chain receipt, never guessed.
      </p>
    </section>
  {/if}
</main>

<style>
  main {
    max-width: 28rem;
    margin: 0 auto;
    padding: 2.5rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    font-family:
      ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #e7e7ea;
  }
  h1 {
    font-size: 1.25rem;
    margin: 0 0 0.25rem;
  }
  h2 {
    font-size: 1rem;
    margin: 0 0 0.75rem;
  }
  .muted {
    color: #9a9aa3;
    font-size: 0.875rem;
  }
  .upper {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.7rem;
    margin-bottom: 0.25rem;
  }
  .card {
    border: 1px solid #2a2a31;
    background: #161619;
    border-radius: 0.75rem;
    padding: 1.25rem;
  }
  .alert,
  .error {
    color: #f5a3a3;
    font-size: 0.875rem;
  }
  .alert {
    border: 1px solid rgba(245, 80, 80, 0.4);
    background: rgba(245, 80, 80, 0.1);
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
  }
  .tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  label {
    display: block;
    margin-bottom: 1rem;
  }
  label > span {
    display: block;
    font-size: 0.875rem;
    color: #9a9aa3;
    margin-bottom: 0.25rem;
  }
  label.checkbox {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
  }
  input,
  textarea {
    width: 100%;
    box-sizing: border-box;
    background: #0e0e10;
    border: 1px solid #2a2a31;
    border-radius: 0.375rem;
    padding: 0.5rem 0.75rem;
    color: inherit;
    font: inherit;
    font-size: 0.875rem;
  }
  label.checkbox input {
    width: auto;
  }
  input:focus,
  textarea:focus {
    outline: none;
    border-color: #6c8cff;
  }
  button {
    cursor: pointer;
    font: inherit;
    border-radius: 0.375rem;
  }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .tabs button {
    padding: 0.375rem 0.75rem;
    font-size: 0.875rem;
    background: transparent;
    border: 1px solid #2a2a31;
    color: #9a9aa3;
  }
  .tabs button.active {
    background: #6c8cff;
    border-color: #6c8cff;
    color: #0e0e10;
  }
  button.primary {
    width: 100%;
    padding: 0.625rem 1rem;
    font-size: 0.875rem;
    font-weight: 500;
    background: #6c8cff;
    border: none;
    color: #0e0e10;
  }
  button.link {
    background: none;
    border: none;
    color: #9a9aa3;
    font-size: 0.875rem;
    text-decoration: underline;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0;
    font-size: 0.875rem;
    border-top: 1px solid #2a2a31;
  }
  li.receive {
    display: block;
  }
  .qr {
    display: block;
    width: 9rem;
    height: 9rem;
    margin-top: 0.5rem;
    background: #fff;
    border-radius: 0.375rem;
    padding: 0.5rem;
    box-sizing: border-box;
  }
  .scan {
    margin-bottom: 1rem;
    padding: 0.375rem 0.75rem;
    font-size: 0.75rem;
    background: transparent;
    border: 1px solid #2a2a31;
    color: #9a9aa3;
  }
  .scanbox {
    margin-bottom: 1rem;
    border: 1px solid #2a2a31;
    background: #0e0e10;
    border-radius: 0.375rem;
    padding: 0.5rem;
  }
  .scanbox .scan {
    margin-bottom: 0;
    margin-top: 0.5rem;
  }
  .scanvid {
    display: block;
    width: 100%;
    border-radius: 0.375rem;
  }
  .mono,
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8rem;
  }
  code {
    display: block;
    word-break: break-all;
    background: #0e0e10;
    border: 1px solid #2a2a31;
    border-radius: 0.375rem;
    padding: 0.5rem;
  }
  pre {
    background: #0e0e10;
    border: 1px solid #2a2a31;
    border-radius: 0.375rem;
    padding: 0.75rem;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.875rem;
    margin: 0 0 1rem;
  }
  select {
    width: 100%;
    box-sizing: border-box;
    background: #0e0e10;
    border: 1px solid #2a2a31;
    border-radius: 0.375rem;
    padding: 0.5rem 0.75rem;
    color: inherit;
    font: inherit;
    font-size: 0.875rem;
  }
  select:focus {
    outline: none;
    border-color: #6c8cff;
  }
  dl {
    margin: 0 0 1rem;
    border: 1px solid #2a2a31;
    border-radius: 0.375rem;
  }
  dl > div {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
  }
  dl > div + div {
    border-top: 1px solid #2a2a31;
  }
  dt {
    color: #9a9aa3;
    flex-shrink: 0;
  }
  dd {
    margin: 0;
    text-align: right;
    word-break: break-all;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
  }
  .actions .primary {
    width: auto;
    flex: 1;
  }
  button.secondary {
    padding: 0.625rem 1rem;
    font-size: 0.875rem;
    background: transparent;
    border: 1px solid #2a2a31;
    color: #9a9aa3;
  }
  .success {
    color: #86efac;
    font-size: 0.875rem;
    margin: 0 0 0.5rem;
  }
  .block {
    display: block;
    font-size: 0.75rem;
  }
  .note {
    margin: 0.75rem 0 0;
  }
  .mt {
    margin-top: 0.75rem;
  }
  .pill {
    flex-shrink: 0;
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
    font-size: 0.75rem;
    white-space: nowrap;
  }
  .pill.ok {
    background: rgba(74, 222, 128, 0.15);
    color: #86efac;
  }
  .pill.bad {
    background: rgba(248, 113, 113, 0.15);
    color: #fca5a5;
  }
  .pill.wait {
    background: rgba(250, 204, 21, 0.15);
    color: #fde047;
  }
</style>
