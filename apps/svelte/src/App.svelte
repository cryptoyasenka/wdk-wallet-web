<script lang="ts">
  /**
   * The whole wallet UI as one client-side state machine — the Svelte 5 twin
   * of apps/next/app/page.tsx, driven entirely by the byte-unchanged
   * @wdk-web/wallet-core public surface.
   *
   * Scope is deliberately Phase-1 parity (P3-CONTEXT D-01): create / import /
   * backup / unlock / portfolio / receive. No send / activity / passkey — those
   * are already proven by the Next.js reference app; re-porting them to the
   * *minimal* second host would be scope creep, not a stronger portability
   * proof. The point being demonstrated is that the same engine, with the same
   * typed-error surface and the same host-port contract, runs framework-free
   * under a second bundler/framework. Every wallet-core call goes through
   * `act()` which maps the package's typed errors to a human message instead of
   * string-matching.
   */
  import {
    InvalidSeedPhraseError,
    UnsupportedChainError,
    VaultDecryptError,
    WalletError,
    WalletExistsError,
    type Balance,
    type ChainId,
  } from "@wdk-web/wallet-core";
  import { getWalletApp } from "./lib/engine";

  type Phase = "loading" | "onboarding" | "backup" | "locked" | "unlocked";
  type OnboardMode = "create" | "import";

  // Identical to apps/next: ask for both, keep whichever the build configured.
  // Bitcoin is gracefully absent in the EVM-only web build (typed
  // UnsupportedChainError, swallowed below — never a silent gap).
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

  /** bigint minor units → decimal string, trailing zeros trimmed. */
  function formatUnits(amount: bigint, decimals: number): string {
    if (decimals === 0) return amount.toString();
    const neg = amount < 0n;
    const digits = (neg ? -amount : amount).toString().padStart(decimals + 1, "0");
    const whole = digits.slice(0, digits.length - decimals);
    const frac = digits.slice(digits.length - decimals).replace(/0+$/, "");
    return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
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
      enter("locked");
    });
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
      <h2>Receive</h2>
      {#if addresses.length === 0}
        <p class="muted">No addresses.</p>
      {/if}
      <ul>
        {#each addresses as [chain, addr] (chain)}
          <li class="receive">
            <div class="muted upper">{chain}</div>
            <code>{addr}</code>
          </li>
        {/each}
      </ul>
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
</style>
